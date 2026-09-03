"""
barangay_distribution.py
--------------------------------------------------------------------------
PLAIN ARITHMETIC lang ito -- WALANG ML/model dito, at SADYANG hiwalay
sa training_logic.py (na siyang may ML para sa pharmacy demand prediction).

>>> BAGO: CASCADING BOX -> STRIP -> PIECE NA PAGHAHATI <<<
Dati, "pieces lang" ang ginagamit sa buong equal split (floor division sa
raw piece count), kaya kahit may 5 buong box na dapat sana ay eksaktong
mahati, kung minsan pieces ang lumalabas sa recommendation.

Ngayon, HAKBANG-HAKBANG ang paghahati, base sa totoong packaging ng
gamot (boxes -> strips_per_box -> pieces_per_strip):

  1. Hatiin muna ang BUONG BOX nang pantay-pantay sa lahat ng barangay
     (floor division sa box level).
  2. Ang HINDI na-hating boxes (natira dahil di kasya sa lahat) ay
     i-convert papuntang STRIPS, idagdag sa anumang natirang strips, at
     hatiin ULIT nang pantay-pantay sa STRIP level.
  3. Ang HINDI pa rin na-hating strips ay i-convert papuntang PIECES, at
     hatiin sa PIECE level -- ito na ang pinakamaliit na unit, kaya
     kahit ano pang matira dito ay HINDI na mahahati pantay-pantay --
     nananatili sa warehouse.

Kung walang packaging info ang gamot (walang pieces_per_box/
pieces_per_strip), gumagana pa rin ito nang normal -- piece-level split
lang, tulad ng dati.

GINAGAMIT ITO NG: api_server.py, sa loob ng /predict-distribution
endpoint, PAGKATAPOS ma-compute ang "available_for_distribution" bawat
gamot (available = current_stock - reserve_for_pharmacy), sa PIECES.

>>> BAGO v2 (save_confirmed_distribution -- auto-create Release):
Dating ang "Confirm & Save" sa Barangay Distribution card ay dalawang
table lang ang tinatamaan (demand_forecasts + barangay_distributions),
kaya HINDI ito lumalabas sa "Medicine Releases" page -- magkaiba ang
dalawang flow kahit parehong "pagpapadala ng gamot sa barangay" ang
ibig sabihin.

Ngayon, kapag na-confirm ang isang distribution plan (auto o manual),
gumagawa na rin ito ng TUNAY na `releases` + `release_items` record --
kagaya ng ginagawa ng "+ New Release" button -- kaya lumalabas na rin
ito sa Medicine Releases page, may status na "pending" hanggang ma-
receive.

⚠️ PAALALA (kailangan pang i-verify laban sa totoong "+ New Release"
   flow -- tingnan ang mga paalala sa loob ng create_releases_for_
   confirmed_distribution() sa ibaba):
   1. Ang FORMAT ng `release_number` dito ay "BRGYDIST-YYYYMMDD-###" --
      sariling convention lang ito na ginawa dahil hindi pa nakumpirma
      ang totoong ginagamit ng manual "+ New Release" button. Basta
      UNIQUE lang ang kailangan (walang CHECK constraint sa pattern sa
      DB), kaya safe itong gamitin, pero baka gusto mong itugma sa
      ibang convention -- sabihin lang para maayos.
   2. HINDI dito binabawasan ang quantity ng napiling batch sa
      `medicine_batches` -- inaasahang may ibang mekanismo (trigger o
      ibang app logic) na gumagawa niyan kapag may bagong release_item.
      Kung wala palang ganito, kailangan pang idagdag ang explicit
      deduction dito.
   3. Isang BATCH lang ang pinipili per medicine per barangay (yung
      pinaka-malapit nang mag-expire, FEFO) -- kung hindi kasya ang
      quantity ng batch na iyon, wala pang "split across multiple
      batches" na logic dito.
"""

from typing import Dict, List, Optional
import pandas as pd


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


