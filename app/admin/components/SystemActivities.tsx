'use client'
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import {
  RefreshCw, Clock, AlertCircle, Search, Download, Printer,
  FileSpreadsheet, Lock, X, Calendar,
} from 'lucide-react'

/*
  ══════════════════════════════════════════════════════════════════════════════
  SYSTEM ACTIVITIES  (Audit Trail)
  ──────────────────────────────────────────────────────────────────────────────
  • Centralized, read-only log of every tracked user action.
  • Filters: Date range · User Role · Activity Type · Specific User · Status.
  • Search: by User Name and by Patient Name.
  • Columns: Date & Time · User · Role · Activity · Patient · Reference · Status.
  • Export: PDF (print-to-pdf) · Excel (CSV) · Print.
  • Access: Admin only (pass `currentUserRole`). Logs cannot be edited/deleted.

  Logs are written by utils/auditLogs.ts → logAction(...). See that file for the
  required `audit_logs` table (incl. patient_name + reference_id columns).
  ══════════════════════════════════════════════════════════════════════════════
*/

const G       = '#16a34a'
const TEAL     = '#0d9488'
const PER_PAGE = 20

interface SystemLog {
  id: string
  user_name: string
  user_role: string
  action: string
  module: string
  description?: string
  patient_name?: string
  reference_id?: string
  timestamp: string
  status: string
  ip_address: string
}

// ── Friendly labels for raw action keys (covers every required activity) ──────
const ACTION_LABELS: Record<string, string> = {
  // Auth
  LOGIN: 'Logged in', LOGOUT: 'Logged out', FAILED_LOGIN: 'Failed login attempt',
  CHANGE_PASSWORD: 'Changed password', LOGIN_USER: 'Logged in', LOGOUT_USER: 'Logged out',
  // Doctor / Nurse
  CONSULTATION: 'Patient consultation created', CONDUCT_CONSULTATION: 'Patient consultation created',
  'Conduct consultation': 'Patient consultation created',
  CONSULTATION_UPDATED: 'Consultation updated', CONSULTATION_COMPLETED: 'Consultation completed',
  SEND_PRESCRIPTION: 'Prescription issued', 'Send prescription': 'Prescription issued',
  SEND_LAB_REQUEST: 'Laboratory request created', LAB_REQUEST: 'Laboratory request created',
  RECORD_VITALS: 'Vital signs recorded', VITAL_SIGNS: 'Vital signs recorded',
  SEND_VACCINE_REQUEST: 'Vaccine request sent', VACCINATE: 'Vaccine administered',
  // Registrar
  REGISTER_PATIENT: 'New patient registered', VIEW_PATIENT: 'Patient record searched',
  SEARCH_PATIENT: 'Patient record searched', EDIT_PATIENT: 'Patient information updated',
  UPDATE_PATIENT: 'Patient record updated',
  CREATE_APPOINTMENT: 'Appointment created', MODIFY_APPOINTMENT: 'Appointment modified',
  CANCEL_APPOINTMENT: 'Appointment cancelled',
  // Pharmacy
  DISPENSE_MEDICINE: 'Medication dispensed', DISPENSE: 'Medication dispensed',
  UPDATE_DISPENSE: 'Dispensing record updated', VIEW_DISPENSE: 'Dispensing history accessed',
  REQUEST_WAREHOUSE: 'Medicine request sent to warehouse', RESTOCK_REQUEST: 'Medicine request sent to warehouse',
  INVENTORY_ADJUSTMENT: 'Inventory adjustment', ADD_MEDICINE: 'Medicine added to inventory',
  UPDATE_STOCK: 'Medicine stock updated',
  // Warehouse
  STOCK_RECEIVED: 'Medicine stock received', STOCK_RELEASED: 'Medicine stock released',
  SEND_TO_PHARMACY: 'Medicine sent to pharmacy', WAREHOUSE_DISPENSE: 'Medicine sent to pharmacy',
  STOCK_TRANSFER: 'Stock transfer processed', STOCK_RECORD_UPDATE: 'Stock record updated',
  // Laboratory / MedTech
  PERFORM_LAB_TEST: 'Laboratory test performed', UPLOAD_LAB: 'Laboratory results submitted',
  SEND_LAB_RESULT: 'Laboratory results submitted', SEND_LAB: 'Laboratory results submitted',
  UPDATE_LAB_RESULT: 'Laboratory results updated', PROCESS_LAB_REQUEST: 'Laboratory request processed',
  COMPLETE_LAB_REQUEST: 'Laboratory request completed', VIEW_LAB: 'Laboratory record accessed',
  // Admin
  ADD_USER: 'Created user account', EDIT_USER: 'Updated user account', DELETE_USER: 'Deleted user account',
  SUSPEND_USER: 'Suspended user account', ACTIVATE_USER: 'Activated user account',
  BACKUP: 'Performed system backup', RESTORE: 'Restored system data', GENERATE_REPORT: 'Generated report',
}

