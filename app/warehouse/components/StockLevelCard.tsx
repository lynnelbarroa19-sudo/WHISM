'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import styles from './warehouse.module.css'

type StockFilter = 'all' | 'highest' | 'medium' | 'lowest'
type SourceFilter = 'all' | 'DOH' | 'PhilHealth' | 'LGU'
type BatchFilter = 'all' | string // 'all' = summed across batches, otherwise a specific batch_number

// Raw batch data as pulled from Supabase (before any filter is applied)
interface RawBatch {
  batch_id: string
  medicine_id: string
  batch_number: string | null
  total_quantity: number
  expiration_date: string | null
  source: string | null
}

interface CatalogEntry {
  medicine_id: string
  generic_name: string
  dosage_strength: string | null
  dosage_form: string | null
  unit: string | null
}

// One row per MEDICINE — quantities summed across whichever batches survive
// the current source/level filters. Shown when batchFilter === 'all'.
interface MedicineRow {
  id: string
  med_name: string
  med_dosage: string
  med_type: string
  quantity: number
  exp_date: string | null   // soonest expiring batch counted in this total
  unit: string
  batchCount: number
}

// One row per BATCH — shown when a specific batch_number is selected.
// The same batch_number can appear across several medicines, so this can
// have more than one row for that batch.
interface BatchRow {
  id: string               // batch_id
  med_name: string
  med_dosage: string
  med_type: string
  quantity: number
  exp_date: string | null
  unit: string
  batch_number: string | null
  source: string | null
}

type StockRow = MedicineRow | BatchRow
function isBatchRow(row: StockRow): row is BatchRow {
  return 'batch_number' in row
}

const HIGH_MIN   = 60
const MEDIUM_MIN = 30

function getLevel(qty: number): 'highest' | 'medium' | 'lowest' {
  if (qty >= HIGH_MIN)   return 'highest'
  if (qty >= MEDIUM_MIN) return 'medium'
  return 'lowest'
}

function levelColor(level: string) {
  if (level === 'highest') return '#16a34a'
  if (level === 'medium')  return '#f59e0b'
  return '#ef4444'
}

function levelBg(level: string) {
  if (level === 'highest') return 'rgba(22,163,74,.12)'
  if (level === 'medium')  return 'rgba(245,158,11,.12)'
  return 'rgba(239,68,68,.12)'
}

function sourceColor(source: string | null) {
  if (source === 'DOH')        return '#2563eb'
  if (source === 'PhilHealth') return '#7c3aed'
  if (source === 'LGU')        return '#0d9488'
  return 'var(--text3)'
}

const VISIBLE_COUNT = 5
const CARD_HEIGHT = 340

const selectStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '3px 8px',
  fontSize: 10.5,
  fontWeight: 700,
  fontFamily: 'inherit',
  background: 'var(--surface, #fff)',
  color: 'var(--text)',
  cursor: 'pointer',
}

