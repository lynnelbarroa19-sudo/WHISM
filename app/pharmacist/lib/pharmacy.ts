"use client";
import { createContext, useContext } from "react";

/* ══════════════════════════════════════════════════════════════════════════
   THEME  (unchanged — not part of the DB migration)
══════════════════════════════════════════════════════════════════════════ */
export const LIGHT = {
  appBg:          "#eef0f4",
  surface:        "#ffffff",
  surface2:       "#f5faf6",
  headerBg:       "#1a5e35",
  sidebarBg:      "#ffffff",
  sidebarBorder:  "#eeeeee",
  navLabel:       "#bbbbbb",
  navText:        "#555555",
  navActiveBg:    "#1a5e35",
  navActiveText:  "#ffffff",
  text:           "#111111",
  text2:          "#444444",
  text3:          "#888888",
  border:         "#c3dfc9",
  border2:        "#dddddd",
  calBg:          "#f5faf6",
  calText:        "#444444",
  cardBg:         "#ffffff",
  cardBorder:     "#dddddd",
  tableHead:      "#999999",
  tableRow:       "#ffffff",
  tableRowSel:    "#f0faf3",
  tableRowBorder: "#f3f3f3",
  dispenseCard:   "#eef7f1",
  notifBg:        "#ffffff",
  notifBorder:    "#eeeeee",
  notifText:      "#333333",
  notifText2:     "#555555",
  modalBg:        "#ffffff",
  modalText:      "#222222",
  modalText2:     "#444444",
  inputBorder:    "#cccccc",
  readonlyBg:     "#f5f5f5",
  green:          "#1a5e35",
  greenLight:     "#2d9e58",
  profileBg:      "#ffffff",
  profileText:    "#222222",
};

export const DARK = {
  appBg:          "#0d1f14",
  surface:        "#132b1c",
  surface2:       "#0f2318",
  headerBg:       "#0b1f10",
  sidebarBg:      "#132b1c",
  sidebarBorder:  "#1e3d28",
  navLabel:       "#4a7a5a",
  navText:        "#8ab89a",
  navActiveBg:    "#1a5e35",
  navActiveText:  "#ffffff",
  text:           "#e8f5ec",
  text2:          "#b0cfba",
  text3:          "#6a9a7a",
  border:         "#2a5a3a",
  border2:        "#1e3d28",
  calBg:          "#0f2318",
  calText:        "#8ab89a",
  cardBg:         "#132b1c",
  cardBorder:     "#1e3d28",
  tableHead:      "#4a7a5a",
  tableRow:       "#132b1c",
  tableRowSel:    "#1a3a25",
  tableRowBorder: "#1e3d28",
  dispenseCard:   "#0f2318",
  notifBg:        "#132b1c",
  notifBorder:    "#1e3d28",
  notifText:      "#e8f5ec",
  notifText2:     "#8ab89a",
  modalBg:        "#132b1c",
  modalText:      "#e8f5ec",
  modalText2:     "#b0cfba",
  inputBorder:    "#2a5a3a",
  readonlyBg:     "#0f2318",
  green:          "#1a5e35",
  greenLight:     "#2d9e58",
  profileBg:      "rgba(255,255,255,0.1)",
  profileText:    "#ffffff",
};

export type Theme = typeof LIGHT;

export const ThemeCtx = createContext<{ t: Theme; dark: boolean; toggle: () => void }>({
  t: LIGHT, dark: false, toggle: () => {},
});

export const useTheme = () => useContext(ThemeCtx);

