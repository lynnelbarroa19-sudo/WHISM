// MedicineStockPage.tsx — analytics stat cards and Import removed. The
// active table now shows one row per BATCH (not per medicine), joined with
// its parent medicine's catalog info.
//
// THIS PASS: true 3-level packaging tracking. Box / Strip / Pcs in the
// Quantity column shows the real, depletable total — boxes and
// loose_pieces — not "Box count + a fixed box-size label" like before.
// Dispensing (see DispenseMedicine.tsx) now decrements all three correctly
// via the box -> strip -> piece cascade.
"use client";
import { CSSProperties, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  useTheme,
  Medicine,
  MedicineBatch,
  MedicineStockSummary,
  MedicineCategory,
  BatchStatus,
} from "../lib/pharmacy";
import AddMedicineModal from "./AddMedicinePage";
import { Plus, Download, X, RotateCcw, Search, Archive as ArchiveIcon, Pencil } from "lucide-react";

type Props = {
  onToast: (msg: string, type: "success" | "error") => void;
  onMedicineAdded?: () => void;
};

type Tab = "drugs" | "supplies";
type StockLevelFilter = "all" | "high" | "medium" | "low" | "out";
type ExpiryFilter = "all" | "expiring" | "expired";

/** One batch row, joined with its parent medicine's catalog info — this is
 *  what actually drives the active table now. */
type BatchRow = MedicineBatch & {
  pharma_medicines: {
    generic_name: string;
    dosage_strength: string | null;
    dosage_form: string | null;
    category: MedicineCategory;
    unit: string | null;
    is_archived: boolean;
  } | null;
};

/** Same rule AddMedicinePage uses: the Box/Strip/Piece breakdown only
 *  applies when the medicine's Unit is literally "Boxes". */
function isBoxUnit(unit: string | null | undefined): boolean {
  return (unit ?? "").trim().toLowerCase() === "boxes";
}

async function exportToExcel(rows: BatchRow[], tabLabel: string) {
  const XLSX = await import("xlsx");
  const data = rows.map((b, i) => {
    const boxUnit = isBoxUnit(b.pharma_medicines?.unit);
    return {
      "No.": i + 1, "Batch No.": b.batch_number ?? "",
      "Medicine Name": b.pharma_medicines?.generic_name ?? "",
      "Dosage/Type": `${b.pharma_medicines?.dosage_strength ?? "—"} / ${b.pharma_medicines?.dosage_form ?? "—"}`,
      "Unit": boxUnit ? `${b.boxes} box${b.boxes !== 1 ? "es" : ""}` : (b.pharma_medicines?.unit ?? ""),
      "Expiration Date": b.expiration_date, "Status": b.status,
      "Storage": b.storage_location ?? "",
      "Quantity": boxUnit ? `${b.total_quantity} pcs` : `${b.total_quantity} ${b.pharma_medicines?.unit ?? "pcs"}`,
    };
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, tabLabel);
  XLSX.writeFile(wb, `${tabLabel.toLowerCase().replace(/ /g, "_")}_${new Date().toISOString().split("T")[0]}.xlsx`);
}

async function exportToPDF(rows: BatchRow[], tabLabel: string) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14); doc.text(`${tabLabel} Report`, 14, 16);
  doc.setFontSize(9); doc.text(`Generated: ${new Date().toLocaleDateString("en-PH")}`, 14, 22);
  autoTable(doc, {
    startY: 27,
    head: [["#", "Batch No.", "Medicine Name", "Dosage/Type", "Unit", "Expiration", "Status", "Storage", "Quantity"]],
    body: rows.map((b, i) => {
      const boxUnit = isBoxUnit(b.pharma_medicines?.unit);
      const unitLabel = boxUnit ? `${b.boxes} box${b.boxes !== 1 ? "es" : ""}` : (b.pharma_medicines?.unit ?? "—");
      const qty = boxUnit ? `${b.total_quantity} pcs` : `${b.total_quantity} ${b.pharma_medicines?.unit ?? "pcs"}`;
      return [
        i + 1, b.batch_number ?? "—", b.pharma_medicines?.generic_name ?? "—",
        `${b.pharma_medicines?.dosage_strength ?? "—"} / ${b.pharma_medicines?.dosage_form ?? "—"}`,
        unitLabel, b.expiration_date, b.status.replace("_", " "),
        b.storage_location ?? "—", qty,
      ];
    }),
    styles: { fontSize: 8 }, headStyles: { fillColor: [22, 163, 74] },
  });
  doc.save(`${tabLabel.toLowerCase().replace(/ /g, "_")}_${new Date().toISOString().split("T")[0]}.pdf`);
}

