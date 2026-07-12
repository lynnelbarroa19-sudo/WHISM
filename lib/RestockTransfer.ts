// lib/restockTransfer.ts
//
// SINGLE SOURCE OF TRUTH for moving stock from the WAREHOUSE to the PHARMACY
// when a restock request is confirmed.
//
// Flow (all triggered by one "Confirm" click on the warehouse side):
//   1. Work out how many PIECES the request represents.
//        box unit   → requested_boxes × pieces_per_box_snapshot (+ any loose pieces)
//        piece unit → requested_partial_pieces (the plain qty)
//   2. Deduct those pieces from warehouse_medicines (FEFO — earliest expiry first).
//   3. Add the same pieces to pharma_medicines (creates the row if it doesn't exist).
//   4. Mark the restock_requests row as 'confirmed'.
//
// ── THIS IS THE ONLY PLACE THAT MAY EVER ADD STOCK TO pharma_medicines AS
// PART OF A RESTOCK CONFIRMATION. RestockConfirmListener.tsx used to ALSO
// add stock on the same status-change event, which doubled every addition
// (confirmRestockTransfer adds once, the listener added again). That
// listener has been retired — see RestockConfirmListener.tsx. Do not
// reintroduce a second writer for this event without removing this one
// first. ──────────────────────────────────────────────────────────────────
//
// ── BOXES / STRIPS ("banig") / PIECES ──────────────────────────────────────────
//   The schema tracks two levels: box → pieces, via `pieces_per_box`.
//   Example: 1 box = 10 strips (banig), 1 strip = 12 pieces.
//   Store that as   pieces_per_box = 10 × 12 = 120.
//   Then 1 box = 120 pieces falls out of the math automatically.
//   (To show strips in the UI later: strips = Math.floor(pieces / 12).)
//
// ── COLUMN NAME DIFFERENCE (important) ─────────────────────────────────────────
//   warehouse_medicines uses:  pcs_per_box , partial_pcs
//   pharma_medicines    uses:  pieces_per_box , partial_pieces
//   This file deliberately reads/writes the correct names for each table.

import { supabase } from '@/lib/supabase'

export interface RestockRequestRow {
  id: string
  medicine_name: string
  dosage: string | null
  medicine_type: string | null
  unit: string
  quantity: number
  requested_boxes: number | null
  requested_partial_pieces: number | null
  pieces_per_box_snapshot: number | null
}

export interface TransferResult {
  ok: boolean
  movedPieces: number
  reason?: string
}

const IS_BOX_UNIT = (unit: string) =>
  !!unit && (unit.toLowerCase().includes('box') || unit.toLowerCase() === 'boxes')

/**
 * Confirms a restock request and moves the stock warehouse → pharmacy.
 * Returns { ok, movedPieces, reason } so the caller can show a toast.
 *
 * ── IDEMPOTENCY GUARD ──────────────────────────────────────────────────────
 * Re-checks the request's current status before doing anything. If it's
 * already 'confirmed' (e.g. a duplicate click, or a retry after a network
 * blip where the first call actually succeeded), this bails out immediately
 * instead of moving stock a second time. This is the same class of bug that
 * RestockConfirmListener.tsx caused via a separate code path — guarding
 * here protects against accidental double-calls of THIS function too, not
 * just against a second competing system.
 */