/* ══════════════════════════════════════════════════════════════════════════
   DB TYPES — aligned to the new normalized schema
   ────────────────────────────────────────────────────────────────────────
   OLD  : one flat `pharma_medicines` row held name + quantity + boxes +
           pieces_per_box + partial_pieces + exp_date all together, and
           "is this a box unit" was *guessed* at render time from the unit
           string (IS_BOX_UNIT helper, duplicated in 4 files).
   NEW  : `pharma_medicines` is now just the catalog entry (no stock, no
           expiry). Stock lives in `pharma_medicine_batches` — one row per
           received batch, each with its own expiration_date, boxes,
           pieces_per_box, loose_pieces (total_quantity is DB-generated).
           A medicine can have MANY batches (different expiry dates), which
           is exactly what FEFO dispensing and the "First Expiry Report"
           need. No more unit-string sniffing — boxes/pieces_per_box/
           loose_pieces are now real columns on every batch, always.
   THIS PASS: pharma_medicine_batches column NAMES now match Warehouse's
           medicine_batches exactly, since both modules independently track
           batch-level packaging the same way — boxes, strips_per_box,
           pieces_per_strip, loose_pieces, total_quantity all mean the same
           thing in both. strips_per_box/pieces_per_strip are OPTIONAL
           (nullable) — you don't always know a product's internal packaging
           breakdown, only how many full boxes and loose pieces you have.
           total_quantity = boxes * COALESCE(strips_per_box,0) *
           COALESCE(pieces_per_strip,0) + loose_pieces (DB-trigger
           maintained, same formula Warehouse uses). No separate
           "loose_strips" — that was a Pharmacy-only 3-level experiment
           that Warehouse's model doesn't have, so it was removed to keep
           the two schemas genuinely aligned, not just similarly named.
           `source_request_id` is the one real Pharmacy-only column (links
           a batch back to the restock request that created it) — that's
           intentional, not a naming mismatch.
   ══════════════════════════════════════════════════════════════════════ */

export type MedicineCategory = "drugs" | "supplies";
export type MedicineStatus   = "active" | "inactive" | "discontinued";

/** Catalog entry — pharma_medicines. No stock/expiry here anymore. */
export type Medicine = {
  medicine_id:      string;
  generic_name:     string;
  brand_name:       string | null;
  dosage_strength:  string | null;
  dosage_form:      string | null;
  category:         MedicineCategory;
  unit:             string | null;
  manufacturer:     string | null;
  barcode:          string | null;
  reorder_level:    number;
  status:           MedicineStatus;
  is_archived:      boolean;
  remarks:          string | null;
  created_by:       string | null;
  created_at:       string;
  last_updated:     string;
};

export type BatchSource = "warehouse" | "donation" | "purchase";
export type BatchStatus = "available" | "low_stock" | "out_of_stock" | "expired" | "archived";

/** One received batch of stock — pharma_medicine_batches. Column names
 *  match Warehouse's medicine_batches on purpose (see note above). */
export type MedicineBatch = {
  batch_id:           string;
  medicine_id:        string;
  batch_number:       string | null;
  source:             BatchSource | null;
  /** Pharmacy-only — links this batch back to the restock request that
   *  created it. Warehouse's table has no equivalent; that's expected. */
  source_request_id:  string | null;
  /** Nullable — supplies like Gloves/Gauze/Cotton often don't meaningfully
   *  expire. Batches without a date sort last in FEFO (dated stock still
   *  gets used first). */
  expiration_date:    string | null;
  /** Complete, unopened boxes currently in stock. Depletes on dispense. */
  boxes:              number;
  /** Packaging info, OPTIONAL — how many strips make up one full box, if known. */
  strips_per_box:     number | null;
  /** Packaging info, OPTIONAL — how many pieces make up one full strip, if known. */
  pieces_per_strip:   number | null;
  /** Individual pieces not accounted for by full boxes. Depletes on dispense. */
  loose_pieces:       number;
  /** DB-maintained (trigger): boxes * COALESCE(strips_per_box,0) *
   *  COALESCE(pieces_per_strip,0) + loose_pieces. Read-only. */
  total_quantity:     number;
  storage_location:   string | null;
  status:             BatchStatus;
  date_received:      string;
  remarks:            string | null;
  created_by:         string | null;
  created_at:         string;
};

/** Convenience joined shape used by list/detail views (medicine + its batches). */
export type MedicineWithBatches = Medicine & {
  batches: MedicineBatch[];
};

