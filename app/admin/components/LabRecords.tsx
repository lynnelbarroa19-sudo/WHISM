'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  useAdmin, RecordPage, StatStrip, Toolbar, SearchInput, Segmented,
  Pill, DataView, downloadCSV, ExportMenu, type Column,
} from './adminUI'

interface LabRequest {
  id: string
  status?: string
  request_date?: string
  created_at?: string
  requested_by?: string
  patient_id?: string
  name: string
  age?: string | number
  gender?: string
  address?: string
  raw: any
}

export default function LabRecords({ darkMode }: { darkMode: boolean }) {
  const t = useAdmin(darkMode)

  const [requests, setRequests] = useState<LabRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'pending' | 'completed'>('all')
  const [sigMap, setSigMap] = useState<Record<string, string>>({})

  const load = async () => {
    setLoading(true)
    const [reqRes, sigRes] = await Promise.all([
      supabase
        .from('laboratory_requests')
        .select(`*, patients ( id, first_name, last_name, age, sex, purok, barangay, municipality, contact_number, email )`)
        .order('created_at', { ascending: false }),
      supabase.from('lab_signatures').select('request_id, med_technologist'),
    ])

    const map: Record<string, string> = {}
    ;(sigRes.data || []).forEach((s: any) => { if (s.request_id) map[s.request_id] = s.med_technologist || '' })
    setSigMap(map)

    if (reqRes.data) {
      setRequests(reqRes.data.map((r: any) => ({
        ...r,
        name: r.patients ? `${r.patients.first_name ?? ''} ${r.patients.last_name ?? ''}`.trim() : r.name || '—',
        age: r.patients?.age ?? r.age ?? '—',
        gender: r.patients?.sex === 'F' ? 'Female' : r.patients?.sex === 'M' ? 'Male' : r.gender || '—',
        address: r.patients ? [r.patients.purok, r.patients.barangay, r.patients.municipality].filter(Boolean).join(', ') : r.address || '—',
        raw: r,
      })))
    }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Tests the lab can process (available) vs requested-but-unavailable
  const TEST_GROUPS: [string, string[]][] = [
    ['Fecalysis', ['fecalysis']],
    ['Urinalysis', ['urinalysis']],
    ['Hematology', ['hgb_hct', 'cbc_with_platelet']],
    ['Clinical Chemistry', ['random_blood_sugar', 'fasting_blood_sugar', 'cholesterol', 'triglycerides', 'lipid_profile', 'blood_uric_acid']],
    ['Serology', ['dengue_ns1', 'dengue_igg_igm', 'hbsag', 'pregnancy_test', 'abo_rh_blood_typing']],
  ]
  // Requestable tests the laboratory does NOT process → "Not Avail"
  const UNAVAILABLE_TESTS: [string, string][] = [
    ['gene_xpert', 'Gene Xpert'],
    ['afb_dssm', 'AFB/DSSM'],
    ['culture_and_sensitivity', 'Culture & Sensitivity'],
  ]
  const testTags = (r: LabRequest): { label: string; ok: boolean }[] => {
    const raw: any = r.raw || {}
    const tags: { label: string; ok: boolean }[] = []
    TEST_GROUPS.forEach(([cat, flags]) => { if (flags.some(f => raw[f])) tags.push({ label: cat, ok: true }) })
    UNAVAILABLE_TESTS.forEach(([col, lbl]) => { if (raw[col]) tags.push({ label: lbl, ok: false }) })
    return tags
  }

  const rows = useMemo(() => requests.filter(r => {
    if (status !== 'all' && (r.status || 'pending') !== status) return false
    if (search) {
      const q = search.toLowerCase()
      const testStr = testTags(r).map(tg => tg.label).join(' ')
      if (!`${r.name} ${r.id} ${r.request_date ?? ''} ${testStr}`.toLowerCase().includes(q)) return false
    }
    return true
  }), [requests, status, search])

  const completed = requests.filter(r => r.status === 'completed').length
  const pending = requests.length - completed

  const columns: Column<LabRequest>[] = [
    { key: 'no', header: '#', width: 44, cell: (_r, i) => <span style={{ color: t.txt2, fontWeight: 700 }}>{i + 1}</span> },
    { key: 'name', header: 'Patient', cell: r => (
      <div>
        <div style={{ fontWeight: 700, color: t.txt }}>{r.name || '—'}</div>
        <div style={{ fontSize: 10, color: t.txt2 }}>ID: {String(r.id).slice(0, 8)}</div>
      </div>
    ) },
    { key: 'age', header: 'Age', cell: r => r.age ?? '—' },
    { key: 'sex', header: 'Sex', cell: r => r.gender ?? '—' },
    { key: 'test', header: 'Test', cell: r => {
      const tags = testTags(r)
      if (tags.length === 0) return <span style={{ color: t.txt2 }}>—</span>
      const shown = tags.slice(0, 3)
      return (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
          {shown.map((tg, i) => <Pill key={i} tone={tg.ok ? 'blue' : 'red'}>{tg.ok ? tg.label : `${tg.label} · Not Avail`}</Pill>)}
          {tags.length > 3 && <span style={{ fontSize: 11, color: t.txt2, fontWeight: 700 }}>+{tags.length - 3}</span>}
        </span>
      )
    } },
    { key: 'date', header: 'Request Date', cell: r => <span style={{ fontSize: 11.5, color: t.txt2 }}>{r.request_date || (r.created_at ? new Date(r.created_at).toLocaleDateString('en-PH') : '—')}</span> },
    { key: 'status', header: 'Status', cell: r => <Pill tone={r.status === 'completed' ? 'green' : 'amber'}>{r.status === 'completed' ? 'Completed' : 'Pending'}</Pill> },
    { key: 'medtech', header: 'Medtech', cell: r => {
      if (r.status !== 'completed') return <span />            // blank while pending
      const mt = sigMap[r.id]
      return <span style={{ fontSize: 11.5, color: mt ? t.txt : t.txt2 }}>{mt || '—'}</span>
    } },
  ]

  const exportData = () => {
    const headers = ['No.', 'Patient', 'Age', 'Sex', 'Test', 'Request Date', 'Status', 'Medtech']
    const body = rows.map((r, i) => [
      i + 1, r.name, r.age ?? '', r.gender ?? '',
      testTags(r).map(tg => tg.ok ? tg.label : `${tg.label} (Not Avail)`).join('; '),
      r.request_date ?? '', r.status ?? 'pending',
      r.status === 'completed' ? (sigMap[r.id] || '') : '',
    ])
    return { headers, body }
  }

  const exportCsv = () => {
    const { headers, body } = exportData()
    downloadCSV('lab-records.csv', headers, body)
  }

  // Excel via HTML table (.xls) — opens directly in Excel
  const exportExcel = () => {
    const { headers, body } = exportData()
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const html =
      `<table border="1"><thead><tr style="background:#1a7a1a;color:#fff">${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>` +
      `<tbody>${body.map(row => `<tr>${row.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    const blob = new Blob([`\uFEFF<html><head><meta charset="utf-8"></head><body>${html}</body></html>`], { type: 'application/vnd.ms-excel' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'lab-records.xls'; a.click()
    URL.revokeObjectURL(url)
  }

  // PDF via print window (use browser's "Save as PDF")
  const exportPdf = () => {
    const { headers, body } = exportData()
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><title>Lab Records</title>
      <style>
        body{font-family:Arial,sans-serif;padding:24px;font-size:11px;color:#111}
        h1{color:#1a7a1a;font-size:18px;border-bottom:3px solid #1a7a1a;padding-bottom:8px;margin-bottom:4px}
        .meta{font-size:10px;color:#666;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;font-size:10px}
        th{background:#1a7a1a;color:#fff;padding:6px 8px;text-align:left}
        td{padding:5px 8px;border-bottom:1px solid #e5e7eb;word-break:break-word}
        tr:nth-child(even){background:#f9fafb}
        @media print{body{padding:0}}
      </style></head><body>
      <h1>Lab Records — SmartRHU</h1>
      <div class="meta">RHU Lopez, Quezon &nbsp;|&nbsp; Records: <b>${body.length}</b> &nbsp;|&nbsp; Generated: ${new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
      <table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${body.map(row => `<tr>${row.map(c => `<td>${c ?? '—'}</td>`).join('')}</tr>`).join('')}</tbody></table>
      </body></html>`)
    w.document.close()
    setTimeout(() => w.print(), 500)
  }

  return (
    <RecordPage t={t} title="LABORATORY RECORDS" subtitle="" onRefresh={load} fit>
      <div style={{ flexShrink: 0 }}>
        <StatStrip t={t} items={[
          { label: 'Total Requests', value: requests.length, color: '#1a7a1a' },
          { label: 'Completed', value: completed, color: '#15803d' },
          { label: 'Pending', value: pending, color: '#d97706', alert: pending > 0 },
        ]} />
      </div>

      <div style={{ flexShrink: 0 }}>
        <Toolbar t={t}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <SearchInput t={t} value={search} onChange={setSearch} placeholder="Search patient, ID, test, date…" />
            <ExportMenu t={t} items={[
              { label: ' Excel', onClick: exportExcel },
              { label: ' PDF', onClick: exportPdf },
            ]} />
          </div>
          <Segmented t={t} value={status} onChange={setStatus} options={[
            { value: 'all', label: 'All' }, { value: 'pending', label: 'Pending' }, { value: 'completed', label: 'Completed' },
          ]} />
        </Toolbar>
      </div>

      <DataView t={t} columns={columns} rows={rows} loading={loading}
        keyOf={r => r.id} resetKey={`${search}|${status}`}
        emptyText="No lab requests found." fill />
    </RecordPage>
  )
}