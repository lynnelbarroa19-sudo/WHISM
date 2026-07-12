'use client'
import { useState, useEffect } from 'react'
import { LayoutDashboard, Package, Settings, LogOut } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import styles from './warehouse.module.css'

// Fixed-date Philippine holidays (month is 0-indexed to match JS Date).
// Lunar/movable holidays (Holy Week, Eid, Chinese New Year) are intentionally
// excluded since they shift every year and need a separate lookup table.
const PH_HOLIDAYS: Record<string, string> = {
  '0-1':   "New Year's Day",
  '1-25':  'EDSA People Power Anniversary',
  '3-9':   'Araw ng Kagitingan',
  '4-1':   'Labor Day',
  '5-12':  'Independence Day',
  '7-21':  'Ninoy Aquino Day',
  '7-25':  'National Heroes Day',
  '9-31':  "All Saints' Day Eve",
  '10-1':  "All Saints' Day",
  '10-30': 'Bonifacio Day',
  '11-8':  'Feast of the Immaculate Conception',
  '11-24': 'Christmas Eve',
  '11-25': 'Christmas Day',
  '11-30': 'Rizal Day',
  '11-31': "New Year's Eve",
}

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [today, setToday] = useState({ day: 0, month: 0, year: 0 })
  const [viewMonth, setViewMonth] = useState(0)
  const [viewYear, setViewYear] = useState(0)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const now = new Date()
    setToday({ day: now.getDate(), month: now.getMonth(), year: now.getFullYear() })
    setViewMonth(now.getMonth())
    setViewYear(now.getFullYear())
  }, [])

  const goPrevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }

  const goNextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  const isHoliday = (month: number, day: number) => PH_HOLIDAYS[`${month}-${day}`]

  const handleLogout = () => {
    localStorage.removeItem('userRole')
    localStorage.removeItem('userName')
    localStorage.removeItem('userId')
    localStorage.removeItem('isFirstLogin')
    localStorage.removeItem('userAvatar')
    router.push('/login')
  }

  const menuItems = [
    { name: 'Dashboard', icon: <LayoutDashboard size={16} />, href: '/warehouse/dashboard' },
    { name: 'Medicine Inventory', icon: <Package size={16} />, href: '/warehouse/medicinestock' },
  ]

  const generalItems = [
    { name: 'Settings', icon: <Settings size={16} />, href: '/warehouse/settings' },
  ]

  const months = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const days = ['S','M','T','W','T','F','S']

  const getDates = () => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay()
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    const dates: (number | null)[] = Array(firstDay).fill(null)
    for (let i = 1; i <= daysInMonth; i++) dates.push(i)
    return dates
  }

  return (
    <>
     <div className={styles.sidebar} style={{ width: collapsed ? 64 : 240, transition: 'width .2s ease', overflowX: 'visible', position: 'relative' }}>

        <div
  className={styles.sidebarLogo}
  style={{
    justifyContent: collapsed ? 'center' : 'flex-start',
    padding: collapsed ? '18px 8px' : undefined,
  }}
>
  <div className={styles.logoSeal}>
    <Image src="/logo.jpg" alt="MHO Logo" width={45} height={45} />
  </div>

  {!collapsed && (
    <div style={{ overflow: 'hidden' }}>
      <div className={styles.logoName}>
        Rural Healthcare Unit<br />
        - Lopez, Quezon
      </div>
    </div>
  )}
</div>
        

        {/* Collapse / expand toggle — green circle, floating on the right edge */}
        <button
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            position: 'absolute',
            top: 68,
            right: 0,
            width: 22, height: 22,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--green), var(--green-mid))',
            border: '2px solid var(--surface)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 3px 10px rgba(22,163,74,.4)',
            zIndex: 15,
            padding: 0,
          }}
        >
          <svg
            width="11" height="11" viewBox="0 0 24 24" fill="none"
            stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <nav className={styles.sidebarNav}>
          <div className={styles.navSection}>
            {!collapsed && <span className={styles.navSectionLabel}>Menu</span>}
            {menuItems.map(item => (
              <Link
                key={item.name}
                href={item.href}
                title={collapsed ? item.name : undefined}
                className={`${styles.navItem} ${pathname === item.href ? styles.navItemActive : ''}`}
                style={collapsed ? { justifyContent: 'center', padding: '9px 0' } : undefined}>
                {item.icon}
                {!collapsed && item.name}
              </Link>
            ))}
          </div>

          <div className={styles.navSection}>
            {!collapsed && <span className={styles.navSectionLabel}>General</span>}
            {generalItems.map(item => (
              <Link
                key={item.name}
                href={item.href}
                title={collapsed ? item.name : undefined}
                className={`${styles.navItem} ${pathname === item.href ? styles.navItemActive : ''}`}
                style={collapsed ? { justifyContent: 'center', padding: '9px 0' } : undefined}>
                {item.icon}
                {!collapsed && item.name}
              </Link>
            ))}
            <button
              onClick={() => setShowLogoutConfirm(true)}
              title={collapsed ? 'Logout' : undefined}
              className={`${styles.navItem} ${styles.navItemLogout}`}
              style={collapsed ? { justifyContent: 'center', padding: '9px 0' } : undefined}>
              <LogOut size={16} />
              {!collapsed && 'Logout'}
            </button>
          </div>
        </nav>

        {/* Mini calendar — hidden when collapsed */}
        {!collapsed && (
          <div className={styles.miniCal}>
            <div className={styles.calHeader}>
              <button
                onClick={goPrevMonth}
                style={{ border: 'none', background: 'transparent', color: 'var(--text2)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <span className={styles.calTitle}>{months[viewMonth]} {viewYear}</span>
              <button
                onClick={goNextMonth}
                style={{ border: 'none', background: 'transparent', color: 'var(--text2)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
            <div className={styles.calGrid} style={{ minHeight: 168 }}>
              {days.map((d, i) => (
                <div
                  key={i}
                  className={styles.calDow}
                  style={i === 0 ? { color: '#ef4444' } : undefined}
                >{d}</div>
              ))}
              {getDates().map((d, i) => {
                if (!d) return <div key={i} />
                const dayOfWeek = i % 7
                const isSunday = dayOfWeek === 0
                const isToday = d === today.day && viewMonth === today.month && viewYear === today.year
                const holidayName = isHoliday(viewMonth, d)
                return (
                  <div
                    key={i}
                    title={holidayName || undefined}
                    className={`${styles.calDay} ${isToday ? styles.calDayToday : ''}`}
                    style={
                      isToday ? undefined :
                      holidayName ? { background: 'var(--green-light)', color: 'var(--green)', fontWeight: 700 } :
                      isSunday ? { color: '#ef4444', fontWeight: 600 } :
                      undefined
                    }
                  >
                    {d}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modal} style={{ maxWidth: 360 }}>
            <div className={styles.modalHeader}>
              <h2>Logout</h2>
              <button className={styles.modalClose} onClick={() => setShowLogoutConfirm(false)}>✕</button>
            </div>
            <div className={styles.modalBody}>
              <div className={`${styles.warnIcon} ${styles.warnIconRed}`}>
                <LogOut size={24} color="#ef4444" />
              </div>
              <p className={styles.warnTitle}>Are you sure?</p>
              <p className={styles.warnText}>You will be logged out of the system.</p>
            </div>
            <div className={styles.modalFooter}>
              <button
                className={styles.btnCancel}
                onClick={() => setShowLogoutConfirm(false)}>
                CANCEL
              </button>
              <button
                className={styles.btnConfirm}
                onClick={handleLogout}>
                LOGOUT
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}