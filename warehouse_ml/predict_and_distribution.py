"""
3_predict_and_distribute.py
------------------------------
ITO ANG MAIN OUTPUT NG SYSTEM. Ginagawa nito ang lahat ng hiningi mo:

  A) PREDICTION: bilang, percentage, at uri ng gamot na possible
     i-request ng mga pharmacy sa susunod na buwan
  B) STOCK COMPUTATION: base sa current warehouse stock, ilan ang
     pwedeng ipamigay sa mga barangay (available for distribution)
  C) EQUAL DISTRIBUTION: paghahati ng available stock nang PANTAY-PANTAY
     sa lahat ng barangay (FLOOR division + leftover handling)

PAANO GAMITIN:
  1. Palitan ang CURRENT_STOCK dictionary sa ibaba ng totoong current
     stock niyo sa warehouse (o i-load mula sa warehouse_stock.csv)
  2. Palitan ang BARANGAY_LIST ng totoong listahan ng barangay niyo
  3. Patakbuhin: python3 3_predict_and_distribute.py
  4. Makikita ang output sa terminal AT sa outputs/ folder (CSV files)
"""

import pandas as pd
import numpy as np
import joblib

# ============================================================
# 1. I-LOAD ANG MGA NA-TRAIN NA MODELS
# ============================================================
qty_model = joblib.load("models/quantity_model.pkl")
cat_model = joblib.load("models/category_model.pkl")
le_brgy = joblib.load("models/le_barangay.pkl")
le_med = joblib.load("models/le_medicine.pkl")
le_cat = joblib.load("models/le_category.pkl")
le_season = joblib.load("models/le_season.pkl")

latest_features = pd.read_csv("data/latest_features.csv")
med_cat_map = pd.read_csv("data/medicine_category_map.csv")

# ============================================================
# 2. I-SET ANG TARGET MONTH NA IPE-PREDICT (susunod na buwan)
# ============================================================
today = pd.Timestamp.today()
target_month = (today + pd.DateOffset(months=1)).month
target_season = "Wet" if target_month in [6,7,8,9,10,11] else "Dry"

print(f"📅 Predicting demand para sa buwan #{target_month} (Season: {target_season})\n")

# ============================================================
# 3. GUMAWA NG PREDICTION PARA SA BAWAT BARANGAY + MEDICINE
# ============================================================
rows = []
for _, r in latest_features.iterrows():
    brgy = r["barangay_id"]
    med = r["medicine_name"]

    brgy_enc = le_brgy.transform([brgy])[0]
    med_enc = le_med.transform([med])[0]
    season_enc = le_season.transform([target_season])[0]

    X_pred = pd.DataFrame([{
        "month": target_month,
        "season_enc": season_enc,
        "barangay_enc": brgy_enc,
        "medicine_enc": med_enc,
        "rolling_avg_3mo": r["rolling_avg_3mo"],
        "same_month_last_year": r["same_month_last_year"],
    }])

    predicted_qty = max(0, round(qty_model.predict(X_pred)[0]))

    rows.append({
        "barangay_id": brgy,
        "medicine_name": med,
        "medicine_category": r["medicine_category"],
        "predicted_quantity": predicted_qty
    })

pred_df = pd.DataFrame(rows)

# ============================================================
# 4. I-SUMMARIZE: TOTAL PREDICTED DEMAND PER MEDICINE
#    (bilang + percentage + uri) -- ito yung sagot sa "A"
# ============================================================
summary = (
    pred_df.groupby(["medicine_name", "medicine_category"])["predicted_quantity"]
    .sum()
    .reset_index()
    .rename(columns={"predicted_quantity": "total_predicted_demand"})
    .sort_values("total_predicted_demand", ascending=False)
)

total_all = summary["total_predicted_demand"].sum()
summary["percentage_of_total_demand"] = (
    summary["total_predicted_demand"] / total_all * 100
).round(2)

print("=" * 70)
print("A) PREDICTED DEMAND SUMMARY (bilang, uri, percentage)")
print("=" * 70)
print(summary.to_string(index=False))
summary.to_csv("outputs/A_predicted_demand_summary.csv", index=False)

# ============================================================
# 5. WAREHOUSE STOCK -- PALITAN MO ITO NG TOTOONG DATA MO
#    (pwede ring i-load galing sa CSV: pd.read_csv("warehouse_stock.csv"))
# ============================================================
CURRENT_STOCK = {
    # medicine_name: current_stock_in_units
    "Paracetamol 500mg": 520,
    "Biogesic": 300,
    "Amoxicillin 500mg": 410,
    "Cefalexin": 180,
    "Cetirizine": 250,
    "Salbutamol Nebule": 90,
    "Multivitamins": 600,
    "Ferrous Sulfate": 340,
    "ORS (Oral Rehydration Salts)": 150,
    "Mefenamic Acid": 275,
    "Loperamide": 60,
    "Metformin 500mg": 200,
}

