"""
1_generate_sample_data.py  (v4 - PHARMACY REQUEST EVENTS)
---------------------------------------------------------------
TAMANG KAHULUGAN:
  Ang PHARMACY (nasa RHU, IISA lang) ay hindi araw-araw humihingi ng
  bagong stock sa WAREHOUSE -- humihingi/nag-re-REQUEST lang sila
  PAMINSAN-MINSAN (kapag paubos na ang stock nila), tuwing ilang
  araw o linggo, depende sa bilis ng ubos ng bawat gamot.

  Ito ang tinatawag na "PHARMACY REQUEST" sa warehouse -- ITO ang
  dapat i-predict: KAILAN at ILAN ang malamang susunod na i-REQUEST
  ng pharmacy sa warehouse.

PALITAN MO NA LANG ITO ng totoong REQUEST LOG ng pharmacy papunta sa
warehouse (hindi patient dispensing log -- ang totoong "request"
records, e.g. requisition slips/forms na pinapasa ng pharmacy sa
warehouse).

REQUIRED COLUMNS ng totoong data mo:
- request_date        (YYYY-MM-DD, petsa ng pag-request ng pharmacy)
- medicine_name
- medicine_category
- quantity_requested   (bilang na hiningi ng pharmacy sa warehouse)
"""

import pandas as pd
import numpy as np

np.random.seed(42)

# ---- PALITAN mo ng totoong listahan ng gamot ----
medicines = [
    ("Paracetamol 500mg", "Pain Reliever"),
    ("Biogesic", "Pain Reliever"),
    ("Amoxicillin 500mg", "Antibiotic"),
    ("Cefalexin", "Antibiotic"),
    ("Cetirizine", "Antihistamine"),
    ("Salbutamol Nebule", "Respiratory"),
    ("Multivitamins", "Vitamins"),
    ("Ferrous Sulfate", "Vitamins"),
    ("ORS (Oral Rehydration Salts)", "Rehydration"),
    ("Mefenamic Acid", "Pain Reliever"),
    ("Loperamide", "Antidiarrheal"),
    ("Metformin 500mg", "Maintenance"),
]

start_date = pd.Timestamp.today().normalize() - pd.DateOffset(years=5)
end_date = pd.Timestamp.today().normalize()
all_days = pd.date_range(start_date, end_date, freq="D")

def get_season(month_num):
    return "Wet" if month_num in [6,7,8,9,10,11] else "Dry"

rows = []

for med_name, med_cat in medicines:
    # Bawat gamot may sariling "consumption rate" -- ilang araw bago
    # muling mag-request ang pharmacy nito (depende sa bilis ng ubos)
    avg_interval_days = np.random.randint(7, 21)      # tuwing 1-3 linggo humihingi
    base_qty_per_request = np.random.uniform(40, 150)  # dami bawat request

    current_idx = np.random.randint(0, avg_interval_days)

    while current_idx < len(all_days):
        req_date = all_days[current_idx]
        month_num = req_date.month
        season = get_season(month_num)

        qty = np.random.poisson(lam=base_qty_per_request)

        # seasonality: mas madalas at mas malaki ang request ng
        # respiratory/antihistamine tuwing Wet season
        if med_cat in ["Respiratory", "Antihistamine"] and season == "Wet":
            qty += np.random.poisson(lam=25)
        if med_cat in ["Antidiarrheal", "Rehydration"] and month_num in [3,4,5]:
            qty += np.random.poisson(lam=15)

        qty = max(1, int(qty))

        rows.append({
            "request_date": req_date.strftime("%Y-%m-%d"),
            "year": req_date.year,
            "month": month_num,
            "day_of_week": req_date.dayofweek,
            "day_of_month": req_date.day,
            "week_of_year": int(req_date.isocalendar().week),
            "season": season,
            "medicine_name": med_name,
            "medicine_category": med_cat,
            "quantity_requested": qty,
            "days_since_last_request": avg_interval_days,  # gaano katagal bago ulit humingi
        })

        step = max(3, avg_interval_days + np.random.randint(-3, 4))
        current_idx += step

df = pd.DataFrame(rows)
df.to_csv("data/pharmacy_requests_history.csv", index=False)
print(f"Nagawa ang sample dataset: {len(df)} pharmacy REQUEST records, {df['medicine_name'].nunique()} medicines")
print(f"Date range: {df['request_date'].min()} hanggang {df['request_date'].max()}")
print(df.head(10))