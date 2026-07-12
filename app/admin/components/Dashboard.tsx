'use client'
import React, { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import {
  Users, FlaskConical, Package, Activity, Heart, Pill,
  ClipboardList, Stethoscope, Baby, Milestone, Brain, ChevronDown, Check,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

interface Props { darkMode: boolean; onNavigate: (menu: string) => void }

/* ── Green palette ─────────────────────────────────────────────────────────*/
const G = {
  darkest: '#0d3b1f', dark: '#166534', mid: '#16a34a', base: '#16a34a',
  light: '#16a34a', teal: '#16a34a', muted: '#4ade80', pale: '#dcfce7', ghost: '#dcfce7',
  surface: '#f6faf7', bg: '#f0f7f2', mint: '#4ade80',
}

const SCHEDULE: { day: string; consult: string; color: string; Icon: React.ElementType }[] = [
  { day: 'Monday',    consult: 'General Consultation',           color: '#16a34a', Icon: ClipboardList },
  { day: 'Tuesday',   consult: 'Pediatric Consultation',         color: '#4ade80', Icon: Stethoscope },
  { day: 'Wednesday', consult: 'Pregnancy Consultation',         color: '#059669', Icon: Baby },
  { day: 'Thursday',  consult: 'Teenage Pregnancy Consultation', color: '#65a30d', Icon: Milestone },
  { day: 'Friday',    consult: 'Mental Health Consultation',     color: '#166534', Icon: Brain },
]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const GREEN_SHADES = ['#0d3b1f', '#166534', '#16a34a', '#4ade80', '#dcfce7', '#16a34a', '#0d3b1f', '#166534', '#16a34a', '#4ade80', '#dcfce7', '#16a34a']

function useBreakpoint() {
  const [w, setW] = useState(1200)
  useEffect(() => {
    const f = () => setW(window.innerWidth)
    f(); window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  return { isMobile: w < 540, isSmall: w < 1024, fit: w >= 1024 }
}

/* ── Stat card (gradient, registrar-style) ─────────────────────────────────*/
function StatCard({ label, value, icon: Icon, gradient, sub, subAlert, onClick }: any) {
  const [hov, setHov] = useState(false)
  const [c1, c2] = gradient
  return (
    <div onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        position: 'relative', overflow: 'hidden', flex: 1, minWidth: 150, userSelect: 'none',
        borderRadius: 16, padding: '14px 16px', color: '#fff', cursor: onClick ? 'pointer' : 'default',
        background: `linear-gradient(135deg, ${c1}, ${c2})`,
        boxShadow: hov ? `0 14px 32px ${c1}55` : `0 5px 16px ${c1}33`,
        transform: hov ? 'translateY(-2px)' : 'translateY(0)', transition: 'all .2s ease',
      }}>
      <div style={{ position: 'absolute', right: -24, top: -24, width: 84, height: 84, borderRadius: '50%', background: 'rgba(255,255,255,0.12)' }} />
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1 }}>{value}</div>
          <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.92, marginTop: 5, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
          {sub && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 7, fontSize: 9, fontWeight: 800, background: subAlert ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.18)', borderRadius: 20, padding: '2px 9px' }}>
              {subAlert && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff' }} />}{sub}
            </div>
          )}
        </div>
        <div style={{ background: 'rgba(255,255,255,0.22)', borderRadius: 11, padding: 8, flexShrink: 0, marginLeft: 8 }}>
          <Icon size={18} color="#fff" strokeWidth={2} />
        </div>
      </div>
    </div>
  )
}

/* ── Section header ────────────────────────────────────────────────────────*/
function SectionTitle({ title, subtitle, dark, right }: { title: string; subtitle?: string; dark: boolean; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{ width: 3, height: 17, borderRadius: 99, background: `linear-gradient(${G.dark},${G.teal})` }} />
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: dark ? '#dcfce7' : G.darkest }}>{title}</div>
          {subtitle && <div style={{ fontSize: 10.5, color: dark ? '#16a34a' : G.muted, marginTop: 1 }}>{subtitle}</div>}
        </div>
      </div>
      {right}
    </div>
  )
}

