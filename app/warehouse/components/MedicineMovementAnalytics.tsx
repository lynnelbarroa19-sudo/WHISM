'use client'
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'

// ---- Config ----
const WINDOW_DAYS = 30
const COMPLETED_STATUSES = ['released', 'received'] as const
const TOP_N = 5 // how many to show per list on the dashboard card

// A release counts as "movement" for a medicine once it has been confirmed
// out the door — 'released' (batches decremented) or 'received' (recipient
// confirmed). 'pending'/'approved'/'rejected'/'cancelled' are excluded since
// stock hasn't actually moved yet (or won't).

interface MedicineRow {
  medicine_id: string
  generic_name: string
  brand_name: string | null
  dosage_strength: string | null
  dosage_form: string | null
  unit: string | null
}

interface MovementStat {
  medicine_id: string
  generic_name: string
  brand_name: string | null
  dosage_strength: string | null
  dosage_form: string | null
  unit: string
  totalQty: number     // base pieces dispensed in the window
  frequency: number    // distinct releases that included this medicine
  score: number         // 0..1 combined movement score (0.5 qty + 0.5 frequency, normalized)
  category: 'fast' | 'moderate' | 'slow'
}

type FilterTab = 'all' | 'fast' | 'moderate' | 'slow'

function isBottleType(unit: string): boolean {
  return (unit || '').toLowerCase().includes('bottle')
}
function baseUnitLabel(unit: string): string {
  return isBottleType(unit) ? 'Bottle' : 'Loose'
}

// Builds the zero-movement stat list (used when a medicine had no dispenses
// at all in the window, or as the starting point before merging real data).
function zeroStat(m: MedicineRow): MovementStat {
  return {
    medicine_id: m.medicine_id,
    generic_name: m.generic_name,
    brand_name: m.brand_name,
    dosage_strength: m.dosage_strength,
    dosage_form: m.dosage_form,
    unit: m.unit || 'Piece',
    totalQty: 0,
    frequency: 0,
    score: 0,
    category: 'slow',
  }
}

// Splits a score-sorted (desc) list into fast / moderate / slow buckets.
// Top ~30% -> fast, bottom ~30% -> slow, middle -> moderate. Always at
// least 1 item in each bucket when there's enough data. Medicines with
// zero movement always land in 'slow' regardless of bucket math, since a
// composite score of 0 has nothing "moderate" about it.
function assignCategories(sorted: MovementStat[]): MovementStat[] {
  const n = sorted.length
  if (n === 0) return sorted
  const bucketSize = Math.max(1, Math.round(n * 0.3))
  return sorted.map((stat, i) => {
    if (stat.totalQty === 0 && stat.frequency === 0) {
      return { ...stat, category: 'slow' }
    }
    if (i < bucketSize) return { ...stat, category: 'fast' }
    if (i >= n - bucketSize) return { ...stat, category: 'slow' }
    return { ...stat, category: 'moderate' }
  })
}

// ---- Category visual tokens (mirrors the Stock Levels dot/bar language) ----
const CATEGORY_META: Record<MovementStat['category'], { dot: string; bar: string; barBg: string; label: string }> = {
  fast: { dot: '#16a34a', bar: 'linear-gradient(90deg,#16a34a,#22c55e)', barBg: '#dcfce7', label: 'Fast' },
  moderate: { dot: '#d97706', bar: 'linear-gradient(90deg,#d97706,#f59e0b)', barBg: '#fef3c7', label: 'Moderate' },
  slow: { dot: '#dc2626', bar: 'linear-gradient(90deg,#dc2626,#ef4444)', barBg: '#fee2e2', label: 'Slow' },
}

