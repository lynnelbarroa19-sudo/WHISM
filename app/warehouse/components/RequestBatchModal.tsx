'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import styles from './warehouse.module.css'

type ReqStatus = 'pending' | 'confirm' | 'alerted' | 'rejected' | 'received'
type ReqCategory = 'drugs' | 'supplies'

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
}

interface EnrichedRow extends RequestRow {
  warehouseStock: number
}

interface RequestNotification {
  related_request_id: string | null
  related_batch_id: string | null
}

const STATUS_STYLE: Record<ReqStatus, { bg: string; color: string; label: string }> = {
  pending:  { bg: '#f3f4f6', color: '#6b7280', label: '● Pending'   },
  confirm:  { bg: '#dbeafe', color: '#2563eb', label: '✓ Confirmed' },
  alerted:  { bg: '#fef3c7', color: '#92400e', label: '⚠ Alerted'   },
  rejected: { bg: '#fee2e2', color: '#dc2626', label: '✗ Rejected'  },
  received: { bg: '#dcfce7', color: '#16a34a', label: '✓ Received'  },
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { month: '2-digit', day: '2-digit', year: 'numeric' })
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true })
}

/** Loose-match key for medicine names — trims, lowercases, and strips a
 *  trailing "(500mg)"-style suffix so "Paracetamol (500mg)" (legacy rows
 *  that folded dosage into the name) still matches the catalog's plain
 *  "Paracetamol". */
