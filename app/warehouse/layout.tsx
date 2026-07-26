'use client'
import { ReactNode, useState, useEffect } from 'react'
import { useTheme } from 'next-themes'
import { WarehouseModalsProvider, useWarehouseModals } from './components/WarehouseModalsContext'
import AddMedicineModal from './components/AddMedicineModal'
import DispenseMedicineModal from './components/DispenseMedicineModal'
import styles from './components/warehouse.module.css'

export default function WarehouseLayout({ children }: { children: ReactNode }) {
  return (
    <WarehouseModalsProvider>
      {children}
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