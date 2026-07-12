'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import styles from './warehouse.module.css'

interface RestockItem {
  qty: number
  type: string    // 'box' | 'boxes' | 'pcs' | 'tablet' | 'piece' | etc.
  unit: string
  dosage: string
  medicine: string
}

interface RestockRequest {
  id: string
  items: RestockItem[]
  status: string
  stock_deducted: boolean
}

interface Props {
  onStockChanged?: () => void
}

/**
 * Resolves the request unit into one of two buckets:
 *   'box'   → deduct qty × pcs_per_box from warehouse
 *   'piece' → deduct qty directly (tablet, capsule, pcs, vial, bottle, etc.)
 */
function resolveUnitBucket(type: string, unit: string): 'box' | 'piece' {
  const t = (type ?? '').toLowerCase().trim()
  const u = (unit ?? '').toLowerCase().trim()
  if (t === 'box' || t === 'boxes' || u === 'box' || u === 'boxes') return 'box'
  return 'piece'
}

export default function RestockListener({ onStockChanged }: Props) {
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' } | null>(null)
  const processingIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    checkMissedRequests()

    const channel = supabase
      .channel('pharma_restock_listener')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pharma_restock_request' },
        (payload) => {
          const row = payload.new as RestockRequest
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
    const { data } = await supabase
      .from('pharma_restock_request')
      .select('id, items, status, stock_deducted')
      .eq('status', 'received')
      .eq('stock_deducted', false)

    if (data) {
      for (const row of data) handleReceived(row as RestockRequest)
    }
  }

  async function handleReceived(row: RestockRequest) {
    if (processingIds.current.has(row.id)) return
    processingIds.current.add(row.id)

    const results: { medicine: string; ok: boolean; reason?: string }[] = []
    for (const item of row.items || []) {
      results.push(await deductStock(item))
    }

    await supabase
      .from('pharma_restock_request')
      .update({ stock_deducted: true })
      .eq('id', row.id)

    const failed = results.filter(r => !r.ok)
    if (failed.length === 0) {
      setToast({
        message: `Stock updated — pharmacist confirmed receipt of ${results.length} item${results.length !== 1 ? 's' : ''}.`,
        type: 'success',
      })
    } else {
      setToast({
        message: `Received, but ${failed.length} item${failed.length !== 1 ? 's' : ''} couldn't be matched or had insufficient stock. Check manually.`,
        type: 'warning',
      })
    }

    setTimeout(() => setToast(null), 5000)
    onStockChanged?.()
  }

  /**
   * Deducts stock using FEFO (First Expiry, First Out).
   *
   * Deduction always converts to PIECES first:
   *   - box request  → qty × pcs_per_box  (fails with warning if pcs_per_box is NULL)
   *   - piece request → qty as-is
   *
   * Then drains partial_pcs first, then full boxes.
   * Leftover pcs from an opened box go back into partial_pcs.
   */
  async function deductStock(item: RestockItem): Promise<{ medicine: string; ok: boolean; reason?: string }> {
    const unitBucket = resolveUnitBucket(item.type, item.unit)

    const { data: batches, error } = await supabase
      .from('warehouse_medicines')
      .select('id, quantity, boxes, pcs_per_box, partial_pcs, exp_date')
      .eq('archived', false)
      .ilike('med_name', item.medicine.trim())
      .gt('quantity', 0)
      .order('exp_date', { ascending: true })

    if (error || !batches || batches.length === 0) {
      return { medicine: item.medicine, ok: false, reason: 'No matching medicine found in warehouse' }
    }

    // Convert requested qty to total pieces
    let totalPiecesToDeduct: number

    if (unitBucket === 'box') {
      const pcsPerBox = batches[0].pcs_per_box
      if (!pcsPerBox || pcsPerBox === 0) {
        return {
          medicine: item.medicine,
          ok: false,
          reason: `pcs_per_box is not set for "${item.medicine}" — cannot calculate box deduction. Please update the medicine record.`,
        }
      }
      totalPiecesToDeduct = item.qty * pcsPerBox
    } else {
      totalPiecesToDeduct = item.qty
    }

    // Check total availability
    const totalAvailable = batches.reduce((sum, b) => sum + (b.quantity ?? 0), 0)
    if (totalAvailable < totalPiecesToDeduct) {
      return {
        medicine: item.medicine,
        ok: false,
        reason: `Insufficient stock: need ${totalPiecesToDeduct} pcs, only ${totalAvailable} available`,
      }
    }

    // FEFO deduction
    let remaining = totalPiecesToDeduct

    for (const batch of batches) {
      if (remaining <= 0) break

      const pcsPerBox  = batch.pcs_per_box ?? 1
      let   partialPcs = batch.partial_pcs ?? 0
      let   boxes      = batch.boxes       ?? 0
      const totalQty   = batch.quantity    ?? 0

      const takeFromBatch = Math.min(remaining, totalQty)
      let   take          = takeFromBatch

      // 1. Drain partial_pcs first
      if (partialPcs >= take) {
        partialPcs -= take
        take = 0
      } else {
        take -= partialPcs
        partialPcs = 0

        // 2. Open boxes as needed
        const boxesNeeded = Math.ceil(take / pcsPerBox)
        const boxesToOpen = Math.min(boxesNeeded, boxes)
        const piecesFromBoxes = boxesToOpen * pcsPerBox

        boxes -= boxesToOpen

        // Leftover from opened box back to partial_pcs
        const leftover = piecesFromBoxes - take
        partialPcs = leftover > 0 ? leftover : 0
        take = 0
      }

      await supabase
        .from('warehouse_medicines')
        .update({
          quantity:    totalQty - takeFromBatch,
          boxes:       boxes,
          partial_pcs: partialPcs,
        })
        .eq('id', batch.id)

      remaining -= takeFromBatch
    }

    if (remaining > 0) {
      return { medicine: item.medicine, ok: false, reason: 'Insufficient stock across all batches' }
    }
    return { medicine: item.medicine, ok: true }
  }

  if (!toast) return null

  return (
    <div
      className={styles.toast}
      style={toast.type === 'warning' ? { background: '#f59e0b' } : undefined}
    >
      {toast.type === 'success' ? '✓' : '⚠'} {toast.message}
    </div>
  )
}