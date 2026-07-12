// Dashboard.tsx — Full updated file
"use client";
import { CSSProperties, ReactNode, useState, useEffect } from "react";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/lib/supabase";
import { Medicine } from "@/lib/types";
import Donut from "../Donut";

const DONUT_COLORS = ["#15803d","#16a34a","#22c55e","#4ade80","#86efac","#bbf7d0"];
const ACCENT_PURPLE      = "#16a34a";
const ACCENT_GREEN_ALT   = "#166534";
const ACCENT_GREEN_ALT_L = "#22c55e";
const ACCENT_GREEN_SUPPLY   = "#047857";
const ACCENT_GREEN_SUPPLY_L = "#34d399";
const STOCK_GREEN_HIGH   = "#166534";
const STOCK_GREEN_HIGH_L = "#22c55e";
const STOCK_GREEN_MED    = "#15803d";
const STOCK_GREEN_MED_L  = "#4ade80";
const STOCK_GREEN_LOW    = "#047857";
const STOCK_GREEN_LOW_L  = "#6ee7b7";

/* ── Box-unit detection ─────────────────────────────────────────────────────── */
const IS_BOX_UNIT = (unit: string) =>
  unit?.toLowerCase().includes("box") || unit?.toLowerCase() === "boxes";

type DispenseEntry = { med_name: string; quantity: number; dispensed_at: string };

type RxRow = {
  id:                string;
  patient_name:      string;
  patient_age:       number | null;
  patient_sex:       string | null;
  patient_address:   string | null;
  medicine:          string;
  dosage:            string | null;
  frequency:         string | null;
  quantity:          string | null;
  status:            "draft" | "sent" | "dispensed" | "cancelled" | string | null;
  prescription_date: string;
  created_at:        string | null;
};

type Props = {
  medicines:           Medicine[];
  totalCount:          number;
  onSendRequest:       (type: "drugs" | "supplies") => void;
  onOpenPrescriptions: () => void;
  onViewRequests:      () => void;
  onStockChanged?:     () => void;
};

/* ── "all" included so the same set of buckets works for filter tabs ── */
// Replace RxFilter type at top:
type RxFilter = "queue" | "unavailable";
type SubFilter = "all" | "sent" | "dispensed" | "cancelled";

/* ── Thresholds ── */
const LOW_STOCK_THRESHOLD = 10;
/**
 * Minimum fuzzy-match score required to consider a medicine a "real" match
 * for a prescription. Score < MIN_MATCH_SCORE means the candidate is an
 * unrelated medicine and should be ignored — preventing wrong error messages
 * (e.g. showing a COC-pill error for a Cetirizine prescription).
 *
 * Scoring breakdown (from rankCandidates):
 *   exact name match   → +100
 *   substring match    → +40
 *   per overlapping word → +5
 *
 * A threshold of 10 means at least 2 overlapping words are required when
 * there is no substring or exact match.
 */
const MIN_MATCH_SCORE = 10;

/* ── Responsive styles ── */
const injectPharmacyStyles = () => {
  if (typeof document === "undefined") return;
  if (document.getElementById("phd-styles")) return;
  const s = document.createElement("style");
  s.id = "phd-styles";
  s.textContent = `
    .phd-hover-lift { transition: transform 0.2s ease, box-shadow 0.2s ease; }
    .phd-hover-lift:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(0,0,0,0.12); }
    .phd-card-row { transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease; }
    .phd-card-row:hover { transform: translateY(-1px); }
    .phd-pill { transition: all 0.12s ease; cursor: pointer; }
    .phd-pill:hover { filter: brightness(1.07); transform: translateY(-1px); }
    .phd-btn { transition: all 0.15s ease; }
    .phd-btn:hover { filter: brightness(1.08); transform: translateY(-1px); }
    .phd-scroll { scrollbar-width: thin; scrollbar-color: rgba(124,111,205,0.35) transparent; }
    .phd-scroll::-webkit-scrollbar { width: 5px; }
    .phd-scroll::-webkit-scrollbar-track { background: transparent; }
    .phd-scroll::-webkit-scrollbar-thumb { background: rgba(124,111,205,0.35); border-radius: 10px; }
    .phd-scroll::-webkit-scrollbar-thumb:hover { background: rgba(124,111,205,0.55); }
    @media (max-width: 1180px) {
      .phd-main-grid { grid-template-columns: 1fr !important; }
      .phd-rx-panel  { height: auto !important; min-height: 460px !important; max-height: 560px !important; }
    }
    @media (max-width: 860px) {
      .phd-charts-row { grid-template-columns: 1fr !important; }
      .phd-stat-row   { grid-template-columns: repeat(2,1fr) !important; }
    }
    @media (max-width: 680px) {
      .phd-stat-row    { grid-template-columns: 1fr !important; }
      .phd-top-row     { flex-direction: column !important; align-items: flex-start !important; gap: 12px !important; }
      .phd-top-actions { width: 100% !important; }
      .phd-top-actions > div, .phd-top-actions > button { flex: 1 !important; }
    }
  `;
  document.head.appendChild(s);
};
if (typeof window !== "undefined") injectPharmacyStyles();

