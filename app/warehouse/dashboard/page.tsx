'use client'
import { useState, useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'
import StatsCards from '../components/StatsCard'
import StockLevelCard from '../components/StockLevelCard'
import DispensedMedicineCard from '../components/DispensedMedicineCard'
import PharmacyRequestsCard from '../components/Pharmacyrequestcard'
import DispenseMedicineModal from '../components/DispenseMedicineModal'
import styles from '../components/warehouse.module.css'

export default function DashboardPage() {
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [showDispenseModal, setShowDispenseModal] = useState(false)
  const [toast, setToast] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const leftColRef = useRef<HTMLDivElement>(null)
  const [rightColHeight, setRightColHeight] = useState<number | undefined>(undefined)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    const measure = () => {
      if (leftColRef.current) {
        setRightColHeight(leftColRef.current.offsetHeight)
      }
    }
    measure()

    const ro = new ResizeObserver(measure)
    if (leftColRef.current) ro.observe(leftColRef.current)
    window.addEventListener('resize', measure)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [refreshKey])

  const handleDispenseSuccess = () => {
    setShowDispenseModal(false)
    setToast('Medicine dispensed successfully!')
    setRefreshKey(k => k + 1)
    setTimeout(() => setToast(''), 3000)
  }

  return (
    <div className={`${styles.root} ${mounted && theme === 'dark' ? styles.dark : ''}`}>
      <Sidebar />
      <div className={styles.mainArea}>
        <Topbar />
        <div className={styles.content}>

          {/* Page header */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 22 }}>
            <div>
              <p className={styles.pageEyebrow} style={{ letterSpacing: '0.12em', marginBottom: 4 }}>Warehouse</p>
              <h1 className={styles.pageTitle} style={{ fontSize: 36, lineHeight: 1.1, letterSpacing: '0.01em', color: '#0d3b1f', fontWeight: 1000 }}>DASHBOARD</h1>
            </div>
            <button
              onClick={() => setShowDispenseModal(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '11px 24px',
                borderRadius: 22,
                border: 'none',
                background: 'linear-gradient(135deg, #0d3b1f, #16a34a)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
                fontFamily: 'inherit',
                cursor: 'pointer',
                boxShadow: '0 6px 18px rgba(13,59,31,.3)',
                transition: 'all .18s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 22px rgba(13,59,31,.4)' }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(13,59,31,.3)' }}
            >
              💊 Medicine Dispense
            </button>
          </div>

          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', overflowX: 'auto' }}>

            {/* LEFT column — buong grid (Analytics / Expiring Soon / Stock Levels / Dispensed Medicine) */}
            <div
              ref={leftColRef}
              style={{
                flex: 1,
                minWidth: 760,
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gridTemplateRows: 'auto 280px 340px',
                gridTemplateAreas: `
                  "analytics analytics"
                  "expiring  dispensed"
                  "stock     dispensed"
                `,
                gap: 18,
              }}
            >
              <StatsCards key={`stats-${refreshKey}`} />

              <div style={{ gridArea: 'stock' }}>
                <StockLevelCard key={`stock-${refreshKey}`} />
              </div>

              <div style={{ gridArea: 'dispensed' }}>
                <DispensedMedicineCard key={`dispensed-${refreshKey}`} />
              </div>
            </div>

            {/* RIGHT column — sticky requests panel */}
            <div
              style={{
                width: 360,
                flexShrink: 0,
                position: 'sticky',
                top: 20,
                height: rightColHeight ? `${rightColHeight}px` : 'auto',
              }}
            >
              <PharmacyRequestsCard />
            </div>

          </div>

        </div>
      </div>

      {showDispenseModal && (
        <DispenseMedicineModal
          onClose={() => setShowDispenseModal(false)}
          onSuccess={handleDispenseSuccess}
        />
      )}

      {toast && (
        <div
          className={styles.toast}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: '0 10px 28px rgba(13,59,31,.3)',
            animation: 'fadeIn .2s ease',
          }}
        >
          <span style={{ fontSize: 14 }}>✓</span> {toast}
        </div>
      )}
    </div>
  )
}