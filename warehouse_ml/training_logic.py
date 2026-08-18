"""
training_logic.py
--------------------
Ang ACTUAL na training logic, nilagay sa SARILING module (function) para
magamit natin ito sa DALAWANG paraan:

  1. Manual: python 2_train_model_supabase.py (para sa unang training,
     o kung gusto mong subukan/i-check ang output nang direkta sa
     terminal)

  2. Automatic: POST /retrain sa api_server.py (tinatawag ito ng
     Supabase Database Webhook tuwing may request na naging 'received')

Parehong paraan, PAREHONG code ang ginagamit -- walang duplicate logic.
"""

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, accuracy_score
import joblib
import os


def train_from_supabase(supabase_client, models_dir: str, data_dir: str) -> dict:
    """
    Kinukuha ang pharmacy_requests mula sa Supabase, nagtetrain ng
    quantity + category models, at ino-overwrite ang .pkl files sa
    models_dir. Nagreturn ng summary dict (para sa logging/response).
    """
    os.makedirs(models_dir, exist_ok=True)
    os.makedirs(data_dir, exist_ok=True)

    # ---------- 1. KUNIN ANG DATA (may pagination, kung marami na) ----------
    all_rows = []
    page_size = 1000
    offset = 0
    while True:
        resp = (
            supabase_client.table("pharmacy_requests")
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
        raise ValueError("Walang laman ang pharmacy_requests table (o lahat 'rejected').")

    df["requested_at"] = pd.to_datetime(df["requested_at"]).dt.tz_localize(None)
    df = df.sort_values(["medicine_name", "requested_at"]).reset_index(drop=True)

    df["year"] = df["requested_at"].dt.year
    df["month"] = df["requested_at"].dt.month
    df["day_of_week"] = df["requested_at"].dt.dayofweek
    df["day_of_month"] = df["requested_at"].dt.day
    df["week_of_year"] = df["requested_at"].dt.isocalendar().week.astype(int)
    df["season"] = df["month"].apply(lambda m: "Wet" if m in [6,7,8,9,10,11] else "Dry")
    df["days_since_last_request"] = df.groupby("medicine_name")["requested_at"].diff().dt.days
    df["days_since_last_request"] = df["days_since_last_request"].fillna(14)
    df["quantity_requested"] = df["requested_qty"]

    # ---------- 2. FEATURE ENGINEERING ----------
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
    df["category_enc"] = le_cat.fit_transform(df["category"])
    df["season_enc"] = le_season.fit_transform(df["season"])

    feature_cols = [
        "day_of_week", "day_of_month", "week_of_year", "month", "season_enc",
        "medicine_enc", "rolling_avg_recent", "same_month_last_year", "days_since_last_request"
    ]
    X = df[feature_cols]

    # ---------- 3. TRAIN MODELS ----------
    y_qty = df["quantity_requested"]
    if len(df) >= 20:
        X_train, X_test, y_train, y_test = train_test_split(X, y_qty, test_size=0.2, random_state=42)
    else:
        X_train, y_train, X_test, y_test = X, y_qty, X, y_qty

    qty_model = RandomForestRegressor(n_estimators=300, max_depth=14, min_samples_leaf=2, random_state=42, n_jobs=-1)
    qty_model.fit(X_train, y_train)
    mae = mean_absolute_error(y_test, qty_model.predict(X_test))

    y_cat = df["category_enc"]
    if len(df) >= 20:
        Xc_train, Xc_test, yc_train, yc_test = train_test_split(X, y_cat, test_size=0.2, random_state=42)
    else:
        Xc_train, yc_train, Xc_test, yc_test = X, y_cat, X, y_cat

    cat_model = RandomForestClassifier(n_estimators=300, max_depth=12, min_samples_leaf=2, random_state=42, n_jobs=-1)
    cat_model.fit(Xc_train, yc_train)
    acc = accuracy_score(yc_test, cat_model.predict(Xc_test))

    # ---------- 4. SAVE ----------
    joblib.dump(qty_model, os.path.join(models_dir, "quantity_model.pkl"))
    joblib.dump(cat_model, os.path.join(models_dir, "category_model.pkl"))
    joblib.dump(le_med, os.path.join(models_dir, "le_medicine.pkl"))
    joblib.dump(le_cat, os.path.join(models_dir, "le_category.pkl"))
    joblib.dump(le_season, os.path.join(models_dir, "le_season.pkl"))

    latest_features = (
        df.sort_values("requested_at")
          .groupby("medicine_name")
          .tail(1)[["medicine_name", "category", "rolling_avg_recent",
                     "same_month_last_year", "days_since_last_request"]]
          .rename(columns={"category": "medicine_category"})
    )
    latest_features.to_csv(os.path.join(data_dir, "latest_features.csv"), index=False)

    return {
        "rows_used": len(df),
        "unique_medicines": int(df["medicine_name"].nunique()),
        "quantity_mae": round(float(mae), 2),
        "category_accuracy_pct": round(float(acc) * 100, 2),
    }