"use client";
import { CSSProperties, useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useTheme, MedicineStockSummary, MedicineBatch, BatchStatus } from "../lib/pharmacy";
import { logAction } from "@/app/utils/auditLogs";
import { useAuth } from "@/context/AuthContext";

type Props = {
  medicine: MedicineStockSummary;
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string, type: "success" | "error") => void;
};

const DARK_GREEN = "#14532d";

/** Same rule AddMedicinePage uses: the Box/Strip/Piece breakdown only
 *  applies when the medicine's Unit is literally "Boxes" — anything else
 *  (Bottles, Vials, Sachets, Pairs, etc.) is just a flat count in that
 *  unit, so there's nothing to break down. */
function isBoxUnit(unit: string | null | undefined): boolean {
  return (unit ?? "").trim().toLowerCase() === "boxes";
}

/** TRUE 3-level cascade: given a total piece count and the batch's fixed
 *  packaging factors (strips per box, pieces per strip), work out how many
 *  complete boxes, complete loose strips, and individual loose pieces that
 *  total actually represents. Boxes are filled first, then strips, then
 *  whatever's left over is loose pieces — matching how stock is physically
 *  broken down as it depletes (a box gets opened into strips, a strip gets
 *  opened into pieces). */
function splitIntoBoxStripPiece(total: number, stripsPerBox: number, piecesPerStrip: number) {
  const safeStripsPerBox = Math.max(1, stripsPerBox || 1);
  const safePiecesPerStrip = Math.max(1, piecesPerStrip || 1);
  const piecesPerBox = safeStripsPerBox * safePiecesPerStrip;

  const boxes = Math.floor(total / piecesPerBox);
  const afterBoxes = total % piecesPerBox;
  const looseStrips = Math.floor(afterBoxes / safePiecesPerStrip);
  const loosePieces = afterBoxes % safePiecesPerStrip;

  return { boxes, looseStrips, loosePieces };
}

