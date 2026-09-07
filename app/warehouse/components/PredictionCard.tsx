'use client'
import { useState, useMemo } from 'react'
import styles from './warehouse.module.css'
import { useWarehousePrediction } from './Usewarehouseprediction'

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
  pieces_per_box?: number | null
  pieces_per_strip?: number | null
  // >>> BAGO: klase ng gamot (Tablet/Capsule/Suspension/Drops/atbp.)
  // mula sa medicines.dosage_form -- ipinapakita bilang badge at
  // bilang linya sa info block sa baba ng bawat card.
  dosage_form?: string | null
}

interface TopMedicineEntry {
  medicine_name: string
  quantity: number
}

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

const TOP_N = 5
type ViewMode = 'reserve' | 'monthly' | 'seasonal'

const TABS: { key: ViewMode; label: string }[] = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'seasonal', label: 'Seasonal' },
  { key: 'reserve', label: 'Reserve' },
]

// >>> BAGO: icon per dosage_form (Tablet/Capsule/Suspension/Drops/
// Nebule/atbp.) -- ginagamit sa badge sa tabi ng bawat gamot at sa
// "Form:" na linya sa info block sa Reserve tab.
function formIcon(form?: string | null): string {
  const f = (form || '').toLowerCase()
  if (f.includes('drop')) return '💧'
  if (f.includes('nebule') || f.includes('inhal')) return '💨'
  if (f.includes('syrup') || f.includes('suspension')) return '🧴'
  return '💊'
}

function formatBoxStripPiece(
  pieces: number,
  piecesPerBox?: number | null,
  piecesPerStrip?: number | null
): string {
  if (pieces <= 0) return '0 pcs'
  const hasBox = !!piecesPerBox && piecesPerBox > 0
  const hasStrip = !!piecesPerStrip && piecesPerStrip > 0
  if (!hasBox && !hasStrip) return `${pieces.toLocaleString()} pcs`

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
  if (remaining > 0 || parts.length === 0) parts.push(`${remaining} pcs`)
  return parts.join(' + ')
}