/** Mirrors the `pharma_medicine_stock_summary` view — one row per medicine
 *  with aggregate quantity + nearest expiry across its non-archived batches.
 *  Use this for list/dashboard screens instead of summing batches client-side. */
export type MedicineStockSummary = {
  medicine_id:     string;
  generic_name:    string;
  brand_name:      string | null;
  dosage_strength: string | null;
  dosage_form:     string | null;
  category:        MedicineCategory;
  unit:            string | null;
  is_archived:     boolean;
  total_quantity:  number;
  nearest_expiry:  string | null;
};

/** Dispense transaction — pharma_dispense_log. Always tied to a specific
 *  batch_id now (the pharmacist picks which batch to draw from), so FEFO
 *  reporting and batch-level remaining stock stay accurate. */
export type DispenseLog = {
  dispense_id:     string;
  batch_id:        string;
  medicine_id:     string;
  quantity:        number;
  recipient_note:  string | null;
  dispensed_by:    string | null;
  dispensed_at:    string;
  remarks:         string | null;
  created_at:      string;
};

export type RestockRequestStatus = "pending" | "alerted" | "confirmed" | "rejected";

/** pharma_restock_requests (was: restock_requests). Same shape as before
 *  plus `unit` and `reason`, and the PK is now `restock_request_id`. */
export type RestockRequest = {
  restock_request_id:        string;
  pharmacist_name:           string;
  medicine_id:               string | null;
  medicine_name:             string;
  dosage:                    string | null;
  medicine_type:             string | null;
  unit:                      string | null;
  quantity:                  number;
  requested_boxes:           number;
  requested_partial_pieces:  number;
  pieces_per_box_snapshot:   number | null;
  reason:                    string | null;
  status:                    RestockRequestStatus;
  created_at:                string;
};

export type VaccineRequestStatus = "pending" | "confirmed" | "rejected";
export type VaccineUrgency       = "routine" | "urgent" | "emergency";

/** pharma_nurse_vaccine_requests (was: nurse_vaccine_requests). Same
 *  columns as before, PK renamed to `vaccine_request_id`. */
export type VaccineRequest = {
  vaccine_request_id:  string;
  nurse_name:          string;
  vaccine_name:        string;
  dosage:              string | null;
  quantity:            number;
  urgency:             VaccineUrgency;
  notes:               string | null;
  status:              VaccineRequestStatus;
  created_at:          string;
};

/* ── UI-only shape used while building a restock request list client-side
 *    (Request.tsx). Not a DB row — just what's staged before submit. ── */
export type RestockItem = {
  medicine: string;
  dosage:   string;
  type:     string;
  unit:     string;
  qty:      number;
  category: MedicineCategory;
};

/* ══════════════════════════════════════════════════════════════════════════
   FORM OPTION LISTS
   ────────────────────────────────────────────────────────────────────────
   Kept as-is for now — AddMedicine.tsx / Inventory.tsx / Request.tsx still
   read these for their Type/Unit dropdowns and haven't been converted to
   the new schema yet (next passes). Once those files are migrated, these
   will map onto `dosage_form` (MEDICINE_TYPES/SUPPLY_TYPES) and `unit`
   (UNITS) on the pharma_medicines catalog row.
══════════════════════════════════════════════════════════════════════════ */
export const MEDICINE_TYPES = [
  "Tablet", "Capsule", "Syrup", "Injectable", "Drops", "Ointment", "Powder",
];

export const SUPPLY_TYPES = [
  "Lab Supply", "Medical Form", "Medical Tape", "PPE", "Insecticide",
  "Bandage", "Gauze", "Gloves", "Syringe", "Cotton", "Alcohol",
  "Mask", "Dressing", "IV", "Catheter", "Equipment", "Other Supply",
];

export const UNITS = [
  "Pieces", "Bottles", "Boxes", "Vials", "Sachets", "Strips",
  "Rolls", "Packs", "Sets", "Pairs",
];