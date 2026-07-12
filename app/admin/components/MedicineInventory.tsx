'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Pill as RxIcon, Warehouse as WhIcon } from 'lucide-react'
import {
  useAdmin, RecordPage, StatStrip, Toolbar, SearchInput, Segmented,
  Pill, DataView, Drawer, Field, Section, downloadCSV, ExportMenu, type Column, type Tone,
} from './adminUI'

/* ── Types ─────────────────────────────────────────────────────────────────*/
interface PharmaItem {
  id: string
  med_name?: string; medicine_name?: string; generic_name?: string; brand_name?: string
  med_dosage?: string; med_type?: string; category?: string
  quantity?: number; unit?: string; exp_date?: string; expiry_date?: string
  reorder_level?: number; created_at?: string; archived?: boolean
}

/* Mirrors the warehouse_medicines schema used in MedicineStockPage:
   boxes + partial_pcs make up quantity, and category splits drug vs supply. */
interface WhMed {
  id: string
  med_name: string; med_dosage: string; med_type: string
  exp_date: string; quantity: number; unit: string
  boxes?: number; partial_pcs?: number
  category?: 'drug' | 'supply'
  description?: string | null
  archived?: boolean; created_at?: string
}

type TabId = 'pharmacy' | 'warehouse'
type WhCat = 'all' | 'drug' | 'supply'

