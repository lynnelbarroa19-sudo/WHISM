'use client'
// app/warehouse/components/ManualRequestModal.tsx
//
// Lets Warehouse staff manually create a Pharmacy / Laboratory / Barangay
// request — typing in the medicines/supplies and who is requesting —
// instead of waiting for that department to submit one through their own
// module.
//
// The three source tables have DIFFERENT shapes:
//   pharmacy_requests / laboratory_requests — identical shape, have
//     brand_name + fund_source, no `barangay` column.
//   barangay_requests — no brand_name/fund_source, has `barangay`
//     instead (which barangay the request is for).
// So the form conditionally shows/hides fields based on the chosen
// source, and builds a row shape matching that source's real columns
// before inserting — inserting a column that doesn't exist on the
// target table would fail outright.
//
// All items typed in one submission share a single request_batch_id and
// are inserted with status: 'pending', so they flow through the exact
// same approval pipeline (Confirm / Alert / Reject / Receive) as any
// other request.
//
// This modal does NOT need to trigger a refetch on the page — the
// Requests page already has a realtime subscription across all three
// tables, so the new row(s) show up automatically the moment this
// insert succeeds.

import React, { useState } from 'react'
import { useTheme } from 'next-themes'
import { createClient } from '@supabase/supabase-js'
import { X, Plus, Trash2, Loader2, Pill, User, MapPin, Wallet, AlertTriangle, FileText, Check } from 'lucide-react'
import { T } from './SharedMedicine'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
)

type RequestSource = 'pharmacy' | 'laboratory' | 'barangay'
type RequestCategory = 'drugs' | 'supplies'
type FundSource = 'Gen. Fund' | 'Ekon' | 'PHO' | 'DOH'

const TABLE_BY_SOURCE: Record<RequestSource, string> = {
  pharmacy: 'pharmacy_requests',
  laboratory: 'laboratory_requests',
  barangay: 'barangay_requests',
}

type DraftItem = {
  key: string
  medicine_name: string
  dosage: string
  dosage_form: string
  brand_name: string // only used for pharmacy / laboratory
  category: RequestCategory
  requested_qty: string
  unit: string
}

const SOURCE_OPTIONS: { key: RequestSource; label: string; color: string }[] = [
  { key: 'pharmacy', label: 'Pharmacy', color: T.green },
  { key: 'laboratory', label: 'Laboratory', color: '#7c3aed' },
  { key: 'barangay', label: 'Barangay', color: '#ea580c' },
]

const CATEGORY_OPTIONS: { key: RequestCategory; label: string }[] = [
  { key: 'drugs', label: 'Drugs' },
  { key: 'supplies', label: 'Supplies' },
]

const FUND_SOURCE_OPTIONS: FundSource[] = ['Gen. Fund', 'Ekon', 'PHO', 'DOH']

const UNIT_OPTIONS = ['Pieces', 'Boxes', 'Strips', 'Bottles', 'Vials', 'Packs']