def compute_equal_split(
    available: int,
    num_barangays: int,
    pieces_per_box: Optional[int] = None,
    pieces_per_strip: Optional[int] = None,
) -> Dict[str, int]:
    """
    Ang PUSO ng arithmetic -- CASCADING na box -> strip -> piece.

    Halimbawa: available=1040 pieces, num_barangays=96,
               pieces_per_box=100 (10 strips/box x 10 pcs/strip),
               pieces_per_strip=10

      Hakbang 1 (BOX): 1040 // 100 = 10 buong box available.
                        10 // 96 = 0 box bawat barangay (kulang pa sa 1
                        box kada isa). 0 pieces ang nagamit sa hakbang
                        na ito, buo pa rin ang 1040.

      Hakbang 2 (STRIP): 1040 // 10 = 104 strips available.
                          104 // 96 = 1 strip bawat barangay.
                          Nagamit: 1 x 96 x 10 = 960 pieces.
                          Natira: 1040 - 960 = 80 pieces.

      Hakbang 3 (PIECE): 80 // 96 = 0 piece bawat barangay (kulang pa
                          sa 1 piece kada isa). Ang 80 pieces na ‘to ay
                          HINDI na mahahati pantay-pantay -- nananatili
                          sa warehouse bilang leftover_units.

      Resulta: bawat barangay ay tatanggap ng 1 STRIP (10 pieces), at
      80 pieces ang matitira sa warehouse.

    Kung walang pieces_per_box/pieces_per_strip (None o 0), piece-level
    split lang -- kagaya ng dating simpleng floor division.
    """
    if num_barangays <= 0 or available <= 0:
        return {
            "boxes_per_barangay": 0,
            "strips_per_barangay": 0,
            "pieces_per_barangay": 0,
            "leftover_units": 0,
        }

    remaining = available
    boxes_per_barangay = 0
    strips_per_barangay = 0

    # ---------- Hakbang 1: BOX level ----------
    if pieces_per_box and pieces_per_box > 0:
        available_boxes = remaining // pieces_per_box
        boxes_per_barangay = available_boxes // num_barangays
        remaining -= boxes_per_barangay * num_barangays * pieces_per_box

    # ---------- Hakbang 2: STRIP level (mula sa natira pagkatapos ng box) ----------
    if pieces_per_strip and pieces_per_strip > 0:
        available_strips = remaining // pieces_per_strip
        strips_per_barangay = available_strips // num_barangays
        remaining -= strips_per_barangay * num_barangays * pieces_per_strip

    # ---------- Hakbang 3: PIECE level (mula sa natira pagkatapos ng strip) ----------
    pieces_per_barangay = remaining // num_barangays
    leftover_units = remaining % num_barangays

    return {
        "boxes_per_barangay": boxes_per_barangay,
        "strips_per_barangay": strips_per_barangay,
        "pieces_per_barangay": pieces_per_barangay,
        "leftover_units": leftover_units,
    }


def build_equal_barangay_recommendation(
    distribution_list: List[dict], barangay_list: List[dict]
) -> List[dict]:
    """
    Ang TUNAY na "recommendation" -- listahan na ng SINONG barangay
    (destination_id + pangalan) at ILAN eksakto ang matatanggap nila,
    kasama na ang cascading box/strip/piece breakdown.

    `distribution_list` -- listahan ng dict, bawat isa ay OUTPUT ng
    attach_equal_split() (may boxes_per_barangay, strips_per_barangay,
    pieces_per_barangay, pieces_per_box, pieces_per_strip).

    `barangay_list` -- output ng fetch_barangay_list_from_destinations()

    PAANO HINAHATI ANG LEFTOVER: HINDI ito ibinibigay sa kahit kaninong
    barangay. Lahat ng 96 barangay ay tumatanggap ng EKSAKTONG PAREHONG
    box+strip+piece breakdown -- walang +1 kahit kanino, kaya walang
    barangay na "swerte" na mas marami ang tanggap. Ang leftover
    (pinakamaliit na unit, pieces) ay NANANATILI sa warehouse.
    """
    recommendation = []
    for d in distribution_list:
        if d["available_for_distribution"] <= 0:
            continue  # walang matitira para dito -- walang irerecommend

        boxes = d.get("boxes_per_barangay", 0)
        strips = d.get("strips_per_barangay", 0)
        pcs = d.get("pieces_per_barangay", 0)
        pieces_per_box = d.get("pieces_per_box") or 0
        pieces_per_strip = d.get("pieces_per_strip") or 0

        # Total sa PIECES -- ito pa rin ang isesave sa DB
        # (barangay_distributions.quantity), para consistent ang unit
        # ng pagsstore kahit paano man ito na-breakdown para sa display.
        total_pieces = boxes * pieces_per_box + strips * pieces_per_strip + pcs

        if total_pieces <= 0:
            continue  # kulang pa sa 1 piece bawat barangay kahit patas na hatiin

        for brgy in barangay_list:
            recommendation.append({
                "destination_id": brgy.get("destination_id"),
                "barangay_name": brgy.get("destination_name"),
                "medicine_name": d["medicine_name"],
                "unit": d.get("unit", "unit"),
                "recommended_quantity": int(total_pieces),
                # >>> BAGO: box/strip/piece breakdown, para sa mas
                # makabuluhang display sa frontend (hal. "1 strip"
                # sa halip na "10 pcs"). <<<
                "recommended_boxes": int(boxes),
                "recommended_strips": int(strips),
                "recommended_pieces": int(pcs),
            })

    return recommendation


