'use client'
// app/warehouse/pharmacy-requests/page.tsx
//
// RESTYLED to match the Medicine Releases page's visual language: inline
// styles driven by the shared `T` theme tokens, the same FilterPill /
// TabPill / StatusBadge components, the same card-table look (rounded
// corners, shadow, sticky header, hover rows), and the same header/
// filter-bar/table-footer structure. PharmacyRequest.module.css is no
// longer used on this page — everything below is inline styles, same
// pattern as MedicineStock / Releases.
//
// ADDED: a "Category" pill row (All / Drugs / Supplies) above the status
// tabs, mirroring the "Destination" pill row on the Releases page. A
// grouped request counts toward a category if ANY item inside it matches
// (a batch can mix drugs and supplies), same convention as the existing
// search filter.
//
// UNCHANGED: grouping logic (request_batch_id), status rollup, realtime
// subscription, and the RequestBatchModal click-through — only the
// presentation layer changed.
//
// LAYOUT NOTE: Sidebar/Topbar are no longer rendered on this page — they
// live in the shared app/warehouse/layout.tsx now, so they stay mounted
// across navigation instead of remounting (and blinking) on every tab
// switch. This page renders only its own content.

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useTheme } from 'next-themes'
import { createClient } from '@supabase/supabase-js'
import { Search, X, ClipboardList, Pill } from 'lucide-react'
import RequestBatchModal from '../components/RequestBatchModal'
// Shared theme tokens — same source of truth used by Medicine Inventory
// and Medicine Releases, so all three pages stay visually consistent.
import { T } from '../components/SharedMedicine'

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
type RequestCategory = 'drugs' | 'supplies'

type PharmacyRequestItem = {
  id: string
  medicine_name: string
  dosage: string | null
  dosage_form: string | null
  category: RequestCategory
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

const CATEGORY_PILLS: { key: 'all' | RequestCategory; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'drugs', label: 'Drugs' },
  { key: 'supplies', label: 'Supplies' },
]

const CATEGORY_COLORS: Record<RequestCategory, string> = {
  drugs: T.green,
  supplies: '#0369a1',
}

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

// ============================================================
// Small shared UI pieces — same pattern/markup as Releases' FilterPill /
// TabPill / StatusBadge, so the two pages read as one visual family.
// ============================================================

function FilterPill({
  label, count, active, onClick, dotColor, color, dk,
}: {
  label: string; count?: number; active: boolean; onClick: () => void
  dotColor?: string; color?: string; dk: boolean
}) {
  const c = color || T.green
  return (
    <button onClick={onClick} style={{
      padding: '5px 12px 5px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700,
      cursor: 'pointer', transition: 'all 0.15s',
      border: `1.5px solid ${active ? c : (dk ? T.borderDk : T.border)}`,
      background: active ? `${c}14` : 'transparent',
      color: active ? c : (dk ? T.text2Dk : T.text2),
      display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap',
      fontFamily: 'Nunito, sans-serif',
    }}>
      {dotColor && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />}
      {label}
      {typeof count === 'number' && (
        <span style={{
          background: active ? `${c}22` : (dk ? T.borderDk : T.border),
          color: active ? c : (dk ? T.text2Dk : T.text2),
          borderRadius: 20, padding: '1px 7px', fontSize: 10, fontWeight: 700,
        }}>{count}</span>
      )}
    </button>
  )
}

function TabPill({
  active, onClick, label, count, dk, activeColor,
}: {
  active: boolean; onClick: () => void; label: string; count: number; dk: boolean; activeColor?: string
}) {
  const c = activeColor || T.green
  return (
    <button onClick={onClick} style={{
      padding: '5px 16px', borderRadius: 20, fontSize: 12, fontWeight: 700,
      border: 'none', cursor: 'pointer', transition: 'all 0.15s',
      background: active ? c : 'transparent',
      color: active ? '#fff' : (dk ? T.text2Dk : T.text2),
      boxShadow: active ? `0 2px 8px ${c}44` : 'none',
      display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
      fontFamily: 'Nunito, sans-serif',
    }}>
      {label}
      <span style={{
        background: active ? 'rgba(255,255,255,0.25)' : (dk ? T.borderDk : T.border),
        color: active ? '#fff' : (dk ? T.text2Dk : T.text2),
        borderRadius: 20, padding: '1px 8px', fontSize: 10, fontWeight: 700,
      }}>{count}</span>
    </button>
  )
}

