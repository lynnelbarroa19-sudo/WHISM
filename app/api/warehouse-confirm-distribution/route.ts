// ILAGAY ITO SA: whimsrhu/app/api/warehouse-confirm-distribution/route.ts

import { NextResponse } from 'next/server'

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000'

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Hindi valid ang request body.' }, { status: 400 })
  }

  let res: Response
  try {
    res = await fetch(`${ML_SERVICE_URL}/confirm-distribution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // 20s timeout -- kung mag-re-restart ang uvicorn (hal. dahil sa
      // --reload na na-trigger ng file write), makikita agad ito bilang
      // malinaw na timeout sa halip na basta "unreachable" na parang
      // laging ganito ang mangyayari.
      signal: AbortSignal.timeout(20000),
    })
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError'
    console.error('warehouse-confirm-distribution: hindi ma-reach ang ML service:', err)
    return NextResponse.json(
      {
        error: isTimeout
          ? `Nag-timeout ang koneksyon sa ML service pagkatapos ng 20s. Posibleng ` +
            `nag-restart ang uvicorn (hal. --reload na na-trigger ng file write sa ` +
            `models/ o data/) habang tumatakbo ang request.`
          : `Hindi ma-reach ang ML service sa ${ML_SERVICE_URL}. I-check kung tumatakbo ` +
            `ang uvicorn -- subukan ang "Invoke-RestMethod http://localhost:8000/health" sa PowerShell.`,
      },
      { status: 502 }
    )
  }

  const rawText = await res.text()
  let json: any = null
  try {
    json = rawText ? JSON.parse(rawText) : null
  } catch {
    console.error(
      'warehouse-confirm-distribution: non-JSON response mula sa ML service (status %d): %s',
      res.status,
      rawText.slice(0, 500)
    )
    return NextResponse.json(
      { error: `Hindi JSON ang sagot ng ML service (status ${res.status}). Tignan ang uvicorn logs.` },
      { status: 502 }
    )
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: 'Hindi na-save ang distribution plan.', detail: json?.detail ?? json },
      { status: res.status }
    )
  }

  return NextResponse.json(json)
}