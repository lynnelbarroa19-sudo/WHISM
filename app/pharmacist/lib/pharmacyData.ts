// lib/pharmacyData.ts — shared Supabase access, aligned to the real schema
// defined in lib/pharmacy.ts (pharma_medicines / pharma_medicine_batches /
// pharma_dispense_log / pharma_restock_requests).
//
// THIS PASS: pharma_medicine_batches column names now match Warehouse's
// medicine_batches exactly — boxes / strips_per_box / pieces_per_strip /
// loose_pieces / total_quantity. strips_per_box and pieces_per_strip are
// OPTIONAL (nullable) — you don't always know a product's internal
// packaging breakdown. total_quantity = boxes * COALESCE(strips_per_box,0)
// * COALESCE(pieces_per_strip,0) + loose_pieces, DB-trigger maintained,
// same formula Warehouse uses. See align_batches_with_warehouse.sql.
//
// submitRestockRequest() REWRITTEN: was looping and firing one INSERT per
// item — which meant a 5-item request produced 5 separate rows with no
// shared id, so Warehouse's per-request notification/grouping logic (which
// keys off request_batch_id) saw 5 unrelated requests instead of 1. Also
// was folding dosage into medicine_name ("Paracetamol (500mg)") and type
// into notes ("Type: Tablet — <reason>"), which broke both the warehouse
// stock name-match and the "Reason" display (it showed "Type: Tablet"
// instead of the actual reason). Now: one bulk insert, one shared
// request_batch_id, and dosage/dosage_form/brand_name go into their own
// columns — notes holds ONLY the reason. Requires the dosage / dosage_form
// / brand_name / request_batch_id columns from the pharmacy_requests
// migration SQL to already exist.
"use client";
import { supabase } from "@/lib/supabase";
import {
  Medicine, MedicineBatch, MedicineWithBatches, MedicineStockSummary,
  RestockItem, MedicineCategory, BatchSource,
} from "./pharmacy";

const BATCH_COLUMNS = `
  batch_id, medicine_id, batch_number, source, source_request_id,
  expiration_date, boxes, strips_per_box, pieces_per_strip,
  loose_pieces, total_quantity,
  storage_location, status, date_received, remarks, created_by, created_at
`;

const MEDICINE_COLUMNS = `
  medicine_id, generic_name, brand_name, dosage_strength, dosage_form,
  category, unit, manufacturer, barcode, reorder_level, status,
  is_archived, remarks, created_by, created_at, last_updated
`;

/** Aggregate stock per medicine — reads the pharma_medicine_stock_summary view. */
export async function fetchStockSummary(): Promise<MedicineStockSummary[]> {
  const { data, error } = await supabase
    .from("pharma_medicine_stock_summary")
    .select("*")
    .eq("is_archived", false)
    .order("generic_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as MedicineStockSummary[];
}

/** Full medicine + batch detail — used by Inventory / batch-management screens. */
export async function fetchMedicinesWithBatches(): Promise<MedicineWithBatches[]> {
  const { data, error } = await supabase
    .from("pharma_medicines")
    .select(`${MEDICINE_COLUMNS}, pharma_medicine_batches ( ${BATCH_COLUMNS} )`)
    .eq("is_archived", false)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...row,
    batches: (row.pharma_medicine_batches ?? []) as MedicineBatch[],
  }));
}

export async function fetchArchivedMedicines(): Promise<MedicineWithBatches[]> {
  const { data, error } = await supabase
    .from("pharma_medicines")
    .select(`${MEDICINE_COLUMNS}, pharma_medicine_batches ( ${BATCH_COLUMNS} )`)
    .eq("is_archived", true)
    .order("last_updated", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...row,
    batches: (row.pharma_medicine_batches ?? []) as MedicineBatch[],
  }));
}

/** Insert a new catalog entry + its first batch, in one call. If a medicine
 *  with the same name + category already exists, this is treated as a
 *  RESTOCK — the existing catalog entry is reused and only a new batch
 *  (with its own expiration date, so FEFO keeps working correctly across
 *  batches) gets added, instead of failing on the uq_medicine_name_category
 *  unique constraint. */
