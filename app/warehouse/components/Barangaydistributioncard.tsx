'use client'
import { useState, useEffect, useMemo } from 'react'
import styles from './warehouse.module.css'
import { useWarehousePrediction } from './Usewarehouseprediction'

// ---- Response shape returned by /api/warehouse-predict (proxies to
// warehouse_ml/api_server.py's POST /predict-distribution). Ito yung
// TUNAY na per-barangay recommendation -- WALANG ML dito, plain
// arithmetic lang mula sa barangay_distribution.py (CASCADING box ->
// strip -> piece equal split + leftover allocation). ----
interface BarangayRecommendationRow {
  destination_id: string
  barangay_name: string
  medicine_name: string
  unit: string
  recommended_quantity: number       // total sa PIECES (para sa DB storage)
  recommended_boxes: number
  recommended_strips: number
  recommended_pieces: number
}

interface StockReserveRow {
  medicine_name: string
  unit: string
  current_stock_sa_warehouse?: number
  pieces_per_box?: number | null
  pieces_per_strip?: number | null
  // >>> BAGO: klase ng gamot (Tablet/Capsule/Suspension/Drops/atbp.)
  // mula sa medicines.dosage_form -- ipinapakita bilang badge sa
  // medicine list, at ginagamit para pilitin ang "pcs"-lang na input
  // kapag Drops (tingnan ang isDropsForm() sa ibaba).
  dosage_form?: string | null
}

interface EqualDistributionRow {
  medicine_name: string
  unit: string
  available_for_distribution: number
  boxes_per_barangay: number
  strips_per_barangay: number
  pieces_per_barangay: number
  leftover_units: number
}

interface PredictResponse {
  number_of_barangays: number
  barangay_recommendation_exact: BarangayRecommendationRow[]
  barangay_recommendation_buffered: BarangayRecommendationRow[]
  barangay_equal_distribution_exact: EqualDistributionRow[]
  barangay_equal_distribution_buffered: EqualDistributionRow[]
  stock_and_reserve_summary: StockReserveRow[]
}

type BufferMode = 'exact' | 'buffered'
type PlanMode = 'auto' | 'manual'
type InputUnit = 'box' | 'strip' | 'pcs'

interface MedicineGroup {
  medicine_name: string
  unit: string
  barangayCount: number
  totalUnits: number
  perBarangayBoxes: number
  perBarangayStrips: number
  perBarangayPieces: number
  perBarangayTotalPieces: number
  rows: BarangayRecommendationRow[]
}

// >>> BAGO: helpers para sa dosage_form (Tablet/Capsule/Suspension/
// Drops/atbp.) -- ginagamit para ipakita ang klase ng gamot bilang
// badge, at para malaman kung "Drops" (dapat i-pilit na "pcs" lang
// ang input unit, hindi Box/Strip -- karaniwang bote-bote, hindi
// strip/blister pack, ang packaging ng drops).
function isDropsForm(form?: string | null): boolean {
  return !!form && form.toLowerCase().includes('drop')
}

function formIcon(form?: string | null): string {
  const f = (form || '').toLowerCase()
  if (f.includes('drop')) return '💧'
  if (f.includes('nebule') || f.includes('inhal')) return '💨'
  if (f.includes('syrup') || f.includes('suspension')) return '🧴'
  if (f.includes('capsule')) return '💊'
  if (f.includes('tablet')) return '💊'
  return '💊'
}

function formatPackagingBreakdown(
  boxes: number,
  strips: number,
  pieces: number,
  totalPieces?: number
): string {
  const parts: string[] = []
  if (boxes > 0) parts.push(`${boxes} box${boxes !== 1 ? 'es' : ''}`)
  if (strips > 0) parts.push(`${strips} strip${strips !== 1 ? 's' : ''}`)
  if (pieces > 0 || parts.length === 0) parts.push(`${pieces} pcs`)

  const breakdown = parts.join(' + ')
  const isMixedUnits = boxes > 0 || strips > 0

  if (isMixedUnits && typeof totalPieces === 'number') {
    return `${breakdown} (= ${totalPieces.toLocaleString()} pcs total)`
  }
  return breakdown
}