const STATUS_BADGE_STYLES: Record<RequestStatus, { bg: string; color: string; border: string }> = {
  pending:  { bg: '#fef9c3', color: '#854d0e', border: '#fde68a' },
  confirm:  { bg: '#dbeafe', color: '#1e40af', border: '#bfdbfe' },
  alerted:  { bg: T.amberLight, color: T.amber, border: T.amberBorder },
  received: { bg: T.greenLight, color: T.greenDark, border: `${T.green}33` },
  rejected: { bg: T.redLight, color: T.red, border: T.redBorder },
}

const STATUS_LABELS: Record<RequestStatus, string> = {
  pending: 'Pending',
  confirm: 'Confirmed',
  alerted: 'Alerted',
  received: 'Received',
  rejected: 'Rejected',
}

function StatusBadge({ status }: { status: RequestStatus }) {
  const s = STATUS_BADGE_STYLES[status]
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 800,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      whiteSpace: 'nowrap', display: 'inline-block',
    }}>{STATUS_LABELS[status]}</span>
  )
}

export default function PharmacyRequestsRecordsPage() {
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const dk = mounted && theme === 'dark'

  const bg = dk ? T.bgDk : T.bg
  const card = dk ? T.surfDk : T.surface
  const card2 = dk ? T.surf2Dk : T.surface2
  const bdr = dk ? T.borderDk : T.border
  const txt = dk ? T.textDk : T.text
  const txt2 = dk ? T.text2Dk : T.text2
  const shadow = dk ? T.shadowDk : T.shadow

  const [requests, setRequests] = useState<PharmacyRequestItem[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | RequestStatus>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | RequestCategory>('all')
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

    // Realtime subscription — new/updated requests from Pharmacy show up
    // live. Unique name per mount so this never collides with a
    // still-subscribed channel from a prior mount (React Strict Mode's
    // dev-only mount→cleanup→remount cycle can otherwise hand back an
    // already-subscribed channel object before its predecessor's async
    // removeChannel() has finished).
    const channel = supabase
      .channel(`pharmacy_requests_records_${Math.random().toString(36).slice(2)}`)
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

  // ── Status tab counts — computed against the category filter, not itself ──
  const statusCounts = useMemo(() => {
    const base = categoryFilter === 'all' ? grouped : grouped.filter((g) => g.items.some((i) => i.category === categoryFilter))
    const counts: Record<string, number> = { all: base.length, pending: 0, confirm: 0, alerted: 0, received: 0, rejected: 0 }
    for (const g of base) counts[g.status] = (counts[g.status] || 0) + 1
    return counts
  }, [grouped, categoryFilter])

  // ── Category pill counts — computed against the status filter, not itself ──
  const categoryCounts = useMemo(() => {
    const base = statusFilter === 'all' ? grouped : grouped.filter((g) => g.status === statusFilter)
    const counts: Record<string, number> = { all: base.length, drugs: 0, supplies: 0 }
    for (const g of base) {
      const cats = new Set(g.items.map((i) => i.category))
      for (const c of cats) counts[c] = (counts[c] || 0) + 1
    }
    return counts
  }, [grouped, statusFilter])

  const filtered = useMemo(() => {
    return grouped.filter((g) => {
      const matchesStatus = statusFilter === 'all' || g.status === statusFilter
      const matchesCategory = categoryFilter === 'all' || g.items.some((i) => i.category === categoryFilter)
      const q = search.trim().toLowerCase()
      const matchesSearch =
        !q ||
        g.items.some((i) => i.medicine_name.toLowerCase().includes(q)) ||
        g.requestedBy.toLowerCase().includes(q)
      return matchesStatus && matchesCategory && matchesSearch
    })
  }, [grouped, statusFilter, categoryFilter, search])

  const thStyle: React.CSSProperties = {
    padding: '12px 12px', textAlign: 'left', fontWeight: 800,
    color: T.green, fontSize: 10, textTransform: 'uppercase',
    letterSpacing: 0.8, whiteSpace: 'nowrap',
    fontFamily: 'Nunito, sans-serif',
    position: 'sticky', top: 0, background: bg, zIndex: 1,
  }

  const emptyStateLabel = search
    ? `No requests found matching "${search}"`
    : statusFilter !== 'all' || categoryFilter !== 'all'
      ? 'No requests match these filters.'
      : 'No requests yet.'

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        * { font-family: Nunito, sans-serif !important; }
      `}</style>

        <main style={{ padding: 24, overflowY: 'auto', background: bg, height: 'calc(100vh - var(--wh-topbar-h, 62px))' }}>

          {/* ── Page header ── */}
          <div style={{ marginBottom: 20 }}>
            <p style={{ color: '#636363', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4, margin: 0 }}>Warehouse</p>
            <h1 style={{ fontSize: 34, fontWeight: 900, color: '#000', margin: 0, lineHeight: 1 }}>PHARMACY REQUESTS</h1>
            <div style={{ fontSize: 13, color: txt2, marginTop: 4, fontWeight: 600 }}></div>
          </div>

          {/* ── Filter bar ── */}
          <div style={{ background: card, borderRadius: T.radius, padding: '16px 20px', marginBottom: 16, boxShadow: shadow, border: `1px solid ${bdr}` }}>

            {/* Category row — secondary chip style, same pattern as Destination filter on Releases */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingBottom: 12, borderBottom: `1px dashed ${bdr}`, marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 2 }}>
                Category
              </span>
              {CATEGORY_PILLS.map(({ key, label }) => (
                <FilterPill
                  key={key}
                  label={label}
                  count={key === 'all' ? categoryCounts.all : categoryCounts[key]}
                  active={categoryFilter === key}
                  onClick={() => setCategoryFilter(key)}
                  dotColor={key !== 'all' ? CATEGORY_COLORS[key as RequestCategory] : undefined}
                  color={key !== 'all' ? CATEGORY_COLORS[key as RequestCategory] : undefined}
                  dk={dk}
                />
              ))}
            </div>

            {/* Status tabs — primary pills, same pattern as Releases' status tabs */}
            <div style={{ display: 'flex', gap: 3, background: bg, borderRadius: 24, padding: 3, border: `1px solid ${bdr}`, marginBottom: 12, width: 'fit-content', flexWrap: 'wrap' }}>
              {STATUS_TABS.map(({ key, label }) => (
                <TabPill
                  key={key}
                  active={statusFilter === key}
                  onClick={() => setStatusFilter(key)}
                  label={label}
                  count={key === 'all' ? statusCounts.all : statusCounts[key]}
                  dk={dk}
                />
              ))}
            </div>

            {/* Search row */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: txt2, display: 'flex' }}>
                  <Search size={14} />
                </span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search medicine or pharmacist..."
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '9px 36px 9px 32px',
                    borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`,
                    fontSize: 12, outline: 'none', color: txt,
                    background: bg, transition: 'border 0.15s',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = T.green)}
                  onBlur={(e) => (e.currentTarget.style.borderColor = bdr)}
                />
                {search && (
                  <button onClick={() => setSearch('')} style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: txt2, display: 'flex', padding: 0,
                  }}><X size={14} /></button>
                )}
              </div>
            </div>
          </div>

          {/* ── Table — one row per submitted batch/request; rows are clickable
                and open RequestBatchModal, same interaction as before, just
                restyled to match Releases' card-table look. ── */}
          <div style={{ background: card, border: `1px solid ${bdr}`, borderRadius: T.radius, overflow: 'hidden', boxShadow: shadow }}>
            <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 360px)', minHeight: 200 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: bg, borderBottom: `2px solid ${bdr}` }}>
                    <th style={{ ...thStyle, width: 40 }}>No.</th>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Requested By</th>
                    <th style={thStyle}>Items</th>
                    <th style={thStyle}>Quantity</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: 48, color: txt2, fontSize: 13 }}>
                      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 32, height: 32, border: `3px solid ${T.green}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        Loading requests...
                      </div>
                    </td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: 56, color: txt2, fontSize: 13 }}>
                      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 10, animation: 'fadeIn 0.2s ease' }}>
                        <div style={{ width: 52, height: 52, borderRadius: '50%', background: T.greenLight, color: T.green, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <ClipboardList size={24} />
                        </div>
                        <div style={{ fontWeight: 700, color: txt }}>{emptyStateLabel}</div>
                        {(search || statusFilter !== 'all' || categoryFilter !== 'all') && (
                          <button
                            onClick={() => { setSearch(''); setStatusFilter('all'); setCategoryFilter('all') }}
                            style={{ marginTop: 2, padding: '6px 16px', borderRadius: 20, border: `1.5px solid ${T.green}`, background: 'transparent', color: T.green, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
                          >Clear filters</button>
                        )}
                      </div>
                    </td></tr>
                  ) : (
                    filtered.map((g, idx) => {
                      const rowBg = idx % 2 === 0 ? card : card2
                      return (
                        <tr
                          key={g.key}
                          onClick={() => setOpenNotification({ related_batch_id: g.batchId, related_request_id: g.singleId })}
                          style={{ background: rowBg, borderBottom: `1px solid ${bdr}`, cursor: 'pointer', transition: 'background 0.1s' }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = T.greenLight }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = rowBg }}
                        >
                          <td style={{ padding: '11px 12px', color: txt2, fontWeight: 700, verticalAlign: 'top' }}>{idx + 1}</td>
                          <td style={{ padding: '11px 12px', color: txt2, fontSize: 11, verticalAlign: 'top', whiteSpace: 'nowrap' }}>{formatPHT(g.requestedAt)}</td>
                          <td style={{ padding: '11px 12px', color: txt, fontSize: 12, fontWeight: 600, verticalAlign: 'top' }}>{g.requestedBy}</td>
                          <td style={{ padding: '11px 12px', verticalAlign: 'top' }}>
                            {g.items.map((i) => (
                              <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '2px 0' }}>
                                <div style={{ width: 22, height: 22, borderRadius: 6, background: T.greenLight, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.green, flexShrink: 0 }}>
                                  <Pill size={11} />
                                </div>
                                <span style={{ fontWeight: 700, color: txt, fontSize: 12 }}>{i.medicine_name}</span>
                              </div>
                            ))}
                          </td>
                          <td style={{ padding: '11px 12px', verticalAlign: 'top' }}>
                            {g.items.map((i) => (
                              <div key={i.id} style={{ color: txt2, fontSize: 11, padding: '2px 0', lineHeight: '22px' }}>{i.requested_qty} {i.unit}</div>
                            ))}
                          </td>
                          <td style={{ padding: '11px 12px', verticalAlign: 'top' }}><StatusBadge status={g.status} /></td>
                          <td style={{ padding: '11px 12px', color: txt2, fontSize: 11, verticalAlign: 'top', maxWidth: 220 }}>{g.notes || '—'}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Table footer */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderTop: `1px solid ${bdr}`, background: bg }}>
              <span style={{ fontSize: 12, color: txt2, fontWeight: 600 }}>
                {filtered.length === 0 ? 'No results' : `${filtered.length} request${filtered.length !== 1 ? 's' : ''}`}
              </span>
            </div>
          </div>

        </main>

      {openNotification && (
        <RequestBatchModal notification={openNotification} onClose={() => setOpenNotification(null)} />
      )}
    </>
  )
}