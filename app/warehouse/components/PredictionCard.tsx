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
  // >>> BAGO: conversion factors mula sa medicine_batches (representative
  // packaging -- tingnan ang fetch_medicine_packaging() sa api_server.py).
  // Pwedeng null kung walang box/strip breakdown ang gamot na ito. <<<
  pieces_per_box?: number | null
  pieces_per_strip?: number | null
}

interface TopMedicineEntry {
  medicine_name: string
  quantity: number
}

// >>> BAGO: shapes para sa weekly/monthly/seasonal forecast breakdown
// (galing sa bagong demand_by_week / demand_by_month / demand_by_season
// fields ng api_server.py).
interface WeeklyDemandRow {
  year: number
  week_of_year: number
  week_label: string
  total_predicted_quantity: number
  top_medicines: TopMedicineEntry[]
}

interface MonthlyDemandRow {
  year: number
  month: number
  month_label: string
  total_predicted_quantity: number
  top_medicines: TopMedicineEntry[]
}

interface SeasonalDemandRow {
  season: string // "Wet" | "Dry"
  total_predicted_quantity: number
  top_medicines: TopMedicineEntry[]
}

interface PredictResponse {
  forecast_period_days: number
  number_of_barangays: number
  safety_buffer_percent_used: number
  pharmacy_demand_summary: DemandSummaryRow[]
  stock_and_reserve_summary: ReserveSummaryRow[]
  demand_by_week: WeeklyDemandRow[]
  demand_by_month: MonthlyDemandRow[]
  demand_by_season: SeasonalDemandRow[]
}

// >>> BAGO: TOP_N pa rin ang DEFAULT na bilang na ipinapakita (para
// compact ang card); ang buong listahan (lahat ng gamot) ay makikita
// na lang sa isang MODAL/popup -- tingnan ang modalView state sa ibaba.
const TOP_N = 5
type ViewMode = 'demand' | 'reserve' | 'weekly' | 'monthly' | 'seasonal'

// >>> BAGO: i-convert ang raw pieces papuntang "X box + Y strip + Z pcs".
// Kung walang pieces_per_box/pieces_per_strip (null/0), mag-fallback sa
// plain pieces lang -- hindi lahat ng gamot ay may box/strip breakdown
// (hal. loose-only items). PAALALA: ang conversion factor ay REPRESENTATIVE
// lang (mula sa batch na may pinakamalaking stock -- tingnan ang paalala
// sa api_server.py fetch_medicine_packaging()), kaya approximation ito
// kung magkaiba ang packaging ng iba't ibang batch ng parehong gamot. <<<
function formatBoxStripPiece(
  pieces: number,
  piecesPerBox?: number | null,
  piecesPerStrip?: number | null
): string {
  if (pieces <= 0) return '0 pcs'

  const hasBox = !!piecesPerBox && piecesPerBox > 0
  const hasStrip = !!piecesPerStrip && piecesPerStrip > 0

  if (!hasBox && !hasStrip) {
    return `${pieces.toLocaleString()} pcs`
  }

  let remaining = pieces
  const parts: string[] = []

  if (hasBox) {
    const boxes = Math.floor(remaining / piecesPerBox!)
    remaining -= boxes * piecesPerBox!
    if (boxes > 0) parts.push(`${boxes} box${boxes !== 1 ? 'es' : ''}`)
  }

  if (hasStrip) {
    const strips = Math.floor(remaining / piecesPerStrip!)
    remaining -= strips * piecesPerStrip!
    if (strips > 0) parts.push(`${strips} strip${strips !== 1 ? 's' : ''}`)
  }

  if (remaining > 0 || parts.length === 0) {
    parts.push(`${remaining} pcs`)
  }

  return parts.join(' + ')
}

