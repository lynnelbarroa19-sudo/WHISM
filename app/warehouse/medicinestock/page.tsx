'use client'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useTheme } from 'next-themes'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'
import AddMedicineModal from '../components/AddMedicineModal'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from '@/lib/supabase'
import { Plus, Download, X, PackageSearch, Archive as ArchiveIcon, RotateCcw } from 'lucide-react'
import {
  T,
  computeStatus, IconDrug, IconSupply, IconArchive, IconImport, IconSearch,
  IconExcelFile, IconPdfFile,
  type Medicine, type Tab, type ImportRow,
} from '../components/SharedMedicine'

// ─── Row shown in the table = one medicine_batches row + its parent medicines
// identity fields flattened together. `batch_id` is now the true unique key
// for a row (a medicine can have several batches), so selection/keys use it
// instead of `medicine_id`. `strips_per_box` / `pieces_per_strip` are carried
// along too — used only to derive the Strip (Qty) column below. ───────────
type MedicineRow = Medicine & {
  batch_id: string
  strips_per_box: number | null
  pieces_per_strip: number | null
}

// ─── Source filter type ────────────────────────────────────────────────────
type SourceFilter = 'all' | 'DOH' | 'PHILHEALTH' | 'LGU'

// ─── Archive reason (required before a batch can be MANUALLY archived).
// NOTE: 'expired' is intentionally NOT an option here anymore — expired
// batches are auto-archived by the system (see fetchMedicines below) and
// never need a human to pick a reason for them. Only Spoiled/Damaged and
// Other go through this manual confirmation modal. ─────────────────────────
type ArchiveReason = 'spoiled' | 'other'

// ─── Source color tokens — shared by the filter pills and the table badges ─
const SOURCE_COLORS = {
  DOH:        { bg: '#e0f2fe', color: '#0369a1', border: '#bae6fd' },
  PHILHEALTH: { bg: '#ede9fe', color: '#6d28d9', border: '#ddd6fe' },
  LGU:        { bg: T.greenLight, color: T.greenDark, border: `${T.green}33` },
} as const

// ─── Small shared components (Pharmacy style) ─────────────────────────────────
function FilterBtn({ label, active, onClick, icon, activeColor, activeBg }: {
  label: string; active: boolean; onClick: () => void; icon?: React.ReactNode
  activeColor?: string; activeBg?: string
}) {
  const [hov, setHov] = useState(false)
  const color = activeColor || T.green
  const bgActive = activeBg || T.green
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
        cursor: 'pointer',
        border: active ? 'none' : `1.5px solid ${T.border}`,
        background: active ? bgActive : hov ? `${color}10` : 'transparent',
        color: active ? '#fff' : color,
        transition: 'all 0.15s',
        boxShadow: active ? `0 4px 12px ${color}44` : 'none',
        whiteSpace: 'nowrap',
        display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: 'Nunito, sans-serif',
      }}
    >
      {icon}{label}
    </button>
  )
}

function StatusBadge({ type }: { type: 'instock' | 'lowstock' | 'outofstock' | 'expired' }) {
  const map = {
    instock:    { bg: T.greenLight,  color: T.greenDark, border: `${T.green}33`,  label: 'In Stock'     },
    lowstock:   { bg: T.amberLight,  color: T.amber,     border: T.amberBorder,   label: 'Low Stock'    },
    outofstock: { bg: T.redLight,    color: T.red,       border: T.redBorder,     label: 'Out of Stock' },
    expired:    { bg: T.redLight,    color: T.red,       border: T.redBorder,     label: 'Expired'      },
  }
  const s = map[type]
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 800,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      whiteSpace: 'nowrap', display: 'inline-block',
    }}>{s.label}</span>
  )
}

// Small helper: normalize a raw "source" string into one of our 3 buckets
function normalizeSource(raw: string | null | undefined): 'DOH' | 'PHILHEALTH' | 'LGU' | 'OTHER' {
  const src = (raw || '').trim().toUpperCase()
  if (src === 'DOH') return 'DOH'
  if (src.includes('PHIL')) return 'PHILHEALTH' // matches "PHILHEALTH", "PhilHealth", etc.
  if (src === 'LGU') return 'LGU'
  return 'OTHER'
}

