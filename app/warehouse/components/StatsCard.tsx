'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import styles from './warehouse.module.css'

interface ExpiringSoon {
  id: string           // batch_id — unique key per row
  med_name: string
  exp_date: string
  quantity: number
  batch_number: string | null
}

type Source = 'LGU' | 'PhilHealth' | 'DOH'

// ── Custom watermark-style icons for the analytics cards ──
function BoxIcon({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M32 6 L58 18 V46 L32 58 L6 46 V18 Z" fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinejoin="round"/>
      <path d="M6 18 L32 30 L58 18" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinejoin="round" fill="none"/>
      <path d="M32 30 L32 58" stroke="rgba(255,255,255,0.55)" strokeWidth="2"/>
      <path d="M19 12 L45 24" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5"/>
    </svg>
  )
}

function BottleIcon({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="10" width="14" height="8" rx="2" fill="rgba(255,255,255,0.45)"/>
      <path d="M16 18 H38 V24 C38 24 41 27 41 33 V52 C41 55.3 38.3 58 35 58 H19 C15.7 58 13 55.3 13 52 V33 C13 27 16 24 16 24 Z"
        fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinejoin="round"/>
      <path d="M13 38 H41" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5"/>
      <path d="M24 30 V42 M18 36 H30" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round"/>
      <circle cx="42" cy="46" r="6.5" fill="rgba(255,255,255,0.35)" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5"/>
      <circle cx="50" cy="38" r="6.5" fill="rgba(255,255,255,0.25)" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5"/>
    </svg>
  )
}

function KitIcon({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M24 14 H40 C42.2 14 44 15.8 44 18 V22 H20 V18 C20 15.8 21.8 14 24 14 Z"
        fill="rgba(255,255,255,0.3)" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinejoin="round"/>
      <rect x="8" y="22" width="48" height="32" rx="5"
        fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.55)" strokeWidth="2"/>
      <path d="M8 34 H56" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5"/>
      <path d="M32 28 V46 M23 37 H41" stroke="rgba(255,255,255,0.7)" strokeWidth="3" strokeLinecap="round"/>
    </svg>
  )
}

// Simple government-building watermark — used for the LGU card.
function BuildingIcon({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M32 6 L56 20 H8 Z" fill="rgba(255,255,255,0.3)" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinejoin="round"/>
      <rect x="10" y="20" width="44" height="4" fill="rgba(255,255,255,0.4)"/>
      <rect x="14" y="26" width="6" height="24" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5"/>
      <rect x="26" y="26" width="6" height="24" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5"/>
      <rect x="38" y="26" width="6" height="24" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5"/>
      <rect x="8" y="50" width="48" height="6" rx="1" fill="rgba(255,255,255,0.35)" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5"/>
    </svg>
  )
}

