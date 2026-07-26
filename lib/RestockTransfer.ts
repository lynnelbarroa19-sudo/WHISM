// lib/restockTransfer.ts
//
// SINGLE SOURCE OF TRUTH for moving stock from the WAREHOUSE to the PHARMACY
// when a restock request is confirmed.
//
// Flow (all triggered by one "Confirm" click on the warehouse side):
//   1. Work out how many PIECES the request represents.
//        box unit   → requested_boxes × pieces_per_box_snapshot (+ any loose pieces)
//        piece unit → requested_partial_pieces (the plain qty)
//   2. Deduct those pieces from medicine_batches (FEFO — earliest expiry first).
//   3. Add the same pieces to pharma_medicines (creates the row if it doesn't exist).
//   4. Mark the pharma_restock_requests row as 'confirmed'.
//
// ── THIS IS THE ONLY PLACE THAT MAY EVER ADD STOCK TO pharma_medicines AS
// PART OF A RESTOCK CONFIRMATION. RestockConfirmListener.tsx used to ALSO
// add stock on the same status-change event, which doubled every addition
// (confirmRestockTransfer adds once, the listener added again). That
// listener has been retired — see RestockConfirmListener.tsx. Do not
// reintroduce a second writer for this event without removing this one
// first. ──────────────────────────────────────────────────────────────────
//
// ── TABLE / PRIMARY KEY for restock requests (this was bug #1) ─────────────
//   The actual table is `pharma_restock_requests`, NOT `restock_requests`.
//   Its primary key column is `restock_request_id`, NOT `id`. `req.id` is
//   still fine as the field name on RestockRequestRow (the caller aliases
//   restock_request_id → id when selecting) — but every Supabase call must
//   target the real table/column names below.
//
// ── WAREHOUSE SCHEMA (this was bug #2) ──────────────────────────────────────
//   There is no `warehouse_medicines` table. Warehouse stock actually lives
//   across two tables:
//     medicines         — one row per medicine (medicine_id, generic_name, ...)
//     medicine_batches  — one row per batch of that medicine, with:
//         boxes             integer
//         strips_per_box    integer | null
//         pieces_per_strip  integer | null
//         loose_pieces      integer
//         total_quantity    GENERATED ALWAYS AS
//                              (boxes * COALESCE(strips_per_box,0) * COALESCE(pieces_per_strip,0))
//                              + loose_pieces
//                            STORED   ← read-only, never write to this column directly
//   So "pieces per box" for a batch = strips_per_box × pieces_per_strip (both
//   may be null, which the generated column treats as 0 — meaning that
//   batch's boxes don't count toward its available pieces at all, only its
//   loose_pieces do). This file mirrors that same rule when opening boxes.
//
// ── COLUMN NAME DIFFERENCE (important) ─────────────────────────────────────────
//   medicine_batches (warehouse) uses:  boxes, strips_per_box, pieces_per_strip, loose_pieces
//   pharma_medicines            uses:  boxes, pieces_per_box, partial_pieces
//   This file deliberately reads/writes the correct names for each table.
//
// ── BOX-UNIT REQUESTS WITH NO requested_boxes (this was bug #3) ─────────────
//   Some restock requests have unit = "box" but requested_boxes /
//   requested_partial_pieces were never populated (legacy rows, or a form
//   path that only ever wrote `quantity`). Previously the box branch below
//   had NO fallback to `quantity` in that case, so totalPieces came out to
//   0 and confirmRestockTransfer failed with "Requested quantity is zero."
//   even though the request clearly had a real quantity on it. The piece
//   branch already had this fallback (`reqPartial > 0 ? reqPartial :
//   req.quantity`) — the box branch now mirrors it, and also adds
//   requested_partial_pieces (loose pieces on top of full boxes) into the
//   total, which was previously dropped entirely.

import { supabase } from '@/lib/supabase'

