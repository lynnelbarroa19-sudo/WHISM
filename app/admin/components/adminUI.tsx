'use client'
/* ───────────────────────────────────────────────────────────────────────────
   adminUI.tsx — Shared, view-only design system for the SmartRHU Admin panel.
   Every admin record screen (Patient / Lab / Inventory / Warehouse) is built
   from these primitives so the whole panel looks and behaves consistently.

   Nothing here touches your database or routing — it is pure presentation.
   ─────────────────────────────────────────────────────────────────────────── */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Search, Inbox, X, ChevronLeft, ChevronRight } from 'lucide-react'

/* ── Theme tokens ──────────────────────────────────────────────────────────*/
export function useAdmin(dark: boolean) {
  return useMemo(() => ({
    dark,
    pageBg:    dark ? '#061a0d' : '#f0f7f2',
    card:      dark ? '#0d2516' : '#ffffff',
    cardAlt:   dark ? '#0f2e1a' : '#f6faf7',
    bdr:       dark ? 'rgba(74,222,128,0.1)' : 'rgba(22,163,74,0.15)',
    txt:       dark ? '#e2f5e9' : '#0a2912',
    txt2:      dark ? '#9abea6' : '#4b6557',
    txt3:      dark ? '#4b6557' : '#9ca3af',
    brand:     dark ? '#4ade80' : '#16a34a',
    brandRaw:  '#16a34a',
    greenDark: '#0d3b1f',
    greenMid:  '#166534',
    mint:      '#4ade80',
    surface:   dark ? 'rgba(74,222,128,0.10)' : '#dcfce7',
    grad:      'linear-gradient(135deg,#16a34a,#4ade80)',
    gradDark:  'linear-gradient(135deg,#0d3b1f,#166534)',
    shadow:    dark ? '0 2px 16px rgba(0,0,0,0.4)' : '0 2px 16px rgba(13,59,31,0.08)',
    radius:    14,
    radiusSm:  8,
  }), [dark])
}
export type Tokens = ReturnType<typeof useAdmin>

/* ── Responsive hook ───────────────────────────────────────────────────────*/
export function useIsMobile(bp = 820) {
  const [m, setM] = useState(false)
  useEffect(() => {
    const f = () => setM(window.innerWidth < bp)
    f(); window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [bp])
  return m
}

/* ── Status pill ───────────────────────────────────────────────────────────*/
export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'violet'
const TONES: Record<Tone, { bg: string; fg: string; bd: string }> = {
  green:  { bg: '#dcfce7', fg: '#15803d', bd: '#86efac' },
  amber:  { bg: '#fef3c7', fg: '#b45309', bd: '#fcd34d' },
  red:    { bg: '#fee2e2', fg: '#dc2626', bd: '#fca5a5' },
  blue:   { bg: '#dbeafe', fg: '#1d4ed8', bd: '#93c5fd' },
  gray:   { bg: '#eef2f0', fg: '#64748b', bd: '#d1d9d3' },
  violet: { bg: '#ede9fe', fg: '#6d28d9', bd: '#c4b5fd' },
}
export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const t = TONES[tone]
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 99, fontSize: 10.5, fontWeight: 800,
      background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, whiteSpace: 'nowrap',
      display: 'inline-block',
    }}>{children}</span>
  )
}

