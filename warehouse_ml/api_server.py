"""
api_server.py  (v5.5 - + dosage_form now included in stock_and_reserve_summary)
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

CHANGES IN v5.5 (dosage_form ngayon kasama na sa stock_and_reserve_summary):
  Dating hindi kasama ang `dosage_form` (Tablet/Capsule/Suspension/
  Drops/atbp., mula sa `medicines.dosage_form`) sa SELECT ng
  fetch_medicine_catalog(), kaya lagi itong `null` sa response ng
  /predict-distribution kahit may laman naman ang column sa Supabase
  (PredictionCard.tsx sa frontend ay laging nagpapakita ng
  "Not specified" dahil dito). Ngayon:
    1. Idinagdag ang "dosage_form" sa .select() ni
       fetch_medicine_catalog(), at kasama na rin ito sa dict na
       ibinabalik nito per medicine.
    2. Ginawa ang `dosage_form_by_med` mapping (kaparehong pattern ng
       `unit_by_med`), at idinagdag ang "dosage_form" key sa dict na
       ini-append sa `result_per_medicine` sa loob ng
       predict_distribution().
  Kung talagang NULL ang dosage_form ng isang gamot sa mismong
  Supabase (walang na-type na value), magpapatuloy pa rin itong
  lalabas bilang `null` sa JSON -- tama at inaasahan iyon, ang
  frontend na lang ang nagpapakita ng "Not specified" bilang fallback.

CHANGES IN v5.4 (tinanggal ang auto-logging sa /predict-distribution):
  Dating gumagawa ang predict_distribution() ng BAGONG "draft" na
  demand_forecasts row + "pending" na barangay_distributions row PARA
  SA BAWAT GAMOT, TUWING may nag-load o nag-refresh ng dashboard --
  kahit walang totoong "Confirm & Save" na pinindot ng staff. Dahil
  ang /predict-distribution ay tinatawag paulit-ulit (bawat page view,
  bawat auto-refresh), mabilis na dumadami nang walang kwenta ang
  dalawang table na 'yan.

  Ang TAMANG "save" flow ay nasa /confirm-distribution endpoint na
  (save_confirmed_distribution() sa barangay_distribution.py) -- doon
  lang dapat talaga sumusulat sa demand_forecasts/barangay_
  distributions, kapag EXPLICIT na pinindot ng staff ang "Confirm &
  Save" button. Kaya TINANGGAL na ang awtomatikong pag-log sa
  predict_distribution() -- hindi ito ginagamit ng frontend (preview/
  read-only lang dapat ang endpoint na 'to), at duplicate lang sa
  tamang confirm flow.

  (Ang log_predictions_to_supabase() function mismo ay INIWAN pa rin
  sa baba ng file, hindi tinanggal -- basta hindi na ito AWTOMATIKONG
  tinatawag. Kung sakaling kailangan pa ito balang araw para sa ibang
  layunin, hal. periodic snapshot logging para sa MAE tracking,
  puwede pa rin itong gamitin nang explicit.)

CHANGES IN v5.3 (HTTP/1.1-only Supabase client -- WinError 10035 fix):
  Dating nagkakaroon ng "httpcore.ReadError: [WinError 10035] A non-blocking
  socket operation could not be completed immediately" tuwing dalawa o
  higit pang dashboard card (hal. Demand Forecast + Barangay Distribution)
  ang sabay-sabay tumatawag sa /predict-distribution. Dahil `def` (hindi
  `async def`) ang endpoint, pinapatakbo ito ni FastAPI sa isang
  THREADPOOL -- kaya dalawang magkaibang thread ang sabay-sabay gumagamit
  ng IISANG cached na `_supabase` client. Ang HTTP/2 (default sa httpx/
  postgrest-py) ay may kilalang Windows-specific bug: nasisira ang
  non-blocking socket read state kapag naka-interleave ang dalawang
  thread sa parehong multiplexed stream. Ang fix: pilitin na HTTP/1.1
  LANG (http2=False) sa custom httpx.Client na ipinapasa sa Supabase
  ClientOptions -- tingnan ang get_supabase() sa ibaba.

CHANGES IN v5.2 (Box/Strip/Piece breakdown):
  Idinagdag ang `fetch_medicine_packaging()` -- kinukuha ang
  `pieces_per_box` at `pieces_per_strip` PER GAMOT mula sa medicine_batches,
  para ma-convert ng frontend ang "Matitira" (available_for_96_barangays)
  figure papunta sa Box/Strip/Piece breakdown.

>>> DEBUG HANDLER (pansamantala): idinagdag ang isang global exception
handler sa ibaba na kukuha ng BUONG Python traceback at ipapasa ito
bilang JSON `detail` field, sa halip na basta "Internal Server Error"
lang. Makikita mo na ngayon ang eksaktong error DIREKTA sa dashboard
card mismo (walang kailangang balik-balikan pa ang terminal). TANGGALIN
ITO pagkatapos ma-fix ang bug -- hindi dapat naka-expose ang raw
traceback sa production, delikado ito security-wise. <<<

Run: python -m uvicorn api_server:app --reload --port 8000
Docs: http://127.0.0.1:8000/docs
"""

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Dict, Optional, List
from concurrent.futures import ThreadPoolExecutor
import pandas as pd
import joblib
import os
import time
import traceback
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
app = FastAPI(title="WHIMS RHU - Warehouse ML Service v5.5 (dosage_form fix, DEBUG mode)")

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


