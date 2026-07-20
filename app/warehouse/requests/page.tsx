'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTheme } from 'next-themes'
import { createClient } from '@supabase/supabase-js'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'
import styles from './PharmacyRequest.module.css'

/**
 * ─────────────────────────────────────────────────────────────────────────
 * SCHEMA ASSUMPTION — adjust here if your actual table/columns differ.
 * Table: `pharmacy_requests`
 *   id               uuid
 *   medicine_name    text
 *   requested_qty    int4
 *   unit             text            e.g. "box", "vial", "tab"
 *   status           text            'pending' | 'approved' | 'rejected' | 'fulfilled'
 *   requested_by     text            pharmacist name
 *   requested_at     timestamptz
 *   notes            text | null
 *   fulfilled_at     timestamptz | null
 * If your table/columns are named differently, only this block + the
 * `PharmacyRequest` type + the `.select()` string need to change.
 * ─────────────────────────────────────────────────────────────────────────
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
)

type RequestStatus = 'pending' | 'approved' | 'rejected' | 'fulfilled'

type PharmacyRequest = {
  id: string
  medicine_name: string
  requested_qty: number
  unit: string
  status: RequestStatus
  requested_by: string
  requested_at: string
  notes: string | null
  fulfilled_at: string | null
}

const STATUS_TABS: { key: 'all' | RequestStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'fulfilled', label: 'Fulfilled' },
  { key: 'rejected', label: 'Rejected' },
]

// PHT (UTC+8) formatting, en-PH locale — matches the rest of SmartRHU.
function formatPHT(dateStr: string) {
  return new Date(dateStr).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`${styles.badge} ${styles[`badge_${status}`]}`}>{status}</span>
}

export default function PharmacyRequestsRecordsPage() {
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [requests, setRequests] = useState<PharmacyRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'all' | RequestStatus>('all')
  const [search, setSearch] = useState('')
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  useEffect(() => setMounted(true), [])

  const fetchRequests = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('pharmacy_requests')
      .select('id, medicine_name, requested_qty, unit, status, requested_by, requested_at, notes, fulfilled_at')
      .order('requested_at', { ascending: false })

    if (!error && data) setRequests(data as PharmacyRequest[])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchRequests()

    // Realtime subscription — new/updated requests from Pharmacy show up live.
    const channel = supabase
      .channel('pharmacy_requests_records')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pharmacy_requests' }, () => {
        fetchRequests()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchRequests])

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      const matchesTab = activeTab === 'all' || r.status === activeTab
      const q = search.trim().toLowerCase()
      const matchesSearch =
        !q ||
        r.medicine_name.toLowerCase().includes(q) ||
        r.requested_by.toLowerCase().includes(q)
      return matchesTab && matchesSearch
    })
  }, [requests, activeTab, search])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: requests.length }
    for (const r of requests) c[r.status] = (c[r.status] || 0) + 1
    return c
  }, [requests])

  const handleAction = async (id: string, next: RequestStatus) => {
    setActioningId(id)
    const patch: Partial<PharmacyRequest> =
      next === 'fulfilled'
        ? { status: next, fulfilled_at: new Date().toISOString() }
        : { status: next }

    const { error } = await supabase.from('pharmacy_requests').update(patch).eq('id', id)

    if (!error) {
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
      setToast(
        next === 'approved'
          ? 'Request approved.'
          : next === 'rejected'
          ? 'Request rejected.'
          : 'Marked as fulfilled.'
      )
      setTimeout(() => setToast(''), 3000)
    }
    setActioningId(null)
  }

  return (
    <div className={`${styles.root} ${mounted && theme === 'dark' ? styles.dark : ''}`}>
      <Sidebar />
      <div className={styles.mainArea}>
        <Topbar />

        <div className={styles.content}>
          <div className={styles.header}>
            <p className={styles.pageEyebrow}>Warehouse</p>
            <h1 className={styles.pageTitle}>PHARMACY REQUESTS</h1>
            <p className={styles.pageSubtitle}>
              Every restock request submitted by Pharmacy, with live status.
            </p>
          </div>

          <div className={styles.toolbar}>
            <div className={styles.tabs}>
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.key}
                  className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                  <span className={styles.tabCount}>{counts[tab.key] ?? 0}</span>
                </button>
              ))}
            </div>

            <input
              className={styles.search}
              placeholder="Search medicine or pharmacist..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className={styles.tableWrap}>
            {loading ? (
              <div className={styles.emptyState}>Loading requests...</div>
            ) : filtered.length === 0 ? (
              <div className={styles.emptyState}>No requests match this view.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th>Qty</th>
                    <th>Requested by</th>
                    <th>Date requested</th>
                    <th>Status</th>
                    <th>Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id}>
                      <td className={styles.medicineCell}>{r.medicine_name}</td>
                      <td>
                        {r.requested_qty} {r.unit}
                      </td>
                      <td>{r.requested_by}</td>
                      <td>{formatPHT(r.requested_at)}</td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td className={styles.notesCell}>{r.notes || '—'}</td>
                      <td>
                        {r.status === 'pending' && (
                          <div className={styles.actions}>
                            <button
                              className={styles.approveBtn}
                              disabled={actioningId === r.id}
                              onClick={() => handleAction(r.id, 'approved')}
                            >
                              Approve
                            </button>
                            <button
                              className={styles.rejectBtn}
                              disabled={actioningId === r.id}
                              onClick={() => handleAction(r.id, 'rejected')}
                            >
                              Reject
                            </button>
                          </div>
                        )}
                        {r.status === 'approved' && (
                          <button
                            className={styles.fulfillBtn}
                            disabled={actioningId === r.id}
                            onClick={() => handleAction(r.id, 'fulfilled')}
                          >
                            Mark fulfilled
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div className={styles.toast}>
          <span style={{ fontSize: 14 }}>✓</span> {toast}
        </div>
      )}
    </div>
  )
}