// Full barangay list (alphabetical) — used for the "Barangay" dropdown
// when source === 'barangay'.
const BARANGAY_OPTIONS = [
  'Bacungan', 'Bagacay', 'Banabahin Ibaba', 'Banabahin Ilaya', 'Bayabas',
  'Bebito', 'Bigajo', 'Binahian A', 'Binahian B', 'Binahian C', 'Bocboc',
  'Buenavista', 'Burgos (Poblacion)', 'Buyacanin', 'Cagacag', 'Calantipayan',
  'Canda Ibaba', 'Canda Ilaya', 'Cawayan', 'Cawayanin', 'Cogorin Ibaba',
  'Cogorin Ilaya', 'Concepcion', 'Danlagan (Poblacion)', 'De La Paz',
  'Del Pilar', 'Del Rosario', 'Esperanza Ibaba', 'Esperanza Ilaya',
  'Gomez (Poblacion)', 'Guihay', 'Guinuangan', 'Guites', 'Hondagua',
  'Ilayang Ilog A', 'Ilayang Ilog B', 'Inalusan', 'Jongo', 'Lalaguna',
  'Lourdes', 'Mabanban', 'Mabini', 'Magallanes', 'Magsaysay (Poblacion)',
  'Maguilayan', 'Mahayod-Hayod', 'Mal-ay', 'Mandoog', 'Manguisian',
  'Matinik', 'Monteclaro', 'New Calumpang', 'Pamampangin', 'Pansol',
  'Peñafrancia', 'Pisipis', 'Rizal (Poblacion)', 'Roma', 'Rosario',
  'Sabang', 'Samil', 'San Antonio', 'San Francisco A', 'San Francisco B',
  'San Isidro', 'San Jamil', 'San Jose', 'San Lorenzo Ruiz (Poblacion)',
  'San Pedro', 'San Rafael', 'San Roque', 'Santa Elena', 'Santa Jacobe',
  'Santa Lucia', 'Santa Maria', 'Santa Rosa', 'Santa Teresa',
  'Santo Niño Ibaba', 'Santo Niño Ilaya', 'Sugod', 'Sumilang', 'Talisay',
  'Talolong (Poblacion)', 'Tan-ag Ibaba', 'Tan-ag Ilaya', 'Tocalin',
  'Vegaflor', 'Veriña', 'Villa Aurora', 'Villa Consolidated', 'Villa Espina',
  'Villa Hermosa', 'Villa Jacobe', 'Villa Mercado', 'Villa Rojas',
]

function emptyItem(): DraftItem {
  return {
    key: Math.random().toString(36).slice(2),
    medicine_name: '',
    dosage: '',
    dosage_form: '',
    brand_name: '',
    category: 'drugs',
    requested_qty: '',
    unit: 'Pieces',
  }
}

/** Turns raw Postgres/Supabase error text into something a non-technical
 *  user can act on, while keeping the original message visible underneath
 *  in case it needs to be reported. */
function friendlyError(message: string, table: string): { title: string; detail: string } {
  if (message.includes('row-level security')) {
    return {
      title: `Hindi ma-save ang request — walang access permission sa "${table}" table.`,
      detail: `${message}. Kontakin ang admin para i-check ang RLS policy ng table na ito.`,
    }
  }
  if (message.includes('violates check constraint') || message.includes('violates foreign key')) {
    return {
      title: 'May hindi tugmang value sa isa sa fields.',
      detail: message,
    }
  }
  if (message.includes('column') && message.includes('does not exist')) {
    return {
      title: `Hindi tugma ang column names sa "${table}" table.`,
      detail: message,
    }
  }
  return {
    title: 'Hindi na-save ang request.',
    detail: message,
  }
}

