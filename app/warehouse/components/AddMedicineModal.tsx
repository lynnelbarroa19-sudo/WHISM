'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  T, DRUG_TYPES, SUPPLY_TYPES, SOURCE_OPTIONS,
  computeStatus, sanitizeNonNegativeInt, IconCheck,
  type Tab,
} from './SharedMedicine'

interface AddMedicineModalProps {
  /** Controls visibility of the modal */
  show: boolean
  /** Called when the modal should close without saving (backdrop click, X, Cancel) */
  onClose: () => void
  /** Called after a successful insert, so the parent can refetch its list */
  onAdded: () => void
  /** Parent's toast helper, so success/error messages use the same toast UI */
  showToast: (msg: string) => void
  /** Which tab was active when "Add" was clicked — decides drug vs supply category & labels */
  activeTab: Tab
  /** Dark mode flag, forwarded from the parent so styling matches */
  dk: boolean
}

const blankForm = {
  genericName: '', brandName: '', dosageStrength: '', dosageForm: '',
  unit: '', manufacturer: '', source: '' as '' | 'DOH' | 'PhilHealth' | 'LGU', batchNumber: '',
  manufactureDate: '', expDate: '',
  boxes: '', stripsPerBox: '', piecesPerStrip: '',
  storageLocation: '', dateReceived: new Date().toISOString().split('T')[0], remarks: '',
  category: '' as '' | 'drug' | 'supply',
}

// '' -> null, otherwise trimmed string. Keeps matching consistent with how we
// insert into `medicines` (empty inputs are stored as NULL, not '').
const normOrNull = (s: string) => {
  const t = s.trim()
  return t === '' ? null : t
}

// yyyy-mm-dd string arithmetic (safe here since dates are always ISO 'date' inputs)
const addDaysStr = (dateStr: string, days: number) => {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}
const minStr = (a: string, b: string) => (a < b ? a : b)

