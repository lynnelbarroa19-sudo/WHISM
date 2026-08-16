"""
api_server.py  (v4 - PHARMACY REQUEST PREDICTION, PARA SA WAREHOUSE)
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

Run: python -m uvicorn api_server:app --reload --port 8000
Docs: http://127.0.0.1:8000/docs
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Optional
import pandas as pd
import joblib
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = FastAPI(title="WHIMS RHU - Warehouse ML Service v4 (Pharmacy Request Prediction)")

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
    number_of_barangays: Optional[int] = 96
    safety_buffer_percent: Optional[float] = 0.15  # +15% extra sa reserve
    forecast_days_ahead: Optional[int] = 30        # tumingin ka pasulong ng ilang araw


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
    batch na 'available' PA at hindi pa expired, per generic_name.

    PAALALA: ang pagtutugma ng pangalan papunta sa pharmacy_requests.
    medicine_name ay TEXT MATCHING lang -- kailangang magkatugma nang
    eksakto ang spelling sa dalawang table. Kung minsan magkaiba
    (hal. "Paracetamol" sa isa, "Paracetamol 500mg" sa isa), hindi
    magmamatch ang reserve computation sa demand prediction.
    """
    sb = get_supabase()
    if sb is None:
        raise HTTPException(500, "Walang SUPABASE_URL/SUPABASE_KEY na naka-set sa .env file.")

    # I-fetch ang mga available batch, kasama ang generic_name mula sa
    # naka-link na medicines table (PostgREST embedding via foreign key)
    resp = (
        sb.table("medicine_batches")
        .select("total_quantity, status, expiration_date, medicines(generic_name)")
        .eq("status", "available")
        .execute()
    )
    if not resp.data:
        raise HTTPException(400, "Walang 'available' na batch sa medicine_batches table.")

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

    # TIYAK na commitment (pending/confirm/alerted na requests, hindi pa
    # na-receive) -- ito ay babawasin din sa warehouse balang araw
    pending_committed = fetch_pending_committed_requests()

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

    # ---------- E) RESERVE PARA SA PHARMACY (EXACT + BUFFERED) ----------
    # ---------- F) MATITIRA -> EQUAL SPLIT SA 96 BARANGAY ----------
    num_brgy = req.number_of_barangays
    result_per_medicine = []
    distribution_exact = []
    distribution_buffered = []

    for med, stock in current_stock.items():
        pred_row = total_demand[total_demand["medicine_name"] == med]
        predicted_pharmacy_request = int(pred_row["total_predicted_pharmacy_request"].values[0]) if len(pred_row) else 0

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

        per_brgy_exact = available_exact // num_brgy
        leftover_exact = available_exact % num_brgy
        distribution_exact.append({
            "medicine_name": med,
            "available_for_distribution": available_exact,
            "number_of_barangays": num_brgy,
            "units_per_barangay": int(per_brgy_exact),
            "leftover_units": int(leftover_exact),
        })

        per_brgy_buf = available_buffered // num_brgy
        leftover_buf = available_buffered % num_brgy
        distribution_buffered.append({
            "medicine_name": med,
            "available_for_distribution": available_buffered,
            "number_of_barangays": num_brgy,
            "units_per_barangay": int(per_brgy_buf),
            "leftover_units": int(leftover_buf),
        })

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

        # (3) Equal distribution sa 96 barangay mula sa MATITIRANG stock
        "barangay_equal_distribution_exact": distribution_exact,
        "barangay_equal_distribution_buffered": distribution_buffered,
    }


@app.get("/health")
def health_check():
    return {"status": "ok", "message": "Warehouse ML service v4 (pharmacy request prediction) is running."}