function formatTotalAvailableBreakdown(
  totalPieces: number,
  piecesPerBox?: number | null,
  piecesPerStrip?: number | null
): string {
  if (totalPieces <= 0) return '0 pcs'
  const hasBox = !!piecesPerBox && piecesPerBox > 0
  const hasStrip = !!piecesPerStrip && piecesPerStrip > 0
  if (!hasBox && !hasStrip) return `${totalPieces.toLocaleString()} pcs`

  let remaining = totalPieces
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
      const first = rs[0]
      return {
        medicine_name,
        unit: first?.unit || 'unit',
        barangayCount: rs.length,
        totalUnits,
        perBarangayBoxes: first?.recommended_boxes ?? 0,
        perBarangayStrips: first?.recommended_strips ?? 0,
        perBarangayPieces: first?.recommended_pieces ?? 0,
        perBarangayTotalPieces: first?.recommended_quantity ?? 0,
        rows: [...rs].sort((a, b) => a.barangay_name.localeCompare(b.barangay_name)),
      }
    })
    .sort((a, b) => b.totalUnits - a.totalUnits)
}

type ManualQtyMap = Record<string, number>
type ManualPlan = Record<string, ManualQtyMap>

export default function BarangayDistributionCard() {
  const { data, loading, error, refreshing, lastComputed, refresh: fetchPrediction } = useWarehousePrediction() as {
    data: PredictResponse | null
    loading: boolean
    error: string
    refreshing: boolean
    lastComputed: Date | null
    refresh: () => void
  }

  const [bufferMode, setBufferMode] = useState<BufferMode>('buffered')
  const [planMode, setPlanMode] = useState<PlanMode>('auto')
  const [activeMed, setActiveMed] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const [manualPlan, setManualPlan] = useState<ManualPlan>({})
  const [fillAllValue, setFillAllValue] = useState('')
  const [inputUnit, setInputUnit] = useState<InputUnit>('pcs')

  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const autoRows = bufferMode === 'exact'
    ? data?.barangay_recommendation_exact || []
    : data?.barangay_recommendation_buffered || []

  const autoGroups = useMemo(() => groupByMedicine(autoRows), [autoRows])

  const leftoverByMed = useMemo(() => {
    const rows = bufferMode === 'exact'
      ? data?.barangay_equal_distribution_exact || []
      : data?.barangay_equal_distribution_buffered || []
    const map = new Map<string, number>()
    for (const r of rows) map.set(r.medicine_name, r.leftover_units)
    return map
  }, [data, bufferMode])

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

  const unitByMed = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of data?.stock_and_reserve_summary || []) map.set(r.medicine_name, r.unit || 'unit')
    for (const g of autoGroups) if (!map.has(g.medicine_name)) map.set(g.medicine_name, g.unit)
    return map
  }, [data, autoGroups])

  const packagingByMed = useMemo(() => {
    const map = new Map<string, { piecesPerBox: number | null; piecesPerStrip: number | null }>()
    for (const r of data?.stock_and_reserve_summary || []) {
      map.set(r.medicine_name, {
        piecesPerBox: r.pieces_per_box ?? null,
        piecesPerStrip: r.pieces_per_strip ?? null,
      })
    }
    return map
  }, [data])

  // >>> BAGO: medicine_name -> dosage_form (Tablet/Capsule/Suspension/
  // Drops/atbp.), para ipakita bilang badge at para malaman kung
  // "Drops" ang kasalukuyang piniling gamot.
  const dosageFormByMed = useMemo(() => {
    const map = new Map<string, string | null | undefined>()
    for (const r of data?.stock_and_reserve_summary || []) {
      map.set(r.medicine_name, r.dosage_form)
    }
    return map
  }, [data])

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

  useEffect(() => {
    if (!activeMed) return
    const pkg = packagingByMed.get(activeMed)
    const dropsForm = isDropsForm(dosageFormByMed.get(activeMed))
    if (inputUnit === 'box' && (!pkg?.piecesPerBox || dropsForm)) setInputUnit('pcs')
    if (inputUnit === 'strip' && (!pkg?.piecesPerStrip || dropsForm)) setInputUnit('pcs')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMed])

  const activeGroup = groups?.find(g => g.medicine_name === activeMed) || null
  const activePkg = activeMed ? packagingByMed.get(activeMed) : undefined
  const activeDosageForm = activeMed ? dosageFormByMed.get(activeMed) : undefined
  const activeIsDrops = isDropsForm(activeDosageForm)

  const activeMultiplier = useMemo(() => {
    if (inputUnit === 'box') return activePkg?.piecesPerBox || 0
    if (inputUnit === 'strip') return activePkg?.piecesPerStrip || 0
    return 1
  }, [inputUnit, activePkg])

  const filteredAutoRows = useMemo(() => {
    const rows = activeGroup?.rows || []
    const q = query.trim().toLowerCase()
    return q ? rows.filter(r => r.barangay_name.toLowerCase().includes(q)) : rows
  }, [activeGroup, query])

  const filteredBarangayList = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? barangayList.filter(b => b.barangay_name.toLowerCase().includes(q)) : barangayList
  }, [barangayList, query])

  const setManualQty = (medName: string, destId: string, qtyInCurrentUnit: number) => {
    const multiplier = activeMultiplier || 1
    const qtyInPieces = qtyInCurrentUnit * multiplier
    setManualPlan(prev => ({
      ...prev,
      [medName]: { ...(prev[medName] || {}), [destId]: qtyInPieces },
    }))
  }

  const fillAllForActiveMed = () => {
    const val = parseInt(fillAllValue, 10)
    if (!activeMed || isNaN(val) || val < 0) return
    const multiplier = activeMultiplier || 1
    const qtyInPieces = val * multiplier
    setManualPlan(prev => {
      const next: ManualQtyMap = { ...(prev[activeMed] || {}) }
      for (const b of barangayList) next[b.destination_id] = qtyInPieces
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
        const detailText = typeof json.detail === 'string'
          ? json.detail
          : json.detail
            ? JSON.stringify(json.detail)
            : ''
        setSaveMsg({
          type: 'error',
          text: [json.error, detailText].filter(Boolean).join(' — ') || 'Hindi na-save ang distribution plan.',
        })
      } else {
        const medCount = new Set(rows.map(r => r.medicine_name)).size
        const brgyCount = new Set(rows.map(r => r.destination_id)).size
        const rowsSaved = json.barangay_rows_saved ?? rows.length
        setSaveMsg({
          type: 'ok',
          text: `Na-save: ${brgyCount} barangay × ${medCount} gamot = ${rowsSaved} allocation.`,
        })
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
          <HeaderTitle />
        </div>
        <div style={{ padding: '17px 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[100, 80, 60].map((w, i) => (
            <div key={i} className={styles.predSkeletonBar} style={{ height: 40, width: `${w}%`, borderRadius: 10 }} />
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
        </div>
      </div>
    )
  }

  return (
    <div style={{ ...cardStyle, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ ...headerStyle, flexShrink: 0 }}>
        <HeaderTitle />
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={headerChipStyle(true)}>{totalBarangays} barangays</span>
          <span style={headerChipStyle(false)}>Equal split</span>
        </div>
      </div>

      <div style={{ padding: '17px 20px 19px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={() => { setPlanMode('auto'); setSaveMsg(null) }} style={modeButtonStyle(planMode === 'auto')}>
            <span style={{ fontSize: 14 }}>🤖</span> Auto
          </button>
          <button onClick={() => { setPlanMode('manual'); setSaveMsg(null) }} style={modeButtonStyle(planMode === 'manual')}>
            <span style={{ fontSize: 14 }}>✍️</span> Manual
          </button>
        </div>

        {planMode === 'auto' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600 }}>Reserve:</span>
            <div style={{ display: 'flex', gap: 5 }}>
              <button onClick={() => setBufferMode('exact')} style={miniTabStyle(bufferMode === 'exact')}>Exact</button>
              <button onClick={() => setBufferMode('buffered')} style={miniTabStyle(bufferMode === 'buffered')}>+15% Buffer</button>
            </div>
            {bufferMode === 'exact' && (
              <span style={{ fontSize: 9, color: 'var(--text3)', fontStyle: 'italic' }}>
                (iba ito sa Demand Forecast — laging buffered ang doon)
              </span>
            )}
          </div>
        )}

        {planMode === 'manual' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600 }}>I-input bilang:</span>
            <div style={{ display: 'flex', gap: 5 }}>
              <button
                onClick={() => setInputUnit('box')}
                disabled={!activePkg?.piecesPerBox || activeIsDrops}
                title={activeIsDrops ? 'Drops -- pcs (bote) lang ang input dito' : !activePkg?.piecesPerBox ? 'Walang box packaging info ang gamot na ito' : undefined}
                style={miniTabStyle(inputUnit === 'box', !activePkg?.piecesPerBox || activeIsDrops)}
              >
                Box
              </button>
              <button
                onClick={() => setInputUnit('strip')}
                disabled={!activePkg?.piecesPerStrip || activeIsDrops}
                title={activeIsDrops ? 'Drops -- pcs (bote) lang ang input dito' : !activePkg?.piecesPerStrip ? 'Walang strip packaging info ang gamot na ito' : undefined}
                style={miniTabStyle(inputUnit === 'strip', !activePkg?.piecesPerStrip || activeIsDrops)}
              >
                Strip
              </button>
              <button onClick={() => setInputUnit('pcs')} style={miniTabStyle(inputUnit === 'pcs')}>
                Pcs
              </button>
            </div>
            {inputUnit !== 'pcs' && activeMultiplier > 0 && (
              <span style={{ fontSize: 9, color: 'var(--text3)' }}>(1 {inputUnit} = {activeMultiplier} pcs)</span>
            )}
            {activeIsDrops && (
              <span style={{ fontSize: 9, color: 'var(--text3)', fontStyle: 'italic' }}>
                💧 Drops -- pcs (bilang ng bote) lang
              </span>
            )}
          </div>
        )}

        {planMode === 'auto' && autoGroups.length === 0 ? (
          <div style={emptyStyle}>Walang matitirang stock na maipapamahagi sa mga barangay ngayon.</div>
        ) : (
          <div style={{ flex: 1, minHeight: 340, display: 'flex', gap: 16 }}>
            {/* Kaliwa: pumili ng gamot */}
            <div style={{ width: '40%', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <StepLabel n={1} text="Piliin ang gamot" />
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', marginTop: 10 }}>
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
                        padding: '12px 14px',
                        borderRadius: 12,
                        border: '1px solid var(--border)',
                        borderLeft: isActive ? '4px solid #16a34a' : '4px solid transparent',
                        background: isActive ? 'var(--surface2)' : 'transparent',
                        cursor: 'pointer',
                        flexShrink: 0,
                        transition: 'background .12s ease, border-color .12s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{
                          fontSize: 11.5, fontWeight: 700,
                          color: isActive ? '#0f5132' : 'var(--text)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {medName}
                        </span>
                        {planMode === 'manual' && (
                          <span style={{ fontSize: 11.5, flexShrink: 0 }}>{isComplete ? '✅' : mStats && mStats.filled > 0 ? '🟡' : '⚪'}</span>
                        )}
                      </div>

                      {dosageFormByMed.get(medName) && (
                        <span style={dosageFormBadgeStyle}>
                          {formIcon(dosageFormByMed.get(medName))} {dosageFormByMed.get(medName)}
                        </span>
                      )}

                      {planMode === 'auto' ? (
                        <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 700, marginTop: 4 }}>
                          {autoG ? (
                            formatTotalAvailableBreakdown(
                              autoG.totalUnits + (leftoverByMed.get(medName) || 0),
                              packagingByMed.get(medName)?.piecesPerBox,
                              packagingByMed.get(medName)?.piecesPerStrip
                            )
                          ) : 'Walang matitira'}
                        </div>
                      ) : (
                        <>
                          <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                            <span>{mStats!.filled}/{totalBarangays} brgy</span>
                            {mStats!.total > 0 && <span style={{ color: '#16a34a', fontWeight: 700 }}>{mStats!.total} pcs</span>}
                          </div>
                          <div style={{ height: 4, borderRadius: 999, background: 'var(--border)', marginTop: 6, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${progressPct}%`, background: '#16a34a', borderRadius: 999, transition: 'width .15s ease' }} />
                          </div>
                        </>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Kanan: ilagay ang dami */}
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {activeMed && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <StepLabel n={2} text={planMode === 'auto' ? 'Tingnan ang recommendation' : 'Ilagay ang dami bawat barangay'} />
                      {activeDosageForm && (
                        <span style={dosageFormBadgeStyle}>{formIcon(activeDosageForm)} {activeDosageForm}</span>
                      )}
                    </div>
                    {planMode === 'manual' && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: activeManualStats.filled > 0 ? '#16a34a' : 'var(--text3)', flexShrink: 0 }}>
                        {activeManualStats.filled}/{totalBarangays}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexShrink: 0 }}>
                    <input
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      placeholder="Hanapin ang barangay..."
                      style={{ ...inputStyle, flex: 1, boxSizing: 'border-box' }}
                    />
                    {planMode === 'manual' && (
                      <>
                        <input
                          value={fillAllValue}
                          onChange={e => setFillAllValue(e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder={inputUnit === 'pcs' ? 'Qty' : `Qty (${inputUnit})`}
                          style={{ ...inputStyle, width: 78, textAlign: 'center' }}
                        />
                        <button onClick={fillAllForActiveMed} style={fillAllButtonStyle} title="Ilagay ang quantity na ito sa LAHAT ng barangay">
                          Fill all
                        </button>
                        <button onClick={clearActiveMed} style={clearButtonStyle} title="Burahin lahat ng nilagay para sa gamot na ito">
                          ✕
                        </button>
                      </>
                    )}
                  </div>

                  <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10 }}>
                    {planMode === 'auto' ? (
                      filteredAutoRows.length === 0 ? (
                        <div style={rowEmptyStyle}>Walang barangay na matitira para sa gamot na ito.</div>
                      ) : (
                        filteredAutoRows.map(r => (
                          <div key={r.destination_id} style={rowStyle}>
                            <span style={rowLabelStyle}>{r.barangay_name}</span>
                            <span style={{ fontWeight: 700, color: '#16a34a', flexShrink: 0, marginLeft: 8, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                              {formatPackagingBreakdown(r.recommended_boxes, r.recommended_strips, r.recommended_pieces, r.recommended_quantity)}
                            </span>
                          </div>
                        ))
                      )
                    ) : filteredBarangayList.length === 0 ? (
                      <div style={rowEmptyStyle}>Walang nahanap na barangay.</div>
                    ) : (
                      filteredBarangayList.map(b => {
                        const storedPieces = manualPlan[activeMed]?.[b.destination_id] ?? 0
                        const multiplier = activeMultiplier || 1
                        const displayValue = multiplier > 0 ? storedPieces / multiplier : storedPieces
                        const hasVal = storedPieces > 0
                        return (
                          <div key={b.destination_id} style={{ ...rowStyle, background: hasVal ? '#dcfce7' : 'var(--surface2)' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, minWidth: 0, flex: 1 }}>
                              <span style={{ fontSize: 9.5, flexShrink: 0, width: 14, textAlign: 'center' }}>{hasVal ? '✓' : ''}</span>
                              <span style={{ ...rowLabelStyle, color: hasVal ? '#0f5132' : 'var(--text2)', fontWeight: hasVal ? 600 : 400 }}>
                                {b.barangay_name}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                              {inputUnit !== 'pcs' && hasVal && !Number.isInteger(displayValue) && (
                                <span style={{ fontSize: 9, color: 'var(--text3)' }}>({storedPieces} pcs)</span>
                              )}
                              <input
                                type="number"
                                min={0}
                                value={displayValue || ''}
                                onChange={e => setManualQty(activeMed, b.destination_id, Math.max(0, parseInt(e.target.value, 10) || 0))}
                                placeholder="0"
                                style={{
                                  ...qtyInputStyle,
                                  borderColor: hasVal ? '#16a34a' : 'var(--border)',
                                  color: hasVal ? '#0f5132' : 'var(--text)',
                                  fontWeight: hasVal ? 700 : 400,
                                }}
                              />
                              <span style={{ fontSize: 9, color: 'var(--text3)' }}>{inputUnit}</span>
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
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '14px 0 2px',
            borderTop: '1px solid var(--border)',
            background: 'var(--surface, #fff)',
          }}
        >
          {saveMsg && (
            <div style={{
              fontSize: 10, padding: '8px 12px', borderRadius: 9,
              background: saveMsg.type === 'ok' ? '#dcfce7' : '#fee2e2',
              color: saveMsg.type === 'ok' ? '#16a34a' : '#dc2626',
              wordBreak: 'break-word',
            }}>
              {saveMsg.type === 'ok' ? '✓ ' : '⚠ '}{saveMsg.text}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <button
              onClick={handleConfirmSave}
              disabled={saving}
              style={{
                flex: 1, fontSize: 11.5, fontWeight: 700, padding: '13px 16px', borderRadius: 11,
                border: 'none', color: '#fff', cursor: saving ? 'default' : 'pointer',
                background: 'linear-gradient(135deg,#0f5132,#16a34a)', opacity: saving ? 0.6 : 1,
                boxShadow: '0 3px 10px rgba(22,163,74,0.28)',
              }}
            >
              {saving ? 'Saving…' : `Confirm & save (${planMode === 'auto' ? 'Auto' : 'Manual'})`}
            </button>
            {lastComputed && (
              <button
                onClick={fetchPrediction}
                disabled={refreshing}
                style={refreshButtonStyle(refreshing)}
              >
                <span style={refreshing ? { ...spinIconStyle, animation: 'brgySpin .8s linear infinite' } : spinIconStyle}>⟳</span>
                {refreshing ? 'Refreshing' : 'Refresh'}
              </button>
            )}
          </div>
        </div>
      </div>

      <style>{`@keyframes brgySpin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function HeaderTitle() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={headerIconBadgeStyle}>🗺️</span>
      <span style={headerTitleTextStyle}>Barangay distribution</span>
    </div>
  )
}

function StepLabel({ n, text }: { n: number; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={stepBadgeStyle}>{n}</span>
      <span style={stepTextStyle}>{text}</span>
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
    borderRadius: 9,
    padding: '8px 12px',
    border: '1px solid ' + (active ? 'transparent' : 'var(--border)'),
    background: active ? 'linear-gradient(135deg,#0f5132,#16a34a)' : 'var(--surface2)',
    color: active ? '#fff' : 'var(--text3)',
    cursor: 'pointer',
    boxShadow: active ? '0 2px 6px rgba(22,163,74,.25)' : 'none',
    transition: 'background .15s ease, color .15s ease',
  }
}

function miniTabStyle(active: boolean, disabled?: boolean): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    borderRadius: 8,
    padding: '6px 12px',
    border: '1px solid ' + (active ? '#16a34a' : 'var(--border)'),
    background: active ? '#dcfce7' : 'transparent',
    color: disabled ? 'var(--border)' : active ? '#16a34a' : 'var(--text3)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
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
    padding: '9px 16px',
    cursor: refreshing ? 'default' : 'pointer',
    opacity: refreshing ? 0.75 : 1,
    flexShrink: 0,
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

const stepBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: 6,
  fontSize: 9,
  fontWeight: 800,
  flexShrink: 0,
  background: 'linear-gradient(135deg,#16a34a,#22c55e)',
  color: '#fff',
}
const stepTextStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--text2)',
}

// >>> BAGO: badge para sa dosage_form (Tablet/Capsule/Suspension/
// Drops/atbp.) sa medicine list.
const dosageFormBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 9.5,
  fontWeight: 600,
  color: 'var(--text3)',
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  padding: '2px 8px',
  borderRadius: 999,
  marginTop: 5,
}

