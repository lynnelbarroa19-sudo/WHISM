'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import styles from './warehouse.module.css'

/**
 * Deducts warehouse stock the moment a `pharmacy_requests` item's status
 * becomes 'received'. Mount this ONCE somewhere that's always alive while
 * Warehouse is in use (e.g. the warehouse layout) — it has no UI besides a
 * toast, and does not depend on RequestBatchModal being open.
 *
 * Requires a `stock_deducted boolean default false` column on
 * `pharmacy_requests` (see pharmacy_requests_migration.sql) so a row is
 * only ever deducted once, even if this component re-mounts or the
 * realtime event fires more than once.
 */

interface ReceivedRequest {
  id: string
  medicine_name: string
  requested_qty: number
  unit: string
  status: string
  stock_deducted: boolean
}

interface RawMedicine {
  generic_name: string
  brand_name: string | null
}

interface RawBatch {
  batch_id: string
  boxes: number
  strips_per_box: number | null
  pieces_per_strip: number | null
  loose_pieces: number
  total_quantity: number
  expiration_date: string | null
  status: string
  medicines: RawMedicine | RawMedicine[] | null
}

function normalizeMedName(s: string) {
  return s.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase()
}

function resolveUnitBucket(unit: string): 'box' | 'strip' | 'piece' {
  const u = (unit ?? '').toLowerCase().trim()
  if (u.startsWith('box')) return 'box'
  if (u.startsWith('strip')) return 'strip'
  return 'piece'
}

