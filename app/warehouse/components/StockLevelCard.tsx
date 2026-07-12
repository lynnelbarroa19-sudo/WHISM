'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import styles from './warehouse.module.css'

type StockFilter = 'all' | 'highest' | 'medium' | 'lowest'

interface Medicine {
  id: string
  med_name: string
  med_dosage: string
  med_type: string
  quantity: number
  exp_date: string
  unit: string
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

const VISIBLE_COUNT = 5
const CARD_HEIGHT = 340

export default function StockLevelCard() {
  const [medicines,       setMedicines]       = useState<Medicine[]>([])
  const [loading,         setLoading]         = useState(true)
  const [filter,          setFilter]          = useState<StockFilter>('all')
  const [showOthersPopup, setShowOthersPopup] = useState(false)

  useEffect(() => { fetchMedicines() }, [])

  async function fetchMedicines() {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const { data, error } = await supabase
      .from('warehouse_medicines')
      .select('id, med_name, med_dosage, med_type, quantity, exp_date, unit')
      .eq('archived', false)
      .gt('exp_date', today)
      .order('quantity', { ascending: false })
    if (!error && data) setMedicines(data)
    setLoading(false)
  }

  const maxQty = Math.max(...medicines.map(m => m.quantity), 1)

  const counts = {
    highest: medicines.filter(m => getLevel(m.quantity) === 'highest').length,
    medium:  medicines.filter(m => getLevel(m.quantity) === 'medium').length,
    lowest:  medicines.filter(m => getLevel(m.quantity) === 'lowest').length,
  }

  const FILTERS: { key: StockFilter; label: string; count: number; color: string }[] = [
    { key: 'all',     label: 'All',     count: medicines.length,  color: '#0d3b1f' },
    { key: 'highest', label: 'Highest', count: counts.highest,    color: '#16a34a' },
    { key: 'medium',  label: 'Medium',  count: counts.medium,     color: '#f59e0b' },
    { key: 'lowest',  label: 'Lowest',  count: counts.lowest,     color: '#ef4444' },
  ]

  // Filtered list based on active tab
  const filteredMedicines = filter === 'all'
    ? medicines
    : medicines.filter(m => getLevel(m.quantity) === filter)

  const visibleMedicines = filteredMedicines.slice(0, VISIBLE_COUNT)
  const hiddenMedicines  = filteredMedicines.slice(VISIBLE_COUNT)

  const selectFilter = (f: StockFilter) => {
    setFilter(f)
    setShowOthersPopup(false)
  }

  const activeColor = filter === 'all' ? '#0d3b1f' : levelColor(filter)

  return (
    <>
      <div className={styles.card} style={{ display: 'flex', flexDirection: 'column', height: CARD_HEIGHT, position: 'relative' }}>
        <div className={styles.cardHeader}>Stock Levels</div>
        <div className={styles.cardBody} style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '14px 16px', minHeight: 0 }}>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text3)', fontSize: 12 }}>
              Loading medicines…
            </div>
          ) : (
            <>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 14 }}>
                {filter === 'all' ? 'Stock — All Medicines' : `Stock — ${FILTERS.find(f => f.key === filter)?.label}`}
              </div>

              {/* Bar rows — top 5 of current filter, walang scroll, mas maluwag na ang spacing */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
                {filteredMedicines.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', padding: '20px 0' }}>
                    No medicines in this category.
                  </div>
                ) : (
                  visibleMedicines.map(m => {
                    const level = getLevel(m.quantity)
                    const pct   = Math.round((m.quantity / maxQty) * 100)
                    const dot   = levelColor(level)
                    return (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 9, height: 9, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                        <span style={{
                          width: 110, fontSize: 12, color: 'var(--text)', flexShrink: 0,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {m.med_name}
                        </span>
                        <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: dot, borderRadius: 99, transition: 'width .4s' }} />
                        </div>
                        <span style={{ width: 34, textAlign: 'right', fontSize: 12, fontWeight: 700, color: dot, flexShrink: 0 }}>
                          {m.quantity}
                        </span>
                      </div>
                    )
                  })
                )}

                {hiddenMedicines.length > 0 && (
                  <div
                    onClick={() => setShowOthersPopup(true)}
                    style={{
                      fontSize: 11, color: activeColor, textAlign: 'center', marginTop: 2,
                      cursor: 'pointer', fontWeight: 600, textDecoration: 'underline', textDecorationStyle: 'dotted',
                    }}
                  >
                    +{hiddenMedicines.length} more · click to see all
                  </div>
                )}
              </div>

              {/* Filter pills */}
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

      {/* ── "Others" popup — only for items beyond top 5 ── */}
      {showOthersPopup && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setShowOthersPopup(false)}
        >
          <div
            style={{ background: 'var(--surface, #fff)', borderRadius: 18, width: '100%', maxWidth: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.28)', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ background: `linear-gradient(90deg,#0d3b1f,${activeColor})`, padding: '16px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase' }}>
                  Medicine Stock
                </div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, marginTop: 2 }}>
                  {filter === 'all' ? 'All Medicines' : FILTERS.find(f => f.key === filter)?.label}
                  <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 500, opacity: .8 }}>
                    ({filteredMedicines.length} medicines)
                  </span>
                </div>
              </div>
              <button
                onClick={() => setShowOthersPopup(false)}
                style={{ border: 'none', background: 'rgba(255,255,255,.2)', color: '#fff', width: 28, height: 28, borderRadius: 7, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontFamily: 'inherit' }}
              >✕</button>
            </div>

            {/* Full list */}
            <div style={{ overflowY: 'auto', padding: '12px 0', background: 'var(--surface, #fff)' }}>
              {filteredMedicines.map(m => {
                const level = getLevel(m.quantity)
                const pct   = Math.round((m.quantity / maxQty) * 100)
                return (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 22px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: levelColor(level), flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{m.med_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
                        {m.med_dosage}{m.med_type ? ` · ${m.med_type}` : ''}{m.exp_date ? ` · Exp: ${m.exp_date}` : ''}
                      </div>
                      <div style={{ marginTop: 5, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: levelColor(level), borderRadius: 3, transition: 'width .4s' }} />
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: levelColor(level), lineHeight: 1 }}>{m.quantity}</div>
                      <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{m.unit}</div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer */}
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