export default function MedicineMovementAnalytics() {
  const [stats, setStats] = useState<MovementStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastComputed, setLastComputed] = useState<Date | null>(null)
  const [filter, setFilter] = useState<FilterTab>('all')

  useEffect(() => {
    fetchMovementData()
  }, [])

  const fetchMovementData = async () => {
    setLoading(true)
    setError('')

    // ---- 1. Universe: all active, non-archived medicines ----
    const { data: meds, error: medsError } = await supabase
      .from('medicines')
      .select('medicine_id, generic_name, brand_name, dosage_strength, dosage_form, unit')
      .eq('is_archived', false)
      .eq('status', 'active')

    if (medsError || !meds) {
      console.error('MedicineMovementAnalytics (medicines):', medsError)
      setError('Could not load medicines for analytics.')
      setLoading(false)
      return
    }

    if (meds.length === 0) {
      setStats([])
      setLoading(false)
      setLastComputed(new Date())
      return
    }

    // ---- 2. Completed releases within the last WINDOW_DAYS ----
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - WINDOW_DAYS)

    const { data: releases, error: releasesError } = await supabase
      .from('releases')
      .select('release_id')
      .in('status', COMPLETED_STATUSES as unknown as string[])
      .gte('date_released', cutoff.toISOString())

    if (releasesError) {
      console.error('MedicineMovementAnalytics (releases):', releasesError)
      setError('Could not load release history for analytics.')
      setLoading(false)
      return
    }

    const releaseIds = (releases || []).map(r => r.release_id)

    // No completed releases in the window at all -> everything is zero-movement.
    if (releaseIds.length === 0) {
      const zeroed = assignCategories(
        meds.map(zeroStat).sort((a, b) => a.generic_name.localeCompare(b.generic_name))
      )
      setStats(zeroed)
      setLoading(false)
      setLastComputed(new Date())
      return
    }

    // ---- 3. release_items for those releases (batch_id + quantity dispensed) ----
    const { data: items, error: itemsError } = await supabase
      .from('release_items')
      .select('release_id, batch_id, quantity')
      .in('release_id', releaseIds)

    if (itemsError || !items) {
      console.error('MedicineMovementAnalytics (release_items):', itemsError)
      setError('Could not load release items for analytics.')
      setLoading(false)
      return
    }

    // ---- 4. Map batch_id -> medicine_id (a batch always belongs to one medicine) ----
    const batchIds = Array.from(new Set(items.map(i => i.batch_id)))
    const { data: batches, error: batchesError } = await supabase
      .from('medicine_batches')
      .select('batch_id, medicine_id')
      .in('batch_id', batchIds)

    if (batchesError || !batches) {
      console.error('MedicineMovementAnalytics (medicine_batches):', batchesError)
      setError('Could not resolve batches for analytics.')
      setLoading(false)
      return
    }

    const batchToMed = new Map(batches.map(b => [b.batch_id, b.medicine_id]))

    // ---- 5. Aggregate: total qty + distinct release count, per medicine ----
    const qtyByMed = new Map<string, number>()
    const releaseSetByMed = new Map<string, Set<string>>()

    for (const it of items) {
      const medId = batchToMed.get(it.batch_id)
      if (!medId) continue // batch since deleted/orphaned — skip defensively
      qtyByMed.set(medId, (qtyByMed.get(medId) || 0) + it.quantity)
      const set = releaseSetByMed.get(medId) || new Set<string>()
      set.add(it.release_id)
      releaseSetByMed.set(medId, set)
    }

    const maxQty = Math.max(1, ...Array.from(qtyByMed.values()))
    const maxFreq = Math.max(1, ...Array.from(releaseSetByMed.values()).map(s => s.size))

    // ---- 6. Build one stat row per medicine in the universe (zero-filled
    // for medicines that had no dispenses in the window at all) ----
    const built: MovementStat[] = meds.map(m => {
      const qty = qtyByMed.get(m.medicine_id) || 0
      const freq = releaseSetByMed.get(m.medicine_id)?.size || 0
      // Combined score: 50% normalized quantity + 50% normalized frequency.
      const score = 0.5 * (qty / maxQty) + 0.5 * (freq / maxFreq)
      return {
        medicine_id: m.medicine_id,
        generic_name: m.generic_name,
        brand_name: m.brand_name,
        dosage_strength: m.dosage_strength,
        dosage_form: m.dosage_form,
        unit: m.unit || 'Piece',
        totalQty: qty,
        frequency: freq,
        score,
        category: 'slow', // placeholder, real bucket assigned below
      }
    })

    built.sort((a, b) => b.score - a.score || b.totalQty - a.totalQty)
    setStats(assignCategories(built))
    setLoading(false)
    setLastComputed(new Date())
  }

  const counts = useMemo(() => {
    return {
      all: stats.length,
      fast: stats.filter(s => s.category === 'fast').length,
      moderate: stats.filter(s => s.category === 'moderate').length,
      slow: stats.filter(s => s.category === 'slow').length,
    }
  }, [stats])

  // Single ranked list (mirrors the Stock Levels "one list, ranked" layout),
  // filterable by the pills at the bottom instead of two side-by-side columns.
  const visibleStats = useMemo(() => {
    const filtered = filter === 'all' ? stats : stats.filter(s => s.category === filter)
    return filtered.slice(0, TOP_N)
  }, [stats, filter])

  const maxVisibleQty = Math.max(1, ...visibleStats.map(s => s.totalQty))

  if (loading) {
    return (
      <div style={{ ...cardStyle, height: '100%' }}>
        <div style={headerStyle}>
          <span style={headerTitleStyle}>📊 MEDICINE MOVEMENT</span>
        </div>
        <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
          Loading movement analytics...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ ...cardStyle, height: '100%' }}>
        <div style={headerStyle}>
          <span style={headerTitleStyle}>📊 MEDICINE MOVEMENT</span>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: '#fee2e2', color: '#dc2626', padding: '10px 12px', borderRadius: 8, fontSize: 12 }}>
            <span>⚠ {error}</span>
            <button
              onClick={fetchMovementData}
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
      {/* ---- Header: dark green gradient band, same language as Stock Levels ---- */}
      <div style={{ ...headerStyle, flexShrink: 0 }}>
        <span style={headerTitleStyle}>📊 MEDICINE MOVEMENT</span>
        <span style={headerMetaStyle}>Last {WINDOW_DAYS} Days · Released &amp; Received</span>
      </div>

      <div style={{ padding: '14px 16px 16px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12, flexShrink: 0 }}>
          Movement — {filter === 'all' ? 'All' : CATEGORY_META[filter].label}
          <span style={{ fontWeight: 400, color: 'var(--text3)' }}> · Top {TOP_N}</span>
        </div>

        {/* ---- Ranked list with dot + bar, same visual grammar as Stock Levels.
            flex: 1 here is what keeps the card the SAME height no matter which
            filter is active (All/Fast/Moderate/Slow) — fewer rows just leave
            blank space in this area instead of shrinking the whole card, so
            the pills + footer below never jump around. ---- */}
        {visibleStats.length === 0 ? (
          <div style={{ ...emptyStyle, flex: 1 }}>Nothing to show for this filter.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, overflowY: 'auto' }}>
            {visibleStats.map(s => {
              const meta = CATEGORY_META[s.category]
              const barPct = s.totalQty === 0 ? 0 : Math.max(6, Math.round((s.totalQty / maxVisibleQty) * 100))
              return (
                <div key={s.medicine_id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.dot, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.generic_name}
                      </span>
                      <span style={{ fontSize: 10.5, color: 'var(--text3)', flexShrink: 0 }}>
                        {s.dosage_strength}{s.dosage_form ? ` · ${s.dosage_form}` : ''}
                      </span>
                    </div>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: meta.dot, flexShrink: 0, marginLeft: 8 }}>
                      {s.totalQty === 0 ? 'No movement' : `${s.totalQty} ${baseUnitLabel(s.unit)}`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 8, borderRadius: 999, background: meta.barBg, overflow: 'hidden' }}>
                      <div style={{ width: `${barPct}%`, height: '100%', borderRadius: 999, background: meta.bar, transition: 'width .3s ease' }} />
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0, minWidth: 58, textAlign: 'right' }}>
                      {s.frequency}x released
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ---- Filter pills, same pattern as All/Highest/Medium/Lowest ----
            Compact + nowrap so all four always sit on a single line, even
            in the narrower right-column layout. */}
        <div style={{ display: 'flex', gap: 6, marginTop: 16, flexWrap: 'nowrap', overflowX: 'auto', flexShrink: 0 }}>
          <FilterPill label="All" count={counts.all} active={filter === 'all'} color={ALL_PILL_COLOR} isAll onClick={() => setFilter('all')} />
          <FilterPill label="🔥 Fast" count={counts.fast} active={filter === 'fast'} color={CATEGORY_META.fast.dot} onClick={() => setFilter('fast')} />
          <FilterPill label="➖ Moderate" count={counts.moderate} active={filter === 'moderate'} color={CATEGORY_META.moderate.dot} onClick={() => setFilter('moderate')} />
          <FilterPill label="🐌 Slow" count={counts.slow} active={filter === 'slow'} color={CATEGORY_META.slow.dot} onClick={() => setFilter('slow')} />
        </div>

        {lastComputed && (
          <div style={{ marginTop: 14, fontSize: 10, color: 'var(--text3)', textAlign: 'right', flexShrink: 0 }}>
            Computed {lastComputed.toLocaleTimeString()}
            <button
              onClick={fetchMovementData}
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

// ---- Small filter pill button (All / Fast / Moderate / Slow) ----
// Visual language copied 1:1 from the Stock Levels All/Highest/Medium/Lowest
// pills: "All" is a solid dark pill, the rest are white pills with a
// colored border + colored text + a solid colored count bubble.
const ALL_PILL_COLOR = '#0f172a'

function FilterPill({
  label, count, active, color, onClick, isAll = false,
}: { label: string; count: number; active: boolean; color: string; onClick: () => void; isAll?: boolean }) {
  const pillColor = isAll ? ALL_PILL_COLOR : color
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 9px',
        borderRadius: 999,
        border: `1.5px solid ${pillColor}`,
        background: isAll ? pillColor : '#fff',
        color: isAll ? '#fff' : pillColor,
        fontSize: 10.5,
        fontWeight: 700,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        opacity: active ? 1 : isAll ? 1 : 0.55,
        transition: 'all .15s ease',
      }}
    >
      {label}
      <span
        style={{
          background: isAll ? '#fff' : pillColor,
          color: isAll ? pillColor : '#fff',
          borderRadius: 999,
          minWidth: 15,
          textAlign: 'center',
          padding: '0px 5px',
          fontSize: 9.5,
          fontWeight: 800,
        }}
      >
        {count}
      </span>
    </button>
  )
}

// ---- Shared inline styles ----
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