export default function AddMedicineModal({ show, onClose, onAdded, showToast, activeTab, dk }: AddMedicineModalProps) {
  const [form, setForm] = useState(blankForm)
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const bg     = dk ? T.bgDk    : T.bg
  const card   = dk ? T.surfDk  : T.surface
  const card2  = dk ? T.surf2Dk : T.surface2
  const bdr    = dk ? T.borderDk : T.border
  const txt    = dk ? T.textDk  : T.text
  const txt2   = dk ? T.text2Dk : T.text2
  const shadow = dk ? T.shadowDk : T.shadow

  // The active tab picks the default when the modal first opens, but the
  // person can override it with the Category dropdown below — that
  // selection (not the tab) is what actually decides drug vs supply from
  // here on out.
  const effectiveCategory: 'drug' | 'supply' =
    form.category || (activeTab === 'supply' ? 'supply' : 'drug')
  const isSupplyTab = effectiveCategory === 'supply'
  const typeOptions = isSupplyTab ? SUPPLY_TYPES : DRUG_TYPES
  const dosageLabel = isSupplyTab ? 'Specification' : 'Mg / Dosage'
  const todayStr = new Date().toISOString().split('T')[0]   // dates can never be before this

  // Manufacture date must be before the expiration date, and can't be in the
  // future. If an EXP date is already set, cap manufacture date at the day
  // before it; otherwise cap at today.
  const maxManufactureDate = form.expDate
    ? minStr(todayStr, addDaysStr(form.expDate, -1))
    : todayStr

  // Guards against closing mid-save: an in-flight insert would keep running
  // after the modal unmounts, but the person would see the modal vanish with
  // no feedback — safer to just block the close until the save settles.
  const resetAndClose = () => {
    if (isSaving) return
    setForm(blankForm)
    setTypeDropdownOpen(false)
    onClose()
  }

  // ── Look for an existing, non-archived `medicines` row that matches what the
  // user typed, so we never create a duplicate identity row for the same item.
  // Matched on generic_name + brand_name + dosage_strength + dosage_form +
  // category, all matched exactly (case-insensitive).
  const findExistingMedicineId = async (category: 'drug' | 'supply'): Promise<string | null> => {
    const genericName = normOrNull(form.genericName)
    if (!genericName) return null

    let query = supabase
      .from('medicines')
      .select('medicine_id')
      .ilike('generic_name', genericName)
      .eq('category', category)
      .eq('is_archived', false)

    const brandName = normOrNull(form.brandName)
    query = brandName ? query.ilike('brand_name', brandName) : query.is('brand_name', null)

    const dosageStrength = normOrNull(form.dosageStrength)
    query = dosageStrength ? query.ilike('dosage_strength', dosageStrength) : query.is('dosage_strength', null)

    const dosageForm = normOrNull(form.dosageForm)
    query = dosageForm ? query.ilike('dosage_form', dosageForm) : query.is('dosage_form', null)

    const { data, error } = await query.limit(1)
    if (error) {
      console.error('Duplicate-check lookup failed:', error)
      return null
    }
    return data && data.length > 0 ? data[0].medicine_id : null
  }

  // ── Add medicine → reuse an existing `medicines` row if one matches (no
  // duplication), otherwise insert a new one, then always insert a new
  // `medicine_batches` row (that's the actual stock being added) ──
  const handleAdd = async () => {
    const genericNameTrimmed = form.genericName.trim()
    if (!genericNameTrimmed || isSaving) return

    // Manufacture date is required, and must be strictly before the
    // expiration date. The "before EXP" part is also enforced live via the
    // `max` attribute on the input, but we guard again here in case both
    // fields were set before either was clamped.
    if (!form.manufactureDate) {
      showToast('Error: Manufacture date is required')
      return
    }
    if (form.expDate && form.manufactureDate >= form.expDate) {
      showToast('Error: Manufacture date must be before the expiration date')
      return
    }

    setIsSaving(true)

    const boxes = Math.max(0, Number(form.boxes) || 0)

    // strips_per_box / pieces_per_strip are nullable in the DB — not every
    // item ships in strips (e.g. bottles, masks). Blank input -> null,
    // not 0, so the CHECK constraints (which allow NULL) and the
    // total_quantity formula (COALESCE(..., 0)) treat it the same way.
    //
    // Medical Supplies never have a strip breakdown at all — that concept
    // only applies to drugs (e.g. a strip of tablets inside a box). For
    // supplies, "Strips / Box" is never shown to the user and is always
    // treated as blank/null here, regardless of whatever value may still be
    // sitting in form state from a prior category switch.
    const stripsPerBox   = isSupplyTab
      ? null
      : (form.stripsPerBox.trim() === '' ? null : Math.max(0, Number(form.stripsPerBox) || 0))
    const piecesPerStrip = form.piecesPerStrip.trim() === '' ? null : Math.max(1, Number(form.piecesPerStrip) || 1)

    // total_quantity = boxes × strips_per_box × pieces_per_strip (the DB's
    // GENERATED column only accounts for full boxes — there's no loose-stock
    // tracking in this schema). If Boxes is entered but pieces_per_strip is
    // left blank, that entire quantity silently multiplies by 0 in the DB
    // and never counts toward stock — block the save instead of letting it
    // disappear silently.
    if (boxes > 0 && piecesPerStrip === null) {
      showToast(
        isSupplyTab
          ? 'Error: "Pcs / Box" is required when Boxes is entered — it converts boxes into countable pieces.'
          : 'Error: "Pcs / Strip" is required when Boxes is entered — it converts boxes into countable pieces. If this item isn\'t packaged in strips, just enter the pieces-per-box count here and leave "Strips / Box" blank (it defaults to 1).'
      )
      setIsSaving(false)
      return
    }

    // If pieces_per_strip is set but strips_per_box was left blank, treat the
    // whole box as "1 strip" so boxes still convert correctly — this covers
    // items that aren't actually divided into strips (e.g. a box of 100 loose
    // tablets, entered as strips_per_box blank + pieces_per_strip = 100), and
    // is always the case for Medical Supplies since they never have strips.
    const effectiveStripsPerBox = stripsPerBox === null && piecesPerStrip !== null ? 1 : stripsPerBox

    // Mirrors the DB's generated total_quantity column, for computeStatus only —
    // the DB computes and stores its own value, this is never sent on insert.
    const totalQty = boxes * (effectiveStripsPerBox ?? 0) * (piecesPerStrip ?? 0)

    const todayStrNow   = new Date().toISOString().split('T')[0]
    const safeExpDate      = form.expDate && form.expDate >= todayStrNow ? form.expDate : todayStrNow
    const safeDateReceived = form.dateReceived && form.dateReceived >= todayStrNow ? form.dateReceived : todayStrNow

    const { data: userData } = await supabase.auth.getUser()
    const userId = userData?.user?.id || null

    // Category now comes from the explicit dropdown (falling back to the
    // active tab if the person never touched it), not the tab alone.
    const category: 'drug' | 'supply' = effectiveCategory

    // 0) Check for an existing match first — avoids duplicate `medicines` rows
    //    when the same item is being restocked.
    const existingMedicineId = await findExistingMedicineId(category)

    let medicineId: string | null = existingMedicineId
    let createdNewMedicine = false

    if (!medicineId) {
      // 1) No match found — insert the medicine "identity" row
      const { data: medRow, error: medError } = await supabase
        .from('medicines')
        .insert({
          generic_name: genericNameTrimmed,
          brand_name: form.brandName || null,
          dosage_strength: form.dosageStrength || null,
          dosage_form: form.dosageForm || null,
          category,
          unit: form.unit || null,
          manufacturer: form.manufacturer || null,
          manufacture_date: form.manufactureDate || null,
          // reorder_level omitted — DB default (0) applies
          // status omitted — DB default ('active') applies; medicines.status is
          // active/inactive/discontinued only, NOT the stock-level status
          remarks: form.remarks || null,
          is_archived: false,
          created_by: userId,
        })
        .select('medicine_id')
        .single()

      if (medError || !medRow) {
        console.error('Insert medicine failed:', medError)
        showToast(`Error: ${medError?.message || 'Failed to add item'}`)
        setIsSaving(false)
        return
      }

      medicineId = medRow.medicine_id
      createdNewMedicine = true
    }

    // 2) Insert the batch/stock row, linked via medicine_id (existing or new)
    const { error: batchError } = await supabase.from('medicine_batches').insert({
      medicine_id: medicineId,
      source: form.source || null,
      batch_number: form.batchNumber || null,
      expiration_date: form.expDate || null,
      boxes,
      strips_per_box: effectiveStripsPerBox,
      pieces_per_strip: piecesPerStrip,
      // total_quantity is GENERATED ALWAYS — do NOT send it
      storage_location: form.storageLocation || null,
      status: computeStatus(totalQty, form.expDate || null),
      date_received: form.dateReceived || null,
      remarks: form.remarks || null,
      created_by: userId,
    })

    if (!batchError) {
      setForm(blankForm)
      showToast(
        createdNewMedicine
          ? (category === 'supply' ? 'Supply added successfully!' : 'Medicine added successfully!')
          : 'Existing item found — new stock batch added!'
      )
      onAdded()
      onClose()
    } else {
      console.error('Insert medicine_batches failed:', batchError)
      showToast(`Error: ${batchError.message || 'Failed to add stock batch'}`)
      // rollback: only delete the medicine row if WE just created it —
      // never delete a pre-existing medicine just because its new batch failed
      if (createdNewMedicine && medicineId) {
        await supabase.from('medicines').delete().eq('medicine_id', medicineId)
      }
    }
    setIsSaving(false)
  }

  if (!show) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 3000, padding: 16,
    }} onClick={resetAndClose}>
      <div style={{
        background: card, borderRadius: T.radius,
        width: '100%', maxWidth: 600, maxHeight: '92vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: shadow, border: `1px solid ${bdr}`,
      }} onClick={e => e.stopPropagation()}>

        {/* Modal header */}
        <div style={{
          background: T.greenDark, padding: '18px 22px',
          flexShrink: 0,
          borderBottom: `2px solid ${T.mint}`,
        }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Warehouse</div>
          <h2 style={{ color: '#fff', margin: 0, fontSize: 17, fontWeight: 800 }}>
            Add {isSupplyTab ? 'Supply' : 'Medicine'}
          </h2>
        </div>

        {/* Modal body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px', background: bg, display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Category — lets the person file this item as a drug or a
              supply regardless of which tab the modal was opened from. */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>
              Category
            </label>
            <select
              value={effectiveCategory}
              onChange={e => {
                const nextCategory = e.target.value as 'drug' | 'supply'
                // Switching category changes which Type list applies, so
                // clear a Type value that no longer belongs to that list.
                const nextTypeOptions = nextCategory === 'supply' ? SUPPLY_TYPES : DRUG_TYPES
                const dosageFormStillValid = nextTypeOptions.some(
                  t => t.toLowerCase() === form.dosageForm.toLowerCase()
                )
                setForm({
                  ...form,
                  category: nextCategory,
                  dosageForm: dosageFormStillValid ? form.dosageForm : '',
                  // Supplies never use a strip breakdown — clear any
                  // leftover Strips/Box value so it can't silently carry
                  // over from a previous Medical Drugs entry.
                  stripsPerBox: nextCategory === 'supply' ? '' : form.stripsPerBox,
                })
              }}
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 13, background: card, color: txt, outline: 'none' }}
            >
              <option value="drug">Medical Drugs</option>
              <option value="supply">Medical Supplies</option>
            </select>
          </div>

          {/* Generic + Brand name */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>
                {isSupplyTab ? 'Supply Name' : 'Generic Name'}
              </label>
              <input type="text" placeholder={isSupplyTab ? 'e.g. Surgical Gloves' : 'e.g. Paracetamol'}
                value={form.genericName}
                onChange={e => setForm({ ...form, genericName: e.target.value })}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 13, background: card, color: txt, outline: 'none', transition: 'border 0.15s' }}
                onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>
                Brand Name <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.6 }}>(optional)</span>
              </label>
              <input type="text" placeholder="e.g. Biogesic"
                value={form.brandName}
                onChange={e => setForm({ ...form, brandName: e.target.value })}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 13, background: card, color: txt, outline: 'none', transition: 'border 0.15s' }}
                onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
              />
            </div>
          </div>

          {/* Dosage strength + Unit */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>
                {isSupplyTab ? 'Specification' : 'Mg / Dosage'}
              </label>
              <input type="text" placeholder={isSupplyTab ? 'e.g. Large, 1 inch x 10 yards' : 'e.g. 500mg'}
                value={form.dosageStrength}
                onChange={e => setForm({ ...form, dosageStrength: e.target.value })}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 13, background: card, color: txt, outline: 'none', transition: 'border 0.15s' }}
                onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Unit</label>
              <input type="text" placeholder="e.g. Piece, Box, Bottle"
                value={form.unit}
                onChange={e => setForm({ ...form, unit: e.target.value })}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 13, background: card, color: txt, outline: 'none', transition: 'border 0.15s' }}
                onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
              />
            </div>
          </div>

          {/* Type combobox (dosage_form) */}
          <div style={{ position: 'relative' }}>
            <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Type</label>
            <input
              type="text" placeholder="Search or type a new type..."
              value={form.dosageForm}
              onFocus={() => setTypeDropdownOpen(true)}
              onChange={e => { setForm({ ...form, dosageForm: e.target.value }); setTypeDropdownOpen(true) }}
              onBlur={() => setTimeout(() => setTypeDropdownOpen(false), 120)}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '9px 12px', borderRadius: T.radiusSm,
                border: `1.5px solid ${bdr}`, fontSize: 13,
                background: card, color: txt, outline: 'none', transition: 'border 0.15s',
              }}
            />
            {typeDropdownOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
                background: card, border: `1.5px solid ${T.green}`,
                borderRadius: T.radiusSm, boxShadow: shadow, overflow: 'hidden',
              }}>
                {typeOptions.filter(t => t.toLowerCase().includes(form.dosageForm.toLowerCase())).map(t => (
                  <button key={t} type="button"
                    onMouseDown={() => { setForm({ ...form, dosageForm: t }); setTypeDropdownOpen(false) }}
                    style={{
                      width: '100%', padding: '9px 14px', textAlign: 'left',
                      border: 'none', background: 'transparent', cursor: 'pointer',
                      fontSize: 13, color: txt, fontWeight: 600,
                      borderBottom: `1px solid ${bdr}`,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = T.greenLight)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >{t}</button>
                ))}
                {form.dosageForm && !typeOptions.some(t => t.toLowerCase() === form.dosageForm.toLowerCase()) && (
                  <button type="button" onMouseDown={() => setTypeDropdownOpen(false)}
                    style={{ width: '100%', padding: '9px 14px', textAlign: 'left', border: 'none', background: T.greenLight, cursor: 'pointer', fontSize: 13, color: T.greenDark, fontWeight: 700 }}>
                    Use "{form.dosageForm}"
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Manufacturer + Batch number */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Manufacturer <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.6 }}>(optional)</span></label>
              <input type="text" placeholder="e.g. Unilab"
                value={form.manufacturer}
                onChange={e => setForm({ ...form, manufacturer: e.target.value })}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 13, background: card, color: txt, outline: 'none', transition: 'border 0.15s' }}
                onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Batch Number <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.6 }}></span></label>
              <input type="text" placeholder="e.g. B-2026-0451"
                value={form.batchNumber}
                onChange={e => setForm({ ...form, batchNumber: e.target.value })}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 13, background: card, color: txt, outline: 'none', transition: 'border 0.15s' }}
                onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
              />
            </div>
          </div>

          {/* Source dropdown — fixed 3 options, full names, values match the DB CHECK constraint */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Source <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.6 }}></span></label>
            <select
              value={form.source}
              onChange={e => setForm({ ...form, source: e.target.value as typeof form.source })}
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 13, background: card, color: txt, outline: 'none' }}
            >
              <option value="">— Select source —</option>
              {SOURCE_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Manufacture Date + EXP Date + Date Received.
              Manufacture date is capped so it can never land on/after EXP
              date, and never in the future. EXP/Date Received keep their
              existing "never in the past" rule. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>
                Manufacture Date
              </label>
              <input type="date" value={form.manufactureDate} max={maxManufactureDate}
                onChange={e => {
                  const v = e.target.value
                  setForm({ ...form, manufactureDate: v > maxManufactureDate ? maxManufactureDate : v })
                }}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 13, background: card, color: txt, outline: 'none', transition: 'border 0.15s' }}
                onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>EXP Date</label>
              <input type="date" value={form.expDate} min={form.manufactureDate ? addDaysStr(form.manufactureDate, 1) : todayStr}
                onChange={e => {
                  const floor = form.manufactureDate ? addDaysStr(form.manufactureDate, 1) : todayStr
                  const v = e.target.value < floor ? floor : e.target.value
                  setForm({ ...form, expDate: v })
                }}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 13, background: card, color: txt, outline: 'none', transition: 'border 0.15s' }}
                onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Date Received</label>
              <input type="date" value={form.dateReceived} min={todayStr}
                onChange={e => setForm({ ...form, dateReceived: e.target.value < todayStr ? todayStr : e.target.value })}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 13, background: card, color: txt, outline: 'none', transition: 'border 0.15s' }}
                onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
              />
            </div>
          </div>

          {/* Boxes / Strips per box / Pcs per strip — negative numbers blocked.
              Medical Supplies never have a strip breakdown, so that field is
              only shown for Medical Drugs: supplies get just Boxes + Pcs/Box
              (piecesPerStrip doubling as "pieces per box" via
              effectiveStripsPerBox = 1). Drugs keep all three fields, with
              Strips/Box optional (leave blank if the item isn't divided into
              strips). This is the only stock breakdown the DB supports —
              there's no loose-strip / loose-piece tracking outside of full
              boxes. */}
          <div style={{ display: 'grid', gridTemplateColumns: isSupplyTab ? '1fr 1fr' : '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Boxes</label>
              <input type="number" min={0} step={1} placeholder="e.g. 12"
                value={form.boxes}
                onChange={e => setForm({ ...form, boxes: sanitizeNonNegativeInt(e.target.value) })}
                onKeyDown={e => { if (e.key === '-' || e.key === 'e' || e.key === '+') e.preventDefault() }}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 13, background: card, color: txt, outline: 'none', transition: 'border 0.15s' }}
                onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
              />
            </div>
            {!isSupplyTab && (
              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Strips / Box</label>
                <input type="number" min={0} step={1} placeholder="optional — leave blank if 1"
                  value={form.stripsPerBox}
                  onChange={e => setForm({ ...form, stripsPerBox: sanitizeNonNegativeInt(e.target.value) })}
                  onKeyDown={e => { if (e.key === '-' || e.key === 'e' || e.key === '+') e.preventDefault() }}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 13, background: card, color: txt, outline: 'none', transition: 'border 0.15s' }}
                  onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                  onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
                />
              </div>
            )}
            <div>
              <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>
                {isSupplyTab ? 'Pcs / Box' : 'Pcs / Strip'}
              </label>
              <input type="number" min={0} step={1} placeholder={isSupplyTab ? 'e.g. 10' : 'e.g. 10 (or pcs/box if no strips)'}
                value={form.piecesPerStrip}
                onChange={e => setForm({ ...form, piecesPerStrip: sanitizeNonNegativeInt(e.target.value) })}
                onKeyDown={e => { if (e.key === '-' || e.key === 'e' || e.key === '+') e.preventDefault() }}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 13, background: card, color: txt, outline: 'none', transition: 'border 0.15s' }}
                onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
              />
            </div>
          </div>

          {/* Storage location */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Storage Location <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.6 }}></span></label>
            <input type="text" placeholder="e.g. Shelf A-3"
              value={form.storageLocation}
              onChange={e => setForm({ ...form, storageLocation: e.target.value })}
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 13, background: card, color: txt, outline: 'none', transition: 'border 0.15s' }}
              onFocus={e => (e.currentTarget.style.borderColor = T.green)}
              onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
            />
          </div>

          {/* Remarks */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>
              Remarks <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.6 }}>(optional)</span>
            </label>
            <textarea
              placeholder="Free-text notes about this item..." rows={3}
              value={form.remarks}
              onChange={e => setForm({ ...form, remarks: e.target.value })}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '9px 12px', borderRadius: T.radiusSm,
                border: `1.5px solid ${bdr}`, fontSize: 13,
                background: card, color: txt, outline: 'none',
                resize: 'vertical', fontFamily: 'Nunito, sans-serif',
                transition: 'border 0.15s',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = T.green)}
              onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
            />
          </div>
        </div>

        {/* Modal footer */}
        <div style={{
          padding: '14px 22px', borderTop: `1px solid ${bdr}`,
          background: card2, display: 'flex', gap: 10, flexShrink: 0, justifyContent: 'flex-end',
        }}>
          <button onClick={resetAndClose} disabled={isSaving} style={{
            padding: '10px 24px', borderRadius: T.radius,
            border: `1.5px solid ${T.redBorder}`,
            background: 'transparent', color: T.red,
            fontSize: 13, fontWeight: 800,
            cursor: isSaving ? 'not-allowed' : 'pointer',
            opacity: isSaving ? 0.5 : 1,
            transition: 'all 0.15s',
          }}
            onMouseEnter={e => (e.currentTarget.style.background = T.redLight)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >Cancel</button>
          <button onClick={handleAdd} disabled={isSaving} style={{
            padding: '10px 28px', borderRadius: T.radius,
            background: T.greenMid, color: '#fff', border: 'none',
            fontSize: 13, fontWeight: 800,
            cursor: isSaving ? 'not-allowed' : 'pointer',
            opacity: isSaving ? 0.6 : 1,
            boxShadow: `0 6px 20px ${T.green}44`,
            display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s',
          }}>
            <IconCheck /> {isSaving ? 'Saving...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}