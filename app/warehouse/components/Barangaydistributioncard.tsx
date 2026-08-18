'use client'
import { useState, useEffect, useMemo } from 'react'
import styles from './warehouse.module.css'

// ---- Response shape returned by /api/warehouse-predict (proxies to
// warehouse_ml/api_server.py's POST /predict-distribution). Ito yung
// TUNAY na per-barangay recommendation -- WALANG ML dito, plain
// arithmetic lang mula sa barangay_distribution.py (equal split +
// leftover allocation). ----
interface BarangayRecommendationRow {
  destination_id: string
  barangay_name: string
  medicine_name: string
  unit: string
  recommended_quantity: number
}

interface StockReserveRow {
  medicine_name: string
  unit: string
}

interface PredictResponse {
  number_of_barangays: number
  barangay_recommendation_exact: BarangayRecommendationRow[]
  barangay_recommendation_buffered: BarangayRecommendationRow[]
  stock_and_reserve_summary: StockReserveRow[]
}

type BufferMode = 'exact' | 'buffered'
type PlanMode = 'auto' | 'manual'

interface MedicineGroup {
  medicine_name: string
  unit: string
  barangayCount: number
  totalUnits: number
  perBarangayBase: number
  rows: BarangayRecommendationRow[]
}

function groupByMedicine(rows: BarangayRecommendationRow[]): MedicineGroup[] {
  const map = new Map<string, BarangayRecommendationRow[]>()
  for (const r of rows) {
    const arr = map.get(r.medicine_name) || []
    arr.push(r)
    map.set(r.medicine_name, arr)
  }
  return Array.from(map.entries())
    .map(([medicine_name, rs]) => {
      const totalUnits = rs.reduce((sum, r) => sum + r.recommended_quantity, 0)
      const perBarangayBase = Math.min(...rs.map(r => r.recommended_quantity))
      return {
        medicine_name,
        unit: rs[0]?.unit || 'unit',
        barangayCount: rs.length,
        totalUnits,
        perBarangayBase,
        rows: [...rs].sort((a, b) => a.barangay_name.localeCompare(b.barangay_name)),
      }
    })
    .sort((a, b) => b.totalUnits - a.totalUnits)
}

// destination_id -> quantity, para sa isang gamot
type ManualQtyMap = Record<string, number>
// medicine_name -> ManualQtyMap
type ManualPlan = Record<string, ManualQtyMap>

