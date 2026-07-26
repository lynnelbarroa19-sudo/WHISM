'use client'
import React, { useState, useEffect } from 'react'
import {
  LayoutDashboard, Users, Settings, HelpCircle, LogOut, Activity,
  FlaskConical, Package, UserCog, ShieldCheck, Monitor, Database,
  FileBarChart, Bell,
} from 'lucide-react'


interface SidebarProps {
  activeMenu:     string
  setActiveMenu:  (m: string) => void
  sidebarOpen:    boolean
  setSidebarOpen?: (v: boolean) => void   // optional — enables mobile drawer close
  onLogout:       () => void
  darkMode:       boolean
}

/* Responsive helper */
function useIsMobile(bp = 820) {
  const [m, setM] = useState(false)
  useEffect(() => {
    const f = () => setM(window.innerWidth < bp)
    f(); window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [bp])
  return m
}

const injectStyles = () => {
  if (typeof document === 'undefined') return
  const id = 'smartrhu-admin-sidebar-styles'
  if (document.getElementById(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@300;400;500;600;700;800;900&display=swap');
    .srhu-admin-sidebar {
  font-family: 'Nunito', sans-serif;
}
    .srhu-admin-nav-btn { position: relative; overflow: hidden; }
    .srhu-admin-pulse { animation: admin-pulse-dot 2.5s ease-in-out infinite; }
    @keyframes admin-pulse-dot {
      0%, 100% { opacity: 0.5; box-shadow: 0 0 4px rgba(34,197,94,0.4); }
      50% { opacity: 1; box-shadow: 0 0 10px rgba(34,197,94,0.8); }
    }
    .srhu-admin-slide-in { animation: adminSlideIn 0.3s cubic-bezier(0.22, 1, 0.36, 1) both; }
    @keyframes adminSlideIn { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: translateX(0); } }
    .srhu-admin-cal-day:hover { background: rgba(26,122,26,0.12) !important; border-radius: 6px; }
    .srhu-admin-logout-icon { transition: transform 0.2s ease; }
    .srhu-admin-logout-btn:hover .srhu-admin-logout-icon { transform: translateX(2px); }
    .srhu-admin-badge {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 18px; height: 18px; border-radius: 9px; font-size: 10px;
      font-weight: 700; padding: 0 5px;
     background: linear-gradient(135deg,#16a34a,#4ade80);
      margin-left: auto; box-shadow: 0 2px 6px rgba(34,197,94,0.4);
    }
  `
  document.head.appendChild(style)
}
if (typeof window !== 'undefined') injectStyles()

function MiniCalendar({ darkMode }: { darkMode: boolean }) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const today = new Date()
  const month = currentDate.toLocaleString('default', { month: 'long' }).toUpperCase()
  const year  = currentDate.getFullYear()
  const firstDay    = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay()
  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()
  const days = ['S','M','T','W','T','F','S']

  const navBtnStyle: React.CSSProperties = {
    background: darkMode ? 'rgba(26,122,26,0.1)' : 'rgba(26,122,26,0.07)',
    border: 'none', borderRadius: 6, width: 22, height: 22,
    cursor: 'pointer', color: darkMode ? '#4db86a' : '#1a7a1a',
    display:'flex', alignItems:'center', justifyContent:'center',
    fontSize: 14, fontWeight: 700, lineHeight: 1, transition: 'background 0.15s',
  }

  return (
    <div style={{ fontFamily: "'Nunito', sans-serif" }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
        <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth()-1, 1))} style={navBtnStyle}>‹</button>
        <span style={{ fontWeight:700, fontSize:10, letterSpacing:1, color: darkMode?'#4db86a':'#1a7a1a' }}>{month} {year}</span>
        <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 1))} style={navBtnStyle}>›</button>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:1, textAlign:'center' }}>
        {days.map((d, i) => (
          <div key={i} style={{ fontWeight:700, color:darkMode?'#3a6b48':'#a8c0a8', padding:'2px 0', fontSize:9, letterSpacing:0.5 }}>{d}</div>
        ))}
        {Array.from({ length: firstDay }).map((_, i) => <div key={`b${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1
          const isToday = day===today.getDate() && currentDate.getMonth()===today.getMonth() && currentDate.getFullYear()===today.getFullYear()
          return (
            <div key={day} className="srhu-admin-cal-day" style={{
              padding:'3px 0', borderRadius:6, cursor:'pointer',
              background: isToday?'linear-gradient(135deg, #1a7a1a, #22c55e)':'transparent',
              color: isToday?'#fff':darkMode?'#4db86a':'#024b18',
              fontWeight: isToday?700:400, fontSize:10,
              boxShadow: isToday?'0 2px 8px rgba(26,122,26,0.4)':'none', transition:'background 0.15s',
            }}>{day}</div>
          )
        })}
      </div>
    </div>
  )
}

