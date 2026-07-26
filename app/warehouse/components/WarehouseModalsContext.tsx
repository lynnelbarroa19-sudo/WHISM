'use client'
import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react'

interface WarehouseModalsContextValue {
  // Add Medicine
  showAddMedicine: boolean
  openAddMedicine: () => void
  closeAddMedicine: () => void

  // Dispense Medicine
  showDispense: boolean
  openDispense: () => void
  closeDispense: () => void

  // Bump these to tell whichever page is mounted "your data is stale, refetch".
  // Pages read the number (e.g. as a React `key`) and re-render/refetch when it changes.
  inventoryRefreshKey: number
  bumpInventoryRefresh: () => void

  dashboardRefreshKey: number
  bumpDashboardRefresh: () => void

  // One shared toast for actions triggered from the sidebar modals, so a
  // success message shows no matter which page you were on when you acted.
  toast: string
  showToast: (msg: string) => void
}

const WarehouseModalsContext = createContext<WarehouseModalsContextValue | null>(null)

export function WarehouseModalsProvider({ children }: { children: ReactNode }) {
  const [showAddMedicine, setShowAddMedicine] = useState(false)
  const [showDispense, setShowDispense] = useState(false)
  const [inventoryRefreshKey, setInventoryRefreshKey] = useState(0)
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3000)
  }, [])

  const value: WarehouseModalsContextValue = {
    showAddMedicine,
    openAddMedicine: () => setShowAddMedicine(true),
    closeAddMedicine: () => setShowAddMedicine(false),

    showDispense,
    openDispense: () => setShowDispense(true),
    closeDispense: () => setShowDispense(false),

    inventoryRefreshKey,
    bumpInventoryRefresh: () => setInventoryRefreshKey(k => k + 1),

    dashboardRefreshKey,
    bumpDashboardRefresh: () => setDashboardRefreshKey(k => k + 1),

    toast,
    showToast,
  }

  return (
    <WarehouseModalsContext.Provider value={value}>
      {children}
    </WarehouseModalsContext.Provider>
  )
}

// Throws loudly if used outside the provider — better than a silent no-op
// that would make the sidebar buttons quietly do nothing.
export function useWarehouseModals() {
  const ctx = useContext(WarehouseModalsContext)
  if (!ctx) {
    throw new Error('useWarehouseModals must be used within a WarehouseModalsProvider')
  }
  return ctx
}