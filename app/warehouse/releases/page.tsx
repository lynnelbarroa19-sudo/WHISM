'use client'
// app/warehouse/releases/page.tsx
//
// Restyled to match the Medicine Inventory page's visual language:
// inline styles driven by the shared `T` theme tokens, StatCard /
// FilterBtn-style pills, dark-mode support via next-themes, and the
// same table/header/filter-bar look. No more release.module.css —
// everything below is inline styles, same pattern as MedicineStock.
//
// UPDATED: "New Release" now opens DispenseMedicineModal (the same
// modal used elsewhere for dispensing medicine) instead of a custom
// destination/medicine picker built locally on this page. That local
// NewReleaseModal (and everything it alone depended on — BARANGAYS,
// DESTINATION_TYPES, PENDING_DEST_ID, getMedicinesWithBatches,
// resolveDestination, createRelease, the `destinations`/`medicinesPool`
// state, and the duplicate BatchInfo/MedicineOption/BatchOptionRow
// types) has been removed since DispenseMedicineModal is fully
// self-contained and fetches/handles all of that on its own.
//
// NOTE: Also run releases_stock_trigger.sql on Supabase — it adds the
// auto release_number generator and the stock auto-decrement trigger
// that this page depends on.
//
// NOTE 2: Also run confirm_release_receipt.sql on Supabase. Confirming
// receipt calls the confirm_release_receipt(...) RPC instead of a
// plain UPDATE — it's what actually deducts medicine_batches (boxes /
// loose_pieces) for every batch reserved under that release, atomically
// and with row locks so two confirms can't over-draw the same batch.
// Without running that SQL file, "Confirm Receipt" will fail with a
// "function confirm_release_receipt does not exist" error.
//
// CHANGED: "Confirm Receipt" no longer takes an ID photo upload. It
// uses a mouse/finger-drawn digital signature (SignaturePad) as proof
// of receipt. The signature PNG is stored in the existing
// id_picture_url column on `releases` (repurposed — the column name is
// unchanged in the DB, but it now holds a signature image instead of a
// photographed ID), and confirmation_method is set to
// 'digital_signature' to match.
//
// REMOVED: The separate "Approve Release" step is gone. A release no
// longer needs a warehouse-staff signature before it can be claimed —
// the ONLY signature captured anywhere in this flow is the claimant's
// own signature, taken once at "Confirm Receipt". New releases are
// created directly as status: 'pending' and go straight to "Received"
// once the claimant signs.
//
// REMOVED: The "released" / "In Transit" stage and its stat card/tab
// are gone — a release is simply pending (awaiting the claimant) or
// received (claimant signed, stock deducted).
//
// CHANGED (multi-medicine releases): "New Release" creates ONE
// release header with as many medicines/batches as needed attached to
// it as release_items, instead of one brand-new release per medicine
// (this is handled inside DispenseMedicineModal now). This means a
// single pickup trip to one destination — even with several different
// medicines — only ever needs ONE Confirm Receipt / ONE signature,
// since confirm_release_receipt() already deducts every release_item
// under that one release_id in a single call. The table below groups
// rows by release_id: Destination / Received By / Signature / Status /
// Date Released / Date Received / Actions are shown once per release
// (spanning all its medicine rows); Medicine / Batch No. / Expiration /
// Qty stay one row per medicine.
//
// REMOVED: The "Total Releases / Pending / Received" stat cards row at
// the top of the page has been removed per request. The status tabs in
// the filter bar (All / Pending / Received / Rejected / Cancelled)
// already show equivalent counts, so nothing is lost — this just drops
// the redundant summary strip above the table. `releaseCountByStatus`
// and the `StatCard` component were removed since nothing else used
// them; the `Layers` / `Clock3` / `PackageCheck` icon imports were
// dropped for the same reason.

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import {
  Plus, Search, Download, CheckCircle2, XCircle, PackageMinus, X,
  Truck, Pill, ImageOff, Eraser, Printer,
} from 'lucide-react'
// Adjust this import path to match your actual Supabase client location.
import { supabase } from '@/lib/supabase'
// Layout pieces — these keep the sidebar/topbar visible on this page.
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'
// Shared theme tokens — same source of truth used by the Medicine
// Inventory page, so both pages stay visually consistent.
import { T } from '../components/SharedMedicine'
// The "New Release" flow now just reuses this modal (same one used to
// dispense medicine elsewhere in the app) instead of a bespoke local
// picker. ADJUST THIS PATH to wherever DispenseMedicineModal actually
// lives in your project (e.g. '../components/DispenseMedicineModal').
import DispenseMedicineModal from '../components/DispenseMedicineModal'

// ============================================================
// Types (mirrors your Supabase schema)
// ============================================================

// 'approved' and 'released' remain in the type only so old rows created
// before this change still type-check and render (their badge/status
// text still works) — nothing in this page sets either value anymore.
type ReleaseStatus = 'pending' | 'approved' | 'released' | 'received' | 'rejected' | 'cancelled'
type ConfirmationMethod = 'digital_signature' | 'manual_signature'
type DestinationType = 'Barangay' | 'Pharmacy' | 'Laboratory' | 'Office'

// One row in the flat query result = one medicine/batch line item within
// a release. Several of these can share the same release_id — see the
// grouping logic further down, which is what lets one release cover
// several medicines under a single signature.
interface ReleaseRecord {
  release_item_id: string
  release_id: string
  quantity: number
  batch_id: string
  batch_number: string | null
  expiration_date: string | null
  medicine_id: string
  generic_name: string
  brand_name: string | null
  unit: string | null
  release_number: string
  status: ReleaseStatus
  date_released: string
  destination_id: string
  destination_name: string
  destination_type: DestinationType
  received_by_name: string | null
  received_by_position: string | null
  received_at: string | null
  confirmation_method: ConfirmationMethod | null
  remarks: string | null
  id_picture_url: string | null
  approved_by_name: string | null
  approved_by_position: string | null
  approval_id_picture_url: string | null
  digital_signature: string | null
}

// release_id-level grouping of ReleaseRecord rows — this is what the
// table actually renders. Everything here is shared across every
// medicine in the release (one destination, one claimant, one
// signature, one status), while `items` holds the per-medicine lines.
interface ReleaseGroup {
  release_id: string
  release_number: string
  status: ReleaseStatus
  date_released: string
  destination_name: string
  destination_type: DestinationType
  received_by_name: string | null
  received_by_position: string | null
  received_at: string | null
  id_picture_url: string | null
  remarks: string | null
  items: ReleaseRecord[]
}

