'use client'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useTheme } from 'next-themes'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from '@/lib/supabase'
import { Plus, Download, X, RotateCcw } from 'lucide-react'

// ─── All original types & data — untouched ────────────────────────────────────
interface Medicine {
  id: string
  med_name: string
  med_dosage: string
  med_type: string
  exp_date: string
  quantity: number
  boxes: number
  partial_pcs: number
  description: string | null
  unit: string
  category: 'drug' | 'supply'
  selected: boolean
  archived: boolean
}

type Tab = 'drug' | 'supply' | 'archived'

type ImportRow = {
  med_name: string
  med_dosage: string
  med_type: string
  unit: string
  exp_date: string
  boxes: number
  partial_pcs: number
  quantity: number
  category: 'drug' | 'supply'
}

const DRUG_TYPES   = ['Tablet','Capsule','Syrup','Vaccine','Injection','Ointment','Suspension','Drops']
const SUPPLY_TYPES = ['Lab Supply','Medical Form','Medical Tape','Insecticide','PPE','Syringe','Other']

// ─── Design tokens (Pharmacy palette) ────────────────────────────────────────
const T = {
  green:      '#16a34a',
  greenDark:  '#0d3b1f',
  greenMid:   '#166534',
  greenLight: '#dcfce7',
  mint:       '#4ade80',
  bg:         '#f0f7f2',
  surface:    '#ffffff',
  surface2:   '#f6faf7',
  border:     'rgba(22,163,74,0.15)',
  text:       '#0a2912',
  text2:      '#4b6557',
  text3:      '#9ca3af',
  shadow:     '0 2px 16px rgba(13,59,31,0.08)',
  radius:     14,
  radiusSm:   8,
  bgDk:       '#061a0d',
  surfDk:     '#0d2516',
  surf2Dk:    '#0f2e1a',
  borderDk:   'rgba(74,222,128,0.1)',
  textDk:     '#e2f5e9',
  text2Dk:    '#9abea6',
  shadowDk:   '0 2px 16px rgba(0,0,0,0.4)',
  red:        '#dc2626',
  redLight:   'rgba(220,38,38,0.10)',
  redBorder:  'rgba(220,38,38,0.20)',
  amber:      '#d97706',
  amberLight: 'rgba(217,119,6,0.10)',
  amberBorder:'rgba(217,119,6,0.25)',
} as const

// ─── SVG Icons (same as Pharmacy) ────────────────────────────────────────────
const IconDrug = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.5 20H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H20a2 2 0 0 1 2 2v3"/>
    <circle cx="18" cy="18" r="4"/><path d="M18 14v8M14 18h8"/>
  </svg>
)
const IconSupply = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2c0 1.1.9 2 2 2h5v5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2h-2z"/>
  </svg>
)
const IconArchive = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/>
    <line x1="10" y1="12" x2="14" y2="12"/>
  </svg>
)
const IconImport = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
)
const IconSearch = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)
const IconExcelFile = () => (
  <svg width="28" height="32" viewBox="0 0 34 40" fill="none">
    <path d="M4 0h18l12 12v24a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z" fill="#dcfce7"/>
    <path d="M22 0l12 12H26a4 4 0 0 1-4-4V0z" fill="#86efac"/>
    <text x="17" y="30" textAnchor="middle" fontSize="9" fontWeight="800" fill="#16a34a" fontFamily="inherit">XLS</text>
  </svg>
)
const IconPdfFile = () => (
  <svg width="28" height="32" viewBox="0 0 34 40" fill="none">
    <path d="M4 0h18l12 12v24a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z" fill="#fee2e2"/>
    <path d="M22 0l12 12H26a4 4 0 0 1-4-4V0z" fill="#fca5a5"/>
    <text x="17" y="30" textAnchor="middle" fontSize="10" fontWeight="800" fill="#dc2626" fontFamily="inherit">PDF</text>
  </svg>
)
const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)

