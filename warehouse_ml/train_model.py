"""
2_train_model_supabase.py  (v5 - TOTOONG SCHEMA)
-----------------------------------------------------
Kumukuha ng TOTOONG historical requests mula sa 'pharmacy_requests'
table (totoong schema ng WHIMS RHU niyo).

SETUP MUNA:
    pip install supabase python-dotenv --break-system-packages

.env file sa loob ng warehouse_ml folder:
    SUPABASE_URL=https://xxxxx.supabase.co
    SUPABASE_KEY=your-service-role-or-anon-key

PAALALA TUNGKOL SA DATA MO:
- Ginagamit natin ang 'requested_qty' bilang target (ito ang
  "hihingin ng pharmacy" na gusto nating i-predict).
- Ang 'category' sa pharmacy_requests ay 'drugs'/'supplies' lang
  (general). Kung gusto mo ng mas detalyadong category (Antibiotic,
  Vitamins, atbp.) kailangan sanang naka-link ang medicine_id sa
  pharmacy_requests -- pero wala pa ito ngayon, kaya ginamit na lang
  natin ang 'category' column na mayroon.
- Hindi natin isinali ang mga request na 'rejected' (hindi totoong
  demand signal ang mga ito).
"""

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, accuracy_score
import joblib
import os
from dotenv import load_dotenv
from supabase import create_client

# ============================================================
# 1. KUMONEKTA SA SUPABASE
# ============================================================
load_dotenv()
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ============================================================
# 2. KUNIN ANG PHARMACY REQUESTS (i-exclude ang 'rejected')
# ============================================================
print("Kumukuha ng data mula sa Supabase (pharmacy_requests)...")

all_rows = []
page_size = 1000
offset = 0
while True:
    resp = (
        supabase.table("pharmacy_requests")
        .select("medicine_name, requested_qty, unit, status, category, requested_at, fulfilled_qty")
        .neq("status", "rejected")
        .range(offset, offset + page_size - 1)
        .execute()
    )
    if not resp.data:
        break
    all_rows.extend(resp.data)
    if len(resp.data) < page_size:
        break
    offset += page_size

df = pd.DataFrame(all_rows)

if df.empty:
    raise ValueError("Walang laman ang pharmacy_requests table (o lahat 'rejected'). "
                      "I-check ang totoong records sa Supabase.")

df["requested_at"] = pd.to_datetime(df["requested_at"]).dt.tz_localize(None)
df = df.sort_values(["medicine_name", "requested_at"]).reset_index(drop=True)

# I-derive ang date-based features
df["year"] = df["requested_at"].dt.year
df["month"] = df["requested_at"].dt.month
df["day_of_week"] = df["requested_at"].dt.dayofweek
df["day_of_month"] = df["requested_at"].dt.day
df["week_of_year"] = df["requested_at"].dt.isocalendar().week.astype(int)
df["season"] = df["month"].apply(lambda m: "Wet" if m in [6,7,8,9,10,11] else "Dry")

# I-compute ang "days_since_last_request" per medicine
df["days_since_last_request"] = (
    df.groupby("medicine_name")["requested_at"].diff().dt.days
)
df["days_since_last_request"] = df["days_since_last_request"].fillna(14)

# Target: requested_qty (ang hihingin ng pharmacy)
df["quantity_requested"] = df["requested_qty"]

print(f"Nakuha: {len(df)} pharmacy requests mula sa Supabase, "
      f"{df['medicine_name'].nunique()} unique na gamot")

# I-warn kung sobrang kaunti ang data para sa magandang training
if len(df) < 100:
    print("⚠️  BABALA: Kaunti pa lang ang records mo (<100). Maaaring hindi pa "
          "sapat ang accuracy ng model. Titingnan pa rin natin, pero mag-ingat "
          "sa paggamit ng predictions habang tumatambak pa ang totoong data niyo.")