const PillIcon = ({ size = 15, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
    <rect x="2" y="9" width="20" height="6" rx="3" stroke={color} strokeWidth="2" fill="none"/>
    <line x1="12" y1="9" x2="12" y2="15" stroke={color} strokeWidth="2"/>
    <rect x="2" y="9" width="10" height="6" rx="3" fill={color} opacity="0.25"/>
  </svg>
);
const WarningIcon = ({ size = 13, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);
const XCircleIcon = ({ size = 13, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
  </svg>
);
const BoxIcon = ({ size = 13, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M21 8L12 3 3 8v8l9 5 9-5V8z" fill="none"/><path d="M3 8l9 5 9-5"/><line x1="12" y1="13" x2="12" y2="21"/>
  </svg>
);

/** Pull a human display name off the current Supabase Auth session —
 *  there's no `users` table to join, so this is the only source for
 *  "who dispensed this" that doesn't require a separate profile table. */
async function currentDisplayName(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const authUser = session?.user;
  if (!authUser) return null;
  const meta = authUser.user_metadata as { username?: string; full_name?: string } | undefined;
  return meta?.username || meta?.full_name || authUser.email?.split("@")[0] || null;
}

/** Shared FEFO dispense — draws `qty` units for `medicineId` from its
 *  eligible batches, earliest expiry first, writing one pharma_dispense_log
 *  row per batch touched. Used by both PrescriptionModal (automatic,
 *  prescription-driven) and DispenseItemsModal (manual, multi-item) so the
 *  quantity/expiry validation logic only lives in one place.
 *
 *  THIS PASS: batches now update using the true 3-level cascade — Boxes,
 *  Strips, AND Pieces all shrink correctly as stock depletes, instead of
 *  only Boxes/loose-pieces. */
export async function dispenseFEFO(
  medicineId: string,
  medName: string,
  qty: number,
  dispensedBy: string | null,
  dispensedByName: string | null,
  recipientName: string,
  remarks?: string | null
) {
  const { data: batches, error } = await supabase
    .from("pharma_medicine_batches")
    .select("*")
    .eq("medicine_id", medicineId)
    .in("status", ["available", "low_stock"])
    .gt("total_quantity", 0)
    .order("expiration_date", { ascending: true });
  if (error) throw error;

  let remaining = qty;
  for (const batch of (batches ?? []) as MedicineBatch[]) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, batch.total_quantity);
    const newTotal = batch.total_quantity - take;
    const { boxes: newBoxes, looseStrips: newLooseStrips, loosePieces: newLoose } =
      splitIntoBoxStripPiece(newTotal, batch.strips_per_box, batch.pieces_per_strip);
    const newStatus: BatchStatus = newTotal === 0 ? "out_of_stock" : newTotal <= 10 ? "low_stock" : "available";

    const { error: updErr } = await supabase.from("pharma_medicine_batches")
      .update({ boxes: newBoxes, loose_strips: newLooseStrips, loose_pieces: newLoose, status: newStatus })
      .eq("batch_id", batch.batch_id);
    if (updErr) throw updErr;

    const { error: logErr } = await supabase.from("pharma_dispense_log").insert([{
      batch_id: batch.batch_id, medicine_id: medicineId, quantity: take,
      dispensed_by: dispensedBy, dispensed_by_name: dispensedByName,
      recipient_note: recipientName, dispensed_at: new Date().toISOString(),
      remarks: remarks ?? null,
    }]);
    if (logErr) throw logErr;

    remaining -= take;
  }
  if (remaining > 0) throw new Error(`Insufficient batch stock left for ${medName} (${remaining} unit(s) short).`);
}

/* ══════════════════════════════════════════════════════════════════════════
   PrescriptionModal — batch of doctor-prescribed items to dispense at once.
   ─────────────────────────────────────────────────────────────────────────
   NOTE: unlike the manual DispenseMedicineModal below (where the pharmacist
   explicitly picks one batch), a prescription can contain several medicines
   at once. Stock is drawn automatically FEFO (earliest expiration_date
   first, across as many batches as needed to cover the requested quantity).
══════════════════════════════════════════════════════════════════════════ */
type Prescription = {
  id: string;
  patient_id: string;
  prescription_date: string;
  medicine: string;
  quantity: string | null;
  dosage_frequency?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  notes: string | null;
  status: string | null;
  created_at: string | null;
  patient_name?: string;
};

type MedicineAvailability = {
  medicine_id: string;
  generic_name: string;
  is_archived: boolean;
  total_quantity: number;
};

type PrescriptionModalProps = {
  onClose: () => void;
  onToast: (msg: string, type: "success" | "error") => void;
};

function normalize(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function PrescriptionModal({ onClose, onToast }: PrescriptionModalProps) {
  const { user } = useAuth();
  const { t } = useTheme();

  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [stocks, setStocks] = useState<MedicineAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => { fetchLatestGroup(); }, []);

  const fetchLatestGroup = async () => {
    setLoading(true);
    try {
      const { data: latest, error: latestError } = await supabase
        .from("prescriptions")
        .select(`
          id, patient_id, prescription_date, medicine, quantity,
          dosage_frequency, dosage, frequency, notes, status, created_at,
          patients ( name )
        `)
        .eq("status", "sent")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) throw latestError;

      if (!latest) { setPrescriptions([]); setLoading(false); return; }

      // Group every "sent" prescription for the same patient + same
      // prescription date as the most recent one — this is how a doctor's
      // multi-medicine prescription for one visit shows up as one form.
      const { data: groupData, error: groupError } = await supabase
        .from("prescriptions")
        .select(`
          id, patient_id, prescription_date, medicine, quantity,
          dosage_frequency, dosage, frequency, notes, status, created_at,
          patients ( name )
        `)
        .eq("status", "sent")
        .eq("patient_id", latest.patient_id)
        .eq("prescription_date", latest.prescription_date)
        .order("created_at", { ascending: true });
      if (groupError) throw groupError;

      const mapped: Prescription[] = (groupData ?? []).map((row: any) => ({
        ...row,
        patient_name: row.patients?.name ?? "Unknown",
      }));

      const { data: medRows, error: medError } = await supabase
        .from("pharma_medicine_stock_summary")
        .select("medicine_id, generic_name, is_archived, total_quantity");
      if (medError) throw medError;

      setPrescriptions(mapped);
      setStocks((medRows ?? []) as MedicineAvailability[]);
    } catch (err: any) {
      onToast(err.message || "Failed to load prescriptions.", "error");
      onClose();
    } finally { setLoading(false); }
  };

  const unavailableMedicines = useMemo(() => {
    return prescriptions.filter((rx) => {
      const found = stocks.find(m => normalize(m.generic_name) === normalize(rx.medicine));
      if (!found) return true;
      if (found.is_archived) return true;
      if ((found.total_quantity ?? 0) <= 0) return true;
      return false;
    });
  }, [prescriptions, stocks]);

  const isNotAvailable = unavailableMedicines.length > 0;
  const patient = prescriptions[0];

  const handleConfirm = async () => {
    if (prescriptions.length === 0) return;
    if (isNotAvailable) {
      onToast("Cannot dispense. Some prescribed medicine is not available in RHU.", "error");
      return;
    }
    if (!patient?.patient_name || !patient.patient_name.trim()) {
      onToast("Patient name is missing on this prescription.", "error");
      return;
    }
    setConfirming(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const dispensedBy = session?.user?.id ?? null;
      const dispensedByName = await currentDisplayName();

      for (const rx of prescriptions) {
        const stock = stocks.find(m => normalize(m.generic_name) === normalize(rx.medicine));
        if (!stock) continue;
        const qtyNumber = Number(String(rx.quantity ?? "1").match(/\d+/)?.[0] ?? 1);
        if (!Number.isFinite(qtyNumber) || qtyNumber <= 0) {
          throw new Error(`Invalid quantity on prescription for ${rx.medicine}.`);
        }
        await dispenseFEFO(stock.medicine_id, stock.generic_name, qtyNumber, dispensedBy, dispensedByName, patient.patient_name, `Prescription dispense — ${stock.generic_name}`);
      }

      const ids = prescriptions.map((p) => p.id);
      const { error } = await supabase.from("prescriptions").update({ status: "dispensed" }).in("id", ids);
      if (error) throw error;

      await logAction({
        user_name: dispensedByName || user?.name || "Pharmacist", user_role: "Pharmacist",
        action: "Dispense Prescription", module: "Pharmacy",
        description: `Dispensed ${prescriptions.length} medicine(s) to ${patient?.patient_name}`,
        status: "success",
      });

      onToast("Prescription marked as dispensed.", "success");
      onClose();
    } catch (err: any) {
      onToast(err.message || "Failed to dispense prescription.", "error");
    } finally { setConfirming(false); }
  };

  const fieldLabel: CSSProperties = { fontSize: 11, fontWeight: 800, color: "#111" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }} onClick={onClose}>
      <div style={{ width: "min(560px, 95vw)", background: "#f8fafc", borderRadius: 18, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ background: `linear-gradient(135deg, ${DARK_GREEN}, ${t.green})`, padding: "16px 22px", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 900 }}>Prescription Form</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{patient?.patient_name ?? "Loading..."}</div>
          </div>
          <button onClick={onClose} style={{ border: "1px solid rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.15)", color: "#fff", borderRadius: 8, padding: "8px 14px", fontWeight: 800, cursor: "pointer" }}>✕ Close</button>
        </div>

        <div style={{ padding: 22 }}>
          {loading && <div style={{ textAlign: "center", padding: 40, color: t.text3 }}>Loading prescription…</div>}
          {!loading && prescriptions.length === 0 && <div style={{ textAlign: "center", padding: 40, color: t.text3 }}>No pending prescriptions.</div>}

          {!loading && prescriptions.length > 0 && (
            <>
              <div style={{ background: "#fff", minHeight: 520, padding: 28, borderRadius: 6, color: "#000", fontFamily: "Arial, sans-serif", boxShadow: "0 2px 10px rgba(0,0,0,0.08)" }}>
                <div style={{ textAlign: "center", marginBottom: 18 }}>
                  <div style={{ fontSize: 11 }}>Republic of the Philippines</div>
                  <div style={{ fontSize: 12 }}>Department of Health</div>
                  <div style={{ fontSize: 12 }}>Lopez, Quezon</div>
                  <div style={{ fontSize: 12 }}>Municipal Health Office</div>
                  <div style={{ fontSize: 14, fontWeight: 900 }}>PRESCRIPTION FORM</div>
                </div>

                <div style={{ borderBottom: "2px solid #000", marginBottom: 12 }} />

                <div style={{ fontSize: 12, marginBottom: 12 }}>
                  <div style={{ display: "flex", gap: 10, marginBottom: 7 }}>
                    <span style={fieldLabel}>Name:</span>
                    <span style={{ flex: 1, borderBottom: "1px solid #000" }}>{patient?.patient_name}</span>
                    <span style={fieldLabel}>Date:</span>
                    <span style={{ width: 130, borderBottom: "1px solid #000" }}>
                      {new Date(patient.prescription_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                </div>

                <div style={{ borderBottom: "1px solid #000", marginBottom: 16 }} />
                <div style={{ fontFamily: "serif", fontSize: 42, fontWeight: 900, marginBottom: 10 }}>R<sub style={{ fontSize: 22 }}>x</sub></div>

                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {prescriptions.map((rx, index) => {
                    const unavailable = unavailableMedicines.some((u) => u.id === rx.id);
                    return (
                      <div key={rx.id} style={{ borderBottom: "1px solid #ddd", paddingBottom: 10, background: unavailable ? "#fff7ed" : "transparent" }}>
                        <div style={{ fontSize: 14, fontWeight: 900 }}>
                          {index + 1}. {rx.medicine}
                          {unavailable && <span style={{ marginLeft: 8, color: "#c2410c", fontSize: 10, fontWeight: 900 }}>NOT AVAILABLE</span>}
                        </div>
                        <div style={{ fontSize: 12, marginTop: 4 }}>
                          <b>Dosage/Frequency:</b> {rx.dosage_frequency || [rx.dosage, rx.frequency].filter(Boolean).join(" - ") || "—"}
                        </div>
                        <div style={{ fontSize: 12 }}><b>Quantity:</b> {rx.quantity ?? "—"}</div>
                        {rx.notes && <div style={{ fontSize: 12 }}><b>Notes:</b> {rx.notes}</div>}
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: 50, textAlign: "center" }}>
                  <div style={{ width: "60%", borderTop: "1px solid #000", margin: "0 auto 4px" }} />
                  <div style={{ fontSize: 11, fontWeight: 900 }}>MUNICIPAL HEALTH OFFICER</div>
                  <div style={{ fontSize: 10 }}>Physician</div>
                </div>
              </div>

              {isNotAvailable && (
                <div style={{ marginTop: 14, background: "#fff7ed", border: "1.5px solid #fb923c", color: "#9a3412", borderRadius: 10, padding: "12px 14px", fontSize: 12, fontWeight: 700 }}>
                  These medicine(s) are not available in RHU: {unavailableMedicines.map((m) => m.medicine).join(", ")}. This should appear under the Not Available queue.
                </div>
              )}

              <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
                <button onClick={onClose} style={{ flex: 1, padding: "12px 0", borderRadius: 9, border: "none", background: "#d63031", color: "#fff", fontWeight: 900, cursor: "pointer" }}>CANCEL</button>
                <button onClick={handleConfirm} disabled={confirming || isNotAvailable} style={{
                  flex: 1, padding: "12px 0", borderRadius: 9, border: "none",
                  background: isNotAvailable ? "#9ca3af" : t.green, color: "#fff", fontWeight: 900,
                  cursor: isNotAvailable ? "not-allowed" : "pointer", opacity: confirming ? 0.6 : 1,
                }}>{confirming ? "SAVING…" : "CONFIRM"}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   DispenseItemsModal — pick SEVERAL medicines and quantities, then dispense
   all of them in one go for one patient/recipient. Batch selection is
   automatic (FEFO, via the shared dispenseFEFO() above).
══════════════════════════════════════════════════════════════════════════ */
type DispenseItemsModalProps = {
  medicines: MedicineStockSummary[]; // already filtered to in-stock only by the caller
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string, type: "success" | "error") => void;
};

type DispenseDraftItem = {
  medicine_id: string;
  generic_name: string;
  unit: string | null;
  available: number;
  qty: number;          // always the final total in pieces — what actually gets dispensed
  displayQty: string;    // human label, e.g. "2 box + 5 pcs" or "10 Bottles"
};

export function DispenseItemsModal({ medicines, onClose, onSaved, onToast }: DispenseItemsModalProps) {
  const { t } = useTheme();
  const { user } = useAuth();

  const [patientName, setPatientName] = useState("");
  const [items, setItems] = useState<DispenseDraftItem[]>([]);
  const [pickMedicineId, setPickMedicineId] = useState("");
  const [medicineSearch, setMedicineSearch] = useState("");
  const [showMedicineDropdown, setShowMedicineDropdown] = useState(false);
  const [pickQty, setPickQty] = useState(1);
  const [pickBoxes, setPickBoxes] = useState("");
  const [pickLoose, setPickLoose] = useState("");
  const [pickPiecesPerBox, setPickPiecesPerBox] = useState<number | null>(null);
  const [loadingBoxInfo, setLoadingBoxInfo] = useState(false);
  const [saving, setSaving] = useState(false);

  const remainingChoices = medicines.filter(m => !items.some(it => it.medicine_id === m.medicine_id));
  const pickedMedicine = remainingChoices.find(m => m.medicine_id === pickMedicineId) ?? null;
  const pickedIsBoxUnit = isBoxUnit(pickedMedicine?.unit);
  const filteredChoices = remainingChoices.filter(m =>
    !medicineSearch.trim()
    || m.generic_name.toLowerCase().includes(medicineSearch.toLowerCase())
    || (m.dosage_strength ?? "").toLowerCase().includes(medicineSearch.toLowerCase())
  );

  // When a "Boxes" unit medicine is picked, look up the pieces-per-box
  // (strips_per_box × pieces_per_strip) of its earliest-expiry batch —
  // that's the one FEFO will draw from first, so it's the right
  // conversion factor for "how many pieces is that".
  useEffect(() => {
    let cancelled = false;
    async function loadBoxInfo() {
      if (!pickedMedicine || !pickedIsBoxUnit) { setPickPiecesPerBox(null); return; }
      setLoadingBoxInfo(true);
      try {
        const { data, error } = await supabase
          .from("pharma_medicine_batches")
          .select("strips_per_box, pieces_per_strip")
          .eq("medicine_id", pickedMedicine.medicine_id)
          .in("status", ["available", "low_stock"])
          .gt("total_quantity", 0)
          .order("expiration_date", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        const sb = data?.strips_per_box ?? 1;
        const pps = data?.pieces_per_strip ?? 1;
        if (!cancelled) setPickPiecesPerBox(Math.max(1, sb * pps));
      } catch {
        if (!cancelled) setPickPiecesPerBox(1);
      } finally {
        if (!cancelled) setLoadingBoxInfo(false);
      }
    }
    loadBoxInfo();
    return () => { cancelled = true; };
  }, [pickedMedicine, pickedIsBoxUnit]);

  const pickTotal = pickedIsBoxUnit
    ? (parseInt(pickBoxes || "0", 10) * (pickPiecesPerBox ?? 1)) + parseInt(pickLoose || "0", 10)
    : pickQty;

  const resetPicker = () => {
    setPickMedicineId(""); setMedicineSearch(""); setPickQty(1); setPickBoxes(""); setPickLoose(""); setPickPiecesPerBox(null);
  };

  const selectMedicine = (m: MedicineStockSummary) => {
    setPickMedicineId(m.medicine_id);
    setMedicineSearch(`${m.generic_name}${m.dosage_strength ? ` (${m.dosage_strength})` : ""}`);
    setShowMedicineDropdown(false);
    setPickQty(1); setPickBoxes(""); setPickLoose("");
  };

  const addItem = () => {
    if (!pickedMedicine) { onToast("Choose a medicine first.", "error"); return; }
    if (!pickTotal || pickTotal < 1) { onToast("Quantity must be at least 1.", "error"); return; }
    if (pickTotal > pickedMedicine.total_quantity) {
      onToast(`Only ${pickedMedicine.total_quantity} ${(pickedMedicine.unit || "pcs").toLowerCase()} of ${pickedMedicine.generic_name} available.`, "error");
      return;
    }
    const displayQty = pickedIsBoxUnit
      ? [
          parseInt(pickBoxes || "0", 10) > 0 ? `${pickBoxes} box` : null,
          parseInt(pickLoose || "0", 10) > 0 ? `${pickLoose} pcs` : null,
        ].filter(Boolean).join(" + ") || `${pickTotal} pcs`
      : `${pickTotal} ${pickedMedicine.unit || "pcs"}`;

    setItems(prev => [...prev, {
      medicine_id: pickedMedicine.medicine_id, generic_name: pickedMedicine.generic_name,
      unit: pickedMedicine.unit, available: pickedMedicine.total_quantity, qty: pickTotal, displayQty,
    }]);
    resetPicker();
  };

  const removeItem = (medicineId: string) => setItems(prev => prev.filter(it => it.medicine_id !== medicineId));

  const updateItemQty = (medicineId: string, raw: string) => {
    const n = parseInt(raw, 10);
    setItems(prev => prev.map(it => {
      if (it.medicine_id !== medicineId) return it;
      const clamped = !Number.isFinite(n) || n < 1 ? 1 : Math.min(n, it.available);
      return { ...it, qty: clamped, displayQty: `${clamped} ${it.unit || "pcs"}` };
    }));
  };

  const nameValid = patientName.trim().length > 0;
  const canDispense = nameValid && items.length > 0 && items.every(it => it.qty > 0 && it.qty <= it.available);

  const handleDispenseAll = async () => {
    if (!nameValid) { onToast("Patient / recipient name is required.", "error"); return; }
    if (items.length === 0) { onToast("Add at least one medicine to dispense.", "error"); return; }
    const overLimit = items.find(it => it.qty > it.available);
    if (overLimit) { onToast(`${overLimit.generic_name}: quantity exceeds available stock (${overLimit.available}).`, "error"); return; }

    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const dispensedBy = session?.user?.id ?? null;
      const dispensedByName = await currentDisplayName();
      const recipient = patientName.trim();

      for (const it of items) {
        await dispenseFEFO(it.medicine_id, it.generic_name, it.qty, dispensedBy, dispensedByName, recipient);
      }

      await logAction({
        user_name: dispensedByName || user?.name || "Pharmacist", user_role: "Pharmacist",
        action: "DISPENSE_MULTIPLE", module: "Pharmacy",
        description: `Dispensed ${items.length} medicine(s) to ${recipient}: ${items.map(it => `${it.generic_name} (${it.displayQty})`).join(", ")}`,
        status: "success",
      });

      onToast(`Dispensed ${items.length} item${items.length !== 1 ? "s" : ""} to ${recipient}.`, "success");
      onSaved();
      onClose();
    } catch (err: any) {
      onToast(err.message || "Failed to dispense.", "error");
    } finally { setSaving(false); }
  };

  const inp: CSSProperties = {
    border: `1.5px solid ${t.inputBorder}`, borderRadius: 8, padding: "9px 12px",
    fontSize: 13, fontFamily: "inherit", outline: "none", background: t.modalBg,
    color: t.modalText, width: "100%", height: 40, boxSizing: "border-box",
  };
  const sel: CSSProperties = { ...inp, appearance: "none", WebkitAppearance: "none", cursor: "pointer" };
  const lbl: CSSProperties = {
    fontSize: 10.5, fontWeight: 700, color: t.text3, textTransform: "uppercase",
    letterSpacing: "0.06em", marginBottom: 5, display: "block",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "min(560px, 94vw)", maxHeight: "88vh", display: "flex", flexDirection: "column",
        background: t.modalBg, borderRadius: 18, border: `2.5px solid ${DARK_GREEN}`,
        boxShadow: "0 24px 60px rgba(0,0,0,0.4)", overflow: "hidden",
      }}>
        <div style={{ background: `linear-gradient(135deg, ${DARK_GREEN}, ${t.green})`, padding: "16px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 900 }}>Dispense Medicine</div>
          <button onClick={onClose} style={{ border: "1px solid rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.15)", color: "#fff", borderRadius: 8, width: 30, height: 30, cursor: "pointer", fontSize: 15, fontWeight: 800 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 22 }}>
          <label style={lbl}>Patient / Recipient Name <span style={{ color: "#dc2626" }}>*</span></label>
          <input value={patientName} onChange={e => setPatientName(e.target.value)} placeholder="e.g. Juan Dela Cruz"
            style={{ ...inp, border: `1.5px solid ${!nameValid && patientName.length > 0 ? "#dc2626" : t.inputBorder}` }} />

          <div style={{ borderTop: `1px dashed ${t.border2}`, margin: "18px 0" }} />

          <div style={{ fontSize: 13, fontWeight: 800, color: t.green, marginBottom: 12 }}>Add Medicine</div>
          <div style={{ marginBottom: 12, position: "relative" }}>
            <label style={lbl}>Medicine (in stock only)</label>
            <input
              value={medicineSearch}
              onChange={e => {
                setMedicineSearch(e.target.value);
                setShowMedicineDropdown(true);
                if (pickMedicineId) { setPickMedicineId(""); setPickQty(1); setPickBoxes(""); setPickLoose(""); }
              }}
              onFocus={() => setShowMedicineDropdown(true)}
              onBlur={() => setTimeout(() => setShowMedicineDropdown(false), 150)}
              placeholder="Search or type a medicine name…"
              style={sel}
            />
            {showMedicineDropdown && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, zIndex: 20,
                background: t.modalBg, border: `1.5px solid ${t.border2}`, borderRadius: 8,
                maxHeight: 220, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
              }}>
                {filteredChoices.length === 0 ? (
                  <div style={{ padding: 12, fontSize: 12.5, color: t.text3, fontStyle: "italic", textAlign: "center" }}>No matches</div>
                ) : filteredChoices.map(m => (
                  <button
                    key={m.medicine_id}
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => selectMedicine(m)}
                    style={{
                      display: "block", width: "100%", textAlign: "left", padding: "9px 12px",
                      border: "none", borderBottom: `1px solid ${t.border2}`, background: "transparent",
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = t.surface2)}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: t.modalText }}>
                      {m.generic_name} {m.dosage_strength ? `(${m.dosage_strength})` : ""}
                    </div>
                    <div style={{ fontSize: 10.5, color: t.text3 }}>{m.total_quantity} {m.unit || "pcs"} available</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {pickedMedicine && (
            pickedIsBoxUnit ? (
              <div style={{ marginBottom: 12 }}>
                <label style={lbl}>
                  Boxes &amp; Loose Pieces {loadingBoxInfo ? "(loading box size…)" : pickPiecesPerBox ? `(1 box = ${pickPiecesPerBox} pcs)` : ""}
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 9.5, color: t.text3, marginBottom: 4 }}>Boxes</div>
                    <input type="number" min={0} value={pickBoxes} onChange={e => setPickBoxes(e.target.value)} placeholder="0" style={inp} disabled={loadingBoxInfo} />
                  </div>
                  <div>
                    <div style={{ fontSize: 9.5, color: t.text3, marginBottom: 4 }}>Loose Pieces</div>
                    <input type="number" min={0} value={pickLoose} onChange={e => setPickLoose(e.target.value)} placeholder="0" style={inp} disabled={loadingBoxInfo} />
                  </div>
                </div>
                <div style={{ marginTop: 8, fontSize: 11.5, color: t.text3 }}>
                  = <b style={{ color: t.green }}>{pickTotal}</b> pcs total {pickedMedicine ? `(max ${pickedMedicine.total_quantity})` : ""}
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: 12 }}>
                <label style={lbl}>Quantity ({pickedMedicine.unit || "pcs"}) {`(max ${pickedMedicine.total_quantity})`}</label>
                <input type="number" min={1} max={pickedMedicine.total_quantity} value={pickQty}
                  onChange={e => setPickQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  onKeyDown={e => { if (e.key === "-" || e.key === "e") e.preventDefault(); }}
                  style={inp} />
              </div>
            )
          )}

          <button onClick={addItem} disabled={!pickedMedicine || loadingBoxInfo} style={{
            width: "100%", padding: 10, borderRadius: 8, border: `1.5px dashed ${t.green}`,
            background: "transparent", color: t.green, fontSize: 13, fontWeight: 700,
            cursor: (pickedMedicine && !loadingBoxInfo) ? "pointer" : "not-allowed", fontFamily: "inherit",
            opacity: (pickedMedicine && !loadingBoxInfo) ? 1 : 0.5,
          }}>+ Add to list</button>

          <div style={{ borderTop: `1px dashed ${t.border2}`, margin: "18px 0" }} />

          <div style={{ fontSize: 13, fontWeight: 800, color: t.green, marginBottom: 12 }}>Items to Dispense ({items.length})</div>
          <div style={{ border: `1px solid ${t.border2}`, borderRadius: 10, overflow: "hidden" }}>
            {items.length === 0 ? (
              <div style={{ padding: 18, textAlign: "center", color: t.text3, fontSize: 12.5, fontStyle: "italic" }}>No items added yet</div>
            ) : items.map((it, i) => (
              <div key={it.medicine_id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                borderBottom: i < items.length - 1 ? `1px solid ${t.border2}` : "none",
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: t.modalText }}>{it.generic_name}</div>
                  <div style={{ fontSize: 10.5, color: t.text3 }}>{it.displayQty} · {it.available} {it.unit || "pcs"} available</div>
                </div>
                <input type="number" min={1} max={it.available} value={it.qty}
                  onChange={e => updateItemQty(it.medicine_id, e.target.value)}
                  style={{ ...inp, width: 70, height: 32, textAlign: "center", padding: "4px 6px" }} />
                <button onClick={() => removeItem(it.medicine_id)} style={{ border: "none", background: "none", color: "#d63031", fontSize: 16, cursor: "pointer", padding: 0 }}>×</button>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: 18, borderTop: `1px solid ${t.border2}`, flexShrink: 0 }}>
          <button onClick={handleDispenseAll} disabled={saving || !canDispense} style={{
            width: "100%", padding: "13px 0", borderRadius: 10, border: "none",
            background: canDispense ? t.green : t.tableRowBorder, color: canDispense ? "#fff" : t.text3,
            fontSize: 14, fontWeight: 900, cursor: canDispense && !saving ? "pointer" : "not-allowed",
            fontFamily: "inherit", boxShadow: canDispense ? `0 6px 18px ${t.green}44` : "none", opacity: saving ? 0.6 : 1,
          }}>
            {saving ? "DISPENSING…" : `DISPENSE ${items.length || ""} ITEM${items.length !== 1 ? "S" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   DispenseMedicineModal — manual, single-batch dispensing.
   Pharmacist picks the exact batch (no auto-FEFO here).

   THIS PASS: the "After Dispense" preview now shows the true 3-level
   cascade (Full Boxes / Loose Strips / Loose Pcs), computed from the
   selected batch's actual strips_per_box × pieces_per_strip — matching
   exactly how the batch will be split in the database after saving.
══════════════════════════════════════════════════════════════════════════ */
export default function DispenseMedicineModal({ medicine, onClose, onSaved, onToast }: Props) {
  const { t } = useTheme();
  const [batches, setBatches] = useState<MedicineBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [boxesToGive, setBoxesToGive] = useState("");
  const [looseToGive, setLooseToGive] = useState("");
  const [patientName, setPatientName] = useState("");
  const [saving, setSaving] = useState(false);
  const { user } = useAuth();

  const medicineIsBoxUnit = isBoxUnit(medicine.unit);

  useEffect(() => { fetchBatches(); /* eslint-disable-next-line */ }, []);

  const fetchBatches = async () => {
    setLoadingBatches(true);
    try {
      const { data, error } = await supabase
        .from("pharma_medicine_batches")
        .select("*")
        .eq("medicine_id", medicine.medicine_id)
        .in("status", ["available", "low_stock"])
        .gt("total_quantity", 0)
        .order("expiration_date", { ascending: true });
      if (error) throw error;
      const rows = (data as MedicineBatch[]) ?? [];
      setBatches(rows);
      if (rows.length > 0) setSelectedBatchId(rows[0].batch_id); // earliest-expiry pre-selected, but changeable
    } catch (err: any) {
      onToast(err.message || "Failed to load batches.", "error");
    } finally { setLoadingBatches(false); }
  };

  const selectedBatch = batches.find(b => b.batch_id === selectedBatchId) ?? null;
  const totalAvailable = selectedBatch?.total_quantity ?? 0;
  const piecesPerBox = selectedBatch ? Math.max(1, selectedBatch.strips_per_box * selectedBatch.pieces_per_strip) : 1;

  // Reset the quantity inputs whenever the selected batch changes, so a
  // leftover value from a different-sized batch can't sneak through.
  useEffect(() => {
    setQty(1); setBoxesToGive(""); setLooseToGive("");
  }, [selectedBatchId]);

  const effectiveQty = (medicineIsBoxUnit && selectedBatch)
    ? (parseInt(boxesToGive || "0", 10) * piecesPerBox) + parseInt(looseToGive || "0", 10)
    : qty;

  const remaining = totalAvailable - effectiveQty;
  const { boxes: newBoxes, looseStrips: newLooseStrips, loosePieces: newLoose } = selectedBatch
    ? splitIntoBoxStripPiece(Math.max(remaining, 0), selectedBatch.strips_per_box, selectedBatch.pieces_per_strip)
    : { boxes: 0, looseStrips: 0, loosePieces: 0 };
  const nameValid = patientName.trim().length > 0;
  const canDispense = !!selectedBatch && effectiveQty > 0 && effectiveQty <= totalAvailable && nameValid;

  const daysUntil = (dateStr: string | null) => {
    if (!dateStr) return Infinity;
    const todayStr = new Date().toLocaleDateString("en-CA");
    const a = new Date(todayStr + "T00:00:00");
    const b = new Date(dateStr + "T00:00:00");
    return Math.ceil((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
  };

  const handleDispense = async () => {
    if (!selectedBatch) { onToast("Select a batch first.", "error"); return; }
    if (!nameValid) { onToast("Patient / recipient name is required.", "error"); return; }
    if (!(effectiveQty > 0 && effectiveQty <= totalAvailable)) { onToast(`Quantity must be between 1 and ${totalAvailable}.`, "error"); return; }

    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const dispensedBy = session?.user?.id ?? null;
      const dispensedByName = await currentDisplayName();

      const newStatus: BatchStatus = remaining === 0 ? "out_of_stock" : remaining <= 10 ? "low_stock" : "available";

      const { error: dispErr } = await supabase.from("pharma_dispense_log").insert([{
        batch_id: selectedBatch.batch_id, medicine_id: medicine.medicine_id, quantity: effectiveQty,
        recipient_note: patientName.trim(), dispensed_by: dispensedBy, dispensed_by_name: dispensedByName,
        dispensed_at: new Date().toISOString(),
      }]);
      if (dispErr) throw dispErr;

      const { error: batchErr } = await supabase.from("pharma_medicine_batches")
        .update({ boxes: newBoxes, loose_strips: newLooseStrips, loose_pieces: newLoose, status: newStatus })
        .eq("batch_id", selectedBatch.batch_id);
      if (batchErr) throw batchErr;

      const qtyLabel = medicineIsBoxUnit
        ? [
            parseInt(boxesToGive || "0", 10) > 0 ? `${boxesToGive} box` : null,
            parseInt(looseToGive || "0", 10) > 0 ? `${looseToGive} pcs` : null,
          ].filter(Boolean).join(" + ") || `${effectiveQty} pcs`
        : `${effectiveQty} ${(medicine.unit || "piece(s)").toLowerCase()}`;

      await logAction({
        user_name: dispensedByName || user?.name || "Pharmacist",
        user_role: "Pharmacist",
        action: "DISPENSE_MEDICINE",
        module: "Pharmacy",
        description: `Dispensed ${qtyLabel} of ${medicine.generic_name} to ${patientName.trim()} (batch ${selectedBatch.batch_number || selectedBatch.batch_id.slice(0, 8)})`,
        status: "success",
      });

      onToast(`Dispensed ${qtyLabel} of ${medicine.generic_name} to ${patientName.trim()}.`, "success");
      onSaved();
      onClose();
    } catch (err: any) {
      onToast(err.message || "Failed to dispense.", "error");
    } finally { setSaving(false); }
  };

  const inp: CSSProperties = {
    border: `1.5px solid ${t.inputBorder}`, borderRadius: 8, padding: "8px 10px", fontSize: 16,
    fontFamily: "inherit", outline: "none", background: t.modalBg, color: t.modalText,
    width: "100%", height: 40, boxSizing: "border-box", textAlign: "center", fontWeight: 700,
  };

  const StatCard = ({ label, value, color }: { label: string; value: string | number; color: string }) => (
    <div style={{ background: t.modalBg, borderRadius: 8, border: `1px solid ${t.border}`, padding: "10px 12px", textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 10, color: t.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>{label}</div>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: t.modalBg, borderRadius: 18, width: 520, maxHeight: "90vh", overflowY: "auto", padding: "28px 32px", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }} onClick={e => e.stopPropagation()}>

        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: t.green, margin: "0 0 4px" }}>Dispense Medicine</h2>
          <p style={{ fontSize: 12, color: t.text3, margin: 0 }}>Pick a batch, then record who it was given to and how much.</p>
        </div>

        <div style={{ background: t.surface2, borderRadius: 12, border: `1px solid ${t.border}`, padding: "14px 16px", marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: t.text, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
            <PillIcon size={15} color={t.green} />
            {medicine.generic_name}
            <span style={{ fontSize: 12, fontWeight: 600, color: t.text3, marginLeft: 4 }}>{medicine.dosage_strength}</span>
          </div>
          {medicine.brand_name && <div style={{ fontSize: 11, color: t.text3, marginLeft: 23 }}>{medicine.brand_name}</div>}
        </div>

        {/* Patient / recipient — required, this is the primary column in the history table */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: t.text3, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 8 }}>
            Patient / Recipient Name <span style={{ color: "#dc2626" }}>*</span>
          </label>
          <input value={patientName} onChange={e => setPatientName(e.target.value)} placeholder="e.g. Juan Dela Cruz"
            style={{ ...inp, textAlign: "left", fontWeight: 500, fontSize: 13, height: 38, border: `1.5px solid ${!nameValid && patientName.length > 0 ? "#dc2626" : t.inputBorder}` }} />
          {!nameValid && patientName.length === 0 && (
            <div style={{ fontSize: 10.5, color: t.text3, marginTop: 4 }}>Required — who is this being dispensed to?</div>
          )}
        </div>

        {/* ── Batch picker ── */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: t.text3, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 8 }}>
            Select Batch ({batches.length} available)
          </label>

          {loadingBatches ? (
            <div style={{ fontSize: 12, color: t.text3, padding: "12px 0" }}>Loading batches…</div>
          ) : batches.length === 0 ? (
            <div style={{
              background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10, padding: "12px 14px",
              fontSize: 12, color: "#dc2626", fontWeight: 700, display: "flex", alignItems: "center", gap: 6,
            }}><XCircleIcon size={13} color="#dc2626" /> No usable stock batches for this medicine.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {batches.map(b => {
                const days = daysUntil(b.expiration_date);
                const isSel = selectedBatchId === b.batch_id;
                const soon = days <= 30;
                const bPiecesPerBox = Math.max(1, b.strips_per_box * b.pieces_per_strip);
                return (
                  <button key={b.batch_id} onClick={() => setSelectedBatchId(b.batch_id)} style={{
                    textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                    border: `1.5px solid ${isSel ? t.green : t.border2}`,
                    background: isSel ? `${t.green}12` : t.modalBg,
                    borderRadius: 10, padding: "10px 12px",
                    display: "flex", alignItems: "center", gap: 10,
                  }}>
                    <span style={{
                      width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                      background: isSel ? t.green : t.surface2, color: isSel ? "#fff" : t.green,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}><BoxIcon size={14} color={isSel ? "#fff" : t.green} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: t.text, display: "flex", alignItems: "center", gap: 8 }}>
                        {b.batch_number || `Batch ${b.batch_id.slice(0, 8)}`}
                        {soon && (
                          <span style={{ fontSize: 9, background: "#fef2f2", color: "#dc2626", borderRadius: 4, padding: "1px 6px", fontWeight: 800 }}>
                            {days <= 0 ? "EXPIRED" : `${days}D LEFT`}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: t.text3, marginTop: 1 }}>
                        Exp {b.expiration_date || "—"} · {b.boxes} box{b.boxes !== 1 ? "es" : ""} × {bPiecesPerBox} + {b.loose_strips} strip{b.loose_strips !== 1 ? "s" : ""} + {b.loose_pieces} loose
                      </div>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 900, color: b.total_quantity <= 10 ? "#d94040" : t.green, flexShrink: 0 }}>
                      {b.total_quantity}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selectedBatch && (
          <>
            {medicineIsBoxUnit ? (
              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: t.text3, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 8 }}>
                  Boxes &amp; Loose Pieces to Dispense (this batch = {piecesPerBox} pcs/box)
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, color: t.text3, marginBottom: 6, textAlign: "center" }}>Boxes</div>
                    <input type="number" min={0} value={boxesToGive} onChange={e => setBoxesToGive(e.target.value)} placeholder="0" style={inp} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: t.text3, marginBottom: 6, textAlign: "center" }}>Loose Pieces</div>
                    <input type="number" min={0} value={looseToGive} onChange={e => setLooseToGive(e.target.value)} placeholder="0" style={inp} />
                  </div>
                </div>
                <div style={{ marginTop: 8, fontSize: 11.5, color: t.text3, textAlign: "center" }}>
                  = <b style={{ color: t.green }}>{effectiveQty}</b> pcs total (max {totalAvailable})
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: t.text3, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 8 }}>
                  {medicine.unit || "Pieces"} to Dispense (from selected batch)
                </label>
                <div style={{ fontSize: 10.5, color: t.text3, marginBottom: 8 }}>
                  Counted in {(medicine.unit || "pieces").toLowerCase()} — this medicine's total stock ({totalAvailable}) is already tracked in that unit, so the number below matches exactly.
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button onClick={() => setQty(v => Math.max(1, v - 1))} style={{
                    width: 40, height: 40, borderRadius: 8, border: `1.5px solid ${t.inputBorder}`, background: t.modalBg,
                    color: t.text, fontSize: 22, cursor: "pointer", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 300,
                  }}>−</button>
                  <input type="number" min={1} max={totalAvailable} value={qty}
                    onChange={e => setQty(Math.max(1, Math.min(totalAvailable, parseInt(e.target.value) || 1)))}
                    style={inp} />
                  <button onClick={() => setQty(v => Math.min(totalAvailable, v + 1))} style={{
                    width: 40, height: 40, borderRadius: 8, border: `1.5px solid ${t.inputBorder}`, background: t.modalBg,
                    color: t.text, fontSize: 22, cursor: "pointer", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 300,
                  }}>+</button>
                </div>
              </div>
            )}

            {canDispense && (
              <div style={{
                background: remaining <= 10 ? "#fefce8" : `${t.green}0d`,
                border: `1px solid ${remaining <= 10 ? "#fde047" : t.green + "33"}`,
                borderRadius: 10, padding: "12px 14px", marginBottom: 18,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: t.text3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>After Dispense (this batch)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                  <StatCard label="Full Boxes" value={newBoxes} color={t.green} />
                  <StatCard label="Loose Strips" value={newLooseStrips} color="#0891b2" />
                  <StatCard label="Loose Pcs" value={newLoose} color="#e07a30" />
                  <StatCard label="Total Left" value={remaining} color={remaining <= 10 ? "#d94040" : t.text} />
                </div>
                {remaining <= 10 && (
                  <div style={{ fontSize: 11, color: "#92400e", fontWeight: 700, marginTop: 10, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                    <WarningIcon size={13} color="#92400e" /> Low stock warning after dispense
                  </div>
                )}
              </div>
            )}

            {effectiveQty > totalAvailable && (
              <div style={{
                background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10, padding: "10px 14px", marginBottom: 18,
                fontSize: 12, color: "#dc2626", fontWeight: 700, textAlign: "center",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}><XCircleIcon size={13} color="#dc2626" /> Not enough stock in this batch — only {totalAvailable} available.</div>
            )}
          </>
        )}

        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "11px 0", borderRadius: 8, border: `1.5px solid ${t.border2}`, background: "transparent", color: t.text2, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>CANCEL</button>
          <button onClick={handleDispense} disabled={saving || !canDispense} style={{
            flex: 2, padding: "11px 0", borderRadius: 8, border: "none",
            background: canDispense ? t.green : t.tableRowBorder, color: canDispense ? "#fff" : t.text3,
            fontSize: 13, fontWeight: 900, cursor: canDispense && !saving ? "pointer" : "not-allowed",
            fontFamily: "inherit", letterSpacing: "0.06em", opacity: saving ? 0.6 : 1,
            boxShadow: canDispense ? `0 3px 10px ${t.green}55` : "none", transition: "all 0.15s",
          }}>
            {saving ? "DISPENSING…" : `DISPENSE ${effectiveQty} ${medicineIsBoxUnit ? "PCS" : (medicine.unit || "PIECES").toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}