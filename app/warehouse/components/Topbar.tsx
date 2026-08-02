'use client'
import { useState, useEffect, useRef, useMemo, CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { Bell, Moon, Sun, User, Lock, LogOut, ChevronDown } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import styles from './warehouse.module.css'
// Adjust this path if RequestBatchModal actually lives somewhere else
// relative to Topbar.
import RequestBatchModal from './RequestBatchModal'

// Route where the moved-out pharmacy requests page now lives.
// Adjust this if your actual folder/route is named differently.
const REQUESTS_ROUTE = '/warehouse/requests'

const NOTIF_TABLE = 'notifications'
const MY_ROLE = 'warehouse'

type NotifType = 'new_request' | 'request_approved' | 'request_rejected' | 'request_confirmed' | 'request_short'

interface AppNotification {
  id: string
  recipient_role: 'admin' | 'pharmacist' | 'warehouse'
  type: NotifType
  title: string
  message: string
  related_request_id: string | null
  // Set for batched submissions (2+ items sent together) — a single
  // notification now covers the whole batch instead of one per item.
  related_batch_id: string | null
  is_read: boolean
  created_at: string
}

interface Medicine {
  id: string
  med_name: string
  med_dosage: string
  med_type: string
  exp_date: string
  quantity: number
  unit: string
}

interface ExpiringAlert extends Medicine { daysLeft: number }

const LOW_STOCK_MAX = 30

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

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

/** Small per-type badge shown next to a DB notification's title. */
function notifBadge(type: NotifType): { label: string; bg: string; color: string } | null {
  switch (type) {
    case 'new_request':       return { label: 'New',      bg: '#fee2e2', color: '#dc2626' }
    case 'request_short':     return { label: 'Short',    bg: '#fef9c3', color: '#ca8a04' }
    case 'request_confirmed': return { label: 'Fulfilled',bg: '#dcfce7', color: '#16a34a' }
    case 'request_approved':  return { label: 'Approved', bg: '#dbeafe', color: '#2563eb' }
    case 'request_rejected':  return { label: 'Rejected', bg: '#fee2e2', color: '#dc2626' }
    default: return null
  }
}

/** Key used to group notification rows that belong to the same request —
 *  prefers the batch id (multi-item submissions); falls back to the single
 *  request id for legacy/one-item requests that predate batching; and
 *  finally the notification's own id so anything unrelated never collapses. */
function groupKey(n: AppNotification): string {
  return n.related_batch_id || n.related_request_id || n.id
}

const profileMenuItemStyle: CSSProperties = {
  width: '100%', padding: '11px 16px', textAlign: 'left',
  border: 'none', background: 'transparent', cursor: 'pointer',
  fontSize: 13, color: 'var(--text)', fontWeight: 600,
  display: 'flex', alignItems: 'center', gap: 12,
  borderBottom: '1px solid var(--border)', transition: 'background .1s',
  fontFamily: 'inherit',
}

export default function Topbar() {
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  const [showNotif, setShowNotif] = useState(false)
  const [selectedAlert, setSelectedAlert] = useState<ExpiringAlert | null>(null)
  // Set when a restock-request notification (new_request / request_short /
  // etc.) is clicked — drives the RequestBatchModal popup.
  const [openRequestNotif, setOpenRequestNotif] = useState<AppNotification | null>(null)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'alert' | 'confirm'>('confirm')
  const [showProfile, setShowProfile] = useState(false)
  const [time, setTime] = useState('')

  // ── Profile state — initialized from localStorage cache for instant display,
  //     then refreshed from Supabase via fetchProfile() ──
  const [userName, setUserName] = useState(() => {
    if (typeof window === 'undefined') return 'Name'
    try {
      const raw = localStorage.getItem('smartrhu_user')
      if (raw) { const u = JSON.parse(raw); if (u?.name) return u.name }
    } catch {}
    return localStorage.getItem('userName') || 'Name'
  })
  const [userRole, setUserRole] = useState('Member')
  const [userEmail, setUserEmail] = useState(
    typeof window !== 'undefined' ? localStorage.getItem('userEmail') || '' : ''
  )
  const [userAvatar, setUserAvatar] = useState<string | null>(
    typeof window !== 'undefined' ? localStorage.getItem('userAvatar') : null
  )

  // Pharmacy-request notifications (persistent, DB-backed)
  const [notifications, setNotifications] = useState<AppNotification[]>([])

  // Warehouse-stock alerts (expiring / low stock) — unchanged from before
  const [expiringAlerts, setExpiringAlerts] = useState<ExpiringAlert[]>([])
  const [lowStockAlerts, setLowStockAlerts] = useState<Medicine[]>([])
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [notifTab, setNotifTab] = useState<'new' | 'read'>('new')

  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState({
    name: '', dosage: '', type: '', expDate: '', quantity: '', unit: ''
  })
  const [addToast, setAddToast] = useState('')

  const profileRef = useRef<HTMLDivElement>(null)

  // ── Fetch profile from Supabase (name, role, email, avatar) ──
  const fetchProfile = async () => {
    const uid = getStoredUserId()
    if (!uid) {
      console.warn('[Topbar] fetchProfile: no uid found in localStorage (userId / smartrhu_user). Skipping fetch.')
      return
    }

    const { data, error } = await supabase
      .from('users')
      .select('username, email, avatar_url, role')
      .eq('user_id', uid)
      .maybeSingle()

    if (error) {
      console.error('[Topbar] fetchProfile error:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        uid,
      })
      return
    }

    if (!data) {
      console.warn('[Topbar] fetchProfile: no user row found for user_id =', uid)
      return
    }

    setUserName(data.username || 'Name')
    setUserEmail(data.email || '')
    setUserRole(
      data.role
        ? data.role === 'admin'
          ? 'Administrator'
          : data.role.charAt(0).toUpperCase() + data.role.slice(1)
        : 'Member'
    )
    if (data.avatar_url) setUserAvatar(`${data.avatar_url}?t=${Date.now()}`)
  }

  const fetchNotifications = async () => {
    const { data, error } = await supabase
      .from(NOTIF_TABLE)
      .select('*')
      .eq('recipient_role', MY_ROLE)
      .order('created_at', { ascending: false })
      .limit(30)

    if (error) {
      console.error('[Topbar] fetchNotifications error:', error)
      return
    }
    if (data) setNotifications(data as AppNotification[])
  }

  const fetchAlerts = async () => {
    const today = new Date()
    const { data } = await supabase
      .from('warehouse_medicines')
      .select('id, med_name, med_dosage, med_type, exp_date, quantity, unit')
      .eq('archived', false)

    if (data) {
      const expiring: ExpiringAlert[] = []
      const lowStock: Medicine[] = []

      data.forEach((m: Medicine) => {
        if (m.exp_date) {
          const exp = new Date(m.exp_date)
          const daysLeft = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
          if (daysLeft >= 0 && daysLeft <= 30) {
            expiring.push({ ...m, daysLeft })
          }
        }
        if (m.quantity <= LOW_STOCK_MAX) {
          lowStock.push(m)
        }
      })

      expiring.sort((a, b) => a.daysLeft - b.daysLeft)
      lowStock.sort((a, b) => a.quantity - b.quantity)

      setExpiringAlerts(expiring)
      setLowStockAlerts(lowStock)
    }
  }

  useEffect(() => {
    setMounted(true)
    fetchNotifications()
    fetchAlerts()
    fetchProfile()

    const storedRead = localStorage.getItem('smartrhu_read_notifs')
    if (storedRead) {
      try { setReadIds(new Set(JSON.parse(storedRead))) } catch {}
    }

    window.addEventListener('profileUpdated', fetchProfile)
    window.addEventListener('avatarUpdated', fetchProfile)

    // Live pharmacy-request notifications
    const notifChannel = supabase
      .channel('warehouse_notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: NOTIF_TABLE, filter: `recipient_role=eq.${MY_ROLE}` },
        (payload) => {
          const incoming = payload.new as AppNotification
          setNotifications(prev =>
            prev.some(n => n.id === incoming.id) ? prev : [incoming, ...prev]
          )
        }
      )
      .subscribe()

    return () => {
      window.removeEventListener('profileUpdated', fetchProfile)
      window.removeEventListener('avatarUpdated', fetchProfile)
      supabase.removeChannel(notifChannel)
    }
  }, [])

  // ── Close dropdowns on outside click ──
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setShowProfile(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Clock ──
  useEffect(() => {
    const tick = () => setTime(
      new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    )
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const showToastMsg = (msg: string, type: 'alert' | 'confirm') => {
    setToast(msg)
    setToastType(type)
    setTimeout(() => setToast(''), 3000)
  }

  // Local read-tracking for the non-DB alert types (expiring / low stock)
  const markAsRead = (fingerprint: string) => {
    setReadIds(prev => {
      if (prev.has(fingerprint)) return prev
      const next = new Set(prev)
      next.add(fingerprint)
      localStorage.setItem('smartrhu_read_notifs', JSON.stringify(Array.from(next)))
      return next
    })
  }

  // Server-tracked read state for pharmacy-request notifications — marks
  // every row that shares this request's group key (not just the one
  // clicked), so a request that somehow produced more than one DB row
  // doesn't leave a "ghost" unread entry behind.
  const markGroupRead = async (n: AppNotification) => {
    const key = groupKey(n)
    const idsInGroup = notifications.filter(x => groupKey(x) === key).map(x => x.id)
    if (!idsInGroup.length) return
    setNotifications(prev => prev.map(x => idsInGroup.includes(x.id) ? { ...x, is_read: true } : x))
    const { error } = await supabase.from(NOTIF_TABLE).update({ is_read: true }).in('id', idsInGroup)
    if (error) console.error('[Topbar] markGroupRead error:', error)
  }

  const markAllNotificationsRead = async () => {
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id)
    if (!unreadIds.length) return
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    const { error } = await supabase.from(NOTIF_TABLE).update({ is_read: true }).in('id', unreadIds)
    if (error) console.error('[Topbar] markAllNotificationsRead error:', error)
  }

  // Clicking a pharmacy-request notification now opens the request detail
  // popup directly (RequestBatchModal) instead of just navigating away —
  // it already carries related_request_id / related_batch_id, which is
  // exactly what that modal needs to look up the request.
  const handleRequestNotifClick = (n: AppNotification) => {
    markGroupRead(n)
    setShowNotif(false)
    setOpenRequestNotif(n)
  }

  const handleAddMedicine = async () => {
    if (!addForm.name || !addForm.dosage || !addForm.type || !addForm.expDate || !addForm.quantity) {
      setAddToast('Please fill in all fields.')
      setTimeout(() => setAddToast(''), 3000)
      return
    }
    const { error } = await supabase.from('warehouse_medicines').insert({
      med_name: addForm.name,
      med_dosage: addForm.dosage,
      med_type: addForm.type,
      exp_date: addForm.expDate,
      quantity: Number(addForm.quantity),
      unit: addForm.unit,
      archived: false,
    })
    if (!error) {
      setShowAddModal(false)
      setAddForm({ name: '', dosage: '', type: '', expDate: '', quantity: '', unit: '' })
      showToastMsg('Medicine added successfully!', 'confirm')
    } else {
      setAddToast('Error adding medicine!')
      setTimeout(() => setAddToast(''), 3000)
    }
  }

  const handleLogout = async () => {
    setShowProfile(false)
    try { await supabase.auth.signOut() } catch {}
    localStorage.removeItem('smartrhu_user')
    localStorage.removeItem('userId')
    localStorage.removeItem('userName')
    localStorage.removeItem('userEmail')
    localStorage.removeItem('userAvatar')
    window.location.href = '/landing'
  }

  const goToSettings = (tab?: 'profile' | 'password') => {
    setShowProfile(false)
    router.push(tab === 'password' ? '/warehouse/settings?tab=password' : '/warehouse/settings')
  }

  const initials = (userName || 'U').split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'U'

  // Tag every non-DB alert with a stable fingerprint, then split into "new" vs "read"
  const expiringTagged = expiringAlerts.map(m => ({ ...m, fp: `exp-${m.id}` }))
  const lowStockTagged = lowStockAlerts.map(m => ({ ...m, fp: `low-${m.id}` }))

  // Collapse notification rows that belong to the same request into one
  // entry. Handles both the (now-fixed) per-item legacy trigger and any
  // stray client-side duplicates: whichever row is most recent per group
  // is shown, and the group counts as unread if any row in it is unread.
  const groupedNotifications = useMemo(() => {
    const map = new Map<string, AppNotification>()
    for (const n of notifications) {
      const key = groupKey(n)
      const existing = map.get(key)
      if (!existing) {
        map.set(key, n)
      } else {
        // `notifications` is ordered newest-first, so `existing` is already
        // the most recent row for this key — just fold in read state.
        map.set(key, { ...existing, is_read: existing.is_read && n.is_read })
      }
    }
    return Array.from(map.values())
  }, [notifications])

  const newDbNotifs  = groupedNotifications.filter(n => !n.is_read)
  const readDbNotifs = groupedNotifications.filter(n => n.is_read)

  const newExpiring  = expiringTagged.filter(m => !readIds.has(m.fp))
  const newLowStock  = lowStockTagged.filter(m => !readIds.has(m.fp))

  const readExpiring = expiringTagged.filter(m => readIds.has(m.fp))
  const readLowStock = lowStockTagged.filter(m => readIds.has(m.fp))

  const unreadCount = newDbNotifs.length + newExpiring.length + newLowStock.length
  const readCount   = readDbNotifs.length + readExpiring.length + readLowStock.length
  const showRedDot  = unreadCount > 0

  const openNotif = () => {
    setShowNotif(!showNotif)
    setSelectedAlert(null)
  }

  if (!mounted) return <div className={styles.topbar} />

  return (
    <>
      <div className={styles.topbar}>

        {/* Brand title — static, replaces the per-page title */}
        <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: '-.01em' }}>
          SMARTRHU
        </h2>

        <div className={styles.topbarActions}>

          {/* Clock */}
          <div style={{
            color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 600,
            letterSpacing: 0.5, whiteSpace: 'nowrap',
            background: 'rgba(255,255,255,0.1)', borderRadius: 20, padding: '6px 14px',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {time}
          </div>

          {/* Notification Bell */}
          <div style={{ position: 'relative' }}>
            <button className={styles.iconBtn} onClick={openNotif}>
              <Bell size={18} />
              {showRedDot && <span className={styles.notifDot} />}
            </button>

            {showNotif && !selectedAlert && (
              <div className={styles.dropdown} style={{ width: 320, maxHeight: 460, display: 'flex', flexDirection: 'column' }}>
                <div className={styles.dropdownHeader} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className={styles.dropdownTitle}>Notifications</span>
                  {unreadCount > 0 && (
                    <span className={styles.dropdownBadge}>{unreadCount}</span>
                  )}
                </div>

                {/* New / Read tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
                  <button
                    onClick={() => setNotifTab('new')}
                    style={{
                      flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 700,
                      border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
                      color: notifTab === 'new' ? 'var(--green)' : 'var(--text3)',
                      borderBottom: notifTab === 'new' ? '2px solid var(--green)' : '2px solid transparent',
                    }}
                  >
                    New {unreadCount > 0 ? `(${unreadCount})` : ''}
                  </button>
                  <button
                    onClick={() => setNotifTab('read')}
                    style={{
                      flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 700,
                      border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
                      color: notifTab === 'read' ? 'var(--green)' : 'var(--text3)',
                      borderBottom: notifTab === 'read' ? '2px solid var(--green)' : '2px solid transparent',
                    }}
                  >
                    Read {readCount > 0 ? `(${readCount})` : ''}
                  </button>
                </div>

                {notifTab === 'new' && unreadCount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 12px 0' }}>
                    <button
                      onClick={markAllNotificationsRead}
                      style={{ background: 'none', border: 'none', color: 'var(--green)', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      Mark all read
                    </button>
                  </div>
                )}

                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {notifTab === 'new' ? (
                    unreadCount === 0 ? (
                      <div className={styles.notifEmpty}>You're all caught up!</div>
                    ) : (
                      <>
                        {newDbNotifs.map(n => {
                          const badge = notifBadge(n.type)
                          return (
                            <button
                              key={n.id}
                              className={styles.notifItem}
                              onClick={() => handleRequestNotifClick(n)}>
                              <div className={styles.notifItemTop}>
                                <span className={styles.notifItemName}>{n.title}</span>
                                {badge && (
                                  <span className={styles.urgentBadge} style={{ background: badge.bg, color: badge.color }}>
                                    {badge.label}
                                  </span>
                                )}
                              </div>
                              <div className={styles.notifItemSub}>{n.message}</div>
                              <div className={styles.notifItemTime}>{timeAgo(n.created_at)}</div>
                            </button>
                          )
                        })}

                        {newExpiring.map(med => (
                          <button
                            key={med.fp}
                            className={styles.notifItem}
                            onClick={() => { markAsRead(med.fp); setSelectedAlert(med) }}>
                            <div className={styles.notifItemTop}>
                              <span className={styles.notifItemName}>Expiring Soon</span>
                              <span
                                className={styles.urgentBadge}
                                style={{
                                  background: med.daysLeft <= 7 ? '#fee2e2' : '#fef9c3',
                                  color: med.daysLeft <= 7 ? '#dc2626' : '#ca8a04',
                                }}
                              >
                                {med.daysLeft}d left
                              </span>
                            </div>
                            <div className={styles.notifItemSub}>{med.med_name} · {med.med_dosage}</div>
                            <div className={styles.notifItemTime}>Exp: {med.exp_date}</div>
                          </button>
                        ))}

                        {newLowStock.map(med => (
                          <button
                            key={med.fp}
                            className={styles.notifItem}
                            onClick={() => { markAsRead(med.fp); setSelectedAlert({ ...med, daysLeft: -1 }) }}>
                            <div className={styles.notifItemTop}>
                              <span className={styles.notifItemName}>Low Stock</span>
                              <span className={styles.urgentBadge}>{med.quantity} left</span>
                            </div>
                            <div className={styles.notifItemSub}>{med.med_name} · {med.med_dosage}</div>
                            <div className={styles.notifItemTime}>{med.med_type}</div>
                          </button>
                        ))}
                      </>
                    )
                  ) : (
                    readCount === 0 ? (
                      <div className={styles.notifEmpty}>No read notifications yet</div>
                    ) : (
                      <>
                        {readDbNotifs.map(n => {
                          const badge = notifBadge(n.type)
                          return (
                            <button
                              key={n.id}
                              className={styles.notifItem}
                              style={{ opacity: 0.6 }}
                              onClick={() => { setShowNotif(false); setOpenRequestNotif(n) }}>
                              <div className={styles.notifItemTop}>
                                <span className={styles.notifItemName}>{n.title}</span>
                                {badge && (
                                  <span className={styles.urgentBadge} style={{ background: badge.bg, color: badge.color }}>
                                    {badge.label}
                                  </span>
                                )}
                              </div>
                              <div className={styles.notifItemSub}>{n.message}</div>
                              <div className={styles.notifItemTime}>{timeAgo(n.created_at)}</div>
                            </button>
                          )
                        })}

                        {readExpiring.map(med => (
                          <button
                            key={med.fp}
                            className={styles.notifItem}
                            style={{ opacity: 0.6 }}
                            onClick={() => setSelectedAlert(med)}>
                            <div className={styles.notifItemTop}>
                              <span className={styles.notifItemName}>Expiring Soon</span>
                            </div>
                            <div className={styles.notifItemSub}>{med.med_name} · {med.med_dosage}</div>
                            <div className={styles.notifItemTime}>Exp: {med.exp_date}</div>
                          </button>
                        ))}

                        {readLowStock.map(med => (
                          <button
                            key={med.fp}
                            className={styles.notifItem}
                            style={{ opacity: 0.6 }}
                            onClick={() => setSelectedAlert({ ...med, daysLeft: -1 })}>
                            <div className={styles.notifItemTop}>
                              <span className={styles.notifItemName}>Low Stock</span>
                            </div>
                            <div className={styles.notifItemSub}>{med.med_name} · {med.med_dosage}</div>
                            <div className={styles.notifItemTime}>{med.med_type}</div>
                          </button>
                        ))}
                      </>
                    )
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Dark Mode Toggle */}
          <button
            className={styles.iconBtn}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* ── User pill + dropdown (pharmacist-style) ── */}
          <div ref={profileRef} style={{ position: 'relative' }}>
            <button
              className={styles.avatarChip}
              onClick={() => setShowProfile(!showProfile)}>
              <div className={styles.avatar}>
                {userAvatar
                  ? <img src={userAvatar} alt="avatar" />
                  : initials}
              </div>
              <span className={styles.avatarName}>{userName}</span>
              <ChevronDown
                size={13}
                style={{
                  color: 'rgba(255,255,255,0.6)', marginLeft: 2,
                  transform: showProfile ? 'rotate(180deg)' : 'rotate(0)',
                  transition: 'transform 0.2s',
                }}
              />
            </button>

            {showProfile && (
              <div className={styles.dropdown} style={{ width: 260, padding: 0 }}>

                {/* Gradient header */}
                <div style={{
                  padding: '14px 16px',
                  background: 'linear-gradient(135deg, var(--green-dark), var(--green))',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{
                    width: 42, height: 42, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                    background: 'rgba(255,255,255,0.2)', border: '2px solid rgba(255,255,255,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 800, fontSize: 16,
                  }}>
                    {userAvatar
                      ? <img src={userAvatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : initials}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      color: '#fff', fontWeight: 700, fontSize: 13,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {userName}
                    </div>
                    <div style={{
                      color: 'rgba(255,255,255,0.65)', fontSize: 10,
                      textTransform: 'uppercase', letterSpacing: '.05em',
                    }}>
                      {userRole}
                    </div>
                    {userEmail && (
                      <div style={{
                        color: 'rgba(255,255,255,0.5)', fontSize: 10, marginTop: 1,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {userEmail}
                      </div>
                    )}
                  </div>
                </div>

                {/* Menu items */}
                <button
                  onClick={() => goToSettings('profile')}
                  style={profileMenuItemStyle}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--green-light)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <User size={15} style={{ color: 'var(--text2)', flexShrink: 0 }} /> My Profile
                </button>

                <button
                  onClick={() => goToSettings('password')}
                  style={profileMenuItemStyle}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--green-light)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <Lock size={15} style={{ color: 'var(--text2)', flexShrink: 0 }} /> Change Password
                </button>

                <button
                  onClick={handleLogout}
                  style={{ ...profileMenuItemStyle, color: '#dc2626', borderBottom: 'none' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <LogOut size={15} style={{ color: '#dc2626', flexShrink: 0 }} /> Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Expiring / Low Stock Alert Detail Modal */}
      {selectedAlert && (
        <div className={styles.modalBackdrop} onClick={() => setSelectedAlert(null)}>
          <div className={styles.modal} style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{selectedAlert.daysLeft >= 0 ? 'Expiring Soon' : 'Low Stock'}</h2>
              <button className={styles.modalClose} onClick={() => setSelectedAlert(null)}>✕</button>
            </div>
            <div className={styles.modalBody}>
              <div
                className={`${styles.warnIcon} ${selectedAlert.daysLeft >= 0 && selectedAlert.daysLeft <= 7 ? styles.warnIconRed : ''}`}
              >
                {selectedAlert.daysLeft >= 0 ? '⏳' : '📉'}
              </div>
              <p className={styles.warnTitle}>{selectedAlert.med_name}</p>
              <p className={styles.warnText}>{selectedAlert.med_dosage} · {selectedAlert.med_type}</p>

              {selectedAlert.daysLeft >= 0 ? (
                <>
                  <p className={styles.warnHighlight}>
                    Expires {selectedAlert.exp_date} ({selectedAlert.daysLeft} day{selectedAlert.daysLeft !== 1 ? 's' : ''} left)
                  </p>
                  <p className={styles.warnNote}>
                    {selectedAlert.quantity} {selectedAlert.unit} currently in stock.
                  </p>
                </>
              ) : (
                <>
                  <p className={styles.warnHighlight}>
                    Only {selectedAlert.quantity} {selectedAlert.unit} remaining
                  </p>
                  <p className={styles.warnNote}>
                    Consider restocking this item soon.
                  </p>
                </>
              )}
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.btnConfirm} onClick={() => setSelectedAlert(null)} style={{ flex: 1 }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restock-request detail popup — opened from a notification click.
          Shows request id, requester, date/time, items, and reason. */}
      {openRequestNotif && (
        <RequestBatchModal
          notification={{
            related_request_id: openRequestNotif.related_request_id,
            related_batch_id: openRequestNotif.related_batch_id,
          }}
          onClose={() => setOpenRequestNotif(null)}
        />
      )}

      {/* Add Medicine Modal */}
      {showAddModal && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>Add Medicine</h2>
              <button className={styles.modalClose} onClick={() => setShowAddModal(false)}>✕</button>
            </div>
            <div className={styles.modalBody}>
              {[
                { label: 'Medicine Name', key: 'name', type: 'text' },
                { label: 'Mg/Dosage', key: 'dosage', type: 'text' },
                { label: 'Medicine Type', key: 'type', type: 'text' },
                { label: 'EXP Date', key: 'expDate', type: 'date' },
                { label: 'Quantity', key: 'quantity', type: 'number' },
                { label: 'Unit', key: 'unit', type: 'text' },
              ].map(({ label, key, type }) => (
                <div key={key}>
                  <label>{label}</label>
                  <input
                    type={type}
                    className={styles.modalInput}
                    value={addForm[key as keyof typeof addForm]}
                    onChange={e => setAddForm({ ...addForm, [key]: e.target.value })}
                  />
                </div>
              ))}
              {addToast && (
                <p style={{ fontSize: 12, color: '#ef4444', textAlign: 'center' }}>{addToast}</p>
              )}
            </div>
            <div className={styles.modalFooter}>
              <button
                className={styles.btnCancel}
                onClick={() => { setShowAddModal(false); setAddForm({ name: '', dosage: '', type: '', expDate: '', quantity: '', unit: '' }) }}>
                CANCEL
              </button>
              <button className={styles.btnConfirm} onClick={handleAddMedicine}>CONFIRM</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`${styles.toast} ${toastType === 'alert' ? styles.toastWarning : ''}`}>
          ✓ {toast}
        </div>
      )}
    </>
  )
}