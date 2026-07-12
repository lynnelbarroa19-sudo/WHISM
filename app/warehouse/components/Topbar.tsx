'use client'
import { useState, useEffect, useRef, CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { Bell, Moon, Sun, Search, X, User, Lock, LogOut, ChevronDown } from 'lucide-react'
import { Doughnut } from 'react-chartjs-2'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { supabase } from '@/lib/supabase'
import styles from './warehouse.module.css'

ChartJS.register(ArcElement, Tooltip, Legend)

interface RestockRequest {
  id: number
  pharmacist_name: string
  medicine_name: string
  dosage: string
  medicine_type: string
  quantity: number
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

const stockData = {
  Highest: { labels: ['Paracetamol','Amoxicillin','Vitamin C'], data: [120,95,80], colors: ['#16a34a','#2d9e4f','#4ade80'] },
  Medium:  { labels: ['Ibuprofen','Mefenamic','Cetirizine'],   data: [55,45,40],   colors: ['#f59e0b','#fbbf24','#fcd34d'] },
  Lowest:  { labels: ['Insulin','Metformin','Losartan'],        data: [10,8,5],     colors: ['#ef4444','#f56565','#fc8181'] },
}
type FilterType = 'Highest' | 'Medium' | 'Lowest'

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
  const [selectedRequest, setSelectedRequest] = useState<RestockRequest | null>(null)
  const [selectedAlert, setSelectedAlert] = useState<ExpiringAlert | null>(null)
  const [stockFilter, setStockFilter] = useState<FilterType>('Highest')
  const [notifSearch, setNotifSearch] = useState('')
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

  const [requests, setRequests] = useState<RestockRequest[]>([])
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
    if (!uid) return
    const { data, error } = await supabase
      .from('users')
      .select('username, email, avatar_url, role')
      .eq('user_id', uid)
      .single()
    if (error) { console.error('[Topbar] fetchProfile:', error); return }
    if (data) {
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
  }

  useEffect(() => {
    setMounted(true)
    fetchRequests()
    fetchAlerts()
    fetchProfile()

    const storedRead = localStorage.getItem('smartrhu_read_notifs')
    if (storedRead) {
      try { setReadIds(new Set(JSON.parse(storedRead))) } catch {}
    }

    window.addEventListener('profileUpdated', fetchProfile)
    window.addEventListener('avatarUpdated', fetchProfile)
    return () => {
      window.removeEventListener('profileUpdated', fetchProfile)
      window.removeEventListener('avatarUpdated', fetchProfile)
    }
  }, [])

  // ── Close profile dropdown on outside click ──
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

  const fetchRequests = async () => {
    const { data } = await supabase
      .from('restock_requests')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    setRequests(data || [])
  }

  const fetchAlerts = async () => {
    const today = new Date()
    const in30 = new Date()
    in30.setDate(in30.getDate() + 30)

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

  const showToastMsg = (msg: string, type: 'alert' | 'confirm') => {
    setToast(msg)
    setToastType(type)
    setTimeout(() => setToast(''), 3000)
  }

  const markAsRead = (fingerprint: string) => {
    setReadIds(prev => {
      if (prev.has(fingerprint)) return prev
      const next = new Set(prev)
      next.add(fingerprint)
      localStorage.setItem('smartrhu_read_notifs', JSON.stringify(Array.from(next)))
      return next
    })
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

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })

  const initials = (userName || 'U').split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'U'
  const current = stockData[stockFilter]
  const chartData = {
    labels: current.labels,
    datasets: [{ data: current.data, backgroundColor: current.colors, borderWidth: 0 }]
  }

  const filteredRequests = requests.filter(r =>
    notifSearch.trim() === '' ? true :
    r.medicine_name.toLowerCase().includes(notifSearch.toLowerCase()) ||
    r.pharmacist_name.toLowerCase().includes(notifSearch.toLowerCase())
  )

  // Tag every notification with a stable fingerprint, then split into "new" vs "read"
  const requestsTagged = requests.map(r => ({ ...r, fp: `req-${r.id}` }))
  const expiringTagged = expiringAlerts.map(m => ({ ...m, fp: `exp-${m.id}` }))
  const lowStockTagged = lowStockAlerts.map(m => ({ ...m, fp: `low-${m.id}` }))

  const newRequests  = requestsTagged.filter(r => !readIds.has(r.fp))
  const newExpiring  = expiringTagged.filter(m => !readIds.has(m.fp))
  const newLowStock  = lowStockTagged.filter(m => !readIds.has(m.fp))

  const readRequests = requestsTagged.filter(r => readIds.has(r.fp))
  const readExpiring = expiringTagged.filter(m => readIds.has(m.fp))
  const readLowStock = lowStockTagged.filter(m => readIds.has(m.fp))

  const unreadCount = newRequests.length + newExpiring.length + newLowStock.length
  const readCount = readRequests.length + readExpiring.length + readLowStock.length
  const showRedDot = unreadCount > 0

  const openNotif = () => {
    setShowNotif(!showNotif)
    setSelectedRequest(null)
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

            {showNotif && !selectedRequest && !selectedAlert && (
              <div className={styles.dropdown} style={{ width: 320, maxHeight: 460, display: 'flex', flexDirection: 'column' }}>
                <div className={styles.dropdownHeader}>
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

                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {notifTab === 'new' ? (
                    unreadCount === 0 ? (
                      <div className={styles.notifEmpty}>You're all caught up!</div>
                    ) : (
                      <>
                        {newRequests.map(req => (
                          <button
                            key={req.fp}
                            className={styles.notifItem}
                            onClick={() => { markAsRead(req.fp); setSelectedRequest(req) }}>
                            <div className={styles.notifItemTop}>
                              <span className={styles.notifItemName}>Restock Request</span>
                              <span className={styles.urgentBadge}>Urgent</span>
                            </div>
                            <div className={styles.notifItemSub}>{req.medicine_name} — {req.pharmacist_name}</div>
                            <div className={styles.notifItemTime}>{formatDate(req.created_at)}</div>
                          </button>
                        ))}

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
                        {readRequests.map(req => (
                          <button
                            key={req.fp}
                            className={styles.notifItem}
                            style={{ opacity: 0.6 }}
                            onClick={() => setSelectedRequest(req)}>
                            <div className={styles.notifItemTop}>
                              <span className={styles.notifItemName}>Restock Request</span>
                            </div>
                            <div className={styles.notifItemSub}>{req.medicine_name} — {req.pharmacist_name}</div>
                            <div className={styles.notifItemTime}>{formatDate(req.created_at)}</div>
                          </button>
                        ))}

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

      {/* Restock Request Modal */}
      {selectedRequest && (
        <div className={styles.modalBackdrop}>
          <div className={`${styles.modal} ${styles.restockModal}`}>

            <div className={styles.restockLeft}>
              <p className={styles.restockLeftTitle}>Requested Medicine</p>
              {[
                ['Requested by:', selectedRequest.pharmacist_name],
                ['Medicine Name:', selectedRequest.medicine_name],
                ['Mg/Dosage:', selectedRequest.dosage],
                ['Medicine Type:', selectedRequest.medicine_type],
                ['Quantity:', String(selectedRequest.quantity)],
                ['Date and Time:', formatDate(selectedRequest.created_at)],
              ].map(([label, value]) => (
                <div key={label} className={styles.restockField}>
                  <span className={styles.restockFieldLabel}>{label}</span>
                  <span className={styles.restockFieldValue}>{value}</span>
                </div>
              ))}
            </div>

            <div className={styles.restockRight}>
              <div className={styles.restockChartHeader}>Stock Levels</div>
              <div className={styles.restockChart}>
                <Doughnut
                  data={chartData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    cutout: '60%'
                  }}
                />
              </div>

              <div className={styles.filterRow}>
                {(['Highest','Medium','Lowest'] as FilterType[]).map(f => (
                  <button
                    key={f}
                    onClick={() => { setStockFilter(f); setNotifSearch('') }}
                    className={`${styles.filterBtn} ${
                      stockFilter === f
                        ? f === 'Highest' ? styles.filterBtnHighest
                          : f === 'Medium' ? styles.filterBtnMedium
                          : styles.filterBtnLowest
                        : ''
                    }`}>
                    {f}
                  </button>
                ))}
              </div>

              <div className={styles.restockSearch}>
                <Search size={13} className={styles.restockSearchIco} />
                <input
                  className={styles.restockSearchInput}
                  placeholder="Search medicine name or dosage..."
                  value={notifSearch}
                  onChange={e => setNotifSearch(e.target.value)}
                />
              </div>

              <div className={styles.restockList}>
                <div className={styles.restockListHeader}>
                  <span>Medicine</span>
                  <span style={{ textAlign: 'center' }}>Mg/Dosage</span>
                  <span style={{ textAlign: 'right' }}>Quantity</span>
                </div>
                {filteredRequests.length > 0 ? filteredRequests.map((req, i) => (
                  <div key={i} className={styles.restockListItem}>
                    <span className={styles.restockListItemName}>{req.medicine_name}</span>
                    <span className={styles.restockListItemDosage}>{req.dosage}</span>
                    <span className={styles.restockListItemQty}>{req.quantity}</span>
                  </div>
                )) : (
                  <div className={styles.restockEmpty}>No requests found</div>
                )}
              </div>

              <div className={styles.modalFooter} style={{ padding: 0, borderTop: 'none' }}>
                <button
                  className={styles.btnCancel}
                  onClick={() => { setSelectedRequest(null); setShowNotif(false); setNotifSearch('') }}>
                  CANCEL
                </button>
                <button
                  className={styles.btnWarning}
                  onClick={() => showToastMsg('Alert message has been sent!', 'alert')}>
                  Send Alert
                </button>
                <button
                  className={styles.btnConfirm}
                  onClick={() => showToastMsg('Confirmation sent!', 'confirm')}>
                  Send Confirmation
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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