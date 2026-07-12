"use client";
import { useTheme } from "@/lib/theme";

export default function MiniCalendar() {
  const { t } = useTheme();
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const firstDow = new Date(y, m, 1).getDay();
  const dim = new Date(y, m + 1, 0).getDate();
  const blanks = Array.from({ length: firstDow });
  const days = Array.from({ length: dim }, (_, i) => i + 1);
  const dow = ["S", "M", "T", "W", "TH", "F", "S"];

  return (
    <div style={{
      margin: "0 8px 10px", background: t.calBg,
      border: `1px solid ${t.border}`, borderRadius: 10, padding: "8px 8px 6px",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "center", fontSize: 9, marginBottom: 6,
      }}>
        <span style={{ fontWeight: 800, color: t.green }}>
          MONTH {String(m + 1).padStart(2, "0")}
        </span>
        <span style={{ color: t.text3 }}>{String(d).padStart(2, "0")} Day</span>
        <span style={{ color: t.text3 }}>00:00 AM ▶</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
        {dow.map((n, i) => (
          <div key={i} style={{
            textAlign: "center", fontSize: 8,
            fontWeight: 700, color: t.text3, paddingBottom: 2,
          }}>{n}</div>
        ))}
        {blanks.map((_, i) => <div key={`b${i}`} />)}
        {days.map(n => (
          <div key={n} style={{
            textAlign: "center", fontSize: 9, padding: "2px 0",
            borderRadius: "50%", cursor: "pointer",
            background: n === d ? t.green : "transparent",
            color: n === d ? "#fff" : t.calText,
            fontWeight: n === d ? 800 : 400,
          }}>{n}</div>
        ))}
      </div>
    </div>
  );
}