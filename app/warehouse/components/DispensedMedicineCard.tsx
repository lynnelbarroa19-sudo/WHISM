'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import styles from './warehouse.module.css'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

type RangeFilter = 'day' | 'month' | 'year'
type ViewTab = 'trend' | 'ranking'

interface TrendBucket { label: string; sortKey: number; total: number }
interface TrendPoint { label: string; total: number }

// Zero-filled scaffold so the trend line stays continuous across
// hours/days/months with no dispenses, instead of jumping between the
// sparse points that actually had activity.
function buildEmptyBuckets(r: RangeFilter, now: Date): Record<string, TrendBucket> {
  const buckets: Record<string, TrendBucket> = {}
  if (r === 'day') {
    for (let h = 0; h < 24; h++) {
      const label = h === 0 ? '12AM' : h < 12 ? `${h}AM` : h === 12 ? '12PM' : `${h - 12}PM`
      buckets[String(h)] = { label, sortKey: h, total: 0 }
    }
  } else if (r === 'year') {
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    MONTHS.forEach((label, i) => { buckets[String(i)] = { label, sortKey: i, total: 0 } })
  } else {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    for (let d = 1; d <= daysInMonth; d++) {
      buckets[String(d)] = { label: String(d), sortKey: d, total: 0 }
    }
  }
  return buckets
}

function bucketKeyFor(dateStr: string, r: RangeFilter): string {
  const d = new Date(dateStr)
  if (r === 'day') return String(d.getHours())
  if (r === 'year') return String(d.getMonth())
  return String(d.getDate())
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: TrendPoint }> }) {
  if (!active || !payload || !payload.length) return null
  const p = payload[0].payload
  return (
    <div style={{
      background: 'var(--surface, #fff)', border: '1px solid var(--border)', borderRadius: 8,
      padding: '6px 10px', fontSize: 11, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
    }}>
      <div style={{ fontWeight: 700, color: 'var(--text)' }}>{p.label}</div>
      <div style={{ color: 'var(--green)', fontWeight: 600 }}>{p.total.toLocaleString()} units</div>
    </div>
  )
}

// One row = one batch allocation on a confirmed-received release — joined
// all the way up to the medicine name and down to the destination it went
// to. Only releases with status 'received' are counted here, since that's
// the point where stock is actually deducted from medicine_batches (via
// the confirm_release_receipt RPC) — a 'pending' release hasn't had
// anything leave the warehouse yet, it's just reserved.
//
// FIXED: this used to filter on status === 'released' and date on
// date_released, both of which are stale — the current release lifecycle
// is pending -> received (no separate 'approved'/'released' stage
// anymore), and date_released is just when the request was created, not
// when stock actually left. received_at is the field that's actually set
// (by the RPC) at the moment of deduction, so that's what "dispensed"
// should mean and what the day/month/year range should filter on.
interface DispensedRow {
  quantity: number
  medicine_batches: {
    medicine_id: string
    medicines: { generic_name: string } | null
  } | null
  releases: {
    received_at: string | null
    status: string
    destination_id: string
    destinations: { destination_name: string } | null
  } | null
}

interface GroupedItem {
  med_name: string
  total: number
  topDestination: string
}

const BAR_COLORS = [
  { from: '#16a34a', to: '#22c55e' },
  { from: '#0d9488', to: '#14b8a6' },
  { from: '#059669', to: '#34d399' },
  { from: '#15803d', to: '#4ade80' },
  { from: '#047857', to: '#6ee7b7' },
  { from: '#166534', to: '#86efac' },
  { from: '#0f766e', to: '#5eead4' },
  { from: '#065f46', to: '#a7f3d0' },
]

const RANGE_TABS: { key: RangeFilter; label: string }[] = [
  { key: 'day',   label: 'Day'   },
  { key: 'month', label: 'Month' },
  { key: 'year',  label: 'Year'  },
]