export default function MedicineInventory({ darkMode }: { darkMode: boolean }) {
  const t = useAdmin(darkMode)
  const [tab, setTab] = useState<TabId>('pharmacy')

  /* ── Pharmacy state ──────────────────────────────────────────────────────*/
  const [pItems, setPItems] = useState<PharmaItem[]>([])
  const [pLoading, setPLoading] = useState(true)
  const [pSource, setPSource] = useState('')
  const [pSearch, setPSearch] = useState('')
  const [pFilter, setPFilter] = useState<'all' | 'low' | 'out' | 'expiring'>('all')
  const [pView, setPView] = useState<PharmaItem | null>(null)

  /* ── Warehouse state ─────────────────────────────────────────────────────*/
  const [wMeds, setWMeds] = useState<WhMed[]>([])
  const [wLoading, setWLoading] = useState(true)
  const [wSearch, setWSearch] = useState('')
  const [wFilter, setWFilter] = useState<'active' | 'archived' | 'expiring'>('active')
  const [wCat, setWCat] = useState<WhCat>('all')
  const [wView, setWView] = useState<WhMed | null>(null)

  /* ── Loaders ─────────────────────────────────────────────────────────────*/
  const loadPharmacy = async () => {
    setPLoading(true)
    const tries: [string, any][] = [
      ['pharma_medicines', supabase.from('pharma_medicines').select('*').eq('archived', false).order('created_at', { ascending: false })],
      ['inventory', supabase.from('inventory').select('*').order('created_at', { ascending: false })],
      ['medicine_inventory', supabase.from('medicine_inventory').select('*').order('created_at', { ascending: false })],
    ]
    for (const [nm, q] of tries) {
      const { data } = await q
      if (data && data.length > 0) { setPItems(data); setPSource(nm); setPLoading(false); return }
    }
    setPItems([]); setPSource('pharma_medicines'); setPLoading(false)
  }

  const loadWarehouse = async () => {
    setWLoading(true)
    const { data } = await supabase.from('warehouse_medicines').select('*').order('created_at', { ascending: false })
    setWMeds((data as WhMed[]) || [])
    setWLoading(false)
  }

  useEffect(() => { loadPharmacy(); loadWarehouse() }, [])

  /* ── Pharmacy helpers ────────────────────────────────────────────────────*/
  const pName = (i: PharmaItem) => i.med_name || i.medicine_name || i.generic_name || '—'
  const pDose = (i: PharmaItem) => i.med_dosage || '—'
  const pType = (i: PharmaItem) => i.med_type || i.category || '—'
  const pQty = (i: PharmaItem) => Number(i.quantity ?? 0)
  const pReorder = (i: PharmaItem) => Number(i.reorder_level ?? 10)
  const pExpiry = (i: PharmaItem) => i.exp_date || i.expiry_date || ''
  const pExpired = (i: PharmaItem) => { const d = pExpiry(i); return !!d && new Date(d) < new Date() }
  const pExpiringSoon = (i: PharmaItem) => { const d = pExpiry(i); if (!d) return false; const diff = (new Date(d).getTime() - Date.now()) / 86400000; return diff >= 0 && diff <= 90 }
  const pStock = (i: PharmaItem): { label: string; tone: Tone } =>
    pQty(i) === 0 ? { label: 'Out of Stock', tone: 'red' }
    : pQty(i) <= pReorder(i) ? { label: 'Low Stock', tone: 'amber' }
    : { label: 'In Stock', tone: 'green' }

  const pRows = useMemo(() => pItems.filter(i => {
    if (pFilter === 'low' && !(pQty(i) > 0 && pQty(i) <= pReorder(i))) return false
    if (pFilter === 'out' && pQty(i) !== 0) return false
    if (pFilter === 'expiring' && !pExpiringSoon(i)) return false
    if (pSearch && !`${pName(i)} ${pDose(i)} ${pType(i)}`.toLowerCase().includes(pSearch.toLowerCase())) return false
    return true
  }), [pItems, pFilter, pSearch])

  const pOut = pItems.filter(i => pQty(i) === 0).length
  const pLow = pItems.filter(i => pQty(i) > 0 && pQty(i) <= pReorder(i)).length
  const pExpSoon = pItems.filter(i => pExpiringSoon(i) && !pExpired(i)).length
  const pExpired2 = pItems.filter(i => pExpired(i)).length

  const pColumns: Column<PharmaItem>[] = [
    { key: 'no', header: '#', width: 44, cell: (_i, idx) => <span style={{ color: t.txt2, fontWeight: 700 }}>{idx + 1}</span> },
    { key: 'name', header: 'Medicine', cell: i => (
      <div>
        <div style={{ fontWeight: 700, color: t.txt }}>{pName(i)}</div>
        {i.brand_name && <div style={{ fontSize: 10, color: t.txt2, fontStyle: 'italic' }}>{i.brand_name}</div>}
      </div>
    ) },
    { key: 'dose', header: 'Dosage', cell: i => <span style={{ fontSize: 11.5, color: t.txt2 }}>{pDose(i)}</span> },
    { key: 'type', header: 'Type', cell: i => <span style={{ fontSize: 11.5, color: t.txt2 }}>{pType(i)}</span> },
    { key: 'qty', header: 'Qty', align: 'right', cell: i => (
      <span style={{ fontWeight: 800, fontSize: 14, color: pQty(i) === 0 ? '#dc2626' : pQty(i) <= pReorder(i) ? '#d97706' : t.txt }}>{pQty(i)}</span>
    ) },
    { key: 'unit', header: 'Unit', cell: i => <span style={{ fontSize: 11.5, color: t.txt2 }}>{i.unit || '—'}</span> },
    { key: 'exp', header: 'Expiry', cell: i => (
      <span style={{ fontSize: 11.5, fontWeight: 600, color: pExpired(i) ? '#dc2626' : pExpiringSoon(i) ? '#d97706' : t.txt2 }}>{pExpiry(i) || '—'}</span>
    ) },
    { key: 'stock', header: 'Status', cell: i => { const s = pStock(i); return <Pill tone={s.tone}>{s.label}</Pill> } },
  ]

  const pData = () => ({
    headers: ['No.', 'Medicine', 'Dosage', 'Type', 'Quantity', 'Unit', 'Expiry', 'Status'],
    body: pRows.map((i, idx) => [idx + 1, pName(i), pDose(i), pType(i), pQty(i), i.unit || '', pExpiry(i), pStock(i).label]),
  })

  /* ── Warehouse helpers ───────────────────────────────────────────────────*/
  /* Expiry uses a midnight cutoff to match MedicineStockPage's auto-archive. */
  const wExpired = (m: WhMed) => {
    if (!m.exp_date) return false
    const today = new Date(); today.setHours(0, 0, 0, 0)
    return new Date(m.exp_date).getTime() < today.getTime()
  }
  const wExpiringSoon = (m: WhMed) => { if (!m.exp_date) return false; const d = (new Date(m.exp_date).getTime() - Date.now()) / 86400000; return d >= 0 && d <= 90 }
  /* Expired rows are treated as archived, exactly like the warehouse screen. */
  const wArchivedEff = (m: WhMed) => !!m.archived || wExpired(m)
  const wCatOf = (m: WhMed): 'drug' | 'supply' => m.category === 'supply' ? 'supply' : 'drug'
  const wTotal = (m: WhMed) => Number(m.quantity ?? ((m.boxes || 0) + (m.partial_pcs || 0)))
  const wTone = (m: WhMed): Tone => wExpired(m) ? 'red' : wExpiringSoon(m) ? 'amber' : 'green'
  const wExpLabel = (m: WhMed) => wExpired(m) ? 'Expired' : wExpiringSoon(m) ? 'Expiring soon' : 'Valid'

  const wScoped = useMemo(
    () => wMeds.filter(m => wCat === 'all' || wCatOf(m) === wCat),
    [wMeds, wCat],
  )

  const wRows = useMemo(() => wScoped.filter(m => {
    if (wFilter === 'active' && wArchivedEff(m)) return false
    if (wFilter === 'archived' && !wArchivedEff(m)) return false
    if (wFilter === 'expiring' && !wExpiringSoon(m) && !wExpired(m)) return false
    if (wSearch && !`${m.med_name} ${m.med_dosage} ${m.med_type}`.toLowerCase().includes(wSearch.toLowerCase())) return false
    return true
  }), [wScoped, wFilter, wSearch])

  const wActive = wScoped.filter(m => !wArchivedEff(m)).length
  const wArchived = wScoped.filter(m => wArchivedEff(m)).length
  const wExpSoon = wScoped.filter(m => wExpiringSoon(m) && !wExpired(m)).length
  const wExpired2 = wScoped.filter(m => wExpired(m)).length
  const wUnits = wScoped.filter(m => !wArchivedEff(m)).reduce((s, m) => s + wTotal(m), 0)
  const wTabCount = wMeds.filter(m => !wArchivedEff(m)).length

  const WhStockCell = ({ m }: { m: WhMed }) => {
    const total = wTotal(m)
    const color = total === 0 ? '#dc2626' : total <= 10 ? '#d97706' : t.txt
    if ((m.boxes ?? 0) > 0) {
      return (
        <div style={{ textAlign: 'right', lineHeight: 1.4 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color }}>{m.boxes} boxes</div>
          {(m.partial_pcs ?? 0) > 0 && <div style={{ fontSize: 10, color: '#e07a30' }}>+{m.partial_pcs} loose</div>}
          <div style={{ fontSize: 10, color: t.txt2 }}>{total} total</div>
        </div>
      )
    }
    return <span style={{ fontWeight: 800, fontSize: 14, color }}>{total}</span>
  }

  const CatTag = ({ m }: { m: WhMed }) => (
    <span style={{
      fontSize: 9.5, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase',
      padding: '1px 6px', borderRadius: 5,
      color: wCatOf(m) === 'supply' ? '#0d9488' : '#1a7a1a',
      background: wCatOf(m) === 'supply' ? 'rgba(13,148,136,0.12)' : 'rgba(26,122,26,0.12)',
    }}>{wCatOf(m)}</span>
  )

  const wColumns: Column<WhMed>[] = [
    { key: 'no', header: '#', width: 44, cell: (_m, i) => <span style={{ color: t.txt2, fontWeight: 700 }}>{i + 1}</span> },
    { key: 'name', header: 'Medicine', cell: m => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700, color: t.txt }}>{m.med_name || '—'}</span>
        {wCat === 'all' && <CatTag m={m} />}
      </div>
    ) },
    { key: 'dose', header: 'Dosage / Spec', cell: m => <span style={{ fontSize: 11.5, color: t.txt2 }}>{m.med_dosage || '—'}</span> },
    { key: 'type', header: 'Type', cell: m => <span style={{ fontSize: 11.5, color: t.txt2 }}>{m.med_type || '—'}</span> },
    { key: 'qty', header: 'Stock', align: 'right', cell: m => <WhStockCell m={m} /> },
    { key: 'unit', header: 'Unit', cell: m => <span style={{ fontSize: 11.5, color: t.txt2 }}>{m.unit || '—'}</span> },
    { key: 'exp', header: 'Expiry', cell: m => <Pill tone={wTone(m)}>{m.exp_date || '—'}</Pill> },
  ]

  const wData = () => ({
    headers: ['No.', 'Medicine', 'Category', 'Dosage/Spec', 'Type', 'Boxes', 'Loose', 'Total', 'Unit', 'Expiry', 'State'],
    body: wRows.map((m, i) => [
      i + 1, m.med_name, wCatOf(m), m.med_dosage, m.med_type,
      m.boxes ?? 0, m.partial_pcs ?? 0, wTotal(m), m.unit, m.exp_date,
      wArchivedEff(m) ? (wExpired(m) ? 'Expired' : 'Archived') : 'Active',
    ]),
  })

  /* ── Export: CSV / Excel / PDF (shared) ─────────────────────────────────── */
  const exportAs = (format: 'csv' | 'excel' | 'pdf', filename: string, title: string, headers: string[], body: any[][]) => {
    if (format === 'csv') { downloadCSV(`${filename}.csv`, headers, body); return }
    if (format === 'excel') {
      const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const html =
        `<table border="1"><thead><tr style="background:#1a7a1a;color:#fff">${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>` +
        `<tbody>${body.map(row => `<tr>${row.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      const blob = new Blob([`\uFEFF<html><head><meta charset="utf-8"></head><body>${html}</body></html>`], { type: 'application/vnd.ms-excel' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${filename}.xls`; a.click()
      URL.revokeObjectURL(url)
      return
    }
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
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
      <h1>${title} — SmartRHU</h1>
      <div class="meta">RHU Lopez, Quezon &nbsp;|&nbsp; Records: <b>${body.length}</b> &nbsp;|&nbsp; Generated: ${new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
      <table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${body.map(row => `<tr>${row.map(c => `<td>${c ?? '—'}</td>`).join('')}</tr>`).join('')}</tbody></table>
      </body></html>`)
    w.document.close()
    setTimeout(() => w.print(), 500)
  }

  const pMenu = [
    { label: 'CSV',   onClick: () => { const d = pData(); exportAs('csv',   'pharmacy-inventory', 'Pharmacy Inventory', d.headers, d.body) } },
    { label: 'Excel', onClick: () => { const d = pData(); exportAs('excel', 'pharmacy-inventory', 'Pharmacy Inventory', d.headers, d.body) } },
    { label: 'PDF',   onClick: () => { const d = pData(); exportAs('pdf',   'pharmacy-inventory', 'Pharmacy Inventory', d.headers, d.body) } },
  ]
  const wMenu = [
    { label: 'CSV',   onClick: () => { const d = wData(); exportAs('csv',   'warehouse-inventory', 'Warehouse Inventory', d.headers, d.body) } },
    { label: 'Excel', onClick: () => { const d = wData(); exportAs('excel', 'warehouse-inventory', 'Warehouse Inventory', d.headers, d.body) } },
    { label: 'PDF',   onClick: () => { const d = wData(); exportAs('pdf',   'warehouse-inventory', 'Warehouse Inventory', d.headers, d.body) } },
  ]

  /* ── Tab button ──────────────────────────────────────────────────────────*/
  const TabBtn = ({ id, label, Icon, count }: { id: TabId; label: string; Icon: React.ElementType; count: number }) => {
    const on = tab === id
    return (
      <button onClick={() => setTab(id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, padding: '9px 16px', borderRadius: 12, cursor: 'pointer',
          border: `1.5px solid ${on ? '#1a7a1a' : t.bdr}`,
          background: on ? 'linear-gradient(135deg,#1a7a1a,#0d9488)' : t.card,
          color: on ? '#fff' : t.txt, fontSize: 13, fontWeight: 800, transition: 'all .15s',
          boxShadow: on ? '0 6px 16px rgba(26,122,26,0.28)' : 'none',
        }}>
        <Icon size={16} strokeWidth={2.4} />
        {label}
        <span style={{
          fontSize: 11, fontWeight: 800, lineHeight: 1, padding: '3px 7px', borderRadius: 999,
          background: on ? 'rgba(255,255,255,0.22)' : t.bg2, color: on ? '#fff' : t.txt2,
        }}>{count}</span>
      </button>
    )
  }

  const subtitle = tab === 'pharmacy'
    ? `${pSource && pSource !== 'pharma_medicines' ? ` · source: ${pSource}` : ''}`
    : ''

  return (
    <RecordPage t={t} title="MEDICINE INVENTORY" subtitle={subtitle}
      onRefresh={tab === 'pharmacy' ? loadPharmacy : loadWarehouse} fit>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
        <TabBtn id="pharmacy" label="Pharmacy" Icon={RxIcon} count={pItems.length} />
        <TabBtn id="warehouse" label="Warehouse" Icon={WhIcon} count={wTabCount} />
      </div>

      {tab === 'pharmacy' ? (
        <>
          <div style={{ flexShrink: 0 }}>
            <StatStrip t={t} items={[
              { label: 'Total Items', value: pItems.length, color: '#1a7a1a', active: pFilter === 'all', onClick: () => setPFilter('all') },
              { label: 'Out of Stock', value: pOut, color: '#dc2626', active: pFilter === 'out', alert: pOut > 0, onClick: () => setPFilter('out') },
              { label: 'Low Stock', value: pLow, color: '#d97706', active: pFilter === 'low', alert: pLow > 0, onClick: () => setPFilter('low') },
              { label: 'Expiring Soon', value: pExpSoon, color: '#7c3aed', active: pFilter === 'expiring', onClick: () => setPFilter('expiring') },
              { label: 'Expired', value: pExpired2, color: '#64748b', alert: pExpired2 > 0 },
            ]} />
          </div>

          <div style={{ flexShrink: 0 }}>
            <Toolbar t={t}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <SearchInput t={t} value={pSearch} onChange={setPSearch} placeholder="Search medicine, dosage, type…" />
                <ExportMenu t={t} items={pMenu} />
              </div>
              <Segmented t={t} value={pFilter} onChange={setPFilter} options={[
                { value: 'all', label: 'All' }, { value: 'low', label: 'Low' }, { value: 'out', label: 'Out' }, { value: 'expiring', label: 'Expiring' },
              ]} />
            </Toolbar>
          </div>

          <DataView t={t} columns={pColumns} rows={pRows} loading={pLoading}
            keyOf={i => i.id} resetKey={`p|${pSearch}|${pFilter}`}
            emptyText="No medicines match your filters." onRowClick={setPView} fill />
        </>
      ) : (
        <>
          <div style={{ flexShrink: 0 }}>
            <StatStrip t={t} items={[
              { label: 'Active Items', value: wActive, color: '#1a7a1a', active: wFilter === 'active', onClick: () => setWFilter('active') },
              { label: 'Total Units', value: wUnits, color: '#0d9488' },
              { label: 'Expiring Soon', value: wExpSoon, color: '#d97706', active: wFilter === 'expiring', alert: wExpSoon > 0, onClick: () => setWFilter('expiring') },
              { label: 'Expired', value: wExpired2, color: '#dc2626', alert: wExpired2 > 0, active: wFilter === 'expiring', onClick: () => setWFilter('expiring') },
              { label: 'Archived', value: wArchived, color: '#64748b', active: wFilter === 'archived', onClick: () => setWFilter('archived') },
            ]} />
          </div>

          <div style={{ flexShrink: 0 }}>
            <Toolbar t={t}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <SearchInput t={t} value={wSearch} onChange={setWSearch} placeholder="Search medicine, dosage, type…" />
                <ExportMenu t={t} items={wMenu} />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Segmented t={t} value={wCat} onChange={setWCat} options={[
                  { value: 'all', label: 'All' }, { value: 'drug', label: 'Drugs' }, { value: 'supply', label: 'Supplies' },
                ]} />
                <Segmented t={t} value={wFilter} onChange={setWFilter} options={[
                  { value: 'active', label: 'Active' }, { value: 'expiring', label: 'Expiring' }, { value: 'archived', label: 'Archived' },
                ]} />
              </div>
            </Toolbar>
          </div>

          <DataView t={t} columns={wColumns} rows={wRows} loading={wLoading}
            keyOf={m => m.id} resetKey={`w|${wCat}|${wSearch}|${wFilter}`}
            emptyText="No warehouse medicines match your filters." onRowClick={setWView} fill />
        </>
      )}

      {/* ── Pharmacy detail drawer ── */}
      <Drawer t={t} open={!!pView} onClose={() => setPView(null)}
        title={pView ? pName(pView) : ''} subtitle={pView ? `${pDose(pView)} · ${pType(pView)}` : ''}
        accent={pView ? (pStock(pView).tone === 'red' ? '#dc2626' : pStock(pView).tone === 'amber' ? '#d97706' : '#1a7a1a') : '#1a7a1a'}>
        {pView && (
          <>
            <div style={{ marginBottom: 14, display: 'flex', gap: 8 }}>
              <Pill tone={pStock(pView).tone}>{pStock(pView).label}</Pill>
              {pExpired(pView) ? <Pill tone="red">Expired</Pill> : pExpiringSoon(pView) ? <Pill tone="amber">Expiring soon</Pill> : null}
            </div>
            <Section t={t} title="Stock">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field t={t} label="Quantity" value={pQty(pView)} />
                <Field t={t} label="Unit" value={pView.unit} />
                <Field t={t} label="Reorder level" value={pReorder(pView)} />
                <Field t={t} label="Expiry" value={pExpiry(pView) || '—'} />
              </div>
            </Section>
            <Section t={t} title="Details">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field t={t} label="Name" value={pName(pView)} />
                <Field t={t} label="Brand" value={pView.brand_name} />
                <Field t={t} label="Dosage" value={pDose(pView)} />
                <Field t={t} label="Type" value={pType(pView)} />
              </div>
            </Section>
          </>
        )}
      </Drawer>

      {/* ── Warehouse detail drawer ── */}
      <Drawer t={t} open={!!wView} onClose={() => setWView(null)}
        title={wView?.med_name || ''} subtitle={wView ? `${wView.med_dosage} · ${wView.med_type}` : ''}
        accent={wView ? (wTone(wView) === 'red' ? '#dc2626' : wTone(wView) === 'amber' ? '#d97706' : '#1a7a1a') : '#1a7a1a'}>
        {wView && (
          <>
            <div style={{ marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Pill tone={wTone(wView)}>{wExpLabel(wView)}</Pill>
              {wArchivedEff(wView) && <Pill tone="gray">Archived</Pill>}
            </div>
            <Section t={t} title="Stock">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field t={t} label="Boxes" value={wView.boxes ?? 0} />
                <Field t={t} label="Loose pcs" value={wView.partial_pcs ?? 0} />
                <Field t={t} label="Total" value={wTotal(wView)} />
                <Field t={t} label="Unit" value={wView.unit} />
                <Field t={t} label="Expiry date" value={wView.exp_date} />
                <Field t={t} label="Added" value={wView.created_at ? new Date(wView.created_at).toLocaleDateString('en-PH') : '—'} />
              </div>
            </Section>
            <Section t={t} title="Details">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field t={t} label="Medicine" value={wView.med_name} />
                <Field t={t} label="Category" value={wCatOf(wView) === 'supply' ? 'Supply' : 'Drug'} />
                <Field t={t} label="Dosage / Spec" value={wView.med_dosage} />
                <Field t={t} label="Type" value={wView.med_type} />
              </div>
            </Section>
            {wView.description && (
              <Section t={t} title="Notes">
                <div style={{ fontSize: 12.5, color: t.txt2, lineHeight: 1.5 }}>{wView.description}</div>
              </Section>
            )}
          </>
        )}
      </Drawer>
    </RecordPage>
  )
}