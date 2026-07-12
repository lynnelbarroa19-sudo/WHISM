'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import styles from './warehouse.module.css'
import { logAction } from "@/app/utils/auditLogs";

interface MedicineOption {
  id: string
  med_name: string
  med_type: string
  med_dosage: string
  quantity: number
  boxes: number
  unit: string
  exp_date: string
  category: 'drug' | 'supply'
}

interface MedicineRow {
  id: string
  med_name: string
  med_type: string
  med_dosage: string
  quantity: string
  availableStock: number
  availableBoxes: number
  searchQuery: string
  showDropdown: boolean
  unit: string
  exp_date: string
  category: 'drug' | 'supply' | ''
  notes: string
}

interface Props {
  onClose: () => void
  onSuccess: () => void
}

function generateId() {
  return Math.random().toString(36).substr(2, 9)
}

function blankRow(): MedicineRow {
  return {
    id: generateId(), med_name: '', med_type: '', med_dosage: '',
    quantity: '', availableStock: 0, availableBoxes: 0,
    searchQuery: '', showDropdown: false,
    unit: '', exp_date: '', category: '', notes: '',
  }
}

export default function DispenseMedicineModal({ onClose, onSuccess }: Props) {
  const [allMedicines, setAllMedicines] = useState<MedicineOption[]>([])
  const [medicines, setMedicines] = useState<MedicineRow[]>([blankRow()])
  const [brgy, setBrgy] = useState('')
  const [dispensedTo, setDispensedTo] = useState('')
  const [dispensedDate, setDispensedDate] = useState(new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => { fetchAllMedicines() }, [])

  const fetchAllMedicines = async () => {
    const { data } = await supabase
      .from('warehouse_medicines')
      .select('id, med_name, med_type, med_dosage, quantity, boxes, unit, exp_date, category')
      .eq('archived', false)
      .gt('boxes', 0)
      .order('med_name', { ascending: true })
    setAllMedicines(data || [])
  }

  const getFilteredMeds = (query: string) => {
    if (!query.trim()) return allMedicines
    return allMedicines.filter(m =>
      m.med_name.toLowerCase().includes(query.toLowerCase())
    )
  }

  const updateRow = (id: string, fields: Partial<MedicineRow>) => {
    setMedicines(prev => prev.map(m => m.id === id ? { ...m, ...fields } : m))
  }

  const handleSelectMed = (rowId: string, med: MedicineOption) => {
    updateRow(rowId, {
      med_name: med.med_name,
      med_type: med.med_type || '',
      med_dosage: med.med_dosage || '',
      availableStock: med.quantity,
      availableBoxes: med.boxes,
      searchQuery: med.med_name,
      showDropdown: false,
      unit: med.unit || '',
      exp_date: med.exp_date || '',
      category: med.category || '',
    })
  }

  const addRow = () => {
    setMedicines(prev => [blankRow(), ...prev])
  }

  const removeRow = (id: string) => {
    if (medicines.length === 1) return
    setMedicines(prev => prev.filter(m => m.id !== id))
  }

  const requestConfirm = () => {
    const validMeds = medicines.filter(m => m.med_name.trim() && m.quantity)
    if (validMeds.length === 0) { setError('Add at least one medicine with name and quantity.'); return }
    if (!brgy) { setError('Barangay is required.'); return }

    for (const med of validMeds) {
      if (Number(med.quantity) <= 0) {
        setError(`Quantity for "${med.med_name}" must be greater than 0.`)
        return
      }
      if (Number(med.quantity) > med.availableBoxes) {
        setError(`Insufficient boxes for "${med.med_name}". Only ${med.availableBoxes} box${med.availableBoxes !== 1 ? 'es' : ''} available.`)
        return
      }
    }

    setError('')
    setShowConfirm(true)
  }

  const handleSubmit = async () => {
    const validMeds = medicines.filter(m => m.med_name.trim() && m.quantity)
    if (validMeds.length === 0) { setError('Add at least one medicine with name and quantity.'); return }
    if (!brgy) { setError('Barangay is required.'); return }

    for (const med of validMeds) {
      if (Number(med.quantity) <= 0) {
        setError(`Quantity for "${med.med_name}" must be greater than 0.`)
        return
      }
      if (Number(med.quantity) > med.availableBoxes) {
        setError(`Insufficient boxes for "${med.med_name}". Only ${med.availableBoxes} box${med.availableBoxes !== 1 ? 'es' : ''} available.`)
        return
      }
    }

    setLoading(true)
    setError('')

    const stored = localStorage.getItem('smartrhu_user')
    let dispensedBy = 'Warehouse Staff'
    if (stored) { try { dispensedBy = JSON.parse(stored).name || dispensedBy } catch {} }

    for (const med of validMeds) {
      const { data: medData } = await supabase
        .from('warehouse_medicines')
        .select('id, boxes')
        .ilike('med_name', med.med_name)
        .eq('archived', false)
        .order('exp_date', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (!medData) { setError(`Medicine "${med.med_name}" not found.`); setLoading(false); return }

      const { error: dispenseError } = await supabase
        .from('warehouse_dispensed')
        .insert({
          med_name: med.med_name,
          med_type: med.med_type,
          med_dosage: med.med_dosage,
          quantity_dispensed: Number(med.quantity),
          dispensed_to: dispensedTo,
          brgy,
          dispensed_by: dispensedBy,
          dispensed_at: new Date(dispensedDate).toISOString(),
          unit: med.unit,
          exp_date: med.exp_date || null,
          category: med.category || null,
          notes: med.notes || null,
        })

      if (dispenseError) { setError('Error recording dispense!'); setLoading(false); return }

      await supabase
        .from('warehouse_medicines')
        .update({ boxes: medData.boxes - Number(med.quantity) })
        .eq('id', medData.id)
    }

    setLoading(false)
    onSuccess()
  }

  const validCount = medicines.filter(m => m.med_name && m.quantity).length

  return (
    <div className={styles.modalBackdrop}>
      <div className={styles.modal} style={{ maxWidth: 580, maxHeight: '90vh' }}>

        <div className={styles.modalHeader}>
          <h2>💊 Medicine Dispense</h2>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>

        <div className={styles.modalBody} style={{ overflowY: 'auto', maxHeight: 'calc(90vh - 140px)' }}>

          {/* Date */}
          <div>
            <label>Dispense Date</label>
            <input
              type="date"
              className={styles.modalInput}
              value={dispensedDate}
              onChange={e => setDispensedDate(e.target.value)}
            />
          </div>

          {/* Barangay */}
          <div>
            <label>Barangay *</label>
            <input
              type="text"
              className={styles.modalInput}
              value={brgy}
              onChange={e => setBrgy(e.target.value)}
              placeholder="e.g. Brgy. San Jose"
            />
          </div>

          {/* Dispensed To */}
          <div>
            <label>Dispensed To</label>
            <input
              type="text"
              className={styles.modalInput}
              value={dispensedTo}
              onChange={e => setDispensedTo(e.target.value)}
              placeholder="Patient name or recipient"
            />
          </div>

          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />

          {/* Medicines header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <label style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--text2)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
              Medicines
            </label>
            <button
              type="button"
              onClick={addRow}
              style={{
                background: 'var(--green)', color: '#fff', border: 'none',
                borderRadius: 20, padding: '4px 12px', fontSize: 11,
                fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}>
              + Add Medicine
            </button>
          </div>

          {/* Medicine rows */}
          {medicines.map((med, index) => (
            <div key={med.id} style={{
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: 10, padding: 12, marginBottom: 10,
            }}>
              {/* Row header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  Medicine #{index + 1}
                </span>
                {medicines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(med.id)}
                    style={{
                      background: '#fee2e2', color: '#dc2626', border: 'none',
                      borderRadius: 6, padding: '3px 8px', fontSize: 11,
                      fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    Remove
                  </button>
                )}
              </div>

              {/* Medicine Name dropdown */}
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <label>Medicine Name * {med.availableBoxes > 0 && (
                  <span style={{ color: 'var(--green)', fontWeight: 600, fontSize: 11 }}>
                    ({med.availableBoxes} box{med.availableBoxes !== 1 ? 'es' : ''} available)
                  </span>
                )}</label>
                <input
                  type="text"
                  className={styles.modalInput}
                  value={med.searchQuery}
                  onChange={e => {
                    updateRow(med.id, { searchQuery: e.target.value, med_name: e.target.value, showDropdown: true, availableStock: 0, availableBoxes: 0, unit: '', exp_date: '', category: '' })
                  }}
                  onFocus={() => updateRow(med.id, { showDropdown: true })}
                  onBlur={() => setTimeout(() => updateRow(med.id, { showDropdown: false }), 150)}
                  placeholder="Click or type to search..."
                  autoComplete="off"
                />

                {/* Dropdown */}
                {med.showDropdown && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0,
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                    zIndex: 100, overflow: 'hidden', maxHeight: 220, overflowY: 'auto',
                  }}>
                    {getFilteredMeds(med.searchQuery).length === 0 ? (
                      <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>
                        No medicines found
                      </div>
                    ) : (
                      getFilteredMeds(med.searchQuery).map(option => (
                        <button
                          key={option.id}
                          type="button"
                          onMouseDown={() => handleSelectMed(med.id, option)}
                          style={{
                            display: 'flex', justifyContent: 'space-between',
                            alignItems: 'center', width: '100%',
                            padding: '9px 14px', border: 'none',
                            borderBottom: '1px solid var(--border)',
                            background: 'transparent', cursor: 'pointer',
                            fontFamily: 'inherit', transition: 'background .12s',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--green-light)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <div style={{ textAlign: 'left' }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                              {option.med_name}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                              {option.med_dosage}{option.med_type ? ` · ${option.med_type}` : ''}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{
                              fontSize: 12, fontWeight: 700,
                              color: option.boxes <= 2 ? '#ef4444' : option.boxes <= 5 ? '#f59e0b' : 'var(--green)'
                            }}>
                              {option.boxes} box{option.boxes !== 1 ? 'es' : ''}
                            </div>
                            <div style={{ fontSize: 9, color: 'var(--text3)' }}>in stock</div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Type + Dosage */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <label>Medicine Type</label>
                  <input
                    type="text"
                    className={styles.modalInput}
                    value={med.med_type}
                    onChange={e => updateRow(med.id, { med_type: e.target.value })}
                    placeholder="e.g. Tablet"
                  />
                </div>
                <div>
                  <label>Dosage (mg)</label>
                  <input
                    type="text"
                    className={styles.modalInput}
                    value={med.med_dosage}
                    onChange={e => updateRow(med.id, { med_dosage: e.target.value })}
                    placeholder="e.g. 500mg"
                  />
                </div>
              </div>

              {/* Unit + Category — auto-filled, read-only */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <label>Unit</label>
                  <input
                    type="text"
                    className={styles.modalInput}
                    value={med.unit}
                    readOnly
                    disabled
                    placeholder="Auto-filled"
                  />
                </div>
                <div>
                  <label>Category</label>
                  <input
                    type="text"
                    className={styles.modalInput}
                    value={med.category === 'drug' ? 'Medicine Drug' : med.category === 'supply' ? 'Medicine Supply' : ''}
                    readOnly
                    disabled
                    placeholder="Auto-filled"
                  />
                </div>
              </div>

              {/* Expiration Date — auto-filled, read-only */}
              <div style={{ marginBottom: 8 }}>
                <label>Expiration Date</label>
                <input
                  type="text"
                  className={styles.modalInput}
                  value={med.exp_date || ''}
                  readOnly
                  disabled
                  placeholder="Auto-filled"
                />
              </div>

              {/* Quantity (boxes) */}
              <div style={{ marginBottom: 8 }}>
                <label>Quantity (boxes) *</label>
                <input
                  type="number"
                  className={styles.modalInput}
                  value={med.quantity}
                  onChange={e => updateRow(med.id, { quantity: e.target.value })}
                  placeholder="0"
                  min="1"
                  max={med.availableBoxes || undefined}
                  style={{
                    borderColor: med.quantity && med.availableBoxes && Number(med.quantity) > med.availableBoxes
                      ? '#ef4444' : undefined
                  }}
                />
                {med.quantity && med.availableBoxes > 0 && Number(med.quantity) > med.availableBoxes && (
                  <div style={{ fontSize: 11, color: '#ef4444', marginTop: 3 }}>
                    ⚠ Exceeds available boxes ({med.availableBoxes})
                  </div>
                )}
              </div>

              {/* Description / Notes — manual, optional */}
              <div>
                <label>Description <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text3)' }}>(optional)</span></label>
                <textarea
                  className={styles.modalInput}
                  value={med.notes}
                  onChange={e => updateRow(med.id, { notes: e.target.value })}
                  placeholder=""
                  rows={2}
                />
              </div>
            </div>
          ))}

          {error && (
            <div style={{
              background: '#fee2e2', color: '#dc2626',
              padding: '8px 12px', borderRadius: 8,
              fontSize: 12, fontWeight: 500,
            }}>
              ⚠ {error}
            </div>
          )}
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.btnCancel} onClick={onClose} disabled={loading}>
            CANCEL
          </button>
          <button className={styles.btnConfirm} onClick={requestConfirm} disabled={loading}>
            {loading ? 'Saving...' : `CONFIRM (${validCount} medicine${validCount !== 1 ? 's' : ''})`}
          </button>
        </div>
      </div>

      {/* Confirmation popup */}
      {showConfirm && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setShowConfirm(false)}
        >
          <div
            style={{ background: 'var(--surface, #fff)', borderRadius: 16, width: '100%', maxWidth: 360, boxShadow: '0 24px 64px rgba(0,0,0,.28)', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '20px 22px 0', textAlign: 'center' }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%', background: 'var(--green-light)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px',
                fontSize: 22,
              }}>💊</div>
              <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>
                Confirm Dispense
              </p>
              <p style={{ fontSize: 12.5, color: 'var(--text2)', margin: '0 0 18px', lineHeight: 1.5 }}>
                Are you sure you want to dispense {validCount} medicine{validCount !== 1 ? 's' : ''}? This will deduct boxes from warehouse stock and cannot be undone.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, padding: '0 22px 20px' }}>
              <button
                onClick={() => setShowConfirm(false)}
                style={{ flex: 1, padding: 10, borderRadius: 10, border: 'none', background: '#fee2e2', color: '#ef4444', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
              >Cancel</button>
              <button
                onClick={() => { setShowConfirm(false); handleSubmit() }}
                disabled={loading}
                style={{ flex: 1, padding: 10, borderRadius: 10, border: 'none', background: 'var(--green)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
              >{loading ? 'Saving...' : 'Yes, Dispense'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}