"use client";
import { CSSProperties, useCallback, useEffect, useState } from "react";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/lib/supabase";
import { Medicine } from "@/lib/types";
import AddMedicineModal from "../modal/AddMedicineModal";
import RestockModal     from "../modal/RestockModal";
import { Plus, Download, X, RotateCcw } from "lucide-react";

type Props = {
  onToast: (msg: string, type: "success" | "error") => void;
  onMedicineAdded?: () => void;
  darkMode?: boolean;
};

type Tab = "drugs" | "supplies";

type ImportRow = {
  med_name:       string;
  med_dosage:     string;
  med_type:       string;
  unit:           string;
  exp_date:       string;
  quantity:       number;
  boxes:          number;
  pieces_per_box: number;
  partial_pieces: number;
};

/* ── Design tokens ──────────────────────────────────────────────────────────── */
const T = {
  green:      "#16a34a",
  greenDark:  "#0d3b1f",
  greenMid:   "#166534",
  greenLight: "#dcfce7",
  mint:       "#4ade80",
  bg:         "#f0f7f2",
  surface:    "#ffffff",
  surface2:   "#f6faf7",
  border:     "rgba(22,163,74,0.15)",
  text:       "#0a2912",
  text2:      "#4b6557",
  text3:      "#9ca3af",
  shadow:     "0 2px 16px rgba(13,59,31,0.08)",
  radius:     14,
  radiusSm:   8,
  bgDk:       "#061a0d",
  surfDk:     "#0d2516",
  surf2Dk:    "#0f2e1a",
  borderDk:   "rgba(74,222,128,0.1)",
  textDk:     "#e2f5e9",
  text2Dk:    "#9abea6",
  text3Dk:    "#4b6557",
  shadowDk:   "0 2px 16px rgba(0,0,0,0.4)",
  red:        "#dc2626",
  redLight:   "rgba(220,38,38,0.10)",
  redBorder:  "rgba(220,38,38,0.20)",
  amber:      "#d97706",
  amberLight: "rgba(217,119,6,0.10)",
  amberBorder:"rgba(217,119,6,0.25)",
} as const;

/* ── Box-unit detection ─────────────────────────────────────────────────────── */
const IS_BOX_UNIT = (unit: string) =>
  unit?.toLowerCase().includes("box") || unit?.toLowerCase() === "boxes";

/**
 * Parse pieces_per_box from Excel.
 * Range strings like "2 to 3" take the lower bound.
 * Zero or unparseable → 10 as safe default.
 */
function parsePiecesPerBox(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return 10;
  const str = String(raw).trim();
  if (!str) return 10;

  const rangeMatch = str.match(/^(\d+)\s+to\s+(\d+)$/i);
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1], 10);
    return lo > 0 ? lo : 10;
  }

  const n = parseInt(str, 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/* ── SVG icons ──────────────────────────────────────────────────────────────── */
const IconDrug = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.5 20H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H20a2 2 0 0 1 2 2v3"/>
    <circle cx="18" cy="18" r="4"/>
    <path d="M18 14v8M14 18h8"/>
  </svg>
);
const IconSupply = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2c0 1.1.9 2 2 2h5v5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2h-2z"/>
  </svg>
);
const IconArchive = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="21 8 21 21 3 21 3 8"/>
    <rect x="1" y="3" width="22" height="5"/>
    <line x1="10" y1="12" x2="14" y2="12"/>
  </svg>
);
const IconRestock = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 4 1 10 7 10"/>
    <path d="M3.51 15a9 9 0 1 0 .49-4"/>
  </svg>
);
const IconSearch = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);
const IconImport = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/>
    <line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
);
const IconExcelFile = () => (
  <svg width="34" height="40" viewBox="0 0 34 40" fill="none">
    <path d="M4 0h18l12 12v24a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z" fill="#dcfce7"/>
    <path d="M22 0l12 12H26a4 4 0 0 1-4-4V0z" fill="#86efac"/>
    <text x="17" y="30" textAnchor="middle" fontSize="9" fontWeight="800" fill="#16a34a" fontFamily="inherit">XLS</text>
  </svg>
);
const IconPdfFile = () => (
  <svg width="34" height="40" viewBox="0 0 34 40" fill="none">
    <path d="M4 0h18l12 12v24a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z" fill="#fee2e2"/>
    <path d="M22 0l12 12H26a4 4 0 0 1-4-4V0z" fill="#fca5a5"/>
    <text x="17" y="30" textAnchor="middle" fontSize="10" fontWeight="800" fill="#dc2626" fontFamily="inherit">PDF</text>
  </svg>
);

