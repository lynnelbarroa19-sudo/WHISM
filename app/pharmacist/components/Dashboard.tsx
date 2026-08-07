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

const DrugIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="9" width="20" height="6" rx="3" /><line x1="12" y1="9" x2="12" y2="15" />
  </svg>
);
const SupplyIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2c0 1.1.9 2 2 2h5v5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2h-2z" />
  </svg>
);
const CalendarIcon = ({ color = "currentColor" }: { color?: string }) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);
const TrendIcon = ({ color = "#fff" }: { color?: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
  </svg>
);
const StarIcon = ({ color = "#fff" }: { color?: string }) => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill={color} stroke="none">
    <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9" />
  </svg>
);
const BoxIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 8L12 3 3 8v8l9 5 9-5V8z" /><path d="M3 8l9 5 9-5" /><line x1="12" y1="13" x2="12" y2="21" />
  </svg>
);

function StatCard({ label, value, sub, icon, loading }: {
  label: string; value: React.ReactNode; sub: string; icon: React.ReactElement; loading?: boolean;
}) {
  const { t } = useTheme();
  return (
    <div style={{
      background: `linear-gradient(135deg, ${t.green} 0%, ${t.greenLight} 100%)`,
      borderRadius: 16, padding: "18px 20px", color: "#fff",
      display: "flex", flexDirection: "column", justifyContent: "space-between",
      minHeight: 130, boxShadow: `0 6px 20px ${t.green}55`,
      position: "relative", overflow: "hidden",
    }}>
      <span style={{
        position: "absolute", right: -6, bottom: -8, width: 68, height: 68, borderRadius: 14,
        background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center",
        color: "rgba(255,255,255,0.55)", pointerEvents: "none",
      }}>
        {icon}
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.9, position: "relative", zIndex: 1 }}>{label}</span>
      <div style={{ position: "relative", zIndex: 1 }}>
        {loading ? (
          <div style={{ width: 54, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.25)", animation: "pulse 1.3s ease-in-out infinite" }} />
        ) : (
          <div style={{ fontSize: 38, fontWeight: 900, lineHeight: 1 }}>{value}</div>
        )}
        <div style={{ fontSize: 11, opacity: 0.7, marginTop: 5 }}>{sub}</div>
      </div>
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
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 8px 6px" }}>
          <span style={{
            display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 800, color: "#fff",
            background: t.green, borderRadius: 20, padding: "3px 10px", letterSpacing: 0.3,
          }}>
            <StarIcon /> PEAK · {peak.label} ({peak.value})
          </span>
        </div>
      )}
      <div style={{ width: "100%", height: 190 }}>
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

const SORT_OPTIONS: { key: StockSort; label: string }[] = [
  { key: "az", label: "A–Z" },
  { key: "most", label: "High Stock" },
  { key: "least", label: "Low Stock" },
];

/** Injects a scoped thin-scrollbar style once, so the Stock Levels list
 *  can hold every inventory item without needing a bulky default scrollbar.
 *  Also defines the stat-card loading pulse animation used above. */
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
    .filter((x): x is { med: MedicineStockSummary; daysLeft: number } => x !== null && x.daysLeft <= 30)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const drugsCount = medicines.filter(m => m.category === "drugs").length;
  const suppliesCount = medicines.filter(m => m.category === "supplies").length;
  const lowStockCount = medicines.filter(m => m.total_quantity > 0 && m.total_quantity <= 10).length;
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

  const cardStyle: CSSProperties = {
    background: t.cardBg, borderRadius: 16, border: `1px solid ${t.cardBorder}`,
    overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", display: "flex", flexDirection: "column",
  };
  const panelHead = (): CSSProperties => ({
    background: t.green, padding: "10px 16px", color: "#fff", fontSize: 11.5, fontWeight: 800,
    letterSpacing: 0.4, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 8,
  });
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

      {/* Stat cards — Dispensed Today, Total Items, Drugs, Supplies. Each
          card shows its own skeleton until its underlying fetch resolves,
          instead of a misleading "0". */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", gap: isMobile ? 10 : 14 }}>
        <StatCard label="Dispensed Today" value={totalDispensedToday} sub="units out today" icon={<CalendarIcon color="#fff" />} loading={loadingDispense} />
        <StatCard label="Total Items" value={medicines.length} sub={`${lowStockCount} low stock`} icon={<BoxIcon size={30} />} loading={loadingMeds} />
        <StatCard label="Drugs" value={drugsCount} sub="medicine drugs" icon={<DrugIcon size={30} />} loading={loadingMeds} />
        <StatCard label="Supplies" value={suppliesCount} sub="medicine supplies" icon={<SupplyIcon size={30} />} loading={loadingMeds} />
      </div>

      {/* Expiring Soon + Monthly Dispense Trend */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 10 : 14 }}>

        <div style={cardStyle}>
          <div style={panelHead()}>
            <CalendarIcon color="#fff" /> Expiring Soon
            <span style={{ marginLeft: "auto", background: "rgba(255,255,255,0.25)", borderRadius: 12, padding: "1px 8px", fontSize: 10 }}>
              {loadingMeds ? "…" : expiringMeds.length}
            </span>
          </div>
          <div style={{ padding: 14, maxHeight: 320, overflowY: "auto" }}>
            {loadingMeds ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "36px 0" }}><Spinner /></div>
            ) : expiringMeds.length === 0 ? (
              <div style={emptyMsg}>No medicines expiring soon</div>
            ) : expiringMeds.map(({ med, daysLeft }) => {
              const color = expiryColor(daysLeft);
              return (
                <div key={med.medicine_id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "9px 4px",
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

        <div style={cardStyle}>
          <div style={{ ...panelHead(), justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}><TrendIcon /> Monthly Dispense Trend</span>
          </div>
          <div style={{ padding: "18px 14px", flex: 1, display: "flex", alignItems: "center" }}>
            {loadingDispense ? (
              <div style={{ display: "flex", justifyContent: "center", width: "100%", padding: "36px 0" }}><Spinner /></div>
            ) : monthlyTrend.every(m => m.value === 0) ? (
              <div style={{ ...emptyMsg, width: "100%" }}>No dispense activity in the last 6 months.</div>
            ) : (
              <MonthlyTrendChart data={monthlyTrend} />
            )}
          </div>
        </div>
      </div>

      {/* Stock Levels — now sortable */}
      <div style={cardStyle}>
        <div style={{ ...panelHead(), justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span>Stock Levels</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", gap: 3, background: "rgba(255,255,255,0.15)", borderRadius: 20, padding: 3 }}>
              {SORT_OPTIONS.map(opt => (
                <button key={opt.key} onClick={() => setStockSort(opt.key)} style={{
                  padding: "4px 11px", borderRadius: 16, fontSize: 10, fontWeight: 800, border: "none",
                  cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                  background: stockSort === opt.key ? "#fff" : "transparent",
                  color: stockSort === opt.key ? t.green : "#fff",
                }}>{opt.label}</button>
              ))}
            </div>
            <span style={{ background: "rgba(255,255,255,0.25)", borderRadius: 12, padding: "1px 8px", fontSize: 10 }}>
              {loadingMeds ? "…" : `${medicines.length} items`}
            </span>
          </div>
        </div>
        <div style={{ padding: 16 }}>
          {loadingMeds ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}><Spinner /></div>
          ) : sortedStock.length === 0 ? (
            <div style={emptyMsg}>No medicines yet</div>
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
                    <div style={{ flex: 1, height: 8, borderRadius: 6, background: t.surface2, overflow: "hidden" }}>
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