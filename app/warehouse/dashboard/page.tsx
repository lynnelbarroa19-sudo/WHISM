'use client'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useTheme } from 'next-themes'
import { useSearchParams, useRouter } from 'next/navigation'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'
import StatsCards from '../components/StatsCard'
import StockLevelCard from '../components/StockLevelCard'
import DispensedMedicineCard from '../components/DispensedMedicineCard'
import PharmacyRequestsCard from '../components/Pharmacyrequestcard'
import DispenseMedicineModal from '../components/DispenseMedicineModal'
import styles from '../components/warehouse.module.css'

// useSearchParams() requires a Suspense boundary in the App Router, so the
// actual page body lives in DashboardInner and this file just wraps it.
export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardInner />
    </Suspense>
  )
}

function DashboardInner() {
  const { theme } = useTheme()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [showDispenseModal, setShowDispenseModal] = useState(false)
  const [toast, setToast] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const topbarRef = useRef<HTMLDivElement>(null)
  const [topbarHeight, setTopbarHeight] = useState(0)

  useEffect(() => setMounted(true), [])

  // Auto-open the Dispense Medicine modal when navigated here via the
  // Sidebar's "Dispense Medicine" link (/warehouse/dashboard?dispense=1),
  // then strip the query param so refreshing/back doesn't reopen it.
  useEffect(() => {
    if (searchParams.get('dispense') === '1') {
      setShowDispenseModal(true)
      router.replace('/warehouse/dashboard')
    }
  }, [searchParams, router])

  useEffect(() => {
    const measure = () => {
      if (topbarRef.current) {
        setTopbarHeight(topbarRef.current.offsetHeight)
      }
    }
    measure()

    const ro = new ResizeObserver(measure)
    if (topbarRef.current) ro.observe(topbarRef.current)
    window.addEventListener('resize', measure)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

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
        <div ref={topbarRef}>
          <Topbar />
        </div>

        {/* Fixed-height wrapper — buong page/window hindi na nagsscroll.
            Height nito = viewport minus Topbar, at hindi na sya sumosobra pababa. */}
        <div
          style={{
            height: topbarHeight ? `calc(100vh - ${topbarHeight}px)` : '100vh',
            overflow: 'hidden',
            display: 'flex',
            gap: 20,
            alignItems: 'stretch',
            padding: '20px',
            boxSizing: 'border-box',
          }}
        >

          {/* LEFT column — header + buong grid. Ito lang ang may internal scroll. */}
          <div
            style={{
              flex: 1,
              minWidth: 760,
              height: '100%',
              overflowY: 'auto',
              overflowX: 'hidden',
              paddingRight: 4,
            }}
          >

            {/* Page header — title lang na ngayon; ang "Dispense Medicine" action
                ay pumunta na sa Sidebar bilang permanent nav item, kaya inalis na
                dito yung button (walang duplicate entry point). */}
            <div style={{ marginBottom: 22 }}>
              <p className={styles.pageEyebrow} style={{ letterSpacing: '0.12em', marginBottom: 4 }}>Warehouse</p>
              <h1 className={styles.pageTitle} style={{ fontSize: 36, lineHeight: 1.1, letterSpacing: '0.01em', color: '#0d3b1f', fontWeight: 1000 }}>DASHBOARD</h1>
            </div>

            <div
              style={{
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
          </div>

          {/* RIGHT column — Pharmacy Requests, tulad ng dati. */}
          <div
            style={{
              width: 360,
              flexShrink: 0,
              height: '100%',
              overflow: 'hidden',
            }}
          >
            <PharmacyRequestsCard />
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