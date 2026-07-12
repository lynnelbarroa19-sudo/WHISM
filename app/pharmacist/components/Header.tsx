'use client'
import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'

interface TopbarProps {
  darkMode: boolean
  setDarkMode: (v: (d: boolean) => boolean) => void
  onNavigate?: (menu: string) => void
}

export default function Topbar({ darkMode, setDarkMode, onNavigate }: TopbarProps) {
  const { user } = useAuth()

  /* ── Live profile state ── */
  const [profileName,   setProfileName]   = useState('')
  const [profileRole,   setProfileRole]   = useState('Pharmacist')
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null)
  const [profileEmail,  setProfileEmail]  = useState('')

  const [time,        setTime]        = useState('')
  const [showProfile, setShowProfile] = useState(false)
  const [notifCount]                  = useState(3)
  const [showNotif,   setShowNotif]   = useState(false)

  const profileRef = useRef<HTMLDivElement>(null)
  const notifRef   = useRef<HTMLDivElement>(null)

  /* ── Fetch profile from Supabase on mount ── */
  useEffect(() => {
    fetchProfile()
  }, [])

  const fetchProfile = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id
    if (!uid) return

    const { data, error } = await supabase
      .from('users')
      .select('username, email, avatar_url, role')
      .eq('user_id', uid)
      .single()

    if (error) { console.error('[Topbar] fetchProfile:', error); return }
    if (data) {
      setProfileName(data.username   || '')
      setProfileEmail(data.email     || '')
      setProfileRole(data.role       || 'Pharmacist')
      if (data.avatar_url) setProfileAvatar(data.avatar_url)
    }
  }

  /* ── Listen to Settings save events ── */
  useEffect(() => {
    const onProfileUpdated = () => fetchProfile()
    const onAvatarUpdated  = () => fetchProfile()

    window.addEventListener('profileUpdated', onProfileUpdated)
    window.addEventListener('avatarUpdated',  onAvatarUpdated)
    return () => {
      window.removeEventListener('profileUpdated', onProfileUpdated)
      window.removeEventListener('avatarUpdated',  onAvatarUpdated)
    }
  }, [])

  /* ── Real-time clock ── */
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setTime(now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  /* ── Close dropdowns on outside click ── */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node))
        setShowProfile(false)
      if (notifRef.current && !notifRef.current.contains(e.target as Node))
        setShowNotif(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  /* ── Derived display values ── */
  const displayName   = profileName   || user?.name  || 'Pharmacist'
  const displayRole   = profileRole   || user?.role  || 'Pharmacist'
  const displayEmail  = profileEmail  || user?.email || ''
  const displayAvatar = profileAvatar || null

  const initials = displayName
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'P'

  const iconBtn: React.CSSProperties = {
    background: 'rgba(255,255,255,0.1)',
    border: 'none', borderRadius: '50%',
    width: 38, height: 38, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative', flexShrink: 0, transition: 'background 0.15s',
  }

  /* ── Avatar circle ── */
  const AvatarCircle = ({ size = 32, fontSize = 13 }: { size?: number; fontSize?: number }) => (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
      background: 'linear-gradient(135deg,#2ea82e,#0d9488)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 800, fontSize,
      border: '2px solid rgba(255,255,255,0.25)',
    }}>
      {displayAvatar
        ? <img src={displayAvatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : initials}
    </div>
  )

  /* ── Pharmacist-specific notifications ── */
  const notifications = [
    { title: 'Low stock alert',        sub: 'Amoxicillin — only 3 left'       },
    { title: 'New dispense request',   sub: 'Dr. Reyes — 10 mins ago'          },
    { title: 'Medicine restocked',     sub: 'Paracetamol 500mg — 1 hr ago'    },
  ]

  return (
    <header style={{
      background: '#1b3a1b', height: 64,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px', position: 'sticky', top: 0, zIndex: 40,
      boxShadow: '0 1px 6px rgba(0,0,0,0.25)', gap: 16,
    }}>

      {/* ── Search bar ── */}
      <div style={{ position: 'relative', flex: 1, maxWidth: 420 }}>
        <svg style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
          width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          placeholder="Search medicines, prescriptions…"
          onChange={e => window.dispatchEvent(new CustomEvent('topbar-search', { detail: e.target.value }))}
          style={{
            width: '100%', background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.15)', borderRadius: 50,
            padding: '9px 18px 9px 38px', color: '#fff', fontSize: 13,
            outline: 'none', transition: 'border 0.2s', boxSizing: 'border-box',
          }}
          onFocus={e  => (e.currentTarget.style.border = '1px solid rgba(255,255,255,0.5)')}
          onBlur={e   => (e.currentTarget.style.border = '1px solid rgba(255,255,255,0.15)')}
        />
      </div>

      {/* ── Right section ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>

        {/* Clock */}
        <div style={{
          color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 600,
          letterSpacing: 0.5, whiteSpace: 'nowrap',
          background: 'rgba(255,255,255,0.07)', borderRadius: 20, padding: '5px 14px',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {time}
        </div>

        {/* Notification bell */}
        <div ref={notifRef} style={{ position: 'relative' }}>
          <button onClick={() => setShowNotif(p => !p)} style={iconBtn}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {notifCount > 0 && (
              <span style={{
                position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: '50%',
                background: '#dc2626', color: '#fff', fontSize: 9, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '2px solid #1b3a1b',
              }}>{notifCount}</span>
            )}
          </button>

          {showNotif && (
            <div style={{
              position: 'absolute', right: 0, top: 'calc(100% + 10px)',
              background: '#fff', borderRadius: 16, width: 300,
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)', overflow: 'hidden', zIndex: 100,
            }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0fdf4', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 800, fontSize: 13, color: '#1b3a1b' }}>Notifications</span>
                <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 700, cursor: 'pointer' }}>Mark all read</span>
              </div>
              {notifications.map((n, i) => (
                <div key={i}
                  style={{ padding: '11px 16px', display: 'flex', gap: 10, alignItems: 'flex-start', borderBottom: i < notifications.length - 1 ? '1px solid #f9fafb' : 'none', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f0fdf4')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', flexShrink: 0, marginTop: 4 }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1f2937' }}>{n.title}</div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{n.sub}</div>
                  </div>
                </div>
              ))}
              <div style={{ padding: '10px 16px', textAlign: 'center', borderTop: '1px solid #f0fdf4' }}>
                <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 700, cursor: 'pointer' }}>View all notifications</span>
              </div>
            </div>
          )}
        </div>

        {/* Dark mode toggle */}
        <button onClick={() => setDarkMode(d => !d)} style={iconBtn}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}>
          {darkMode
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
          }
        </button>

        {/* ── User pill + dropdown ── */}
        <div ref={profileRef} style={{ position: 'relative' }}>
          <div onClick={() => setShowProfile(p => !p)}
            style={{
              display: 'flex', alignItems: 'center', gap: 9,
              background: 'rgba(255,255,255,0.12)', borderRadius: 50,
              padding: '5px 16px 5px 5px', cursor: 'pointer',
              border: showProfile ? '1px solid rgba(255,255,255,0.3)' : '1px solid transparent',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}>
            <AvatarCircle size={32} fontSize={13} />
            <div>
              <div style={{ color: '#fff', fontWeight: 600, fontSize: 13, lineHeight: 1.2, whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {displayName}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {displayRole}
              </div>
            </div>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5"
              style={{ marginLeft: 2, transform: showProfile ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>

          {showProfile && (
            <div style={{
              position: 'absolute', right: 0, top: 'calc(100% + 10px)',
              background: '#fff', borderRadius: 16, width: 240,
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)', overflow: 'hidden', zIndex: 100,
            }}>
              {/* Profile header */}
              <div style={{ padding: '14px 16px', background: 'linear-gradient(135deg,#1b3a1b,#2d5a2d)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <AvatarCircle size={42} fontSize={16} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {displayName}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {displayRole}
                  </div>
                  {displayEmail && (
                    <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {displayEmail}
                    </div>
                  )}
                </div>
              </div>

              {/* Menu items */}
              {[
                { icon: '👤', label: 'My Profile',      action: () => { setShowProfile(false); onNavigate?.('Settings') } },
                { icon: '🔒', label: 'Change Password', action: () => { setShowProfile(false); onNavigate?.('Settings') } },
                { icon: '⚙️', label: 'Settings',        action: () => { setShowProfile(false); onNavigate?.('Settings') } },
              ].map((item, i) => (
                <button key={i} onClick={item.action}
                  style={{
                    width: '100%', padding: '11px 16px', textAlign: 'left',
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    fontSize: 13, color: '#1f2937', fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 10,
                    borderBottom: '1px solid #f9fafb', transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f0fdf4')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ fontSize: 15 }}>{item.icon}</span> {item.label}
                </button>
              ))}

              <button
                style={{
                  width: '100%', padding: '11px 16px', textAlign: 'left',
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  fontSize: 13, color: '#dc2626', fontWeight: 700,
                  display: 'flex', alignItems: 'center', gap: 10, transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15 }}>🚪</span> Logout
              </button>
            </div>
          )}
        </div>

      </div>
    </header>
  )
}