/* ── Page shell: title + read-only badge + refresh ─────────────────────────*/
export function RecordPage({
  t, title, subtitle, onRefresh, fit, children,
}: {
  t: Tokens; title: string; subtitle: string
  onRefresh?: () => void; fit?: boolean; children: React.ReactNode
}) {
  const mobile = useIsMobile()
  const fitMode = !!fit && !useIsMobile(1024)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, ...(fitMode ? { height: '100%', overflow: 'hidden' } : {}) }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', gap: 12,
        alignItems: mobile ? 'flex-start' : 'flex-end', flexDirection: mobile ? 'column' : 'row',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: mobile ? 28 : 28, fontWeight: 1000, color: 'darkgreen', letterSpacing: -0.3 }}>{title}</h2>
            
          </div>
          <p style={{ margin: '5px 0 0', fontSize: 12, color: t.txt2 }}>{subtitle}</p>
        </div>
        {onRefresh && (
          <button onClick={onRefresh}
            style={{
              background: t.card, border: `1.5px solid ${t.bdr}`, borderRadius: 11, padding: '8px 15px',
              display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', color: t.txt2,
              fontSize: 13, fontWeight: 700,
            }}>
            <RefreshCw size={14} /> Refresh
          </button>
        )}
      </div>
      {children}
      <style>{`@keyframes arspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

/* ── Stat strip (clickable summary cards) ──────────────────────────────────*/
export type Stat = { label: string; value: React.ReactNode; color: string; active?: boolean; alert?: boolean; onClick?: () => void }
export function StatStrip({ t, items }: { t: Tokens; items: Stat[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 11 }}>
      {items.map(s => (
        <div key={s.label} onClick={s.onClick}
          style={{
            background: s.active ? `${s.color}14` : t.card,
            border: `1.5px solid ${s.active ? s.color : t.bdr}`,
            borderRadius: 14, padding: 0, overflow: 'hidden',
            cursor: s.onClick ? 'pointer' : 'default', transition: 'border-color .15s, transform .15s',
            boxShadow: t.shadow,
          }}
          onMouseEnter={e => { if (s.onClick) (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)' }}
          onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'}>
          <div style={{ height: 3, background: s.color }} />
          <div style={{ padding: '12px 15px', display: 'flex', alignItems: 'center', gap: 11 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.color, flexShrink: 0, boxShadow: s.alert ? `0 0 0 4px ${s.color}22` : 'none' }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: t.txt, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 11, color: s.alert ? s.color : t.txt2, marginTop: 3, fontWeight: s.alert ? 800 : 600 }}>{s.label}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Distribution bars — the analytic "signature" element ──────────────────*/
export function DistBars({ t, title, subtitle, items }: {
  t: Tokens; title: string; subtitle?: string
  items: { label: string; value: number; color: string }[]
}) {
  const max = Math.max(1, ...items.map(i => i.value))
  const total = items.reduce((s, i) => s + i.value, 0)
  return (
    <div style={{ background: t.card, border: `1.5px solid ${t.bdr}`, borderRadius: 16, padding: 18, boxShadow: t.shadow }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: t.txt }}>{title}</div>
      {subtitle && <div style={{ fontSize: 11, color: t.txt3, margin: '2px 0 14px' }}>{subtitle}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        {items.map(it => (
          <div key={it.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: t.txt, marginBottom: 4 }}>
              <span>{it.label}</span>
              <span style={{ color: it.color, fontWeight: 900 }}>
                {it.value}{total ? <span style={{ color: t.txt3, fontWeight: 600 }}> · {Math.round((it.value / total) * 100)}%</span> : null}
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 8, background: t.dark ? 'rgba(255,255,255,0.06)' : '#eef4ef', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(it.value / max) * 100}%`, background: it.color, borderRadius: 8, transition: 'width .5s' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Toolbar: search + segmented filters ───────────────────────────────────*/
export function SearchInput({ t, value, onChange, placeholder }: {
  t: Tokens; value: string; onChange: (v: string) => void; placeholder: string
}) {
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
      <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: t.txt2 }} />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '9px 34px', borderRadius: 11,
          border: `1.5px solid ${t.bdr}`, fontSize: 12.5, outline: 'none', color: t.txt, background: t.pageBg,
        }}
        onFocus={e => (e.currentTarget.style.borderColor = t.brandRaw)}
        onBlur={e => (e.currentTarget.style.borderColor = t.bdr)} />
      {value && (
        <button onClick={() => onChange('')} aria-label="Clear search"
          style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: t.txt2, display: 'flex', padding: 0 }}>
          <X size={14} />
        </button>
      )}
    </div>
  )
}

export function Segmented<T extends string>({ t, value, onChange, options }: {
  t: Tokens; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]
}) {
  return (
    <div style={{ display: 'flex', gap: 3, background: t.pageBg, borderRadius: 99, padding: 3, border: `1px solid ${t.bdr}`, width: 'fit-content', flexWrap: 'wrap' }}>
      {options.map(o => {
        const on = value === o.value
        return (
          <button key={o.value} onClick={() => onChange(o.value)}
            style={{
              padding: '6px 15px', borderRadius: 99, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer',
              background: on ? t.grad : 'transparent', color: on ? '#fff' : t.txt2,
              boxShadow: on ? `0 2px 8px ${t.brandRaw}55` : 'none', transition: 'all .15s',
            }}>{o.label}</button>
        )
      })}
    </div>
  )
}

export function Toolbar({ t, children }: { t: Tokens; children: React.ReactNode }) {
  return (
    <div style={{ background: t.card, borderRadius: 16, padding: '13px 16px', border: `1.5px solid ${t.bdr}`, display: 'flex', flexDirection: 'column', gap: 11, boxShadow: t.shadow }}>
      {children}
    </div>
  )
}