const ROLES = ['All', 'Admin', 'Doctor', 'Nurse', 'Registrar', 'Pharmacist', 'Warehouse Staff', 'Medical Technologist', 'System']
const STATUSES = ['all', 'success', 'completed', 'pending', 'warning', 'failed']

function normalizeRole(role: string) {
  const r = (role || '—').trim().toLowerCase()
  if (r === 'doctor') return 'Doctor'
  if (r === 'nurse') return 'Nurse'
  if (r === 'registrar') return 'Registrar'
  if (r === 'pharmacist' || r === 'pharmacy') return 'Pharmacist'
  if (r === 'warehouse' || r === 'warehouse staff') return 'Warehouse Staff'
  if (r === 'medtech' || r === 'medical technologist' || r === 'laboratory') return 'Medical Technologist'
  if (r === 'admin' || r === 'administrator') return 'Admin'
  if (r === 'system') return 'System'
  return role || '—'
}

// status → display bucket (Success / Completed / Pending / Warning / Failed)
function statusMeta(status: string): { label: string; color: string; bg: string } {
  const s = (status || '').toLowerCase()
  if (s === 'completed')              return { label: 'Completed', color: '#0d9488', bg: '#ccfbf1' }
  if (s === 'pending')                return { label: 'Pending',   color: '#b45309', bg: '#fef3c7' }
  if (s === 'warning')                return { label: 'Warning',   color: '#b45309', bg: '#fef3c7' }
  if (s === 'failed' || s === 'error')return { label: 'Failed',    color: '#dc2626', bg: '#fee2e2' }
  return { label: 'Success', color: '#16a34a', bg: '#dcfce7' }
}
function statusMatches(filter: string, status: string) {
  if (filter === 'all') return true
  const s = (status || '').toLowerCase()
  if (filter === 'failed') return s === 'failed' || s === 'error'
  return s === filter
}

// Best-effort patient-name fallback from a free-text description.
function patientFromDescription(desc?: string): string {
  if (!desc) return ''
  const m = desc.match(/(?:patient|to|for)[:\s]+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})/)
  return m ? m[1].trim() : ''
}

function fmtDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: '2-digit' })
}
function fmtTime(iso: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function SystemActivities({ darkMode, currentUserRole }: { darkMode: boolean; currentUserRole?: string }) {
  const dk   = darkMode
  const bg   = dk ? '#0d1a0f' : '#f0f4f1'
  const card = dk ? '#0f2014' : '#ffffff'
  const bdr  = dk ? '#1a3d24' : '#e5e7eb'
  const txt  = dk ? '#e2f5e9' : '#1f2937'
  const txt2 = dk ? '#6ee7b7' : '#6b7280'

  // ── Admin-only gate ──────────────────────────────────────────────────────
  // If a role is supplied and it isn't Admin, block access entirely.
  const accessAllowed = currentUserRole == null || normalizeRole(currentUserRole) === 'Admin'

  const [logs,         setLogs]         = useState<SystemLog[]>([])
  const [loading,      setLoading]      = useState(true)
  const [noTable,      setNoTable]      = useState(false)
  const [roleFilter,   setRoleFilter]   = useState('All')
  const [userFilter,   setUserFilter]   = useState('All')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter,   setTypeFilter]   = useState('All')
  const [search,       setSearch]       = useState('')
  const [patientSearch,setPatientSearch]= useState('')
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')
  const [page,         setPage]         = useState(1)

  const fetchLogs = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('audit_logs').select('*')
      .order('created_at', { ascending: false }).limit(1000)

    if (error || !data) {
      setNoTable(true)
      setLogs([
        { id:'1', user_name:'Admin',          user_role:'Admin',                 action:'LOGIN',            module:'Auth',            description:'Admin logged in',                     patient_name:'',              reference_id:'',        timestamp:new Date(Date.now()-60000).toISOString(),    status:'success',   ip_address:'192.168.1.1' },
        { id:'2', user_name:'Maria Santos',   user_role:'Registrar',             action:'REGISTER_PATIENT', module:'Patient Records', description:'Registered patient: Juan Dela Cruz',  patient_name:'Juan Dela Cruz',reference_id:'PT-1042',  timestamp:new Date(Date.now()-300000).toISOString(),   status:'success',   ip_address:'192.168.1.3' },
        { id:'3', user_name:'Dr. Reyes',      user_role:'Doctor',                action:'SEND_PRESCRIPTION',module:'Prescription',    description:'Prescription issued to Ana Reyes',    patient_name:'Ana Reyes',     reference_id:'RX-5567',  timestamp:new Date(Date.now()-600000).toISOString(),   status:'completed', ip_address:'192.168.1.5' },
        { id:'4', user_name:'Unknown',        user_role:'—',                     action:'FAILED_LOGIN',     module:'Auth',            description:'Failed login: admin@rhu.gov.ph',      patient_name:'',              reference_id:'',        timestamp:new Date(Date.now()-900000).toISOString(),   status:'failed',    ip_address:'203.0.113.42' },
        { id:'5', user_name:'Med. Tech Cruz', user_role:'Medical Technologist',  action:'UPLOAD_LAB',       module:'Lab Records',     description:'Laboratory results submitted for #101',patient_name:'Liza Ramos',   reference_id:'LAB-0091', timestamp:new Date(Date.now()-1800000).toISOString(),  status:'success',   ip_address:'192.168.1.8' },
        { id:'6', user_name:'Pharmacist Go',  user_role:'Pharmacist',            action:'DISPENSE_MEDICINE',module:'Pharmacy',        description:'Dispensed Amoxicillin to Mica Marzan', patient_name:'Mica Marzan',  reference_id:'DSP-3320', timestamp:new Date(Date.now()-2400000).toISOString(),  status:'success',   ip_address:'192.168.1.6' },
        { id:'7', user_name:'Nurse Bautista', user_role:'Nurse',                 action:'RECORD_VITALS',    module:'Consultation',    description:'Vital signs recorded for Rosa Aquino', patient_name:'Rosa Aquino',  reference_id:'',         timestamp:new Date(Date.now()-3600000).toISOString(),  status:'pending',   ip_address:'192.168.1.9' },
        { id:'8', user_name:'Warehouse Dela', user_role:'Warehouse Staff',       action:'SEND_TO_PHARMACY', module:'Warehouse',       description:'Sent 200 pcs Paracetamol to pharmacy', patient_name:'',             reference_id:'WH-7781',  timestamp:new Date(Date.now()-7200000).toISOString(),  status:'completed', ip_address:'192.168.1.4' },
      ])
      setLoading(false)
      return
    }

    setLogs(data.map((l: any) => ({
      id:           l.id,
      user_name:    l.user_name    || 'System',
      user_role:    normalizeRole(l.user_role || '—'),
      action:       l.action       || '',
      module:       l.module       || '',
      description:  l.description   || '',
      patient_name: l.patient_name || '',
      reference_id: l.reference_id || '',
      timestamp:    l.created_at    || '',
      status:       l.status        || 'success',
      ip_address:   l.ip_address    || '—',
    })))
    setNoTable(false)
    setLoading(false)
  }

  useEffect(() => { if (accessAllowed) fetchLogs() }, [accessAllowed])

  // dropdown option sources derived from the data
  const userOptions = useMemo(
    () => ['All', ...Array.from(new Set(logs.map(l => l.user_name).filter(Boolean))).sort()],
    [logs]
  )
  const typeOptions = useMemo(
    () => ['All', ...Array.from(new Set(logs.map(l => ACTION_LABELS[l.action] || l.action).filter(Boolean))).sort()],
    [logs]
  )

  const activityLabel = (l: SystemLog) => ACTION_LABELS[l.action] || l.action
  const patientOf     = (l: SystemLog) => l.patient_name || patientFromDescription(l.description)

  const display = useMemo(() => logs.filter(l => {
    if (roleFilter !== 'All' && l.user_role !== roleFilter) return false
    if (userFilter !== 'All' && l.user_name !== userFilter) return false
    if (!statusMatches(statusFilter, l.status)) return false
    if (typeFilter !== 'All' && activityLabel(l) !== typeFilter) return false

    if (dateFrom || dateTo) {
      const t = l.timestamp ? new Date(l.timestamp).getTime() : 0
      if (dateFrom && t < new Date(dateFrom + 'T00:00:00').getTime()) return false
      if (dateTo   && t > new Date(dateTo   + 'T23:59:59').getTime()) return false
    }
    if (search) {
      const q = search.toLowerCase()
      const blob = `${l.user_name} ${activityLabel(l)} ${l.module} ${l.description || ''} ${l.reference_id || ''} ${l.ip_address}`.toLowerCase()
      if (!blob.includes(q)) return false
    }
    if (patientSearch) {
      if (!patientOf(l).toLowerCase().includes(patientSearch.toLowerCase())) return false
    }
    return true
  }), [logs, roleFilter, userFilter, statusFilter, typeFilter, dateFrom, dateTo, search, patientSearch])

  useEffect(() => { setPage(1) }, [roleFilter, userFilter, statusFilter, typeFilter, dateFrom, dateTo, search, patientSearch])

  const totalPages = Math.max(1, Math.ceil(display.length / PER_PAGE))
  const paginated  = display.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const clearFilters = () => {
    setRoleFilter('All'); setUserFilter('All'); setStatusFilter('all'); setTypeFilter('All')
    setSearch(''); setPatientSearch(''); setDateFrom(''); setDateTo('')
  }
  const hasActiveFilters =
    roleFilter !== 'All' || userFilter !== 'All' || statusFilter !== 'all' ||
    typeFilter !== 'All' || !!search || !!patientSearch || !!dateFrom || !!dateTo

  const roleMeta: Record<string, { color: string; bg: string }> = {
    Admin:                  { color:'#7c3aed', bg:'#ede9fe' },
    Doctor:                 { color:'#059669', bg:'#d1fae5' },
    Nurse:                  { color:'#db2777', bg:'#fce7f3' },
    Registrar:              { color:'#d97706', bg:'#fef3c7' },
    Pharmacist:             { color:'#2563eb', bg:'#dbeafe' },
    'Warehouse Staff':      { color:'#b45309', bg:'#fef9c3' },
    'Medical Technologist': { color:'#0891b2', bg:'#cffafe' },
    System:                 { color:'#6b7280', bg:'#f3f4f6' },
  }

  // ── Export helpers (no external dependencies) ────────────────────────────
  const EXPORT_HEADERS = ['Date', 'Time', 'User', 'Role', 'Activity', 'Patient', 'Reference', 'Module', 'Status', 'IP Address']
  const exportRows = () => display.map(l => ([
    fmtDate(l.timestamp), fmtTime(l.timestamp), l.user_name, l.user_role,
    activityLabel(l), patientOf(l) || '—', l.reference_id || '—',
    l.module || '—', statusMeta(l.status).label, l.ip_address || '—',
  ]))

  const exportCSV = () => {
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [EXPORT_HEADERS, ...exportRows()].map(r => r.map(esc).join(','))
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `system-activities-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const openPrint = (forPdf: boolean) => {
    const rows = exportRows()
    const win  = window.open('', '_blank')
    if (!win) return
    const cells = (arr: string[], tag: 'td' | 'th') =>
      arr.map(c => `<${tag}>${String(c).replace(/</g, '&lt;')}</${tag}>`).join('')
    const body = rows.map(r => `<tr>${cells(r, 'td')}</tr>`).join('')
    win.document.write(`
      <html><head><title>SMARTRHU — System Activity Report</title>
      <style>
        *{font-family:Arial,Helvetica,sans-serif;}
        body{padding:24px;color:#111;}
        h1{font-size:18px;margin:0 0 2px;color:#16a34a;}
        .sub{font-size:11px;color:#555;margin-bottom:14px;}
        table{width:100%;border-collapse:collapse;font-size:10px;}
        th,td{border:1px solid #d1d5db;padding:5px 7px;text-align:left;}
        th{background:#dcfce7;color:#166534;text-transform:uppercase;font-size:9px;letter-spacing:.4px;}
        tr:nth-child(even) td{background:#f6faf7;}
        @media print{ .noprint{display:none;} }
      </style></head><body>
      <h1>SMARTRHU — System Activity Report</h1>
      <div class="sub">Rural Health Unit · Lopez, Quezon &nbsp;|&nbsp; Generated ${new Date().toLocaleString('en-PH')} &nbsp;|&nbsp; ${rows.length} record(s)</div>
      <table><thead><tr>${cells(EXPORT_HEADERS, 'th')}</tr></thead><tbody>${body}</tbody></table>
      <script>window.onload=function(){setTimeout(function(){window.print();},250);}<\/script>
      </body></html>`)
    win.document.close()
    // forPdf is informational — the browser print dialog offers "Save as PDF".
    void forPdf
  }

  const btn = (extra: object = {}): React.CSSProperties => ({
    background: card, border: `1.5px solid ${bdr}`, borderRadius: 10, padding: '8px 14px',
    display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
    color: txt2, fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', ...extra,
  })
  const selStyle: React.CSSProperties = {
    padding: '7px 12px', borderRadius: 10, border: `1.5px solid ${bdr}`,
    fontSize: 12, color: txt, background: bg, cursor: 'pointer', outline: 'none', fontWeight: 600,
  }

  // ── Access denied screen ─────────────────────────────────────────────────
  if (!accessAllowed) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Nunito',sans-serif" }}>
        <div style={{ textAlign: 'center', maxWidth: 380, padding: 32, background: card, border: `1px solid ${bdr}`, borderRadius: 18 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <Lock size={28} color="#dc2626" />
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: txt, marginBottom: 6 }}>Restricted Area</div>
          <div style={{ fontSize: 13, color: txt2, lineHeight: 1.6 }}>
            The System Activities audit trail can only be accessed by Administrators.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="sys-thin-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', minHeight: 0, fontFamily: "'Nunito',sans-serif" }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, flexShrink: 0 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: dk ? '#4ade80' : G, letterSpacing: '-0.5px' }}>SYSTEM ACTIVITY MONITOR</h2>
          <div style={{ fontSize: 12, color: txt2, marginTop: 4 }}>Read-only audit trail · auto-generated · {display.length} matching record{display.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={btn()} onClick={() => openPrint(true)}><Download size={14} /> PDF</button>
          <button style={btn()} onClick={exportCSV}><FileSpreadsheet size={14} /> Excel</button>
          <button style={btn()} onClick={() => openPrint(false)}><Printer size={14} /> Print</button>
          <button style={btn({ background: `linear-gradient(135deg,${G},${TEAL})`, color: '#fff', border: 'none' })} onClick={fetchLogs}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Setup notice if table missing */}
      {noTable && (
        <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 12, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start', flexShrink: 0 }}>
          <AlertCircle size={16} color="#d97706" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12, color: '#92400e', lineHeight: 1.6 }}>
            <strong>audit_logs table not found.</strong> Showing sample data. Create the table from the SQL in <code>utils/auditLogs.ts</code> and call <code>logAction()</code> across the app to populate real activity.
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ background: card, borderRadius: 18, padding: '14px 18px', border: `1px solid ${bdr}`, display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0 }}>

        {/* Search row */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={14} color={txt2} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search user, activity, module, reference, IP..."
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 14px 9px 34px', borderRadius: 12, border: `1.5px solid ${bdr}`, fontSize: 12.5, outline: 'none', color: txt, background: bg }}
              onFocus={e => (e.currentTarget.style.borderColor = G)} onBlur={e => (e.currentTarget.style.borderColor = bdr)} />
          </div>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={14} color={txt2} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input value={patientSearch} onChange={e => setPatientSearch(e.target.value)} placeholder="Search by patient name..."
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 14px 9px 34px', borderRadius: 12, border: `1.5px solid ${bdr}`, fontSize: 12.5, outline: 'none', color: txt, background: bg }}
              onFocus={e => (e.currentTarget.style.borderColor = G)} onBlur={e => (e.currentTarget.style.borderColor = bdr)} />
          </div>
        </div>

        {/* Controls row */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Status pills */}
          <div style={{ display: 'flex', gap: 3, background: bg, borderRadius: 24, padding: 3, border: `1px solid ${bdr}` }}>
            {STATUSES.map(v => (
              <button key={v} onClick={() => setStatusFilter(v)} style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer',
                background: statusFilter === v ? `linear-gradient(135deg,${G},${TEAL})` : 'transparent',
                color: statusFilter === v ? '#fff' : txt2, transition: 'all 0.15s',
              }}>
                {v === 'all' ? 'All' : v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>

          <select value={roleFilter}   onChange={e => setRoleFilter(e.target.value)}   style={selStyle} title="Filter by role">
            {ROLES.map(r => <option key={r} value={r}>{r === 'All' ? 'All Roles' : r}</option>)}
          </select>
          <select value={userFilter}   onChange={e => setUserFilter(e.target.value)}   style={selStyle} title="Filter by specific user">
            {userOptions.map(u => <option key={u} value={u}>{u === 'All' ? 'All Users' : u}</option>)}
          </select>
          <select value={typeFilter}   onChange={e => setTypeFilter(e.target.value)}   style={{ ...selStyle, maxWidth: 220 }} title="Filter by activity type">
            {typeOptions.map(tp => <option key={tp} value={tp}>{tp === 'All' ? 'All Activities' : tp}</option>)}
          </select>

          {/* Date range */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: bg, border: `1.5px solid ${bdr}`, borderRadius: 10, padding: '4px 10px' }}>
            <Calendar size={13} color={txt2} />
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ border: 'none', outline: 'none', background: 'transparent', color: txt, fontSize: 12, fontFamily: 'inherit' }} />
            <span style={{ color: txt2, fontSize: 12 }}>→</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ border: 'none', outline: 'none', background: 'transparent', color: txt, fontSize: 12, fontFamily: 'inherit' }} />
          </div>

          {hasActiveFilters && (
            <button onClick={clearFilters} style={{ ...btn(), padding: '7px 12px', color: '#dc2626', borderColor: '#fca5a5' }}>
              <X size={13} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Log table */}
      <div style={{ background: card, border: `1px solid ${bdr}`, borderRadius: 18, overflow: 'hidden', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="sys-thin-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: bg, borderBottom: `2px solid ${bdr}` }}>
                {['Date & Time', 'User', 'Role', 'Activity', 'Reference', 'Module'].map(h => (
                  <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 800, color: dk ? '#4ade80' : G, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: bg, zIndex: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 48, color: txt2 }}>
                  <div style={{ width: 28, height: 28, border: `3px solid ${G}`, borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto 8px', animation: 'spin 0.8s linear infinite' }} />
                  Loading activity logs…
                </td></tr>
              ) : paginated.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 48, color: txt2 }}>No events found.</td></tr>
              ) : paginated.map(log => {
                const rm = roleMeta[log.user_role] || { color: '#6b7280', bg: '#f3f4f6' }
                return (
                  <tr key={log.id} style={{ borderBottom: `1px solid ${bdr}`, transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = dk ? 'rgba(22,163,74,0.06)' : 'rgba(22,163,74,0.03)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: txt2, fontSize: 11 }}>
                      <div style={{ fontWeight: 700, color: txt }}>{fmtDate(log.timestamp)}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}><Clock size={10} />{fmtTime(log.timestamp)}</div>
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 700, color: txt, whiteSpace: 'nowrap' }}>{log.user_name}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: rm.bg, color: rm.color, border: `1px solid ${rm.color}30`, whiteSpace: 'nowrap' }}>{log.user_role}</span>
                    </td>
                    <td style={{ padding: '10px 14px', color: txt, fontSize: 11, fontWeight: 600 }}>{activityLabel(log)}</td>
                    <td style={{ padding: '10px 14px', fontSize: 11, color: txt2, fontFamily: 'monospace' }}>{log.reference_id || '—'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 600, background: dk ? 'rgba(22,163,74,0.2)' : '#dcfce7', color: G }}>{log.module || '—'}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderTop: `1px solid ${bdr}`, background: bg, flexWrap: 'wrap', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: txt2 }}>
            Showing {display.length === 0 ? 0 : Math.min((page - 1) * PER_PAGE + 1, display.length)}–{Math.min(page * PER_PAGE, display.length)} of {display.length} events
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              style={{ padding: '5px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, border: `1.5px solid ${bdr}`, background: card, color: page === 1 ? txt2 : G, cursor: page === 1 ? 'default' : 'pointer' }}>← Prev</button>
            {Array.from({ length: Math.min(totalPages, 7) }).map((_, i) => (
              <button key={i} onClick={() => setPage(i + 1)}
                style={{ padding: '5px 11px', borderRadius: 10, fontSize: 12, fontWeight: 800, border: 'none', cursor: 'pointer',
                  background: page === i + 1 ? `linear-gradient(135deg,${G},${TEAL})` : 'transparent', color: page === i + 1 ? '#fff' : txt2 }}>
                {i + 1}
              </button>
            ))}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              style={{ padding: '5px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, border: `1.5px solid ${bdr}`, background: card, color: page === totalPages ? txt2 : G, cursor: page === totalPages ? 'default' : 'pointer' }}>Next →</button>
          </div>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap');
        @keyframes spin{to{transform:rotate(360deg)}}
        .sys-thin-scroll{ scrollbar-width: thin; scrollbar-color: ${G}66 transparent; }
        .sys-thin-scroll::-webkit-scrollbar{ width:8px; height:8px; }
        .sys-thin-scroll::-webkit-scrollbar-track{ background: transparent; }
        .sys-thin-scroll::-webkit-scrollbar-thumb{ background:${G}66; border-radius:8px; border:2px solid transparent; background-clip:content-box; }
        .sys-thin-scroll::-webkit-scrollbar-thumb:hover{ background:${G}; background-clip:content-box; }
      `}</style>
    </div>
  )
}