def attach_equal_split(
    medicine_name: str,
    available: int,
    num_barangays: int,
    unit: str = "unit",
    pieces_per_box: Optional[int] = None,
    pieces_per_strip: Optional[int] = None,
) -> dict:
    """
    Convenience helper -- ginagawa ang buong dict na kailangan ng
    build_equal_barangay_recommendation() para sa IISANG gamot, mula sa
    available stock at bilang ng barangay. Ginagamit ito ng api_server.py
    sa loob ng loop bawat gamot.

    `pieces_per_box`/`pieces_per_strip` -- ang representative packaging
    conversion ng gamot na ito (mula sa fetch_medicine_packaging() sa
    api_server.py). Kung None, piece-level split lang ang gagamitin.
    """
    split = compute_equal_split(available, num_barangays, pieces_per_box, pieces_per_strip)
    return {
        "medicine_name": medicine_name,
        "unit": unit,
        "available_for_distribution": available,
        "number_of_barangays": num_barangays,
        "pieces_per_box": pieces_per_box,
        "pieces_per_strip": pieces_per_strip,
        **split,
    }


# ============================================================
# CONFIRMED DISTRIBUTION (AUTO o MANUAL) -- pag-save ng FINAL na
# desisyon ng warehouse staff.
# ============================================================
#
# Ang STAFF ang huling desisyon dito, hindi ML at hindi na rin plain
# arithmetic -- kaya ang function sa ibaba ay 'dumb save' lang: kung ano
# ang ipinasa (galing man sa recommendation na sinunod nang buo, o
# ganap na tinype ng staff mula sa wala), yun din ang isesave.
#
# May DALAWANG source lang, at HINDI PWEDENG MAGHALO ang isang plan
# (base sa desisyon ng RHU Lopez):
#   - "auto"   -> yung mismong equal-split recommendation, sinunod nang
#                 walang binago
#   - "manual" -> ganap na pinili ng warehouse staff ang gamot at
#                 quantity bawat barangay
#
# PAALALA (nahanap habang nagde-debug ng "demand_forecasts_status_check"/
# "barangay_distributions_status_check" violations): dalawang MAGKAIBANG
# konsepto ang tinatrack ng status sa DALAWANG table na ito -- hindi
# dapat parehong "confirmed":
#
#   - demand_forecasts.status: tumatrack ng DESISYON (draft -> confirmed
#     ng staff). Dito TAMA ang "confirmed".
#
#   - barangay_distributions.status: tumatrack ng PHYSICAL DELIVERY
#     lifecycle (CHECK constraint sa DB: 'pending' -> 'distributed' ->
#     'received' LANG ang allowed values -- walang "confirmed"). Kapag
#     na-confirm ng staff ang plano, HINDI pa ito physically naipapadala
#     sa mga barangay -- plano pa lang ito. Kaya ang TAMANG status dito
#     ay "pending" (naghihintay pang i-distribute), hindi "confirmed".
#
def _pick_fefo_batch(supabase_client, medicine_id: str, needed_qty: int) -> Optional[dict]:
    """
    Piliin ang batch na dapat unahing ubusin, gamit ang FEFO (First-
    Expiry-First-Out): ang batch na PINAKAMALAPIT nang mag-expire, na
    'available' o 'low_stock' pa, ang priority.

    Kung may batch na sapat ang total_quantity para sa needed_qty,
    ibabalik ito. Kung wala man lang sapat, ibabalik pa rin ang
    pinaka-malapit-nang-mag-expire na batch (partial coverage --
    HINDI pa ito naghahati sa maraming batch, tingnan ang PAALALA #3
    sa itaas ng file).

    Nagbabalik ng None kung walang available/low_stock na batch para
    sa medicine_id na ito.

    >>> FIX (WinError/timeout dahil sa dami ng calls): TINATAWAG na
    lang ito ISANG BESES PER GAMOT (hindi per barangay) sa loob ng
    create_releases_for_confirmed_distribution() -- pareho naman ang
    napipiling batch para sa lahat ng barangay na tatanggap ng
    parehong gamot (wala pa tayong per-batch deduction, tingnan ang
    PAALALA #2 sa itaas ng file), kaya walang saysay na ulitin ito
    96 beses. <<<
    """
    resp = (
        supabase_client.table("medicine_batches")
        .select("batch_id, expiration_date, status, total_quantity")
        .eq("medicine_id", medicine_id)
        .in_("status", ["available", "low_stock"])
        .order("expiration_date")
        .execute()
    )
    if not resp.data:
        return None

    # Priority 1: unang batch (pinaka-maagang mag-expire dahil naka-
    # order na ascending) na sapat ang total_quantity.
    for batch in resp.data:
        qty = batch.get("total_quantity") or 0
        if qty >= needed_qty:
            return batch

    # Priority 2: walang sapat -- ibalik na lang ang pinaka-maagang
    # mag-expire (partial coverage lang, alam na limitasyon).
    return resp.data[0]


