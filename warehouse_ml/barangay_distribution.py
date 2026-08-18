"""
barangay_distribution.py
--------------------------------------------------------------------------
PLAIN ARITHMETIC lang ito -- WALANG ML/model dito, at SADYANG hiwalay
sa training_logic.py (na siyang may ML para sa pharmacy demand prediction).

BAKIT HIWALAY:
  - Ang PHARMACY DEMAND PREDICTION (training_logic.py / quantity_model.pkl)
    ay may UNCERTAINTY -- hinuhulaan natin ang hindi pa nangyayari, base
    sa historical pattern. DITO tama ang ML.

  - Ang PAGHAHATI SA 96 BARANGAY ay WALANG uncertainty -- POLICY ng RHU
    Lopez na "EQUAL FOR ALL" ito, walang paboritismo, walang weighting
    base sa population/distance/kahit ano. Simpleng:

        available_stock // 96  (base share bawat barangay)
        available_stock %  96  (leftover, ibinibigay nang +1 sa ilan)

    Kaya PURA ARITHMETIC lang ang kailangan dito -- walang model na
    kailangang i-train, walang .pkl na kailangang i-load. Kung sakaling
    magbago balang araw ang POLICY (hal. gustong i-weight base sa
    population ng barangay), DITO lang babaguhin -- hindi kailanman
    dapat maging ML ito habang "equal for all" ang policy.

GINAGAMIT ITO NG: api_server.py, sa loob ng /predict-distribution
endpoint, PAGKATAPOS ma-compute ang "available_for_distribution" bawat
gamot (available = current_stock - reserve_for_pharmacy).
"""

from typing import Dict, List, Optional


def fetch_barangay_list_from_destinations(supabase_client) -> List[dict]:
    """
    Kunin ang BUONG LISTAHAN (destination_id + pangalan) ng ACTIVE na
    barangay mula sa 'destinations' table (destination_type = 'Barangay').

    Kung walang Supabase connection, gagawa ng fallback na 96 dummy
    barangay (BRGY-01 hanggang BRGY-96) para hindi masira ang response.
    """
    fallback = [
        {"destination_id": f"BRGY-{i+1:02d}", "destination_name": f"Barangay {i+1}"}
        for i in range(96)
    ]

    if supabase_client is None:
        return fallback

    resp = (
        supabase_client.table("destinations")
        .select("destination_id, destination_name")
        .eq("destination_type", "Barangay")
        .eq("is_active", True)
        .order("destination_name")
        .execute()
    )
    return resp.data if resp.data else fallback


def compute_equal_split(available: int, num_barangays: int) -> Dict[str, int]:
    """
    Ang PUSO ng arithmetic. Walang ML dito -- FLOOR DIVISION + REMAINDER
    lang. Ibinabalik ang:
      - units_per_barangay: base share, PANTAY-PANTAY sa lahat
      - leftover_units: natitira matapos ang floor division (0 hanggang
        num_barangays - 1 lang laging posibleng halaga)

    Halimbawa: available=288, num_barangays=96
      -> units_per_barangay=3, leftover_units=0  (eksaktong hati)

    Halimbawa: available=1040, num_barangays=96
      -> units_per_barangay=10, leftover_units=80
    """
    if num_barangays <= 0:
        return {"units_per_barangay": 0, "leftover_units": 0}
    if available <= 0:
        return {"units_per_barangay": 0, "leftover_units": 0}

    return {
        "units_per_barangay": available // num_barangays,
        "leftover_units": available % num_barangays,
    }


def build_equal_barangay_recommendation(
    distribution_list: List[dict], barangay_list: List[dict]
) -> List[dict]:
    """
    Ang TUNAY na "recommendation" -- listahan na ng SINONG barangay
    (destination_id + pangalan) at ILAN eksakto ang matatanggap nila,
    kasama na ang PATAS na paghahati ng leftover.

    `distribution_list` -- listahan ng dict, bawat isa ay may:
        medicine_name, available_for_distribution,
        units_per_barangay, leftover_units
    (ito yung output ng compute_equal_split(), naka-attach na sa bawat
    gamot -- tingnan ang api_server.py kung paano ito ginagawa)

    `barangay_list` -- output ng fetch_barangay_list_from_destinations()

    PAANO HINAHATI ANG LEFTOVER: +1 EXTRA na unit sa UNANG `leftover_units`
    na barangay sa listahan (naka-sort by name). Simple at predictable --
    walang paboritismo, at consistent kada run (parehong barangay laging
    unang nakakatanggap ng extra kung magkasing-available ang stock).

    Kung sa hinaharap ay gusto ng RHU ng ROTATION (iba-ibang barangay ang
    nakakatanggap ng extra kada forecast run, para mas patas sa mahabang
    panahon), DITO LANG babaguhin ang paraan ng pag-assign ng extra --
    walang kinalaman ang ML dito, purong sequencing/rotation logic lang.
    """
    recommendation = []
    for d in distribution_list:
        if d["available_for_distribution"] <= 0:
            continue  # walang matitira para dito -- walang irerecommend

        base_qty = d["units_per_barangay"]
        leftover = d["leftover_units"]

        for idx, brgy in enumerate(barangay_list):
            qty = base_qty + (1 if idx < leftover else 0)
            if qty <= 0:
                continue
            recommendation.append({
                "destination_id": brgy.get("destination_id"),
                "barangay_name": brgy.get("destination_name"),
                "medicine_name": d["medicine_name"],
                "unit": d.get("unit", "unit"),
                "recommended_quantity": int(qty),
            })

    return recommendation


