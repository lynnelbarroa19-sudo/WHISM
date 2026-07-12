'use client'
import { useState, useEffect, useRef, CSSProperties, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTheme } from 'next-themes'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'
import { User, Lock, Eye, EyeOff, Upload, Camera, Check, X, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import styles from '../components/warehouse.module.css'

type SettingsTab = 'profile' | 'password'

function getStoredUserId(): string | null {
  if (typeof window === 'undefined') return null
  const direct = localStorage.getItem('userId')
  if (direct) return direct
  try {
    const raw = localStorage.getItem('smartrhu_user')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed?.id) return parsed.id
      if (parsed?.user_id) return parsed.user_id
    }
  } catch {}
  return null
}

function SettingsPageInner() {
  const { theme } = useTheme()
  const searchParams = useSearchParams()
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile')
  const [photo, setPhoto] = useState<string | null>(
    typeof window !== 'undefined' ? localStorage.getItem('userAvatar') : null
  )
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [pwSaving, setPwSaving] = useState(false)

  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const [uploading, setUploading] = useState(false)
  const [showCamera, setShowCamera] = useState(false)

  // ── Captured photo waiting for confirmation ──
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [userId, setUserId] = useState<string | null>(null)

  const req = {
    length: newPassword.length >= 8,
    special: /[!@#$%^&*?]/.test(newPassword),
    number: /[0-9]/.test(newPassword),
    match: newPassword.length > 0 && newPassword === confirmPassword,
  }

  useEffect(() => {
    setMounted(true)
    const id = getStoredUserId()
    setUserId(id)
  }, [])

  // Read the ?tab= query param so the profile dropdown can deep-link to either tab
  useEffect(() => {
    const tabParam = searchParams.get('tab')
    if (tabParam === 'password' || tabParam === 'profile') {
      setActiveTab(tabParam)
    }
  }, [searchParams])

  useEffect(() => {
    if (userId) fetchProfile(userId)
  }, [userId])

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop())
      if (capturedPreview) URL.revokeObjectURL(capturedPreview)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchProfile = async (uid: string) => {
    const { data } = await supabase
      .from('users')
      .select('username, email, avatar_url')
      .eq('user_id', uid)
      .single()
    if (data) {
      setUsername(data.username || '')
      setEmail(data.email || '')
      if (data.avatar_url) setPhoto(`${data.avatar_url}?t=${Date.now()}`)
    }
  }

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast(msg)
    setToastType(type)
    setTimeout(() => setToast(''), 3500)
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !userId) return
    setPhoto(URL.createObjectURL(file))
    setUploading(true)
    try {
      const fileExt = file.name.split('.').pop()
      const filePath = `${userId}/avatar.${fileExt}`
      const { error: uploadError } = await supabase.storage
        .from('avatars').upload(filePath, file, { upsert: true })
      if (uploadError) { showToast(`Error: ${uploadError.message}`, 'error'); setUploading(false); return }
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath)
      const { error: updateError } = await supabase
        .from('users').update({ avatar_url: urlData.publicUrl }).eq('user_id', userId)
      if (updateError) { showToast(`Error saving photo: ${updateError.message}`, 'error'); setUploading(false); return }
      setPhoto(`${urlData.publicUrl}?t=${Date.now()}`)
      localStorage.setItem('userAvatar', urlData.publicUrl)
      window.dispatchEvent(new Event('avatarUpdated'))
      showToast('Photo updated successfully!', 'success')
    } catch { showToast('Something went wrong!', 'error') }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const openCamera = async () => {
    setShowCamera(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch {
      showToast('Camera access denied.', 'error')
      setShowCamera(false)
    }
  }

  // Closes the whole modal (Cancel / X) — discards everything
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (capturedPreview) URL.revokeObjectURL(capturedPreview)
    setCapturedBlob(null)
    setCapturedPreview(null)
    setShowCamera(false)
  }

  // Step 1: just capture a preview, do NOT upload yet
  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return
    const canvas = canvasRef.current
    canvas.width = videoRef.current.videoWidth
    canvas.height = videoRef.current.videoHeight
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) return
      setCapturedBlob(blob)
      setCapturedPreview(URL.createObjectURL(blob))
      // pause the live feed while reviewing the shot
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }, 'image/jpeg', 0.9)
  }

  // "Retake" — discard the preview, restart the live camera
  const retakePhoto = async () => {
    if (capturedPreview) URL.revokeObjectURL(capturedPreview)
    setCapturedBlob(null)
    setCapturedPreview(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch {
      showToast('Camera access denied.', 'error')
      setShowCamera(false)
    }
  }

  // "Use This Photo" — only now does it actually upload + save
  const confirmCapturedPhoto = async () => {
    if (!capturedBlob || !userId) return
    setUploading(true)
    const filePath = `${userId}/avatar.jpg`
    const { error: uploadError } = await supabase.storage
      .from('avatars').upload(filePath, capturedBlob, { upsert: true, contentType: 'image/jpeg' })
    if (uploadError) { showToast(`Error: ${uploadError.message}`, 'error'); setUploading(false); return }
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath)
    const { error: updateError } = await supabase
      .from('users').update({ avatar_url: urlData.publicUrl }).eq('user_id', userId)
    if (updateError) { showToast('Error saving photo.', 'error'); setUploading(false); return }
    setPhoto(`${urlData.publicUrl}?t=${Date.now()}`)
    localStorage.setItem('userAvatar', urlData.publicUrl)
    window.dispatchEvent(new Event('avatarUpdated'))
    showToast('Photo saved successfully!', 'success')
    setUploading(false)
    stopCamera()
  }

  const handleSaveProfile = async () => {
    if (!username || !email) { showToast('Please fill in all fields.', 'error'); return }
    if (!userId) return
    setSaving(true)
    const { error } = await supabase
      .from('users').update({ username, email }).eq('user_id', userId)
    setSaving(false)
    if (error) { showToast('Error saving profile!', 'error'); return }
    localStorage.setItem('userName', username)
    localStorage.setItem('userEmail', email)
    window.dispatchEvent(new Event('profileUpdated'))
    showToast('Profile saved successfully!', 'success')
  }

  const handleChangePassword = async () => {
    if (!currentPassword) { showToast('Please enter your current password.', 'error'); return }
    if (!req.length)  { showToast('Password must be at least 8 characters.', 'error'); return }
    if (!req.special) { showToast('Password must have a special character.', 'error'); return }
    if (!req.number)  { showToast('Password must have a number.', 'error'); return }
    if (!req.match)   { showToast('Passwords do not match.', 'error'); return }
    const userEmail = localStorage.getItem('userEmail') || ''
    setPwSaving(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: userEmail, password: currentPassword })
    if (signInError) { showToast('Current password is incorrect.', 'error'); setPwSaving(false); return }
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    setPwSaving(false)
    if (updateError) { showToast('Error changing password!', 'error'); return }
    setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
    showToast('Password changed successfully!', 'success')
  }

  const now = new Date()
  const dateStr = now.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const inputStyle: CSSProperties = {
    width: '100%', padding: '11px 14px',
    border: '1.5px solid var(--border)',
    borderRadius: 8, fontSize: 14, fontFamily: 'inherit',
    background: 'var(--surface)', color: 'var(--text)',
    outline: 'none', boxSizing: 'border-box',
    transition: 'border-color 0.2s',
  }

  const labelStyle: CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
    color: 'var(--text3)', marginBottom: 6, display: 'block',
    textTransform: 'uppercase',
  }

  const sideTabStyle = (active: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 10,
    width: '100%', padding: '10px 12px',
    borderRadius: 9, border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 13,
    fontWeight: active ? 700 : 500,
    background: active ? 'var(--green)' : 'transparent',
    color: active ? '#fff' : 'var(--text)',
    textAlign: 'left', transition: 'background 0.15s',
    marginBottom: 4,
  })

  const initials = (username || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

  return (
    <div className={`${styles.root} ${mounted && theme === 'dark' ? styles.dark : ''}`}>
      <Sidebar />
      <div className={styles.mainArea}>
        <Topbar />
        <div className={styles.content}>

          {/* Page heading */}
          <div style={{ marginBottom: 24 }}>
            <p className={styles.pageEyebrow}>Warehouse</p>
            <h1 className={styles.pageTitle} style={{ marginBottom: 4 }}>Settings</h1>
            <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>{dateStr}</p>
          </div>

          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>

            {/* ── Left sidebar nav ── */}
            <div style={{
              width: 240, background: 'var(--surface)',
              borderRadius: 16, padding: '20px 16px',
              boxShadow: 'var(--shadow)',
              border: '1px solid var(--border)',
              flexShrink: 0,
            }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)',
                textTransform: 'uppercase', letterSpacing: '.1em',
                marginBottom: 14, paddingLeft: 4, marginTop: 0 }}>
                Settings
              </p>

              {/* User card */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'var(--surface2)', borderRadius: 10,
                padding: '10px 12px', marginBottom: 20,
                border: '1px solid var(--border)',
              }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%',
                  overflow: 'hidden', background: 'var(--green-light)',
                  flexShrink: 0, border: '2px solid var(--green)' }}>
                  {photo
                    ? <img src={photo} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setPhoto(null)} />
                    : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: 'var(--green)' }}>
                        {initials}
                      </div>
                  }
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {username || 'Staff'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>Warehouse Staff</div>
                </div>
              </div>

              {/* Nav tabs */}
              <button type="button" onMouseDown={e => e.preventDefault()} style={sideTabStyle(activeTab === 'profile')} onClick={() => setActiveTab('profile')}>
                <User size={15} /> User Profile
              </button>
              <button type="button" onMouseDown={e => e.preventDefault()} style={sideTabStyle(activeTab === 'password')} onClick={() => setActiveTab('password')}>
                <Lock size={15} /> Password
              </button>
            </div>

            {/* ── Right content ── */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 20 }}>

              <div style={{
                flex: 1, background: 'var(--surface)',
                borderRadius: 16, padding: '36px 40px',
                boxShadow: 'var(--shadow)',
                border: '1px solid var(--border)',
              }}>

                {/* ══ PROFILE TAB ══ */}
                {activeTab === 'profile' && (
                  <>
                    <div style={{ marginBottom: 28 }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>User Profile</div>
                      <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>
                        Update your display name, email, and profile photo.
                      </div>
                    </div>

                    {/* Photo section */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 32 }}>
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <div style={{ width: 90, height: 90, borderRadius: '50%',
                          overflow: 'hidden', border: '3px solid var(--green)',
                          background: 'var(--green-light)' }}>
                          {photo
                            ? <img src={photo} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setPhoto(null)} />
                            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 700, color: 'var(--green)' }}>
                                {initials}
                              </div>
                          }
                        </div>
                        {uploading && (
                          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div style={{ width: 24, height: 24, borderRadius: '50%', border: '3px solid #fff', borderTopColor: 'transparent', animation: 'whSpin 0.7s linear infinite' }} />
                          </div>
                        )}
                      </div>

                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>
                          Profile Photo
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            background: 'var(--green)', color: '#fff', border: 'none',
                            borderRadius: 20, padding: '8px 20px',
                            fontSize: 13, fontWeight: 600,
                            cursor: uploading ? 'not-allowed' : 'pointer',
                            fontFamily: 'inherit', opacity: uploading ? 0.7 : 1,
                          }}>
                            <Upload size={14} />
                            {uploading ? 'Uploading…' : 'Change Photo'}
                          </button>
                          <button type="button" onClick={openCamera} disabled={uploading} style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            background: 'transparent', color: 'var(--green)',
                            border: '1.5px solid var(--green)', borderRadius: 20,
                            padding: '8px 20px', fontSize: 13, fontWeight: 600,
                            cursor: 'pointer', fontFamily: 'inherit',
                          }}>
                            <Camera size={14} />
                            Camera
                          </button>
                        </div>
                        <p style={{ fontSize: 11, color: 'var(--text3)', margin: 0 }}>
                          JPG, PNG, GIF or WEBP · Max 5 MB
                        </p>
                        <input key={photo ?? 'no-photo'} ref={fileRef} type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: 'none' }} />
                      </div>
                    </div>

                    {/* Fields */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px', marginBottom: 32 }}>
                      <div>
                        <label style={labelStyle}>Username</label>
                        <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter username" style={inputStyle}
                          onFocus={e => (e.currentTarget.style.borderColor = 'var(--green)')}
                          onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')} />
                      </div>
                      <div>
                        <label style={labelStyle}>Email</label>
                        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Enter email" style={inputStyle}
                          onFocus={e => (e.currentTarget.style.borderColor = 'var(--green)')}
                          onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')} />
                      </div>
                    </div>

                    <button type="button" onClick={handleSaveProfile} disabled={saving} style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      background: saving ? 'var(--green-mid)' : 'var(--green)',
                      color: '#fff', border: 'none', borderRadius: 22,
                      padding: '11px 30px', fontSize: 13, fontWeight: 700,
                      cursor: saving ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit', transition: 'background 0.2s',
                    }}>
                      {saving
                        ? <><Loader2 size={13} style={{ animation: 'whSpin 0.8s linear infinite' }} /> Saving…</>
                        : <><Check size={13} /> Save Changes</>
                      }
                    </button>
                  </>
                )}

                {/* ══ PASSWORD TAB ══ */}
                {activeTab === 'password' && (
                  <>
                    <div style={{ marginBottom: 28 }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>Change Password</div>
                      <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>
                        Your new password must meet all the requirements on the right.
                      </div>
                    </div>

                    {([
                      { label: 'Current Password', value: currentPassword, setter: setCurrentPassword, show: showCurrent, toggle: () => setShowCurrent(v => !v), placeholder: 'Enter current password' },
                      { label: 'New Password', value: newPassword, setter: setNewPassword, show: showNew, toggle: () => setShowNew(v => !v), placeholder: 'Enter new password' },
                      { label: 'Confirm New Password', value: confirmPassword, setter: setConfirmPassword, show: showConfirm, toggle: () => setShowConfirm(v => !v), placeholder: 'Confirm new password' },
                    ] as const).map(({ label, value, setter, show, toggle, placeholder }, i) => (
                      <div key={label} style={{ marginBottom: i < 2 ? 18 : 32 }}>
                        <label style={labelStyle}>{label}</label>
                        <div style={{ position: 'relative' }}>
                          <input
                            type={show ? 'text' : 'password'}
                            value={value}
                            onChange={e => setter(e.target.value)}
                            placeholder={placeholder}
                            style={{ ...inputStyle, paddingRight: 44 }}
                            onFocus={e => (e.currentTarget.style.borderColor = 'var(--green)')}
                            onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')} />
                          <button type="button" onClick={toggle} style={{
                            position: 'absolute', right: 12, top: '50%',
                            transform: 'translateY(-50%)',
                            border: 'none', background: 'none',
                            cursor: 'pointer', color: 'var(--text3)', padding: 0,
                            display: 'flex',
                          }}>
                            {show ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </div>
                    ))}

                    <button type="button" onClick={handleChangePassword}
                      disabled={pwSaving || !req.length || !req.special || !req.number || !req.match}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        background: 'var(--green)', color: '#fff', border: 'none',
                        borderRadius: 22, padding: '11px 30px',
                        fontSize: 13, fontWeight: 700,
                        cursor: (pwSaving || !req.length || !req.special || !req.number || !req.match) ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit',
                        opacity: (pwSaving || !req.length || !req.special || !req.number || !req.match) ? 0.55 : 1,
                        transition: 'background 0.2s',
                      }}>
                      {pwSaving
                        ? <><Loader2 size={13} style={{ animation: 'whSpin 0.8s linear infinite' }} /> Changing…</>
                        : <><Lock size={13} /> Change Password</>
                      }
                    </button>
                  </>
                )}
              </div>

              {/* Requirements panel */}
              {activeTab === 'password' && (
                <div style={{
                  width: 220, background: 'var(--surface2)',
                  borderRadius: 16, padding: '24px 20px',
                  boxShadow: 'var(--shadow)',
                  flexShrink: 0, border: '1px solid var(--border)',
                  alignSelf: 'flex-start',
                }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)',
                    textTransform: 'uppercase', letterSpacing: '.08em',
                    marginBottom: 16, marginTop: 0 }}>
                    Requirements
                  </p>
                  {([
                    { met: req.length, label: 'At least 8 characters' },
                    { met: req.special, label: 'One special char (!@#$%^&*?)' },
                    { met: req.number, label: 'One number' },
                    { met: req.match, label: 'Passwords match' },
                  ]).map(({ met, label }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                        border: `2px solid ${met ? 'var(--green)' : 'var(--border)'}`,
                        background: met ? 'var(--green)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all .2s',
                      }}>
                        {met && <Check size={10} color="#fff" strokeWidth={3} />}
                      </div>
                      <span style={{ fontSize: 12, color: met ? 'var(--green)' : 'var(--text3)', fontWeight: met ? 700 : 400, lineHeight: 1.4 }}>
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Camera modal ── */}
      {showCamera && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 18, width: '100%', maxWidth: 480, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,.28)' }}>
            <div style={{ background: 'linear-gradient(90deg, var(--green-dark), var(--green))', padding: '16px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Camera size={16} /> {capturedPreview ? 'Review Photo' : 'Take Photo'}
              </span>
              <button type="button" onClick={stopCamera} style={{ border: 'none', background: 'rgba(255,255,255,.2)', color: '#fff', width: 28, height: 28, borderRadius: 7, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={13} />
              </button>
            </div>
            <div style={{ padding: 16 }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                style={{ width: '100%', borderRadius: 10, background: '#000', display: capturedPreview ? 'none' : 'block' }}
              />
              {capturedPreview && (
                <img src={capturedPreview} alt="Captured preview" style={{ width: '100%', borderRadius: 10, display: 'block' }} />
              )}
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              {capturedPreview && (
                <p style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', marginTop: 10, marginBottom: 0 }}>
                  Sigurado ka ba na ito ang gusto mong gamiting profile photo?
                </p>
              )}
            </div>
            <div style={{ padding: '12px 22px', display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--border)' }}>
              {capturedPreview ? (
                <>
                  <button type="button" onClick={retakePhoto} disabled={uploading} style={{ background: 'var(--surface2)', color: 'var(--text)', border: 'none', borderRadius: 20, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                    Retake
                  </button>
                  <button type="button" onClick={confirmCapturedPhoto} disabled={uploading} style={{ background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 20, padding: '8px 22px', fontSize: 13, fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: uploading ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {uploading
                      ? <><Loader2 size={13} style={{ animation: 'whSpin 0.8s linear infinite' }} /> Saving…</>
                      : <><Check size={13} /> Use This Photo</>
                    }
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={stopCamera} style={{ background: 'var(--surface2)', color: 'var(--text)', border: 'none', borderRadius: 20, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Cancel
                  </button>
                  <button type="button" onClick={capturePhoto} style={{ background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 20, padding: '8px 22px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Camera size={13} /> Capture
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 28, right: 28, zIndex: 2000,
          background: toastType === 'success' ? 'var(--green)' : '#ef4444',
          color: '#fff', borderRadius: 12, padding: '12px 20px',
          fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
          boxShadow: '0 8px 24px rgba(0,0,0,.18)',
          display: 'flex', alignItems: 'center', gap: 8,
          animation: 'whSlideUp 0.25s ease',
        }}>
          {toastType === 'success' ? <Check size={14} /> : <X size={14} />}
          {toast}
        </div>
      )}

      <style>{`
        @keyframes whSpin    { to { transform: rotate(360deg); } }
        @keyframes whSlideUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  )
}