// Dashboard.tsx — fixes: monthly trend chart no longer looks broken for
// zero-value months (distinct empty-state placeholder instead of a
// near-invisible sliver), peak month uses a green accent instead of red,
// the summary sentence under the chart is gone, stat cards are reordered
// to Dispensed Today / Drugs / Supplies, and Stock Levels now has A-Z /
// Most Stock / Least Stock sorting.
"use client";
import { CSSProperties, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useTheme, MedicineStockSummary } from "../lib/pharmacy";
import { fetchStockSummary } from "../lib/pharmacyData";

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

function StatCard({ label, value, sub, icon }: { label: string; value: React.ReactNode; sub: string; icon: React.ReactElement }) {
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
        <div style={{ fontSize: 38, fontWeight: 900, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 11, opacity: 0.7, marginTop: 5 }}>{sub}</div>
      </div>
    </div>
  );
}

/* ── Monthly dispense trend ──────────────────────────────────────────────
   FIX: months with 0 dispensed used to render as a ~4px green sliver sitting
   on the baseline, which reads as "broken chart" rather than "no data".
   Zero-value months now get an explicit dashed placeholder bar instead, so
   it's visually clear those months simply had no activity. The peak month
   is now called out in green (a filled bar + small star badge) instead of
   red — red is reserved for actual danger states elsewhere in the app. ── */
function MonthlyTrendChart({ data }: { data: { label: string; value: number; isPeak: boolean }[] }) {
  const { t } = useTheme();
  const max = Math.max(1, ...data.map(d => d.value));
  const gridLines = [0.25, 0.5, 0.75, 1];

  return (
    <div style={{ width: "100%", padding: "4px 8px 0" }}>
      <div style={{ position: "relative", height: 150 }}>
        {/* Subtle horizontal gridlines for reference */}
        {gridLines.map(g => (
          <div key={g} style={{
            position: "absolute", left: 0, right: 0, bottom: `${g * 100}%`,
            borderTop: `1px dashed ${t.border}`, opacity: g === 1 ? 0 : 0.7,
          }} />
        ))}

        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", gap: 14 }}>
          {data.map((d, i) => {
            const hasData = d.value > 0;
            const pct = hasData ? Math.max(6, Math.round((d.value / max) * 100)) : 0;
            return (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end" }}>
                {d.isPeak && (
                  <span style={{
                    display: "flex", alignItems: "center", gap: 3, fontSize: 8.5, fontWeight: 900, color: "#fff",
                    background: t.green, borderRadius: 20, padding: "2px 8px", letterSpacing: 0.3,
                  }}>
                    <StarIcon /> PEAK
                  </span>
                )}
                <span style={{ fontSize: 11, fontWeight: 800, color: hasData ? t.text : "transparent" }}>{hasData ? d.value : "0"}</span>
                {hasData ? (
                  <div style={{
                    width: "100%", maxWidth: 32, height: `${pct}%`, borderRadius: "8px 8px 2px 2px",
                    background: d.isPeak
                      ? `linear-gradient(180deg, ${t.green} 0%, ${t.greenLight} 100%)`
                      : `linear-gradient(180deg, ${t.greenLight} 0%, ${t.surface2} 100%)`,
                    border: d.isPeak ? "none" : `1.5px solid ${t.green}55`,
                    minHeight: 10, transition: "height 0.3s ease",
                  }} />
                ) : (
                  <div style={{
                    width: "100%", maxWidth: 32, height: 10, borderRadius: 4,
                    border: `1.5px dashed ${t.border}`, background: "transparent",
                  }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Baseline + month labels */}
      <div style={{ borderTop: `1.5px solid ${t.border}`, marginTop: 2 }} />
      <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 10.5, color: t.text3, fontWeight: 700 }}>{d.label}</div>
        ))}
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
 *  can hold every inventory item without needing a bulky default scrollbar. */
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

  const now = new Date();

  useEffect(() => { fetchStockSummary().then(setMedicines).catch(() => setMedicines([])); }, []);

  useEffect(() => {
    async function load() {
      const start = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();
      const { data, error } = await supabase
        .from("pharma_dispense_log")
        .select("medicine_id, quantity, dispensed_at, pharma_medicines(generic_name)")
        .gte("dispensed_at", start);
      if (!error && data) {
        setAllDispense((data as any[]).map(r => ({
          medicine_id: r.medicine_id, quantity: r.quantity, dispensed_at: r.dispensed_at,
          med_name: r.pharma_medicines?.generic_name ?? "Unknown",
        })));
      }
    }
    load();
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 14 : 16 }}>

      <div>
        <div style={{ fontSize: 10.5, color: t.text3, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 3 }}>Pharmacist</div>
        <div style={{ fontSize: isMobile ? 22 : 30, fontWeight: 900, color: t.text, lineHeight: 1 }}>DASHBOARD</div>
      </div>

      {/* Stat cards — reordered: Dispensed Today, Drugs, Supplies */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3,1fr)", gap: isMobile ? 10 : 14 }}>
        <StatCard label="Dispensed Today" value={totalDispensedToday} sub="units out today" icon={<CalendarIcon color="#fff" />} />
        <StatCard label="Drugs" value={drugsCount} sub="medicine drugs" icon={<DrugIcon size={30} />} />
        <StatCard label="Supplies" value={suppliesCount} sub="medicine supplies" icon={<SupplyIcon size={30} />} />
      </div>

      {/* Expiring Soon + Monthly Dispense Trend */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 10 : 14 }}>

        <div style={cardStyle}>
          <div style={panelHead()}>
            <CalendarIcon color="#fff" /> Expiring Soon
            <span style={{ marginLeft: "auto", background: "rgba(255,255,255,0.25)", borderRadius: 12, padding: "1px 8px", fontSize: 10 }}>
              {expiringMeds.length}
            </span>
          </div>
          <div style={{ padding: 14, maxHeight: 320, overflowY: "auto" }}>
            {expiringMeds.length === 0 ? (
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
            {monthlyTrend.every(m => m.value === 0) ? (
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
            <span style={{ background: "rgba(255,255,255,0.25)", borderRadius: 12, padding: "1px 8px", fontSize: 10 }}>{medicines.length} items</span>
          </div>
        </div>
        <div style={{ padding: 16 }}>
          {sortedStock.length === 0 ? (
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