# >>> DEBUG: pansamantalang global exception handler. Kapag may ANUMANG
# hindi na-catch na exception sa loob ng kahit anong endpoint, ito ang
# huhuli, at ibabalik bilang JSON (kasama ang BUONG traceback sa
# "detail" field) sa halip na plain-text "Internal Server Error" na
# walang detalye. Makikita mo agad ito sa red error card ng dashboard.
@app.exception_handler(Exception)
async def debug_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    print(tb)  # naka-print pa rin sa terminal, extra visibility
    return JSONResponse(
        status_code=500,
        content={"error": "Internal Server Error", "detail": tb},
    )


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

        from supabase import ClientOptions

        options = ClientOptions(
            postgrest_client_timeout=30,
            storage_client_timeout=30,
        )
        _supabase = create_client(url, key, options=options)

        # >>> FIX v5.3 (WinError 10035): dating default client -- may
        # HTTP/2 enabled by default. Kapag dalawa o higit pang FastAPI
        # request ang tumatakbo nang SABAY (bawat isa nasa sariling
        # threadpool worker thread dahil sync `def` ang mga endpoint
        # dito -- tingnan ang predict_distribution()), pareho silang
        # gumagamit ng IISANG cached na `_supabase` client/connection.
        # Ang HTTP/2 multiplexing sa httpcore ay may kilalang
        # Windows-specific bug: nasisira ang non-blocking socket read
        # state kapag naka-interleave ang dalawang thread sa parehong
        # stream, kaya lumalabas ang "httpcore.ReadError:
        # [WinError 10035] A non-blocking socket operation could not
        # be completed immediately".
        #
        # PAALALA: sa supabase==2.10.0 / postgrest==0.18.0 (na-verify
        # sa source), WALANG "httpx_client" param ang ClientOptions --
        # at NAKA-HARDCODE ang http2=True sa loob mismo ng
        # SyncPostgrestClient.create_session(), kaya wala talagang
        # paraan na i-configure ito PASOK sa ClientOptions para sa
        # bersyong ito. Kaya sa halip, DIREKTA na lang nating
        # pinapalitan ang underlying httpx.Client (`.postgrest.session`)
        # PAGKATAPOS itong magawa ni create_client() -- ginagaya ang
        # parehong base_url/headers/timeout ng luma, http2=False lang
        # ang pinagkaiba. Ito ang gumagawa ng normal na HTTP/1.1
        # connection pooling (hiwalay na socket bawat concurrent
        # request sa halip na i-multiplex sa isang shared stream),
        # kaya ligtas na ito sa multi-thread na concurrent access. <<<
        import httpx
        old_session = _supabase.postgrest.session
        _supabase.postgrest.session = httpx.Client(
            base_url=old_session.base_url,
            headers=old_session.headers,
            timeout=old_session.timeout,
            follow_redirects=True,
            http2=False,
        )
        old_session.close()
    return _supabase


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
# >>> BAGO: cache PARA LANG SA SEASONAL computation -- isang beses lang
# ito ini-compute BAWAT ARAW (hindi bawat page load/refresh), dahil
# hindi naman nagbabago ang "seasonal pattern" sa loob ng iisang araw.
# Malaking bawas 'to sa dami ng katawagan sa mabigat na 200-araw na
# forecast (SEASONAL_HORIZON_DAYS) -- ang mga ibang page load sa
# parehong araw ay gagamit na lang ng cached na resulta. <<<
_seasonal_cache = {"date": None, "demand_by_season": None}

# >>> BAGO (bilis): cache PARA SA "DEMAND" forecast (yung 30-araw, o
# kung anong forecast_days_ahead ang ipinasa) -- GAYA RIN NG GINAWA
# NATIN SA SEASONAL sa itaas. Ang build_pharmacy_request_forecast()
# ay UMAASA LANG sa na-train na model + latest_features.csv -- WALANG
# kinalaman dito ang current_stock o pending_committed_requests (mga
# 'yon ay hiwalay na dinadagdag PAGKATAPOS, sa loob ng predict_
# distribution()). Ibig sabihin, hindi ito nagbabago sa loob ng iisang
# araw maliban kung mag-retrain (na nagre-reset na ng cache na ito,
# tingnan ang /retrain sa ibaba) -- kaya ligtas at TAMANG i-cache ito
# nang isang beses bawat araw, sa halip na kompyutin ulit ang
# BUONG batched ML prediction loop sa BAWAT SINGLE page load/refresh
# ng DALAWANG card (Demand Forecast + Barangay Distribution). Keyed by
# forecast_days_ahead dahil pwedeng iba-iba ang hiniling na horizon
# (bagama't 30 ang default/palaging ginagamit ng frontend ngayon). <<<
_demand_forecast_cache: Dict[int, Dict] = {}

def get_cached_events_df(forecast_days_ahead: int):
    today_str = pd.Timestamp.today().strftime("%Y-%m-%d")
    cached = _demand_forecast_cache.get(forecast_days_ahead)
    if cached and cached["date"] == today_str:
        return cached["events_df"]
    events_df = build_pharmacy_request_forecast(forecast_days_ahead)
    _demand_forecast_cache[forecast_days_ahead] = {"date": today_str, "events_df": events_df}
    return events_df

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


