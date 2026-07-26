'use client'
import React, { useState } from 'react'
import AdminSidebar           from './AdminSidebar'
import AdminTopbar            from './AdminTopbar'
import Dashboard              from './Dashboard'
import LabRecords             from './LabRecords'
import MedicineInventory      from './MedicineInventory'
import GenerateReport         from './GenerateReports'
import UserManagement         from './UserManagement'
import RolesPermissions       from './RolePermissions'
import SystemActivities       from './SystemActivities'
import AdminSettings          from './Settings'
import BackupRestore          from './BackupRestore'
import NotificationSettings   from './NotificationSettings'
import { Activity }           from 'lucide-react'
import { supabase }           from '@/lib/supabase'
import { useRouter }          from 'next/navigation'
import { useEffect }          from 'react'

export default function AdminDashboard() {
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => (typeof window !== 'undefined' ? window.innerWidth >= 820 : true))
  const [isMobile,    setIsMobile]    = useState(false)
  const [fitScreen,   setFitScreen]   = useState(false)
  const [darkMode,    setDarkMode]    = useState(false)
  const [activeMenu,  setActiveMenu]  = useState('Dashboard')
  const router = useRouter()

  useEffect(() => {
    const f = () => { setIsMobile(window.innerWidth < 820); setFitScreen(window.innerWidth >= 1024) }
    f(); window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])

  const bg  = darkMode ? '#061a0d' : '#f0f7f2'
  const txt = darkMode ? '#e2f5e9' : '#0a2912'
  const sub = darkMode ? '#9abea6' : '#4b6557'
  const surface = darkMode ? '#0d2516' : '#ffffff'
  const border = darkMode ? 'rgba(74,222,128,0.1)' : 'rgba(22,163,74,0.15)'

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const renderContent = () => {
    switch (activeMenu) {
      case 'Dashboard':             return <Dashboard            darkMode={darkMode} onNavigate={setActiveMenu}/>
      case 'Patient Records':       return <PatientRecords       darkMode={darkMode}/>
      case 'Laboratory Records':    return <LabRecords           darkMode={darkMode}/>
      case 'Medicine Inventory':    return <MedicineInventory    darkMode={darkMode}/>
      case 'Generate Report':       return <GenerateReport       darkMode={darkMode}/>
      case 'User Management':       return <UserManagement       darkMode={darkMode}/>
      case 'Roles & Permissions':   return <RolesPermissions     darkMode={darkMode}/>
      case 'System Activities':     return <SystemActivities     darkMode={darkMode}/>
      case 'Backup & Restore':      return <BackupRestore        darkMode={darkMode}/>
      case 'Notifications':         return <NotificationSettings darkMode={darkMode}/>
      case 'Settings':              return <AdminSettings        darkMode={darkMode}/>
      default:
        return (
          <div style={{ textAlign:'center', padding:64, color:sub }}>
            <Activity size={48} color={darkMode?'#4b6557':'#9ca3af'} style={{ margin:'0 auto 16px' }}/>
            <div style={{ fontSize:14, fontWeight:600, color:txt }}>Select a menu item</div>
          </div>
        )
    }
  }

  return (
    <div className={`admin-shell${darkMode ? ' root dark' : ''}`} style={{ display:'flex', height:'100vh', overflow:'hidden', background:bg, fontFamily:"'Nunito', sans-serif" }}>
      <AdminSidebar activeMenu={activeMenu} setActiveMenu={setActiveMenu} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} onLogout={handleLogout} darkMode={darkMode}/>
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, minHeight:0 }}>
        <AdminTopbar darkMode={darkMode} setDarkMode={setDarkMode} onNavigate={setActiveMenu}/>
        <button onClick={() => setSidebarOpen(o => !o)} aria-label="Toggle menu" style={{ position:'fixed', zIndex: isMobile ? 1300 : 50, top: isMobile ? 13 : 72, left: isMobile ? 13 : (sidebarOpen ? 228 : 48), width: isMobile ? 38 : 28, height: isMobile ? 38 : 28, borderRadius: isMobile ? 11 : '50%', background:'linear-gradient(135deg,#16a34a,#4ade80)', border:'2px solid #fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 2px 10px rgba(22,163,74,0.4)', transition:'left 0.25s cubic-bezier(0.22,1,0.36,1)' }}>
          {isMobile ? (sidebarOpen ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>) : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" style={{ transform:sidebarOpen?'rotate(0)':'rotate(180deg)', transition:'transform 0.25s' }}><polyline points="15 18 9 12 15 6"/></svg>}
        </button>
        <main className="admin-main-scroll" style={{ flex:1, minHeight:0, padding:'44px 28px 28px', overflowY: fitScreen ? 'hidden' : 'auto' }}>{renderContent()}</main>
      </div>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@300;400;500;600;700;800;900&display=swap'); .admin-shell, .admin-shell * { font-family: 'Nunito', sans-serif !important; scrollbar-width: thin; scrollbar-color: rgba(22,163,74,0.35) transparent; } .admin-shell *::-webkit-scrollbar, .admin-shell::-webkit-scrollbar { width: 8px; height: 8px; } .admin-shell *::-webkit-scrollbar-track, .admin-shell::-webkit-scrollbar-track { background: transparent; } .admin-shell *::-webkit-scrollbar-thumb, .admin-shell::-webkit-scrollbar-thumb { background: rgba(22,163,74,0.35); border-radius: 8px; border: 2px solid transparent; background-clip: content-box; } .admin-shell *::-webkit-scrollbar-thumb:hover, .admin-shell::-webkit-scrollbar-thumb:hover { background: #16a34a; background-clip: content-box; }`}</style>
    </div>
  )
}