'use client'
import React, { useState, useEffect } from 'react'
import { UserPlus, Edit, Trash2, Search, Lock, Unlock, CheckCircle, XCircle, Eye, EyeOff, RefreshCw, Shield } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// ── Role metadata matching actual DB constraint ───────────────────────────
const ROLES = ['admin','doctor','pharmacist','medtech','warehouse','registrar'] as const
type Role = typeof ROLES[number]

const roleMeta: Record<Role, { label:string; color:string; bg:string; needsLicense:boolean }> = {
  admin:      { label:'Admin',               color:'#7c3aed', bg:'#ede9fe', needsLicense:false },
  doctor:     { label:'Doctor',              color:'#059669', bg:'#d1fae5', needsLicense:true  },
  pharmacist: { label:'Pharmacist',          color:'#2563eb', bg:'#dbeafe', needsLicense:true  },
  medtech:    { label:'Medical Technologist',color:'#0891b2', bg:'#cffafe', needsLicense:true  },
  warehouse:  { label:'Warehouse Staff',     color:'#b45309', bg:'#fef9c3', needsLicense:false },
  registrar:  { label:'Registrar',           color:'#d97706', bg:'#fef3c7', needsLicense:false },
}

const G = { dark:'#1a7a1a', mid:'#2e7d32', surface:'#e8f5e9', ghost:'#c8e6c8', bg:'#f1f8f1' }

interface UserAccount {
  user_id:      string
  first_name:   string
  middle_name?: string
  last_name:    string
  email:        string
  username?:    string
  role:         Role
  status:       'active'|'inactive'|'suspended'
  user_license?: string
  is_first_login?: boolean
  created_at:   string
  avatar_url?:  string
}

function RoleBadge({ role }: { role: string }) {
  const m = roleMeta[role as Role] || { color:'#6b7280', bg:'#f3f4f6', label: role }
  return (
    <span style={{ background:m.bg, color:m.color, fontSize:10, fontWeight:700,
      padding:'3px 10px', borderRadius:20, border:`1px solid ${m.color}22`, whiteSpace:'nowrap' }}>
      {m.label}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cfg = status==='active'
    ? { bg:'#d1fae5', color:'#065f46', dot:'#10b981' }
    : status==='suspended'
    ? { bg:'#fee2e2', color:'#991b1b', dot:'#ef4444' }
    : { bg:'#f3f4f6', color:'#374151', dot:'#9ca3af' }
  return (
    <span style={{ display:'flex', alignItems:'center', gap:5, background:cfg.bg, color:cfg.color,
      fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:20, width:'fit-content' }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:cfg.dot, display:'inline-block' }}/>
      {status}
    </span>
  )
}