// ============================================================
// FEFO / expiry helpers
// ============================================================

type ExpiryStatus = 'expired' | 'expiring_soon' | 'ok' | 'unknown'

function getExpiryStatus(expiration_date: string | null): ExpiryStatus {
  if (!expiration_date) return 'unknown'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const exp = new Date(expiration_date)
  const daysLeft = Math.floor((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (daysLeft < 0) return 'expired'
  if (daysLeft <= 30) return 'expiring_soon'
  return 'ok'
}

// ============================================================
// Supabase queries
// ============================================================

async function getReleaseRecords(): Promise<ReleaseRecord[]> {
  const { data, error } = await supabase
    .from('release_items')
    .select(`
      release_item_id,
      quantity,
      batch_id,
      medicine_batches (
        batch_number,
        expiration_date,
        medicine_id,
        medicines ( medicine_id, generic_name, brand_name, unit )
      ),
      releases (
        release_id,
        release_number,
        status,
        date_released,
        destination_id,
        received_by_name,
        received_by_position,
        received_at,
        confirmation_method,
        remarks,
        id_picture_url,
        approved_by_name,
        approved_by_position,
        approval_id_picture_url,
        digital_signature,
        destinations ( destination_id, destination_name, destination_type )
      )
    `)
    .order('created_at', { ascending: false })

  if (error) throw error
  if (!data) return []

  return (data as any[]).map((row) => {
    const batch = row.medicine_batches
    const med = batch?.medicines
    const rel = row.releases
    const dest = rel?.destinations

    return {
      release_item_id: row.release_item_id,
      release_id: rel?.release_id,
      quantity: row.quantity,
      batch_id: row.batch_id,
      batch_number: batch?.batch_number ?? null,
      expiration_date: batch?.expiration_date ?? null,
      medicine_id: med?.medicine_id ?? '',
      generic_name: med?.generic_name ?? 'Unknown medicine',
      brand_name: med?.brand_name ?? null,
      unit: med?.unit ?? null,
      release_number: rel?.release_number ?? '',
      status: rel?.status ?? 'pending',
      date_released: rel?.date_released,
      destination_id: dest?.destination_id ?? '',
      destination_name: dest?.destination_name ?? 'Unknown destination',
      destination_type: dest?.destination_type ?? 'Office',
      received_by_name: rel?.received_by_name ?? null,
      received_by_position: rel?.received_by_position ?? null,
      received_at: rel?.received_at ?? null,
      confirmation_method: rel?.confirmation_method ?? null,
      remarks: rel?.remarks ?? null,
      id_picture_url: rel?.id_picture_url ?? null,
      approved_by_name: rel?.approved_by_name ?? null,
      approved_by_position: rel?.approved_by_position ?? null,
      approval_id_picture_url: rel?.approval_id_picture_url ?? null,
      digital_signature: rel?.digital_signature ?? null,
    } as ReleaseRecord
  })
}

// Uploads a photo (ID picture or signature photo) to Supabase Storage and
// returns its public URL. Bucket must exist and be public (or served via
// signed URL if you'd rather keep it private).
async function uploadReleaseImage(file: File, releaseId: string, kind: 'id' | 'signature'): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg'
  const path = `${releaseId}/${kind}-${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('release-confirmations')
    .upload(path, file, { upsert: true, cacheControl: '3600' })

  if (uploadError) throw uploadError

  const { data } = supabase.storage.from('release-confirmations').getPublicUrl(path)
  return data.publicUrl
}

// Confirms receipt AND deducts stock, both atomically, via the
// confirm_release_receipt Postgres function (see
// confirm_release_receipt.sql). It loops through EVERY release_item
// under this one release_id — so calling it once here, after the
// claimant signs a single time, correctly deducts every medicine in a
// multi-medicine release. This intentionally does NOT do a plain
// `.from('releases').update(...)` here:
//   - total_quantity on medicine_batches is a GENERATED column, so the
//     deduction has to happen against boxes/loose_pieces — that math
//     (and the reorder_level → status recompute) lives in the RPC.
//   - Doing "check stock, then update" as separate client-side calls
//     would race if two releases confirm against the same batch at
//     once; the RPC locks each batch row for the whole confirm, so
//     concurrent confirms serialize instead of double-spending stock.
async function markAsReceived(
  release_id: string,
  received_by_name: string,
  received_by_position: string,
  id_picture_url: string | null,
  confirmation_method: ConfirmationMethod = 'digital_signature'
) {
  const { error } = await supabase.rpc('confirm_release_receipt', {
    p_release_id: release_id,
    p_received_by_name: received_by_name,
    p_received_by_position: received_by_position,
    p_id_picture_url: id_picture_url,
    p_confirmation_method: confirmation_method,
  })
  if (error) throw error
}

async function cancelRelease(release_id: string) {
  const { error } = await supabase
    .from('releases')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('release_id', release_id)
  if (error) throw error
}

// ============================================================
// Small shared UI pieces — mirrors MedicineStock's FilterBtn / StatCard
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

const STATUS_BADGE_STYLES: Record<ReleaseStatus, { bg: string; color: string; border: string }> = {
  pending:   { bg: '#fef9c3', color: '#854d0e', border: '#fde68a' },
  approved:  { bg: '#dbeafe', color: '#1e40af', border: '#bfdbfe' },
  released:  { bg: '#e0e7ff', color: '#3730a3', border: '#c7d2fe' },
  received:  { bg: T.greenLight, color: T.greenDark, border: `${T.green}33` },
  rejected:  { bg: T.redLight, color: T.red, border: T.redBorder },
  cancelled: { bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' },
}

function StatusBadge({ status }: { status: ReleaseStatus }) {
  const s = STATUS_BADGE_STYLES[status]
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 800,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      whiteSpace: 'nowrap', display: 'inline-block', textTransform: 'capitalize',
    }}>{status}</span>
  )
}

const DEST_TYPE_COLORS: Record<DestinationType, string> = {
  Barangay: T.green,
  Pharmacy: '#0369a1',
  Laboratory: '#a21caf',
  Office: '#b45309',
}

// ============================================================
// Signature pad — lets the claimant sign with a mouse/touch instead
// of uploading a photo. Exposes an imperative handle (via forwardRef)
// so the parent modal can pull out a PNG blob, check whether anything
// was drawn, and clear the pad without prop-drilling canvas state.
// ============================================================

interface SignaturePadHandle {
  clear: () => void
  isEmpty: () => boolean
  toBlob: () => Promise<Blob | null>
}

const SignaturePad = React.forwardRef<
  SignaturePadHandle,
  { onChange: (hasSignature: boolean) => void; dk: boolean; height?: number }
>(function SignaturePad({ onChange, dk, height = 160 }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const hasDrawnRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)

  const bdr = dk ? T.borderDk : T.border
  const bg = dk ? T.bgDk : T.bg
  const strokeColor = dk ? '#ffffff' : '#111827'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = rect.width * ratio
      canvas.height = height * ratio
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.scale(ratio, ratio)
        ctx.lineWidth = 2.2
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.strokeStyle = strokeColor
      }
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      const t = e.touches[0]
      return { x: t.clientX - rect.left, y: t.clientY - rect.top }
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top }
  }

  const start = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    drawingRef.current = true
    lastPointRef.current = getPos(e)
  }

  const move = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawingRef.current) return
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const pos = getPos(e)
    const last = lastPointRef.current
    if (last) {
      ctx.beginPath()
      ctx.moveTo(last.x, last.y)
      ctx.lineTo(pos.x, pos.y)
      ctx.stroke()
    }
    lastPointRef.current = pos
    if (!hasDrawnRef.current) {
      hasDrawnRef.current = true
      onChange(true)
    }
  }

  const end = () => {
    drawingRef.current = false
    lastPointRef.current = null
  }

  const clear = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    hasDrawnRef.current = false
    onChange(false)
  }

  React.useImperativeHandle(ref, () => ({
    clear,
    isEmpty: () => !hasDrawnRef.current,
    toBlob: () =>
      new Promise((resolve) => {
        const canvas = canvasRef.current
        if (!canvas) return resolve(null)
        canvas.toBlob((b) => resolve(b), 'image/png')
      }),
  }))

  return (
    <div>
      <div
        style={{
          border: `1.5px dashed ${bdr}`, borderRadius: T.radiusSm, background: bg,
          touchAction: 'none', cursor: 'crosshair', overflow: 'hidden',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height, display: 'block' }}
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
        />
      </div>
      <button
        type="button"
        onClick={clear}
        style={{
          marginTop: 6, fontSize: 11, color: dk ? T.text2Dk : T.text2, background: 'none',
          border: 'none', cursor: 'pointer', fontWeight: 700, padding: 0,
          display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        <Eraser size={12} /> Clear signature
      </button>
    </div>
  )
})

// ============================================================
// Main page
// ============================================================

// Group-level sort keys only — Medicine / Batch / Expiration / Qty are
// per-medicine-line now, not per-release, so they aren't meaningfully
// sortable at the release-group level the table renders.
type SortKey = 'date_released' | 'received_at' | 'destination_name' | 'status'

// No "Approved" or "Released" tabs — there's no approval/dispatch stage
// in this workflow anymore. Legacy rows with those statuses still show
// up under "All" and remain fully filterable/searchable; they just
// don't get a dedicated tab.
const STATUS_TABS: { key: ReleaseStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'received', label: 'Received' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'cancelled', label: 'Cancelled' },
]

const DEST_TYPE_PILLS: { key: DestinationType | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'Barangay', label: 'Barangay' },
  { key: 'Pharmacy', label: 'Pharmacy' },
  { key: 'Laboratory', label: 'Laboratory' },
  { key: 'Office', label: 'Office' },
]

export default function ReleasesPage() {
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

  const [records, setRecords] = useState<ReleaseRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ReleaseStatus | 'all'>('all')
  const [destTypeFilter, setDestTypeFilter] = useState<DestinationType | 'all'>('all')

  const [sortKey, setSortKey] = useState<SortKey>('date_released')
  const [sortAsc, setSortAsc] = useState(false)

  // Confirm Receipt now targets a whole release GROUP, not a single
  // medicine row — one signature covers every medicine under it.
  const [receiveTarget, setReceiveTarget] = useState<ReleaseGroup | null>(null)
  const [receiveName, setReceiveName] = useState('')
  const [receivePosition, setReceivePosition] = useState('')
  const [receiveHasSignature, setReceiveHasSignature] = useState(false)
  const [receiveSignaturePadKey, setReceiveSignaturePadKey] = useState(0) // bump to force-remount + clear the pad
  const receiveSignaturePadRef = useRef<SignaturePadHandle | null>(null)
  const [receiveError, setReceiveError] = useState<string | null>(null)
  const [confirmSubmitting, setConfirmSubmitting] = useState(false)

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  // Which release the printable receipt/packing-list modal is showing.
  // Meant to be printed and physically handed to (or kept by) the
  // claimant, so they can check off each medicine/quantity against
  // what's actually handed over before or as they sign.
  const [receiptTarget, setReceiptTarget] = useState<ReleaseGroup | null>(null)
  const handlePrintReceipt = () => window.print()

  useEffect(() => { setMounted(true) }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const r = await getReleaseRecords()
      setRecords(r)
    } catch (err) {
      console.error('Failed to load release records:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  // ── Status tab counts — by release, computed against the destination-type filter, not itself ──
  const statusCounts = useMemo(() => {
    const base = destTypeFilter === 'all' ? records : records.filter((r) => r.destination_type === destTypeFilter)
    const seen = new Map<string, ReleaseStatus>()
    for (const r of base) seen.set(r.release_id, r.status)
    const counts: Record<string, number> = { all: 0, pending: 0, approved: 0, released: 0, received: 0, rejected: 0, cancelled: 0 }
    for (const status of seen.values()) {
      counts.all += 1
      counts[status] = (counts[status] || 0) + 1
    }
    return counts
  }, [records, destTypeFilter])

  // ── Destination-type pill counts — by release, computed against the status filter, not itself ──
  const destTypeCounts = useMemo(() => {
    const base = statusFilter === 'all' ? records : records.filter((r) => r.status === statusFilter)
    const seen = new Map<string, DestinationType>()
    for (const r of base) seen.set(r.release_id, r.destination_type)
    const counts: Record<string, number> = { all: 0, Barangay: 0, Pharmacy: 0, Laboratory: 0, Office: 0 }
    for (const type of seen.values()) {
      counts.all += 1
      counts[type] += 1
    }
    return counts
  }, [records, statusFilter])

  // Filters apply at the item level (search matches medicine/batch too),
  // then rows are grouped by release_id right after — see `groups`.
  const filteredItems = useMemo(() => {
    let rows = [...records]

    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(
        (r) =>
          r.generic_name.toLowerCase().includes(q) ||
          (r.brand_name || '').toLowerCase().includes(q) ||
          r.release_number.toLowerCase().includes(q) ||
          r.destination_name.toLowerCase().includes(q) ||
          (r.received_by_name || '').toLowerCase().includes(q) ||
          (r.batch_number || '').toLowerCase().includes(q)
      )
    }

    if (statusFilter !== 'all') rows = rows.filter((r) => r.status === statusFilter)
    if (destTypeFilter !== 'all') rows = rows.filter((r) => r.destination_type === destTypeFilter)

    return rows
  }, [records, search, statusFilter, destTypeFilter])

  // Groups every filtered item by release_id, then sorts the GROUPS
  // (not individual items) since Destination/Status/Dates are the same
  // for every medicine in a release — sorting only makes sense at that
  // level. This is what the table actually maps over.
  const groups = useMemo(() => {
    const map = new Map<string, ReleaseGroup>()
    for (const r of filteredItems) {
      let g = map.get(r.release_id)
      if (!g) {
        g = {
          release_id: r.release_id,
          release_number: r.release_number,
          status: r.status,
          date_released: r.date_released,
          destination_name: r.destination_name,
          destination_type: r.destination_type,
          received_by_name: r.received_by_name,
          received_by_position: r.received_by_position,
          received_at: r.received_at,
          id_picture_url: r.id_picture_url,
          remarks: r.remarks,
          items: [],
        }
        map.set(r.release_id, g)
      }
      g.items.push(r)
    }
    const arr = Array.from(map.values())
    for (const g of arr) g.items.sort((a, b) => a.generic_name.localeCompare(b.generic_name))
    arr.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'date_released') cmp = new Date(a.date_released).getTime() - new Date(b.date_released).getTime()
      else if (sortKey === 'received_at') {
        if (!a.received_at && !b.received_at) cmp = 0
        else if (!a.received_at) cmp = 1
        else if (!b.received_at) cmp = -1
        else cmp = new Date(a.received_at).getTime() - new Date(b.received_at).getTime()
      }
      else if (sortKey === 'destination_name') cmp = a.destination_name.localeCompare(b.destination_name)
      else cmp = String(a[sortKey]).localeCompare(String(b[sortKey]))
      return sortAsc ? cmp : -cmp
    })
    return arr
  }, [filteredItems, sortKey, sortAsc])

  const totalItemRows = useMemo(() => groups.reduce((sum, g) => sum + g.items.length, 0), [groups])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((a) => !a)
    else { setSortKey(key); setSortAsc(true) }
  }

  // Opens the "Confirm Receipt" modal for a whole release GROUP and
  // resets its local form state (name/position/signature pad) fresh
  // each time. This is now the ONLY signing step in the flow, and it
  // covers every medicine under this one release_id in one go.
  const openReceiveModal = (g: ReleaseGroup) => {
    setReceiveTarget(g)
    setReceiveName(g.received_by_name || '')
    setReceivePosition(g.received_by_position || '')
    setReceiveHasSignature(false)
    setReceiveSignaturePadKey((k) => k + 1)
    setReceiveError(null)
  }

  const closeReceiveModal = () => {
    setReceiveTarget(null)
    setReceiveName('')
    setReceivePosition('')
    setReceiveHasSignature(false)
    setReceiveError(null)
  }

  const handleConfirmReceive = async () => {
    if (!receiveTarget) return
    if (!receiveName || !receivePosition) {
      setReceiveError('Please fill in the claimant\'s name and position.')
      return
    }
    if (!receiveHasSignature || receiveSignaturePadRef.current?.isEmpty()) {
      setReceiveError('Please sign using your mouse or finger before confirming.')
      return
    }

    setReceiveError(null)
    setConfirmSubmitting(true)
    try {
      const sigBlob = await receiveSignaturePadRef.current?.toBlob()
      if (!sigBlob) throw new Error('Could not capture the signature. Please try signing again.')
      const sigFile = new File([sigBlob], 'signature.png', { type: 'image/png' })
      const sigUrl = await uploadReleaseImage(sigFile, receiveTarget.release_id, 'signature')
      // One call, one signature — deducts stock for every medicine
      // under this release_id via the RPC's internal loop.
      await markAsReceived(receiveTarget.release_id, receiveName, receivePosition, sigUrl, 'digital_signature')
      closeReceiveModal()
      loadData()
    } catch (err: any) {
      setReceiveError(err.message || 'Failed to confirm receipt. Please try again.')
    } finally {
      setConfirmSubmitting(false)
    }
  }

  const handleCancel = async (g: ReleaseGroup) => {
    const label = g.items.length > 1 ? `release ${g.release_number} (${g.items.length} medicines)` : `release ${g.release_number}`
    if (!confirm(`Cancel ${label}?`)) return
    try {
      await cancelRelease(g.release_id)
      loadData()
    } catch (err) {
      console.error('Failed to cancel release:', err)
    }
  }

  const exportCsv = () => {
    const headers = ['Release #', 'Medicine', 'Batch #', 'Expiration', 'Quantity', 'Destination', 'Received By', 'Status', 'Date Released', 'Date Received']
    const rows = filteredItems.map((r) => [
      r.release_number,
      r.brand_name ? `${r.generic_name} (${r.brand_name})` : r.generic_name,
      r.batch_number || '',
      r.expiration_date || '',
      r.quantity,
      r.destination_name,
      r.received_by_name || '',
      r.status,
      new Date(r.date_released).toLocaleString(),
      r.received_at ? new Date(r.received_at).toLocaleString() : '',
    ])
    const csv = [headers, ...rows].map((row) => row.map((v) => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `releases_${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const thStyle: React.CSSProperties = {
    padding: '12px 12px', textAlign: 'left', fontWeight: 800,
    color: T.green, fontSize: 10, textTransform: 'uppercase',
    letterSpacing: 0.8, whiteSpace: 'nowrap',
    fontFamily: 'Nunito, sans-serif',
    position: 'sticky', top: 0, background: bg, zIndex: 1, cursor: 'pointer',
  }

  const emptyStateLabel = search
    ? `No releases found matching "${search}"`
    : statusFilter !== 'all' || destTypeFilter !== 'all'
      ? 'No release records match these filters.'
      : 'No release records yet. Create one to get started.'

  const canConfirmReceive = !!receiveName && !!receivePosition && receiveHasSignature && !confirmSubmitting

  return (
    <div style={{ display: 'flex', height: '100vh', background: bg, fontFamily: 'Nunito, sans-serif' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        * { font-family: Nunito, sans-serif !important; }

        /* Print rules — only fire when the browser print dialog is
           triggered while the receipt modal is open. Everything else
           on the page is hidden; #printable-receipt is repositioned to
           fill the printed page on its own. */
        @media print {
          body * { visibility: hidden; }
          #printable-receipt, #printable-receipt * { visibility: visible; }
          #printable-receipt {
            position: absolute; top: 0; left: 0; width: 100%;
            padding: 0.5in; box-sizing: border-box;
          }
          .no-print { display: none !important; }
          .receipt-modal-overlay { position: static !important; background: none !important; padding: 0 !important; }
        }
      `}</style>

      <Sidebar />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar />

        <main style={{ flex: 1, padding: 24, overflowY: 'auto', background: bg }}>

          {/* ── Page header ── */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <p style={{ color: T.mint, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4, margin: 0 }}>Warehouse</p>
              <h1 style={{ fontSize: 34, fontWeight: 900, color: dk ? T.mint : T.green, margin: 0, lineHeight: 1 }}>MEDICINE RELEASES</h1>
              <div style={{ fontSize: 13, color: txt2, marginTop: 4, fontWeight: 600 }}>Records of medicines released to barangays, offices, and other destinations</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={exportCsv}
                style={{
                  height: 42, padding: '0 18px', borderRadius: T.radius, fontSize: 13, fontWeight: 800,
                  border: `1.5px solid ${bdr}`, background: card, color: T.green,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                  boxShadow: shadow, whiteSpace: 'nowrap', transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = T.greenLight)}
                onMouseLeave={(e) => (e.currentTarget.style.background = card)}
              >
                <Download size={14} /> Export CSV
              </button>
              <button
                onClick={() => setShowModal(true)}
                style={{
                  background: T.greenMid, color: '#fff', border: 'none',
                  borderRadius: T.radius, height: 42, padding: '0 26px', boxSizing: 'border-box',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                  fontWeight: 800, fontSize: 14,
                  boxShadow: `0 6px 20px ${T.green}44`, transition: 'all 0.2s', whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)' }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)' }}
              >
                <Plus size={18} /> New Release
              </button>
            </div>
          </div>

          {/* ── Filter bar ── */}
          <div style={{ background: card, borderRadius: T.radius, padding: '16px 20px', marginBottom: 16, boxShadow: shadow, border: `1px solid ${bdr}` }}>

            {/* Destination row — secondary chip style, same pattern as Source filter on Inventory */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingBottom: 12, borderBottom: `1px dashed ${bdr}`, marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 2 }}>
                Destination
              </span>
              {DEST_TYPE_PILLS.map(({ key, label }) => (
                <FilterPill
                  key={key}
                  label={label}
                  count={key === 'all' ? destTypeCounts.all : destTypeCounts[key]}
                  active={destTypeFilter === key}
                  onClick={() => setDestTypeFilter(key)}
                  dotColor={key !== 'all' ? DEST_TYPE_COLORS[key as DestinationType] : undefined}
                  color={key !== 'all' ? DEST_TYPE_COLORS[key as DestinationType] : undefined}
                  dk={dk}
                />
              ))}
            </div>

            {/* Status tabs — primary pills, same pattern as Drugs/Supplies/Archived */}
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
                  placeholder="Search medicine, release #, destination, batch..."
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

          {/* ── Table — grouped by release: Medicine/Batch/Expiration/Qty
                repeat per medicine row, while Destination/Received By/
                Signature/Status/Dates/Actions span the whole group via
                rowSpan, since they're the same for every medicine under
                one release. ── */}
          <div style={{ background: card, border: `1px solid ${bdr}`, borderRadius: T.radius, overflow: 'hidden', boxShadow: shadow }}>
            <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 420px)', minHeight: 200 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: bg, borderBottom: `2px solid ${bdr}` }}>
                    <th style={{ ...thStyle, cursor: 'default', width: 40 }}>No.</th>
                    <th style={{ ...thStyle, cursor: 'default' }}>Medicine</th>
                    <th style={{ ...thStyle, cursor: 'default' }}>Batch No.</th>
                    <th style={{ ...thStyle, cursor: 'default' }}>Expiration (FEFO)</th>
                    <th style={{ ...thStyle, cursor: 'default' }}>Qty</th>
                    <th style={thStyle} onClick={() => toggleSort('destination_name')}>Destination</th>
                    <th style={{ ...thStyle, cursor: 'default' }}>Received By</th>
                    <th style={{ ...thStyle, cursor: 'default' }}>Signature</th>
                    <th style={thStyle} onClick={() => toggleSort('status')}>Status</th>
                    <th style={thStyle} onClick={() => toggleSort('date_released')}>Date Released</th>
                    <th style={thStyle} onClick={() => toggleSort('received_at')}>Date Received</th>
                    <th style={{ ...thStyle, cursor: 'default', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={12} style={{ textAlign: 'center', padding: 48, color: txt2, fontSize: 13 }}>
                      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 32, height: 32, border: `3px solid ${T.green}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        Loading release records...
                      </div>
                    </td></tr>
                  ) : groups.length === 0 ? (
                    <tr><td colSpan={12} style={{ textAlign: 'center', padding: 56, color: txt2, fontSize: 13 }}>
                      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 10, animation: 'fadeIn 0.2s ease' }}>
                        <div style={{ width: 52, height: 52, borderRadius: '50%', background: T.greenLight, color: T.green, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Truck size={24} />
                        </div>
                        <div style={{ fontWeight: 700, color: txt }}>{emptyStateLabel}</div>
                        {(search || statusFilter !== 'all' || destTypeFilter !== 'all') && (
                          <button
                            onClick={() => { setSearch(''); setStatusFilter('all'); setDestTypeFilter('all') }}
                            style={{ marginTop: 2, padding: '6px 16px', borderRadius: 20, border: `1.5px solid ${T.green}`, background: 'transparent', color: T.green, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
                          >Clear filters</button>
                        )}
                      </div>
                    </td></tr>
                  ) : (() => {
                    let runningIndex = 0
                    return groups.map((g, gi) => {
                      const rowBg = gi % 2 === 0 ? card : card2
                      return g.items.map((item, itemIdx) => {
                        runningIndex += 1
                        const expiry = getExpiryStatus(item.expiration_date)
                        const expiryColor = expiry === 'expired' ? T.red : expiry === 'expiring_soon' ? T.amber : txt2
                        const isFirst = itemIdx === 0
                        const rowSpan = g.items.length
                        return (
                          <tr key={item.release_item_id}
                            style={{ background: rowBg, borderBottom: itemIdx === g.items.length - 1 ? `1px solid ${bdr}` : `1px dashed ${bdr}`, transition: 'background 0.1s' }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = T.greenLight }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = rowBg }}
                          >
                            <td style={{ padding: '11px 12px', color: txt2, fontWeight: 700 }}>{runningIndex}</td>
                            <td style={{ padding: '11px 12px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                                <div style={{ width: 32, height: 32, borderRadius: 8, background: T.greenLight, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.green, flexShrink: 0 }}>
                                  <Pill size={15} />
                                </div>
                                <div>
                                  <div style={{ fontWeight: 700, color: txt, fontSize: 12 }}>{item.generic_name}</div>
                                  {item.brand_name && <div style={{ fontSize: 10, color: txt2 }}>{item.brand_name}</div>}
                                </div>
                              </div>
                            </td>
                            <td style={{ padding: '11px 12px', color: txt2, fontSize: 11 }}>{item.batch_number || '—'}</td>
                            <td style={{ padding: '11px 12px', fontSize: 11, color: expiryColor, fontWeight: expiry !== 'ok' && expiry !== 'unknown' ? 700 : 400 }}>
                              {item.expiration_date || 'N/A'}
                              {expiry === 'expired' && <span style={{ fontSize: 9, marginLeft: 5, background: T.redLight, color: T.red, border: `1px solid ${T.redBorder}`, borderRadius: 4, padding: '1px 5px', fontWeight: 800 }}>EXPIRED</span>}
                              {expiry === 'expiring_soon' && <span style={{ fontSize: 9, marginLeft: 5, background: T.amberLight, color: T.amber, border: `1px solid ${T.amberBorder}`, borderRadius: 4, padding: '1px 5px', fontWeight: 800 }}>SOON</span>}
                            </td>
                            <td style={{ padding: '11px 12px', color: txt2, fontSize: 11 }}>{item.quantity} {item.unit || ''}</td>

                            {isFirst && (
                              <td rowSpan={rowSpan} style={{ padding: '11px 12px', verticalAlign: 'top', borderLeft: `1px solid ${bdr}` }}>
                                <div>
                                  <div style={{ fontWeight: 700, color: txt, fontSize: 12 }}>{g.destination_name}</div>
                                  <div style={{ fontSize: 10, color: txt2 }}>{g.destination_type}</div>
                                  {rowSpan > 1 && (
                                    <div style={{ fontSize: 9, color: T.green, fontWeight: 800, marginTop: 4, textTransform: 'uppercase' }}>
                                      {rowSpan} medicines · Release {g.release_number}
                                    </div>
                                  )}
                                </div>
                              </td>
                            )}
                            {isFirst && (
                              <td rowSpan={rowSpan} style={{ padding: '11px 12px', color: txt2, fontSize: 11, verticalAlign: 'top' }}>
                                {g.received_by_name ? (
                                  <div>
                                    <div style={{ color: txt }}>{g.received_by_name}</div>
                                    {g.received_by_position && <div style={{ fontSize: 10, color: txt2 }}>{g.received_by_position}</div>}
                                  </div>
                                ) : '—'}
                              </td>
                            )}
                            {isFirst && (
                              <td rowSpan={rowSpan} style={{ padding: '11px 12px', verticalAlign: 'top' }}>
                                <div style={{ display: 'flex', gap: 5 }}>
                                  {g.id_picture_url ? (
                                    <button
                                      type="button"
                                      onClick={() => setLightboxUrl(g.id_picture_url)}
                                      title="Click to view the claimant's signature larger"
                                      style={{
                                        width: 46, height: 34, borderRadius: 7, padding: 2, cursor: 'pointer',
                                        border: `1.5px solid ${T.green}`, background: '#fff', display: 'flex',
                                        alignItems: 'center', justifyContent: 'center',
                                      }}
                                    >
                                      <img
                                        src={g.id_picture_url}
                                        alt="Claimant signature"
                                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                                      />
                                    </button>
                                  ) : (
                                    <div
                                      title="Awaiting claimant's signature (not yet received)"
                                      style={{ width: 34, height: 34, borderRadius: 7, background: bg, border: `1px dashed ${bdr}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: txt2 }}
                                    >
                                      <ImageOff size={13} />
                                    </div>
                                  )}
                                </div>
                              </td>
                            )}
                            {isFirst && (
                              <td rowSpan={rowSpan} style={{ padding: '11px 12px', verticalAlign: 'top' }}><StatusBadge status={g.status} /></td>
                            )}
                            {isFirst && (
                              <td rowSpan={rowSpan} style={{ padding: '11px 12px', color: txt2, fontSize: 11, verticalAlign: 'top' }}>{new Date(g.date_released).toLocaleDateString()}</td>
                            )}
                            {isFirst && (
                              <td rowSpan={rowSpan} style={{ padding: '11px 12px', color: txt2, fontSize: 11, verticalAlign: 'top' }}>
                                {g.received_at ? (
                                  <div>
                                    <div style={{ color: T.greenDark, fontWeight: 700 }}>{new Date(g.received_at).toLocaleDateString()}</div>
                                    <div style={{ fontSize: 9, color: txt2 }}>{new Date(g.received_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                  </div>
                                ) : (
                                  <span style={{ color: txt2, opacity: 0.6 }}>— not yet received</span>
                                )}
                              </td>
                            )}
                            {isFirst && (
                              <td rowSpan={rowSpan} style={{ padding: '11px 12px', textAlign: 'right', verticalAlign: 'top' }}>
                                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                  {g.status === 'pending' && (
                                    <button
                                      onClick={() => openReceiveModal(g)}
                                      title="Confirm receipt (requires the claimant's mouse/finger signature — covers every medicine in this release)"
                                      style={{ border: `1.5px solid ${bdr}`, background: card, borderRadius: T.radiusSm, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: T.green }}
                                      onMouseEnter={(e) => { e.currentTarget.style.background = T.greenLight; e.currentTarget.style.borderColor = T.green }}
                                      onMouseLeave={(e) => { e.currentTarget.style.background = card; e.currentTarget.style.borderColor = bdr }}
                                    >
                                      <CheckCircle2 size={13} /> Received
                                    </button>
                                  )}
                                  {(g.status === 'pending' || g.status === 'received') && (
                                    <button
                                      onClick={() => setReceiptTarget(g)}
                                      title="Print a packing-list receipt for the claimant to check items against"
                                      style={{ border: `1.5px solid ${bdr}`, background: card, borderRadius: T.radiusSm, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: txt2 }}
                                      onMouseEnter={(e) => { e.currentTarget.style.background = bg; e.currentTarget.style.borderColor = txt2 }}
                                      onMouseLeave={(e) => { e.currentTarget.style.background = card; e.currentTarget.style.borderColor = bdr }}
                                    >
                                      <Printer size={13} /> Print
                                    </button>
                                  )}
                                  {g.status === 'pending' && (
                                    <button
                                      onClick={() => handleCancel(g)}
                                      title="Cancel this release"
                                      style={{ border: `1.5px solid ${bdr}`, background: card, borderRadius: T.radiusSm, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: T.red }}
                                      onMouseEnter={(e) => { e.currentTarget.style.background = T.redLight; e.currentTarget.style.borderColor = T.red }}
                                      onMouseLeave={(e) => { e.currentTarget.style.background = card; e.currentTarget.style.borderColor = bdr }}
                                    >
                                      <XCircle size={13} /> Cancel
                                    </button>
                                  )}
                                </div>
                              </td>
                            )}
                          </tr>
                        )
                      })
                    })
                  })()}
                </tbody>
              </table>
            </div>

            {/* Table footer */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderTop: `1px solid ${bdr}`, background: bg }}>
              <span style={{ fontSize: 12, color: txt2, fontWeight: 600 }}>
                {groups.length === 0 ? 'No results' : `${groups.length} release${groups.length !== 1 ? 's' : ''} · ${totalItemRows} medicine line${totalItemRows !== 1 ? 's' : ''} total`}
              </span>
            </div>
          </div>

          {/* ── New Release — now just DispenseMedicineModal, same modal
              used elsewhere to dispense medicine. It fetches its own
              medicines/destinations, builds its own FEFO allocation, and
              writes the release + release_items itself; on success we
              just close it and refresh the table. ── */}
          {showModal && (
            <DispenseMedicineModal
              onClose={() => setShowModal(false)}
              onSuccess={() => { setShowModal(false); loadData() }}
            />
          )}

          {/* ── Confirm Receipt modal — the ONLY signing step now.
              The claimant (the person picking up the medicine) fills in
              their own details and signs ONCE, covering every medicine
              line under this release_id. ── */}
          {receiveTarget && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: 16 }} onClick={closeReceiveModal}>
              <div style={{ background: card, borderRadius: T.radius, width: '100%', maxWidth: 420, maxHeight: '90vh', overflowY: 'auto', boxShadow: shadow, border: `1px solid ${bdr}` }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: `1px solid ${bdr}`, background: T.greenDark, borderRadius: `${T.radius}px ${T.radius}px 0 0` }}>
                  <h2 style={{ fontSize: 16, margin: 0, color: '#fff', fontWeight: 900 }}>Confirm Receipt</h2>
                  <button onClick={closeReceiveModal} style={{ border: 'none', background: 'rgba(74,222,128,0.15)', cursor: 'pointer', color: T.mint, width: 30, height: 30, borderRadius: T.radiusSm, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={15} /></button>
                </div>
                <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ fontSize: 11, color: txt2, background: bg, border: `1px solid ${bdr}`, borderRadius: T.radiusSm, padding: '8px 10px' }}>
                    Have the person claiming this release fill in their own details and sign below. One signature covers all {receiveTarget.items.length} medicine{receiveTarget.items.length !== 1 ? 's' : ''} in this release.
                  </div>

                  <div style={{ fontSize: 11, color: txt2 }}>
                    <strong style={{ color: txt }}>Release {receiveTarget.release_number}</strong> to {receiveTarget.destination_name}:
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      {receiveTarget.items.map((it) => (
                        <li key={it.release_item_id}>{it.generic_name} — {it.quantity} {it.unit || ''}</li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: txt2, marginBottom: 6, display: 'block' }}>Received By (Name) *</label>
                    <input
                      value={receiveName}
                      onChange={(e) => setReceiveName(e.target.value)}
                      style={{ border: `1.5px solid ${bdr}`, borderRadius: T.radiusSm, padding: '9px 12px', fontSize: 13, color: txt, outline: 'none', width: '100%', background: bg, boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: txt2, marginBottom: 6, display: 'block' }}>Position *</label>
                    <input
                      value={receivePosition}
                      onChange={(e) => setReceivePosition(e.target.value)}
                      style={{ border: `1.5px solid ${bdr}`, borderRadius: T.radiusSm, padding: '9px 12px', fontSize: 13, color: txt, outline: 'none', width: '100%', background: bg, boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: txt2, marginBottom: 6, display: 'block' }}>Claimant's Signature (sign with mouse or finger) *</label>
                    <SignaturePad key={receiveSignaturePadKey} ref={receiveSignaturePadRef} dk={dk} onChange={setReceiveHasSignature} />
                  </div>

                  {receiveError && <div style={{ color: T.red, fontSize: 12, fontWeight: 600 }}>{receiveError}</div>}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 20px', borderTop: `1px solid ${bdr}` }}>
                  <button onClick={closeReceiveModal} style={{ background: card, border: `1.5px solid ${bdr}`, padding: '9px 18px', borderRadius: T.radiusSm, fontSize: 13, fontWeight: 700, cursor: 'pointer', color: txt }}>Cancel</button>
                  <button
                    onClick={handleConfirmReceive}
                    disabled={!canConfirmReceive}
                    style={{
                      background: canConfirmReceive ? T.greenMid : T.green, color: '#fff', border: 'none', padding: '9px 20px',
                      borderRadius: T.radiusSm, fontSize: 13, fontWeight: 800,
                      cursor: canConfirmReceive ? 'pointer' : 'not-allowed',
                      opacity: canConfirmReceive ? 1 : 0.5,
                      display: 'flex', alignItems: 'center', gap: 6, boxShadow: `0 6px 18px ${T.green}44`,
                    }}
                  >
                    <PackageMinus size={14} /> {confirmSubmitting ? 'Uploading...' : 'Confirm'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Signature lightbox — shown on a solid white card, since
              the signature itself is drawn as a dark stroke on a
              transparent background and would be nearly invisible
              floating directly on the dark backdrop. ── */}
          {lightboxUrl && (
            <div
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 4000, padding: 24 }}
              onClick={() => setLightboxUrl(null)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: '#fff', borderRadius: 16, padding: 24, maxWidth: '92vw', maxHeight: '85vh',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: 10,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Claimant's Signature
                </div>
                <img
                  src={lightboxUrl}
                  alt="Claimant signature"
                  style={{ maxWidth: '85vw', maxHeight: '65vh', objectFit: 'contain', display: 'block' }}
                />
              </div>
              <button
                onClick={() => setLightboxUrl(null)}
                style={{ position: 'absolute', top: 24, right: 24, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={20} />
              </button>
            </div>
          )}

          {/* ── Printable Receipt / packing-list modal ──
              Meant to be printed and handed to (or kept by) the
              claimant, so they can check off each medicine/quantity
              against what's actually being handed over. The
              "no-print" class hides everything except the header/
              close/print controls when NOT printing; #printable-receipt
              is what actually survives onto paper, per the @media
              print rules declared in the page-level <style> block. */}
          {receiptTarget && (
            <div
              className="receipt-modal-overlay"
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: 16 }}
              onClick={() => setReceiptTarget(null)}
            >
              <div
                style={{ background: '#fff', borderRadius: T.radius, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: shadow }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: `1px solid ${T.border}`, background: T.greenDark, borderRadius: `${T.radius}px ${T.radius}px 0 0` }}>
                  <h2 style={{ fontSize: 16, margin: 0, color: '#fff', fontWeight: 900 }}>Release Receipt</h2>
                  <button onClick={() => setReceiptTarget(null)} style={{ border: 'none', background: 'rgba(74,222,128,0.15)', cursor: 'pointer', color: T.mint, width: 30, height: 30, borderRadius: T.radiusSm, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={15} /></button>
                </div>

                {/* Plain black-on-white so it reads well on paper
                    regardless of dark mode in the app itself. */}
                <div id="printable-receipt" style={{ padding: 28, color: '#111827', fontFamily: 'Nunito, sans-serif' }}>
                  <div style={{ textAlign: 'center', marginBottom: 18 }}>
                    <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 0.5 }}>SMARTRHU — MEDICINE RELEASE RECEIPT</div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Rural Health Unit, Lopez, Quezon</div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 14, borderTop: '1px solid #d1d5db', borderBottom: '1px solid #d1d5db', padding: '8px 0' }}>
                    <div><strong>Release No.:</strong> {receiptTarget.release_number}</div>
                    <div><strong>Date:</strong> {new Date(receiptTarget.date_released).toLocaleDateString()}</div>
                  </div>

                  <div style={{ fontSize: 12, marginBottom: 14 }}>
                    <strong>Destination:</strong> {receiptTarget.destination_name} ({receiptTarget.destination_type})
                  </div>

                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 16 }}>
                    <thead>
                      <tr style={{ borderBottom: '1.5px solid #111827' }}>
                        <th style={{ textAlign: 'left', padding: '6px 4px', width: 24 }}>✓</th>
                        <th style={{ textAlign: 'left', padding: '6px 4px' }}>Medicine</th>
                        <th style={{ textAlign: 'left', padding: '6px 4px' }}>Batch No.</th>
                        <th style={{ textAlign: 'left', padding: '6px 4px' }}>Expiration</th>
                        <th style={{ textAlign: 'right', padding: '6px 4px' }}>Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receiptTarget.items.map((item) => (
                        <tr key={item.release_item_id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                          <td style={{ padding: '8px 4px' }}>
                            {/* Blank checkbox for the claimant to tick as
                                they physically count each item against
                                what's listed here. */}
                            <span style={{ display: 'inline-block', width: 12, height: 12, border: '1.3px solid #111827' }} />
                          </td>
                          <td style={{ padding: '8px 4px' }}>
                            {item.generic_name}{item.brand_name ? ` (${item.brand_name})` : ''}
                          </td>
                          <td style={{ padding: '8px 4px' }}>{item.batch_number || '—'}</td>
                          <td style={{ padding: '8px 4px' }}>{item.expiration_date || 'N/A'}</td>
                          <td style={{ padding: '8px 4px', textAlign: 'right' }}>{item.quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div style={{ fontSize: 10.5, color: '#6b7280', marginBottom: 16, lineHeight: 1.5 }}>
                    Please check (✓) each item above against what is physically handed over before leaving the warehouse.
                    Report any discrepancy immediately.
                  </div>

                  {receiptTarget.remarks && (
                    <div style={{ fontSize: 11, marginBottom: 20 }}>
                      <strong>Remarks:</strong> {receiptTarget.remarks}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 24, marginTop: 30 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ height: 60, borderBottom: '1px solid #111827', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4 }}>
                        {receiptTarget.id_picture_url && (
                          <img src={receiptTarget.id_picture_url} alt="Claimant signature" style={{ maxHeight: 56, maxWidth: '100%', objectFit: 'contain' }} />
                        )}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, marginTop: 6 }}>{receiptTarget.received_by_name || '—'}</div>
                      <div style={{ fontSize: 10, color: '#6b7280' }}>{receiptTarget.received_by_position || ''}</div>
                      <div style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>
                        {receiptTarget.status === 'received' ? 'Received By (Claimant)' : 'Received By (Claimant) — to sign upon pickup'}
                      </div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ height: 60, borderBottom: '1px solid #111827' }} />
                      <div style={{ fontSize: 12, fontWeight: 700, marginTop: 6 }}>&nbsp;</div>
                      <div style={{ fontSize: 10, color: '#6b7280' }}>&nbsp;</div>
                      <div style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>Released By (Warehouse Staff)</div>
                    </div>
                  </div>

                  {receiptTarget.received_at && (
                    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 18, textAlign: 'right' }}>
                      Received on {new Date(receiptTarget.received_at).toLocaleString()}
                    </div>
                  )}
                </div>

                <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 20px', borderTop: `1px solid ${T.border}` }}>
                  <button onClick={() => setReceiptTarget(null)} style={{ background: '#fff', border: `1.5px solid ${T.border}`, padding: '9px 18px', borderRadius: T.radiusSm, fontSize: 13, fontWeight: 700, cursor: 'pointer', color: '#111827' }}>Close</button>
                  <button
                    onClick={handlePrintReceipt}
                    style={{
                      background: T.greenMid, color: '#fff', border: 'none', padding: '9px 20px',
                      borderRadius: T.radiusSm, fontSize: 13, fontWeight: 800, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 6, boxShadow: `0 6px 18px ${T.green}44`,
                    }}
                  >
                    <Printer size={14} /> Print
                  </button>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>

    </div>
  )
}