def fetch_medicine_catalog() -> Dict[str, Dict[str, str]]:
    """
    Kunin ang TOTOONG unit, category, AT dosage_form ng bawat gamot
    mula sa 'medicines' table (hal. unit: "Piece", "Bottle", "Box",
    "Loose", "Strip"; dosage_form: "Tablet", "Capsule", "Suspension",
    "Drops", "Nebule", atbp.) -- ito ang ipapalit sa dating generic na
    "u" sa Demand Forecast at Barangay Distribution cards, para tumugma
    sa TALAGANG nasa medicine inventory, hindi basta paikot na label.

    >>> FIX v5.5: idinagdag ang "dosage_form" sa .select() -- dati
    hindi ito kasama, kaya laging null/"Not specified" ang lumalabas
    sa "Form:" na linya ng PredictionCard.tsx sa Reserve tab, kahit
    may value naman talaga sa Supabase (tingnan ang dosage_form_by_med
    mapping sa predict_distribution() sa ibaba kung paano ito
    ginagamit). <<<

    Ginagamit din ito para bigyan ng unit/category/dosage_form ang mga
    BAGONG gamot na wala pang laman sa ML model (tingnan ang
    live-merge sa /predict-distribution) -- kaya kasama rin ang LAHAT
    ng gamot dito, hindi lang yung nasa training data.
    """
    sb = get_supabase()
    if sb is None:
        return {}
    resp = sb.table("medicines").select("generic_name, unit, category, dosage_form").execute()
    if not resp.data:
        return {}
    catalog = {}
    for row in resp.data:
        # 'medicines.category' ay singular ("drug"/"supply"), samantalang
        # 'pharmacy_requests.category' (galing sa ML training data) ay
        # plural ("drugs"/"supplies") -- i-normalize papuntang plural
        # para magkatugma sa PredictionCard.tsx grouping.
        cat = (row.get("category") or "drugs").strip().lower()
        if not cat.endswith("s"):
            cat += "s"
        catalog[row["generic_name"]] = {
            "unit": row.get("unit") or "unit",
            "category": cat,
            # >>> BAGO v5.5: hindi na-normalize/altered dito, ipinasa
            # nang buo -- kung NULL sa Supabase, mananatiling None
            # (-> null sa JSON), tama at inaasahan iyon; ang frontend
            # na lang ang may "Not specified" fallback. <<<
            "dosage_form": row.get("dosage_form"),
        }
    return catalog


def fetch_medicine_packaging() -> Dict[str, Dict[str, Optional[int]]]:
    """
    Kunin ang packaging conversion PER GAMOT, mula sa medicine_batches, para
    magamit ng frontend na i-convert ang "available for barangays" papunta
    sa Box/Strip/Piece breakdown.

    >>> FIX: walang column na "pieces_per_box" sa medicine_batches (na-
    verify via information_schema.columns -- error 42703 dati). Dalawang
    hakbang pala ang totoong packaging structure: BOX -> STRIPS_PER_BOX ->
    PIECES_PER_STRIP (kaya ang total_quantity generated column ay malamang
    boxes * strips_per_box * pieces_per_strip + loose_pieces). Kaya
    dini-derive na lang natin ang "pieces_per_box" = strips_per_box *
    pieces_per_strip, sa halip na kunin ito nang direkta bilang column. <<<

    PAALALA: ang conversion factor ay naka-store PER BATCH sa DB --
    kinukuha lang dito ang values mula sa batch na may PINAKAMALAKING
    total_quantity bilang "representative" packaging ng gamot na iyon.
    """
    sb = get_supabase()
    if sb is None:
        return {}

    resp = (
        sb.table("medicine_batches")
        .select("total_quantity, strips_per_box, pieces_per_strip, status, medicines(generic_name)")
        .in_("status", ["available", "low_stock"])
        .execute()
    )
    if not resp.data:
        return {}

    best_by_med: Dict[str, dict] = {}
    for row in resp.data:
        med = row.get("medicines")
        name = med.get("generic_name") if isinstance(med, dict) else None
        if not name:
            continue
        qty = row.get("total_quantity") or 0
        existing = best_by_med.get(name)
        if existing is None or qty > existing["_qty"]:
            strips_per_box = row.get("strips_per_box")
            pieces_per_strip = row.get("pieces_per_strip")
            # Derived, hindi direktang column
            pieces_per_box = (
                strips_per_box * pieces_per_strip
                if strips_per_box and pieces_per_strip
                else None
            )
            best_by_med[name] = {
                "_qty": qty,
                "pieces_per_box": pieces_per_box,
                "pieces_per_strip": pieces_per_strip,
            }

    return {
        name: {"pieces_per_box": v["pieces_per_box"], "pieces_per_strip": v["pieces_per_strip"]}
        for name, v in best_by_med.items()
    }