// ─── Small shared components (Pharmacy style) ─────────────────────────────────
function FilterBtn({ label, active, onClick, icon }: {
  label: string; active: boolean; onClick: () => void; icon?: React.ReactNode
}) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
        cursor: 'pointer',
        border: active ? 'none' : `1.5px solid ${T.border}`,
        background: active ? T.green : hov ? `${T.green}10` : 'transparent',
        color: active ? '#fff' : T.green,
        transition: 'all 0.15s',
        boxShadow: active ? `0 4px 12px ${T.green}44` : 'none',
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

  // ── All original state — untouched ──────────────────────────────────────────
  const [medicines,    setMedicines]    = useState<Medicine[]>([])
  const [loading,      setLoading]      = useState(true)
  const [activeTab,    setActiveTab]    = useState<Tab>('drug')
  const [showModal,    setShowModal]    = useState(false)
  const [showExport,   setShowExport]   = useState(false)
  const [selectAll,    setSelectAll]    = useState(false)
  const [sortAZ,       setSortAZ]       = useState(false)
  const [ascending,    setAscending]    = useState(false)
  const [descending,   setDescending]   = useState(false)
  const [searchQuery,  setSearchQuery]  = useState('')
  const [toast,        setToast]        = useState('')
  const exportRef = useRef<HTMLDivElement>(null)

  const blankForm = { name: '', dosage: '', type: '', expDate: '', boxes: '', partialPcs: '', pcsPerBox: '', unit: '', description: '' }
  const [form, setForm] = useState(blankForm)
  const [typeDropdownOpen, setTypeDropdownOpen] = useState<'add' | 'edit' | null>(null)
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

  // ── All original logic — untouched ──────────────────────────────────────────
  const fetchMedicines = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('warehouse_medicines').select('*').order('created_at', { ascending: false })
    const all = (data || []) as Medicine[]
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const expired = all.filter(m => !m.archived && m.exp_date && new Date(m.exp_date) < today)
    if (expired.length > 0) {
      await Promise.all(expired.map(m => supabase.from('warehouse_medicines').update({ archived: true }).eq('id', m.id)))
      const { data: fresh } = await supabase.from('warehouse_medicines').select('*').order('created_at', { ascending: false })
      setMedicines((fresh || []).map((m: any) => ({ ...m, selected: false })))
      showToastMsg(`${expired.length} expired item(s) auto-archived.`)
    } else {
      setMedicines(all.map(m => ({ ...m, selected: false })))
    }
    setLoading(false)
  }, [])

  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked)
    setMedicines(prev => prev.map(m => visibleIds.includes(m.id) ? { ...m, selected: checked } : m))
  }
  const handleSelectOne = (id: string, checked: boolean) =>
    setMedicines(prev => prev.map(m => m.id === id ? { ...m, selected: checked } : m))
  const handleAscending  = (checked: boolean) => { setAscending(checked);  if (checked) { setDescending(false); setSortAZ(false) } }
  const handleDescending = (checked: boolean) => { setDescending(checked); if (checked) { setAscending(false); setSortAZ(false) } }

 const [isSaving, setIsSaving] = useState(false)   // bagong state, ilagay malapit sa ibang useState

