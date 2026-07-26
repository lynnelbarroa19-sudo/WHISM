// lib/pharmacyData.ts — shared Supabase access, aligned to the real schema
// defined in lib/pharmacy.ts (pharma_medicines / pharma_medicine_batches /
// pharma_dispense_log / pharma_restock_requests).
//
// THIS PASS: true 3-level packaging tracking. A batch now carries:
//   - strips_per_box / pieces_per_strip — fixed packaging FACTORS
//   - boxes / loose_strips / loose_pieces — real, depletable COUNTS
// total_quantity is a DB-generated column: boxes*strips_per_box*pieces_per_strip
// + loose_strips*pieces_per_strip + loose_pieces. See
// upgrade_3level_packaging.sql for the migration this depends on.
"use client";
import { supabase } from "@/lib/supabase";
import {
  Medicine, MedicineBatch, MedicineWithBatches, MedicineStockSummary,
  RestockItem, MedicineCategory, BatchSource,
} from "./pharmacy";

const BATCH_COLUMNS = `
  batch_id, medicine_id, batch_number, source, source_request_id,
  expiration_date, boxes, strips_per_box, pieces_per_strip, loose_strips,
  pieces_per_box, loose_pieces, total_quantity,
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
    strips_per_box:      number;   // fixed packaging factor
    pieces_per_strip:    number;   // fixed packaging factor
    loose_strips:        number;   // real depletable count
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
    strips_per_box:     Math.max(1, input.batch.strips_per_box || 1),
    pieces_per_strip:   Math.max(1, input.batch.pieces_per_strip || 1),
    loose_strips:       input.batch.loose_strips || 0,
    loose_pieces:       input.batch.loose_pieces || 0,
    storage_location:   input.batch.storage_location || null,
    date_received:      input.batch.date_received || undefined, // let DB default to now() if not provided
    remarks:            input.batch.remarks || null,
    created_by:         userId,
  }]);
  if (batchErr) throw batchErr;

  return medicine as Medicine;
}

/** Submit one or more items to the shared warehouse restock queue. */
export async function submitRestockRequest(
  items: RestockItem[],
  pharmacistName: string,
  reason?: string
) {
  for (const item of items) {
    const { error } = await supabase.from("pharma_restock_requests").insert([{
      pharmacist_name: pharmacistName,
      medicine_name:   item.medicine,
      dosage:          item.dosage,
      medicine_type:   item.type,
      unit:            item.unit,
      quantity:        item.qty,
      status:          "pending",
      reason:          reason || null,
    }]);
    if (error) throw error;
  }
}