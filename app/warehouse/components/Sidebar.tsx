'use client'
import { useState, useEffect, CSSProperties } from 'react'
import { useTheme } from 'next-themes'
import { LayoutDashboard, Package, PackageMinus, ClipboardList, Settings, LogOut } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useWarehouseModals } from './WarehouseModalsContext'

// ── Font: Nunito, matching the pharmacist side. Guarded by id so it only
//    ever runs once regardless of which component mounts first.
const injectWarehouseFont = () => {
  if (typeof document === 'undefined') return
  const id = 'warehouse-font-nunito'
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@300;400;500;600;700;800;900&display=swap'
  document.head.appendChild(link)
  const style = document.createElement('style')
  style.id = id + '-style'
  style.textContent = `body, body * { font-family: 'Nunito', sans-serif; }`
  document.head.appendChild(style)
}
if (typeof window !== 'undefined') injectWarehouseFont()

// ── Palette — same values as the pharmacist side's usePharTheme(), so the
//    two dashboards read as one design system.
function usePalette(dark: boolean) {
  return {
    green: '#16a34a', greenDark: '#0d3b1f', greenMid: '#166534', greenLight: '#dcfce7', mint: '#4ade80',
    bg: dark ? '#061a0d' : '#f0f7f2',
    surface: dark ? '#0d2516' : '#ffffff',
    border: dark ? 'rgba(74,222,128,0.1)' : 'rgba(22,163,74,0.15)',
    text: dark ? '#e2f5e9' : '#0a2912',
    text2: dark ? '#9abea6' : '#4b6557',
    text3: dark ? '#4b6557' : '#9ca3af',
    accentSoft: dark ? 'rgba(74,222,128,0.12)' : '#dcfce7',
    shadow: dark ? '0 2px 16px rgba(0,0,0,0.4)' : '0 2px 16px rgba(13,59,31,0.08)',
  }
}

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
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = mounted && theme === 'dark'
  const C = usePalette(dark)

  const { showAddMedicine, showDispense } = useWarehouseModals()
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [today, setToday] = useState({ day: 0, month: 0, year: 0 })
  const [viewMonth, setViewMonth] = useState(0)
  const [viewYear, setViewYear] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)

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

  // Real page links (still navigate normally) — unchanged from before.
  const menuItems = [
    { name: 'Dashboard', icon: LayoutDashboard, href: '/warehouse/dashboard' },
    { name: 'Medicine Inventory', icon: Package, href: '/warehouse/medicinestock' },
    { name: 'Dispense Medicine', icon: PackageMinus, href: '/warehouse/releases' },
    { name: 'Request Medicine', icon: ClipboardList, href: '/warehouse/requests' },
  ]

  // Only one nav item should ever look "active" at a time. Page links use
  // pathname, which doesn't change when a modal opens on top of the current
  // page — so while a modal is open (triggered elsewhere, e.g. from a page
  // button), we suppress the pathname-based highlight so no stale item stays
  // green underneath the modal.
  const anyModalOpen = showAddMedicine || showDispense

  const generalItems = [
    { name: 'Profile', icon: Settings, href: '/warehouse/settings' },
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

  const navBtnBase: CSSProperties = {
    width: '100%', display: 'flex', alignItems: 'center',
    gap: collapsed ? 0 : 10, justifyContent: collapsed ? 'center' : 'flex-start',
    padding: collapsed ? '9px' : '9px 14px', borderRadius: 12, marginBottom: 3,
    border: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left',
    fontFamily: 'inherit', textDecoration: 'none', position: 'relative',
    transition: 'background .15s, transform .15s',
  }

  const NavLink = ({ name, icon: Icon, href }: { name: string; icon: React.ElementType; href: string }) => {
    const on = pathname === href && !anyModalOpen
    const isHovered = hovered === name
    return (
      <Link
        href={href}
        title={collapsed ? name : undefined}
        onMouseEnter={() => setHovered(name)}
        onMouseLeave={() => setHovered(null)}
        style={{
          ...navBtnBase,
          background: on ? `linear-gradient(135deg, ${C.greenMid} 0%, ${C.green} 100%)` : isHovered ? C.accentSoft : 'transparent',
          color: on ? '#ffffff' : C.text2,
          fontWeight: on ? 600 : 400,
          boxShadow: on ? `0 4px 18px ${C.green}44, inset 0 1px 0 rgba(255,255,255,0.15)` : 'none',
        }}
      >
        {on && <span style={{ position: 'absolute', left: 0, top: '22%', bottom: '22%', width: 3, borderRadius: 2, background: 'rgba(255,255,255,0.55)' }} />}
        <span style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          background: on ? 'rgba(255,255,255,0.18)' : isHovered ? C.accentSoft : 'transparent',
        }}>
          <Icon size={15} strokeWidth={on ? 2.5 : 2} />
        </span>
        {!collapsed && <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>}
      </Link>
    )
  }

  return (
    <>
      <div style={{
        position: 'sticky', top: 0, height: '100vh', flexShrink: 0, zIndex: 100,
        width: collapsed ? 78 : 264, transition: 'width 0.25s cubic-bezier(0.22,1,0.36,1)',
      }}>
        <aside style={{
          width: '100%', height: '100vh', background: C.bg, display: 'flex', flexDirection: 'column',
          borderRight: `1px solid ${C.border}`, flexShrink: 0, position: 'relative', overflow: 'hidden',
        }}>
          <div id="wh-sidebar-logo-block" style={{
            padding: '10px 14px 8px', borderBottom: `1px solid ${C.border}`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
          }}>
            <div style={{
              width: collapsed ? 32 : 38, height: collapsed ? 32 : 38, borderRadius: collapsed ? 10 : 12, flexShrink: 0,
              background: `linear-gradient(135deg, ${C.green}, ${C.mint})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              boxShadow: `0 3px 10px rgba(22,163,74,0.28), inset 0 1px 0 rgba(255,255,255,0.25)`,
            }}>
              <Image src="/rhulogo.png" alt="MHO Logo" width={38} height={38} style={{ objectFit: 'cover' }} />
            </div>
            {!collapsed && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 800, fontSize: 12, lineHeight: 1.2, color: dark ? C.mint : C.green }}>Rural Healthcare Unit</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: C.text3, marginTop: 0 }}>Lopez, Quezon</div>
              </div>
            )}
          </div>

          <nav style={{ padding: '14px 10px 0', flex: 1 }}>
            {!collapsed && <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: C.text3, marginBottom: 8, paddingLeft: 6 }}>Menu</div>}
            {menuItems.map(item => <NavLink key={item.name} {...item} />)}

            <div style={{ height: 1, margin: '10px 6px', background: `linear-gradient(90deg, transparent, ${C.border} 30%, ${C.border} 70%, transparent)` }} />

            {!collapsed && <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: C.text3, marginBottom: 8, paddingLeft: 6 }}>General</div>}
            {generalItems.map(item => <NavLink key={item.name} {...item} />)}

            <div style={{ height: 1, margin: '8px 6px', background: C.border }} />

            <button
              onClick={() => setShowLogoutConfirm(true)}
              onMouseEnter={() => setHovered('__logout__')}
              onMouseLeave={() => setHovered(null)}
              title={collapsed ? 'Logout' : undefined}
              style={{
                ...navBtnBase, marginTop: 2,
                background: hovered === '__logout__' ? 'rgba(220,38,38,0.07)' : 'transparent',
                color: dark ? '#f08080' : '#dc2626', fontWeight: 500,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 8, flexShrink: 0 }}>
                <LogOut size={15} strokeWidth={2} />
              </span>
              {!collapsed && <span>Logout</span>}
            </button>
          </nav>

          {!collapsed && (
            <div style={{ margin: '0 10px 16px', padding: '12px 12px 10px', background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, boxShadow: C.shadow }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <button onClick={goPrevMonth} style={{ background: C.accentSoft, border: 'none', borderRadius: 6, width: 22, height: 22, cursor: 'pointer', color: dark ? C.mint : C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, lineHeight: 1 }}>‹</button>
                <span style={{ fontWeight: 800, fontSize: 11, letterSpacing: 1, color: dark ? C.mint : C.green }}>{months[viewMonth].toUpperCase()} {viewYear}</span>
                <button onClick={goNextMonth} style={{ background: C.accentSoft, border: 'none', borderRadius: 6, width: 22, height: 22, cursor: 'pointer', color: dark ? C.mint : C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, lineHeight: 1 }}>›</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, textAlign: 'center' }}>
                {days.map((d, i) => (
                  <div key={i} style={{ fontWeight: 700, color: '#9ca3af', padding: '2px 0', fontSize: 9, letterSpacing: 0.5 }}>{d}</div>
                ))}
                {getDates().map((d, i) => {
                  if (!d) return <div key={i} />
                  const isSun = i % 7 === 0
                  const isToday = d === today.day && viewMonth === today.month && viewYear === today.year
                  const holidayName = isHoliday(viewMonth, d)
                  return (
                    <div key={i} title={holidayName || undefined} style={{
                      padding: '3px 0', borderRadius: 6, cursor: holidayName ? 'help' : 'default',
                      background: isToday ? `linear-gradient(135deg, ${C.green}, ${C.mint})` : 'transparent',
                      color: isToday ? '#ffffff' : (holidayName || isSun ? '#dc2626' : C.text2),
                      fontWeight: isToday || holidayName || isSun ? 700 : 400, fontSize: 10,
                      boxShadow: isToday ? `0 2px 8px ${C.green}44` : 'none',
                    }}>{d}</div>
                  )
                })}
              </div>
            </div>
          )}
        </aside>

        <button
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            position: 'absolute', top: 68, right: -14, transform: 'translateY(-50%)',
            width: 28, height: 28, borderRadius: '50%', background: C.green, border: '2px solid #ffffff',
            boxShadow: '0 2px 10px rgba(22,163,74,0.45)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
            color: '#ffffff', fontSize: 13, fontWeight: 900, lineHeight: 1,
          }}
        >
          <span style={{ display: 'inline-block', transition: 'transform 0.25s cubic-bezier(0.22,1,0.36,1)', transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)', fontSize: 14, lineHeight: 1 }}>‹</span>
        </button>
      </div>

      {/* Logout Confirmation Modal — same markup/behavior as before, restyled inline to match the shared green palette instead of the CSS module. */}
      {showLogoutConfirm && (
        <div
          onClick={() => setShowLogoutConfirm(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 360, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
            <div style={{ background: C.green, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 16, color: '#ffffff' }}>Logout</span>
              <button onClick={() => setShowLogoutConfirm(false)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>✕</button>
            </div>
            <div style={{ padding: '32px 24px 20px', textAlign: 'center' }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', margin: '0 auto 20px', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <LogOut size={28} color="#dc2626" strokeWidth={2} />
              </div>
              <p style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>Are you sure?</p>
              <p style={{ fontSize: 13, color: '#6b7280', margin: 0, lineHeight: 1.5 }}>You will be logged out of the system.</p>
            </div>
            <div style={{ padding: '8px 24px 24px', display: 'flex', gap: 10 }}>
              <button onClick={() => setShowLogoutConfirm(false)} style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: '1.5px solid rgba(220,38,38,0.3)', background: '#ffffff', color: '#dc2626', fontSize: 13, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5, fontFamily: 'inherit' }}>CANCEL</button>
              <button onClick={handleLogout} style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: 'none', background: C.green, color: '#ffffff', fontSize: 13, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5, boxShadow: '0 4px 14px rgba(22,163,74,0.35)', fontFamily: 'inherit' }}>LOGOUT</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}