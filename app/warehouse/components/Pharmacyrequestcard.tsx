// Add/replace this function in ../lib/pharmacyData.ts
// (keep whatever else already lives in that file untouched — this is only
// the one function that needs updating.)

import { supabase } from "@/lib/supabase";
import { RestockItem } from "./pharmacy";

export async function submitRestockRequest(
  items: RestockItem[],
  requestedBy: string,
  reason?: string,
) {
  // One id shared by every item in this submission, so Warehouse can group
  // them into a single notification/popup instead of one per medicine.
  const batchId = crypto.randomUUID();

  const rows = items.map((item) => ({
    medicine_name: item.medicine,
    dosage: item.dosage || null,
    dosage_form: item.type || null,
    category: item.category,
    requested_qty: item.qty,
    unit: item.unit,
    status: "pending",
    requested_by: requestedBy,
    notes: reason || null,
    request_batch_id: batchId,
  }));

  const { error } = await supabase.from("pharmacy_requests").insert(rows);
  if (error) throw error;
}