export async function createMedicineWithBatch(input: {
  generic_name:      string;
  brand_name?:       string;
  dosage_strength?:  string;
  dosage_form?:      string;
  category:          MedicineCategory;
  unit?:             string;
  manufacturer?:     string;
  barcode?:          string;
  reorder_level?:    number;
  remarks?:          string;
  batch: {
    batch_number?:      string;
    source?:            BatchSource;
    expiration_date?:   string;   // optional — supplies often don't expire
    boxes:               number;
    strips_per_box?:     number;   // packaging info, optional
    pieces_per_strip?:   number;   // packaging info, optional
    loose_pieces:        number;   // real depletable count
    storage_location?:  string;
    date_received?:     string;
    remarks?:            string;
  };
}) {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id ?? null;

  // If a medicine with this exact name + category already exists, this is
  // really a RESTOCK (new batch, same catalog entry) — not a new medicine.
  // Reuse the existing medicine_id instead of trying to insert a duplicate
  // catalog row, which would hit uq_medicine_name_category and fail.
  const { data: existing, error: findErr } = await supabase
    .from("pharma_medicines")
    .select("medicine_id, generic_name")
    .eq("category", input.category)
    .ilike("generic_name", input.generic_name.trim())
    .maybeSingle();
  if (findErr) throw findErr;

  let medicine: { medicine_id: string; generic_name: string };

  if (existing) {
    medicine = existing;
  } else {
    const { data: created, error: medErr } = await supabase
      .from("pharma_medicines")
      .insert([{
        generic_name:      input.generic_name,
        brand_name:        input.brand_name || null,
        dosage_strength:   input.dosage_strength || null,
        dosage_form:       input.dosage_form || null,
        category:          input.category,
        unit:              input.unit || null,
        manufacturer:      input.manufacturer || null,
        barcode:           input.barcode || null,
        reorder_level:     input.reorder_level ?? 10,
        remarks:           input.remarks || null,
        status:            "active",
        is_archived:       false,
        created_by:        userId,
      }])
      .select()
      .single();
    if (medErr) throw medErr;
    medicine = created;
  }

  const { error: batchErr } = await supabase.from("pharma_medicine_batches").insert([{
    medicine_id:        medicine.medicine_id,
    batch_number:       input.batch.batch_number || null,
    source:             input.batch.source || null,
    expiration_date:    input.batch.expiration_date || null,
    boxes:              input.batch.boxes,
    strips_per_box:     input.batch.strips_per_box ?? null,
    pieces_per_strip:   input.batch.pieces_per_strip ?? null,
    loose_pieces:       input.batch.loose_pieces || 0,
    storage_location:   input.batch.storage_location || null,
    date_received:      input.batch.date_received || undefined, // let DB default to now() if not provided
    remarks:            input.batch.remarks || null,
    created_by:         userId,
  }]);
  if (batchErr) throw batchErr;

  return medicine as Medicine;
}

/** Submit one or more items to Warehouse in a SINGLE insert. Writes into
 *  `pharmacy_requests` — NOT `pharma_restock_requests`. The Warehouse
 *  module's PharmacyRequestsRecordsPage / notification trigger already
 *  read/write `pharmacy_requests` with this exact shape.
 *
 *  All items share one `request_batch_id` (either the one passed in from
 *  the confirmation-dialog flow, or generated here if none was given) —
 *  this is what lets Warehouse's per-statement trigger fire exactly once
 *  for the whole request instead of once per item, and lets its "restock
 *  request" popup group every item under a single notification.
 *
 *  Dosage, type (dosage_form), and brand name each get their own column
 *  now instead of being folded into medicine_name/notes — notes holds
 *  ONLY the reason, so it displays correctly instead of showing "Type: X". */
export async function submitRestockRequest(
  items: RestockItem[],
  pharmacistName: string,
  reason?: string,
  batchId?: string,
): Promise<string> {
  const requestBatchId = batchId ?? crypto.randomUUID();

  const rows = items.map((item) => ({
    medicine_name:    item.medicine,
    brand_name:       item.category === "drugs" ? (item.brand || null) : null,
    dosage:           item.category === "drugs" ? (item.dosage || null) : null,
    dosage_form:      item.type || null,
    requested_qty:    item.qty,
    unit:             item.unit || "pcs",
    status:           "pending",
    requested_by:     pharmacistName,
    notes:            reason || null,
    category:         item.category || "drugs",
    request_batch_id: requestBatchId,
  }));

  const { error } = await supabase.from("pharmacy_requests").insert(rows);
  if (error) throw error;

  return requestBatchId;
}