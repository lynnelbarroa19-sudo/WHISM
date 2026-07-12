'use client'
import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/lib/theme'
import { supabase } from '@/lib/supabase'

type NotifKind = 'prescription' | 'restock'
type RestockStatus = 'pending' | 'alerted' | 'confirmed' | 'rejected'

type Notification = {
  id: string
  kind: NotifKind
  title: string
  sub: string
  read: boolean
  created_at: string
  restockStatus?: RestockStatus
}

// ── Date helper ───────────────────────────────────────────────────────────────
// Formats an ISO date string as "Jun 20, 2026" the same way the medtech side
// does, so prescription notifications read consistently across roles.
function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-PH', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch {
    return iso
  }
}

// ── Persisted read state ─────────────────────────────────────────────────────
// Notification "read" status only lives in this component's React state, and
// the prescriptions/restock_requests tables have no read/is_read column to
// write it back to. To survive a page reload without a schema change, we
// keep the set of read notification IDs in localStorage, scoped per
// pharmacist so different logins on the same browser don't share state.
function readStorageKey(pharmacistName: string): string {
  return `pharma_notif_read:${pharmacistName || 'anon'}`
}

function loadReadIds(pharmacistName: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(readStorageKey(pharmacistName))
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set(arr) : new Set()
  } catch {
    return new Set()
  }
}

function saveReadIds(pharmacistName: string, ids: Set<string>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(readStorageKey(pharmacistName), JSON.stringify(Array.from(ids)))
  } catch {
    // localStorage unavailable (e.g. private mode quota) — read state just
    // won't persist this session, nothing else breaks.
  }
}

// `onNavigate` now accepts an optional settings tab so menu items like
// "Change Password" can tell page.tsx which tab to land on. page.tsx is the
// sole owner of the URL (it mirrors activePage/settingsTab → URL in its own
// effect) — Topbar only calls onNavigate and never touches router.push
// itself, to avoid racing that effect (see goTo() below for the history of
// that bug).
type NavigateFn = (page: string, tab?: 'profile' | 'password') => void