export default function UserManagement({ darkMode }: { darkMode: boolean }) {
  const dk     = darkMode
  const card   = dk ? '#0f2014' : '#fff'
  const bdr    = dk ? '#1a4d1a' : G.ghost
  const txt    = dk ? '#c8e6c8' : '#0d2e0d'
  const txt2   = dk ? '#81c784' : G.dark
  const txt3   = dk ? '#388e3c' : '#6b7280'
  const inp: React.CSSProperties = {
    width:'100%', boxSizing:'border-box', padding:'9px 12px', borderRadius:10,
    border:`1.5px solid ${bdr}`, background:dk?'rgba(255,255,255,0.05)':G.surface,
    color:txt, fontSize:13, outline:'none', fontFamily:'Nunito',
  }

  const [users,      setUsers]      = useState<UserAccount[]>([])
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const [roleFilter, setRoleFilter] = useState<'all'|Role>('all')
  const [showForm,   setShowForm]   = useState(false)
  const [editUser,   setEditUser]   = useState<UserAccount|null>(null)
  const [saving,     setSaving]     = useState(false)
  const [msg,        setMsg]        = useState<{text:string;ok:boolean}|null>(null)
  const [showPw,     setShowPw]     = useState(false)

  const blankForm = { first_name:'', middle_name:'', last_name:'', email:'', username:'', role:'registrar' as Role, password:'', user_license:'', status:'active' as const }
  const [form, setForm] = useState(blankForm)
  const setF = (k: string, v: string) => setForm(f => ({...f, [k]:v}))

  // ── Fetch users from Supabase ──────────────────────────────────────────
  const fetchUsers = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('users')
      .select('user_id, first_name, middle_name, last_name, email, username, role, status, user_license, is_first_login, created_at, avatar_url')
      .order('created_at', { ascending: false })
    if (error) {
      setMsg({ text: `Failed to load users: ${error.message}`, ok: false }); clearMsg()
    }
    if (data) setUsers(data as UserAccount[])
    setLoading(false)
  }

  useEffect(() => { fetchUsers() }, [])

  const clearMsg = () => setTimeout(() => setMsg(null), 4000)

  // ── Helper: safely parse a fetch Response that *should* be JSON ─────────
  // If the route is missing/crashing, the body is an HTML error page; calling
  // res.json() on that throws "Unexpected token '<'...". This reads the text
  // first and surfaces a readable error instead of the cryptic parser one.
  const parseJsonResponse = async (res: Response) => {
    const raw = await res.text()
    let body: any = {}
    if (raw) {
      try {
        body = JSON.parse(raw)
      } catch {
        throw new Error(
          `Server returned non-JSON (HTTP ${res.status}). ` +
          `This usually means the /api/create-user route is missing or crashed. ` +
          `First bytes: ${raw.slice(0, 120).replace(/\s+/g, ' ').trim()}`
        )
      }
    }
    if (!res.ok) throw new Error(body.error || `Request failed (HTTP ${res.status})`)
    return body
  }

  // ── Create user via API route (Supabase Auth admin + insert) ───────────
  const handleCreate = async () => {
    if (!form.first_name.trim() || !form.last_name.trim() || !form.email.trim() || !form.password) {
      setMsg({ text:'First name, last name, email, and password are required.', ok:false }); return
    }
    const needsLic = roleMeta[form.role]?.needsLicense
    if (needsLic && !form.user_license.trim()) {
      setMsg({ text:`License number is required for ${roleMeta[form.role].label}.`, ok:false }); return
    }
    if (form.password.length < 8) {
      setMsg({ text:'Password must be at least 8 characters.', ok:false }); return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email:        form.email.trim(),
          password:     form.password,
          first_name:   form.first_name.trim(),
          middle_name:  form.middle_name.trim(),
          last_name:    form.last_name.trim(),
          username:     form.username.trim(),
          role:         form.role,
          user_license: form.user_license.trim(),
        }),
      })
      await parseJsonResponse(res)

      setMsg({ text: `User "${form.first_name} ${form.last_name}" created successfully!`, ok: true })
      setForm(blankForm); setShowForm(false)
      fetchUsers()
    } catch (err: any) {
      setMsg({ text: err.message || 'Failed to create user.', ok: false })
    } finally {
      setSaving(false); clearMsg()
    }
  }

  // ── Update existing user ───────────────────────────────────────────────
  const handleUpdate = async () => {
    if (!editUser) return
    setSaving(true)
    try {
      const needsLic = roleMeta[editUser.role]?.needsLicense
      const { error } = await supabase.from('users')
        .update({
          first_name:   editUser.first_name,
          middle_name:  editUser.middle_name || null,
          last_name:    editUser.last_name,
          username:     editUser.username || null,
          role:         editUser.role,
          status:       editUser.status,
          user_license: needsLic ? (editUser.user_license || null) : null,
          updated_at:   new Date().toISOString(),
        })
        .eq('user_id', editUser.user_id)
      if (error) throw new Error(error.message)
      setMsg({ text:'User updated successfully!', ok:true })
      setEditUser(null); fetchUsers()
    } catch(err: any) {
      setMsg({ text: err.message, ok:false })
    } finally {
      setSaving(false); clearMsg()
    }
  }

  // ── Toggle suspend/activate ────────────────────────────────────────────
  const handleToggleStatus = async (u: UserAccount) => {
    const newStatus = u.status === 'active' ? 'suspended' : 'active'
    const { error } = await supabase.from('users')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('user_id', u.user_id)
    if (error) { setMsg({ text: error.message, ok:false }); clearMsg(); return }
    fetchUsers()
  }

  // ── Delete user ────────────────────────────────────────────────────────
  // NOTE: this deletes the profile row only. To also remove the auth user you
  // need a server route with the service-role key (see /api/delete-user idea).
  const handleDelete = async (u: UserAccount) => {
    if (!confirm(`Delete "${u.first_name} ${u.last_name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('users').delete().eq('user_id', u.user_id)
    if (error) { setMsg({ text: error.message, ok:false }); clearMsg(); return }
    fetchUsers()
  }

  // ── Reset to first login (force password change on next login) ─────────
  const handleResetLogin = async (u: UserAccount) => {
    const { error } = await supabase.from('users').update({ is_first_login: true }).eq('user_id', u.user_id)
    if (error) { setMsg({ text: error.message, ok:false }); clearMsg(); return }
    setMsg({ text:`${u.first_name} will be prompted to change password on next login.`, ok:true })
    clearMsg(); fetchUsers()
  }

  // ── Filter ────────────────────────────────────────────────────────────
  const filtered = users.filter(u => {
    const full = `${u.first_name} ${u.middle_name||''} ${u.last_name} ${u.email} ${u.username||''}`.toLowerCase()
    if (search && !full.includes(search.toLowerCase())) return false
    if (roleFilter !== 'all' && u.role !== roleFilter) return false
    return true
  })

  const fullName = (u: UserAccount) => [u.first_name, u.middle_name, u.last_name].filter(Boolean).join(' ')
  const initials = (u: UserAccount) => `${u.first_name?.[0]||''}${u.last_name?.[0]||''}`.toUpperCase()

  return (
    <div className="um-thin-scroll" style={{ display:'flex', flexDirection:'column', gap:20, height:'100%', minHeight:0, overflow:'hidden' }}>

      {/* ── Header ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', flexWrap:'wrap', gap:12, flexShrink:0 }}>
        <div>
          <h2 style={{ margin:0, fontSize:28, fontWeight:900, color:dk?'#4ade80':G.dark }}>USER MANAGEMENT</h2>
        </div>
        <button
          onClick={() => { setShowForm(true); setEditUser(null); setForm(blankForm); setMsg(null) }}
          style={{ background:`linear-gradient(135deg,${G.dark},${G.mid})`, color:'#fff', border:'none',
            borderRadius:12, padding:'10px 22px', fontSize:13, fontWeight:700, cursor:'pointer',
            display:'flex', alignItems:'center', gap:8, boxShadow:`0 4px 14px ${G.dark}44` }}>
          <UserPlus size={16}/> Add New User
        </button>
      </div>

      {/* ── Message ── */}
      {msg && (
        <div style={{ background:msg.ok?G.surface:'#fef2f2', border:`1.5px solid ${msg.ok?G.dark:'#fca5a5'}`,
          borderRadius:12, padding:'11px 16px', fontSize:13, color:msg.ok?G.dark:'#dc2626',
          display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
          {msg.ok ? <CheckCircle size={16} color={G.dark}/> : <XCircle size={16} color="#dc2626"/>}
          {msg.text}
        </div>
      )}

      {/* ── Create / Edit Form ── */}
      {(showForm || editUser) && (
        <div style={{ background:card, border:`1.5px solid ${bdr}`, borderRadius:18, padding:24,
          boxShadow:dk?'0 4px 24px rgba(0,0,0,0.4)':'0 4px 24px rgba(26,122,26,0.1)', flexShrink:0 }}>
          {/* Form header */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
            <div>
              <h3 style={{ margin:0, fontSize:16, fontWeight:800, color:txt }}>
                {editUser ? `Edit: ${fullName(editUser)}` : 'Create New User Account'}
              </h3>
              <p style={{ margin:'3px 0 0', fontSize:11, color:txt3 }}>
                {editUser ? 'Update user information and role' : 'New user will receive login credentials at their email'}
              </p>
            </div>
            <button onClick={()=>{setShowForm(false);setEditUser(null);setMsg(null)}}
              style={{ background:'none', border:'none', cursor:'pointer', color:txt3, fontSize:20, lineHeight:1 }}>✕</button>
          </div>

          {/* Name row */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:14 }}>
            {[['First Name *','first_name'],['Middle Name','middle_name'],['Last Name *','last_name']].map(([label,key])=>(
              <div key={key}>
                <label style={{ display:'block', fontSize:11, fontWeight:700, color:txt2, marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 }}>{label}</label>
                <input
                  value={editUser ? (editUser as any)[key]||'' : (form as any)[key]}
                  onChange={e => editUser ? setEditUser({...editUser,[key]:e.target.value}) : setF(key, e.target.value)}
                  placeholder={label.replace(' *','')}
                  style={inp}
                  onFocus={e=>(e.currentTarget.style.borderColor=G.dark)}
                  onBlur={e=>(e.currentTarget.style.borderColor=bdr)}
                />
              </div>
            ))}
          </div>

          {/* Email + Username row */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
            <div>
              <label style={{ display:'block', fontSize:11, fontWeight:700, color:txt2, marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 }}>Email Address *</label>
              <input type="email"
                value={editUser ? editUser.email : form.email}
                onChange={e => editUser ? setEditUser({...editUser,email:e.target.value}) : setF('email', e.target.value)}
                placeholder="user@rhu.gov.ph" style={inp} disabled={!!editUser}
                onFocus={e=>(e.currentTarget.style.borderColor=G.dark)}
                onBlur={e=>(e.currentTarget.style.borderColor=bdr)}
              />
              {editUser && <div style={{ fontSize:10, color:txt3, marginTop:4 }}>Email cannot be changed after creation.</div>}
            </div>
            <div>
              <label style={{ display:'block', fontSize:11, fontWeight:700, color:txt2, marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 }}>Username (optional)</label>
              <input
                value={editUser ? editUser.username||'' : form.username}
                onChange={e => editUser ? setEditUser({...editUser,username:e.target.value}) : setF('username', e.target.value)}
                placeholder="e.g. juan.delacruz" style={inp}
                onFocus={e=>(e.currentTarget.style.borderColor=G.dark)}
                onBlur={e=>(e.currentTarget.style.borderColor=bdr)}
              />
            </div>
          </div>

          {/* Role + Status row */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
            <div>
              <label style={{ display:'block', fontSize:11, fontWeight:700, color:txt2, marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 }}>Role *</label>
              <select
                value={editUser ? editUser.role : form.role}
                onChange={e => editUser ? setEditUser({...editUser,role:e.target.value as Role}) : setF('role', e.target.value)}
                style={{ ...inp, cursor:'pointer', appearance:'none' as any }}>
                {ROLES.map(r => (
                  <option key={r} value={r}>{roleMeta[r].label}</option>
                ))}
              </select>
              {/* Role description */}
              <div style={{ fontSize:10, color:txt3, marginTop:4, display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:roleMeta[editUser?.role||form.role]?.color, display:'inline-block' }}/>
                {roleMeta[editUser?.role||form.role]?.needsLicense ? 'Requires professional license number' : 'No license required for this role'}
              </div>
            </div>
            {editUser && (
              <div>
                <label style={{ display:'block', fontSize:11, fontWeight:700, color:txt2, marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 }}>Account Status</label>
                <select value={editUser.status} onChange={e=>setEditUser({...editUser,status:e.target.value as any})}
                  style={{ ...inp, cursor:'pointer', appearance:'none' as any }}>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            )}
          </div>

          {/* License — only for doctor/pharmacist/medtech */}
          {roleMeta[editUser?.role||form.role]?.needsLicense && (
            <div style={{ marginBottom:14 }}>
              <label style={{ display:'block', fontSize:11, fontWeight:700, color:txt2, marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 }}>
                Professional License Number *
              </label>
              <input
                value={editUser ? editUser.user_license||'' : form.user_license}
                onChange={e => editUser ? setEditUser({...editUser,user_license:e.target.value}) : setF('user_license', e.target.value)}
                placeholder="e.g. 0012345" style={{ ...inp, maxWidth:280 }}
                onFocus={e=>(e.currentTarget.style.borderColor=G.dark)}
                onBlur={e=>(e.currentTarget.style.borderColor=bdr)}
              />
              <div style={{ fontSize:10, color:txt3, marginTop:4 }}>Required by DB constraint for {roleMeta[editUser?.role||form.role].label}</div>
            </div>
          )}

          {/* Password — only for new users */}
          {!editUser && (
            <div style={{ marginBottom:20 }}>
              <label style={{ display:'block', fontSize:11, fontWeight:700, color:txt2, marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 }}>
                Temporary Password *
              </label>
              <div style={{ position:'relative', maxWidth:340 }}>
                <input type={showPw?'text':'password'}
                  value={form.password}
                  onChange={e=>setF('password', e.target.value)}
                  placeholder="Minimum 8 characters"
                  style={{ ...inp }}
                  onFocus={e=>(e.currentTarget.style.borderColor=G.dark)}
                  onBlur={e=>(e.currentTarget.style.borderColor=bdr)}
                />
                <button onClick={()=>setShowPw(v=>!v)} type="button"
                  style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:txt3, display:'flex' }}>
                  {showPw ? <EyeOff size={15}/> : <Eye size={15}/>}
                </button>
              </div>
              <div style={{ fontSize:10, color:txt3, marginTop:4 }}>
                The user will be prompted to change this on first login (is_first_login = true).
              </div>
            </div>
          )}

          {/* Buttons */}
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={editUser ? handleUpdate : handleCreate} disabled={saving}
              style={{ background:`linear-gradient(135deg,${G.dark},${G.mid})`, color:'#fff', border:'none',
                borderRadius:10, padding:'10px 24px', fontSize:13, fontWeight:700, cursor:'pointer',
                opacity:saving?0.6:1, display:'flex', alignItems:'center', gap:8 }}>
              {saving ? <><RefreshCw size={14} style={{ animation:'spin 0.8s linear infinite' }}/> Saving…</> : editUser ? '✓ Save Changes' : '+ Create User'}
            </button>
            <button onClick={()=>{setShowForm(false);setEditUser(null);setMsg(null)}}
              style={{ background:'transparent', color:txt2, border:`1.5px solid ${bdr}`, borderRadius:10, padding:'10px 20px', fontSize:13, fontWeight:600, cursor:'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Search + Role filter ── */}
      <div style={{ background:card, borderRadius:16, padding:'14px 18px', border:`1.5px solid ${bdr}`, display:'flex', flexDirection:'column', gap:10, flexShrink:0 }}>
        <div style={{ position:'relative' }}>
          <Search size={14} style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:txt3 }}/>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search by name, email, or username..."
            style={{ ...inp, paddingLeft:34 }}
            onFocus={e=>(e.currentTarget.style.borderColor=G.dark)}
            onBlur={e=>(e.currentTarget.style.borderColor=bdr)}/>
        </div>
        {/* Role filter pills */}
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          <button onClick={()=>setRoleFilter('all')}
            style={{ padding:'5px 14px', borderRadius:20, fontSize:11, fontWeight:700, cursor:'pointer',
              background:roleFilter==='all'?G.dark:'transparent', color:roleFilter==='all'?'#fff':txt3,
              border:roleFilter==='all'?'none':`1px solid ${bdr}`, transition:'all 0.15s' }}>
            All ({users.length})
          </button>
          {ROLES.map(r=>{
            const count = users.filter(u=>u.role===r).length
            const m = roleMeta[r]
            return (
              <button key={r} onClick={()=>setRoleFilter(r)}
                style={{ padding:'5px 14px', borderRadius:20, fontSize:11, fontWeight:700, cursor:'pointer',
                  background:roleFilter===r?m.color:'transparent',
                  color:roleFilter===r?'#fff':m.color,
                  border:`1px solid ${roleFilter===r?m.color:m.color+'44'}`,
                  transition:'all 0.15s' }}>
                {m.label} ({count})
              </button>
            )
          })}
        </div>
      </div>

      {/* ── User Table ── */}
      <div style={{ background:card, border:`1.5px solid ${bdr}`, borderRadius:18, overflow:'hidden',
        boxShadow:dk?'0 4px 24px rgba(0,0,0,0.3)':'0 2px 16px rgba(26,122,26,0.06)', flex:1, minHeight:0, display:'flex', flexDirection:'column' }}>
        <div className="um-thin-scroll" style={{ flex:1, minHeight:0, overflowX:'auto', overflowY:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ background:dk?'rgba(26,122,26,0.1)':G.surface, borderBottom:`2px solid ${bdr}` }}>
                {['#','Name','Email','Username','Role','License','Status','Actions'].map(h=>(
                  <th key={h} style={{ padding:'12px 14px', textAlign:'left', fontWeight:800,
                    color:dk?'#4ade80':G.dark, fontSize:10, textTransform:'uppercase', letterSpacing:0.8, whiteSpace:'nowrap', position:'sticky', top:0, background:dk?'#13251a':G.surface, zIndex:1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign:'center', padding:48, color:txt3 }}>
                  <div style={{ width:28, height:28, border:`3px solid ${G.dark}`, borderTopColor:'transparent', borderRadius:'50%', margin:'0 auto 8px', animation:'spin 0.8s linear infinite' }}/>
                  Loading users…
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign:'center', padding:48, color:txt3, fontSize:13 }}>
                  No users found{search ? ` for "${search}"` : ''}.
                </td></tr>
              ) : filtered.map((u, i) => (
                <tr key={u.user_id}
                  style={{ borderBottom:`1px solid ${bdr}`, transition:'background 0.1s' }}
                  onMouseEnter={e=>(e.currentTarget.style.background=dk?'rgba(26,122,26,0.05)':G.surface+'88')}
                  onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>

                  {/* # */}
                  <td style={{ padding:'12px 14px', color:txt3, fontWeight:700, fontSize:11 }}>{i+1}</td>

                  {/* Name + Avatar */}
                  <td style={{ padding:'12px 14px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div style={{ width:36, height:36, borderRadius:'50%', flexShrink:0,
                        background:`linear-gradient(135deg,${G.dark},${G.mid})`,
                        display:'flex', alignItems:'center', justifyContent:'center',
                        color:'#fff', fontWeight:800, fontSize:12, overflow:'hidden' }}>
                        {u.avatar_url
                          ? <img src={u.avatar_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
                          : initials(u)}
                      </div>
                      <div>
                        <div style={{ fontWeight:700, color:txt, fontSize:13 }}>{fullName(u)}</div>
                        {u.is_first_login && (
                          <div style={{ fontSize:9, color:'#d97706', fontWeight:700, background:'#fef3c7', padding:'1px 6px', borderRadius:4, display:'inline-block', marginTop:2 }}>
                            First login pending
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Email */}
                  <td style={{ padding:'12px 14px', color:txt3, fontSize:11 }}>{u.email}</td>

                  {/* Username */}
                  <td style={{ padding:'12px 14px', color:txt3, fontSize:11 }}>{u.username || <span style={{ color:txt3, opacity:0.5 }}>—</span>}</td>

                  {/* Role */}
                  <td style={{ padding:'12px 14px' }}><RoleBadge role={u.role}/></td>

                  {/* License */}
                  <td style={{ padding:'12px 14px', color:txt3, fontSize:11 }}>
                    {u.user_license
                      ? <span style={{ fontFamily:'Nunito', background:dk?'rgba(255,255,255,0.06)':G.surface, padding:'2px 8px', borderRadius:6, border:`1px solid ${bdr}` }}>{u.user_license}</span>
                      : <span style={{ color:txt3, opacity:0.5, fontSize:10 }}>N/A</span>}
                  </td>

                  {/* Status */}
                  <td style={{ padding:'12px 14px' }}><StatusBadge status={u.status}/></td>

                  {/* Actions */}
                  <td style={{ padding:'12px 14px' }}>
                    <div style={{ display:'flex', gap:5 }}>
                      {/* Edit */}
                      <button onClick={()=>{setEditUser(u);setShowForm(false);setMsg(null)}}
                        title="Edit user" style={{ background:G.surface, color:G.dark, border:`1px solid ${G.ghost}`, borderRadius:8, padding:'5px 8px', cursor:'pointer', display:'flex', alignItems:'center' }}>
                        <Edit size={13}/>
                      </button>
                      {/* Suspend/Activate */}
                      <button onClick={()=>handleToggleStatus(u)}
                        title={u.status==='active'?'Suspend':'Activate'}
                        style={{ background:u.status==='active'?'#fef3c7':'#dcfce7', color:u.status==='active'?'#d97706':'#15803d', border:'none', borderRadius:8, padding:'5px 8px', cursor:'pointer', display:'flex', alignItems:'center' }}>
                        {u.status==='active' ? <Lock size={13}/> : <Unlock size={13}/>}
                      </button>
                      {/* Reset first login */}
                      <button onClick={()=>handleResetLogin(u)}
                        title="Force password change on next login"
                        style={{ background:'#eff6ff', color:'#1d4ed8', border:'none', borderRadius:8, padding:'5px 8px', cursor:'pointer', display:'flex', alignItems:'center' }}>
                        <Shield size={13}/>
                      </button>
                      {/* Delete */}
                      <button onClick={()=>handleDelete(u)}
                        title="Delete user"
                        style={{ background:'#fee2e2', color:'#dc2626', border:'none', borderRadius:8, padding:'5px 8px', cursor:'pointer', display:'flex', alignItems:'center' }}>
                        <Trash2 size={13}/>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        .um-thin-scroll{ scrollbar-width: thin; scrollbar-color: ${G.dark}55 transparent; }
        .um-thin-scroll::-webkit-scrollbar{ width:7px; height:7px; }
        .um-thin-scroll::-webkit-scrollbar-track{ background: transparent; }
        .um-thin-scroll::-webkit-scrollbar-thumb{ background: ${G.dark}55; border-radius: 8px; }
        .um-thin-scroll:hover::-webkit-scrollbar-thumb{ background: ${G.dark}88; }
      `}</style>
    </div>
  )
}