export default function PredictionCard() {
  const { data, loading, error, refreshing, lastComputed, refresh: fetchPrediction } = useWarehousePrediction() as {
    data: PredictResponse | null
    loading: boolean
    error: string
    refreshing: boolean
    lastComputed: Date | null
    refresh: () => void
  }
  const [view, setView] = useState<ViewMode>('monthly')

  const [modalView, setModalView] = useState<'reserve' | null>(null)
  const [periodModal, setPeriodModal] = useState<{ title: string; medicines: TopMedicineEntry[]; accentColor: string } | null>(null)

  const allDemand = data?.pharmacy_demand_summary || []
  const allReserve = data?.stock_and_reserve_summary || []
  const allMonthly = data?.demand_by_month || []
  const allSeasonal = data?.demand_by_season || []

  const sortedReserve = useMemo(() => {
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

  const maxMonthlyTotal = Math.max(1, ...allMonthly.map(m => m.total_predicted_quantity))
  const seasonalTotalSum = allSeasonal.reduce((sum, s) => sum + s.total_predicted_quantity, 0)

  const [selectedSeason, setSelectedSeason] = useState<string | null>(null)
  const currentMonth = new Date().getMonth() + 1
  const defaultSeason = [6, 7, 8, 9, 10, 11].includes(currentMonth) ? 'Wet' : 'Dry'
  const activeSeason = selectedSeason ?? defaultSeason

  if (loading) {
    return (
      <div style={{ ...cardStyle, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ ...headerStyle, flexShrink: 0 }}>
          <HeaderTitle />
        </div>
        <div style={{ padding: '17px 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[100, 85, 70, 55].map((w, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className={styles.predSkeletonBar} style={{ height: 16, width: `${w}%`, borderRadius: 6 }} />
              <div className={styles.predSkeletonBar} style={{ height: 10, width: '100%', borderRadius: 6 }} />
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
          <HeaderTitle />
        </div>
        <div style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: '#fee2e2', color: '#dc2626', padding: '14px 16px', borderRadius: 12, fontSize: 11.5 }}>
            <span>⚠ {error}</span>
            <button onClick={fetchPrediction} style={retryButtonStyle}>Retry</button>
          </div>
          <div style={{ marginTop: 12, fontSize: 10.5, color: 'var(--text3)' }}>
            Make sure the ML service is running (<code>uvicorn api_server:app --port 8000</code> inside <code>warehouse_ml/</code>).
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ ...cardStyle, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ ...headerStyle, flexShrink: 0 }}>
        <HeaderTitle />
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={headerChipStyle(true)}>{data?.forecast_period_days ?? 30}-day outlook</span>
          <span style={headerChipStyle(false)}>+{Math.round((data?.safety_buffer_percent_used ?? 0.15) * 100)}% buffer</span>
        </div>
      </div>

      <div style={{ padding: '17px 20px 19px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {categoryBreakdown.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>No forecast data yet</div>
        ) : (
          <div style={statStripStyle}>
            {categoryBreakdown.map((c, i) => (
              <div key={c.category} style={statCellStyle(i < categoryBreakdown.length - 1)}>
                <span style={statIconStyle(c.category)}>{c.category === 'drugs' ? '💊' : '🧰'}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={statLabelStyle}>{formatCategory(c.category)}</span>
                  <span style={statValueStyle}>{c.count}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={segmentTrackStyle}>
          {TABS.map(t => {
            const active = view === t.key
            return (
              <button key={t.key} onClick={() => setView(t.key)} style={segmentButtonStyle(active)}>
                {t.label}
                {t.key === 'reserve' && shortageCount > 0 && (
                  <span style={segmentBadgeStyle(active)}>{shortageCount}</span>
                )}
              </button>
            )
          })}
        </div>

        <div style={{ flex: 1, minHeight: 340, display: 'flex', flexDirection: 'column' }}>
          {view === 'reserve' && (
            visibleReserve.length === 0 ? (
              <div style={emptyStyle}>No reserve data yet.</div>
            ) : (
              <>
                <div className={styles.predList} style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                          padding: '13px 15px', borderRadius: 12,
                          background: isShort ? '#fee2e2' : 'var(--surface2)',
                          border: `1px solid ${isShort ? 'rgba(220,38,38,0.25)' : 'var(--border)'}`,
                          borderLeft: `4px solid ${isShort ? '#dc2626' : '#16a34a'}`,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                              {row.medicine_name}
                            </span>
                            {row.dosage_form && (
                              <span style={dosageFormBadgeStyle}>{formIcon(row.dosage_form)} {row.dosage_form}</span>
                            )}
                          </div>
                          <span style={reserveBadgeStyle(isShort)}>
                            <span style={statusDotStyle(isShort)} />
                            {isShort ? 'Shortage' : 'OK'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2, background: 'var(--surface2)' }}>
                          <div style={{ width: `${reservePct}%`, background: '#2563eb', borderRadius: availPct > 0.5 ? '5px 0 0 5px' : 5 }} />
                          <div style={{ width: `${availPct}%`, background: '#16a34a', borderRadius: reservePct > 0.5 ? '0 5px 5px 0' : 5 }} />
                        </div>

                        <div style={{ fontSize: 9.5, color: 'var(--text3)', marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
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
                {allReserve.length > TOP_N && (
                  <button onClick={() => setModalView('reserve')} style={showAllLinkStyle}>
                    Show all {allReserve.length} <span style={chevronStyle}>›</span>
                  </button>
                )}
              </>
            )
          )}

          {view === 'monthly' && (
            allMonthly.length === 0 ? (
              <div style={emptyStyle}>Walang monthly forecast data.</div>
            ) : (
              <div className={styles.predList} style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {allMonthly.map(mo => {
                  const totalBarPct = Math.max(4, Math.round((mo.total_predicted_quantity / maxMonthlyTotal) * 100))
                  const visibleMeds = mo.top_medicines.slice(0, TOP_N)
                  const topQty = visibleMeds[0]?.quantity || 1
                  return (
                    <div key={`${mo.year}-${mo.month}`} style={periodCardStyle}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                        <span style={periodLabelStyle}>{mo.month_label}</span>
                        <span style={periodTotalStyle}>{mo.total_predicted_quantity.toLocaleString()}</span>
                      </div>
                      <div style={periodBarTrackStyle}>
                        <div style={{ ...periodBarFillStyle, width: `${totalBarPct}%` }} />
                      </div>
                      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
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
                          onClick={() => setPeriodModal({ title: mo.month_label, medicines: mo.top_medicines, accentColor: '#16a34a' })}
                          style={periodShowAllLinkStyle('#16a34a')}
                        >
                          Show all {mo.top_medicines.length} <span style={chevronStyle}>›</span>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          )}

          {view === 'seasonal' && (
            allSeasonal.length === 0 ? (
              <div style={emptyStyle}>Walang seasonal forecast data.</div>
            ) : (
              <div className={styles.predList} style={{ overflowY: 'auto' }}>
                <div style={seasonSwitchTrackStyle}>
                  {['Wet', 'Dry'].map(s => {
                    const seasonData = allSeasonal.find(se => se.season === s)
                    if (!seasonData) return null
                    const isActive = activeSeason === s
                    return (
                      <button key={s} onClick={() => setSelectedSeason(s)} style={seasonSwitchButtonStyle(isActive, s === 'Wet')}>
                        {s === 'Wet' ? '🌧️ Wet season' : '☀️ Dry season'}
                      </button>
                    )
                  })}
                </div>

                {allSeasonal.length > 1 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--text3)', marginBottom: 7 }}>
                      Share of the full-year forecast
                    </div>
                    <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2 }}>
                      {allSeasonal.map(se => {
                        const share = seasonalTotalSum > 0 ? (se.total_predicted_quantity / seasonalTotalSum) * 100 : 0
                        return (
                          <div
                            key={se.season}
                            style={{
                              width: `${share}%`,
                              background: se.season === 'Wet' ? '#3b82f6' : '#f59e0b',
                              borderRadius: 5,
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

                {allSeasonal.filter(se => se.season === activeSeason).map(se => {
                  const isWet = se.season === 'Wet'
                  const visibleMeds = se.top_medicines.slice(0, TOP_N)
                  const topQty = visibleMeds[0]?.quantity || 1
                  const share = seasonalTotalSum > 0 ? Math.round((se.total_predicted_quantity / seasonalTotalSum) * 100) : 100
                  return (
                    <div
                      key={se.season}
                      style={{ ...periodCardStyle, background: isWet ? '#eff6ff' : '#fffbeb', border: `1px solid ${isWet ? '#bfdbfe' : '#fde68a'}` }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: isWet ? '#1e40af' : '#92400e', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span>{isWet ? '🌧️' : '☀️'}</span> {se.season === 'Wet' ? 'Wet season' : 'Dry season'}
                        </span>
                        <span style={{ fontSize: 15.5, fontWeight: 700, color: isWet ? '#1e40af' : '#92400e' }}>
                          {se.total_predicted_quantity.toLocaleString()}
                        </span>
                      </div>
                      <div style={{ fontSize: 9.5, color: isWet ? '#3b82f6' : '#d97706', marginBottom: 12 }}>
                        {share}% ng buong-taong (~1 taon) na forecast
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
                          style={periodShowAllLinkStyle(isWet ? '#1e40af' : '#92400e')}
                        >
                          Show all {se.top_medicines.length} <span style={chevronStyle}>›</span>
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
          <div
            className={styles.predFooter}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '14px 0 2px',
              borderTop: '1px solid var(--border)',
              background: 'var(--surface, #fff)',
            }}
          >
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>🔮 Auto-generated forecast</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>Computed {lastComputed.toLocaleTimeString()}</span>
              <button onClick={fetchPrediction} disabled={refreshing} style={refreshButtonStyle(refreshing)}>
                <span style={refreshing ? { ...spinIconStyle, animation: 'predSpin .8s linear infinite' } : spinIconStyle}>⟳</span>
                {refreshing ? 'Refreshing' : 'Refresh'}
              </button>
            </div>
          </div>
        )}
      </div>

      {modalView === 'reserve' && (
        <div onClick={() => setModalView(null)} className={styles.modalBackdrop}>
          <div onClick={e => e.stopPropagation()} className={styles.modal} style={{ maxWidth: 520, maxHeight: '82vh' }}>
            <div className={styles.modalHeader}>
              <span style={headerTitleTextStyle}>📦 Full reserve summary</span>
              <button onClick={() => setModalView(null)} className={styles.modalClose}>✕</button>
            </div>
            <div style={{ padding: '16px 20px 20px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
              <div className={styles.predList} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                        padding: '12px 14px', borderRadius: 12,
                        background: isShort ? '#fee2e2' : 'var(--surface2)',
                        border: `1px solid ${isShort ? 'rgba(220,38,38,0.25)' : 'var(--border)'}`,
                        borderLeft: `4px solid ${isShort ? '#dc2626' : '#16a34a'}`,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{row.medicine_name}</span>
                          {row.dosage_form && (
                            <span style={dosageFormBadgeStyle}>{formIcon(row.dosage_form)} {row.dosage_form}</span>
                          )}
                        </div>
                        <span style={reserveBadgeStyle(isShort)}>
                          <span style={statusDotStyle(isShort)} />
                          {isShort ? 'Shortage' : 'OK'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', height: 9, borderRadius: 4, overflow: 'hidden', gap: 2, background: 'var(--surface2)' }}>
                        <div style={{ width: `${reservePct}%`, background: '#2563eb', borderRadius: availPct > 0.5 ? '4px 0 0 4px' : 4 }} />
                        <div style={{ width: `${availPct}%`, background: '#16a34a', borderRadius: reservePct > 0.5 ? '0 4px 4px 0' : 4 }} />
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 7, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span>Stock: {stockDisplay}</span>
                        <span>Reserve: {reserveDisplay} ({row.percentage_ilalaan_para_sa_pharmacy_buffered_15pct}%)</span>
                        <span style={{ color: isShort ? '#dc2626' : '#16a34a', fontWeight: 700 }}>Matitira: {availDisplay}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {periodModal && (
        <div onClick={() => setPeriodModal(null)} className={styles.modalBackdrop}>
          <div onClick={e => e.stopPropagation()} className={styles.modal} style={{ maxWidth: 440, maxHeight: '80vh' }}>
            <div className={styles.modalHeader} style={{ background: `linear-gradient(90deg, var(--green-dark), ${periodModal.accentColor})` }}>
              <span style={headerTitleTextStyle}>{periodModal.title}</span>
              <button onClick={() => setPeriodModal(null)} className={styles.modalClose}>✕</button>
            </div>
            <div style={{ padding: '16px 20px 20px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {periodModal.medicines.map((m, i) => {
                  const topQty = periodModal.medicines[0]?.quantity || 1
                  return (
                    <div key={m.medicine_name} style={miniMedRowStyle}>
                      <span style={{ ...miniMedRankStyle, color: periodModal.accentColor }}>{i + 1}</span>
                      <span style={{ ...miniMedNameStyle, width: 160 }}>{m.medicine_name}</span>
                      <div style={miniMedBarTrackStyle}>
                        <div style={{ ...miniMedBarFillStyle, width: `${Math.max(8, Math.round((m.quantity / topQty) * 100))}%`, background: periodModal.accentColor }} />
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

      <style>{`@keyframes predSpin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function HeaderTitle() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={headerIconBadgeStyle}>🔮</span>
      <span style={headerTitleTextStyle}>Demand forecast</span>
    </div>
  )
}

function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

// ---- Segmented tab control ----
function segmentButtonStyle(active: boolean): React.CSSProperties {
  return {
    flex: '1 1 auto',
    minWidth: 76,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    fontSize: 11.5,
    fontWeight: 700,
    border: 'none',
    borderRadius: 10,
    padding: '10px 12px',
    background: active ? 'linear-gradient(135deg,#0f5132,#16a34a)' : 'transparent',
    color: active ? '#fff' : 'var(--text3)',
    boxShadow: active ? '0 3px 10px rgba(22,163,74,.3)' : 'none',
    cursor: 'pointer',
    transition: 'background .15s ease, color .15s ease, box-shadow .15s ease',
  }
}

function segmentBadgeStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 9,
    fontWeight: 800,
    borderRadius: 999,
    minWidth: 17,
    height: 17,
    padding: '0 5px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: active ? 'rgba(255,255,255,.9)' : '#dc2626',
    color: active ? '#dc2626' : '#fff',
  }
}

function reserveBadgeStyle(isShort: boolean): React.CSSProperties {
  return {
    fontSize: 9,
    fontWeight: 800,
    flexShrink: 0,
    padding: '4px 11px 4px 8px',
    borderRadius: 999,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    color: isShort ? '#dc2626' : '#16a34a',
    background: isShort ? '#fecaca' : '#dcfce7',
  }
}

function statusDotStyle(isShort: boolean): React.CSSProperties {
  return { width: 6, height: 6, borderRadius: '50%', background: isShort ? '#dc2626' : '#16a34a', flexShrink: 0 }
}

// >>> BAGO: badge para sa dosage_form (Tablet/Capsule/Suspension/
// Drops/atbp.) sa Reserve tab.
const dosageFormBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 9,
  fontWeight: 600,
  color: 'var(--text3)',
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  padding: '2px 7px',
  borderRadius: 999,
  flexShrink: 0,
}

function rankBadgeStyle(index: number): React.CSSProperties {
  const isTop3 = index < 3
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 18,
    borderRadius: 6,
    fontSize: 9,
    fontWeight: 800,
    flexShrink: 0,
    background: isTop3 ? 'linear-gradient(135deg,#16a34a,#22c55e)' : 'var(--border)',
    color: isTop3 ? '#fff' : 'var(--text3)',
  }
}

function seasonSwitchButtonStyle(active: boolean, isWet: boolean): React.CSSProperties {
  const activeColor = isWet ? '#3b82f6' : '#f59e0b'
  return {
    flex: 1,
    fontSize: 11.5,
    fontWeight: 700,
    borderRadius: 999,
    padding: '9px 13px',
    border: '1px solid ' + (active ? activeColor : 'transparent'),
    background: active ? (isWet ? '#eff6ff' : '#fffbeb') : 'transparent',
    color: active ? (isWet ? '#1e40af' : '#92400e') : 'var(--text3)',
    cursor: 'pointer',
    transition: 'background .15s ease, color .15s ease, border-color .15s ease',
  }
}

function headerChipStyle(solid: boolean): React.CSSProperties {
  return {
    fontSize: 10,
    color: '#fff',
    fontWeight: 700,
    background: solid ? 'rgba(255,255,255,.2)' : 'transparent',
    border: solid ? 'none' : '1px solid rgba(255,255,255,.5)',
    padding: '5px 12px',
    borderRadius: 999,
  }
}

function refreshButtonStyle(refreshing: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 10.5,
    fontWeight: 700,
    color: '#16a34a',
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: 999,
    padding: '7px 14px',
    cursor: refreshing ? 'default' : 'pointer',
    opacity: refreshing ? 0.75 : 1,
  }
}

function periodShowAllLinkStyle(color: string): React.CSSProperties {
  return {
    marginTop: 9,
    padding: '6px 3px 0',
    fontSize: 9.5,
    fontWeight: 700,
    color,
    background: 'none',
    border: 'none',
    borderTop: '1px dashed rgba(0,0,0,.08)',
    cursor: 'pointer',
    width: '100%',
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 4,
  }
}

const statStripStyle: React.CSSProperties = {
  display: 'flex',
  border: '1px solid var(--border)',
  borderRadius: 13,
  overflow: 'hidden',
  background: 'var(--surface2)',
}

function statCellStyle(withDivider: boolean): React.CSSProperties {
  return {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    padding: '13px 16px',
    borderRight: withDivider ? '1px solid var(--border)' : 'none',
    minWidth: 0,
  }
}

function statIconStyle(category: string): React.CSSProperties {
  const isDrugs = category === 'drugs'
  return {
    width: 32,
    height: 32,
    borderRadius: 9,
    background: isDrugs ? '#fee2e2' : '#dbeafe',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    flexShrink: 0,
  }
}

const statLabelStyle: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 600,
  color: 'var(--text3)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const statValueStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 800,
  color: 'var(--text)',
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1.1,
}

// ---- Shared inline styles ----
const cardStyle: React.CSSProperties = {
  background: 'var(--surface, #fff)',
  border: '1px solid var(--border)',
  borderRadius: 18,
  overflowY: 'auto',
  overflowX: 'hidden',
  boxShadow: 'var(--shadow, 0 6px 28px rgba(13,59,31,0.12))',
}
const headerStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg,#0f5132,#16a34a)',
  padding: '15px 20px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  rowGap: 8,
  position: 'sticky',
  top: 0,
  zIndex: 2,
}
const headerIconBadgeStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 11,
  background: 'rgba(255,255,255,.18)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 15,
  flexShrink: 0,
}
const headerTitleTextStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
  color: '#fff',
}
const emptyStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: 'var(--text3)',
  padding: '10px 0',
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
}
const segmentTrackStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: 4,
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: 13,
  flexWrap: 'wrap',
}
const seasonSwitchTrackStyle: React.CSSProperties = {
  display: 'flex',
  gap: 3,
  padding: 4,
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: 999,
  marginBottom: 14,
}
const showAllLinkStyle: React.CSSProperties = {
  flexShrink: 0,
  marginTop: 12,
  padding: '10px 3px 0',
  fontSize: 11,
  fontWeight: 700,
  color: '#16a34a',
  background: 'none',
  border: 'none',
  borderTop: '1px dashed var(--border)',
  cursor: 'pointer',
  width: '100%',
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: 5,
}
const chevronStyle: React.CSSProperties = { fontSize: 13, fontWeight: 800 }
const retryButtonStyle: React.CSSProperties = {
  background: 'none',
  color: '#dc2626',
  border: '1px solid rgba(220,38,38,.35)',
  borderRadius: 999,
  padding: '5px 14px',
  fontSize: 10.5,
  fontWeight: 700,
  cursor: 'pointer',
  flexShrink: 0,
}
const spinIconStyle: React.CSSProperties = { display: 'inline-block' }
const periodCardStyle: React.CSSProperties = {
  padding: '14px 16px',
  borderRadius: 13,
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
}
const periodLabelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--text)' }
const periodTotalStyle: React.CSSProperties = { fontSize: 14.5, fontWeight: 700, color: '#16a34a', fontVariantNumeric: 'tabular-nums' }
const periodBarTrackStyle: React.CSSProperties = { height: 6, borderRadius: 999, background: '#dcfce7', overflow: 'hidden' }
const periodBarFillStyle: React.CSSProperties = { height: '100%', borderRadius: 999, background: 'linear-gradient(90deg,#16a34a,#22c55e)' }
const miniMedRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
const miniMedRankStyle: React.CSSProperties = { fontSize: 9, fontWeight: 700, color: '#16a34a', width: 14, flexShrink: 0, textAlign: 'center' }
const miniMedNameStyle: React.CSSProperties = {
  fontSize: 10, color: 'var(--text2)', width: 112, flexShrink: 0,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
const miniMedBarTrackStyle: React.CSSProperties = { flex: 1, height: 5, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }
const miniMedBarFillStyle: React.CSSProperties = { height: '100%', borderRadius: 999, background: '#16a34a' }
const miniMedQtyStyle: React.CSSProperties = {
  fontSize: 9.5, fontWeight: 700, color: 'var(--text3)', width: 30, flexShrink: 0,
  textAlign: 'right', fontVariantNumeric: 'tabular-nums',
}