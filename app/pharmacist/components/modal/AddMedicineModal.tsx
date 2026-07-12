"use client";
import { CSSProperties, useState } from "react";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/lib/supabase";
import { MEDICINE_TYPES, SUPPLY_TYPES, UNITS } from "@/lib/types";

type Props = {
  onClose:     () => void;
  onSaved:     () => void;
  onToast:     (msg: string, type: "success" | "error") => void;
  defaultTab?: "drugs" | "supplies";
};

const BoxIcon = ({ size = 13, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth="2.2" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M21 8L12 3 3 8v8l9 5 9-5V8z" fill="none"/>
    <path d="M3 8l9 5 9-5"/>
    <line x1="12" y1="13" x2="12" y2="21"/>
  </svg>
);

export default function AddMedicineModal({ onClose, onSaved, onToast, defaultTab }: Props) {
  const { t }        = useTheme();
  const isSupply     = defaultTab === "supplies";
  const typeList     = isSupply ? SUPPLY_TYPES : MEDICINE_TYPES;

  const [saving, setSaving] = useState(false);
  const [form, setForm]     = useState({
    medicineName: "", mgDosage: "", expDate: "",
    medicineType: "", unit: "Pieces",
    boxes: "", piecesPerBox: "10",
  });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Box inventory is only relevant when unit contains "box"
  const isBoxUnit    = form.unit.toLowerCase().includes("box");
  const boxes        = parseInt(form.boxes        || "0",  10);
  const piecesPerBox = parseInt(form.piecesPerBox || "10", 10);
  const totalPieces  = isBoxUnit ? boxes * piecesPerBox : 0;

  const handleConfirm = async () => {
    if (!form.medicineName.trim() || !form.expDate || !form.medicineType) {
      onToast("Please fill in Medicine Name, EXP Date, and Type.", "error");
      return;
    }
    if (isBoxUnit) {
      if (!form.boxes || boxes <= 0)        { onToast("Number of boxes must be at least 1.", "error"); return; }
      if (piecesPerBox <= 0) { onToast("Pieces per box must be at least 1.", "error"); return; }
    }

    setSaving(true);
    try {
      const quantity = isBoxUnit ? totalPieces : parseInt(form.boxes || "0", 10);
      const { error } = await supabase.from("pharma_medicines").insert([{
        med_name:       form.medicineName.trim(),
        med_dosage:     form.mgDosage.trim() || "N/A",
        med_type:       form.medicineType,
        exp_date:       form.expDate,
        unit:           form.unit,
        boxes:          isBoxUnit ? boxes : 0,
        pieces_per_box: isBoxUnit ? piecesPerBox : 0,
        partial_pieces: 0,
        quantity:       isBoxUnit ? totalPieces : (parseInt(form.boxes || "0", 10)),
        archived:       false,
      }]);
      if (error) throw error;

      const msg = isBoxUnit
        ? `${form.medicineName} added — ${boxes} box${boxes !== 1 ? "es" : ""} × ${piecesPerBox} pcs = ${totalPieces} total.`
        : `${form.medicineName} added successfully.`;
      onToast(msg, "success");
      onSaved();
      onClose();
    } catch (err: any) {
      onToast(err.message || "Failed to add medicine.", "error");
    } finally {
      setSaving(false);
    }
  };

  const inp: CSSProperties = {
    border: `1.5px solid ${t.inputBorder}`, borderRadius: 8,
    padding: "8px 10px", fontSize: 12.5, fontFamily: "inherit",
    outline: "none", background: t.modalBg, color: t.modalText,
    width: "100%", height: 36, boxSizing: "border-box",
  };
  const sel: CSSProperties = { ...inp, appearance: "none", WebkitAppearance: "none", cursor: "pointer" };
  const lbl: CSSProperties = {
    fontSize: 11, fontWeight: 700, color: t.text3,
    textTransform: "uppercase", letterSpacing: "0.06em",
    marginBottom: 5, display: "block",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        background: t.modalBg, borderRadius: 18, width: 460,
        maxHeight: "92vh", overflowY: "auto",
        padding: "28px 32px", boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: t.green, margin: "0 0 4px" }}>
            {isSupply ? "Add Supply" : "Add Medicine"}
          </h2>
          <div style={{ fontSize: 12, color: t.text3 }}>
            {isSupply ? "Adding to Medicine Supplies" : "Adding to Medicine Drugs"}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18 }}>

          {/* Name */}
          <div>
            <label style={lbl}>{isSupply ? "Supply Name" : "Medicine Name"}</label>
            <input value={form.medicineName} onChange={e => set("medicineName", e.target.value)}
              placeholder={isSupply ? "e.g. Surgical Gloves" : "e.g. Paracetamol"} style={inp} />
          </div>

          {/* Dosage / Specification */}
          <div>
            <label style={lbl}>{isSupply ? "Specification" : "Mg / Dosage"}</label>
            <input value={form.mgDosage} onChange={e => set("mgDosage", e.target.value)}
              placeholder={isSupply ? "e.g. Large, 1 inch x 10 yards" : "e.g. 500mg"} style={inp} />
          </div>

          {/* EXP Date */}
          <div>
            <label style={lbl}>EXP Date</label>
            <input type="date" value={form.expDate} onChange={e => set("expDate", e.target.value)} style={inp} />
          </div>

          {/* Type */}
          <div>
            <label style={lbl}>Type</label>
            <select value={form.medicineType} onChange={e => set("medicineType", e.target.value)} style={sel}>
              <option value="">— select —</option>
              {typeList.map(o => <option key={o}>{o}</option>)}
            </select>
          </div>

          {/* Unit */}
          <div>
            <label style={lbl}>Unit</label>
            <select value={form.unit} onChange={e => set("unit", e.target.value)} style={sel}>
              {UNITS.map(o => <option key={o}>{o}</option>)}
            </select>
          </div>

          {/* ── Box Inventory — only visible when unit is "Box" ── */}
          {isBoxUnit && (
            <div style={{
              background: `${t.green}0d`,
              border: `1.5px solid ${t.green}33`,
              borderRadius: 10, padding: "14px 16px",
              animation: "fadeIn 0.15s ease",
            }}>
              <div style={{
                fontSize: 11, fontWeight: 800, color: t.green,
                textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 12,
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <BoxIcon size={13} color={t.green} />
                Box Inventory
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={lbl}>Number of Boxes</label>
                  <input type="number" min={1} value={form.boxes}
                    onChange={e => set("boxes", e.target.value)}
                    placeholder="e.g. 10" style={inp} />
                </div>
                <div>
                  <label style={lbl}>Pieces Per Box</label>
                  <input type="number" min={1} value={form.piecesPerBox}
                    onChange={e => set("piecesPerBox", e.target.value)}
                    placeholder="e.g. 20" style={inp} />
                </div>
              </div>

              {boxes > 0 && piecesPerBox > 0 && (
                <div style={{
                  marginTop: 12, background: t.modalBg, borderRadius: 8,
                  padding: "10px 14px", textAlign: "center",
                  border: `1px solid ${t.border}`,
                }}>
                  <span style={{ fontSize: 11, color: t.text3 }}>Total pieces: </span>
                  <span style={{ fontSize: 16, fontWeight: 900, color: t.green }}>
                    {boxes} × {piecesPerBox} = {totalPieces} pcs
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Qty for non-box units ── */}
          {!isBoxUnit && (
            <div>
              <label style={lbl}>Quantity</label>
              <input type="number" min={0} value={form.boxes}
                onChange={e => set("boxes", e.target.value)}
                placeholder="e.g. 100" style={inp} />
            </div>
          )}

        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "11px 0", borderRadius: 8, border: "none",
            background: "#d63031", color: "#fff", fontSize: 13, fontWeight: 900,
            cursor: "pointer", fontFamily: "inherit",
          }}>CANCEL</button>
          <button onClick={handleConfirm} disabled={saving} style={{
            flex: 1, padding: "11px 0", borderRadius: 8,
            border: `2.5px solid ${t.green}`, background: "transparent",
            color: t.green, fontSize: 13, fontWeight: 900,
            cursor: saving ? "not-allowed" : "pointer",
            fontFamily: "inherit", opacity: saving ? 0.6 : 1,
          }}>
            {saving ? "SAVING…" : "CONFIRM"}
          </button>
        </div>

        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-4px); }
            to   { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    </div>
  );
}