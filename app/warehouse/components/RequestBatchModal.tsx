'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import styles from './warehouse.module.css'

type ReqStatus = 'pending' | 'confirm' | 'alerted' | 'rejected' | 'received'
type ReqCategory = 'drugs' | 'supplies'
type ReqSource = 'pharmacy' | 'laboratory' | 'barangay'

// The three source tables have different shapes — pharmacy_requests /
// laboratory_requests share brand_name + fund_source (no `barangay`
// column); barangay_requests has `barangay` instead (no brand_name /
// fund_source). Every field beyond the common core is optional here so
// one row type can represent whichever table was actually queried.
interface RequestRow {
  id: string
  requested_by: string
  medicine_name: string
  dosage: string | null
  dosage_form: string | null
  category: ReqCategory
  requested_qty: number
  unit: string
  status: ReqStatus
  requested_at: string
  notes: string | null
  fulfilled_qty: number | null
  request_batch_id: string | null
  brand_name?: string | null      // pharmacy_requests / laboratory_requests only
  fund_source?: string | null     // pharmacy_requests / laboratory_requests only
  barangay?: string | null        // barangay_requests only
}

/** Warehouse stock for one medicine, expressed three ways so a mismatch
 *  between the request's unit and the warehouse's packaging (boxes /
 *  strips / loose pieces) never gets mislabeled. */
interface StockBreakdown {
  boxes: number
  strips: number
  pieces: number
  inRequestUnit: number
}

interface EnrichedRow extends RequestRow {
  stock: StockBreakdown
}

interface RequestNotification {
  source: ReqSource
  related_request_id: string | null
  related_batch_id: string | null
}

const TABLE_BY_SOURCE: Record<ReqSource, string> = {
  pharmacy: 'pharmacy_requests',
  laboratory: 'laboratory_requests',
  barangay: 'barangay_requests',
}

const SOURCE_STYLE: Record<ReqSource, { bg: string; color: string; label: string }> = {
  pharmacy:   { bg: 'rgba(255,255,255,.18)', color: '#fff', label: 'Pharmacy'   },
  laboratory: { bg: 'rgba(255,255,255,.18)', color: '#fff', label: 'Laboratory' },
  barangay:   { bg: 'rgba(255,255,255,.18)', color: '#fff', label: 'Barangay'   },
}

const STATUS_STYLE: Record<ReqStatus, { bg: string; color: string; label: string }> = {
  pending:  { bg: '#fdf1d6', color: '#92660c', label: 'Pending'   },
  confirm:  { bg: '#dcedff', color: '#1a5aa8', label: 'Confirmed' },
  alerted:  { bg: '#fef3c7', color: '#92400e', label: 'Alerted'   },
  rejected: { bg: '#fbdede', color: '#a3251f', label: 'Rejected'  },
  received: { bg: '#dcf3e3', color: '#1f7a44', label: 'Received'  },
}

/** Same rollup used by the requests list page — surfaces whichever status
 *  needs attention first, and only reports "settled" (received/rejected)
 *  once every item in the request agrees. Kept in sync so the badge shown
 *  here always matches the badge shown in the row you clicked. */
function rollupStatus(statuses: ReqStatus[]): ReqStatus {
  if (statuses.every(s => s === 'received')) return 'received'
  if (statuses.every(s => s === 'rejected')) return 'rejected'
  if (statuses.some(s => s === 'pending')) return 'pending'
  if (statuses.some(s => s === 'alerted')) return 'alerted'
  if (statuses.some(s => s === 'confirm')) return 'confirm'
  return statuses[0]
}

// Same PHT (UTC+8) formatting, en-PH locale, used by the requests list
// page — kept identical here on purpose so the date/time in this modal's
// header always matches what's shown in the row that opened it.
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

/** Loose-match key for medicine names — trims, lowercases, and strips a
 *  trailing "(500mg)"-style suffix so "Paracetamol (500mg)" (legacy rows
 *  that folded dosage into the name) still matches the catalog's plain
 *  "Paracetamol". */
function normalizeMedName(s: string) {
  return s.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase()
}

/** Maps a request's free-typed unit string to a packaging bucket. */
function resolveUnitBucket(unit: string): 'box' | 'strip' | 'piece' {
  const u = (unit ?? '').toLowerCase().trim()
  if (u.startsWith('box')) return 'box'
  if (u.startsWith('strip')) return 'strip'
  return 'piece'
}

interface RawBatch {
  boxes: number | null
  strips_per_box: number | null
  pieces_per_strip: number | null
  loose_pieces: number | null
  total_quantity: number | null
  medicines: { generic_name: string; brand_name: string | null } | { generic_name: string; brand_name: string | null }[] | null
}

interface StockAgg {
  boxes: number
  strips: number
  pieces: number
}

