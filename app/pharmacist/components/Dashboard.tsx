"use client";
import { CSSProperties, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useTheme, MedicineStockSummary } from "../lib/pharmacy";
import { fetchStockSummary } from "../lib/pharmacyData";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

type DispenseEntry = { medicine_id: string; quantity: number; dispensed_at: string; med_name: string };
type StockSort = "az" | "most" | "least";

type Props = {
  totalCount?: number;
};

function useBreakpoint() {
  const [w, setW] = useState(1280);
  useEffect(() => {
    setW(window.innerWidth);
    const fn = () => setW(window.innerWidth);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return { isMobile: w < 680, isTablet: w < 1180 };
}

const DrugIcon = ({ size = 18, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="9" width="20" height="6" rx="3" /><line x1="12" y1="9" x2="12" y2="15" />
  </svg>
);
const SupplyIcon = ({ size = 18, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2c0 1.1.9 2 2 2h5v5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2h-2z" />
  </svg>
);
const CalendarIcon = ({ color = "currentColor", size = 13 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);
const StarIcon = ({ color = "#fff" }: { color?: string }) => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill={color} stroke="none">
    <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9" />
  </svg>
);
const BoxIcon = ({ size = 18, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 8L12 3 3 8v8l9 5 9-5V8z" /><path d="M3 8l9 5 9-5" /><line x1="12" y1="13" x2="12" y2="21" />
  </svg>
);

/* ── Shared visual language (matches the warehouse dashboard's look):
   solid dark-green centered panel headers, clean white bodies, pill
   filter buttons. Pulled into small reusable pieces so every panel below
   stays visually consistent without repeating inline styles everywhere. ── */

function PanelHeader({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const { t } = useTheme();
  return (
    <div style={{
      background: t.green, padding: "13px 18px", position: "relative",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <span style={{
        display: "flex", alignItems: "center", gap: 7, color: "#fff", fontSize: 12,
        fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", textAlign: "center",
      }}>
        {children}
      </span>
      {right && (
        <span style={{ position: "absolute", right: 16, display: "flex", alignItems: "center" }}>
          {right}
        </span>
      )}
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  const { t } = useTheme();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, padding: "8px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 700,
        border: `1.5px solid ${active ? t.green : t.cardBorder}`,
        background: active ? t.green : "#fff",
        color: active ? "#fff" : t.text2,
        cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s", whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

/* Gradient header — reserved for the two "headline" panels (Expiring Soon,
   Monthly Dispense) to match the reference's dark-to-bright green sweep.
   Other panels keep the flat PanelHeader so the gradient reads as an
   intentional accent rather than a repeated pattern. */
function GradientPanelHeader({ children }: { children: React.ReactNode }) {
  const { t } = useTheme();
  return (
    <div style={{
      background: `linear-gradient(90deg, ${t.green} 0%, ${t.greenLight} 100%)`,
      padding: "13px 18px", display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <span style={{
        display: "flex", alignItems: "center", gap: 7, color: "#fff", fontSize: 12,
        fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", textAlign: "center",
      }}>
        {children}
      </span>
    </div>
  );
}

/* Compact auto-width pill — used for the Trend/Ranking toggle, which sits
   left-aligned rather than spanning the full row like the filter pills. */
function SmallPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  const { t } = useTheme();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 16px", borderRadius: 20, fontSize: 11.5, fontWeight: 700,
        border: `1.5px solid ${active ? t.green : t.cardBorder}`,
        background: active ? t.green : "#fff",
        color: active ? "#fff" : t.text2,
        cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s", whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function LegendChip({ color, label, count }: { color: string; label: string; count: number }) {
  const { t } = useTheme();
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700,
      color: t.text2, border: `1px solid ${t.cardBorder}`, borderRadius: 20, padding: "5px 10px",
    }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
      {label}
      <span style={{
        background: t.surface2, color: t.text3, borderRadius: 10, padding: "0 6px", fontSize: 10, fontWeight: 800,
      }}>{count}</span>
    </span>
  );
}

/* Stat tile — green gradient card matching the Analytics header cards
   (Total Medicine / LGU / PhilHealth / Department of Health): dark-to-
   bright green sweep, white label/value/sub text, large faint icon
   anchored bottom-right. `accent` is unused now (kept optional so call
   sites don't need to change) — the whole card carries the green, not
   just the icon badge. */
function StatTile({ label, value, sub, icon, accent, loading }: {
  label: string; value: React.ReactNode; sub: string; icon: React.ReactElement; accent?: string; loading?: boolean;
}) {
  const { t } = useTheme();
  return (
    <div style={{
      background: `linear-gradient(135deg, ${t.green} 0%, ${t.greenLight ?? t.green} 100%)`,
      borderRadius: 14, padding: "16px 18px", boxShadow: `0 6px 18px ${t.green}33`,
      display: "flex", flexDirection: "column", gap: 8, minHeight: 108,
      position: "relative", overflow: "hidden",
    }}>
      <span style={{
        fontSize: 10.5, fontWeight: 800, color: "rgba(255,255,255,0.85)",
        textTransform: "uppercase", letterSpacing: 0.6,
      }}>
        {label}
      </span>
      {loading ? (
        <div style={{ width: 50, height: 26, borderRadius: 6, background: "rgba(255,255,255,0.25)", animation: "pulse 1.3s ease-in-out infinite" }} />
      ) : (
        <div style={{ fontSize: 30, fontWeight: 900, color: "#fff", lineHeight: 1 }}>{value}</div>
      )}
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.8)" }}>{sub}</div>
      <span style={{
        position: "absolute", right: 12, bottom: 10, width: 34, height: 34,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "rgba(255,255,255,0.35)",
      }}>
        {icon}
      </span>
    </div>
  );
}


/* ── Monthly dispense trend — real area/line graph (recharts) ────────────
   Was a hand-rolled CSS bar chart; now a proper graph with gridlines, axis
   labels, and a hover tooltip showing the exact figure per month. The peak
   month still gets called out — a small badge above the chart plus a
   slightly larger highlighted dot on that point — same idea as before,
   just on a real chart instead of custom divs. */
function MonthlyTrendChart({ data }: { data: { label: string; value: number; isPeak: boolean }[] }) {
  const { t } = useTheme();
  const peak = data.find(d => d.isPeak);

  const PeakDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (payload.isPeak) {
      return (
        <g>
          <circle cx={cx} cy={cy} r={7} fill={t.green} fillOpacity={0.18} />
          <circle cx={cx} cy={cy} r={4.5} fill={t.green} stroke="#fff" strokeWidth={2} />
        </g>
      );
    }
    return <circle cx={cx} cy={cy} r={3} fill={t.green} fillOpacity={0.85} stroke="#fff" strokeWidth={1.5} />;
  };

  return (
    <div style={{ width: "100%" }}>
      {peak && (
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 4px 10px" }}>
          <span style={{
            display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 800, color: "#fff",
            background: t.green, borderRadius: 20, padding: "3px 10px", letterSpacing: 0.3,
          }}>
            <StarIcon /> PEAK · {peak.label} ({peak.value})
          </span>
        </div>
      )}
      <div style={{ width: "100%", height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 14, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="dashDispenseFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={t.green} stopOpacity={0.35} />
                <stop offset="95%" stopColor={t.green} stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 4" stroke={t.border} vertical={false} />
            <XAxis
              dataKey="label" tickLine={false} axisLine={{ stroke: t.border }}
              tick={{ fontSize: 10.5, fontWeight: 700, fill: t.text3 }}
            />
            <YAxis
              allowDecimals={false} tickLine={false} axisLine={false} width={34}
              tick={{ fontSize: 10, fill: t.text3 }}
            />
            <Tooltip
              cursor={{ stroke: t.green, strokeWidth: 1, strokeDasharray: "3 3" }}
              contentStyle={{
                borderRadius: 10, border: `1px solid ${t.border}`, fontSize: 12,
                fontFamily: "inherit", background: t.cardBg, boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
              }}
              labelStyle={{ fontWeight: 800, color: t.text, marginBottom: 2 }}
              formatter={(value: any) => [`${value} unit${value !== 1 ? "s" : ""}`, "Dispensed"]}
            />
            <Area
              type="monotone" dataKey="value" stroke={t.green} strokeWidth={2.5}
              fill="url(#dashDispenseFill)" dot={<PeakDot />} activeDot={{ r: 6, fill: t.green, stroke: "#fff", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* Ranking view for the Monthly Dispense panel's Trend/Ranking toggle —
   same underlying dispense data, just shown as a sorted list instead of
   a chart. Mirrors the Stock Levels row styling for visual consistency. */
function RankingList({ rows, maxQty }: { rows: { name: string; qty: number }[]; maxQty: number }) {
  const { t } = useTheme();
  if (rows.length === 0) {
    return <div style={{ textAlign: "center", color: t.text3, fontSize: 11.5, padding: "24px 0", fontStyle: "italic" }}>No dispense activity yet.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rows.map((r, i) => {
        const pct = Math.max(4, Math.round((r.qty / maxQty) * 100));
        return (
          <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              width: 18, height: 18, borderRadius: "50%", background: i === 0 ? t.green : t.surface2,
              color: i === 0 ? "#fff" : t.text3, fontSize: 10, fontWeight: 800,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>{i + 1}</span>
            <span style={{ fontSize: 12, color: t.text2, fontWeight: 600, width: 140, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.name}
            </span>
            <div style={{ flex: 1, height: 7, borderRadius: 6, background: t.surface2, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: t.green, borderRadius: 6 }} />
            </div>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: t.text, width: 44, textAlign: "right", flexShrink: 0 }}>
              {r.qty}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const SORT_OPTIONS: { key: StockSort; label: string }[] = [
  { key: "az", label: "A–Z" },
  { key: "most", label: "High Stock" },
  { key: "least", label: "Low Stock" },
];


/** Injects a scoped thin-scrollbar style once, so the Stock Levels list
 *  can hold every inventory item without needing a bulky default scrollbar.
 *  Also defines the stat-tile loading pulse animation used above. */
function useMiniScrollbar() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById("dash-mini-scroll-style")) return;
    const style = document.createElement("style");
    style.id = "dash-mini-scroll-style";
    style.textContent = `
      .dash-mini-scroll { scrollbar-width: thin; scrollbar-color: rgba(22,163,74,0.35) transparent; }
      .dash-mini-scroll::-webkit-scrollbar { width: 5px; }
      .dash-mini-scroll::-webkit-scrollbar-track { background: transparent; }
      .dash-mini-scroll::-webkit-scrollbar-thumb { background: rgba(22,163,74,0.35); border-radius: 10px; }
      .dash-mini-scroll::-webkit-scrollbar-thumb:hover { background: rgba(22,163,74,0.55); }
      @keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
      @keyframes dash-spin { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);
  }, []);
}

export default function Dashboard({ totalCount }: Props) {
  const { t } = useTheme();
  const { isMobile } = useBreakpoint();
  useMiniScrollbar();
  const [medicines, setMedicines] = useState<MedicineStockSummary[]>([]);
  const [allDispense, setAllDispense] = useState<DispenseEntry[]>([]);
  const [stockSort, setStockSort] = useState<StockSort>("az");

  // Expiring Soon window filter (30/60/90 days) — matches the reference's
  // pill row. Recomputing expiringMeds against this instead of a fixed
  // 30-day cutoff is the only behavior change; the underlying data and
  // "days left" math are unchanged.
  const [expiryWindow, setExpiryWindow] = useState<30 | 60 | 90>(30);

  // Monthly Dispense panel: granularity changes what the chart plots
  // (Day = current month by day, Month = existing 6-month trend), view
  // toggles between the chart and a ranked list — both read from the same
  // `allDispense` data already being fetched, no new data source.
  const [trendGranularity, setTrendGranularity] = useState<"day" | "month" | "year">("month");
  const [trendView, setTrendView] = useState<"trend" | "ranking">("trend");

  // BUG FIX: previously there was no loading state at all — while the two
  // fetches below were in flight, `medicines`/`allDispense` were still `[]`,
  // so every panel briefly rendered its EMPTY state ("No medicines yet",
  // "No dispense activity...", stat cards showing 0) before the real data
  // arrived. On a slower connection this reads as broken/wrong analytics
  // rather than "still loading". Both fetches now track their own loading
  // flag, and every panel below shows a skeleton/spinner until its own data
  // is actually in — never a false "empty" or "zero" state.
  const [loadingMeds, setLoadingMeds] = useState(true);
  const [loadingDispense, setLoadingDispense] = useState(true);

  const now = new Date();

  useEffect(() => {
    let cancelled = false;
    setLoadingMeds(true);
    fetchStockSummary()
      .then(rows => { if (!cancelled) setMedicines(rows); })
      .catch(() => { if (!cancelled) setMedicines([]); })
      .finally(() => { if (!cancelled) setLoadingMeds(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingDispense(true);
      try {
        const start = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();
        const { data, error } = await supabase
          .from("pharma_dispense_log")
          .select("medicine_id, quantity, dispensed_at, pharma_medicines(generic_name)")
          .gte("dispensed_at", start);
        if (!error && data && !cancelled) {
          setAllDispense((data as any[]).map(r => ({
            medicine_id: r.medicine_id, quantity: r.quantity, dispensed_at: r.dispensed_at,
            med_name: r.pharma_medicines?.generic_name ?? "Unknown",
          })));
        }
      } finally {
        if (!cancelled) setLoadingDispense(false);
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalDispensedToday = allDispense
    .filter(r => new Date(r.dispensed_at).toDateString() === now.toDateString())
    .reduce((s, r) => s + r.quantity, 0);

  const expiringMeds = medicines
    .map(m => {
      if (!m.nearest_expiry) return null;
      const exp = new Date(m.nearest_expiry); exp.setHours(0, 0, 0, 0);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const days = Math.ceil((exp.getTime() - today.getTime()) / 86400000);
      return { med: m, daysLeft: days };
    })
    .filter((x): x is { med: MedicineStockSummary; daysLeft: number } => x !== null && x.daysLeft <= expiryWindow)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const drugsCount = medicines.filter(m => m.category === "drugs").length;
  const suppliesCount = medicines.filter(m => m.category === "supplies").length;
  const lowStockCount = medicines.filter(m => m.total_quantity > 0 && m.total_quantity <= 10).length;
  const outOfStockCount = medicines.filter(m => m.total_quantity === 0).length;
  const highStockCount = medicines.filter(m => m.total_quantity > 10).length;
  const maxQty = Math.max(1, ...medicines.map(m => m.total_quantity));

  const sortedStock = useMemo(() => {
    const list = [...medicines];
    if (stockSort === "az") list.sort((a, b) => a.generic_name.localeCompare(b.generic_name));
    else if (stockSort === "most") list.sort((a, b) => b.total_quantity - a.total_quantity);
    else list.sort((a, b) => a.total_quantity - b.total_quantity);
    return list;
  }, [medicines, stockSort]);

  const monthlyTrend = (() => {
    const months: { label: string; value: number; monthKey: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ label: d.toLocaleDateString("en-PH", { month: "short" }), value: 0, monthKey: `${d.getFullYear()}-${d.getMonth()}` });
    }
    for (const entry of allDispense) {
      const d = new Date(entry.dispensed_at);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const m = months.find(mo => mo.monthKey === key);
      if (m) m.value += entry.quantity;
    }
    const maxVal = Math.max(0, ...months.map(m => m.value));
    return months.map(({ label, value }) => ({ label, value, isPeak: value === maxVal && maxVal > 0 }));
  })();

  // Dispense entries for the current calendar month — the basis for the
  // "Day" chart, the Ranking list, the total-this-month figure, and the
  // top-medicine callout. All derived from the same allDispense fetch.
  const currentMonthDispense = allDispense.filter(e => {
    const d = new Date(e.dispensed_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });

  const dailyTrend = (() => {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => ({ label: String(i + 1), value: 0 }));
    for (const entry of currentMonthDispense) {
      const dayIdx = new Date(entry.dispensed_at).getDate() - 1;
      if (days[dayIdx]) days[dayIdx].value += entry.quantity;
    }
    const maxVal = Math.max(0, ...days.map(d => d.value));
    return days.map(d => ({ ...d, isPeak: d.value === maxVal && maxVal > 0 }));
  })();

  const chartData = trendGranularity === "day" ? dailyTrend : monthlyTrend;

  const totalThisMonth = currentMonthDispense.reduce((s, e) => s + e.quantity, 0);

  const topMedicineThisMonth = (() => {
    const totals = new Map<string, number>();
    for (const e of currentMonthDispense) {
      totals.set(e.med_name, (totals.get(e.med_name) ?? 0) + e.quantity);
    }
    let best: { name: string; qty: number } | null = null;
    for (const [name, qty] of totals) {
      if (!best || qty > best.qty) best = { name, qty };
    }
    return best;
  })();

  const rankingRows = (() => {
    const totals = new Map<string, number>();
    for (const e of currentMonthDispense) {
      totals.set(e.med_name, (totals.get(e.med_name) ?? 0) + e.quantity);
    }
    return Array.from(totals, ([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 6);
  })();
  const rankingMax = Math.max(1, ...rankingRows.map(r => r.qty));

  const medicinesTrackedCount = new Set(currentMonthDispense.map(e => e.medicine_id)).size;

  const cardStyle: CSSProperties = {
    background: t.cardBg, borderRadius: 14, border: `1px solid ${t.cardBorder}`,
    overflow: "hidden", boxShadow: "0 1px 8px rgba(0,0,0,0.05)", display: "flex", flexDirection: "column",
  };
  const emptyMsg: CSSProperties = { textAlign: "center", color: t.text3, fontSize: 11.5, padding: "24px 0", fontStyle: "italic" };
  const expiryColor = (d: number) => (d <= 7 ? "#dc2626" : d <= 14 ? "#ea580c" : "#d97706");
  const expiryLabel = (d: number) => (d < 0 ? `Expired ${Math.abs(d)}d ago` : d === 0 ? "Today" : `${d}d`);
  const stockStatus = (qty: number): { label: string; color: string } => {
    if (qty === 0) return { label: "Out of Stock", color: "#dc2626" };
    if (qty <= 10) return { label: "Low Stock", color: "#d97706" };
    return { label: "High Stock", color: t.green };
  };

  const Spinner = ({ size = 22 }: { size?: number }) => (
    <div style={{
      width: size, height: size, border: `3px solid ${t.green}`, borderTopColor: "transparent",
      borderRadius: "50%", animation: "dash-spin 0.8s linear infinite",
    }} />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 14 : 16 }}>

      <div>
        <div style={{ fontSize: 10.5, color: t.text3, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 3 }}>Pharmacist</div>
        <div style={{ fontSize: isMobile ? 22 : 30, fontWeight: 900, color: t.text, lineHeight: 1 }}>DASHBOARD</div>
      </div>

      {/* Stat tiles — Dispensed Today, Total Items, Drugs, Supplies. Green
          gradient cards to match the Analytics header cards; each shows
          its own skeleton until its underlying fetch resolves, instead of
          a misleading "0". */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", gap: isMobile ? 10 : 14 }}>
        <StatTile label="Dispensed Today" value={totalDispensedToday} sub="units out today" icon={<CalendarIcon size={22} color="#fff" />} loading={loadingDispense} />
        <StatTile label="Total Items" value={medicines.length} sub={`${lowStockCount} low stock`} icon={<BoxIcon size={24} color="#fff" />} loading={loadingMeds} />
        <StatTile label="Drugs" value={drugsCount} sub="medicine drugs" icon={<DrugIcon size={24} color="#fff" />} loading={loadingMeds} />
        <StatTile label="Supplies" value={suppliesCount} sub="medicine supplies" icon={<SupplyIcon size={24} color="#fff" />} loading={loadingMeds} />
      </div>

      {/* Expiring Soon + Monthly Dispense Trend */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 10 : 14 }}>

        <div style={cardStyle}>
          <GradientPanelHeader>
            Expiring Soon {!loadingMeds && `(${expiringMeds.length})`}
          </GradientPanelHeader>
          <div style={{ padding: 16 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              {([30, 60, 90] as const).map(w => (
                <Pill key={w} active={expiryWindow === w} onClick={() => setExpiryWindow(w)}>
                  {w}d
                </Pill>
              ))}
            </div>
            <div style={{ maxHeight: 280, overflowY: "auto" }}>
              {loadingMeds ? (
                <div style={{ display: "flex", justifyContent: "center", padding: "36px 0" }}><Spinner /></div>
              ) : expiringMeds.length === 0 ? (
                <div style={emptyMsg}>No medicines expiring within {expiryWindow} days</div>
              ) : expiringMeds.map(({ med, daysLeft }) => {
                const color = expiryColor(daysLeft);
                return (
                  <div key={med.medicine_id} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 4px",
                    borderBottom: `1px solid ${t.border}`,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: t.text }}>{med.generic_name}</div>
                      <div style={{ fontSize: 10.5, color: t.text3, marginTop: 1 }}>
                        {med.dosage_strength} · Batch {med.nearest_expiry ? new Date(med.nearest_expiry).toLocaleDateString("en-PH", { month: "short", day: "numeric" }) : ""}
                      </div>
                    </div>
                    <span style={{ fontSize: 10.5, fontWeight: 800, color, background: `${color}18`, borderRadius: 14, padding: "2px 9px" }}>
                      {expiryLabel(daysLeft)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <GradientPanelHeader>Dispensed Medicine</GradientPanelHeader>
          <div style={{ padding: "16px 16px 6px" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <Pill active={trendGranularity === "day"} onClick={() => setTrendGranularity("day")}>Day</Pill>
              <Pill active={trendGranularity === "month"} onClick={() => setTrendGranularity("month")}>Month</Pill>
              <Pill active={trendGranularity === "year"} onClick={() => setTrendGranularity("year")}>Year</Pill>
            </div>

            {loadingDispense ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "36px 0" }}><Spinner /></div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: t.text3, textTransform: "uppercase", letterSpacing: 0.6 }}>
                      Total This Month
                    </div>
                    <div style={{ fontSize: 30, fontWeight: 900, color: t.text, lineHeight: 1.1, marginTop: 3 }}>
                      {totalThisMonth}
                    </div>
                    <div style={{ fontSize: 11, color: t.text3 }}>units dispensed</div>
                  </div>
                  {topMedicineThisMonth && (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: t.text3, textTransform: "uppercase", letterSpacing: 0.6 }}>
                        Top Medicine
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: t.text, marginTop: 3 }}>
                        {topMedicineThisMonth.name}
                      </div>
                      <div style={{ fontSize: 11, color: t.green, fontWeight: 700 }}>{topMedicineThisMonth.qty} units</div>
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <SmallPill active={trendView === "trend"} onClick={() => setTrendView("trend")}>Trend</SmallPill>
                  <SmallPill active={trendView === "ranking"} onClick={() => setTrendView("ranking")}>Ranking</SmallPill>
                </div>
              </>
            )}
          </div>

          <div style={{ padding: "0 16px 16px", flex: 1, display: "flex", flexDirection: "column" }}>
            {loadingDispense ? null : trendGranularity === "year" ? (
              <div style={emptyMsg}>Insufficient data for a yearly view — additional historical data is required.</div>
            ) : trendView === "ranking" ? (
              <RankingList rows={rankingRows} maxQty={rankingMax} />
            ) : chartData.every(d => d.value === 0) ? (
              <div style={emptyMsg}>No dispense activity for this period.</div>
            ) : (
              <MonthlyTrendChart data={chartData} />
            )}

            {!loadingDispense && trendGranularity !== "year" && (
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${t.border}` }}>
                <span style={{ fontSize: 10.5, color: t.text3 }}>
                  {now.toLocaleDateString("en-PH", { month: "long", year: "numeric" })}
                </span>
                <span style={{ fontSize: 10.5, color: t.green, fontWeight: 700 }}>
                  {medicinesTrackedCount} medicine{medicinesTrackedCount !== 1 ? "s" : ""} tracked
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stock Levels — now sortable, pill filters below the header like
          the reference's 30d/60d/90d row, plus a status legend row. */}
      <div style={cardStyle}>
        <PanelHeader>
          Stock Levels {!loadingMeds && `(${medicines.length})`}
        </PanelHeader>
        <div style={{ padding: 16 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {SORT_OPTIONS.map(opt => (
              <Pill key={opt.key} active={stockSort === opt.key} onClick={() => setStockSort(opt.key)}>
                {opt.label}
              </Pill>
            ))}
          </div>

          {!loadingMeds && medicines.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              <LegendChip color={t.green} label="Highest" count={highStockCount} />
              <LegendChip color="#d97706" label="Low" count={lowStockCount} />
              <LegendChip color="#dc2626" label="Out" count={outOfStockCount} />
            </div>
          )}

          {loadingMeds ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}><Spinner /></div>
          ) : sortedStock.length === 0 ? (
            <div style={emptyMsg}>No medicines recorded in inventory yet.</div>
          ) : (
            <div className="dash-mini-scroll" style={{ maxHeight: 360, overflowY: "auto", paddingRight: 6, display: "flex", flexDirection: "column", gap: 12 }}>
              {sortedStock.map(m => {
                const pct = Math.max(4, Math.round((m.total_quantity / maxQty) * 100));
                const status = stockStatus(m.total_quantity);
                return (
                  <div key={m.medicine_id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: status.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: t.text2, fontWeight: 600, width: 140, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.generic_name}
                    </span>
                    <div style={{ flex: 1, height: 7, borderRadius: 6, background: t.surface2, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: status.color, borderRadius: 6 }} />
                    </div>
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: t.text, width: 44, textAlign: "right", flexShrink: 0 }}>
                      {m.total_quantity}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}