def fetch_pending_committed_requests() -> Dict[str, int]:
    """
    Kunin ang mga request na 'pending', 'confirm', o 'alerted' pa lang
    (ibig sabihin, TIYAK na babawasin sa warehouse balang araw, pero
    HINDI PA nababawas ngayon dahil hindi pa na-'received').
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
    df["remaining_qty"] = df["requested_qty"] - df["fulfilled_qty"].fillna(0)
    df["remaining_qty"] = df["remaining_qty"].clip(lower=0)

    return df.groupby("medicine_name")["remaining_qty"].sum().astype(int).to_dict()


def fetch_current_stock_from_supabase() -> Dict[str, int]:
    """
    Kunin ang current_stock mula sa Supabase, gamit ang TOTOONG schema:
      medicine_batches (boxes, total_quantity [computed], status, expiration_date)
            | medicine_id (foreign key)
      medicines (generic_name, category, ...)
    """
    sb = get_supabase()
    if sb is None:
        raise HTTPException(500, "Walang SUPABASE_URL/SUPABASE_KEY na naka-set sa .env file.")

    resp = (
        sb.table("medicine_batches")
        .select("total_quantity, status, expiration_date, medicines(generic_name)")
        .in_("status", ["available", "low_stock"])
        .execute()
    )
    if not resp.data:
        raise HTTPException(400, "Walang 'available' o 'low_stock' na batch sa medicine_batches table.")

    df = pd.DataFrame(resp.data)
    df["generic_name"] = df["medicines"].apply(lambda m: m.get("generic_name") if isinstance(m, dict) else None)
    df = df.dropna(subset=["generic_name"])

    today = pd.Timestamp.today().normalize()
    if "expiration_date" in df.columns:
        exp = pd.to_datetime(df["expiration_date"], errors="coerce")
        df = df[exp.isna() | (exp >= today)]

    stock_series = df.groupby("generic_name")["total_quantity"].sum()
    return stock_series.astype(int).to_dict()


def build_pharmacy_request_forecast(forecast_days_ahead: int):
    """
    >>> FIX (BAGAL sa mahabang forecast_days_ahead, hal. 400+ araw para
    sa Seasonal tab): DATING isa-isang `qty_model.predict()` call PER
    EVENT (bawat gamot, bawat susunod na petsa) -- kaya sa 400-araw na
    horizon, umaabot ng daan-daang indibidwal na model.predict() calls,
    bawat isa may sariling overhead (paggawa ng bagong 1-row DataFrame,
    atbp.), kaya sobrang bagal, lalo na dahil TAWAG ITO NANG DALAWANG
    BESES bawat /predict-distribution (30-araw para sa Demand, +400-araw
    para sa Seasonal), at TINATAWAG ang endpoint ng DALAWANG card
    (Demand Forecast + Barangay Distribution) sa bawat page load.

    NGAYON: BATCHED na ang prediction PER "STEP" (hindi na per event)
    -- lahat ng gamot na may susunod na petsa sa PAREHONG hakbang ay
    pinagsasama sa IISANG DataFrame, IISANG model.predict() call na
    lang. Bilang ng calls = bilang ng "steps" hanggang maubos ang
    horizon ng gamot na may PINAKAMAIKLING interval (hindi na
    bilang-ng-gamot x steps-bawat-gamot) -- malaking bawas sa dami ng
    calls, lalo na kapag maraming gamot. Eksaktong PAREHONG resulta
    ang output (parehong recursive na rolling_avg update per medicine),
    mas mabilis lang.
    """
    models = get_models()
    qty_model = models["qty_model"]
    le_med = models["le_med"]
    le_season = models["le_season"]
    latest_features = models["latest_features"]

    today = pd.Timestamp.today().normalize()
    known_med = set(le_med.classes_)
    lf = latest_features[latest_features["medicine_name"].isin(known_med)].reset_index(drop=True)

    if lf.empty:
        return pd.DataFrame()

    horizon_end = today + pd.Timedelta(days=forecast_days_ahead)

    med_names = lf["medicine_name"].tolist()
    med_categories = lf["medicine_category"].tolist()
    intervals = [max(3, int(x)) for x in lf["days_since_last_request"]]
    med_encs = le_med.transform(med_names)
    rolling_avgs = lf["rolling_avg_recent"].tolist()
    same_month_lys = lf["same_month_last_year"].tolist()
    next_dates = [today + pd.Timedelta(days=iv) for iv in intervals]
    active = [d <= horizon_end for d in next_dates]

    events = []

    while any(active):
        batch_idx = [i for i in range(len(med_names)) if active[i]]

        rows = []
        for i in batch_idx:
            d = next_dates[i]
            season_enc = le_season.transform([get_season(d.month)])[0]
            rows.append({
                "day_of_week": d.dayofweek,
                "day_of_month": d.day,
                "week_of_year": int(d.isocalendar().week),
                "month": d.month,
                "season_enc": season_enc,
                "medicine_enc": med_encs[i],
                "rolling_avg_recent": rolling_avgs[i],
                "same_month_last_year": same_month_lys[i],
                "days_since_last_request": intervals[i],
            })

        # >>> ISANG batched predict() call PARA SA BUONG STEP na ito
        # (lahat ng aktibong gamot sabay-sabay), sa halip na paisa-isa. <<<
        preds = qty_model.predict(pd.DataFrame(rows))

        for j, i in enumerate(batch_idx):
            predicted_qty = max(0, round(preds[j]))
            d = next_dates[i]
            events.append({
                "predicted_request_date": d.strftime("%Y-%m-%d"),
                "year": d.year,
                "month": d.month,
                "week_of_year": int(d.isocalendar().week),
                "medicine_name": med_names[i],
                "medicine_category": med_categories[i],
                "predicted_quantity_requested": int(predicted_qty),
            })

            rolling_avgs[i] = (rolling_avgs[i] + predicted_qty) / 2
            next_dates[i] = d + pd.Timedelta(days=intervals[i])
            active[i] = next_dates[i] <= horizon_end

    return pd.DataFrame(events)


@app.post("/predict-distribution")
def predict_distribution(req: PredictRequest):
    # Siguraduhing GAWA na ang _supabase client BAGO mag-fan-out sa
    # threadpool sa ibaba -- iwas race kung dalawang thread ang parehong
    # susubukang gawin ito nang sabay sa unang pagkakataon.
    sb = get_supabase()

    # >>> BAGO (bilis): SUNOD-SUNOD dating tinatawag ang apat na fetch_*
    # function sa ibaba -- kahit isa sa kanila ay walang dependency sa
    # resulta ng iba (independienteng Supabase READS lahat). Kung
    # ~200-300ms ang bawat network round-trip papuntang Supabase,
    # ~1 segundo o higit pa ang TOTAL na naiipon dito bago pa man
    # magsimula ang tunay na computation -- SUNOD-SUNOD kasi sila
    # tinatawag. Ngayon, SABAY-SABAY (concurrent, gamit ang
    # ThreadPoolExecutor) sila tinatawag -- ang TOTAL na oras ay
    # magiging kasing bilis na lang ng PINAKABAGAL sa kanila, hindi na
    # ang KABUUAN ng lahat. Ligtas na itong gawin ngayon dahil naka-
    # force na HTTP/1.1 (http2=False) ang Supabase client mula pa sa
    # v5.3 fix sa itaas -- hindi na ito naka-multiplex sa isang shared
    # stream na sensitive sa concurrent thread access. <<<
    with ThreadPoolExecutor(max_workers=5) as pool:
        stock_future = None if req.current_stock else pool.submit(fetch_current_stock_from_supabase)
        barangay_future = pool.submit(fetch_barangay_list_from_destinations, sb)
        pending_future = pool.submit(fetch_pending_committed_requests)
        catalog_future = pool.submit(fetch_medicine_catalog)
        packaging_future = pool.submit(fetch_medicine_packaging)

        current_stock = req.current_stock or stock_future.result()
        barangay_list = barangay_future.result()
        pending_committed = pending_future.result()
        medicine_catalog = catalog_future.result()
        packaging_by_med = packaging_future.result()

    # Bihirang mangyari lang ito (kapag literal walang laman ang
    # 'destinations' table) -- kaya sequential fallback na lang, hindi
    # na kasama sa itaas dahil umaasa ito sa resulta ng barangay_list.
    num_brgy_final = req.number_of_barangays or len(barangay_list) or fetch_barangay_count_from_destinations()

    unit_by_med = {name: info["unit"] for name, info in medicine_catalog.items()}
    # >>> BAGO v5.5: dosage_form mapping, kaparehong pattern ng
    # unit_by_med sa itaas -- ginagamit sa loob ng loop bawat gamot
    # para idagdag sa result_per_medicine (tingnan sa ibaba). <<<
    dosage_form_by_med = {name: info.get("dosage_form") for name, info in medicine_catalog.items()}

    # >>> BAGO (bilis): gamit na ang cached na events_df (tingnan ang
    # get_cached_events_df() / _demand_forecast_cache sa itaas) sa
    # halip na direktang tumawag sa build_pharmacy_request_forecast() --
    # isang beses lang ito talaga kokomputin bawat araw, hindi na
    # bawat page load/refresh ng dalawang card.
    events_df = get_cached_events_df(req.forecast_days_ahead)

    if events_df.empty:
        raise HTTPException(400, "Walang na-generate na forecast. I-check ang latest_features.csv.")

    # >>> BAGO (bilis): TINANGGAL ang `predicted_requests` (per-event
    # detail list), `weekly`, at `monthly` na computation dito -- na-
    # verify na WALA sa PredictionCard.tsx o BarangayDistributionCard.tsx
    # na gumagamit sa "predicted_pharmacy_requests_detail",
    # "predicted_pharmacy_requests_weekly", o
    # "predicted_pharmacy_requests_monthly" fields sa response (ang
    # TS interfaces sa dalawang card ay hindi man lang nagde-declare
    # ng mga field na 'to). Dagdag na groupby/loop computation at
    # dagdag na laki ng JSON payload na walang kwenta kung walang
    # gumagamit -- kung sakaling meron palang IBANG parte ng system
    # na umaasa dito, tingnan na lang ang git history ng file na ito
    # para sa dating code.

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

    demand_by_med = {
        row["medicine_name"]: {
            "medicine_category": row["medicine_category"],
            "total_predicted_pharmacy_request": row["total_predicted_pharmacy_request"],
        }
        for row in total_demand.to_dict(orient="records")
    }
    for med, live_qty in pending_committed.items():
        if live_qty <= 0:
            continue
        if med in demand_by_med:
            demand_by_med[med]["total_predicted_pharmacy_request"] = max(
                demand_by_med[med]["total_predicted_pharmacy_request"], live_qty
            )
        else:
            cat_info = medicine_catalog.get(med, {})
            demand_by_med[med] = {
                "medicine_category": cat_info.get("category", "drugs"),
                "total_predicted_pharmacy_request": live_qty,
            }

    demand_summary_live = pd.DataFrame([
        {"medicine_name": med, **vals} for med, vals in demand_by_med.items()
    ])
    live_total_all = demand_summary_live["total_predicted_pharmacy_request"].sum()
    demand_summary_live["percentage_of_total_predicted_requests"] = (
        (demand_summary_live["total_predicted_pharmacy_request"] / live_total_all * 100).round(2)
        if live_total_all > 0 else 0
    )
    demand_summary_live["unit"] = demand_summary_live["medicine_name"].map(unit_by_med).fillna("unit")
    demand_summary_live = demand_summary_live.sort_values("total_predicted_pharmacy_request", ascending=False)

    num_brgy = num_brgy_final
    result_per_medicine = []
    distribution_exact = []
    distribution_buffered = []

    meds_with_new_requests = {med for med, qty in pending_committed.items() if qty > 0}
    all_meds_for_reserve = sorted(set(current_stock) | meds_with_new_requests)

    for med in all_meds_for_reserve:
        stock = current_stock.get(med, 0)
        pred_row = total_demand[total_demand["medicine_name"] == med]
        predicted_pharmacy_request = int(pred_row["total_predicted_pharmacy_request"].values[0]) if len(pred_row) else 0

        stock_unit = "pcs"

        pending_qty = int(pending_committed.get(med, 0))

        reserve_exact = pending_qty + predicted_pharmacy_request
        available_exact = max(0, stock - reserve_exact)
        if stock > 0:
            pct_available_exact = round((available_exact / stock * 100), 2)
            pct_reserved_exact = round((reserve_exact / stock * 100), 2)
        else:
            pct_available_exact = 0
            pct_reserved_exact = 100 if reserve_exact > 0 else 0

        reserve_buffered = pending_qty + round(predicted_pharmacy_request * (1 + req.safety_buffer_percent))
        available_buffered = max(0, stock - reserve_buffered)
        if stock > 0:
            pct_available_buffered = round((available_buffered / stock * 100), 2)
            pct_reserved_buffered = round((reserve_buffered / stock * 100), 2)
        else:
            pct_available_buffered = 0
            pct_reserved_buffered = 100 if reserve_buffered > 0 else 0

        pkg = packaging_by_med.get(med, {})

        result_per_medicine.append({
            "medicine_name": med,
            "unit": stock_unit,
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
            "pieces_per_box": pkg.get("pieces_per_box"),
            "pieces_per_strip": pkg.get("pieces_per_strip"),
            # >>> BAGO v5.5: dosage_form (Tablet/Capsule/Suspension/
            # Drops/atbp.) -- kung walang match sa medicine_catalog
            # (hal. mali ang spelling ng medicine_name kumpara sa
            # medicines.generic_name), o kung NULL talaga sa Supabase,
            # magiging None ito (-> null sa JSON), at ang frontend na
            # ang magpapakita ng "Not specified" fallback. <<<
            "dosage_form": dosage_form_by_med.get(med),
        })

        distribution_exact.append(attach_equal_split(
            med, available_exact, num_brgy, stock_unit,
            pieces_per_box=pkg.get("pieces_per_box"),
            pieces_per_strip=pkg.get("pieces_per_strip"),
        ))
        distribution_buffered.append(attach_equal_split(
            med, available_buffered, num_brgy, stock_unit,
            pieces_per_box=pkg.get("pieces_per_box"),
            pieces_per_strip=pkg.get("pieces_per_strip"),
        ))

    barangay_recommendation_exact = build_equal_barangay_recommendation(distribution_exact, barangay_list)
    barangay_recommendation_buffered = build_equal_barangay_recommendation(distribution_buffered, barangay_list)

    # ============================================================
    # >>> BAGO: MONTHLY / SEASONAL na FORECAST breakdown. May
    # ikatlong "WEEKLY" breakdown dati dito (parehong groupby logic,
    # iisang events_df) pero TINANGGAL na -- tinanggal na rin ang
    # Weekly tab sa PredictionCard.tsx (frontend) kaya hindi na ito
    # ginagamit/ni-render ng dashboard. Sayang lang na compute time
    # (dagdag na groupby + Python loop) at dagdag na JSON payload size
    # kung ikokompyut pa rin natin ito -- kaya inalis narin dito para
    # sabay bumilis ang response. Kung babalik man ang Weekly tab sa
    # frontend balang araw, tingnan na lang ang git history ng file
    # na ito para sa dating "---------- WEEKLY ----------" block. <<<

    # ---------- MONTHLY ----------
    monthly_totals = (
        events_df.groupby(["year", "month"])["predicted_quantity_requested"]
        .sum().reset_index().rename(columns={"predicted_quantity_requested": "total_qty"})
        .sort_values(["year", "month"])
    )
    monthly_by_med = (
        events_df.groupby(["year", "month", "medicine_name"])["predicted_quantity_requested"]
        .sum().reset_index().rename(columns={"predicted_quantity_requested": "qty"})
    )
    demand_by_month = []
    for _, mo in monthly_totals.iterrows():
        yr, mn = int(mo["year"]), int(mo["month"])
        meds = monthly_by_med[(monthly_by_med["year"] == yr) & (monthly_by_med["month"] == mn)]
        # >>> BAGO: TANGGAL na ang head(5) limit -- kaparehong dahilan
        # ng Weekly sa itaas.
        meds = meds.sort_values("qty", ascending=False)
        month_label = pd.Timestamp(year=yr, month=mn, day=1).strftime("%B %Y")
        demand_by_month.append({
            "year": yr,
            "month": mn,
            "month_label": month_label,
            "total_predicted_quantity": int(mo["total_qty"]),
            "top_medicines": [
                {"medicine_name": m["medicine_name"], "quantity": int(m["qty"])}
                for _, m in meds.iterrows()
            ],
        })

    # ---------- SEASONAL (Wet: Jun-Nov, Dry: Dec-May -- parehong get_season() na ginagamit sa training) ----------
    #
    # >>> BAGO: HIWALAY na, MAS MAHABANG forecast horizon PARA LANG SA
    # SEASONAL na tab -- hindi na ito umaasa sa parehong 30-araw na
    # events_df ng Demand tab. Dating kung 30 araw lang ang window,
    # ISANG season lang ang maaabot nito (kung saan man kasalukuyang
    # nahuhulog ang petsa ngayon) -- imposibleng makita ang KABILANG
    # season, kahit anong araw pa i-check. Ngayon, gumagawa tayo ng
    # BAGONG, MAS MAHABANG forecast (SEASONAL_HORIZON_DAYS, sapat na
    # para tiyak na masaklaw ang BUONG Wet + BUONG Dry season), gamit
    # pa rin ang PAREHONG na-train na model -- iba lang ang haba ng
    # tinitingnang hinaharap. Hindi na ito nakaka-apekto sa "Demand"/
    # "Reserve" tabs (mananatili silang 30-araw, para sa near-term na
    # pag-order desisyon) -- ang Seasonal tab lang ang gumagamit nito. <<<
    # >>> FIX (bilis): binawasan mula 400 papuntang 200 araw -- ang
    # PINAKAMALIIT na kailangan para ma-guarantee na masasaklaw ang
    # PAREHONG Wet at Dry season (6 buwan bawat isa, ~183 araw) mula
    # sa KAHIT ANONG petsa ngayon ay ~184 araw -- 200 ay may sapat
    # nang buffer, at kalahati na lang ng dating computation cost. <<<
    SEASONAL_HORIZON_DAYS = 200

    # >>> BAGO: tignan muna ang cache bago mag-compute ulit -- kapag
    # PAREHONG ARAW pa rin (walang pang bagong training/retrain), gamit
    # na lang ang naunang resulta.
    today_str = pd.Timestamp.today().strftime("%Y-%m-%d")
    if _seasonal_cache["date"] == today_str and _seasonal_cache["demand_by_season"] is not None:
        demand_by_season = _seasonal_cache["demand_by_season"]
    else:
        events_df_season_raw = build_pharmacy_request_forecast(SEASONAL_HORIZON_DAYS)

        if events_df_season_raw.empty:
            demand_by_season = []
        else:
            events_df_season = events_df_season_raw.copy()
            events_df_season["season"] = events_df_season["month"].apply(get_season)
            seasonal_totals = (
                events_df_season.groupby("season")["predicted_quantity_requested"]
                .sum().reset_index().rename(columns={"predicted_quantity_requested": "total_qty"})
            )
            seasonal_by_med = (
                events_df_season.groupby(["season", "medicine_name"])["predicted_quantity_requested"]
                .sum().reset_index().rename(columns={"predicted_quantity_requested": "qty"})
            )
            demand_by_season = []
            for _, se in seasonal_totals.iterrows():
                season = se["season"]
                meds = seasonal_by_med[seasonal_by_med["season"] == season]
                # >>> BAGO: TANGGAL na ang head(5) limit -- kaparehong dahilan.
                meds = meds.sort_values("qty", ascending=False)
                demand_by_season.append({
                    "season": season,
                    "total_predicted_quantity": int(se["total_qty"]),
                    "top_medicines": [
                        {"medicine_name": m["medicine_name"], "quantity": int(m["qty"])}
                        for _, m in meds.iterrows()
                    ],
                })

        # I-save sa cache PARA SA MGA SUSUNOD NA CALL NGAYONG ARAW
        _seasonal_cache["date"] = today_str
        _seasonal_cache["demand_by_season"] = demand_by_season

    # >>> FIX v5.4 (dumaraming demand_forecasts + barangay_distributions):
    # TINANGGAL na ang automatic na tawag papunta sa log_predictions_to_
    # supabase() dito. Ang /predict-distribution endpoint na ito ay
    # dapat "PREVIEW LANG" -- tinatawag ito TUWING nag-lo-load o
    # nag-re-refresh ang dashboard (Demand Forecast + Barangay
    # Distribution cards), hindi lang paminsan-minsan. Bago itong FIX,
    # gumagawa ito ng BAGONG "draft" demand_forecasts row + "pending"
    # barangay_distributions row PARA SA BAWAT GAMOT, TUWING lang may
    # nag-view ng dashboard -- kahit walang totoong "Confirm & Save" na
    # pinindot. Dahil dito, dumadami nang sobra ang dalawang table na
    # 'yan sa bawat page load/refresh.
    #
    # Ang TAMANG "save" flow ay nasa /confirm-distribution endpoint na
    # (save_confirmed_distribution() sa barangay_distribution.py) --
    # doon lang dapat talaga sumusulat sa demand_forecasts/barangay_
    # distributions, kapag EXPLICIT na pinindot ng staff ang
    # "Confirm & Save" button. Kaya SAFE at TAMA na tanggalin ang
    # awtomatikong pag-log dito -- hindi ito ginagamit ng frontend, at
    # duplicate lang sa tamang confirm flow.
    #
    # (Ang log_predictions_to_supabase() function mismo ay INIWAN pa
    # rin sa baba ng file, hindi tinanggal -- basta hindi na ito
    # AWTOMATIKONG tinatawag. Kung sakaling kailangan pa ito balang
    # araw para sa ibang layunin, hal. periodic snapshot logging para
    # sa MAE tracking, puwede pa rin itong gamitin nang explicit.)

    return {
        "forecast_period_days": req.forecast_days_ahead,
        "number_of_barangays": num_brgy,
        "safety_buffer_percent_used": req.safety_buffer_percent,

        "pharmacy_demand_summary": demand_summary_live.to_dict(orient="records"),
        "stock_and_reserve_summary": result_per_medicine,

        # >>> BAGO: monthly/seasonal forecast breakdown (Weekly tab at
        # ang mga unused na predicted_pharmacy_requests_* fields ay
        # tinanggal na -- tingnan ang mga paalala sa itaas)
        "demand_by_month": demand_by_month,
        "demand_by_season": demand_by_season,

        "barangay_equal_distribution_exact": distribution_exact,
        "barangay_equal_distribution_buffered": distribution_buffered,
        "barangay_recommendation_exact": barangay_recommendation_exact,
        "barangay_recommendation_buffered": barangay_recommendation_buffered,
    }


def log_predictions_to_supabase(
    result_per_medicine, barangay_recommendation_exact, forecast_days_ahead
):
    """
    >>> PAALALA: hindi na ito AWTOMATIKONG tinatawag ng predict_
    distribution() (tingnan ang FIX v5.4 note sa itaas). Naiwan pa rin
    ang function na ito dito para pwede pa ring gamitin nang explicit
    balang araw kung kakailanganin (hal. periodic snapshot logging),
    pero hindi na ito bahagi ng normal na request/response flow. <<<
    """
    sb = get_supabase()
    if sb is None:
        return

    med_resp = sb.table("medicines").select("medicine_id, generic_name").execute()
    name_to_id = {row["generic_name"]: row["medicine_id"] for row in med_resp.data}

    today = pd.Timestamp.today().normalize()
    end_date = today + pd.Timedelta(days=forecast_days_ahead)
    forecast_period = f"{today.strftime('%Y%m%d')}-{end_date.strftime('%Y%m%d')}"

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
    global CURRENT_MODEL_VERSION
    sb = get_supabase()
    if sb is None:
        return
    new_version = pd.Timestamp.now().strftime("v%Y%m%d_%H%M%S")
    try:
        # >>> BAGO: "warehouse_ml_model_versions" na ito (hindi na
        # "ml_model_versions") -- hiwalay na table para sa WAREHOUSE ML
        # model history, para hindi magkahalo sa ml_model_versions na
        # ginagamit na ng PHARMACY side (ibang ML system). <<<
        sb.table("warehouse_ml_model_versions").insert({
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
    source: str
    rows: List[ConfirmDistributionRow]
    forecast_period_days: Optional[int] = 30


@app.post("/confirm-distribution")
def confirm_distribution(req: ConfirmDistributionRequest):
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
    except Exception as e:
        raise HTTPException(500, f"Hindi na-save ang distribution plan: {e}")

    return result


@app.get("/health")
def health_check():
    return {"status": "ok", "message": "Warehouse ML service v5.5 is running (DEBUG mode)."}


RETRAIN_COOLDOWN_SECONDS = 60 * 60  # 1 oras
_last_retrain_time = 0
CURRENT_MODEL_VERSION = "v_initial"

WEBHOOK_SECRET = os.environ.get("RETRAIN_WEBHOOK_SECRET")


class RetrainRequest(BaseModel):
    force: Optional[bool] = False
    secret: Optional[str] = None


@app.post("/retrain")
def retrain_model(req: RetrainRequest = RetrainRequest()):
    global _last_retrain_time, _cache, _seasonal_cache

    trigger_source = "webhook" if req.secret else "manual"

    if WEBHOOK_SECRET and req.secret != WEBHOOK_SECRET:
        raise HTTPException(401, "Mali o walang secret na ipinasa.")

    now = time.time()
    seconds_since_last = now - _last_retrain_time
    if not req.force and seconds_since_last < RETRAIN_COOLDOWN_SECONDS:
        wait_more = int(RETRAIN_COOLDOWN_SECONDS - seconds_since_last)
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

    _cache = None
    # >>> BAGO: i-reset din ang seasonal AT demand-forecast cache --
    # bagong model na, kaya kailangang i-compute ulit ang PAREHONG
    # forecast (hindi na dapat gamitin ang lumang cached na resulta
    # mula sa lumang model).
    _seasonal_cache = {"date": None, "demand_by_season": None}
    _demand_forecast_cache.clear()
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