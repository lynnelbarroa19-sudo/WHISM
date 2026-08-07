"use client";
import { CSSProperties, useRef, useState } from "react";
import { useTheme, MEDICINE_TYPES, SUPPLY_TYPES, UNITS, MedicineCategory } from "../lib/pharmacy";
import { createMedicineWithBatch } from "../lib/pharmacyData";

type Props = {
  onToast: (msg: string, type: "success" | "error") => void;
  // Optional — present only when opened as a MODAL from Inventory.tsx.
  onClose?: () => void;
  onSaved?: () => void;
  defaultTab?: MedicineCategory;
};

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

type FormErrors = Partial<Record<
  "generic_name" | "dosage_form" | "expiration_date" | "date_received" |
  "boxes" | "strips_per_box" | "pieces_per_strip" | "loose_pieces" | "quantity",
  string
>>;

type DraftForm = {
  generic_name: string; brand_name: string; dosage_strength: string; unit: string;
  dosage_form: string; barcode: string; reorder_level: string; remarks: string;
};
type DraftBatch = {
  batch_number: string; expiration_date: string; date_received: string;
  boxes: string; strips_per_box: string; pieces_per_strip: string;
  loose_pieces: string;
  simple_quantity: string; storage_location: string; remarks: string;
};
type QueuedItem = {
  key: string;
  category: MedicineCategory;
  form: DraftForm;
  batch: DraftBatch;
  isBoxUnit: boolean;
  totalPieces: number;
};

const EMPTY_FORM: DraftForm = { generic_name: "", brand_name: "", dosage_strength: "", unit: "Pieces", dosage_form: "", barcode: "", reorder_level: "10", remarks: "" };
const emptyBatch = (): DraftBatch => ({
  batch_number: "", expiration_date: "", date_received: todayStr(),
  boxes: "", strips_per_box: "", pieces_per_strip: "", loose_pieces: "0",
  simple_quantity: "", storage_location: "", remarks: "",
});