/* ── Small shared UI pieces ── */
function StockBadge({ m }: { m: MedicineStockSummary }) {
  const { t } = useTheme();
  const total = m.total_quantity;
  const color = total === 0 ? "#dc2626" : total <= 10 ? "#d97706" : t.green;
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: 14, fontWeight: 900, color }}>{total}</div>
      <div style={{ fontSize: 10, color: t.text3 }}>{m.unit || "pcs"}</div>
    </div>
  );
}

function BatchStatusPill({ status }: { status: BatchStatus }) {
  const map: Record<BatchStatus, { bg: string; color: string }> = {
    available: { bg: "#dcfce7", color: "#166534" }, low_stock: { bg: "#fef3c7", color: "#b45309" },
    out_of_stock: { bg: "#fee2e2", color: "#dc2626" }, expired: { bg: "#fee2e2", color: "#dc2626" },
    archived: { bg: "#f3f4f6", color: "#6b7280" },
  };
  const s = map[status];
  return <span style={{ padding: "2px 9px", borderRadius: 20, fontSize: 9.5, fontWeight: 800, background: s.bg, color: s.color, whiteSpace: "nowrap" }}>{status.replace("_", " ")}</span>;
}

/** A row from pharma_archived_batches — auto-archived expired batches,
 *  separate from the manually-archived medicines list above. */
type ArchivedBatchRow = {
  archived_batch_id: string;
  generic_name: string;
  dosage_strength: string | null;
  dosage_form: string | null;
  unit: string | null;
  batch_number: string | null;
  expiration_date: string;
  total_quantity: number;
  archive_reason: string;
  archived_at: string;
};

/* ── Edit Batch modal — fixes/completes a batch's info directly (batch
 *  number, expiry, storage, quantity breakdown). Mainly for the "blank"
 *  batches the old fulfill-trigger created before it copied real
 *  Warehouse batch data — those have no batch_number/expiration_date and
 *  need manual correction. Also just generally useful for any batch. ── */