// ── Bar chart row ──────────────────────────────────────────────────
// A "grown-in" horizontal bar: starts at 0% width and animates up to
// its real value shortly after mount/data-load, with a small stagger
// per row so the whole list reads as one chart filling in rather than
// a flat list of static bars.
function BarRow({
  item, index, maxVal, grown,
}: { item: GroupedItem; index: number; maxVal: number; grown: boolean }) {
  const pct = Math.min(100, (item.total / maxVal) * 100)
  const c = BAR_COLORS[index % BAR_COLORS.length]
  const labelFitsInside = pct > 22

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{
          fontSize: 11.5, fontWeight: 700, color: 'var(--text)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '62%',
        }}>
          {index === 0 && <span style={{ marginRight: 4 }}>🏆</span>}
          {item.med_name}
        </span>
        <span style={{ fontSize: 9.5, color: 'var(--text3)', fontWeight: 600 }}>
          {item.topDestination}
        </span>
      </div>

      {/* Track: faint background + gridlines sit here, bar fills on top */}
      <div style={{
        position: 'relative', height: 24, borderRadius: 7,
        background: 'var(--border)', opacity: 1, overflow: 'hidden',
      }}>
        {/* Gridlines at 25/50/75% for scale reference */}
        {[25, 50, 75].map((g) => (
          <div key={g} style={{
            position: 'absolute', top: 0, bottom: 0, left: `${g}%`,
            width: 1, background: 'rgba(0,0,0,0.06)',
          }} />
        ))}

        {/* Filled bar */}
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0,
          width: grown ? `${pct}%` : '0%',
          background: `linear-gradient(90deg, ${c.from}, ${c.to})`,
          borderRadius: 7,
          transition: `width 0.7s cubic-bezier(0.22, 1, 0.36, 1) ${index * 60}ms`,
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          boxShadow: `0 1px 4px ${c.from}55`,
        }}>
          {labelFitsInside && (
            <span style={{
              fontSize: 10.5, fontWeight: 800, color: '#fff', marginRight: 8,
              whiteSpace: 'nowrap', opacity: grown ? 1 : 0, transition: `opacity 0.3s ease ${index * 60 + 300}ms`,
            }}>
              {item.total.toLocaleString()}
            </span>
          )}
        </div>

        {/* Value shown outside the bar when the bar is too short for the label to fit inside */}
        {!labelFitsInside && (
          <span style={{
            position: 'absolute', top: '50%', transform: 'translateY(-50%)',
            left: `calc(${grown ? pct : 0}% + 8px)`, fontSize: 10.5, fontWeight: 800, color: 'var(--text)',
            whiteSpace: 'nowrap', transition: `left 0.7s cubic-bezier(0.22, 1, 0.36, 1) ${index * 60}ms`,
          }}>
            {item.total.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  )
}

function ViewTabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 12px',
        borderRadius: 999,
        border: '1.5px solid var(--green)',
        background: active ? 'var(--green)' : 'transparent',
        color: active ? '#fff' : 'var(--green)',
        fontSize: 11,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'inherit',
        opacity: active ? 1 : 0.6,
        transition: 'all .15s ease',
      }}
    >
      {label}
    </button>
  )
}

