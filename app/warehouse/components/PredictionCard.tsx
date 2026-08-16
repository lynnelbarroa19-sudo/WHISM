'use client'
import { useState, useEffect, useMemo } from 'react'

// ---- Response shapes returned by /api/warehouse-predict (proxies to
// warehouse_ml/api_server.py's POST /predict-distribution) ----
interface DemandSummaryRow {
  medicine_name: string
  medicine_category: string
  total_predicted_pharmacy_request: number
  percentage_of_total_predicted_requests: number
}

interface ReserveSummaryRow {
  medicine_name: string
  current_stock_sa_warehouse: number
  pending_committed_requests: number
  predicted_future_pharmacy_request: number
  reserve_for_pharmacy_buffered_15pct: number
  percentage_ilalaan_para_sa_pharmacy_buffered_15pct: number
  available_for_96_barangays_buffered: number
  percentage_available_for_barangays_buffered: number
  stock_status: string
}

interface PredictResponse {
  forecast_period_days: number
  number_of_barangays: number
  safety_buffer_percent_used: number
  pharmacy_demand_summary: DemandSummaryRow[]
  stock_and_reserve_summary: ReserveSummaryRow[]
}

type ViewTab = 'demand' | 'reserve'
const TOP_N = 5

export default function PredictionCard() {
  const [data, setData] = useState<PredictResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastComputed, setLastComputed] = useState<Date | null>(null)
  const [tab, setTab] = useState<ViewTab>('demand')

  useEffect(() => {
    fetchPrediction()
  }, [])

  const fetchPrediction = async () => {
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/warehouse-predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json()

      if (!res.ok) {
        // `detail` is the raw FastAPI error body (often `{"detail": "..."}`
        // as text) — surface the underlying reason instead of just the
        // generic proxy message, so failures are diagnosable from the UI.
        let reason = ''
        if (typeof json.detail === 'string') {
          try {
            reason = JSON.parse(json.detail)?.detail || json.detail
          } catch {
            reason = json.detail
          }
        }
        setError([json.error, reason].filter(Boolean).join(' — ') || 'Could not load the demand forecast.')
        setData(null)
        setLoading(false)
        return
      }

      setData(json)
      setLastComputed(new Date())
    } catch (err) {
      console.error('PredictionCard fetch error:', err)
      setError('Could not reach the prediction service.')
      setData(null)
    }

    setLoading(false)
  }

  const topDemand = useMemo(
    () => (data?.pharmacy_demand_summary || []).slice(0, TOP_N),
    [data]
  )

  const reserveRows = useMemo(() => {
    const rows = data?.stock_and_reserve_summary || []
    // Shortages surfaced first — that's the actionable part of this view.
    return [...rows]
      .sort((a, b) => {
        const aShort = a.stock_status.includes('SHORTAGE') ? 0 : 1
        const bShort = b.stock_status.includes('SHORTAGE') ? 0 : 1
        return aShort - bShort || b.percentage_ilalaan_para_sa_pharmacy_buffered_15pct - a.percentage_ilalaan_para_sa_pharmacy_buffered_15pct
      })
      .slice(0, TOP_N)
  }, [data])

  const shortageCount = useMemo(
    () => (data?.stock_and_reserve_summary || []).filter(r => r.stock_status.includes('SHORTAGE')).length,
    [data]
  )

  const maxDemandQty = Math.max(1, ...topDemand.map(d => d.total_predicted_pharmacy_request))

  if (loading) {
    return (
      <div style={{ ...cardStyle, height: '100%' }}>
        <div style={headerStyle}>
          <span style={headerTitleStyle}>🔮 DEMAND FORECAST</span>
        </div>
        <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
          Loading forecast...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ ...cardStyle, height: '100%' }}>
        <div style={headerStyle}>
          <span style={headerTitleStyle}>🔮 DEMAND FORECAST</span>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: '#fee2e2', color: '#dc2626', padding: '10px 12px', borderRadius: 8, fontSize: 12 }}>
            <span>⚠ {error}</span>
            <button
              onClick={fetchPrediction}
              style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
            >
              Retry
            </button>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text3)' }}>
            Make sure the ML service is running (<code>uvicorn api_server:app --port 8000</code> inside <code>warehouse_ml/</code>).
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ ...cardStyle, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ ...headerStyle, flexShrink: 0 }}>
        <span style={headerTitleStyle}>🔮 DEMAND FORECAST</span>
        <span style={headerMetaStyle}>
          Next {data?.forecast_period_days ?? 30} Days · +{Math.round((data?.safety_buffer_percent_used ?? 0.15) * 100)}% Safety Buffer
        </span>
      </div>

      <div style={{ padding: '14px 16px 16px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12, flexShrink: 0 }}>
          {tab === 'demand' ? 'Predicted Pharmacy Demand' : 'Stock Reserve Status'}
          {tab === 'reserve' && shortageCount > 0 && (
            <span style={{ fontWeight: 400, color: '#dc2626' }}> · {shortageCount} shortage{shortageCount !== 1 ? 's' : ''}</span>
          )}
        </div>

        {tab === 'demand' ? (
          topDemand.length === 0 ? (
            <div style={{ ...emptyStyle, flex: 1 }}>No demand forecast available yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, overflowY: 'auto' }}>
              {topDemand.map(row => {
                const barPct = Math.max(6, Math.round((row.total_predicted_pharmacy_request / maxDemandQty) * 100))
                return (
                  <div key={row.medicine_name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.medicine_name}
                        </span>
                        <span style={{ fontSize: 10.5, color: 'var(--text3)', flexShrink: 0 }}>{row.medicine_category}</span>
                      </div>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#16a34a', flexShrink: 0, marginLeft: 8 }}>
                        {row.total_predicted_pharmacy_request} units
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 8, borderRadius: 999, background: '#dcfce7', overflow: 'hidden' }}>
                        <div style={{ width: `${barPct}%`, height: '100%', borderRadius: 999, background: 'linear-gradient(90deg,#16a34a,#22c55e)', transition: 'width .3s ease' }} />
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0, minWidth: 70, textAlign: 'right' }}>
                        {row.percentage_of_total_predicted_requests}% of total
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        ) : reserveRows.length === 0 ? (
          <div style={{ ...emptyStyle, flex: 1 }}>No reserve data available yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {/* Legend — one fixed pair of colors for every row's split, so it
                only needs to be stated once, not repeated per row. */}
            <div style={{ display: 'flex', gap: 14, marginBottom: 10, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text2)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: '#2563eb', flexShrink: 0 }} />
                Reserved for pharmacy
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text2)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: '#16a34a', flexShrink: 0 }} />
                Available for barangays
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, overflowY: 'auto' }}>
              {reserveRows.map(row => {
                const isShort = row.stock_status.includes('SHORTAGE')
                const reserveVal = row.reserve_for_pharmacy_buffered_15pct
                const availVal = row.available_for_96_barangays_buffered
                const segTotal = Math.max(1, reserveVal + availVal)
                const reservePct = (reserveVal / segTotal) * 100
                const availPct = 100 - reservePct
                return (
                  <div
                    key={row.medicine_name}
                    style={{
                      padding: '8px 10px', borderRadius: 8,
                      background: isShort ? '#fee2e2' : 'var(--surface2)',
                      border: `1px solid ${isShort ? 'rgba(220,38,38,0.25)' : 'var(--border)'}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                        {row.medicine_name}
                      </div>
                      <span
                        style={{
                          fontSize: 10, fontWeight: 700, flexShrink: 0, padding: '3px 8px', borderRadius: 999,
                          color: isShort ? '#dc2626' : '#16a34a',
                          background: isShort ? '#fecaca' : '#dcfce7',
                        }}
                      >
                        {isShort ? 'SHORTAGE' : 'SUFFICIENT'}
                      </span>
                    </div>

                    {/* Composition bar: current stock split into pharmacy
                        reserve vs. what's left for barangays. The flex `gap`
                        on a surface-colored, overflow-hidden track is the
                        2px separator between the two segments. */}
                    <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2, background: 'var(--surface2)' }}>
                      <div style={{ width: `${reservePct}%`, background: '#2563eb', borderRadius: availPct > 0.5 ? '5px 0 0 5px' : 5 }} />
                      <div style={{ width: `${availPct}%`, background: '#16a34a', borderRadius: reservePct > 0.5 ? '0 5px 5px 0' : 5 }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 9.5, color: 'var(--text3)' }}>
                      <span>Stock {row.current_stock_sa_warehouse} · Reserve {reserveVal} ({row.percentage_ilalaan_para_sa_pharmacy_buffered_15pct}%)</span>
                      <span>Avail {availVal} ({row.percentage_available_for_barangays_buffered}%)</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 16, flexShrink: 0 }}>
          <TabPill label="Demand" active={tab === 'demand'} onClick={() => setTab('demand')} />
          <TabPill label="Reserve" active={tab === 'reserve'} onClick={() => setTab('reserve')} />
        </div>

        {lastComputed && (
          <div style={{ marginTop: 14, fontSize: 10, color: 'var(--text3)', textAlign: 'right', flexShrink: 0 }}>
            Computed {lastComputed.toLocaleTimeString()}
            <button
              onClick={fetchPrediction}
              style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--green, #16a34a)', fontWeight: 700, cursor: 'pointer', fontSize: 10, padding: 0 }}
            >
              Refresh
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function TabPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 12px',
        borderRadius: 999,
        border: '1.5px solid #0f172a',
        background: active ? '#0f172a' : '#fff',
        color: active ? '#fff' : '#0f172a',
        fontSize: 10.5,
        fontWeight: 700,
        cursor: 'pointer',
        opacity: active ? 1 : 0.55,
        transition: 'all .15s ease',
      }}
    >
      {label}
    </button>
  )
}

// ---- Shared inline styles (mirrors MedicineMovementAnalytics) ----
const cardStyle: React.CSSProperties = {
  background: 'var(--surface, #fff)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  overflow: 'hidden',
}
const headerStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg,#0f5132,#16a34a)',
  padding: '13px 16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  rowGap: 4,
}
const headerTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  color: '#fff',
  letterSpacing: '.03em',
}
const headerMetaStyle: React.CSSProperties = {
  fontSize: 10.5,
  color: 'rgba(255,255,255,.85)',
  fontWeight: 600,
}
const emptyStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
  padding: '8px 0',
}
