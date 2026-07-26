'use client'
import React, { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Users, FlaskConical, Package, FileBarChart, Monitor, UserCog, Download, Filter, Zap } from 'lucide-react'

const G = '#1a7a1a'
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

/* ── Lab test grouping (mirrors LabRecords screen) ─────────────────────────*/
const TEST_GROUPS: [string, string[]][] = [
  ['Fecalysis', ['fecalysis']],
  ['Urinalysis', ['urinalysis']],
  ['Hematology', ['hgb_hct', 'cbc_with_platelet']],
  ['Clinical Chemistry', ['random_blood_sugar', 'fasting_blood_sugar', 'cholesterol', 'triglycerides', 'lipid_profile', 'blood_uric_acid']],
  ['Serology', ['dengue_ns1', 'dengue_igg_igm', 'hbsag', 'pregnancy_test', 'abo_rh_blood_typing']],
]
const UNAVAILABLE_TESTS: [string, string][] = [
  ['gene_xpert', 'Gene Xpert'], ['afb_dssm', 'AFB/DSSM'], ['culture_and_sensitivity', 'Culture & Sensitivity'],
]
const labTestStr = (raw: any) => {
  const tags: string[] = []
  TEST_GROUPS.forEach(([cat, flags]) => { if (flags.some(f => raw[f])) tags.push(cat) })
  UNAVAILABLE_TESTS.forEach(([col, lbl]) => { if (raw[col]) tags.push(`${lbl} (Not Avail)`) })
  return tags.join('; ')
}

interface ReportDef {
  title: string; desc: string; color: string; icon: any
  table: string; dateField: string | null   // null = current snapshot (no date filter)
  archivedFilter?: boolean                   // count only archived=false
  rows: (from: string, to: string) => Promise<Record<string, any>[]>
}

