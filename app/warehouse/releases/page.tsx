'use client'
// app/warehouse/releases/page.tsx
//
// Restyled to match the Medicine Inventory page's visual language:
// inline styles driven by the shared `T` theme tokens, StatCard /
// FilterBtn-style pills, dark-mode support via next-themes, and the
// same table/header/filter-bar look. No more release.module.css —
// everything below is inline styles, same pattern as MedicineStock.
//
// Data layer (Supabase queries, FEFO helpers, types, New Release modal
// logic) is unchanged from the previous version — only presentation
// changed.
//
// NOTE: Also run releases_stock_trigger.sql on Supabase — it adds the
// auto release_number generator and the stock auto-decrement trigger
// that this page depends on.
//
// NEW: "Confirm Receipt" now requires an uploaded ID photo of the
// claimant. This needs:
//   1. A new column on `releases`:  id_picture_url text null
//   2. A public Supabase Storage bucket named `release-confirmations`
//      (see SQL snippet at the bottom of this file's PR notes).

import { useEffect, useMemo, useState } from 'react'
import { useTheme } from 'next-themes'
import {
  Plus, Search, Download, CheckCircle2, XCircle, PackageMinus, X,
  Layers, Clock3, Truck, PackageCheck, Pill, Camera, ImageOff,
} from 'lucide-react'
// Adjust this import path to match your actual Supabase client location.
import { supabase } from '@/lib/supabase'
// Layout pieces — these keep the sidebar/topbar visible on this page.
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'
// Shared theme tokens — same source of truth used by the Medicine
// Inventory page, so both pages stay visually consistent.
import { T } from '../components/SharedMedicine'

// ============================================================
// Types (mirrors your Supabase schema)
// ============================================================

type ReleaseStatus = 'pending' | 'approved' | 'released' | 'received' | 'rejected' | 'cancelled'
type ConfirmationMethod = 'digital_signature' | 'manual_signature'
type DestinationType = 'Barangay' | 'Pharmacy' | 'Laboratory' | 'Office'

interface Destination {
  destination_id: string
  destination_name: string
  destination_type: DestinationType
  is_active: boolean
}

interface Medicine {
  medicine_id: string
  generic_name: string
  brand_name: string | null
  unit: string | null
}

interface MedicineBatch {
  batch_id: string
  medicine_id: string
  batch_number: string | null
  expiration_date: string | null
  total_quantity: number
  status: string
}

// One row in the table = one medicine/batch line item within a release
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