const inputStyle: React.CSSProperties = {
  fontSize: 11, padding: '9px 12px', borderRadius: 9,
  border: '1px solid var(--border)', background: 'var(--surface2)',
  color: 'var(--text)', outline: 'none',
}

const fillAllButtonStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, padding: '8px 13px', borderRadius: 9,
  border: '1px solid #16a34a', background: '#dcfce7', color: '#16a34a',
  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
}

const clearButtonStyle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, padding: '8px 12px', borderRadius: 9,
  border: '1px solid var(--border)', background: 'transparent', color: 'var(--text3)',
  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
}

const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8,
  fontSize: 10.5, padding: '8px 12px', borderRadius: 9, background: 'var(--surface2)',
  transition: 'background .12s ease',
}

const rowLabelStyle: React.CSSProperties = {
  color: 'var(--text2)', flex: 1, minWidth: 0, wordBreak: 'break-word',
}

const rowEmptyStyle: React.CSSProperties = {
  fontSize: 10, color: 'var(--text3)', padding: '10px 0', textAlign: 'center',
}

const qtyInputStyle: React.CSSProperties = {
  width: 56, fontSize: 10.5, padding: '5px 8px', borderRadius: 7,
  border: '1.5px solid var(--border)', background: 'var(--surface)',
  outline: 'none', textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums',
}

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

// ---- Shared inline styles (mirrors PredictionCard) ----
const cardStyle: React.CSSProperties = {
  background: 'var(--surface, #fff)',
  border: '1px solid var(--border)',
  borderRadius: 18,
  overflowY: 'auto',
  overflowX: 'hidden',
  boxShadow: '0 6px 28px rgba(13,59,31,0.12)',
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