export default function DispensedMedicineCard() {
  const [items,       setItems]       = useState<GroupedItem[]>([])
  const [trend,       setTrend]       = useState<TrendPoint[]>([])
  const [loading,     setLoading]     = useState(true)
  const [fetchError,  setFetchError]  = useState('')
  const [total,       setTotal]       = useState(0)
  const [rangeLabel,  setRangeLabel]  = useState('')
  const [range,       setRange]       = useState<RangeFilter>('month')
  const [view,        setView]        = useState<ViewTab>('trend')
  const [grown,       setGrown]       = useState(false) // triggers the bar grow-in animation

  useEffect(() => { fetchDispensed(range) }, [range])

  function getRangeBounds(r: RangeFilter) {
    const now = new Date()

    if (r === 'day') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()
      const label = now.toLocaleDateString('default', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })
      return { start, end, label }
    }

    if (r === 'year') {
      const start = new Date(now.getFullYear(), 0, 1).toISOString()
      const end   = new Date(now.getFullYear(), 11, 31, 23, 59, 59).toISOString()
      const label = String(now.getFullYear())
      return { start, end, label }
    }

    // month (default)
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()
    const label = now.toLocaleString('default', { month: 'long', year: 'numeric' })
    return { start, end, label }
  }

  async function fetchDispensed(r: RangeFilter) {
    setLoading(true)
    setFetchError('')
    setGrown(false) // reset so bars animate in fresh for the new range

    const { start, end, label } = getRangeBounds(r)
    setRangeLabel(label)

    // release_items is the source of truth for "what actually left the
    // warehouse" — each row is one batch allocation on a release. We join up
    // to medicines (for the name) and destinations (for where it went), and
    // filter on the parent release's status + received_at. The `!inner`
    // join on `releases` is required so the `.eq`/`.gte`/`.lte` filters below
    // can reach into that nested table.
    const { data, error } = await supabase
      .from('release_items')
      .select(`
        quantity,
        medicine_batches (
          medicine_id,
          medicines ( generic_name )
        ),
        releases!inner (
          received_at,
          status,
          destination_id,
          destinations ( destination_name )
        )
      `)
      .eq('releases.status', 'received')
      .gte('releases.received_at', start)
      .lte('releases.received_at', end)

    if (!error && data) {
      // Group by medicine name (for the Ranking view) and by time bucket
      // (for the Trend view) in the same pass.
      const grouped: Record<string, { total: number; destinations: Record<string, number> }> = {}
      const buckets = buildEmptyBuckets(r, new Date())
      ;(data as unknown as DispensedRow[]).forEach(row => {
        const medName = row.medicine_batches?.medicines?.generic_name || 'Unknown'
        const destName = row.releases?.destinations?.destination_name || 'Unknown'
        if (!grouped[medName]) grouped[medName] = { total: 0, destinations: {} }
        grouped[medName].total += row.quantity
        grouped[medName].destinations[destName] = (grouped[medName].destinations[destName] || 0) + row.quantity

        const receivedAt = row.releases?.received_at
        if (receivedAt) {
          const bKey = bucketKeyFor(receivedAt, r)
          if (buckets[bKey]) buckets[bKey].total += row.quantity
        }
      })

      const result: GroupedItem[] = Object.entries(grouped)
        .map(([med_name, v]) => ({
          med_name,
          total: v.total,
          topDestination: Object.entries(v.destinations).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—',
        }))
        .sort((a, b) => b.total - a.total)

      setItems(result)
      setTotal(result.reduce((s, i) => s + i.total, 0))
      setTrend(Object.values(buckets).sort((a, b) => a.sortKey - b.sortKey).map(({ label, total: t }) => ({ label, total: t })))
    } else {
      console.error('fetchDispensed:', error)
      setFetchError('Could not load dispense history.')
      setItems([])
      setTotal(0)
      setTrend([])
    }

    setLoading(false)
    // Let the bars mount at 0% first, then grow — a tiny delay is enough
    // for the browser to paint the 0-width state before transitioning.
    requestAnimationFrame(() => requestAnimationFrame(() => setGrown(true)))
  }

  const maxVal = Math.max(...items.map(i => i.total), 1)
  const topMed = items[0]

  const totalLabel = range === 'day' ? 'Total Today' : range === 'year' ? 'Total This Year' : 'Total This Month'

  return (
    <div className={styles.card} style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <div className={styles.cardHeader}>Dispensed Medicine</div>
      <div className={styles.cardBody} style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 14px', minHeight: 0 }}>

        {/* Range tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {RANGE_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setRange(t.key)}
              style={{
                flex: 1,
                padding: '7px 0',
                fontSize: 12,
                fontWeight: 700,
                border: `1.5px solid ${range === t.key ? 'var(--green)' : 'var(--border)'}`,
                borderRadius: 20,
                background: range === t.key ? 'var(--green)' : 'transparent',
                color: range === t.key ? '#fff' : 'var(--text2)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all .15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text3)', fontSize: 12 }}>
            Loading dispensed records…
          </div>
        ) : fetchError ? (
          <div style={{ background: '#fee2e2', color: '#dc2626', padding: '10px 12px', borderRadius: 8, fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span>⚠ {fetchError}</span>
            <button
              type="button"
              onClick={() => fetchDispensed(range)}
              style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {/* Summary header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  {totalLabel}
                </div>
                <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--green)', lineHeight: 1.1 }}>
                  {total.toLocaleString()}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>units dispensed</div>
              </div>
              {topMed && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    Top Medicine
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{topMed.med_name}</div>
                  <div style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>{topMed.total} units</div>
                </div>
              )}
            </div>

            {/* Trend / Ranking toggle — Trend shows the shape over time
                (something a per-medicine bar list can never show); Ranking
                keeps the original top-medicines-by-volume list. */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <ViewTabBtn label="Trend" active={view === 'trend'} onClick={() => setView('trend')} />
              <ViewTabBtn label="Ranking" active={view === 'ranking'} onClick={() => setView('ranking')} />
            </div>

            {view === 'trend' ? (
              trend.every(p => p.total === 0) ? (
                <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', padding: '20px 0' }}>
                  No dispensed records for this {range}.
                </div>
              ) : (
                <div style={{ flex: 1, minHeight: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="dispensedTrendFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#16a34a" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="#16a34a" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="0" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: 'var(--text3)', fontSize: 9.5 }}
                        axisLine={{ stroke: 'var(--border)' }} tickLine={false}
                        interval={range === 'month' ? 4 : range === 'day' ? 2 : 0}
                      />
                      <YAxis
                        tick={{ fill: 'var(--text3)', fontSize: 10 }}
                        axisLine={{ stroke: 'var(--border)' }} tickLine={false}
                        width={32} allowDecimals={false}
                      />
                      <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'var(--green)', strokeDasharray: '0' }} />
                      <Area type="monotone" dataKey="total" stroke="#16a34a" strokeWidth={2} fill="url(#dispensedTrendFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )
            ) : (
              /* Bar chart list */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
                {items.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', padding: '20px 0' }}>
                    No dispensed records for this {range}.
                  </div>
                ) : (
                  items.map((item, i) => (
                    <BarRow key={item.med_name} item={item} index={i} maxVal={maxVal} grown={grown} />
                  ))
                )}
              </div>
            )}

            {/* Footer */}
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'var(--text3)' }}>{rangeLabel}</span>
              <span style={{ fontSize: 9, color: 'var(--green)', fontWeight: 600 }}>
                {items.length} medicine{items.length !== 1 ? 's' : ''} tracked
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}