export default function AddMedicinePage({ onToast, onClose, onSaved, defaultTab }: Props) {
  const { t } = useTheme();
  const [category, setCategory] = useState<MedicineCategory>(defaultTab ?? "drugs");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const prevTypeRef = useRef("");

  const [form, setForm] = useState<DraftForm>(EMPTY_FORM);
  const [batch, setBatch] = useState<DraftBatch>(emptyBatch());
  const [queue, setQueue] = useState<QueuedItem[]>([]);

  // The quantity section only shows the Boxes/Strips/Pieces breakdown when
  // the Unit is literally "Boxes" — anything else is a flat count in that
  // unit (a "Bottle" unit doesn't come in boxes-of-bottles here).
  const isBoxUnit = form.unit.trim().toLowerCase() === "boxes";

  const set = (k: keyof DraftForm, v: string) => {
    setForm(f => ({ ...f, [k]: v }));
    if (k === "unit") {
      const nowBoxUnit = v.trim().toLowerCase() === "boxes";
      setBatch(b => nowBoxUnit
        ? { ...b, simple_quantity: "" }
        : { ...b, boxes: "", strips_per_box: "", pieces_per_strip: "" });
      setErrors(e => ({ ...e, boxes: undefined, strips_per_box: undefined, pieces_per_strip: undefined, quantity: undefined }));
    }
  };
  const setB = (k: keyof DraftBatch, v: string) => {
    setBatch(b => ({ ...b, [k]: v }));
    if (errors[k as keyof FormErrors]) setErrors(e => ({ ...e, [k]: undefined, quantity: undefined }));
  };

  const piecesPerBox = Math.max(1, (parseInt(batch.strips_per_box, 10) || 0) * (parseInt(batch.pieces_per_strip, 10) || 0)) || 1;
  const totalPieces = isBoxUnit
    ? (parseInt(batch.boxes || "0", 10) * piecesPerBox) + parseInt(batch.loose_pieces || "0", 10)
    : parseInt(batch.simple_quantity || "0", 10);

  function nonNegIntError(raw: string): string | undefined {
    if (raw.trim() === "") return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) return "Enter a whole number, 0 or more";
    return undefined;
  }

  function validate(): FormErrors {
    const e: FormErrors = {};

    if (!form.generic_name.trim()) e.generic_name = "Required";
    if (!form.dosage_form.trim()) e.dosage_form = "Required";

    // expiration_date is optional now — supplies like Gloves/Gauze often
    // don't meaningfully expire. Only validate ordering if both are given.
    if (batch.date_received) {
      if (new Date(batch.date_received) > new Date(todayStr())) e.date_received = "Can't be a future date";
    }
    if (batch.expiration_date && batch.date_received && !e.date_received) {
      if (new Date(batch.expiration_date) <= new Date(batch.date_received)) {
        e.expiration_date = "Must be after Date Received";
      }
    }

    let quantityInvalid = false;
    if (isBoxUnit) {
      const boxesErr = nonNegIntError(batch.boxes);
      const stripsErr = nonNegIntError(batch.strips_per_box);
      const piecesErr = nonNegIntError(batch.pieces_per_strip);
      const looseErr = nonNegIntError(batch.loose_pieces);
      if (boxesErr) e.boxes = boxesErr;
      if (stripsErr) e.strips_per_box = stripsErr;
      if (piecesErr) e.pieces_per_strip = piecesErr;
      if (looseErr) e.loose_pieces = looseErr;

      const boxesN = parseInt(batch.boxes || "0", 10) || 0;
      const stripsN = parseInt(batch.strips_per_box || "0", 10) || 0;
      const piecesN = parseInt(batch.pieces_per_strip || "0", 10) || 0;
      if (boxesN > 0 && !stripsErr && !piecesErr && (stripsN <= 0 || piecesN <= 0)) {
        e.strips_per_box = e.strips_per_box || "Needed when Boxes > 0";
        e.pieces_per_strip = e.pieces_per_strip || "Needed when Boxes > 0";
      }
      quantityInvalid = !!(boxesErr || stripsErr || piecesErr || looseErr);
    } else {
      if (!batch.simple_quantity.trim()) {
        e.quantity = `Enter a quantity (in ${form.unit || "units"})`;
        quantityInvalid = true;
      } else {
        const qErr = nonNegIntError(batch.simple_quantity);
        if (qErr) { e.quantity = qErr; quantityInvalid = true; }
      }
    }

    if (!quantityInvalid && totalPieces <= 0) {
      e.quantity = "Total quantity must be greater than 0";
    }

    return e;
  }

  const hasUnsavedWork = () =>
    queue.length > 0 || form.generic_name.trim() !== "" || form.dosage_form.trim() !== "" || batch.expiration_date !== "";

  function requestClose() {
    if (saving) return;
    if (hasUnsavedWork()) setShowDiscardConfirm(true);
    else onClose?.();
  }

  /** Validates the current form, and if it passes, snapshots it into the
   *  queue and clears the form for the next item. */
  const addToQueue = () => {
    const foundErrors = validate();
    setErrors(foundErrors);
    const firstError = Object.values(foundErrors).find(Boolean);
    if (firstError) { onToast(firstError, "error"); return; }

    setQueue(prev => [...prev, {
      key: `${Date.now()}-${prev.length}`,
      category, form: { ...form }, batch: { ...batch }, isBoxUnit, totalPieces,
    }]);
    setForm(EMPTY_FORM);
    setBatch(emptyBatch());
    setErrors({});
    onToast(`${form.generic_name} added to the list.`, "success");
  };

  const removeFromQueue = (key: string) => setQueue(prev => prev.filter(q => q.key !== key));

  /** Saves every queued item in order. If one fails partway through, the
   *  ones already saved stay saved — the toast says exactly how far it
   *  got, and only the unsaved remainder goes back into the queue. */
  const handleConfirmAll = async () => {
    if (queue.length === 0) { onToast("Add at least one medicine or supply to the list first.", "error"); return; }
    setSaving(true);
    let done = 0;
    try {
      for (const item of queue) {
        await createMedicineWithBatch({
          generic_name:     item.form.generic_name.trim(),
          brand_name:       item.form.brand_name.trim(),
          dosage_strength:  item.form.dosage_strength.trim(),
          dosage_form:      item.form.dosage_form.trim(),
          category:         item.category,
          unit:             item.form.unit,
          barcode:          item.form.barcode.trim(),
          reorder_level:    parseInt(item.form.reorder_level || "10", 10),
          remarks:          item.form.remarks.trim(),
          batch: {
            batch_number:     item.batch.batch_number.trim(),
            expiration_date:  item.batch.expiration_date || undefined,
            date_received:    item.batch.date_received || undefined,
            boxes:            item.isBoxUnit ? parseInt(item.batch.boxes || "0", 10) : 0,
            strips_per_box:   item.isBoxUnit ? Math.max(1, parseInt(item.batch.strips_per_box || "1", 10)) : undefined,
            pieces_per_strip: item.isBoxUnit ? Math.max(1, parseInt(item.batch.pieces_per_strip || "1", 10)) : undefined,
            loose_pieces:     item.isBoxUnit ? parseInt(item.batch.loose_pieces || "0", 10) : parseInt(item.batch.simple_quantity || "0", 10),
            storage_location: item.batch.storage_location.trim(),
            remarks:          item.batch.remarks.trim(),
          },
        });
        done += 1;
      }
      onToast(`Added ${done} item${done !== 1 ? "s" : ""} to inventory.`, "success");
      setQueue([]);
      onSaved?.();
      onClose?.();
    } catch (err: any) {
      onToast(`${err.message || "Failed to save."} (${done} of ${queue.length} saved before this happened.)`, "error");
      setQueue(prev => prev.slice(done));
    } finally {
      setSaving(false);
    }
  };

  const inp: CSSProperties = {
    border: `1.5px solid ${t.inputBorder}`, borderRadius: 8, padding: "10px 12px",
    fontSize: 13, fontFamily: "inherit", outline: "none", background: t.modalBg,
    color: t.modalText, width: "100%", height: 40, boxSizing: "border-box",
  };
  const inpError: CSSProperties = { ...inp, border: "1.5px solid #dc2626" };
  const sel: CSSProperties = { ...inp, appearance: "none", WebkitAppearance: "none", cursor: "pointer", paddingRight: 34 };
  const selWrap: CSSProperties = { position: "relative" };
  const selChevron: CSSProperties = { position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: t.text3 };
  const SelectChevron = () => (
    <svg style={selChevron} width="11" height="7" viewBox="0 0 11 7" fill="none">
      <path d="M1 1L5.5 5.5L10 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  const lbl: CSSProperties = {
    fontSize: 10.5, fontWeight: 700, color: t.text3, textTransform: "uppercase",
    letterSpacing: "0.06em", marginBottom: 6, display: "block",
  };
  const errTxt: CSSProperties = { fontSize: 10.5, color: "#dc2626", fontWeight: 600, marginTop: 4 };
  const optionalTag = <span style={{ textTransform: "none", fontWeight: 500, color: t.text3, letterSpacing: 0 }}> (optional)</span>;
  const row2: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 };
  const field: CSSProperties = { marginBottom: 16 };
  const ErrorText = ({ msg }: { msg?: string }) => (msg ? <div style={errTxt}>{msg}</div> : null);

  const typeOptions = category === "supplies" ? SUPPLY_TYPES : MEDICINE_TYPES;

  const formContent = (
    <div style={{ width: "100%" }}>

      {/* Header */}
      <div style={{
        background: t.green, margin: onClose ? "-26px -36px 22px" : "0 0 22px", padding: onClose ? "18px 36px" : 0,
        borderRadius: onClose ? "18px 18px 0 0" : 0, display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.8)", fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 3 }}>Pharmacist</div>
          <div style={{ fontSize: onClose ? 20 : 26, fontWeight: 900, color: "#fff", lineHeight: 1 }}>Add Medicine</div>
        </div>
        {onClose && (
          <button onClick={requestClose} style={{
            border: "1px solid rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.15)", color: "#fff",
            borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 15, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>✕</button>
        )}
      </div>

      <div style={{ padding: onClose ? "0 2px" : 0 }}>

        <div style={{ fontSize: 12, color: t.text3, marginBottom: 16 }}>
          Fill out one item, "Add to List", then repeat for the next. Everything in the list gets saved together when you press Confirm.
        </div>

        {/* Category */}
        <div style={field}>
          <label style={lbl}>Category</label>
          <div style={selWrap}>
            <select value={category} onChange={e => setCategory(e.target.value as MedicineCategory)} style={sel}>
              <option value="drugs">Medical Drugs</option>
              <option value="supplies">Medical Supplies</option>
            </select>
            <SelectChevron />
          </div>
        </div>

        {/* Generic Name / Brand Name */}
        <div style={{ ...row2, ...field }}>
          <div>
            <label style={lbl}>{category === "supplies" ? "Supply Name" : "Generic Name"}</label>
            <input value={form.generic_name} onChange={e => set("generic_name", e.target.value)}
              placeholder={category === "supplies" ? "e.g. Surgical Gloves" : "e.g. Paracetamol"} style={errors.generic_name ? inpError : inp} />
            <ErrorText msg={errors.generic_name} />
          </div>
          <div>
            <label style={lbl}>Brand Name{optionalTag}</label>
            <input value={form.brand_name} onChange={e => set("brand_name", e.target.value)} placeholder="e.g. Biogesic" style={inp} />
          </div>
        </div>

        {/* Dosage / Unit — Unit is a plain dropdown so it's always easy to
            pick a different one, no "stuck" search field. */}
        <div style={{ ...row2, ...field }}>
          <div>
            <label style={lbl}>{category === "supplies" ? "Specification" : "Mg / Dosage"}</label>
            <input value={form.dosage_strength} onChange={e => set("dosage_strength", e.target.value)}
              placeholder={category === "supplies" ? "e.g. Large, 1in x 10yd" : "e.g. 500mg"} style={inp} />
          </div>
          <div>
            <label style={lbl}>Unit</label>
            <div style={selWrap}>
              <select value={form.unit} onChange={e => set("unit", e.target.value)} style={sel}>
                {UNITS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <SelectChevron />
            </div>
          </div>
        </div>

        {/* Type — search-or-type-new, via datalist */}
        <div style={field}>
          <label style={lbl}>Type</label>
          <input
            list="add-medicine-type-options"
            value={form.dosage_form}
            onFocus={e => { prevTypeRef.current = form.dosage_form.trim() || prevTypeRef.current; set("dosage_form", ""); e.target.select(); }}
            onBlur={() => { if (!form.dosage_form.trim() && prevTypeRef.current) set("dosage_form", prevTypeRef.current); }}
            onChange={e => set("dosage_form", e.target.value)}
            placeholder="Search or type a new type…"
            style={errors.dosage_form ? inpError : inp}
          />
          <datalist id="add-medicine-type-options">
            {typeOptions.map(o => <option key={o} value={o} />)}
          </datalist>
          <ErrorText msg={errors.dosage_form} />
        </div>

        {/* Batch Number */}
        <div style={field}>
          <label style={lbl}>Batch Number</label>
          <input value={batch.batch_number} onChange={e => setB("batch_number", e.target.value)} placeholder="e.g. B-2026-0451" style={inp} />
        </div>

        {/* Exp Date / Date Received */}
        <div style={{ ...row2, ...field }}>
          <div>
            <label style={lbl}>Exp Date <span style={{ textTransform: "none", fontWeight: 500, color: t.text3, letterSpacing: 0 }}>(optional)</span></label>
            <input type="date" value={batch.expiration_date} onChange={e => setB("expiration_date", e.target.value)} style={errors.expiration_date ? inpError : inp} />
            <ErrorText msg={errors.expiration_date} />
          </div>
          <div>
            <label style={lbl}>Date Received</label>
            <input type="date" max={todayStr()} value={batch.date_received} onChange={e => setB("date_received", e.target.value)} style={errors.date_received ? inpError : inp} />
            <ErrorText msg={errors.date_received} />
          </div>
        </div>

        {/* Quantity — shape depends on the chosen Unit above. */}
        <div style={field}>
          {isBoxUnit ? (
            <>
              <label style={lbl}>Boxes, Strips &amp; Pieces</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto 1fr", gap: 8, alignItems: "start" }}>
                <div>
                  <div style={{ fontSize: 9.5, color: t.text3, marginBottom: 4, textAlign: "center" }}>Boxes</div>
                  <input type="number" min={0} step={1} value={batch.boxes} onChange={e => setB("boxes", e.target.value)} placeholder="e.g. 10" style={{ ...(errors.boxes ? inpError : inp), textAlign: "center" }} />
                  <ErrorText msg={errors.boxes} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: t.text3, marginTop: 32 }}>×</div>
                <div>
                  <div style={{ fontSize: 9.5, color: t.text3, marginBottom: 4, textAlign: "center" }}>Strips / Box</div>
                  <input type="number" min={0} step={1} value={batch.strips_per_box} onChange={e => setB("strips_per_box", e.target.value)} placeholder="e.g. 10" style={{ ...(errors.strips_per_box ? inpError : inp), textAlign: "center" }} />
                  <ErrorText msg={errors.strips_per_box} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: t.text3, marginTop: 32 }}>×</div>
                <div>
                  <div style={{ fontSize: 9.5, color: t.text3, marginBottom: 4, textAlign: "center" }}>Pieces / Strip</div>
                  <input type="number" min={0} step={1} value={batch.pieces_per_strip} onChange={e => setB("pieces_per_strip", e.target.value)} placeholder="e.g. 10" style={{ ...(errors.pieces_per_strip ? inpError : inp), textAlign: "center" }} />
                  <ErrorText msg={errors.pieces_per_strip} />
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 9.5, color: t.text3, marginBottom: 4 }}>Loose Pieces (not in a full box)</div>
                <input type="number" min={0} step={1} value={batch.loose_pieces} onChange={e => setB("loose_pieces", e.target.value)} placeholder="e.g. 5" style={errors.loose_pieces ? inpError : inp} />
                <ErrorText msg={errors.loose_pieces} />
              </div>
            </>
          ) : (
            <>
              <label style={lbl}>Quantity ({form.unit || "units"})</label>
              <input
                type="number" min={0} step={1} value={batch.simple_quantity}
                onChange={e => setB("simple_quantity", e.target.value)}
                placeholder="e.g. 50"
                style={errors.quantity ? inpError : inp}
              />
            </>
          )}
          <ErrorText msg={errors.quantity} />
        </div>

        {/* Storage Location */}
        <div style={field}>
          <label style={lbl}>Storage Location</label>
          <input value={batch.storage_location} onChange={e => setB("storage_location", e.target.value)} placeholder="e.g. Shelf A-3" style={inp} />
        </div>

        {/* Remarks */}
        <div style={field}>
          <label style={lbl}>Remarks{optionalTag}</label>
          <textarea
            value={form.remarks} onChange={e => set("remarks", e.target.value)}
            placeholder="Free-text notes about this item…" rows={2}
            style={{ ...inp, height: "auto", padding: "10px 12px", resize: "vertical", fontFamily: "inherit" }}
          />
        </div>

        {/* Total preview + Add to List */}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 20 }}>
          <div style={{
            flex: 1, background: t.surface2, borderRadius: 8, padding: "9px 14px",
            textAlign: "center", border: `1px solid ${errors.quantity ? "#dc2626" : t.border}`,
          }}>
            <span style={{ fontSize: 11, color: t.text3 }}>This item's total: </span>
            <span style={{ fontSize: 15, fontWeight: 900, color: totalPieces > 0 ? t.green : "#dc2626" }}>{totalPieces} pcs</span>
          </div>
          <button onClick={addToQueue} style={{
            padding: "11px 20px", borderRadius: 8, border: `1.5px dashed ${t.green}`,
            background: "transparent", color: t.green, fontSize: 13, fontWeight: 800,
            cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
          }}>+ Add to List</button>
        </div>

        {/* Queued items */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: t.green, marginBottom: 10 }}>Items to Add ({queue.length})</div>
          <div style={{ border: `1px solid ${t.border}`, borderRadius: 10, overflow: "hidden" }}>
            {queue.length === 0 ? (
              <div style={{ padding: 18, textAlign: "center", color: t.text3, fontSize: 12.5, fontStyle: "italic" }}>
                No items added yet — fill out the form above and click "Add to List".
              </div>
            ) : queue.map((q, i) => (
              <div key={q.key} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                borderBottom: i < queue.length - 1 ? `1px solid ${t.border}` : "none",
              }}>
                <span style={{
                  fontSize: 9.5, fontWeight: 800, padding: "2px 9px", borderRadius: 20, textTransform: "capitalize", flexShrink: 0,
                  background: q.category === "drugs" ? "#dbeafe" : "#fef3c7",
                  color: q.category === "drugs" ? "#1d4ed8" : "#b45309",
                }}>{q.category}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {q.form.generic_name}{q.form.dosage_strength ? ` · ${q.form.dosage_strength}` : ""}
                  </div>
                  <div style={{ fontSize: 11, color: t.text3 }}>{q.form.dosage_form} · {q.form.unit} · {q.batch.expiration_date ? `Exp ${q.batch.expiration_date}` : "No expiry"}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: t.green, flexShrink: 0 }}>{q.totalPieces} {q.isBoxUnit ? "pcs" : q.form.unit}</div>
                <button onClick={() => removeFromQueue(q.key)} style={{ border: "none", background: "none", color: "#d63031", fontSize: 16, cursor: "pointer", padding: 0, flexShrink: 0 }}>×</button>
              </div>
            ))}
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 12, justifyContent: onClose ? "flex-end" : "flex-start" }}>
          {onClose && (
            <button onClick={requestClose} style={{
              padding: "11px 26px", borderRadius: 10, border: `1.5px solid #fca5a5`,
              background: "transparent", color: "#dc2626", fontSize: 13, fontWeight: 800,
              cursor: "pointer", fontFamily: "inherit",
            }}>Cancel</button>
          )}
          <button onClick={handleConfirmAll} disabled={saving || queue.length === 0} style={{
            padding: "11px 28px", borderRadius: 10, border: "none",
            background: queue.length === 0 ? t.tableRowBorder : t.green,
            color: queue.length === 0 ? t.text3 : "#fff", fontSize: 13, fontWeight: 900,
            cursor: (saving || queue.length === 0) ? "not-allowed" : "pointer",
            fontFamily: "inherit", boxShadow: queue.length === 0 ? "none" : `0 6px 18px ${t.green}44`, opacity: saving ? 0.6 : 1,
            display: "flex", alignItems: "center", gap: 7,
          }}>
            {saving ? "SAVING…" : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Confirm {queue.length > 0 ? `(${queue.length})` : ""}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  if (onClose) {
    return (
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }}
      >
        <div
          style={{
            background: t.cardBg, borderRadius: 18, width: "min(680px, 96vw)", maxHeight: "none",
            overflow: "visible", padding: "26px 36px", boxShadow: "0 24px 60px rgba(0,0,0,0.4)", marginBottom: 40,
            position: "relative",
          }}
        >
          {formContent}

          {showDiscardConfirm && (
            <div
              onClick={e => e.stopPropagation()}
              style={{
                position: "absolute", inset: 0, borderRadius: 18, background: "rgba(0,0,0,0.45)",
                display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 10,
              }}
            >
              <div style={{
                background: t.cardBg, borderRadius: 14, padding: "22px 26px", width: "min(360px, 100%)",
                boxShadow: "0 16px 40px rgba(0,0,0,0.35)", border: `1px solid ${t.border}`,
              }}>
                <div style={{ fontSize: 15, fontWeight: 900, color: t.modalText, marginBottom: 6 }}>Discard everything?</div>
                <div style={{ fontSize: 12.5, color: t.text3, marginBottom: 18, lineHeight: 1.5 }}>
                  {queue.length > 0
                    ? `You have ${queue.length} item${queue.length !== 1 ? "s" : ""} in the list plus unsaved changes. Closing now will lose all of it.`
                    : "You have unsaved changes. Closing now will lose what you've entered."}
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setShowDiscardConfirm(false)}
                    style={{
                      padding: "9px 18px", borderRadius: 9, border: `1.5px solid ${t.inputBorder}`,
                      background: "transparent", color: t.modalText, fontSize: 12.5, fontWeight: 800,
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >Keep Editing</button>
                  <button
                    onClick={() => { setShowDiscardConfirm(false); setQueue([]); onClose?.(); }}
                    style={{
                      padding: "9px 18px", borderRadius: 9, border: "none",
                      background: "#dc2626", color: "#fff", fontSize: 12.5, fontWeight: 800,
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >Discard</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return <div style={{ maxWidth: 680 }}>{formContent}</div>;
}