function EditBatchModal({ batch, onClose, onSaved, onToast }: {
  batch: BatchRow;
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string, type: "success" | "error") => void;
}) {
  const { t } = useTheme();
  const [batchNumber, setBatchNumber] = useState(batch.batch_number ?? "");
  const [expirationDate, setExpirationDate] = useState(batch.expiration_date ?? "");
  const [storageLocation, setStorageLocation] = useState(batch.storage_location ?? "");
  const [boxes, setBoxes] = useState(String(batch.boxes ?? 0));
  const [stripsPerBox, setStripsPerBox] = useState(batch.strips_per_box != null ? String(batch.strips_per_box) : "");
  const [piecesPerStrip, setPiecesPerStrip] = useState(batch.pieces_per_strip != null ? String(batch.pieces_per_strip) : "");
  const [loosePieces, setLoosePieces] = useState(String(batch.loose_pieces ?? 0));
  const [remarks, setRemarks] = useState(batch.remarks ?? "");
  const [saving, setSaving] = useState(false);

  const piecesPerBox = Math.max(0, (parseInt(stripsPerBox, 10) || 0) * (parseInt(piecesPerStrip, 10) || 0));
  const previewTotal = (parseInt(boxes, 10) || 0) * piecesPerBox + (parseInt(loosePieces, 10) || 0);

  const handleSave = async () => {
    setSaving(true);
    try {
      const boxesN = Math.max(0, parseInt(boxes, 10) || 0);
      const looseN = Math.max(0, parseInt(loosePieces, 10) || 0);
      const total = boxesN * piecesPerBox + looseN;
      const newStatus = total === 0 ? "out_of_stock" : total <= 10 ? "low_stock" : "available";

      const { error } = await supabase.from("pharma_medicine_batches").update({
        batch_number: batchNumber.trim() || null,
        expiration_date: expirationDate || null,
        storage_location: storageLocation.trim() || null,
        boxes: boxesN,
        strips_per_box: stripsPerBox.trim() ? Math.max(0, parseInt(stripsPerBox, 10) || 0) : null,
        pieces_per_strip: piecesPerStrip.trim() ? Math.max(1, parseInt(piecesPerStrip, 10) || 1) : null,
        loose_pieces: looseN,
        remarks: remarks.trim() || null,
        status: newStatus,
      }).eq("batch_id", batch.batch_id);
      if (error) throw error;

      onToast("Batch updated.", "success");
      onSaved();
      onClose();
    } catch (err: any) {
      onToast(err.message || "Failed to update batch.", "error");
    } finally {
      setSaving(false);
    }
  };

  const inp: CSSProperties = {
    border: `1.5px solid ${t.inputBorder}`, borderRadius: 8, padding: "9px 12px",
    fontSize: 13, fontFamily: "inherit", outline: "none", background: t.modalBg,
    color: t.modalText, width: "100%", height: 38, boxSizing: "border-box",
  };
  const lbl: CSSProperties = {
    fontSize: 10.5, fontWeight: 700, color: t.text3, textTransform: "uppercase",
    letterSpacing: "0.06em", marginBottom: 5, display: "block",
  };
  const row2: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };
  const field: CSSProperties = { marginBottom: 14 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "min(480px, 94vw)", maxHeight: "88vh", overflowY: "auto",
        background: t.cardBg, borderRadius: 18, border: `2px solid ${t.green}`,
        boxShadow: "0 24px 60px rgba(0,0,0,0.4)", padding: "24px 26px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 10.5, color: t.text3, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.2 }}>Edit Batch</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: t.text }}>{batch.pharma_medicines?.generic_name ?? "Medicine"}</div>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", color: t.text3, cursor: "pointer", fontSize: 18, padding: 4 }}>✕</button>
        </div>
        {(!batch.batch_number || !batch.expiration_date) && (
          <div style={{ background: "#fef3c7", border: "1px solid #fde047", borderRadius: 8, padding: "8px 12px", fontSize: 11.5, color: "#854d0e", marginBottom: 16, marginTop: 10 }}>
            This batch is missing detail (likely created before Warehouse batch info was linked). Fill in what you know.
          </div>
        )}
        {(batch.batch_number && batch.expiration_date) && <div style={{ marginBottom: 16 }} />}

        <div style={{ ...row2, ...field }}>
          <div>
            <label style={lbl}>Batch Number</label>
            <input value={batchNumber} onChange={e => setBatchNumber(e.target.value)} placeholder="e.g. B-2026-0451" style={inp} />
          </div>
          <div>
            <label style={lbl}>Expiration Date</label>
            <input type="date" value={expirationDate} onChange={e => setExpirationDate(e.target.value)} style={inp} />
          </div>
        </div>

        <div style={field}>
          <label style={lbl}>Storage Location</label>
          <input value={storageLocation} onChange={e => setStorageLocation(e.target.value)} placeholder="e.g. Shelf A-3" style={inp} />
        </div>

        <div style={{ ...row2, ...field }}>
          <div>
            <label style={lbl}>Strips / Box (optional)</label>
            <input type="number" min={0} value={stripsPerBox} onChange={e => setStripsPerBox(e.target.value)} placeholder="e.g. 10" style={inp} />
          </div>
          <div>
            <label style={lbl}>Pieces / Strip (optional)</label>
            <input type="number" min={0} value={piecesPerStrip} onChange={e => setPiecesPerStrip(e.target.value)} placeholder="e.g. 10" style={inp} />
          </div>
        </div>

        <div style={{ ...row2, ...field }}>
          <div>
            <label style={lbl}>Boxes</label>
            <input type="number" min={0} value={boxes} onChange={e => setBoxes(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={lbl}>Loose Pieces</label>
            <input type="number" min={0} value={loosePieces} onChange={e => setLoosePieces(e.target.value)} style={inp} />
          </div>
        </div>

        <div style={field}>
          <label style={lbl}>Remarks (optional)</label>
          <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2}
            style={{ ...inp, height: "auto", padding: "8px 10px", resize: "vertical", fontFamily: "inherit" }} />
        </div>

        <div style={{
          marginBottom: 18, background: t.surface2, borderRadius: 8, padding: "9px 14px",
          textAlign: "center", border: `1px solid ${t.border}`,
        }}>
          <span style={{ fontSize: 11, color: t.text3 }}>New total: </span>
          <span style={{ fontSize: 15, fontWeight: 900, color: t.green }}>{previewTotal} pcs</span>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "11px 0", borderRadius: 9, border: `1.5px solid ${t.border2}`,
            background: "transparent", color: t.text2, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{
            flex: 2, padding: "11px 0", borderRadius: 9, border: "none",
            background: t.green, color: "#fff", fontSize: 13, fontWeight: 900, cursor: "pointer",
            fontFamily: "inherit", opacity: saving ? 0.6 : 1,
          }}>{saving ? "SAVING…" : "SAVE CHANGES"}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Main component ── */
