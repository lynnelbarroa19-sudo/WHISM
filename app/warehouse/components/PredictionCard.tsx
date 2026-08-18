'use client'
import { useState, useEffect, useMemo } from 'react'
import styles from './warehouse.module.css'

// ---- Response shapes returned by /api/warehouse-predict (proxies to
// warehouse_ml/api_server.py's POST /predict-distribution) ----
interface DemandSummaryRow {
  medicine_name: string
  medicine_category: string
  total_predicted_pharmacy_request: number
  percentage_of_total_predicted_requests: number
  unit: string
}

interface ReserveSummaryRow {
  medicine_name: string
  unit: string
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

const TOP_N = 5
type ViewMode = 'demand' | 'reserve'

export default function PredictionCard() {
  const [data, setData] = useState<PredictResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastComputed, setLastComputed] = useState<Date | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [view, setView] = useState<ViewMode>('demand')

  useEffect(() => {
    fetchPrediction()
  }, [])

  const fetchPrediction = async () => {
    if (lastComputed) setRefreshing(true)
    else setLoading(true)
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
        setRefreshing(false)
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
    setRefreshing(false)
  }

  const allDemand = data?.pharmacy_demand_summary || []
  const allReserve = data?.stock_and_reserve_summary || []

  const topDemand = useMemo(() => allDemand.slice(0, TOP_N), [allDemand])

  const reserveRows = useMemo(() => {
    // Shortages surfaced first — that's the actionable part of this view.
    return [...allReserve]
      .sort((a, b) => {
        const aShort = a.stock_status.includes('SHORTAGE') ? 0 : 1
        const bShort = b.stock_status.includes('SHORTAGE') ? 0 : 1
        return aShort - bShort || b.percentage_ilalaan_para_sa_pharmacy_buffered_15pct - a.percentage_ilalaan_para_sa_pharmacy_buffered_15pct
      })
      .slice(0, TOP_N)
  }, [allReserve])

