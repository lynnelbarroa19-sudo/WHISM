"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function AdminDashboard() {
  const router = useRouter();
  const { user, logout, isLoading } = useAuth();
  useEffect(() => { if (!isLoading && !user) router.replace("/login"); }, [user,isLoading,router]);
  if (isLoading||!user) return null;

  return (
    <div style={{minHeight:"100vh",background:"#f0f7f2",fontFamily:"Nunito,sans-serif",display:"flex",flexDirection:"column"}}>
      <header style={{background:"#0d3b1f",padding:"0 24px",height:60,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <span style={{fontFamily:"Nunito,sans-serif",fontWeight:800,fontSize:16,color:"#fff",letterSpacing:"0.06em"}}>SMARTRHU — Admin</span>
        <div style={{display:"flex",alignItems:"center",gap:10,background:"rgba(255,255,255,0.12)",borderRadius:20,padding:"4px 14px 4px 4px"}}>
          <div style={{width:30,height:30,borderRadius:"50%",background:"#4ade80",color:"#0d3b1f",fontWeight:700,fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"}}>{user.initials}</div>
          <div>
            <div style={{fontSize:13,color:"#fff",fontWeight:600,lineHeight:1.3}}>{user.name}</div>
            <div style={{fontSize:9,color:"rgba(255,255,255,0.55)",textTransform:"uppercase",letterSpacing:"0.06em"}}>Administrator</div>
          </div>
        </div>
      </header>
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
        <div style={{fontSize:56}}>🖥️</div>
        <h1 style={{fontFamily:"Nunito,sans-serif",fontWeight:800,fontSize:28,color:"#0a2912"}}>Admin Dashboard</h1>
        <p style={{color:"#4b6557",fontSize:15}}>Welcome, <strong>{user.name}</strong>! Your admin module is coming soon.</p>
        <button onClick={() => { logout(); router.push("/login"); }}
          style={{marginTop:12,padding:"10px 28px",background:"#0d3b1f",color:"#fff",border:"none",borderRadius:20,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"Nunito,sans-serif"}}>
          Logout
        </button>
      </div>
    </div>
  );
}