// Simple shield watermark — used for the DOH card.
function ShieldIcon({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M32 6 L54 14 V30 C54 44 44 54 32 58 C20 54 10 44 10 30 V14 Z"
        fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinejoin="round"/>
      <path d="M22 32 L29 39 L43 24" stroke="rgba(255,255,255,0.7)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  )
}

export default function StatsCards() {
  const [totalMedicine, setTotalMedicine] = useState(0)
  const [sourceCounts, setSourceCounts] = useState<Record<Source, number>>({ LGU: 0, PhilHealth: 0, DOH: 0 })
  const [expiringSoon, setExpiringSoon] = useState<ExpiringSoon[]>([])
  const [dayFilter, setDayFilter] = useState<30 | 60 | 90>(30)
  const [loading, setLoading] = useState(true)
  const [expiringLoading, setExpiringLoading] = useState(true)
  const [expiringError, setExpiringError] = useState('')
  const today = new Date()

  useEffect(() => { fetchStats() }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchExpiring(dayFilter) }, [dayFilter])

  // Counts distinct medicines (catalog entries) that currently have at
  // least one non-archived batch sourced from `source`. This lives on
  // medicine_batches.source, not on medicines, so we pull the rows and
  // dedupe by medicine_id in JS rather than relying on a head-count.
  const countMedicinesBySource = async (source: Source) => {
    const { data, error } = await supabase
      .from('medicine_batches')
      .select('medicine_id, medicines!inner(is_archived)')
      .eq('source', source)
      .eq('medicines.is_archived', false)
      .neq('status', 'archived')

    if (error) {
      console.error(`Count by source (${source}) error:`, error)
      return 0
    }
    return new Set((data || []).map((row: any) => row.medicine_id)).size
  }

  const fetchStats = async () => {
    setLoading(true)

    const { count: total, error: totalErr } = await supabase
      .from('medicines')
      .select('*', { count: 'exact', head: true })
      .eq('is_archived', false)
    if (totalErr) console.error('Total medicine count error:', totalErr)
    setTotalMedicine(total || 0)

    const [lgu, philhealth, doh] = await Promise.all([
      countMedicinesBySource('LGU'),
      countMedicinesBySource('PhilHealth'),
      countMedicinesBySource('DOH'),
    ])
    setSourceCounts({ LGU: lgu, PhilHealth: philhealth, DOH: doh })

    setLoading(false)
  }

  // FIXED: expiration_date and total_quantity live on medicine_batches, not on
  // medicines (medicines is just the catalog — generic_name, dosage, category,
  // unit). This joins medicine_batches -> medicines to pull the generic_name,
  // and only counts batches that are actually still active/in-stock.
  const fetchExpiring = async (days: number) => {
    setExpiringLoading(true)
    setExpiringError('')

    const startDate = new Date()
    const endDate = new Date()
    if (days === 30) {
      endDate.setDate(endDate.getDate() + 30)
    } else if (days === 60) {
      startDate.setDate(startDate.getDate() + 31)
      endDate.setDate(endDate.getDate() + 60)
    } else {
      startDate.setDate(startDate.getDate() + 61)
      endDate.setDate(endDate.getDate() + 90)
    }

    const { data, error } = await supabase
      .from('medicine_batches')
      .select('batch_id, medicine_id, batch_number, expiration_date, total_quantity, medicines!inner(generic_name)')
      .in('status', ['available', 'low_stock'])
      .gt('total_quantity', 0)
      .gte('expiration_date', startDate.toISOString().split('T')[0])
      .lte('expiration_date', endDate.toISOString().split('T')[0])
      .order('expiration_date', { ascending: true })

    if (error) {
      console.error('fetchExpiring error:', error)
      setExpiringError('Could not load expiring medicines. Check your connection and try again.')
      setExpiringSoon([])
      setExpiringLoading(false)
      return
    }

    setExpiringSoon(
      (data || []).map((d: any) => ({
        id: d.batch_id,
        med_name: d.medicines?.generic_name || 'Unknown',
        exp_date: d.expiration_date,
        quantity: d.total_quantity,
        batch_number: d.batch_number,
      }))
    )
    setExpiringLoading(false)
  }

  const daysLeft = (expDate: string) => {
    const diff = new Date(expDate).getTime() - today.getTime()
    return Math.ceil(diff / (1000 * 60 * 60 * 24))
  }

  const urgencyClass = (days: number) => {
    if (days <= 7) return styles.urgencyBadgeRed
    if (days <= 30) return styles.urgencyBadgeYellow
    return styles.urgencyBadgeGreen
  }

  const dateLabel = today.toLocaleDateString('en-PH', { weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' })

  return (
    <>
      {/* ── Analytics — buong width, apat na card na ngayon ── */}
      <div className={styles.analyticsCard} style={{ gridArea: 'analytics' }}>
        <div className={styles.analyticsLabel}>Analytics</div>

        <div className={styles.analyticsGrid} style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className={styles.statCardGreen} style={{ position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div className={styles.statLabel}>Total Medicine (All)</div>
              <div className={styles.statNum}>{loading ? '—' : totalMedicine}</div>
              <div className={styles.statDate}>{dateLabel}</div>
            </div>
            <div style={{ position: 'absolute', right: 12, bottom: 12, opacity: 0.9 }}>
              <BoxIcon size={44} />
            </div>
          </div>

          <div className={styles.statCardGreen} style={{ position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div className={styles.statLabel}> LGU</div>
              <div className={styles.statNum}>{loading ? '—' : sourceCounts.LGU}</div>
              <div className={styles.statDate}>{dateLabel}</div>
            </div>
            <div style={{ position: 'absolute', right: 12, bottom: 12, opacity: 0.9 }}>
              <BuildingIcon size={44} />
            </div>
          </div>

          <div className={styles.statCardGreen} style={{ position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div className={styles.statLabel}>PhilHealth</div>
              <div className={styles.statNum}>{loading ? '—' : sourceCounts.PhilHealth}</div>
              <div className={styles.statDate}>{dateLabel}</div>
            </div>
            <div style={{ position: 'absolute', right: 12, bottom: 12, opacity: 0.9 }}>
              <BottleIcon size={44} />
            </div>
          </div>

          <div className={styles.statCardGreen} style={{ position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div className={styles.statLabel}>Department of Health</div>
              <div className={styles.statNum}>{loading ? '—' : sourceCounts.DOH}</div>
              <div className={styles.statDate}>{dateLabel}</div>
            </div>
            <div style={{ position: 'absolute', right: 12, bottom: 12, opacity: 0.9 }}>
              <ShieldIcon size={44} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Expiring Soon — nasa dating pwesto ng Total Monthly Stock ── */}
      <div className={styles.card} style={{ gridArea: 'expiring', height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className={styles.cardHeader}>
          EXPIRING SOON
          {!expiringLoading && !expiringError && expiringSoon.length > 0 && (
            <span style={{ fontWeight: 500, fontSize: 11, marginLeft: 6, opacity: 0.85 }}>
              ({expiringSoon.length})
            </span>
          )}
        </div>
        <div className={styles.cardBody} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
            {([30, 60, 90] as const).map(d => (
              <button
                key={d}
                onClick={() => setDayFilter(d)}
                className={styles.filterBtn}
                style={dayFilter === d ? { background: 'var(--green)', color: '#fff', borderColor: 'var(--green)' } : undefined}
              >
                {d}d
              </button>
            ))}
          </div>

          {expiringLoading ? (
            <div className={styles.emptyText}>Loading...</div>
          ) : expiringError ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '20px 0', textAlign: 'center' }}>
              <span style={{ fontSize: 12, color: '#dc2626' }}>⚠ {expiringError}</span>
              <button
                onClick={() => fetchExpiring(dayFilter)}
                style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Retry
              </button>
            </div>
          ) : expiringSoon.length > 0 ? (
            <div className={styles.expiringList} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {expiringSoon.map(item => {
                const days = daysLeft(item.exp_date)
                return (
                  <div key={item.id} className={styles.expiringItem}>
                    <div className={styles.expiringItemInfo}>
                      <span className={styles.expiringItemName}>
                        {item.med_name}
                        {item.batch_number && (
                          <span style={{ fontWeight: 500, color: 'var(--text3)', fontSize: 11 }}> · Batch {item.batch_number}</span>
                        )}
                      </span>
                      <span className={styles.expiringItemDate}>
                        {item.exp_date} · {item.quantity} unit{item.quantity !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <span className={urgencyClass(days)}>{days}d</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className={styles.emptyText}>
              {dayFilter === 30
                ? 'No medicines expiring within 30 days'
                : dayFilter === 60
                ? 'No medicines expiring between 31–60 days'
                : 'No medicines expiring between 61–90 days'}
            </div>
          )}
        </div>
      </div>
    </>
  )
}