# ============================================================
# 3. FEATURE ENGINEERING
# ============================================================
df["rolling_avg_recent"] = (
    df.groupby("medicine_name")["quantity_requested"]
      .transform(lambda x: x.shift(1).rolling(window=3, min_periods=1).mean())
)
df["rolling_avg_recent"] = df["rolling_avg_recent"].fillna(df["quantity_requested"].mean())

prev_year = df[["medicine_name", "year", "month", "quantity_requested"]].copy()
prev_year["year"] = prev_year["year"] + 1
prev_year = prev_year.groupby(["medicine_name", "year", "month"])["quantity_requested"].mean().reset_index()
prev_year = prev_year.rename(columns={"quantity_requested": "same_month_last_year"})
df = df.merge(prev_year, on=["medicine_name", "year", "month"], how="left")
df["same_month_last_year"] = df["same_month_last_year"].fillna(df["rolling_avg_recent"])

le_med = LabelEncoder()
le_cat = LabelEncoder()
le_season = LabelEncoder()
df["medicine_enc"] = le_med.fit_transform(df["medicine_name"])
df["category_enc"] = le_cat.fit_transform(df["category"])   # 'drugs' / 'supplies'
df["season_enc"] = le_season.fit_transform(df["season"])

feature_cols = [
    "day_of_week", "day_of_month", "week_of_year", "month", "season_enc",
    "medicine_enc", "rolling_avg_recent", "same_month_last_year", "days_since_last_request"
]
X = df[feature_cols]

# ============================================================
# 4. TRAIN MODELS
# ============================================================
y_qty = df["quantity_requested"]

# Kung sobrang kaunti pa ang data, i-skip ang train/test split (gamitin
# lahat para sa training) -- pero babalaan pa rin
if len(df) >= 20:
    X_train, X_test, y_train, y_test = train_test_split(X, y_qty, test_size=0.2, random_state=42)
else:
    X_train, y_train = X, y_qty
    X_test, y_test = X, y_qty

qty_model = RandomForestRegressor(n_estimators=300, max_depth=14, min_samples_leaf=2, random_state=42, n_jobs=-1)
qty_model.fit(X_train, y_train)
mae = mean_absolute_error(y_test, qty_model.predict(X_test))
print(f"\n[QUANTITY MODEL] Mean Absolute Error: {mae:.2f} units per request")

importance = pd.Series(qty_model.feature_importances_, index=feature_cols).sort_values(ascending=False)
print("\n[QUANTITY MODEL] Feature Importance:")
print(importance)

y_cat = df["category_enc"]
if len(df) >= 20:
    Xc_train, Xc_test, yc_train, yc_test = train_test_split(X, y_cat, test_size=0.2, random_state=42)
else:
    Xc_train, yc_train = X, y_cat
    Xc_test, yc_test = X, y_cat

cat_model = RandomForestClassifier(n_estimators=300, max_depth=12, min_samples_leaf=2, random_state=42, n_jobs=-1)
cat_model.fit(Xc_train, yc_train)
acc = accuracy_score(yc_test, cat_model.predict(Xc_test))
print(f"\n[CATEGORY MODEL] Accuracy: {acc*100:.2f}%")

# ============================================================
# 5. SAVE MODELS + REFERENCE TABLES
# ============================================================
os.makedirs("models", exist_ok=True)
os.makedirs("data", exist_ok=True)

joblib.dump(qty_model, "models/quantity_model.pkl")
joblib.dump(cat_model, "models/category_model.pkl")
joblib.dump(le_med, "models/le_medicine.pkl")
joblib.dump(le_cat, "models/le_category.pkl")
joblib.dump(le_season, "models/le_season.pkl")

latest_features = (
    df.sort_values("requested_at")
      .groupby("medicine_name")
      .tail(1)[["medicine_name", "category", "rolling_avg_recent",
                 "same_month_last_year", "days_since_last_request"]]
      .rename(columns={"category": "medicine_category"})
)
latest_features.to_csv("data/latest_features.csv", index=False)

print("\n✅ Models saved sa /models folder.")
print("✅ Reference table saved sa /data/latest_features.csv")
print("✅ Trained gamit ang TOTOONG pharmacy_requests data mula sa Supabase!")