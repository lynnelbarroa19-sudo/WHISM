'use client'
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import styles from './warehouse.module.css'

// One entry per MEDICINE. Batches (with batch_number, for the optional manual
// filter) are carried underneath — FEFO allocation across them happens
// automatically unless the user locks a row to one specific batch_number.
interface BatchInfo {
  batch_id: string
  batch_number: string | null
  availableQty: number    // this batch's total_quantity (base units)
  piecesPerBox: number
  expiryDate: string | null
}

interface MedicineOption {
  medicine_id: string
  generic_name: string
  brand_name: string | null
  dosage_strength: string | null
  dosage_form: string | null
  category: string | null
  unit: string | null
  totalAvailable: number   // sum across all active batches
  batches: BatchInfo[]     // sorted FEFO: soonest expiry first, no-expiry last
}

// One row per BATCH — used ONLY to render the search dropdown, so batches of
// the same medicine are never summed/merged into a single visual row.
// Selecting any row still passes the parent medicine's FULL batch list (or
// batch-number-filtered list) to handleSelectMed, so FEFO cascade on quantity
// overflow keeps working exactly as before — this only fixes the display.
interface BatchOptionRow {
  key: string
  medicine: MedicineOption
  batch: BatchInfo
}

function flattenToBatchRows(pool: MedicineOption[]): BatchOptionRow[] {
  const rows: BatchOptionRow[] = []
  for (const med of pool) {
    for (const b of med.batches) {
      rows.push({ key: b.batch_id, medicine: med, batch: b })
    }
  }
  return rows
}

interface DestinationOption {
  destination_id: string
  destination_name: string
  destination_type: string
}

const DESTINATION_TYPES = ['Barangay', 'Pharmacy', 'Laboratory', 'Office'] as const
type DestType = (typeof DESTINATION_TYPES)[number]

const PENDING_ID = '__pending__'

const BARANGAYS: string[] = [
  'Bacungan', 'Bagacay', 'Banabahin Ibaba', 'Banabahin Ilaya', 'Bayabas', 'Bebito',
  'Bigajo', 'Binahian A', 'Binahian B', 'Binahian C', 'Bocboc', 'Buenavista',
  'Burgos (Poblacion)', 'Buyacanin', 'Cagacag', 'Calantipayan', 'Canda Ibaba',
  'Canda Ilaya', 'Cawayan', 'Cawayanin', 'Cogorin Ibaba', 'Cogorin Ilaya',
  'Concepcion', 'Danlagan (Poblacion)', 'De La Paz', 'Del Pilar', 'Del Rosario',
  'Esperanza Ibaba', 'Esperanza Ilaya', 'Gomez (Poblacion)', 'Guihay', 'Guinuangan',
  'Guites', 'Hondagua', 'Ilayang Ilog A', 'Ilayang Ilog B', 'Inalusan', 'Jongo',
  'Lalaguna', 'Lourdes', 'Mabanban', 'Mabini', 'Magallanes', 'Maguilayan',
  'Mahayod-Hayod', 'Mal-ay', 'Mandoog', 'Manguisian', 'Matinik',
  'Magsaysay (Poblacion)', 'Monteclaro', 'Pamampangin', 'Pansol', 'Peñafrancia',
  'Pisipis', 'Rizal (Poblacion)', 'Rizal (Rural)', 'Roma', 'Rosario', 'Samat',
  'San Andres', 'San Antonio', 'San Francisco A', 'San Francisco B', 'San Isidro',
  'San Jose', 'San Lorenzo Ruiz (Poblacion)', 'San Miguel (Dao)', 'San Pedro',
  'San Rafael', 'San Roque', 'Silang', 'Sta. Catalina', 'Sta. Elena', 'Sta. Jacobe',
  'Sta. Lucia', 'Sta. Maria', 'Sta. Rosa', 'Sta. Teresa', 'Sto. Niño Ibaba',
  'Sto. Niño Ilaya', 'Sugod', 'Sumilang', 'Talolong (Poblacion)', 'Tan-ag Ibaba',
  'Tan-ag Ilaya', 'Tocalin', 'Vegaflor', 'Vergaña', 'Veronica', 'Villa Aurora',
  'Villa Espina', 'Villageda', 'Villahermosa', 'Villamonte', 'Villanacaob',
]

type DispenseUnit = 'base' | 'box'

// One line of the FEFO breakdown for a row — which batch, how much, when it expires.
interface Allocation {
  batch_id: string
  quantity: number      // base units
  expiryDate: string | null
}

interface MedicineRow {
  id: string
  medicine_id: string
  generic_name: string
  dosage_strength: string
  dosage_form: string
  unit: string
  category: string
  totalAvailable: number
  batches: BatchInfo[]
  boxPiecesPerBox: number   // pieces-per-box of the FIRST (soonest-expiry, or only, batch), used only for the box-mode input conversion
  quantity: string
  dispenseUnit: DispenseUnit
  searchQuery: string
  showDropdown: boolean
  notes: string
  selectedBatchNumber: string   // '' = no filter, auto FEFO across all batches for this medicine
}

interface Props { onClose: () => void; onSuccess: () => void }

function generateId() { return Math.random().toString(36).substr(2, 9) }

