"use client";
import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useTheme, MedicineStockSummary } from "../lib/pharmacy";
import { fetchStockSummary } from "../lib/pharmacyData";
import { DispenseItemsModal } from "./DispenseMedicine";
import { Search, Pill, Plus, Download, X } from "lucide-react";

type Props = {
  onToast: (msg: string, type: "success" | "error") => void;
};

/** Only "Boxes" is a container concept, not something a patient literally
 *  receives — so its dispense quantity (which is always tracked in pieces
 *  under the hood) displays as "pcs". Any other unit (Packs, Bottles,
 *  Vials, Sachets, etc.) is a real dispensing unit in its own right, so it
 *  keeps showing exactly that unit. */
function isBoxUnit(unit: string | null | undefined): boolean {
  return (unit ?? "").trim().toLowerCase() === "boxes";
}
function displayUnit(unit: string | null | undefined): string {
  return isBoxUnit(unit) ? "pcs" : (unit || "pcs");
}

/** The five funding-source columns from the paper logbook — same list
 *  used by the dispense modals' single-select pills. Kept short/abbreviated
 *  here since they render as narrow table columns, matching how compact
 *  they are on the paper form. */
const FUND_SOURCE_COLUMNS: { key: string; label: string }[] = [
  { key: "Gen. Fund", label: "GEN.\nFUND" },
  { key: "Ekon", label: "EKON" },
  { key: "PHO", label: "PHO" },
  { key: "DOH", label: "DOH" },
  { key: "Donation", label: "DONATION" },
];

type DispenseHistoryRow = {
  dispense_id: string;
  quantity: number;
  dispensed_at: string;
  recipient_note: string | null;
  dispensed_by_name: string | null;
  remarks: string | null;
  generic_name: string;
  unit: string | null;
  barangay: string | null;
  fund_source: string | null;
  prescribed_by: string | null;
};

/** Groups individual dispense_log rows that belong to the same "session" —
 *  same recipient, dispensed within the same minute — so a multi-item
 *  DispenseItemsModal submission (one row per medicine/batch touched)
 *  shows up as ONE grouped entry in the history table. Same grouping
 *  convention RequestMedicinePage.tsx already uses for restock requests. */
type DispenseGroup = {
  key: string;
  recipient: string;
  dispensed_at: string;
  dispensed_by_name: string | null;
  barangay: string | null;
  fund_source: string | null;
  prescribed_by: string | null;
  items: DispenseHistoryRow[];
};

function groupDispenseHistory(rows: DispenseHistoryRow[]): DispenseGroup[] {
  const map = new Map<string, DispenseGroup>();
  for (const r of rows) {
    const key = `${r.recipient_note ?? ""}__${r.dispensed_at.slice(0, 16)}`;
    if (!map.has(key)) {
      map.set(key, {
        key, recipient: r.recipient_note || "—", dispensed_at: r.dispensed_at,
        dispensed_by_name: r.dispensed_by_name,
        barangay: r.barangay, fund_source: r.fund_source, prescribed_by: r.prescribed_by,
        items: [],
      });
    }
    map.get(key)!.items.push(r);
  }
  // Merge items for display: FEFO dispensing writes ONE pharma_dispense_log
  // row per BATCH touched, so a single "1998 Ibuprofen" request that had to
  // draw from two batches (1000 + 998) arrives here as two separate rows
  // for the same medicine. That's correct for batch-level traceability in
  // the database, but confusing to look at — the pharmacist just wants to
  // see "1998 Ibuprofen given to Yuuri", not "over two batches". Combine
  // same-medicine rows within a group into one summed line here, purely
  // for display; nothing in the underlying data changes.
  for (const group of map.values()) {
    const merged = new Map<string, DispenseHistoryRow>();
    for (const item of group.items) {
      const k = `${item.generic_name}__${item.unit ?? ""}`;
      const existing = merged.get(k);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        merged.set(k, { ...item });
      }
    }
    group.items = Array.from(merged.values());
  }
  return Array.from(map.values());
}