/* ── Export helpers ─────────────────────────────────────────────────────────── */
async function exportToExcel(rows: Medicine[], tabLabel: string, isDrugs: boolean) {
  const XLSX = await import("xlsx");
  const data = rows.map((m, i) => ({
    "No.": i + 1,
    "Medicine Name": m.med_name,
    [isDrugs ? "Dosage" : "Specification"]: m.med_dosage,
    "Type": m.med_type,
    "Unit": m.unit,
    "EXP Date": m.exp_date,
    "Quantity": m.quantity,
    ...(IS_BOX_UNIT(m.unit) ? {
      "Full Boxes":     m.boxes          ?? 0,
      "Partial Pieces": m.partial_pieces ?? 0,
      "Pieces/Box":     m.pieces_per_box ?? 10,
    } : {}),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, tabLabel);
  XLSX.writeFile(wb, `${tabLabel.toLowerCase().replace(/ /g, "_")}_${new Date().toISOString().split("T")[0]}.xlsx`);
}

async function exportToPDF(rows: Medicine[], tabLabel: string, isDrugs: boolean) {
  const { default: jsPDF }     = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text(`${tabLabel} Report`, 14, 16);
  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toLocaleDateString("en-PH")}`, 14, 22);
  autoTable(doc, {
    startY: 27,
    head: [["#", "Medicine", isDrugs ? "Dosage" : "Specification", "Type", "Unit", "EXP Date", "Stock", "Boxes", "Partial"]],
    body: rows.map((m, i) => [
      i + 1, m.med_name, m.med_dosage, m.med_type, m.unit, m.exp_date,
      m.quantity,
      IS_BOX_UNIT(m.unit) ? (m.boxes ?? 0) : "—",
      IS_BOX_UNIT(m.unit) ? (m.partial_pieces ?? 0) : "—",
    ]),
    styles: { fontSize: 8 }, headStyles: { fillColor: [22, 163, 74] },
  });
  doc.save(`${tabLabel.toLowerCase().replace(/ /g, "_")}_${new Date().toISOString().split("T")[0]}.pdf`);
}

/* ── Categorise ─────────────────────────────────────────────────────────────── */
const DRUG_TYPES   = ["tablet","capsule","syrup","suspension","injection","drops","inhaler","patch","suppository","solution","ointment","powder","injectable","vaccine","vial"];
const SUPPLY_TYPES_LIST = ["bandage","gauze","gloves","syringe","cotton","alcohol","mask","dressing","iv","catheter","supply","equipment","lab","ppe","insecticide","tape","form","test kit","reagent","medical supply","medical tape","medical form","medical adhesive"];

function categorise(med: Medicine): Tab {
  const type = (med.med_type ?? "").toLowerCase();
  if (SUPPLY_TYPES_LIST.some(s => type.includes(s))) return "supplies";
  if (DRUG_TYPES.some(d => type.includes(d)))        return "drugs";
  return "drugs";
}

function detectImportType(row: Record<string, unknown>): "drugs" | "supplies" {
  const cat = String(row["category"] ?? "").toLowerCase();
  if (cat === "supplies") return "supplies";
  if (cat === "drugs")    return "drugs";
  if ("Specification" in row || "specification" in row) return "supplies";
  const typeVal = String(row["med_type"] ?? row["Type"] ?? "").toLowerCase();
  if (SUPPLY_TYPES_LIST.some(s => typeVal.includes(s))) return "supplies";
  return "drugs";
}

/* ── FilterBtn ──────────────────────────────────────────────────────────────── */
function FilterBtn({ label, active, onClick, icon }: {
  label: string; active: boolean; onClick: () => void; icon?: React.ReactNode;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700,
        cursor: "pointer",
        border: active ? "none" : `1.5px solid ${T.border}`,
        background: active ? T.green : hov ? `${T.green}10` : "transparent",
        color: active ? "#fff" : T.green,
        transition: "all 0.15s",
        boxShadow: active ? `0 4px 12px ${T.green}44` : "none",
        whiteSpace: "nowrap",
        display: "flex", alignItems: "center", gap: 6,
        fontFamily: "Nunito, sans-serif",
      }}
    >
      {icon}{label}
    </button>
  );
}

/* ── Stock badge — box-aware ────────────────────────────────────────────────── */
function StockBadge({ med }: { med: Medicine }) {
  const isBox        = IS_BOX_UNIT(med.unit);
  const piecesPerBox = isBox && (med.pieces_per_box ?? 0) > 0 ? med.pieces_per_box : 10;
  const fullBoxes    = med.boxes          ?? 0;
  const partial      = med.partial_pieces ?? 0;
  const total        = isBox
    ? (fullBoxes > 0 || partial > 0
        ? fullBoxes * piecesPerBox + partial
        : med.quantity)
    : med.quantity;

  const color = total === 0 ? T.red : total <= 10 ? T.amber : T.green;

  if (isBox) {
    return (
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 14, fontWeight: 900, color }}>{total} pcs</div>
        <div style={{ fontSize: 10, color: T.text3, lineHeight: 1.5 }}>
          {fullBoxes} box{fullBoxes !== 1 ? "es" : ""}
          {partial > 0 ? ` + ${partial} loose` : ""}
        </div>
        <div style={{ fontSize: 9, color: T.text3 }}>×{piecesPerBox} pcs/box</div>
      </div>
    );
  }

  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: 15, fontWeight: 900, color }}>{total}</div>
      <div style={{ fontSize: 10, color: T.text3, lineHeight: 1.4 }}>{med.unit || "pcs"}</div>
    </div>
  );
}

/* ── StatusBadge ────────────────────────────────────────────────────────────── */
function StatusBadge({ type }: { type: "instock" | "lowstock" | "outofstock" | "expired" }) {
  const map = {
    instock:    { bg: T.greenLight,   color: T.greenDark,  border: `${T.green}33`,   label: "In Stock"     },
    lowstock:   { bg: T.amberLight,   color: T.amber,      border: T.amberBorder,    label: "Low Stock"    },
    outofstock: { bg: T.redLight,     color: T.red,        border: T.redBorder,      label: "Out of Stock" },
    expired:    { bg: T.redLight,     color: T.red,        border: T.redBorder,      label: "Expired"      },
  };
  const s = map[type];
  return (
    <span style={{
      padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 800,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      whiteSpace: "nowrap", display: "inline-block",
    }}>{s.label}</span>
  );
}

/* ── Main component ─────────────────────────────────────────────────────────── */
export default function MedicineStockPage({ onToast, onMedicineAdded, darkMode }: Props) {
  const { dark: themeDark } = useTheme();
  const dk = darkMode !== undefined ? darkMode : (themeDark ?? false);
  const bg     = dk ? T.bgDk    : T.bg;
  const card   = dk ? T.surfDk  : T.surface;
  const card2  = dk ? T.surf2Dk : T.surface2;
  const bdr    = dk ? T.borderDk : T.border;
  const txt    = dk ? T.textDk  : T.text;
  const txt2   = dk ? T.text2Dk : T.text2;
  const shadow = dk ? T.shadowDk : T.shadow;

  const [medicines,        setMedicines]        = useState<Medicine[]>([]);
  const [archivedMeds,     setArchivedMeds]     = useState<Medicine[]>([]);
  const [loading,          setLoading]          = useState(true);
  const [loadingArchived,  setLoadingArchived]  = useState(false);
  const [selected,         setSelected]         = useState<string[]>([]);
  const [showExport,       setShowExport]       = useState(false);
  const [showAddModal,     setShowAddModal]     = useState(false);
  const [restockTarget,    setRestockTarget]    = useState<Medicine | null>(null);
  const [activeTab,        setActiveTab]        = useState<Tab>("drugs");
  const [showArchived,     setShowArchived]     = useState(false);
  const [search,           setSearch]           = useState("");
  const [importPreview,    setImportPreview]    = useState<ImportRow[] | null>(null);
  const [importIsSupplies, setImportIsSupplies] = useState(false);
  const [importing,        setImporting]        = useState(false);

  useEffect(() => {
    const handler = (e: Event) => setSearch((e as CustomEvent).detail?.toLowerCase() ?? "");
    window.addEventListener("header-search", handler);
    return () => window.removeEventListener("header-search", handler);
  }, []);

  /* ── FIX: timezone-safe expiry check ──────────────────────────────────────
   *
   * OLD (broken):
   *   const today = new Date(); today.setHours(0,0,0,0);
   *   const expired = all.filter(m => new Date(m.exp_date) < today);
   *
   * Problem: `new Date("2026-06-25")` parses as UTC midnight.
   * In UTC+8 (Philippines), local midnight is UTC+8 = June 24 16:00 UTC,
   * so today (UTC midnight) is AFTER local midnight — items expiring today
   * are NOT caught and stay visible instead of being auto-archived.
   *
   * FIX: compare YYYY-MM-DD strings directly in local time.
   * `toLocaleDateString("en-CA")` reliably returns "YYYY-MM-DD" in local tz.
   * exp_date is already stored as "YYYY-MM-DD" so string comparison is exact.
   * Items with exp_date <= todayStr (i.e. today OR any past date) are expired.
   */
  const fetchMedicines = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("pharma_medicines").select("*")
        .eq("archived", false).order("created_at", { ascending: false });
      if (error) throw error;
      const all = (data as Medicine[]) ?? [];

      // Timezone-safe: compare date strings directly (local date, no UTC shift)
      const todayStr = new Date().toLocaleDateString("en-CA"); // "YYYY-MM-DD"
      const expired  = all.filter(m => m.exp_date <= todayStr);

      if (expired.length > 0) {
        await Promise.all(expired.map(m =>
          supabase.from("pharma_medicines").update({ archived: true }).eq("id", m.id)
        ));
        const { data: fresh } = await supabase
          .from("pharma_medicines").select("*")
          .eq("archived", false).order("created_at", { ascending: false });
        setMedicines((fresh as Medicine[]) ?? []);
        onToast(`${expired.length} expired item(s) auto-archived.`, "success");
      } else {
        setMedicines(all);
      }
    } catch (err: any) {
      onToast(err.message || "Failed to load medicines.", "error");
    } finally { setLoading(false); }
  }, [onToast]);

  const fetchArchived = useCallback(async () => {
    setLoadingArchived(true);
    try {
      const { data, error } = await supabase
        .from("pharma_medicines").select("*")
        .eq("archived", true).order("updated_at", { ascending: false });
      if (error) throw error;
      setArchivedMeds((data as Medicine[]) ?? []);
    } catch (err: any) {
      onToast(err.message || "Failed to load archived.", "error");
    } finally { setLoadingArchived(false); }
  }, [onToast]);

  const unarchiveItem = async (id: string) => {
    try {
      await supabase.from("pharma_medicines").update({ archived: false }).eq("id", id);
      onToast("Item restored successfully.", "success");
      fetchArchived(); fetchMedicines();
    } catch (err: any) { onToast(err.message || "Failed to restore.", "error"); }
  };

  useEffect(() => { fetchMedicines(); }, [fetchMedicines]);
  useEffect(() => { fetchArchived(); }, [fetchArchived]);
  useEffect(() => { if (showArchived) fetchArchived(); }, [showArchived, fetchArchived]);
  useEffect(() => { setSelected([]); }, [activeTab]);

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const XLSX   = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb     = XLSX.read(buffer);
      const ws     = wb.Sheets[wb.SheetNames[0]];
      const rows   = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
      if (rows.length === 0) { onToast("No valid rows found in file.", "error"); return; }
      const fileType = detectImportType(rows[0]);
      setImportIsSupplies(fileType === "supplies");

      const parsed: ImportRow[] = rows
        .map(row => {
          const name = String(row["Medicine Name"] ?? row["med_name"] ?? "").trim();
          if (!name) return null;

          const specOrDosage = String(
            row["Specification"] ?? row["specification"] ??
            row["Dosage"]        ?? row["dosage"]        ??
            row["med_dosage"]    ?? "N/A"
          ).trim();

          const rawQty = row["Quantity"] ?? row["quantity"] ?? row["Total Pieces"] ?? row["Stock"] ?? "0";
          const quantity = parseInt(String(rawQty), 10);

          const rawBoxes = row["Full Boxes"] ?? row["boxes"] ?? row["Boxes"] ?? "0";
          const boxes    = parseInt(String(rawBoxes), 10);

          const rawPpb = row["pieces_per_boxes"]
            ?? row["pieces_per_box"]
            ?? row["Pieces/Box"]
            ?? row["pcs_per_box"]
            ?? row["PiecesPerBox"]
            ?? null;
          const pieces_per_box = parsePiecesPerBox(rawPpb);

          const rawPartial     = row["Partial Pieces"] ?? row["partial_pieces"] ?? row["Partial"] ?? "0";
          const partial_pieces = parseInt(String(rawPartial), 10);

          const expDateRaw = row["EXP Date"] ?? row["exp_date"] ?? row["Exp Date"] ?? "";
          let   expDate    = String(expDateRaw).trim();
          if (expDateRaw instanceof Date) {
            expDate = expDateRaw.toISOString().split("T")[0];
          }

          return {
            med_name:       name,
            med_dosage:     specOrDosage,
            med_type:       String(row["Type"] ?? row["med_type"] ?? (fileType === "supplies" ? "medical supply" : "Tablet")).trim(),
            unit:           String(row["Unit"] ?? row["unit"] ?? "Pieces").trim(),
            exp_date:       expDate || new Date().toISOString().split("T")[0],
            quantity:       isNaN(quantity)       ? 0  : quantity,
            boxes:          isNaN(boxes)          ? 0  : boxes,
            pieces_per_box: pieces_per_box,
            partial_pieces: isNaN(partial_pieces) ? 0  : partial_pieces,
          } as ImportRow;
        })
        .filter(Boolean) as ImportRow[];

      if (parsed.length === 0) { onToast("No valid rows found in file.", "error"); return; }
      setImportPreview(parsed);
    } catch (err: any) { onToast(err.message || "Failed to read file.", "error"); }
  };

  const handleImportConfirm = async () => {
    if (!importPreview) return;
    setImporting(true);
    let count = 0;
    try {
      for (const row of importPreview) {
        const isBox        = IS_BOX_UNIT(row.unit);
        const piecesPerBox = isBox ? row.pieces_per_box : 10;

        const derivedQty = isBox && (row.boxes > 0 || row.partial_pieces > 0)
          ? row.boxes * piecesPerBox + row.partial_pieces
          : row.quantity;

        const { error } = await supabase.from("pharma_medicines").insert([{
          med_name:       row.med_name,
          med_dosage:     row.med_dosage,
          med_type:       row.med_type,
          unit:           row.unit,
          exp_date:       row.exp_date,
          quantity:       derivedQty,
          archived:       false,
          boxes:          isBox ? row.boxes          : 0,
          pieces_per_box: isBox ? piecesPerBox       : 10,
          partial_pieces: isBox ? row.partial_pieces : 0,
        }]);
        if (!error) count++;
      }
      onToast(`Imported ${count} item(s) successfully.`, "success");
      setImportPreview(null);
      fetchMedicines();
      onMedicineAdded?.();
    } catch (err: any) {
      onToast(err.message || "Failed to import.", "error");
    } finally { setImporting(false); }
  };

  const archiveSelected = async () => {
    if (selected.length === 0) return;
    try {
      for (const id of selected)
        await supabase.from("pharma_medicines").update({ archived: true }).eq("id", id);
      onToast(`Archived ${selected.length} item(s).`, "success");
      setSelected([]); fetchMedicines();
      if (showArchived) fetchArchived();
    } catch (err: any) { onToast(err.message || "Failed to archive.", "error"); }
  };

  const tabRows = medicines
    .filter(m => categorise(m) === activeTab)
    .filter(m =>
      !search ||
      m.med_name.toLowerCase().includes(search)   ||
      m.med_type.toLowerCase().includes(search)   ||
      m.med_dosage.toLowerCase().includes(search) ||
      m.unit.toLowerCase().includes(search)       ||
      m.exp_date.includes(search)
    );

  const drugCount   = medicines.filter(m => categorise(m) === "drugs").length;
  const supplyCount = medicines.filter(m => categorise(m) === "supplies").length;
  const tabLabel    = activeTab === "drugs" ? "Medicine Drugs" : "Medicine Supplies";
  const isDrugsTab  = activeTab === "drugs";
  const dosageColLabel = isDrugsTab ? "Dosage" : "Specification";
  const importColLabel = importIsSupplies ? "Specification" : "Dosage";

  const toggleAll = () =>
    setSelected(s => s.length === tabRows.length ? [] : tabRows.map(m => m.id));
  const toggleRow = (id: string) =>
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const thStyle: CSSProperties = {
    padding: "12px 12px", textAlign: "left", fontWeight: 800,
    color: T.green, fontSize: 10, textTransform: "uppercase",
    letterSpacing: 0.8, whiteSpace: "nowrap",
    fontFamily: "Nunito, sans-serif",
  };

  // Timezone-safe isExpired check for display (same logic as auto-archive)
  const todayStr = new Date().toLocaleDateString("en-CA");
  const isExpiredCheck = (exp_date: string) => exp_date <= todayStr;

  return (
    <main style={{
      flex: 1, padding: 24, overflowY: "auto", background: bg,
      fontFamily: "Nunito, sans-serif",
    }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { font-family: Nunito, sans-serif !important; }
      `}</style>

      {/* ── Page header ── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "flex-end",
        marginBottom: 20,
      }}>
        <div>
          <p style={{ color: T.mint, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4, margin: 0 }}>Pharmacist</p>
          <h1 style={{ fontSize: 34, fontWeight: 900, color: T.green, margin: 0, lineHeight: 1 }}>MEDICINE INVENTORY</h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{
            background: "transparent", color: T.green,
            border: `1.5px solid ${T.green}`,
            borderRadius: T.radius, padding: "11px 22px",
            cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
            fontWeight: 800, fontSize: 13, transition: "all 0.2s",
            whiteSpace: "nowrap",
          }}
            onMouseEnter={e => (e.currentTarget.style.background = T.greenLight)}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <IconImport />
            Import Medicines
            <input type="file" accept=".xlsx,.xls" onChange={handleImportExcel} style={{ display: "none" }} />
          </label>
          <button
            onClick={() => setShowAddModal(true)}
            style={{
              background: T.greenMid, color: "#fff", border: "none",
              borderRadius: T.radius, padding: "12px 28px",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
              fontWeight: 800, fontSize: 14,
              boxShadow: `0 6px 20px ${T.green}44`, transition: "all 0.2s",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}
          >
            <Plus size={18} /> Add Medicine
          </button>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div style={{
        background: card, borderRadius: T.radius,
        padding: "16px 20px", marginBottom: 16,
        boxShadow: shadow, border: `1px solid ${bdr}`,
      }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: txt2, display: "flex" }}>
              <IconSearch />
            </span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search medicines..."
              style={{
                width: "100%", boxSizing: "border-box",
                padding: "8px 36px 8px 32px",
                borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`,
                fontSize: 12, outline: "none", color: txt,
                background: bg, transition: "border 0.15s",
              }}
              onFocus={e => (e.currentTarget.style.borderColor = T.green)}
              onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: txt2, display: "flex", padding: 0 }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button
              onClick={() => setShowExport(v => !v)}
              style={{
                padding: "7px 14px", borderRadius: T.radiusSm, fontSize: 12, fontWeight: 800,
                border: `1.5px solid ${bdr}`, background: card, color: T.green,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                boxShadow: shadow, whiteSpace: "nowrap",
              }}
            >
              <Download size={13} /> Export
            </button>
            {showExport && (
              <div style={{
                position: "absolute", right: 0, top: "110%",
                background: card, border: `1px solid ${bdr}`,
                borderRadius: T.radiusSm, zIndex: 99, minWidth: 180,
                boxShadow: shadow, overflow: "hidden",
              }}>
                {[
                  { label: "Download as Excel", fn: () => exportToExcel(tabRows, tabLabel, isDrugsTab), icon: <IconExcelFile /> },
                  { label: "Download as PDF",   fn: () => exportToPDF(tabRows, tabLabel, isDrugsTab),   icon: <IconPdfFile /> },
                ].map(({ label, fn, icon }) => (
                  <button
                    key={label}
                    onClick={() => { fn(); setShowExport(false); }}
                    style={{
                      width: "100%", padding: "10px 16px", textAlign: "left",
                      border: "none", background: "transparent", cursor: "pointer",
                      fontSize: 13, color: txt, display: "flex", alignItems: "center",
                      gap: 10, fontWeight: 600,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = bg)}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    {icon}{label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Tab pills */}
        <div style={{
          display: "flex", gap: 3, background: bg,
          borderRadius: 24, padding: 3, border: `1px solid ${bdr}`,
          marginBottom: 10, width: "fit-content",
        }}>
          {[
            { tab: "drugs"    as Tab, icon: <IconDrug />,   label: "Drugs",    count: drugCount   },
            { tab: "supplies" as Tab, icon: <IconSupply />, label: "Supplies", count: supplyCount },
          ].map(({ tab, icon, label, count }) => {
            const active = activeTab === tab && !showArchived;
            return (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); setShowArchived(false); }}
                style={{
                  padding: "5px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                  border: "none", cursor: "pointer", transition: "all 0.15s",
                  background: active ? T.green : "transparent",
                  color:      active ? "#fff"  : txt2,
                  boxShadow:  active ? `0 2px 8px ${T.green}44` : "none",
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                {icon}{label}
                <span style={{
                  background: active ? "rgba(255,255,255,0.25)" : bdr,
                  color: active ? "#fff" : txt2,
                  borderRadius: 20, padding: "1px 8px", fontSize: 10, fontWeight: 700,
                }}>{count}</span>
              </button>
            );
          })}
          <button
            onClick={() => setShowArchived(v => !v)}
            style={{
              padding: "5px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700,
              border: "none", cursor: "pointer", transition: "all 0.15s",
              background: showArchived ? "#6b7280" : "transparent",
              color:      showArchived ? "#fff"    : txt2,
              boxShadow:  showArchived ? "0 2px 8px rgba(107,114,128,0.4)" : "none",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <IconArchive /> Archived
            <span style={{
              background: showArchived ? "rgba(255,255,255,0.25)" : bdr,
              color: showArchived ? "#fff" : txt2,
              borderRadius: 20, padding: "1px 8px", fontSize: 10, fontWeight: 700,
            }}>{archivedMeds.length}</span>
          </button>
        </div>

        {/* Bulk actions */}
        {!showArchived && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 12, fontWeight: 700, color: txt2, cursor: "pointer",
              padding: "5px 14px", borderRadius: 20,
              border: `1.5px solid ${bdr}`,
            }}>
              <input
                type="checkbox"
                checked={tabRows.length > 0 && selected.length === tabRows.length}
                onChange={toggleAll}
                style={{ accentColor: T.green, width: 12, height: 12 }}
              />
              Select All
            </label>
            <FilterBtn
              label={`Archive (${selected.length})`}
              active={selected.length > 0}
              onClick={archiveSelected}
              icon={<IconArchive />}
            />
          </div>
        )}
      </div>

      {/* ── Active medicines table ── */}
      {!showArchived && (
        <div style={{
          background: card, border: `1px solid ${bdr}`,
          borderRadius: T.radius, overflow: "hidden", boxShadow: shadow,
        }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: bg, borderBottom: `2px solid ${bdr}` }}>
                  <th style={{ ...thStyle, width: 50 }}>No.</th>
                  <th style={thStyle}>Medicine Name</th>
                  <th style={thStyle}>{dosageColLabel}</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Unit</th>
                  <th style={thStyle}>EXP Date</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Stock</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} style={{ textAlign: "center", padding: 48, color: txt2, fontSize: 13 }}>
                    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 32, height: 32, border: `3px solid ${T.green}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                      Loading medicines...
                    </div>
                  </td></tr>
                ) : tabRows.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: "center", padding: 48, color: txt2, fontSize: 13 }}>
                    {search
                      ? `No medicines found matching "${search}"`
                      : `No ${tabLabel.toLowerCase()} yet. Add one to get started.`}
                  </td></tr>
                ) : tabRows.map((med, n) => {
                  const sel        = selected.includes(med.id);
                  const isExpired  = isExpiredCheck(med.exp_date);

                  const isBox        = IS_BOX_UNIT(med.unit);
                  const piecesPerBox = isBox && (med.pieces_per_box ?? 0) > 0 ? med.pieces_per_box : 10;
                  const effectiveQty = isBox
                    ? ((med.boxes ?? 0) > 0 || (med.partial_pieces ?? 0) > 0
                        ? (med.boxes ?? 0) * piecesPerBox + (med.partial_pieces ?? 0)
                        : med.quantity)
                    : med.quantity;

                  const outOfStock = effectiveQty === 0;
                  const isLowStock = !outOfStock && effectiveQty <= 10;
                  const rowBg      = sel ? `${T.green}08` : n % 2 === 0 ? card : card2;
                  const statusType = outOfStock ? "outofstock" : isExpired ? "expired" : isLowStock ? "lowstock" : "instock";

                  return (
                    <tr
                      key={med.id}
                      style={{ background: rowBg, borderBottom: `1px solid ${bdr}`, transition: "background 0.1s" }}
                      onMouseEnter={e => { if (!sel) (e.currentTarget as HTMLTableRowElement).style.background = T.greenLight; }}
                      onMouseLeave={e => { if (!sel) (e.currentTarget as HTMLTableRowElement).style.background = rowBg; }}
                    >
                      <td style={{ padding: "11px 12px", color: txt2, fontWeight: 700 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <input
                            type="checkbox" checked={sel} onChange={() => toggleRow(med.id)}
                            style={{ accentColor: T.green, width: 12, height: 12 }}
                          />
                          <span style={{ color: txt2, fontSize: 12 }}>{n + 1}</span>
                        </div>
                      </td>
                      <td style={{ padding: "11px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <span style={{ color: txt2, flexShrink: 0 }}>
                            {isDrugsTab ? <IconDrug /> : <IconSupply />}
                          </span>
                          <span style={{ fontWeight: 700, color: txt, fontSize: 12 }}>{med.med_name}</span>
                        </div>
                      </td>
                      <td style={{ padding: "11px 12px", color: txt2, fontSize: 11 }}>{med.med_dosage}</td>
                      <td style={{ padding: "11px 12px", color: txt2, fontSize: 11 }}>{med.med_type}</td>
                      <td style={{ padding: "11px 12px", color: txt2, fontSize: 11 }}>{med.unit}</td>
                      <td style={{ padding: "11px 12px", fontSize: 11, color: isExpired ? T.red : txt2 }}>
                        {med.exp_date}
                        {isExpired && (
                          <span style={{
                            fontSize: 9, marginLeft: 5,
                            background: T.redLight, color: T.red,
                            border: `1px solid ${T.redBorder}`,
                            borderRadius: 4, padding: "1px 5px", fontWeight: 800,
                          }}>EXPIRED</span>
                        )}
                      </td>
                      <td style={{ padding: "11px 12px" }}>
                        <StockBadge med={med} />
                      </td>
                      <td style={{ padding: "11px 12px", textAlign: "center" }}>
                        {outOfStock ? (
                          <button
                            onClick={() => setRestockTarget(med)}
                            style={{
                              background: T.redLight, color: T.red,
                              border: `1.5px solid ${T.redBorder}`,
                              borderRadius: 20, padding: "3px 12px",
                              fontSize: 10, fontWeight: 800, cursor: "pointer",
                              display: "inline-flex", alignItems: "center", gap: 5,
                              whiteSpace: "nowrap",
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = `${T.red}18`)}
                            onMouseLeave={e => (e.currentTarget.style.background = T.redLight)}
                          >
                            <IconRestock /> Restock
                          </button>
                        ) : (
                          <StatusBadge type={statusType as any} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 18px", borderTop: `1px solid ${bdr}`,
            background: bg,
          }}>
            <span style={{ fontSize: 12, color: txt2, fontWeight: 600 }}>
              {tabRows.length === 0
                ? "No results"
                : `${tabRows.length} ${tabLabel.toLowerCase()} total`}
            </span>
            {selected.length > 0 && (
              <span style={{ fontSize: 12, color: T.green, fontWeight: 700 }}>
                {selected.length} selected
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Archived table ── */}
      {showArchived && (
        <div style={{
          background: card, border: `1px solid ${bdr}`,
          borderRadius: T.radius, overflow: "hidden", boxShadow: shadow,
        }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: bg, borderBottom: `2px solid ${bdr}` }}>
                  {["No.", "Medicine Name", "Dosage / Specification", "Type", "Unit", "EXP Date", "Stock", "Action"].map((h, i) => (
                    <th key={h} style={{ ...thStyle, textAlign: i === 6 ? "right" : i === 7 ? "center" : "left" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingArchived ? (
                  <tr><td colSpan={8} style={{ textAlign: "center", padding: 48, color: txt2, fontSize: 13 }}>
                    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 32, height: 32, border: `3px solid ${T.green}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                      Loading archived items...
                    </div>
                  </td></tr>
                ) : archivedMeds.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: "center", padding: 48, color: txt2, fontSize: 13 }}>No archived items.</td></tr>
                ) : archivedMeds.map((med, n) => {
                  const isExpired = isExpiredCheck(med.exp_date);
                  const rowBg     = n % 2 === 0 ? card : card2;
                  return (
                    <tr
                      key={med.id}
                      style={{ background: rowBg, borderBottom: `1px solid ${bdr}` }}
                      onMouseEnter={e => ((e.currentTarget as HTMLTableRowElement).style.background = T.greenLight)}
                      onMouseLeave={e => ((e.currentTarget as HTMLTableRowElement).style.background = rowBg)}
                    >
                      <td style={{ padding: "11px 12px", color: txt2, fontWeight: 700 }}>{n + 1}</td>
                      <td style={{ padding: "11px 12px", fontWeight: 700, color: txt, fontSize: 12 }}>{med.med_name}</td>
                      <td style={{ padding: "11px 12px", color: txt2, fontSize: 11 }}>{med.med_dosage}</td>
                      <td style={{ padding: "11px 12px", color: txt2, fontSize: 11 }}>{med.med_type}</td>
                      <td style={{ padding: "11px 12px", color: txt2, fontSize: 11 }}>{med.unit}</td>
                      <td style={{ padding: "11px 12px", fontSize: 11, color: isExpired ? T.red : txt2 }}>
                        {med.exp_date}
                        {isExpired && (
                          <span style={{ fontSize: 9, marginLeft: 5, background: T.redLight, color: T.red, border: `1px solid ${T.redBorder}`, borderRadius: 4, padding: "1px 5px", fontWeight: 800 }}>EXPIRED</span>
                        )}
                      </td>
                      <td style={{ padding: "11px 12px" }}><StockBadge med={med} /></td>
                      <td style={{ padding: "11px 12px", textAlign: "center" }}>
                        <button
                          onClick={() => unarchiveItem(med.id)}
                          style={{
                            background: T.greenLight, color: T.greenDark,
                            border: `1.5px solid ${T.green}33`,
                            borderRadius: 20, padding: "3px 14px",
                            fontSize: 10, fontWeight: 800, cursor: "pointer",
                            display: "inline-flex", alignItems: "center", gap: 5,
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = `${T.green}25`)}
                          onMouseLeave={e => (e.currentTarget.style.background = T.greenLight)}
                        >
                          <RotateCcw size={10} /> Restore
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "14px 18px", borderTop: `1px solid ${bdr}`, background: bg }}>
            <span style={{ fontSize: 12, color: txt2, fontWeight: 600 }}>
              {archivedMeds.length} archived item{archivedMeds.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {showAddModal && (
        <AddMedicineModal
          onClose={() => setShowAddModal(false)}
          onSaved={() => { fetchMedicines(); onMedicineAdded?.(); }}
          onToast={onToast}
          defaultTab={activeTab}
        />
      )}
      {restockTarget && (
        <RestockModal
          onClose={() => setRestockTarget(null)}
          onToast={onToast}
          medicineId={restockTarget.id}
          onSaved={() => { fetchMedicines(); fetchArchived(); onMedicineAdded?.(); }}
          prefill={{
            medicine: restockTarget.med_name,
            dosage:   restockTarget.med_dosage,
            type:     restockTarget.med_type,
            unit:     restockTarget.unit,
            qty:      1,
          }}
        />
      )}

      {/* ── Import Preview Modal ── */}
      {importPreview && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 3000, padding: 16,
        }} onClick={() => !importing && setImportPreview(null)}>
          <div style={{
            background: card, borderRadius: T.radius,
            width: "100%", maxWidth: 960, maxHeight: "88vh",
            display: "flex", flexDirection: "column", overflow: "hidden",
            boxShadow: shadow, border: `1px solid ${bdr}`,
          }} onClick={e => e.stopPropagation()}>

            <div style={{
              background: T.greenDark, padding: "18px 22px",
              display: "flex", alignItems: "center", gap: 14, flexShrink: 0,
              borderBottom: `2px solid ${T.mint}`,
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: "50%",
                background: "rgba(74,222,128,0.18)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: T.mint, fontWeight: 900, fontSize: 16, flexShrink: 0,
              }}>
                <IconImport />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "#fff", fontWeight: 900, fontSize: 16 }}>Confirm Import</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                  <span style={{ background: "rgba(74,222,128,0.2)", borderRadius: 99, padding: "2px 10px", fontSize: 11, color: T.mint, fontWeight: 700 }}>
                    {importIsSupplies ? "Medicine Supplies" : "Medicine Drugs"}
                  </span>
                  <span style={{ background: "rgba(74,222,128,0.15)", borderRadius: 99, padding: "2px 10px", fontSize: 11, color: T.mint, fontWeight: 700 }}>
                    {importPreview.length} item{importPreview.length !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setImportPreview(null)}
                style={{ background: "rgba(74,222,128,0.15)", border: "none", color: T.mint, borderRadius: T.radiusSm, width: 32, height: 32, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(74,222,128,0.3)")}
                onMouseLeave={e => (e.currentTarget.style.background = "rgba(74,222,128,0.15)")}
              >×</button>
            </div>

            <div style={{
              padding: "8px 22px", background: `${T.green}10`,
              borderBottom: `1px solid ${bdr}`,
              fontSize: 11, color: T.greenMid, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              Review data below before confirming. The Pieces/Box column reflects the accurate per-medicine value from your Excel file.
            </div>

            <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", background: bg }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 760 }}>
                <thead>
                  <tr style={{ background: card, borderBottom: `2px solid ${bdr}` }}>
                    {["#", "Medicine Name", importColLabel, "Type", "Unit", "EXP Date", "Boxes", "Pcs/Box", "Partial", "Total"].map((h, i) => (
                      <th key={h} style={{
                        padding: "12px 10px", textAlign: i >= 6 ? "right" : "left",
                        fontSize: 10, fontWeight: 800, color: T.green,
                        textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {importPreview.map((row, i) => {
                    const isBox  = IS_BOX_UNIT(row.unit);
                    const ppb    = isBox ? row.pieces_per_box : 0;
                    const total  = isBox && (row.boxes > 0 || row.partial_pieces > 0)
                      ? row.boxes * ppb + row.partial_pieces
                      : row.quantity;
                    return (
                      <tr key={i} style={{ background: i % 2 === 0 ? card : card2, borderBottom: `1px solid ${bdr}` }}>
                        <td style={{ padding: "8px 10px", color: txt2, fontSize: 11 }}>{i + 1}</td>
                        {(["med_name","med_dosage","med_type","unit","exp_date"] as (keyof ImportRow)[]).map(key => (
                          <td key={key} style={{ padding: "6px 8px" }}>
                            <input
                              value={String(row[key])}
                              onChange={e => {
                                const updated = [...importPreview];
                                (updated[i] as any)[key] = e.target.value;
                                setImportPreview(updated);
                              }}
                              style={{
                                border: `1.5px solid ${bdr}`, borderRadius: T.radiusSm,
                                padding: "5px 8px", fontSize: 12, width: "100%",
                                background: card, color: txt, outline: "none",
                                minWidth: key === "med_name" ? 160 : key === "med_type" ? 120 : 80,
                              }}
                              onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                              onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
                            />
                          </td>
                        ))}
                        {/* Boxes */}
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>
                          <input type="number"
                            value={row.boxes}
                            onChange={e => {
                              const updated = [...importPreview];
                              const v = parseInt(e.target.value, 10);
                              updated[i] = { ...updated[i], boxes: isNaN(v) ? 0 : v };
                              setImportPreview(updated);
                            }}
                            style={{ border: `1.5px solid ${bdr}`, borderRadius: T.radiusSm, padding: "5px 6px", fontSize: 12, width: 60, background: card, color: txt, outline: "none", textAlign: "right" }}
                            onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                            onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
                          />
                        </td>
                        {/* Pieces/Box */}
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>
                          <input type="number"
                            value={row.pieces_per_box}
                            onChange={e => {
                              const updated = [...importPreview];
                              const v = parseInt(e.target.value, 10);
                              updated[i] = { ...updated[i], pieces_per_box: isNaN(v) || v <= 0 ? 1 : v };
                              setImportPreview(updated);
                            }}
                            style={{ border: `1.5px solid ${T.green}`, borderRadius: T.radiusSm, padding: "5px 6px", fontSize: 12, width: 60, background: T.greenLight, color: T.greenDark, outline: "none", textAlign: "right", fontWeight: 700 }}
                            onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                            onBlur={e  => (e.currentTarget.style.borderColor = T.green)}
                          />
                        </td>
                        {/* Partial */}
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>
                          <input type="number"
                            value={row.partial_pieces}
                            onChange={e => {
                              const updated = [...importPreview];
                              const v = parseInt(e.target.value, 10);
                              updated[i] = { ...updated[i], partial_pieces: isNaN(v) ? 0 : v };
                              setImportPreview(updated);
                            }}
                            style={{ border: `1.5px solid ${bdr}`, borderRadius: T.radiusSm, padding: "5px 6px", fontSize: 12, width: 60, background: card, color: txt, outline: "none", textAlign: "right" }}
                            onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                            onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
                          />
                        </td>
                        {/* Total (computed) */}
                        <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 900, color: T.green, fontSize: 13 }}>
                          {total}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{
              padding: "12px 22px", borderTop: `1px solid ${bdr}`,
              background: card2, display: "flex", gap: 10, flexShrink: 0,
              justifyContent: "flex-end",
            }}>
              <button
                onClick={() => setImportPreview(null)} disabled={importing}
                style={{
                  padding: "10px 24px", borderRadius: T.radius,
                  border: `1.5px solid ${T.redBorder}`,
                  background: "transparent", color: T.red,
                  fontSize: 13, fontWeight: 800, cursor: "pointer",
                  opacity: importing ? 0.6 : 1, transition: "all 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = T.redLight)}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >Cancel</button>
              <button
                onClick={handleImportConfirm} disabled={importing}
                style={{
                  padding: "10px 28px", borderRadius: T.radius,
                  background: importing ? T.green : T.greenMid,
                  color: "#fff", border: "none",
                  fontSize: 13, fontWeight: 800,
                  cursor: importing ? "not-allowed" : "pointer",
                  boxShadow: `0 6px 20px ${T.green}44`,
                  display: "flex", alignItems: "center", gap: 8, transition: "all 0.2s",
                }}
                onMouseEnter={e => { if (!importing) e.currentTarget.style.transform = "translateY(-2px)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}
              >
                {importing ? (
                  <>
                    <div style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.5)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                    Importing {importPreview.length} items…
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Confirm Import ({importPreview.length} items)
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}