function blankRow(): MedicineRow {
  return {
    id: generateId(), medicine_id: '', generic_name: '', dosage_strength: '',
    dosage_form: '', unit: '', category: '', totalAvailable: 0, batches: [],
    boxPiecesPerBox: 1,
    quantity: '', dispenseUnit: 'base',
    searchQuery: '', showDropdown: false, notes: '',
    selectedBatchNumber: '',
  }
}

function canUseBox(row: { boxPiecesPerBox: number }): boolean {
  return row.boxPiecesPerBox > 1
}

// Unit type has exactly two families of base unit, never combined into one
// string:
//   - Piece-type meds (tablets, capsules, etc.) -> base unit is "Loose"
//     (1 Loose = 1 piece; e.g. 5 Loose = 5 tablets dispensed)
//   - Bottle-type meds (syrups, liquids, etc.)  -> base unit is "Bottle"
//     (1 Bottle = 1 whole bottle; not further divided into pieces)
// "Box" is always its own separate option on top of whichever base family
// applies (Box = boxPiecesPerBox of that medicine's base unit, e.g. 500
// tablets/box, or 24 bottles/box). A medicine is never both Loose AND
// Bottle at once — only one of the two applies, based on its stored unit.
function unitTypeLabel(row: { unit: string; boxPiecesPerBox: number; dispenseUnit: DispenseUnit }): string {
  if (row.dispenseUnit === 'box') return 'Box'
  return isBottleType(row.unit) ? 'Bottle' : 'Loose'
}

function isBottleType(unit: string): boolean {
  return (unit || '').toLowerCase().includes('bottle')
}

// Shared display label for the base/loose unit wherever it's shown outside
// the dropdown (availability text, search rows, FEFO breakdown) — keeps it
// consistently "Loose" or "Bottle", never the raw stored unit string.
function baseUnitLabel(unit: string): string {
  return isBottleType(unit) ? 'Bottle' : 'Loose'
}

// Core FEFO engine. Walks batches soonest-expiry-first, draining each one
// before moving to the next, until `neededQty` is satisfied or stock runs out.
// This is exactly the "Batch 1 has 10, Batch 2 has 1000, need 50" case:
// it drains Batch 1 (10) then continues into Batch 2 for the remaining 40.
// When a row is locked to one batch_number, `batches` passed in is already
// pre-filtered to just that batch — so this naturally produces zero cascade.
function allocateFEFO(batches: BatchInfo[], neededQty: number): { allocations: Allocation[]; shortfall: number } {
  const allocations: Allocation[] = []
  let remaining = neededQty
  for (const b of batches) {
    if (remaining <= 0) break
    if (b.availableQty <= 0) continue
    const take = Math.min(b.availableQty, remaining)
    if (take > 0) {
      allocations.push({ batch_id: b.batch_id, quantity: take, expiryDate: b.expiryDate })
      remaining -= take
    }
  }
  return { allocations, shortfall: Math.max(remaining, 0) }
}

function toBaseQty(row: { quantity: string; dispenseUnit: DispenseUnit; boxPiecesPerBox: number }): number {
  const n = Number(row.quantity) || 0
  return row.dispenseUnit === 'box' ? n * row.boxPiecesPerBox : n
}

function maxForUnit(row: { totalAvailable: number; dispenseUnit: DispenseUnit; boxPiecesPerBox: number }): number {
  return row.dispenseUnit === 'box' ? Math.floor(row.totalAvailable / row.boxPiecesPerBox) : row.totalAvailable
}

type ReceiptItem = { name: string; qty: string; unit: string }
type Receipt = {
  release_number: string
  destination: string
  date: string
  receivedBy: string
  position: string
  items: ReceiptItem[]
}

