'use client'
// app/warehouse/pharmacy-requests/page.tsx
//
// NOW COVERS ALL THREE REQUEST SOURCES — Pharmacy, Laboratory, and
// Barangay each have their own table (different shapes; see the SCHEMA
// block below), so this page fetches all three in parallel, normalizes
// each row into a common `UnifiedRequestItem` shape (tagging it with
// `source`), and merges them into one filterable/sortable list. A new
// "Source" pill row (All / Pharmacy / Laboratory / Barangay) sits above
// the existing Category and Status filters.
//
// IMPORTANT — RequestBatchModal: the row click still opens
// RequestBatchModal, now passed a `source` field alongside
// related_batch_id / related_request_id. RequestBatchModal's own code
// was not available while writing this page, so it likely needs a small
// update on its end to pick the right table (pharmacy_requests /
// laboratory_requests / barangay_requests) based on that `source` field
// before querying. Flagged with a TODO below — send over
// RequestBatchModal.tsx and I'll wire that up too.
//
// UNCHANGED from the single-table version: grouping logic
// (request_batch_id), status rollup, card-table look (T theme tokens,
// FilterPill / TabPill / StatusBadge), realtime-driven refetch.

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useTheme } from 'next-themes'
import { createClient } from '@supabase/supabase-js'
import { Search, X, ClipboardList, Pill, Plus } from 'lucide-react'
import RequestBatchModal from '../components/RequestBatchModal'
import ManualRequestModal from '../components/ManualRequestModal'
// Shared theme tokens — same source of truth used by Medicine Inventory
// and Medicine Releases, so all three pages stay visually consistent.
import { T } from '../components/SharedMedicine'

/**
 * ─────────────────────────────────────────────────────────────────────────
 * SCHEMA — three separate tables, different shapes.
 *
 * pharmacy_requests / laboratory_requests (identical shape):
 *   id, medicine_name, dosage, dosage_form, brand_name, category,
 *   requested_qty, unit, status, requested_by, requested_at, notes,
 *   fulfilled_qty, fulfilled_at, request_batch_id, confirmed_at,
 *   status_updated_at, fund_source
 *   (pharmacy_requests additionally has batch_lot_no, expiration_date —
 *   not selected here since laboratory_requests doesn't have them)
 *
 * barangay_requests (different shape — no brand_name/fund_source, has
 * `barangay` instead):
 *   id, barangay, requested_by, category, medicine_name, dosage, unit,
 *   dosage_form, requested_qty, status, requested_at, notes,
 *   request_batch_id, fulfilled_qty
 * ─────────────────────────────────────────────────────────────────────────
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
)

type RequestStatus = 'pending' | 'confirm' | 'alerted' | 'rejected' | 'received'
type RequestCategory = 'drugs' | 'supplies'
type RequestSource = 'pharmacy' | 'laboratory' | 'barangay'

/** Normalized shape every row gets mapped into, regardless of source table. */
type UnifiedRequestItem = {
  id: string
  source: RequestSource
  medicine_name: string
  dosage: string | null
  dosage_form: string | null
  brand_name: string | null
  category: RequestCategory
  requested_qty: number
  unit: string
  status: RequestStatus
  requested_by: string
  requested_at: string
  notes: string | null
  fulfilled_qty: number | null
  fulfilled_at: string | null
  batch_lot_no: string | null
  expiration_date: string | null
  request_batch_id: string | null
  barangay: string | null // only populated for source === 'barangay'
  fund_source: string | null // only populated for pharmacy / laboratory
}

/** One row in the table — one or more items submitted together. */
type GroupedRequest = {
  key: string
  source: RequestSource
  batchId: string | null
  singleId: string | null // set only when this "group" is really just one legacy, non-batched row
  items: UnifiedRequestItem[]
  requestedBy: string
  barangay: string | null
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

const SOURCE_PILLS: { key: 'all' | RequestSource; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pharmacy', label: 'Pharmacy' },
  { key: 'laboratory', label: 'Laboratory' },
  { key: 'barangay', label: 'Barangay' },
]

const SOURCE_COLORS: Record<RequestSource, string> = {
  pharmacy: T.green,
  laboratory: '#7c3aed',
  barangay: '#ea580c',
}

const TABLE_BY_SOURCE: Record<RequestSource, string> = {
  pharmacy: 'pharmacy_requests',
  laboratory: 'laboratory_requests',
  barangay: 'barangay_requests',
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

// Date-only formatter for expiration_date (a plain `date` column, no
// time component — parsed as UTC-midnight so it never shifts a day
// backward/forward when displayed in PHT).
function formatDateOnly(dateStr: string) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-PH', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
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

function SourceBadge({ source }: { source: RequestSource }) {
  const c = SOURCE_COLORS[source]
  const label = SOURCE_PILLS.find((s) => s.key === source)?.label ?? source
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 800,
      background: `${c}14`, color: c, border: `1px solid ${c}33`,
      whiteSpace: 'nowrap', display: 'inline-block',
    }}>{label}</span>
  )
}