export default function BarangayDistributionCard() {
  const [data, setData] = useState<PredictResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastComputed, setLastComputed] = useState<Date | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const [bufferMode, setBufferMode] = useState<BufferMode>('exact')
  const [planMode, setPlanMode] = useState<PlanMode>('auto')
  const [activeMed, setActiveMed] = useState<string | null>(null)

  // ---- Manual mode state ----
  const [manualPlan, setManualPlan] = useState<ManualPlan>({})
  const [fillAllValue, setFillAllValue] = useState('')

  // ---- Save state ----
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

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
        let reason = ''
        if (typeof json.detail === 'string') {
          try {
            reason = JSON.parse(json.detail)?.detail || json.detail
          } catch {
            reason = json.detail
          }
        }
        setError([json.error, reason].filter(Boolean).join(' — ') || 'Could not load the barangay recommendation.')
        setData(null)
        setLoading(false)
        setRefreshing(false)
        return
      }

      setData(json)
      setLastComputed(new Date())
    } catch (err) {
      console.error('BarangayDistributionCard fetch error:', err)
      setError('Could not reach the prediction service.')
      setData(null)
    }

    setLoading(false)
    setRefreshing(false)
  }

  const autoRows = bufferMode === 'exact'
    ? data?.barangay_recommendation_exact || []
    : data?.barangay_recommendation_buffered || []

  const autoGroups = useMemo(() => groupByMedicine(autoRows), [autoRows])

  const allMedicineNames = useMemo(() => {
    const fromStock = (data?.stock_and_reserve_summary || []).map(r => r.medicine_name)
    const fromAuto = autoGroups.map(g => g.medicine_name)
    return Array.from(new Set([...fromStock, ...fromAuto])).sort()
  }, [data, autoGroups])

  const barangayList = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of [...(data?.barangay_recommendation_exact || []), ...(data?.barangay_recommendation_buffered || [])]) {
      seen.set(r.destination_id, r.barangay_name)
    }
    return Array.from(seen.entries())
      .map(([destination_id, barangay_name]) => ({ destination_id, barangay_name }))
      .sort((a, b) => a.barangay_name.localeCompare(b.barangay_name))
  }, [data])

  const totalBarangays = data?.number_of_barangays || barangayList.length || 96

  // Totoong unit ng bawat gamot (Piece/Bottle/Box/Loose/Strip/atbp.),
  // galing sa stock summary o sa recommendation rows -- alinman ang meron.
  const unitByMed = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of data?.stock_and_reserve_summary || []) map.set(r.medicine_name, r.unit || 'unit')
    for (const g of autoGroups) if (!map.has(g.medicine_name)) map.set(g.medicine_name, g.unit)
    return map
  }, [data, autoGroups])
  const unitFor = (medName: string) => unitByMed.get(medName) || 'unit'

  const groups = planMode === 'auto' ? autoGroups : null

  useEffect(() => {
    const pool = planMode === 'auto' ? autoGroups.map(g => g.medicine_name) : allMedicineNames
    if (pool.length === 0) {
      setActiveMed(null)
      return
    }
    if (!activeMed || !pool.includes(activeMed)) {
      setActiveMed(pool[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planMode, autoGroups, allMedicineNames])

  const activeGroup = groups?.find(g => g.medicine_name === activeMed) || null

  const setManualQty = (medName: string, destId: string, qty: number) => {
    setManualPlan(prev => ({
      ...prev,
      [medName]: { ...(prev[medName] || {}), [destId]: qty },
    }))
  }

  const fillAllForActiveMed = () => {
    const val = parseInt(fillAllValue, 10)
    if (!activeMed || isNaN(val) || val < 0) return
    setManualPlan(prev => {
      const next: ManualQtyMap = { ...(prev[activeMed] || {}) }
      for (const b of barangayList) next[b.destination_id] = val
      return { ...prev, [activeMed]: next }
    })
  }

  const clearActiveMed = () => {
    if (!activeMed) return
    setManualPlan(prev => ({ ...prev, [activeMed]: {} }))
    setFillAllValue('')
  }

  const manualStatsForMed = (medName: string) => {
    const map = manualPlan[medName] || {}
    let filled = 0
    let total = 0
    for (const b of barangayList) {
      const v = map[b.destination_id] || 0
      if (v > 0) filled += 1
      total += v
    }
    return { filled, total }
  }

  const activeManualStats = activeMed ? manualStatsForMed(activeMed) : { filled: 0, total: 0 }

  const handleConfirmSave = async () => {
    setSaving(true)
    setSaveMsg(null)

    let rows: { destination_id: string; medicine_name: string; quantity: number }[] = []

    if (planMode === 'auto') {
      rows = autoRows.map(r => ({
        destination_id: r.destination_id,
        medicine_name: r.medicine_name,
        quantity: r.recommended_quantity,
      }))
    } else {
      for (const [medName, qtyMap] of Object.entries(manualPlan)) {
        for (const [destId, qty] of Object.entries(qtyMap)) {
          if (qty > 0) rows.push({ destination_id: destId, medicine_name: medName, quantity: qty })
        }
      }
    }

    if (rows.length === 0) {
      setSaving(false)
      setSaveMsg({ type: 'error', text: planMode === 'auto' ? 'Walang recommendation na i-se-save.' : 'Wala kang nilagyan ng quantity.' })
      return
    }

    try {
      const res = await fetch('/api/warehouse-confirm-distribution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: planMode, rows }),
      })
      const json = await res.json()
      if (!res.ok) {
        setSaveMsg({ type: 'error', text: json.error || 'Hindi na-save ang distribution plan.' })
      } else {
        setSaveMsg({ type: 'ok', text: `Na-save: ${json.barangay_rows_saved ?? rows.length} na barangay allocation.` })
      }
    } catch (err) {
      console.error('confirm-distribution error:', err)
      setSaveMsg({ type: 'error', text: 'Hindi ma-reach ang server.' })
    }

    setSaving(false)
  }

  if (loading) {
    return (
      <div style={{ ...cardStyle, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ ...headerStyle, flexShrink: 0 }}>
          <span style={headerTitleStyle}>🗺️ BARANGAY DISTRIBUTION</span>
        </div>
        <div style={{ padding: '12px 16px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[100, 80, 60].map((w, i) => (
            <div key={i} className={styles.predSkeletonBar} style={{ height: 30, width: `${w}%`, borderRadius: 8 }} />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ ...cardStyle, height: '100%' }}>
        <div style={headerStyle}>
          <span style={headerTitleStyle}>🗺️ BARANGAY DISTRIBUTION</span>
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
        </div>
      </div>
    )
  }

  return (
    <div style={{ ...cardStyle, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ ...headerStyle, flexShrink: 0 }}>
        <span style={headerTitleStyle}>🗺️ BARANGAY DISTRIBUTION</span>
        <span style={headerMetaStyle}>{totalBarangays} Barangays · Equal Split</span>
      </div>

      <div style={{ padding: '12px 16px 14px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>

        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => { setPlanMode('auto'); setSaveMsg(null) }}
            style={modeButtonStyle(planMode === 'auto')}
          >
            <span style={{ fontSize: 14 }}>🤖</span> Auto
          </button>
          <button
            onClick={() => { setPlanMode('manual'); setSaveMsg(null) }}
            style={modeButtonStyle(planMode === 'manual')}
          >
            <span style={{ fontSize: 14 }}>✍️</span> Manual
          </button>
        </div>

        {/* Exact / Buffer -- compact, isang linya lang, relevant lang sa AUTO */}
        {planMode === 'auto' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600 }}>Reserve:</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setBufferMode('exact')} style={miniTabStyle(bufferMode === 'exact')}>Exact</button>
              <button onClick={() => setBufferMode('buffered')} style={miniTabStyle(bufferMode === 'buffered')}>+15% Buffer</button>
            </div>
          </div>
        )}

        {planMode === 'auto' && autoGroups.length === 0 ? (
          <div style={emptyStyle}>Walang matitirang stock na maipapamahagi sa mga barangay ngayon.</div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 10 }}>
            {/* Kaliwa: "1. Pumili ng gamot" */}
            <div style={{ width: '38%', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
              <div style={stepLabelStyle}>1 · Piliin ang gamot</div>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 5, overflowY: 'auto', marginTop: 5 }}>
                {(planMode === 'auto' ? autoGroups.map(g => g.medicine_name) : allMedicineNames).map(medName => {
                  const isActive = medName === activeMed
                  const autoG = autoGroups.find(g => g.medicine_name === medName)
                  const mStats = planMode === 'manual' ? manualStatsForMed(medName) : null
                  const isComplete = planMode === 'manual' && mStats && mStats.filled === totalBarangays && totalBarangays > 0
                  const progressPct = mStats && totalBarangays > 0 ? (mStats.filled / totalBarangays) * 100 : 0

                  return (
                    <button
                      key={medName}
                      onClick={() => { setActiveMed(medName); setQuery('') }}
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        borderLeft: isActive ? '3px solid #16a34a' : '3px solid transparent',
                        background: isActive ? 'var(--surface2)' : 'transparent',
                        cursor: 'pointer',
                        flexShrink: 0,
                        transition: 'background .12s ease, border-color .12s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <span style={{
                          fontSize: 11.5, fontWeight: 700,
                          color: isActive ? '#0f5132' : 'var(--text)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {medName}
                        </span>
                        {planMode === 'manual' && (
                          <span style={{ fontSize: 11, flexShrink: 0 }}>{isComplete ? '✅' : mStats && mStats.filled > 0 ? '🟡' : '⚪'}</span>
                        )}
                      </div>

                      {planMode === 'auto' ? (
                        <div style={{ fontSize: 9.5, color: 'var(--text3)', marginTop: 2 }}>
                          {autoG ? `${autoG.perBarangayBase} ${autoG.unit} × ${autoG.barangayCount} brgy` : 'Walang matitira'}
                        </div>
                      ) : (
                        <>
                          <div style={{ fontSize: 9.5, color: 'var(--text3)', marginTop: 2, display: 'flex', justifyContent: 'space-between' }}>
                            <span>{mStats!.filled}/{totalBarangays} brgy</span>
                            {mStats!.total > 0 && <span style={{ color: '#16a34a', fontWeight: 700 }}>{mStats!.total} {unitFor(medName)}</span>}
                          </div>
                          <div style={{ height: 3, borderRadius: 999, background: 'var(--border)', marginTop: 4, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${progressPct}%`, background: '#16a34a', borderRadius: 999, transition: 'width .15s ease' }} />
                          </div>
                        </>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Kanan: "2. Ilagay ang dami" */}
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
              {activeMed && (
                <>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <div style={stepLabelStyle}>2 · {planMode === 'auto' ? 'Tingnan ang recommendation' : 'Ilagay ang dami bawat barangay'}</div>
                    {planMode === 'manual' && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: activeManualStats.filled > 0 ? '#16a34a' : 'var(--text3)' }}>
                        {activeManualStats.filled}/{totalBarangays}
                      </span>
                    )}
                  </div>

                  {planMode === 'manual' && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexShrink: 0 }}>
                      <input
                        value={fillAllValue}
                        onChange={e => setFillAllValue(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="Qty"
                        style={{ ...inputStyle, width: 48, textAlign: 'center' }}
                      />
                      <button onClick={fillAllForActiveMed} style={fillAllButtonStyle} title="Ilagay ang quantity na ito sa LAHAT ng barangay">
                        Fill All
                      </button>
                      <button onClick={clearActiveMed} style={clearButtonStyle} title="Burahin lahat ng nilagay para sa gamot na ito">
                        ✕
                      </button>
                    </div>
                  )}

                  <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
                    {planMode === 'auto' ? (
                      (activeGroup?.rows.length ?? 0) === 0 ? (
                        <div style={rowEmptyStyle}>Walang barangay na matitira para sa gamot na ito.</div>
                      ) : (
                        activeGroup!.rows.map(r => (
                          <div key={r.destination_id} style={rowStyle}>
                            <span style={rowLabelStyle}>{r.barangay_name}</span>
                            <span style={{ fontWeight: 700, color: '#16a34a', flexShrink: 0, marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>
                              {r.recommended_quantity} {r.unit}
                            </span>
                          </div>
                        ))
                      )
                    ) : barangayList.length === 0 ? (
                      <div style={rowEmptyStyle}>Walang barangay na nakalista.</div>
                    ) : (
                      barangayList.map(b => {
                        const val = manualPlan[activeMed]?.[b.destination_id] ?? 0
                        const hasVal = val > 0
                        return (
                          <div
                            key={b.destination_id}
                            style={{ ...rowStyle, background: hasVal ? '#dcfce7' : 'var(--surface2)' }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                              <span style={{ fontSize: 10, flexShrink: 0, width: 12, textAlign: 'center' }}>{hasVal ? '✓' : ''}</span>
                              <span style={{ ...rowLabelStyle, color: hasVal ? '#0f5132' : 'var(--text2)', fontWeight: hasVal ? 600 : 400 }}>
                                {b.barangay_name}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 6 }}>
                              <input
                                type="number"
                                min={0}
                                value={val || ''}
                                onChange={e => setManualQty(activeMed, b.destination_id, Math.max(0, parseInt(e.target.value, 10) || 0))}
                                placeholder="0"
                                style={{
                                  ...qtyInputStyle,
                                  borderColor: hasVal ? '#16a34a' : 'var(--border)',
                                  color: hasVal ? '#0f5132' : 'var(--text)',
                                  fontWeight: hasVal ? 700 : 400,
                                }}
                              />
                              <span style={{ fontSize: 9.5, color: 'var(--text3)' }}>{unitFor(activeMed)}</span>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Confirm & Save */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {saveMsg && (
            <div style={{
              fontSize: 10.5, padding: '5px 8px', borderRadius: 6,
              background: saveMsg.type === 'ok' ? '#dcfce7' : '#fee2e2',
              color: saveMsg.type === 'ok' ? '#16a34a' : '#dc2626',
            }}>
              {saveMsg.type === 'ok' ? '✓ ' : '⚠ '}{saveMsg.text}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handleConfirmSave}
              disabled={saving}
              style={{
                flex: 1, fontSize: 11.5, fontWeight: 700, padding: '9px 12px', borderRadius: 8,
                border: 'none', color: '#fff', cursor: saving ? 'default' : 'pointer',
                background: 'linear-gradient(135deg,#0f5132,#16a34a)', opacity: saving ? 0.6 : 1,
                boxShadow: '0 2px 6px rgba(22,163,74,0.25)',
              }}
            >
              {saving ? 'Saving…' : `Confirm & Save (${planMode === 'auto' ? 'Auto' : 'Manual'})`}
            </button>
            {lastComputed && (
              <div style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  onClick={fetchPrediction}
                  disabled={refreshing}
                  style={{ background: 'none', border: 'none', color: 'var(--green, #16a34a)', fontWeight: 700, cursor: refreshing ? 'default' : 'pointer', fontSize: 10, padding: 0, opacity: refreshing ? 0.6 : 1 }}
                >
                  {refreshing ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function modeButtonStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    fontSize: 12,
    fontWeight: 700,
    borderRadius: 8,
    padding: '8px 10px',
    border: '1px solid ' + (active ? 'transparent' : 'var(--border)'),
    background: active ? 'linear-gradient(135deg,#0f5132,#16a34a)' : 'var(--surface2)',
    color: active ? '#fff' : 'var(--text3)',
    cursor: 'pointer',
    transition: 'background .15s ease, color .15s ease',
  }
}

function miniTabStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    borderRadius: 6,
    padding: '3px 8px',
    border: '1px solid ' + (active ? '#16a34a' : 'var(--border)'),
    background: active ? '#dcfce7' : 'transparent',
    color: active ? '#16a34a' : 'var(--text3)',
    cursor: 'pointer',
  }
}

const stepLabelStyle: React.CSSProperties = {
  fontSize: 9.5, fontWeight: 800, color: 'var(--text3)', letterSpacing: '.04em', textTransform: 'uppercase',
}

const inputStyle: React.CSSProperties = {
  fontSize: 11, padding: '6px 8px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--surface2)',
  color: 'var(--text)', outline: 'none',
}

const fillAllButtonStyle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, padding: '6px 10px', borderRadius: 6,
  border: '1px solid #16a34a', background: '#dcfce7', color: '#16a34a',
  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
}

const clearButtonStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, padding: '6px 9px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'transparent', color: 'var(--text3)',
  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
}

const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  fontSize: 11, padding: '5px 8px', borderRadius: 6, background: 'var(--surface2)',
  transition: 'background .12s ease',
}

const rowLabelStyle: React.CSSProperties = {
  color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

const rowEmptyStyle: React.CSSProperties = {
  fontSize: 10.5, color: 'var(--text3)', padding: '6px 0', textAlign: 'center',
}

const qtyInputStyle: React.CSSProperties = {
  width: 44, fontSize: 11, padding: '3px 6px', borderRadius: 5,
  border: '1.5px solid var(--border)', background: 'var(--surface)',
  outline: 'none', textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums',
}

// ---- Shared inline styles (mirrors PredictionCard / MedicineMovementAnalytics) ----
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