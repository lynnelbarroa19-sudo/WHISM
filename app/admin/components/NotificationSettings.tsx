'use client'
import React, { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Bell, ShieldAlert, Package, FlaskConical, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react'

const G = '#1a7a1a'

interface Notification {
  id: string
  title: string
  message: string
  type: 'warning' | 'error' | 'info' | 'success'
  module: string
  is_read: boolean
  created_at: string
}

export default function NotificationSettings({ darkMode }: { darkMode: boolean }) {
  const dk   = darkMode
  const card = dk ? 'rgba(10,26,13,0.9)' : '#fff'
  const bdr  = dk ? 'rgba(77,184,106,0.12)' : 'rgba(26,122,26,0.1)'
  const txt  = dk ? '#d1fae5' : '#0d2e0d'
  const txt2 = dk ? '#4db86a' : '#1a7a1a'
  const txt3 = dk ? '#3a6b48' : '#6b7280'
  const bg   = dk ? '#0d1a0f' : '#f0f4f1'

  const [notifications, setNotifications] = useState<Notification[]>([])
  const [alerts,        setAlerts]        = useState<{msg:string; type:string; action?:string}[]>([])
  const [loading,       setLoading]       = useState(true)
  const [settings, setSettings] = useState({
    lowStockAlert:     true,
    expiringAlert:     true,
    failedLoginAlert:  true,
    pendingLabAlert:   true,
    newPatientAlert:   false,
    backupAlert:       true,
    emailNotif:        false,
    emailAddress:      '',
    alertThreshold:    10,
    expiryDays:        90,
  })

  const fetchAlerts = async () => {
    setLoading(true)
    const now  = new Date()
    const in90 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + settings.expiryDays)
    const fmt  = (d:Date) => d.toISOString().split('T')[0]
    const newAlerts: any[] = []

    // Low stock
    if (settings.lowStockAlert) {
      const { count } = await supabase.from('pharma_medicines').select('id',{count:'exact',head:true}).eq('archived',false).lte('quantity',settings.alertThreshold)
      if (count && count > 0) newAlerts.push({ msg:`${count} medicine(s) have stock ≤ ${settings.alertThreshold} units`, type:'warning', action:'Inventory Records' })
    }

    // Expiring
    if (settings.expiringAlert) {
      const { count } = await supabase.from('pharma_medicines').select('id',{count:'exact',head:true}).eq('archived',false).gte('exp_date',fmt(now)).lte('exp_date',fmt(in90))
      if (count && count > 0) newAlerts.push({ msg:`${count} medicine(s) expiring within ${settings.expiryDays} days`, type:'warning', action:'Inventory Records' })
    }

    // Expired
    const { count: expCount } = await supabase.from('pharma_medicines').select('id',{count:'exact',head:true}).eq('archived',false).lt('exp_date',fmt(now))
    if (expCount && expCount > 0) newAlerts.push({ msg:`${expCount} medicine(s) have already EXPIRED`, type:'error', action:'Inventory Records' })

    // Pending labs
    if (settings.pendingLabAlert) {
      const { count } = await supabase.from('laboratory_requests').select('id',{count:'exact',head:true}).eq('status','pending')
      if (count && count > 0) newAlerts.push({ msg:`${count} lab request(s) are still pending`, type:'info', action:'Lab Records' })
    }

    // Failed logins from audit_logs
    if (settings.failedLoginAlert) {
      const yesterday = new Date(Date.now() - 24*60*60*1000).toISOString()
      const { count } = await supabase.from('audit_logs').select('id',{count:'exact',head:true}).eq('action','FAILED_LOGIN').gte('created_at',yesterday)
      if (count && count > 0) newAlerts.push({ msg:`${count} failed login attempt(s) in the last 24 hours`, type:'error', action:'System Activities' })
    }

    setAlerts(newAlerts)

    // Load from audit_logs as notification feed
    const { data } = await supabase.from('audit_logs').select('*').order('created_at',{ascending:false}).limit(20)
    if (data) {
      setNotifications(data.map((l:any) => ({
        id: l.id,
        title: l.action || 'System Event',
        message: l.description || `${l.user_name} performed ${l.action}`,
        type: l.status === 'error' ? 'error' : l.status === 'warning' ? 'warning' : 'info',
        module: l.module || 'System',
        is_read: false,
        created_at: l.created_at,
      })))
    }
    setLoading(false)
  }

  useEffect(() => { fetchAlerts() }, [])

  const typeIcon = (type: string) => {
    if (type === 'error')   return <ShieldAlert size={15} color="#dc2626"/>
    if (type === 'warning') return <AlertTriangle size={15} color="#d97706"/>
    if (type === 'success') return <CheckCircle size={15} color="#059669"/>
    return <Bell size={15} color="#2563eb"/>
  }

  const typeBg = (type: string) => {
    if (type === 'error')   return { bg:'#fee2e2', border:'#fca5a5', color:'#dc2626' }
    if (type === 'warning') return { bg:'#fef3c7', border:'#fcd34d', color:'#d97706' }
    if (type === 'success') return { bg:'#dcfce7', border:'#86efac', color:'#15803d' }
    return { bg:'#eff6ff', border:'#bfdbfe', color:'#1d4ed8' }
  }

  const INP: React.CSSProperties = {
    padding:'8px 12px', borderRadius:9, border:`1.5px solid ${bdr}`,
    background:dk?'rgba(255,255,255,0.05)':bg, color:txt, fontSize:13, outline:'none',
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end' }}>
        <div>
          <h2 style={{ margin:0, fontSize:22, fontWeight:900, color:dk?'#4ade80':G }}>Notification Management</h2>
          <p style={{ margin:'4px 0 0', fontSize:12, color:txt3 }}>System alerts and notification settings</p>
        </div>
        <button onClick={fetchAlerts}
          style={{ background:card, border:`1.5px solid ${bdr}`, borderRadius:10, padding:'8px 16px',
            display:'flex', alignItems:'center', gap:7, cursor:'pointer', color:txt3, fontSize:13, fontWeight:700 }}>
          <RefreshCw size={14}/> Refresh
        </button>
      </div>

      {/* Active Alerts */}
      <div style={{ background:card, border:`1px solid ${bdr}`, borderRadius:16, overflow:'hidden' }}>
        <div style={{ padding:'14px 18px', borderBottom:`1px solid ${bdr}`, display:'flex', alignItems:'center', gap:8 }}>
          <Bell size={16} color={G}/>
          <span style={{ fontWeight:800, fontSize:14, color:txt }}>Active System Alerts</span>
          {alerts.length > 0 && (
            <span style={{ background:'#dc2626', color:'#fff', borderRadius:20, padding:'1px 8px', fontSize:10, fontWeight:800 }}>{alerts.length}</span>
          )}
        </div>
        <div style={{ padding:16, display:'flex', flexDirection:'column', gap:10 }}>
          {loading ? (
            <div style={{ textAlign:'center', padding:24, color:txt3, fontSize:12 }}>Checking system status…</div>
          ) : alerts.length === 0 ? (
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', background:'#dcfce7', borderRadius:12, border:'1px solid #86efac' }}>
              <CheckCircle size={16} color="#15803d"/>
              <span style={{ fontSize:13, fontWeight:600, color:'#15803d' }}>All systems normal — no active alerts</span>
            </div>
          ) : alerts.map((a,i)=>{
            const s = typeBg(a.type)
            return (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', background:s.bg, borderRadius:12, border:`1px solid ${s.border}` }}>
                {typeIcon(a.type)}
                <span style={{ fontSize:13, fontWeight:600, color:s.color, flex:1 }}>{a.msg}</span>
                {a.action && (
                  <span style={{ fontSize:11, color:s.color, fontWeight:700, cursor:'pointer', textDecoration:'underline' }}>
                    View →
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        {/* Alert Settings */}
        <div style={{ background:card, border:`1px solid ${bdr}`, borderRadius:16, padding:20 }}>
          <div style={{ fontWeight:800, fontSize:14, color:txt, marginBottom:16 }}>Alert Settings</div>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {[
              { key:'lowStockAlert',    label:'Low Stock Alert',         desc:'Alert when medicine quantity is low' },
              { key:'expiringAlert',    label:'Expiring Medicine Alert',  desc:'Alert for medicines expiring soon' },
              { key:'failedLoginAlert', label:'Failed Login Alert',       desc:'Alert on suspicious login attempts' },
              { key:'pendingLabAlert',  label:'Pending Lab Alert',        desc:'Alert for unprocessed lab requests' },
              { key:'newPatientAlert',  label:'New Patient Alert',        desc:'Alert when a new patient registers' },
              { key:'backupAlert',      label:'Backup Status Alert',      desc:'Alert on backup success/failure' },
            ].map(s=>(
              <div key={s.key} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 14px', background:bg, borderRadius:10 }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:txt }}>{s.label}</div>
                  <div style={{ fontSize:11, color:txt3, marginTop:2 }}>{s.desc}</div>
                </div>
                <label style={{ position:'relative', display:'inline-block', width:44, height:24, flexShrink:0 }}>
                  <input type="checkbox" checked={(settings as any)[s.key]}
                    onChange={e=>setSettings(p=>({...p,[s.key]:e.target.checked}))}
                    style={{ opacity:0, width:0, height:0 }}/>
                  <span style={{
                    position:'absolute', cursor:'pointer', inset:0, borderRadius:12,
                    background:(settings as any)[s.key]?G:'#ccc', transition:'0.3s',
                  }}>
                    <span style={{
                      position:'absolute', content:'""', height:18, width:18, left: (settings as any)[s.key]?22:3,
                      bottom:3, background:'#fff', borderRadius:'50%', transition:'0.3s',
                    }}/>
                  </span>
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* Threshold Settings */}
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <div style={{ background:card, border:`1px solid ${bdr}`, borderRadius:16, padding:20 }}>
            <div style={{ fontWeight:800, fontSize:14, color:txt, marginBottom:16 }}>Alert Thresholds</div>
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div>
                <label style={{ display:'block', fontSize:11, fontWeight:700, color:txt3, marginBottom:6, textTransform:'uppercase', letterSpacing:0.5 }}>
                  Low Stock Threshold (units)
                </label>
                <input type="number" value={settings.alertThreshold} min={1} max={100}
                  onChange={e=>setSettings(p=>({...p,alertThreshold:Number(e.target.value)}))}
                  style={{ ...INP, width:'100%', boxSizing:'border-box' }}/>
                <div style={{ fontSize:10, color:txt3, marginTop:4 }}>Alert when stock falls below this number</div>
              </div>
              <div>
                <label style={{ display:'block', fontSize:11, fontWeight:700, color:txt3, marginBottom:6, textTransform:'uppercase', letterSpacing:0.5 }}>
                  Expiry Warning (days before)
                </label>
                <input type="number" value={settings.expiryDays} min={7} max={365}
                  onChange={e=>setSettings(p=>({...p,expiryDays:Number(e.target.value)}))}
                  style={{ ...INP, width:'100%', boxSizing:'border-box' }}/>
                <div style={{ fontSize:10, color:txt3, marginTop:4 }}>Alert when medicine expires within this many days</div>
              </div>
              <button onClick={fetchAlerts}
                style={{ background:`linear-gradient(135deg,${G},#0d9488)`, color:'#fff', border:'none', borderRadius:10, padding:'10px 0', fontSize:13, fontWeight:700, cursor:'pointer', width:'100%' }}>
                Apply & Check Now
              </button>
            </div>
          </div>

          {/* Recent notifications from audit log */}
          <div style={{ background:card, border:`1px solid ${bdr}`, borderRadius:16, padding:20, flex:1 }}>
            <div style={{ fontWeight:800, fontSize:14, color:txt, marginBottom:12 }}>Recent Events</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:220, overflowY:'auto' }}>
              {notifications.slice(0,10).map(n=>{
                const s = typeBg(n.type)
                return (
                  <div key={n.id} style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
                    <div style={{ width:8, height:8, borderRadius:'50%', background:s.color, flexShrink:0, marginTop:5 }}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:600, color:txt, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{n.message}</div>
                      <div style={{ fontSize:10, color:txt3 }}>
                        {n.module} · {new Date(n.created_at).toLocaleString('en-PH',{hour:'2-digit',minute:'2-digit',month:'short',day:'numeric'})}
                      </div>
                    </div>
                  </div>
                )
              })}
              {notifications.length === 0 && (
                <div style={{ fontSize:11, color:txt3, textAlign:'center', padding:12 }}>No events yet. Set up audit_logs table.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}