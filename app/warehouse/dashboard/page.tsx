'use client'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import StatsCards from '../components/StatsCard'
import StockLevelCard from '../components/StockLevelCard'
import DispensedMedicineCard from '../components/DispensedMedicineCard'
import DispenseMedicineModal from '../components/DispenseMedicineModal'
import MedicineMovementAnalytics from '../components/MedicineMovementAnalytics'
import PredictionCard from '../components/PredictionCard'
import BarangayDistributionCard from '../components/Barangaydistributioncard'
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
  const searchParams = useSearchParams()
  const router = useRouter()
  const [showDispenseModal, setShowDispenseModal] = useState(false)
  const [toast, setToast] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  // Auto-open the Dispense Medicine modal when navigated here via the
  // Sidebar's "Dispense Medicine" link (/warehouse/dashboard?dispense=1),
  // then strip the query param so refreshing/back doesn't reopen it.
  useEffect(() => {
    if (searchParams.get('dispense') === '1') {
      setShowDispenseModal(true)
      router.replace('/warehouse/dashboard')
    }
  }, [searchParams, router])

  const handleDispenseSuccess = () => {
    setShowDispenseModal(false)
    setToast('Medicine dispensed successfully!')
    setRefreshKey(k => k + 1)
    setTimeout(() => setToast(''), 3000)
  }

  return (
    <>
      {/* Fixed-height wrapper synced to the shared layout's measured topbar
          height (--wh-topbar-h) — buong page/window hindi na nagsscroll. */}
      <div
        style={{
          height: 'calc(100vh - var(--wh-topbar-h, 62px))',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'stretch',
          padding: '20px',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            flex: 1,
            height: '100%',
            overflowY: 'auto',
            overflowX: 'hidden',
            paddingRight: 4,
          }}
        >
          <div style={{ marginBottom: 22 }}>
            <p className={styles.pageEyebrow} style={{ letterSpacing: '0.12em', marginBottom: 4 }}>Warehouse</p>
            <h1 className={styles.pageTitle} style={{ fontSize: 36, lineHeight: 1.1, letterSpacing: '0.01em', color: 'var(--text)', fontWeight: 1000 }}>DASHBOARD</h1>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gridTemplateRows: 'auto 380px 380px 380px',
              gridTemplateAreas: `
                "analytics  analytics"
                "expiring   dispensed"
                "movement   stock"
                "prediction barangay"
              `,
              gap: 18,
            }}
          >
            <StatsCards key={`stats-${refreshKey}`} />

            <div style={{ gridArea: 'movement', height: '100%', overflow: 'hidden' }}>
              <MedicineMovementAnalytics key={`movement-${refreshKey}`} />
            </div>

            <div style={{ gridArea: 'stock', height: '100%', overflow: 'hidden' }}>
              <StockLevelCard key={`stock-${refreshKey}`} />
            </div>

            <div style={{ gridArea: 'dispensed', height: '100%', overflow: 'hidden' }}>
              <DispensedMedicineCard key={`dispensed-${refreshKey}`} />
            </div>

            <div style={{ gridArea: 'prediction', height: '100%', overflow: 'hidden' }}>
              <PredictionCard key={`prediction-${refreshKey}`} />
            </div>

            <div style={{ gridArea: 'barangay', height: '100%', overflow: 'hidden' }}>
              <BarangayDistributionCard key={`barangay-${refreshKey}`} />
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
    </>
  )
}