// Strip (Qty) for a row — derived from total_quantity ÷ pieces_per_strip,
// NOT from boxes × strips_per_box. This way loose pieces sitting outside a
// full box (partial stock, a broken-down box, etc.) still count toward
// strip availability as long as there are enough of them to form a whole
// strip. Returns 0 when the batch has no strip breakdown at all.
function stripQtyForRow(m: MedicineRow): number {
  if (!m.pieces_per_strip) return 0
  return Math.floor(m.total_quantity / m.pieces_per_strip)
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function MedicineStockPage() {
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const dk = mounted && theme === 'dark'

  const bg     = dk ? T.bgDk    : T.bg
  const card   = dk ? T.surfDk  : T.surface
  const card2  = dk ? T.surf2Dk : T.surface2
  const bdr    = dk ? T.borderDk : T.border
  const txt    = dk ? T.textDk  : T.text
  const txt2   = dk ? T.text2Dk : T.text2
  const shadow = dk ? T.shadowDk : T.shadow

  // ── State ────────────────────────────────────────────────────────────────
  const [medicines,    setMedicines]    = useState<MedicineRow[]>([])
  const [loading,      setLoading]      = useState(true)
  const [activeTab,    setActiveTab]    = useState<Tab>('drug')
  const [showModal,    setShowModal]    = useState(false)
  const [showExport,   setShowExport]   = useState(false)
  const [selectAll,    setSelectAll]    = useState(false)
  const [sortAZ,       setSortAZ]       = useState(false)
  const [ascending,    setAscending]    = useState(false)
  const [descending,   setDescending]   = useState(false)
  const [searchQuery,  setSearchQuery]  = useState('')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [toast,        setToast]        = useState('')
  const [actionBusyId, setActionBusyId] = useState<string | null>(null)
  const exportRef = useRef<HTMLDivElement>(null)

  // Archive confirmation modal — a batch cannot go straight from active
  // status to 'archived' without the user picking a reason (Spoiled/Damaged
  // or Other) and, for "Other", typing a note. That reason gets written
  // into medicine_batches.remarks before the status flips.
  // Expired batches SKIP this modal entirely — they're auto-archived by
  // fetchMedicines() the moment their EXP date passes.
  const [archiveTarget, setArchiveTarget] = useState<MedicineRow | null>(null)
  const [archiveReason, setArchiveReason] = useState<ArchiveReason>('spoiled')
  const [archiveNotes,  setArchiveNotes]  = useState('')

  const [importPreview, setImportPreview] = useState<ImportRow[] | null>(null)
  const [importing,     setImporting]     = useState(false)

  const selectedCount = medicines.filter(m => m.selected).length

  useEffect(() => { setMounted(true); fetchMedicines() }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setShowExport(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const showToastMsg = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  // Flattens a `medicine_batches` row (with its joined `medicines` row) into
  // the single object the table renders — identity fields (name, brand,
  // dosage, category, manufacturer, is_archived...) come from `medicines`;
  // stock fields (boxes, pieces, expiration, source, batch_number, status,
  // total_quantity, storage_location, date_received, remarks...) come from
  // the batch itself.
  const flattenBatchRow = (r: any): MedicineRow | null => {
    if (!r.medicines) return null // guard: shouldn't happen, FK is NOT NULL
    return {
      ...r.medicines,
      batch_id: r.batch_id,
      source: r.source,
      batch_number: r.batch_number,
      expiration_date: r.expiration_date,
      boxes: r.boxes,
      pieces_per_box: r.pieces_per_box,
      strips_per_box: r.strips_per_box,
      pieces_per_strip: r.pieces_per_strip,
      loose_pieces: r.loose_pieces,
      total_quantity: r.total_quantity,
      storage_location: r.storage_location,
      status: r.status, // batch stock status (available/low_stock/out_of_stock/archived)
      date_received: r.date_received,
      batch_remarks: r.remarks,
      selected: false,
    } as MedicineRow
  }

  // ── Fetch (joined with batches) + AUTO-ARCHIVE expired batches ─────────────
  const fetchMedicines = useCallback(async () => {
    setLoading(true)

    const { data, error } = await supabase
      .from('medicine_batches')
      .select('*, medicines(*)')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Fetch medicines failed:', error)
      showToastMsg(`Error loading inventory: ${error.message}`)
      setLoading(false)
      return
    }

    const rows = data || []
    const today = new Date(); today.setHours(0, 0, 0, 0)

    // A batch is due for auto-archive if it's past its EXP date and isn't
    // archived yet. Unlike Spoiled/Damaged or Other, an expired batch
    // doesn't need a human to confirm a reason — the system archives it
    // straight away and stamps the remarks so it's clear WHY it landed in
    // the Archived tab. We update `medicine_batches.status` ONLY —
    // `medicines.status` has its own separate check constraint
    // (active/inactive/discontinued) and must never receive this value.
    const expiredBatches = rows.filter((r: any) =>
      r.status !== 'archived' &&
      r.expiration_date && new Date(r.expiration_date) < today
    )

    if (expiredBatches.length > 0) {
      await Promise.all(
        expiredBatches.map((r: any) =>
          supabase.from('medicine_batches').update({
            status: 'archived',
            remarks: r.remarks && r.remarks.trim() ? r.remarks : 'Expired: Auto-archived by system',
          }).eq('batch_id', r.batch_id)
        )
      )
      const { data: fresh } = await supabase
        .from('medicine_batches')
        .select('*, medicines(*)')
        .order('created_at', { ascending: false })
      const freshFlat = ((fresh || []) as any[]).map(flattenBatchRow).filter(Boolean) as MedicineRow[]
      setMedicines(freshFlat)
      showToastMsg(`${expiredBatches.length} expired batch(es) auto-archived.`)
    } else {
      const flat = (rows as any[]).map(flattenBatchRow).filter(Boolean) as MedicineRow[]
      setMedicines(flat)
    }

    setLoading(false)
  }, [])

  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked)
    setMedicines(prev => prev.map(m => visibleIds.includes(m.batch_id) ? { ...m, selected: checked } : m))
  }
  const handleSelectOne = (batchId: string, checked: boolean) =>
    setMedicines(prev => prev.map(m => m.batch_id === batchId ? { ...m, selected: checked } : m))
  const handleAscending  = (checked: boolean) => { setAscending(checked);  if (checked) { setDescending(false); setSortAZ(false) } }
  const handleDescending = (checked: boolean) => { setDescending(checked); if (checked) { setAscending(false); setSortAZ(false) } }

  const isExpired = (m: MedicineRow) => {
    if (!m.expiration_date) return false
    const exp = new Date(m.expiration_date); const today = new Date(); today.setHours(0,0,0,0)
    return exp.getTime() < today.getTime()
  }
  // Archived effective = the medicine identity was archived, OR this specific
  // batch is past its EXP date, OR this batch was explicitly archived.
  const isArchivedEffective = (m: MedicineRow) => m.is_archived || isExpired(m) || m.status === 'archived'

  // ── Row actions: MANUALLY archiving a batch (Spoiled/Damaged or Other)
  // goes through a confirmation modal that requires a reason first.
  // Expired batches never reach this — they're auto-archived on fetch, so
  // the "Archive" button in the active tabs only ever applies to batches
  // that are still within their EXP date. Restoring an archived (but not
  // expired) batch brings it back to its computed live status. ──────────

  // Step 1: open the modal, defaulting to "Spoiled / Damaged".
  const openArchiveModal = (m: MedicineRow) => {
    setArchiveTarget(m)
    setArchiveReason('spoiled')
    setArchiveNotes('')
  }

  // Step 2: user confirms inside the modal — only then does the batch
  // actually flip to 'archived', carrying the reason into `remarks`.
  const handleArchiveBatch = async () => {
    if (!archiveTarget) return
    const m = archiveTarget
    const reasonLabel = archiveReason === 'spoiled' ? 'Spoiled/Damaged' : 'Other'
    const notes = archiveNotes.trim()
    const combinedRemarks = notes ? `${reasonLabel}: ${notes}` : reasonLabel

    setActionBusyId(m.batch_id)
    const { error } = await supabase
      .from('medicine_batches')
      .update({ status: 'archived', remarks: combinedRemarks })
      .eq('batch_id', m.batch_id)
    setActionBusyId(null)
    if (error) { showToastMsg(`Failed to archive: ${error.message}`); return }
    showToastMsg(`${m.generic_name} (batch ${m.batch_number || m.batch_id}) archived.`)
    setArchiveTarget(null)
    setArchiveNotes('')
    fetchMedicines()
  }

  const handleRestoreBatch = async (m: MedicineRow) => {
    if (isExpired(m)) { showToastMsg('This batch is expired and cannot be restored to active stock.'); return }
    setActionBusyId(m.batch_id)
    const newStatus = computeStatus(m.total_quantity, m.expiration_date)
    const { error } = await supabase.from('medicine_batches').update({ status: newStatus }).eq('batch_id', m.batch_id)
    setActionBusyId(null)
    if (error) { showToastMsg(`Failed to restore: ${error.message}`); return }
    showToastMsg(`${m.generic_name} (batch ${m.batch_number || m.batch_id}) restored.`)
    fetchMedicines()
  }

  // Tab filter: Drugs / Supplies / Archived (unchanged behavior)
  const tabFiltered = useMemo(() => {
    if (activeTab === 'archived') return medicines.filter(m => isArchivedEffective(m))
    return medicines.filter(m => !isArchivedEffective(m) && m.category === activeTab)
  }, [medicines, activeTab])

  // Source filter: DOH / PhilHealth / LGU / All — applied on top of the tab filter
  const sourceFiltered = useMemo(() => {
    if (sourceFilter === 'all') return tabFiltered
    return tabFiltered.filter(m => normalizeSource(m.source) === sourceFilter)
  }, [tabFiltered, sourceFilter])

  const searchFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return sourceFiltered
    return sourceFiltered.filter(m =>
      m.generic_name.toLowerCase().includes(q) ||
      (m.brand_name || '').toLowerCase().includes(q) ||
      (m.dosage_form || '').toLowerCase().includes(q) ||
      (m.batch_number || '').toLowerCase().includes(q) ||
      (m.manufacturer || '').toLowerCase().includes(q) ||
      (m.storage_location || '').toLowerCase().includes(q)
    )
  }, [sourceFiltered, searchQuery])

  const sortedMedicines = useMemo(() => {
    return [...searchFiltered].sort((a, b) => {
      if (sortAZ)       return a.generic_name.localeCompare(b.generic_name)
      if (ascending)    return new Date(a.expiration_date || '').getTime() - new Date(b.expiration_date || '').getTime()
      if (descending)   return new Date(b.expiration_date || '').getTime() - new Date(a.expiration_date || '').getTime()
      return 0
    })
  }, [searchFiltered, sortAZ, ascending, descending])

  const visibleIds = sortedMedicines.map(m => m.batch_id)

  const drugCount     = medicines.filter(m => !isArchivedEffective(m) && m.category === 'drug').length
  const supplyCount   = medicines.filter(m => !isArchivedEffective(m) && m.category === 'supply').length
  const archivedCount = medicines.filter(m => isArchivedEffective(m)).length

  // Source counts — computed from tabFiltered so they reflect the CURRENT tab (Drugs/Supplies/Archived)
  const sourceCounts = useMemo(() => {
    const counts = { all: tabFiltered.length, DOH: 0, PHILHEALTH: 0, LGU: 0 }
    tabFiltered.forEach(m => {
      const s = normalizeSource(m.source)
      if (s === 'DOH') counts.DOH++
      else if (s === 'PHILHEALTH') counts.PHILHEALTH++
      else if (s === 'LGU') counts.LGU++
    })
    return counts
  }, [tabFiltered])

  const getExportData = () => {
    const data = selectedCount > 0 ? sortedMedicines.filter(m => m.selected) : sortedMedicines
    return data.map((m, i) => ({
      'No.': i + 1,
      'Batch No.': m.batch_number || '',
      'Generic Name': m.generic_name,
      'Brand Name': m.brand_name || '',
      [activeTab === 'supply' ? 'Specification' : 'Dosage']: m.dosage_strength || '',
      'Type': m.dosage_form || '',
      'Manufacturer': m.manufacturer || '',
      'Source': m.source || '',
      'EXP Date': m.expiration_date || '',
      'Date Received': m.date_received || '',
      'Stock Quantity': m.total_quantity,
      'Strip (Qty)': stripQtyForRow(m),
      'Unit': m.unit || '',
      'Storage': m.storage_location || '',
      'Status': m.status,
    }))
  }

  const handleExportExcel = () => {
    const data = getExportData()
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Medicine Stock')
    XLSX.writeFile(wb, 'medicine-stock.xlsx')
    setShowExport(false); showToastMsg('Exported as Excel!')
  }
  const handleExportPDF = () => {
    const data = getExportData()
    const doc = new jsPDF()
    doc.text('Medicine Stock Report', 14, 15)
    autoTable(doc, {
      startY: 22,
      head: [Object.keys(data[0] || {})],
      body: data.map(d => Object.values(d).map(String)),
      headStyles: { fillColor: [13, 59, 31] },
      alternateRowStyles: { fillColor: [220, 252, 231] },
      styles: { fontSize: 9 },
    })
    doc.save('medicine-stock.pdf')
    setShowExport(false); showToastMsg('Exported as PDF!')
  }
  const handleExportCSV = () => {
    const data = getExportData()
    if (!data.length) { showToastMsg('Nothing to export!'); return }
    const headers = Object.keys(data[0]).join(',')
    const csvRows = data.map(d => Object.values(d).join(',')).join('\n')
    const blob = new Blob([`${headers}\n${csvRows}`], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'medicine-stock.csv'; a.click()
    URL.revokeObjectURL(url); setShowExport(false); showToastMsg('Exported as CSV!')
  }

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = ''
    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
      const parsed: ImportRow[] = rows.map(row => {
        const name = String(row['Generic Name'] ?? row['generic_name'] ?? '').trim()
        if (!name) return null
        const boxes       = Math.max(0, parseInt(String(row['Boxes'] ?? row['boxes'] ?? '0'), 10) || 0)
        const loosePieces = Math.max(0, parseInt(String(row['Loose Pieces'] ?? row['loose_pieces'] ?? '0'), 10) || 0)
        const pcsPerBox   = Math.max(1, parseInt(String(row['Pieces per Box'] ?? row['pieces_per_box'] ?? '1'), 10) || 1)
        const rawCategory = String(row['Category'] ?? row['category'] ?? '').trim().toLowerCase()
        const category: 'drug' | 'supply' = rawCategory.startsWith('supply') || rawCategory.includes('supply') ? 'supply' : 'drug'
        return {
          generic_name: name,
          brand_name: String(row['Brand Name'] ?? row['brand_name'] ?? '').trim(),
          dosage_strength: String(row['Dosage'] ?? row['Specification'] ?? row['dosage_strength'] ?? '').trim(),
          dosage_form: String(row['Type'] ?? row['dosage_form'] ?? '').trim(),
          unit: String(row['Unit'] ?? row['unit'] ?? '').trim(),
          manufacturer: String(row['Manufacturer'] ?? row['manufacturer'] ?? '').trim(),
          source: String(row['Source'] ?? row['source'] ?? '').trim(),
          batch_number: String(row['Batch No.'] ?? row['batch_number'] ?? '').trim(),
          expiration_date: String(row['EXP Date'] ?? row['expiration_date'] ?? new Date().toISOString().split('T')[0]),
          boxes,
          pieces_per_box: pcsPerBox,
          loose_pieces: loosePieces,
          category,
        } as ImportRow
      }).filter(Boolean) as ImportRow[]
      if (parsed.length === 0) { showToastMsg('No valid rows found in file.'); return }
      setImportPreview(parsed)
    } catch { showToastMsg('Failed to read file.') }
  }

  // Same dedupe idea as AddMedicineModal: reuse an existing, non-archived
  // `medicines` row that matches this import row's identity fields, instead
  // of creating a duplicate. Returns null if nothing matches.
  const findExistingMedicineId = async (row: ImportRow, category: 'drug' | 'supply'): Promise<string | null> => {
    const generic = row.generic_name?.trim()
    if (!generic) return null

    let query = supabase
      .from('medicines')
      .select('medicine_id')
      .ilike('generic_name', generic)
      .eq('category', category)
      .eq('is_archived', false)

    const brand = row.brand_name?.trim()
    query = brand ? query.ilike('brand_name', brand) : query.is('brand_name', null)

    const dosage = row.dosage_strength?.trim()
    query = dosage ? query.ilike('dosage_strength', dosage) : query.is('dosage_strength', null)

    const form = row.dosage_form?.trim()
    query = form ? query.ilike('dosage_form', form) : query.is('dosage_form', null)

    const { data, error } = await query.limit(1)
    if (error) {
      console.error('Import dedupe lookup failed:', error)
      return null
    }
    return data && data.length > 0 ? data[0].medicine_id : null
  }

  const handleImportConfirm = async () => {
    if (!importPreview) return
    setImporting(true)
    let count = 0
    const importCategory: 'drug' | 'supply' = activeTab === 'supply' ? 'supply' : 'drug'

    for (const row of importPreview) {
      const totalQty = row.boxes * row.pieces_per_box + row.loose_pieces

      // 1) Reuse an existing medicine if this row matches one — never
      //    duplicate the `medicines` identity row on import.
      let medicineId = await findExistingMedicineId(row, importCategory)

      if (!medicineId) {
        const { data: medRow, error: medError } = await supabase
          .from('medicines')
          .insert({
            generic_name: row.generic_name,
            brand_name: row.brand_name || null,
            dosage_strength: row.dosage_strength || null,
            dosage_form: row.dosage_form || null,
            category: importCategory,
            unit: row.unit || null,
            manufacturer: row.manufacturer || null,
            remarks: null,
            is_archived: false,
          })
          .select('medicine_id')
          .single()

        if (medError || !medRow) {
          console.error('Import: insert medicine failed:', medError)
          continue
        }
        medicineId = medRow.medicine_id
      }

      // 2) Always insert a new stock batch — that's the actual quantity
      //    being brought in by this import row.
      const { error: batchError } = await supabase.from('medicine_batches').insert({
        medicine_id: medicineId,
        source: row.source || null,
        batch_number: row.batch_number || null,
        expiration_date: row.expiration_date || null,
        boxes: row.boxes,
        pieces_per_box: row.pieces_per_box,
        loose_pieces: row.loose_pieces,
        storage_location: null,
        status: computeStatus(totalQty, row.expiration_date),
        date_received: new Date().toISOString().split('T')[0],
        remarks: null,
      })

      if (!batchError) count++
      else console.error('Import: insert batch failed:', batchError)
    }

    setImporting(false); showToastMsg(`Imported ${count} item(s) successfully.`)
    setImportPreview(null); fetchMedicines()
  }

  const isSupplyTab  = activeTab === 'supply'
  const dosageLabel  = isSupplyTab ? 'Specification' : 'Dosage'

  // Total column count for the table (used by colSpan on loading/empty rows):
  // No, Batch, Name, Dosage, Type, Manufacturer, Source, Unit, EXP, Status,
  // Storage, Date Received, Boxes, Strip (Qty), Pieces, Actions = 16,
  // + checkbox column when the tab isn't Archived.
  const columnCount = activeTab !== 'archived' ? 17 : 16

  const thStyle: React.CSSProperties = {
    padding: '12px 12px', textAlign: 'left', fontWeight: 800,
    color: T.green, fontSize: 10, textTransform: 'uppercase',
    letterSpacing: 0.8, whiteSpace: 'nowrap',
    fontFamily: 'Nunito, sans-serif',
    position: 'sticky', top: 0, background: bg, zIndex: 1,
  }

  const emptyStateLabel = searchQuery
    ? `No medicines found matching "${searchQuery}"`
    : sourceFilter !== 'all'
      ? `No items found for source "${sourceFilter === 'PHILHEALTH' ? 'PhilHealth' : sourceFilter}".`
      : activeTab === 'archived'
        ? 'No archived items yet.'
        : `No ${isSupplyTab ? 'supplies' : 'medicines'} yet. Add one to get started.`

  // ─── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100vh', background: bg, fontFamily: 'Nunito, sans-serif' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        * { font-family: Nunito, sans-serif !important; }
      `}</style>

      <Sidebar />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar />

        <main style={{ flex: 1, padding: 24, overflowY: 'auto', background: bg }}>

          {/* ── Page header ── */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <p style={{ color: T.mint, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4, margin: 0 }}>Warehouse</p>
              <h1 style={{ fontSize: 34, fontWeight: 900, color: dk ? T.mint : T.green, margin: 0, lineHeight: 1 }}>MEDICINE INVENTORY</h1>
            </div>
            {activeTab !== 'archived' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {/* Export dropdown */}
                <div ref={exportRef} style={{ position: 'relative', flexShrink: 0 }}>
                  <button
                    onClick={() => setShowExport(v => !v)}
                    style={{
                      height: 42, padding: '0 18px', borderRadius: T.radius, fontSize: 13, fontWeight: 800,
                      border: `1.5px solid ${bdr}`, background: card, color: T.green,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                      boxShadow: shadow, whiteSpace: 'nowrap', transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = T.greenLight)}
                    onMouseLeave={e => (e.currentTarget.style.background = card)}
                  >
                    <Download size={14} />
                    Export {selectedCount > 0 ? `(${selectedCount})` : ''}
                  </button>
                  {showExport && (
                    <div style={{
                      position: 'absolute', right: 0, top: 'calc(100% + 6px)',
                      background: card, border: `1px solid ${bdr}`,
                      borderRadius: T.radiusSm, zIndex: 99, minWidth: 200,
                      boxShadow: shadow, overflow: 'hidden', animation: 'fadeIn 0.15s ease',
                    }}>
                      <div style={{ padding: '8px 14px 6px', fontSize: 10, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${bdr}` }}>
                        {selectedCount > 0 ? `Export ${selectedCount} selected` : 'Export All'}
                      </div>
                      {[
                        { label: 'Download as Excel', fn: handleExportExcel, icon: <IconExcelFile /> },
                        { label: 'Download as PDF',   fn: handleExportPDF,   icon: <IconPdfFile /> },
                      ].map(({ label, fn, icon }) => (
                        <button key={label} onClick={() => { fn(); setShowExport(false) }} style={{
                          width: '100%', padding: '10px 16px', textAlign: 'left',
                          border: 'none', background: 'transparent', cursor: 'pointer',
                          fontSize: 13, color: txt, display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600,
                        }}
                          onMouseEnter={e => (e.currentTarget.style.background = bg)}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >{icon}{label}</button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Import */}
                <label style={{
                  background: 'transparent', color: T.green, border: `1.5px solid ${T.green}`,
                  borderRadius: T.radius, height: 42, padding: '0 22px', boxSizing: 'border-box',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                  fontWeight: 800, fontSize: 13, transition: 'all 0.2s', whiteSpace: 'nowrap',
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = T.greenLight)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <IconImport /> Import
                  <input type="file" accept=".xlsx,.xls" onChange={handleImportExcel} style={{ display: 'none' }} />
                </label>

                {/* Add — opens the standalone AddMedicineModal component */}
                <button
                  onClick={() => setShowModal(true)}
                  style={{
                    background: T.greenMid, color: '#fff', border: 'none',
                    borderRadius: T.radius, height: 42, padding: '0 26px', boxSizing: 'border-box',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                    fontWeight: 800, fontSize: 14,
                    boxShadow: `0 6px 20px ${T.green}44`, transition: 'all 0.2s', whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)' }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
                >
                  <Plus size={18} /> {isSupplyTab ? 'Add Supply' : 'Add Medicine'}
                </button>
              </div>
            )}
          </div>

          {/* ── Filter bar ── */}
          <div style={{
            background: card, borderRadius: T.radius,
            padding: '16px 20px', marginBottom: 16,
            boxShadow: shadow, border: `1px solid ${bdr}`,
          }}>
            {/* Source row — a lighter, secondary chip style so it reads as a filter refinement,
                distinct from the bold primary Drugs/Supplies/Archived tabs below it */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingBottom: 12, borderBottom: `1px dashed ${bdr}`, marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 2 }}>
                Source
              </span>
              {([
                { key: 'all'        as SourceFilter, label: 'All',        count: sourceCounts.all,       color: txt2 },
                { key: 'DOH'        as SourceFilter, label: 'DOH',        count: sourceCounts.DOH,        color: SOURCE_COLORS.DOH.color },
                { key: 'PHILHEALTH' as SourceFilter, label: 'PhilHealth', count: sourceCounts.PHILHEALTH, color: SOURCE_COLORS.PHILHEALTH.color },
                { key: 'LGU'        as SourceFilter, label: 'LGU',        count: sourceCounts.LGU,        color: SOURCE_COLORS.LGU.color },
              ]).map(({ key, label, count, color }) => {
                const active = sourceFilter === key
                return (
                  <button key={key} onClick={() => setSourceFilter(key)} style={{
                    padding: '5px 12px 5px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                    cursor: 'pointer', transition: 'all 0.15s',
                    border: `1.5px solid ${active ? color : bdr}`,
                    background: active ? `${color}14` : 'transparent',
                    color: active ? color : txt2,
                    display: 'flex', alignItems: 'center', gap: 7,
                  }}>
                    {key !== 'all' && (
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                    )}
                    {label}
                    <span style={{
                      background: active ? `${color}22` : bdr,
                      color: active ? color : txt2,
                      borderRadius: 20, padding: '1px 7px', fontSize: 10, fontWeight: 700,
                    }}>{count}</span>
                  </button>
                )
              })}
            </div>

            {/* Tab pills */}
            <div style={{
              display: 'flex', gap: 3, background: bg,
              borderRadius: 24, padding: 3, border: `1px solid ${bdr}`,
              marginBottom: 12, width: 'fit-content',
            }}>
              {([
                { tab: 'drug'     as Tab, icon: <IconDrug />,    label: 'Drugs',    count: drugCount     },
                { tab: 'supply'   as Tab, icon: <IconSupply />,  label: 'Supplies', count: supplyCount   },
                { tab: 'archived' as Tab, icon: <IconArchive />, label: 'Archived', count: archivedCount },
              ]).map(({ tab, icon, label, count }) => {
                const active = activeTab === tab
                return (
                  <button key={tab} onClick={() => { setActiveTab(tab); setSelectAll(false); setSourceFilter('all') }} style={{
                    padding: '5px 16px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                    border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                    background: active ? (tab === 'archived' ? '#6b7280' : T.green) : 'transparent',
                    color:      active ? '#fff' : txt2,
                    boxShadow:  active ? (tab === 'archived' ? '0 2px 8px rgba(107,114,128,0.4)' : `0 2px 8px ${T.green}44`) : 'none',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {icon}{label}
                    <span style={{
                      background: active ? 'rgba(255,255,255,0.25)' : bdr,
                      color: active ? '#fff' : txt2,
                      borderRadius: 20, padding: '1px 8px', fontSize: 10, fontWeight: 700,
                    }}>{count}</span>
                  </button>
                )
              })}
            </div>

            {/* Search row */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: txt2, display: 'flex' }}>
                  <IconSearch />
                </span>
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search medicine, brand, type, batch, manufacturer, or storage..."
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '9px 36px 9px 32px',
                    borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`,
                    fontSize: 12, outline: 'none', color: txt,
                    background: bg, transition: 'border 0.15s',
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                  onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: txt2, display: 'flex', padding: 0,
                  }}><X size={14} /></button>
                )}
              </div>
            </div>

            {/* Bulk sort/select controls */}
            {activeTab !== 'archived' && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', paddingTop: 12, borderTop: `1px dashed ${bdr}` }}>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12, fontWeight: 700, color: txt2, cursor: 'pointer',
                  padding: '5px 14px', borderRadius: 20, border: `1.5px solid ${bdr}`,
                }}>
                  <input
                    type="checkbox"
                    checked={sortedMedicines.length > 0 && selectedCount === sortedMedicines.length}
                    onChange={e => handleSelectAll(e.target.checked)}
                    style={{ accentColor: T.green, width: 12, height: 12 }}
                  />
                  Select All
                </label>
                <div style={{ width: 1, height: 24, background: bdr }} />
                <FilterBtn label="A–Z"        active={sortAZ}     onClick={() => { const next = !sortAZ; setSortAZ(next); if (next) { setAscending(false); setDescending(false) } }} />
                <FilterBtn label="Ascending"  active={ascending}  onClick={() => handleAscending(!ascending)}   />
                <FilterBtn label="Descending" active={descending} onClick={() => handleDescending(!descending)} />
                {selectedCount > 0 && (
                  <span style={{ marginLeft: 8, fontSize: 12, color: T.green, fontWeight: 700 }}>
                    {selectedCount} selected
                  </span>
                )}
              </div>
            )}
          </div>

          {/* ── Table ── */}
          <div style={{
            background: card, border: `1px solid ${bdr}`,
            borderRadius: T.radius, overflow: 'hidden', boxShadow: shadow,
          }}>
            <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 420px)', minHeight: 200 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: bg, borderBottom: `2px solid ${bdr}` }}>
                    {activeTab !== 'archived' && <th style={{ ...thStyle, width: 50 }}></th>}
                    <th style={thStyle}>No.</th>
                    <th style={thStyle}>Batch No.</th>
                    <th style={thStyle}>Medicine Name</th>
                    <th style={thStyle}>{dosageLabel}</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Manufacturer</th>
                    <th style={thStyle}>Source</th>
                    <th style={thStyle}>Unit</th>
                    <th style={thStyle}>EXP Date</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Storage</th>
                    <th style={thStyle}>Date Received</th>
                    <th style={{ ...thStyle, textAlign: 'right', borderLeft: `2px dashed ${T.green}22`, minWidth: 90 }}>
                      <div style={{ fontSize: 8, color: T.text3, fontWeight: 700, letterSpacing: 0.4, marginBottom: 2 }}>WAREHOUSE</div>
                      Boxes
                    </th>
                    <th style={{ ...thStyle, textAlign: 'right', minWidth: 90 }}>
                      <div style={{ fontSize: 8, color: '#a855f7', fontWeight: 700, letterSpacing: 0.4, marginBottom: 2 }}>PACK</div>
                      Strip (Qty)
                    </th>
                    <th style={{ ...thStyle, textAlign: 'right', minWidth: 100 }}>
                      <div style={{ fontSize: 8, color: '#3b82f6', fontWeight: 700, letterSpacing: 0.4, marginBottom: 2 }}>DISPENSE</div>
                      Pieces (Qty)
                    </th>
                    <th style={{ ...thStyle, textAlign: 'center', minWidth: 80 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={columnCount} style={{ textAlign: 'center', padding: 48, color: txt2, fontSize: 13 }}>
                      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 32, height: 32, border: `3px solid ${T.green}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        Loading medicines...
                      </div>
                    </td></tr>
                  ) : sortedMedicines.length === 0 ? (
                    <tr><td colSpan={columnCount} style={{ textAlign: 'center', padding: 56, color: txt2, fontSize: 13 }}>
                      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 10, animation: 'fadeIn 0.2s ease' }}>
                        <div style={{
                          width: 52, height: 52, borderRadius: '50%',
                          background: T.greenLight, color: T.green,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <PackageSearch size={24} />
                        </div>
                        <div style={{ fontWeight: 700, color: txt }}>{emptyStateLabel}</div>
                        {(searchQuery || sourceFilter !== 'all') && (
                          <button
                            onClick={() => { setSearchQuery(''); setSourceFilter('all') }}
                            style={{
                              marginTop: 2, padding: '6px 16px', borderRadius: 20,
                              border: `1.5px solid ${T.green}`, background: 'transparent',
                              color: T.green, fontSize: 12, fontWeight: 800, cursor: 'pointer',
                            }}
                          >Clear filters</button>
                        )}
                      </div>
                    </td></tr>
                  ) : sortedMedicines.map((med, i) => {
                    const expired = isExpired(med)
                    const sel     = med.selected
                    const rowBg   = sel ? `${T.green}08` : i % 2 === 0 ? card : card2
                    const statusType = expired ? 'expired'
                      : med.status === 'out_of_stock' ? 'outofstock'
                      : med.status === 'low_stock' ? 'lowstock'
                      : 'instock'
                    const busy = actionBusyId === med.batch_id
                    const stripQty = stripQtyForRow(med)

                    return (
                      <tr key={med.batch_id}
                        style={{ background: rowBg, borderBottom: `1px solid ${bdr}`, transition: 'background 0.1s' }}
                        onMouseEnter={e => { if (!sel) (e.currentTarget as HTMLTableRowElement).style.background = T.greenLight }}
                        onMouseLeave={e => { if (!sel) (e.currentTarget as HTMLTableRowElement).style.background = rowBg }}
                      >
                        {activeTab !== 'archived' && (
                          <td style={{ padding: '11px 12px' }}>
                            <input
                              type="checkbox" checked={sel}
                              onChange={e => handleSelectOne(med.batch_id, e.target.checked)}
                              style={{ accentColor: T.green, width: 12, height: 12 }}
                            />
                          </td>
                        )}
                        <td style={{ padding: '11px 12px', color: txt2, fontWeight: 700 }}>{i + 1}</td>
                        <td style={{ padding: '11px 12px', color: txt2, fontSize: 11 }}>{med.batch_number || '—'}</td>
                        <td style={{ padding: '11px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                            <span style={{ color: txt2, flexShrink: 0 }}>
                              {med.category === 'supply' ? <IconSupply /> : <IconDrug />}
                            </span>
                            <div>
                              <div style={{ fontWeight: 700, color: txt, fontSize: 12 }}>{med.generic_name}</div>
                              {med.brand_name && <div style={{ fontSize: 10, color: txt2 }}>{med.brand_name}</div>}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '11px 12px', color: txt2, fontSize: 11 }}>{med.dosage_strength || '—'}</td>
                        <td style={{ padding: '11px 12px', color: txt2, fontSize: 11 }}>{med.dosage_form || '—'}</td>
                        <td style={{ padding: '11px 12px', color: txt2, fontSize: 11 }}>{med.manufacturer || '—'}</td>
                        <td style={{ padding: '11px 12px', fontSize: 11 }}>
                          {med.source ? (
                            <span style={{
                              padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 800,
                              background: normalizeSource(med.source) === 'DOH' ? SOURCE_COLORS.DOH.bg
                                : normalizeSource(med.source) === 'PHILHEALTH' ? SOURCE_COLORS.PHILHEALTH.bg
                                : normalizeSource(med.source) === 'LGU' ? SOURCE_COLORS.LGU.bg
                                : bdr,
                              color: normalizeSource(med.source) === 'DOH' ? SOURCE_COLORS.DOH.color
                                : normalizeSource(med.source) === 'PHILHEALTH' ? SOURCE_COLORS.PHILHEALTH.color
                                : normalizeSource(med.source) === 'LGU' ? SOURCE_COLORS.LGU.color
                                : txt2,
                              whiteSpace: 'nowrap',
                            }}>{med.source}</span>
                          ) : '—'}
                        </td>
                        <td style={{ padding: '11px 12px', color: txt2, fontSize: 11 }}>{med.unit || '—'}</td>
                        <td style={{ padding: '11px 12px', fontSize: 11, color: expired ? T.red : txt2 }}>
                          {med.expiration_date || '—'}
                          {expired && (
                            <span style={{
                              fontSize: 9, marginLeft: 5,
                              background: T.redLight, color: T.red,
                              border: `1px solid ${T.redBorder}`,
                              borderRadius: 4, padding: '1px 5px', fontWeight: 800,
                            }}>EXPIRED</span>
                          )}
                        </td>
                        <td style={{ padding: '11px 12px' }}><StatusBadge type={statusType} /></td>
                        <td style={{ padding: '11px 12px', color: txt2, fontSize: 11 }}>{med.storage_location || '—'}</td>
                        <td style={{ padding: '11px 12px', color: txt2, fontSize: 11 }}>{med.date_received || '—'}</td>
                        <td style={{ padding: '11px 12px', textAlign: 'right', borderLeft: `2px dashed ${T.green}22` }}>
                          <div style={{ fontWeight: 900, fontSize: 14, color: txt }}>{med.boxes > 0 ? med.boxes : '—'}</div>
                          <div style={{ fontSize: 10, color: T.text3 }}>{med.boxes > 0 ? 'boxes' : ''}</div>
                        </td>

                        {/* Strip (Qty) — derived from total_quantity ÷ pieces_per_strip,
                            so loose pieces outside a full box still count toward strip
                            availability as long as they're enough to form a whole strip. */}
                        <td style={{ padding: '11px 12px', textAlign: 'right' }}>
                          {med.pieces_per_strip ? (
                            <>
                              <div style={{ fontWeight: 900, fontSize: 14, color: txt }}>{stripQty}</div>
                              <div style={{ fontSize: 10, color: T.text3 }}>strips</div>
                            </>
                          ) : (
                            <span style={{ color: T.text3 }}>—</span>
                          )}
                        </td>

                        {/* Pieces — total dispensable qty (generated column, source of truth) */}
                        <td style={{ padding: '11px 12px', textAlign: 'right' }}>
                          <div style={{ fontWeight: 900, fontSize: 15, color: med.total_quantity === 0 ? T.red : T.green }}>
                            {med.total_quantity} pcs
                          </div>
                          {med.boxes > 0 && (
                            <div style={{ fontSize: 10, color: T.text3 }}>
                              {med.boxes} box{med.boxes !== 1 ? 'es' : ''}{med.loose_pieces > 0 ? ` + ${med.loose_pieces} loose` : ''}
                            </div>
                          )}
                        </td>

                        {/* Row actions — archive out of active stock (via reason modal, Spoiled/Other
                            only — expired batches never reach this tab), or restore from Archived */}
                        <td style={{ padding: '11px 12px', textAlign: 'center' }}>
                          {activeTab === 'archived' ? (
                            <button
                              disabled={busy || expired}
                              title={expired ? 'Expired batches cannot be restored' : 'Restore to active stock'}
                              onClick={() => handleRestoreBatch(med)}
                              style={{
                                width: 30, height: 30, borderRadius: 8, border: `1.5px solid ${bdr}`,
                                background: 'transparent', color: expired ? T.text3 : T.green,
                                cursor: expired || busy ? 'not-allowed' : 'pointer',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                opacity: busy ? 0.5 : 1, transition: 'all 0.15s',
                              }}
                              onMouseEnter={e => { if (!expired && !busy) e.currentTarget.style.background = T.greenLight }}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            ><RotateCcw size={14} /></button>
                          ) : (
                            <button
                              disabled={busy}
                              title="Archive this batch"
                              onClick={() => openArchiveModal(med)}
                              style={{
                                width: 30, height: 30, borderRadius: 8, border: `1.5px solid ${bdr}`,
                                background: 'transparent', color: txt2,
                                cursor: busy ? 'not-allowed' : 'pointer',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                opacity: busy ? 0.5 : 1, transition: 'all 0.15s',
                              }}
                              onMouseEnter={e => { if (!busy) { e.currentTarget.style.background = T.redLight; e.currentTarget.style.color = T.red; e.currentTarget.style.borderColor = T.redBorder } }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = txt2; e.currentTarget.style.borderColor = bdr }}
                            ><ArchiveIcon size={14} /></button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Table footer */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 18px', borderTop: `1px solid ${bdr}`, background: bg,
            }}>
              <span style={{ fontSize: 12, color: txt2, fontWeight: 600 }}>
                {sortedMedicines.length === 0
                  ? 'No results'
                  : `${sortedMedicines.length} item${sortedMedicines.length !== 1 ? 's' : ''} total`}
              </span>
              {selectedCount > 0 && (
                <span style={{ fontSize: 12, color: T.green, fontWeight: 700 }}>
                  {selectedCount} selected
                </span>
              )}
            </div>
          </div>

          {/* ── Add Medicine / Supply — now a fully separate component ── */}
          <AddMedicineModal
            show={showModal}
            onClose={() => setShowModal(false)}
            onAdded={fetchMedicines}
            showToast={showToastMsg}
            activeTab={activeTab}
            dk={dk}
          />

          {/* ── Archive Confirmation Modal — reason required before archiving.
               Only Spoiled/Damaged and Other reach this modal; expired
               batches are auto-archived by the system in fetchMedicines(). ── */}
          {archiveTarget && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 3000, padding: 16,
            }} onClick={() => actionBusyId === null && setArchiveTarget(null)}>
              <div style={{
                background: card, borderRadius: T.radius,
                width: '100%', maxWidth: 440,
                boxShadow: shadow, border: `1px solid ${bdr}`,
                overflow: 'hidden', animation: 'fadeIn 0.15s ease',
              }} onClick={e => e.stopPropagation()}>

                <div style={{
                  background: T.redLight, padding: '18px 22px',
                  borderBottom: `1px solid ${T.redBorder}`,
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: '50%',
                    background: '#fff', color: T.red,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}><ArchiveIcon size={18} /></div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: 15, color: T.red }}>Archive Batch</div>
                    <div style={{ fontSize: 11, color: txt2, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {archiveTarget.generic_name} — batch {archiveTarget.batch_number || archiveTarget.batch_id}
                    </div>
                  </div>
                </div>

                <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                      Reason for archiving
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {([
                        { key: 'spoiled' as const, label: 'Spoiled / Damaged' },
                        { key: 'other'   as const, label: 'Other' },
                      ]).map(({ key, label }) => {
                        const active = archiveReason === key
                        return (
                          <button key={key} onClick={() => setArchiveReason(key)} style={{
                            padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                            cursor: 'pointer', border: `1.5px solid ${active ? T.red : bdr}`,
                            background: active ? T.redLight : 'transparent',
                            color: active ? T.red : txt2, transition: 'all 0.15s',
                          }}>{label}</button>
                        )
                      })}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                      Remarks {archiveReason === 'other' ? '(required)' : '(optional details)'}
                    </div>
                    <textarea
                      value={archiveNotes}
                      onChange={e => setArchiveNotes(e.target.value)}
                      placeholder={
                        archiveReason === 'spoiled' ? 'e.g. Water damage, broken packaging, discoloration'
                        : 'Describe the reason for archiving...'
                      }
                      rows={3}
                      style={{
                        width: '100%', boxSizing: 'border-box', resize: 'vertical',
                        padding: '10px 12px', borderRadius: T.radiusSm, border: `1.5px solid ${bdr}`,
                        fontSize: 12, outline: 'none', color: txt, background: bg,
                        fontFamily: 'Nunito, sans-serif', transition: 'border 0.15s',
                      }}
                      onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                      onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
                    />
                  </div>
                </div>

                <div style={{
                  padding: '14px 22px', borderTop: `1px solid ${bdr}`,
                  background: card2, display: 'flex', gap: 10, justifyContent: 'flex-end',
                }}>
                  <button
                    onClick={() => setArchiveTarget(null)}
                    disabled={actionBusyId === archiveTarget.batch_id}
                    style={{
                      padding: '9px 20px', borderRadius: T.radius, border: `1.5px solid ${bdr}`,
                      background: 'transparent', color: txt2, fontSize: 13, fontWeight: 800, cursor: 'pointer',
                    }}
                  >Cancel</button>
                  <button
                    onClick={handleArchiveBatch}
                    disabled={actionBusyId === archiveTarget.batch_id || (archiveReason === 'other' && !archiveNotes.trim())}
                    style={{
                      padding: '9px 24px', borderRadius: T.radius, border: 'none',
                      background: T.red, color: '#fff', fontSize: 13, fontWeight: 800,
                      cursor: (actionBusyId === archiveTarget.batch_id || (archiveReason === 'other' && !archiveNotes.trim())) ? 'not-allowed' : 'pointer',
                      opacity: (archiveReason === 'other' && !archiveNotes.trim()) ? 0.6 : 1,
                      display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.15s',
                    }}
                  >
                    {actionBusyId === archiveTarget.batch_id ? (
                      <>
                        <div style={{ width: 13, height: 13, border: '2px solid rgba(255,255,255,0.5)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        Archiving…
                      </>
                    ) : 'Confirm Archive'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Import Preview Modal ── */}
          {importPreview && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 3000, padding: 16,
            }} onClick={() => !importing && setImportPreview(null)}>
              <div style={{
                background: card, borderRadius: T.radius,
                width: '100%', maxWidth: 960, maxHeight: '88vh',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                boxShadow: shadow, border: `1px solid ${bdr}`,
              }} onClick={e => e.stopPropagation()}>

                {/* Import modal header */}
                <div style={{
                  background: T.greenDark, padding: '18px 22px',
                  display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0,
                  borderBottom: `2px solid ${T.mint}`,
                }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: '50%',
                    background: 'rgba(74,222,128,0.18)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: T.mint, fontWeight: 900, fontSize: 16, flexShrink: 0,
                  }}>
                    <IconImport />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#fff', fontWeight: 900, fontSize: 16 }}>Confirm Import</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                      <span style={{ background: 'rgba(74,222,128,0.2)', borderRadius: 99, padding: '2px 10px', fontSize: 11, color: T.mint, fontWeight: 700 }}>
                        {isSupplyTab ? 'Medicine Supplies' : 'Medicine Drugs'}
                      </span>
                      <span style={{ background: 'rgba(74,222,128,0.15)', borderRadius: 99, padding: '2px 10px', fontSize: 11, color: T.mint, fontWeight: 700 }}>
                        {importPreview.length} item{importPreview.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => setImportPreview(null)} style={{
                    background: 'rgba(74,222,128,0.15)', border: 'none', color: T.mint,
                    borderRadius: T.radiusSm, width: 32, height: 32, cursor: 'pointer',
                    fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(74,222,128,0.3)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(74,222,128,0.15)')}
                  >×</button>
                </div>

                {/* Info strip */}
                <div style={{
                  padding: '8px 22px', background: `${T.green}10`,
                  borderBottom: `1px solid ${bdr}`,
                  fontSize: 11, color: T.greenMid, fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  Review data below before confirming. You can edit values directly in the table.
                </div>

                {/* Import table */}
                <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', background: bg }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 900 }}>
                    <thead>
                      <tr style={{ background: card, borderBottom: `2px solid ${bdr}` }}>
                        {['#', 'Generic Name', 'Brand Name', dosageLabel, 'Type', 'Manufacturer', 'Source', 'Batch No.', 'Unit', 'EXP Date', 'Boxes', 'Pcs/Box', 'Loose Pcs'].map((h, i) => (
                          <th key={h} style={{
                            padding: '12px 10px', textAlign: i >= 10 ? 'right' : 'left',
                            fontSize: 10, fontWeight: 800, color: T.green,
                            textTransform: 'uppercase', letterSpacing: 0.8, whiteSpace: 'nowrap',
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.map((row, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? card : card2, borderBottom: `1px solid ${bdr}` }}>
                          <td style={{ padding: '8px 10px', color: txt2, fontSize: 11 }}>{i + 1}</td>
                          {(['generic_name','brand_name','dosage_strength','dosage_form','manufacturer'] as (keyof ImportRow)[]).map(key => (
                            <td key={key} style={{ padding: '6px 8px' }}>
                              <input value={String(row[key])}
                                onChange={e => {
                                  const updated = [...importPreview];
                                  (updated[i] as any)[key] = e.target.value
                                  setImportPreview(updated)
                                }}
                                style={{
                                  border: `1.5px solid ${bdr}`, borderRadius: T.radiusSm,
                                  padding: '5px 8px', fontSize: 12, width: '100%',
                                  background: card, color: txt, outline: 'none',
                                  minWidth: key === 'generic_name' ? 140 : key === 'dosage_form' ? 110 : 80,
                                  transition: 'border 0.15s',
                                }}
                                onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                                onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
                              />
                            </td>
                          ))}
                          {/* Source dropdown — values must match the DB CHECK constraint on
                              medicine_batches.source EXACTLY: 'DOH' | 'PhilHealth' | 'LGU'.
                              (Previously used 'PHILHEALTH', which violated the constraint.) */}
                          <td style={{ padding: '6px 8px' }}>
                            <select
                              value={String((row as any).source || '')}
                              onChange={e => {
                                const updated = [...importPreview];
                                (updated[i] as any).source = e.target.value
                                setImportPreview(updated)
                              }}
                              style={{
                                border: `1.5px solid ${bdr}`, borderRadius: T.radiusSm,
                                padding: '5px 8px', fontSize: 12, width: '100%',
                                background: card, color: txt, outline: 'none', minWidth: 100,
                              }}
                            >
                              <option value="">—</option>
                              <option value="DOH">DOH</option>
                              <option value="PhilHealth">PhilHealth</option>
                              <option value="LGU">LGU</option>
                            </select>
                          </td>
                          {(['batch_number','unit','expiration_date'] as (keyof ImportRow)[]).map(key => (
                            <td key={key} style={{ padding: '6px 8px' }}>
                              <input value={String(row[key])}
                                onChange={e => {
                                  const updated = [...importPreview];
                                  (updated[i] as any)[key] = e.target.value
                                  setImportPreview(updated)
                                }}
                                style={{
                                  border: `1.5px solid ${bdr}`, borderRadius: T.radiusSm,
                                  padding: '5px 8px', fontSize: 12, width: '100%',
                                  background: card, color: txt, outline: 'none',
                                  minWidth: 80,
                                  transition: 'border 0.15s',
                                }}
                                onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                                onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
                              />
                            </td>
                          ))}
                          {(['boxes','pieces_per_box','loose_pieces'] as (keyof ImportRow)[]).map(key => (
                            <td key={key} style={{ padding: '6px 8px', textAlign: 'right' }}>
                              <input type="number" min={key === 'pieces_per_box' ? 1 : 0} value={row[key] as number}
                                onChange={e => {
                                  const updated = [...importPreview]
                                  const val = Math.max(key === 'pieces_per_box' ? 1 : 0, parseInt(e.target.value, 10) || 0);
                                  (updated[i] as any)[key] = val
                                  setImportPreview(updated)
                                }}
                                onKeyDown={e => { if (e.key === '-' || e.key === 'e' || e.key === '+') e.preventDefault() }}
                                style={{
                                  border: `1.5px solid ${bdr}`,
                                  borderRadius: T.radiusSm, padding: '5px 8px', fontSize: 12, width: 70,
                                  background: card, color: txt,
                                  outline: 'none', textAlign: 'right',
                                  transition: 'border 0.15s',
                                }}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Import modal footer */}
                <div style={{
                  padding: '14px 22px', borderTop: `1px solid ${bdr}`,
                  background: card2, display: 'flex', gap: 10, flexShrink: 0, justifyContent: 'flex-end',
                }}>
                  <button onClick={() => setImportPreview(null)} disabled={importing} style={{
                    padding: '10px 24px', borderRadius: T.radius,
                    border: `1.5px solid ${T.redBorder}`,
                    background: 'transparent', color: T.red,
                    fontSize: 13, fontWeight: 800, cursor: 'pointer',
                    opacity: importing ? 0.6 : 1, transition: 'all 0.15s',
                  }}
                    onMouseEnter={e => (e.currentTarget.style.background = T.redLight)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >Cancel</button>
                  <button onClick={handleImportConfirm} disabled={importing} style={{
                    padding: '10px 28px', borderRadius: T.radius,
                    background: importing ? T.green : T.greenMid,
                    color: '#fff', border: 'none',
                    fontSize: 13, fontWeight: 800,
                    cursor: importing ? 'not-allowed' : 'pointer',
                    boxShadow: `0 6px 20px ${T.green}44`,
                    display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s',
                  }}
                    onMouseEnter={e => { if (!importing) e.currentTarget.style.transform = 'translateY(-2px)' }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
                  >
                    {importing ? (
                      <>
                        <div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.5)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        Importing {importPreview.length} items…
                      </>
                    ) : (
                      <>Confirm Import ({importPreview.length} items)</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Toast ── */}
          {toast && (
            <div style={{
              position: 'fixed', bottom: 28, right: 28, zIndex: 9999,
              background: T.greenDark, color: '#fff',
              padding: '12px 22px', borderRadius: T.radius,
              boxShadow: `0 8px 28px ${T.green}55`,
              fontSize: 13, fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: 8,
              border: `1px solid ${T.mint}44`,
              animation: 'fadeIn 0.2s ease',
            }}>
              <span style={{ color: T.mint, fontSize: 16 }}>✓</span> {toast}
            </div>
          )}

        </main>
      </div>
    </div>
  )
}