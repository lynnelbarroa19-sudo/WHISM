"use client";
import { CSSProperties, useEffect, useState } from "react";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/lib/supabase";

type ReqStatus = "pending" | "alerted" | "confirmed" | "rejected";

type RestockRequest = {
  id: string;
  pharmacist_name: string;
  medicine_name: string;
  dosage: string;
  medicine_type: string;
  quantity: number;
  status: ReqStatus;
  created_at: string;
};

type VaccineReqStatus = "pending" | "confirmed" | "rejected";

type VaccineRequest = {
  id: string;
  nurse_name: string;
  vaccine_name: string;
  dosage: string;
  quantity: number;
  urgency: "routine" | "urgent" | "emergency" | string;
  notes: string | null;
  status: VaccineReqStatus;
  created_at: string;
};

type Props = {
  onClose: () => void;
  onToast?: (msg: string, type: "success" | "error") => void;
};

const STATUS_MAP: Record<ReqStatus, { bg: string; color: string; border: string; label: string }> = {
  pending:   { bg: "#fef9c3", color: "#854d0e", border: "#fde047", label: "Pending"   },
  alerted:   { bg: "#ffedd5", color: "#9a3412", border: "#fdba74", label: "Alerted"   },
  confirmed: { bg: "#dcfce7", color: "#166534", border: "#86efac", label: "Confirmed" },
  rejected:  { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", label: "Rejected"  },
};

const VACCINE_STATUS_MAP: Record<VaccineReqStatus, { bg: string; color: string; border: string; label: string }> = {
  pending:   { bg: "#fef9c3", color: "#854d0e", border: "#fde047", label: "Pending"   },
  confirmed: { bg: "#dcfce7", color: "#166534", border: "#86efac", label: "Confirmed" },
  rejected:  { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", label: "Rejected"  },
};

const URGENCY_MAP: Record<string, { bg: string; color: string; label: string }> = {
  routine:   { bg: "#e0f2fe", color: "#075985", label: "Routine"   },
  urgent:    { bg: "#ffedd5", color: "#9a3412", label: "Urgent"    },
  emergency: { bg: "#fee2e2", color: "#991b1b", label: "Emergency" },
};

type FilterTab = "all" | ReqStatus;
type VaccineFilterTab = "all" | VaccineReqStatus;
type MainTab = "restock" | "vaccine";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-PH", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function StatusPill({ status }: { status: ReqStatus }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.pending;
  return (
    <span style={{
      background: s.bg, color: s.color,
      border: `1.5px solid ${s.border}`,
      borderRadius: 20, padding: "2px 10px",
      fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
    }}>{s.label}</span>
  );
}

function VaccineStatusPill({ status }: { status: VaccineReqStatus }) {
  const s = VACCINE_STATUS_MAP[status] ?? VACCINE_STATUS_MAP.pending;
  return (
    <span style={{
      background: s.bg, color: s.color,
      border: `1.5px solid ${s.border}`,
      borderRadius: 20, padding: "2px 10px",
      fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
    }}>{s.label}</span>
  );
}

function UrgencyPill({ urgency }: { urgency: string }) {
  const u = URGENCY_MAP[urgency] ?? URGENCY_MAP.routine;
  return (
    <span style={{
      background: u.bg, color: u.color,
      borderRadius: 6, padding: "1px 8px",
      fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap",
    }}>{u.label}</span>
  );
}

const BoxIcon = ({ size = 18, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M21 8L12 3 3 8v8l9 5 9-5V8z" fill="none"/>
    <path d="M3 8l9 5 9-5"/>
    <line x1="12" y1="13" x2="12" y2="21"/>
  </svg>
);

const PillIcon = ({ size = 13, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
    <rect x="2" y="9" width="20" height="6" rx="3" stroke={color} strokeWidth="2" fill="none"/>
    <line x1="12" y1="9" x2="12" y2="15" stroke={color} strokeWidth="2"/>
    <rect x="2" y="9" width="10" height="6" rx="3" fill={color} opacity="0.25"/>
  </svg>
);

const SyringeIcon = ({ size = 18, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M18 2l4 4"/>
    <path d="M17 7l3-3"/>
    <path d="M19 9 9 19l-4 2 2-4L17 7l2 2z"/>
    <path d="M12 12l3 3"/>
    <path d="M9 9l1.5 1.5"/>
    <path d="M6 12l1.5 1.5"/>
  </svg>
);

/* ════════════════════════════════════════════════════════════════════════
   Multi-strategy stock finder — client-side scoring
   ════════════════════════════════════════════════════════════════════════ */
type StockRow = { id: string; quantity: number; med_name: string };

async function findStockForVaccine(
  vaccineName: string
): Promise<{ rows: StockRow[] | null; error: Error | null }> {
  const normalized = vaccineName.trim().toLowerCase();

  const { data, error } = await supabase
    .from("pharma_medicines")
    .select("id, quantity, med_name")
    .eq("archived", false);

  if (error) return { rows: null, error: new Error(error.message) };
  if (!data || data.length === 0) return { rows: [], error: null };

  // Extract acronym from parentheses e.g. "Oral Polio Vaccine (OPV)" → "opv"
  const acronymMatch = vaccineName.match(/\(([^)]+)\)/);
  const acronym = acronymMatch ? acronymMatch[1].trim().toLowerCase() : null;

  // Base name without the parenthesised part
  const baseName = normalized.replace(/\s*\(.*?\)\s*/g, "").trim();

  type Scored = { row: StockRow; score: number };
  const scored: Scored[] = [];

  for (const row of data as StockRow[]) {
    const name = row.med_name.trim().toLowerCase();
    let score = 0;

    if (name === normalized) {
      score = 100; // exact full match
    } else if (acronym && name === acronym) {
      score = 95;  // exact acronym match  e.g. stock is "OPV"
    } else if (name.includes(normalized)) {
      score = 80;  // stock name contains full request string
    } else if (normalized.includes(name)) {
      score = 75;  // request contains stock name
    } else if (acronym && name.includes(acronym)) {
      score = 70;  // stock name contains acronym
    } else if (acronym && name.replace(/[^a-z]/g, "").includes(acronym.replace(/[^a-z]/g, ""))) {
      score = 65;  // fuzzy acronym (ignoring punctuation)
    } else if (baseName && name.includes(baseName)) {
      score = 60;  // stock contains base name (without acronym)
    } else {
      // keyword scan — score by number of meaningful word hits
      const keywords = normalized
        .replace(/\(.*?\)/g, "")
        .split(/\s+/)
        .filter(w => w.length > 3);
      const hits = keywords.filter(w => name.includes(w)).length;
      if (hits > 0) score = hits * 10;
    }

    if (score > 0) scored.push({ row, score });
  }

  if (scored.length === 0) return { rows: [], error: null };

  // Keep only the best score tier
  const maxScore = Math.max(...scored.map(s => s.score));
  const best = scored.filter(s => s.score === maxScore).map(s => s.row);

  return { rows: best, error: null };
}

export default function ViewRequestsModal({ onClose, onToast }: Props) {
  const { t } = useTheme();

  const [mainTab, setMainTab] = useState<MainTab>("restock");

  /* ── Restock state ───────────────────────────────────────────────────── */
  const [requests,  setRequests]  = useState<RestockRequest[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [filter, setFilter] = useState<FilterTab>("pending");
  const [expanded,  setExpanded]  = useState<string | null>(null);

  /* ── Vaccine state ───────────────────────────────────────────────────── */
  const [vaccineReqs,     setVaccineReqs]     = useState<VaccineRequest[]>([]);
  const [vaccineLoading,  setVaccineLoading]  = useState(true);
  const [vaccineFilter,   setVaccineFilter]   = useState<VaccineFilterTab>("pending");
  const [vaccineExpanded, setVaccineExpanded] = useState<string | null>(null);
  const [actingId,        setActingId]        = useState<string | null>(null);
  const [confirmTarget,   setConfirmTarget]   = useState<{ id: string; action: "confirmed" | "rejected" } | null>(null);

  useEffect(() => { load(); loadVaccine(); }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("restock_requests")
      .select("id, pharmacist_name, medicine_name, dosage, medicine_type, quantity, status, created_at")
      .order("created_at", { ascending: false });
    if (!error && data) setRequests(data as RestockRequest[]);
    setLoading(false);
  }

  async function loadVaccine() {
    setVaccineLoading(true);
    const { data, error } = await supabase
      .from("nurse_vaccine_requests")
      .select("id, nurse_name, vaccine_name, dosage, quantity, urgency, notes, status, created_at")
      .order("created_at", { ascending: false });
    if (!error && data) setVaccineReqs(data as VaccineRequest[]);
    setVaccineLoading(false);
  }

  /* ── Restock grouping ────────────────────────────────────────────────── */
  type GroupedBatch = {
    key: string;
    pharmacist_name: string;
    created_at: string;
    items: RestockRequest[];
    batchStatus: ReqStatus;
  };

  // REPLACE WITH — majority/worst-active-status wins:
function batchStatus(items: RestockRequest[]): ReqStatus {
  const counts = { pending: 0, alerted: 0, confirmed: 0, rejected: 0 };
  for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1;

  // If ALL items are the same status, use that directly
  if (counts.pending   === items.length) return "pending";
  if (counts.confirmed === items.length) return "confirmed";
  if (counts.rejected  === items.length) return "rejected";
  if (counts.alerted   === items.length) return "alerted";

  // Mixed batch — show the most "active" status so it stays visible
  if (counts.pending > 0) return "pending";
  if (counts.alerted > 0) return "alerted";
  if (counts.confirmed > 0) return "confirmed";
  return "rejected";
}

  const batches: GroupedBatch[] = [];
  const seen = new Map<string, GroupedBatch>();

  requests.forEach(r => {
    const day = r.created_at.slice(0, 10);
    const key = `${r.pharmacist_name}__${day}`;
    if (!seen.has(key)) {
      const b: GroupedBatch = { key, pharmacist_name: r.pharmacist_name, created_at: r.created_at, items: [], batchStatus: "pending" };
      seen.set(key, b);
      batches.push(b);
    }
    seen.get(key)!.items.push(r);
  });
  batches.forEach(b => { b.batchStatus = batchStatus(b.items); });

  const filtered = filter === "all"
  ? batches
  : batches.filter(b => String(b.batchStatus).trim() === String(filter).trim());

 const counts: Record<FilterTab, number> = {
  all:       batches.length,
  pending:   batches.filter(b => String(b.batchStatus).trim() === "pending").length,
  alerted:   batches.filter(b => String(b.batchStatus).trim() === "alerted").length,
  confirmed: batches.filter(b => String(b.batchStatus).trim() === "confirmed").length,
  rejected:  batches.filter(b => String(b.batchStatus).trim() === "rejected").length,
};

  const TABS: { key: FilterTab; label: string }[] = [
    { key: "all",       label: "All"       },
    { key: "pending",   label: "Pending"   },
    { key: "alerted",   label: "Alerted"   },
    { key: "confirmed", label: "Confirmed" },
    { key: "rejected",  label: "Rejected"  },
  ];

  /* ── Vaccine filtering ────────────────────────────────────────────────── */
 const vaccineFiltered = vaccineFilter === "all"
  ? vaccineReqs
  : vaccineReqs.filter(r => String(r.status).trim() === String(vaccineFilter).trim());

  const vaccineCounts: Record<VaccineFilterTab, number> = {
    all:       vaccineReqs.length,
    pending:   vaccineReqs.filter(r => r.status === "pending").length,
    confirmed: vaccineReqs.filter(r => r.status === "confirmed").length,
    rejected:  vaccineReqs.filter(r => r.status === "rejected").length,
  };

  const VACCINE_TABS: { key: VaccineFilterTab; label: string }[] = [
    { key: "pending",   label: "Pending"   },
    { key: "confirmed", label: "Confirmed" },
    { key: "rejected",  label: "Rejected"  },
    { key: "all",       label: "All"       },
  ];

  /* ── Vaccine confirm/reject handling ─────────────────────────────────── */
  async function handleVaccineAction(req: VaccineRequest, action: "confirmed" | "rejected") {
    setActingId(req.id);
    try {
      if (action === "rejected") {
        const { error } = await supabase
          .from("nurse_vaccine_requests")
          .update({ status: "rejected" })
          .eq("id", req.id);
        if (error) throw error;
        setVaccineReqs(prev => prev.map(r => r.id === req.id ? { ...r, status: "rejected" } : r));
        onToast?.(`Rejected vaccine request: ${req.vaccine_name}`, "success");
        return;
      }

      const { rows: matches, error: matchErr } = await findStockForVaccine(req.vaccine_name);
      if (matchErr) throw matchErr;

      if (!matches || matches.length === 0) {
        onToast?.(
          `No matching stock found for "${req.vaccine_name}". Add it to inventory first.`,
          "error",
        );
        return;
      }
      if (matches.length > 1) {
        onToast?.(
          `Multiple stock entries match "${req.vaccine_name}". Resolve duplicates before confirming.`,
          "error",
        );
        return;
      }

      const stockRow = matches[0];
      if (stockRow.quantity < req.quantity) {
        onToast?.(
          `Not enough stock: ${stockRow.med_name} has ${stockRow.quantity}, but ${req.quantity} requested.`,
          "error",
        );
        return;
      }

      const { error: updateStockErr } = await supabase
        .from("pharma_medicines")
        .update({ quantity: stockRow.quantity - req.quantity })
        .eq("id", stockRow.id);
      if (updateStockErr) throw updateStockErr;

      const { error: updateReqErr } = await supabase
        .from("nurse_vaccine_requests")
        .update({ status: "confirmed" })
        .eq("id", req.id);
      if (updateReqErr) throw updateReqErr;

      setVaccineReqs(prev => prev.map(r => r.id === req.id ? { ...r, status: "confirmed" } : r));
      onToast?.(
        `Confirmed: ${req.quantity} × ${stockRow.med_name} deducted from stock.`,
        "success",
      );
    } catch (err) {
      console.error(err);
      onToast?.("Something went wrong. Please try again.", "error");
    } finally {
      setActingId(null);
      setConfirmTarget(null);
    }
  }

  const thStyle: CSSProperties = {
    padding: "9px 12px", textAlign: "left", fontSize: 10, fontWeight: 800,
    color: t.tableHead, textTransform: "uppercase", letterSpacing: "0.06em",
    borderBottom: `1px solid ${t.tableRowBorder}`, background: t.surface2,
    whiteSpace: "nowrap",
  };
  const tdStyle: CSSProperties = {
    padding: "9px 12px", fontSize: 12, color: t.text2,
    borderBottom: `1px solid ${t.tableRowBorder}`, verticalAlign: "middle",
  };

  const pendingVaccineCount = vaccineReqs.filter(r => r.status === "pending").length;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        style={{ background: t.modalBg, borderRadius: 18, width: 740, maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.35)", overflow: "hidden" }}
        onClick={e => e.stopPropagation()}
      >

        {/* ── Header ── */}
        <div style={{ background: t.green, padding: "18px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>
              {mainTab === "restock" ? "Warehouse" : "Health Center"}
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>
              {mainTab === "restock" ? "Restock Requests" : "Vaccine Requests"}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
              {mainTab === "restock"
                ? `${batches.length} batch${batches.length !== 1 ? "es" : ""} · ${requests.length} item${requests.length !== 1 ? "s" : ""}`
                : `${vaccineReqs.length} request${vaccineReqs.length !== 1 ? "s" : ""}`}
            </span>
            <button
              onClick={onClose}
              style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", width: 30, height: 30, borderRadius: 8, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}
            >✕</button>
          </div>
        </div>

        {/* ── Main tab switcher ── */}
        <div style={{ display: "flex", borderBottom: `1px solid ${t.border2}`, flexShrink: 0 }}>
          {([
            { key: "restock" as const, label: "Restock Requests", Icon: BoxIcon },
            { key: "vaccine" as const, label: "Vaccine Requests",  Icon: SyringeIcon },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setMainTab(tab.key)}
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "13px 0", border: "none", cursor: "pointer", fontFamily: "inherit",
                background: mainTab === tab.key ? `${t.green}12` : "transparent",
                color: mainTab === tab.key ? t.green : t.text3,
                fontSize: 13, fontWeight: 800,
                borderBottom: `2.5px solid ${mainTab === tab.key ? t.green : "transparent"}`,
                transition: "background 0.15s, color 0.15s",
              }}
            >
              <tab.Icon size={15} color={mainTab === tab.key ? t.green : t.text3} />
              {tab.label}
              {tab.key === "vaccine" && pendingVaccineCount > 0 && (
                <span style={{
                  background: mainTab === "vaccine" ? t.green : "#dc2626",
                  color: "#fff", borderRadius: 10, padding: "1px 7px",
                  fontSize: 10, fontWeight: 700,
                }}>{pendingVaccineCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* ════════════════════ RESTOCK TAB ════════════════════ */}
        {mainTab === "restock" && (
          <>
            <div style={{ display: "flex", gap: 8, padding: "14px 24px", borderBottom: `1px solid ${t.border2}`, flexShrink: 0, flexWrap: "wrap" }}>
              {TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setFilter(tab.key)}
                  style={{
                    padding: "6px 14px", borderRadius: 20,
                    border: `1.5px solid ${filter === tab.key ? t.green : t.border2}`,
                    background: filter === tab.key ? t.green : "transparent",
                    color: filter === tab.key ? "#fff" : t.text2,
                    fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  {tab.label}
                  <span style={{
                    marginLeft: 6, fontSize: 10, fontWeight: 700,
                    background: filter === tab.key ? "rgba(255,255,255,0.25)" : t.tableRowBorder,
                    color: filter === tab.key ? "#fff" : t.text3,
                    borderRadius: 10, padding: "1px 7px",
                  }}>{counts[tab.key]}</span>
                </button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px 24px" }}>
              {loading ? (
                <div style={{ padding: "40px 0", textAlign: "center", color: t.text3, fontSize: 13 }}>Loading requests…</div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: "48px 0", textAlign: "center", color: t.text3, fontSize: 13, fontStyle: "italic" }}>No requests found</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {filtered.map(batch => (
                    <div
                      key={batch.key}
                      style={{
                        background: t.cardBg, borderRadius: 12,
                        border: `1px solid ${expanded === batch.key ? t.green : t.cardBorder}`,
                        overflow: "hidden",
                        boxShadow: expanded === batch.key ? `0 0 0 3px ${t.green}22` : "0 1px 6px rgba(0,0,0,0.06)",
                        transition: "border-color 0.15s, box-shadow 0.15s",
                      }}
                    >
                      <div
                        onClick={() => setExpanded(expanded === batch.key ? null : batch.key)}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer" }}
                      >
                        <div style={{
                          width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                          background: t.dispenseCard ?? "#f0fdf4",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <BoxIcon size={18} color={t.green} />
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>
                            {batch.pharmacist_name}
                          </div>
                          <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>
                            {batch.items.length} medicine{batch.items.length !== 1 ? "s" : ""} · {fmtDate(batch.created_at)}
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          <StatusPill status={batch.batchStatus} />
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.text3} strokeWidth="2"
                            style={{ transition: "transform 0.2s", transform: expanded === batch.key ? "rotate(180deg)" : "rotate(0deg)" }}>
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </div>
                      </div>

                      {expanded === batch.key && (
                        <div style={{ borderTop: `1px solid ${t.border2}` }}>
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
                              {batch.items.map((item, i) => (
                                <tr key={item.id}>
                                  <td style={{ ...tdStyle, color: t.text3, fontSize: 11 }}>{i + 1}</td>
                                  <td style={tdStyle}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                      <PillIcon size={13} color={t.green} />
                                      <span style={{ fontWeight: 600, color: t.text }}>{item.medicine_name}</span>
                                    </div>
                                  </td>
                                  <td style={tdStyle}>
                                    <span style={{
                                      background: t.dispenseCard ?? "#f0fdf4", color: t.green,
                                      border: `1px solid ${t.border ?? "#e5e7eb"}`,
                                      borderRadius: 6, padding: "1px 8px",
                                      fontSize: 11, fontWeight: 700,
                                    }}>{item.dosage || "—"}</span>
                                  </td>
                                  <td style={tdStyle}>{item.medicine_type}</td>
                                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: t.text }}>{item.quantity}</td>
                                  <td style={{ ...tdStyle, textAlign: "center" }}>
                                    <StatusPill status={item.status} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr>
                                <td colSpan={4} style={{ ...tdStyle, fontWeight: 700, color: t.text3, fontSize: 11, textAlign: "right", borderBottom: "none" }}>
                                  Total units:
                                </td>
                                <td style={{ ...tdStyle, fontWeight: 800, color: t.green, textAlign: "right", borderBottom: "none" }}>
                                  {batch.items.reduce((s, i) => s + i.quantity, 0)}
                                </td>
                                <td style={{ borderBottom: "none" }} />
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ════════════════════ VACCINE TAB ════════════════════ */}
        {mainTab === "vaccine" && (
          <>
            <div style={{ display: "flex", gap: 8, padding: "14px 24px", borderBottom: `1px solid ${t.border2}`, flexShrink: 0, flexWrap: "wrap" }}>
              {VACCINE_TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setVaccineFilter(tab.key)}
                  style={{
                    padding: "6px 14px", borderRadius: 20,
                    border: `1.5px solid ${vaccineFilter === tab.key ? t.green : t.border2}`,
                    background: vaccineFilter === tab.key ? t.green : "transparent",
                    color: vaccineFilter === tab.key ? "#fff" : t.text2,
                    fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  {tab.label}
                  <span style={{
                    marginLeft: 6, fontSize: 10, fontWeight: 700,
                    background: vaccineFilter === tab.key ? "rgba(255,255,255,0.25)" : t.tableRowBorder,
                    color: vaccineFilter === tab.key ? "#fff" : t.text3,
                    borderRadius: 10, padding: "1px 7px",
                  }}>{vaccineCounts[tab.key]}</span>
                </button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px 24px" }}>
              {vaccineLoading ? (
                <div style={{ padding: "40px 0", textAlign: "center", color: t.text3, fontSize: 13 }}>Loading requests…</div>
              ) : vaccineFiltered.length === 0 ? (
                <div style={{ padding: "48px 0", textAlign: "center", color: t.text3, fontSize: 13, fontStyle: "italic" }}>No requests found</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {vaccineFiltered.map(req => {
                    const isOpen   = vaccineExpanded === req.id;
                    const isActing = actingId === req.id;
                    return (
                      <div
                        key={req.id}
                        style={{
                          background: t.cardBg, borderRadius: 12,
                          border: `1px solid ${isOpen ? t.green : t.cardBorder}`,
                          overflow: "hidden",
                          boxShadow: isOpen ? `0 0 0 3px ${t.green}22` : "0 1px 6px rgba(0,0,0,0.06)",
                          transition: "border-color 0.15s, box-shadow 0.15s",
                        }}
                      >
                        <div
                          onClick={() => setVaccineExpanded(isOpen ? null : req.id)}
                          style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer" }}
                        >
                          <div style={{
                            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                            background: t.dispenseCard ?? "#f0fdf4",
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            <SyringeIcon size={17} color={t.green} />
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: t.text, display: "flex", alignItems: "center", gap: 8 }}>
                              {req.vaccine_name}
                              <UrgencyPill urgency={req.urgency} />
                            </div>
                            <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>
                              {req.nurse_name} · Qty {req.quantity} · {fmtDate(req.created_at)}
                            </div>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                            <VaccineStatusPill status={req.status} />
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.text3} strokeWidth="2"
                              style={{ transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </div>
                        </div>

                        {isOpen && (
                          <div style={{ borderTop: `1px solid ${t.border2}`, padding: "14px 16px" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: req.notes ? 12 : 0 }}>
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 800, color: t.text3, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>Dosage / Form</div>
                                <div style={{ fontSize: 13, color: t.text, fontWeight: 600 }}>{req.dosage || "—"}</div>
                              </div>
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 800, color: t.text3, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>Quantity</div>
                                <div style={{ fontSize: 13, color: t.text, fontWeight: 600 }}>{req.quantity} vials</div>
                              </div>
                            </div>
                            {req.notes && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 800, color: t.text3, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>Notes</div>
                                <div style={{ fontSize: 12.5, color: t.text2, lineHeight: 1.5 }}>{req.notes}</div>
                              </div>
                            )}

                            {req.status === "pending" && (
                              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                                <button
                                  disabled={isActing}
                                  onClick={(e) => { e.stopPropagation(); setConfirmTarget({ id: req.id, action: "rejected" }); }}
                                  style={{
                                    flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
                                    background: "#d63031", color: "#fff", fontSize: 12.5, fontWeight: 800,
                                    cursor: isActing ? "default" : "pointer", fontFamily: "inherit",
                                    opacity: isActing ? 0.6 : 1,
                                  }}
                                >
                                  REJECT
                                </button>
                                <button
                                  disabled={isActing}
                                  onClick={(e) => { e.stopPropagation(); setConfirmTarget({ id: req.id, action: "confirmed" }); }}
                                  style={{
                                    flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
                                    background: t.green, color: "#fff", fontSize: 12.5, fontWeight: 800,
                                    cursor: isActing ? "default" : "pointer", fontFamily: "inherit",
                                    opacity: isActing ? 0.6 : 1,
                                  }}
                                >
                                  {isActing ? "Processing…" : "CONFIRM"}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

      </div>

      {/* ── Confirmation dialog ── */}
      {confirmTarget && (() => {
        const req = vaccineReqs.find(r => r.id === confirmTarget.id);
        if (!req) return null;
        const isConfirm = confirmTarget.action === "confirmed";
        const isActing  = actingId === req.id;
        return (
          <div
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
              display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 1100,
            }}
            onClick={() => !isActing && setConfirmTarget(null)}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: t.cardBg, borderRadius: 14, width: 380,
                padding: "24px 24px 20px", boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
                textAlign: "center",
              }}
            >
              <div style={{
                width: 48, height: 48, borderRadius: "50%",
                background: isConfirm ? `${t.green}22` : "#d6303122",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {isConfirm ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={t.green} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 12l2 2 4-4"/>
                    <circle cx="12" cy="12" r="9"/>
                  </svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d63031" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9"/>
                    <line x1="15" y1="9" x2="9" y2="15"/>
                    <line x1="9" y1="9" x2="15" y2="15"/>
                  </svg>
                )}
              </div>

              <div style={{ fontSize: 15, fontWeight: 800, color: t.text }}>
                {isConfirm ? "Confirm Vaccine Request?" : "Reject This Request?"}
              </div>
              <div style={{ fontSize: 12.5, color: t.text3, lineHeight: 1.5 }}>
                {isConfirm
                  ? <>This will deduct <b>{req.quantity}</b> units of <b>{req.vaccine_name}</b> from stock and mark this request confirmed for <b>{req.nurse_name}</b>.</>
                  : <>This will reject the request for <b>{req.vaccine_name}</b> from <b>{req.nurse_name}</b>. No stock will be changed.</>}
              </div>

              <div style={{ display: "flex", gap: 10, width: "100%", marginTop: 8 }}>
                <button
                  onClick={() => setConfirmTarget(null)}
                  disabled={isActing}
                  style={{
                    flex: 1, padding: "9px 0", borderRadius: 8,
                    border: `1.5px solid ${t.border2}`, background: "transparent",
                    color: t.text2, fontSize: 13, fontWeight: 800,
                    cursor: "pointer", fontFamily: "inherit",
                    opacity: isActing ? 0.6 : 1,
                  }}>
                  Go Back
                </button>
                <button
                  onClick={() => handleVaccineAction(req, confirmTarget.action)}
                  disabled={isActing}
                  style={{
                    flex: 1, padding: "9px 0", borderRadius: 8,
                    border: "none",
                    background: isConfirm ? t.green : "#d63031",
                    color: "#fff", fontSize: 13, fontWeight: 800,
                    cursor: "pointer", fontFamily: "inherit",
                    opacity: isActing ? 0.6 : 1,
                  }}>
                  {isActing ? "Saving…" : "Yes, Proceed"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}