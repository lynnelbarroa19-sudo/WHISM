'use client'
import React from 'react'
import { Shield, CheckCircle } from 'lucide-react'

export default function RolesPermissions({ darkMode }: { darkMode: boolean }) {
  const card   = darkMode ? 'rgba(10,26,13,0.9)' : '#fff'
  const border = darkMode ? 'rgba(77,184,106,0.12)' : 'rgba(26,122,26,0.1)'
  const txt    = darkMode ? '#d1fae5' : '#0d2e0d'
  const sub    = darkMode ? '#4db86a' : '#1a7a1a'

  const roles = [
    { role:'Admin',              color:'#1a7a1a', permissions:['All access','User management','System config','Backup & restore','View all records','Generate reports'] },
    { role:'Doctor',             color:'#059669', permissions:['Login','Conduct/Save consultation','Create prescription','View lab results','Send lab request','View disease prediction','AI medicine dictionary'] },
    { role:'Nurse',              color:'#db2777', permissions:['Login','Initial assessment','Forward to doctor','Request medicine','Monitor medication','Administer medications','AI medicine dictionary'] },
    { role:'Registrar',          color:'#d97706', permissions:['Login','Register patient','Notify doctor','Manage warehouse inventory','Receive medicine request','Generate report'] },
    { role:'Pharmacist',         color:'#2563eb', permissions:['Login','Manage medicine inventory','Stock notifications','Send restock request','View prescriptions','Medicine prediction'] },
    { role:'Warehouse Staff',    color:'#b45309', permissions:['Login','Update stock levels','Process medicine requests','Generate report'] },
    { role:'Medical Technologist', color:'#0891b2', permissions:['Login','Upload lab results','View lab requests','Send lab results','View all lab records'] },
  ]

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div>
        <h2 style={{ margin:0, fontSize:18, fontWeight:800, color:txt }}>Roles & Permissions</h2>
        <p style={{ margin:'4px 0 0', fontSize:12, color:sub }}>System access matrix for each user role</p>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px,1fr))', gap:16 }}>
        {roles.map(r => (
          <div key={r.role} style={{ background:card, border:`1px solid ${border}`, borderRadius:16, padding:20,
            boxShadow: darkMode?'0 4px 24px rgba(0,0,0,0.2)':'0 2px 12px rgba(26,122,26,0.05)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ width:36, height:36, borderRadius:10, background:`${r.color}18`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <Shield size={17} color={r.color}/>
                </div>
                <span style={{ fontWeight:800, fontSize:14, color:txt }}>{r.role}</span>
              </div>
              <span style={{ fontSize:10, background:`${r.color}18`, color:r.color, padding:'2px 8px', borderRadius:10, fontWeight:700 }}>
                {r.permissions.length} permissions
              </span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
              {r.permissions.map(p => (
                <div key={p} style={{ display:'flex', alignItems:'center', gap:7, fontSize:12, color: darkMode?'#a7f3d0':'#166534' }}>
                  <CheckCircle size={12} color={r.color}/> {p}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}