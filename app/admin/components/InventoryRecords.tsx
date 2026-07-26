'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  useAdmin, useIsMobile, RecordPage, StatStrip, Toolbar, SearchInput, Segmented,
  Pill, DistBars, DataView, Drawer, Field, Section, downloadCSV, ExportBtn, type Column, type Tone,
} from './adminUI'

interface Item {
  id: string
  med_name?: string; medicine_name?: string; generic_name?: string; brand_name?: string
  med_dosage?: string; med_type?: string; category?: string
  quantity?: number; unit?: string; exp_date?: string; expiry_date?: string
  reorder_level?: number; created_at?: string
}

export default function InventoryRecords({ darkMode }: { darkMode: boolean }) {
  const t = useAdmin(darkMode)
  const mobile = useIsMobile()

  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'low' | 'out' | 'expiring'>('all')
  const [view, setView] = useState<Item | null>(null)

  // Same fallback chain as your original: pharma → warehouse → inventory → medicine_inventory
  const load = async () => {
    setLoading(true)
    const tries: [string, any][] = [
      ['pharma_medicines', supabase.from('pharma_medicines').select('*').eq('archived', false).order('created_at', { ascending: false })],
      ['warehouse_medicines', supabase.from('warehouse_medicines').select('*').eq('archived', false).order('created_at', { ascending: false })],
      ['inventory', supabase.from('inventory').select('*').order('created_at', { ascending: false })],
      ['medicine_inventory', supabase.from('medicine_inventory').select('*').order('created_at', { ascending: false })],
    ]
    for (const [name, q] of tries) {
      const { data } = await q
      if (data && data.length > 0) { setItems(data); setSource(name); setLoading(false); return }
    }
    setItems([]); setSource('pharma_medicines'); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const name = (i: Item) => i.med_name || i.medicine_name || i.generic_name || '—'
  const dose = (i: Item) => i.med_dosage || '—'
  const type = (i: Item) => i.med_type || i.category || '—'
  const qty = (i: Item) => Number(i.quantity ?? 0)
  const reorder = (i: Item) => Number(i.reorder_level ?? 10)
  const expiry = (i: Item) => i.exp_date || i.expiry_date || ''
  const isExpired = (i: Item) => { const d = expiry(i); return !!d && new Date(d) < new Date() }
  const isExpiringSoon = (i: Item) => { const d = expiry(i); if (!d) return false; const diff = (new Date(d).getTime() - Date.now()) / 86400000; return diff >= 0 && diff <= 90 }
  const stock = (i: Item): { label: string; tone: Tone } =>
    qty(i) === 0 ? { label: 'Out of Stock', tone: 'red' }
    : qty(i) <= reorder(i) ? { label: 'Low Stock', tone: 'amber' }
    : { label: 'In Stock', tone: 'green' }

  const rows = useMemo(() => items.filter(i => {
    if (filter === 'low' && !(qty(i) > 0 && qty(i) <= reorder(i))) return false
    if (filter === 'out' && qty(i) !== 0) return false
    if (filter === 'expiring' && !isExpiringSoon(i)) return false
    if (search && !`${name(i)} ${dose(i)} ${type(i)}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [items, filter, search])

  const out = items.filter(i => qty(i) === 0).length
  const low = items.filter(i => qty(i) > 0 && qty(i) <= reorder(i)).length
  const expSoon = items.filter(i => isExpiringSoon(i) && !isExpired(i)).length
  const expired = items.filter(i => isExpired(i)).length
  const inStock = items.length - out - low

  const columns: Column<Item>[] = [
    { key: 'no', header: '#', width: 44, cell: (_i, idx) => <span style={{ color: t.txt2, fontWeight: 700 }}>{idx + 1}</span> },
    { key: 'name', header: 'Medicine', cell: i => (
      <div>
        <div style={{ fontWeight: 700, color: t.txt }}>{name(i)}</div>
        {i.brand_name && <div style={{ fontSize: 10, color: t.txt2, fontStyle: 'italic' }}>{i.brand_name}</div>}
      </div>
    ) },
    { key: 'dose', header: 'Dosage', cell: i => <span style={{ fontSize: 11.5, color: t.txt2 }}>{dose(i)}</span> },
    { key: 'type', header: 'Type', cell: i => <span style={{ fontSize: 11.5, color: t.txt2 }}>{type(i)}</span> },
    { key: 'qty', header: 'Qty', align: 'right', cell: i => (
      <span style={{ fontWeight: 800, fontSize: 14, color: qty(i) === 0 ? '#dc2626' : qty(i) <= reorder(i) ? '#d97706' : t.txt }}>{qty(i)}</span>
    ) },
    { key: 'unit', header: 'Unit', cell: i => <span style={{ fontSize: 11.5, color: t.txt2 }}>{i.unit || '—'}</span> },
    { key: 'exp', header: 'Expiry', cell: i => (
      <span style={{ fontSize: 11.5, fontWeight: 600, color: isExpired(i) ? '#dc2626' : isExpiringSoon(i) ? '#d97706' : t.txt2 }}>
        {expiry(i) || '—'}
      </span>
    ) },
    { key: 'stock', header: 'Status', cell: i => { const s = stock(i); return <Pill tone={s.tone}>{s.label}</Pill> } },
  ]

  const exportCsv = () => downloadCSV(
    'inventory-records.csv',
    ['No.', 'Medicine', 'Dosage', 'Type', 'Quantity', 'Unit', 'Expiry', 'Status'],
    rows.map((i, idx) => [idx + 1, name(i), dose(i), type(i), qty(i), i.unit || '', expiry(i), stock(i).label]),
  )

  return (
    <RecordPage t={t} title="Inventory Records" subtitle={`Read-only pharmacy stock${source ? ` · source: ${source}` : ''}`} onRefresh={load}>
      <StatStrip t={t} items={[
        { label: 'Total Items', value: items.length, color: '#1a7a1a', active: filter === 'all', onClick: () => setFilter('all') },
        { label: 'Out of Stock', value: out, color: '#dc2626', active: filter === 'out', alert: out > 0, onClick: () => setFilter('out') },
        { label: 'Low Stock', value: low, color: '#d97706', active: filter === 'low', alert: low > 0, onClick: () => setFilter('low') },
        { label: 'Expiring Soon', value: expSoon, color: '#7c3aed', active: filter === 'expiring', onClick: () => setFilter('expiring') },
        { label: 'Expired', value: expired, color: '#64748b', alert: expired > 0 },
      ]} />

      {!mobile && (
        <DistBars t={t} title="Stock health" subtitle="Distribution across all medicines" items={[
          { label: 'In stock', value: inStock, color: '#15803d' },
          { label: 'Low stock', value: low, color: '#d97706' },
          { label: 'Out of stock', value: out, color: '#dc2626' },
        ]} />
      )}

      <Toolbar t={t}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <SearchInput t={t} value={search} onChange={setSearch} placeholder="Search medicine, dosage, type…" />
          <ExportBtn t={t} onClick={exportCsv} />
        </div>
        <Segmented t={t} value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All' }, { value: 'low', label: 'Low' }, { value: 'out', label: 'Out' }, { value: 'expiring', label: 'Expiring' },
        ]} />
      </Toolbar>

      <DataView t={t} columns={columns} rows={rows} loading={loading}
        keyOf={i => i.id} resetKey={`${search}|${filter}`}
        emptyText="No medicines match your filters." onRowClick={setView} />

      <Drawer t={t} open={!!view} onClose={() => setView(null)}
        title={view ? name(view) : ''} subtitle={view ? `${dose(view)} · ${type(view)}` : ''}
        accent={view ? (stock(view).tone === 'red' ? '#dc2626' : stock(view).tone === 'amber' ? '#d97706' : '#1a7a1a') : '#1a7a1a'}>
        {view && (
          <>
            <div style={{ marginBottom: 14 }}><Pill tone={stock(view).tone}>{stock(view).label}</Pill></div>
            <Section t={t} title="Stock">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field t={t} label="Quantity" value={qty(view)} />
                <Field t={t} label="Unit" value={view.unit} />
                <Field t={t} label="Reorder level" value={reorder(view)} />
                <Field t={t} label="Expiry" value={expiry(view) || '—'} />
              </div>
            </Section>
            <Section t={t} title="Details">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field t={t} label="Name" value={name(view)} />
                <Field t={t} label="Brand" value={view.brand_name} />
                <Field t={t} label="Dosage" value={dose(view)} />
                <Field t={t} label="Type" value={type(view)} />
              </div>
            </Section>
          </>
        )}
      </Drawer>
    </RecordPage>
  )
}