export default function MedicineStockPage({ onToast, onMedicineAdded }: Props) {
  const { t } = useTheme();

  const [medicines, setMedicines] = useState<MedicineStockSummary[]>([]);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [archivedMeds, setArchivedMeds] = useState<MedicineStockSummary[]>([]);
  const [archivedBatches, setArchivedBatches] = useState<ArchivedBatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [loadingArchivedBatches, setLoadingArchivedBatches] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [showExport, setShowExport] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingBatch, setEditingBatch] = useState<BatchRow | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("drugs");
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<StockLevelFilter>("all");
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>("all");

  useEffect(() => {
    const handler = (e: Event) => setSearch((e as CustomEvent).detail?.toLowerCase() ?? "");
    window.addEventListener("header-search", handler);
    return () => window.removeEventListener("header-search", handler);
  }, []);

  /** Medicine catalog summary — still needed for the Drugs/Supplies tab
   *  counts (pill badges) and the Archived tab, both of which stay at the
   *  medicine level. */
  const fetchMedicines = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("pharma_medicine_stock_summary").select("*")
        .eq("is_archived", false).order("generic_name", { ascending: true });
      if (error) throw error;
      setMedicines((data as MedicineStockSummary[]) ?? []);
    } catch (err: any) { onToast(err.message || "Failed to load medicines.", "error"); }
  }, [onToast]);

  /** Batch-level rows for the active table — joined with the parent
   *  medicine's catalog fields (name, dosage, type, unit, category). */
  const fetchBatchRows = useCallback(async () => {
    setLoading(true);
    try {
      // Move any newly-expired batches into pharma_archived_batches first
      // — they're gone from pharma_medicine_batches after this, so the
      // fetch right after only ever returns live, non-expired stock.
      const { data: archivedCount, error: archiveErr } = await supabase.rpc("archive_expired_batches");
      if (archiveErr) throw archiveErr;
      if ((archivedCount ?? 0) > 0) {
        onToast(`${archivedCount} expired batch(es) moved to archive.`, "success");
        fetchMedicines();
        fetchArchivedBatches();
      }

      const { data, error } = await supabase
        .from("pharma_medicine_batches")
        .select("*, pharma_medicines(generic_name, dosage_strength, dosage_form, category, unit, is_archived)")
        .neq("status", "archived")
        .order("expiration_date", { ascending: true });
      if (error) throw error;
      const rows = ((data as BatchRow[]) ?? []).filter(b => b.pharma_medicines && !b.pharma_medicines.is_archived);
      setBatchRows(rows);
    } catch (err: any) { onToast(err.message || "Failed to load medicine batches.", "error"); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onToast, fetchMedicines]);

  const fetchArchived = useCallback(async () => {
    setLoadingArchived(true);
    try {
      const { data, error } = await supabase.from("pharma_medicine_stock_summary").select("*").eq("is_archived", true).order("generic_name", { ascending: true });
      if (error) throw error;
      setArchivedMeds((data as MedicineStockSummary[]) ?? []);
    } catch (err: any) { onToast(err.message || "Failed to load archived.", "error"); }
    finally { setLoadingArchived(false); }
  }, [onToast]);

  /** Batches auto-archived on expiry (pharma_archived_batches) — separate
   *  data source from the manually-archived medicines above. */
  const fetchArchivedBatches = useCallback(async () => {
    setLoadingArchivedBatches(true);
    try {
      const { data, error } = await supabase
        .from("pharma_archived_batches")
        .select("archived_batch_id, generic_name, dosage_strength, dosage_form, unit, batch_number, expiration_date, total_quantity, archive_reason, archived_at")
        .order("archived_at", { ascending: false });
      if (error) throw error;
      setArchivedBatches((data as ArchivedBatchRow[]) ?? []);
    } catch (err: any) { onToast(err.message || "Failed to load archived batches.", "error"); }
    finally { setLoadingArchivedBatches(false); }
  }, [onToast]);

  const unarchiveItem = async (id: string) => {
    try {
      await supabase.from("pharma_medicines").update({ is_archived: false }).eq("medicine_id", id);
      onToast("Item restored successfully.", "success");
      fetchArchived(); fetchMedicines(); fetchBatchRows();
    } catch (err: any) { onToast(err.message || "Failed to restore.", "error"); }
  };

  useEffect(() => { fetchMedicines(); }, [fetchMedicines]);
  useEffect(() => { fetchBatchRows(); }, [fetchBatchRows]);
  useEffect(() => { fetchArchived(); }, [fetchArchived]);
  useEffect(() => { fetchArchivedBatches(); }, [fetchArchivedBatches]);
  useEffect(() => { setSelected([]); }, [activeTab]);

  const archiveSelected = async () => {
    if (selected.length === 0) return;
    try {
      await supabase.from("pharma_medicines").update({ is_archived: true }).in("medicine_id", selected);
      onToast(`Archived ${selected.length} item(s).`, "success");
      setSelected([]); fetchMedicines(); fetchBatchRows();
      if (showArchived) fetchArchived();
    } catch (err: any) { onToast(err.message || "Failed to archive.", "error"); }
  };

  const daysUntil = (dateStr: string | null) => {
    if (!dateStr) return Infinity;
    const todayStr = new Date().toLocaleDateString("en-CA");
    const a = new Date(todayStr + "T00:00:00");
    const b = new Date(dateStr + "T00:00:00");
    return Math.ceil((b.getTime() - a.getTime()) / 86400000);
  };

  const matchesStockFilter = (qty: number): boolean => {
    if (stockFilter === "all") return true;
    if (stockFilter === "out") return qty === 0;
    if (stockFilter === "low") return qty > 0 && qty <= 10;
    if (stockFilter === "medium") return qty > 10 && qty <= 50;
    if (stockFilter === "high") return qty > 50;
    return true;
  };
  const matchesExpiryFilter = (dateStr: string | null): boolean => {
    if (expiryFilter === "all") return true;
    const days = daysUntil(dateStr);
    if (expiryFilter === "expired") return days <= 0;
    if (expiryFilter === "expiring") return days > 0 && days <= 30;
    return true;
  };

  const activeBatchRows = batchRows
    .filter(b => b.pharma_medicines?.category === activeTab)
    .filter(b => matchesStockFilter(b.total_quantity))
    .filter(b => matchesExpiryFilter(b.expiration_date))
    .filter(b => !search
      || (b.pharma_medicines?.generic_name ?? "").toLowerCase().includes(search)
      || (b.pharma_medicines?.dosage_strength ?? "").toLowerCase().includes(search)
      || (b.pharma_medicines?.dosage_form ?? "").toLowerCase().includes(search)
      || (b.pharma_medicines?.unit ?? "").toLowerCase().includes(search)
      || (b.batch_number ?? "").toLowerCase().includes(search)
      || (b.storage_location ?? "").toLowerCase().includes(search));

  const drugCount = medicines.filter(m => m.category === "drugs").length;
  const supplyCount = medicines.filter(m => m.category === "supplies").length;
  const tabLabel = activeTab === "drugs" ? "Medicine Drugs" : "Medicine Supplies";

  const uniqueMedicineIds = Array.from(new Set(activeBatchRows.map(b => b.medicine_id)));
  const toggleAll = () => setSelected(s => s.length === uniqueMedicineIds.length ? [] : uniqueMedicineIds);
  const toggleRow = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const thStyle: CSSProperties = { padding: "12px 12px", textAlign: "left", fontWeight: 800, color: t.green, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" };
  const activeExtraFilterCount = (stockFilter !== "all" ? 1 : 0) + (expiryFilter !== "all" ? 1 : 0);

  return (
    <main style={{ flex: 1, padding: 24, overflowY: "auto", background: t.surface2 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div>
          <p style={{ color: t.text3, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 4, margin: 0 }}>Pharmacist</p>
          <h1 style={{ fontSize: 28, fontWeight: 900, color: t.text, margin: 0, lineHeight: 1 }}>MEDICINE INVENTORY</h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setShowAddModal(true)} style={{
            background: t.green, color: "#fff", border: "none", borderRadius: 10, padding: "11px 24px",
            cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 14,
            boxShadow: `0 6px 18px ${t.green}44`, whiteSpace: "nowrap",
          }}>
            <Plus size={17} /> Add Medicine
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ background: t.cardBg, borderRadius: 14, padding: "16px 20px", marginBottom: 16, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", border: `1px solid ${t.cardBorder}` }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.text2, display: "flex" }}><Search size={14} /></span>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search generic name, batch no., storage..."
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 34px 9px 32px", borderRadius: 8, border: `1.5px solid ${t.border}`, fontSize: 12.5, outline: "none", color: t.text, background: t.surface2 }}
            />
            {search && (
              <button onClick={() => setSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: t.text2, display: "flex", padding: 0 }}>
                <X size={14} />
              </button>
            )}
          </div>

          <select value={stockFilter} onChange={e => setStockFilter(e.target.value as StockLevelFilter)} style={{
            padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, border: `1.5px solid ${t.border}`, background: t.surface2, color: t.text, cursor: "pointer",
          }}>
            <option value="all">All Stock Levels</option>
            <option value="high">High (50+)</option>
            <option value="medium">Medium (11–50)</option>
            <option value="low">Low (1–10)</option>
            <option value="out">Out of Stock</option>
          </select>
          <select value={expiryFilter} onChange={e => setExpiryFilter(e.target.value as ExpiryFilter)} style={{
            padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, border: `1.5px solid ${t.border}`, background: t.surface2, color: t.text, cursor: "pointer",
          }}>
            <option value="all">All Expiry</option>
            <option value="expiring">Expiring ≤30 days</option>
            <option value="expired">Expired</option>
          </select>
          {activeExtraFilterCount > 0 && (
            <button onClick={() => { setStockFilter("all"); setExpiryFilter("all"); }} style={{ border: "none", background: "transparent", color: "#dc2626", fontSize: 11.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
              <X size={12} /> Clear
            </button>
          )}

          <div style={{ position: "relative", marginLeft: "auto" }}>
            <button onClick={() => setShowExport(v => !v)} style={{ padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 800, border: `1.5px solid ${t.border}`, background: t.cardBg, color: t.green, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              <Download size={13} /> Export
            </button>
            {showExport && (
              <div style={{ position: "absolute", right: 0, top: "110%", background: t.cardBg, border: `1px solid ${t.border}`, borderRadius: 8, zIndex: 99, minWidth: 170, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", overflow: "hidden" }}>
                <button onClick={() => { exportToExcel(activeBatchRows, tabLabel); setShowExport(false); }} style={{ width: "100%", padding: "10px 14px", textAlign: "left", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, color: t.text, fontWeight: 600 }}>Download as Excel</button>
                <button onClick={() => { exportToPDF(activeBatchRows, tabLabel); setShowExport(false); }} style={{ width: "100%", padding: "10px 14px", textAlign: "left", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, color: t.text, fontWeight: 600 }}>Download as PDF</button>
              </div>
            )}
          </div>
        </div>

        {/* Pill tabs */}
        <div style={{ display: "flex", gap: 3, background: t.surface2, borderRadius: 24, padding: 3, border: `1px solid ${t.border}`, marginBottom: 10, width: "fit-content" }}>
          {[{ tab: "drugs" as Tab, label: "Drugs", count: drugCount }, { tab: "supplies" as Tab, label: "Supplies", count: supplyCount }].map(({ tab, label, count }) => {
            const active = activeTab === tab && !showArchived;
            return (
              <button key={tab} onClick={() => { setActiveTab(tab); setShowArchived(false); }} style={{
                padding: "6px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
                background: active ? t.green : "transparent", color: active ? "#fff" : t.text2,
                display: "flex", alignItems: "center", gap: 6,
              }}>
                {label}
                <span style={{ background: active ? "rgba(255,255,255,0.25)" : t.border, color: active ? "#fff" : t.text2, borderRadius: 20, padding: "1px 8px", fontSize: 10, fontWeight: 700 }}>{count}</span>
              </button>
            );
          })}
          <button onClick={() => setShowArchived(v => !v)} style={{
            padding: "6px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
            background: showArchived ? "#6b7280" : "transparent", color: showArchived ? "#fff" : t.text2,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <ArchiveIcon size={13} /> Archived
            <span style={{ background: showArchived ? "rgba(255,255,255,0.25)" : t.border, color: showArchived ? "#fff" : t.text2, borderRadius: 20, padding: "1px 8px", fontSize: 10, fontWeight: 700 }}>{archivedMeds.length + archivedBatches.length}</span>
          </button>
        </div>

        {!showArchived && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: t.text2, cursor: "pointer", padding: "5px 14px", borderRadius: 20, border: `1.5px solid ${t.border}` }}>
              <input type="checkbox" checked={uniqueMedicineIds.length > 0 && selected.length === uniqueMedicineIds.length} onChange={toggleAll} style={{ accentColor: t.green, width: 12, height: 12 }} />
              Select All
            </label>
            {selected.length > 0 && (
              <button onClick={archiveSelected} style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, border: "none", background: t.green, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <ArchiveIcon size={12} /> Archive ({selected.length})
              </button>
            )}
          </div>
        )}
      </div>

      {/* Active table — batch-level rows */}
      {!showArchived && (
        <div style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: t.surface2, borderBottom: `2px solid ${t.border}` }}>
                  <th style={{ ...thStyle, width: 60 }}>No.</th>
                  <th style={thStyle}>Batch No.</th>
                  <th style={thStyle}>Medicine Name</th>
                  <th style={thStyle}>Dosage/Type</th>
                  <th style={thStyle}>Expiration Date</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Status</th>
                  <th style={thStyle}>Storage</th>
                  <th style={thStyle}>Unit</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Quantity</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} style={{ textAlign: "center", padding: 48, color: t.text2 }}>
                    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 30, height: 30, border: `3px solid ${t.green}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                      Loading medicines...
                    </div>
                  </td></tr>
                ) : activeBatchRows.length === 0 ? (
                  <tr><td colSpan={9} style={{ textAlign: "center", padding: 48, color: t.text2 }}>
                    {search || activeExtraFilterCount > 0 ? "No batches match your search/filters." : `No ${tabLabel.toLowerCase()} batches yet. Add a medicine to get started.`}
                  </td></tr>
                ) : activeBatchRows.map((b, n) => {
                  const sel = selected.includes(b.medicine_id);
                  const days = daysUntil(b.expiration_date);
                  const isExpiring = days <= 30;
                  const rowBg = sel ? `${t.green}0d` : "transparent";
                  const boxUnit = isBoxUnit(b.pharma_medicines?.unit);

                  return (
                    <tr key={b.batch_id} style={{ background: rowBg, borderBottom: `1px solid ${t.border}` }}>
                      <td style={{ padding: "11px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <input type="checkbox" checked={sel} onChange={() => toggleRow(b.medicine_id)} style={{ accentColor: t.green, width: 12, height: 12 }} />
                          <span style={{ color: t.text2, fontSize: 12 }}>{n + 1}</span>
                        </div>
                      </td>
                      <td style={{ padding: "11px 12px", color: t.text2 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span>{b.batch_number || "—"}</span>
                          <button
                            onClick={() => setEditingBatch(b)}
                            title="Edit batch"
                            style={{
                              border: "none", background: "transparent", cursor: "pointer",
                              color: t.text3, padding: 2, display: "flex", flexShrink: 0,
                            }}
                          ><Pencil size={12} /></button>
                        </div>
                      </td>
                      <td style={{ padding: "11px 12px", fontWeight: 700, color: t.text }}>{b.pharma_medicines?.generic_name ?? "—"}</td>
                      <td style={{ padding: "11px 12px", color: t.text2 }}>{b.pharma_medicines?.dosage_strength || "—"} / {b.pharma_medicines?.dosage_form || "—"}</td>
                      <td style={{ padding: "11px 12px", color: isExpiring ? "#dc2626" : t.text2 }}>
                        {b.expiration_date || <span style={{ fontStyle: "italic" }}>No expiry</span>}
                        {isExpiring && <span style={{ fontSize: 9, marginLeft: 5, background: "#fee2e2", color: "#dc2626", borderRadius: 4, padding: "1px 5px", fontWeight: 800 }}>{days <= 0 ? "EXPIRED" : `${days}D`}</span>}
                      </td>
                      <td style={{ padding: "11px 12px", textAlign: "center" }}>
                        <BatchStatusPill status={b.status} />
                      </td>
                      <td style={{ padding: "11px 12px", color: t.text2 }}>{b.storage_location || "—"}</td>
                      <td style={{ padding: "11px 12px", color: t.text2 }}>
                        {boxUnit ? `${b.boxes} box${b.boxes !== 1 ? "es" : ""}` : (b.pharma_medicines?.unit || "—")}
                      </td>
                      <td style={{ padding: "11px 12px", textAlign: "right", fontWeight: 800, color: t.green }}>
                        {b.total_quantity} {boxUnit ? "pcs" : (b.pharma_medicines?.unit || "pcs")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderTop: `1px solid ${t.border}`, background: t.surface2 }}>
            <span style={{ fontSize: 12, color: t.text2, fontWeight: 600 }}>{activeBatchRows.length === 0 ? "No results" : `${activeBatchRows.length} batch${activeBatchRows.length !== 1 ? "es" : ""} · ${tabLabel.toLowerCase()}`}</span>
            {selected.length > 0 && <span style={{ fontSize: 12, color: t.green, fontWeight: 700 }}>{selected.length} selected</span>}
          </div>
        </div>
      )}

      {/* Archived — unified table, combines auto-archived expired batches
          and manually-archived medicines into one list with a Reason
          column instead of separate sub-tabs. */}
      {showArchived && (
        <div style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: t.surface2, borderBottom: `2px solid ${t.border}` }}>
                  {["No.", "Medicine Name", "Dosage/Type", "Unit", "Reason", "Detail", "Quantity", "Date", "Action"].map((h, i) => (
                    <th key={h} style={{ ...thStyle, textAlign: i === 6 ? "right" : i === 8 ? "center" : "left" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(loadingArchived || loadingArchivedBatches) ? (
                  <tr><td colSpan={9} style={{ textAlign: "center", padding: 48, color: t.text2 }}>Loading archived items...</td></tr>
                ) : (archivedBatches.length === 0 && archivedMeds.length === 0) ? (
                  <tr><td colSpan={9} style={{ textAlign: "center", padding: 48, color: t.text2 }}>No archived items.</td></tr>
                ) : (
                  <>
                    {archivedBatches.map((b, n) => (
                      <tr key={b.archived_batch_id} style={{ borderBottom: `1px solid ${t.border}` }}>
                        <td style={{ padding: "11px 12px", color: t.text2 }}>{n + 1}</td>
                        <td style={{ padding: "11px 12px", fontWeight: 700, color: t.text }}>{b.generic_name}</td>
                        <td style={{ padding: "11px 12px", color: t.text2 }}>{b.dosage_strength || "—"} / {b.dosage_form || "—"}</td>
                        <td style={{ padding: "11px 12px", color: t.text2 }}>{b.unit || "—"}</td>
                        <td style={{ padding: "11px 12px" }}>
                          <span style={{ fontSize: 9.5, fontWeight: 800, padding: "2px 9px", borderRadius: 20, background: "#fee2e2", color: "#dc2626" }}>Expired</span>
                        </td>
                        <td style={{ padding: "11px 12px", color: "#dc2626", fontWeight: 700 }}>Batch {b.batch_number || "—"} · exp {b.expiration_date || "—"}</td>
                        <td style={{ padding: "11px 12px", textAlign: "right", color: t.text2 }}>{b.total_quantity} {b.unit || "pcs"}</td>
                        <td style={{ padding: "11px 12px", color: t.text3, fontSize: 11 }}>{new Date(b.archived_at).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })}</td>
                        <td style={{ padding: "11px 12px", textAlign: "center", color: t.text3, fontSize: 10.5, fontStyle: "italic" }}>—</td>
                      </tr>
                    ))}
                    {archivedMeds.map((med, n) => (
                      <tr key={med.medicine_id} style={{ borderBottom: `1px solid ${t.border}` }}>
                        <td style={{ padding: "11px 12px", color: t.text2 }}>{archivedBatches.length + n + 1}</td>
                        <td style={{ padding: "11px 12px", fontWeight: 700, color: t.text }}>{med.generic_name}</td>
                        <td style={{ padding: "11px 12px", color: t.text2 }}>{med.dosage_strength || "—"} / {med.dosage_form || "—"}</td>
                        <td style={{ padding: "11px 12px", color: t.text2 }}>{med.unit || "—"}</td>
                        <td style={{ padding: "11px 12px" }}>
                          <span style={{ fontSize: 9.5, fontWeight: 800, padding: "2px 9px", borderRadius: 20, background: "#f3f4f6", color: "#6b7280" }}>Manual</span>
                        </td>
                        <td style={{ padding: "11px 12px", color: t.text2 }}>{med.brand_name || "—"}</td>
                        <td style={{ padding: "11px 12px", textAlign: "right" }}><StockBadge m={med} /></td>
                        <td style={{ padding: "11px 12px", color: t.text3, fontSize: 11 }}>{med.nearest_expiry ?? "—"}</td>
                        <td style={{ padding: "11px 12px", textAlign: "center" }}>
                          <button onClick={() => unarchiveItem(med.medicine_id)} style={{ background: "#dcfce7", color: "#166534", border: "1.5px solid #86efac", borderRadius: 20, padding: "3px 14px", fontSize: 10, fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <RotateCcw size={10} /> Restore
                          </button>
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "14px 18px", borderTop: `1px solid ${t.border}`, background: t.surface2 }}>
            <span style={{ fontSize: 12, color: t.text2, fontWeight: 600 }}>
              {archivedBatches.length + archivedMeds.length} archived item{(archivedBatches.length + archivedMeds.length) !== 1 ? "s" : ""}
              {" "}({archivedBatches.length} expired, {archivedMeds.length} manual)
            </span>
          </div>
        </div>
      )}

      {/* Modals */}
      {showAddModal && (
        <AddMedicineModal onClose={() => setShowAddModal(false)} onSaved={() => { fetchMedicines(); fetchBatchRows(); onMedicineAdded?.(); }} onToast={onToast} defaultTab={activeTab} />
      )}
      {editingBatch && (
        <EditBatchModal
          batch={editingBatch}
          onClose={() => setEditingBatch(null)}
          onSaved={() => { fetchBatchRows(); fetchMedicines(); }}
          onToast={onToast}
        />
      )}
    </main>
  );
}