def attach_equal_split(medicine_name: str, available: int, num_barangays: int, unit: str = "unit") -> dict:
    """
    Convenience helper -- ginagawa ang buong dict na kailangan ng
    build_equal_barangay_recommendation() para sa IISANG gamot, mula sa
    available stock at bilang ng barangay. Ginagamit ito ng api_server.py
    sa loob ng loop bawat gamot.

    `unit` -- TOTOONG unit ng gamot mula sa 'medicines' table (Piece,
    Bottle, Box, Loose, Strip, atbp.), ipinapasa lang papunta sa
    recommendation rows sa ibaba para tama ang label sa UI.
    """
    split = compute_equal_split(available, num_barangays)
    return {
        "medicine_name": medicine_name,
        "unit": unit,
        "available_for_distribution": available,
        "number_of_barangays": num_barangays,
        "units_per_barangay": split["units_per_barangay"],
        "leftover_units": split["leftover_units"],
    }


# ============================================================
# CONFIRMED DISTRIBUTION (AUTO o MANUAL) -- pag-save ng FINAL na
# desisyon ng warehouse staff.
# ============================================================
#
# Ang STAFF ang huling desisyon dito, hindi ML at hindi na rin plain
# arithmetic -- kaya ang function sa ibaba ay 'dumb save' lang: kung ano
# ang ipinasa (galing man sa recommendation na sinunod nang buo, o
# ganap na tinype ng staff mula sa wala), yun din ang isesave, status
# = 'confirmed'.
#
# May DALAWANG source lang, at HINDI PWEDENG MAGHALO ang isang plan
# (base sa desisyon ng RHU Lopez):
#   - "auto"   -> yung mismong equal-split recommendation, sinunod nang
#                 walang binago
#   - "manual" -> ganap na pinili ng warehouse staff ang gamot at
#                 quantity bawat barangay
#
def save_confirmed_distribution(
    supabase_client,
    rows: List[dict],
    source: str,
    forecast_period_days: int = 30,
) -> dict:
    """
    I-save ang FINAL na distribution plan (auto o manual) bilang
    'confirmed' sa 'barangay_distributions' table.

    `rows` -- listahan ng dict, bawat isa ay:
        { destination_id, medicine_name, quantity }
    (galing man sa barangay_recommendation_exact/buffered kung 'auto',
    o direktang input ng staff kung 'manual')

    Muling gumagamit ng 'demand_forecasts' table bilang PARENT record
    per medicine (required ng foreign key ng barangay_distributions),
    pero may sariling model_version/status para malinaw na hindi ito
    ML prediction:
        - status='confirmed' (hindi 'draft')
        - model_version='auto-confirmed' o 'manual-override'

    Ibinabalik: { status, medicines_saved, barangay_rows_saved }
    """
    if supabase_client is None:
        raise ValueError("Walang Supabase connection -- hindi ma-save ang confirmed distribution.")
    if source not in ("auto", "manual"):
        raise ValueError("Ang 'source' ay dapat 'auto' o 'manual' lang.")
    if not rows:
        raise ValueError("Walang laman ang distribution plan -- wala kang bibigyan.")

    # ---------- 1. I-map ang medicine_name papunta sa medicine_id ----------
    med_resp = supabase_client.table("medicines").select("medicine_id, generic_name").execute()
    name_to_id = {row["generic_name"]: row["medicine_id"] for row in med_resp.data}

    # ---------- 2. I-group ang rows per medicine, para malaman ang
    # TOTAL na ibinigay sa bawat gamot (para sa demand_forecasts row) ----------
    totals_by_med: Dict[str, int] = {}
    for r in rows:
        totals_by_med[r["medicine_name"]] = totals_by_med.get(r["medicine_name"], 0) + int(r["quantity"])

    import pandas as pd  # local import -- iwas circular/unused sa module load kung minsan hindi kailangan
    today = pd.Timestamp.today().normalize()
    end_date = today + pd.Timedelta(days=forecast_period_days)
    forecast_period = f"{today.strftime('%Y-%m-%d')}_to_{end_date.strftime('%Y-%m-%d')}"

    model_version = "auto-confirmed" if source == "auto" else "manual-override"

    forecast_id_by_med: Dict[str, str] = {}
    for med_name, total_qty in totals_by_med.items():
        medicine_id = name_to_id.get(med_name)
        if medicine_id is None:
            print(f"[WARN] Walang match na medicine_id para sa '{med_name}' -- ski-skip sa confirm.")
            continue
        fc_resp = supabase_client.table("demand_forecasts").insert({
            "medicine_id": medicine_id,
            "forecast_period": forecast_period,
            "base_forecast_quantity": None,
            "buffer_percentage": None,
            "recommended_quantity": total_qty,
            "model_version": model_version,
            "status": "confirmed",
        }).execute()
        if fc_resp.data:
            forecast_id_by_med[med_name] = fc_resp.data[0]["forecast_id"]

    # ---------- 3. Insert ang bawat barangay row, status='confirmed' ----------
    dist_rows = []
    for r in rows:
        qty = int(r["quantity"])
        if qty <= 0:
            continue  # walang ibinigay dito, huwag i-save
        med_name = r["medicine_name"]
        medicine_id = name_to_id.get(med_name)
        forecast_id = forecast_id_by_med.get(med_name)
        if medicine_id is None or forecast_id is None or not r.get("destination_id"):
            continue
        dist_rows.append({
            "forecast_id": forecast_id,
            "medicine_id": medicine_id,
            "destination_id": r["destination_id"],
            "quantity": qty,
            "status": "confirmed",
        })

    if dist_rows:
        supabase_client.table("barangay_distributions").insert(dist_rows).execute()

    return {
        "status": "confirmed",
        "source": source,
        "medicines_saved": len(forecast_id_by_med),
        "barangay_rows_saved": len(dist_rows),
    }