/* ── Responsive data view: table (desktop) ↔ cards (mobile) + pagination ───*/
export type Column<T> = {
  key: string
  header: string
  align?: 'left' | 'right' | 'center'
  width?: number
  cell: (row: T, index: number) => React.ReactNode
}
export function DataView<T>({
  t, columns, rows, loading, keyOf, perPage = 10, resetKey, emptyText = 'No records found.', onRowClick, renderCard, fill,
}: {
  t: Tokens
  columns: Column<T>[]
  rows: T[]
  loading: boolean
  keyOf: (row: T, i: number) => string
  perPage?: number
  resetKey?: string
  emptyText?: string
  onRowClick?: (row: T) => void
  renderCard?: (row: T, index: number) => React.ReactNode
  fill?: boolean
}) {
  const mobile = useIsMobile()
  const fillMode = !!fill && !useIsMobile(1024)
  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [resetKey])
  const totalPages = Math.max(1, Math.ceil(rows.length / perPage))
  const pageRows = rows.slice((page - 1) * perPage, page * perPage)

  const Loader = (
    <div style={{ textAlign: 'center', padding: 48, color: t.txt2 }}>
      <div style={{ width: 28, height: 28, border: `3px solid ${t.brandRaw}`, borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto 10px', animation: 'arspin .8s linear infinite' }} />
      Loading…
    </div>
  )
  const Empty = (
    <div style={{ textAlign: 'center', padding: 48, color: t.txt2, fontSize: 13 }}>
      <Inbox size={38} color={t.bdr} style={{ display: 'block', margin: '0 auto 10px' }} />
      {emptyText}
    </div>
  )

  return (
    <div style={{ background: t.card, border: `1.5px solid ${t.bdr}`, borderRadius: 16, overflow: 'hidden', boxShadow: t.shadow,
      ...(fillMode ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : {}) }}>
      <style>{`
        .admin-thin-scroll{ scrollbar-width: thin; scrollbar-color: ${t.brandRaw}55 transparent; }
        .admin-thin-scroll::-webkit-scrollbar{ width:7px; height:7px; }
        .admin-thin-scroll::-webkit-scrollbar-track{ background: transparent; }
        .admin-thin-scroll::-webkit-scrollbar-thumb{ background: ${t.brandRaw}55; border-radius: 8px; }
        .admin-thin-scroll:hover::-webkit-scrollbar-thumb{ background: ${t.brandRaw}88; }
      `}</style>
      {loading ? Loader : rows.length === 0 ? Empty : mobile ? (
        <div className={fillMode ? 'admin-thin-scroll' : undefined} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, ...(fillMode ? { flex: 1, minHeight: 0, overflowY: 'auto' } : {}) }}>
          {pageRows.map((r, i) => (
            <div key={keyOf(r, i)} onClick={() => onRowClick?.(r)}
              style={{ background: t.cardAlt, border: `1px solid ${t.bdr}`, borderRadius: 13, padding: '13px 15px', cursor: onRowClick ? 'pointer' : 'default' }}>
              {renderCard ? renderCard(r, (page - 1) * perPage + i) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {columns.map(c => (
                    <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5 }}>
                      <span style={{ color: t.txt2, fontWeight: 600 }}>{c.header}</span>
                      <span style={{ color: t.txt, textAlign: 'right' }}>{c.cell(r, (page - 1) * perPage + i)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className={fillMode ? 'admin-thin-scroll' : undefined} style={{ overflowX: 'auto', ...(fillMode ? { flex: 1, minHeight: 0, overflowY: 'auto' } : {}) }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: t.pageBg, borderBottom: `2px solid ${t.bdr}`, ...(fillMode ? { position: 'sticky', top: 0, zIndex: 1 } : {}) }}>
                {columns.map(c => (
                  <th key={c.key} style={{
                    padding: '12px 14px', textAlign: c.align || 'left', fontWeight: 800, color: t.brand,
                    fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.7, whiteSpace: 'nowrap', width: c.width,
                  }}>{c.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, i) => (
                <tr key={keyOf(r, i)} onClick={() => onRowClick?.(r)}
                  style={{ borderBottom: `1px solid ${t.bdr}`, cursor: onRowClick ? 'pointer' : 'default', transition: 'background .1s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = t.dark ? 'rgba(74,222,128,0.05)' : 'rgba(26,122,26,0.03)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  {columns.map(c => (
                    <td key={c.key} style={{ padding: '11px 14px', textAlign: c.align || 'left', color: t.txt, verticalAlign: 'middle' }}>
                      {c.cell(r, (page - 1) * perPage + i)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!loading && rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: `1px solid ${t.bdr}`, background: t.pageBg, flexWrap: 'wrap', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: t.txt2, fontWeight: 600 }}>
            Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, rows.length)} of {rows.length}
          </span>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
            <PageBtn t={t} disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}><ChevronLeft size={14} /></PageBtn>
            {pageWindow(page, totalPages).map((p, i) =>
              p === '…'
                ? <span key={`e${i}`} style={{ padding: '0 4px', color: t.txt2, fontSize: 12 }}>…</span>
                : <button key={p} onClick={() => setPage(p as number)}
                    style={{ padding: '5px 11px', borderRadius: 9, fontSize: 12, fontWeight: 800, border: 'none', cursor: 'pointer', background: page === p ? t.grad : 'transparent', color: page === p ? '#fff' : t.txt2 }}>{p}</button>
            )}
            <PageBtn t={t} disabled={page === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}><ChevronRight size={14} /></PageBtn>
          </div>
        </div>
      )}
    </div>
  )
}
function PageBtn({ t, disabled, onClick, children }: { t: Tokens; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ padding: '5px 10px', borderRadius: 9, border: `1.5px solid ${t.bdr}`, background: t.card, color: disabled ? t.txt3 : t.brand, cursor: disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center' }}>
      {children}
    </button>
  )
}
function pageWindow(page: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const out: (number | '…')[] = [1]
  if (page > 4) out.push('…')
  for (let i = Math.max(2, page - 1); i <= Math.min(total - 1, page + 1); i++) out.push(i)
  if (page < total - 3) out.push('…')
  out.push(total)
  return out
}

/* ── Detail drawer (read-only) — right sheet on desktop, bottom on mobile ──*/
export function Drawer({ t, open, onClose, title, subtitle, accent = t.brandRaw, children }: {
  t: Tokens; open: boolean; onClose: () => void
  title: string; subtitle?: string; accent?: string; children: React.ReactNode
}) {
  const mobile = useIsMobile()
  if (!open) return null
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', justifyContent: mobile ? 'center' : 'flex-end', alignItems: mobile ? 'flex-end' : 'stretch' }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: t.card, width: mobile ? '100%' : 440, maxWidth: '100%',
          height: mobile ? 'auto' : '100%', maxHeight: mobile ? '88vh' : '100%',
          borderRadius: mobile ? '20px 20px 0 0' : 0, display: 'flex', flexDirection: 'column',
          boxShadow: '-12px 0 40px rgba(0,0,0,0.25)', overflow: 'hidden',
          animation: mobile ? 'arUp .25s ease' : 'arIn .25s ease',
        }}>
        <div style={{ background: `linear-gradient(135deg,${accent},${t.teal})`, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: '#fff', fontWeight: 900, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
            {subtitle && <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, background: t.pageBg }}>{children}</div>
      </div>
      <style>{`@keyframes arIn{from{transform:translateX(30px);opacity:.4}to{transform:none;opacity:1}}@keyframes arUp{from{transform:translateY(40px)}to{transform:none}}`}</style>
    </div>
  )
}

/* Field row + section for drawers */
export function Field({ t, label, value }: { t: Tokens; label: string; value: React.ReactNode }) {
  return (
    <div style={{ background: t.card, border: `1px solid ${t.bdr}`, borderRadius: 11, padding: '10px 13px' }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, color: t.txt2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: t.txt, wordBreak: 'break-word' }}>{value ?? '—'}</div>
    </div>
  )
}
export function Section({ t, title, children }: { t: Tokens; title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: t.txt2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 3, height: 12, background: t.brandRaw, borderRadius: 99 }} />{title}
      </div>
      {children}
    </div>
  )
}

/* CSV export helper (read-only reporting) */
export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const body = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n')
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
export function ExportBtn({ t, onClick, label = 'Export CSV' }: { t: Tokens; onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick}
      style={{ padding: '8px 14px', borderRadius: 11, fontSize: 12.5, fontWeight: 800, border: `1.5px solid ${t.bdr}`, background: t.card, color: t.brand, cursor: 'pointer' }}>
      {label}
    </button>
  )
}

// Single "Export" button with a dropdown (CSV / Excel / PDF, etc.)
export function ExportMenu({ t, items, label = 'Export' }: {
  t: Tokens; label?: string; items: { label: string; onClick: () => void }[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 11, fontSize: 12.5, fontWeight: 800, border: `1.5px solid ${open ? t.brandRaw : t.bdr}`, background: t.card, color: t.brand, cursor: 'pointer' }}>
        {label}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 60, background: t.card, border: `1.5px solid ${t.bdr}`, borderRadius: 12, boxShadow: t.shadow, overflow: 'hidden', minWidth: 150 }}>
          {items.map((it, i) => (
            <button key={i} onClick={() => { setOpen(false); it.onClick() }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', fontSize: 12.5, fontWeight: 700, color: t.txt, background: 'transparent', border: 'none', cursor: 'pointer', borderBottom: i < items.length - 1 ? `1px solid ${t.bdr}` : 'none' }}
              onMouseEnter={e => (e.currentTarget.style.background = t.pageBg)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}