  const shortageCount = useMemo(
    () => allReserve.filter(r => r.stock_status.includes('SHORTAGE')).length,
    [allReserve]
  )

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of allDemand) {
      map.set(row.medicine_category, (map.get(row.medicine_category) || 0) + 1)
    }
    return Array.from(map.entries()).map(([category, count]) => ({ category, count }))
  }, [allDemand])

  const maxDemandQty = Math.max(1, ...topDemand.map(d => d.total_predicted_pharmacy_request))

  if (loading) {
    return (
      <div style={{ ...cardStyle, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ ...headerStyle, flexShrink: 0 }}>
          <span style={headerTitleStyle}>🔮 DEMAND FORECAST</span>
        </div>
        <div style={{ padding: '12px 16px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[100, 85, 70, 55].map((w, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className={styles.predSkeletonBar} style={{ height: 12, width: `${w}%` }} />
              <div className={styles.predSkeletonBar} style={{ height: 8, width: '100%' }} />
            </div>
          ))}
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

      <div style={{ padding: '12px 16px 14px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className={styles.predSummary}>
          {categoryBreakdown.length === 0 ? (
            <span className={styles.predSummaryItem}>No forecast data yet</span>
          ) : (
            categoryBreakdown.map(c => (
              <span key={c.category} className={styles.predSummaryItem}>
                {c.category === 'drugs' ? '💊' : '🧰'} {formatCategory(c.category)} <b>{c.count}</b>
              </span>
            ))
          )}
        </div>

        {/* Toggle -- Demand / Reserve. Pinapalitan yung dating dalawang
            column na magkatabi; iisang view na lang, mas compact ang card. */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setView('demand')}
            style={tabButtonStyle(view === 'demand')}
          >
            Demand
          </button>
          <button
            onClick={() => setView('reserve')}
            style={tabButtonStyle(view === 'reserve')}
          >
            Reserve
            {shortageCount > 0 && (
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 800,
                  borderRadius: 999,
                  minWidth: 16,
                  height: 16,
                  padding: '0 4px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: view === 'reserve' ? 'rgba(255,255,255,.9)' : '#dc2626',
                  color: view === 'reserve' ? '#dc2626' : '#fff',
                }}
              >
                {shortageCount}
              </span>
            )}
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {view === 'demand' ? (
            topDemand.length === 0 ? (
              <div style={emptyStyle}>No demand forecast yet.</div>
            ) : (
              <div className={styles.predList}>
                {topDemand.map((row, i) => {
                  const barPct = Math.max(6, Math.round((row.total_predicted_pharmacy_request / maxDemandQty) * 100))
                  return (
                    <div key={row.medicine_name} className={styles.predRow}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text3)', flexShrink: 0 }}>{i + 1}.</span>
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.medicine_name}
                          </span>
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#16a34a', flexShrink: 0 }}>
                          {row.total_predicted_pharmacy_request.toLocaleString()} {row.unit}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1, height: 6, borderRadius: 999, background: '#dcfce7', overflow: 'hidden' }}>
                          <div style={{ width: `${barPct}%`, height: '100%', borderRadius: 999, background: 'linear-gradient(90deg,#16a34a,#22c55e)', transition: 'width .3s ease' }} />
                        </div>
                        <span style={{ fontSize: 9.5, color: 'var(--text3)', flexShrink: 0 }}>
                          {row.percentage_of_total_predicted_requests}%
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          ) : reserveRows.length === 0 ? (
            <div style={emptyStyle}>No reserve data yet.</div>
          ) : (
            <div className={styles.predList}>
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
                      padding: '7px 9px', borderRadius: 8,
                      background: isShort ? '#fee2e2' : 'var(--surface2)',
                      border: `1px solid ${isShort ? 'rgba(220,38,38,0.25)' : 'var(--border)'}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                        {row.medicine_name}
                      </div>
                      <span
                        style={{
                          fontSize: 9, fontWeight: 700, flexShrink: 0, padding: '2px 6px', borderRadius: 999,
                          color: isShort ? '#dc2626' : '#16a34a',
                          background: isShort ? '#fecaca' : '#dcfce7',
                        }}
                      >
                        {isShort ? '⚠' : '✓'}
                      </span>
                    </div>

                    {/* Composition bar: current stock split into pharmacy
                        reserve vs. what's left for barangays. */}
                    <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2, background: 'var(--surface2)' }}>
                      <div style={{ width: `${reservePct}%`, background: '#2563eb', borderRadius: availPct > 0.5 ? '4px 0 0 4px' : 4 }} />
                      <div style={{ width: `${availPct}%`, background: '#16a34a', borderRadius: reservePct > 0.5 ? '0 4px 4px 0' : 4 }} />
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 3 }}>
                      Stock {row.current_stock_sa_warehouse} {row.unit} · Reserve {row.percentage_ilalaan_para_sa_pharmacy_buffered_15pct}%
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {lastComputed && (
          <div style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'right', flexShrink: 0, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
            Computed {lastComputed.toLocaleTimeString()}
            <button
              onClick={fetchPrediction}
              disabled={refreshing}
              style={{ marginLeft: 4, background: 'none', border: 'none', color: 'var(--green, #16a34a)', fontWeight: 700, cursor: refreshing ? 'default' : 'pointer', fontSize: 10, padding: 0, opacity: refreshing ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              {refreshing && <span className={styles.predSpin}>⟳</span>}
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// medicine_category comes through as lowercase ("drugs" / "supplies")
function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    fontSize: 12,
    fontWeight: 700,
    borderRadius: 8,
    padding: '7px 10px',
    border: '1px solid ' + (active ? 'transparent' : 'var(--border)'),
    background: active ? 'linear-gradient(135deg,#0f5132,#16a34a)' : 'var(--surface2)',
    color: active ? '#fff' : 'var(--text3)',
    cursor: 'pointer',
    transition: 'background .15s ease, color .15s ease',
  }
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
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
}