/* ── Year dropdown ─────────────────────────────────────────────────────────*/
function YearMenu({ value, years, onChange, dark, bdr }: { value: number; years: number[]; onChange: (y: number) => void; dark: boolean; bdr: string }) {
  const [open, setOpen] = useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 99,
          border: `1.5px solid ${open ? G.dark : bdr}`,
          background: open ? `linear-gradient(135deg,${G.dark},${G.teal})` : dark ? '#0d2516' : '#f0fdf4',
          color: open ? '#fff' : G.dark, fontSize: 12, fontWeight: 800, cursor: 'pointer',
        }}>
        {value} <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50, background: dark ? '#0d2516' : '#fff', border: `1.5px solid ${G.dark}`, borderRadius: 12, boxShadow: '0 8px 28px rgba(0,0,0,0.18)', minWidth: 110, overflow: 'hidden' }}>
          {years.map(y => {
            const sel = y === value
            return (
              <div key={y} onClick={() => { onChange(y); setOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 13px', fontSize: 13, fontWeight: sel ? 800 : 600, color: sel ? '#fff' : dark ? '#e2f5e9' : '#1f2937', background: sel ? `linear-gradient(135deg,${G.dark},${G.teal})` : 'transparent', cursor: 'pointer' }}
                onMouseEnter={e => { if (!sel) e.currentTarget.style.background = dark ? 'rgba(74,222,128,0.1)' : '#f0fdf4' }}
                onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'transparent' }}>
                {y} {sel && <Check size={13} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const BarLabel = (p: any) => p.value ? <text x={p.x + p.width / 2} y={p.y - 4} fill="#9ca3af" textAnchor="middle" fontSize={9} fontWeight={700}>{p.value}</text> : null

/* ── Dashboard ─────────────────────────────────────────────────────────────*/
export default function Dashboard({ darkMode, onNavigate }: Props) {
  const dk = darkMode
  const { isMobile, isSmall, fit } = useBreakpoint()

  const card = dk ? '#0d2516' : '#fff'
  const bdr = dk ? '#1a4d1a' : G.ghost
  const txt = dk ? '#dcfce7' : G.darkest
  const txt2 = dk ? '#dcfce7' : G.dark
  const txt3 = dk ? '#16a34a' : G.muted

  const cardBox: React.CSSProperties = { background: card, border: `1.5px solid ${bdr}`, borderRadius: 16, padding: 16 }

  const [stats, setStats] = useState({ users: 0, patients: 0, labs: 0, inventory: 0, consultations: 0, prescriptions: 0, lowStock: 0, pendingLabs: 0 })
  const [diseases, setDiseases] = useState<{ name: string; count: number }[]>([])
  const [topMeds, setTopMeds] = useState<{ name: string; count: number }[]>([])
  const [monthly, setMonthly] = useState<{ month: string; patients: number }[]>(MONTHS.map(m => ({ month: m, patients: 0 })))
  const [year, setYear] = useState(new Date().getFullYear())
  const [years, setYears] = useState<number[]>([new Date().getFullYear()])

  const fetchMonthly = async (y: number) => {
    const { data } = await supabase.from('patients').select('created_at')
      .gte('created_at', `${y}-01-01`).lte('created_at', `${y}-12-31T23:59:59`)
    const counts = MONTHS.map(() => 0)
    ;(data ?? []).forEach((r: any) => { if (r.created_at) counts[new Date(r.created_at).getMonth()]++ })
    setMonthly(MONTHS.map((m, i) => ({ month: m, patients: counts[i] })))
  }

  useEffect(() => {
    const now = new Date()
    const load = async () => {
      const [u, p, l, inv, c, pr, low, pend] = await Promise.all([
        supabase.from('users').select('user_id', { count: 'exact', head: true }),
        supabase.from('patients').select('id', { count: 'exact', head: true }),
        supabase.from('laboratory_requests').select('id', { count: 'exact', head: true }),
        supabase.from('pharma_medicines').select('id', { count: 'exact', head: true }).eq('archived', false),
        supabase.from('soap_consultations').select('id', { count: 'exact', head: true }),
        supabase.from('prescriptions').select('id', { count: 'exact', head: true }),
        supabase.from('pharma_medicines').select('id', { count: 'exact', head: true }).eq('archived', false).lte('quantity', 10),
        supabase.from('laboratory_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      ])
      setStats({
        users: u.count || 0, patients: p.count || 0, labs: l.count || 0, inventory: inv.count || 0,
        consultations: c.count || 0, prescriptions: pr.count || 0, lowStock: low.count || 0, pendingLabs: pend.count || 0,
      })

      const { data: soapRows } = await supabase
        .from('soap_consultations')
        .select('assessments, icd10_codes')
        .limit(2000)

      if (soapRows) {
        const tally: Record<string, number> = {}

        soapRows.forEach((r: any) => {
          const source = Array.isArray(r.assessments) && r.assessments.length > 0
            ? r.assessments
            : Array.isArray(r.icd10_codes)
              ? r.icd10_codes
              : []

          source.forEach((item: any) => {
            const name = String(item ?? '').trim()
            if (name) tally[name] = (tally[name] || 0) + 1
          })
        })

        setDiseases(
          Object.entries(tally)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 6)
        )
      }

      const { data: dispensedMeds } = await supabase
        .from('pharma_dispense')
        .select('med_name, quantity')
        .limit(2000)

      if (dispensedMeds) {
        const tally: Record<string, number> = {}

        dispensedMeds.forEach((r: any) => {
          const name = String(r.med_name ?? '').trim()
          const qty = Number(r.quantity ?? 1)
          if (name) tally[name] = (tally[name] || 0) + (Number.isFinite(qty) && qty > 0 ? qty : 1)
        })

        setTopMeds(
          Object.entries(tally)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 6)
        )
      }

      const { data: yr } = await supabase.from('patients').select('created_at').not('created_at', 'is', null)
      const set = new Set<number>([now.getFullYear()])
      ;(yr ?? []).forEach((r: any) => { if (r.created_at) set.add(new Date(r.created_at).getFullYear()) })
      setYears(Array.from(set).sort((a, b) => b - a))
    }
    load(); fetchMonthly(year)
  }, [])

  useEffect(() => { fetchMonthly(year) }, [year])

  const maxDis = Math.max(...diseases.map(d => d.count), 1)
  const maxMed = Math.max(...topMeds.map(m => m.count), 1)
  const isToday = (d: string) => new Date().toLocaleDateString('en-US', { weekday: 'long' }) === d

  /* ── List card (disease / prescribed) — fills its half, list scrolls if needed ─ */
  const ListCard = ({ title, subtitle, items, max, ranked }: {
    title: string; subtitle: string; items: { name: string; count: number }[]; max: number; ranked?: boolean
  }) => (
    <div style={{ ...cardBox, flex: fit ? 1 : undefined, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <SectionTitle title={title} subtitle={subtitle} dark={dk} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, overflowY: 'auto', minHeight: 0, flex: fit ? 1 : undefined }}>
        {items.length === 0 ? <div style={{ fontSize: 12, color: txt3 }}>No data yet</div> : items.map((it, i) => {
          const c = GREEN_SHADES[i % 6]
          return (
            <div key={it.name}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: txt, marginBottom: 4, gap: 8 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  {ranked && <span style={{ width: 17, height: 17, borderRadius: 6, background: `${c}1f`, color: c, fontSize: 9.5, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                </span>
                <span style={{ color: c, fontWeight: 900, flexShrink: 0 }}>{it.count}</span>
              </div>
              <div style={{ height: 7, borderRadius: 8, background: dk ? 'rgba(255,255,255,0.06)' : G.surface, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(it.count / max) * 100}%`, background: c, borderRadius: 8, transition: 'width .5s' }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <div style={{ height: fit ? '100%' : 'auto', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.45} }`}</style>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', flexShrink: 0 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: G.dark, boxShadow: `0 0 0 3px ${G.dark}33`, animation: 'pulse 2s infinite' }} />
            <p style={{ color: dk ? '#4ade80' : txt2, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, margin: 0 }}>Live Dashboard</p>
          </div>
          <h1 style={{ fontSize: isMobile ? 24 : 28, fontWeight: 900, color: dk ? '#4ade80' : G.dark, margin: 0, lineHeight: 1 }}>DASHBOARD</h1>
        </div>
      </div>

      {/* Totals */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
        <StatCard label="Total Users"    value={stats.users}         icon={Users}        gradient={['#0d3b1f', '#16a34a']} sub="All roles"        onClick={() => onNavigate('User Management')} />
        <StatCard label="Total Patients" value={stats.patients}      icon={Activity}     gradient={['#059669', '#166534']} sub="Registered"       onClick={() => onNavigate('Patient Records')} />
        <StatCard label="Lab Requests"   value={stats.labs}          icon={FlaskConical} gradient={['#166534', '#4ade80']} sub={`${stats.pendingLabs} pending`} onClick={() => onNavigate('Laboratory Records')} />
        <StatCard label="Consultations"  value={stats.consultations} icon={Heart}        gradient={['#16a34a', '#4ade80']} sub="SOAP notes" />
        <StatCard label="Prescriptions"  value={stats.prescriptions} icon={Pill}         gradient={['#166534', '#16a34a']} sub="Issued" />
        <StatCard label="Medicine Stock" value={stats.inventory}     icon={Package}      gradient={['#16a34a', '#65a30d']} sub={stats.lowStock > 0 ? `${stats.lowStock} low stock` : 'OK'} subAlert={stats.lowStock > 0} onClick={() => onNavigate('Medicine Inventory')} />
      </div>

      {/* Schedule */}
      <div style={{ ...cardBox, flexShrink: 0 }}>
        <SectionTitle title="Weekly Consultation Schedule" subtitle="RHU Lopez — recurring clinic days" dark={dk} />
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : isSmall ? 'repeat(3,1fr)' : 'repeat(5,1fr)', gap: 10 }}>
          {SCHEDULE.map(({ day, consult, color, Icon }) => {
            const active = isToday(day)
            return (
              <div key={day} style={{ borderRadius: 11, overflow: 'hidden', border: `1.5px solid ${active ? color : bdr}`, background: active ? `linear-gradient(135deg,${color}1f,${color}0a)` : dk ? '#0d1f14' : '#f6faf7', boxShadow: active ? `0 4px 16px ${color}22` : 'none' }}>
                <div style={{ height: 3, background: active ? `linear-gradient(90deg,${color},${color}88)` : `linear-gradient(90deg,${bdr},transparent)` }} />
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: active ? `linear-gradient(135deg,${color},${color}88)` : `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={16} color={active ? '#fff' : color} strokeWidth={2} />
                    </div>
                    {active && <span style={{ background: color, color: '#fff', fontSize: 8, fontWeight: 800, padding: '2px 7px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 0.5 }}>Today</span>}
                  </div>
                  <div style={{ fontSize: 9, fontWeight: 800, color: active ? color : txt2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>{day}</div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: txt, lineHeight: 1.3 }}>{consult}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Bottom region — fills remaining height on desktop */}
      <div style={{ flex: fit ? 1 : undefined, minHeight: 0, display: 'grid', gridTemplateColumns: isSmall ? '1fr' : '1fr 1fr', gap: 12 }}>
        <ListCard title="Top Disease Trends" subtitle="From SOAP consultation records" items={diseases} max={maxDis} />
        <ListCard title="Top Prescribed Medicines" subtitle="Most dispensed medicines" items={topMeds} max={maxMed} ranked />
      </div>

      {/* Patient registration trend — fills remaining height on desktop */}
      <div style={{ ...cardBox, flex: fit ? 1 : undefined, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <SectionTitle title="Patient Registration Trend" subtitle={`New patients per month · ${year}`} dark={dk}
          right={<YearMenu value={year} years={years} onChange={setYear} dark={dk} bdr={bdr} />} />
        <div style={{ flex: 1, minHeight: fit ? 0 : 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} margin={{ top: 14, right: 4, left: -26, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={dk ? 'rgba(74,222,128,0.1)40' : '#eef4ef'} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: isMobile ? 8 : 10, fill: txt2 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: isMobile ? 8 : 10, fill: txt2 }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
              <Tooltip cursor={{ fill: 'rgba(26,122,26,0.07)' }} contentStyle={{ background: dk ? '#122918' : '#fff', border: `1px solid ${bdr}`, borderRadius: 10, fontSize: 11 }} formatter={(v: any) => [v, `Patients (${year})`]} />
              <Bar dataKey="patients" radius={[6, 6, 0, 0]} label={isMobile ? undefined : <BarLabel />}>
                {monthly.map((_, i) => <Cell key={i} fill={GREEN_SHADES[i % 12]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}