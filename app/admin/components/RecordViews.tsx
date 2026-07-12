'use client'
import React from 'react'
import { Users, FlaskConical, Package } from 'lucide-react'

// ─── Shared empty-state shell ───────────────────────────────────────────────
function EmptyState({ icon: Icon, title, desc, color, darkMode }:
  { icon: React.ElementType; title: string; desc: React.ReactNode; color: string; darkMode: boolean }) {
  const card   = darkMode ? 'rgba(10,26,13,0.9)' : '#fff'
  const border = darkMode ? 'rgba(77,184,106,0.12)' : 'rgba(26,122,26,0.1)'
  const txt    = darkMode ? '#d1fae5' : '#0d2e0d'
  const sub    = darkMode ? '#4db86a' : '#1a7a1a'
  return (
    <div style={{ background:card, border:`1px solid ${border}`, borderRadius:16, padding:24 }}>
      <div style={{ textAlign:'center', padding:48, color:sub }}>
        <div style={{ width:64, height:64, borderRadius:18, background:`${color}18`,
          display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
          <Icon size={32} color={color}/>
        </div>
        <div style={{ fontSize:14, fontWeight:700, color:txt }}>{title}</div>
        <div style={{ fontSize:12, marginTop:8, color:sub, lineHeight:1.6 }}>{desc}</div>
      </div>
    </div>
  )
}

// ─── Patient Records ─────────────────────────────────────────────────────────
export function PatientRecords({ darkMode }: { darkMode: boolean }) {
  const txt = darkMode ? '#d1fae5' : '#0d2e0d'
  const sub = darkMode ? '#4db86a' : '#1a7a1a'
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div>
        <h2 style={{ margin:0, fontSize:18, fontWeight:800, color:txt }}>All Patient Records</h2>
        <p style={{ margin:'4px 0 0', fontSize:12, color:sub }}>Read-only admin view of all registered patients</p>
      </div>
      <EmptyState icon={Users} color="#1a7a1a" darkMode={darkMode}
        title="Patient records are loaded from the database"
        desc={<>Connect your Supabase <code>patients</code> table to display records here</>}/>
    </div>
  )
}

// ─── Lab Records ─────────────────────────────────────────────────────────────
export function LabRecords({ darkMode }: { darkMode: boolean }) {
  const txt = darkMode ? '#d1fae5' : '#0d2e0d'
  const sub = darkMode ? '#4db86a' : '#1a7a1a'
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div>
        <h2 style={{ margin:0, fontSize:18, fontWeight:800, color:txt }}>All Lab Records</h2>
        <p style={{ margin:'4px 0 0', fontSize:12, color:sub }}>Admin view of all laboratory test results</p>
      </div>
      <EmptyState icon={FlaskConical} color="#0891b2" darkMode={darkMode}
        title="Lab records are loaded from the database"
        desc={<>Connect your Supabase <code>lab_results</code> table to display records here</>}/>
    </div>
  )
}

// ─── Inventory Records ────────────────────────────────────────────────────────
export function InventoryRecords({ darkMode }: { darkMode: boolean }) {
  const txt = darkMode ? '#d1fae5' : '#0d2e0d'
  const sub = darkMode ? '#4db86a' : '#1a7a1a'
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div>
        <h2 style={{ margin:0, fontSize:18, fontWeight:800, color:txt }}>All Inventory Records</h2>
        <p style={{ margin:'4px 0 0', fontSize:12, color:sub }}>Admin view of all medicine and supply inventory</p>
      </div>
      <EmptyState icon={Package} color="#d97706" darkMode={darkMode}
        title="Inventory records are loaded from the database"
        desc={<>Connect your Supabase <code>inventory</code> table to display records here</>}/>
    </div>
  )
}