function useBreakpoint() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1280);
  useEffect(() => {
    const fn = () => setW(window.innerWidth);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return { isMobile: w < 680, isTablet: w < 1180, w };
}

/* ── SVG Icons ── */
const PillIcon = ({ size = 16, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
    <rect x="2" y="9" width="20" height="6" rx="3" stroke={color} strokeWidth="2" fill="none"/>
    <line x1="12" y1="9" x2="12" y2="15" stroke={color} strokeWidth="2"/>
    <rect x="2" y="9" width="10" height="6" rx="3" fill={color} opacity="0.25"/>
  </svg>
);
const BoxIcon = ({ size = 16, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
    <path d="M21 8L12 3 3 8v8l9 5 9-5V8z" stroke={color} strokeWidth="2" strokeLinejoin="round" fill="none"/>
    <path d="M3 8l9 5 9-5" stroke={color} strokeWidth="2" strokeLinejoin="round"/>
    <line x1="12" y1="13" x2="12" y2="21" stroke={color} strokeWidth="2"/>
  </svg>
);
const DrugIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="9" width="20" height="6" rx="3"/>
    <line x1="12" y1="9" x2="12" y2="15"/>
  </svg>
);
const SupplyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2c0 1.1.9 2 2 2h5v5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2h-2z"/>
  </svg>
);
const ChevronDown = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);
const CalendarIcon = ({ color = "currentColor" }: { color?: string }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8"  y1="2" x2="8"  y2="6"/>
    <line x1="3"  y1="10" x2="21" y2="10"/>
  </svg>
);
const WarningIcon = ({ color = "currentColor" }: { color?: string }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);
const RxIcon = ({ size = 13, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
  </svg>
);

/* ── Design primitives ── */
function SH({ children, accent, muted }: { children: ReactNode; accent: string; muted: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, marginTop: 2 }}>
      <div style={{ width: 3, height: 13, borderRadius: 2, background: accent, flexShrink: 0 }} />
      <div style={{ fontSize: 10, fontWeight: 800, color: muted, textTransform: "uppercase", letterSpacing: 1.3 }}>
        {children}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, gradient, icon }: {
  label: string; value: ReactNode; sub: string; gradient: string; icon: JSX.Element;
}) {
  return (
    <div className="phd-hover-lift" style={{
      background: gradient, borderRadius: 18, padding: "20px 20px 16px", color: "#fff",
      position: "relative", overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
      display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 130,
    }}>
      <div style={{ position: "absolute", right: -28, top: -28, width: 110, height: 110, borderRadius: "50%", background: "rgba(255,255,255,0.10)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", right: 18, bottom: -30, width: 72, height: 72, borderRadius: "50%", background: "rgba(255,255,255,0.06)", pointerEvents: "none" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.80, textTransform: "uppercase", letterSpacing: 0.7 }}>{label}</div>
        <div style={{
          width: 38, height: 38, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.45)",
          background: "rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>{icon}</div>
      </div>
      <div>
        <div style={{ fontSize: 42, fontWeight: 900, lineHeight: 1, marginBottom: 4 }}>{value}</div>
        <div style={{ fontSize: 11, opacity: 0.65 }}>{sub}</div>
      </div>
    </div>
  );
}

/* ── Helpers ── */
function buildAddress(p: any): string | null {
  const parts = [p?.purok, p?.barangay, p?.municipality].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function mapPatientRow(row: any): { name: string; age: number | null; sex: string | null; address: string | null } {
  const p = row.patients;
  const fullName = p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() : "Unknown";
  return {
    name:    fullName || "Unknown",
    age:     p?.age    ?? null,
    sex:     p?.sex    ? String(p.sex).trim() : null,
    address: buildAddress(p),
  };
}

function normalizeName(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function rankCandidates(rxMedicineName: string, pool: Medicine[]): Medicine[] {
  const target      = normalizeName(rxMedicineName);
  const targetWords = new Set(target.split(" ").filter(Boolean));
  const scored = pool.map(m => {
    const name = normalizeName(m.med_name);
    let score = 0;
    if (name === target) score += 100;
    if (name.includes(target) || target.includes(name)) score += 40;
    const words   = name.split(" ").filter(Boolean);
    const overlap = words.filter(w => targetWords.has(w)).length;
    score += overlap * 5;
    return { m, score };
  });
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.m);
}

/**
 * Like rankCandidates but only returns the best match if its score meets
 * MIN_MATCH_SCORE. This prevents a low-confidence fuzzy hit (e.g. a COC pill
 * matching a Cetirizine prescription) from producing the wrong error message.
 */
function bestMatchWithThreshold(rxMedicineName: string, pool: Medicine[]): Medicine | null {
  const target      = normalizeName(rxMedicineName);
  const targetWords = new Set(target.split(" ").filter(Boolean));
  let bestScore = 0;
  let bestMed: Medicine | null = null;
  for (const m of pool) {
    const name = normalizeName(m.med_name);
    let score = 0;
    if (name === target) score += 100;
    if (name.includes(target) || target.includes(name)) score += 40;
    const words   = name.split(" ").filter(Boolean);
    const overlap = words.filter(w => targetWords.has(w)).length;
    score += overlap * 5;
    if (score > bestScore) { bestScore = score; bestMed = m; }
  }
  return bestScore >= MIN_MATCH_SCORE ? bestMed : null;
}

function parseRxQuantity(raw: string | null): number {
  if (!raw) return 1;
  const match = raw.match(/\d+/);
  if (!match) return 1;
  const n = parseInt(match[0], 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function isPendingStatus(status: RxRow["status"]): boolean {
  const s = String(status ?? "").toLowerCase().trim();
  // Supabase data may use either "sent" (old) or "pending" (new).
  // Both must behave as Queue items: can be cancelled or confirmed/dispensed.
  return s === "sent" || s === "pending" || s === "queue" || s === "in queue";
}

function isMedicineExpired(med: Medicine): boolean {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const exp   = new Date(med.exp_date); exp.setHours(0, 0, 0, 0);
  return exp < today;
}

/* ── Box-aware effective quantity ── */
function getEffectiveQty(med: Medicine): number {
  const isBox        = IS_BOX_UNIT(med.unit);
  const piecesPerBox = isBox && (med.pieces_per_box ?? 0) > 0 ? med.pieces_per_box : 10;
  if (isBox && ((med.boxes ?? 0) > 0 || (med.partial_pieces ?? 0) > 0)) {
    return (med.boxes ?? 0) * piecesPerBox + (med.partial_pieces ?? 0);
  }
  return med.quantity;
}

const DRUG_TYPES   = ["tablet","capsule","syrup","suspension","injection","drops","inhaler","patch","suppository","solution","ointment","powder","injectable","vaccine","vial"];
const SUPPLY_TYPES = ["bandage","gauze","gloves","syringe","cotton","alcohol","mask","dressing","iv","catheter","supply","equipment","lab","ppe","insecticide","tape","form"];

function categorise(med: Medicine): "drugs" | "supplies" {
  const type = (med.med_type ?? "").toLowerCase();
  if (SUPPLY_TYPES.some(s => type.includes(s))) return "supplies";
  if (DRUG_TYPES.some(d => type.includes(d)))   return "drugs";
  return "drugs";
}

export default function Dashboard({ medicines, totalCount, onSendRequest, onOpenPrescriptions, onViewRequests, onStockChanged }: Props) {
  const { t } = useTheme();
  const { isMobile, isTablet } = useBreakpoint();
  const [dispenseData,    setDispenseData]    = useState<DispenseEntry[]>([]);
  const [allDispense,     setAllDispense]     = useState<DispenseEntry[]>([]);
  const [showRequestMenu, setShowRequestMenu] = useState(false);
  const [rxRows,          setRxRows]          = useState<RxRow[]>([]);
  const [rxLoading,       setRxLoading]       = useState(true);
  const [rxFilter,        setRxFilter]        = useState<RxFilter>("queue");
  const [subFilter,       setSubFilter]       = useState<SubFilter>("all");
  const [rxSearch,        setRxSearch]        = useState("");
  const [rxExpanded,      setRxExpanded]      = useState<Set<string>>(new Set());
  // viewSession = ALL medicines belonging to one prescription "slip" (same patient + same date)
  const [viewSession,     setViewSession]     = useState<RxRow[] | null>(null);
  const [rxUpdating,      setRxUpdating]      = useState(false);
  const [pendingSlipId,   setPendingSlipId]   = useState<string | null>(null);
  const [confirmAction,   setConfirmAction]   = useState<"dispensed" | "cancelled" | null>(null);
  const [dispenseError,   setDispenseError]   = useState<string | null>(null);

  const now     = new Date();
  const dateStr = `Day, ${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;

  useEffect(() => {
    if (!showRequestMenu) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-request-menu]")) setShowRequestMenu(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [showRequestMenu]);

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent).detail?.id;
      if (id) setPendingSlipId(String(id));
    };
    window.addEventListener("openPrescriptionSlip", handler);
    return () => window.removeEventListener("openPrescriptionSlip", handler);
  }, []);

  useEffect(() => {
    async function fetchDispense() {
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const end   = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
      const { data, error } = await supabase
        .from("pharma_dispense").select("med_name, quantity, dispensed_at")
        .gte("dispensed_at", start).lt("dispensed_at", end);
      if (!error && data) setDispenseData(data as DispenseEntry[]);
    }
    fetchDispense();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function fetchAllDispense() {
      const start = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();
      const { data, error } = await supabase
        .from("pharma_dispense").select("med_name, quantity, dispensed_at")
        .gte("dispensed_at", start);
      if (!error && data) setAllDispense(data as DispenseEntry[]);
    }
    fetchAllDispense();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function fetchRx() {
      setRxLoading(true);
      try {
        const { data, error } = await supabase
          .from("prescriptions")
          .select(`
            id,
            prescription_date,
            created_at,
            medicine,
            dosage,
            frequency,
            quantity,
            status,
            patients (
              first_name,
              last_name,
              age,
              sex,
              purok,
              barangay,
              municipality
            )
          `)
          .order("created_at", { ascending: false })
          .limit(30);
        if (error) throw error;
        const mapped: RxRow[] = (data ?? []).map((row: any) => {
          const { name, age, sex, address } = mapPatientRow(row);
          return {
            id:               row.id,
            patient_name:     name,
            patient_age:      age,
            patient_sex:      sex,
            patient_address:  address,
            medicine:         row.medicine,
            dosage:           row.dosage    ?? null,
            frequency:        row.frequency ?? null,
            quantity:         row.quantity  ?? null,
            status:           row.status,
            prescription_date: row.prescription_date,
            created_at:        row.created_at ?? null,
          };
        });
        setRxRows(mapped);
      } catch {
        setRxRows([]);
      } finally {
        setRxLoading(false);
      }
    }
    fetchRx();
  }, []);

  /* ── Opening a slip from a notification: gather the FULL session
   * (same patient + same date), not just the single medicine that
   * triggered the notification ── */
  useEffect(() => {
    if (!pendingSlipId || rxLoading) return;
    const match = rxRows.find(r => r.id === pendingSlipId);
    if (match) {
      const sessionRows = rxRows.filter(r => buildRxSlipKey(r) === buildRxSlipKey(match));
      setRxExpanded(prev => new Set(prev).add(match.patient_name));
      setViewSession(sessionRows.length > 0 ? sessionRows : [match]);
      setPendingSlipId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("prescriptions")
          .select(`
            id, prescription_date, created_at, medicine, dosage, frequency, quantity, status,
            patients ( first_name, last_name, age, sex, purok, barangay, municipality )
          `)
          .eq("id", pendingSlipId)
          .maybeSingle();
        if (error || !data || cancelled) return;
        const { name, age, sex, address } = mapPatientRow(data);
        const row: RxRow = {
          id:               (data as any).id,
          patient_name:     name,
          patient_age:      age,
          patient_sex:      sex,
          patient_address:  address,
          medicine:         (data as any).medicine,
          dosage:           (data as any).dosage    ?? null,
          frequency:        (data as any).frequency ?? null,
          quantity:         (data as any).quantity  ?? null,
          status:           (data as any).status,
          prescription_date: (data as any).prescription_date,
          created_at:        (data as any).created_at ?? null,
        };
        setViewSession([row]);
      } finally {
        if (!cancelled) setPendingSlipId(null);
      }
    })();
    return () => { cancelled = true; };
  }, [pendingSlipId, rxLoading, rxRows]);

  const todayStr = now.toISOString().split("T")[0];
  const totalDispensedToday = allDispense
    .filter(r => r.dispensed_at.startsWith(todayStr))
    .reduce((s, r) => s + r.quantity, 0);

  /* ── Expiring medicines ── */
  const expiringMeds = medicines
    .filter(m => !m.archived)
    .map(m => {
      const exp   = new Date(m.exp_date); exp.setHours(0, 0, 0, 0);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const days  = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return { ...m, daysLeft: days };
    })
    .filter(m => m.daysLeft <= 30)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  /* ── Donut data ── */
  const dispenseSegs = (() => {
    if (dispenseData.length === 0) return [];
    const totals: Record<string, number> = {};
    for (const row of dispenseData) totals[row.med_name] = (totals[row.med_name] ?? 0) + row.quantity;
    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    const top    = sorted.slice(0, 5);
    const others = sorted.slice(5).reduce((s, [, v]) => s + v, 0);
    const result = top.map(([, v], i) => ({ v, c: DONUT_COLORS[i] }));
    if (others > 0) result.push({ v: others, c: "#ccc" });
    return result;
  })();

  const dispenseLegend = (() => {
    if (dispenseData.length === 0) return [];
    const totals: Record<string, number> = {};
    for (const row of dispenseData) totals[row.med_name] = (totals[row.med_name] ?? 0) + row.quantity;
    const sorted    = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    const top       = sorted.slice(0, 5).map(([name, qty], i) => ({ name, qty, color: DONUT_COLORS[i] }));
    const othersQty = sorted.slice(5).reduce((s, [, v]) => s + v, 0);
    if (othersQty > 0) top.push({ name: "Others", qty: othersQty, color: "#ccc" });
    return top;
  })();

  const totalDispensed = dispenseData.reduce((s, r) => s + r.quantity, 0);

  const active  = medicines.filter(m => !m.archived);
  const highest = active.filter(m => getEffectiveQty(m) >= 50).length;
  const medium  = active.filter(m => getEffectiveQty(m) >= 10 && getEffectiveQty(m) < 50).length;
  const lowest  = active.filter(m => getEffectiveQty(m) < 10).length;
  const stockSegs = [
    { v: highest || 0.001, c: STOCK_GREEN_HIGH },
    { v: medium  || 0.001, c: STOCK_GREEN_MED },
    { v: lowest  || 0.001, c: STOCK_GREEN_LOW },
  ];

  const drugsCount    = active.filter(m => categorise(m) === "drugs").length;
  const suppliesCount = active.filter(m => categorise(m) === "supplies").length;

  /* ── Validate dispense (hard block) ─────────────────────────────────────────
   * Priority order:
   *   1. Found in active + non-expired + in-stock  → no error (can dispense)
   *   2. Found in active but expired               → expired error
   *   3. Found in active but out of stock          → out-of-stock error
   *   4. Found only in archived                    → archived/expired error
   *   5. Not found anywhere                        → not-found error
   *
   * All checks use bestMatchWithThreshold() so a low-confidence fuzzy hit
   * (e.g. a COC pill matching a Cetirizine prescription with score < 10)
   * is ignored and we fall through to "not found in inventory".
   *
   * Error messages always use rx.medicine (the prescription name) as the
   * subject — never the matched inventory item's name — so the pharmacist
   * always sees the correct medicine name in the error.
   * ── */
  const validateDispense = (rx: RxRow): string | null => {
    // 1. Try to find a valid (active, non-expired, in-stock) match
    const validPool = medicines.filter(m => !m.archived && !isMedicineExpired(m) && getEffectiveQty(m) > 0);
    if (bestMatchWithThreshold(rx.medicine, validPool) !== null) return null; // all good

    // 2. Check active (non-archived) medicines
    const activePool  = medicines.filter(m => !m.archived);
    const activeMatch = bestMatchWithThreshold(rx.medicine, activePool);
    if (activeMatch) {
      if (isMedicineExpired(activeMatch))
        return `Cannot dispense — "${rx.medicine}" has expired (exp: ${activeMatch.exp_date}) and is no longer available. Please restock with a valid batch before dispensing.`;
      if (getEffectiveQty(activeMatch) <= 0)
        return `Cannot dispense — "${rx.medicine}" is out of stock. Please restock before dispensing.`;
    }

    // 3. Check archived medicines — medicine exists but was archived (likely auto-expired)
    const archivedPool  = medicines.filter(m => m.archived);
    const archivedMatch = bestMatchWithThreshold(rx.medicine, archivedPool);
    if (archivedMatch) {
      if (isMedicineExpired(archivedMatch))
        return `Cannot dispense — "${rx.medicine}" has expired (exp: ${archivedMatch.exp_date}) and has been automatically archived. Please restock with a new valid batch before dispensing.`;
      return `Cannot dispense — "${rx.medicine}" is archived and unavailable. Please restore or restock it before dispensing.`;
    }

    // 4. Not found in inventory at all
    return `Cannot dispense — "${rx.medicine}" was not found in the inventory. Please add it to the medicine stock first.`;
  };

  /**
   * Classify a single prescription row into a bucket:
   *  - "dispensed" / "cancelled" mirror the DB status directly.
   *  - any still-"sent" row is "sent" if its medicine is currently available
   *    in stock, or "unavailable" if validateDispense() flags a problem —
   *    this drives the "Not Available" queue.
   */
  const classifyRow = (rx: RxRow): "queue" | "unavailable" | "dispensed" | "cancelled" => {
  if (rx.status === "dispensed") return "dispensed";
  if (rx.status === "cancelled") return "cancelled";
  return validateDispense(rx) === null ? "queue" : "unavailable";
};

  /* ── Low-stock soft warning ── */
  const getLowStockWarning = (rx: RxRow): string | null => {
    // Only show low-stock warning when the medicine IS available but quantity is low
    const validPool = medicines.filter(m => !m.archived && !isMedicineExpired(m) && getEffectiveQty(m) > 0);
    const bestMatch = bestMatchWithThreshold(rx.medicine, validPool);
    if (!bestMatch) return null;

    const total = getEffectiveQty(bestMatch);
    if (total > 0 && total <= LOW_STOCK_THRESHOLD) {
      const isBox    = IS_BOX_UNIT(bestMatch.unit);
      const unitDesc = isBox
        ? `${total} piece${total !== 1 ? "s" : ""}`
        : `${total} ${bestMatch.unit || "unit(s)"}`;
      return `Low stock warning — only ${unitDesc} of "${rx.medicine}" remaining in inventory. Consider cancelling if supply is insufficient for the full prescription.`;
    }
    return null;
  };

  const classifiedRx = rxRows.map(rx => ({ rx, cls: classifyRow(rx) }));

 const rxCounts = {
  queue:       classifiedRx.filter(c => c.cls === "queue").length,
  unavailable: classifiedRx.filter(c => c.cls === "unavailable").length,
  all:         rxRows.length,
  sent:        classifiedRx.filter(c => c.cls === "queue").length,
  dispensed:   classifiedRx.filter(c => c.cls === "dispensed").length,
  cancelled:   classifiedRx.filter(c => c.cls === "cancelled").length,
};

 const baseFilteredRx = (() => {
  if (rxFilter === "unavailable") {
    return classifiedRx.filter(c => c.cls === "unavailable").map(c => c.rx);
  }
  // queue tab — apply subFilter
  const queueRows = classifiedRx
    .filter(c => c.cls === "queue" || c.cls === "dispensed" || c.cls === "cancelled")
    .map(c => c.rx);
  if (subFilter === "all") return queueRows;
  if (subFilter === "sent") return classifiedRx.filter(c => c.cls === "queue").map(c => c.rx);
  if (subFilter === "dispensed") return classifiedRx.filter(c => c.cls === "dispensed").map(c => c.rx);
  if (subFilter === "cancelled") return classifiedRx.filter(c => c.cls === "cancelled").map(c => c.rx);
  return queueRows;
})();

 const filteredRx = baseFilteredRx.filter(rx => {
  const q = rxSearch.trim().toLowerCase();
  if (!q) return true;
  return (
    rx.patient_name.toLowerCase().includes(q) ||
    rx.medicine.toLowerCase().includes(q) ||
    (rx.patient_address ?? "").toLowerCase().includes(q)
  );
});

  /* ── Sessions = one prescription slip/batch.
   * HINDI na patient + date lang ang grouping, kasi puwedeng may dalawang magkaibang
   * prescription ang doctor sa iisang patient sa parehong araw. Rows are grouped only
   * when they were created close together (same 5-minute batch), so magkakasama lang
   * yung sabay na ni-prescribe. ── */
  const getSlipTimeBucket = (rx: RxRow): string => {
    const raw = rx.created_at ?? rx.prescription_date;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return "no-time";
    return String(Math.floor(d.getTime() / (1000 * 60 * 5)));
  };

  const buildRxSlipKey = (rx: RxRow): string =>
    `${rx.patient_name}__${rx.prescription_date}__${getSlipTimeBucket(rx)}`;

  type RxSession = { key: string; patient_name: string; date: string; rows: RxRow[] };

  const rxSessions: RxSession[] = (() => {
    const map = new Map<string, RxSession>();
    for (const rx of filteredRx) {
      const key = buildRxSlipKey(rx);
      if (!map.has(key)) map.set(key, { key, patient_name: rx.patient_name, date: rx.prescription_date, rows: [] });
      map.get(key)!.rows.push(rx);
    }
    return Array.from(map.values());
  })();

  type RxGroup = { patient_name: string; sessions: RxSession[] };
  const rxGroups: RxGroup[] = (() => {
    const map = new Map<string, RxGroup>();
    for (const session of rxSessions) {
      if (!map.has(session.patient_name)) map.set(session.patient_name, { patient_name: session.patient_name, sessions: [] });
      map.get(session.patient_name)!.sessions.push(session);
    }
    return Array.from(map.values()).slice(0, 8);
  })();

  /* Always open the FULL session (every medicine for that patient + date),
   * even if the sidebar list is currently filtered to a sub-set. */
  const openSession = (session: RxSession) => {
    const fullRows = rxRows.filter(r => buildRxSlipKey(r) === session.key);
    const baseRows = fullRows.length > 0 ? fullRows : session.rows;

    // Sa Not Available tab, ang ipapakita at ipiprint lang ay yung gamot na wala sa RHU/pharmacy stock.
    // Hindi na isasama sa form yung ibang gamot ng same patient na available naman.
   const unavailableOnly = rxFilter === "unavailable"
  ? baseRows.filter(r => isPendingStatus(r.status) && validateDispense(r) !== null)
  : baseRows;

    setViewSession(unavailableOnly.length > 0 ? unavailableOnly : baseRows);
    setDispenseError(null);
  };

  const sessionStatus = (session: RxSession): "queue" | "unavailable" | "dispensed" | "cancelled" => {
  const classes = session.rows.map(classifyRow);
  if (classes.includes("unavailable")) return "unavailable";
  if (classes.length > 0 && classes.every(c => c === "dispensed")) return "dispensed";
  if (classes.length > 0 && classes.every(c => c === "cancelled")) return "cancelled";
  if (classes.includes("queue")) return "queue";
  return classes[0] ?? "queue";
};

  const toggleRxGroup = (name: string) => {
    setRxExpanded(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const printPrescriptionSlip = () => {
    if (typeof window !== "undefined") window.print();
  };

  const cancelCurrentSession = async () => {
    if (!viewSession || viewSession.length === 0) return;
    await handleRxUpdate(viewSession, "cancelled");
  };

  const handleConfirmDispenseClick = () => {
    if (!viewSession || viewSession.length === 0) return;
    const pending = viewSession.filter(r => isPendingStatus(r.status));
    if (pending.length === 0) {
      setDispenseError("Nothing pending to dispense in this prescription.");
      return;
    }
    const dispensable = pending.filter(r => validateDispense(r) === null);
    if (dispensable.length === 0) {
      setDispenseError("None of the medicines in this prescription are currently available to dispense.");
      return;
    }
    setDispenseError(null);
    setConfirmAction("dispensed");
  };

  /* ── Update an entire session at once ──
   * - "cancelled": cancels every still-pending row in the session.
   * - "dispensed": dispenses every pending row that's currently available,
   *   skipping (and reporting) any that aren't — partial dispense is allowed
   *   so the pharmacist doesn't get blocked on the whole slip just because
   *   one item ran out. ── */
  const handleRxUpdate = async (rows: RxRow[], status: "dispensed" | "cancelled") => {
    if (rows.length === 0) return;
    setRxUpdating(true);
    try {
      if (status === "cancelled") {
        const ids = rows.filter(r => isPendingStatus(r.status)).map(r => r.id);
        if (ids.length > 0) {
          const { error } = await supabase.from("prescriptions").update({ status: "cancelled" }).in("id", ids);
          if (error) throw error;
        }
        setRxRows(prev => prev.map(r => ids.includes(r.id) ? { ...r, status: "cancelled" } : r));
        setViewSession(null);
        setConfirmAction(null);
        setDispenseError(null);
        return;
      }

      // status === "dispensed"
      const pending  = rows.filter(r => isPendingStatus(r.status));
      const skipped: string[] = [];
      const dispensedIds: string[] = [];

      for (const rx of pending) {
        const validPool = medicines.filter(m => !m.archived && !isMedicineExpired(m) && getEffectiveQty(m) > 0);
        const bestMatch  = bestMatchWithThreshold(rx.medicine, validPool);
        if (!bestMatch) { skipped.push(rx.medicine); continue; }

        /* ── Fresh DB read to verify current state ── */
        const { data: freshMed } = await supabase
          .from("pharma_medicines")
          .select("id, quantity, exp_date, archived, boxes, pieces_per_box, partial_pieces, unit")
          .eq("id", bestMatch.id)
          .maybeSingle();
        if (!freshMed || freshMed.archived) { skipped.push(rx.medicine); continue; }

        const freshExpDate = new Date(freshMed.exp_date); freshExpDate.setHours(0, 0, 0, 0);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        if (freshExpDate < today) { skipped.push(rx.medicine); continue; }

        /* ── Box-aware quantity calculation ── */
        const freshIsBox = IS_BOX_UNIT(freshMed.unit ?? bestMatch.unit);
        const freshPpb   = freshIsBox && (freshMed.pieces_per_box ?? 0) > 0 ? freshMed.pieces_per_box : 10;
        const freshTotal = freshIsBox && ((freshMed.boxes ?? 0) > 0 || (freshMed.partial_pieces ?? 0) > 0)
          ? (freshMed.boxes ?? 0) * freshPpb + (freshMed.partial_pieces ?? 0)
          : (freshMed.quantity as number);

        if (freshTotal <= 0) { skipped.push(rx.medicine); continue; }

        const qty       = parseRxQuantity(rx.quantity);
        const actual    = Math.min(qty, freshTotal);
        const remaining = Math.max(0, freshTotal - actual);

        if (actual > 0) {
          const { error: dispErr } = await supabase.from("pharma_dispense").insert([{
            medicine_id:  bestMatch.id,
            med_name:     bestMatch.med_name,
            quantity:     actual,
            dispensed_at: new Date().toISOString(),
          }]);
          if (dispErr) throw dispErr;
        }

        /* ── Write back box fields if applicable ── */
        const updatePayload: Record<string, number> = { quantity: remaining };
        if (freshIsBox) {
          updatePayload.boxes          = Math.floor(remaining / freshPpb);
          updatePayload.partial_pieces = remaining % freshPpb;
          updatePayload.pieces_per_box = freshPpb;
        }
        const { error: stockErr } = await supabase
          .from("pharma_medicines").update(updatePayload).eq("id", bestMatch.id);
        if (stockErr) throw stockErr;

        const { error: rxErr } = await supabase.from("prescriptions").update({ status: "dispensed" }).eq("id", rx.id);
        if (rxErr) throw rxErr;

        dispensedIds.push(rx.id);
      }

      if (dispensedIds.length > 0) {
        setRxRows(prev => prev.map(r => dispensedIds.includes(r.id) ? { ...r, status: "dispensed" } : r));
        onStockChanged?.();
      }

      if (skipped.length > 0) {
        setDispenseError(
          `${dispensedIds.length} medicine(s) dispensed. Could not dispense: ${skipped.join(", ")} — not available in inventory.`
        );
        setConfirmAction(null);
        // keep the slip open with updated statuses so the pharmacist sees what's left
        setViewSession(prev => prev ? prev.map(r => dispensedIds.includes(r.id) ? { ...r, status: "dispensed" } : r) : prev);
      } else {
        setViewSession(null);
        setConfirmAction(null);
        setDispenseError(null);
      }
    } catch (err) {
      console.error(err);
      setDispenseError("An error occurred while dispensing. Please try again.");
      setConfirmAction(null);
    } finally {
      setRxUpdating(false);
    }
  };

  /* ── Shared styles ── */
  const cardStyle: CSSProperties = {
    background: t.cardBg, borderRadius: 18, border: `1px solid ${t.cardBorder}`,
    overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
    display: "flex", flexDirection: "column",
  };
  const cardHead = (accent: string, title: string, subtitle: string, badge?: ReactNode): JSX.Element => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, gap: 10 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: accent }}>{title}</div>
        <div style={{ fontSize: 10, color: t.text3, marginTop: 2 }}>{subtitle}</div>
      </div>
      {badge}
    </div>
  );
  const emptyMsg: CSSProperties = {
    textAlign: "center", color: t.text3, fontSize: 11,
    padding: "16px 0", fontStyle: "italic",
  };

  const expiryColor = (days: number) => {
    if (days < 0)   return "#dc2626";
    if (days <= 7)  return "#dc2626";
    if (days <= 14) return "#ea580c";
    return "#d97706";
  };
  const expiryBg = (days: number) => {
    if (days < 0)   return "#fef2f2";
    if (days <= 7)  return "#fef2f2";
    if (days <= 14) return "#fff7ed";
    return "#fffbeb";
  };
  const expiryLabel = (days: number) => {
    if (days < 0)   return `Expired ${Math.abs(days)}d ago`;
    if (days === 0) return "Expires today!";
    if (days === 1) return "Expires tomorrow";
    return `${days}d left`;
  };

  /* Badge now keyed off the computed RxFilter bucket (sent/dispensed/cancelled/unavailable)
   * instead of the raw DB status, so "Not Available" can render distinctly. */
  const rxStatusBadge = (status: "queue" | "unavailable" | "dispensed" | "cancelled" | "sent" | "all") => {
    const map: Record<"queue" | "unavailable" | "dispensed" | "cancelled" | "sent" | "all", { bg: string; color: string; label: string }> = {
      queue:       { bg: "#fff8e1", color: "#b8860b", label: "Pending"      },
      sent:        { bg: "#fff8e1", color: "#b8860b", label: "Pending"      },
      dispensed:   { bg: "#e8f5e9", color: "#2e7d32", label: "Dispensed"    },
      cancelled:   { bg: "#fdecea", color: "#c62828", label: "Cancelled"    },
      unavailable: { bg: "#fff3e0", color: "#c2680d", label: "Not Available" },
      all:         { bg: "#f0f0f0", color: "#888",    label: "All"          },
    };
    const s = map[status] ?? { bg: "#f0f0f0", color: "#888", label: String(status) };
    return (
      <span style={{ background: s.bg, color: s.color, borderRadius: 14,
        padding: "1.5px 8px", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>
        {s.label}
      </span>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 14 : 16 }}>

      {/* ── Title + buttons ── */}
      <div className="phd-top-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 10.5, color: t.text3, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 3 }}>Pharmacist</div>
          <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 900, color: t.text, lineHeight: 1, letterSpacing: "-0.5px" }}>DASHBOARD</div>
        </div>
        <div className="phd-top-actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ position: "relative" }} data-request-menu>
            <button
              className="phd-btn"
              onClick={() => setShowRequestMenu(v => !v)}
              style={{
                background: t.green, color: "#fff", border: "none",
                borderRadius: 20, padding: "9px 18px", fontWeight: 700, fontSize: 12.5,
                cursor: "pointer", fontFamily: "inherit",
                boxShadow: `0 3px 10px ${t.green}55`,
                display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
              }}
            >
              Send Request <ChevronDown />
            </button>
            {showRequestMenu && (
              <div style={{
                position: "absolute", top: "calc(100% + 6px)", left: 0,
                background: t.notifBg ?? "#fff", borderRadius: 12,
                boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
                border: `1px solid ${t.notifBorder ?? "#e5e7eb"}`,
                overflow: "hidden", zIndex: 200, minWidth: 210,
              }}>
                {([
                  { label: "Medicine Drugs",    type: "drugs"    as const, Icon: DrugIcon,   desc: "Tablets, capsules, syrup…" },
                  { label: "Medicine Supplies", type: "supplies" as const, Icon: SupplyIcon, desc: "Gauze, gloves, tape…"      },
                ] as const).map((opt, i, arr) => (
                  <button key={opt.type}
                    onClick={() => { onSendRequest(opt.type); setShowRequestMenu(false); }}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 10,
                      padding: "11px 16px", border: "none", cursor: "pointer",
                      fontFamily: "inherit", background: "transparent",
                      borderBottom: i < arr.length - 1 ? `1px solid ${t.notifBorder ?? "#f3f4f6"}` : "none",
                      textAlign: "left",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = `${t.green}12`)}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <span style={{
                      width: 32, height: 32, borderRadius: 8, background: `${t.green}18`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: t.green, flexShrink: 0,
                    }}>
                      <opt.Icon />
                    </span>
                    <span>
                      <div style={{ fontSize: 13, fontWeight: 700, color: t.notifText ?? "#1f2937" }}>{opt.label}</div>
                      <div style={{ fontSize: 11, color: t.text3, marginTop: 1 }}>{opt.desc}</div>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="phd-btn" onClick={onViewRequests} style={{
            background: "transparent", color: t.green, border: `1.5px solid ${t.green}`,
            borderRadius: 20, padding: "9px 18px", fontWeight: 700, fontSize: 12.5,
            cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
          }}>View Requests</button>
        </div>
      </div>

      {/* ── Main grid ── */}
      <div className="phd-main-grid" style={{
        display: "grid",
        gridTemplateColumns: isTablet ? "1fr" : "minmax(0, 1fr) 460px",
        gap: isMobile ? 12 : 16,
        alignItems: "stretch",
      }}>

        {/* ── Left column ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 12 : 16, minWidth: 0 }}>

          <SH accent={t.green} muted={t.text3}>Overview</SH>
          <div className="phd-stat-row" style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: isMobile ? 10 : 14 }}>
            <StatCard
              label="Total Medicine"
              value={totalCount}
              sub={dateStr}
              gradient={`linear-gradient(135deg,${t.green} 0%,${t.greenLight} 100%)`}
              icon={<PillIcon size={17} color="#fff" />}
            />
            <StatCard
              label="Drugs"
              value={drugsCount}
              sub="medicine drugs"
              gradient={`linear-gradient(135deg,${ACCENT_GREEN_ALT} 0%,${ACCENT_GREEN_ALT_L} 100%)`}
              icon={<DrugIcon />}
            />
            <StatCard
              label="Supplies"
              value={suppliesCount}
              sub="medicine supplies"
              gradient={`linear-gradient(135deg,${ACCENT_GREEN_SUPPLY} 0%,${ACCENT_GREEN_SUPPLY_L} 100%)`}
              icon={<SupplyIcon />}
            />
            <StatCard
              label="Dispensed Today"
              value={totalDispensedToday}
              sub="medicines out today"
              gradient={`linear-gradient(135deg,#14532d 0%,#16a34a 100%)`}
              icon={<BoxIcon size={16} color="#fff" />}
            />
          </div>

          <SH accent={t.green} muted={t.text3}>Inventory &amp; Dispensing</SH>
          <div className="phd-charts-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: isMobile ? 10 : 14 }}>

            {/* Stock Levels */}
            <div className="phd-hover-lift" style={{ ...cardStyle, padding: isMobile ? 14 : 20, minHeight: 250, justifyContent: "flex-start" }}>
              {cardHead(t.green, "Stock Levels", "Inventory health at a glance",
                <div style={{ background: `${t.green}15`, border: `1px solid ${t.green}30`, borderRadius: 20, padding: "3px 10px", fontSize: 9.5, fontWeight: 800, color: t.green, whiteSpace: "nowrap" }}>
                  {active.length} items
                </div>
              )}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
                {active.length === 0 ? (
                  <div style={emptyMsg}>No medicines yet</div>
                ) : (
                  <>
                    <Donut segments={stockSegs} size={150} thick={25} label={`${active.length}`} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
                      {[
                        { label: "High",   count: highest, c: STOCK_GREEN_HIGH },
                        { label: "Medium", count: medium,  c: STOCK_GREEN_MED },
                        { label: "Low",    count: lowest,  c: STOCK_GREEN_LOW },
                      ].map(b => (
                        <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: b.c, flexShrink: 0 }} />
                          <span style={{ fontSize: 12, color: t.text2, fontWeight: 600, minWidth: 52 }}>{b.label}</span>
                          <span style={{ fontSize: 13, fontWeight: 800, color: t.text, minWidth: 22, textAlign: "right" }}>{b.count}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Dispense Monthly */}
            <div className="phd-hover-lift" style={{ ...cardStyle, padding: isMobile ? 14 : 20, minHeight: 250, justifyContent: "flex-start" }}>
              {cardHead(ACCENT_PURPLE, "Dispense (Monthly)", "Top medicines this month",
                <div style={{ background: `${ACCENT_PURPLE}18`, border: `1px solid ${ACCENT_PURPLE}30`, borderRadius: 20, padding: "3px 10px", fontSize: 9.5, fontWeight: 800, color: ACCENT_PURPLE, whiteSpace: "nowrap" }}>
                  {totalDispensed} units
                </div>
              )}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {dispenseSegs.length === 0 ? (
                  <div style={emptyMsg}>No dispense records this month</div>
                ) : (
                  <>
                    <Donut segments={dispenseSegs} size={150} thick={25} label={String(totalDispensed)} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, width: "100%" }}>
                      {dispenseLegend.map((item, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 10.5, color: t.text2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: t.text, flexShrink: 0 }}>{item.qty}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── Expiring Soon ── */}
          <SH accent="#dc2626" muted={t.text3}>Alerts</SH>
          <div className="phd-hover-lift" style={{ ...cardStyle, borderRadius: 18 }}>
            <div style={{
              background: "linear-gradient(135deg,#dc2626,#ef4444)",
              padding: "10px 16px", flexShrink: 0,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ color: "#fff", fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 6 }}>
                <CalendarIcon color="#fff" />
                Expiring Soon <span style={{ opacity: 0.75, fontWeight: 600 }}>· 30 days</span>
              </span>
              {expiringMeds.length > 0 && (
                <span style={{ background: "rgba(255,255,255,0.25)", color: "#fff", borderRadius: 16, padding: "2px 9px", fontSize: 10.5, fontWeight: 700 }}>
                  {expiringMeds.length}
                </span>
              )}
            </div>
            <div style={{ padding: isMobile ? 10 : 12 }}>
              {expiringMeds.length === 0 ? (
                <div style={{ ...emptyMsg, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                  <span style={{ color: t.text3, fontSize: 11 }}>No medicines expiring soon</span>
                </div>
              ) : (
                <div className="phd-scroll" style={{ maxHeight: 300, overflowY: "auto", overflowX: "hidden", paddingRight: 4 }}>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2,1fr)", gap: 8 }}>
                    {expiringMeds.map((med) => {
                      const color = expiryColor(med.daysLeft);
                      const bg    = expiryBg(med.daysLeft);
                      return (
                        <div key={med.id} className="phd-card-row" style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "10px 12px", borderRadius: 12,
                          background: bg, border: `1px solid ${color}22`,
                        }}>
                          <div style={{ width: 3, height: 28, borderRadius: 3, background: color, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {med.med_name}
                            </div>
                            <div style={{ fontSize: 10.5, color: t.text3, marginTop: 1 }}>
                              {med.med_dosage} · {med.med_type}
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontSize: 9.5, color: t.text3, marginBottom: 1 }}>
                              {new Date(med.exp_date).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
                            </div>
                            <span style={{
                              background: "#fff", color, borderRadius: 16, padding: "1.5px 7px",
                              fontSize: 9.5, fontWeight: 800, whiteSpace: "nowrap",
                              display: "flex", alignItems: "center", gap: 3, border: `1px solid ${color}30`,
                            }}>
                              <WarningIcon color={color} />
                              {expiryLabel(med.daysLeft)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right column: Pending Patients panel ── */}
<div
  className="phd-rx-panel"
  style={{
    background: "#ffffff",
    borderRadius: 18,
    border: `1px solid #d1fae5`,
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.10)",
    height: "100%",
    minHeight: 590,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  }}
>
  {/* Header label */}
  <div style={{ padding: "16px 16px 0", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
    <div style={{ fontSize: 13, fontWeight: 900, color: "#008f3a" }}>PRESCRIPTION</div>
    <div style={{
      minWidth: 30, height: 22, padding: "0 10px", borderRadius: 999,
      background: "linear-gradient(135deg,#22c55e,#16a34a)", color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 12, fontWeight: 900, boxShadow: "0 5px 12px rgba(22,163,74,0.35)",
    }}>{rxRows.length}</div>
  </div>

  {/* Top 2 tabs: In Queue / Not Available */}
  <div style={{ padding: "0 16px", display: "flex", gap: 8, marginBottom: 10 }}>
    {([
      { key: "queue" as const, label: "In Queue", count: rxCounts.queue },
      { key: "unavailable" as const, label: "Not Available", count: rxCounts.unavailable },
    ]).map(tab => {
      const active = rxFilter === tab.key;
      return (
        <button
          key={tab.key}
          onClick={() => setRxFilter(tab.key)}
          style={{
            flex: 1, height: 38, borderRadius: 999,
            border: active ? "none" : "1.5px solid #22c55e",
            background: active ? "linear-gradient(135deg,#22c55e,#16a34a)" : "transparent",
            color: active ? "#fff" : "#16a34a",
            fontSize: 12, fontWeight: 900, cursor: "pointer", fontFamily: "inherit",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            boxShadow: active ? "0 4px 12px rgba(34,197,94,0.30)" : "none",
            transition: "all 0.15s ease",
          }}
        >
          {tab.label}
          <span style={{
            minWidth: 18, height: 18, borderRadius: 999,
            background: active ? "rgba(255,255,255,0.28)" : "#bbf7d0",
            color: active ? "#fff" : "#16a34a",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            padding: "0 5px", fontSize: 10, fontWeight: 900, lineHeight: 1,
          }}>{tab.count}</span>
        </button>
      );
    })}
  </div>

  {/* Search bar */}
  <div style={{ position: "relative", padding: "0 16px", marginBottom: 10 }}>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="#8aa99a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ position: "absolute", left: 28, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
      <circle cx="11" cy="11" r="8"/>
      <path d="m21 21-4.35-4.35"/>
    </svg>
    <input
      value={rxSearch}
      onChange={e => setRxSearch(e.target.value)}
      placeholder="Search patients..."
      style={{
        width: "100%", height: 36, borderRadius: 20,
        border: "1.5px solid #d1fae5", outline: "none",
        padding: "0 12px 0 34px", fontSize: 11, color: "#134e2a",
        fontFamily: "inherit", boxSizing: "border-box", background: "#f8fffb",
      }}
    />
  </div>

  {/* Sub-filter pills (only on queue tab) */}
  {rxFilter === "queue" && (
    <div style={{ padding: "0 16px", display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
      {([
        { key: "all" as const, label: "All" },
        { key: "sent" as const, label: "Pending" },
        { key: "cancelled" as const, label: "Reject" },
        { key: "dispensed" as const, label: "Completed" },
      ]).map(f => {
        const active = subFilter === f.key;
        return (
          <button
            key={f.key}
            onClick={() => setSubFilter(f.key)}
            style={{
              height: 26, borderRadius: 999, padding: "0 11px",
              border: active ? "none" : "1.5px solid #bbf7d0",
              background: active ? "#22c55e" : "#f0fdf4",
              color: active ? "#fff" : "#16a34a",
              fontSize: 10.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
              transition: "all 0.12s ease",
            }}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  )}

  {/* Not Available info banner */}
  {rxFilter === "unavailable" && (
    <div style={{
      margin: "0 16px 10px",
      borderRadius: 9, border: "1px solid #bfe8d2",
      background: "#f8fffb", padding: "9px 12px",
      fontSize: 10, lineHeight: 1.45, color: "#006b33",
    }}>
      Tests not available here (X-ray, Gene Xpert, AFB/DSSM, Culture &amp; Sensitivity).
    </div>
  )}

  {/* Patient cards list */}
  <div className="phd-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "0 16px 12px" }}>
    {rxLoading ? (
      <div style={{ textAlign: "center", color: "#709481", fontSize: 11, padding: "16px 0", fontStyle: "italic" }}>Loading patients…</div>
    ) : rxGroups.length === 0 ? (
      <div style={{ textAlign: "center", color: "#709481", fontSize: 11, padding: "16px 0", fontStyle: "italic" }}>No patients found.</div>
    ) : (
      rxGroups.map(group =>
        group.sessions.map(session => {
          const first = session.rows[0];
          const totalMeds = session.rows.length;
          const status = sessionStatus(session);
          const shortAddress = first.patient_address?.split(",").slice(0, 2).join(", ") || "";
          const dateLabel = new Date(session.date).toLocaleDateString("en-PH", { month: "short", day: "2-digit" });
          const medicineLabel = totalMeds === 1 ? first.medicine : `${first.medicine} +${totalMeds - 1} other`;

          return (
            <div key={session.key} style={{
              border: "1.5px solid #0f7f3a", borderRadius: 11,
              background: "#fbfffd",
              boxShadow: "0 8px 18px rgba(15,127,58,0.10)",
              marginBottom: 10, overflow: "hidden",
            }}>
              <div style={{ padding: "10px 12px 8px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
                  <div style={{
                    width: 27, height: 27, borderRadius: 8, background: "#119447",
                    color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 900, flexShrink: 0,
                  }}>{first.patient_name.charAt(0).toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: "#0f7f3a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {first.patient_name}
                      </div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#b9a9b8", flexShrink: 0 }}>{dateLabel}</div>
                    </div>
                    {totalMeds > 1 && (
                      <div style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        float: "right", marginTop: 5, borderRadius: 999,
                        border: "1px solid #bdeccb", background: "#f6fff9",
                        color: "#0f7f3a", fontSize: 8, fontWeight: 900, padding: "2px 7px",
                      }}>+{totalMeds - 1} other</div>
                    )}
                    <div style={{ fontSize: 9.5, color: "#618071", marginTop: 16 }}>
                      {first.patient_age ?? ""} yrs · {first.patient_sex || ""}{shortAddress ? ` · ${shortAddress}` : ""}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 11, borderTop: "1px solid #d8f1e3", paddingTop: 9 }}>
                  <span title={medicineLabel} style={{
                    display: "inline-flex", alignItems: "center", maxWidth: "100%",
                    borderRadius: 999, background: "#d9f8e4", border: "1px solid #b9efcb",
                    color: "#008f3a", fontSize: 8.5, fontWeight: 900, padding: "3px 8px",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{medicineLabel}</span>
                </div>
              </div>

              {rxFilter === "unavailable" ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "0 12px 10px" }}>
                  <button onClick={() => openSession(session)} style={{
                    height: 34, border: "none", borderRadius: 8,
                    background: "linear-gradient(135deg,#15803d,#16a34a)",
                    color: "#fff", fontSize: 11, fontWeight: 900, cursor: "pointer", fontFamily: "inherit",
                  }}>Print</button>
                  <button onClick={() => {
                    const fullRows = rxRows.filter(r => buildRxSlipKey(r) === session.key);
                    setViewSession(fullRows.length > 0 ? fullRows : session.rows);
                    setDispenseError(null);
                    setConfirmAction("cancelled");
                  }} style={{
                    height: 34, border: "1px solid #b9efcb", borderRadius: 8,
                    background: "#d9f8e4", color: "#008f3a",
                    fontSize: 11, fontWeight: 900, cursor: "pointer", fontFamily: "inherit",
                  }}>Cancel</button>
                </div>
              ) : (
                <div style={{ padding: "0 12px 10px" }}>
                  <button onClick={() => openSession(session)} style={{
                    width: "100%", height: 34, border: "none", borderRadius: 8,
                    background: "linear-gradient(135deg,#15803d,#16a34a)",
                    color: "#fff", fontSize: 11, fontWeight: 900, cursor: "pointer", fontFamily: "inherit",
                  }}>View</button>
                </div>
              )}
            </div>
          );
        })
      )
    )}
  </div>
</div>

      </div>

      {/* ── Prescription slip modal — ONE form per patient/date, with ALL their medicines listed ── */}
      {viewSession && viewSession.length > 0 && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000, overflowY: "auto", padding: "32px 0",
          }}
          onClick={() => { setViewSession(null); setConfirmAction(null); setDispenseError(null); }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: "min(6.2in, 94vw)",
              background: "#f3f6f4",
              borderRadius: 14,
              boxShadow: "0 18px 55px rgba(0,0,0,0.35)",
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.35)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{
              background: "linear-gradient(135deg,#0f7a3b,#15803d)",
              padding: "14px 18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "#fff", fontSize: 13, fontWeight: 900 }}>Prescription Form</div>
                <div style={{ color: "rgba(255,255,255,0.82)", fontSize: 11, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {viewSession[0].patient_name} — {new Date(viewSession[0].prescription_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                {rxFilter === "unavailable" && (
                  <button
                    className="phd-btn"
                    onClick={printPrescriptionSlip}
                    style={{
                      height: 34,
                      padding: "0 16px",
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.45)",
                      background: "rgba(255,255,255,0.14)",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 900,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Print
                  </button>
                )}
                <button
                  className="phd-btn"
                  onClick={() => { setViewSession(null); setConfirmAction(null); setDispenseError(null); }}
                  style={{
                    height: 34,
                    padding: "0 16px",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.45)",
                    background: "rgba(255,255,255,0.14)",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 900,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Close
                </button>
              </div>
            </div>

            <div style={{ padding: "18px 22px 12px", display: "flex", justifyContent: "center" }}>
              {/* ── Paper slip ── */}
              <div style={{
                width: "min(5.25in, 100%)",
                minHeight: "5.5in",
                background: "#fff",
                fontFamily: "Arial, sans-serif",
                color: "#000",
                padding: "0.22in 0.28in",
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
                position: "relative",
              }}>

              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
                <img
                  src="/logo.jpg" alt="seal"
                  style={{ width: 56, height: 56, objectFit: "contain", flexShrink: 0 }}
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <div style={{ textAlign: "center", flex: 1, padding: "0 10px", lineHeight: 1.5 }}>
                  <div style={{ fontSize: "8pt" }}>Republic of the Philippines</div>
                  <div style={{ fontSize: "11pt", fontWeight: 900, textTransform: "uppercase" }}>Department of Health</div>
                  <div style={{ fontSize: "10pt", fontWeight: 900, textTransform: "uppercase" }}>Rural Health Unit</div>
                  <div style={{ fontSize: "8.5pt" }}>Lopez, Quezon</div>
                </div>
                <img
                  src="/logo.jpg" alt="seal"
                  style={{ width: 56, height: 56, objectFit: "contain", flexShrink: 0 }}
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>

              {/* Patient fields — shared across the whole session */}
              <div style={{ fontSize: "9pt", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, marginRight: 4, whiteSpace: "nowrap" }}>Name:</span>
                  <span style={{ flex: 2.2, borderBottom: "1px solid #000", paddingLeft: 3, paddingBottom: 1, marginRight: 16 }}>
                    {viewSession[0].patient_name}
                  </span>
                  <span style={{ fontWeight: 700, marginRight: 4, whiteSpace: "nowrap" }}>Date:</span>
                  <span style={{ flex: 1, borderBottom: "1px solid #000", paddingLeft: 3, paddingBottom: 1 }}>
                    {new Date(viewSession[0].prescription_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, marginRight: 4, whiteSpace: "nowrap" }}>Age:</span>
                  <span style={{ flex: 0.7, borderBottom: "1px solid #000", paddingLeft: 3, paddingBottom: 1, marginRight: 14 }}>
                    {viewSession[0].patient_age ?? ""}
                  </span>
                  <span style={{ fontWeight: 700, marginRight: 4, whiteSpace: "nowrap" }}>Gender:</span>
                  <span style={{ flex: 0.9, borderBottom: "1px solid #000", paddingLeft: 3, paddingBottom: 1, marginRight: 14 }}>
                    {viewSession[0].patient_sex === "M" ? "Male" : viewSession[0].patient_sex === "F" ? "Female" : ""}
                  </span>
                  <span style={{ fontWeight: 700, marginRight: 4, whiteSpace: "nowrap" }}>Civil Status:</span>
                  <span style={{ flex: 1.2, borderBottom: "1px solid #000", minHeight: 16 }} />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <span style={{ fontWeight: 700, marginRight: 4, whiteSpace: "nowrap" }}>Address:</span>
                  <span style={{ flex: 1, borderBottom: "1px solid #000", paddingLeft: 3, paddingBottom: 1, minHeight: 16 }}>
                    {viewSession[0].patient_address ?? ""}
                  </span>
                </div>
              </div>

              <div style={{ borderTop: "1px solid #000", margin: "6px 0 8px" }} />

              {/* Rx body */}
              <div style={{ fontFamily: "serif", fontWeight: "bold", fontSize: "30pt", lineHeight: 1, marginBottom: 10 }}>
                R<sub style={{ fontSize: "17pt" }}>x</sub>
              </div>

              {/* ── All medicines for this patient/date, listed together in ONE form ── */}
              <div style={{ flex: 1, paddingLeft: 4, fontSize: "10pt", display: "flex", flexDirection: "column", gap: 10 }}>
                {viewSession.map((rx, idx) => {
                  const err  = isPendingStatus(rx.status) ? validateDispense(rx) : null;
                  const warn = isPendingStatus(rx.status) && !err ? getLowStockWarning(rx) : null;
                  return (
                    <div key={rx.id} style={{
                      borderBottom: idx < viewSession.length - 1 ? "1px dashed #ccc" : "none",
                      paddingBottom: idx < viewSession.length - 1 ? 8 : 0,
                    }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ fontSize: "11pt", fontWeight: "bold" }}>{rx.medicine}</div>
                      </div>
                      {rx.dosage    && <div style={{ marginBottom: 2 }}><b>Dosage:</b> {rx.dosage}</div>}
                      {rx.frequency && <div style={{ marginBottom: 2 }}><b>Sig:</b> {rx.frequency}</div>}
                      {rx.quantity  && <div style={{ marginBottom: 2 }}><b>Qty:</b> #{rx.quantity}</div>}
                    </div>
                  );
                })}
              </div>

              {/* Doctor footer */}
              <div style={{ marginTop: "auto", paddingTop: 14, textAlign: "center" }}>
                <div style={{ borderTop: "1px solid #000", width: "60%", margin: "0 auto 4px" }} />
                <div style={{ fontSize: "9pt", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                  PAOLO GAYLORD S. VILLAFAÑE, MD, FPPS
                </div>
                <div style={{ fontSize: "8pt" }}>Municipal Health Officer</div>
                <div style={{ fontSize: "8pt" }}>Lic. No. 89594</div>
              </div>
            </div>
            </div>

            {/* ── Hard error / partial-result banner ── */}
            {dispenseError && (
              <div style={{
                width: "calc(100% - 44px)",
                background: "#fef2f2",
                border: "1.5px solid #fca5a5",
                borderRadius: 10,
                padding: "12px 16px",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#dc2626", marginBottom: 2 }}>Dispense Result</div>
                  <div style={{ fontSize: 11.5, color: "#7f1d1d", lineHeight: 1.5 }}>{dispenseError}</div>
                </div>
              </div>
            )}

            {/* ── Bottom action buttons ── */}
            {viewSession.some(r => isPendingStatus(r.status)) ? (() => {
              // Kapag galing sa Not Available tab, PRINT + CANCEL lang.
              // Kapag galing sa In Queue tab, ibalik ang dating buttons: CANCEL + CONFIRM.
              const isNotAvailableForm = rxFilter === "unavailable";
              return (
                <div style={{ display: "flex", gap: 10, width: "calc(100% - 44px)", padding: "0 0 18px" }}>
                  <button
                    className="phd-btn"
                    onClick={isNotAvailableForm ? printPrescriptionSlip : () => setConfirmAction("cancelled")}
                    style={{
                      flex: 1, padding: "11px 0", borderRadius: 8,
                      border: "none", background: isNotAvailableForm ? "#15803d" : "#d63031", color: "#fff",
                      fontSize: 13, fontWeight: 900, cursor: "pointer", fontFamily: "inherit",
                    }}>
                    {isNotAvailableForm ? "PRINT" : "CANCEL"}
                  </button>
                  <button
                    className="phd-btn"
                    onClick={isNotAvailableForm ? cancelCurrentSession : handleConfirmDispenseClick}
                    style={{
                      flex: 1, padding: "11px 0", borderRadius: 8,
                      border: isNotAvailableForm ? "1.5px solid #bbf7d0" : "none",
                      background: isNotAvailableForm ? "#dcfce7" : "#1b5e20",
                      color: isNotAvailableForm ? "#166534" : "#fff",
                      fontSize: 13, fontWeight: 900, cursor: "pointer", fontFamily: "inherit",
                    }}>
                    {isNotAvailableForm ? "CANCEL" : "CONFIRM"}
                  </button>
                </div>
              );
            })() : (
              <div style={{ display: "flex", gap: 10, width: "calc(100% - 44px)", padding: "0 0 18px" }}>
                <button
                  className="phd-btn"
                  onClick={printPrescriptionSlip}
                  style={{
                    flex: 1, padding: "11px 0", borderRadius: 8,
                    border: "none", background: "#15803d", color: "#fff",
                    fontSize: 13, fontWeight: 900, cursor: "pointer", fontFamily: "inherit",
                  }}>
                  PRINT
                </button>
                <button
                  className="phd-btn"
                  onClick={() => { setViewSession(null); setDispenseError(null); }}
                  style={{
                    flex: 1, padding: "11px 0", borderRadius: 8,
                    border: "1.5px solid #bbf7d0", background: "#dcfce7", color: "#166534",
                    fontSize: 13, fontWeight: 900, cursor: "pointer", fontFamily: "inherit",
                  }}>
                  CLOSE
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Confirmation dialog ── */}
      {viewSession && confirmAction && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1100, padding: 16,
          }}
          onClick={() => !rxUpdating && setConfirmAction(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: t.cardBg, borderRadius: 16, width: 380, maxWidth: "92vw",
              padding: "24px 24px 20px", boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
              textAlign: "center", border: `1px solid ${t.cardBorder}`,
            }}
          >
            <div style={{
              width: 48, height: 48, borderRadius: "50%",
              background: confirmAction === "dispensed" ? "#1b5e2022" : "#d6303122",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {confirmAction === "dispensed" ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1b5e20" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
              {confirmAction === "dispensed" ? "Confirm Dispense?" : "Cancel This Prescription?"}
            </div>
            <div style={{ fontSize: 12.5, color: t.text3, lineHeight: 1.5 }}>
              {confirmAction === "dispensed" ? (() => {
                const pending     = viewSession.filter(r => isPendingStatus(r.status));
                const dispensable = pending.filter(r => validateDispense(r) === null);
                const skipped     = pending.filter(r => validateDispense(r) !== null);
                return (
                  <>
                    <b>{dispensable.map(r => r.medicine).join(", ")}</b> will be dispensed to{" "}
                    <b>{viewSession[0].patient_name}</b> and deducted from inventory.
                    {skipped.length > 0 && (
                      <> {skipped.length} item{skipped.length !== 1 ? "s" : ""} ({skipped.map(r => r.medicine).join(", ")}) will be skipped — not available.</>
                    )}
                    {" "}This cannot be undone.
                  </>
                );
              })() : (
                <>This will cancel {viewSession.filter(r => isPendingStatus(r.status)).length} medicine(s) for <b>{viewSession[0].patient_name}</b>. This cannot be undone.</>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, width: "100%", marginTop: 8 }}>
              <button
                className="phd-btn"
                onClick={() => setConfirmAction(null)}
                disabled={rxUpdating}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 8,
                  border: `1.5px solid ${t.border2}`, background: "transparent",
                  color: t.text2, fontSize: 13, fontWeight: 800,
                  cursor: "pointer", fontFamily: "inherit",
                  opacity: rxUpdating ? 0.6 : 1,
                }}>
                Go Back
              </button>
              <button
                className="phd-btn"
                onClick={() => handleRxUpdate(viewSession, confirmAction)}
                disabled={rxUpdating}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 8,
                  border: "none",
                  background: confirmAction === "dispensed" ? "#1b5e20" : "#d63031",
                  color: "#fff", fontSize: 13, fontWeight: 800,
                  cursor: "pointer", fontFamily: "inherit",
                  opacity: rxUpdating ? 0.6 : 1,
                }}>
                {rxUpdating ? "Saving…" : "Yes, Proceed"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}