export default function DispenseMedicineModal({ onClose, onSuccess }: Props) {
  const [allMedicines, setAllMedicines] = useState<MedicineOption[]>([])
  const [medFetchError, setMedFetchError] = useState('')
  const [medicines, setMedicines] = useState<MedicineRow[]>([blankRow()])

  const [allDestinations, setAllDestinations] = useState<DestinationOption[]>([])
  const [destFetchError, setDestFetchError] = useState('')
  const [destType, setDestType] = useState<DestType | null>(null)
  const [destQuery, setDestQuery] = useState('')
  const [showDestDropdown, setShowDestDropdown] = useState(false)
  const [destination, setDestination] = useState<DestinationOption | null>(null)

  const [receivedByName, setReceivedByName] = useState('')
  const [receivedByPosition, setReceivedByPosition] = useState('')
  const [remarks, setRemarks] = useState('')
  const [dateReleased, setDateReleased] = useState(new Date().toISOString().split('T')[0])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [receipt, setReceipt] = useState<Receipt | null>(null)

  useEffect(() => {
    // Fired off in the background — the form renders immediately with
    // empty options and fills in as soon as each fetch resolves, instead of
    // blocking the whole modal behind a loading screen.
    fetchAllMedicines()
    fetchDestinations()
  }, [])

  // ---- Medicines: grouped by generic medicine, batches (with batch_number)
  // carried underneath for automatic FEFO allocation and/or manual batch filter. ----
  const fetchAllMedicines = async () => {
    setMedFetchError('')
    const { data: meds, error: medsError } = await supabase
      .from('medicines')
      .select('medicine_id, generic_name, brand_name, dosage_strength, dosage_form, category, unit')
      .eq('is_archived', false)
      .eq('status', 'active')

    if (medsError) {
      console.error('fetchAllMedicines (medicines):', medsError)
      setMedFetchError('Could not load medicines. Check your connection and try again.')
      return
    }

    const { data: batches, error: batchesError } = await supabase
      .from('medicine_batches')
      .select('batch_id, medicine_id, batch_number, total_quantity, expiration_date, pieces_per_box')
      .in('status', ['available', 'low_stock'])
      .gt('total_quantity', 0)
      .order('expiration_date', { ascending: true, nullsFirst: false })

    if (batchesError) {
      console.error('fetchAllMedicines (batches):', batchesError)
      setMedFetchError('Could not load stock levels. Check your connection and try again.')
      return
    }

    const today = new Date().toISOString().split('T')[0]
    const batchesByMed = new Map<string, BatchInfo[]>()
    for (const b of batches || []) {
      if (b.expiration_date && b.expiration_date < today) continue // stopgap: already expired, not yet swept
      const arr = batchesByMed.get(b.medicine_id) || []
      arr.push({
        batch_id: b.batch_id,
        batch_number: b.batch_number,
        availableQty: b.total_quantity,
        piecesPerBox: b.pieces_per_box,
        expiryDate: b.expiration_date,
      })
      batchesByMed.set(b.medicine_id, arr)
    }
    // FEFO order: soonest expiry first, no-expiry batches last
    for (const arr of batchesByMed.values()) {
      arr.sort((a, b) => {
        if (!a.expiryDate) return 1
        if (!b.expiryDate) return -1
        return a.expiryDate.localeCompare(b.expiryDate)
      })
    }

    const options: MedicineOption[] = (meds || [])
      .map(m => {
        const medBatches = batchesByMed.get(m.medicine_id) || []
        if (medBatches.length === 0) return null
        return {
          medicine_id: m.medicine_id,
          generic_name: m.generic_name,
          brand_name: m.brand_name,
          dosage_strength: m.dosage_strength,
          dosage_form: m.dosage_form,
          category: m.category,
          unit: m.unit,
          totalAvailable: medBatches.reduce((sum, b) => sum + b.availableQty, 0),
          batches: medBatches,
        } as MedicineOption
      })
      .filter((o): o is MedicineOption => o !== null)
      .sort((a, b) => a.generic_name.localeCompare(b.generic_name))

    setAllMedicines(options)
  }

  const fetchDestinations = async () => {
    setDestFetchError('')
    const { data, error: destError } = await supabase
      .from('destinations')
      .select('destination_id, destination_name, destination_type')
      .eq('is_active', true)
      .order('destination_name', { ascending: true })

    if (destError) {
      console.error('fetchDestinations:', destError)
      setDestFetchError('Could not load destinations. Check your connection and try again.')
      return
    }

    setAllDestinations(data || [])
  }

  // Distinct batch_numbers across all currently-loaded medicines, each tagged
  // with how many different medicines exist in that batch — used to populate
  // the optional "Batch" filter dropdown per row.
  const allBatchNumbers = useMemo(() => {
    const map = new Map<string, number>()
    for (const med of allMedicines) {
      const seen = new Set<string>()
      for (const b of med.batches) {
        if (b.batch_number && !seen.has(b.batch_number)) {
          seen.add(b.batch_number)
          map.set(b.batch_number, (map.get(b.batch_number) || 0) + 1)
        }
      }
    }
    return Array.from(map.entries())
      .map(([batch_number, medicineCount]) => ({ batch_number, medicineCount }))
      .sort((a, b) => b.batch_number.localeCompare(a.batch_number))
  }, [allMedicines])

  // Medicine search pool, optionally locked to one batch_number. When locked,
  // each medicine's `batches` is narrowed to just that batch (and totalAvailable
  // recomputed) so everything downstream — FEFO calc, breakdown preview,
  // availability text, dropdown rows — reflects only that batch automatically.
  const getFilteredMeds = (query: string, batchNumber: string) => {
    let pool = allMedicines
    if (batchNumber) {
      pool = pool
        .map(m => {
          const matching = m.batches.filter(b => b.batch_number === batchNumber)
          if (matching.length === 0) return null
          return { ...m, batches: matching, totalAvailable: matching.reduce((s, b) => s + b.availableQty, 0) }
        })
        .filter((m): m is MedicineOption => m !== null)
    }
    if (!query.trim()) return pool
    return pool.filter(m => m.generic_name.toLowerCase().includes(query.toLowerCase())
      || (m.brand_name || '').toLowerCase().includes(query.toLowerCase()))
  }

  const getFilteredBarangays = (query: string) => {
    const q = query.trim().toLowerCase()
    if (!q) return BARANGAYS
    return BARANGAYS.filter(b => b.toLowerCase().includes(q))
  }

  const updateRow = (id: string, fields: Partial<MedicineRow>) => {
    setMedicines(prev => prev.map(m => m.id === id ? { ...m, ...fields } : m))
  }

  // Selecting ANY batch row for a medicine still attaches the medicine's full
  // (or batch-filtered) batch list — not just the one clicked — so FEFO
  // cascade on quantity overflow keeps working the same as before.
  const handleSelectMed = (rowId: string, med: MedicineOption) => {
    updateRow(rowId, {
      medicine_id: med.medicine_id,
      generic_name: med.generic_name,
      dosage_strength: med.dosage_strength || '',
      dosage_form: med.dosage_form || '',
      unit: med.unit || 'Piece',
      category: med.category || '',
      totalAvailable: med.totalAvailable,
      batches: med.batches,
      boxPiecesPerBox: med.batches[0]?.piecesPerBox || 1,
      dispenseUnit: 'base',
      quantity: '',
      searchQuery: med.brand_name ? `${med.generic_name} (${med.brand_name})` : med.generic_name,
      showDropdown: false,
    })
  }

  // Changing the Batch filter clears whatever medicine was already picked on
  // that row, since the previously-picked medicine may not exist in the new
  // batch at all.
  const handleBatchFilterChange = (rowId: string, batchNumber: string) => {
    updateRow(rowId, {
      selectedBatchNumber: batchNumber,
      medicine_id: '', generic_name: '', searchQuery: '',
      totalAvailable: 0, batches: [], quantity: '',
    })
  }

  const addRow = () => setMedicines(prev => [blankRow(), ...prev])
  const removeRow = (id: string) => {
    if (medicines.length === 1) return
    setMedicines(prev => prev.filter(m => m.id !== id))
  }

  const handleDestBlur = () => {
    setTimeout(() => {
      setShowDestDropdown(false)
      if (destination || !destQuery.trim() || destType !== 'Barangay') return
      const matches = getFilteredBarangays(destQuery)
      if (matches.length === 1) handleSelectBarangay(matches[0])
    }, 150)
  }

  const handleSelectBarangay = (name: string) => {
    setShowDestDropdown(false)
    setDestQuery('')
    const existing = allDestinations.find(d => d.destination_type === 'Barangay' && d.destination_name === name)
    setDestination(existing || { destination_id: PENDING_ID, destination_name: name, destination_type: 'Barangay' })
  }

  const selectFixedDestination = (type: Exclude<DestType, 'Barangay'>) => {
    setDestType(type)
    setShowDestDropdown(false)
    setDestQuery('')
    setError('')
    const existing = allDestinations.find(d => d.destination_type === type)
    setDestination(existing || { destination_id: PENDING_ID, destination_name: type, destination_type: type })
  }

  const resolveDestination = async (dest: DestinationOption): Promise<DestinationOption | null> => {
    if (dest.destination_id !== PENDING_ID) return dest

    const { data, error: insertError } = await supabase
      .from('destinations')
      .insert({ destination_name: dest.destination_name, destination_type: dest.destination_type })
      .select('destination_id, destination_name, destination_type')
      .single()

    if (data) return data

    if (insertError?.code === '23505') {
      const { data: found } = await supabase
        .from('destinations')
        .select('destination_id, destination_name, destination_type')
        .eq('destination_type', dest.destination_type)
        .eq('destination_name', dest.destination_name)
        .maybeSingle()
      if (found) return found
    }

    console.error('resolveDestination:', insertError)
    return null
  }

  // Live FEFO preview per row — recomputed whenever quantity/unit/selection/batch
  // filter changes. Drives the breakdown UI under each quantity field. Purely
  // client-side, using the batch snapshot loaded at modal open; the authoritative
  // recompute against fresh data happens again in handleSubmit.
  const rowPreviews = useMemo(() => {
    const map = new Map<string, { allocations: Allocation[]; shortfall: number }>()
    for (const med of medicines) {
      if (!med.medicine_id || med.batches.length === 0) continue
      const baseQty = toBaseQty(med)
      if (baseQty <= 0) continue
      map.set(med.id, allocateFEFO(med.batches, baseQty))
    }
    return map
  }, [medicines])

  const validate = () => {
    const validMeds = medicines.filter(m => m.medicine_id && m.quantity)
    if (validMeds.length === 0) return 'Add at least one medicine with quantity.'
    if (!destination) return 'Destination is required.'
    if (!receivedByName.trim()) return 'Received By is required.'
    if (!receivedByPosition.trim()) return 'Position is required.'

    for (const med of validMeds) {
      const entered = Number(med.quantity)
      const unitLabel = unitTypeLabel(med)
      if (!Number.isInteger(entered) || entered <= 0) {
        return `Quantity for "${med.generic_name}" must be a whole number greater than 0 ${unitLabel}(s).`
      }
      const baseQty = toBaseQty(med)
      if (baseQty > med.totalAvailable) {
        const maxAllowed = maxForUnit(med)
        const scope = med.selectedBatchNumber ? `in Batch ${med.selectedBatchNumber}` : 'across all batches'
        return `Insufficient stock for "${med.generic_name}". Only ${maxAllowed} ${unitLabel}(s) available ${scope}.`
      }
    }
    return ''
  }

  const requestConfirm = () => {
    const err = validate()
    if (err) { setError(err); return }
    setError('')
    setShowConfirm(true)
  }

  const generateReleaseNumber = () => {
    const now = new Date()
    return `RLS-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`
  }

  const handleSubmit = async () => {
    const err = validate()
    if (err) { setError(err); return }
    if (!destination) return

    setLoading(true)
    setError('')

    // ---- PASS 0: resolve destination ----
    const finalDestination = await resolveDestination(destination)
    if (!finalDestination) {
      setError(`Could not save destination "${destination.destination_name}". Please try again.`)
      setLoading(false)
      return
    }
    if (finalDestination.destination_id !== destination.destination_id) {
      setAllDestinations(prev => [...prev, finalDestination].sort((a, b) => a.destination_name.localeCompare(b.destination_name)))
      setDestination(finalDestination)
    }

    const validMeds = medicines.filter(m => m.medicine_id && m.quantity)

    // ---- PASS 1: refetch FRESH batch data for every affected medicine, then
    // recompute allocation against that fresh snapshot — stock may have moved
    // since the modal was opened. If a row was locked to a batch_number, filter
    // the fresh batches down to just that batch before allocating (same rule
    // as the live preview), so a locked row still never cascades.
    //
    // NOTE: this allocation is the INTENDED FEFO split, recorded on the
    // release_items now so the confirm-receipt step (built separately) knows
    // exactly which batches to deduct from later. No stock is deducted here —
    // this dispense is created as 'pending' and only the future confirm step
    // decrements medicine_batches. ----
    const medicineIds = Array.from(new Set(validMeds.map(m => m.medicine_id)))
    const { data: freshBatches, error: freshError } = await supabase
      .from('medicine_batches')
      .select('batch_id, medicine_id, batch_number, pieces_per_box, total_quantity, status, expiration_date')
      .in('medicine_id', medicineIds)
      .in('status', ['available', 'low_stock'])
      .gt('total_quantity', 0)

    if (freshError || !freshBatches) {
      setError('Could not verify current stock. Please try again.')
      setLoading(false)
      return
    }

    const freshByMed = new Map<string, BatchInfo[]>()
    for (const b of freshBatches) {
      const arr = freshByMed.get(b.medicine_id) || []
      arr.push({ batch_id: b.batch_id, batch_number: b.batch_number, availableQty: b.total_quantity, piecesPerBox: b.pieces_per_box, expiryDate: b.expiration_date })
      freshByMed.set(b.medicine_id, arr)
    }
    for (const arr of freshByMed.values()) {
      arr.sort((a, b) => {
        if (!a.expiryDate) return 1
        if (!b.expiryDate) return -1
        return a.expiryDate.localeCompare(b.expiryDate)
      })
    }

    // ---- PASS 1b: build the intended allocation per row against fresh data;
    // bail before writing anything if any medicine is already short on paper. ----
    type RowAllocationSet = { medicine_id: string; generic_name: string; allocations: Allocation[] }
    const rowAllocationSets: RowAllocationSet[] = []
    const receiptItems: ReceiptItem[] = []

    for (const med of validMeds) {
      const baseQty = toBaseQty(med)
      let freshBatchesForMed = freshByMed.get(med.medicine_id) || []
      if (med.selectedBatchNumber) {
        freshBatchesForMed = freshBatchesForMed.filter(b => b.batch_number === med.selectedBatchNumber)
      }
      const { allocations, shortfall } = allocateFEFO(freshBatchesForMed, baseQty)

      if (shortfall > 0) {
        const scope = med.selectedBatchNumber ? `in Batch ${med.selectedBatchNumber}` : 'across all batches'
        setError(`Stock for "${med.generic_name}" changed and there isn't enough left ${scope}. Please refresh and try again.`)
        setLoading(false)
        return
      }

      rowAllocationSets.push({ medicine_id: med.medicine_id, generic_name: med.generic_name, allocations })
      receiptItems.push({ name: med.generic_name, qty: med.quantity, unit: unitTypeLabel(med) })
    }

    const stored = localStorage.getItem('smartrhu_user')
    let releasedBy: string | null = null
    if (stored) { try { releasedBy = JSON.parse(stored).id || null } catch {} }

    // ---- PASS 2: create release header as PENDING. It only becomes
    // 'released' — and only then does medicine_batches get decremented —
    // once the confirm-receipt step (separate component, TBD) marks it so. ----
    let releaseId: string | null = null
    let usedReleaseNumber = ''
    for (let attempt = 0; attempt < 3 && !releaseId; attempt++) {
      const candidateNumber = generateReleaseNumber()
      const { data: release, error: releaseError } = await supabase
        .from('releases')
        .insert({
          release_number: candidateNumber,
          destination_id: finalDestination.destination_id,
          released_by: releasedBy,
          received_by_name: receivedByName,
          received_by_position: receivedByPosition,
          date_released: new Date(dateReleased).toISOString(),
          status: 'pending',
          remarks: remarks || null,
        })
        .select('release_id')
        .single()

      if (release) {
        releaseId = release.release_id
        usedReleaseNumber = candidateNumber
      } else if (releaseError?.code !== '23505') {
        setError('Error creating release record.')
        setLoading(false)
        return
      }
    }

    if (!releaseId) {
      setError('Error creating release record (release number collision). Please try again.')
      setLoading(false)
      return
    }

    // ---- PASS 3: write one release_item PER BATCH ALLOCATION (a row can
    // produce 2+ release_items if it was split FEFO across batches). This is
    // the reserved FEFO plan for later — medicine_batches quantities are
    // untouched until the release is confirmed as 'released'. ----
    for (const set of rowAllocationSets) {
      for (const alloc of set.allocations) {
        const { error: itemError } = await supabase
          .from('release_items')
          .insert({ release_id: releaseId, batch_id: alloc.batch_id, quantity: alloc.quantity })
        if (itemError) {
          await supabase.from('releases').delete().eq('release_id', releaseId)
          setError(`Error recording release item for "${set.generic_name}". The dispense was cancelled — no stock was deducted.`)
          setLoading(false)
          return
        }
      }
    }

    setLoading(false)
    setReceipt({
      release_number: usedReleaseNumber,
      destination: `${finalDestination.destination_name} (${finalDestination.destination_type})`,
      date: new Date(dateReleased).toLocaleDateString(),
      receivedBy: receivedByName,
      position: receivedByPosition,
      items: receiptItems,
    })
  }

  const handleDone = () => {
    setReceipt(null)
    onSuccess()
  }

  const validCount = medicines.filter(m => m.medicine_id && m.quantity).length
  const destinationInvalid = !!error && !destination
  const destPendingSelection = !destination && destQuery.trim().length > 0

  if (receipt) {
    return (
      <div className={styles.modalBackdrop}>
        <style jsx global>{`
          @media print {
            body * { visibility: hidden; }
            #dispense-receipt, #dispense-receipt * { visibility: visible; }
            #dispense-receipt { position: fixed; inset: 0; padding: 24px; }
          }
        `}</style>
        <div className={styles.modal} style={{ maxWidth: 420 }}>
          <div className={styles.modalHeader}>
            <h2>📦 Recorded — Pending Confirmation</h2>
          </div>
          <div className={styles.modalBody} id="dispense-receipt">
            <div style={{ textAlign: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Release No.</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--green)' }}>{receipt.release_number}</div>
              <div style={{ display: 'inline-block', marginTop: 6, padding: '3px 10px', borderRadius: 20, background: '#fff7ed', color: '#c2410c', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Pending
              </div>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.8 }}>
              <div><strong>Date:</strong> {receipt.date}</div>
              <div><strong>Destination:</strong> {receipt.destination}</div>
              <div><strong>Received By:</strong> {receipt.receivedBy} ({receipt.position})</div>
            </div>
            <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', marginBottom: 6 }}>
              Medicines to Release
            </div>
            {receipt.items.map((it, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                <span>{it.name}</span>
                <span style={{ fontWeight: 700 }}>{it.qty} {it.unit}(s)</span>
              </div>
            ))}
            <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.5 }}>
              Stock has not been deducted yet. This will move to <strong>Released</strong> and the batch quantities will be decremented once receipt is confirmed.
            </div>
          </div>
          <div className={styles.modalFooter}>
            <button className={styles.btnCancel} onClick={() => window.print()}>PRINT</button>
            <button className={styles.btnConfirm} onClick={handleDone}>DONE</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.modalBackdrop}>
      <div className={styles.modal} style={{ maxWidth: 580, maxHeight: '90vh' }}>
        <div className={styles.modalHeader}>
          <h2>💊 Medicine Dispense</h2>
        </div>

        <div className={styles.modalBody} style={{ overflowY: 'auto', maxHeight: 'calc(90vh - 140px)' }}>
          <div>
            <label htmlFor="date-released">Release Date</label>
            <input id="date-released" type="date" className={styles.modalInput} value={dateReleased} onChange={e => setDateReleased(e.target.value)} />
          </div>

          <div style={{ position: 'relative' }}>
            <label htmlFor="destination-search">Destination *</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }} onMouseDown={e => e.preventDefault()}>
              {DESTINATION_TYPES.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    if (t === 'Barangay') {
                      setDestType('Barangay')
                      setDestination(null)
                      setDestQuery('')
                      setShowDestDropdown(true)
                      setError('')
                    } else {
                      selectFixedDestination(t)
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: '7px 4px',
                    fontSize: 11.5,
                    fontWeight: 700,
                    borderRadius: 8,
                    border: destType === t ? '1px solid var(--green)' : '1px solid var(--border)',
                    background: destType === t ? 'var(--green)' : 'var(--surface)',
                    color: destType === t ? '#fff' : 'var(--text2)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            {destType && destType !== 'Barangay' ? (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--surface2)',
                  fontSize: 13,
                  fontWeight: 600,
                  color: destination ? 'var(--text)' : 'var(--text3)',
                }}
              >
                {destination ? `${destination.destination_name} (${destination.destination_type})` : 'Selecting...'}
              </div>
            ) : (
              <>
                <input
                  id="destination-search"
                  type="text"
                  className={styles.modalInput}
                  value={destination ? `${destination.destination_name} (${destination.destination_type})` : destQuery}
                  onChange={e => { setDestQuery(e.target.value); setDestination(null); setShowDestDropdown(true) }}
                  onFocus={() => destType && setShowDestDropdown(true)}
                  onBlur={handleDestBlur}
                  placeholder={destType ? 'Search barangay...' : 'Choose a type above first'}
                  autoComplete="off"
                  disabled={!destType}
                  style={{ borderColor: (destinationInvalid || destPendingSelection) ? '#f59e0b' : undefined }}
                />
                {destPendingSelection && (
                  <div style={{ fontSize: 11, color: '#b45309', marginTop: 3 }}>
                    ⚠ Select a barangay from the list below to confirm it.
                  </div>
                )}
                {showDestDropdown && destType === 'Barangay' && (
                  <div
                    onMouseDown={e => e.preventDefault()}
                    style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, zIndex: 100, maxHeight: 260, overflowY: 'auto' }}
                  >
                    {getFilteredBarangays(destQuery).length === 0 ? (
                      <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>No matching barangay.</div>
                    ) : (
                      getFilteredBarangays(destQuery).map(name => {
                        const isRegistered = allDestinations.some(d => d.destination_type === 'Barangay' && d.destination_name === name)
                        return (
                          <button
                            key={name}
                            type="button"
                            onMouseDown={() => handleSelectBarangay(name)}
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', textAlign: 'left', padding: '9px 14px', border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
                          >
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span>
                            {isRegistered && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--green)' }}>✓ Barangay</span>}
                          </button>
                        )
                      })
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label htmlFor="received-by-name">Received By *</label>
              <input id="received-by-name" type="text" className={styles.modalInput} value={receivedByName} onChange={e => setReceivedByName(e.target.value)} placeholder="Recipient name" />
            </div>
            <div>
              <label htmlFor="received-by-position">Position *</label>
              <input id="received-by-position" type="text" className={styles.modalInput} value={receivedByPosition} onChange={e => setReceivedByPosition(e.target.value)} placeholder="e.g. BHW" />
            </div>
          </div>

          <div>
            <label htmlFor="remarks">Remarks <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text3)' }}>(optional)</span></label>
            <textarea id="remarks" className={styles.modalInput} value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} placeholder="Notes for this release" />
          </div>

          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <label style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--text2)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
              Medicines
            </label>
            <button
              type="button"
              onClick={addRow}
              style={{ background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 20, padding: '4px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              + Add Medicine
            </button>
          </div>

          {medFetchError && (
            <div style={{ background: '#fee2e2', color: '#dc2626', padding: '10px 12px', borderRadius: 8, fontSize: 12, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span>⚠ {medFetchError}</span>
              <button
                type="button"
                onClick={fetchAllMedicines}
                style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
              >
                Retry
              </button>
            </div>
          )}
          {!medFetchError && allMedicines.length === 0 && (
            <div style={{ background: '#fff7ed', color: '#c2410c', padding: '10px 12px', borderRadius: 8, fontSize: 12, marginBottom: 10 }}>
              ⚠ No medicines currently in stock. Check Inventory or wait for a stock-in.
            </div>
          )}

          {medicines.map((med, index) => {
            const medCanUseBox = med.medicine_id ? canUseBox(med) : false
            const maxQty = maxForUnit(med)
            const exceeds = med.quantity && med.totalAvailable > 0 && toBaseQty(med) > med.totalAvailable
            const preview = rowPreviews.get(med.id)
            const showBreakdown = preview && preview.allocations.length > 1 && preview.shortfall === 0

            return (
            <div key={med.id} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  Medicine #{index + 1}
                </span>
                {medicines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(med.id)}
                    style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Remove
                  </button>
                )}
              </div>

              {/* Optional manual Batch filter — leaving it blank keeps the
                  default automatic FEFO behavior. Picking a batch narrows the
                  Medicine Name search to only what exists in that batch, and
                  locks allocation to it (no cascade to other batches). */}
              <div style={{ marginBottom: 8 }}>
                <label htmlFor={`med-batch-${med.id}`}>
                  Batch <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text3)' }}>(optional — leave blank for auto FEFO)</span>
                </label>
                <select
                  id={`med-batch-${med.id}`}
                  className={styles.modalInput}
                  value={med.selectedBatchNumber}
                  onChange={e => handleBatchFilterChange(med.id, e.target.value)}
                >
                  <option value="">All batches (auto FEFO)</option>
                  {allBatchNumbers.map(b => (
                    <option key={b.batch_number} value={b.batch_number}>
                      Batch {b.batch_number} ({b.medicineCount} medicine{b.medicineCount !== 1 ? 's' : ''})
                    </option>
                  ))}
                </select>
                {med.selectedBatchNumber && (
                  <div style={{ fontSize: 11, color: '#b45309', marginTop: 3 }}>
                    ⚠ Locked to this batch only — walang auto-split kahit kulang ang stock dito.
                  </div>
                )}
              </div>

              <div style={{ position: 'relative', marginBottom: 8 }}>
                <label htmlFor={`med-search-${med.id}`}>
                  Medicine Name * {med.totalAvailable > 0 && (
                    <span style={{ color: 'var(--green)', fontWeight: 600, fontSize: 11 }}>
                      ({med.totalAvailable} {baseUnitLabel(med.unit)} available{med.selectedBatchNumber ? ` in Batch ${med.selectedBatchNumber}` : ` across ${med.batches.length} batch${med.batches.length !== 1 ? 'es' : ''}`}{medCanUseBox ? ` · ${Math.floor(med.totalAvailable / med.boxPiecesPerBox)} Box` : ''})
                    </span>
                  )}
                </label>
                <input
                  id={`med-search-${med.id}`}
                  type="text"
                  className={styles.modalInput}
                  value={med.searchQuery}
                  onChange={e => updateRow(med.id, { searchQuery: e.target.value, medicine_id: '', showDropdown: true, totalAvailable: 0, unit: '', category: '', batches: [] })}
                  onFocus={() => updateRow(med.id, { showDropdown: true })}
                  onBlur={() => setTimeout(() => updateRow(med.id, { showDropdown: false }), 150)}
                  placeholder={med.selectedBatchNumber ? `Search within Batch ${med.selectedBatchNumber}...` : 'Click or type to search...'}
                  autoComplete="off"
                />
                {med.showDropdown && (() => {
                  const rows = flattenToBatchRows(getFilteredMeds(med.searchQuery, med.selectedBatchNumber))
                  return (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 100, overflow: 'hidden', maxHeight: 220, overflowY: 'auto' }}>
                      {rows.length === 0 ? (
                        <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>
                          {med.selectedBatchNumber ? `No medicines found in Batch ${med.selectedBatchNumber}.` : 'No medicines match your search.'}
                        </div>
                      ) : (
                        rows.map(row => (
                          <button
                            key={row.key}
                            type="button"
                            onMouseDown={() => handleSelectMed(med.id, row.medicine)}
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '9px 14px', border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', transition: 'background .12s' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--green-light)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            <div style={{ textAlign: 'left' }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                                {row.medicine.generic_name}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                                {row.medicine.dosage_strength}{row.medicine.dosage_form ? ` · ${row.medicine.dosage_form}` : ''}
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                                {row.batch.expiryDate ? `Exp: ${new Date(row.batch.expiryDate).toLocaleDateString()}` : 'No expiry'}
                                {row.batch.batch_number ? ` · Batch ${row.batch.batch_number}` : ''}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: row.batch.availableQty <= 20 ? '#ef4444' : 'var(--green)' }}>
                                {row.batch.availableQty} {baseUnitLabel(row.medicine.unit || '')}
                              </div>
                              {row.batch.piecesPerBox > 1 && (
                                <div style={{ fontSize: 9, color: 'var(--text3)' }}>
                                  {Math.floor(row.batch.availableQty / row.batch.piecesPerBox)} Box
                                </div>
                              )}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )
                })()}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <label>Dosage</label>
                  <input type="text" className={styles.modalInput} value={med.dosage_strength} readOnly disabled placeholder="Auto-filled" />
                </div>
                <div>
                  <label>Form</label>
                  <input type="text" className={styles.modalInput} value={med.dosage_form} readOnly disabled placeholder="Auto-filled" />
                </div>
              </div>

              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8 }}>
                  <label htmlFor={`med-qty-${med.id}`} style={{ margin: 0 }}>Quantity *</label>
                  {medCanUseBox ? (
                    <div style={{ display: 'flex', gap: 4 }}>
                      {/* Unit type is now a proper set of distinct, separate
                          options — Box vs. the medicine's actual base unit
                          (Piece, Bottle, Vial, etc.) — never smashed together
                          into one combined label like "Loose Box". */}
                      <select
                        id={`med-unit-${med.id}`}
                        value={med.dispenseUnit}
                        onChange={e => updateRow(med.id, { dispenseUnit: e.target.value as DispenseUnit, quantity: '' })}
                        style={{ fontSize: 11, fontWeight: 700, border: '1px solid var(--border)', borderRadius: 6, padding: '3px 6px', fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--text2)' }}
                      >
                        <option value="base">{unitTypeLabel({ ...med, dispenseUnit: 'base' })}</option>
                        <option value="box">Box</option>
                      </select>
                    </div>
                  ) : med.medicine_id ? (
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)' }}>
                      {unitTypeLabel({ ...med, dispenseUnit: 'base' })}
                    </span>
                  ) : null}
                </div>
                <input
                  id={`med-qty-${med.id}`}
                  type="number"
                  className={styles.modalInput}
                  value={med.quantity}
                  onChange={e => updateRow(med.id, { quantity: e.target.value })}
                  placeholder="0"
                  min="1"
                  step="1"
                  max={maxQty || undefined}
                  style={{ borderColor: exceeds ? '#ef4444' : undefined }}
                />
                {exceeds && (
                  <div style={{ fontSize: 11, color: '#ef4444', marginTop: 3 }}>
                    ⚠ Exceeds available stock ({maxQty} {unitTypeLabel(med)}(s) max{med.selectedBatchNumber ? ` in Batch ${med.selectedBatchNumber}` : ', across all batches'})
                  </div>
                )}

                {/* FEFO breakdown preview — only shows when the entered qty spills
                    past the first batch into a second/third one within whatever
                    pool is active (all batches, or the locked batch — which will
                    never trigger this since a locked row is a single batch). */}
                {showBreakdown && preview && (
                  <div style={{ marginTop: 8, background: 'var(--green-light, #eafbf3)', border: '1px solid var(--green)', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
                      ↳ Split across {preview.allocations.length} batches (FEFO)
                    </div>
                    {preview.allocations.map((a, i) => (
                      <div key={a.batch_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                        <span style={{ color: 'var(--text2)' }}>
                          {a.expiryDate ? `Batch exp ${new Date(a.expiryDate).toLocaleDateString()}` : 'Batch (no expiry)'}
                        </span>
                        <span style={{ fontWeight: 700 }}>{a.quantity} {baseUnitLabel(med.unit)}(s)</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label htmlFor={`med-notes-${med.id}`}>Notes <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text3)' }}>(optional)</span></label>
                <textarea
                  id={`med-notes-${med.id}`}
                  className={styles.modalInput}
                  value={med.notes}
                  onChange={e => updateRow(med.id, { notes: e.target.value })}
                  rows={2}
                />
              </div>
            </div>
          )})}

          {error && (
            <div style={{ background: '#fee2e2', color: '#dc2626', padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 500 }}>
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
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: 22 }}>💊</div>
              <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>
                Confirm Dispense
              </p>
              <p style={{ fontSize: 12.5, color: 'var(--text2)', margin: '0 0 18px', lineHeight: 1.5 }}>
                Record {validCount} medicine{validCount !== 1 ? 's' : ''} for release to {destination?.destination_name}? This will be saved as <strong>Pending</strong> — the FEFO batch allocation (oldest batch first) is reserved, but stock will only be deducted once receipt is confirmed.
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