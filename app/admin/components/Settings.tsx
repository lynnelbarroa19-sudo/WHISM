'use client'
import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { User, Lock, Eye, EyeOff, Upload, Camera, X, Check, AlertCircle } from 'lucide-react'

type Tab = 'profile' | 'password'

const C = {
  green:  '#16a34a',
  teal:   '#0d9488',
  red:    '#dc2626',
  yellow: '#ca8a04',
}

/* ── useBreakpoint ── */
function useBreakpoint() {
  const [w, setW] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200)
  useEffect(() => {
    const fn = () => setW(window.innerWidth)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return { isMobile: w < 640, isTablet: w < 900 }
}

/* ── Toast ── */
function Toast({ msg, type }: { msg: string; type: 'success' | 'error' }) {
  return (
    <div style={{
      position: 'fixed', bottom: 28, right: 28, zIndex: 9999,
      background: type === 'success'
        ? `linear-gradient(135deg,${C.green},${C.teal})`
        : `linear-gradient(135deg,${C.red},#b91c1c)`,
      color: '#fff', borderRadius: 14, padding: '13px 20px',
      display: 'flex', alignItems: 'center', gap: 8,
      fontWeight: 700, fontSize: 13,
      boxShadow: `0 8px 24px ${type === 'success' ? C.green : C.red}55`,
    }}>
      {type === 'success' ? <Check size={16}/> : <AlertCircle size={16}/>}
      {msg}
    </div>
  )
}

/* ── CondRow ── */
function CondRow({ met, label }: { met: boolean; label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
      color: met ? C.green : '#9ca3af', fontWeight: 600,
      padding: '4px 0', transition: 'color 0.2s',
    }}>
      <div style={{
        width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
        background: met ? `linear-gradient(135deg,${C.green},${C.teal})` : 'transparent',
        border: `2px solid ${met ? C.green : '#d1d5db'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.2s',
      }}>
        {met && <Check size={10} color="#fff" strokeWidth={3}/>}
      </div>
      {label}
    </div>
  )
}

/* ── Main ── */
export default function AdminSettings({ darkMode = false }: { darkMode?: boolean }) {
  const dk = darkMode
  const { isMobile, isTablet } = useBreakpoint()
  const { user: authUser } = useAuth()

  const bg      = dk ? '#0d1a0f' : '#f0f4f1'
  const card    = dk ? '#0f2014' : '#ffffff'
  const bdr     = dk ? '#1a3d24' : '#e5e7eb'
  const txt     = dk ? '#e2f5e9' : '#1f2937'
  const txt2    = dk ? '#6ee7b7' : '#6b7280'
  const inputBg  = dk ? '#0a1a0d' : '#f9fafb'
  const inputBdr = dk ? '#1a3d24' : '#d1d5db'

  const [activeTab,        setActiveTab]        = useState<Tab>('profile')
  const [photo,            setPhoto]            = useState<string | null>(null)
  const [username,         setUsername]         = useState('')
  const [email,            setEmail]            = useState('')
  const [role,             setRole]             = useState('Admin')
  const [currentPassword,  setCurrentPassword]  = useState('')
  const [newPassword,      setNewPassword]      = useState('')
  const [confirmPassword,  setConfirmPassword]  = useState('')
  const [showCurrent,      setShowCurrent]      = useState(false)
  const [showNew,          setShowNew]          = useState(false)
  const [showConfirm,      setShowConfirm]      = useState(false)
  const [uploading,        setUploading]        = useState(false)
  const [saving,           setSaving]           = useState(false)
  const [showPhotoOptions, setShowPhotoOptions] = useState(false)
  const [showCamera,       setShowCamera]       = useState(false)
  const [toast,            setToast]            = useState('')
  const [toastType,        setToastType]        = useState<'success' | 'error'>('success')
  const [uid,              setUid]              = useState<string | null>(null)

  const fileRef   = useRef<HTMLInputElement>(null)
  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  /* ── Resolve the user id the same way the working Doctor page does:
     AuthContext id first, then localStorage fallbacks. ── */
  const getUid = (): string | null => {
    if (uid) return uid
    if (authUser?.id) return authUser.id
    try {
      const r = localStorage.getItem('smartrhu_user')
      if (r) { const p = JSON.parse(r); if (p?.id) return p.id }
    } catch {}
    return localStorage.getItem('userId')
  }

  /* ── Open the correct tab when arriving from the Topbar dropdown ── */
  useEffect(() => {
    try {
      const t = sessionStorage.getItem('adminSettingsTab')
      if (t === 'password' || t === 'profile') { setActiveTab(t); sessionStorage.removeItem('adminSettingsTab') }
    } catch {}
    const fn = (e: any) => {
      const t = e?.detail
      if (t === 'password' || t === 'profile') setActiveTab(t)
    }
    window.addEventListener('adminSettingsTab', fn)
    return () => window.removeEventListener('adminSettingsTab', fn)
  }, [])

  /* ── Load profile on mount / when auth resolves ── */
  useEffect(() => {
    const id = getUid()
    if (id) { setUid(id); fetchProfile(id) }
  }, [authUser])

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) { console.error('[AdminSettings fetchProfile]', error.message); showToast('Failed to load profile.', 'error'); return }
    if (data) {
      setUsername(data.username  || '')
      setEmail(data.email        || '')
      setRole(data.role          || 'Admin')
      if (data.avatar_url) setPhoto(`${data.avatar_url}?t=${Date.now()}`)
    }
  }

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(''), 3500)
  }

  /* ── Photo upload ── */
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const userId = getUid()
    if (!userId) { showToast('User not found. Please refresh.', 'error'); return }
    if (file.size > 5 * 1024 * 1024) { showToast('File too large. Max 5 MB.', 'error'); return }
    if (!['image/jpeg','image/png','image/gif','image/webp'].includes(file.type)) {
      showToast('Use JPG, PNG, GIF, or WEBP.', 'error'); return
    }

    setPhoto(URL.createObjectURL(file))   // instant preview
    setUploading(true)
    try {
      const ext      = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
      const filePath = `${userId}/avatar.${ext}`

      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true, contentType: file.type })
      if (upErr) { showToast(`Upload failed: ${upErr.message}`, 'error'); setUploading(false); return }

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath)
      const publicUrl = urlData?.publicUrl
      if (!publicUrl) { showToast('Could not get file URL. Is the "avatars" bucket Public?', 'error'); setUploading(false); return }

      const { data: rows, error: dbErr } = await supabase
        .from('users').update({ avatar_url: publicUrl }).eq('user_id', userId).select()
      if (dbErr) { showToast(`Could not save: ${dbErr.message}`, 'error'); setUploading(false); return }
      if (!rows || rows.length === 0) { showToast('Photo uploaded but not linked — add an UPDATE RLS policy on users.', 'error'); setUploading(false); return }

      setPhoto(`${publicUrl}?t=${Date.now()}`)
      localStorage.setItem('userAvatar', publicUrl)
      window.dispatchEvent(new Event('avatarUpdated'))
      showToast('Photo updated successfully!', 'success')
    } catch (err: any) {
      showToast('Unexpected error: ' + (err?.message ?? 'unknown'), 'error')
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  /* ── Camera ── */
  const openCamera = async () => {
    setShowPhotoOptions(false); setShowCamera(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch {
      showToast('Camera access denied.', 'error'); setShowCamera(false)
    }
  }

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null; setShowCamera(false)
  }

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return
    const userId = getUid()
    if (!userId) { showToast('User not found.', 'error'); return }

    const canvas = canvasRef.current
    canvas.width  = videoRef.current.videoWidth
    canvas.height = videoRef.current.videoHeight
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0)

    canvas.toBlob(async (blob) => {
      if (!blob) return
      setUploading(true); stopCamera()
      const filePath = `${userId}/avatar.jpg`

      const { error: upErr } = await supabase.storage
        .from('avatars').upload(filePath, blob, { upsert: true, contentType: 'image/jpeg' })
      if (upErr) { showToast(`Upload failed: ${upErr.message}`, 'error'); setUploading(false); return }

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath)
      const publicUrl = urlData?.publicUrl
      if (!publicUrl) { showToast('Could not get file URL.', 'error'); setUploading(false); return }

      const { data: rows, error: dbErr } = await supabase
        .from('users').update({ avatar_url: publicUrl }).eq('user_id', userId).select()
      if (dbErr) { showToast(`DB error: ${dbErr.message}`, 'error'); setUploading(false); return }
      if (!rows || rows.length === 0) { showToast('Photo not linked — add an UPDATE RLS policy on users.', 'error'); setUploading(false); return }

      setPhoto(`${publicUrl}?t=${Date.now()}`)
      localStorage.setItem('userAvatar', publicUrl)
      window.dispatchEvent(new Event('avatarUpdated'))
      showToast('Photo saved!', 'success')
      setUploading(false)
    }, 'image/jpeg', 0.92)
  }

  /* ── Save profile ── */
  const handleSaveProfile = async () => {
    if (!username.trim() || !email.trim()) { showToast('Please fill in all fields.', 'error'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Please enter a valid email.', 'error'); return }
    const userId = getUid()
    if (!userId) { showToast('User not found. Please refresh.', 'error'); return }

    setSaving(true)
    const { data: rows, error } = await supabase
      .from('users')
      .update({ username: username.trim(), email: email.trim() })
      .eq('user_id', userId)
      .select()
    setSaving(false)

    if (error) { showToast('Error saving profile: ' + error.message, 'error'); return }
    if (!rows || rows.length === 0) {
      showToast('Not saved — the database blocked the update. Add an UPDATE RLS policy on the users table.', 'error'); return
    }

    localStorage.setItem('userName',  username.trim())
    localStorage.setItem('userEmail', email.trim())
    window.dispatchEvent(new Event('profileUpdated'))
    showToast('Profile saved successfully!', 'success')
  }

  /* ── Change password ── */
  const conds = {
    length:  newPassword.length >= 8,
    special: /[!@#$%^&*?]/.test(newPassword),
    number:  /[0-9]/.test(newPassword),
    match:   newPassword === confirmPassword && confirmPassword.length > 0,
  }

  const handleChangePassword = async () => {
    if (!currentPassword)  { showToast('Enter your current password.',     'error'); return }
    if (!conds.length)     { showToast('Password must be ≥ 8 characters.', 'error'); return }
    if (!conds.special)    { showToast('Add a special character.',          'error'); return }
    if (!conds.number)     { showToast('Add a number.',                     'error'); return }
    if (!conds.match)      { showToast('Passwords do not match.',           'error'); return }

    const userEmail = email || localStorage.getItem('userEmail') || ''
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email: userEmail, password: currentPassword })
    if (signInErr) { showToast('Current password is incorrect.', 'error'); return }

    const { error: updErr } = await supabase.auth.updateUser({ password: newPassword })
    if (updErr) { showToast('Error changing password: ' + updErr.message, 'error'); return }

    setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
    showToast('Password changed successfully!', 'success')
  }

  /* ── Shared styles ── */
  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    padding: '10px 14px', borderRadius: 10,
    border: `1.5px solid ${inputBdr}`,
    background: inputBg, color: txt, fontSize: 13,
    outline: 'none', transition: 'border 0.15s',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 12, fontWeight: 700,
    color: txt2, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6,
  }
  const gradBtn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '11px 28px', borderRadius: 12, border: 'none',
    background: `linear-gradient(135deg,${C.green},${C.teal})`,
    color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer',
    boxShadow: `0 6px 18px ${C.green}44`, transition: 'all 0.15s',
  }

  const NavItem = ({ tab, icon: Icon, label }: { tab: Tab; icon: React.ElementType; label: string }) => {
    const active = activeTab === tab
    return (
      <button onClick={() => setActiveTab(tab)} style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '11px 14px', borderRadius: 12,
        border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13,
        textAlign: 'left', transition: 'all 0.15s', marginBottom: 4,
        background: active ? `linear-gradient(135deg,${C.green},${C.teal})` : 'transparent',
        color:      active ? '#fff' : txt2,
        boxShadow:  active ? `0 4px 14px ${C.green}44` : 'none',
      }}>
        <Icon size={16}/> {label}
      </button>
    )
  }

  const score     = Object.values(conds).filter(Boolean).length
  const strengthColor = score <= 1 ? C.red : score === 2 ? C.yellow : score === 3 ? C.teal : C.green
  const strengthLabel = score <= 1 ? 'Weak' : score === 2 ? 'Fair' : score === 3 ? 'Good' : 'Strong'

  return (
    <main style={{ flex: 1, padding: isMobile ? 14 : 24, overflowY: 'auto', background: bg }}>

      <div style={{ marginBottom: isMobile ? 18 : 28 }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: dk ? '#4ade80' : txt2, textTransform: 'uppercase', letterSpacing: 1.5 }}>Admin</p>
        <h1 style={{ margin: '2px 0 0', fontSize: isMobile ? 24 : 34, fontWeight: 900, color: dk ? '#4ade80' : C.green, lineHeight: 1 }}>SETTINGS</h1>
      </div>

      <div style={{ display: 'flex', gap: 20, flexDirection: isMobile || isTablet ? 'column' : 'row', alignItems: 'flex-start' }}>

        {/* Sidebar */}
        <div style={{ background: card, borderRadius: 18, padding: 16, border: `1px solid ${bdr}`, boxShadow: '0 2px 12px rgba(0,0,0,0.07)', width: isMobile || isTablet ? '100%' : 210, flexShrink: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 12px 4px' }}>SETTINGS</p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: dk ? '#0a1a0d' : '#f0fdf4', marginBottom: 16, border: `1px solid ${bdr}` }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: `linear-gradient(135deg,${C.green},${C.teal})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 15, border: `2px solid ${C.green}44` }}>
              {photo
                ? <img src={photo} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={()=>setPhoto(null)}/>
                : (username?.[0] ?? 'A').toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: txt, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{username || 'Admin'}</div>
              <div style={{ fontSize: 10, color: txt2, fontWeight: 600 }}>{role}</div>
            </div>
          </div>

          <NavItem tab="profile"  icon={User} label="User Profile" />
          <NavItem tab="password" icon={Lock} label="Password"     />
        </div>

        {/* Content */}
        <div style={{ background: card, borderRadius: 18, padding: isMobile ? 18 : 28, border: `1px solid ${bdr}`, boxShadow: '0 2px 12px rgba(0,0,0,0.07)', flex: 1, minWidth: 0 }}>

          {/* ══ PROFILE TAB ══ */}
          {activeTab === 'profile' && (
            <div>
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: txt }}>User Profile</h2>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: txt2 }}>Update your display name, email, and profile photo.</p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 28, flexWrap: 'wrap' }}>
                <div style={{ position:'relative', flexShrink:0 }}>
                  <div style={{ width: 88, height: 88, borderRadius: '50%', overflow: 'hidden', background: `linear-gradient(135deg,${C.green},${C.teal})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 28, border: `3px solid ${C.green}55`, boxShadow: `0 4px 16px ${C.green}33` }}>
                    {photo
                      ? <img src={photo} alt="profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={()=>setPhoto(null)}/>
                      : (username?.[0] ?? 'A').toUpperCase()}
                  </div>
                  {uploading && (
                    <div style={{ position:'absolute', inset:0, borderRadius:'50%', background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <div style={{ width:24, height:24, borderRadius:'50%', border:'3px solid #fff', borderTopColor:'transparent', animation:'spin 0.7s linear infinite' }}/>
                    </div>
                  )}
                </div>
                <div>
                  <p style={{ margin: '0 0 8px', fontSize: 12, color: txt2, fontWeight: 600 }}>Profile Photo</p>
                  <button onClick={() => setShowPhotoOptions(true)} disabled={uploading}
                    style={{ ...gradBtn, padding: '8px 16px', fontSize: 12, opacity: uploading ? 0.6 : 1 }}>
                    <Upload size={13}/> {uploading ? 'Uploading…' : 'Change Photo'}
                  </button>
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={handlePhotoUpload} style={{ display: 'none' }}/>
                  <p style={{ margin: '6px 0 0', fontSize: 11, color: txt2 }}>JPG, PNG, GIF or WEBP · Max 5 MB</p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 20 }}>
                <div>
                  <label style={labelStyle}>Username</label>
                  <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter username" style={inputStyle}
                    onFocus={e => (e.currentTarget.style.borderColor = C.green)}
                    onBlur={e  => (e.currentTarget.style.borderColor = inputBdr)}/>
                </div>
                <div>
                  <label style={labelStyle}>Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Enter email" style={inputStyle}
                    onFocus={e => (e.currentTarget.style.borderColor = C.green)}
                    onBlur={e  => (e.currentTarget.style.borderColor = inputBdr)}/>
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={labelStyle}>Role</label>
                <input type="text" value={role} readOnly style={{ ...inputStyle, opacity: 0.5, cursor: 'not-allowed' }}/>
              </div>

              <button onClick={handleSaveProfile} disabled={saving} style={{ ...gradBtn, opacity: saving ? 0.7 : 1 }}>
                <Check size={15}/> {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          )}

          {/* ══ PASSWORD TAB ══ */}
          {activeTab === 'password' && (
            <div>
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: txt }}>Change Password</h2>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: txt2 }}>Your new password must meet all the requirements.</p>
              </div>

              <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 24 }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={labelStyle}>Current Password</label>
                    <div style={{ position: 'relative' }}>
                      <input type={showCurrent ? 'text' : 'password'} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
                        style={{ ...inputStyle, paddingRight: 42 }}
                        onFocus={e => (e.currentTarget.style.borderColor = C.green)} onBlur={e => (e.currentTarget.style.borderColor = inputBdr)}/>
                      <button onClick={() => setShowCurrent(p => !p)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: txt2, display: 'flex', padding: 0 }}>
                        {showCurrent ? <EyeOff size={15}/> : <Eye size={15}/>}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>New Password</label>
                    <div style={{ position: 'relative' }}>
                      <input type={showNew ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)}
                        style={{ ...inputStyle, paddingRight: 42 }}
                        onFocus={e => (e.currentTarget.style.borderColor = C.green)} onBlur={e => (e.currentTarget.style.borderColor = inputBdr)}/>
                      <button onClick={() => setShowNew(p => !p)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: txt2, display: 'flex', padding: 0 }}>
                        {showNew ? <EyeOff size={15}/> : <Eye size={15}/>}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>Confirm New Password</label>
                    <div style={{ position: 'relative' }}>
                      <input type={showConfirm ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                        style={{ ...inputStyle, paddingRight: 42, borderColor: confirmPassword && !conds.match ? C.red : inputBdr }}
                        onFocus={e => (e.currentTarget.style.borderColor = C.green)} onBlur={e => (e.currentTarget.style.borderColor = confirmPassword && !conds.match ? C.red : inputBdr)}/>
                      <button onClick={() => setShowConfirm(p => !p)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: txt2, display: 'flex', padding: 0 }}>
                        {showConfirm ? <EyeOff size={15}/> : <Eye size={15}/>}
                      </button>
                    </div>
                    {confirmPassword && !conds.match && (
                      <p style={{ margin: '5px 0 0', fontSize: 11, color: C.red, fontWeight: 600 }}>Passwords do not match.</p>
                    )}
                  </div>

                  <button onClick={handleChangePassword} style={{ ...gradBtn, alignSelf: 'flex-start' }}>
                    <Lock size={14}/> Change Password
                  </button>
                </div>

                <div style={{ background: dk ? '#0a1a0d' : '#f0fdf4', border: `1.5px solid ${bdr}`, borderRadius: 14, padding: '18px 20px', width: isMobile ? '100%' : 230, flexShrink: 0, alignSelf: 'flex-start' }}>
                  <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.8 }}>Requirements</p>
                  <CondRow met={conds.length}  label="At least 8 characters"        />
                  <CondRow met={conds.special} label="One special char (!@#$%^&*?)" />
                  <CondRow met={conds.number}  label="One number"                   />
                  <CondRow met={conds.match}   label="Passwords match"              />

                  {newPassword.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: txt2 }}>Strength</p>
                        <p style={{ margin: 0, fontSize: 11, fontWeight: 800, color: strengthColor }}>{strengthLabel}</p>
                      </div>
                      <div style={{ height: 6, borderRadius: 6, background: dk ? '#1a3d24' : '#e5e7eb', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${(score / 4) * 100}%`, background: strengthColor, borderRadius: 6, transition: 'width 0.3s, background 0.3s' }}/>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Photo Options Modal ── */}
      {showPhotoOptions && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 16 }}
          onClick={() => setShowPhotoOptions(false)}>
          <div style={{ background: card, borderRadius: 20, width: '100%', maxWidth: 320, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.25)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ background: `linear-gradient(135deg,${C.green},${C.teal})`, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ color: '#fff', margin: 0, fontSize: 16, fontWeight: 800 }}>Choose Option</h2>
              <button onClick={() => setShowPhotoOptions(false)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 8, padding: '4px 8px', cursor: 'pointer', color: '#fff', display: 'flex' }}><X size={15}/></button>
            </div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button onClick={openCamera} style={{ ...gradBtn, width: '100%' }}>
                <Camera size={15}/> Take Photo
              </button>
              <button onClick={() => { setShowPhotoOptions(false); fileRef.current?.click() }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 12, border: `1.5px solid ${bdr}`, background: 'transparent', color: txt, fontWeight: 800, fontSize: 13, cursor: 'pointer', width: '100%' }}>
                <Upload size={15}/> Upload from Device
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Camera Modal ── */}
      {showCamera && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 16 }}>
          <div style={{ background: card, borderRadius: 20, width: '100%', maxWidth: 480, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.25)' }}>
            <div style={{ background: `linear-gradient(135deg,${C.green},${C.teal})`, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ color: '#fff', margin: 0, fontSize: 16, fontWeight: 800 }}>Take Photo</h2>
              <button onClick={stopCamera} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 8, padding: '4px 8px', cursor: 'pointer', color: '#fff', display: 'flex' }}><X size={15}/></button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <video ref={videoRef} autoPlay playsInline style={{ width: '100%', borderRadius: 12, background: '#000', display: 'block' }}/>
              <canvas ref={canvasRef} style={{ display: 'none' }}/>
            </div>
            <div style={{ padding: '0 20px 20px', display: 'flex', gap: 10 }}>
              <button onClick={stopCamera} style={{ flex: 1, padding: '11px', borderRadius: 12, border: `1.5px solid ${bdr}`, background: 'transparent', color: txt, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={capturePhoto} disabled={uploading} style={{ ...gradBtn, flex: 1, opacity: uploading ? 0.7 : 1 }}>
                <Camera size={14}/> {uploading ? 'Saving…' : 'Capture'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast} type={toastType}/>}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </main>
  )
}