export async function confirmRestockTransfer(req: RestockRequestRow): Promise<TransferResult> {
  // ── Guard: bail out if this request was already confirmed ─────────────
  const { data: freshRow, error: freshErr } = await supabase
    .from('restock_requests')
    .select('status')
    .eq('id', req.id)
    .single()

  if (freshErr) {
    return { ok: false, movedPieces: 0, reason: freshErr.message }
  }
  if (freshRow?.status === 'confirmed') {
    return { ok: false, movedPieces: 0, reason: 'This request was already confirmed.' }
  }

  const isBox = IS_BOX_UNIT(req.unit)
  const piecesPerBox =
    isBox && req.pieces_per_box_snapshot && req.pieces_per_box_snapshot > 0
      ? req.pieces_per_box_snapshot
      : 10

  const reqBoxes   = req.requested_boxes ?? 0
  const reqPartial = req.requested_partial_pieces ?? 0

  // Total pieces this request moves.
  const totalPieces = isBox
    ? reqBoxes * piecesPerBox + reqPartial
    : (reqPartial > 0 ? reqPartial : req.quantity)

  if (totalPieces <= 0) {
    return { ok: false, movedPieces: 0, reason: 'Requested quantity is zero.' }
  }

  // 1 + 2: deduct from warehouse (FEFO)
  const deduct = await deductFromWarehouse(req.medicine_name, totalPieces)
  if (!deduct.ok) return { ok: false, movedPieces: 0, reason: deduct.reason }

  // 3: add to pharmacy
  const add = await addToPharmacy(req, totalPieces, isBox, piecesPerBox, deduct.expDate)
  if (!add.ok) {
    return {
      ok: false,
      movedPieces: totalPieces,
      reason: `Warehouse was deducted but the pharmacy update failed (${add.reason}). Please reconcile manually.`,
    }
  }

  // 4: confirm the request
  const { error } = await supabase
    .from('restock_requests')
    .update({ status: 'confirmed' })
    .eq('id', req.id)
  if (error) return { ok: false, movedPieces: totalPieces, reason: error.message }

  return { ok: true, movedPieces: totalPieces }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * WAREHOUSE side — deduct `piecesNeeded` pieces, FEFO (earliest expiry first).
 * Drains loose pieces (partial_pcs) first, then opens whole boxes.
 * Returns the earliest expiry it touched, so a brand-new pharmacy row can
 * inherit a sensible exp_date.
 * ─────────────────────────────────────────────────────────────────────────── */
async function deductFromWarehouse(
  medName: string,
  piecesNeeded: number,
): Promise<{ ok: boolean; reason?: string; expDate?: string }> {
  const { data: batches, error } = await supabase
    .from('warehouse_medicines')
    .select('id, quantity, boxes, pcs_per_box, partial_pcs, exp_date')
    .eq('archived', false)
    .ilike('med_name', medName.trim())
    .gt('quantity', 0)
    .order('exp_date', { ascending: true })

  if (error)             return { ok: false, reason: error.message }
  if (!batches?.length)  return { ok: false, reason: `No warehouse stock found for "${medName}".` }

  const totalAvailable = batches.reduce((s, b) => s + (b.quantity ?? 0), 0)
  if (totalAvailable < piecesNeeded) {
    return {
      ok: false,
      reason: `Not enough warehouse stock: need ${piecesNeeded} pcs, only ${totalAvailable} available.`,
    }
  }

  let remaining = piecesNeeded
  let earliestExp: string | undefined

  for (const batch of batches) {
    if (remaining <= 0) break

    const pcsPerBox  = batch.pcs_per_box ?? 1
    let   partialPcs = batch.partial_pcs ?? 0
    let   boxes      = batch.boxes ?? 0
    const totalQty   = batch.quantity ?? 0

    const take = Math.min(remaining, totalQty)
    let   need = take

    if (!earliestExp) earliestExp = batch.exp_date

    // Drain loose pieces first, then open whole boxes as needed.
    if (partialPcs >= need) {
      partialPcs -= need
    } else {
      need -= partialPcs
      partialPcs = 0
      const boxesToOpen  = Math.min(Math.ceil(need / pcsPerBox), boxes)
      const piecesOpened = boxesToOpen * pcsPerBox
      boxes     -= boxesToOpen
      const leftover = piecesOpened - need        // leftover from the last opened box
      partialPcs = leftover > 0 ? leftover : 0
    }

    const { error: upErr } = await supabase
      .from('warehouse_medicines')
      .update({ quantity: totalQty - take, boxes, partial_pcs: partialPcs })
      .eq('id', batch.id)
    if (upErr) return { ok: false, reason: upErr.message }

    remaining -= take
  }

  if (remaining > 0) return { ok: false, reason: 'Could not fully deduct across warehouse batches.' }
  return { ok: true, expDate: earliestExp }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * PHARMACY side — add `piecesToAdd` pieces. Updates the existing row if the
 * medicine already exists (non-archived), otherwise creates a fresh row.
 * Recomputes boxes / partial_pieces from the new piece total.
 * ─────────────────────────────────────────────────────────────────────────── */
async function addToPharmacy(
  req: RestockRequestRow,
  piecesToAdd: number,
  isBox: boolean,
  piecesPerBox: number,
  expDate?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const { data: rows, error: findErr } = await supabase
    .from('pharma_medicines')
    .select('id, quantity, boxes, partial_pieces, pieces_per_box')
    .ilike('med_name', req.medicine_name.trim())
    .eq('archived', false)
    .limit(1)
  if (findErr) return { ok: false, reason: findErr.message }

  const existing = rows?.[0]

  if (existing) {
    const ppb = isBox && (existing.pieces_per_box ?? 0) > 0 ? existing.pieces_per_box : piecesPerBox
    const currentTotal =
      isBox && ((existing.boxes ?? 0) > 0 || (existing.partial_pieces ?? 0) > 0)
        ? (existing.boxes ?? 0) * ppb + (existing.partial_pieces ?? 0)
        : existing.quantity
    const newTotal = currentTotal + piecesToAdd

    const payload: Record<string, number> = { quantity: newTotal }
    if (isBox) {
      payload.pieces_per_box = ppb
      payload.boxes          = Math.floor(newTotal / ppb)
      payload.partial_pieces = newTotal % ppb
    }
    const { error } = await supabase.from('pharma_medicines').update(payload).eq('id', existing.id)
    return error ? { ok: false, reason: error.message } : { ok: true }
  }

  // No existing pharmacy row → create one (first-time stock for this medicine).
  const payload: Record<string, any> = {
    med_name:       req.medicine_name,
    med_dosage:     req.dosage ?? '',
    med_type:       req.medicine_type ?? '',
    unit:           req.unit,
    exp_date:       expDate ?? new Date().toISOString().split('T')[0],
    quantity:       piecesToAdd,
    archived:       false,
    boxes:          isBox ? Math.floor(piecesToAdd / piecesPerBox) : 0,
    pieces_per_box: isBox ? piecesPerBox : 10,
    partial_pieces: isBox ? piecesToAdd % piecesPerBox : 0,
  }
  const { error } = await supabase.from('pharma_medicines').insert([payload])
  return error ? { ok: false, reason: error.message } : { ok: true }
}