export default function StockLevelCard() {
  const [catalog,         setCatalog]         = useState<CatalogEntry[]>([])
  const [rawBatches,      setRawBatches]      = useState<RawBatch[]>([])
  const [loading,         setLoading]         = useState(true)
  const [fetchError,      setFetchError]      = useState('')
  const [filter,          setFilter]          = useState<StockFilter>('all')
  const [batchFilter,     setBatchFilter]     = useState<BatchFilter>('all')
  const [sourceFilter,    setSourceFilter]    = useState<SourceFilter>('all')
  const [showOthersPopup, setShowOthersPopup] = useState(false)

  useEffect(() => { fetchMedicines() }, [])

  // Stock lives on medicine_batches (total_quantity, expiration_date, source
  // per batch). This pulls catalog + all active batches ONCE, then every
  // view (All / specific batch, All / DOH / PhilHealth / LGU) is derived
  // client-side in the useMemo below — no refetch on filter change.
  async function fetchMedicines() {
    setLoading(true)
    setFetchError('')

    const { data: catalogData, error: catalogError } = await supabase
      .from('medicines')
      .select('medicine_id, generic_name, dosage_strength, dosage_form, unit')
      .eq('is_archived', false)
      .eq('status', 'active')

    if (catalogError) {
      console.error('Stock level fetch error (medicines):', catalogError)
      setFetchError('Could not load medicines. Check your connection and try again.')
      setLoading(false)
      return
    }

    const today = new Date().toISOString().split('T')[0]
    const { data: batches, error: batchesError } = await supabase
      .from('medicine_batches')
      .select('batch_id, medicine_id, batch_number, total_quantity, expiration_date, source, status')
      .in('status', ['available', 'low_stock'])
      .gt('total_quantity', 0)

    if (batchesError) {
      console.error('Stock level fetch error (medicine_batches):', batchesError)
      setFetchError('Could not load stock levels. Check your connection and try again.')
      setLoading(false)
      return
    }

    const activeBatches = (batches || []).filter(b => !b.expiration_date || b.expiration_date >= today)

    setCatalog(catalogData || [])
    setRawBatches(activeBatches as RawBatch[])
    setLoading(false)
  }

  // Distinct batch numbers available across ALL active batches (not
  // narrowed by source, so switching source never hides a batch option).
  const batchOptions = useMemo(() => {
    const set = new Set<string>()
    for (const b of rawBatches) {
      if (b.batch_number) set.add(b.batch_number)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }, [rawBatches])

  const catalogById = useMemo(
    () => new Map(catalog.map(m => [m.medicine_id, m])),
    [catalog]
  )

  // Rows for the current batch + source selection.
  const rows: StockRow[] = useMemo(() => {
    const sourceFiltered = sourceFilter === 'all'
      ? rawBatches
      : rawBatches.filter(b => b.source === sourceFilter)

    if (batchFilter === 'all') {
      // Sum per medicine across whatever batches survived the source filter.
      const totalsByMed = new Map<string, number>()
      const soonestExpByMed = new Map<string, string | null>()
      const batchCountByMed = new Map<string, number>()
      for (const b of sourceFiltered) {
        totalsByMed.set(b.medicine_id, (totalsByMed.get(b.medicine_id) || 0) + b.total_quantity)
        batchCountByMed.set(b.medicine_id, (batchCountByMed.get(b.medicine_id) || 0) + 1)
        if (b.expiration_date) {
          const current = soonestExpByMed.get(b.medicine_id)
          if (!current || b.expiration_date < current) soonestExpByMed.set(b.medicine_id, b.expiration_date)
        } else if (!soonestExpByMed.has(b.medicine_id)) {
          soonestExpByMed.set(b.medicine_id, null)
        }
      }

      const medList: MedicineRow[] = catalog
        .map(m => {
          const quantity = totalsByMed.get(m.medicine_id) || 0
          if (quantity <= 0) return null
          return {
            id: m.medicine_id,
            med_name: m.generic_name,
            med_dosage: m.dosage_strength || '',
            med_type: m.dosage_form || '',
            quantity,
            exp_date: soonestExpByMed.get(m.medicine_id) ?? null,
            unit: m.unit || '',
            batchCount: batchCountByMed.get(m.medicine_id) || 0,
          } as MedicineRow
        })
        .filter((m): m is MedicineRow => m !== null)
        .sort((a, b) => b.quantity - a.quantity)

      return medList
    }

    // Specific batch selected — one row per matching batch (can span
    // several medicines that each happen to have a batch with this number).
    const batchList: BatchRow[] = sourceFiltered
      .filter(b => b.batch_number === batchFilter)
      .map(b => {
        const med = catalogById.get(b.medicine_id)
        if (!med) return null
        return {
          id: b.batch_id,
          med_name: med.generic_name,
          med_dosage: med.dosage_strength || '',
          med_type: med.dosage_form || '',
          quantity: b.total_quantity,
          exp_date: b.expiration_date,
          unit: med.unit || '',
          batch_number: b.batch_number,
          source: b.source,
        } as BatchRow
      })
      .filter((b): b is BatchRow => b !== null)
      .sort((a, b) => b.quantity - a.quantity)

    return batchList
  }, [rawBatches, catalog, catalogById, batchFilter, sourceFilter])

  const maxQty = Math.max(...rows.map(r => r.quantity), 1)

  const counts = {
    highest: rows.filter(r => getLevel(r.quantity) === 'highest').length,
    medium:  rows.filter(r => getLevel(r.quantity) === 'medium').length,
    lowest:  rows.filter(r => getLevel(r.quantity) === 'lowest').length,
  }

  const FILTERS: { key: StockFilter; label: string; count: number; color: string }[] = [
    { key: 'all',     label: 'All',     count: rows.length,      color: '#0d3b1f' },
    { key: 'highest', label: 'Highest', count: counts.highest,   color: '#16a34a' },
    { key: 'medium',  label: 'Medium',  count: counts.medium,    color: '#f59e0b' },
    { key: 'lowest',  label: 'Lowest',  count: counts.lowest,    color: '#ef4444' },
  ]

  const filteredRows = filter === 'all'
    ? rows
    : rows.filter(r => getLevel(r.quantity) === filter)

  const visibleRows = filteredRows.slice(0, VISIBLE_COUNT)
  const hiddenRows   = filteredRows.slice(VISIBLE_COUNT)

  const selectFilter = (f: StockFilter) => {
    setFilter(f)
    setShowOthersPopup(false)
  }

  const activeColor = filter === 'all' ? '#0d3b1f' : levelColor(filter)

  const batchLabel  = batchFilter === 'all' ? 'All Batches' : `Batch ${batchFilter}`
  const sourceLabel = sourceFilter === 'all' ? 'All Sources' : sourceFilter

  return (
    <>
      <div className={styles.card} style={{ display: 'flex', flexDirection: 'column', height: CARD_HEIGHT, position: 'relative' }}>
        <div className={styles.cardHeader} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span>Stock Levels</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {/* Batch dropdown — All (summed per medicine) or a specific batch_number */}
            <select
              value={batchFilter}
              onChange={e => { setBatchFilter(e.target.value); setShowOthersPopup(false) }}
              style={selectStyle}
            >
              <option value="all">All Batches</option>
              {batchOptions.map(bn => (
                <option key={bn} value={bn}>Batch {bn}</option>
              ))}
            </select>

            {/* Source dropdown — All / DOH / PhilHealth / LGU */}
            <select
              value={sourceFilter}
              onChange={e => { setSourceFilter(e.target.value as SourceFilter); setShowOthersPopup(false) }}
              style={selectStyle}
            >
              <option value="all">All Sources</option>
              <option value="DOH">DOH</option>
              <option value="PhilHealth">PhilHealth</option>
              <option value="LGU">LGU</option>
            </select>
          </div>
        </div>
        <div className={styles.cardBody} style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '14px 16px', minHeight: 0 }}>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text3)', fontSize: 12 }}>
              Loading medicines…
            </div>
          ) : fetchError ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '20px 0', textAlign: 'center' }}>
              <span style={{ fontSize: 12, color: '#dc2626' }}>⚠ {fetchError}</span>
              <button
                onClick={fetchMedicines}
                style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 14 }}>
                {filter === 'all' ? 'Stock — All' : `Stock — ${FILTERS.find(f => f.key === filter)?.label}`}
                <span style={{ fontWeight: 500, color: 'var(--text3)' }}> · {batchLabel} · {sourceLabel}</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
                {filteredRows.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', padding: '20px 0' }}>
                    No medicines in this category.
                  </div>
                ) : (
                  visibleRows.map(r => {
                    const level = getLevel(r.quantity)
                    const pct   = Math.round((r.quantity / maxQty) * 100)
                    const dot   = levelColor(level)
                    return (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 9, height: 9, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                        <span style={{
                          width: 110, fontSize: 12, color: 'var(--text)', flexShrink: 0,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {r.med_name}
                          {isBatchRow(r) && r.source && (
                            <span style={{ color: sourceColor(r.source), fontWeight: 600 }}> · {r.source}</span>
                          )}
                        </span>
                        <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: dot, borderRadius: 99, transition: 'width .4s' }} />
                        </div>
                        <span style={{ width: 34, textAlign: 'right', fontSize: 12, fontWeight: 700, color: dot, flexShrink: 0 }}>
                          {r.quantity}
                        </span>
                      </div>
                    )
                  })
                )}

                {hiddenRows.length > 0 && (
                  <div
                    onClick={() => setShowOthersPopup(true)}
                    style={{
                      fontSize: 11, color: activeColor, textAlign: 'center', marginTop: 2,
                      cursor: 'pointer', fontWeight: 600, textDecoration: 'underline', textDecorationStyle: 'dotted',
                    }}
                  >
                    +{hiddenRows.length} more · click to see all
                  </div>
                )}
              </div>

              {/* Level filter pills */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 16 }}>
                {FILTERS.map(f => {
                  const isActive = filter === f.key
                  return (
                    <button
                      key={f.key}
                      onClick={() => selectFilter(f.key)}
                      style={{
                        background:   isActive ? f.color : 'transparent',
                        color:        isActive ? '#fff' : f.color,
                        border:       `1.5px solid ${f.color}`,
                        borderRadius: 20,
                        padding:      '4px 10px',
                        fontSize:     11,
                        fontWeight:   700,
                        cursor:       'pointer',
                        fontFamily:   'inherit',
                        transition:   'all .15s',
                        display:      'flex',
                        alignItems:   'center',
                        gap:          4,
                      }}
                    >
                      {f.label}
                      <span style={{
                        background:   isActive ? 'rgba(255,255,255,.22)' : levelBg(f.key === 'all' ? 'highest' : f.key),
                        borderRadius: 10,
                        padding:      '0 5px',
                        fontSize:     10,
                        color:        isActive ? '#fff' : f.color,
                      }}>
                        {f.count}
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── "Others" popup — full list for the current batch/source/level selection ── */}
      {showOthersPopup && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setShowOthersPopup(false)}
        >
          <div
            style={{ background: 'var(--surface, #fff)', borderRadius: 18, width: '100%', maxWidth: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.28)', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ background: `linear-gradient(90deg,#0d3b1f,${activeColor})`, padding: '16px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase' }}>
                  Medicine Stock · {batchLabel} · {sourceLabel}
                </div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, marginTop: 2 }}>
                  {filter === 'all' ? 'All' : FILTERS.find(f => f.key === filter)?.label}
                  <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 500, opacity: .8 }}>
                    ({filteredRows.length} {batchFilter === 'all' ? 'medicines' : 'batches'})
                  </span>
                </div>
              </div>
              <button
                onClick={() => setShowOthersPopup(false)}
                style={{ border: 'none', background: 'rgba(255,255,255,.2)', color: '#fff', width: 28, height: 28, borderRadius: 7, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontFamily: 'inherit' }}
              >✕</button>
            </div>

            <div style={{ overflowY: 'auto', padding: '12px 0', background: 'var(--surface, #fff)' }}>
              {filteredRows.map(r => {
                const level = getLevel(r.quantity)
                const pct   = Math.round((r.quantity / maxQty) * 100)
                return (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 22px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: levelColor(level), flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                        {r.med_name}
                        {isBatchRow(r) && r.batch_number && (
                          <span style={{ fontWeight: 500, color: 'var(--text3)' }}> · Batch {r.batch_number}</span>
                        )}
                        {isBatchRow(r) && r.source && (
                          <span style={{ fontWeight: 600, color: sourceColor(r.source) }}> · {r.source}</span>
                        )}
                        {!isBatchRow(r) && r.batchCount > 1 && (
                          <span style={{ fontWeight: 500, color: 'var(--text3)' }}> · {r.batchCount} batches</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
                        {r.med_dosage}{r.med_type ? ` · ${r.med_type}` : ''}{r.exp_date ? ` · Exp: ${r.exp_date}` : ''}
                      </div>
                      <div style={{ marginTop: 5, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: levelColor(level), borderRadius: 3, transition: 'width .4s' }} />
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: levelColor(level), lineHeight: 1 }}>{r.quantity}</div>
                      <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{r.unit}</div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div style={{ padding: '12px 22px', borderTop: '1px solid var(--border)', background: 'var(--surface, #fff)', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowOthersPopup(false)}
                style={{ background: '#0d3b1f', color: '#fff', border: 'none', borderRadius: 20, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}