'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import styles from './warehouse.module.css'

type RangeFilter = 'day' | 'month' | 'year'

// One row = one batch allocation on a released dispense — joined all the way
// up to the medicine name and down to the destination it went to. Only
// releases with status 'released' are counted here, since that's the point
// where stock is actually decremented (a 'pending' release hasn't been
// dispensed yet — see DispenseMedicineModal).
interface DispensedRow {
  quantity: number
  medicine_batches: {
    medicine_id: string
    medicines: { generic_name: string } | null
  } | null
  releases: {
    date_released: string
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

function MiniBar({ value, max, color = '#16a34a' }: { value: number; max: number; color?: string }) {
  const pct = Math.min(100, (value / max) * 100)
  return (
    <div style={{ background: 'var(--border)', borderRadius: 4, height: 6, overflow: 'hidden', flex: 1 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .4s ease' }} />
    </div>
  )
}

const BAR_COLORS = ['#16a34a', '#22c55e', '#4ade80', '#86efac', '#bbf7d0', '#6ee7b7', '#34d399', '#10b981']

const RANGE_TABS: { key: RangeFilter; label: string }[] = [
  { key: 'day',   label: 'Day'   },
  { key: 'month', label: 'Month' },
  { key: 'year',  label: 'Year'  },
]

export default function DispensedMedicineCard() {
  const [items,       setItems]       = useState<GroupedItem[]>([])
  const [loading,     setLoading]     = useState(true)
  const [fetchError,  setFetchError]  = useState('')
  const [total,       setTotal]       = useState(0)
  const [rangeLabel,  setRangeLabel]  = useState('')
  const [range,       setRange]       = useState<RangeFilter>('month')

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

    const { start, end, label } = getRangeBounds(r)
    setRangeLabel(label)

    // release_items is the source of truth for "what actually left the
    // warehouse" — each row is one batch allocation on a release. We join up
    // to medicines (for the name) and destinations (for where it went), and
    // filter on the parent release's status + date_released. The `!inner`
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
          date_released,
          status,
          destination_id,
          destinations ( destination_name )
        )
      `)
      .eq('releases.status', 'released')
      .gte('releases.date_released', start)
      .lte('releases.date_released', end)

    if (!error && data) {
      // Group by medicine name
      const grouped: Record<string, { total: number; destinations: Record<string, number> }> = {}
      ;(data as unknown as DispensedRow[]).forEach(row => {
        const medName = row.medicine_batches?.medicines?.generic_name || 'Unknown'
        const destName = row.releases?.destinations?.destination_name || 'Unknown'
        if (!grouped[medName]) grouped[medName] = { total: 0, destinations: {} }
        grouped[medName].total += row.quantity
        grouped[medName].destinations[destName] = (grouped[medName].destinations[destName] || 0) + row.quantity
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
    } else {
      console.error('fetchDispensed:', error)
      setFetchError('Could not load dispense history.')
      setItems([])
      setTotal(0)
    }

    setLoading(false)
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
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

            {/* Bar list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
              {items.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', padding: '20px 0' }}>
                  No dispensed records for this {range}.
                </div>
              ) : (
                items.map((item, i) => (
                  <div key={item.med_name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '55%' }}>
                        {item.med_name}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)' }}>{item.total}</span>
                    </div>
                    <MiniBar value={item.total} max={maxVal} color={BAR_COLORS[i % BAR_COLORS.length]} />
                    <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 2 }}>{item.topDestination}</div>
                  </div>
                ))
              )}
            </div>

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