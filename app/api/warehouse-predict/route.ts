// ILAGAY ITO SA: whimsrhu/app/api/warehouse-predict/route.ts
//
// Ito ang route na tatawagin ng warehouse dashboard mo (app/warehouse/...)
// para makakuha ng prediction + distribution data mula sa Python ML service.

import { NextRequest, NextResponse } from "next/server";

// URL ng Python FastAPI service (tumatakbo sa ibang terminal/process)
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Expected body mula sa frontend (dapat tumugma sa PredictRequest
    // sa warehouse_ml/api_server.py -- lahat ng field ay optional):
    // {
    //   "current_stock": { "Paracetamol 500mg": 520, "Biogesic": 300, ... },
    //   "number_of_barangays": 96,
    //   "safety_buffer_percent": 0.15,
    //   "forecast_days_ahead": 30
    // }

    const response = await fetch(`${ML_SERVICE_URL}/predict-distribution`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorDetail = await response.text();
      return NextResponse.json(
        { error: "Nabigo ang ML service.", detail: errorDetail },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error calling ML service:", error);
    return NextResponse.json(
      { error: "Hindi ma-reach ang ML service. Tiyaking tumatakbo ito (uvicorn api_server:app)." },
      { status: 500 }
    );
  }
}