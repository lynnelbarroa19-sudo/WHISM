'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import styles from './warehouse.module.css'

interface ExpiringSoon { med_name: string; exp_date: string; quantity: number }

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

export default function StatsCards() {
  const [totalMedicine, setTotalMedicine] = useState(0)
  const [totalDrugs, setTotalDrugs] = useState(0)
  const [totalSupplies, setTotalSupplies] = useState(0)
  const [expiringSoon, setExpiringSoon] = useState<ExpiringSoon[]>([])
  const [dayFilter, setDayFilter] = useState<30 | 60 | 90>(30)
  const [loading, setLoading] = useState(true)
  const today = new Date()

  useEffect(() => { fetchStats() }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchExpiring(dayFilter) }, [dayFilter])

  const fetchStats = async () => {
    setLoading(true)

    const { count: total } = await supabase
      .from('warehouse_medicines')
      .select('*', { count: 'exact', head: true })
      .eq('archived', false)
    setTotalMedicine(total || 0)

    const { count: drugs } = await supabase
      .from('warehouse_medicines')
      .select('*', { count: 'exact', head: true })
      .eq('archived', false)
      .eq('category', 'drug')
    setTotalDrugs(drugs || 0)

    const { count: supplies } = await supabase
      .from('warehouse_medicines')
      .select('*', { count: 'exact', head: true })
      .eq('archived', false)
      .eq('category', 'supply')
    setTotalSupplies(supplies || 0)

    setLoading(false)
  }

  const fetchExpiring = async (days: number) => {
    const startDate = new Date()
    const endDate = new Date()
    if (days === 30) { endDate.setDate(endDate.getDate() + 30) }
    else if (days === 60) { startDate.setDate(startDate.getDate() + 31); endDate.setDate(endDate.getDate() + 60) }
    else { startDate.setDate(startDate.getDate() + 61); endDate.setDate(endDate.getDate() + 90) }

    const { data } = await supabase
      .from('warehouse_medicines')
      .select('med_name, exp_date, quantity')
      .eq('archived', false)
      .gte('exp_date', startDate.toISOString().split('T')[0])
      .lte('exp_date', endDate.toISOString().split('T')[0])
      .order('exp_date', { ascending: true })
    setExpiringSoon(data || [])
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
      {/* ── Analytics — buong width ── */}
      <div className={styles.analyticsCard} style={{ gridArea: 'analytics' }}>
        <div className={styles.analyticsLabel}>Analytics</div>

        <div className={styles.analyticsGrid}>
          <div className={styles.statCardGreen} style={{ position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div className={styles.statLabel}>Total Medicine</div>
              <div className={styles.statNum}>{loading ? '—' : totalMedicine}</div>
              <div className={styles.statDate}>{dateLabel}</div>
            </div>
            <div style={{ position: 'absolute', right: 12, bottom: 12, opacity: 0.9 }}>
              <BoxIcon size={44} />
            </div>
          </div>

          <div className={styles.statCardGreen} style={{ position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div className={styles.statLabel}>Total Drug Medicine</div>
              <div className={styles.statNum}>{loading ? '—' : totalDrugs}</div>
              <div className={styles.statDate}>{dateLabel}</div>
            </div>
            <div style={{ position: 'absolute', right: 12, bottom: 12, opacity: 0.9 }}>
              <BottleIcon size={44} />
            </div>
          </div>

          <div className={styles.statCardGreen} style={{ position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div className={styles.statLabel}>Total Medicine Supplies</div>
              <div className={styles.statNum}>{loading ? '—' : totalSupplies}</div>
              <div className={styles.statDate}>{dateLabel}</div>
            </div>
            <div style={{ position: 'absolute', right: 12, bottom: 12, opacity: 0.9 }}>
              <KitIcon size={44} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Expiring Soon — nasa dating pwesto ng Total Monthly Stock ── */}
      <div className={styles.card} style={{ gridArea: 'expiring', height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className={styles.cardHeader}>EXPIRING SOON</div>
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

          {loading ? (
            <div className={styles.emptyText}>Loading...</div>
          ) : expiringSoon.length > 0 ? (
            <div className={styles.expiringList} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {expiringSoon.map((item, i) => {
                const days = daysLeft(item.exp_date)
                return (
                  <div key={i} className={styles.expiringItem}>
                    <div className={styles.expiringItemInfo}>
                      <span className={styles.expiringItemName}>{item.med_name}</span>
                      <span className={styles.expiringItemDate}>{item.exp_date}</span>
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