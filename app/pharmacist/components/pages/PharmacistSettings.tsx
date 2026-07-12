"use client";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

type Tab = "profile" | "password";

function EyeIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

const UploadIcon = ({ size = 14, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/>
    <line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
);

const CameraIcon = ({ size = 14, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
    <circle cx="12" cy="13" r="4"/>
  </svg>
);

const CheckIcon = ({ size = 13, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const LockIcon = ({ size = 13, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
);

const SpinnerIcon = ({ size = 13, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}>
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
  </svg>
);

const XIcon = ({ size = 13, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

export default function PharmacistSettings({ initialTab }: { initialTab?: Tab }) {
  const { t }                   = useTheme();
  const router                  = useRouter();
  const { user: authUser, isLoading } = useAuth();

  const [tab, setTab]                     = useState<Tab>(initialTab ?? "profile");
  const [photo, setPhoto]                 = useState<string | null>(null);
  const [username, setUsername]           = useState("");
  const [email, setEmail]                 = useState("");
  const [role, setRole]                   = useState("pharmacist");
  const [saving, setSaving]               = useState(false);
  const [uploading, setUploading]         = useState(false);
  const [userId, setUserId]               = useState<string | null>(null);

  const [currentPw,  setCurrentPw]  = useState("");
  const [newPw,      setNewPw]      = useState("");
  const [confirmPw,  setConfirmPw]  = useState("");
  const [showCur,    setShowCur]    = useState(false);
  const [showNew,    setShowNew]    = useState(false);
  const [showConf,   setShowConf]   = useState(false);
  const [pwSaving,   setPwSaving]   = useState(false);

  const [toast,      setToast]      = useState("");
  const [toastType,  setToastType]  = useState<"success" | "error">("success");

  const [showCamera, setShowCamera] = useState(false);

  const fileRef   = useRef<HTMLInputElement>(null);
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const req = {
    length:  newPw.length >= 8,
    special: /[!@#$%^&*?]/.test(newPw),
    number:  /[0-9]/.test(newPw),
    match:   newPw.length > 0 && newPw === confirmPw,
  };

  useEffect(() => {
    if (!isLoading && !authUser) router.replace("/login");
  }, [authUser, isLoading, router]);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (authUser?.id) { setUserId(authUser.id); return; }
    try {
      const raw = localStorage.getItem("smartrhu_user");
      if (raw) { const p = JSON.parse(raw); if (p?.id) { setUserId(p.id); return; } }
    } catch {}
    const id = localStorage.getItem("userId");
    if (id) setUserId(id);
  }, [authUser]);

  useEffect(() => {
    if (!userId) return;
    fetchProfile(userId);
  }, [userId]);

  useEffect(() => {
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  const fetchProfile = async (uid: string) => {
    const { data, error } = await supabase
      .from("users")
      .select("username, email, avatar_url, role")
      .eq("user_id", uid)
      .single();
    if (error) { showToast("Failed to load profile.", "error"); return; }
    if (data) {
      setUsername(data.username || "");
      setEmail(data.email || "");
      setRole(data.role || "pharmacist");
      if (data.avatar_url) setPhoto(`${data.avatar_url}?t=${Date.now()}`);
    }
  };

  const showToast = (msg: string, type: "success" | "error") => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(""), 3500);
  };

  const getUid = () => userId || authUser?.id || (() => {
    try { const r = localStorage.getItem("smartrhu_user"); if (r) return JSON.parse(r)?.id; } catch {}
    return localStorage.getItem("userId");
  })();

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const uid = getUid();
    if (!uid) { showToast("User not found. Please refresh.", "error"); return; }
    if (file.size > 5 * 1024 * 1024) { showToast("File too large. Max 5 MB.", "error"); return; }

    setPhoto(URL.createObjectURL(file));
    setUploading(true);
    try {
      const ext      = file.name.split(".").pop();
      const filePath = `${uid}/avatar.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("avatars").upload(filePath, file, { upsert: true });
      if (uploadErr) { showToast(`Upload error: ${uploadErr.message}`, "error"); setUploading(false); return; }

      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(filePath);
      const publicUrl  = urlData.publicUrl;
      const displayUrl = `${publicUrl}?t=${Date.now()}`;

      const { error: updateErr } = await supabase.from("users")
        .update({ avatar_url: publicUrl }).eq("user_id", uid);
      if (updateErr) { showToast(`Error saving photo: ${updateErr.message}`, "error"); setUploading(false); return; }

      setPhoto(displayUrl);
      localStorage.setItem("userAvatar", publicUrl);
      window.dispatchEvent(new Event("avatarUpdated"));
      showToast("Photo updated successfully!", "success");
    } catch { showToast("Something went wrong.", "error"); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const openCamera = async () => {
    setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch { showToast("Camera access denied.", "error"); setShowCamera(false); }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setShowCamera(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const uid = getUid();
    if (!uid) return;
    const canvas = canvasRef.current;
    canvas.width  = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      setUploading(true); stopCamera();
      const filePath = `${uid}/avatar.jpg`;
      const { error: uploadErr } = await supabase.storage
        .from("avatars").upload(filePath, blob, { upsert: true, contentType: "image/jpeg" });
      if (uploadErr) { showToast(`Upload error: ${uploadErr.message}`, "error"); setUploading(false); return; }
      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(filePath);
      const publicUrl  = urlData.publicUrl;
      const displayUrl = `${publicUrl}?t=${Date.now()}`;
      await supabase.from("users").update({ avatar_url: publicUrl }).eq("user_id", uid);
      setPhoto(displayUrl);
      localStorage.setItem("userAvatar", publicUrl);
      window.dispatchEvent(new Event("avatarUpdated"));
      showToast("Photo saved!", "success");
      setUploading(false);
    }, "image/jpeg", 0.9);
  };

  const handleSaveProfile = async () => {
    if (!username.trim()) { showToast("Please enter a username.", "error"); return; }
    if (!email.trim())    { showToast("Please enter an email.", "error"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast("Please enter a valid email.", "error"); return; }
    const uid = getUid();
    if (!uid) { showToast("User not found. Please refresh.", "error"); return; }

    setSaving(true);
    const { error } = await supabase.from("users")
      .update({ username: username.trim(), email: email.trim() })
      .eq("user_id", uid);
    setSaving(false);

    if (error) { showToast("Error saving profile!", "error"); return; }
    localStorage.setItem("userName",  username.trim());
    localStorage.setItem("userEmail", email.trim());
    window.dispatchEvent(new Event("profileUpdated"));
    showToast("Profile saved successfully!", "success");
  };

  const handleChangePassword = async () => {
    if (!currentPw)      { showToast("Please enter your current password.", "error"); return; }
    if (!req.length)     { showToast("Password must be at least 8 characters.", "error"); return; }
    if (!req.special)    { showToast("Password must include a special character.", "error"); return; }
    if (!req.number)     { showToast("Password must include a number.", "error"); return; }
    if (!req.match)      { showToast("Passwords do not match.", "error"); return; }
    if (newPw === currentPw) { showToast("New password must differ from current.", "error"); return; }

    setPwSaving(true);
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email, password: currentPw,
    });
    if (signInErr) { showToast("Current password is incorrect.", "error"); setPwSaving(false); return; }
    const { error: updateErr } = await supabase.auth.updateUser({ password: newPw });
    setPwSaving(false);
    if (updateErr) { showToast("Error changing password!", "error"); return; }
    setCurrentPw(""); setNewPw(""); setConfirmPw("");
    showToast("Password changed successfully!", "success");
  };

  const now     = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const inputStyle: CSSProperties = {
    width: "100%", padding: "11px 14px",
    border: `1.5px solid ${t.cardBorder}`,
    borderRadius: 8, fontSize: 14, fontFamily: "inherit",
    background: t.cardBg, color: t.text,
    outline: "none", boxSizing: "border-box",
    transition: "border-color 0.2s",
  };

  const labelStyle: CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: "0.07em",
    color: t.text3, marginBottom: 6, display: "block",
    textTransform: "uppercase",
  };

  const sideTabStyle = (active: boolean): CSSProperties => ({
    display: "flex", alignItems: "center", gap: 10,
    width: "100%", padding: "10px 12px",
    borderRadius: 9, border: "none", cursor: "pointer",
    fontFamily: "inherit", fontSize: 13,
    fontWeight: active ? 700 : 500,
    background: active ? t.green : "transparent",
    color: active ? "#fff" : t.text,
    textAlign: "left", transition: "background 0.15s",
    marginBottom: 4,
  });

  const initials = (username || authUser?.name || "P")
    .split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2);

  const roleLabel = role
    ? role.charAt(0).toUpperCase() + role.slice(1)
    : "Pharmacist";

  if (isLoading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
      height: "100%", color: t.text3, fontFamily: "inherit" }}>
      Loading…
    </div>
  );
  if (!authUser) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>

      {/* Page heading */}
      <div style={{ marginBottom: 24, flexShrink: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: t.greenLight,
          textTransform: "uppercase", letterSpacing: ".08em", margin: 0 }}>
          Pharmacist
        </p>
        <h1 style={{ fontSize: 32, fontWeight: 1000, color: t.greenLight,
          margin: "4px 0 0", lineHeight: 1 }}>
          SETTINGS
        </h1>
       
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>

        {/* ── Left sidebar nav ── */}
        <div style={{
          width: 240, background: t.cardBg,
          borderRadius: 16, padding: "20px 16px",
          boxShadow: "0 1px 8px rgba(0,0,0,.07)",
          border: `1px solid ${t.cardBorder}`,
          flexShrink: 0,
        }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: t.greenLight,
            textTransform: "uppercase", letterSpacing: ".1em",
            marginBottom: 14, paddingLeft: 4, marginTop: 0 }}>
            Settings
          </p>

          {/* User card */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            background: t.dispenseCard, borderRadius: 10,
            padding: "10px 12px", marginBottom: 20,
            border: `1px solid ${t.border}`,
          }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%",
              overflow: "hidden", background: t.green + "22",
              flexShrink: 0, border: `2px solid ${t.green}` }}>
              {photo
                ? <img src={photo} alt="avatar"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    onError={() => setPhoto(null)} />
                : <div style={{ width: "100%", height: "100%", display: "flex",
                    alignItems: "center", justifyContent: "center",
                    fontSize: 15, fontWeight: 700, color: t.greenLight }}>
                    {initials}
                  </div>
              }
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.text,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {username || authUser.name || "Pharmacist"}
              </div>
              <div style={{ fontSize: 11, color: t.text3 }}>{roleLabel}</div>
            </div>
          </div>

          {/* Nav tabs */}
          <button style={sideTabStyle(tab === "profile")} onClick={() => setTab("profile")}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            User Profile
          </button>

          <button style={sideTabStyle(tab === "password")} onClick={() => setTab("password")}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            Password
          </button>
        </div>

        {/* ── Right content ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 20 }}>

          <div style={{
            flex: 1, background: t.cardBg,
            borderRadius: 16, padding: "36px 40px",
            boxShadow: "0 1px 8px rgba(0,0,0,.07)",
            border: `1px solid ${t.cardBorder}`,
          }}>

            {/* ══ PROFILE TAB ══ */}
            {tab === "profile" && (
              <>
                <div style={{ marginBottom: 28 }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: t.text }}>User Profile</div>
                  <div style={{ fontSize: 13, color: t.text3, marginTop: 4 }}>
                    Update your display name, email, and profile photo.
                  </div>
                </div>

                {/* Photo section */}
                <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 32 }}>
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    <div style={{ width: 90, height: 90, borderRadius: "50%",
                      overflow: "hidden", border: `3px solid ${t.green}`,
                      background: t.green + "22" }}>
                      {photo
                        ? <img src={photo} alt="Profile"
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            onError={() => setPhoto(null)} />
                        : <div style={{ width: "100%", height: "100%", display: "flex",
                            alignItems: "center", justifyContent: "center",
                            fontSize: 30, fontWeight: 700, color: t.green }}>
                            {initials}
                          </div>
                      }
                    </div>
                    {uploading && (
                      <div style={{ position: "absolute", inset: 0, borderRadius: "50%",
                        background: "rgba(0,0,0,0.45)", display: "flex",
                        alignItems: "center", justifyContent: "center" }}>
                        <div style={{ width: 24, height: 24, borderRadius: "50%",
                          border: "3px solid #fff", borderTopColor: "transparent",
                          animation: "spin 0.7s linear infinite" }} />
                      </div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: t.text, marginBottom: 10 }}>
                      Profile Photo
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                      <button type="button" onClick={() => fileRef.current?.click()}
                        disabled={uploading} style={{
                          display: "flex", alignItems: "center", gap: 6,
                          background: t.green, color: "#fff", border: "none",
                          borderRadius: 20, padding: "8px 20px",
                          fontSize: 13, fontWeight: 600,
                          cursor: uploading ? "not-allowed" : "pointer",
                          fontFamily: "inherit", opacity: uploading ? 0.7 : 1,
                        }}>
                        <UploadIcon size={14} color="#fff" />
                        {uploading ? "Uploading…" : "Change Photo"}
                      </button>
                      <button type="button" onClick={openCamera} disabled={uploading} style={{
                        display: "flex", alignItems: "center", gap: 6,
                        background: "transparent", color: t.green,
                        border: `1.5px solid ${t.green}`, borderRadius: 20,
                        padding: "8px 20px", fontSize: 13, fontWeight: 600,
                        cursor: "pointer", fontFamily: "inherit",
                      }}>
                        <CameraIcon size={14} color={t.green} />
                        Camera
                      </button>
                    </div>
                    <p style={{ fontSize: 11, color: t.text3, margin: 0 }}>
                      JPG, PNG, GIF or WEBP · Max 5 MB
                    </p>
                    <input key={photo ?? "no-photo"} ref={fileRef} type="file"
                      accept="image/*" onChange={handlePhotoUpload}
                      style={{ display: "none" }} />
                  </div>
                </div>

                {/* Fields */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr",
                  gap: "16px 24px", marginBottom: 20 }}>
                  <div>
                    <label style={labelStyle}>Username</label>
                    <input type="text" value={username}
                      onChange={e => setUsername(e.target.value)}
                      placeholder="Enter username" style={inputStyle}
                      autoComplete="off" name="profile-username"
                      onFocus={e => (e.currentTarget.style.borderColor = t.green)}
                      onBlur={e  => (e.currentTarget.style.borderColor = t.cardBorder)} />
                  </div>
                  <div>
                    <label style={labelStyle}>Email</label>
                    <input type="text" value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="Enter email" style={inputStyle}
                      autoComplete="off" name="profile-email"
                      onFocus={e => (e.currentTarget.style.borderColor = t.green)}
                      onBlur={e  => (e.currentTarget.style.borderColor = t.cardBorder)} />
                  </div>
                </div>

                <div style={{ marginBottom: 32 }}>
                  <label style={labelStyle}>Role</label>
                  <input type="text" value={roleLabel} readOnly style={{
                    ...inputStyle,
                    background: t.tableRowBorder,
                    color: t.text3, cursor: "not-allowed",
                  }} />
                </div>

                <button type="button" onClick={handleSaveProfile} disabled={saving} style={{
                  display: "flex", alignItems: "center", gap: 7,
                  background: saving ? t.greenLight : t.green,
                  color: "#fff", border: "none", borderRadius: 22,
                  padding: "11px 30px", fontSize: 13, fontWeight: 700,
                  cursor: saving ? "not-allowed" : "pointer",
                  fontFamily: "inherit", transition: "background 0.2s",
                }}>
                  {saving
                    ? <><SpinnerIcon size={13} color="#fff" /> Saving…</>
                    : <><CheckIcon size={13} color="#fff" /> Save Changes</>
                  }
                </button>
              </>
            )}

            {/* ══ PASSWORD TAB ══ */}
            {tab === "password" && (
              <>
                <div style={{ marginBottom: 28 }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: t.text }}>Change Password</div>
                  <div style={{ fontSize: 13, color: t.text3, marginTop: 4 }}>
                    Your new password must meet all the requirements on the right.
                  </div>
                </div>

                <input type="text"     name="fake-user" style={{ display: "none" }} autoComplete="username" readOnly />
                <input type="password" name="fake-pass" style={{ display: "none" }} autoComplete="new-password" readOnly />

                {([
                  { label: "Current Password",    value: currentPw, setter: setCurrentPw, show: showCur, toggle: () => setShowCur(v => !v), placeholder: "Enter current password",  ac: "current-password" },
                  { label: "New Password",         value: newPw,     setter: setNewPw,     show: showNew, toggle: () => setShowNew(v => !v), placeholder: "Enter new password",      ac: "new-password"     },
                  { label: "Confirm New Password", value: confirmPw, setter: setConfirmPw, show: showConf,toggle: () => setShowConf(v => !v),placeholder: "Confirm new password",    ac: "new-password"     },
                ] as const).map(({ label, value, setter, show, toggle, placeholder, ac }, i) => (
                  <div key={label} style={{ marginBottom: i < 2 ? 18 : 32 }}>
                    <label style={labelStyle}>{label}</label>
                    <div style={{ position: "relative" }}>
                      <input
                        type={show ? "text" : "password"}
                        name={`pw-field-${i}`}
                        autoComplete={ac}
                        value={value}
                        onChange={e => (setter as (v: string) => void)(e.target.value)}
                        placeholder={placeholder}
                        style={{ ...inputStyle, paddingRight: 44 }}
                        onFocus={e => (e.currentTarget.style.borderColor = t.green)}
                        onBlur={e  => (e.currentTarget.style.borderColor = t.cardBorder)} />
                      <button type="button" onClick={toggle} style={{
                        position: "absolute", right: 12, top: "50%",
                        transform: "translateY(-50%)",
                        border: "none", background: "none",
                        cursor: "pointer", color: t.text3, padding: 0,
                        display: "flex",
                      }}>
                        <EyeIcon visible={show} />
                      </button>
                    </div>
                  </div>
                ))}

                <button type="button" onClick={handleChangePassword}
                  disabled={pwSaving || !req.length || !req.special || !req.number || !req.match}
                  style={{
                    display: "flex", alignItems: "center", gap: 7,
                    background: t.green, color: "#fff", border: "none",
                    borderRadius: 22, padding: "11px 30px",
                    fontSize: 13, fontWeight: 700,
                    cursor: (pwSaving || !req.length || !req.special || !req.number || !req.match)
                      ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    opacity: (pwSaving || !req.length || !req.special || !req.number || !req.match) ? 0.55 : 1,
                    transition: "background 0.2s",
                  }}>
                  {pwSaving
                    ? <><SpinnerIcon size={13} color="#fff" /> Changing…</>
                    : <><LockIcon size={13} color="#fff" /> Change Password</>
                  }
                </button>
              </>
            )}
          </div>

          {/* Requirements panel */}
          {tab === "password" && (
            <div style={{
              width: 220, background: t.dispenseCard,
              borderRadius: 16, padding: "24px 20px",
              boxShadow: "0 1px 6px rgba(0,0,0,.06)",
              flexShrink: 0, border: `1px solid ${t.border}`,
              alignSelf: "flex-start",
            }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: t.text,
                textTransform: "uppercase", letterSpacing: ".08em",
                marginBottom: 16, marginTop: 0 }}>
                Requirements
              </p>
              {([
                { met: req.length,  label: "At least 8 characters" },
                { met: req.special, label: "One special char (!@#$%^&*?)" },
                { met: req.number,  label: "One number" },
                { met: req.match,   label: "Passwords match" },
              ]).map(({ met, label }) => (
                <div key={label} style={{ display: "flex", alignItems: "flex-start",
                  gap: 10, marginBottom: 14 }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                    border: `2px solid ${met ? t.green : t.border2}`,
                    background: met ? t.green : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all .2s",
                  }}>
                    {met && (
                      <svg width="8" height="8" viewBox="0 0 10 10">
                        <path d="M2 5l2.5 2.5L8 3" stroke="#fff" strokeWidth="1.8"
                          fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  <span style={{ fontSize: 12, color: met ? t.green : t.text3,
                    fontWeight: met ? 700 : 400, lineHeight: 1.4 }}>
                    {label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Camera modal ── */}
      {showCamera && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)",
          backdropFilter: "blur(4px)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: t.cardBg, borderRadius: 18, width: "100%",
            maxWidth: 480, overflow: "hidden",
            boxShadow: "0 24px 64px rgba(0,0,0,.28)" }}>
            <div style={{
              background: `linear-gradient(90deg, ${t.green} 0%, ${t.greenLight} 100%)`,
              padding: "16px 22px", display: "flex",
              alignItems: "center", justifyContent: "space-between",
            }}>
              <span style={{ color: "#fff", fontWeight: 700, fontSize: 16,
                display: "flex", alignItems: "center", gap: 8 }}>
                <CameraIcon size={16} color="#fff" />
                Take Photo
              </span>
              <button type="button" onClick={stopCamera} style={{
                border: "none", background: "rgba(255,255,255,.2)",
                color: "#fff", width: 28, height: 28, borderRadius: 7,
                cursor: "pointer", fontSize: 14,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <XIcon size={13} color="#fff" />
              </button>
            </div>
            <div style={{ padding: 16 }}>
              <video ref={videoRef} autoPlay playsInline
                style={{ width: "100%", borderRadius: 10, background: "#000", display: "block" }} />
              <canvas ref={canvasRef} style={{ display: "none" }} />
            </div>
            <div style={{ padding: "12px 22px", display: "flex",
              justifyContent: "flex-end", gap: 10,
              borderTop: `1px solid ${t.cardBorder}` }}>
              <button type="button" onClick={stopCamera} style={{
                background: t.surface2, color: t.text, border: "none",
                borderRadius: 20, padding: "8px 20px",
                fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}>Cancel</button>
              <button type="button" onClick={capturePhoto} disabled={uploading} style={{
                background: t.green, color: "#fff", border: "none",
                borderRadius: 20, padding: "8px 22px",
                fontSize: 13, fontWeight: 600,
                cursor: uploading ? "not-allowed" : "pointer",
                fontFamily: "inherit", opacity: uploading ? 0.7 : 1,
                display: "flex", alignItems: "center", gap: 6,
              }}>
                {uploading
                  ? <><SpinnerIcon size={13} color="#fff" /> Saving…</>
                  : <><CameraIcon size={13} color="#fff" /> Capture</>
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 28, right: 28, zIndex: 2000,
          background: toastType === "success" ? t.green : "#ef4444",
          color: "#fff", borderRadius: 12, padding: "12px 20px",
          fontSize: 13, fontWeight: 600, fontFamily: "inherit",
          boxShadow: "0 8px 24px rgba(0,0,0,.18)",
          display: "flex", alignItems: "center", gap: 8,
          animation: "slideUp 0.25s ease",
        }}>
          {toastType === "success"
            ? <CheckIcon size={14} color="#fff" />
            : <XIcon size={14} color="#fff" />
          }
          {toast}
        </div>
      )}

      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes slideUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
    </div>
  );
}