// Columns selected from pharmacy_requests / laboratory_requests (identical shape).
const PHARMACY_LAB_COLUMNS =
  'id, medicine_name, dosage, dosage_form, brand_name, category, requested_qty, unit, status, requested_by, requested_at, notes, fulfilled_qty, fulfilled_at, batch_lot_no, expiration_date, request_batch_id, fund_source'

// Columns selected from barangay_requests (different shape).
const BARANGAY_COLUMNS =
  'id, barangay, requested_by, category, medicine_name, dosage, unit, dosage_form, requested_qty, status, requested_at, notes, fulfilled_qty, fulfilled_at, batch_lot_no, expiration_date, request_batch_id'

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

  const [requests, setRequests] = useState<UnifiedRequestItem[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | RequestStatus>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | RequestCategory>('all')
  const [sourceFilter, setSourceFilter] = useState<'all' | RequestSource>('all')
  const [search, setSearch] = useState('')
  const [openNotification, setOpenNotification] = useState<{ source: RequestSource; related_batch_id: string | null; related_request_id: string | null } | null>(null)
  const [showRequestModal, setShowRequestModal] = useState(false)

  useEffect(() => setMounted(true), [])

  const fetchRequests = useCallback(async () => {
    setLoading(true)

    const [pharmacyRes, labRes, barangayRes] = await Promise.all([
      supabase.from('pharmacy_requests').select(PHARMACY_LAB_COLUMNS).order('requested_at', { ascending: false }),
      supabase.from('laboratory_requests').select(PHARMACY_LAB_COLUMNS).order('requested_at', { ascending: false }),
      supabase.from('barangay_requests').select(BARANGAY_COLUMNS).order('requested_at', { ascending: false }),
    ])

    const merged: UnifiedRequestItem[] = []

    if (!pharmacyRes.error && pharmacyRes.data) {
      for (const r of pharmacyRes.data as any[]) {
        merged.push({
          id: r.id, source: 'pharmacy', medicine_name: r.medicine_name, dosage: r.dosage,
          dosage_form: r.dosage_form, brand_name: r.brand_name, category: r.category,
          requested_qty: r.requested_qty, unit: r.unit, status: r.status, requested_by: r.requested_by,
          requested_at: r.requested_at, notes: r.notes, fulfilled_qty: r.fulfilled_qty,
          fulfilled_at: r.fulfilled_at, batch_lot_no: r.batch_lot_no, expiration_date: r.expiration_date,
          request_batch_id: r.request_batch_id, barangay: null, fund_source: r.fund_source,
        })
      }
    }

    if (!labRes.error && labRes.data) {
      for (const r of labRes.data as any[]) {
        merged.push({
          id: r.id, source: 'laboratory', medicine_name: r.medicine_name, dosage: r.dosage,
          dosage_form: r.dosage_form, brand_name: r.brand_name, category: r.category,
          requested_qty: r.requested_qty, unit: r.unit, status: r.status, requested_by: r.requested_by,
          requested_at: r.requested_at, notes: r.notes, fulfilled_qty: r.fulfilled_qty,
          fulfilled_at: r.fulfilled_at, batch_lot_no: r.batch_lot_no, expiration_date: r.expiration_date,
          request_batch_id: r.request_batch_id, barangay: null, fund_source: r.fund_source,
        })
      }
    }

    if (!barangayRes.error && barangayRes.data) {
      for (const r of barangayRes.data as any[]) {
        merged.push({
          id: r.id, source: 'barangay', medicine_name: r.medicine_name, dosage: r.dosage,
          dosage_form: r.dosage_form, brand_name: null, category: r.category,
          requested_qty: r.requested_qty, unit: r.unit, status: r.status, requested_by: r.requested_by,
          requested_at: r.requested_at, notes: r.notes, fulfilled_qty: r.fulfilled_qty,
          fulfilled_at: r.fulfilled_at, batch_lot_no: r.batch_lot_no, expiration_date: r.expiration_date,
          request_batch_id: r.request_batch_id, barangay: r.barangay, fund_source: null,
        })
      }
    }

    setRequests(merged)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchRequests()

    // Realtime subscription — one channel, listening across all three
    // tables. Unique channel name per mount so this never collides with
    // a still-subscribed channel from a prior mount (React Strict
    // Mode's dev-only mount→cleanup→remount cycle can otherwise hand
    // back an already-subscribed channel object before its
    // predecessor's async removeChannel() has finished).
    const channel = supabase
      .channel(`combined_requests_records_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pharmacy_requests' }, () => fetchRequests())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'laboratory_requests' }, () => fetchRequests())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'barangay_requests' }, () => fetchRequests())
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchRequests])

  // Group individual rows into one row per submission — items that
  // share a request_batch_id (within the same source table) were
  // submitted together and should read as a single request. Keyed by
  // `${source}:${batchId ?? id}` so a batch id collision across
  // different tables (astronomically unlikely with uuids, but still)
  // can never merge two unrelated requests into one row.
  const grouped = useMemo<GroupedRequest[]>(() => {
    const map = new Map<string, UnifiedRequestItem[]>()
    for (const r of requests) {
      const key = `${r.source}:${r.request_batch_id ?? r.id}`
      const arr = map.get(key) ?? []
      arr.push(r)
      map.set(key, arr)
    }

    const rows: GroupedRequest[] = []
    for (const [key, items] of map.entries()) {
      const first = items[0]
      rows.push({
        key,
        source: first.source,
        batchId: first.request_batch_id,
        singleId: first.request_batch_id ? null : first.id,
        items,
        requestedBy: first.requested_by,
        barangay: first.barangay,
        requestedAt: first.requested_at,
        notes: first.notes,
        totalQty: items.reduce((sum, i) => sum + i.requested_qty, 0),
        status: rollupStatus(items.map((i) => i.status)),
      })
    }

    rows.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
    return rows
  }, [requests])

  // ── Status tab counts — computed against the category + source filters, not itself ──
  const statusCounts = useMemo(() => {
    const base = grouped.filter(
      (g) =>
        (categoryFilter === 'all' || g.items.some((i) => i.category === categoryFilter)) &&
        (sourceFilter === 'all' || g.source === sourceFilter)
    )
    const counts: Record<string, number> = { all: base.length, pending: 0, confirm: 0, alerted: 0, received: 0, rejected: 0 }
    for (const g of base) counts[g.status] = (counts[g.status] || 0) + 1
    return counts
  }, [grouped, categoryFilter, sourceFilter])

  // ── Category pill counts — computed against the status + source filters, not itself ──
  const categoryCounts = useMemo(() => {
    const base = grouped.filter(
      (g) =>
        (statusFilter === 'all' || g.status === statusFilter) &&
        (sourceFilter === 'all' || g.source === sourceFilter)
    )
    const counts: Record<string, number> = { all: base.length, drugs: 0, supplies: 0 }
    for (const g of base) {
      const cats = new Set(g.items.map((i) => i.category))
      for (const c of cats) counts[c] = (counts[c] || 0) + 1
    }
    return counts
  }, [grouped, statusFilter, sourceFilter])

  // ── Source pill counts — computed against the status + category filters, not itself ──
  const sourceCounts = useMemo(() => {
    const base = grouped.filter(
      (g) =>
        (statusFilter === 'all' || g.status === statusFilter) &&
        (categoryFilter === 'all' || g.items.some((i) => i.category === categoryFilter))
    )
    const counts: Record<string, number> = { all: base.length, pharmacy: 0, laboratory: 0, barangay: 0 }
    for (const g of base) counts[g.source] = (counts[g.source] || 0) + 1
    return counts
  }, [grouped, statusFilter, categoryFilter])

  const filtered = useMemo(() => {
    return grouped.filter((g) => {
      const matchesStatus = statusFilter === 'all' || g.status === statusFilter
      const matchesCategory = categoryFilter === 'all' || g.items.some((i) => i.category === categoryFilter)
      const matchesSource = sourceFilter === 'all' || g.source === sourceFilter
      const q = search.trim().toLowerCase()
      const matchesSearch =
        !q ||
        g.items.some((i) => i.medicine_name.toLowerCase().includes(q)) ||
        g.requestedBy.toLowerCase().includes(q) ||
        (g.barangay ?? '').toLowerCase().includes(q)
      return matchesStatus && matchesCategory && matchesSource && matchesSearch
    })
  }, [grouped, statusFilter, categoryFilter, sourceFilter, search])

  const thStyle: React.CSSProperties = {
    padding: '12px 12px', textAlign: 'left', fontWeight: 800,
    color: T.green, fontSize: 10, textTransform: 'uppercase',
    letterSpacing: 0.8, whiteSpace: 'nowrap',
    fontFamily: 'Nunito, sans-serif',
    position: 'sticky', top: 0, background: bg, zIndex: 1,
  }

  const hasActiveFilters = search || statusFilter !== 'all' || categoryFilter !== 'all' || sourceFilter !== 'all'

  const emptyStateLabel = search
    ? `No requests found matching "${search}"`
    : hasActiveFilters
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
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
            <div>
              <p style={{ color: '#636363', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4, margin: 0 }}>Warehouse</p>
              <h1 style={{ fontSize: 34, fontWeight: 900, color: '#000', margin: 0, lineHeight: 1 }}>REQUESTS</h1>
              <div style={{ fontSize: 13, color: txt2, marginTop: 4, fontWeight: 600 }}></div>
            </div>

            <button
              onClick={() => setShowRequestModal(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px',
                borderRadius: 20, border: 'none', background: T.green, color: '#fff',
                fontSize: 13, fontWeight: 800, cursor: 'pointer', boxShadow: `0 2px 8px ${T.green}44`,
                whiteSpace: 'nowrap',
              }}
            >
              <Plus size={16} /> Request Medicine
            </button>
          </div>

          {/* ── Filter bar ── */}
          <div style={{ background: card, borderRadius: T.radius, padding: '16px 20px', marginBottom: 16, boxShadow: shadow, border: `1px solid ${bdr}` }}>

            {/* Source row — Pharmacy / Laboratory / Barangay */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingBottom: 12, borderBottom: `1px dashed ${bdr}`, marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 2 }}>
                Source
              </span>
              {SOURCE_PILLS.map(({ key, label }) => (
                <FilterPill
                  key={key}
                  label={label}
                  count={key === 'all' ? sourceCounts.all : sourceCounts[key]}
                  active={sourceFilter === key}
                  onClick={() => setSourceFilter(key)}
                  dotColor={key !== 'all' ? SOURCE_COLORS[key as RequestSource] : undefined}
                  color={key !== 'all' ? SOURCE_COLORS[key as RequestSource] : undefined}
                  dk={dk}
                />
              ))}
            </div>

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
                  placeholder="Search medicine, requester, or barangay..."
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
                now source-aware. ── */}
          <div style={{ background: card, border: `1px solid ${bdr}`, borderRadius: T.radius, overflow: 'hidden', boxShadow: shadow }}>
            <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 360px)', minHeight: 200 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: bg, borderBottom: `2px solid ${bdr}` }}>
                    <th style={{ ...thStyle, width: 40 }}>No.</th>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Source</th>
                    <th style={thStyle}>Requested By</th>
                    <th style={thStyle}>Items</th>
                    <th style={thStyle}>Quantity</th>
                    <th style={thStyle}>Batch / Expiry</th>
                    <th style={thStyle}>Fulfilled</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={10} style={{ textAlign: 'center', padding: 48, color: txt2, fontSize: 13 }}>
                      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 32, height: 32, border: `3px solid ${T.green}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        Loading requests...
                      </div>
                    </td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={10} style={{ textAlign: 'center', padding: 56, color: txt2, fontSize: 13 }}>
                      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 10, animation: 'fadeIn 0.2s ease' }}>
                        <div style={{ width: 52, height: 52, borderRadius: '50%', background: T.greenLight, color: T.green, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <ClipboardList size={24} />
                        </div>
                        <div style={{ fontWeight: 700, color: txt }}>{emptyStateLabel}</div>
                        {hasActiveFilters && (
                          <button
                            onClick={() => { setSearch(''); setStatusFilter('all'); setCategoryFilter('all'); setSourceFilter('all') }}
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
                          onClick={() => setOpenNotification({ source: g.source, related_batch_id: g.batchId, related_request_id: g.singleId })}
                          style={{ background: rowBg, borderBottom: `1px solid ${bdr}`, cursor: 'pointer', transition: 'background 0.1s' }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = T.greenLight }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = rowBg }}
                        >
                          <td style={{ padding: '11px 12px', color: txt2, fontWeight: 700, verticalAlign: 'top' }}>{idx + 1}</td>
                          <td style={{ padding: '11px 12px', color: txt2, fontSize: 11, verticalAlign: 'top', whiteSpace: 'nowrap' }}>{formatPHT(g.requestedAt)}</td>
                          <td style={{ padding: '11px 12px', verticalAlign: 'top' }}><SourceBadge source={g.source} /></td>
                          <td style={{ padding: '11px 12px', color: txt, fontSize: 12, fontWeight: 600, verticalAlign: 'top' }}>
                            {g.requestedBy}
                            {g.barangay && (
                              <div style={{ color: txt2, fontSize: 10, fontWeight: 700, marginTop: 2 }}>Brgy. {g.barangay}</div>
                            )}
                          </td>
                          <td style={{ padding: '11px 12px', verticalAlign: 'top' }}>
                            {g.items.map((i) => (
                              <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '2px 0' }}>
                                <div style={{ width: 22, height: 22, borderRadius: 6, background: T.greenLight, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.green, flexShrink: 0 }}>
                                  <Pill size={11} />
                                </div>
                                <span style={{ fontWeight: 700, color: txt, fontSize: 12 }}>
                                  {i.medicine_name}{i.brand_name ? ` (${i.brand_name})` : ''}
                                </span>
                              </div>
                            ))}
                          </td>
                          <td style={{ padding: '11px 12px', verticalAlign: 'top' }}>
                            {g.items.map((i) => (
                              <div key={i.id} style={{ color: txt2, fontSize: 11, padding: '2px 0', lineHeight: '22px' }}>{i.requested_qty} {i.unit}</div>
                            ))}
                          </td>
                          <td style={{ padding: '11px 12px', verticalAlign: 'top' }}>
                            {g.items.map((i) => (
                              <div key={i.id} style={{ padding: '2px 0', lineHeight: '22px' }}>
                                {i.batch_lot_no ? (
                                  <>
                                    <span style={{ color: txt, fontSize: 11, fontWeight: 700 }}>{i.batch_lot_no}</span>
                                    {i.expiration_date && (
                                      <div style={{ color: txt2, fontSize: 10 }}>Exp. {formatDateOnly(i.expiration_date)}</div>
                                    )}
                                  </>
                                ) : (
                                  <span style={{ color: txt2, fontSize: 11 }}>—</span>
                                )}
                              </div>
                            ))}
                          </td>
                          <td style={{ padding: '11px 12px', verticalAlign: 'top' }}>
                            {g.items.map((i) => (
                              <div key={i.id} style={{ padding: '2px 0', lineHeight: '22px' }}>
                                {i.fulfilled_qty !== null ? (
                                  <>
                                    <span style={{
                                      fontSize: 11, fontWeight: 700,
                                      color: i.fulfilled_qty >= i.requested_qty ? T.greenDark : T.amber,
                                    }}>
                                      {i.fulfilled_qty}/{i.requested_qty} {i.unit}
                                    </span>
                                    {i.fulfilled_at && (
                                      <div style={{ color: txt2, fontSize: 10 }}>{formatPHT(i.fulfilled_at)}</div>
                                    )}
                                  </>
                                ) : (
                                  <span style={{ color: txt2, fontSize: 11 }}>—</span>
                                )}
                              </div>
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
        // TODO: RequestBatchModal needs to accept `source` (pharmacy |
        // laboratory | barangay) and query TABLE_BY_SOURCE[source]
        // instead of always querying pharmacy_requests. Send over its
        // current code and I'll wire that up.
        <RequestBatchModal notification={openNotification} onClose={() => setOpenNotification(null)} />
      )}

      {showRequestModal && (
        <ManualRequestModal onClose={() => setShowRequestModal(false)} />
      )}
    </>
  )
}