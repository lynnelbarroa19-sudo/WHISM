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

/** Submit one or more items to Warehouse. Writes into `pharmacy_requests`
 *  — NOT `pharma_restock_requests`. The Warehouse module's
 *  PharmacyRequestsRecordsPage already reads/writes `pharmacy_requests`
 *  with this exact shape (see its "SCHEMA ASSUMPTION" comment); using that
 *  table here — instead of our old pharma_restock_requests, which nothing
 *  on the Warehouse side ever looked at — is what actually makes a
 *  Pharmacy request show up on their end, with zero changes needed there.
 *  Dosage/type/category get folded into `medicine_name` and `notes` since
 *  pharmacy_requests doesn't have dedicated columns for them. */
export async function submitRestockRequest(
  items: RestockItem[],
  pharmacistName: string,
  reason?: string
) {
  for (const item of items) {
    const nameWithDosage = item.dosage ? `${item.medicine} (${item.dosage})` : item.medicine;
    const noteParts = [item.type ? `Type: ${item.type}` : null, reason || null].filter(Boolean);
    const { error } = await supabase.from("pharmacy_requests").insert([{
      medicine_name: nameWithDosage,
      requested_qty: item.qty,
      unit:          item.unit || "pcs",
      status:        "pending",
      requested_by:  pharmacistName,
      notes:         noteParts.length > 0 ? noteParts.join(" — ") : null,
      category:      item.category || "drugs",
    }]);
    if (error) throw error;
  }
}