'use client'
import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { ChevronLeft, UserCircle, KeyRound, Settings, Upload, Check, AlertCircle, Package, UserPlus, Activity, Bell } from 'lucide-react'

interface TopbarProps {
  darkMode: boolean
  setDarkMode: (v: (d: boolean) => boolean) => void
  onNavigate?: (menu: string) => void
}

type NotifType = 'low_stock' | 'new_patient' | 'system'
interface Notif {
  id: string
  type: NotifType
  tone: 'warning' | 'error' | 'info' | 'success'
  title: string
  message: string
  time: string          // ISO timestamp ('' for current-state alerts like low stock)
}

const LOW_STOCK = 10    // quantity at or below this = low stock alert

export default function Topbar({ darkMode, setDarkMode, onNavigate }: TopbarProps) {
  const { user } = useAuth()

  const [profileName,   setProfileName]   = useState('')
  const [profileRole,   setProfileRole]   = useState('Admin')
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null)
  const [profileEmail,  setProfileEmail]  = useState('')
  const [time,          setTime]          = useState('')
  const [showProfile,   setShowProfile]   = useState(false)
  const [showNotif,     setShowNotif]     = useState(false)

  // ── Dropdown view: 'menu' | 'profile' (profile is EDITABLE, saves to DB) ──
  const [dropView, setDropView] = useState<'menu'|'profile'>('menu')

  // profile display (read from DB)
  const [profileFirstName, setProfileFirstName] = useState('')
  const [profileLastName,  setProfileLastName]  = useState('')
  const [profileMiddle,    setProfileMiddle]     = useState('')
  const [profileStatus,    setProfileStatus]     = useState('')
  const [profileLicense,   setProfileLicense]   = useState('')

  // editable profile fields (topbar)
  const [editUsername,   setEditUsername]   = useState('')
  const [editEmail,      setEditEmail]      = useState('')
  const [editPhoto,      setEditPhoto]      = useState<string|null>(null)
  const [savingProfile,  setSavingProfile]  = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)

  const [uid, setUid] = useState<string|null>(null)

  // toast
  const [toast,   setToast]   = useState('')
  const [toastOk, setToastOk] = useState(true)

  // notifications
  const [notifList,  setNotifList]  = useState<Notif[]>([])
  const [notifCount, setNotifCount] = useState(0)

  // sound + new-detection refs
  const seenRef      = useRef<Set<string>>(new Set())
  const firstLoadRef = useRef(true)
  const audioRef     = useRef<AudioContext | null>(null)

  const fileRef    = useRef<HTMLInputElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)
  const notifRef   = useRef<HTMLDivElement>(null)

  // ── Theme palette ──
  const dk = darkMode
  const C = {
    green:       '#16a34a',
    greenDark:   '#0d3b1f',
    greenMid:    '#166534',
    greenLight:  '#dcfce7',
    mint:        '#4ade80',
    bg:          dk ? '#061a0d' : '#f0f7f2',
    surface:     dk ? '#0d2516' : '#ffffff',
    surface2:    dk ? '#0f2e1a' : '#f6faf7',
    border:      dk ? 'rgba(74,222,128,0.1)'  : 'rgba(22,163,74,0.15)',
    text:        dk ? '#e2f5e9' : '#0a2912',
    text2:       dk ? '#9abea6' : '#4b6557',
    text3:       dk ? '#4b6557' : '#9ca3af',
    shadow:      dk ? '0 2px 16px rgba(0,0,0,0.4)' : '0 2px 16px rgba(13,59,31,0.08)',
    panelShadow: dk ? '0 8px 32px rgba(0,0,0,0.5)' : '0 8px 32px rgba(13,59,31,0.18)',
    accentSoft:  dk ? 'rgba(74,222,128,0.12)' : '#dcfce7',
    radius:      14,
    radiusSm:    8,
  }

  const showToast = (msg: string, ok: boolean) => {
    setToast(msg); setToastOk(ok)
    setTimeout(() => setToast(''), 3000)
  }

  // ── Notification sound (Web Audio beep — no asset needed) ──
  const playBeep = () => {
    try {
      if (!audioRef.current) {
        const Ctx = (window.AudioContext || (window as any).webkitAudioContext)
        if (!Ctx) return
        audioRef.current = new Ctx()
      }
      const ctx = audioRef.current!
      if (ctx.state === 'suspended') ctx.resume()
      const t = ctx.currentTime
      ;[880, 1175].forEach((freq, i) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.type = 'sine'; osc.frequency.value = freq
        const start = t + i * 0.16
        gain.gain.setValueAtTime(0.0001, start)
        gain.gain.exponentialRampToValueAtTime(0.25, start + 0.01)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15)
        osc.start(start); osc.stop(start + 0.16)
      })
    } catch {}
  }

  // ── Resolve user id the same way the working Doctor page does ──
  const getUid = (): string | null => {
    if (uid) return uid
    if (user?.id) return user.id
    try {
      const r = localStorage.getItem('smartrhu_user')
      if (r) { const p = JSON.parse(r); if (p?.id) return p.id }
    } catch {}
    return localStorage.getItem('userId')
  }

  // ── Fetch profile. bust=true forces the avatar image to refresh. ──
  const fetchProfile = async (bust = false) => {
    const id = getUid()
    if (!id) return
    setUid(id)
    const { data, error } = await supabase.from('users')
      .select('*')
      .eq('user_id', id).maybeSingle()
    if (error) { console.error('[topbar fetchProfile]', error.message); return }
    if (data) {
      setProfileName(data.username   || data.first_name || '')
      setProfileEmail(data.email     || '')
      setProfileRole(data.role       || 'Admin')
      setProfileFirstName(data.first_name  || '')
      setProfileLastName(data.last_name    || '')
      setProfileMiddle(data.middle_name    || '')
      setProfileStatus(data.status         || 'active')
      setProfileLicense(data.user_license  || '')
      const avatar = data.avatar_url ? (bust ? data.avatar_url + '?t=' + Date.now() : data.avatar_url) : null
      setProfileAvatar(avatar)
      // seed edit fields
      setEditUsername(data.username || '')
      setEditEmail(data.email || '')
      setEditPhoto(avatar)
    }
  }

  // ── Fetch notifications: low stock + new patients + recent system logs ──
  const fetchNotifs = async () => {
    const out: Notif[] = []
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    // 1) Low / out of stock medicines (current state)
    try {
      const { data } = await supabase.from('pharma_medicines')
        .select('id, med_name, quantity, unit, archived')
        .eq('archived', false).lte('quantity', LOW_STOCK)
        .order('quantity', { ascending: true }).limit(20)
      ;(data ?? []).forEach((m: any) => {
        const qty = Number(m.quantity ?? 0)
        out.push({
          id: `lowstock_${m.id}`,
          type: 'low_stock',
          tone: qty <= 0 ? 'error' : 'warning',
          title: qty <= 0 ? 'Out of stock' : 'Low stock',
          message: `${m.med_name || 'Medicine'} — ${qty} ${m.unit || ''} left`.trim(),
          time: '',
        })
      })
    } catch {}

    // 2) New patients (registered in the last 24h)
    try {
      const { data } = await supabase.from('patients')
        .select('id, first_name, last_name, created_at')
        .gte('created_at', since).order('created_at', { ascending: false }).limit(10)
      ;(data ?? []).forEach((p: any) => out.push({
        id: `patient_${p.id}`,
        type: 'new_patient',
        tone: 'success',
        title: 'New patient',
        message: `${p.first_name || ''} ${p.last_name || ''}`.trim() + ' registered',
        time: p.created_at || '',
      }))
    } catch {}

    // 3) Recent system logs
    try {
      const { data } = await supabase.from('audit_logs')
        .select('id, user_name, action, module, description, status, created_at')
        .order('created_at', { ascending: false }).limit(8)
      ;(data ?? []).forEach((l: any) => out.push({
        id: `log_${l.id}`,
        type: 'system',
        tone: l.status === 'error' ? 'error' : l.status === 'warning' ? 'warning' : 'info',
        title: l.module || 'System',
        message: l.description || `${l.user_name || 'User'} — ${l.action || ''}`.trim(),
        time: l.created_at || '',
      }))
    } catch {}

    out.sort((a, b) => {
      if (!a.time && b.time) return -1
      if (a.time && !b.time) return 1
      return (b.time || '').localeCompare(a.time || '')
    })

    const fresh = out.filter(n => !seenRef.current.has(n.id))
    if (!firstLoadRef.current && fresh.length > 0) playBeep()
    firstLoadRef.current = false
    seenRef.current = new Set(out.map(n => n.id))

    setNotifList(out)
    setNotifCount(out.filter(n => n.type !== 'system').length)
  }

  useEffect(() => { fetchProfile(); fetchNotifs() }, [])

  // ── Sync with Settings: when profile/photo is saved anywhere, refresh here ──
  useEffect(() => {
    const fn = () => fetchProfile(true)
    window.addEventListener('profileUpdated', fn)
    window.addEventListener('avatarUpdated',  fn)
    return () => { window.removeEventListener('profileUpdated', fn); window.removeEventListener('avatarUpdated', fn) }
  }, [])

  useEffect(() => {
    const ch = supabase.channel('topbar_alerts')
      .on('postgres_changes', { event: '*',      schema: 'public', table: 'pharma_medicines' }, () => fetchNotifs())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'patients' },          () => fetchNotifs())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' },         () => fetchNotifs())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  useEffect(() => {
    const id = setInterval(() => fetchNotifs(), 60000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit', second:'2-digit' }))
    tick(); const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setShowProfile(false); setDropView('menu')
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotif(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const fullName      = [profileFirstName, profileLastName].filter(Boolean).join(' ')
  const displayName   = fullName || profileName || user?.name || 'Admin'
  const displayRole   = profileRole   || user?.role  || 'Admin'
  const displayEmail  = profileEmail  || user?.email || ''
  const displayAvatar = profileAvatar || null
  const initials = displayName.split(' ').map((w:string) => w[0]).join('').toUpperCase().slice(0,2) || 'A'

  // ── Open editable profile view (seed current values) ──
  const openProfileEdit = () => {
    setEditUsername(profileName); setEditEmail(profileEmail); setEditPhoto(profileAvatar)
    setDropView('profile')
  }

  // ── Save profile (username + email) to the database ──
  const handleSaveProfile = async () => {
    if (!editUsername.trim() || !editEmail.trim()) { showToast('Fill in all fields.', false); return }
    const id = getUid()
    if (!id) { showToast('User not found. Please refresh.', false); return }
    setSavingProfile(true)
    const { data: rows, error } = await supabase.from('users')
      .update({ username: editUsername.trim(), email: editEmail.trim() })
      .eq('user_id', id)
      .select()
    setSavingProfile(false)
    if (error) { showToast('Error: ' + error.message, false); return }
    if (!rows || rows.length === 0) { showToast('Not saved — add an UPDATE RLS policy on users.', false); return }
    setProfileName(editUsername.trim()); setProfileEmail(editEmail.trim())
    window.dispatchEvent(new Event('profileUpdated'))   // keeps Settings + topbar in sync
    showToast('Profile saved!', true)
  }

  // ── Upload + save photo to Storage and the database ──
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const userId = getUid()
    if (!userId) { showToast('User not found. Please refresh.', false); return }
    if (file.size > 5 * 1024 * 1024) { showToast('Max 5 MB.', false); return }
    if (!['image/jpeg','image/png','image/gif','image/webp'].includes(file.type)) {
      showToast('Use JPG, PNG, GIF, or WEBP.', false); return
    }
    setUploadingPhoto(true)
    const ext  = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const path = `${userId}/avatar.${ext}`
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type })
    if (upErr) { showToast('Upload failed: ' + upErr.message, false); setUploadingPhoto(false); return }
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
    const url = urlData?.publicUrl
    if (!url) { showToast('Could not get URL. Is the "avatars" bucket Public?', false); setUploadingPhoto(false); return }
    const { data: rows, error: dbErr } = await supabase.from('users').update({ avatar_url: url }).eq('user_id', userId).select()
    if (dbErr) { showToast('DB error: ' + dbErr.message, false); setUploadingPhoto(false); return }
    if (!rows || rows.length === 0) { showToast('Photo not linked — add an UPDATE RLS policy on users.', false); setUploadingPhoto(false); return }
    const busted = url + '?t=' + Date.now()
    setEditPhoto(busted); setProfileAvatar(busted)
    window.dispatchEvent(new Event('avatarUpdated'))     // keeps Settings + topbar in sync
    showToast('Photo updated!', true)
    setUploadingPhoto(false); e.target.value = ''
  }

  // ── Navigate to the Settings page (AdminSettings) on a specific tab ──
  const goSettings = (tab: 'profile'|'password') => {
    try { sessionStorage.setItem('adminSettingsTab', tab) } catch {}
    window.dispatchEvent(new CustomEvent('adminSettingsTab', { detail: tab }))
    setShowProfile(false); setDropView('menu')
    onNavigate?.('Settings')
  }

  const goFromNotif = (n: Notif) => {
    setShowNotif(false)
    if (n.type === 'low_stock')   onNavigate?.('Medicine Inventory')
    else if (n.type === 'new_patient') onNavigate?.('Patient Records')
    else onNavigate?.('System Activities')
  }

  const iconBtn: React.CSSProperties = {
    background:'rgba(255,255,255,0.1)', border:'none', borderRadius:'50%',
    width:38, height:38, cursor:'pointer',
    display:'flex', alignItems:'center', justifyContent:'center',
    position:'relative', flexShrink:0, transition:'background 0.15s',
  }

  const AvatarCircle = ({ size=32, fontSize=13, src=displayAvatar }: { size?:number; fontSize?:number; src?:string|null }) => (
    <div style={{
      width:size, height:size, borderRadius:'50%', flexShrink:0, overflow:'hidden',
      background:`linear-gradient(135deg,${C.green},${C.mint})`,
      display:'flex', alignItems:'center', justifyContent:'center',
      color:'#fff', fontWeight:800, fontSize,
      border:'2px solid rgba(255,255,255,0.25)',
    }}>
      {src ? <img src={src} alt="avatar" style={{width:'100%',height:'100%',objectFit:'cover'}}/> : initials}
    </div>
  )

  function timeAgo(iso: string) {
    if (!iso) return ''
    const diff = Date.now() - new Date(iso).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'Just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.floor(h / 24)
    return `${d}d ago`
  }

  const toneColor = (tone: Notif['tone']) =>
    tone === 'error' ? '#dc2626' : tone === 'warning' ? '#d97706' : tone === 'success' ? '#16a34a' : '#2563eb'

  const NotifIcon = ({ n }: { n: Notif }) => {
    const col = toneColor(n.tone)
    const Ic = n.type === 'low_stock' ? Package : n.type === 'new_patient' ? UserPlus : Activity
    return (
      <div style={{ width:32, height:32, borderRadius:'50%', flexShrink:0, background:`${col}1a`, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <Ic size={15} color={col}/>
      </div>
    )
  }

  // shared input styles for the editable profile
  const inp: React.CSSProperties = {
    width:'100%', boxSizing:'border-box', padding:'9px 12px',
    borderRadius:C.radiusSm+1, border:`1.5px solid ${C.border}`,
    background:C.surface2, color:C.text, fontSize:12, outline:'none',
  }
  const lbl: React.CSSProperties = {
    display:'block', fontSize:10, fontWeight:700, color:C.text3,
    textTransform:'uppercase', letterSpacing:0.6, marginBottom:4,
  }
  const saveBtn: React.CSSProperties = {
    width:'100%', padding:'10px', borderRadius:10, border:'none',
    background:`linear-gradient(135deg,${C.green},${C.greenMid})`,
    color:'#fff', fontWeight:700, fontSize:13, cursor:'pointer',
    display:'flex', alignItems:'center', justifyContent:'center', gap:6,
    boxShadow:`0 4px 12px ${C.green}33`,
  }

  return (
    <>
    <header style={{
      background:C.greenDark, height:64,
      display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'0 24px', position:'sticky', top:0, zIndex:40,
      boxShadow:'0 1px 6px rgba(0,0,0,0.25)', gap:16,
    }}>
      <div style={{flex:1, display:'flex', alignItems:'center'}}>
        <span style={{
          color:'#fff', fontWeight:800, fontSize:18, letterSpacing:1,
          fontFamily:"'Nunito', sans-serif",
        }}>SMARTRHU</span>
      </div>

      <div style={{display:'flex', alignItems:'center', gap:10, flexShrink:0}}>

        {/* Clock */}
        <div style={{
          color:'rgba(255,255,255,0.7)', fontSize:12, fontWeight:600,
          letterSpacing:0.5, whiteSpace:'nowrap',
          background:'rgba(255,255,255,0.07)', borderRadius:20, padding:'5px 14px',
          fontVariantNumeric:'tabular-nums',
        }}>{time}</div>

        {/* Notification bell */}
        <div ref={notifRef} style={{position:'relative'}}>
          <button onClick={() => { setShowNotif(p => !p); playBeep() /* unlock audio on first user gesture */ }} style={iconBtn}
            onMouseEnter={e=>(e.currentTarget.style.background='rgba(255,255,255,0.18)')}
            onMouseLeave={e=>(e.currentTarget.style.background='rgba(255,255,255,0.1)')}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {notifCount > 0 && (
              <span style={{
                position:'absolute', top:4, right:4, minWidth:16, height:16, borderRadius:8, padding:'0 4px',
                background:'#dc2626', color:'#fff', fontSize:9, fontWeight:800,
                display:'flex', alignItems:'center', justifyContent:'center', border:`2px solid ${C.greenDark}`,
              }}>{notifCount > 9 ? '9+' : notifCount}</span>
            )}
          </button>
          {showNotif && (
            <div style={{position:'absolute',right:0,top:'calc(100% + 10px)',background:C.surface,borderRadius:16,width:340,boxShadow:C.panelShadow,overflow:'hidden',zIndex:100,border:`1px solid ${C.border}`}}>
              <div style={{padding:'12px 16px',borderBottom:`1px solid ${C.border}`,display:'flex',justifyContent:'space-between',alignItems:'center',background:C.surface2}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <Bell size={15} color={C.green}/>
                  <span style={{fontWeight:800,fontSize:13,color:C.text}}>Notifications</span>
                </div>
                {notifCount > 0 && <span style={{background:'#fee2e2',color:'#b91c1c',fontSize:10,fontWeight:800,padding:'2px 8px',borderRadius:20}}>{notifCount} need action</span>}
              </div>
              <div style={{maxHeight:340,overflowY:'auto'}}>
                {notifList.length === 0 ? (
                  <div style={{padding:'28px 16px',textAlign:'center'}}>
                    <div style={{fontSize:28,marginBottom:8}}>✅</div>
                    <div style={{fontSize:13,fontWeight:600,color:dk?C.mint:C.greenMid}}>You're all caught up</div>
                    <div style={{fontSize:11,color:C.text3,marginTop:4}}>No new notifications</div>
                  </div>
                ) : notifList.map((n, i) => (
                  <div key={n.id}
                    style={{padding:'11px 16px',display:'flex',gap:11,alignItems:'flex-start',borderBottom:i<notifList.length-1?`1px solid ${C.border}`:'none',cursor:'pointer',transition:'background 0.1s'}}
                    onClick={()=>goFromNotif(n)}
                    onMouseEnter={e=>(e.currentTarget.style.background=C.surface2)}
                    onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                    <NotifIcon n={n}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:6}}>
                        <span style={{fontSize:12,fontWeight:800,color:toneColor(n.tone)}}>{n.title}</span>
                        <span style={{fontSize:10,color:C.text3,marginLeft:'auto',whiteSpace:'nowrap'}}>
                          {n.type === 'low_stock' ? 'Inventory' : timeAgo(n.time)}
                        </span>
                      </div>
                      <div style={{fontSize:12,color:C.text2,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{n.message}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{padding:'10px 16px',textAlign:'center',borderTop:`1px solid ${C.border}`,background:C.surface2}}>
                <span onClick={()=>{setShowNotif(false);onNavigate?.('Notifications')}} style={{fontSize:12,color:C.green,fontWeight:700,cursor:'pointer'}}>Open Notifications →</span>
              </div>
            </div>
          )}
        </div>

        {/* Dark mode toggle */}
        <button onClick={() => setDarkMode(d => !d)} style={iconBtn}
          onMouseEnter={e=>(e.currentTarget.style.background='rgba(255,255,255,0.18)')}
          onMouseLeave={e=>(e.currentTarget.style.background='rgba(255,255,255,0.1)')}>
          {darkMode
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
          }
        </button>

        {/* ── User pill ── */}
        <div ref={profileRef} style={{position:'relative'}}>
          <div onClick={() => { setShowProfile(p => !p); setDropView('menu') }}
            style={{
              display:'flex', alignItems:'center', gap:9,
              background:'rgba(255,255,255,0.12)', borderRadius:50,
              padding:'5px 16px 5px 5px', cursor:'pointer',
              border: showProfile ? '1px solid rgba(255,255,255,0.3)' : '1px solid transparent',
              transition:'all 0.15s',
            }}
            onMouseEnter={e=>(e.currentTarget.style.background='rgba(255,255,255,0.18)')}
            onMouseLeave={e=>(e.currentTarget.style.background='rgba(255,255,255,0.12)')}
          >
            <AvatarCircle size={32} fontSize={13}/>
            <div>
              <div style={{color:'#fff',fontWeight:600,fontSize:13,lineHeight:1.2,whiteSpace:'nowrap',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis'}}>{displayName}</div>
              <div style={{color:'rgba(255,255,255,0.55)',fontSize:10,textTransform:'uppercase',letterSpacing:0.5}}>{displayRole}</div>
            </div>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5"
              style={{marginLeft:2,transform:showProfile?'rotate(180deg)':'rotate(0)',transition:'transform 0.2s'}}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>

          {/* ── Dropdown panel ── */}
          {showProfile && (
            <div style={{
              position:'absolute', right:0, top:'calc(100% + 10px)',
              background:C.surface, borderRadius:16, width:280,
              boxShadow:C.panelShadow, overflow:'hidden', zIndex:100,
              border:`1px solid ${C.border}`,
            }}>

              {/* ── VIEW: menu ── */}
              {dropView === 'menu' && (
                <>
                  {/* Profile header card */}
                  <div style={{padding:'16px',background:`linear-gradient(135deg,${C.greenDark},${C.greenMid})`,display:'flex',alignItems:'center',gap:12}}>
                    <AvatarCircle size={44} fontSize={16}/>
                    <div style={{minWidth:0}}>
                      <div style={{color:'#fff',fontWeight:700,fontSize:14,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{displayName}</div>
                      <div style={{color:'rgba(255,255,255,0.55)',fontSize:10,textTransform:'uppercase',letterSpacing:0.5,marginTop:1}}>{displayRole}</div>
                      {displayEmail && <div style={{color:'rgba(255,255,255,0.4)',fontSize:10,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{displayEmail}</div>}
                    </div>
                  </div>
                  {/* Menu items */}
                  <div style={{padding:'6px 0'}}>
                   {[
                      { icon: UserCircle, label:'My Profile',      sub:'View and edit profile',    action: openProfileEdit },
                      { icon: KeyRound,   label:'Change Password', sub:'Update your password',     action: ()=>goSettings('password') },
                      { icon: Settings,   label:'Settings',        sub:'Full settings page',       action: ()=>goSettings('profile') },
                    ].map((item, i) => (
                      <div key={i} onClick={item.action}
                        style={{display:'flex',alignItems:'center',gap:12,padding:'10px 16px',cursor:'pointer',transition:'background 0.12s'}}
                        onMouseEnter={e=>(e.currentTarget.style.background=C.surface2)}
                        onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                        <div style={{width:34,height:34,borderRadius:10,background:C.accentSoft,border:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                          <item.icon size={16} color={C.green} strokeWidth={2}/>
                        </div>
                        <div style={{minWidth:0}}>
                          <div style={{fontSize:13,fontWeight:700,color:C.text}}>{item.label}</div>
                          <div style={{fontSize:11,color:C.text3,marginTop:1}}>{item.sub}</div>
                        </div>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.text3} strokeWidth="2" style={{flexShrink:0,marginLeft:'auto'}}><polyline points="9 18 15 12 9 6"/></svg>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* ── VIEW: profile (EDITABLE — saves to DB) ── */}
              {dropView === 'profile' && (
                <>
                  {/* Back header */}
                  <div style={{display:'flex',alignItems:'center',gap:8,padding:'12px 16px',borderBottom:`1px solid ${C.border}`,background:C.surface2,flexShrink:0}}>
                    <button onClick={()=>setDropView('menu')} style={{background:'none',border:'none',cursor:'pointer',color:C.text2,display:'flex',padding:4,borderRadius:6}}>
                      <ChevronLeft size={16}/>
                    </button>
                    <span style={{fontWeight:700,fontSize:13,color:C.text}}>My Profile</span>
                  </div>

                  <div style={{maxHeight:480,overflowY:'auto'}}>
                    <div style={{padding:'16px',display:'flex',flexDirection:'column',gap:12}}>

                      {/* ── Avatar + upload ── */}
                      <div style={{display:'flex',alignItems:'center',gap:12,background:C.accentSoft,borderRadius:12,padding:'12px'}}>
                        <div style={{position:'relative',flexShrink:0}}>
                          <div style={{width:60,height:60,borderRadius:'50%',overflow:'hidden',background:`linear-gradient(135deg,${C.green},${C.mint})`,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:900,fontSize:20,border:`3px solid ${C.surface}`,boxShadow:`0 2px 8px ${C.green}33`}}>
                            {editPhoto
                              ? <img src={editPhoto} alt="avatar" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                              : initials}
                          </div>
                          <button onClick={()=>fileRef.current?.click()} disabled={uploadingPhoto}
                            title="Change photo"
                            style={{position:'absolute',bottom:-2,right:-2,width:22,height:22,borderRadius:'50%',border:`2px solid ${C.surface}`,background:C.green,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',opacity:uploadingPhoto?0.6:1}}>
                            <Upload size={11} color="#fff"/>
                          </button>
                        </div>
                        <div style={{minWidth:0}}>
                          <div style={{fontSize:14,fontWeight:800,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                            {[profileFirstName, profileMiddle, profileLastName].filter(Boolean).join(' ') || displayName}
                          </div>
                          <div style={{fontSize:10,color:C.green,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,marginTop:1}}>{displayRole}</div>
                          <div style={{display:'inline-flex',alignItems:'center',gap:4,marginTop:4,background:profileStatus==='active'?C.accentSoft:'#fee2e2',borderRadius:20,padding:'2px 8px'}}>
                            <div style={{width:5,height:5,borderRadius:'50%',background:profileStatus==='active'?C.green:'#dc2626'}}/>
                            <span style={{fontSize:9,fontWeight:700,color:profileStatus==='active'?(dk?C.mint:C.greenMid):'#991b1b',textTransform:'uppercase',letterSpacing:0.4}}>
                              {profileStatus || 'active'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* ── Read-only info ── */}
                      <div style={{background:C.surface2,borderRadius:10,padding:'10px 12px',display:'flex',flexDirection:'column',gap:8,border:`1px solid ${C.border}`}}>
                        <div style={{fontSize:10,fontWeight:800,color:C.text3,textTransform:'uppercase',letterSpacing:0.8,marginBottom:2}}>Account Info</div>
                        {[
                          ['Full Name', [profileFirstName, profileMiddle, profileLastName].filter(Boolean).join(' ') || '—'],
                          ['Role',      displayRole  || '—'],
                          ...(profileLicense ? [['License No.', profileLicense]] : []),
                        ].map(([label, value]) => (
                          <div key={label} style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                            <span style={{fontSize:11,color:C.text3,fontWeight:600,flexShrink:0}}>{label}</span>
                            <span style={{fontSize:11,color:C.text,fontWeight:600,textAlign:'right',wordBreak:'break-all'}}>{value}</span>
                          </div>
                        ))}
                      </div>

                      {/* ── Editable fields ── */}
                      <div style={{fontSize:10,fontWeight:800,color:C.text3,textTransform:'uppercase',letterSpacing:0.8}}>Edit Profile</div>
                      <div>
                        <label style={lbl}>Username</label>
                        <input type="text" value={editUsername} onChange={e=>setEditUsername(e.target.value)} style={inp}
                          onFocus={e=>(e.currentTarget.style.borderColor=C.green)}
                          onBlur={e=>(e.currentTarget.style.borderColor=C.border)}/>
                      </div>
                      <div>
                        <label style={lbl}>Email</label>
                        <input type="email" value={editEmail} onChange={e=>setEditEmail(e.target.value)} style={inp}
                          onFocus={e=>(e.currentTarget.style.borderColor=C.green)}
                          onBlur={e=>(e.currentTarget.style.borderColor=C.border)}/>
                      </div>

                      <button onClick={handleSaveProfile} disabled={savingProfile}
                        style={{...saveBtn,opacity:savingProfile?0.7:1}}>
                        <Check size={13}/> {savingProfile?'Saving…':'Save Changes'}
                      </button>
                    </div>
                  </div>
                </>
              )}

            </div>
          )}
        </div>

      </div>
    </header>

    {/* hidden file input for avatar upload */}
    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={handlePhotoUpload} style={{display:'none'}}/>

    {/* Toast */}
    {toast && (
      <div style={{
        position:'fixed',bottom:24,right:24,zIndex:9999,
        background:toastOk?`linear-gradient(135deg,${C.green},${C.greenMid})`:'linear-gradient(135deg,#dc2626,#b91c1c)',
        color:'#fff',borderRadius:12,padding:'12px 18px',
        display:'flex',alignItems:'center',gap:8,fontWeight:700,fontSize:13,
        boxShadow:`0 8px 24px ${toastOk?C.green:'#dc2626'}55`,
      }}>
        {toastOk ? <Check size={15}/> : <AlertCircle size={15}/>}
        {toast}
      </div>
    )}
    </>
  )
}