export default function ReceivedStockListener() {
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' } | null>(null)
  const processingIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    checkMissedRequests()

    const channel = supabase
      .channel('pharmacy_requests_received_listener')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pharmacy_requests' },
        (payload) => {
          const row = payload.new as ReceivedRequest
          if (row.status === 'received' && !row.stock_deducted) {
            handleReceived(row)
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function checkMissedRequests() {
    const { data, error } = await supabase
      .from('pharmacy_requests')
      .select('id, medicine_name, requested_qty, unit, status, stock_deducted')
      .eq('status', 'received')
      .eq('stock_deducted', false)

    if (error) {
      console.error('ReceivedStockListener: checkMissedRequests error', error)
      return
    }
    if (data) {
      for (const row of data as ReceivedRequest[]) handleReceived(row)
    }
  }

  async function handleReceived(row: ReceivedRequest) {
    if (processingIds.current.has(row.id)) return
    processingIds.current.add(row.id)

    const result = await deductStock(row)

    if (result.ok) {
      const { error: markErr } = await supabase
        .from('pharmacy_requests')
        .update({ stock_deducted: true })
        .eq('id', row.id)

      if (markErr) {
        console.error('ReceivedStockListener: failed to mark stock_deducted', markErr)
      }
    } else {
      console.warn('ReceivedStockListener: deduction failed, will retry next time', row.id, result.reason)
    }

    setToast(
      result.ok
        ? { message: `Stock updated — deducted ${row.requested_qty} ${row.unit} of ${row.medicine_name}.`, type: 'success' }
        : { message: `Received "${row.medicine_name}", but couldn't auto-deduct stock: ${result.reason}. Check manually.`, type: 'warning' }
    )
    setTimeout(() => setToast(null), 5000)

    processingIds.current.delete(row.id)
  }

  /**
   * Deducts `row.requested_qty` (in the request's own unit) from
   * warehouse stock, FEFO (earliest expiration_date first), matching the
   * same batch-matching rule as RequestBatchModal: a batch is matched by
   * its brand name if it has one, otherwise its generic name — so a
   * plain "Paracetamol" receipt never touches Biogesic-branded stock,
   * and vice versa.
   *
   * `total_quantity` is DB-generated (boxes*strips_per_box*pieces_per_strip
   * + loose_pieces), always in pieces, so the requested unit is converted
   * to pieces using the earliest-expiry matching batch's own packaging,
   * then drained loose-pieces-first, opening boxes only as needed —
   * leftover pieces from an opened box go back into loose_pieces.
   */
  async function deductStock(row: ReceivedRequest): Promise<{ ok: boolean; reason?: string }> {
    const { data: batches, error } = await supabase
      .from('medicine_batches')
      .select('batch_id, boxes, strips_per_box, pieces_per_strip, loose_pieces, total_quantity, expiration_date, status, medicines(generic_name, brand_name)')
      .in('status', ['available', 'low_stock'])
      .order('expiration_date', { ascending: true })

    if (error || !batches) {
      return { ok: false, reason: 'Could not load warehouse batches' }
    }

    const requestKey = normalizeMedName(row.medicine_name)
    const matching = (batches as unknown as RawBatch[]).filter((b) => {
      const medRel = b.medicines
      const med = Array.isArray(medRel) ? medRel[0] : medRel
      if (!med) return false
      const effectiveName = (med.brand_name && med.brand_name.trim()) ? med.brand_name : med.generic_name
      if (!effectiveName) return false
      return normalizeMedName(effectiveName) === requestKey
    })

    if (matching.length === 0) {
      return { ok: false, reason: 'No matching medicine found in warehouse' }
    }

    const bucket = resolveUnitBucket(row.unit)
    const first = matching[0]
    const stripsPerBox = first.strips_per_box ?? 0
    const piecesPerStrip = first.pieces_per_strip ?? 0

    let piecesNeeded: number
    if (bucket === 'box') {
      const piecesPerBox = stripsPerBox * piecesPerStrip
      if (piecesPerBox <= 0) {
        return { ok: false, reason: `packaging (strips per box / pieces per strip) not set for "${row.medicine_name}"` }
      }
      piecesNeeded = row.requested_qty * piecesPerBox
    } else if (bucket === 'strip') {
      if (piecesPerStrip <= 0) {
        return { ok: false, reason: `pieces per strip not set for "${row.medicine_name}"` }
      }
      piecesNeeded = row.requested_qty * piecesPerStrip
    } else {
      piecesNeeded = row.requested_qty
    }

    const totalAvailable = matching.reduce((sum, b) => sum + (b.total_quantity ?? 0), 0)
    if (totalAvailable < piecesNeeded) {
      return { ok: false, reason: `insufficient stock: need ${piecesNeeded} pcs, only ${totalAvailable} available` }
    }

    let remaining = piecesNeeded
    for (const batch of matching) {
      if (remaining <= 0) break

      const bStripsPerBox = batch.strips_per_box ?? 0
      const bPiecesPerStrip = batch.pieces_per_strip ?? 0
      const piecesPerBox = bStripsPerBox * bPiecesPerStrip
      let boxes = batch.boxes ?? 0
      let loose = batch.loose_pieces ?? 0
      const batchTotal = batch.total_quantity ?? 0

      const takeFromBatch = Math.min(remaining, batchTotal)
      let take = takeFromBatch

      if (loose >= take) {
        loose -= take
        take = 0
      } else {
        take -= loose
        loose = 0
        if (piecesPerBox > 0) {
          const boxesNeeded = Math.ceil(take / piecesPerBox)
          const boxesToOpen = Math.min(boxesNeeded, boxes)
          const piecesFromBoxes = boxesToOpen * piecesPerBox
          boxes -= boxesToOpen
          const leftover = piecesFromBoxes - take
          loose = leftover > 0 ? leftover : 0
          take = 0
        }
      }

      const { error: updErr } = await supabase
        .from('medicine_batches')
        .update({ boxes, loose_pieces: loose })
        .eq('batch_id', batch.batch_id)

      if (updErr) {
        console.error('ReceivedStockListener: batch update failed', batch.batch_id, updErr)
        return { ok: false, reason: `failed to update batch ${batch.batch_id}: ${updErr.message}` }
      }

      remaining -= takeFromBatch
    }

    if (remaining > 0) {
      return { ok: false, reason: 'insufficient stock across matched batches' }
    }
    return { ok: true }
  }

  if (!toast) return null

  return (
    <div
      className={styles.toast}
      style={{ background: toast.type === 'warning' ? '#f59e0b' : undefined }}
    >
      {toast.type === 'success' ? '✓' : '⚠'} {toast.message}
    </div>
  )
}