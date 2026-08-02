// RequestMedicinePage.tsx
//
// Reads/writes `pharmacy_requests` — the table Warehouse's
// PharmacyRequestsRecordsPage reads from.
//
// Status vocabulary now matches Warehouse's current version:
//   'pending' | 'confirm' | 'alerted' | 'rejected' | 'received'
// (previously 'pending' | 'approved' | 'rejected' | 'fulfilled')
//
// Multi-item submissions now share one `request_batch_id` (generated once
// per submission in submitRestockRequest()), so Warehouse can show them as
// a single grouped popup instead of separate notifications. History
// grouping here uses that same id when present, falling back to the old
// same-minute heuristic only for legacy rows submitted before this change.
//
// `dosage` and `dosage_form` ("Type") are their own columns instead of
// being folded into medicine_name/notes — the New Request form already
// collects them separately, so this just stops throwing that detail away.
//
// UPDATED: fields now depend on the item's category.
//   - Drugs:    Generic Name, Brand Name (optional), Dosage, Type, Unit, Qty
//   - Supplies: Name, Type, Unit, Qty
//   (Requested By and Reason stay as request-level fields, shared by all
//   items in the request — that hasn't changed.)
//
// NOTE: this file assumes two small companion changes elsewhere, since
// this page can't add columns/params on its own:
//   1) `../lib/pharmacy` — RestockItem (or whatever local shape is passed
//      to submitRestockRequest) needs an optional `brand` field alongside
//      `medicine`/`dosage`/`type`/`unit`/`qty`/`category`.
//   2) `../lib/pharmacyData` — submitRestockRequest() needs to insert the
//      new `brand_name` column (drugs only — leave null for supplies),
//      alongside the existing medicine_name/dosage/dosage_form insert.
//   See the accompanying SQL for the new `brand_name` column.
"use client";
import { CSSProperties, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  useTheme,
  MEDICINE_TYPES, SUPPLY_TYPES, UNITS,
} from "../lib/pharmacy";
import { submitRestockRequest } from "../lib/pharmacyData";
import { Search, X } from "lucide-react";

type Props = {
  onToast: (msg: string, type: "success" | "error") => void;
};

const DARK_GREEN = "#14532d";
type ItemCategory = "drugs" | "supplies";
type RequestStatus = "pending" | "confirm" | "alerted" | "rejected" | "received";
type StatusFilter = "all" | RequestStatus;