interface NewReleaseInput {
  destination_id: string
  batch_id: string
  quantity: number
  released_by: string | null
  remarks?: string | null
  received_by_name?: string | null
  received_by_position?: string | null
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

async function getActiveDestinations(): Promise<Destination[]> {
  const { data, error } = await supabase
    .from('destinations')
    .select('destination_id, destination_name, destination_type, is_active')
    .eq('is_active', true)
    .order('destination_name', { ascending: true })
  if (error) throw error
  return data || []
}

async function getActiveMedicines(): Promise<Medicine[]> {
  const { data, error } = await supabase
    .from('medicines')
    .select('medicine_id, generic_name, brand_name, unit')
    .eq('status', 'active')
    .eq('is_archived', false)
    .order('generic_name', { ascending: true })
  if (error) throw error
  return data || []
}

// FEFO: batches for a medicine, earliest expiration first, available stock only
async function getAvailableBatchesForMedicine(medicine_id: string): Promise<MedicineBatch[]> {
  const { data, error } = await supabase
    .from('medicine_batches')
    .select('batch_id, medicine_id, batch_number, expiration_date, total_quantity, status')
    .eq('medicine_id', medicine_id)
    .in('status', ['available', 'low_stock'])
    .gt('total_quantity', 0)
    .order('expiration_date', { ascending: true, nullsFirst: false })
  if (error) throw error
  return data || []
}

// Create a new release (header + single line item).
// release_number is auto-generated by a DB trigger — see releases_stock_trigger.sql
async function createRelease(input: NewReleaseInput) {
  const { data: release, error: releaseError } = await supabase
    .from('releases')
    .insert({
      destination_id: input.destination_id,
      released_by: input.released_by,
      status: 'released',
      date_released: new Date().toISOString(),
      remarks: input.remarks ?? null,
      received_by_name: input.received_by_name ?? null,
      received_by_position: input.received_by_position ?? null,
    })
    .select()
    .single()

  if (releaseError) throw releaseError

  const { error: itemError } = await supabase.from('release_items').insert({
    release_id: release.release_id,
    batch_id: input.batch_id,
    quantity: input.quantity,
  })

  if (itemError) throw itemError

  return release
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

// Approves a pending release: requires the approver's digital signature
// photo and a photo of their ID. Moves status pending -> approved.
async function approveRelease(
  release_id: string,
  approved_by_name: string,
  approved_by_position: string,
  digital_signature: string,
  approval_id_picture_url: string
) {
  const { error } = await supabase
    .from('releases')
    .update({
      status: 'approved',
      approved_by_name,
      approved_by_position,
      digital_signature,
      approval_id_picture_url,
      confirmation_method: 'digital_signature',
      updated_at: new Date().toISOString(),
    })
    .eq('release_id', release_id)
  if (error) throw error
}

async function markAsReceived(
  release_id: string,
  received_by_name: string,
  received_by_position: string,
  id_picture_url: string | null,
  confirmation_method: ConfirmationMethod = 'manual_signature'
) {
  const { error } = await supabase
    .from('releases')
    .update({
      status: 'received',
      received_by_name,
      received_by_position,
      confirmation_method,
      id_picture_url,
      received_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('release_id', release_id)
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

function StatCard({ icon, label, value, color, bg, dk }: {
  icon: React.ReactNode; label: string; value: number; color: string; bg: string; dk: boolean
}) {
  return (
    <div style={{
      flex: '1 1 160px', minWidth: 160,
      background: dk ? T.surfDk : T.surface,
      border: `1px solid ${dk ? T.borderDk : T.border}`,
      borderLeft: `4px solid ${color}`,
      borderRadius: T.radiusSm,
      padding: '12px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 10, flexShrink: 0,
        background: bg, color, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 900, color: dk ? T.textDk : T.text, lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: dk ? T.text2Dk : T.text2 }}>{label}</div>
      </div>
    </div>
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
// New Release modal (sub-component, same file)
// ============================================================

function NewReleaseModal({
  isOpen, onClose, onSuccess, destinations, medicines, dk,
}: {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  destinations: Destination[]
  medicines: Medicine[]
  dk: boolean
}) {
  const [destinationId, setDestinationId] = useState('')
  const [medicineId, setMedicineId] = useState('')
  const [batches, setBatches] = useState<MedicineBatch[]>([])
  const [batchId, setBatchId] = useState('')
  const [quantity, setQuantity] = useState<number>(1)
  const [receivedByName, setReceivedByName] = useState('')
  const [receivedByPosition, setReceivedByPosition] = useState('')
  const [remarks, setRemarks] = useState('')
  const [loadingBatches, setLoadingBatches] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const card = dk ? T.surfDk : T.surface
  const bdr = dk ? T.borderDk : T.border
  const txt = dk ? T.textDk : T.text
  const txt2 = dk ? T.text2Dk : T.text2
  const bg = dk ? T.bgDk : T.bg
  const shadow = dk ? T.shadowDk : T.shadow

  useEffect(() => {
    if (isOpen) {
      setDestinationId('')
      setMedicineId('')
      setBatches([])
      setBatchId('')
      setQuantity(1)
      setReceivedByName('')
      setReceivedByPosition('')
      setRemarks('')
      setError(null)
    }
  }, [isOpen])

  useEffect(() => {
    if (!medicineId) {
      setBatches([])
      setBatchId('')
      return
    }
    setLoadingBatches(true)
    getAvailableBatchesForMedicine(medicineId)
      .then((data) => {
        setBatches(data)
        setBatchId(data[0]?.batch_id ?? '') // auto-select earliest-expiry batch (FEFO)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingBatches(false))
  }, [medicineId])

  const selectedBatch = useMemo(() => batches.find((b) => b.batch_id === batchId) || null, [batches, batchId])
  const isFefoBatch = batches.length > 0 && batches[0].batch_id === batchId

  const handleSubmit = async () => {
    setError(null)
    if (!destinationId) return setError('Please select a destination.')
    if (!medicineId) return setError('Please select a medicine.')
    if (!selectedBatch) return setError('Please select a batch.')
    if (!quantity || quantity <= 0) return setError('Quantity must be greater than 0.')
    if (quantity > selectedBatch.total_quantity) {
      return setError(`Only ${selectedBatch.total_quantity} unit(s) available in this batch.`)
    }

    setSubmitting(true)
    try {
      const userId = typeof window !== 'undefined' ? localStorage.getItem('userId') : null
      await createRelease({
        destination_id: destinationId,
        batch_id: batchId,
        quantity,
        released_by: userId,
        remarks: remarks || null,
        received_by_name: receivedByName || null,
        received_by_position: receivedByPosition || null,
      })
      onSuccess()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to create release record.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  const fieldStyle: React.CSSProperties = {
    border: `1.5px solid ${bdr}`, borderRadius: T.radiusSm, padding: '9px 12px',
    fontSize: 13, color: txt, outline: 'none', width: '100%', background: bg,
    boxSizing: 'border-box', fontFamily: 'Nunito, sans-serif',
  }
  const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: txt2, marginBottom: 6, display: 'block' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: 16 }} onClick={onClose}>
      <div style={{ background: card, borderRadius: T.radius, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', boxShadow: shadow, border: `1px solid ${bdr}` }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: `1px solid ${bdr}`, background: T.greenDark, borderRadius: `${T.radius}px ${T.radius}px 0 0` }}>
          <h2 style={{ fontSize: 16, margin: 0, color: '#fff', fontWeight: 900 }}>New Medicine Release</h2>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(74,222,128,0.15)', cursor: 'pointer', color: T.mint, width: 30, height: 30, borderRadius: T.radiusSm, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={15} /></button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>Destination *</label>
            <select style={fieldStyle} value={destinationId} onChange={(e) => setDestinationId(e.target.value)}>
              <option value="">Select destination...</option>
              {destinations.map((d) => (
                <option key={d.destination_id} value={d.destination_id}>
                  {d.destination_name} ({d.destination_type})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Medicine *</label>
            <select style={fieldStyle} value={medicineId} onChange={(e) => setMedicineId(e.target.value)}>
              <option value="">Select medicine...</option>
              {medicines.map((m) => (
                <option key={m.medicine_id} value={m.medicine_id}>
                  {m.generic_name}{m.brand_name ? ` (${m.brand_name})` : ''}
                </option>
              ))}
            </select>
          </div>

          {medicineId && (
            <div>
              <label style={labelStyle}>Batch (FEFO — earliest expiry auto-selected) *</label>
              <select style={fieldStyle} value={batchId} onChange={(e) => setBatchId(e.target.value)} disabled={loadingBatches}>
                {loadingBatches && <option>Loading batches...</option>}
                {!loadingBatches && batches.length === 0 && <option>No available stock</option>}
                {batches.map((b, idx) => (
                  <option key={b.batch_id} value={b.batch_id}>
                    {b.batch_number || 'No batch #'} — exp. {b.expiration_date || 'N/A'} — {b.total_quantity} pcs
                    {idx === 0 ? ' (FEFO)' : ''}
                  </option>
                ))}
              </select>

              {selectedBatch && (
                <div style={{ marginTop: 8, background: T.greenLight, border: `1px solid ${T.green}`, borderRadius: T.radiusSm, padding: '10px 12px', fontSize: 12, color: T.greenDark, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>Batch: {selectedBatch.batch_number || 'N/A'}</span>
                  <span>Expiration: {selectedBatch.expiration_date || 'N/A'}</span>
                  <span>Available stock: {selectedBatch.total_quantity} pcs</span>
                  {!isFefoBatch && <span style={{ color: T.amber, fontWeight: 700 }}>⚠ Not the earliest-expiring batch (FEFO override)</span>}
                  {getExpiryStatus(selectedBatch.expiration_date) === 'expiring_soon' && (
                    <span style={{ color: T.amber, fontWeight: 700 }}>⚠ Expiring within 30 days</span>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label style={labelStyle}>Quantity to Release *</label>
            <input
              style={fieldStyle}
              type="number"
              min={1}
              max={selectedBatch?.total_quantity ?? undefined}
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
            />
          </div>

          <div>
            <label style={labelStyle}>Received By (Name)</label>
            <input
              style={fieldStyle}
              type="text"
              placeholder="Optional — can be filled when confirmed"
              value={receivedByName}
              onChange={(e) => setReceivedByName(e.target.value)}
            />
          </div>

          <div>
            <label style={labelStyle}>Received By (Position)</label>
            <input
              style={fieldStyle}
              type="text"
              placeholder="e.g. Barangay Health Worker"
              value={receivedByPosition}
              onChange={(e) => setReceivedByPosition(e.target.value)}
            />
          </div>

          <div>
            <label style={labelStyle}>Remarks</label>
            <textarea style={{ ...fieldStyle, resize: 'vertical' }} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>

          {error && <div style={{ color: T.red, fontSize: 12, fontWeight: 600 }}>{error}</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 20px', borderTop: `1px solid ${bdr}` }}>
          <button onClick={onClose} style={{ background: card, border: `1.5px solid ${bdr}`, padding: '9px 18px', borderRadius: T.radiusSm, fontSize: 13, fontWeight: 700, cursor: 'pointer', color: txt }}>Cancel</button>
          <button onClick={handleSubmit} disabled={submitting} style={{
            background: submitting ? T.green : T.greenMid, color: '#fff', border: 'none', padding: '9px 20px',
            borderRadius: T.radiusSm, fontSize: 13, fontWeight: 800, cursor: submitting ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, boxShadow: `0 6px 18px ${T.green}44`,
          }}>
            <PackageMinus size={14} />
            {submitting ? 'Saving...' : 'Release Medicine'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Main page
// ============================================================

type SortKey = 'date_released' | 'generic_name' | 'destination_name' | 'expiration_date' | 'status'

const STATUS_TABS: { key: ReleaseStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'released', label: 'Released' },
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
  const [destinations, setDestinations] = useState<Destination[]>([])
  const [medicines, setMedicines] = useState<Medicine[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ReleaseStatus | 'all'>('all')
  const [destTypeFilter, setDestTypeFilter] = useState<DestinationType | 'all'>('all')

  const [sortKey, setSortKey] = useState<SortKey>('date_released')
  const [sortAsc, setSortAsc] = useState(false)

  const [receiveTarget, setReceiveTarget] = useState<ReleaseRecord | null>(null)
  const [receiveName, setReceiveName] = useState('')
  const [receivePosition, setReceivePosition] = useState('')
  const [receiveIdFile, setReceiveIdFile] = useState<File | null>(null)
  const [receiveIdPreview, setReceiveIdPreview] = useState<string | null>(null)
  const [receiveError, setReceiveError] = useState<string | null>(null)
  const [confirmSubmitting, setConfirmSubmitting] = useState(false)

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  const [approveTarget, setApproveTarget] = useState<ReleaseRecord | null>(null)
  const [approveName, setApproveName] = useState('')
  const [approvePosition, setApprovePosition] = useState('')
  const [approveSigFile, setApproveSigFile] = useState<File | null>(null)
  const [approveSigPreview, setApproveSigPreview] = useState<string | null>(null)
  const [approveIdFile, setApproveIdFile] = useState<File | null>(null)
  const [approveIdPreview, setApproveIdPreview] = useState<string | null>(null)
  const [approveError, setApproveError] = useState<string | null>(null)
  const [approveSubmitting, setApproveSubmitting] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [r, d, m] = await Promise.all([getReleaseRecords(), getActiveDestinations(), getActiveMedicines()])
      setRecords(r)
      setDestinations(d)
      setMedicines(m)
    } catch (err) {
      console.error('Failed to load release records:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  // ── Stat cards (unaffected by the filters below — a snapshot of everything) ──
  const stats = useMemo(() => {
    const total = records.length
    const pending = records.filter((r) => r.status === 'pending' || r.status === 'approved').length
    const inTransit = records.filter((r) => r.status === 'released').length
    const received = records.filter((r) => r.status === 'received').length
    return { total, pending, inTransit, received }
  }, [records])

  // ── Status tab counts — computed against the destination-type filter, not itself ──
  const statusCounts = useMemo(() => {
    const base = destTypeFilter === 'all' ? records : records.filter((r) => r.destination_type === destTypeFilter)
    const counts: Record<string, number> = { all: base.length, pending: 0, approved: 0, released: 0, received: 0, rejected: 0, cancelled: 0 }
    base.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1 })
    return counts
  }, [records, destTypeFilter])

  // ── Destination-type pill counts — computed against the status filter, not itself ──
  const destTypeCounts = useMemo(() => {
    const base = statusFilter === 'all' ? records : records.filter((r) => r.status === statusFilter)
    const counts: Record<string, number> = { all: base.length, Barangay: 0, Pharmacy: 0, Laboratory: 0, Office: 0 }
    base.forEach((r) => { counts[r.destination_type] = (counts[r.destination_type] || 0) + 1 })
    return counts
  }, [records, statusFilter])

  const filtered = useMemo(() => {
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

    rows.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'date_released') cmp = new Date(a.date_released).getTime() - new Date(b.date_released).getTime()
      else if (sortKey === 'expiration_date')
        cmp = new Date(a.expiration_date || 0).getTime() - new Date(b.expiration_date || 0).getTime()
      else cmp = String(a[sortKey]).localeCompare(String(b[sortKey]))
      return sortAsc ? cmp : -cmp
    })

    return rows
  }, [records, search, statusFilter, destTypeFilter, sortKey, sortAsc])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((a) => !a)
    else { setSortKey(key); setSortAsc(true) }
  }

  // Opens the "Confirm Receipt" modal for a given release row and resets
  // its local form state (name/position/ID photo) fresh each time.
  const openReceiveModal = (r: ReleaseRecord) => {
    setReceiveTarget(r)
    setReceiveName(r.received_by_name || '')
    setReceivePosition(r.received_by_position || '')
    setReceiveIdFile(null)
    setReceiveIdPreview(r.id_picture_url || null)
    setReceiveError(null)
  }

  const closeReceiveModal = () => {
    setReceiveTarget(null)
    setReceiveName('')
    setReceivePosition('')
    setReceiveIdFile(null)
    setReceiveIdPreview(null)
    setReceiveError(null)
  }

  const handleIdFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setReceiveError('Please upload a valid image file (JPG or PNG).')
      return
    }
    setReceiveError(null)
    setReceiveIdFile(file)
    const reader = new FileReader()
    reader.onload = () => setReceiveIdPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleConfirmReceive = async () => {
    if (!receiveTarget) return
    if (!receiveName || !receivePosition) {
      setReceiveError('Please fill in the claimant\'s name and position.')
      return
    }
    if (!receiveIdFile) {
      setReceiveError('Please upload a photo of the claimant\'s ID before confirming.')
      return
    }

    setReceiveError(null)
    setConfirmSubmitting(true)
    try {
      const idPictureUrl = await uploadReleaseImage(receiveIdFile, receiveTarget.release_id, 'id')
      await markAsReceived(receiveTarget.release_id, receiveName, receivePosition, idPictureUrl)
      closeReceiveModal()
      loadData()
    } catch (err: any) {
      setReceiveError(err.message || 'Failed to confirm receipt. Please try again.')
    } finally {
      setConfirmSubmitting(false)
    }
  }

  const openApproveModal = (r: ReleaseRecord) => {
    setApproveTarget(r)
    setApproveName(r.approved_by_name || '')
    setApprovePosition(r.approved_by_position || '')
    setApproveSigFile(null)
    setApproveSigPreview(r.digital_signature || null)
    setApproveIdFile(null)
    setApproveIdPreview(r.approval_id_picture_url || null)
    setApproveError(null)
  }

  const closeApproveModal = () => {
    setApproveTarget(null)
    setApproveName('')
    setApprovePosition('')
    setApproveSigFile(null)
    setApproveSigPreview(null)
    setApproveIdFile(null)
    setApproveIdPreview(null)
    setApproveError(null)
  }

  const handleApproveSigChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setApproveError('Please upload a valid image file (JPG or PNG).')
      return
    }
    setApproveError(null)
    setApproveSigFile(file)
    const reader = new FileReader()
    reader.onload = () => setApproveSigPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleApproveIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setApproveError('Please upload a valid image file (JPG or PNG).')
      return
    }
    setApproveError(null)
    setApproveIdFile(file)
    const reader = new FileReader()
    reader.onload = () => setApproveIdPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleConfirmApprove = async () => {
    if (!approveTarget) return
    if (!approveName || !approvePosition) {
      setApproveError('Please fill in the approver\'s name and position.')
      return
    }
    if (!approveSigFile) {
      setApproveError('Please upload a photo of the digital signature.')
      return
    }
    if (!approveIdFile) {
      setApproveError('Please upload a photo of the approver\'s ID.')
      return
    }

    setApproveError(null)
    setApproveSubmitting(true)
    try {
      const [sigUrl, idUrl] = await Promise.all([
        uploadReleaseImage(approveSigFile, approveTarget.release_id, 'signature'),
        uploadReleaseImage(approveIdFile, approveTarget.release_id, 'id'),
      ])
      await approveRelease(approveTarget.release_id, approveName, approvePosition, sigUrl, idUrl)
      closeApproveModal()
      loadData()
    } catch (err: any) {
      setApproveError(err.message || 'Failed to approve release. Please try again.')
    } finally {
      setApproveSubmitting(false)
    }
  }

  const handleCancel = async (record: ReleaseRecord) => {
    if (!confirm(`Cancel release ${record.release_number}?`)) return
    try {
      await cancelRelease(record.release_id)
      loadData()
    } catch (err) {
      console.error('Failed to cancel release:', err)
    }
  }

  const exportCsv = () => {
    const headers = ['Release #', 'Medicine', 'Batch #', 'Expiration', 'Quantity', 'Destination', 'Received By', 'Status', 'Date Released']
    const rows = filtered.map((r) => [
      r.release_number,
      r.brand_name ? `${r.generic_name} (${r.brand_name})` : r.generic_name,
      r.batch_number || '',
      r.expiration_date || '',
      r.quantity,
      r.destination_name,
      r.received_by_name || '',
      r.status,
      new Date(r.date_released).toLocaleString(),
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

  const canConfirmReceive = !!receiveName && !!receivePosition && !!receiveIdFile && !confirmSubmitting
  const canConfirmApprove = !!approveName && !!approvePosition && !!approveSigFile && !!approveIdFile && !approveSubmitting

  return (
    <div style={{ display: 'flex', height: '100vh', background: bg, fontFamily: 'Nunito, sans-serif' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        * { font-family: Nunito, sans-serif !important; }
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

          {/* ── Stat cards ── */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <StatCard icon={<Layers size={17} />} label="Total Releases" value={stats.total} color={T.green} bg={T.greenLight} dk={dk} />
            <StatCard icon={<Clock3 size={17} />} label="Pending / Approved" value={stats.pending} color={T.amber} bg={T.amberLight} dk={dk} />
            <StatCard icon={<Truck size={17} />} label="In Transit" value={stats.inTransit} color="#4338ca" bg="#e0e7ff" dk={dk} />
            <StatCard icon={<PackageCheck size={17} />} label="Received" value={stats.received} color="#0f766e" bg="#ccfbf1" dk={dk} />
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

          {/* ── Table ── */}
          <div style={{ background: card, border: `1px solid ${bdr}`, borderRadius: T.radius, overflow: 'hidden', boxShadow: shadow }}>
            <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 420px)', minHeight: 200 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: bg, borderBottom: `2px solid ${bdr}` }}>
                    <th style={{ ...thStyle, cursor: 'default', width: 40 }}>No.</th>
                    <th style={thStyle} onClick={() => toggleSort('generic_name')}>Medicine</th>
                    <th style={{ ...thStyle, cursor: 'default' }}>Batch No.</th>
                    <th style={thStyle} onClick={() => toggleSort('expiration_date')}>Expiration (FEFO)</th>
                    <th style={{ ...thStyle, cursor: 'default' }}>Qty</th>
                    <th style={thStyle} onClick={() => toggleSort('destination_name')}>Destination</th>
                    <th style={{ ...thStyle, cursor: 'default' }}>Received By</th>
                    <th style={{ ...thStyle, cursor: 'default' }}>ID Photo</th>
                    <th style={thStyle} onClick={() => toggleSort('status')}>Status</th>
                    <th style={thStyle} onClick={() => toggleSort('date_released')}>Date Released</th>
                    <th style={{ ...thStyle, cursor: 'default', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={11} style={{ textAlign: 'center', padding: 48, color: txt2, fontSize: 13 }}>
                      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 32, height: 32, border: `3px solid ${T.green}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        Loading release records...
                      </div>
                    </td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={11} style={{ textAlign: 'center', padding: 56, color: txt2, fontSize: 13 }}>
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
                  ) : filtered.map((r, i) => {
                    const expiry = getExpiryStatus(r.expiration_date)
                    const expiryColor = expiry === 'expired' ? T.red : expiry === 'expiring_soon' ? T.amber : txt2
                    const rowBg = i % 2 === 0 ? card : card2
                    return (
                      <tr key={r.release_item_id}
                        style={{ background: rowBg, borderBottom: `1px solid ${bdr}`, transition: 'background 0.1s' }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = T.greenLight }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = rowBg }}
                      >
                        <td style={{ padding: '11px 12px', color: txt2, fontWeight: 700 }}>{i + 1}</td>
                        <td style={{ padding: '11px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                            <div style={{ width: 32, height: 32, borderRadius: 8, background: T.greenLight, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.green, flexShrink: 0 }}>
                              <Pill size={15} />
                            </div>
                            <div>
                              <div style={{ fontWeight: 700, color: txt, fontSize: 12 }}>{r.generic_name}</div>
                              {r.brand_name && <div style={{ fontSize: 10, color: txt2 }}>{r.brand_name}</div>}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '11px 12px', color: txt2, fontSize: 11 }}>{r.batch_number || '—'}</td>
                        <td style={{ padding: '11px 12px', fontSize: 11, color: expiryColor, fontWeight: expiry !== 'ok' && expiry !== 'unknown' ? 700 : 400 }}>
                          {r.expiration_date || 'N/A'}
                          {expiry === 'expired' && <span style={{ fontSize: 9, marginLeft: 5, background: T.redLight, color: T.red, border: `1px solid ${T.redBorder}`, borderRadius: 4, padding: '1px 5px', fontWeight: 800 }}>EXPIRED</span>}
                          {expiry === 'expiring_soon' && <span style={{ fontSize: 9, marginLeft: 5, background: T.amberLight, color: T.amber, border: `1px solid ${T.amberBorder}`, borderRadius: 4, padding: '1px 5px', fontWeight: 800 }}>SOON</span>}
                        </td>
                        <td style={{ padding: '11px 12px', color: txt2, fontSize: 11 }}>{r.quantity} {r.unit || ''}</td>
                        <td style={{ padding: '11px 12px' }}>
                          <div>
                            <div style={{ fontWeight: 700, color: txt, fontSize: 12 }}>{r.destination_name}</div>
                            <div style={{ fontSize: 10, color: txt2 }}>{r.destination_type}</div>
                          </div>
                        </td>
                        <td style={{ padding: '11px 12px', color: txt2, fontSize: 11 }}>
                          {r.received_by_name ? (
                            <div>
                              <div style={{ color: txt }}>{r.received_by_name}</div>
                              {r.received_by_position && <div style={{ fontSize: 10, color: txt2 }}>{r.received_by_position}</div>}
                            </div>
                          ) : r.approved_by_name ? (
                            <div>
                              <div style={{ color: txt }}>{r.approved_by_name}</div>
                              <div style={{ fontSize: 9, color: '#4338ca', fontWeight: 800 }}>APPROVED BY</div>
                            </div>
                          ) : '—'}
                        </td>
                        <td style={{ padding: '11px 12px' }}>
                          <div style={{ display: 'flex', gap: 5 }}>
                            {r.id_picture_url && (
                              <img
                                src={r.id_picture_url}
                                alt="Claimant ID"
                                title="Claimant ID (receipt)"
                                onClick={() => setLightboxUrl(r.id_picture_url)}
                                style={{ width: 34, height: 34, borderRadius: 7, objectFit: 'cover', cursor: 'pointer', border: `1.5px solid ${T.green}` }}
                              />
                            )}
                            {!r.id_picture_url && r.digital_signature && (
                              <img
                                src={r.digital_signature}
                                alt="Digital signature"
                                title="Digital signature (approval)"
                                onClick={() => setLightboxUrl(r.digital_signature)}
                                style={{ width: 34, height: 34, borderRadius: 7, objectFit: 'cover', cursor: 'pointer', border: `1.5px solid #4338ca` }}
                              />
                            )}
                            {!r.id_picture_url && r.approval_id_picture_url && (
                              <img
                                src={r.approval_id_picture_url}
                                alt="Approver ID"
                                title="Approver ID"
                                onClick={() => setLightboxUrl(r.approval_id_picture_url)}
                                style={{ width: 34, height: 34, borderRadius: 7, objectFit: 'cover', cursor: 'pointer', border: `1.5px solid #4338ca` }}
                              />
                            )}
                            {!r.id_picture_url && !r.digital_signature && !r.approval_id_picture_url && (
                              <div style={{ width: 34, height: 34, borderRadius: 7, background: bg, border: `1px dashed ${bdr}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: txt2 }}>
                                <ImageOff size={13} />
                              </div>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '11px 12px' }}><StatusBadge status={r.status} /></td>
                        <td style={{ padding: '11px 12px', color: txt2, fontSize: 11 }}>{new Date(r.date_released).toLocaleDateString()}</td>
                        <td style={{ padding: '11px 12px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            {r.status === 'pending' && (
                              <button
                                onClick={() => openApproveModal(r)}
                                title="Approve release (requires digital signature + ID photo)"
                                style={{ border: `1.5px solid ${bdr}`, background: card, borderRadius: T.radiusSm, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#4338ca' }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = '#e0e7ff'; e.currentTarget.style.borderColor = '#4338ca' }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = card; e.currentTarget.style.borderColor = bdr }}
                              >
                                <CheckCircle2 size={13} /> Approve
                              </button>
                            )}
                            {(r.status === 'released' || r.status === 'approved') && (
                              <button
                                onClick={() => openReceiveModal(r)}
                                title="Confirm receipt (requires ID photo)"
                                style={{ border: `1.5px solid ${bdr}`, background: card, borderRadius: T.radiusSm, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: T.green }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = T.greenLight; e.currentTarget.style.borderColor = T.green }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = card; e.currentTarget.style.borderColor = bdr }}
                              >
                                <CheckCircle2 size={13} /> Received
                              </button>
                            )}
                            {(r.status === 'pending' || r.status === 'approved') && (
                              <button
                                onClick={() => handleCancel(r)}
                                title="Cancel release"
                                style={{ border: `1.5px solid ${bdr}`, background: card, borderRadius: T.radiusSm, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: T.red }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = T.redLight; e.currentTarget.style.borderColor = T.red }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = card; e.currentTarget.style.borderColor = bdr }}
                              >
                                <XCircle size={13} /> Cancel
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Table footer */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderTop: `1px solid ${bdr}`, background: bg }}>
              <span style={{ fontSize: 12, color: txt2, fontWeight: 600 }}>
                {filtered.length === 0 ? 'No results' : `${filtered.length} item${filtered.length !== 1 ? 's' : ''} total`}
              </span>
            </div>
          </div>

          <NewReleaseModal
            isOpen={showModal}
            onClose={() => setShowModal(false)}
            onSuccess={loadData}
            destinations={destinations}
            medicines={medicines}
            dk={dk}
          />

          {/* ── Confirm Receipt modal ── */}
          {receiveTarget && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: 16 }} onClick={closeReceiveModal}>
              <div style={{ background: card, borderRadius: T.radius, width: '100%', maxWidth: 400, maxHeight: '90vh', overflowY: 'auto', boxShadow: shadow, border: `1px solid ${bdr}` }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: `1px solid ${bdr}`, background: T.greenDark, borderRadius: `${T.radius}px ${T.radius}px 0 0` }}>
                  <h2 style={{ fontSize: 16, margin: 0, color: '#fff', fontWeight: 900 }}>Confirm Receipt</h2>
                  <button onClick={closeReceiveModal} style={{ border: 'none', background: 'rgba(74,222,128,0.15)', cursor: 'pointer', color: T.mint, width: 30, height: 30, borderRadius: T.radiusSm, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={15} /></button>
                </div>
                <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ fontSize: 11, color: txt2, background: bg, border: `1px solid ${bdr}`, borderRadius: T.radiusSm, padding: '8px 10px' }}>
                    Have the person claiming this release show a valid ID, then fill in their details and take/upload a photo of it below.
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
                    <label style={{ fontSize: 12, fontWeight: 700, color: txt2, marginBottom: 6, display: 'block' }}>ID Photo of Claimant *</label>
                    <div
                      onClick={() => document.getElementById('receive-id-photo-input')?.click()}
                      style={{
                        border: `1.5px dashed ${receiveIdPreview ? T.green : bdr}`, borderRadius: T.radiusSm,
                        padding: receiveIdPreview ? 10 : 18, textAlign: 'center', background: bg, cursor: 'pointer',
                        transition: 'border 0.15s',
                      }}
                    >
                      {receiveIdPreview ? (
                        <img src={receiveIdPreview} alt="ID preview" style={{ maxHeight: 150, maxWidth: '100%', borderRadius: 8, display: 'block', margin: '0 auto' }} />
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: txt2 }}>
                          <Camera size={22} />
                          <span style={{ fontSize: 12, fontWeight: 700 }}>Tap to take or upload a photo</span>
                        </div>
                      )}
                      <input
                        id="receive-id-photo-input"
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleIdFileChange}
                        style={{ display: 'none' }}
                      />
                    </div>
                    {receiveIdPreview && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setReceiveIdFile(null); setReceiveIdPreview(null) }}
                        style={{ marginTop: 6, fontSize: 11, color: T.red, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, padding: 0 }}
                      >
                        Remove photo
                      </button>
                    )}
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

          {/* ── Approve Release modal (pending -> approved) ── */}
          {approveTarget && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: 16 }} onClick={closeApproveModal}>
              <div style={{ background: card, borderRadius: T.radius, width: '100%', maxWidth: 420, maxHeight: '90vh', overflowY: 'auto', boxShadow: shadow, border: `1px solid ${bdr}` }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: `1px solid ${bdr}`, background: '#3730a3', borderRadius: `${T.radius}px ${T.radius}px 0 0` }}>
                  <h2 style={{ fontSize: 16, margin: 0, color: '#fff', fontWeight: 900 }}>Approve Release</h2>
                  <button onClick={closeApproveModal} style={{ border: 'none', background: 'rgba(255,255,255,0.15)', cursor: 'pointer', color: '#c7d2fe', width: 30, height: 30, borderRadius: T.radiusSm, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={15} /></button>
                </div>
                <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ fontSize: 11, color: txt2, background: bg, border: `1px solid ${bdr}`, borderRadius: T.radiusSm, padding: '8px 10px' }}>
                    Approving this release authorizes it to move forward to dispatch. Please provide the approver's details, digital signature, and a photo of a valid ID.
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: txt2, marginBottom: 6, display: 'block' }}>Approved By (Name) *</label>
                    <input
                      value={approveName}
                      onChange={(e) => setApproveName(e.target.value)}
                      style={{ border: `1.5px solid ${bdr}`, borderRadius: T.radiusSm, padding: '9px 12px', fontSize: 13, color: txt, outline: 'none', width: '100%', background: bg, boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: txt2, marginBottom: 6, display: 'block' }}>Position *</label>
                    <input
                      value={approvePosition}
                      onChange={(e) => setApprovePosition(e.target.value)}
                      placeholder="e.g. Warehouse Supervisor"
                      style={{ border: `1.5px solid ${bdr}`, borderRadius: T.radiusSm, padding: '9px 12px', fontSize: 13, color: txt, outline: 'none', width: '100%', background: bg, boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: txt2, marginBottom: 6, display: 'block' }}>Digital Signature (photo) *</label>
                    <div
                      onClick={() => document.getElementById('approve-signature-input')?.click()}
                      style={{
                        border: `1.5px dashed ${approveSigPreview ? '#4338ca' : bdr}`, borderRadius: T.radiusSm,
                        padding: approveSigPreview ? 10 : 18, textAlign: 'center', background: bg, cursor: 'pointer',
                      }}
                    >
                      {approveSigPreview ? (
                        <img src={approveSigPreview} alt="Signature preview" style={{ maxHeight: 120, maxWidth: '100%', borderRadius: 8, display: 'block', margin: '0 auto' }} />
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: txt2 }}>
                          <Camera size={20} />
                          <span style={{ fontSize: 12, fontWeight: 700 }}>Tap to upload signature photo</span>
                        </div>
                      )}
                      <input id="approve-signature-input" type="file" accept="image/*" capture="environment" onChange={handleApproveSigChange} style={{ display: 'none' }} />
                    </div>
                    {approveSigPreview && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setApproveSigFile(null); setApproveSigPreview(null) }}
                        style={{ marginTop: 6, fontSize: 11, color: T.red, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, padding: 0 }}
                      >
                        Remove photo
                      </button>
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: txt2, marginBottom: 6, display: 'block' }}>Approver's ID Photo *</label>
                    <div
                      onClick={() => document.getElementById('approve-id-input')?.click()}
                      style={{
                        border: `1.5px dashed ${approveIdPreview ? '#4338ca' : bdr}`, borderRadius: T.radiusSm,
                        padding: approveIdPreview ? 10 : 18, textAlign: 'center', background: bg, cursor: 'pointer',
                      }}
                    >
                      {approveIdPreview ? (
                        <img src={approveIdPreview} alt="ID preview" style={{ maxHeight: 120, maxWidth: '100%', borderRadius: 8, display: 'block', margin: '0 auto' }} />
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: txt2 }}>
                          <Camera size={20} />
                          <span style={{ fontSize: 12, fontWeight: 700 }}>Tap to take or upload a photo</span>
                        </div>
                      )}
                      <input id="approve-id-input" type="file" accept="image/*" capture="environment" onChange={handleApproveIdChange} style={{ display: 'none' }} />
                    </div>
                    {approveIdPreview && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setApproveIdFile(null); setApproveIdPreview(null) }}
                        style={{ marginTop: 6, fontSize: 11, color: T.red, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, padding: 0 }}
                      >
                        Remove photo
                      </button>
                    )}
                  </div>

                  {approveError && <div style={{ color: T.red, fontSize: 12, fontWeight: 600 }}>{approveError}</div>}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 20px', borderTop: `1px solid ${bdr}` }}>
                  <button onClick={closeApproveModal} style={{ background: card, border: `1.5px solid ${bdr}`, padding: '9px 18px', borderRadius: T.radiusSm, fontSize: 13, fontWeight: 700, cursor: 'pointer', color: txt }}>Cancel</button>
                  <button
                    onClick={handleConfirmApprove}
                    disabled={!canConfirmApprove}
                    style={{
                      background: canConfirmApprove ? '#3730a3' : '#818cf8', color: '#fff', border: 'none', padding: '9px 20px',
                      borderRadius: T.radiusSm, fontSize: 13, fontWeight: 800,
                      cursor: canConfirmApprove ? 'pointer' : 'not-allowed',
                      opacity: canConfirmApprove ? 1 : 0.5,
                      display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 6px 18px rgba(67,56,202,0.35)',
                    }}
                  >
                    <CheckCircle2 size={14} /> {approveSubmitting ? 'Uploading...' : 'Approve Release'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── ID Photo lightbox ── */}
          {lightboxUrl && (
            <div
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 4000, padding: 24 }}
              onClick={() => setLightboxUrl(null)}
            >
              <img
                src={lightboxUrl}
                alt="Claimant ID"
                style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
                onClick={(e) => e.stopPropagation()}
              />
              <button
                onClick={() => setLightboxUrl(null)}
                style={{ position: 'absolute', top: 24, right: 24, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={20} />
              </button>
            </div>
          )}

        </main>
      </div>
    </div>
  )
}