def create_releases_for_confirmed_distribution(
    supabase_client,
    rows: List[dict],
    name_to_id: Dict[str, str],
) -> dict:
    """
    Gumawa ng TUNAY na 'releases' + 'release_items' record, isang
    release PER BARANGAY (destination), na naglalaman ng maraming
    release_items (isa per gamot na napunta doon) -- kagaya ng
    ginagawa ng "+ New Release" button sa Medicine Releases page.

    `rows` -- parehong listahan na ipinasa sa save_confirmed_
    distribution() (destination_id, medicine_name, quantity).

    `name_to_id` -- mapping ng medicine_name -> medicine_id (galing
    sa parehong query na ginawa na ng save_confirmed_distribution(),
    para hindi na tayo mag-duplicate ng Supabase call).

    Ibinabalik: { releases_created, release_items_created, skipped }

    >>> FIX v2 (timeout sa 96-barangay na Manual save): dating
    umuulit ito ng PER-BARANGAY na Supabase call (FEFO query + release
    insert + release_items insert) -- kaya sa 96 barangay, umaabot ng
    hanggang ~288 SUNUD-SUNOD na network round-trip, lampas na sa 20s
    timeout ng frontend. Ngayon:

      1. FEFO batch selection: ISANG QUERY PER UNIKONG GAMOT (hindi
         per barangay) -- pareho naman ang resulta para sa lahat ng
         barangay na tumatanggap ng parehong gamot.
      2. 'releases' insert: ISANG BULK INSERT para sa LAHAT ng
         barangay (list ng dicts sa isang .insert() call).
      3. 'release_items' insert: ISANG (o ilang chunked) BULK INSERT
         para sa LAHAT ng release_items, sa halip na isa-isa.

    Kaya kahit 96 barangay x maraming gamot, ilang round-trip na lang
    ang kailangan (bilang ng unikong gamot + ~2-3), hindi na daan-daan. <<<
    """
    # ---------- 1. I-GROUP muna ang mga row PER DESTINATION ----------
    rows_by_dest: Dict[str, List[dict]] = {}
    for r in rows:
        qty = int(r["quantity"])
        if qty <= 0:
            continue
        dest_id = r.get("destination_id")
        if not dest_id:
            continue
        rows_by_dest.setdefault(dest_id, []).append(r)

    if not rows_by_dest:
        return {"releases_created": 0, "release_items_created": 0, "skipped": 0}

    # ---------- 2. FEFO batch selection -- ISANG BESES PER UNIKONG
    # GAMOT, hindi per barangay. Ginagamit ang TOTAL na kailangan
    # (sum ng quantity sa LAHAT ng barangay para sa gamot na iyon)
    # para sa "sapat ba ang batch" na check. ----------
    total_needed_by_medicine: Dict[str, int] = {}
    for dest_rows in rows_by_dest.values():
        for r in dest_rows:
            medicine_id = name_to_id.get(r["medicine_name"])
            if medicine_id is None:
                continue
            total_needed_by_medicine[medicine_id] = (
                total_needed_by_medicine.get(medicine_id, 0) + int(r["quantity"])
            )

    batch_id_by_medicine: Dict[str, str] = {}
    for medicine_id, total_needed in total_needed_by_medicine.items():
        batch = _pick_fefo_batch(supabase_client, medicine_id, total_needed)
        if batch is not None:
            batch_id_by_medicine[medicine_id] = batch["batch_id"]

    # ---------- 3. Alamin ang panimulang sequence number ngayong araw,
    # para hindi mag-conflict ang release_number (UNIQUE constraint) --
    # tingnan ang PAALALA #1 sa itaas ng file tungkol sa format nito. ----------
    today = pd.Timestamp.today()
    date_prefix = today.strftime("%Y%m%d")

    existing_resp = (
        supabase_client.table("releases")
        .select("release_number")
        .like("release_number", f"BRGYDIST-{date_prefix}-%")
        .execute()
    )
    existing_seq = 0
    for row in (existing_resp.data or []):
        num = row.get("release_number", "")
        try:
            existing_seq = max(existing_seq, int(num.rsplit("-", 1)[-1]))
        except (ValueError, IndexError):
            continue

    # ---------- 4. Buuin ang LAHAT ng 'releases' row (isa per
    # barangay), tapos ISANG BULK INSERT lang para sa lahat. ----------
    seq = existing_seq
    release_number_by_dest: Dict[str, str] = {}
    release_insert_rows = []
    for dest_id in rows_by_dest.keys():
        seq += 1
        release_number = f"BRGYDIST-{date_prefix}-{seq:03d}"
        release_number_by_dest[dest_id] = release_number
        release_insert_rows.append({
            "release_number": release_number,
            "destination_id": dest_id,
            "status": "pending",
            "remarks": "Auto-generated mula sa Barangay Distribution (Confirm & Save).",
        })

    release_resp = supabase_client.table("releases").insert(release_insert_rows).execute()
    if not release_resp.data:
        # Walang na-insert kahit isa -- ibig sabihin walang releases o
        # release_items na magagawa.
        total_rows = sum(len(v) for v in rows_by_dest.values())
        return {"releases_created": 0, "release_items_created": 0, "skipped": total_rows}

    # I-match base sa release_number (UNIQUE), hindi base sa order ng
    # pagbalik -- mas ligtas kahit hindi garantisadong preserved ang
    # pagkakasunod-sunod ng bulk insert response.
    release_id_by_number = {row["release_number"]: row["release_id"] for row in release_resp.data}
    release_id_by_dest = {
        dest_id: release_id_by_number[num]
        for dest_id, num in release_number_by_dest.items()
        if num in release_id_by_number
    }
    releases_created = len(release_id_by_dest)

    # ---------- 5. Buuin ang LAHAT ng 'release_items' row, tapos
    # BULK INSERT (chunked kung sobrang dami, para hindi masyadong
    # malaki ang isang payload). ----------
    item_insert_rows = []
    skipped = 0
    for dest_id, dest_rows in rows_by_dest.items():
        release_id = release_id_by_dest.get(dest_id)
        if release_id is None:
            skipped += len(dest_rows)
            continue
        for r in dest_rows:
            med_name = r["medicine_name"]
            medicine_id = name_to_id.get(med_name)
            qty = int(r["quantity"])
            if medicine_id is None:
                print(f"[WARN] Walang match na medicine_id para sa '{med_name}' -- ski-skip sa release_items.")
                skipped += 1
                continue
            batch_id = batch_id_by_medicine.get(medicine_id)
            if batch_id is None:
                print(f"[WARN] Walang available/low_stock na batch para sa '{med_name}' -- ski-skip sa release_items.")
                skipped += 1
                continue
            item_insert_rows.append({
                "release_id": release_id,
                "batch_id": batch_id,
                "quantity": qty,
                "display_quantity": qty,
                "display_unit": "pcs",
            })

    release_items_created = 0
    CHUNK_SIZE = 500  # iwas sobrang laking payload sa isang request
    for i in range(0, len(item_insert_rows), CHUNK_SIZE):
        chunk = item_insert_rows[i:i + CHUNK_SIZE]
        supabase_client.table("release_items").insert(chunk).execute()
        release_items_created += len(chunk)

    return {
        "releases_created": releases_created,
        "release_items_created": release_items_created,
        "skipped": skipped,
    }