export default function PredictionCard() {
  const [data, setData] = useState<PredictResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastComputed, setLastComputed] = useState<Date | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [view, setView] = useState<ViewMode>('demand')

  // >>> BAGO: sa halip na i-expand ang listahan NANG NASA LOOB pa rin ng
  // card (na na-clip pala ng parent grid container -- hindi natin
  // makontrol yun), MODAL/POPUP na lang ang lumalabas sa IBABAW ng buong
  // screen kapag "Ipakita lahat" -- garantisadong may sapat na space ito
  // kahit ano pa ang height constraint ng parent layout.
  const [modalView, setModalView] = useState<ViewMode | null>(null)
  // >>> BAGO: hiwalay na modal PARA SA ISANG PARTIKULAR NA PERIOD
  // (isang linggo, isang buwan, o isang season) -- gamit ito ng
  // Weekly/Monthly/Seasonal tabs kapag pinindot ang "Ipakita lahat"
  // sa isang partikular na card, para makita LAHAT ng gamot para
  // doon (hindi lang Top 5).
  const [periodModal, setPeriodModal] = useState<{ title: string; medicines: TopMedicineEntry[]; accentColor: string } | null>(null)

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
  // >>> BAGO: weekly/monthly/seasonal forecast data
  const allWeekly = data?.demand_by_week || []
  const allMonthly = data?.demand_by_month || []
  const allSeasonal = data?.demand_by_season || []

  // Sa loob ng card, laging Top 5 lang ang ipinapakita -- ang buong
  // listahan (20) ay makikita na lang sa MODAL (tingnan showMoreButtonStyle
  // buttons sa ibaba, at ang modal render sa pinaka-dulo ng component).
  const visibleDemand = useMemo(() => allDemand.slice(0, TOP_N), [allDemand])

  const sortedReserve = useMemo(() => {
    // Shortages surfaced first — that's the actionable part of this view.
    return [...allReserve].sort((a, b) => {
      const aShort = a.stock_status.includes('SHORTAGE') ? 0 : 1
      const bShort = b.stock_status.includes('SHORTAGE') ? 0 : 1
      return aShort - bShort || b.percentage_ilalaan_para_sa_pharmacy_buffered_15pct - a.percentage_ilalaan_para_sa_pharmacy_buffered_15pct
    })
  }, [allReserve])

  const visibleReserve = useMemo(() => sortedReserve.slice(0, TOP_N), [sortedReserve])

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

  // Base pa rin sa TOTAL na dataset (hindi lang sa visible slice) para
  // hindi magbago ang bar scaling habang nag-e-expand/collapse.
  const maxDemandQty = Math.max(1, ...allDemand.map(d => d.total_predicted_pharmacy_request))

  // >>> BAGO: para sa bar scaling ng Weekly/Monthly period cards --
  // kaparehong approach ng maxDemandQty (batay sa pinakamataas na
  // total sa BUONG listahan, hindi nagbabago habang nagsu-scroll).
  const maxWeeklyTotal = Math.max(1, ...allWeekly.map(w => w.total_predicted_quantity))
  const maxMonthlyTotal = Math.max(1, ...allMonthly.map(m => m.total_predicted_quantity))
  const seasonalTotalSum = allSeasonal.reduce((sum, s) => sum + s.total_predicted_quantity, 0)

  // >>> BAGO: piniling season sa Seasonal tab. Naka-default sa
  // KASALUKUYANG season (base sa buwan ngayon, parehong Wet=Jun-Nov/
  // Dry=Dec-May na classification gamit sa backend), pero puwede nang
  // i-toggle ng user papuntang kabilang season -- ito ang "choice"
  // na hiniling.
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null)
  const currentMonth = new Date().getMonth() + 1 // JS: 0-indexed, +1 para 1-12
  const defaultSeason = [6, 7, 8, 9, 10, 11].includes(currentMonth) ? 'Wet' : 'Dry'
  const activeSeason = selectedSeason ?? defaultSeason

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

        {/* Toggle -- Demand / Reserve / Weekly / Monthly / Seasonal.
            >>> BAGO: 3 dagdag na tab (flexWrap para kasya sa maliit na
            card kung sakaling maikli ang width). <<< */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            onClick={() => setView('demand')}
            className={styles.predTabBtn}
            style={tabButtonStyle(view === 'demand')}
          >
            Demand
          </button>
          <button
            onClick={() => setView('reserve')}
            className={styles.predTabBtn}
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
          <button
            onClick={() => setView('weekly')}
            className={styles.predTabBtn}
            style={tabButtonStyle(view === 'weekly')}
          >
            Weekly
          </button>
          <button
            onClick={() => setView('monthly')}
            className={styles.predTabBtn}
            style={tabButtonStyle(view === 'monthly')}
          >
            Monthly
          </button>
          <button
            onClick={() => setView('seasonal')}
            className={styles.predTabBtn}
            style={tabButtonStyle(view === 'seasonal')}
          >
            Seasonal
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {view === 'demand' && (
            visibleDemand.length === 0 ? (
              <div style={emptyStyle}>No demand forecast yet.</div>
            ) : (
              <>
                <div className={styles.predList} style={{ overflowY: 'auto' }}>
                  {visibleDemand.map((row, i) => {
                    const barPct = Math.max(6, Math.round((row.total_predicted_pharmacy_request / maxDemandQty) * 100))
                    return (
                      <div key={row.medicine_name} className={styles.predRow}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                            <span style={rankBadgeStyle(i)}>{i + 1}</span>
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
                {/* >>> BAGO: binubuksan na ang MODAL (hindi na inline
                    expand) -- lumalabas lang kung mas marami sa TOP_N. <<< */}
                {allDemand.length > TOP_N && (
                  <button
                    onClick={() => setModalView('demand')}
                    style={showMoreButtonStyle}
                  >
                    ▼ Ipakita lahat ({allDemand.length})
                  </button>
                )}
              </>
            )
          )}

          {view === 'reserve' && (
            visibleReserve.length === 0 ? (
              <div style={emptyStyle}>No reserve data yet.</div>
            ) : (
              <>
                <div className={styles.predList} style={{ overflowY: 'auto' }}>
                  {visibleReserve.map(row => {
                    const isShort = row.stock_status.includes('SHORTAGE')
                    const reserveVal = row.reserve_for_pharmacy_buffered_15pct
                    const availVal = row.available_for_96_barangays_buffered
                    const segTotal = Math.max(1, reserveVal + availVal)
                    const reservePct = (reserveVal / segTotal) * 100
                    const availPct = 100 - reservePct

                    const stockDisplay = formatBoxStripPiece(row.current_stock_sa_warehouse, row.pieces_per_box, row.pieces_per_strip)
                    const reserveDisplay = formatBoxStripPiece(reserveVal, row.pieces_per_box, row.pieces_per_strip)
                    const availDisplay = formatBoxStripPiece(availVal, row.pieces_per_box, row.pieces_per_strip)

                    return (
                      <div
                        key={row.medicine_name}
                        style={{
                          padding: '7px 9px', borderRadius: 8,
                          background: isShort ? '#fee2e2' : 'var(--surface2)',
                          border: `1px solid ${isShort ? 'rgba(220,38,38,0.25)' : 'var(--border)'}`,
                          borderLeft: `3px solid ${isShort ? '#dc2626' : '#16a34a'}`,
                          marginBottom: 6,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                            {row.medicine_name}
                          </div>
                          <span style={reserveBadgeStyle(isShort)}>
                            {isShort ? '⚠ Shortage' : '✓ OK'}
                          </span>
                        </div>

                        {/* Composition bar: current stock split into pharmacy
                            reserve vs. what's left for barangays. */}
                        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2, background: 'var(--surface2)' }}>
                          <div style={{ width: `${reservePct}%`, background: '#2563eb', borderRadius: availPct > 0.5 ? '4px 0 0 4px' : 4 }} />
                          <div style={{ width: `${availPct}%`, background: '#16a34a', borderRadius: reservePct > 0.5 ? '0 4px 4px 0' : 4 }} />
                        </div>

                        <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span>Stock: {stockDisplay}</span>
                          <span>Reserve: {reserveDisplay} ({row.percentage_ilalaan_para_sa_pharmacy_buffered_15pct}%)</span>
                          <span style={{ color: isShort ? '#dc2626' : '#16a34a', fontWeight: 700 }}>
                            Matitira: {availDisplay}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {/* >>> BAGO: modal din ito, Reserve tab. <<< */}
                {allReserve.length > TOP_N && (
                  <button
                    onClick={() => setModalView('reserve')}
                    style={showMoreButtonStyle}
                  >
                    ▼ Ipakita lahat ({allReserve.length})
                  </button>
                )}
              </>
            )
          )}

          {/* >>> BAGO: WEEKLY tab -- listahan ng linggo sa loob ng
              forecast period. Bawat card: label + total (may
              proportional bar, kaparehong grammar ng Demand tab),
              tapos ranked mini-list ng top 3 gamot (may sariling
              proportional bar relative sa pinakamataas sa loob ng
              parehong linggo) -- consistent na visual language sa
              buong card, hindi na flat na "chip cloud". <<< */}
          {view === 'weekly' && (
            allWeekly.length === 0 ? (
              <div style={emptyStyle}>Walang weekly forecast data.</div>
            ) : (
              <div className={styles.predList} style={{ overflowY: 'auto' }}>
                {allWeekly.map(wk => {
                  const totalBarPct = Math.max(4, Math.round((wk.total_predicted_quantity / maxWeeklyTotal) * 100))
                  const visibleMeds = wk.top_medicines.slice(0, TOP_N)
                  const topQty = visibleMeds[0]?.quantity || 1
                  return (
                    <div key={`${wk.year}-${wk.week_of_year}`} style={periodCardStyle}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                        <span style={periodLabelStyle}>{wk.week_label}</span>
                        <span style={periodTotalStyle}>{wk.total_predicted_quantity.toLocaleString()}</span>
                      </div>
                      <div style={periodBarTrackStyle}>
                        <div style={{ ...periodBarFillStyle, width: `${totalBarPct}%` }} />
                      </div>
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {visibleMeds.map((m, i) => (
                          <div key={m.medicine_name} style={miniMedRowStyle}>
                            <span style={miniMedRankStyle}>{i + 1}</span>
                            <span style={miniMedNameStyle}>{m.medicine_name}</span>
                            <div style={miniMedBarTrackStyle}>
                              <div style={{ ...miniMedBarFillStyle, width: `${Math.max(8, Math.round((m.quantity / topQty) * 100))}%` }} />
                            </div>
                            <span style={miniMedQtyStyle}>{m.quantity}</span>
                          </div>
                        ))}
                      </div>
                      {/* >>> BAGO: "Ipakita lahat" PER PERIOD -- lumalabas
                          lang kung mas marami sa TOP_N ang gamot para sa
                          linggong ito. <<< */}
                      {wk.top_medicines.length > TOP_N && (
                        <button
                          onClick={() => setPeriodModal({
                            title: wk.week_label,
                            medicines: wk.top_medicines,
                            accentColor: '#16a34a',
                          })}
                          style={periodShowAllButtonStyle}
                        >
                          Ipakita lahat ({wk.top_medicines.length})
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          )}

          {/* >>> BAGO: MONTHLY tab -- kaparehong disenyo ng Weekly,
              pero per buwan. Base sa demand_by_month. <<< */}
          {view === 'monthly' && (
            allMonthly.length === 0 ? (
              <div style={emptyStyle}>Walang monthly forecast data.</div>
            ) : (
              <div className={styles.predList} style={{ overflowY: 'auto' }}>
                {allMonthly.map(mo => {
                  const totalBarPct = Math.max(4, Math.round((mo.total_predicted_quantity / maxMonthlyTotal) * 100))
                  const visibleMeds = mo.top_medicines.slice(0, TOP_N)
                  const topQty = visibleMeds[0]?.quantity || 1
                  return (
                    <div key={`${mo.year}-${mo.month}`} style={periodCardStyle}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                        <span style={periodLabelStyle}>{mo.month_label}</span>
                        <span style={periodTotalStyle}>{mo.total_predicted_quantity.toLocaleString()}</span>
                      </div>
                      <div style={periodBarTrackStyle}>
                        <div style={{ ...periodBarFillStyle, width: `${totalBarPct}%` }} />
                      </div>
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {visibleMeds.map((m, i) => (
                          <div key={m.medicine_name} style={miniMedRowStyle}>
                            <span style={miniMedRankStyle}>{i + 1}</span>
                            <span style={miniMedNameStyle}>{m.medicine_name}</span>
                            <div style={miniMedBarTrackStyle}>
                              <div style={{ ...miniMedBarFillStyle, width: `${Math.max(8, Math.round((m.quantity / topQty) * 100))}%` }} />
                            </div>
                            <span style={miniMedQtyStyle}>{m.quantity}</span>
                          </div>
                        ))}
                      </div>
                      {mo.top_medicines.length > TOP_N && (
                        <button
                          onClick={() => setPeriodModal({
                            title: mo.month_label,
                            medicines: mo.top_medicines,
                            accentColor: '#16a34a',
                          })}
                          style={periodShowAllButtonStyle}
                        >
                          Ipakita lahat ({mo.top_medicines.length})
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          )}

          {/* >>> BAGO: SEASONAL tab -- Wet vs Dry (parehong get_season()
              classification na ginagamit sa training). May composition
              bar sa itaas na nagpapakita ng SHARE ng Wet vs Dry sa
              kabuuang forecast (kaparehong grammar ng "reserve vs
              available" composition bar sa Reserve tab), tapos bawat
              season card ay may sariling tinted background (asul-ish
              para Wet, kulay-buhawi para Dry) at ranked mini-list ng
              top medicines, kaparehong disenyo ng Weekly/Monthly. <<< */}
          {view === 'seasonal' && (
            allSeasonal.length === 0 ? (
              <div style={emptyStyle}>Walang seasonal forecast data.</div>
            ) : (
              <div className={styles.predList} style={{ overflowY: 'auto' }}>
                {/* >>> BAGO: toggle selector -- Wet/Dry, para makapili
                    talaga ang user kung aling season ang gustong
                    tingnan (dating basta pinapakita lang lahat). <<< */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  {['Wet', 'Dry'].map(s => {
                    const seasonData = allSeasonal.find(se => se.season === s)
                    if (!seasonData) return null
                    const isActive = activeSeason === s
                    return (
                      <button
                        key={s}
                        onClick={() => setSelectedSeason(s)}
                        style={seasonToggleStyle(isActive, s === 'Wet')}
                      >
                        {s === 'Wet' ? '🌧️ Wet Season' : '☀️ Dry Season'}
                      </button>
                    )
                  })}
                </div>

                {allSeasonal.length > 1 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text3)', letterSpacing: '.02em', marginBottom: 5 }}>
                      Paghahati ng buong-taong forecast (Wet vs Dry)
                    </div>
                    <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 }}>
                      {allSeasonal.map(se => {
                        const share = seasonalTotalSum > 0 ? (se.total_predicted_quantity / seasonalTotalSum) * 100 : 0
                        return (
                          <div
                            key={se.season}
                            style={{
                              width: `${share}%`,
                              background: se.season === 'Wet' ? '#3b82f6' : '#f59e0b',
                              borderRadius: 4,
                              opacity: se.season === activeSeason ? 1 : 0.35,
                              transition: 'opacity .15s ease',
                            }}
                            title={`${se.season}: ${Math.round(share)}%`}
                          />
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* >>> BAGO: IPINAPAKITA LANG ANG NAPILING SEASON (hindi
                    na pareho lagi), base sa activeSeason toggle sa
                    itaas. <<< */}
                {allSeasonal.filter(se => se.season === activeSeason).map(se => {
                  const isWet = se.season === 'Wet'
                  const visibleMeds = se.top_medicines.slice(0, TOP_N)
                  const topQty = visibleMeds[0]?.quantity || 1
                  const share = seasonalTotalSum > 0 ? Math.round((se.total_predicted_quantity / seasonalTotalSum) * 100) : 100
                  return (
                    <div
                      key={se.season}
                      style={{
                        ...periodCardStyle,
                        background: isWet ? '#eff6ff' : '#fffbeb',
                        border: `1px solid ${isWet ? '#bfdbfe' : '#fde68a'}`,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: isWet ? '#1e40af' : '#92400e', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>{isWet ? '🌧️' : '☀️'}</span> {se.season === 'Wet' ? 'Wet Season' : 'Dry Season'}
                        </span>
                        <span style={{ fontSize: 15, fontWeight: 700, color: isWet ? '#1e40af' : '#92400e' }}>
                          {se.total_predicted_quantity.toLocaleString()}
                        </span>
                      </div>
                      <div style={{ fontSize: 9.5, color: isWet ? '#3b82f6' : '#d97706', marginBottom: 8 }}>
                        {share}% ng buong-taong (~1 taon) na forecast
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {visibleMeds.map((m, i) => (
                          <div key={m.medicine_name} style={miniMedRowStyle}>
                            <span style={{ ...miniMedRankStyle, color: isWet ? '#1e40af' : '#92400e' }}>{i + 1}</span>
                            <span style={miniMedNameStyle}>{m.medicine_name}</span>
                            <div style={miniMedBarTrackStyle}>
                              <div
                                style={{
                                  ...miniMedBarFillStyle,
                                  width: `${Math.max(8, Math.round((m.quantity / topQty) * 100))}%`,
                                  background: isWet ? '#3b82f6' : '#f59e0b',
                                }}
                              />
                            </div>
                            <span style={miniMedQtyStyle}>{m.quantity}</span>
                          </div>
                        ))}
                      </div>
                      {se.top_medicines.length > TOP_N && (
                        <button
                          onClick={() => setPeriodModal({
                            title: se.season === 'Wet' ? '🌧️ Wet Season' : '☀️ Dry Season',
                            medicines: se.top_medicines,
                            accentColor: isWet ? '#3b82f6' : '#f59e0b',
                          })}
                          style={{
                            ...periodShowAllButtonStyle,
                            color: isWet ? '#1e40af' : '#92400e',
                            background: isWet ? '#dbeafe' : '#fef3c7',
                            border: `1px solid ${isWet ? '#93c5fd' : '#fcd34d'}`,
                          }}
                        >
                          Ipakita lahat ({se.top_medicines.length})
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          )}
        </div>

        {lastComputed && (
          <div className={styles.predFooter}>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>
              🔮 Auto-generated forecast
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>
                Computed {lastComputed.toLocaleTimeString()}
              </span>
              <button
                onClick={fetchPrediction}
                disabled={refreshing}
                className={styles.predRefreshBtn}
              >
                {refreshing && <span className={styles.predSpin}>⟳</span>}
                {refreshing ? 'Refreshing…' : '↻ Refresh'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* >>> BAGO: MODAL na lumalabas SA IBABAW ng buong screen (position:
          fixed, hindi bahagi ng constrained na parent grid), para
          garantisadong may sapat na height ito para makita ang buong
          listahan (20 gamot), anuman ang laki ng dashboard card. <<< */}
      {modalView && (
        <div
          onClick={() => setModalView(null)}
          className={styles.modalBackdrop}
        >
          <div
            onClick={e => e.stopPropagation()}
            className={styles.modal}
            style={{ maxWidth: 480, maxHeight: '80vh' }}
          >
            <div className={styles.modalHeader}>
              <span style={headerTitleStyle}>
                {modalView === 'demand' ? '🔮 Buong Demand Forecast' : '📦 Buong Reserve Summary'}
              </span>
              <button
                onClick={() => setModalView(null)}
                className={styles.modalClose}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: '12px 16px 16px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
              {modalView === 'demand' ? (
                <div className={styles.predList}>
                  {allDemand.map((row, i) => {
                    const barPct = Math.max(6, Math.round((row.total_predicted_pharmacy_request / maxDemandQty) * 100))
                    return (
                      <div key={row.medicine_name} className={styles.predRow}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                            <span style={rankBadgeStyle(i)}>{i + 1}</span>
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
                            <div style={{ width: `${barPct}%`, height: '100%', borderRadius: 999, background: 'linear-gradient(90deg,#16a34a,#22c55e)' }} />
                          </div>
                          <span style={{ fontSize: 9.5, color: 'var(--text3)', flexShrink: 0 }}>
                            {row.percentage_of_total_predicted_requests}%
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className={styles.predList}>
                  {sortedReserve.map(row => {
                    const isShort = row.stock_status.includes('SHORTAGE')
                    const reserveVal = row.reserve_for_pharmacy_buffered_15pct
                    const availVal = row.available_for_96_barangays_buffered
                    const segTotal = Math.max(1, reserveVal + availVal)
                    const reservePct = (reserveVal / segTotal) * 100
                    const availPct = 100 - reservePct
                    const stockDisplay = formatBoxStripPiece(row.current_stock_sa_warehouse, row.pieces_per_box, row.pieces_per_strip)
                    const reserveDisplay = formatBoxStripPiece(reserveVal, row.pieces_per_box, row.pieces_per_strip)
                    const availDisplay = formatBoxStripPiece(availVal, row.pieces_per_box, row.pieces_per_strip)
                    return (
                      <div
                        key={row.medicine_name}
                        style={{
                          padding: '7px 9px', borderRadius: 8,
                          background: isShort ? '#fee2e2' : 'var(--surface2)',
                          border: `1px solid ${isShort ? 'rgba(220,38,38,0.25)' : 'var(--border)'}`,
                          borderLeft: `3px solid ${isShort ? '#dc2626' : '#16a34a'}`,
                          marginBottom: 6,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                            {row.medicine_name}
                          </div>
                          <span style={reserveBadgeStyle(isShort)}>
                            {isShort ? '⚠ Shortage' : '✓ OK'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2, background: 'var(--surface2)' }}>
                          <div style={{ width: `${reservePct}%`, background: '#2563eb', borderRadius: availPct > 0.5 ? '4px 0 0 4px' : 4 }} />
                          <div style={{ width: `${availPct}%`, background: '#16a34a', borderRadius: reservePct > 0.5 ? '0 4px 4px 0' : 4 }} />
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span>Stock: {stockDisplay}</span>
                          <span>Reserve: {reserveDisplay} ({row.percentage_ilalaan_para_sa_pharmacy_buffered_15pct}%)</span>
                          <span style={{ color: isShort ? '#dc2626' : '#16a34a', fontWeight: 700 }}>Matitira: {availDisplay}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* >>> BAGO: PER-PERIOD modal -- lumalabas kapag pinindot ang
          "Ipakita lahat" sa loob ng isang partikular na Weekly/Monthly/
          Seasonal card. Kaparehong estilo ng modalView modal sa itaas,
          pero mas simple (isang ranked list lang, walang tabs). <<< */}
      {periodModal && (
        <div
          onClick={() => setPeriodModal(null)}
          className={styles.modalBackdrop}
        >
          <div
            onClick={e => e.stopPropagation()}
            className={styles.modal}
            style={{ maxWidth: 420, maxHeight: '80vh' }}
          >
            <div
              className={styles.modalHeader}
              style={{ background: `linear-gradient(90deg, var(--green-dark), ${periodModal.accentColor})` }}
            >
              <span style={headerTitleStyle}>{periodModal.title}</span>
              <button
                onClick={() => setPeriodModal(null)}
                className={styles.modalClose}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: '12px 16px 16px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {periodModal.medicines.map((m, i) => {
                  const topQty = periodModal.medicines[0]?.quantity || 1
                  return (
                    <div key={m.medicine_name} style={miniMedRowStyle}>
                      <span style={{ ...miniMedRankStyle, color: periodModal.accentColor }}>{i + 1}</span>
                      <span style={{ ...miniMedNameStyle, width: 140 }}>{m.medicine_name}</span>
                      <div style={miniMedBarTrackStyle}>
                        <div
                          style={{
                            ...miniMedBarFillStyle,
                            width: `${Math.max(8, Math.round((m.quantity / topQty) * 100))}%`,
                            background: periodModal.accentColor,
                          }}
                        />
                      </div>
                      <span style={miniMedQtyStyle}>{m.quantity}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
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
    boxShadow: active ? '0 3px 10px rgba(22,163,74,.3)' : 'none',
    cursor: 'pointer',
    transition: 'background .15s ease, color .15s ease, transform .15s ease, filter .15s ease',
  }
}

// Status pill used in the Reserve list — spells out "Shortage"/"OK" instead
// of a bare icon, so the state reads without relying on color alone.
function reserveBadgeStyle(isShort: boolean): React.CSSProperties {
  return {
    fontSize: 9,
    fontWeight: 800,
    flexShrink: 0,
    padding: '3px 8px',
    borderRadius: 999,
    display: 'inline-flex',
    alignItems: 'center',
    letterSpacing: '.02em',
    color: isShort ? '#dc2626' : '#16a34a',
    background: isShort ? '#fecaca' : '#dcfce7',
  }
}

// Circular rank badge used in the Demand list — top 3 get a filled green
// badge, the rest a neutral one, so the ranking reads at a glance.
function rankBadgeStyle(index: number): React.CSSProperties {
  const isTop3 = index < 3
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 16,
    height: 16,
    borderRadius: '50%',
    fontSize: 9,
    fontWeight: 800,
    flexShrink: 0,
    background: isTop3 ? 'linear-gradient(135deg,#16a34a,#22c55e)' : 'var(--border)',
    color: isTop3 ? '#fff' : 'var(--text3)',
  }
}

// >>> BAGO: toggle button para sa Wet/Dry season selector sa Seasonal tab.
function seasonToggleStyle(active: boolean, isWet: boolean): React.CSSProperties {
  const activeColor = isWet ? '#3b82f6' : '#f59e0b'
  return {
    flex: 1,
    fontSize: 11.5,
    fontWeight: 700,
    borderRadius: 8,
    padding: '7px 10px',
    border: '1px solid ' + (active ? activeColor : 'var(--border)'),
    background: active ? (isWet ? '#eff6ff' : '#fffbeb') : 'var(--surface2)',
    color: active ? (isWet ? '#1e40af' : '#92400e') : 'var(--text3)',
    cursor: 'pointer',
    transition: 'background .15s ease, color .15s ease, border-color .15s ease',
  }
}

// ---- Shared inline styles (mirrors MedicineMovementAnalytics) ----
const cardStyle: React.CSSProperties = {
  background: 'var(--surface, #fff)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  overflow: 'hidden',
  boxShadow: 'var(--shadow, 0 2px 16px rgba(13,59,31,0.08))',
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
  fontSize: 10,
  color: '#fff',
  fontWeight: 700,
  background: 'rgba(255,255,255,.16)',
  padding: '3px 10px',
  borderRadius: 999,
  letterSpacing: '.01em',
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
const showMoreButtonStyle: React.CSSProperties = {
  flexShrink: 0,
  marginTop: 8,
  padding: '7px 10px',
  fontSize: 11,
  fontWeight: 700,
  color: '#16a34a',
  background: '#f0fdf4',
  border: '1px solid #bbf7d0',
  borderRadius: 8,
  cursor: 'pointer',
  width: '100%',
  textAlign: 'center',
}
// >>> BAGO: "Ipakita lahat" button PER period card (Weekly/Monthly/
// Seasonal) -- mas maliit/subtle kaysa showMoreButtonStyle dahil
// nasa LOOB ito ng isang maliit na card, hindi sa ilalim ng buong list.
const periodShowAllButtonStyle: React.CSSProperties = {
  marginTop: 8,
  padding: '5px 8px',
  fontSize: 10,
  fontWeight: 700,
  color: '#16a34a',
  background: '#f0fdf4',
  border: '1px solid #bbf7d0',
  borderRadius: 6,
  cursor: 'pointer',
  width: '100%',
  textAlign: 'center',
}
// >>> BAGO: styles para sa Weekly/Monthly/Seasonal period cards --
// unified na ngayon sa parehong "label + number + proportional bar"
// grammar ng Demand tab, sa halip na flat na chip cloud.
const periodCardStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  marginBottom: 8,
}
const periodLabelStyle: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  color: 'var(--text)',
}
const periodTotalStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: '#16a34a',
  fontVariantNumeric: 'tabular-nums',
}
const periodBarTrackStyle: React.CSSProperties = {
  height: 5,
  borderRadius: 999,
  background: '#dcfce7',
  overflow: 'hidden',
}
const periodBarFillStyle: React.CSSProperties = {
  height: '100%',
  borderRadius: 999,
  background: 'linear-gradient(90deg,#16a34a,#22c55e)',
}
const miniMedRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}
const miniMedRankStyle: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  color: '#16a34a',
  width: 12,
  flexShrink: 0,
  textAlign: 'center',
}
const miniMedNameStyle: React.CSSProperties = {
  fontSize: 10.5,
  color: 'var(--text2)',
  width: 96,
  flexShrink: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
const miniMedBarTrackStyle: React.CSSProperties = {
  flex: 1,
  height: 4,
  borderRadius: 999,
  background: 'var(--border)',
  overflow: 'hidden',
}
const miniMedBarFillStyle: React.CSSProperties = {
  height: '100%',
  borderRadius: 999,
  background: '#16a34a',
}
const miniMedQtyStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--text3)',
  width: 24,
  flexShrink: 0,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
}