// Table + PK for the restock requests table — must match PharmacyRequestsCard.tsx.
const RESTOCK_TABLE = 'pharma_restock_requests'
const RESTOCK_PK    = 'restock_request_id'

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
    .from(RESTOCK_TABLE)
    .select('status')
    .eq(RESTOCK_PK, req.id)
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
  //
  // Box branch: normally reqBoxes/reqPartial drive the total. But if BOTH
  // are 0 (unit says "box" yet nothing was ever recorded in those columns —
  // a legacy/incomplete request), fall back to `quantity` instead of
  // silently computing 0, mirroring what the piece branch already does.
  const totalPieces = isBox
    ? (reqBoxes > 0 || reqPartial > 0
        ? reqBoxes * piecesPerBox + reqPartial
        : req.quantity)
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
    .from(RESTOCK_TABLE)
    .update({ status: 'confirmed' })
    .eq(RESTOCK_PK, req.id)
  if (error) return { ok: false, movedPieces: totalPieces, reason: error.message }

  return { ok: true, movedPieces: totalPieces }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * WAREHOUSE side — deduct `piecesNeeded` pieces, FEFO (earliest expiry first),
 * from medicine_batches for the given medicine.
 *
 * Drains loose_pieces first, then opens whole boxes (boxes × strips_per_box ×
 * pieces_per_strip pieces each — 0 if either factor is null, matching how
 * total_quantity itself is generated). Returns the earliest expiry it
 * touched, so a brand-new pharmacy row can inherit a sensible exp_date.
 * ─────────────────────────────────────────────────────────────────────────── */
async function deductFromWarehouse(
  medName: string,
  piecesNeeded: number,
): Promise<{ ok: boolean; reason?: string; expDate?: string }> {
  // Look up the medicine record(s) first — medicine_batches only stores
  // medicine_id. There can be more than one non-archived `medicines` row
  // for the same generic_name (e.g. a legacy duplicate), so match ALL of
  // them instead of grabbing one via limit(1) — picking the wrong single
  // id here was causing "No warehouse stock found" even when a batch with
  // real stock existed, just under a different medicine_id.
  const { data: medRows, error: medErr } = await supabase
    .from('medicines')
    .select('medicine_id')
    .ilike('generic_name', medName.trim())
    .eq('is_archived', false)

  if (medErr) return { ok: false, reason: medErr.message }
  if (!medRows?.length) return { ok: false, reason: `No medicine record found for "${medName}".` }
  const medicineIds = medRows.map(m => m.medicine_id)

  const { data: batches, error } = await supabase
    .from('medicine_batches')
    .select('batch_id, boxes, strips_per_box, pieces_per_strip, loose_pieces, total_quantity, expiration_date, status')
    .in('medicine_id', medicineIds)
    .neq('status', 'archived')
    .gt('total_quantity', 0)
    .order('expiration_date', { ascending: true, nullsFirst: false })

  if (error)             return { ok: false, reason: error.message }
  if (!batches?.length)  return { ok: false, reason: `No warehouse stock found for "${medName}".` }

  const totalAvailable = batches.reduce((s, b) => s + (b.total_quantity ?? 0), 0)
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

    // Pieces per box for THIS batch — 0 if either factor is missing, same
    // rule the generated total_quantity column itself uses.
    const piecesPerBox = (batch.strips_per_box ?? 0) * (batch.pieces_per_strip ?? 0)
    let   loosePieces  = batch.loose_pieces ?? 0
    let   boxes        = batch.boxes ?? 0
    const totalQty     = batch.total_quantity ?? 0

    const take = Math.min(remaining, totalQty)
    let   need = take

    if (!earliestExp) earliestExp = batch.expiration_date ?? undefined

    // Drain loose pieces first, then open whole boxes as needed.
    if (loosePieces >= need) {
      loosePieces -= need
    } else {
      need -= loosePieces
      loosePieces = 0
      if (piecesPerBox > 0) {
        const boxesToOpen  = Math.min(Math.ceil(need / piecesPerBox), boxes)
        const piecesOpened = boxesToOpen * piecesPerBox
        boxes -= boxesToOpen
        const leftover = piecesOpened - need   // leftover from the last opened box
        loosePieces = leftover > 0 ? leftover : 0
      }
      // If piecesPerBox is 0, this batch has no usable boxes (matches how
      // total_quantity treats them) — `take` was already capped by totalQty
      // above so this branch shouldn't be reachable in that case.
    }

    // total_quantity is a generated/STORED column — never write to it
    // directly; only boxes and loose_pieces are updated, and it recomputes
    // itself.
    const { error: upErr } = await supabase
      .from('medicine_batches')
      .update({ boxes, loose_pieces: loosePieces })
      .eq('batch_id', batch.batch_id)
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