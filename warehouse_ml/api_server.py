"""
api_server.py  (v5 - PHARMACY REQUEST PREDICTION + PER-BARANGAY RECOMMENDATION)
--------------------------------------------------------------------------
Ito ang ML mula sa PANIG NG WAREHOUSE. Ang sagot dito:

  1. "Ano ang malamang i-REQUEST ng PHARMACY sa akin (warehouse) sa
     susunod na mga araw/linggo/buwan?" -- base sa HISTORICAL REQUEST
     pattern ng pharmacy (kada ilang araw sila humihingi, at gaano
     karami).

  2. "Base sa current stock ko, ilang PERCENT/BILANG ang dapat kong
     ilaan (RESERVE) para dito sa inaasahang request ng pharmacy?"

  3. "Ang MATITIRA pagkatapos ng reserve -- ilan ang pwede kong ipamigay
     sa 96 BARANGAY, PANTAY-PANTAY bawat isa?"

     >>> BAGO (v5): Hindi lang bilang/aggregate ang sagot dito ngayon --
     may TUNAY NA LISTAHAN na kung sino eksaktong tatanggap at ilan
     (per-barangay recommendation), kasama na ang PATAS na paghahati
     ng leftover mula sa floor division (walang masasayang na unit). <<<

Run: python -m uvicorn api_server:app --reload --port 8000
Docs: http://127.0.0.1:8000/docs
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Optional, List
import pandas as pd
import joblib
import os
import time
from dotenv import load_dotenv
from supabase import create_client

# ---------- ML (may uncertainty -- hinuhulaan ang FUTURE PHARMACY DEMAND) ----------
from training_logic import train_from_supabase

# ---------- PLAIN ARITHMETIC (walang ML -- POLICY na "EQUAL FOR ALL" na
# paghahati sa 96 barangay, sadyang HIWALAY na module dahil ibang klase
# ng logic ito kumpara sa ML) ----------
from barangay_distribution import (
    fetch_barangay_list_from_destinations,
    build_equal_barangay_recommendation,
    attach_equal_split,
    save_confirmed_distribution,
)

load_dotenv()
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = FastAPI(title="WHIMS RHU - Warehouse ML Service v5 (Pharmacy Request Prediction + Barangay Recommendation)")

# ============================================================
# SUPABASE CONNECTION (optional -- para awtomatikong makuha ang
# current_stock mula sa database sa halip na i-type sa request body)
# ============================================================
_supabase = None
def get_supabase():
    global _supabase
    if _supabase is None:
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_KEY")
        if not url or not key:
            return None
        _supabase = create_client(url, key)
    return _supabase

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

def load_models():
    models_dir = os.path.join(BASE_DIR, "models")
    data_dir = os.path.join(BASE_DIR, "data")
    return {
        "qty_model": joblib.load(os.path.join(models_dir, "quantity_model.pkl")),
        "le_med": joblib.load(os.path.join(models_dir, "le_medicine.pkl")),
        "le_season": joblib.load(os.path.join(models_dir, "le_season.pkl")),
        "latest_features": pd.read_csv(os.path.join(data_dir, "latest_features.csv")),
    }

_cache = None
def get_models():
    global _cache
    if _cache is None:
        try:
            _cache = load_models()
        except FileNotFoundError as e:
            raise HTTPException(500, f"Hindi pa na-train ang model. Patakbuhin muna ang 2_train_model.py. ({e})")
    return _cache

def get_season(month_num: int) -> str:
    return "Wet" if month_num in [6,7,8,9,10,11] else "Dry"


class PredictRequest(BaseModel):
    # OPTIONAL na ngayon -- kung hindi ipinasa, kukunin diretso mula sa
    # Supabase "warehouse_stock" table (tingnan ang /predict-distribution-auto)
    current_stock: Optional[Dict[str, int]] = None
    number_of_barangays: Optional[int] = None       # None = awtomatikong kukunin mula sa 'destinations' table
    safety_buffer_percent: Optional[float] = 0.15  # +15% extra sa reserve
    forecast_days_ahead: Optional[int] = 30        # tumingin ka pasulong ng ilang araw


def fetch_barangay_count_from_destinations() -> int:
    """
    Kunin ang bilang ng ACTIVE na barangay mula sa 'destinations' table
    (destination_type = 'Barangay'). Ito ang gagamitin bilang
    number_of_barangays kung hindi ito ipinasa nang manual sa request.
    """
    sb = get_supabase()
    if sb is None:
        return 96  # fallback default kung walang Supabase connection
    resp = (
        sb.table("destinations")
        .select("destination_id", count="exact")
        .eq("destination_type", "Barangay")
        .eq("is_active", True)
        .execute()
    )
    count = resp.count if resp.count is not None else len(resp.data)
    return count if count and count > 0 else 96


def fetch_medicine_units() -> Dict[str, str]:
    """
    Kunin ang TOTOONG unit ng bawat gamot mula sa 'medicines' table
    (hal. "Piece", "Bottle", "Box", "Loose", "Strip") -- ito ang
    ipapalit sa dating generic na "u" sa Demand Forecast at Barangay
    Distribution cards, para tumugma sa TALAGANG nasa medicine
    inventory, hindi basta paikot na label.
    """
    sb = get_supabase()
    if sb is None:
        return {}
    resp = sb.table("medicines").select("generic_name, unit").execute()
    if not resp.data:
        return {}
    return {row["generic_name"]: (row.get("unit") or "unit") for row in resp.data}


def fetch_pending_committed_requests() -> Dict[str, int]:
    """
    Kunin ang mga request na 'pending', 'confirm', o 'alerted' pa lang
    (ibig sabihin, TIYAK na babawasin sa warehouse balang araw, pero
    HINDI PA nababawas ngayon dahil hindi pa na-'received').

    Ito ay TIYAK na commitment, HINDI prediction -- kaya isasama natin
    ito nang buo (walang buffer/discount) sa reserve computation,
    bukod pa sa ML-predicted future demand.
    """
    sb = get_supabase()
    if sb is None:
        return {}

    resp = (
        sb.table("pharmacy_requests")
        .select("medicine_name, requested_qty, fulfilled_qty, status")
        .in_("status", ["pending", "confirm", "alerted"])
        .execute()
    )
    if not resp.data:
        return {}

    df = pd.DataFrame(resp.data)
    # Natitirang dami na hindi pa na-fulfill (kung may partial fulfillment na)
    df["remaining_qty"] = df["requested_qty"] - df["fulfilled_qty"].fillna(0)
    df["remaining_qty"] = df["remaining_qty"].clip(lower=0)

    return df.groupby("medicine_name")["remaining_qty"].sum().astype(int).to_dict()


def fetch_current_stock_from_supabase() -> Dict[str, int]:
    """
    Kunin ang current_stock mula sa Supabase, gamit ang TOTOONG schema:

      medicine_batches (boxes, total_quantity [computed], status, expiration_date)
            |
            | medicine_id (foreign key)
            v
      medicines (generic_name, category, ...)

    Ang "current stock" ay ang KABUUAN ng total_quantity sa lahat ng
    batch na 'available' O 'low_stock' pa (ibig sabihin may laman
    pa rin, hindi 'out_of_stock'/'expired'/'archived'), at hindi pa
    expired.

    PAALALA: ang pagtutugma ng pangalan papunta sa pharmacy_requests.
    medicine_name ay TEXT MATCHING lang -- kailangang magkatugma nang
    eksakto ang spelling sa dalawang table. Kung minsan magkaiba
    (hal. "Paracetamol" sa isa, "Paracetamol 500mg" sa isa), hindi
    magmamatch ang reserve computation sa demand prediction.
    """
    sb = get_supabase()
    if sb is None:
        raise HTTPException(500, "Walang SUPABASE_URL/SUPABASE_KEY na naka-set sa .env file.")

    # I-fetch ang mga batch na MAY LAMAN pa ('available' o 'low_stock'),
    # kasama ang generic_name mula sa naka-link na medicines table
    # (PostgREST embedding via foreign key). Hindi kasama ang
    # 'out_of_stock', 'expired', 'archived'.
    resp = (
        sb.table("medicine_batches")
        .select("total_quantity, status, expiration_date, medicines(generic_name)")
        .in_("status", ["available", "low_stock"])
        .execute()
    )
    if not resp.data:
        raise HTTPException(400, "Walang 'available' o 'low_stock' na batch sa medicine_batches table.")

    df = pd.DataFrame(resp.data)
    # I-flatten ang naka-nest na 'medicines' object papunta sa generic_name column
    df["generic_name"] = df["medicines"].apply(lambda m: m.get("generic_name") if isinstance(m, dict) else None)
    df = df.dropna(subset=["generic_name"])

    # I-exclude ang mga expired na batch kahit pa 'available' pa ang status
    # (safety check, sakaling hindi pa na-update ang status automatically)
    today = pd.Timestamp.today().normalize()
    if "expiration_date" in df.columns:
        exp = pd.to_datetime(df["expiration_date"], errors="coerce")
        df = df[exp.isna() | (exp >= today)]

    stock_series = df.groupby("generic_name")["total_quantity"].sum()
    return stock_series.astype(int).to_dict()


# ============================================================
# I-predict ang: (a) KAILAN ang susunod na 1-3 request cycles ng
# pharmacy sa loob ng forecast window, at (b) ILAN bawat cycle
# ============================================================
def build_pharmacy_request_forecast(forecast_days_ahead: int):
    models = get_models()
    qty_model = models["qty_model"]
    le_med = models["le_med"]
    le_season = models["le_season"]
    latest_features = models["latest_features"]

    today = pd.Timestamp.today().normalize()
    known_med = set(le_med.classes_)
    lf = latest_features[latest_features["medicine_name"].isin(known_med)].reset_index(drop=True)

    events = []  # bawat predicted na susunod na REQUEST EVENT (may petsa + bilang)

    for _, r in lf.iterrows():
        med = r["medicine_name"]
        interval = max(3, int(r["days_since_last_request"]))  # gaano kadalas humingi ang pharmacy dito
        med_enc = le_med.transform([med])[0]

        # I-predict ang bawat SUSUNOD na request cycle sa loob ng forecast window
        next_date = today + pd.Timedelta(days=interval)
        rolling_avg = r["rolling_avg_recent"]
        same_month_ly = r["same_month_last_year"]

        while next_date <= today + pd.Timedelta(days=forecast_days_ahead):
            season_enc = le_season.transform([get_season(next_date.month)])[0]
            X_pred = pd.DataFrame([{
                "day_of_week": next_date.dayofweek,
                "day_of_month": next_date.day,
                "week_of_year": int(next_date.isocalendar().week),
                "month": next_date.month,
                "season_enc": season_enc,
                "medicine_enc": med_enc,
                "rolling_avg_recent": rolling_avg,
                "same_month_last_year": same_month_ly,
                "days_since_last_request": interval,
            }])
            predicted_qty = max(0, round(qty_model.predict(X_pred)[0]))

            events.append({
                "predicted_request_date": next_date.strftime("%Y-%m-%d"),
                "year": next_date.year,
                "month": next_date.month,
                "week_of_year": int(next_date.isocalendar().week),
                "medicine_name": med,
                "medicine_category": r["medicine_category"],
                "predicted_quantity_requested": int(predicted_qty),
            })

            # gamitin ang bagong prediction bilang updated rolling average
            # para sa susunod na cycle sa loob ng forecast window
            rolling_avg = (rolling_avg + predicted_qty) / 2
            next_date = next_date + pd.Timedelta(days=interval)

    return pd.DataFrame(events)


@app.post("/predict-distribution")
def predict_distribution(req: PredictRequest):
    # Kung walang current_stock na ipinasa sa request body, awtomatikong
    # kukunin ito mula sa Supabase "warehouse_stock" table
    current_stock = req.current_stock or fetch_current_stock_from_supabase()

    # >>> PLAIN ARITHMETIC (barangay_distribution.py): kunin ang BUONG
    # listahan ng barangay (hindi lang bilang), para magamit sa
    # per-barangay recommendation sa ibaba. WALANG ML dito. <<<
    barangay_list = fetch_barangay_list_from_destinations(get_supabase())
    num_brgy_final = req.number_of_barangays or len(barangay_list) or fetch_barangay_count_from_destinations()

    # TIYAK na commitment (pending/confirm/alerted na requests, hindi pa
    # na-receive) -- ito ay babawasin din sa warehouse balang araw
    pending_committed = fetch_pending_committed_requests()

    # Totoong unit ng bawat gamot (Piece/Bottle/Box/Loose/Strip/atbp.)
    # mula sa 'medicines' table -- ipapalit sa dating generic na "u"
    unit_by_med = fetch_medicine_units()

    events_df = build_pharmacy_request_forecast(req.forecast_days_ahead)

    if events_df.empty:
        raise HTTPException(400, "Walang na-generate na forecast. I-check ang latest_features.csv.")

    # ---------- A) LISTAHAN NG BAWAT PREDICTED REQUEST EVENT ----------
    # (ito ang direktang sagot sa "kailan at ilan ang maaaring i-request")
    predicted_requests = events_df.sort_values("predicted_request_date").to_dict(orient="records")

    # ---------- B) WEEKLY VIEW (aggregate) ----------
    weekly = (
        events_df.groupby(["year", "week_of_year", "medicine_name", "medicine_category"])
        ["predicted_quantity_requested"].sum().reset_index()
        .rename(columns={"predicted_quantity_requested": "predicted_qty_this_week"})
    )

    # ---------- C) MONTHLY VIEW (aggregate) ----------
    monthly = (
        events_df.groupby(["year", "month", "medicine_name", "medicine_category"])
        ["predicted_quantity_requested"].sum().reset_index()
        .rename(columns={"predicted_quantity_requested": "predicted_qty_this_month"})
    )

    # ---------- D) TOTAL PREDICTED DEMAND (buong forecast window) ----------
    total_demand = (
        events_df.groupby(["medicine_name", "medicine_category"])
        ["predicted_quantity_requested"].sum().reset_index()
        .rename(columns={"predicted_quantity_requested": "total_predicted_pharmacy_request"})
    )
    total_all = total_demand["total_predicted_pharmacy_request"].sum()
    total_demand["percentage_of_total_predicted_requests"] = (
        (total_demand["total_predicted_pharmacy_request"] / total_all * 100).round(2) if total_all > 0 else 0
    )
    total_demand = total_demand.sort_values("total_predicted_pharmacy_request", ascending=False)
    total_demand["unit"] = total_demand["medicine_name"].map(unit_by_med).fillna("unit")

    # ---------- E) RESERVE PARA SA PHARMACY (EXACT + BUFFERED) ----------
    # ---------- F) MATITIRA -> EQUAL SPLIT SA BAWAT BARANGAY ----------
    num_brgy = num_brgy_final
    result_per_medicine = []
    distribution_exact = []
    distribution_buffered = []

    for med, stock in current_stock.items():
        pred_row = total_demand[total_demand["medicine_name"] == med]
        predicted_pharmacy_request = int(pred_row["total_predicted_pharmacy_request"].values[0]) if len(pred_row) else 0
        unit = unit_by_med.get(med, "unit")

        # (A) TIYAK na commitment -- pending/confirm/alerted na requests
        #     na hindi pa na-receive, kaya hindi pa nababawas sa stock
        pending_qty = int(pending_committed.get(med, 0))

        # (B) ML-predicted FUTURE demand sa loob ng forecast window
        # RESERVE = TIYAK na commitment + PREDICTED future demand
        reserve_exact = pending_qty + predicted_pharmacy_request
        available_exact = max(0, stock - reserve_exact)
        pct_available_exact = round((available_exact / stock * 100), 2) if stock > 0 else 0
        pct_reserved_exact = round((reserve_exact / stock * 100), 2) if stock > 0 else 0

        # Buffered version: ang TIYAK na commitment ay walang buffer
        # (dahil totoo na ito), pero ang PREDICTED part ay bibigyan ng
        # +15% safety margin
        reserve_buffered = pending_qty + round(predicted_pharmacy_request * (1 + req.safety_buffer_percent))
        available_buffered = max(0, stock - reserve_buffered)
        pct_available_buffered = round((available_buffered / stock * 100), 2) if stock > 0 else 0
        pct_reserved_buffered = round((reserve_buffered / stock * 100), 2) if stock > 0 else 0

        result_per_medicine.append({
            "medicine_name": med,
            "unit": unit,
            "current_stock_sa_warehouse": stock,
            "pending_committed_requests": pending_qty,
            "predicted_future_pharmacy_request": predicted_pharmacy_request,
            "percentage_ilalaan_para_sa_pharmacy_exact": pct_reserved_exact,
            "reserve_for_pharmacy_exact": reserve_exact,
            "available_for_96_barangays_exact": available_exact,
            "percentage_available_for_barangays_exact": pct_available_exact,
            "percentage_ilalaan_para_sa_pharmacy_buffered_15pct": pct_reserved_buffered,
            "reserve_for_pharmacy_buffered_15pct": reserve_buffered,
            "available_for_96_barangays_buffered": available_buffered,
            "percentage_available_for_barangays_buffered": pct_available_buffered,
            "stock_status": "⚠️ SHORTAGE - hindi sapat kahit para lang sa pharmacy" if stock < reserve_buffered else "✅ SUFFICIENT",
        })

        # ---------- PLAIN ARITHMETIC mula rito pababa -- WALANG ML.
        # `attach_equal_split()` (barangay_distribution.py) ay floor
        # division + remainder lang, batay sa "equal for all" na policy. ----------
        distribution_exact.append(attach_equal_split(med, available_exact, num_brgy, unit))
        distribution_buffered.append(attach_equal_split(med, available_buffered, num_brgy, unit))

    # ---------- G) TUNAY NA PER-BARANGAY RECOMMENDATION (barangay_distribution.py) ----------
    # Hindi lang aggregate/bilang -- listahan na ng SINONG barangay
    # (destination_id + pangalan) at ILAN eksakto ang matatanggap nila,
    # kasama na ang patas na paghahati ng leftover. Muli, WALANG ML dito.
    barangay_recommendation_exact = build_equal_barangay_recommendation(distribution_exact, barangay_list)
    barangay_recommendation_buffered = build_equal_barangay_recommendation(distribution_buffered, barangay_list)

    # ---------- LOG sa ml_predictions_log (best-effort, hindi dapat
    # makasira sa response kahit mag-fail ang pag-log) ----------
    try:
        log_predictions_to_supabase(
            result_per_medicine, barangay_recommendation_exact,
            req.forecast_days_ahead
        )
    except Exception as log_err:
        print(f"[WARN] Hindi na-log ang prediction: {log_err}")

    return {
        "forecast_period_days": req.forecast_days_ahead,
        "number_of_barangays": num_brgy,
        "safety_buffer_percent_used": req.safety_buffer_percent,

        # (1) KAILAN at ILAN -- bawat predicted request event ng pharmacy
        "predicted_pharmacy_requests_detail": predicted_requests,
        "predicted_pharmacy_requests_weekly": weekly.sort_values(["year", "week_of_year"]).to_dict(orient="records"),
        "predicted_pharmacy_requests_monthly": monthly.sort_values(["year", "month"]).to_dict(orient="records"),

        # bilang, uri, percentage ng total predicted pharmacy requests
        "pharmacy_demand_summary": total_demand.to_dict(orient="records"),

        # (2) Reserve computation -- ilang percent/bilang ilalaan para sa pharmacy
        "stock_and_reserve_summary": result_per_medicine,

        # (3a) Aggregate view: ilan bawat barangay (bilang lang, walang pangalan)
        "barangay_equal_distribution_exact": distribution_exact,
        "barangay_equal_distribution_buffered": distribution_buffered,

        # (3b) >>> BAGO (v5): TUNAY na recommendation -- per barangay,
        # per medicine, may destination_id + pangalan + eksaktong bilang
        "barangay_recommendation_exact": barangay_recommendation_exact,
        "barangay_recommendation_buffered": barangay_recommendation_buffered,
    }


def log_predictions_to_supabase(
    result_per_medicine, barangay_recommendation_exact, forecast_days_ahead
):
    """
    I-save sa 'demand_forecasts' (ML output, base + buffer, status='draft')
    at 'barangay_distributions' (recommended na distribution per barangay,
    status='pending') ang resulta ng bawat prediction run.

    >>> BAGO (v5): ang na-i-save sa barangay_distributions ngayon ay
    ang MISMONG `barangay_recommendation_exact` (may kasama nang leftover
    allocation), kaya EKSAKTONG tugma ang naka-log sa database sa
    ipinapakitang recommendation sa response ng /predict-distribution. <<<
    """
    sb = get_supabase()
    if sb is None:
        return

    # ---------- 1. I-map ang medicine_name (TEXT) papunta sa
    # medicine_id (UUID) gamit ang 'medicines' table ----------
    med_resp = sb.table("medicines").select("medicine_id, generic_name").execute()
    name_to_id = {row["generic_name"]: row["medicine_id"] for row in med_resp.data}

    # ---------- 2. Forecast period bilang rolling window (hal.
    # '2026-08-17_to_2026-09-16') ----------
    today = pd.Timestamp.today().normalize()
    end_date = today + pd.Timedelta(days=forecast_days_ahead)
    forecast_period = f"{today.strftime('%Y-%m-%d')}_to_{end_date.strftime('%Y-%m-%d')}"

    # ---------- 3. Insert sa demand_forecasts (status: draft), isa
    # bawat gamot; itago ang forecast_id para gamitin sa distributions ----------
    forecast_id_by_med = {}
    for row in result_per_medicine:
        med_name = row["medicine_name"]
        medicine_id = name_to_id.get(med_name)
        if medicine_id is None:
            print(f"[WARN] Walang match na medicine_id para sa '{med_name}' -- "
                  f"i-check ang spelling sa 'medicines.generic_name'. Ski-skip.")
            continue

        forecast_row = {
            "medicine_id": medicine_id,
            "forecast_period": forecast_period,
            "base_forecast_quantity": row["predicted_future_pharmacy_request"],
            "buffer_percentage": 15.0,
            "recommended_quantity": row["reserve_for_pharmacy_buffered_15pct"],
            "model_version": CURRENT_MODEL_VERSION,
            "status": "draft",
        }
        fc_resp = sb.table("demand_forecasts").insert(forecast_row).execute()
        if fc_resp.data:
            forecast_id_by_med[med_name] = fc_resp.data[0]["forecast_id"]

    # ---------- 4. Insert sa barangay_distributions (status: pending),
    # DIRETSO mula sa barangay_recommendation_exact -- kasama na ang
    # tamang leftover allocation, walang duplicate logic ----------
    dist_rows = []
    for rec in barangay_recommendation_exact:
        med_name = rec["medicine_name"]
        medicine_id = name_to_id.get(med_name)
        forecast_id = forecast_id_by_med.get(med_name)
        if medicine_id is None or forecast_id is None or not rec.get("destination_id"):
            continue
        dist_rows.append({
            "forecast_id": forecast_id,
            "medicine_id": medicine_id,
            "destination_id": rec["destination_id"],
            "quantity": rec["recommended_quantity"],
            "status": "pending",
        })

    if dist_rows:
        sb.table("barangay_distributions").insert(dist_rows).execute()


def log_retrain_to_supabase(trigger_source: str, result: dict = None,
                             status: str = "success", error_message: str = None,
                             duration_seconds: float = None):
    """I-save sa ml_model_versions ang resulta ng bawat retrain attempt."""
    global CURRENT_MODEL_VERSION
    sb = get_supabase()
    if sb is None:
        return
    new_version = pd.Timestamp.now().strftime("v%Y%m%d_%H%M%S")
    try:
        sb.table("ml_model_versions").insert({
            "model_version": new_version,
            "trigger_source": trigger_source,
            "rows_used": result["rows_used"] if result else 0,
            "unique_medicines": result["unique_medicines"] if result else 0,
            "quantity_mae": result["quantity_mae"] if result else None,
            "category_accuracy_pct": result["category_accuracy_pct"] if result else None,
            "status": "success" if status == "success" else "failed",
            "notes": error_message,
        }).execute()
        if status == "success":
            CURRENT_MODEL_VERSION = new_version
    except Exception as log_err:
        print(f"[WARN] Hindi na-log ang retrain: {log_err}")


class ConfirmDistributionRow(BaseModel):
    destination_id: str
    medicine_name: str
    quantity: int


class ConfirmDistributionRequest(BaseModel):
    # "auto" -- yung recommendation, sinunod nang buo, walang binago
    # "manual" -- ganap na pinili ng warehouse staff ang gamot at quantity
    # bawat barangay. BUONG plan lang, walang paghahalo (base sa policy
    # ng RHU Lopez -- Auto o Manual lang, hindi pwedeng magkahalo).
    source: str
    rows: List[ConfirmDistributionRow]
    forecast_period_days: Optional[int] = 30


@app.post("/confirm-distribution")
def confirm_distribution(req: ConfirmDistributionRequest):
    """
    I-save ang FINAL na desisyon ng warehouse staff (auto o manual) bilang
    'confirmed' na distribution plan sa 'barangay_distributions' table.

    Tinatawag ito ng "Confirm & Save" button sa Barangay Distribution card
    sa dashboard. Hiwalay ito sa /predict-distribution (na paulit-ulit na
    tumatakbo bilang PREVIEW/draft lang) -- ito na yung TALAGANG desisyon
    na ipapatupad.
    """
    sb = get_supabase()
    if sb is None:
        raise HTTPException(500, "Walang SUPABASE_URL/SUPABASE_KEY na naka-set.")

    try:
        result = save_confirmed_distribution(
            sb,
            rows=[r.model_dump() for r in req.rows],
            source=req.source,
            forecast_period_days=req.forecast_period_days or 30,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    return result


@app.get("/health")
def health_check():
    return {"status": "ok", "message": "Warehouse ML service v5 is running."}


# ============================================================
# AUTOMATIC RETRAINING
# ============================================================
# Cooldown -- huwag mag-retrain nang mas madalas sa itakdang minuto,
# kahit paulit-ulit tawagin ang endpoint na ito (hal. maraming
# 'received' na request sabay-sabay). Baguhin ang RETRAIN_COOLDOWN_SECONDS
# kung gusto mo ng mas madalas/bihirang retraining.
RETRAIN_COOLDOWN_SECONDS = 60 * 60  # 1 oras
_last_retrain_time = 0
CURRENT_MODEL_VERSION = "v_initial"  # mababago tuwing successful ang retrain

WEBHOOK_SECRET = os.environ.get("RETRAIN_WEBHOOK_SECRET")  # optional, para sa security


class RetrainRequest(BaseModel):
    force: Optional[bool] = False   # i-bypass ang cooldown kung True
    secret: Optional[str] = None    # dapat tumugma sa RETRAIN_WEBHOOK_SECRET kung naka-set


@app.post("/retrain")
def retrain_model(req: RetrainRequest = RetrainRequest()):
    """
    Ito ang tinatawag ng Supabase Database Webhook tuwing may
    pharmacy_requests row na naging status = 'received' (o kahit
    anong bagong data na dapat isama sa training).

    May built-in COOLDOWN para hindi ito paulit-ulit na tumatakbo sa
    loob ng maikling panahon (mahal ang training sa oras/resources
    kung sobrang dalas gawin).

    Bawat pagkakataon (success, failed, o skipped) ay naka-log sa
    ml_retrain_log para masubaybayan ang health ng auto-retraining.
    """
    global _last_retrain_time, _cache

    trigger_source = "webhook" if req.secret else "manual"

    if WEBHOOK_SECRET and req.secret != WEBHOOK_SECRET:
        raise HTTPException(401, "Mali o walang secret na ipinasa.")

    now = time.time()
    seconds_since_last = now - _last_retrain_time
    if not req.force and seconds_since_last < RETRAIN_COOLDOWN_SECONDS:
        wait_more = int(RETRAIN_COOLDOWN_SECONDS - seconds_since_last)
        # Hindi na-lo-log ang 'skipped' sa ml_model_versions dahil ang
        # CHECK constraint niyan ay success/failed lang -- console log na lang
        print(f"[INFO] Retrain skipped -- cooldown active, {wait_more}s pa")
        return {
            "status": "skipped",
            "reason": f"Kamakailan lang nag-retrain ({int(seconds_since_last)}s ang nakalipas). "
                      f"Maghintay pa ng {wait_more}s, o magpasa ng 'force': true.",
        }

    sb = get_supabase()
    if sb is None:
        raise HTTPException(500, "Walang SUPABASE_URL/SUPABASE_KEY na naka-set.")

    models_dir = os.path.join(BASE_DIR, "models")
    data_dir = os.path.join(BASE_DIR, "data")

    start_time = time.time()
    try:
        result = train_from_supabase(sb, models_dir, data_dir)
    except ValueError as e:
        log_retrain_to_supabase(trigger_source, status="failed", error_message=str(e))
        raise HTTPException(400, str(e))
    duration = round(time.time() - start_time, 2)

    # I-clear ang in-memory cache para ma-reload ang BAGONG na-save na
    # models sa susunod na prediction request -- WALANG kailangang
    # i-restart pa ang uvicorn
    _cache = None
    _last_retrain_time = now

    log_retrain_to_supabase(trigger_source, result=result, status="success",
                             duration_seconds=duration)

    return {
        "status": "retrained",
        "rows_used": result["rows_used"],
        "unique_medicines": result["unique_medicines"],
        "quantity_mae": result["quantity_mae"],
        "category_accuracy_pct": result["category_accuracy_pct"],
        "duration_seconds": duration,
    }