function withinDateFilter(iso: string, selectedDate: string): boolean {
  if (!selectedDate) return true;
  // <input type="date"> gives "YYYY-MM-DD" in the user's local time zone;
  // compare against the local calendar date of dispensed_at the same way.
  const d = new Date(iso);
  const localYmd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return localYmd === selectedDate;
}

async function exportHistoryToExcel(groups: DispenseGroup[]) {
  const XLSX = await import("xlsx");
  const rows: Record<string, string | number>[] = [];
  groups.forEach((g, gi) => {
    g.items.forEach((it, ii) => {
      rows.push({
        "#": ii === 0 ? gi + 1 : "",
        "Date": ii === 0 ? new Date(g.dispensed_at).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "",
        "Time": ii === 0 ? new Date(g.dispensed_at).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" }) : "",
        "Name": ii === 0 ? g.recipient : "",
        "Medicine": it.generic_name,
        "Quantity": it.quantity,
        "Unit": displayUnit(it.unit),
        "Barangay": ii === 0 ? (g.barangay || "") : "",
        "Fund Source": ii === 0 ? (g.fund_source || "") : "",
        "Prescribed By": ii === 0 ? (g.prescribed_by || "") : "",
        "Dispensed By": ii === 0 ? (g.dispensed_by_name || "Unknown") : "",
      });
    });
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Dispense History");
  XLSX.writeFile(wb, `dispense_history_${new Date().toISOString().split("T")[0]}.xlsx`);
}

export default function DispenseMedicinePage({ onToast }: Props) {
  const { t } = useTheme();
  const [medicines, setMedicines] = useState<MedicineStockSummary[]>([]);
  const [showBulkDispense, setShowBulkDispense] = useState(false);
  const [history, setHistory] = useState<DispenseHistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState("");

  const fetchMedicines = useCallback(async () => {
    try {
      const rows = await fetchStockSummary();
      setMedicines(rows.filter(m => m.total_quantity > 0));
    } catch (err: any) {
      onToast(err.message || "Failed to load medicines.", "error");
    }
  }, [onToast]);

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const { data, error } = await supabase
        .from("pharma_dispense_log")
        .select("dispense_id, quantity, dispensed_at, recipient_note, dispensed_by_name, remarks, barangay, fund_source, prescribed_by, pharma_medicines(generic_name, unit)")
        .order("dispensed_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      setHistory((data ?? []).map((r: any) => ({
        dispense_id: r.dispense_id, quantity: r.quantity, dispensed_at: r.dispensed_at,
        recipient_note: r.recipient_note, dispensed_by_name: r.dispensed_by_name, remarks: r.remarks,
        generic_name: r.pharma_medicines?.generic_name ?? "Unknown",
        unit: r.pharma_medicines?.unit ?? null,
        barangay: r.barangay ?? null,
        fund_source: r.fund_source ?? null,
        prescribed_by: r.prescribed_by ?? null,
      })));
    } catch (err: any) {
      onToast(err.message || "Failed to load dispense history.", "error");
    } finally { setLoadingHistory(false); }
  }, [onToast]);

  useEffect(() => { fetchMedicines(); }, [fetchMedicines]);
  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const refreshAll = () => { fetchMedicines(); fetchHistory(); };

  const filteredHistory = useMemo(() => history.filter(h =>
    withinDateFilter(h.dispensed_at, selectedDate)
    && (!search
      || (h.recipient_note ?? "").toLowerCase().includes(search.toLowerCase())
      || h.generic_name.toLowerCase().includes(search.toLowerCase())
      || (h.barangay ?? "").toLowerCase().includes(search.toLowerCase()))
  ), [history, search, selectedDate]);

  const dispenseGroups = useMemo(() => groupDispenseHistory(filteredHistory), [filteredHistory]);
  const activeFilterCount = (selectedDate ? 1 : 0) + (search.trim() ? 1 : 0);
  const clearFilters = () => { setSearch(""); setSelectedDate(""); };

  const card: CSSProperties = {
    background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 14,
    boxShadow: "0 2px 12px rgba(0,0,0,0.05)", overflow: "hidden",
  };
  const thStyle: CSSProperties = {
    padding: "12px 14px", textAlign: "left", fontWeight: 800, color: t.green,
    fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap",
    borderRight: `1px solid ${t.border}`,
  };
  // Narrow, centered header style for the five fund-source check columns —
  // "liitin ang column" — these are much narrower than the other columns
  // and just hold a checkmark, mirroring the paper log's compact layout.
  // Widened slightly from the first pass so "DONATION" fits on one line
  // instead of hyphen-wrapping.
  const thFundStyle: CSSProperties = {
    ...thStyle, textAlign: "center", width: 56, whiteSpace: "pre-line",
    fontSize: 8.5, lineHeight: 1.2, padding: "8px 4px",
  };
  const tdStyle: CSSProperties = { padding: "11px 14px", fontSize: 12.5, color: t.text2, borderRight: `1px solid ${t.border}` };
  const tdFundStyle: CSSProperties = { padding: "11px 4px", fontSize: 13, color: t.green, textAlign: "center", fontWeight: 900, borderRight: `1px solid ${t.border}` };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Header + primary action */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <p style={{ color: t.text3, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.4, margin: "0 0 4px" }}>Pharmacist</p>
          <h1 style={{ fontSize: 28, fontWeight: 900, color: t.text, margin: 0, lineHeight: 1 }}>DISPENSE MEDICINE</h1>
        </div>
        <button onClick={() => setShowBulkDispense(true)} style={{
          background: t.green, color: "#fff", border: "none", borderRadius: 10, padding: "11px 24px",
          cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 13,
          boxShadow: `0 6px 18px ${t.green}44`, whiteSpace: "nowrap",
        }}>
          <Plus size={16} /> Dispense Medicine
        </button>
      </div>

      {/* Filter bar */}
      <div style={{ ...card, padding: "14px 18px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.text2, display: "flex" }}>
            <Search size={14} />
          </span>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, medicine, or barangay…"
            style={{
              width: "100%", boxSizing: "border-box", padding: "9px 34px 9px 32px",
              borderRadius: 8, border: `1.5px solid ${t.border}`, fontSize: 12.5,
              outline: "none", color: t.text, background: t.surface2, fontFamily: "inherit",
            }}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: t.text2, display: "flex", padding: 0 }}>
              <X size={14} />
            </button>
          )}
        </div>

        <input
          type="date"
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          style={{
            padding: "9px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700,
            border: `1.5px solid ${t.border}`, background: t.surface2, color: t.text,
            cursor: "pointer", fontFamily: "inherit",
          }}
        />

        {activeFilterCount > 0 && (
          <button onClick={clearFilters} style={{ border: "none", background: "transparent", color: "#dc2626", fontSize: 11.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontFamily: "inherit" }}>
            <X size={12} /> Clear
          </button>
        )}

        <button
          onClick={() => exportHistoryToExcel(dispenseGroups)}
          disabled={dispenseGroups.length === 0}
          style={{
            marginLeft: "auto", padding: "9px 16px", borderRadius: 8, fontSize: 12, fontWeight: 800,
            border: `1.5px solid ${t.border}`, background: t.cardBg, color: t.green,
            cursor: dispenseGroups.length === 0 ? "not-allowed" : "pointer",
            opacity: dispenseGroups.length === 0 ? 0.5 : 1,
            display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
          }}
        >
          <Download size={13} /> Export to Excel
        </button>
      </div>

      {/* Dispense history — the primary content of this page. Columns now
          mirror the paper logbook: Date / Name / Medicine / Quantity /
          Barangay / five narrow fund-source check columns / Prescribed By
          / Dispensed By. No signature column — no digital equivalent. */}
      <div style={card}>
        <div style={{ background: t.green, padding: "10px 16px", color: "#fff", fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Dispense History</span>
          <span style={{ background: "rgba(255,255,255,0.25)", borderRadius: 12, padding: "1px 8px", fontSize: 10 }}>{dispenseGroups.length} record{dispenseGroups.length !== 1 ? "s" : ""}</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: t.surface2, borderBottom: `2px solid ${t.border}` }}>
                <th style={{ ...thStyle, width: 40 }}>#</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Medicine</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Quantity</th>
                <th style={thStyle}>Barangay</th>
                {FUND_SOURCE_COLUMNS.map(fc => (
                  <th key={fc.key} style={thFundStyle}>{fc.label}</th>
                ))}
                <th style={thStyle}>Prescribed By</th>
                <th style={{ ...thStyle, borderRight: "none" }}>Dispensed By</th>
              </tr>
            </thead>
            <tbody>
              {loadingHistory ? (
                <tr><td colSpan={11} style={{ textAlign: "center", padding: 48, color: t.text2 }}>
                  <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 28, height: 28, border: `3px solid ${t.green}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                    Loading history…
                  </div>
                </td></tr>
              ) : dispenseGroups.length === 0 ? (
                <tr><td colSpan={11} style={{ textAlign: "center", padding: 48, color: t.text2, fontStyle: "italic" }}>
                  {history.length === 0 ? "No medicines dispensed yet." : "No records match your filters."}
                </td></tr>
              ) : dispenseGroups.map((g, gi) => g.items.map((h, ii) => (
                <tr key={h.dispense_id} style={{
                  background: gi % 2 === 0 ? t.cardBg : t.surface2,
                  borderBottom: ii === g.items.length - 1 ? `1px solid ${t.border}` : `1px dashed ${t.border}`,
                }}>
                  {ii === 0 && (
                    <>
                      <td rowSpan={g.items.length} style={{ ...tdStyle, color: t.text3, verticalAlign: "top" }}>{gi + 1}</td>
                      <td rowSpan={g.items.length} style={{ ...tdStyle, verticalAlign: "top" }}>
                        {new Date(g.dispensed_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}
                        <div style={{ fontSize: 10.5, color: t.text3 }}>
                          {new Date(g.dispensed_at).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </td>
                      <td rowSpan={g.items.length} style={{ ...tdStyle, fontWeight: 700, color: t.text, verticalAlign: "top" }}>{g.recipient}</td>
                    </>
                  )}
                  <td style={{ ...tdStyle, display: "flex", alignItems: "center", gap: 6 }}>
                    <Pill size={12} color={t.green} /> {h.generic_name}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 800, color: t.text }}>
                    {h.quantity} <span style={{ fontSize: 10.5, fontWeight: 700, color: t.text3, textTransform: "lowercase" }}>{displayUnit(h.unit)}</span>
                  </td>
                  {ii === 0 && (
                    <>
                      <td rowSpan={g.items.length} style={{ ...tdStyle, verticalAlign: "top" }}>
                        {g.barangay || <span style={{ color: t.text3, fontStyle: "italic" }}>—</span>}
                      </td>
                      {FUND_SOURCE_COLUMNS.map(fc => (
                        <td key={fc.key} rowSpan={g.items.length} style={{ ...tdFundStyle, verticalAlign: "top" }}>
                          {g.fund_source === fc.key ? "✓" : ""}
                        </td>
                      ))}
                      <td rowSpan={g.items.length} style={{ ...tdStyle, verticalAlign: "top" }}>
                        {g.prescribed_by || <span style={{ color: t.text3, fontStyle: "italic" }}>—</span>}
                      </td>
                      <td rowSpan={g.items.length} style={{ ...tdStyle, verticalAlign: "top", borderRight: "none" }}>
                        {g.dispensed_by_name || <span style={{ color: t.text3, fontStyle: "italic" }}>Unknown</span>}
                      </td>
                    </>
                  )}
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {showBulkDispense && (
        <DispenseItemsModal
          medicines={medicines}
          onClose={() => setShowBulkDispense(false)}
          onSaved={refreshAll}
          onToast={onToast}
        />
      )}
    </div>
  );
}