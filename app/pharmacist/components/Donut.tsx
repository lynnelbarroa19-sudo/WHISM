"use client";
import { useTheme } from "../../../lib/theme";

type Props = {
  segments: { v: number; c: string }[];
  size: number;
  thick: number;
  label?: string;
};

// Perceptually distinct palette — works for both stock levels and dispense charts
const DISTINCT_COLORS = [
  "#16a34a", // green
  "#2563eb", // blue
  "#d97706", // amber
  "#dc2626", // red
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#c2410c", // orange
  "#4d7c0f", // olive green
];

export default function Donut({ segments, size, thick, label }: Props) {
  const { t } = useTheme();
  const r     = (size - thick) / 2;
  const cx    = size / 2;
  const cy    = size / 2;
  const circ  = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + s.v, 0);

  // Re-map segment colors to the distinct palette so adjacent slices never clash
  const remapped = segments.map((seg, i) => ({
    ...seg,
    c: DISTINCT_COLORS[i % DISTINCT_COLORS.length],
  }));

  let offset = 0;
  const GAP_DEG = segments.length > 1 ? 2 : 0; // 2° gap between slices
  const GAP_ARC = (GAP_DEG / 360) * circ;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block", transform: "rotate(-90deg)", flexShrink: 0 }}
    >
      {remapped.map((seg, i) => {
        const raw  = (seg.v / total) * circ;
        const dash = Math.max(0, raw - GAP_ARC);
        const el   = (
          <circle
            key={i}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={seg.c}
            strokeWidth={thick}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ - dash}`}
            strokeDashoffset={-offset}
          />
        );
        offset += raw;
        return el;
      })}
      {label && (
        <text
          x={cx} y={cy}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{
            transform: `rotate(90deg)`,
            transformOrigin: `${cx}px ${cy}px`,
            fontSize: Math.max(10, size * 0.14),
            fill: t.text,
            fontFamily: "Nunito, sans-serif",
            fontWeight: 800,
          }}
        >
          {label}
        </text>
      )}
    </svg>
  );
}