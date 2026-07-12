"use client";
import { CSSProperties, useState } from "react";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/lib/supabase";
import { Medicine } from "@/lib/types";
import { logAction } from "@/app/utils/auditLogs";
type Props = {
  medicine: Medicine;
  onClose:  () => void;
  onSaved:  () => void;
  onToast:  (msg: string, type: "success" | "error") => void;
};

const IS_BOX_UNIT = (unit: string) =>
  unit?.toLowerCase().includes("box") || unit?.toLowerCase() === "boxes";

const PillIcon = ({ size = 15, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
    <rect x="2" y="9" width="20" height="6" rx="3" stroke={color} strokeWidth="2" fill="none"/>
    <line x1="12" y1="9" x2="12" y2="15" stroke={color} strokeWidth="2"/>
    <rect x="2" y="9" width="10" height="6" rx="3" fill={color} opacity="0.25"/>
  </svg>
);

const WarningIcon = ({ size = 13, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);

const XCircleIcon = ({ size = 13, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="12" r="10"/>
    <line x1="15" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="15" y2="15"/>
  </svg>
);

export default function DispenseMedicineModal({ medicine, onClose, onSaved, onToast }: Props) {
  const { t }               = useTheme();
  const [qty, setQty]       = useState(1);
  const [saving, setSaving] = useState(false);

  const isBox        = IS_BOX_UNIT(medicine.unit);
  const piecesPerBox = isBox && medicine.pieces_per_box && medicine.pieces_per_box > 0
    ? medicine.pieces_per_box : 10;
  const fullBoxes    = medicine.boxes          ?? 0;
  const partialPieces= medicine.partial_pieces ?? 0;

  const totalAvailable = isBox
    ? (fullBoxes > 0 || partialPieces > 0
        ? fullBoxes * piecesPerBox + partialPieces
        : medicine.quantity)
    : medicine.quantity;

  const remaining     = totalAvailable - qty;
  const newFullBoxes  = isBox ? Math.floor(remaining / piecesPerBox) : 0;
  const newPartial    = isBox ? remaining % piecesPerBox : 0;
  const canDispense   = qty > 0 && qty <= totalAvailable;

  const handleDispense = async () => {
    if (!canDispense) { onToast("Not enough stock.", "error"); return; }
    setSaving(true);
    try {
      const { error: dispErr } = await supabase.from("pharma_dispense").insert([{
        medicine_id:  medicine.id,
        med_name:     medicine.med_name,
        quantity:     qty,
        dispensed_at: new Date().toISOString(),
      }]);
      if (dispErr) throw dispErr;

      const updatePayload: Record<string, number> = { quantity: remaining };
      if (isBox) {
        updatePayload.boxes           = newFullBoxes;
        updatePayload.partial_pieces  = newPartial;
        updatePayload.pieces_per_box  = piecesPerBox;
      }
      const { error: stockErr } = await supabase
        .from("pharma_medicines").update(updatePayload).eq("id", medicine.id);
      if (stockErr) throw stockErr;

      // ── Audit log: only after a real, successful dispense ──
      await logAction({
        user_role:    "Pharmacist",
        action:       "DISPENSE_MEDICINE",
        module:       "Pharmacy",
        description:  `Dispensed ${qty} ${medicine.unit || "unit(s)"} of ${medicine.med_name}`,
        reference_id: medicine.id,
        status:       "success",
      });

      const unitLabel = isBox ? `piece${qty !== 1 ? "s" : ""}` : (medicine.unit?.toLowerCase() ?? "unit");
      onToast(`Dispensed ${qty} ${unitLabel} of ${medicine.med_name}.`, "success");
      onSaved();
      onClose();
    } catch (err: any) {
      onToast(err.message || "Failed to dispense.", "error");
    } finally { setSaving(false); }
  };

  const inp: CSSProperties = {
    border: `1.5px solid ${t.inputBorder}`, borderRadius: 8,
    padding: "8px 10px", fontSize: 16, fontFamily: "inherit",
    outline: "none", background: t.modalBg, color: t.modalText,
    width: "100%", height: 40, boxSizing: "border-box",
    textAlign: "center", fontWeight: 700,
  };

  const StatCard = ({ label, value, color }: { label: string; value: string | number; color: string }) => (
    <div style={{
      background: t.modalBg, borderRadius: 8, border: `1px solid ${t.border}`,
      padding: "10px 12px", textAlign: "center",
    }}>
      <div style={{ fontSize: 20, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 10, color: t.text3, fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>{label}</div>
    </div>
  );

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        background: t.modalBg, borderRadius: 18, width: 460,
        padding: "28px 32px", boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: t.green, margin: "0 0 4px" }}>
            Dispense Medicine
          </h2>
          <p style={{ fontSize: 12, color: t.text3, margin: 0 }}>
            Record medicine given out based on prescription
          </p>
        </div>

        {/* Medicine info card */}
        <div style={{
          background: t.surface2, borderRadius: 12,
          border: `1px solid ${t.border}`, padding: "14px 16px", marginBottom: 20,
        }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: t.text, marginBottom: 12,
            display: "flex", alignItems: "center", gap: 8 }}>
            <PillIcon size={15} color={t.green} />
            {medicine.med_name}
            <span style={{ fontSize: 12, fontWeight: 600, color: t.text3, marginLeft: 4 }}>
              {medicine.med_dosage}
            </span>
          </div>

          {isBox ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <StatCard label="Full Boxes"   value={fullBoxes}               color={t.green}  />
                <StatCard label="Partial Box"  value={`${partialPieces} pcs`}  color="#e07a30"  />
                <StatCard label="Total Pieces" value={totalAvailable}           color={t.text}   />
              </div>
              <div style={{ fontSize: 11, color: t.text3, marginTop: 10, textAlign: "center" }}>
                {fullBoxes} box{fullBoxes !== 1 ? "es" : ""} × {piecesPerBox} pcs
                {partialPieces > 0 ? ` + 1 partial (${partialPieces} pcs left)` : ""}
              </div>
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <StatCard
                label={medicine.unit ?? "Units"}
                value={totalAvailable}
                color={totalAvailable <= 10 ? "#d94040" : t.green}
              />
              <div style={{ fontSize: 12, color: t.text3, lineHeight: 1.6 }}>
                Each <strong style={{ color: t.text }}>{medicine.unit}</strong> is dispensed
                as one whole unit.<br />
                No pieces subdivision for this unit type.
              </div>
            </div>
          )}
        </div>

        {/* Quantity selector */}
        <div style={{ marginBottom: 18 }}>
          <label style={{
            fontSize: 11, fontWeight: 700, color: t.text3,
            textTransform: "uppercase", letterSpacing: "0.06em",
            display: "block", marginBottom: 8,
          }}>
            {isBox ? "Pieces to Dispense" : `${medicine.unit ?? "Units"} to Dispense`}
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setQty(v => Math.max(1, v - 1))} style={{
              width: 40, height: 40, borderRadius: 8,
              border: `1.5px solid ${t.inputBorder}`, background: t.modalBg,
              color: t.text, fontSize: 22, cursor: "pointer", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 300,
            }}>−</button>
            <input type="number" min={1} max={totalAvailable} value={qty}
              onChange={e => setQty(Math.max(1, Math.min(totalAvailable, parseInt(e.target.value) || 1)))}
              style={inp} />
            <button onClick={() => setQty(v => Math.min(totalAvailable, v + 1))} style={{
              width: 40, height: 40, borderRadius: 8,
              border: `1.5px solid ${t.inputBorder}`, background: t.modalBg,
              color: t.text, fontSize: 22, cursor: "pointer", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 300,
            }}>+</button>
          </div>
        </div>

        {/* After-dispense preview */}
        {canDispense && (
          <div style={{
            background: remaining <= 10 ? "#fefce8" : `${t.green}0d`,
            border: `1px solid ${remaining <= 10 ? "#fde047" : t.green + "33"}`,
            borderRadius: 10, padding: "12px 14px", marginBottom: 18,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: t.text3,
              textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
              After Dispense
            </div>

            {isBox ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: t.green }}>{newFullBoxes}</div>
                  <div style={{ fontSize: 10, color: t.text3, fontWeight: 600 }}>Full Boxes</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: "#e07a30" }}>{newPartial} pcs</div>
                  <div style={{ fontSize: 10, color: t.text3, fontWeight: 600 }}>Partial</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 900,
                    color: remaining <= 10 ? "#d94040" : t.text }}>{remaining} pcs</div>
                  <div style={{ fontSize: 10, color: t.text3, fontWeight: 600 }}>Total Left</div>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 900,
                    color: remaining <= 10 ? "#d94040" : t.green }}>{remaining}</div>
                  <div style={{ fontSize: 11, color: t.text3, fontWeight: 600 }}>
                    {medicine.unit} remaining
                  </div>
                </div>
              </div>
            )}

            {remaining <= 10 && (
              <div style={{ fontSize: 11, color: "#92400e", fontWeight: 700,
                marginTop: 10, textAlign: "center",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <WarningIcon size={13} color="#92400e" />
                Low stock warning after dispense
              </div>
            )}
          </div>
        )}

        {/* Over-stock warning */}
        {qty > totalAvailable && (
          <div style={{
            background: "#fef2f2", border: "1px solid #fca5a5",
            borderRadius: 10, padding: "10px 14px", marginBottom: 18,
            fontSize: 12, color: "#dc2626", fontWeight: 700, textAlign: "center",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
            <XCircleIcon size={13} color="#dc2626" />
            Not enough stock — only {totalAvailable} {isBox ? "pieces" : medicine.unit} available.
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "11px 0", borderRadius: 8,
            border: `1.5px solid ${t.border2}`, background: "transparent",
            color: t.text2, fontSize: 13, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit",
          }}>CANCEL</button>
          <button onClick={handleDispense} disabled={saving || !canDispense} style={{
            flex: 2, padding: "11px 0", borderRadius: 8, border: "none",
            background: canDispense ? t.green : t.tableRowBorder,
            color: canDispense ? "#fff" : t.text3,
            fontSize: 13, fontWeight: 900,
            cursor: canDispense && !saving ? "pointer" : "not-allowed",
            fontFamily: "inherit", letterSpacing: "0.06em",
            opacity: saving ? 0.6 : 1,
            boxShadow: canDispense ? `0 3px 10px ${t.green}55` : "none",
            transition: "all 0.15s",
          }}>
            {saving
              ? "DISPENSING…"
              : `DISPENSE ${qty} ${isBox
                  ? `PIECE${qty !== 1 ? "S" : ""}`
                  : (medicine.unit?.toUpperCase() ?? "UNIT")}`
            }
          </button>

        </div>
      </div>
    </div>
  );
}