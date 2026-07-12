'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  useAdmin, useIsMobile, RecordPage, StatStrip, Toolbar, SearchInput, Segmented,
  Pill, DistBars, DataView, Drawer, Field, Section, downloadCSV, ExportBtn, type Column, type Tone,
} from './adminUI'

interface Med {
  id: string
  med_name: string; med_dosage: string; med_type: string
  exp_date: string; quantity: number; unit: string
  archived?: boolean; created_at?: string
}

export default function WarehouseRecords({ darkMode }: { darkMode: boolean }) {
  const t = useAdmin(darkMode)
  const mobile = useIsMobile()

  const [meds, setMeds] = useState<Med[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'active' | 'archived' | 'expiring'>('active')
  const [view, setView] = useState<Med | null>(null)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('warehouse_medicines').select('*').order('created_at', { ascending: false })
    setMeds((data as Med[]) || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const isExpired = (m: Med) => !!m.exp_date && new Date(m.exp_date) < new Date()
  const isExpiringSoon = (m: Med) => { if (!m.exp_date) return false; const d = (new Date(m.exp_date).getTime() - Date.now()) / 86400000; return d >= 0 && d <= 90 }
  const expTone = (m: Med): Tone => isExpired(m) ? 'red' : isExpiringSoon(m) ? 'amber' : 'green'
  const expLabel = (m: Med) => isExpired(m) ? 'Expired' : isExpiringSoon(m) ? 'Expiring soon' : 'Valid'

  const rows = useMemo(() => meds.filter(m => {
    if (filter === 'active' && m.archived) return false
    if (filter === 'archived' && !m.archived) return false
    if (filter === 'expiring' && !isExpiringSoon(m) && !isExpired(m)) return false
    if (search && !`${m.med_name} ${m.med_dosage} ${m.med_type}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [meds, filter, search])

  const active = meds.filter(m => !m.archived).length
  const archived = meds.filter(m => m.archived).length
  const expSoon = meds.filter(m => isExpiringSoon(m)).length
  const expired = meds.filter(m => isExpired(m)).length
  const totalUnits = meds.filter(m => !m.archived).reduce((s, m) => s + Number(m.quantity || 0), 0)

  const columns: Column<Med>[] = [
    { key: 'no', header: '#', width: 44, cell: (_m, i) => <span style={{ color: t.txt2, fontWeight: 700 }}>{i + 1}</span> },
    { key: 'name', header: 'Medicine', cell: m => <span style={{ fontWeight: 700, color: t.txt }}>{m.med_name || '—'}</span> },
    { key: 'dose', header: 'Dosage', cell: m => <span style={{ fontSize: 11.5, color: t.txt2 }}>{m.med_dosage || '—'}</span> },
    { key: 'type', header: 'Type', cell: m => <span style={{ fontSize: 11.5, color: t.txt2 }}>{m.med_type || '—'}</span> },
    { key: 'qty', header: 'Stock', align: 'right', cell: m => <span style={{ fontWeight: 800, fontSize: 14, color: t.txt }}>{m.quantity ?? 0}</span> },
    { key: 'unit', header: 'Unit', cell: m => <span style={{ fontSize: 11.5, color: t.txt2 }}>{m.unit || '—'}</span> },
    { key: 'exp', header: 'Expiry', cell: m => <Pill tone={expTone(m)}>{m.exp_date || '—'}</Pill> },
  ]

  const exportCsv = () => downloadCSV(
    'warehouse-records.csv',
    ['No.', 'Medicine', 'Dosage', 'Type', 'Stock', 'Unit', 'Expiry', 'State'],
    rows.map((m, i) => [i + 1, m.med_name, m.med_dosage, m.med_type, m.quantity, m.unit, m.exp_date, m.archived ? 'Archived' : 'Active']),
  )

  return (
    <RecordPage t={t} title="Warehouse Records" subtitle="Read-only view of warehouse medicine stock" onRefresh={load}>
      <StatStrip t={t} items={[
        { label: 'Active Items', value: active, color: '#1a7a1a' },
        { label: 'Total Units', value: totalUnits, color: '#0d9488' },
        { label: 'Expiring Soon', value: expSoon, color: '#d97706', alert: expSoon > 0 },
        { label: 'Expired', value: expired, color: '#dc2626', alert: expired > 0 },
        { label: 'Archived', value: archived, color: '#64748b' },
      ]} />

      {!mobile && (
        <DistBars t={t} title="Expiry health" subtitle="Active stock by expiry state" items={[
          { label: 'Valid', value: meds.filter(m => !m.archived && !isExpired(m) && !isExpiringSoon(m)).length, color: '#15803d' },
          { label: 'Expiring soon', value: expSoon, color: '#d97706' },
          { label: 'Expired', value: expired, color: '#dc2626' },
        ]} />
      )}

      <Toolbar t={t}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <SearchInput t={t} value={search} onChange={setSearch} placeholder="Search medicine, dosage, type…" />
          <ExportBtn t={t} onClick={exportCsv} />
        </div>
        <Segmented t={t} value={filter} onChange={setFilter} options={[
          { value: 'active', label: 'Active' }, { value: 'expiring', label: 'Expiring' }, { value: 'archived', label: 'Archived' },
        ]} />
      </Toolbar>

      <DataView t={t} columns={columns} rows={rows} loading={loading}
        keyOf={m => m.id} resetKey={`${search}|${filter}`}
        emptyText="No warehouse medicines match your filters." onRowClick={setView} />

      <Drawer t={t} open={!!view} onClose={() => setView(null)}
        title={view?.med_name || ''} subtitle={view ? `${view.med_dosage} · ${view.med_type}` : ''}
        accent={view ? (expTone(view) === 'red' ? '#dc2626' : expTone(view) === 'amber' ? '#d97706' : '#1a7a1a') : '#1a7a1a'}>
        {view && (
          <>
            <div style={{ marginBottom: 14, display: 'flex', gap: 8 }}>
              <Pill tone={expTone(view)}>{expLabel(view)}</Pill>
              {view.archived && <Pill tone="gray">Archived</Pill>}
            </div>
            <Section t={t} title="Stock">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field t={t} label="Quantity" value={view.quantity} />
                <Field t={t} label="Unit" value={view.unit} />
                <Field t={t} label="Expiry date" value={view.exp_date} />
                <Field t={t} label="Added" value={view.created_at ? new Date(view.created_at).toLocaleDateString('en-PH') : '—'} />
              </div>
            </Section>
            <Section t={t} title="Details">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field t={t} label="Medicine" value={view.med_name} />
                <Field t={t} label="Dosage" value={view.med_dosage} />
                <Field t={t} label="Type" value={view.med_type} />
              </div>
            </Section>
          </>
        )}
      </Drawer>
    </RecordPage>
  )
}