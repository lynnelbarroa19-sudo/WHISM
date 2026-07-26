// ─── Shared tokens, constants & helpers for the Medicine Inventory feature ───
// Used by both `page.tsx` (the inventory table/list) and
// `AddMedicineModal.tsx` (the "Add Medicine / Supply" form), so the two stay
// visually and behaviorally in sync without duplicating this logic.

export interface Medicine {
  medicine_id: string
  barcode: string | null
  generic_name: string
  brand_name: string | null
  dosage_strength: string | null
  dosage_form: string | null
  category: 'drug' | 'supply'
  unit: string | null
  manufacturer: string | null
  source: 'DOH' | 'PhilHealth' | 'LGU' | null
  batch_number: string | null
  expiration_date: string | null
  boxes: number
  pieces_per_box: number
  loose_pieces: number
  total_quantity: number          // GENERATED ALWAYS column — never write this, only read
  reorder_level: number           // still exists in DB (default 0), no longer user-editable
  storage_location: string | null
  status: 'available' | 'low_stock' | 'out_of_stock' | 'expired' | 'archived'
  date_received: string | null
  remarks: string | null
  is_archived: boolean
  created_by: string | null
  created_at: string
  selected: boolean               // client-only, not a DB column
}

export type Tab = 'drug' | 'supply' | 'archived'

export type ImportRow = {
  generic_name: string
  brand_name: string
  dosage_strength: string
  dosage_form: string
  unit: string
  manufacturer: string
  batch_number: string
  expiration_date: string
  boxes: number
  pieces_per_box: number
  loose_pieces: number
  category: 'drug' | 'supply'
}

export const DRUG_TYPES   = ['Tablet','Capsule','Syrup','Vaccine','Injection','Ointment','Suspension','Drops']
export const SUPPLY_TYPES = ['Lab Supply','Medical Form','Medical Tape','Insecticide','PPE','Syringe','Other']

// The 3 fixed stock sources this system tracks. These map 1:1 to the
// `medicines_source_check` CHECK constraint values in Supabase — do NOT
// change the `value` fields below unless the DB constraint changes too.
export const SOURCE_OPTIONS: { value: 'DOH' | 'PhilHealth' | 'LGU'; label: string }[] = [
  { value: 'DOH',       label: 'Department of Health (DOH)' },
  { value: 'PhilHealth', label: 'Philippine Health Insurance Corporation (PhilHealth)' },
  { value: 'LGU',       label: 'Local Government Unit (LGU)' },
]

// ─── Design tokens (Pharmacy palette) ────────────────────────────────────────
export const T = {
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

// ─── Status computation (matches the `status` CHECK constraint) ─────────────
// Reorder level is no longer user-configurable, so "low_stock" is never
// derived here — only "available", "out_of_stock", and "expired".
export const computeStatus = (totalQty: number, expDate: string | null): Medicine['status'] => {
  if (expDate && new Date(expDate) < new Date(new Date().setHours(0, 0, 0, 0))) return 'expired'
  if (totalQty === 0) return 'out_of_stock'
  return 'available'
}

// ─── Helper: keep numeric-string form fields non-negative ────────────────────
// Strips any leading minus sign and non-digit characters as the user types,
// so it's impossible to enter a negative number in Boxes / Pcs per Box / Loose Pieces.
export const sanitizeNonNegativeInt = (raw: string): string => raw.replace(/[^0-9]/g, '')

export const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)

export const IconDrug = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.5 20H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H20a2 2 0 0 1 2 2v3"/>
    <circle cx="18" cy="18" r="4"/><path d="M18 14v8M14 18h8"/>
  </svg>
)

export const IconSupply = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2c0 1.1.9 2 2 2h5v5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2h-2z"/>
  </svg>
)

export const IconArchive = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/>
    <line x1="10" y1="12" x2="14" y2="12"/>
  </svg>
)

export const IconImport = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
)

export const IconSearch = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)

export const IconExcelFile = () => (
  <svg width="28" height="32" viewBox="0 0 34 40" fill="none">
    <path d="M4 0h18l12 12v24a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z" fill="#dcfce7"/>
    <path d="M22 0l12 12H26a4 4 0 0 1-4-4V0z" fill="#86efac"/>
    <text x="17" y="30" textAnchor="middle" fontSize="9" fontWeight="800" fill="#16a34a" fontFamily="inherit">XLS</text>
  </svg>
)

export const IconPdfFile = () => (
  <svg width="28" height="32" viewBox="0 0 34 40" fill="none">
    <path d="M4 0h18l12 12v24a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z" fill="#fee2e2"/>
    <path d="M22 0l12 12H26a4 4 0 0 1-4-4V0z" fill="#fca5a5"/>
    <text x="17" y="30" textAnchor="middle" fontSize="10" fontWeight="800" fill="#dc2626" fontFamily="inherit">PDF</text>
  </svg>
)