def save_confirmed_distribution(
    supabase_client,
    rows: List[dict],
    source: str,
    forecast_period_days: int = 30,
) -> dict:
    """
    I-save ang FINAL na distribution plan (auto o manual) sa
    'barangay_distributions' table, AT gumawa rin ng tunay na
    'releases' + 'release_items' record para lumabas ito sa Medicine
    Releases page (tingnan ang create_releases_for_confirmed_
    distribution() sa itaas).

    `rows` -- listahan ng dict, bawat isa ay:
        { destination_id, medicine_name, quantity }
    (galing man sa barangay_recommendation_exact/buffered kung 'auto',
    o direktang input ng staff kung 'manual')

    Ibinabalik: { status, medicines_saved, barangay_rows_saved,
                  releases_created, release_items_created }
    """
    if supabase_client is None:
        raise ValueError("Walang Supabase connection -- hindi ma-save ang confirmed distribution.")
    if source not in ("auto", "manual"):
        raise ValueError("Ang 'source' ay dapat 'auto' o 'manual' lang.")
    if not rows:
        raise ValueError("Walang laman ang distribution plan -- wala kang bibigyan.")

    med_resp = supabase_client.table("medicines").select("medicine_id, generic_name").execute()
    name_to_id = {row["generic_name"]: row["medicine_id"] for row in med_resp.data}

    totals_by_med: Dict[str, int] = {}
    for r in rows:
        totals_by_med[r["medicine_name"]] = totals_by_med.get(r["medicine_name"], 0) + int(r["quantity"])

    today = pd.Timestamp.today().normalize()
    end_date = today + pd.Timedelta(days=forecast_period_days)
    forecast_period = f"{today.strftime('%Y%m%d')}-{end_date.strftime('%Y%m%d')}"

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
            "base_forecast_quantity": 0,
            "buffer_percentage": 0.0,
            "recommended_quantity": total_qty,
            "model_version": model_version,
            "status": "confirmed",
        }).execute()
        if fc_resp.data:
            forecast_id_by_med[med_name] = fc_resp.data[0]["forecast_id"]

    dist_rows = []
    for r in rows:
        qty = int(r["quantity"])
        if qty <= 0:
            continue
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
            "status": "pending",
        })

    if dist_rows:
        supabase_client.table("barangay_distributions").insert(dist_rows).execute()

    # >>> BAGO: gumawa rin ng tunay na Release, para lumabas sa
    # Medicine Releases page -- tingnan ang mga PAALALA sa itaas ng
    # file tungkol sa mga assumption dito (release_number format,
    # walang stock deduction, single-batch FEFO lang). <<<
    release_result = create_releases_for_confirmed_distribution(
        supabase_client, rows, name_to_id
    )

    return {
        "status": "confirmed",
        "source": source,
        "medicines_saved": len(forecast_id_by_med),
        "barangay_rows_saved": len(dist_rows),
        "releases_created": release_result["releases_created"],
        "release_items_created": release_result["release_items_created"],
    }