SAFETY_STOCK_PERCENT = 0.10  # 10% reserve, PALITAN base sa policy niyo

# ============================================================
# 6. BARANGAY LIST -- PALITAN MO NG TOTOONG LISTAHAN
# ============================================================
BARANGAY_LIST = sorted(pred_df["barangay_id"].unique().tolist())
num_barangays = len(BARANGAY_LIST)

# ============================================================
# 7. COMPUTE: AVAILABLE STOCK FOR DISTRIBUTION -- sagot sa "B"
# ============================================================
stock_rows = []
for med, stock in CURRENT_STOCK.items():
    safety_reserve = round(stock * SAFETY_STOCK_PERCENT)
    available = stock - safety_reserve

    predicted_row = summary[summary["medicine_name"] == med]
    predicted_demand = int(predicted_row["total_predicted_demand"].values[0]) if len(predicted_row) else 0

    stock_rows.append({
        "medicine_name": med,
        "current_stock": stock,
        "safety_reserve": safety_reserve,
        "available_for_distribution": available,
        "predicted_total_demand": predicted_demand,
        "stock_status": "⚠️ SHORTAGE (below predicted demand)" if available < predicted_demand else "✅ SUFFICIENT"
    })

stock_df = pd.DataFrame(stock_rows).sort_values("available_for_distribution", ascending=False)

print("\n" + "=" * 70)
print("B) AVAILABLE STOCK FOR DISTRIBUTION (after safety reserve)")
print("=" * 70)
print(stock_df.to_string(index=False))
stock_df.to_csv("outputs/B_available_stock.csv", index=False)

# ============================================================
# 8. COMPUTE: EQUAL DISTRIBUTION PER BARANGAY -- sagot sa "C"
#    FLOOR(available / num_barangays) + leftover handling
# ============================================================
dist_rows = []
leftover_log = []

for _, r in stock_df.iterrows():
    med = r["medicine_name"]
    available = r["available_for_distribution"]

    per_barangay = available // num_barangays   # FLOOR division -> pantay-pantay
    leftover = available % num_barangays

    dist_rows.append({
        "medicine_name": med,
        "available_for_distribution": available,
        "number_of_barangays": num_barangays,
        "units_per_barangay": int(per_barangay),
        "leftover_units": int(leftover),
    })

    if leftover > 0:
        # Leftover ay ibibigay sa mga barangay na may PINAKAMATAAS na
        # predicted demand para sa gamot na ito (priority-based)
        med_demand = pred_df[pred_df["medicine_name"] == med].sort_values(
            "predicted_quantity", ascending=False
        )
        priority_barangays = med_demand.head(int(leftover))["barangay_id"].tolist()
        for b in priority_barangays:
            leftover_log.append({"medicine_name": med, "extra_unit_given_to": b})

dist_df = pd.DataFrame(dist_rows)
leftover_df = pd.DataFrame(leftover_log) if leftover_log else pd.DataFrame(
    columns=["medicine_name", "extra_unit_given_to"]
)

print("\n" + "=" * 70)
print(f"C) EQUAL DISTRIBUTION PER BARANGAY  ({num_barangays} barangays)")
print("=" * 70)
print(dist_df.to_string(index=False))
dist_df.to_csv("outputs/C_equal_distribution_per_barangay.csv", index=False)

print("\n--- Leftover units (ibinigay sa barangay na may pinakamataas na demand) ---")
print(leftover_df.to_string(index=False) if len(leftover_df) else "Walang leftover units.")
leftover_df.to_csv("outputs/C2_leftover_allocation.csv", index=False)

# ============================================================
# 9. FULL PER-BARANGAY BREAKDOWN TABLE (final master table)
# ============================================================
final_rows = []
for _, r in dist_df.iterrows():
    med = r["medicine_name"]
    base_qty = r["units_per_barangay"]
    extras = set(leftover_df[leftover_df["medicine_name"] == med]["extra_unit_given_to"])
    for b in BARANGAY_LIST:
        qty = base_qty + (1 if b in extras else 0)
        final_rows.append({"barangay_id": b, "medicine_name": med, "quantity_to_receive": qty})

final_df = pd.DataFrame(final_rows)
final_df.to_csv("outputs/D_final_distribution_master_table.csv", index=False)

print("\n✅ Lahat ng output ay na-save sa /outputs folder:")
print("   - A_predicted_demand_summary.csv")
print("   - B_available_stock.csv")
print("   - C_equal_distribution_per_barangay.csv")
print("   - C2_leftover_allocation.csv")
print("   - D_final_distribution_master_table.csv  (buong table, per barangay per medicine)")