const handleAdd = async () => {
  if (!form.name || isSaving) return
  setIsSaving(true)

  const boxes = Number(form.boxes) || 0
  const pcsPerBox = Number(form.pcsPerBox) || 1     // fallback 1 kung walang ilagay (1 box = 1 pc)
  const partialPcs = Number(form.partialPcs) || 0

  const { error } = await supabase.from('warehouse_medicines').insert({
    med_name: form.name, med_dosage: form.dosage, med_type: form.type,
    exp_date: form.expDate,
    boxes,
    pcs_per_box: pcsPerBox,
    partial_pcs: partialPcs,
    quantity: boxes * pcsPerBox + partialPcs,   // FIX: total pieces, hindi boxes na lang
    description: form.description || null,
    unit: form.unit, category: activeTab === 'supply' ? 'supply' : 'drug', archived: false,
  })

  if (!error) {
    setForm(blankForm); setShowModal(false)
    showToastMsg(activeTab === 'supply' ? 'Supply added successfully!' : 'Medicine added successfully!')
    fetchMedicines()
  } else {
    showToastMsg('Error adding item!')
  }
  setIsSaving(false)
}

  const isExpired = (m: Medicine) => {
    if (!m.exp_date) return false
    const exp = new Date(m.exp_date); const today = new Date(); today.setHours(0,0,0,0)
    return exp.getTime() < today.getTime()
  }
  const isArchivedEffective = (m: Medicine) => m.archived || isExpired(m)

  const tabFiltered = useMemo(() => {
    if (activeTab === 'archived') return medicines.filter(m => isArchivedEffective(m))
    return medicines.filter(m => !isArchivedEffective(m) && m.category === activeTab)
  }, [medicines, activeTab])

  const searchFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return tabFiltered
    return tabFiltered.filter(m =>
      m.med_name.toLowerCase().includes(q) ||
      (m.med_type || '').toLowerCase().includes(q) ||
      (m.med_dosage || '').toLowerCase().includes(q)
    )
  }, [tabFiltered, searchQuery])

  const sortedMedicines = useMemo(() => {
    return [...searchFiltered].sort((a, b) => {
      if (sortAZ)       return a.med_name.localeCompare(b.med_name)
      if (ascending)    return new Date(a.exp_date).getTime() - new Date(b.exp_date).getTime()
      if (descending)   return new Date(b.exp_date).getTime() - new Date(a.exp_date).getTime()
      return 0
    })
  }, [searchFiltered, sortAZ, ascending, descending])

  const visibleIds = sortedMedicines.map(m => m.id)

  const drugCount     = medicines.filter(m => !isArchivedEffective(m) && m.category === 'drug').length
  const supplyCount   = medicines.filter(m => !isArchivedEffective(m) && m.category === 'supply').length
  const archivedCount = medicines.filter(m => isArchivedEffective(m)).length

  const getExportData = () => {
    const data = selectedCount > 0 ? sortedMedicines.filter(m => m.selected) : sortedMedicines
    return data.map((m, i) => ({
      'No.': i + 1, 'Medicine Name': m.med_name,
      [activeTab === 'supply' ? 'Specification' : 'Dosage']: m.med_dosage,
      'Type': m.med_type, 'EXP Date': m.exp_date,
      'Stock Quantity': m.quantity, 'Unit': m.unit,
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
        const name = String(row['Medicine Name'] ?? row['med_name'] ?? '').trim()
        if (!name) return null
        const boxes = parseInt(String(row['Boxes'] ?? row['boxes'] ?? '0'), 10)
        const partialPcs = parseInt(String(row['Partial Pcs'] ?? row['partial_pcs'] ?? '0'), 10)
        const pcsPerBox = parseInt(String(row['Pieces per Box'] ?? row['pcs_per_box'] ?? '1'), 10) || 1
const quantity = totalQty > 0 ? totalQty : (isNaN(boxes) ? 0 : boxes * pcsPerBox) + (isNaN(partialPcs) ? 0 : partialPcs)
        const rawCategory = String(row['Category'] ?? row['category'] ?? '').trim().toLowerCase()
        const category: 'drug' | 'supply' = rawCategory.startsWith('supply') || rawCategory.includes('supply') ? 'supply' : 'drug'
        return {
          med_name: name,
          med_dosage: String(row['Dosage'] ?? row['Specification'] ?? row['med_dosage'] ?? '').trim(),
          med_type: String(row['Type'] ?? row['med_type'] ?? '').trim(),
          unit: String(row['Unit'] ?? row['unit'] ?? '').trim(),
          exp_date: String(row['EXP Date'] ?? row['exp_date'] ?? new Date().toISOString().split('T')[0]),
          boxes: isNaN(boxes) ? 0 : boxes,
          partial_pcs: isNaN(partialPcs) ? 0 : partialPcs,
          quantity: isNaN(quantity) ? 0 : quantity,
          category,
        } as ImportRow
      }).filter(Boolean) as ImportRow[]
      if (parsed.length === 0) { showToastMsg('No valid rows found in file.'); return }
      setImportPreview(parsed)
    } catch { showToastMsg('Failed to read file.') }
  }

  const handleImportConfirm = async () => {
    if (!importPreview) return
    setImporting(true)
    let count = 0
    const importCategory: 'drug' | 'supply' = activeTab === 'supply' ? 'supply' : 'drug'
    for (const row of importPreview) {
      const { error } = await supabase.from('warehouse_medicines').insert({ ...row, category: importCategory, description: null, archived: false })
      if (!error) count++
    }
    setImporting(false); showToastMsg(`Imported ${count} item(s) successfully.`)
    setImportPreview(null); fetchMedicines()
  }

  // ── Stock renderer ───────────────────────────────────────────────────────────
  // m.quantity = total pieces (the authoritative stock number)
  // m.boxes / m.partial_pcs = display-only breakdown (how those pieces are stored)
  const renderStock = (m: Medicine) => {
    const totalPcs = m.quantity                         // source of truth
    const color    = totalPcs === 0 ? T.red : totalPcs <= 10 ? T.amber : T.green

    if (m.boxes > 0) {
      return (
        <div style={{ textAlign: 'right' }}>
          {/* Primary: total pieces — this is what pharmacy will dispense from */}
          <div style={{ fontWeight: 900, fontSize: 15, color }}>{totalPcs} pcs</div>
          {/* Secondary: box breakdown for warehouse reference */}
          <div style={{ fontSize: 10, color: T.text3, lineHeight: 1.5 }}>
            {m.boxes} box{m.boxes !== 1 ? 'es' : ''}
            {m.partial_pcs > 0 ? ` + ${m.partial_pcs} loose` : ''}
          </div>
        </div>
      )
    }
    return (
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontWeight: 900, fontSize: 15, color }}>{totalPcs}</div>
        <div style={{ fontSize: 10, color: T.text3 }}>{m.unit || 'pcs'}</div>
      </div>
    )
  }

  const isSupplyTab  = activeTab === 'supply'
  const typeOptions  = isSupplyTab ? SUPPLY_TYPES : DRUG_TYPES
  const dosageLabel  = isSupplyTab ? 'Specification' : 'Dosage'

  const thStyle: React.CSSProperties = {
    padding: '12px 12px', textAlign: 'left', fontWeight: 800,
    color: T.green, fontSize: 10, textTransform: 'uppercase',
    letterSpacing: 0.8, whiteSpace: 'nowrap',
    fontFamily: 'Nunito, sans-serif',
  }

  // ─── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100vh', background: bg, fontFamily: 'Nunito, sans-serif' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { font-family: Nunito, sans-serif !important; }
      `}</style>

      <Sidebar />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar />

        <main style={{ flex: 1, padding: 24, overflowY: 'auto', background: bg }}>

          {/* ── Page header ── */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 }}>
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
                      padding: '11px 18px', borderRadius: T.radius, fontSize: 13, fontWeight: 800,
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
                      boxShadow: shadow, overflow: 'hidden',
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
                  borderRadius: T.radius, padding: '11px 22px',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                  fontWeight: 800, fontSize: 13, transition: 'all 0.2s', whiteSpace: 'nowrap',
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = T.greenLight)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <IconImport /> Import
                  <input type="file" accept=".xlsx,.xls" onChange={handleImportExcel} style={{ display: 'none' }} />
                </label>

                {/* Add */}
                <button
                  onClick={() => { setForm(blankForm); setShowModal(true) }}
                  style={{
                    background: T.greenMid, color: '#fff', border: 'none',
                    borderRadius: T.radius, padding: '12px 28px',
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
            {/* Search row */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: txt2, display: 'flex' }}>
                  <IconSearch />
                </span>
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search medicine, type, or dosage..."
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '8px 36px 8px 32px',
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

            {/* Tab pills */}
            <div style={{
              display: 'flex', gap: 3, background: bg,
              borderRadius: 24, padding: 3, border: `1px solid ${bdr}`,
              marginBottom: 10, width: 'fit-content',
            }}>
              {([
                { tab: 'drug'     as Tab, icon: <IconDrug />,    label: 'Drugs',    count: drugCount     },
                { tab: 'supply'   as Tab, icon: <IconSupply />,  label: 'Supplies', count: supplyCount   },
                { tab: 'archived' as Tab, icon: <IconArchive />, label: 'Archived', count: archivedCount },
              ]).map(({ tab, icon, label, count }) => {
                const active = activeTab === tab
                const archiveColor = active && tab === 'archived' ? '#6b7280' : undefined
                return (
                  <button key={tab} onClick={() => { setActiveTab(tab); setSelectAll(false) }} style={{
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

            {/* Bulk sort/select controls */}
            {activeTab !== 'archived' && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
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
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: bg, borderBottom: `2px solid ${bdr}` }}>
                    {activeTab !== 'archived' && <th style={{ ...thStyle, width: 50 }}></th>}
                    <th style={thStyle}>No.</th>
                    <th style={thStyle}>Medicine Name</th>
                    <th style={thStyle}>{dosageLabel}</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Unit</th>
                    <th style={thStyle}>EXP Date</th>
                    <th style={{ ...thStyle, textAlign: 'right', borderLeft: `2px dashed ${T.green}22`, minWidth: 90 }}>
                      <div style={{ fontSize: 8, color: T.text3, fontWeight: 700, letterSpacing: 0.4, marginBottom: 2 }}>WAREHOUSE</div>
                      Boxes
                    </th>
                    <th style={{ ...thStyle, textAlign: 'right', minWidth: 100 }}>
                      <div style={{ fontSize: 8, color: '#3b82f6', fontWeight: 700, letterSpacing: 0.4, marginBottom: 2 }}>DISPENSE</div>
                      Pieces (Qty)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={activeTab !== 'archived' ? 9 : 8} style={{ textAlign: 'center', padding: 48, color: txt2, fontSize: 13 }}>
                      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 32, height: 32, border: `3px solid ${T.green}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        Loading medicines...
                      </div>
                    </td></tr>
                  ) : sortedMedicines.length === 0 ? (
                    <tr><td colSpan={activeTab !== 'archived' ? 9 : 8} style={{ textAlign: 'center', padding: 48, color: txt2, fontSize: 13 }}>
                      {searchQuery ? `No medicines found matching "${searchQuery}"` : 'No items yet.'}
                    </td></tr>
                  ) : sortedMedicines.map((med, i) => {
                    const expired = isExpired(med)
                    const sel     = med.selected
                    const rowBg   = sel ? `${T.green}08` : i % 2 === 0 ? card : card2
                    const total   = med.boxes > 0 ? med.boxes + med.partial_pcs : med.quantity
                    const statusType = total === 0 ? 'outofstock' : expired ? 'expired' : total <= 10 ? 'lowstock' : 'instock'

                    return (
                      <tr key={med.id}
                        style={{ background: rowBg, borderBottom: `1px solid ${bdr}`, transition: 'background 0.1s' }}
                        onMouseEnter={e => { if (!sel) (e.currentTarget as HTMLTableRowElement).style.background = T.greenLight }}
                        onMouseLeave={e => { if (!sel) (e.currentTarget as HTMLTableRowElement).style.background = rowBg }}
                      >
                        {activeTab !== 'archived' && (
                          <td style={{ padding: '11px 12px' }}>
                            <input
                              type="checkbox" checked={sel}
                              onChange={e => handleSelectOne(med.id, e.target.checked)}
                              style={{ accentColor: T.green, width: 12, height: 12 }}
                            />
                          </td>
                        )}
                        <td style={{ padding: '11px 12px', color: txt2, fontWeight: 700 }}>{i + 1}</td>
                        <td style={{ padding: '11px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                            <span style={{ color: txt2, flexShrink: 0 }}>
                              {med.category === 'supply' ? <IconSupply /> : <IconDrug />}
                            </span>
                            <span style={{ fontWeight: 700, color: txt, fontSize: 12 }}>{med.med_name}</span>
                          </div>
                        </td>
                        <td style={{ padding: '11px 12px', color: txt2, fontSize: 11 }}>{med.med_dosage || '—'}</td>
                        <td style={{ padding: '11px 12px', color: txt2, fontSize: 11 }}>{med.med_type || '—'}</td>
                        <td style={{ padding: '11px 12px', color: txt2, fontSize: 11 }}>{med.unit || '—'}</td>
                        <td style={{ padding: '11px 12px', fontSize: 11, color: expired ? T.red : txt2 }}>
                          {med.exp_date || '—'}
                          {expired && (
                            <span style={{
                              fontSize: 9, marginLeft: 5,
                              background: T.redLight, color: T.red,
                              border: `1px solid ${T.redBorder}`,
                              borderRadius: 4, padding: '1px 5px', fontWeight: 800,
                            }}>EXPIRED</span>
                          )}
                        </td>
                        <td style={{ padding: '11px 12px', textAlign: 'right', borderLeft: `2px dashed ${T.green}22` }}>
  <div style={{ fontWeight: 900, fontSize: 14, color: txt }}>{med.boxes > 0 ? med.boxes : '—'}</div>
  <div style={{ fontSize: 10, color: T.text3 }}>{med.boxes > 0 ? 'boxes' : ''}</div>
</td>

{/* Pieces — total dispensable qty (source of truth) */}
<td style={{ padding: '11px 12px', textAlign: 'right' }}>
  <div style={{ fontWeight: 900, fontSize: 15, color: med.quantity === 0 ? T.red : med.quantity <= 10 ? T.amber : T.green }}>
    {med.quantity} pcs
  </div>
  {med.boxes > 0 && (
    <div style={{ fontSize: 10, color: T.text3 }}>
      {med.boxes} box{med.boxes !== 1 ? 'es' : ''}{med.partial_pcs > 0 ? ` + ${med.partial_pcs} loose` : ''}
    </div>
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

          {/* ── Add Medicine Modal ── */}
          {showModal && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 3000, padding: 16,
            }} onClick={() => setShowModal(false)}>
              <div style={{
                background: card, borderRadius: T.radius,
                width: '100%', maxWidth: 540, maxHeight: '92vh',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                boxShadow: shadow, border: `1px solid ${bdr}`,
              }} onClick={e => e.stopPropagation()}>

                {/* Modal header */}
                <div style={{
                  background: T.greenDark, padding: '18px 22px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
                  borderBottom: `2px solid ${T.mint}`,
                }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Warehouse</div>
                    <h2 style={{ color: '#fff', margin: 0, fontSize: 17, fontWeight: 800 }}>
                      Add {isSupplyTab ? 'Supply' : 'Medicine'}
                    </h2>
                  </div>
                  <button onClick={() => setShowModal(false)} style={{
                    background: 'rgba(74,222,128,0.15)', border: 'none', color: T.mint,
                    borderRadius: T.radiusSm, width: 32, height: 32, cursor: 'pointer',
                    fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(74,222,128,0.3)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(74,222,128,0.15)')}
                  >×</button>
                </div>

                {/* Modal body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px', background: bg, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {[
                    { label: isSupplyTab ? 'Supply Name' : 'Medicine Name', key: 'name', placeholder: isSupplyTab ? 'e.g. Surgical Gloves' : 'e.g. Paracetamol' },
                    { label: isSupplyTab ? 'Specification' : 'Mg / Dosage',  key: 'dosage', placeholder: isSupplyTab ? 'e.g. Large, 1 inch x 10 yards' : 'e.g. 500mg' },
                    { label: 'Unit', key: 'unit', placeholder: 'e.g. Piece, Box, Bottle' },
                  ].map(({ label, key, placeholder }) => (
                    <div key={key}>
                      <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>{label}</label>
                      <input
                        type="text" placeholder={placeholder}
                        value={(form as any)[key]}
                        onChange={e => setForm({ ...form, [key]: e.target.value })}
                        style={{
                          width: '100%', boxSizing: 'border-box',
                          padding: '9px 12px', borderRadius: T.radiusSm,
                          border: `1.5px solid ${bdr}`, fontSize: 13,
                          background: card, color: txt, outline: 'none', transition: 'border 0.15s',
                        }}
                        onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                        onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
                      />
                    </div>
                  ))}

                  {/* EXP Date */}
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>EXP Date</label>
                    <input type="date" value={form.expDate}
                      onChange={e => setForm({ ...form, expDate: e.target.value })}
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        padding: '9px 12px', borderRadius: T.radiusSm,
                        border: `1.5px solid ${bdr}`, fontSize: 13,
                        background: card, color: txt, outline: 'none', transition: 'border 0.15s',
                      }}
                      onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                      onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
                    />
                  </div>

                  {/* Type combobox — original logic */}
                  <div style={{ position: 'relative' }}>
                    <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Type</label>
                    <input
                      type="text" placeholder="Search or type a new type..."
                      value={form.type}
                      onFocus={() => setTypeDropdownOpen('add')}
                      onChange={e => { setForm({ ...form, type: e.target.value }); setTypeDropdownOpen('add') }}
                      onBlur={() => setTimeout(() => setTypeDropdownOpen(null), 120)}
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        padding: '9px 12px', borderRadius: T.radiusSm,
                        border: `1.5px solid ${bdr}`, fontSize: 13,
                        background: card, color: txt, outline: 'none', transition: 'border 0.15s',
                      }}
                      onFocus={e => { e.currentTarget.style.borderColor = T.green; setTypeDropdownOpen('add') }}
                    />
                    {typeDropdownOpen === 'add' && (
                      <div style={{
                        position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
                        background: card, border: `1.5px solid ${T.green}`,
                        borderRadius: T.radiusSm, boxShadow: shadow, overflow: 'hidden',
                      }}>
                        {typeOptions.filter(t => t.toLowerCase().includes(form.type.toLowerCase())).map(t => (
                          <button key={t} type="button"
                            onMouseDown={() => { setForm({ ...form, type: t }); setTypeDropdownOpen(null) }}
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
                        {form.type && !typeOptions.some(t => t.toLowerCase() === form.type.toLowerCase()) && (
                          <button type="button" onMouseDown={() => setTypeDropdownOpen(null)}
                            style={{ width: '100%', padding: '9px 14px', textAlign: 'left', border: 'none', background: T.greenLight, cursor: 'pointer', fontSize: 13, color: T.greenDark, fontWeight: 700 }}>
                            Use "{form.type}"
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Boxes + Partial side by side */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
  {[
    { label: 'Boxes', key: 'boxes', placeholder: 'e.g. 12' },
    { label: 'Pcs / Box', key: 'pcsPerBox', placeholder: 'e.g. 100' },
    { label: 'Partial / Loose Pcs', key: 'partialPcs', placeholder: 'e.g. 5' },
  ].map(({ label, key, placeholder }) => (
    <div key={key}>
      <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>{label}</label>
      <input type="number" placeholder={placeholder}
        value={(form as any)[key]}
        onChange={e => setForm({ ...form, [key]: e.target.value })}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '9px 12px', borderRadius: T.radiusSm,
          border: `1.5px solid ${bdr}`, fontSize: 13,
          background: card, color: txt, outline: 'none', transition: 'border 0.15s',
        }}
        onFocus={e => (e.currentTarget.style.borderColor = T.green)}
        onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
      />
    </div>
  ))}
</div>

                  {/* Description */}
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 800, color: txt2, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>
                      Description <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.6 }}>(optional)</span>
                    </label>
                    <textarea
                      placeholder="Free-text notes about this item..." rows={3}
                      value={form.description}
                      onChange={e => setForm({ ...form, description: e.target.value })}
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
                  <button onClick={() => setShowModal(false)} style={{
                    padding: '10px 24px', borderRadius: T.radius,
                    border: `1.5px solid ${T.redBorder}`,
                    background: 'transparent', color: T.red,
                    fontSize: 13, fontWeight: 800, cursor: 'pointer', transition: 'all 0.15s',
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
                width: '100%', maxWidth: 900, maxHeight: '88vh',
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
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 760 }}>
                    <thead>
                      <tr style={{ background: card, borderBottom: `2px solid ${bdr}` }}>
                        {['#', 'Medicine Name', dosageLabel, 'Type', 'Unit', 'EXP Date', 'Boxes', 'Partial Pcs', 'Total Qty'].map((h, i) => (
                          <th key={h} style={{
                            padding: '12px 10px', textAlign: i >= 6 ? 'right' : 'left',
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
                          {(['med_name','med_dosage','med_type','unit','exp_date'] as (keyof ImportRow)[]).map(key => (
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
                                  minWidth: key === 'med_name' ? 160 : key === 'med_type' ? 120 : 80,
                                  transition: 'border 0.15s',
                                }}
                                onFocus={e => (e.currentTarget.style.borderColor = T.green)}
                                onBlur={e  => (e.currentTarget.style.borderColor = bdr)}
                              />
                            </td>
                          ))}
                          {(['boxes','partial_pcs','quantity'] as (keyof ImportRow)[]).map(key => (
                            <td key={key} style={{ padding: '6px 8px', textAlign: 'right' }}>
                              <input type="number" value={row[key] as number}
                                onChange={e => {
                                  const updated = [...importPreview]
                                  const val = parseInt(e.target.value, 10);
                                  (updated[i] as any)[key] = isNaN(val) ? 0 : val
                                  if (key === 'boxes' || key === 'partial_pcs') {
                                    const b = key === 'boxes' ? (isNaN(val) ? 0 : val) : updated[i].boxes
                                    const p = key === 'partial_pcs' ? (isNaN(val) ? 0 : val) : updated[i].partial_pcs
                                    updated[i].quantity = b + p
                                  }
                                  setImportPreview(updated)
                                }}
                                style={{
                                  border: `1.5px solid ${key === 'quantity' ? T.green : bdr}`,
                                  borderRadius: T.radiusSm, padding: '5px 8px', fontSize: 12, width: 70,
                                  background: key === 'quantity' ? T.greenLight : card,
                                  color: key === 'quantity' ? T.greenDark : txt,
                                  outline: 'none', textAlign: 'right',
                                  fontWeight: key === 'quantity' ? 700 : 400,
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
                      <><IconCheck /> Confirm Import ({importPreview.length} items)</>
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