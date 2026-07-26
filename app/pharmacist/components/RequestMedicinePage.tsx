"use client";
import { CSSProperties, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  useTheme, RestockItem, RestockRequest, RestockRequestStatus,
  MEDICINE_TYPES, SUPPLY_TYPES, UNITS,
} from "../lib/pharmacy";
import { submitRestockRequest } from "../lib/pharmacyData";
import { Search, X } from "lucide-react";

type Props = {
  onToast: (msg: string, type: "success" | "error") => void;
};

const ALL_TYPES = Array.from(new Set([...MEDICINE_TYPES, ...SUPPLY_TYPES]));
const DARK_GREEN = "#14532d";

type ItemCategory = "drugs" | "supplies";
type CategoryFilter = "all" | "drugs" | "supplies";
type StatusFilter = "all" | RestockRequestStatus;

const STATUS_MAP: Record<RestockRequestStatus, { bg: string; color: string; border: string; label: string }> = {
  pending: { bg: "#fef9c3", color: "#854d0e", border: "#fde047", label: "Pending" },
  alerted: { bg: "#ffedd5", color: "#9a3412", border: "#fdba74", label: "Alerted" },
  confirmed: { bg: "#dcfce7", color: "#166534", border: "#86efac", label: "Confirmed" },
  rejected: { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", label: "Rejected" },
};

function StatusPill({ status }: { status: RestockRequestStatus }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.pending;
  return (
    <span style={{
      background: s.bg, color: s.color, border: `1.5px solid ${s.border}`,
      borderRadius: 20, padding: "2px 11px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
    }}>{s.label}</span>
  );
}

/** Majority/worst-active-status wins — same rule the warehouse-facing view uses. */
function batchStatus(items: RestockRequest[]): RestockRequestStatus {
  const counts: Record<RestockRequestStatus, number> = { pending: 0, alerted: 0, confirmed: 0, rejected: 0 };
  for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1;
  if (counts.pending === items.length) return "pending";
  if (counts.confirmed === items.length) return "confirmed";
  if (counts.rejected === items.length) return "rejected";
  if (counts.alerted === items.length) return "alerted";
  if (counts.pending > 0) return "pending";
  if (counts.alerted > 0) return "alerted";
  if (counts.confirmed > 0) return "confirmed";
  return "rejected";
}

/** Buckets a batch's items into Drugs / Supplies / Mixed based on medicine_type. */
function batchCategory(items: RestockRequest[]): "Drugs" | "Supplies" | "Mixed" {
  const cats = new Set(items.map(it => {
    if (it.medicine_type && SUPPLY_TYPES.includes(it.medicine_type)) return "Supplies";
    if (it.medicine_type && MEDICINE_TYPES.includes(it.medicine_type)) return "Drugs";
    return "Other";
  }));
  if (cats.size === 1) return [...cats][0] as "Drugs" | "Supplies";
  return "Mixed";
}

type RequestBatch = {
  key: string;
  pharmacist_name: string;
  created_at: string;
  items: RestockRequest[];
  status: RestockRequestStatus;
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
}

const EMPTY_DRAFT: RestockItem = { medicine: "", dosage: "", type: "", unit: "Pieces", qty: 1 };

export default function RequestMedicinePage({ onToast }: Props) {
  const { t } = useTheme();

  const [batches, setBatches] = useState<RequestBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RequestBatch | null>(null);

  const [showNewRequest, setShowNewRequest] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [items, setItems] = useState<RestockItem[]>([]);
  const [draft, setDraft] = useState<RestockItem>(EMPTY_DRAFT);
  const [itemCategory, setItemCategory] = useState<ItemCategory>("drugs");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [requesterName, setRequesterName] = useState("");

  // ── Filters for the history table ──
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Prefill "Requested By" from the logged-in account's auth metadata
  // (there's no separate `users` table — username/email live on the
  // Supabase Auth user itself), but keep it editable in case someone
  // else is filling this out on the pharmacist's behalf.
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const authUser = session?.user;
      if (!authUser) return;
      const meta = authUser.user_metadata as { username?: string; full_name?: string } | undefined;
      const name = meta?.username || meta?.full_name || authUser.email?.split("@")[0] || "";
      if (name) setRequesterName(name);
    })();
  }, []);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("pharma_restock_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const rows = (data ?? []) as RestockRequest[];
      const map = new Map<string, RequestBatch>();
      for (const r of rows) {
        const day = r.created_at.slice(0, 10);
        const key = `${r.pharmacist_name}__${day}__${r.created_at.slice(0, 16)}`; // groups items sent in the same minute
        if (!map.has(key)) {
          map.set(key, { key, pharmacist_name: r.pharmacist_name, created_at: r.created_at, items: [], status: "pending" });
        }
        map.get(key)!.items.push(r);
      }
      const grouped = Array.from(map.values());
      grouped.forEach(b => { b.status = batchStatus(b.items); });
      grouped.sort((a, b) => b.created_at.localeCompare(a.created_at));
      setBatches(grouped);
    } catch (err: any) {
      onToast(err.message || "Failed to load request history.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadHistory(); }, []);

  const set = (k: keyof RestockItem, v: string | number) => setDraft(d => ({ ...d, [k]: v }));

  /** Clamps to a positive integer — typing "-", "0", or letters can't sneak through. */
  const setQty = (raw: string) => {
    const n = parseInt(raw, 10);
    set("qty", !Number.isFinite(n) || n < 1 ? 1 : n);
  };

  /** Switching category clears the Type field so a stale drug type can't
   *  linger while browsing the supplies list, or vice versa. */
  const switchCategory = (cat: ItemCategory) => {
    setItemCategory(cat);
    set("type", "");
  };

  const addItem = () => {
    if (!draft.medicine.trim()) { onToast("Enter a medicine or supply name first.", "error"); return; }
    if (!draft.qty || draft.qty < 1) { onToast("Quantity must be at least 1.", "error"); return; }
    setItems(prev => [...prev, { ...draft, qty: Math.max(1, Math.floor(draft.qty)) }]);
    setDraft(EMPTY_DRAFT);
  };
  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));

  const resetForm = () => {
    setItems([]);
    setDraft(EMPTY_DRAFT);
    setItemCategory("drugs");
    setReason("");
  };

  /** X button / backdrop click never closes directly — always confirm first
   *  if there's anything the pharmacist would lose. */
  const requestClose = () => {
    if (items.length > 0 || draft.medicine.trim() || reason.trim()) {
      setConfirmClose(true);
    } else {
      setShowNewRequest(false);
    }
  };
  const confirmDiscard = () => {
    resetForm();
    setConfirmClose(false);
    setShowNewRequest(false);
  };

  const handleSend = async () => {
    if (items.length === 0) { onToast("Add at least one item to the request.", "error"); return; }
    if (!requesterName.trim()) { onToast("Enter the requester's name.", "error"); return; }
    setSaving(true);
    try {
      await submitRestockRequest(items, requesterName.trim(), reason.trim() || undefined);
      onToast(`Request sent (${items.length} item${items.length > 1 ? "s" : ""}).`, "success");
      resetForm();
      setShowNewRequest(false);
      loadHistory();
    } catch (err: any) {
      onToast(err.message || "Failed to send request.", "error");
    } finally {
      setSaving(false);
    }
  };

  const inp: CSSProperties = {
    border: `1.5px solid ${t.inputBorder}`, borderRadius: 8, padding: "9px 12px",
    fontSize: 13, fontFamily: "inherit", outline: "none", background: t.modalBg,
    color: t.modalText, width: "100%", height: 40, boxSizing: "border-box",
  };
  const sel: CSSProperties = { ...inp, appearance: "none", WebkitAppearance: "none", cursor: "pointer" };
  const lbl: CSSProperties = {
    fontSize: 10.5, fontWeight: 700, color: t.text3, textTransform: "uppercase",
    letterSpacing: "0.06em", marginBottom: 5, display: "block", whiteSpace: "nowrap",
  };
  const sectionLabel: CSSProperties = { fontSize: 13, fontWeight: 800, color: t.green, marginBottom: 12 };
  const divider: CSSProperties = { borderTop: `1px dashed ${t.border2}`, margin: "18px 0" };
  const thStyle: CSSProperties = {
    padding: "11px 16px", textAlign: "left", fontSize: 10.5, fontWeight: 800,
    color: t.green, textTransform: "uppercase", letterSpacing: 0.6,
    background: `${t.green}12`, whiteSpace: "nowrap",
  };
  const tdStyle: CSSProperties = {
    padding: "12px 16px", fontSize: 12.5, color: t.text2, verticalAlign: "middle",
  };

  const typeOptions = itemCategory === "drugs" ? MEDICINE_TYPES : SUPPLY_TYPES;

  // ── Apply filters to the history list ──
  const filteredBatches = batches.filter(b => {
    if (statusFilter !== "all" && b.status !== statusFilter) return false;
    if (categoryFilter !== "all") {
      const cat = batchCategory(b.items);
      if (categoryFilter === "drugs" && cat !== "Drugs") return false;
      if (categoryFilter === "supplies" && cat !== "Supplies") return false;
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const matchesItem = b.items.some(it => it.medicine_name.toLowerCase().includes(q));
      const matchesRequester = b.pharmacist_name.toLowerCase().includes(q);
      const matchesReason = (b.items[0]?.reason ?? "").toLowerCase().includes(q);
      if (!matchesItem && !matchesRequester && !matchesReason) return false;
    }
    return true;
  });

  const activeFilterCount = (categoryFilter !== "all" ? 1 : 0) + (statusFilter !== "all" ? 1 : 0) + (search.trim() ? 1 : 0);
  const clearFilters = () => { setSearch(""); setCategoryFilter("all"); setStatusFilter("all"); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "relative" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 10.5, color: t.text3, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 3 }}>Pharmacist</div>
          <div style={{ fontSize: 26, fontWeight: 900, color: t.text, lineHeight: 1 }}>REQUEST MEDICINE</div>
        </div>
        <button
          onClick={() => setShowNewRequest(true)}
          style={{
            padding: "11px 26px", borderRadius: 24, border: "none",
            background: t.green,
            color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer",
            fontFamily: "inherit", boxShadow: `0 6px 18px ${t.green}44`,
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Request
        </button>
      </div>

      <div style={{ fontSize: 12, color: t.text3 }}>
        Click a row to see everything included in that request. Track approval from the Warehouse here.
      </div>

      {/* ── Filter bar ── */}
      <div style={{
        background: t.cardBg, borderRadius: 14, padding: "14px 18px",
        border: `1px solid ${t.cardBorder}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
        display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
      }}>
        <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.text3, display: "flex" }}>
            <Search size={14} />
          </span>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search item, requester, or reason..."
            style={{
              width: "100%", boxSizing: "border-box", padding: "9px 34px 9px 32px",
              borderRadius: 8, border: `1.5px solid ${t.inputBorder}`, fontSize: 12.5,
              outline: "none", color: t.text, background: t.modalBg, fontFamily: "inherit",
            }}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: t.text3, display: "flex", padding: 0 }}>
              <X size={14} />
            </button>
          )}
        </div>

        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value as CategoryFilter)} style={{
          padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700,
          border: `1.5px solid ${t.inputBorder}`, background: t.modalBg, color: t.text,
          cursor: "pointer", fontFamily: "inherit",
        }}>
          <option value="all">All Categories</option>
          <option value="drugs">Drugs</option>
          <option value="supplies">Supplies</option>
        </select>

        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)} style={{
          padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700,
          border: `1.5px solid ${t.inputBorder}`, background: t.modalBg, color: t.text,
          cursor: "pointer", fontFamily: "inherit",
        }}>
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="alerted">Alerted</option>
          <option value="confirmed">Confirmed</option>
          <option value="rejected">Rejected</option>
        </select>

        {activeFilterCount > 0 && (
          <button onClick={clearFilters} style={{ border: "none", background: "transparent", color: "#dc2626", fontSize: 11.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontFamily: "inherit" }}>
            <X size={12} /> Clear
          </button>
        )}
      </div>

      {/* ── History table ── */}
      <div style={{
        background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 16,
        overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 40 }}>#</th>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Requested By</th>
              <th style={thStyle}>Category</th>
              <th style={thStyle}>Reason</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Total Qty</th>
              <th style={{ ...thStyle, textAlign: "center" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ ...tdStyle, textAlign: "center", padding: 40, fontStyle: "italic", color: t.text3 }}>Loading requests…</td></tr>
            ) : filteredBatches.length === 0 ? (
              <tr><td colSpan={7} style={{ ...tdStyle, textAlign: "center", padding: 40, fontStyle: "italic", color: t.text3 }}>
                {batches.length === 0 ? "No requests sent yet." : "No requests match your filters."}
              </td></tr>
            ) : filteredBatches.map((b, i) => (
              <tr
                key={b.key}
                onClick={() => setSelected(b)}
                style={{ cursor: "pointer", borderTop: `1px solid ${t.border2}` }}
              >
                <td style={{ ...tdStyle, color: t.text3 }}>{i + 1}</td>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 700, color: t.text }}>{fmtDate(b.created_at)}</div>
                  <div style={{ fontSize: 10.5, color: t.text3 }}>{fmtTime(b.created_at)}</div>
                </td>
                <td style={tdStyle}>{b.pharmacist_name}</td>
                <td style={tdStyle}>
                  {(() => {
                    const cat = batchCategory(b.items);
                    const style = cat === "Drugs"
                      ? { bg: "#dbeafe", color: "#1d4ed8" }
                      : cat === "Supplies"
                      ? { bg: "#fef3c7", color: "#b45309" }
                      : { bg: "#e5e7eb", color: "#374151" };
                    return (
                      <span style={{ background: style.bg, color: style.color, borderRadius: 20, padding: "3px 12px", fontSize: 11, fontWeight: 800 }}>
                        {cat}
                      </span>
                    );
                  })()}
                </td>
                <td style={{ ...tdStyle, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={b.items[0]?.reason ?? undefined}>
                  {b.items[0]?.reason || <span style={{ color: t.text3, fontStyle: "italic" }}>—</span>}
                </td>
                <td style={{ ...tdStyle, textAlign: "right", fontWeight: 800, color: t.text }}>
                  {b.items.reduce((s, it) => s + it.quantity, 0)}
                </td>
                <td style={{ ...tdStyle, textAlign: "center" }}><StatusPill status={b.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${t.border2}`, fontSize: 11.5, color: t.text3, fontWeight: 600 }}>
          {loading ? "" : `${filteredBatches.length} of ${batches.length} request${batches.length !== 1 ? "s" : ""} shown`}
        </div>
      </div>

      {/* ── Detail popup — everything in one request ── */}
      {selected && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setSelected(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: t.cardBg, borderRadius: 16, width: "100%", maxWidth: 640,
              maxHeight: "84vh", overflow: "hidden", display: "flex", flexDirection: "column",
              boxShadow: "0 24px 60px rgba(0,0,0,0.35)", border: `2px solid ${DARK_GREEN}`,
            }}
          >
            <div style={{ background: "linear-gradient(135deg,#116b37,#18a052)", padding: "16px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <div>
                <div style={{ color: "#fff", fontSize: 15, fontWeight: 900 }}>Request Details</div>
                <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 }}>
                  {fmtDate(selected.created_at)} · {fmtTime(selected.created_at)} · {selected.pharmacist_name}
                </div>
              </div>
              <button onClick={() => setSelected(null)} style={{
                border: "1px solid rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.15)",
                color: "#fff", borderRadius: 8, padding: "7px 13px", fontWeight: 800, cursor: "pointer",
              }}>✕ Close</button>
            </div>

            <div style={{ padding: "14px 22px", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 12, color: t.text3, fontWeight: 700 }}>Overall status:</span>
              <StatusPill status={selected.status} />
              <span style={{ fontSize: 12, color: t.text3, marginLeft: "auto" }}>
                {selected.items.length} item{selected.items.length !== 1 ? "s" : ""} · {selected.items.reduce((s, it) => s + it.quantity, 0)} total units
              </span>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "0 22px 20px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, width: 28 }}>#</th>
                    <th style={thStyle}>Medicine</th>
                    <th style={thStyle}>Dosage</th>
                    <th style={thStyle}>Type</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Qty</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.items.map((it, i) => (
                    <tr key={it.restock_request_id} style={{ borderTop: `1px solid ${t.border2}` }}>
                      <td style={{ ...tdStyle, color: t.text3, fontSize: 11 }}>{i + 1}</td>
                      <td style={{ ...tdStyle, fontWeight: 700, color: t.text }}>{it.medicine_name}</td>
                      <td style={tdStyle}>{it.dosage || "—"}</td>
                      <td style={tdStyle}>{it.medicine_type || "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{it.quantity} {it.unit || ""}</td>
                      <td style={{ ...tdStyle, textAlign: "center" }}><StatusPill status={it.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {selected.items[0]?.reason && (
                <div style={{ marginTop: 14, fontSize: 12, color: t.text3 }}>
                  <b style={{ color: t.text2 }}>Reason:</b> {selected.items[0].reason}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── New Request modal — one unified card, dark green border, fixed size ── */}
      {showNewRequest && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={requestClose}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: "min(560px, 94vw)", maxHeight: "88vh",
              display: "flex", flexDirection: "column",
              background: t.cardBg, borderRadius: 18,
              border: `2.5px solid ${DARK_GREEN}`,
              boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
              overflow: "hidden",
            }}
          >
            {/* Sticky header */}
            <div style={{
              background: `linear-gradient(135deg, ${DARK_GREEN}, #16a34a)`, padding: "16px 22px",
              display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0,
            }}>
              <div style={{ color: "#fff", fontSize: 15, fontWeight: 900 }}>New Request</div>
              <button onClick={requestClose} style={{
                border: "1px solid rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.15)",
                color: "#fff", borderRadius: 8, width: 30, height: 30, cursor: "pointer",
                fontSize: 15, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center",
              }}>✕</button>
            </div>

            {/* Scrollable body */}
            <div style={{ flex: 1, overflowY: "auto", padding: 22 }}>

              <label style={lbl}>Requested By</label>
              <input value={requesterName} onChange={e => setRequesterName(e.target.value)} placeholder="Full name" style={inp} />

              <div style={divider} />

              <div style={sectionLabel}>Add Item</div>

              {/* Drugs / Supplies toggle — determines which Type options show below */}
              <div style={{ display: "flex", gap: 3, background: t.surface2 ?? "#f6faf7", borderRadius: 20, padding: 3, border: `1px solid ${t.border2}`, marginBottom: 12, width: "fit-content" }}>
                {(["drugs", "supplies"] as ItemCategory[]).map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => switchCategory(cat)}
                    style={{
                      padding: "6px 18px", borderRadius: 16, fontSize: 12, fontWeight: 700, border: "none",
                      cursor: "pointer", textTransform: "capitalize", fontFamily: "inherit",
                      background: itemCategory === cat ? t.green : "transparent",
                      color: itemCategory === cat ? "#fff" : t.text2,
                    }}
                  >{cat}</button>
                ))}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label style={lbl}>{itemCategory === "drugs" ? "Medicine Name" : "Supply Name"}</label>
                  <input value={draft.medicine} onChange={e => set("medicine", e.target.value)} placeholder={itemCategory === "drugs" ? "e.g. Paracetamol" : "e.g. Face Mask"} style={inp} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={lbl}>Dosage / Spec</label>
                    <input value={draft.dosage} onChange={e => set("dosage", e.target.value)} placeholder={itemCategory === "drugs" ? "500mg" : "Optional"} style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>Type</label>
                    <select value={draft.type} onChange={e => set("type", e.target.value)} style={sel}>
                      <option value="">— select —</option>
                      {typeOptions.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                  <div>
                    <label style={lbl}>Unit</label>
                    <select value={draft.unit} onChange={e => set("unit", e.target.value)} style={sel}>
                      {UNITS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Qty</label>
                    <input type="number" min={1} step={1} value={draft.qty}
                      onChange={e => setQty(e.target.value)}
                      onKeyDown={e => { if (e.key === "-" || e.key === "e") e.preventDefault(); }}
                      style={inp} />
                  </div>
                </div>
              </div>
              <button onClick={addItem} style={{
                marginTop: 14, width: "100%", padding: 10, borderRadius: 8,
                border: `1.5px dashed ${t.green}`, background: "transparent", color: t.green,
                fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              }}>+ Add to list</button>

              <div style={divider} />

              <div style={sectionLabel}>Items ({items.length})</div>
              <div style={{ border: `1px solid ${t.border2}`, borderRadius: 10, overflow: "hidden" }}>
                {items.length === 0 ? (
                  <div style={{ padding: 18, textAlign: "center", color: t.text3, fontSize: 12.5, fontStyle: "italic" }}>
                    No items added yet
                  </div>
                ) : (
                  items.map((item, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                      borderBottom: i < items.length - 1 ? `1px solid ${t.border2}` : "none",
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: t.text }}>{item.medicine}</div>
                        <div style={{ fontSize: 11, color: t.text3 }}>{item.dosage || "—"} · {item.type || "—"} · {item.unit}</div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: t.green }}>×{item.qty}</div>
                      <button onClick={() => removeItem(i)} style={{ border: "none", background: "none", color: "#d63031", fontSize: 16, cursor: "pointer", padding: 0 }}>×</button>
                    </div>
                  ))
                )}
              </div>

              <div style={divider} />

              <label style={lbl}>Reason (optional, applies to whole request)</label>
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
                placeholder="e.g. Low stock, upcoming vaccination drive…"
                style={{ ...inp, height: "auto", padding: "8px 10px", resize: "vertical", fontFamily: "inherit" }} />
            </div>

            {/* Sticky footer */}
            <div style={{ padding: 18, borderTop: `1px solid ${t.border2}`, flexShrink: 0 }}>
              <button onClick={handleSend} disabled={saving} style={{
                width: "100%", padding: "13px 0", borderRadius: 10, border: "none",
                background: t.green, color: "#fff", fontSize: 14, fontWeight: 900, cursor: "pointer",
                fontFamily: "inherit", boxShadow: `0 6px 18px ${t.green}44`, opacity: saving ? 0.6 : 1,
              }}>
                {saving ? "SENDING…" : "SEND REQUEST"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm-close dialog — never discard a half-filled request silently ── */}
      {confirmClose && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setConfirmClose(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: t.cardBg, borderRadius: 16, width: "100%", maxWidth: 380,
              padding: "26px 24px 20px", boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center",
              border: `2px solid ${DARK_GREEN}`,
            }}
          >
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#fee2e2", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d63031" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: t.text }}>Discard this request?</div>
            <div style={{ fontSize: 12.5, color: t.text3, lineHeight: 1.5 }}>
              You have unsaved items or notes. Closing now will discard them.
            </div>
            <div style={{ display: "flex", gap: 10, width: "100%", marginTop: 8 }}>
              <button onClick={() => setConfirmClose(false)} style={{
                flex: 1, padding: "10px 0", borderRadius: 10, border: `1.5px solid ${t.border2}`,
                background: "transparent", color: t.text2, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
              }}>Keep Editing</button>
              <button onClick={confirmDiscard} style={{
                flex: 1, padding: "10px 0", borderRadius: 10, border: "none",
                background: "#d63031", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
              }}>Discard</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}