export default function AdminSidebar({ activeMenu, setActiveMenu, sidebarOpen, setSidebarOpen, onLogout, darkMode }: SidebarProps) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
  const mobile = useIsMobile()

  // On mobile the drawer is always full-width (no 72px collapsed mode)
  const expanded = mobile ? true : sidebarOpen

  const menuItems = [
    { label:'Dashboard',            icon: LayoutDashboard, section:'Menu'           },
    { label:'Patient Records',      icon: Users,           section:'Menu'           },
    { label:'Laboratory Records',   icon: FlaskConical,    section:'Menu'           },
    { label:'Medicine Inventory',  icon: Package,         section:'Menu'           },
    { label:'Generate Report',      icon: FileBarChart,    section:'Menu'           },
    { label:'User Management',      icon: UserCog,         section:'Administration' },
    { label:'System Activities',    icon: Monitor,         section:'Administration' },
    { label:'Backup & Restore',     icon: Database,        section:'Administration' },
    { label:'Settings',             icon: Settings,        section:'General'        },
  ]

  const borderCol  = darkMode ? 'rgba(26,122,26,0.12)' : 'rgba(109,40,217,0.1)'
  const sectionCol = darkMode ? '#3a6b48' : '#04bc50'

  const NavBtn = ({ label, icon: Icon, active }: { label: string; icon: React.ElementType; active: boolean }) => {
    const hovered = hoveredItem === label
    return (
      <button
        className="srhu-admin-nav-btn"
        onClick={() => { setActiveMenu(label); if (mobile) setSidebarOpen?.(false) }}
        onMouseEnter={() => setHoveredItem(label)}
        onMouseLeave={() => setHoveredItem(null)}
        style={{
          width:'100%', display:'flex', alignItems:'center',
          gap: expanded ? 10 : 0,
          justifyContent: expanded ? 'flex-start' : 'center',
          padding: expanded ? '9px 14px' : '9px',
          borderRadius: 12, marginBottom: 3,
          background: active
            ? darkMode ? 'linear-gradient(135deg,#0a1a0d,#1a4d1a)' : 'linear-gradient(135deg,#1a7a1a,#26a326)'
            : hovered ? darkMode?'rgba(26,122,26,0.08)':'rgba(26,122,26,0.07)' : 'transparent',
          color: active ? '#fff' : darkMode ? '#4db86a' : '#013308',
          border: 'none', cursor:'pointer', fontSize:13,
          fontWeight: active ? 600 : 400, transition: 'all 0.18s ease',
          boxShadow: active ? darkMode
            ? '0 4px 18px rgba(26,122,26,0.4),inset 0 1px 0 rgba(255,255,255,0.1)'
            : '0 4px 18px rgba(26,122,26,0.25),inset 0 1px 0 rgba(255,255,255,0.25)'
            : 'none',
          position:'relative',
        }}
      >
        {active && <span style={{ position:'absolute', left:0, top:'22%', bottom:'22%', width:3, borderRadius:2, background:'rgba(255,255,255,0.55)' }}/>}
        <span style={{ display:'flex', alignItems:'center', justifyContent:'center', width:28, height:28, borderRadius:8, flexShrink:0,
          background: active?'rgba(255,255,255,0.18)':hovered?darkMode?'rgba(26,122,26,0.12)':'rgba(109,40,217,0.1)':'transparent', transition:'background 0.18s' }}>
          <Icon size={15} strokeWidth={active?2.5:2}/>
        </span>
        {expanded && <span style={{ flex:1, textAlign:'left' }}>{label}</span>}
      </button>
    )
  }

  const sections = ['Menu','Administration','General']

  /* Width / position behaves differently on mobile (overlay) vs desktop (inline column) */
  const asideStyle: React.CSSProperties = {
    height:'100vh',
    background: darkMode ? 'linear-gradient(180deg,#0a1a0d,#081408)' : 'linear-gradient(180deg,#f4fbf4,#edf7ed)',
    display:'flex', flexDirection:'column',
    borderRight: `1px solid ${borderCol}`,
    flexShrink:0, overflow:'hidden',
    ...(mobile ? {
      position:'fixed', top:0, left:0, height:'100vh', width:260, zIndex:1200,
      transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
      transition:'transform 0.28s cubic-bezier(0.22,1,0.36,1)',
      boxShadow: sidebarOpen ? '4px 0 28px rgba(0,0,0,0.28)' : 'none',
    } : {
      position:'relative', width: sidebarOpen ? 252 : 72,
      transition:'width 0.25s cubic-bezier(0.22,1,0.36,1)',
    }),
  }

  return (
    <>
      {/* Mobile backdrop */}
      {mobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen?.(false)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1199 }} />
      )}

      <aside className="srhu-admin-sidebar" style={asideStyle}>
        {/* Background blobs */}
        <div style={{ position:'absolute', top:-80, right:-80, width:220, height:220, borderRadius:'50%', background:darkMode?'radial-gradient(circle,rgba(26,122,26,0.14),transparent 70%)':'radial-gradient(circle,rgba(26,122,26,0.1),transparent 70%)', pointerEvents:'none' }}/>

        {/* Logo */}
        <div style={{ padding:'18px 14px 16px', borderBottom:`1px solid ${borderCol}`, display:'flex', alignItems:'center', gap:12, overflow:'hidden' }}>
          <div style={{ width:44, height:44, borderRadius:13, flexShrink:0,background:'linear-gradient(135deg,#0d3b1f,#166534)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 4px 16px rgba(26,122,26,0.3)', overflow:'hidden' }}>
            <img src="/logo.jpg" alt="SMARTRHU" style={{ width:44, height:44, borderRadius:13, objectFit:'cover' }} onError={e=>{(e.target as HTMLImageElement).style.display='none'}}/>
            <Activity size={20} color="#fff" strokeWidth={2.5} style={{ position:'absolute' }}/>
          </div>
          {expanded && (
            <div className="srhu-admin-slide-in" style={{ overflow:'hidden' }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, letterSpacing:0.5, lineHeight:1.1, color:darkMode?'#e2f5e9':'#0a2912', whiteSpace:'nowrap' }}>Rural Healthcare Unit<br/>- Lopez, Quezon</div>
              <div style={{ fontSize:10, fontWeight:500, color:darkMode?'#3a6b48':'#9f7ad8', marginTop:4, whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:5 }}>
                <span className="srhu-admin-pulse" style={{ display:'inline-block', width:6, height:6, borderRadius:'50%', background:'#22c55e', flexShrink:0 }}/>
                Admin Panel
              </div>
            </div>
          )}
        </div>
        

        {/* Navigation */}
        <nav style={{ padding:'14px 10px 0', flex:1, position:'relative', zIndex:1, overflowY:'auto', overflowX:'hidden' }}>
          {sections.map((section, si) => (
            <React.Fragment key={section}>
              {si > 0 && <div style={{ height:1, margin:'10px 6px', background:`linear-gradient(90deg,transparent,${borderCol} 30%,${borderCol} 70%,transparent)` }}/>}
              {expanded && <div style={{ fontSize:9, fontWeight:700, letterSpacing:1.5, textTransform:'uppercase', color:sectionCol, marginBottom:8, paddingLeft:6 }}>{section}</div>}
              {menuItems.filter(i=>i.section===section).map(({ label, icon }) => (
                <NavBtn key={label} label={label} icon={icon} active={activeMenu===label}/>
              ))}
            </React.Fragment>
          ))}

          <div style={{ height:1, margin:'8px 6px', background:borderCol }}/>

          <button
            className="srhu-admin-logout-btn"
            onClick={onLogout}
            onMouseEnter={() => setHoveredItem('__logout__')}
            onMouseLeave={() => setHoveredItem(null)}
            style={{
              width:'100%', display:'flex', alignItems:'center',
              gap: expanded ? 10 : 0, justifyContent: expanded ? 'flex-start' : 'center',
              padding: expanded ? '9px 14px' : '9px', borderRadius:12, marginTop:2, marginBottom:16,
              background: hoveredItem==='__logout__'?'rgba(229,62,62,0.07)':'transparent',
              color: darkMode?'#f08080':'#d94040', border:'none', cursor:'pointer', fontSize:13, fontWeight:500, transition:'all 0.18s ease',
            }}>
            <span style={{ display:'flex', alignItems:'center', justifyContent:'center', width:28, height:28, borderRadius:8, background:hoveredItem==='__logout__'?'rgba(229,62,62,0.1)':'transparent', transition:'background 0.18s', flexShrink:0 }}>
              <LogOut className="srhu-admin-logout-icon" size={15} strokeWidth={2}/>
            </span>
            {expanded && <span>Logout</span>}
          </button>
        </nav>

        {/* Mini Calendar */}
        {expanded && (
          <div style={{ margin:'0 10px 16px', padding:'12px 12px 10px', background:darkMode?'rgba(10,20,10,0.85)':'rgba(255,255,255,0.85)', borderRadius:14, border:`1px solid ${borderCol}`, backdropFilter:'blur(8px)', position:'relative', zIndex:1 }}>
            <MiniCalendar darkMode={darkMode}/>
          </div>
        )}
      </aside>
    </>
  )
}