export default function RequestBatchModal({
  notification,
  onClose,
}: {
  notification: RequestNotification
  onClose: () => void
}) {
  const [rows, setRows] = useState<EnrichedRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [alertingId, setAlertingId] = useState<string | null>(null)
  const [alertQty, setAlertQty] = useState(0)
  const [toast, setToast] = useState('')

  const source = notification.source
  const table = TABLE_BY_SOURCE[source]
  const isBarangaySource = source === 'barangay'

  useEffect(() => { loadData() }, [notification.source, notification.related_batch_id, notification.related_request_id])

  async function loadData() {
    setLoading(true)

    let query = supabase.from(table).select('*')
    if (notification.related_batch_id) {
      query = query.eq('request_batch_id', notification.related_batch_id)
    } else if (notification.related_request_id) {
      query = query.eq('id', notification.related_request_id)
    } else {
      setRows([])
      setLoading(false)
      return
    }

    const { data: reqData, error: reqErr } = await query.order('medicine_name', { ascending: true })
    if (reqErr || !reqData) {
      console.error(`RequestBatchModal: fetch requests error (${table})`, reqErr)
      setRows([])
      setLoading(false)
      return
    }

    // Warehouse stock: sum of available + low_stock batches, matched by
    // name. `total_quantity` is a DB-generated column
    // (boxes*strips_per_box*pieces_per_strip + loose_pieces) and is ALWAYS
    // in pieces, so we derive boxes/strips separately to convert into
    // whatever unit the request used.
    //
    // A batch is matched by exactly ONE name: its brand name if it has
    // one, otherwise its generic name. A generic-only catalog entry
    // ("Paracetamol") and a branded entry that happens to share the same
    // generic ingredient ("Paracetamol / Biogesic") are separate,
    // independently-stocked products — a plain "Paracetamol" request must
    // not silently pull in Biogesic-branded stock, and vice versa.
    //
    // Warehouse stock is shared across all three request sources — the
    // same medicine_batches table is checked regardless of whether this
    // is a Pharmacy, Laboratory, or Barangay request.
    const { data: batchData } = await supabase
      .from('medicine_batches')
      .select('boxes, strips_per_box, pieces_per_strip, loose_pieces, total_quantity, status, medicines(generic_name, brand_name)')
      .in('status', ['available', 'low_stock'])

    const stockMap = new Map<string, StockAgg>()
    for (const row of (batchData ?? []) as unknown as RawBatch[]) {
      const medRel = row.medicines
      const med = Array.isArray(medRel) ? medRel[0] : medRel
      if (!med) continue

      const boxes = row.boxes ?? 0
      const stripsPerBox = row.strips_per_box ?? 0
      const piecesPerStrip = row.pieces_per_strip ?? 0
      const loosePieces = row.loose_pieces ?? 0
      const pieces = row.total_quantity ?? 0

      const stripsFromBoxes = boxes * stripsPerBox
      const stripsFromLoose = piecesPerStrip > 0 ? Math.floor(loosePieces / piecesPerStrip) : 0
      const strips = stripsFromBoxes + stripsFromLoose

      const effectiveName = (med.brand_name && med.brand_name.trim()) ? med.brand_name : med.generic_name
      if (!effectiveName) continue
      const key = normalizeMedName(effectiveName)
      const existing = stockMap.get(key) ?? { boxes: 0, strips: 0, pieces: 0 }
      existing.boxes += boxes
      existing.strips += strips
      existing.pieces += pieces
      stockMap.set(key, existing)
    }

    const enriched: EnrichedRow[] = (reqData as RequestRow[]).map(r => {
      const agg = stockMap.get(normalizeMedName(r.medicine_name)) ?? { boxes: 0, strips: 0, pieces: 0 }
      const bucket = resolveUnitBucket(r.unit)
      const inRequestUnit =
        bucket === 'box' ? agg.boxes :
        bucket === 'strip' ? agg.strips :
        agg.pieces
      return {
        ...r,
        stock: { boxes: agg.boxes, strips: agg.strips, pieces: agg.pieces, inRequestUnit },
      }
    })

    setRows(enriched)
    setLoading(false)
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }

  async function updateRow(id: string, patch: Partial<RequestRow>) {
    setBusyId(id)
    const { error } = await supabase.from(table).update(patch).eq('id', id)
    if (!error) {
      setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
    } else {
      console.error(`RequestBatchModal: update error (${table})`, error)
      showToast('✗ Failed to update.')
    }
    setBusyId(null)
  }

  const confirmRow = (id: string) => updateRow(id, { status: 'confirm' })
  const rejectRow  = (id: string) => updateRow(id, { status: 'rejected' })

  // "Mark as Received" — set by WAREHOUSE staff themselves, right when
  // they physically hand the items to Pharmacy/Laboratory/Barangay.
  // Barangay and Laboratory don't have their own inventory module to
  // mark a request "received" from their side, so this button is the
  // single, consistent trigger point across all three sources.
  //
  // Setting status to 'received' fires the DB trigger
  // (trg_deduct_stock_fefo → fn_deduct_stock_fefo()) on all three
  // request tables, which deducts from medicine_batches FEFO (soonest
  // expiration first). That happens server-side the instant the update
  // lands — so right after it, we do a full loadData() (not just a
  // local status patch) to pull the post-deduction stock numbers and
  // reflect them immediately in the "Warehouse Stock" column instead of
  // showing stale pre-deduction figures until the modal is reopened.
  async function markReceived(row: EnrichedRow) {
    await updateRow(row.id, { status: 'received' })
    await loadData()
    showToast(`✓ Na-receive na ang ${row.medicine_name}.`)
  }

  function openAlert(row: EnrichedRow) {
    setAlertingId(row.id)
    setAlertQty(Math.max(0, Math.min(row.requested_qty, row.stock.inRequestUnit)))
  }

  async function submitAlert(row: EnrichedRow) {
    await updateRow(row.id, { status: 'alerted', fulfilled_qty: alertQty })
    setAlertingId(null)
    showToast(
      alertQty <= 0
        ? `⚠ Na-alert si ${SOURCE_STYLE[source].label}: walang stock ng ${row.medicine_name}.`
        : `⚠ Na-alert si ${SOURCE_STYLE[source].label}: ${alertQty}/${row.requested_qty} ${row.unit} na lang ang ${row.medicine_name}.`
    )
  }

  const requester = rows[0]?.requested_by ?? ''
  const requesterBarangay = rows[0]?.barangay ?? null
  const requestedAt = rows[0]?.requested_at
  const totalQty = rows.reduce((sum, r) => sum + r.requested_qty, 0)
  const overallStatus: ReqStatus | null = rows.length ? rollupStatus(rows.map(r => r.status)) : null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 3000,
        background: 'rgba(0,0,0,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 16,
          width: '100%', maxWidth: 980,
          maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 50px rgba(0,0,0,.25)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 22px', flexShrink: 0,
          background: '#2e7d4f', color: '#fff',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Request Details</div>
              <span style={{
                background: SOURCE_STYLE[source].bg, color: SOURCE_STYLE[source].color,
                fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 20,
                letterSpacing: '.02em',
              }}>{SOURCE_STYLE[source].label}</span>
            </div>
            {!loading && rows.length > 0 && (
              <div style={{ fontSize: 12.5, opacity: 0.9, marginTop: 4 }}>
                {formatPHT(requestedAt!)} · {requester}
                {isBarangaySource && requesterBarangay ? ` · Brgy. ${requesterBarangay}` : ''}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,.18)', border: 'none', color: '#fff',
              padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
              fontSize: 12.5, fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >✕ Close</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <p style={{ padding: '24px 22px', color: 'var(--text3, #6b8a75)', fontSize: 13 }}>Loading request…</p>
          ) : rows.length === 0 ? (
            <p style={{ padding: '24px 22px', color: 'var(--text3, #6b8a75)', fontSize: 13 }}>Request not found.</p>
          ) : (
            <>
              {/* Overall status strip */}
              <div style={{
                padding: '14px 22px', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
                borderBottom: '1px solid #e2ede5',
              }}>
                <div style={{ fontSize: 13, color: '#4c6b58' }}>
                  Overall status:{' '}
                  <span style={{
                    background: STATUS_STYLE[overallStatus!].bg, color: STATUS_STYLE[overallStatus!].color,
                    fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, marginLeft: 4,
                  }}>
                    {STATUS_STYLE[overallStatus!].label}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#6b8a75' }}>
                  {rows.length} item{rows.length !== 1 ? 's' : ''} · {totalQty} total units
                </div>
              </div>

              {/* Items table */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      {['#', 'GENERIC NAME / NAME', 'BRAND', 'DOSAGE', 'TYPE', 'QTY', 'WAREHOUSE STOCK', 'NOTES', 'STATUS', ''].map(h => (
                        <th key={h} style={{
                          textAlign: 'left', padding: '10px 16px', fontSize: 11,
                          textTransform: 'uppercase', letterSpacing: '.06em',
                          color: '#6b8a75', borderBottom: '1px solid #e2ede5', whiteSpace: 'nowrap',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => {
                      const s = STATUS_STYLE[row.status]
                      const short = row.stock.inRequestUnit < row.requested_qty
                      const isBusy = busyId === row.id
                      return (
                        <>
                          <tr key={row.id} style={{ borderBottom: alertingId === row.id ? 'none' : '1px solid #eef4f0' }}>
                            <td style={{ padding: '12px 16px', color: '#6b8a75' }}>{idx + 1}</td>
                            <td style={{ padding: '12px 16px', fontWeight: 700 }}>{row.medicine_name}</td>
                            <td style={{ padding: '12px 16px', color: '#6b8a75' }}>{row.brand_name || '—'}</td>
                            <td style={{ padding: '12px 16px' }}>{row.dosage ?? '—'}</td>
                            <td style={{ padding: '12px 16px' }}>{row.dosage_form ?? '—'}</td>
                            <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>{row.requested_qty} {row.unit}</td>
                            <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                              <span style={{ color: short ? '#a3251f' : '#1f7a44', fontWeight: 700 }}>
                                {row.stock.inRequestUnit} {row.unit}
                              </span>
                              <div style={{ fontSize: 10, color: '#9ab3a2' }}>
                                {row.stock.boxes} boxes · {row.stock.strips} strips · {row.stock.pieces} pcs
                              </div>
                            </td>
                            <td style={{ padding: '12px 16px', color: '#6b8a75', maxWidth: 180 }}>{row.notes || '—'}</td>
                            <td style={{ padding: '12px 16px' }}>
                              <span style={{
                                background: s.bg, color: s.color, fontSize: 11, fontWeight: 700,
                                padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap',
                              }}>{s.label}</span>
                            </td>
                            <td style={{ padding: '12px 16px' }}>
                              {(row.status === 'pending' || row.status === 'alerted') && (
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button
                                    disabled={isBusy}
                                    onClick={() => confirmRow(row.id)}
                                    style={{ background: '#dbeafe', color: '#2563eb', border: 'none', fontSize: 10, fontWeight: 700, padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                                  >Confirm</button>
                                  {row.status === 'pending' && (
                                    <button
                                      disabled={isBusy}
                                      onClick={() => openAlert(row)}
                                      style={{ background: '#fef3c7', color: '#92400e', border: 'none', fontSize: 10, fontWeight: 700, padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                                    >Alert</button>
                                  )}
                                  <button
                                    disabled={isBusy}
                                    onClick={() => rejectRow(row.id)}
                                    style={{ background: '#fee2e2', color: '#dc2626', border: 'none', fontSize: 10, fontWeight: 700, padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                                  >Reject</button>
                                </div>
                              )}
                              {row.status === 'confirm' && (
                                <button
                                  disabled={isBusy}
                                  onClick={() => markReceived(row)}
                                  style={{ background: '#dcf3e3', color: '#1f7a44', border: 'none', fontSize: 10, fontWeight: 700, padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                                >Mark as Received</button>
                              )}
                            </td>
                          </tr>

                          {/* Inline alert-qty form, spans the full row width */}
                          {alertingId === row.id && (
                            <tr key={`${row.id}-alert`} style={{ borderBottom: '1px solid #eef4f0' }}>
                              <td colSpan={10} style={{ padding: '0 16px 14px' }}>
                                <div style={{
                                  padding: '10px 12px', borderRadius: 10,
                                  background: '#fffbeb', border: '1px solid #fde68a',
                                }}>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: '#92400e', marginBottom: 6 }}>
                                    Ilang {row.unit} ng {row.medicine_name} ang meron sa warehouse ngayon?
                                  </div>
                                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <input
                                      type="number"
                                      min={0}
                                      max={row.requested_qty}
                                      value={alertQty}
                                      onChange={e => {
                                        const v = Number(e.target.value)
                                        setAlertQty(Math.max(0, Math.min(row.requested_qty, Number.isNaN(v) ? 0 : v)))
                                      }}
                                      style={{
                                        width: 90, padding: '6px 8px', borderRadius: 7,
                                        border: '1px solid #cfe4d6', fontSize: 12, fontFamily: 'inherit',
                                      }}
                                    />
                                    <span style={{ fontSize: 11, color: '#6b8a75' }}>/ {row.requested_qty} {row.unit} hiniling</span>
                                    <div style={{ flex: 1 }} />
                                    <button
                                      onClick={() => setAlertingId(null)}
                                      style={{ background: '#fff', color: '#4c6b58', border: '1px solid #cfe4d6', fontSize: 10, fontWeight: 600, padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}
                                    >Cancel</button>
                                    <button
                                      onClick={() => submitAlert(row)}
                                      style={{ background: '#ca8a04', color: '#fff', border: 'none', fontSize: 10, fontWeight: 700, padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}
                                    >Send Alert</button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {toast && (
        <div
          className={styles.toast}
          style={{ background: toast.startsWith('⚠') ? '#ca8a04' : toast.startsWith('✓') ? '#1f7a44' : '#dc2626' }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}