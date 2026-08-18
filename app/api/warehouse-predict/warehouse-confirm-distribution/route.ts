// app/api/warehouse-confirm-distribution/route.ts
//
// PAALALA: template lang ito, kopya ng pattern na ginagamit (malamang)
// ng existing mong `app/api/warehouse-predict/route.ts`. Kung ibang env
// var name o error-shape ang ginagamit doon (hal. WAREHOUSE_ML_URL vs
// ML_SERVICE_URL), itugma na lang dito -- ang mahalaga ay parehong
// proxy pattern papunta sa parehong FastAPI service.

import { NextResponse } from 'next/server'

const ML_SERVICE_URL = process.env.WAREHOUSE_ML_URL || 'http://127.0.0.1:8000'

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const res = await fetch(`${ML_SERVICE_URL}/confirm-distribution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const json = await res.json()

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Hindi na-save ang distribution plan.', detail: json.detail ?? json },
        { status: res.status }
      )
    }

    return NextResponse.json(json)
  } catch (err) {
    console.error('warehouse-confirm-distribution proxy error:', err)
    return NextResponse.json(
      { error: 'Hindi ma-reach ang ML service.' },
      { status: 502 }
    )
  }
}