"use client";
import { CSSProperties, useEffect, useState } from "react";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/lib/supabase";

type Prescription = {
  id: string;
  patient_name: string;
  medicine: string;
  dosage: string | null;
  frequency: string | null;
  quantity: string | null;
  prescription_date: string;
  status: "draft" | "sent" | "dispensed" | "cancelled";
};

type PatientGroup = {
  patient_name: string;
  prescriptions: Prescription[];
};

type Filter = "all" | "sent" | "dispensed" | "cancelled";

export default function PrescriptionsPage() {
  const { t } = useTheme();
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [loading, setLoading]             = useState(true);
  const [selected, setSelected]           = useState<Prescription | null>(null);
  const [filter, setFilter]               = useState<Filter>("all");
  const [updating, setUpdating]           = useState(false);
  const [toast, setToast]                 = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [expanded, setExpanded]           = useState<Set<string>>(new Set());

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchPrescriptions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("prescriptions")
        .select(`
          id,
          prescription_date,
          medicine,
          quantity,
          dosage,
          frequency,
          notes,
          status,
          patients ( first_name, last_name )
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const mapped: Prescription[] = (data ?? []).map((row: any) => {
        const p = row.patients;
        const fullName = p
          ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim()
          : "Unknown";
        return {
          id:                row.id,
          patient_name:      fullName || "Unknown",
          medicine:          row.medicine,
          dosage:            row.dosage,
          frequency:         row.frequency,
          quantity:          row.quantity,
          prescription_date: row.prescription_date,
          status:            row.status,
        };
      });

      setPrescriptions(mapped);
      setExpanded(new Set());
    } catch (err: any) {
      showToast(err.message || "Failed to load prescriptions.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPrescriptions(); }, []);

  const updateStatus = async (id: string, status: "dispensed" | "cancelled") => {
    setUpdating(true);
    try {
      const { error } = await supabase
        .from("prescriptions")
        .update({ status })
        .eq("id", id);

      if (error) throw error;

      showToast(
        status === "dispensed" ? "Prescription marked as dispensed." : "Prescription cancelled.",
        "success"
      );
      setSelected(null);
      await fetchPrescriptions();
    } catch (err: any) {
      showToast(err.message || "Failed to update prescription.", "error");
    } finally {
      setUpdating(false);
    }
  };

  const filtered = prescriptions.filter(p =>
    filter === "all" || p.status === filter
  );

  const groups: PatientGroup[] = [];
  const seen: Record<string, PatientGroup> = {};
  for (const rx of filtered) {
    if (!seen[rx.patient_name]) {
      const g = { patient_name: rx.patient_name, prescriptions: [] };
      seen[rx.patient_name] = g;
      groups.push(g);
    }
    seen[rx.patient_name].prescriptions.push(rx);
  }

  const toggleGroup = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const statusBadge = (status: Prescription["status"]) => {
    const map: Record<string, { bg: string; color: string; label: string }> = {
      draft:     { bg: "#f0f0f0", color: "#888",    label: "Draft" },
      sent:      { bg: "#fff8e1", color: "#b8860b", label: "Sent" },
      dispensed: { bg: "#e8f5e9", color: "#2e7d32", label: "Dispensed" },
      cancelled: { bg: "#fdecea", color: "#c62828", label: "Cancelled" },
    };
    const s = map[status] ?? map.draft;
    return (
      <span style={{
        background: s.bg, color: s.color, borderRadius: 20,
        padding: "2px 10px", fontSize: 11, fontWeight: 700,
      }}>
        {s.label}
      </span>
    );
  };

  const avatar = (name: string) => {
    const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
    const colors = ["#1b5e20","#0d47a1","#4a148c","#bf360c","#006064","#37474f"];
    const idx = name.charCodeAt(0) % colors.length;
    return (
      <div style={{
        width: 32, height: 32, borderRadius: "50%",
        background: colors[idx], color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, fontWeight: 800, flexShrink: 0,
      }}>
        {initials}
      </div>
    );
  };

  const thStyle: CSSProperties = {
    padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 800,
    color: t.tableHead, textTransform: "uppercase", letterSpacing: "0.04em",
    borderBottom: `1px solid ${t.tableRowBorder}`, background: t.tableRow,
  };

  const tdStyle: CSSProperties = {
    padding: "10px 14px",
    borderBottom: `1px solid ${t.tableRowBorder}`,
    color: t.text2,
    background: t.tableRow,
    fontSize: 12.5,
  };

  const handlePrint = (rx: Prescription) => {
    const w = window.open("", "_blank");
    if (!w) return;
    const dateStr = new Date(rx.prescription_date).toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    });
    w.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Prescription — ${rx.patient_name}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 10pt; background: #fff; display: flex; justify-content: center; }
    .slip { width: 4.25in; min-height: 5.5in; padding: 0.22in 0.28in; display: flex; flex-direction: column; }
    .header { display: flex; align-items: center; justify-content: center; gap: 0; margin-bottom: 8px; }
    .header img { width: 56px; height: 56px; object-fit: contain; flex-shrink: 0; }
    .header-text { text-align: center; flex: 1; padding: 0 10px; line-height: 1.5; }
    .header-text .republic { font-size: 8pt; }
    .header-text .doh { font-size: 11pt; font-weight: 900; text-transform: uppercase; }
    .header-text .rhu { font-size: 10pt; font-weight: 900; text-transform: uppercase; }
    .header-text .city { font-size: 8.5pt; }
    .fields { font-size: 9pt; margin-bottom: 6px; }
    .field-row { display: flex; align-items: flex-end; margin-bottom: 4px; }
    .field-label { font-weight: 700; white-space: nowrap; margin-right: 4px; }
    .field-line { border-bottom: 1px solid #000; flex: 1; min-width: 60px; height: 16px; padding-left: 3px; font-size: 9pt; }
    .divider { border-top: 1px solid #000; margin: 6px 0 8px; }
    .rx-symbol { font-family: 'Times New Roman', serif; font-weight: bold; font-size: 30pt; line-height: 1; margin-bottom: 10px; }
    .rx-symbol sub { font-size: 17pt; }
    .medicine { flex: 1; padding-left: 4px; font-size: 10pt; }
    .medicine .med-name { font-size: 11pt; font-weight: bold; margin-bottom: 5px; }
    .medicine .med-row { margin-bottom: 3px; }
    .footer { margin-top: auto; padding-top: 14px; text-align: center; }
    .sig-line { border-top: 1px solid #000; width: 60%; margin: 0 auto 4px; }
    .sig-name { font-weight: bold; text-transform: uppercase; font-size: 9pt; letter-spacing: 0.02em; }
    .sig-sub { font-size: 8pt; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
<div class="slip">
  <div class="header">
    <img src="/logo.jpg" alt="seal" onerror="this.style.display='none'"/>
    <div class="header-text">
      <div class="republic">Republic of the Philippines</div>
      <div class="doh">Department of Health</div>
      <div class="rhu">Rural Health Unit</div>
      <div class="city">Lopez, Quezon</div>
    </div>
    <img src="/logo.jpg" alt="seal" onerror="this.style.display='none'"/>
  </div>
  <div class="fields">
    <div class="field-row">
      <span class="field-label">Name:</span>
      <span class="field-line" style="flex:2.2;margin-right:16px;">${rx.patient_name}</span>
      <span class="field-label">Date:</span>
      <span class="field-line" style="flex:1;">${dateStr}</span>
    </div>
    <div class="field-row">
      <span class="field-label">Age:</span>
      <span class="field-line" style="flex:0.7;margin-right:14px;"></span>
      <span class="field-label">Gender:</span>
      <span class="field-line" style="flex:0.9;margin-right:14px;"></span>
      <span class="field-label">Civil Status:</span>
      <span class="field-line" style="flex:1.2;"></span>
    </div>
    <div class="field-row">
      <span class="field-label">Address:</span>
      <span class="field-line"></span>
    </div>
  </div>
  <div class="divider"></div>
  <div class="rx-symbol">R<sub>x</sub></div>
  <div class="medicine">
    <div class="med-name">${rx.medicine}</div>
    ${rx.dosage    ? `<div class="med-row"><b>Dosage:</b> ${rx.dosage}</div>`  : ""}
    ${rx.frequency ? `<div class="med-row"><b>Sig:</b> ${rx.frequency}</div>` : ""}
    ${rx.quantity  ? `<div class="med-row"><b>Qty:</b> #${rx.quantity}</div>` : ""}
  </div>
  <div class="footer">
    <div class="sig-line"></div>
    <div class="sig-name">PAOLO GAYLORD S. VILLAFAÑE, MD, FPPS</div>
    <div class="sig-sub">Municipal Health Officer</div>
    <div class="sig-sub">Lic. No. 89594</div>
  </div>
</div>
</body>
</html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 400);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 24, right: 24, zIndex: 9999,
          background: toast.type === "success" ? "#2e7d32" : "#c62828",
          color: "#fff", borderRadius: 10, padding: "12px 22px",
          fontSize: 13, fontWeight: 700, boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
        }}>
          {toast.msg}
        </div>
      )}

      {/* Title + filter tabs */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 12, color: t.text3, fontWeight: 600, marginBottom: 2 }}>Pharmacist</div>
          <div style={{ fontSize: 30, fontWeight: 900, color: t.text, lineHeight: 1 }}>Prescriptions</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["all", "sent", "dispensed", "cancelled"] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: "6px 16px", borderRadius: 20, border: `1.5px solid ${t.green}`,
              background: filter === f ? t.green : "transparent",
              color: filter === f ? "#fff" : t.green,
              fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              textTransform: "capitalize",
            }}>
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{
        background: t.tableRow, borderRadius: 14,
        border: `1px solid ${t.border2}`, overflow: "hidden",
        boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 40 }}>#</th>
              <th style={thStyle}>Patient</th>
              <th style={thStyle}>Medicine</th>
              <th style={thStyle}>Dosage</th>
              <th style={thStyle}>Qty</th>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Status</th>
              <th style={{ ...thStyle, textAlign: "center" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ padding: "30px", textAlign: "center", color: t.text3, fontSize: 13 }}>
                  Loading…
                </td>
              </tr>
            ) : groups.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: "30px", textAlign: "center", color: t.text3, fontSize: 13 }}>
                  No prescriptions found.
                </td>
              </tr>
            ) : groups.map((group) => {
              const isOpen = expanded.has(group.patient_name);
              const pendingCount = group.prescriptions.filter(p => p.status === "sent").length;

              return [
                <tr
                  key={`group-${group.patient_name}`}
                  onClick={() => toggleGroup(group.patient_name)}
                  style={{ cursor: "pointer" }}
                >
                  <td colSpan={8} style={{
                    padding: "10px 14px",
                    borderBottom: `1px solid ${t.tableRowBorder}`,
                    borderLeft: `4px solid ${t.green}`,
                    background: t.tableRow,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {avatar(group.patient_name)}
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 13.5, color: t.text }}>
                          {group.patient_name}
                        </div>
                        <div style={{ fontSize: 11, color: t.text3, marginTop: 1 }}>
                          {group.prescriptions.length} prescription{group.prescriptions.length !== 1 ? "s" : ""}
                          {pendingCount > 0 && (
                            <span style={{
                              marginLeft: 6, background: "#fff8e1", color: "#b8860b",
                              borderRadius: 10, padding: "1px 7px", fontSize: 10, fontWeight: 700,
                            }}>
                              {pendingCount} pending
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ marginLeft: "auto" }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                          stroke={t.text3} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                          style={{ transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}>
                          <polyline points="6 9 12 15 18 9"/>
                        </svg>
                      </div>
                    </div>
                  </td>
                </tr>,

                ...(isOpen ? group.prescriptions.map((rx, i) => (
                  <tr key={rx.id} style={{ background: t.tableRow }}>
                    <td style={{ ...tdStyle, color: t.text3, paddingLeft: 28 }}>{i + 1}</td>
                    <td style={{ ...tdStyle, paddingLeft: 28 }}>
                      <span style={{ fontSize: 11, color: t.text3 }}>• {rx.patient_name}</span>
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{rx.medicine}</td>
                    <td style={tdStyle}>{rx.dosage ?? "—"}</td>
                    <td style={tdStyle}>{rx.quantity ?? "—"}</td>
                    <td style={tdStyle}>
                      {new Date(rx.prescription_date).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", year: "numeric",
                      })}
                    </td>
                    <td style={tdStyle}>{statusBadge(rx.status)}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelected(rx); }}
                        style={{
                          background: t.green, color: "#fff", border: "none",
                          borderRadius: 8, padding: "4px 14px", fontSize: 11,
                          fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                        }}>
                        View
                      </button>
                    </td>
                  </tr>
                )) : []),
              ];
            })}
          </tbody>
        </table>
      </div>

      {/* ── Modal ── */}
      {selected && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000, overflowY: "auto", padding: "32px 0",
          }}
          onClick={() => setSelected(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}
          >
            {/* ── 4.25 × 5.5in Slip ── */}
            <div style={{
              width: "4.25in",
              minHeight: "5.5in",
              background: "#fff",
              fontFamily: "Arial, sans-serif",
              color: "#000",
              padding: "0.22in 0.28in",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 8px 40px rgba(0,0,0,0.35)",
              position: "relative",
            }}>

              {/* ── Close button — inside top-right corner of slip ── */}
              <button
                onClick={() => setSelected(null)}
                style={{
                  position: "absolute", top: 8, right: 8,
                  width: 26, height: 26, borderRadius: "50%",
                  background: "#f3f4f6", border: "1px solid #d1d5db",
                  color: "#374151", fontSize: 13, fontWeight: 900,
                  cursor: "pointer", display: "flex", alignItems: "center",
                  justifyContent: "center", zIndex: 10, lineHeight: 1,
                  flexShrink: 0,
                }}>
                ✕
              </button>

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

              {/* Fields */}
              <div style={{ fontSize: "9pt", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, marginRight: 4, whiteSpace: "nowrap" }}>Name:</span>
                  <span style={{ flex: 2.2, borderBottom: "1px solid #000", paddingLeft: 3, paddingBottom: 1, marginRight: 16 }}>
                    {selected.patient_name}
                  </span>
                  <span style={{ fontWeight: 700, marginRight: 4, whiteSpace: "nowrap" }}>Date:</span>
                  <span style={{ flex: 1, borderBottom: "1px solid #000", paddingLeft: 3, paddingBottom: 1 }}>
                    {new Date(selected.prescription_date).toLocaleDateString("en-US", {
                      month: "long", day: "numeric", year: "numeric",
                    })}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, marginRight: 4, whiteSpace: "nowrap" }}>Age:</span>
                  <span style={{ flex: 0.7, borderBottom: "1px solid #000", minHeight: 16, marginRight: 14 }} />
                  <span style={{ fontWeight: 700, marginRight: 4, whiteSpace: "nowrap" }}>Gender:</span>
                  <span style={{ flex: 0.9, borderBottom: "1px solid #000", minHeight: 16, marginRight: 14 }} />
                  <span style={{ fontWeight: 700, marginRight: 4, whiteSpace: "nowrap" }}>Civil Status:</span>
                  <span style={{ flex: 1.2, borderBottom: "1px solid #000", minHeight: 16 }} />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <span style={{ fontWeight: 700, marginRight: 4, whiteSpace: "nowrap" }}>Address:</span>
                  <span style={{ flex: 1, borderBottom: "1px solid #000", minHeight: 16 }} />
                </div>
              </div>

              {/* Divider */}
              <div style={{ borderTop: "1px solid #000", margin: "6px 0 8px" }} />

              {/* Rx symbol */}
              <div style={{ fontFamily: "serif", fontWeight: "bold", fontSize: "30pt", lineHeight: 1, marginBottom: 10 }}>
                R<sub style={{ fontSize: "17pt" }}>x</sub>
              </div>

              {/* Medicine */}
              <div style={{ flex: 1, paddingLeft: 4, fontSize: "10pt" }}>
                <div style={{ fontSize: "11pt", fontWeight: "bold", marginBottom: 5 }}>{selected.medicine}</div>
                {selected.dosage    && <div style={{ marginBottom: 3 }}><b>Dosage:</b> {selected.dosage}</div>}
                {selected.frequency && <div style={{ marginBottom: 3 }}><b>Sig:</b> {selected.frequency}</div>}
                {selected.quantity  && <div style={{ marginBottom: 3 }}><b>Qty:</b> #{selected.quantity}</div>}
              </div>

              {/* Footer */}
              <div style={{ marginTop: "auto", paddingTop: 14, textAlign: "center" }}>
                <div style={{ borderTop: "1px solid #000", width: "60%", margin: "0 auto 4px" }} />
                <div style={{ fontSize: "9pt", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                  PAOLO GAYLORD S. VILLAFAÑE, MD, FPPS
                </div>
                <div style={{ fontSize: "8pt" }}>Municipal Health Officer</div>
                <div style={{ fontSize: "8pt" }}>Lic. No. 89594</div>
              </div>
            </div>

            {/* ── Bottom action buttons ── */}
            {selected.status === "sent" && (
              <div style={{ display: "flex", gap: 10, width: "4.25in" }}>
                <button
                  onClick={() => updateStatus(selected.id, "cancelled")}
                  disabled={updating}
                  style={{
                    flex: 1, padding: "9px 0", borderRadius: 8,
                    border: "none", background: "#d63031", color: "#fff",
                    fontSize: 13, fontWeight: 900, cursor: "pointer",
                    fontFamily: "inherit", opacity: updating ? 0.6 : 1,
                  }}>
                  CANCEL
                </button>
                <button
                  onClick={() => handlePrint(selected)}
                  style={{
                    flex: 1, padding: "9px 0", borderRadius: 8,
                    border: "none", background: "#374151", color: "#fff",
                    fontSize: 13, fontWeight: 900, cursor: "pointer",
                    fontFamily: "inherit",
                  }}>
                  🖨 PRINT
                </button>
                <button
                  onClick={() => updateStatus(selected.id, "dispensed")}
                  disabled={updating}
                  style={{
                    flex: 1, padding: "9px 0", borderRadius: 8,
                    border: "none", background: "#1b5e20", color: "#fff",
                    fontSize: 13, fontWeight: 900, cursor: "pointer",
                    fontFamily: "inherit", opacity: updating ? 0.6 : 1,
                  }}>
                  {updating ? "SAVING…" : "CONFIRM"}
                </button>
              </div>
            )}

            {/* Close button for non-sent statuses */}
            {selected.status !== "sent" && (
              <div style={{ width: "4.25in" }}>
                <button
                  onClick={() => setSelected(null)}
                  style={{
                    width: "100%", padding: "9px 0", borderRadius: 8,
                    border: "none", background: "#374151", color: "#fff",
                    fontSize: 13, fontWeight: 900, cursor: "pointer",
                    fontFamily: "inherit",
                  }}>
                  CLOSE
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}