const STATUS_MAP: Record<RequestStatus, { bg: string; color: string; border: string; label: string }> = {
  pending:  { bg: "#fef9c3", color: "#854d0e", border: "#fde047", label: "Pending"   },
  confirm:  { bg: "#dbeafe", color: "#1d4ed8", border: "#93c5fd", label: "Confirmed" },
  alerted:  { bg: "#fef3c7", color: "#92400e", border: "#fcd34d", label: "Alerted"   },
  rejected: { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", label: "Rejected"  },
  received: { bg: "#dcfce7", color: "#166534", border: "#86efac", label: "Received"  },
};

function StatusPill({ status }: { status: RequestStatus }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.pending;
  return (
    <span style={{
      background: s.bg, color: s.color, border: `1.5px solid ${s.border}`,
      borderRadius: 20, padding: "2px 11px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
    }}>{s.label}</span>
  );
}

/** One row from pharmacy_requests, matching Warehouse's exact shape.
 *  `medicine_name` doubles as "Generic Name" for drugs and "Name" for
 *  supplies; `brand_name` is drugs-only and null for supplies. */
type PharmacyRequestRow = {
  id: string;
  medicine_name: string;
  brand_name: string | null;
  dosage: string | null;
  dosage_form: string | null;
  category: ItemCategory;
  requested_qty: number;
  unit: string;
  status: RequestStatus;
  requested_by: string;
  requested_at: string;
  notes: string | null;
  fulfilled_at: string | null;
  fulfilled_qty: number | null;
  request_batch_id: string | null;
};

/** Draft/list-item shape used only inside the New Request form.
 *  `brand` is only meaningful (and only shown) for drugs; it's carried
 *  along as an empty string for supplies and ignored on submit. */
type ItemDraft = {
  medicine: string; // Generic Name (drugs) / Name (supplies)
  brand: string;    // Brand Name — drugs only
  dosage: string;   // Dosage — drugs only
  type: string;     // Type — both, different option lists
  unit: string;
  qty: number;
  category: ItemCategory;
};

/** Groups pharmacy_requests rows into one "session" per submission.
 *  Prefers the explicit request_batch_id (set by submitRestockRequest for
 *  every item sent together); falls back to the old same-minute-by-same-
 *  requester heuristic only for rows submitted before batch_id existed. */
type RequestBatch = {
  key: string;
  requested_by: string;
  requested_at: string;
  items: PharmacyRequestRow[];
  status: RequestStatus;
};

function batchStatus(items: PharmacyRequestRow[]): RequestStatus {
  const counts: Record<RequestStatus, number> = { pending: 0, confirm: 0, alerted: 0, rejected: 0, received: 0 };
  for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1;
  const n = items.length;
  if (counts.pending === n) return "pending";
  if (counts.received === n) return "received";
  if (counts.rejected === n) return "rejected";
  if (counts.confirm === n) return "confirm";
  if (counts.alerted === n) return "alerted";
  // Mixed batch — surface whichever still needs attention first.
  if (counts.pending > 0) return "pending";
  if (counts.alerted > 0) return "alerted";
  if (counts.confirm > 0) return "confirm";
  if (counts.received > 0) return "received";
  return "rejected";
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
}

const EMPTY_DRAFT: ItemDraft = { medicine: "", brand: "", dosage: "", type: "", unit: "Pieces", qty: 1, category: "drugs" };

export default function RequestMedicinePage({ onToast }: Props) {
  const { t } = useTheme();

  const [batches, setBatches] = useState<RequestBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RequestBatch | null>(null);

  const [showNewRequest, setShowNewRequest] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  // Set the moment "SEND REQUEST" is clicked (after validation passes) —
  // holds the request id that will be used for this submission, so the
  // confirmation dialog shows the exact id that ends up in the database.
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [draft, setDraft] = useState<ItemDraft>(EMPTY_DRAFT);
  const [itemCategory, setItemCategory] = useState<ItemCategory>("drugs");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [requesterName, setRequesterName] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Prefill "Requested By" from the logged-in account's auth metadata —
  // there's no separate `users` table, so username/email live on the
  // Supabase Auth user itself — but keep it editable.
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
        .from("pharmacy_requests")
        .select("id, medicine_name, brand_name, dosage, dosage_form, category, requested_qty, unit, status, requested_by, requested_at, notes, fulfilled_at, fulfilled_qty, request_batch_id")
        .order("requested_at", { ascending: false });
      if (error) throw error;

      const rows = (data ?? []) as PharmacyRequestRow[];
      const map = new Map<string, RequestBatch>();
      for (const r of rows) {
        // Prefer the real batch id; only fall back to the minute-heuristic
        // for legacy rows that predate request_batch_id.
        const key = r.request_batch_id ?? `${r.requested_by}__${r.requested_at.slice(0, 16)}`;
        if (!map.has(key)) {
          map.set(key, { key, requested_by: r.requested_by, requested_at: r.requested_at, items: [], status: "pending" });
        }
        map.get(key)!.items.push(r);
      }
      const grouped = Array.from(map.values());
      grouped.forEach(b => { b.status = batchStatus(b.items); });
      grouped.sort((a, b) => b.requested_at.localeCompare(a.requested_at));
      setBatches(grouped);
    } catch (err: any) {
      onToast(err.message || "Failed to load request history.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadHistory(); }, []);

  // Realtime — Warehouse confirming/alerting/rejecting/receiving shows up
  // here live, no manual refresh needed.
  useEffect(() => {
    const channel = supabase
      .channel("pharmacy_requests_pharmacist_view")
      .on("postgres_changes", { event: "*", schema: "public", table: "pharmacy_requests" }, () => {
        loadHistory();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const set = (k: keyof ItemDraft, v: string | number) => setDraft(d => ({ ...d, [k]: v }));

  /** Clamps to a positive integer — typing "-", "0", or letters can't sneak through. */
  const setQty = (raw: string) => {
    const n = parseInt(raw, 10);
    set("qty", !Number.isFinite(n) || n < 1 ? 1 : n);
  };

  /** Switching category clears the fields that don't apply to the new
   *  category — brand/dosage are drugs-only, so a stale value can't sneak
   *  into a supplies row (or vice versa) just by flipping the toggle. */
  const switchCategory = (cat: ItemCategory) => {
    setItemCategory(cat);
    setDraft(d => ({ ...d, type: "", brand: "", dosage: "" }));
  };

  const addItem = () => {
    if (!draft.medicine.trim()) {
      onToast(itemCategory === "drugs" ? "Enter a generic name first." : "Enter a supply name first.", "error");
      return;
    }
    if (!draft.qty || draft.qty < 1) { onToast("Quantity must be at least 1.", "error"); return; }
    setItems(prev => [...prev, {
      ...draft,
      category: itemCategory,
      qty: Math.max(1, Math.floor(draft.qty)),
      // Belt-and-suspenders: strip drugs-only fields if somehow present on a supplies row.
      brand: itemCategory === "drugs" ? draft.brand : "",
      dosage: itemCategory === "drugs" ? draft.dosage : "",
    }]);
    setDraft({ ...EMPTY_DRAFT, category: itemCategory, unit: draft.unit });
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

  /** "SEND REQUEST" no longer sends right away — it validates, generates
   *  the id this submission will use, and opens a confirmation dialog so
   *  the pharmacist can review everything (and see the request id) before
   *  it actually goes out. */
  const openSendConfirmation = () => {
    if (items.length === 0) { onToast("Add at least one item to the request.", "error"); return; }
    if (!requesterName.trim()) { onToast("Enter the requester's name.", "error"); return; }
    setPendingRequestId(crypto.randomUUID());
  };

  /** Actual submission — only reachable from the confirmation dialog's
   *  "Confirm & Send" button. */
  const handleSend = async () => {
    if (!pendingRequestId) return;
    setSaving(true);
    try {
      // submitRestockRequest() needs a matching update to:
      //   1) accept this pre-generated batchId and use it as-is instead of
      //      generating its own, so the id shown in the confirmation dialog
      //      matches what actually lands in request_batch_id; and
      //   2) write `brand` into the new brand_name column (drugs only —
      //      pass null/undefined for supplies rows).
      // See lib/pharmacyData.ts.
      await submitRestockRequest(items, requesterName.trim(), reason.trim() || undefined, pendingRequestId);
      onToast(`Request sent to Warehouse (${items.length} item${items.length > 1 ? "s" : ""}).`, "success");
      resetForm();
      setPendingRequestId(null);
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

  const isDrugs = itemCategory === "drugs";
  const typeOptions = isDrugs ? MEDICINE_TYPES : SUPPLY_TYPES;

  const filteredBatches = batches.filter(b => {
    if (statusFilter !== "all" && b.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const matchesItem = b.items.some(it =>
        it.medicine_name.toLowerCase().includes(q) ||
        (it.brand_name ?? "").toLowerCase().includes(q)
      );
      const matchesRequester = b.requested_by.toLowerCase().includes(q);
      if (!matchesItem && !matchesRequester) return false;
    }
    return true;
  });

  const activeFilterCount = (statusFilter !== "all" ? 1 : 0) + (search.trim() ? 1 : 0);
  const clearFilters = () => { setSearch(""); setStatusFilter("all"); };

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
            placeholder="Search item, brand, or requester..."
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

        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)} style={{
          padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700,
          border: `1.5px solid ${t.inputBorder}`, background: t.modalBg, color: t.text,
          cursor: "pointer", fontFamily: "inherit",
        }}>
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="confirm">Confirmed</option>
          <option value="alerted">Alerted</option>
          <option value="rejected">Rejected</option>
          <option value="received">Received</option>
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
              <th style={thStyle}>Items</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Total Qty</th>
              <th style={{ ...thStyle, textAlign: "center" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ ...tdStyle, textAlign: "center", padding: 40, fontStyle: "italic", color: t.text3 }}>Loading requests…</td></tr>
            ) : filteredBatches.length === 0 ? (
              <tr><td colSpan={6} style={{ ...tdStyle, textAlign: "center", padding: 40, fontStyle: "italic", color: t.text3 }}>
                {batches.length === 0 ? "No requests sent yet." : "No requests match your filters."}
              </td></tr>
            ) : filteredBatches.map((b, i) => (
              <tr
                key={b.key}
                onClick={() => setSelected(b)}
                style={{ cursor: "pointer", borderTop: `1px solid ${t.border2}` }}
              >
                <td style={{ ...tdStyle, color: t.text3, verticalAlign: "top" }}>{i + 1}</td>
                <td style={{ ...tdStyle, verticalAlign: "top" }}>
                  <div style={{ fontWeight: 700, color: t.text }}>{fmtDate(b.requested_at)}</div>
                  <div style={{ fontSize: 10.5, color: t.text3 }}>{fmtTime(b.requested_at)}</div>
                </td>
                <td style={{ ...tdStyle, verticalAlign: "top" }}>{b.requested_by}</td>
                <td style={{ ...tdStyle, maxWidth: 220, verticalAlign: "top" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {b.items.slice(0, 5).map(it => (
                      <span key={it.id} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {it.medicine_name}{it.brand_name ? ` (${it.brand_name})` : ""}
                      </span>
                    ))}
                    {b.items.length > 5 && (
                      <span style={{ color: t.green, fontWeight: 700, fontSize: 11 }}>+{b.items.length - 5} more</span>
                    )}
                  </div>
                </td>
                <td style={{ ...tdStyle, textAlign: "right", fontWeight: 800, color: t.text, verticalAlign: "top" }}>
                  {b.items.reduce((s, it) => s + it.requested_qty, 0)}
                </td>
                <td style={{ ...tdStyle, textAlign: "center", verticalAlign: "top" }}><StatusPill status={b.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${t.border2}`, fontSize: 11.5, color: t.text3, fontWeight: 600 }}>
          {loading ? "" : `${filteredBatches.length} of ${batches.length} request${batches.length !== 1 ? "s" : ""} shown`}
        </div>
      </div>

      {/* ── Detail popup ── */}
      {selected && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setSelected(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: t.cardBg, borderRadius: 16, width: "100%", maxWidth: 780,
              maxHeight: "84vh", overflow: "hidden", display: "flex", flexDirection: "column",
              boxShadow: "0 24px 60px rgba(0,0,0,0.35)", border: `2px solid ${DARK_GREEN}`,
            }}
          >
            <div style={{ background: "linear-gradient(135deg,#116b37,#18a052)", padding: "16px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <div>
                <div style={{ color: "#fff", fontSize: 15, fontWeight: 900 }}>Request Details</div>
                <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 }}>
                  {fmtDate(selected.requested_at)} · {fmtTime(selected.requested_at)} · {selected.requested_by}
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
                {selected.items.length} item{selected.items.length !== 1 ? "s" : ""} · {selected.items.reduce((s, it) => s + it.requested_qty, 0)} total units
              </span>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "0 22px 20px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, width: 28 }}>#</th>
                    <th style={thStyle}>Generic Name / Name</th>
                    <th style={thStyle}>Brand</th>
                    <th style={thStyle}>Dosage</th>
                    <th style={thStyle}>Type</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Qty</th>
                    <th style={thStyle}>Notes</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.items.map((it, i) => (
                    <tr key={it.id} style={{ borderTop: `1px solid ${t.border2}` }}>
                      <td style={{ ...tdStyle, color: t.text3, fontSize: 11 }}>{i + 1}</td>
                      <td style={{ ...tdStyle, fontWeight: 700, color: t.text }}>{it.medicine_name}</td>
                      <td style={{ ...tdStyle, fontSize: 11.5 }}>{it.category === "drugs" ? (it.brand_name || "—") : "—"}</td>
                      <td style={{ ...tdStyle, fontSize: 11.5 }}>{it.category === "drugs" ? (it.dosage || "—") : "—"}</td>
                      <td style={{ ...tdStyle, fontSize: 11.5 }}>{it.dosage_form || "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                        {it.status === "received" && it.fulfilled_qty != null && it.fulfilled_qty < it.requested_qty
                          ? `${it.fulfilled_qty}/${it.requested_qty} ${it.unit}`
                          : `${it.requested_qty} ${it.unit}`}
                      </td>
                      <td style={{ ...tdStyle, fontSize: 11.5 }}>{it.notes || "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "center" }}><StatusPill status={it.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── New Request modal — backdrop click no longer closes it; only
          the X button does (and that still confirms first if there's
          unsaved data), so an accidental click outside never loses work. ── */}
      {showNewRequest && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
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
            <div style={{
              background: `linear-gradient(135deg, ${DARK_GREEN}, #16a34a)`, padding: "16px 22px",
              display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0,
            }}>
              <div style={{ color: "#fff", fontSize: 15, fontWeight: 900 }}>New Request to Warehouse</div>
              <button onClick={requestClose} style={{
                border: "1px solid rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.15)",
                color: "#fff", borderRadius: 8, width: 30, height: 30, cursor: "pointer",
                fontSize: 15, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center",
              }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 22 }}>

              <label style={lbl}>Requested By</label>
              <input value={requesterName} onChange={e => setRequesterName(e.target.value)} placeholder="Full name" style={inp} />

              <div style={divider} />

              <div style={sectionLabel}>Add Item</div>

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
                  <label style={lbl}>{isDrugs ? "Generic Name" : "Supply Name"}</label>
                  <input value={draft.medicine} onChange={e => set("medicine", e.target.value)} placeholder={isDrugs ? "e.g. Paracetamol" : "e.g. Face Mask"} style={inp} />
                </div>

                {/* Drugs-only: Brand Name + Dosage. Supplies skip straight to Type/Unit/Qty. */}
                {isDrugs && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={lbl}>Brand Name (optional)</label>
                      <input value={draft.brand} onChange={e => set("brand", e.target.value)} placeholder="e.g. Biogesic" style={inp} />
                    </div>
                    <div>
                      <label style={lbl}>Dosage</label>
                      <input value={draft.dosage} onChange={e => set("dosage", e.target.value)} placeholder="500mg" style={inp} />
                    </div>
                  </div>
                )}

                <div>
                  <label style={lbl}>Type</label>
                  <input
                    list="request-medicine-type-options"
                    value={draft.type}
                    onChange={e => set("type", e.target.value)}
                    placeholder="Search or type a type…"
                    style={inp}
                  />
                  <datalist id="request-medicine-type-options">
                    {typeOptions.map(o => <option key={o} value={o} />)}
                  </datalist>
                </div>

                {/* Quantity — same adaptive idea as Add Medicine: the unit
                    chosen drives the label, so "5" always reads unambiguously
                    as "5 Boxes" / "5 Bottles" / etc, not a bare number. */}
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                  <div>
                    <label style={lbl}>Unit</label>
                    <select value={draft.unit} onChange={e => set("unit", e.target.value)} style={sel}>
                      {UNITS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Qty ({draft.unit})</label>
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
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: t.text }}>
                          {item.medicine}{item.category === "drugs" && item.brand ? ` (${item.brand})` : ""}
                        </div>
                        <div style={{ fontSize: 11, color: t.text3 }}>
                          {item.category === "drugs" ? `${item.dosage || "—"} · ` : ""}{item.type || "—"}
                        </div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: t.green }}>{item.qty} {item.unit}</div>
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

            <div style={{ padding: 18, borderTop: `1px solid ${t.border2}`, flexShrink: 0 }}>
              <button onClick={openSendConfirmation} disabled={saving} style={{
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

      {/* ── Send confirmation dialog — final review before the request
          actually goes out. Backdrop click does nothing on purpose (same
          reasoning as the New Request modal: no accidental loss), only
          the two explicit buttons resolve it. ── */}
      {pendingRequestId && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: t.cardBg, borderRadius: 16, width: "100%", maxWidth: 460,
              maxHeight: "86vh", display: "flex", flexDirection: "column", overflow: "hidden",
              boxShadow: "0 24px 60px rgba(0,0,0,0.4)", border: `2px solid ${DARK_GREEN}`,
            }}
          >
            <div style={{
              background: `linear-gradient(135deg, ${DARK_GREEN}, #16a34a)`, padding: "16px 22px", flexShrink: 0,
            }}>
              <div style={{ color: "#fff", fontSize: 15, fontWeight: 900 }}>Confirm Request</div>
              <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 11.5, marginTop: 2 }}>
                Please review before sending to Warehouse.
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px" }}>
              <div style={{ marginBottom: 14 }}>
                <label style={lbl}>Request ID</label>
                <div style={{
                  fontFamily: "monospace", fontSize: 12.5, fontWeight: 700, color: t.text,
                  background: `${t.green}12`, border: `1px solid ${t.border2}`, borderRadius: 8,
                  padding: "8px 10px", wordBreak: "break-all",
                }}>{pendingRequestId}</div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={lbl}>Requested By</label>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{requesterName.trim()}</div>
              </div>

              <label style={lbl}>Items ({items.length})</label>
              <div style={{ border: `1px solid ${t.border2}`, borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>
                {items.map((item, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                    borderBottom: i < items.length - 1 ? `1px solid ${t.border2}` : "none",
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: t.text }}>
                        {item.medicine}{item.category === "drugs" && item.brand ? ` (${item.brand})` : ""}
                      </div>
                      <div style={{ fontSize: 11, color: t.text3 }}>
                        {item.category === "drugs" ? `${item.dosage || "—"} · ` : ""}{item.type || "—"}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: t.green, whiteSpace: "nowrap" }}>{item.qty} {item.unit}</div>
                  </div>
                ))}
              </div>

              {reason.trim() && (
                <div>
                  <label style={lbl}>Reason</label>
                  <div style={{ fontSize: 12.5, color: t.text2, lineHeight: 1.5 }}>{reason.trim()}</div>
                </div>
              )}
            </div>

            <div style={{ padding: 18, borderTop: `1px solid ${t.border2}`, flexShrink: 0, display: "flex", gap: 10 }}>
              <button onClick={() => setPendingRequestId(null)} disabled={saving} style={{
                flex: 1, padding: "12px 0", borderRadius: 10, border: `1.5px solid ${t.border2}`,
                background: "transparent", color: t.text2, fontSize: 13, fontWeight: 800, cursor: "pointer",
                fontFamily: "inherit", opacity: saving ? 0.6 : 1,
              }}>Back</button>
              <button onClick={handleSend} disabled={saving} style={{
                flex: 1.4, padding: "12px 0", borderRadius: 10, border: "none",
                background: t.green, color: "#fff", fontSize: 13, fontWeight: 900, cursor: "pointer",
                fontFamily: "inherit", boxShadow: `0 6px 18px ${t.green}44`, opacity: saving ? 0.6 : 1,
              }}>{saving ? "SENDING…" : "Confirm & Send"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm-close dialog ── */}
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