function normalizeMedName(s: string) {
  return s.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase()
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

  useEffect(() => { loadData() }, [notification.related_batch_id, notification.related_request_id])

  async function loadData() {
    setLoading(true)

    let query = supabase.from('pharmacy_requests').select('*')
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
      console.error('RequestBatchModal: fetch requests error', reqErr)
      setLoading(false)
      return
    }

    // Warehouse stock: sum of available + low_stock batches, matched by
    // name. Pharmacists type the medicine name freely (sometimes with the
    // dosage tacked on, e.g. "Paracetamol (500mg)"), so we normalize both
    // sides and match against either the catalog's generic OR brand name
    // instead of requiring an exact string match.
    const { data: batchData } = await supabase
      .from('medicine_batches')
      .select('total_quantity, status, medicines(generic_name, brand_name)')
      .in('status', ['available', 'low_stock'])
    const stockMap = new Map<string, number>()
    for (const row of (batchData ?? []) as unknown as { total_quantity: number; medicines: { generic_name: string; brand_name: string | null } | { generic_name: string; brand_name: string | null }[] | null }[]) {
      const medRel = row.medicines
      const med = Array.isArray(medRel) ? medRel[0] : medRel
      if (!med) continue
      const qty = row.total_quantity ?? 0
      for (const raw of [med.generic_name, med.brand_name]) {
        if (!raw) continue
        const key = normalizeMedName(raw)
        stockMap.set(key, (stockMap.get(key) ?? 0) + qty)
      }
    }

    const enriched: EnrichedRow[] = (reqData as RequestRow[]).map(r => ({
      ...r,
      warehouseStock: stockMap.get(normalizeMedName(r.medicine_name)) ?? 0,
    }))

    setRows(enriched)
    setLoading(false)
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }

  async function updateRow(id: string, patch: Partial<RequestRow>) {
    setBusyId(id)
    const { error } = await supabase.from('pharmacy_requests').update(patch).eq('id', id)
    if (!error) {
      setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
    } else {
      console.error('RequestBatchModal: update error', error)
      showToast('✗ Failed to update.')
    }
    setBusyId(null)
  }

  const confirmRow = (id: string) => updateRow(id, { status: 'confirm' })
  const rejectRow  = (id: string) => updateRow(id, { status: 'rejected' })
  const receiveRow = (id: string) => updateRow(id, { status: 'received' })

  function openAlert(row: EnrichedRow) {
    setAlertingId(row.id)
    setAlertQty(Math.max(0, Math.min(row.requested_qty, row.warehouseStock)))
  }

  async function submitAlert(row: EnrichedRow) {
    await updateRow(row.id, { status: 'alerted', fulfilled_qty: alertQty })
    setAlertingId(null)
    showToast(
      alertQty <= 0
        ? `⚠ Na-alert si pharmacy: walang stock ng ${row.medicine_name}.`
        : `⚠ Na-alert si pharmacy: ${alertQty}/${row.requested_qty} ${row.unit} na lang ang ${row.medicine_name}.`
    )
  }

  const requester = rows[0]?.requested_by ?? ''
  const requestedAt = rows[0]?.requested_at
  // "Reason" was submitted once for the whole request and stored in each
  // row's `notes` — every row in the batch carries the same value.
  const reason = rows[0]?.notes?.trim() || ''
  // Prefer the shared batch id (multi-item requests); fall back to the
  // single row's own id for legacy/one-item requests that predate batching.
  const requestId = notification.related_batch_id || rows[0]?.request_batch_id || rows[0]?.id || ''

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
          background: 'var(--surface, #fff)',
          borderRadius: 16,
          width: '100%', maxWidth: 920,
          maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 50px rgba(0,0,0,.25)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0, gap: 12,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>
              Restock Request
            </div>
            {!loading && rows.length > 0 && (
              <>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                  {requester} · {formatDate(requestedAt!)} · {formatTime(requestedAt!)} · {rows.length} medicine{rows.length !== 1 ? 's' : ''}
                </div>
                {requestId && (
                  <div style={{
                    fontSize: 10.5, color: 'var(--text3)', marginTop: 6,
                    display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                  }}>
                    <span style={{ fontWeight: 700 }}>Request ID:</span>
                    <span style={{
                      fontFamily: 'monospace', fontSize: 10.5, color: 'var(--text2)',
                      background: 'var(--surface2)', border: '1px solid var(--border)',
                      borderRadius: 6, padding: '2px 7px', wordBreak: 'break-all',
                    }}>{requestId}</span>
                  </div>
                )}
                {reason && (
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6, maxWidth: 620 }}>
                    <span style={{ fontWeight: 700, color: 'var(--text3)' }}>Reason: </span>{reason}
                  </div>
                )}
              </>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'var(--surface2)', border: 'none', color: 'var(--text2)',
              width: 28, height: 28, borderRadius: 8, cursor: 'pointer',
              fontSize: 14, fontWeight: 700, lineHeight: 1, flexShrink: 0,
            }}
          >✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
          {loading ? (
            <p className={styles.emptyText} style={{ padding: '24px 0' }}>Loading request…</p>
          ) : rows.length === 0 ? (
            <p className={styles.emptyText} style={{ padding: '24px 0' }}>Request not found.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {rows.map(row => {
                const s = STATUS_STYLE[row.status]
                const short = row.warehouseStock < row.requested_qty
                const isBusy = busyId === row.id
                return (
                  <div
                    key={row.id}
                    style={{
                      border: '1px solid var(--border)', borderRadius: 12,
                      padding: '14px 16px', background: 'var(--surface2)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 260 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{row.medicine_name}</span>
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                            background: 'var(--surface)', color: 'var(--text3)', textTransform: 'capitalize',
                          }}>
                            {row.category}
                          </span>
                          <span style={{ background: s.bg, color: s.color, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>
                            {s.label}
                          </span>
                        </div>

                        <div style={{
                          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                          gap: '6px 16px', fontSize: 11, color: 'var(--text2)',
                        }}>
                          <div><span style={{ color: 'var(--text3)' }}>Dosage: </span><strong>{row.dosage ?? '—'}</strong></div>
                          <div><span style={{ color: 'var(--text3)' }}>Type: </span><strong>{row.dosage_form ?? '—'}</strong></div>
                          <div><span style={{ color: 'var(--text3)' }}>Unit: </span><strong>{row.unit}</strong></div>
                          <div><span style={{ color: 'var(--text3)' }}>Quantity: </span><strong>{row.requested_qty} {row.unit}</strong></div>
                          <div>
                            <span style={{ color: 'var(--text3)' }}>Warehouse stock: </span>
                            <strong style={{ color: short ? '#dc2626' : '#16a34a' }}>{row.warehouseStock} {row.unit}</strong>
                          </div>
                        </div>

                        {row.status === 'alerted' && row.fulfilled_qty != null && (
                          <div style={{ marginTop: 8, fontSize: 11, color: '#92400e', fontWeight: 600 }}>
                            ⚠ Na-alert kay pharmacy: {row.fulfilled_qty}/{row.requested_qty} {row.unit} lang ang available.
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                        {(row.status === 'pending' || row.status === 'alerted') && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              disabled={isBusy}
                              onClick={() => confirmRow(row.id)}
                              style={{ background: '#dbeafe', color: '#2563eb', border: 'none', fontSize: 10, fontWeight: 700, padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}
                            >Confirm</button>
                            {row.status === 'pending' && (
                              <button
                                disabled={isBusy}
                                onClick={() => openAlert(row)}
                                style={{ background: '#fef3c7', color: '#92400e', border: 'none', fontSize: 10, fontWeight: 700, padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}
                              >Alert</button>
                            )}
                            <button
                              disabled={isBusy}
                              onClick={() => rejectRow(row.id)}
                              style={{ background: '#fee2e2', color: '#dc2626', border: 'none', fontSize: 10, fontWeight: 700, padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}
                            >Reject</button>
                          </div>
                        )}
                        {row.status === 'confirm' && (
                          <button
                            disabled={isBusy}
                            onClick={() => receiveRow(row.id)}
                            style={{ background: '#16a34a', color: '#fff', border: 'none', fontSize: 10, fontWeight: 700, padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}
                          >Mark received</button>
                        )}
                      </div>
                    </div>

                    {/* Inline alert-qty form */}
                    {alertingId === row.id && (
                      <div style={{
                        marginTop: 10, padding: '10px 12px', borderRadius: 10,
                        background: '#fffbeb', border: '1px solid #fde68a',
                      }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#92400e', marginBottom: 6 }}>
                          Ilang {row.unit} ng {row.medicine_name} ang meron sa warehouse ngayon?
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
                              border: '1px solid var(--border)', fontSize: 12, fontFamily: 'inherit',
                            }}
                          />
                          <span style={{ fontSize: 11, color: 'var(--text3)' }}>/ {row.requested_qty} {row.unit} hiniling</span>
                          <div style={{ flex: 1 }} />
                          <button
                            onClick={() => setAlertingId(null)}
                            style={{ background: 'var(--surface)', color: 'var(--text2)', border: '1px solid var(--border)', fontSize: 10, fontWeight: 600, padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}
                          >Cancel</button>
                          <button
                            onClick={() => submitAlert(row)}
                            style={{ background: '#ca8a04', color: '#fff', border: 'none', fontSize: 10, fontWeight: 700, padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}
                          >Send Alert</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div className={styles.toast} style={{ background: toast.startsWith('⚠') ? '#ca8a04' : '#dc2626' }}>
          {toast}
        </div>
      )}
    </div>
  )
}