export default function Topbar({ onNavigate }: { onNavigate?: NavigateFn }) {
  const { user }         = useAuth()
  const { dark, toggle, t } = useTheme()
  const router           = useRouter()

  const [profileName,   setProfileName]   = useState('')
  const [profileRole,   setProfileRole]   = useState('Pharmacist')
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null)
  const [profileEmail,  setProfileEmail]  = useState('')
  const [time,          setTime]          = useState('')
  const [showProfile,   setShowProfile]   = useState(false)
  const [showNotif,     setShowNotif]     = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])

  // ── Logout confirmation modal — mirrors Sidebar.tsx's modal exactly
  //    (same markup/inline styles) so Topbar and Sidebar logout behave
  //    identically instead of Topbar signing out immediately on click.
  const [showLogoutModal, setShowLogoutModal] = useState(false)

  const profileRef = useRef<HTMLDivElement>(null)
  const notifRef   = useRef<HTMLDivElement>(null)

  const displayNameRef = useRef('')
  const readIdsRef = useRef<Set<string>>(new Set())

  // ── Fetch profile ──────────────────────────────────────────────────────────
  useEffect(() => { fetchProfile() }, [])

  const fetchProfile = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id
    if (!uid) return
    const { data, error } = await supabase
      .from('users').select('username, email, avatar_url, role')
      .eq('user_id', uid).single()
    if (error) { console.error('[Topbar] fetchProfile:', error); return }
    if (data) {
      setProfileName(data.username  || '')
      setProfileEmail(data.email    || '')
      setProfileRole(data.role      || 'Pharmacist')
      if (data.avatar_url) setProfileAvatar(data.avatar_url)
    }
  }

  // ── Listen to settings save events ────────────────────────────────────────
  useEffect(() => {
    window.addEventListener('profileUpdated', fetchProfile)
    window.addEventListener('avatarUpdated',  fetchProfile)
    return () => {
      window.removeEventListener('profileUpdated', fetchProfile)
      window.removeEventListener('avatarUpdated',  fetchProfile)
    }
  }, [])

  // ── Clock ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => setTime(
      new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    )
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  // ── Close dropdowns on outside click ──────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setShowProfile(false)
      if (notifRef.current   && !notifRef.current.contains(e.target as Node))   setShowNotif(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Fetch existing unread prescription notifications ───────────────────────
  // Joins the patients table so the notification shows the actual patient's
  // name and the prescription date, instead of a generic "Doctor → Patient"
  // placeholder — matches the format used on the medtech side.
  useEffect(() => {
    fetchPrescriptionNotifications()
  }, [])

  const fetchPrescriptionNotifications = async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from('prescriptions')
      .select(`
        id,
        medicine,
        prescription_date,
        created_at,
        patients ( first_name, last_name )
      `)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      console.error('[Topbar] fetchPrescriptionNotifs:', error.message, error.details, error.hint)
      return
    }

    if (data && data.length > 0) {
      const notifs: Notification[] = data.map((row: any) => buildPrescriptionNotif(row))
      setNotifications(prev => mergeNotifs(prev, notifs))
    }
  }

  // Builds a prescription notification from a row that has a joined
  // `patients` relation — used by both the initial fetch and (after a
  // follow-up lookup) the realtime INSERT handler below.
  function buildPrescriptionNotif(row: any): Notification {
    const p = row.patients
    const patientName = p
      ? `${p.last_name ?? ''}, ${p.first_name ?? ''}`.trim().replace(/^,\s*/, '') || 'Patient'
      : 'Patient'
    const ts        = row.created_at ?? new Date().toISOString()
    const dateLabel = row.prescription_date ? fmtDate(row.prescription_date) : fmtDate(ts)
    return {
      id: `presc-${row.id}`,
      kind: 'prescription',
      title: 'New Prescription',
      sub: `${patientName} · ${dateLabel} · ${timeAgo(ts)}`,
      read: false,
      created_at: ts,
    }
  }

  // ── Fetch recent restock-status notifications for this pharmacist ──────────
  const fetchRestockNotifications = async (pharmacistName: string) => {
    if (!pharmacistName) return
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from('restock_requests')
      .select('id, medicine_name, dosage, medicine_type, quantity, status, created_at')
      .eq('pharmacist_name', pharmacistName)
      .neq('status', 'pending')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      console.error('[Topbar] fetchRestockNotifs:', error.message, error.details, error.hint)
      return
    }

    if (data && data.length > 0) {
      const notifs: Notification[] = data.map((row: any) => buildRestockNotif(row))
      setNotifications(prev => mergeNotifs(prev, notifs))
    }
  }

  useEffect(() => {
    const name = profileName || user?.name || ''
    displayNameRef.current = name
    readIdsRef.current = loadReadIds(name)
    setNotifications(prev => prev.map(n =>
      readIdsRef.current.has(n.id) ? { ...n, read: true } : n
    ))
    if (name) fetchRestockNotifications(name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileName, user?.name])

  function buildRestockNotif(row: any): Notification {
    const status: RestockStatus = (row.status ?? 'pending') as RestockStatus
    const label =
      status === 'confirmed' ? 'Restock Confirmed' :
      status === 'alerted'   ? 'Restock Alerted'   :
      status === 'rejected'  ? 'Restock Rejected'  : 'Restock Update'
    const detail = `${row.medicine_name}${row.dosage ? ` (${row.dosage})` : ''} · ${row.quantity} pcs`
    return {
      id: `restock-${row.id}-${status}`,
      kind: 'restock',
      title: label,
      sub: `${detail} · ${timeAgo(row.created_at)}`,
      read: false,
      created_at: row.created_at,
      restockStatus: status,
    }
  }

  function mergeNotifs(prev: Notification[], incoming: Notification[]): Notification[] {
    const byId = new Map(prev.map(n => [n.id, n]))
    for (const n of incoming) {
      const existing = byId.get(n.id)
      const wasRead  = existing?.read || readIdsRef.current.has(n.id)
      byId.set(n.id, wasRead ? { ...n, read: true } : n)
    }
    return Array.from(byId.values())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 30)
  }

  // ── Real-time: listen for new prescriptions ────────────────────────────────
  // The INSERT payload only contains the raw prescriptions row (no joined
  // patient), so we follow up with a quick lookup to resolve the patient's
  // name before building the notification — keeps it consistent with the
  // initial fetch instead of falling back to a placeholder.
  useEffect(() => {
    const channel = supabase
      .channel('pharma_prescriptions_notif')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'prescriptions' },
        async (payload) => {
          const row = payload.new as any
          let patientRow: any = null
          if (row.patient_id) {
            const { data } = await supabase
              .from('patients')
              .select('first_name, last_name')
              .eq('id', row.patient_id)
              .maybeSingle()
            patientRow = data
          }
          const newNotif = buildPrescriptionNotif({ ...row, patients: patientRow })
          setNotifications(prev => mergeNotifs(prev, [newNotif]))
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Real-time: listen for restock status changes by warehouse ─────────────
  useEffect(() => {
    const channel = supabase
      .channel('pharma_restock_status_notif')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'restock_requests' },
        (payload) => {
          const row     = payload.new as any
          const oldRow  = payload.old as any
          const myName  = displayNameRef.current
          if (!myName || row.pharmacist_name !== myName) return
          if (row.status === oldRow?.status) return
          if (row.status === 'pending') return

          const newNotif = buildRestockNotif(row)
          setNotifications(prev => mergeNotifs(prev, [newNotif]))
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // ── Mark all as read ───────────────────────────────────────────────────────
  const markAllRead = () => {
    setNotifications(prev => {
      for (const n of prev) readIdsRef.current.add(n.id)
      saveReadIds(displayNameRef.current, readIdsRef.current)
      return prev.map(n => ({ ...n, read: true }))
    })
  }

  // ── Mark single as read ────────────────────────────────────────────────────
  const markRead = (id: string) => {
    readIdsRef.current.add(id)
    saveReadIds(displayNameRef.current, readIdsRef.current)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  const unreadCount = notifications.filter(n => !n.read).length

  function timeAgo(iso: string): string {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (diff < 60)  return `${diff}s ago`
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  const displayName   = profileName   || user?.name  || 'Pharmacist'
  const displayRole   = profileRole   || user?.role  || 'Pharmacist'
  const displayEmail  = profileEmail  || user?.email || ''
  const displayAvatar = profileAvatar || null
  const initials      = displayName.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2) || 'P'

  const iconBtn: React.CSSProperties = {
    background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%',
    width: 38, height: 38, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative', flexShrink: 0, transition: 'background 0.15s',
  }

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

  // Routes a profile-menu click through onNavigate only. page.tsx owns the
  // URL (it has its own effect that mirrors activePage/settingsTab → the
  // address bar via router.replace) — this function used to ALSO call
  // router.push() directly with the tab in the query string, which raced
  // that effect. Whichever one ran last won, and since page.tsx's old
  // handleNavigate ignored the tab argument completely (always forcing
  // settingsTab back to "profile"), its router.replace would usually fire
  // after this router.push and silently overwrite ?tab=password back to
  // ?tab=profile — which is why "Change Password" and "Settings" both
  // appeared to do nothing different from "My Profile". Now this only
  // calls onNavigate(page, tab); page.tsx's effect is the single source of
  // truth for the URL, the same pattern already used for notification
  // clicks (see handleNotifClick below).
  const goTo = (page: string, tab?: 'profile' | 'password') => {
    setShowProfile(false)
    onNavigate?.(page, tab)
  }

  // Routes a clicked notification to the right page using only the
  // in-app onNavigate callback (page.tsx's setActivePage). We deliberately
  // do NOT also call router.push here — page.tsx already mirrors
  // activePage -> URL in its own effect, and calling router.push directly
  // raced with that effect, sometimes leaving the pharmacist looking at
  // Dashboard (with its own prescription slip modal) while the address bar
  // said ?page=prescriptions. Letting onNavigate drive activePage and
  // letting page.tsx own the URL avoids that mismatch entirely.
  // Both notification kinds now land on Dashboard, since Dashboard already
  // has its own Prescriptions panel (with the same RHU slip view) and its
  // own restock-requests modal — a separate full Prescriptions page was
  // redundant duplication of that panel.
  //
  // For a prescription notification specifically, we also dispatch the
  // underlying prescription's id (stripped of the "presc-" prefix used to
  // namespace notification ids) so Dashboard can open that exact RHU slip
  // immediately — instead of just landing on the panel and making the
  // pharmacist re-find and click the row themselves.
  const handleNotifClick = (n: Notification) => {
    markRead(n.id)
    setShowNotif(false)
    onNavigate?.('dashboard')
    if (n.kind === 'restock') {
      window.dispatchEvent(new CustomEvent('openViewRequests'))
    } else {
      const prescriptionId = n.id.replace(/^presc-/, '')
      window.dispatchEvent(new CustomEvent('openPrescriptionSlip', { detail: { id: prescriptionId } }))
    }
  }

  // ── Opens the confirmation modal instead of signing out immediately.
  //    The dropdown closes right away so the modal isn't shown behind it.
  const requestLogout = () => {
    setShowProfile(false)
    setShowLogoutModal(true)
  }

  // ── Actually performs the logout — only called from the modal's
  //    LOGOUT button.
  const handleLogout = async () => {
    setShowLogoutModal(false)
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const IconProfile = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  )
  const IconLock = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  )
  const IconSettings = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  )
  const IconLogout = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  )
  const IconRx = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, marginTop: 2 }}>
      <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18"/>
    </svg>
  )
  const IconBox = ({ color }: { color: string }) => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, marginTop: 2 }}>
      <path d="M21 8l-9-5-9 5 9 5 9-5z"/>
      <path d="M3 8v8l9 5 9-5V8"/>
      <path d="M12 13v8"/>
    </svg>
  )

  function restockAccent(status?: RestockStatus): string {
    if (status === 'confirmed') return '#16a34a'
    if (status === 'alerted')   return '#ca8a04'
    if (status === 'rejected')  return '#dc2626'
    return '#16a34a'
  }

  const menuItems = [
    { icon: <IconProfile />,  label: 'My Profile',      action: () => goTo('settings', 'profile')  },
    { icon: <IconLock />,     label: 'Change Password', action: () => goTo('settings', 'password') },
    { icon: <IconSettings />, label: 'Settings',        action: () => goTo('settings', 'profile')  },
  ]

  return (
    <header style={{
      background: '#1b3a1b', height: 64,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px', position: 'sticky', top: 0, zIndex: 40,
      boxShadow: '0 1px 6px rgba(0,0,0,0.25)', gap: 16,
    }}>

      <h2 style={{
        color: '#fff', fontSize: 18, fontWeight: 700, margin: 0,
        letterSpacing: '-.01em', whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        SMARTRHU
      </h2>

     

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

        {/* ── Notification bell ── */}
        <div ref={notifRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setShowNotif(p => !p)}
            style={iconBtn}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {unreadCount > 0 && (
              <span style={{
                position: 'absolute', top: 4, right: 4, width: 16, height: 16,
                borderRadius: '50%', background: '#dc2626', color: '#fff',
                fontSize: 9, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '2px solid #1b3a1b',
              }}>{unreadCount > 9 ? '9+' : unreadCount}</span>
            )}
          </button>

          {showNotif && (
            <div style={{
              position: 'absolute', right: 0, top: 'calc(100% + 10px)',
              background: '#fff', borderRadius: 16, width: 330,
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)', overflow: 'hidden', zIndex: 100,
              animation: 'fadeDown 0.15s ease',
            }}>
              {/* Header */}
              <div style={{
                padding: '12px 16px', borderBottom: '1px solid #f0fdf4',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 800, fontSize: 13, color: '#1b3a1b' }}>Notifications</span>
                  {unreadCount > 0 && (
                    <span style={{
                      background: '#dc2626', color: '#fff',
                      borderRadius: 20, padding: '1px 7px',
                      fontSize: 10, fontWeight: 800,
                    }}>{unreadCount}</span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <span
                    onClick={markAllRead}
                    style={{ fontSize: 11, color: '#16a34a', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Mark all read
                  </span>
                )}
              </div>

              {/* Notification list */}
              <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                {notifications.length === 0 ? (
                  <div style={{
                    padding: '28px 16px', textAlign: 'center',
                    color: '#9ca3af', fontSize: 12, fontStyle: 'italic',
                  }}>
                    No new notifications
                  </div>
                ) : (
                  notifications.map((n, i) => {
                    const accent = n.kind === 'restock' ? restockAccent(n.restockStatus) : '#16a34a'
                    return (
                      <div
                        key={n.id}
                        onClick={() => handleNotifClick(n)}
                        style={{
                          padding: '11px 16px',
                          display: 'flex', gap: 10, alignItems: 'flex-start',
                          borderBottom: i < notifications.length - 1 ? '1px solid #f9fafb' : 'none',
                          cursor: 'pointer',
                          background: n.read ? 'transparent' : '#f0fdf4',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#dcfce7')}
                        onMouseLeave={e => (e.currentTarget.style.background = n.read ? 'transparent' : '#f0fdf4')}
                      >
                        {/* Unread dot */}
                        <div style={{
                          width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 4,
                          background: n.read ? '#d1d5db' : accent,
                          transition: 'background 0.2s',
                        }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#1f2937' }}>{n.title}</div>
                          <div style={{
                            fontSize: 11, color: '#6b7280', marginTop: 2,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>{n.sub}</div>
                        </div>
                        {/* Kind icon */}
                        {n.kind === 'restock' ? <IconBox color={accent} /> : <IconRx />}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Dark mode ── */}
        <button onClick={toggle} style={iconBtn}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}>
          {dark
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <circle cx="12" cy="12" r="5"/>
                <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
          }
        </button>

        {/* ── User pill + dropdown ── */}
        <div ref={profileRef} style={{ position: 'relative' }}>
          <div onClick={() => setShowProfile(p => !p)} style={{
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
              <div style={{ color: '#fff', fontWeight: 600, fontSize: 13, lineHeight: 1.2,
                whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {displayName}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {displayRole}
              </div>
            </div>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
              stroke="rgba(255,255,255,0.6)" strokeWidth="2.5"
              style={{ marginLeft: 2, transform: showProfile ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>

          {showProfile && (
            <div style={{
              position: 'absolute', right: 0, top: 'calc(100% + 10px)',
              background: '#fff', borderRadius: 16, width: 260,
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)', overflow: 'hidden', zIndex: 100,
              animation: 'fadeDown 0.15s ease',
            }}>
              <div style={{ padding: '14px 16px',
                background: 'linear-gradient(135deg,#1b3a1b,#2d5a2d)',
                display: 'flex', alignItems: 'center', gap: 10 }}>
                <AvatarCircle size={42} fontSize={16} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 13,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</div>
                  <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10,
                    textTransform: 'uppercase', letterSpacing: 0.5 }}>{displayRole}</div>
                  {displayEmail && (
                    <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, marginTop: 1,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {displayEmail}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ height: 1, background: '#f0fdf4' }} />

              {menuItems.map((item, i) => (
                <button key={i} onClick={item.action} style={{
                  width: '100%', padding: '11px 16px', textAlign: 'left',
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  fontSize: 13, color: '#1f2937', fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 12,
                  borderBottom: '1px solid #f9fafb', transition: 'background 0.1s',
                  fontFamily: 'inherit',
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f0fdf4')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ color: '#4b6557', flexShrink: 0 }}>{item.icon}</span>
                  {item.label}
                </button>
              ))}

              <div style={{ height: 1, background: '#f0fdf4' }} />

              {/* ── Logout now opens the confirmation modal instead of
                  signing out immediately ── */}
              <button onClick={requestLogout} style={{
                width: '100%', padding: '11px 16px', textAlign: 'left',
                border: 'none', background: 'transparent', cursor: 'pointer',
                fontSize: 13, color: '#dc2626', fontWeight: 700,
                display: 'flex', alignItems: 'center', gap: 12,
                transition: 'background 0.1s', fontFamily: 'inherit',
              }}
                onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ color: '#dc2626', flexShrink: 0 }}><IconLogout /></span>
                Logout
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Logout Confirmation Modal (same markup/styles as Sidebar.tsx) ── */}
      {showLogoutModal && (
        <div
          onClick={() => setShowLogoutModal(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 16,
              width: 400,
              overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            }}
          >
            {/* Modal header */}
            <div style={{
              background: t.green,
              padding: '16px 20px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>Logout</span>
              <button
                onClick={() => setShowLogoutModal(false)}
                style={{
                  background: 'rgba(255,255,255,0.2)', border: 'none',
                  borderRadius: 8, width: 28, height: 28,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: '#fff',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {/* Modal body */}
            <div style={{
              padding: '36px 28px 28px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
            }}>
              {/* Icon circle */}
              <div style={{
                width: 64, height: 64, borderRadius: '50%',
                background: '#fef2f2',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
                  stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
              </div>

              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#111827', marginBottom: 6 }}>
                  Are you sure?
                </div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>
                  You will be logged out of the system.
                </div>
              </div>

              {/* Buttons */}
              <div style={{ display: 'flex', gap: 12, width: '100%', marginTop: 8 }}>
                <button
                  onClick={() => setShowLogoutModal(false)}
                  style={{
                    flex: 1, padding: '12px 0',
                    border: 'none', borderRadius: 10,
                    background: '#fef2f2', color: '#ef4444',
                    fontWeight: 700, fontSize: 13, cursor: 'pointer',
                    fontFamily: 'inherit', letterSpacing: '0.04em',
                  }}
                >
                  CANCEL
                </button>
                <button
                  onClick={handleLogout}
                  style={{
                    flex: 1, padding: '12px 0',
                    border: 'none', borderRadius: 10,
                    background: t.green, color: '#fff',
                    fontWeight: 700, fontSize: 13, cursor: 'pointer',
                    fontFamily: 'inherit', letterSpacing: '0.04em',
                    boxShadow: `0 4px 14px ${t.green}55`,
                  }}
                >
                  LOGOUT
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeDown {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        input[type="search"]::-webkit-search-cancel-button,
        input[type="search"]::-webkit-search-decoration { display: none; }
      `}</style>
    </header>
  )
}