export default function ManualRequestModal({ onClose }: { onClose: () => void }) {
  const { theme } = useTheme()
  const dk = theme === 'dark'

  const card = dk ? T.surfDk : T.surface
  const bg = dk ? T.bgDk : T.bg
  const bdr = dk ? T.borderDk : T.border
  const txt = dk ? T.textDk : T.text
  const txt2 = dk ? T.text2Dk : T.text2

  const [source, setSource] = useState<RequestSource>('pharmacy')
  const [requestedBy, setRequestedBy] = useState('')
  const [barangay, setBarangay] = useState('')
  const [fundSource, setFundSource] = useState<FundSource | ''>('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<DraftItem[]>([emptyItem()])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<{ title: string; detail: string } | null>(null)
  const [step, setStep] = useState<'form' | 'confirm'>('form')

  const isBarangay = source === 'barangay'

  const updateItem = (key: string, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  }
  const addItem = () => setItems((prev) => [...prev, emptyItem()])
  const removeItem = (key: string) =>
    setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.key !== key) : prev))

  const canSubmit =
    requestedBy.trim().length > 0 &&
    (!isBarangay || barangay.trim().length > 0) &&
    items.every((it) => it.medicine_name.trim().length > 0 && Number(it.requested_qty) > 0) &&
    !submitting

  const handleSave = () => {
    if (!canSubmit) return
    setStep('confirm')
  }

  const handleConfirmSubmit = async () => {
    setSubmitting(true)
    setError(null)

    const requestedAt = new Date().toISOString()
    const batchId = crypto.randomUUID()
    const table = TABLE_BY_SOURCE[source]

    const rows = items.map((it) => {
      const base = {
        medicine_name: it.medicine_name.trim(),
        dosage: it.dosage.trim() || null,
        dosage_form: it.dosage_form.trim() || null,
        category: it.category,
        requested_qty: Number(it.requested_qty),
        unit: it.unit,
        status: 'pending' as const,
        requested_by: requestedBy.trim(),
        requested_at: requestedAt,
        notes: notes.trim() || null,
        fulfilled_qty: null,
        request_batch_id: batchId,
      }

      if (isBarangay) {
        // barangay_requests: no brand_name / fund_source columns.
        return { ...base, barangay: barangay.trim() }
      }
      // pharmacy_requests / laboratory_requests: no `barangay` column.
      return {
        ...base,
        brand_name: it.brand_name.trim() || null,
        fund_source: fundSource || null,
      }
    })

    const { error: insertError } = await supabase.from(table).insert(rows)

    setSubmitting(false)
    if (insertError) {
      setError(friendlyError(insertError.message, table))
      return
    }
    onClose()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 20,
      }}
    >
      <style>{`@keyframes mrm-spin { to { transform: rotate(360deg); } }`}</style>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: card, borderRadius: T.radius, border: `1px solid ${bdr}`,
          width: '100%', maxWidth: 640, maxHeight: '88vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden',
          fontFamily: 'Nunito, sans-serif',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', background: T.green, flexShrink: 0 }}>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,0.75)', textTransform: 'uppercase', letterSpacing: 1.2 }}>{step === 'confirm' ? 'Review' : 'Warehouse'}</p>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: '#fff' }}>{step === 'confirm' ? 'Confirm Request' : 'Request Medicine'}</h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.18)', border: 'none', color: '#fff', cursor: 'pointer',
              padding: 7, borderRadius: 8, display: 'flex',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>

        {step === 'form' ? (
          <>
          {/* Source */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5 }}>Requesting From</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              {SOURCE_OPTIONS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSource(s.key)}
                  style={{
                    padding: '7px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    border: `1.5px solid ${source === s.key ? s.color : bdr}`,
                    background: source === s.key ? `${s.color}14` : 'transparent',
                    color: source === s.key ? s.color : txt2,
                  }}
                >{s.label}</button>
              ))}
            </div>
          </div>

          {/* Requested by + (conditionally) Barangay / Fund Source */}
          <div style={{ display: 'grid', gridTemplateColumns: isBarangay ? '1fr 1fr' : '1fr 1fr', gap: 8, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5 }}>Requested By</label>
              <input
                value={requestedBy}
                onChange={(e) => setRequestedBy(e.target.value)}
                placeholder="Name of requester"
                style={{
                  width: '100%', boxSizing: 'border-box', marginTop: 6, padding: '9px 12px',
                  borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 13, outline: 'none',
                  color: txt, background: bg,
                }}
              />
            </div>

            {isBarangay ? (
              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5 }}>Barangay</label>
                <select
                  value={barangay}
                  onChange={(e) => setBarangay(e.target.value)}
                  style={{
                    width: '100%', boxSizing: 'border-box', marginTop: 6, padding: '9px 12px',
                    borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 13, outline: 'none',
                    color: txt, background: bg,
                  }}
                >
                  <option value="">— Select barangay —</option>
                  {BARANGAY_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5 }}>Fund Source (optional)</label>
                <select
                  value={fundSource}
                  onChange={(e) => setFundSource(e.target.value as FundSource | '')}
                  style={{
                    width: '100%', boxSizing: 'border-box', marginTop: 6, padding: '9px 12px',
                    borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 13, outline: 'none',
                    color: txt, background: bg,
                  }}
                >
                  <option value="">— None —</option>
                  {FUND_SOURCE_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Items */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5 }}>Medicines / Supplies</label>
              <button
                onClick={addItem}
                style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: T.green, fontSize: 12, fontWeight: 800 }}
              ><Plus size={14} /> Add item</button>
            </div>

            {items.map((it, idx) => (
              <div key={it.key} style={{ border: `1px solid ${bdr}`, borderRadius: T.radiusSm, padding: 12, marginBottom: 8, background: bg }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: txt2 }}>Item {idx + 1}</span>
                  {items.length > 1 && (
                    <button onClick={() => removeItem(it.key)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.red, display: 'flex' }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: isBarangay ? '1fr 1fr' : '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <input
                    value={it.medicine_name}
                    onChange={(e) => updateItem(it.key, { medicine_name: e.target.value })}
                    placeholder="Medicine / item name"
                    style={{ padding: '8px 10px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 12, outline: 'none', color: txt, background: card }}
                  />
                  <input
                    value={it.dosage}
                    onChange={(e) => updateItem(it.key, { dosage: e.target.value })}
                    placeholder="Dosage (optional)"
                    style={{ padding: '8px 10px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 12, outline: 'none', color: txt, background: card }}
                  />
                  {!isBarangay && (
                    <input
                      value={it.brand_name}
                      onChange={(e) => updateItem(it.key, { brand_name: e.target.value })}
                      placeholder="Brand name (optional)"
                      style={{ padding: '8px 10px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 12, outline: 'none', color: txt, background: card }}
                    />
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <input
                    value={it.dosage_form}
                    onChange={(e) => updateItem(it.key, { dosage_form: e.target.value })}
                    placeholder="Form (tablet, syrup...) optional"
                    style={{ padding: '8px 10px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 12, outline: 'none', color: txt, background: card }}
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    {CATEGORY_OPTIONS.map((c) => (
                      <button
                        key={c.key}
                        onClick={() => updateItem(it.key, { category: c.key })}
                        style={{
                          flex: 1, padding: '8px 0', borderRadius: T.radiusSm, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                          border: `1.5px solid ${it.category === c.key ? T.green : bdr}`,
                          background: it.category === c.key ? T.greenLight : card,
                          color: it.category === c.key ? T.greenDark : txt2,
                        }}
                      >{c.label}</button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input
                    type="number"
                    min={1}
                    value={it.requested_qty}
                    onChange={(e) => updateItem(it.key, { requested_qty: e.target.value })}
                    placeholder="Quantity"
                    style={{ padding: '8px 10px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 12, outline: 'none', color: txt, background: card }}
                  />
                  <select
                    value={it.unit}
                    onChange={(e) => updateItem(it.key, { unit: e.target.value })}
                    style={{ padding: '8px 10px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 12, outline: 'none', color: txt, background: card }}
                  >
                    {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>

          {/* Notes */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5 }}>Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for this request..."
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box', marginTop: 6, padding: '9px 12px',
                borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`, fontSize: 13, outline: 'none',
                color: txt, background: bg, resize: 'vertical', fontFamily: 'Nunito, sans-serif',
              }}
            />
          </div>
          </>
        ) : (
          // ── Confirm step — read-only summary of everything typed in
          // the form, so staff can double-check before it actually
          // gets inserted. Nothing is submitted until "Confirm Request".
          <>
            <div style={{ marginBottom: 18 }}>
              <span style={{
                display: 'inline-block', padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 800,
                background: `${SOURCE_OPTIONS.find((s) => s.key === source)!.color}14`,
                color: SOURCE_OPTIONS.find((s) => s.key === source)!.color,
                border: `1px solid ${SOURCE_OPTIONS.find((s) => s.key === source)!.color}33`,
              }}>
                {SOURCE_OPTIONS.find((s) => s.key === source)!.label} Request
              </span>
            </div>

            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18,
              padding: 14, borderRadius: T.radiusSm, background: bg, border: `1px solid ${bdr}`,
            }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: T.greenLight, color: T.green, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <User size={14} />
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5 }}>Requested By</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: txt, marginTop: 2 }}>{requestedBy.trim()}</div>
                </div>
              </div>

              {isBarangay ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: '#ea580c14', color: '#ea580c', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <MapPin size={14} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5 }}>Barangay</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: txt, marginTop: 2 }}>{barangay}</div>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: `${T.green}14`, color: T.green, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Wallet size={14} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5 }}>Fund Source</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: txt, marginTop: 2 }}>{fundSource || 'Not specified'}</div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                {items.length} Item{items.length !== 1 ? 's' : ''} to Request
              </div>
              {items.map((it) => (
                <div key={it.key} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  border: `1px solid ${bdr}`, borderRadius: T.radiusSm, padding: 12, marginBottom: 8, background: bg,
                }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: T.greenLight, color: T.green, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Pill size={15} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: txt }}>
                        {it.medicine_name.trim()}{it.brand_name.trim() ? ` (${it.brand_name.trim()})` : ''}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap',
                        background: it.category === 'drugs' ? T.greenLight : '#dbeafe',
                        color: it.category === 'drugs' ? T.greenDark : '#1e40af',
                      }}>{it.category === 'drugs' ? 'Drugs' : 'Supplies'}</span>
                    </div>
                    <div style={{ fontSize: 12, color: txt2, marginTop: 3 }}>
                      {[it.dosage.trim(), it.dosage_form.trim()].filter(Boolean).join(' · ') || 'No dosage / form specified'}
                    </div>
                    <div style={{
                      display: 'inline-block', fontSize: 11, color: txt, fontWeight: 800, marginTop: 6,
                      padding: '2px 9px', borderRadius: 20, background: card, border: `1px solid ${bdr}`,
                    }}>
                      {it.requested_qty} {it.unit}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {notes.trim() && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: `${T.green}14`, color: T.green, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <FileText size={14} />
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5 }}>Notes</div>
                  <div style={{ fontSize: 13, color: txt, marginTop: 2 }}>{notes.trim()}</div>
                </div>
              </div>
            )}
          </>
        )}

          {error && (
            <div style={{
              marginTop: 12, padding: '12px 14px', borderRadius: T.radiusSm,
              background: T.redLight, border: `1px solid ${T.redBorder}`,
              display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              <AlertTriangle size={16} style={{ color: T.red, flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ color: T.red, fontSize: 12, fontWeight: 800 }}>{error.title}</div>
                <div style={{ color: T.red, fontSize: 11, fontWeight: 500, marginTop: 2, opacity: 0.85 }}>{error.detail}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '14px 20px', borderTop: `1px solid ${bdr}`, background: card }}>
          {step === 'form' ? (
            <>
              <button
                onClick={onClose}
                style={{ padding: '9px 20px', borderRadius: 20, border: `1.5px solid ${T.red}66`, background: 'transparent', color: T.red, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
              >Cancel</button>
              <button
                onClick={handleSave}
                disabled={!canSubmit}
                style={{
                  padding: '9px 22px', borderRadius: 20, border: 'none', cursor: canSubmit ? 'pointer' : 'not-allowed',
                  background: T.green, color: '#fff', fontSize: 12, fontWeight: 800, opacity: canSubmit ? 1 : 0.5,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              ><Check size={14} /> Save</button>
            </>
          ) : (
            <>
              <button
                onClick={() => { setError(null); setStep('form') }}
                disabled={submitting}
                style={{ padding: '9px 20px', borderRadius: 20, border: `1.5px solid ${T.red}66`, background: 'transparent', color: T.red, fontSize: 12, fontWeight: 800, cursor: submitting ? 'not-allowed' : 'pointer' }}
              >Back</button>
              <button
                onClick={handleConfirmSubmit}
                disabled={submitting}
                style={{
                  padding: '9px 22px', borderRadius: 20, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer',
                  background: T.green, color: '#fff', fontSize: 12, fontWeight: 800, opacity: submitting ? 0.7 : 1,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {submitting ? <Loader2 size={14} style={{ animation: 'mrm-spin 0.8s linear infinite' }} /> : <Check size={14} />}
                {submitting ? 'Submitting...' : 'Confirm Request'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}