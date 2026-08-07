'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTheme } from 'next-themes'
import { createClient } from '@supabase/supabase-js'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'
import RequestBatchModal from '../components/RequestBatchModal'
import styles from './PharmacyRequest.module.css'

/**
 * ─────────────────────────────────────────────────────────────────────────
 * SCHEMA — matches `pharmacy_requests` as used by RequestBatchModal.
 * Table: `pharmacy_requests`
 *   id                uuid
 *   medicine_name     text
 *   dosage            text | null
 *   dosage_form       text | null
 *   category          'drugs' | 'supplies'
 *   requested_qty     int4
 *   unit              text            e.g. "Boxes", "Strips", "Pieces"
 *   status            text            'pending' | 'confirm' | 'alerted' | 'rejected' | 'received'
 *   requested_by      text            pharmacist name
 *   requested_at      timestamptz
 *   notes             text | null     shared "reason" for the whole request
 *   fulfilled_qty     int4 | null
 *   request_batch_id  uuid | null     groups multiple medicines submitted together
 * ─────────────────────────────────────────────────────────────────────────
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
)

type RequestStatus = 'pending' | 'confirm' | 'alerted' | 'rejected' | 'received'

type PharmacyRequestItem = {
  id: string
  medicine_name: string
  dosage: string | null
  dosage_form: string | null
  category: 'drugs' | 'supplies'
  requested_qty: number
  unit: string
  status: RequestStatus
  requested_by: string
  requested_at: string
  notes: string | null
  fulfilled_qty: number | null
  request_batch_id: string | null
}

/** One row in the table — one or more items submitted together. */
type GroupedRequest = {
  key: string
  batchId: string | null
  singleId: string | null // set only when this "group" is really just one legacy, non-batched row
  items: PharmacyRequestItem[]
  requestedBy: string
  requestedAt: string
  notes: string | null
  totalQty: number
  status: RequestStatus
}

const STATUS_TABS: { key: 'all' | RequestStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'confirm', label: 'Confirmed' },
  { key: 'alerted', label: 'Alerted' },
  { key: 'received', label: 'Received' },
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

/** When a request bundles several medicines, each item can technically end
 *  up with a different status (confirmed one, alerted on another, etc).
 *  Surface whichever needs attention first; only show a "settled" status
 *  (received/rejected) once every item in the group agrees. */
function rollupStatus(statuses: RequestStatus[]): RequestStatus {
  if (statuses.every((s) => s === 'received')) return 'received'
  if (statuses.every((s) => s === 'rejected')) return 'rejected'
  if (statuses.some((s) => s === 'pending')) return 'pending'
  if (statuses.some((s) => s === 'alerted')) return 'alerted'
  if (statuses.some((s) => s === 'confirm')) return 'confirm'
  return statuses[0]
}

function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`${styles.badge} ${styles[`badge_${status}`]}`}>{status}</span>
}

export default function PharmacyRequestsRecordsPage() {
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [requests, setRequests] = useState<PharmacyRequestItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'all' | RequestStatus>('all')
  const [search, setSearch] = useState('')
  const [openNotification, setOpenNotification] = useState<{ related_batch_id: string | null; related_request_id: string | null } | null>(null)

  useEffect(() => setMounted(true), [])

  const fetchRequests = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('pharmacy_requests')
      .select('id, medicine_name, dosage, dosage_form, category, requested_qty, unit, status, requested_by, requested_at, notes, fulfilled_qty, request_batch_id')
      .order('requested_at', { ascending: false })

    if (!error && data) setRequests(data as PharmacyRequestItem[])
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

  // Group individual pharmacy_requests rows into one row per submission —
  // items that share a request_batch_id were submitted together and
  // should read as a single request, matching how Pharmacy sees its own
  // history (one entry per "New Request", listing every medicine inside it).
  const grouped = useMemo<GroupedRequest[]>(() => {
    const map = new Map<string, PharmacyRequestItem[]>()
    for (const r of requests) {
      const key = r.request_batch_id ?? r.id
      const arr = map.get(key) ?? []
      arr.push(r)
      map.set(key, arr)
    }

    const rows: GroupedRequest[] = []
    for (const [key, items] of map.entries()) {
      const first = items[0]
      rows.push({
        key,
        batchId: first.request_batch_id,
        singleId: first.request_batch_id ? null : first.id,
        items,
        requestedBy: first.requested_by,
        requestedAt: first.requested_at,
        notes: first.notes,
        totalQty: items.reduce((sum, i) => sum + i.requested_qty, 0),
        status: rollupStatus(items.map((i) => i.status)),
      })
    }

    rows.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
    return rows
  }, [requests])

  const filtered = useMemo(() => {
    return grouped.filter((g) => {
      const matchesTab = activeTab === 'all' || g.status === activeTab
      const q = search.trim().toLowerCase()
      const matchesSearch =
        !q ||
        g.items.some((i) => i.medicine_name.toLowerCase().includes(q)) ||
        g.requestedBy.toLowerCase().includes(q)
      return matchesTab && matchesSearch
    })
  }, [grouped, activeTab, search])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: grouped.length }
    for (const g of grouped) c[g.status] = (c[g.status] || 0) + 1
    return c
  }, [grouped])

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
                    <th>#</th>
                    <th>Date</th>
                    <th>Requested by</th>
                    <th>Items</th>
                    <th>Quantity</th>
                    <th>Status</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((g, idx) => (
                    <tr
                      key={g.key}
                      className={styles.rowClickable}
                      onClick={() =>
                        setOpenNotification({ related_batch_id: g.batchId, related_request_id: g.singleId })
                      }
                    >
                      <td>{idx + 1}</td>
                      <td>{formatPHT(g.requestedAt)}</td>
                      <td>{g.requestedBy}</td>
                      <td className={styles.itemsCell}>
                        {g.items.map((i) => (
                          <div key={i.id}>{i.medicine_name}</div>
                        ))}
                      </td>
                      <td className={styles.itemsCell}>
                        {g.items.map((i) => (
                          <div key={i.id}>{i.requested_qty} {i.unit}</div>
                        ))}
                      </td>
                      <td>
                        <StatusBadge status={g.status} />
                      </td>
                      <td className={styles.notesCell}>{g.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {openNotification && (
        <RequestBatchModal notification={openNotification} onClose={() => setOpenNotification(null)} />
      )}
    </div>
  )
}