export default function GenerateReport({ darkMode }: { darkMode: boolean }) {
  const dk   = darkMode
  const bg   = dk ? '#0d1a0f' : '#f0f4f1'
  const card = dk ? '#0f2014' : '#ffffff'
  const bdr  = dk ? '#1a3d24' : '#e5e7eb'
  const txt  = dk ? '#e2f5e9' : '#1f2937'
  const txt2 = dk ? '#6ee7b7' : '#6b7280'

  const today        = new Date()
  const currentYear  = today.getFullYear()
  const currentMonth = today.getMonth() + 1
  const isoToday     = today.toISOString().split('T')[0]

  const [filterType, setFilterType] = useState<'month'|'range'>('month')
  const [selYear,    setSelYear]    = useState(currentYear)
  const [selMonth,   setSelMonth]   = useState(currentMonth)
  const [rangeFrom,  setRangeFrom]  = useState(`${currentYear}-01-01`)
  const [rangeTo,    setRangeTo]    = useState(isoToday)
  const [loading,    setLoading]    = useState(false)
  const [counts,     setCounts]     = useState<Record<string, number>>({})   // -1 = table not found

  const years = Array.from({ length: 6 }, (_, i) => currentYear - i)

  const getDateRange = () => {
    if (filterType === 'month') {
      const pad = String(selMonth).padStart(2,'0')
      const lastDay = new Date(selYear, selMonth, 0).getDate()
      return { from:`${selYear}-${pad}-01`, to:`${selYear}-${pad}-${lastDay}`, label:`${MONTHS[selMonth-1]} ${selYear}` }
    }
    return { from:rangeFrom, to:rangeTo, label:`${rangeFrom} to ${rangeTo}` }
  }

  /* ── Reports — each builds rows with the SAME columns shown on its screen ──*/
  const reports: ReportDef[] = [
    {
      title:'Patient Reports', desc:'All registered patients', color:G, icon:Users,
      table:'patients', dateField:'created_at',
      rows: async (from, to) => {
        const [pRes, sRes] = await Promise.all([
          supabase.from('patients')
            .select('id,last_name,first_name,middle_name,age,sex,birthdate,barangay,municipality,contact_number,email,created_at')
            .gte('created_at', from).lte('created_at', to).order('created_at', { ascending: false }),
          supabase.from('soap_consultations').select('patient_id, assessments').range(0, 99999),
        ])
        const dx: Record<string, string[]> = {}
        ;(sRes.data || []).forEach((r: any) => {
          if (!r.patient_id || !Array.isArray(r.assessments)) return
          const a = dx[r.patient_id] || (dx[r.patient_id] = [])
          r.assessments.forEach((x: any) => { const s = String(x).trim(); if (s && !a.includes(s)) a.push(s) })
        })
        return (pRes.data || []).map((p: any, i: number) => ({
          'No.': i + 1,
          'Last Name': p.last_name || '',
          'First Name': p.first_name || '',
          'Middle': p.middle_name || '',
          'Age': p.age ?? '',
          'Sex': p.sex || '',
          'Birthdate': p.birthdate || '',
          'Barangay': p.barangay || '',
          'Municipality': p.municipality || '',
          'Contact': p.contact_number || '',
          'Email': p.email || '',
          'Diagnosis': (dx[p.id] || []).join('; '),
          'Created At': p.created_at || '',
        }))
      },
    },
    {
      title:'Laboratory Result', desc:'All laboratory tests and results', color:'#0891b2', icon:FlaskConical,
      table:'laboratory_requests', dateField:'created_at',
      rows: async (from, to) => {
        const [rRes, sRes] = await Promise.all([
          supabase.from('laboratory_requests')
            .select('*, patients ( first_name, last_name, age, sex )')
            .gte('created_at', from).lte('created_at', to).order('created_at', { ascending: false }),
          supabase.from('lab_signatures').select('request_id, med_technologist'),
        ])
        const sig: Record<string, string> = {}
        ;(sRes.data || []).forEach((s: any) => { if (s.request_id) sig[s.request_id] = s.med_technologist || '' })
        return (rRes.data || []).map((r: any, i: number) => ({
          'No.': i + 1,
          'Patient': r.patients ? `${r.patients.first_name ?? ''} ${r.patients.last_name ?? ''}`.trim() : '—',
          'Age': r.patients?.age ?? '',
          'Sex': r.patients?.sex === 'F' ? 'Female' : r.patients?.sex === 'M' ? 'Male' : '',
          'Test': labTestStr(r),
          'Request Date': r.request_date || (r.created_at ? new Date(r.created_at).toLocaleDateString('en-PH') : ''),
          'Status': r.status === 'completed' ? 'Completed' : 'Pending',
          'Medtech': r.status === 'completed' ? (sig[r.id] || '') : '',
          'Created At': r.created_at || '',
        }))
      },
    },
    {
      title:'Inventory Report', desc:'Current medicine stock levels (snapshot)', color:'#d97706', icon:Package,
      table:'pharma_medicines', dateField:null, archivedFilter:true,
      rows: async () => {
        const { data } = await supabase.from('pharma_medicines').select('*').eq('archived', false).order('created_at', { ascending: false })
        const stock = (i: any) => { const q = Number(i.quantity ?? 0); const r = Number(i.reorder_level ?? 10); return q === 0 ? 'Out of Stock' : q <= r ? 'Low Stock' : 'In Stock' }
        return (data || []).map((i: any, idx: number) => ({
          'No.': idx + 1,
          'Medicine': i.med_name || i.medicine_name || i.generic_name || '',
          'Dosage': i.med_dosage || '',
          'Type': i.med_type || i.category || '',
          'Quantity': Number(i.quantity ?? 0),
          'Unit': i.unit || '',
          'Expiry': i.exp_date || i.expiry_date || '',
          'Status': stock(i),
          'Created At': i.created_at || '',
        }))
      },
    },
    {
      title:'Consultations Report', desc:'All SOAP consultations conducted', color:'#db2777', icon:FileBarChart,
      table:'soap_consultations', dateField:'created_at',
      rows: async (from, to) => {
        const { data } = await supabase.from('soap_consultations')
          .select('id,patient_id,status,subjective,assessments,plan,created_at')
          .gte('created_at', from).lte('created_at', to).order('created_at', { ascending: false })
        return (data || []).map((c: any, i: number) => ({
          'No.': i + 1,
          'Patient ID': c.patient_id || '',
          'Status': c.status || '',
          'Subjective': c.subjective || '',
          'Assessments': Array.isArray(c.assessments) ? c.assessments.join('; ') : (c.assessments || ''),
          'Plan': c.plan || '',
          'Created At': c.created_at || '',
        }))
      },
    },
    {
      title:'Prescription Report', desc:'All issued prescriptions', color:'#2563eb', icon:UserCog,
      table:'prescriptions', dateField:'created_at',
      rows: async (from, to) => {
        const { data } = await supabase.from('prescriptions')
          .select('id,patient_id,medicine,quantity,dosage_frequency,prescription_date,created_at')
          .gte('created_at', from).lte('created_at', to).order('created_at', { ascending: false })
        return (data || []).map((p: any, i: number) => ({
          'No.': i + 1,
          'Patient ID': p.patient_id || '',
          'Medicine': p.medicine || '',
          'Quantity': p.quantity ?? '',
          'Dosage / Frequency': p.dosage_frequency || '',
          'Prescription Date': p.prescription_date || '',
          'Created At': p.created_at || '',
        }))
      },
    },
    {
      title:'System Audit Log', desc:'Complete audit trail of all system changes', color:'#7c3aed', icon:Monitor,
      table:'audit_logs', dateField:'created_at',
      rows: async (from, to) => {
        const { data, error } = await supabase.from('audit_logs')
          .select('id,user_name,user_role,action,module,description,status,created_at')
          .gte('created_at', from).lte('created_at', to).order('created_at', { ascending: false })
        if (error) return []
        return (data || []).map((l: any, i: number) => ({
          'No.': i + 1,
          'User': l.user_name || '',
          'Role': l.user_role || '',
          'Action': l.action || '',
          'Module': l.module || '',
          'Description': l.description || '',
          'Status': l.status || '',
          'Created At': l.created_at || '',
        }))
      },
    },
  ]

  // ── Per-report counts (head query) — same scope as export, so count === rows ──
  const fetchCounts = async () => {
    const { from, to } = getDateRange()
    setLoading(true)
    const results = await Promise.all(reports.map(async (r) => {
      try {
        let q: any = supabase.from(r.table as any).select('*', { count:'exact', head:true })
        if (r.dateField) q = q.gte(r.dateField, from).lte(r.dateField, to)
        if (r.archivedFilter) q = q.eq('archived', false)
        const { count, error } = await q
        if (error) return [r.title, -1] as const
        return [r.title, count || 0] as const
      } catch { return [r.title, -1] as const }
    }))
    const map: Record<string, number> = {}
    results.forEach(([t, c]) => { map[t] = c })
    setCounts(map)
    setLoading(false)
  }

  useEffect(() => { fetchCounts() }, [selYear, selMonth, filterType, rangeFrom, rangeTo])

  // ── Quick presets ────────────────────────────────────────────────────────
  const applyPreset = (preset: string) => {
    if (preset === 'thisMonth')  { setFilterType('month'); setSelYear(currentYear); setSelMonth(currentMonth); return }
    if (preset === 'lastMonth')  { const d = new Date(currentYear, currentMonth - 2, 1); setFilterType('month'); setSelYear(d.getFullYear()); setSelMonth(d.getMonth() + 1); return }
    if (preset === 'last3')      { const d = new Date(); d.setMonth(d.getMonth() - 3); setFilterType('range'); setRangeFrom(d.toISOString().split('T')[0]); setRangeTo(isoToday); return }
    if (preset === 'thisYear')   { setFilterType('range'); setRangeFrom(`${currentYear}-01-01`); setRangeTo(isoToday); return }
    if (preset === 'allTime')    { setFilterType('range'); setRangeFrom('2000-01-01'); setRangeTo(isoToday); return }
  }
  const isPresetActive = (preset: string) => {
    if (preset === 'thisMonth') return filterType === 'month' && selYear === currentYear && selMonth === currentMonth
    if (preset === 'lastMonth') { const d = new Date(currentYear, currentMonth - 2, 1); return filterType === 'month' && selYear === d.getFullYear() && selMonth === d.getMonth() + 1 }
    if (preset === 'thisYear')  return filterType === 'range' && rangeFrom === `${currentYear}-01-01` && rangeTo === isoToday
    if (preset === 'allTime')   return filterType === 'range' && rangeFrom === '2000-01-01' && rangeTo === isoToday
    return false
  }
  const presets = [
    { id:'thisMonth', label:'This Month' }, { id:'lastMonth', label:'Last Month' },
    { id:'last3', label:'Last 3 Months' }, { id:'thisYear', label:'This Year' }, { id:'allTime', label:'All Time' },
  ]

  // ── Export: Excel / PDF (uses the exact display columns) ──────────────────
  const handleExport = async (format: 'Excel'|'PDF', report: ReportDef) => {
    const { from, to, label } = getDateRange()
    const periodLabel = report.dateField ? label : 'Current snapshot'

    const rows = await report.rows(from, to)
    if (!rows || rows.length === 0) {
      alert(`No data found for "${report.title}".\n\nPeriod: ${periodLabel}`)
      return
    }

    const headers = Object.keys(rows[0])
    const esc = (v: any) => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    const fileBase = `${report.title.replace(/\s+/g,'-')}_${periodLabel.replace(/\s+/g,'-')}`

    if (format === 'Excel') {
      const html =
        `<table border="1"><thead><tr style="background:#1a7a1a;color:#fff">${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead>` +
        `<tbody>${rows.map(row=>`<tr>${headers.map(h=>`<td>${esc(row[h])}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      const blob = new Blob([`\uFEFF<html><head><meta charset="utf-8"></head><body>${html}</body></html>`], { type:'application/vnd.ms-excel' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${fileBase}.xls`; a.click()
      URL.revokeObjectURL(url)
      return
    }

    // PDF — opens a print window; choose "Save as PDF"
    const w = window.open('','_blank')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><title>${report.title}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:24px;font-size:11px;color:#111}
        h1{color:${G};font-size:18px;border-bottom:3px solid ${G};padding-bottom:8px;margin-bottom:4px}
        .meta{font-size:10px;color:#666;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;font-size:10px}
        th{background:${G};color:#fff;padding:6px 8px;text-align:left;font-size:10px}
        td{padding:5px 8px;border-bottom:1px solid #e5e7eb;word-break:break-word;max-width:200px}
        tr:nth-child(even){background:#f9fafb}
        @media print{body{padding:0}}
      </style></head><body>
      <h1>${report.title} — SmartRHU</h1>
      <div class="meta">RHU Lopez, Quezon &nbsp;|&nbsp; Period: <b>${periodLabel}</b> &nbsp;|&nbsp; Records: <b>${rows.length}</b> &nbsp;|&nbsp; Generated: ${new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'})}</div>
      <table>
        <thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(row=>`<tr>${headers.map(h=>`<td>${esc(row[h]) || '—'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
      </body></html>`)
    w.document.close()
    setTimeout(() => w.print(), 500)
  }

  const { label } = getDateRange()

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20, height:'100%', overflowY:'auto', paddingRight:4 }}>
      <div>
        <h2 style={{ margin:0, fontSize:28, fontWeight:1000, color:dk?'#015b22':G }}>GENERATE REPORTS</h2>
      </div>

      {/* Filter Panel */}
      <div style={{ background:card, border:`1px solid ${bdr}`, borderRadius:18, padding:20 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
          <Filter size={16} color={G}/>
          <span style={{ fontWeight:800, fontSize:14, color:txt }}>Date Range Filter</span>
        </div>

        {/* Quick presets */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:16 }}>
          <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, fontWeight:800, color:txt2, textTransform:'uppercase', letterSpacing:0.5 }}>
            <Zap size={12} color={G}/> Quick
          </span>
          {presets.map(p=>(
            <button key={p.id} onClick={()=>applyPreset(p.id)}
              style={{ padding:'6px 14px', borderRadius:20, fontSize:12, fontWeight:700, cursor:'pointer',
                background:isPresetActive(p.id)?`linear-gradient(135deg,${G},#0d9488)`:'transparent',
                color:isPresetActive(p.id)?'#fff':txt2,
                border:isPresetActive(p.id)?'none':`1.5px solid ${bdr}`, transition:'all 0.15s' }}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Toggle */}
        <div style={{ display:'flex', gap:3, background:bg, borderRadius:24, padding:3, border:`1px solid ${bdr}`, width:'fit-content', marginBottom:16 }}>
          {(['month','range'] as const).map(v=>(
            <button key={v} onClick={()=>setFilterType(v)}
              style={{ padding:'6px 18px', borderRadius:20, fontSize:12, fontWeight:700, border:'none', cursor:'pointer',
                background:filterType===v?`linear-gradient(135deg,${G},#0d9488)`:'transparent',
                color:filterType===v?'#fff':txt2, transition:'all 0.15s' }}>
              {v==='month'?'By Month':'Custom Range'}
            </button>
          ))}
        </div>

        {filterType === 'month' ? (
          <div style={{ display:'flex', gap:20, flexWrap:'wrap', alignItems:'flex-start' }}>
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:txt2, marginBottom:8, textTransform:'uppercase', letterSpacing:0.5 }}>Year</div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {years.map(y=>(
                  <button key={y} onClick={()=>setSelYear(y)}
                    style={{ padding:'6px 14px', borderRadius:10, fontSize:12, fontWeight:700, cursor:'pointer',
                      background:selYear===y?`linear-gradient(135deg,${G},#0d9488)`:'transparent',
                      color:selYear===y?'#fff':txt2, border:selYear===y?'none':`1.5px solid ${bdr}`, transition:'all 0.15s' }}>
                    {y}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ width:1, height:60, background:bdr, flexShrink:0, marginTop:28 }}/>
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:txt2, marginBottom:8, textTransform:'uppercase', letterSpacing:0.5 }}>Month</div>
              <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                {MONTHS.map((m,i)=>(
                  <button key={m} onClick={()=>setSelMonth(i+1)}
                    style={{ padding:'6px 12px', borderRadius:10, fontSize:11, fontWeight:700, cursor:'pointer',
                      background:selMonth===i+1?`linear-gradient(135deg,${G},#0d9488)`:'transparent',
                      color:selMonth===i+1?'#fff':txt2, border:selMonth===i+1?'none':`1.5px solid ${bdr}`, transition:'all 0.15s' }}>
                    {m.slice(0,3)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap' }}>
            {([['From',rangeFrom,setRangeFrom],['To',rangeTo,setRangeTo]] as const).map(([lbl,val,fn])=>(
              <div key={lbl}>
                <div style={{ fontSize:11, fontWeight:700, color:txt2, marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 }}>{lbl}</div>
                <input type="date" value={val} onChange={e=>fn(e.target.value)}
                  style={{ padding:'8px 12px', borderRadius:10, border:`1.5px solid ${bdr}`, fontSize:13, color:txt, background:bg, outline:'none' }}
                  onFocus={e=>(e.currentTarget.style.borderColor=G)} onBlur={e=>(e.currentTarget.style.borderColor=bdr)}/>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop:16, padding:'10px 16px', background:bg, borderRadius:12, border:`1px solid ${bdr}`, fontSize:12, color:txt2 }}>
          Showing records for <strong style={{ color:txt }}>{label}</strong>
          {loading && <span style={{ marginLeft:8, color:G, fontWeight:700 }}>· counting…</span>}
        </div>
      </div>

      {/* Report Cards */}
      <div className="gr-cards">
        {reports.map(r=>{
          const n = counts[r.title]
          const missing  = n === -1
          const empty    = n === 0
          const disabled = loading || missing || empty
          const badgeText = r.dateField ? `📅 ${label}` : '📦 Current snapshot'
          return (
            <div key={r.title} style={{ background:card, border:`1px solid ${bdr}`, borderRadius:16, padding:20, opacity: missing ? 0.7 : 1 }}>
              <div style={{ width:40, height:40, borderRadius:11, background:`${r.color}18`, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:12 }}>
                <r.icon size={20} color={r.color}/>
              </div>
              <div style={{ fontWeight:800, fontSize:14, color:txt, marginBottom:4 }}>{r.title}</div>
              <div style={{ fontSize:11, color:txt2, marginBottom:10, lineHeight:1.5 }}>{r.desc}</div>

              <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:14 }}>
                <span style={{ fontSize:10, color:r.color, padding:'3px 8px', background:`${r.color}10`, borderRadius:6 }}>{badgeText}</span>
                <span style={{ fontSize:11, fontWeight:800, color: missing ? '#dc2626' : empty ? txt2 : r.color }}>
                  {loading ? '… counting' : missing ? 'Table not found' : empty ? 'No records' : `${n} record${n===1?'':'s'}`}
                </span>
              </div>

              <div style={{ display:'flex', gap:8 }}>
                {(['Excel','PDF'] as const).map(fmt=>(
                  <button key={fmt} onClick={()=>!disabled && handleExport(fmt,r)} disabled={disabled}
                    style={{ flex:1, background:`${r.color}18`, color:r.color, border:`1px solid ${r.color}33`,
                      borderRadius:8, padding:'7px 0', fontSize:11, fontWeight:700, cursor:disabled?'not-allowed':'pointer',
                      opacity:disabled?0.45:1,
                      display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}
                    onMouseEnter={e=>{ if(!disabled) e.currentTarget.style.background=`${r.color}30` }}
                    onMouseLeave={e=>{ if(!disabled) e.currentTarget.style.background=`${r.color}18` }}>
                    <Download size={10}/>{fmt}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <style>{`
        .gr-cards{ display:grid; gap:16px; grid-template-columns:repeat(3,1fr); }
        @media (max-width:1100px){ .gr-cards{ grid-template-columns:repeat(2,1fr); } }
        @media (max-width:680px){ .gr-cards{ grid-template-columns:1fr; } }
      `}</style>
    </div>
  )
}