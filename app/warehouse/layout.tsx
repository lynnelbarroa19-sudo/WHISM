'use client'
import { ReactNode, useState, useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import { WarehouseModalsProvider, useWarehouseModals } from './components/WarehouseModalsContext'
import AddMedicineModal from './components/AddMedicineModal'
import DispenseMedicineModal from './components/DispenseMedicineModal'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import styles from './components/warehouse.module.css'

export default function WarehouseLayout({ children }: { children: ReactNode }) {
  // ── Dark-mode class + measured Topbar height, so every page under
  //    /warehouse/* gets the same var(--text)/var(--border)/etc. CSS
  //    variables (defined only inside .root/.root.dark in
  //    warehouse.module.css) and the same --wh-topbar-h that
  //    dashboard/settings use for their "fixed viewport, own scroll"
  //    content wrappers.
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const topbarRef = useRef<HTMLDivElement>(null)
  const [topbarHeight, setTopbarHeight] = useState(0)
  useEffect(() => {
    const measure = () => { if (topbarRef.current) setTopbarHeight(topbarRef.current.offsetHeight) }
    measure()
    const ro = new ResizeObserver(measure)
    if (topbarRef.current) ro.observe(topbarRef.current)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  return (
    <WarehouseModalsProvider>
      {/* Sidebar/Topbar live INSIDE the provider — Sidebar itself calls
          useWarehouseModals() to know whether a modal is open (for nav
          active-state suppression), so it has to render below the
          provider, not above it. */}
      <div
        className={`${styles.root} ${mounted && theme === 'dark' ? styles.dark : ''}`}
        style={{ display: 'flex', minHeight: '100vh' }}
      >
        <Sidebar />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div ref={topbarRef}>
            <Topbar />
          </div>
          <div style={{ flex: 1, minWidth: 0, '--wh-topbar-h': `${topbarHeight}px` } as React.CSSProperties}>
            {children}
          </div>
        </div>
      </div>

      <GlobalWarehouseModals />
    </WarehouseModalsProvider>
  )
}

// Kept separate from WarehouseLayout so it can call useWarehouseModals() —
// that hook needs to run *inside* the provider, not in the component that
// renders the provider itself.
function GlobalWarehouseModals() {
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dk = mounted && theme === 'dark'

  const {
    showAddMedicine, closeAddMedicine, bumpInventoryRefresh,
    showDispense, closeDispense, bumpDashboardRefresh,
    toast, showToast,
  } = useWarehouseModals()

  return (
    <>
      {/* Add Medicine — opened from the sidebar, works from any page.
          activeTab defaults to 'medicine' (the Drug tab); switch to 'supply'
          here if you'd rather default to Supplies. */}
      <AddMedicineModal
        show={showAddMedicine}
        onClose={closeAddMedicine}
        onAdded={() => {
          bumpInventoryRefresh()
          showToast('Medicine added successfully!')
        }}
        showToast={showToast}
        activeTab="medicine"
        dk={dk}
      />

      {/* Dispense Medicine — opened from the sidebar, works from any page. */}
      {showDispense && (
        <DispenseMedicineModal
          onClose={closeDispense}
          onSuccess={() => {
            bumpDashboardRefresh()
            closeDispense()
            showToast('Medicine dispensed successfully!')
          }}
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