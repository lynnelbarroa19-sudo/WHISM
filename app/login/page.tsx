"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase, getRouteForRole } from "@/lib/supabase";
import { useAuth, AuthUser } from "@/context/AuthContext";
import { logAction } from "@/app/utils/auditLogs";
import styles from "./login.module.css";
import Captcha, { CaptchaRef } from "@/components/Captcha";
import RecaptchaWidget from "@/components/RecaptchaWidget";
import OtpInput from "@/components/OtpInput";
import type ReCAPTCHA from "react-google-recaptcha";

type Screen = "access" | "member" | "admin" | "otp" | "changepass";

function makeInitials(first: string, last: string) {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

export default function LoginPage() {
  const router = useRouter();
  const { user: authUser, login } = useAuth();

  const [screen,   setScreen]   = useState<Screen>("access");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const captchaRef = useRef<CaptchaRef>(null);
  const recaptchaRef = useRef<ReCAPTCHA>(null);

  // OTP state
  const [otpDigits, setOtpDigits] = useState<string[]>(["", "", "", ""]);
  const [otpToken,  setOtpToken]  = useState("");
  const [otpError,  setOtpError]  = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpTimer,  setOtpTimer]  = useState(0);
  const [pendingUser, setPendingUser] = useState<any>(null);
  const [pendingForAdmin, setPendingForAdmin] = useState(false);

  const [currentPw,   setCurrentPw]   = useState("");
  const [newPw,       setNewPw]       = useState("");
  const [confirmPw,   setConfirmPw]   = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew,     setShowNew]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [cpLoading,   setCpLoading]   = useState(false);
  const [cpError,     setCpError]     = useState("");

  const pwConditions = [
    { label: "Must be 8 characters at least.",                      met: newPw.length >= 8 },
    { label: "Must have special characters e.g (!,@,#,$,%,&,*?).", met: /[!@#$%&*?]/.test(newPw) },
    { label: "Must have a number.",                                 met: /\d/.test(newPw) },
  ];

  // Countdown timer for OTP resend cooldown
  useEffect(() => {
    if (otpTimer <= 0) return;
    const id = setInterval(() => setOtpTimer((t) => Math.max(0, t - 1)), 1000);
    return () => clearInterval(id);
  }, [otpTimer]);

  function reset() {
    setEmail(""); setPassword(""); setError("");
    setShowPass(false); setRemember(false);
    setCaptchaAnswer("");
    recaptchaRef.current?.reset();
    setOtpDigits(["", "", "", ""]);
    setOtpToken(""); setOtpError(""); setOtpTimer(0);
    setPendingUser(null); setPendingForAdmin(false);
  }

  // ─────────────────────────────────────────────────────────────
  //  SEND OTP
  // ─────────────────────────────────────────────────────────────
  async function sendOtp(targetEmail: string) {
    const res = await fetch("/api/otp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: targetEmail }),
    });
    const data = await res.json();
    if (!res.ok || !data.token) throw new Error(data.error ?? "Failed to send OTP.");
    setOtpToken(data.token);
    setOtpTimer(60); // 60s cooldown before resend is allowed
  }

  // ─────────────────────────────────────────────────────────────
  //  SIGN IN  (validates credentials, then triggers OTP)
  // ─────────────────────────────────────────────────────────────
  async function handleSignIn(e: React.FormEvent, forAdmin = false) {
    e.preventDefault();
    setError(""); setLoading(true);

    // 1. Verify custom image captcha
    const captchaValid = await captchaRef.current?.verify(captchaAnswer);
    if (!captchaValid) {
      setError("Incorrect captcha. Please try again.");
      captchaRef.current?.refresh();
      setCaptchaAnswer("");
      setLoading(false);
      return;
    }

    // 2. Verify Google reCAPTCHA
    const recaptchaToken = recaptchaRef.current?.getValue();
    if (!recaptchaToken) {
      setError("Please verify that you are not a robot.");
      setLoading(false);
      return;
    }
    try {
      const verifyRes = await fetch("/api/recaptcha/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: recaptchaToken }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyData.success) {
        setError("reCAPTCHA verification failed. Please try again.");
        recaptchaRef.current?.reset();
        setLoading(false);
        return;
      }
    } catch {
      setError("Could not verify reCAPTCHA. Please try again.");
      recaptchaRef.current?.reset();
      setLoading(false);
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    try {
      let userRecord: any = null;

      // 3. Try signing in directly with email
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (!authErr) {
        const { data: { user: supaUser } } = await supabase.auth.getUser();
        const { data: profile, error: pe } = await supabase
          .from("users")
          .select("*")
          .ilike("email", supaUser?.email ?? cleanEmail)
          .single();

        if (pe || !profile) {
          // Log the real reason to the console — "no rows" (PGRST116) usually
          // means either the row doesn't exist, or RLS is blocking the SELECT.
          console.error("Profile lookup failed:", pe);
          throw new Error(
            pe?.code === "PGRST116"
              ? "No matching profile found for this account. Check the users table and its RLS SELECT policy."
              : "User profile not found."
          );
        }
        userRecord = profile;
      } else {
        // 4. Try matching by email prefix (in case partial email was typed)
        const { data: list, error: qe } = await supabase
          .from("users")
          .select("*")
          .ilike("email", `${cleanEmail}%`);

        if (qe) {
          console.error("Fallback lookup failed:", qe);
          throw new Error("Database error. Check credentials.");
        }

        const found = list?.find(
          (u: any) => u.email?.split("@")[0]?.toLowerCase() === cleanEmail
        );
        if (!found) throw new Error("User not found.");

        const { error: a2 } = await supabase.auth.signInWithPassword({
          email: found.email,
          password,
        });
        if (a2) throw new Error("Incorrect password.");
        userRecord = found;
      }

      // 5. Account status check — block suspended / inactive users
      // NOTE: users_status_check constraint only allows 'active' | 'inactive'.
      // Any other value (or a missing column) falls through to the generic message.
      const acctStatus = String(userRecord.status ?? "active").toLowerCase();
      if (acctStatus !== "active") {
        await supabase.auth.signOut();
        const reason =
          acctStatus === "inactive"
            ? "Your account is inactive. Please contact the administrator."
            : "Your account is not active. Please contact the administrator.";
        throw new Error(reason);
      }

      // 6. Role checks
      const role = String(userRecord.role ?? "").toLowerCase();
      if (!role) throw new Error("This account has no role assigned. Contact the administrator.");
      if (forAdmin && role !== "admin") throw new Error("Access denied. Admin only.");
      if (!forAdmin && role === "admin") throw new Error("Use the Admin login instead.");

      // 7. Credentials valid — sign out immediately, gate access behind OTP
      await supabase.auth.signOut();
      setPendingUser(userRecord);
      setPendingForAdmin(forAdmin);

      // 8. Send the OTP email
      await sendOtp(userRecord.email);
      setOtpDigits(["", "", "", ""]);
      setOtpError("");
      setScreen("otp");
    } catch (err: any) {
      setError(err.message ?? "Invalid credentials.");
      captchaRef.current?.refresh();
      setCaptchaAnswer("");
      recaptchaRef.current?.reset();

      // Audit log — failure
      await logAction({
        user_name:   email.trim() || "Unknown",
        user_role:   forAdmin ? "admin" : "member",
        action:      "LOGIN",
        module:      "Auth",
        description: `Failed login attempt (${email.trim()}): ${err.message ?? "Invalid credentials."}`,
        status:      "failed",
      });
    } finally {
      setLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  VERIFY OTP  (completes the actual login)
  // ─────────────────────────────────────────────────────────────
  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setOtpError(""); setOtpLoading(true);

    try {
      const code = otpDigits.join("");
      if (code.length < 4) throw new Error("Please enter the full 4-digit code.");
      if (!pendingUser) throw new Error("Session expired. Please sign in again.");

      // 1. Verify the code against the server
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pendingUser.email, code, token: otpToken }),
      });
      const data = await res.json();
      if (!data.valid) throw new Error("Incorrect or expired code. Please try again.");

      // 2. Re-authenticate to restore the Supabase session
      const { error: reAuthErr } = await supabase.auth.signInWithPassword({
        email: pendingUser.email,
        password,
      });
      if (reAuthErr) throw new Error("Could not restore session. Please sign in again.");

      // 3. Build auth user object
      const loggedInUser: AuthUser = {
        id:           pendingUser.user_id,
        name:         `${pendingUser.first_name} ${pendingUser.last_name}`,
        firstName:    pendingUser.first_name,
        lastName:     pendingUser.last_name,
        role:         pendingUser.role.toLowerCase(),
        initials:     makeInitials(pendingUser.first_name, pendingUser.last_name),
        email:        pendingUser.email,
        isFirstLogin: pendingUser.is_first_login,
      };

      login(loggedInUser);

      // 4. Audit log — success
      await logAction({
        user_name:   `${pendingUser.first_name} ${pendingUser.last_name}`,
        user_role:   pendingUser.role,
        action:      "LOGIN",
        module:      "Auth",
        description: `${pendingUser.role} logged in (${pendingUser.email})`,
        status:      "success",
      });

      // 5. First-login → force password change
      if (pendingUser.is_first_login) {
        setScreen("changepass");
        setOtpLoading(false);
        return;
      }

      router.push(getRouteForRole(pendingUser.role.toLowerCase()));
    } catch (err: any) {
      setOtpError(err.message ?? "Verification failed.");
    } finally {
      setOtpLoading(false);
    }
  }

  async function handleResendOtp() {
    if (otpTimer > 0 || !pendingUser) return;
    setOtpError("");
    try {
      await sendOtp(pendingUser.email);
    } catch (err: any) {
      setOtpError(err.message ?? "Failed to resend code.");
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  CHANGE PASSWORD  (first-login flow)
  // ─────────────────────────────────────────────────────────────
  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setCpError(""); setCpLoading(true);

    try {
      if (!pwConditions.every(c => c.met))
        throw new Error("Password does not meet all conditions.");
      if (newPw !== confirmPw)
        throw new Error("Passwords do not match.");
      if (!authUser)
        throw new Error("Session expired. Please log in again.");
      if (!currentPw)
        throw new Error("Please enter your current password.");

      const userEmail = authUser.email;
      const userRole  = authUser.role;
      const userId    = authUser.id;

      // 1. Verify the current password is correct first
      const { error: verifyErr } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: currentPw,
      });
      if (verifyErr) throw new Error("Current password is incorrect.");

      // 2. Update password in Supabase Auth
      const { error: updateErr } = await supabase.auth.updateUser({ password: newPw });
      if (updateErr) throw new Error(updateErr.message);

      // 3. Update is_first_login flag in DB
      const { error: dbErr } = await supabase
        .from("users")
        .update({ is_first_login: false })
        .eq("user_id", userId);
      if (dbErr) throw new Error(`DB update failed: ${dbErr.message}`);

      // 4. Verify DB update actually saved (RLS check)
      const { data: freshProfile, error: verifyDbErr } = await supabase
        .from("users")
        .select("is_first_login")
        .eq("user_id", userId)
        .single();

      if (verifyDbErr) {
        console.error("Post-update verify failed:", verifyDbErr);
        throw new Error("Could not verify DB update. Check Supabase RLS policies (UPDATE/SELECT).");
      }
      if (freshProfile?.is_first_login === true)
        throw new Error("DB update did not save. Check Supabase RLS policies.");

      // 5. Sign out the old session
      await supabase.auth.signOut();

      // 6. Re-authenticate with NEW password
      const { error: reAuthErr } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: newPw,
      });
      if (reAuthErr) throw new Error(`Re-login failed: ${reAuthErr.message}`);

      // 7. Update AuthContext AFTER successful re-login
      login({ ...authUser, isFirstLogin: false });

      // 8. Audit log
      await logAction({
        user_name:   authUser.name,
        user_role:   authUser.role,
        action:      "CHANGE_PASSWORD",
        module:      "Auth",
        description: `${authUser.name} changed their password (first login)`,
        status:      "success",
      });

      // 9. Navigate to the correct dashboard
      router.push(getRouteForRole(userRole));
    } catch (err: any) {
      setCpError(err.message ?? "Something went wrong. Please try again.");
    } finally {
      setCpLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  UI HELPERS
  // ─────────────────────────────────────────────────────────────
  const EyeIcon = ({ open }: { open: boolean }) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2">
      {open ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );

  const HeroPanel = () => (
    <div className={styles.hero}>
      <div className={styles.heroBg} />
      <div className={styles.heroOverlay} />
      <div className={styles.heroContent}>
        <p className={styles.heroWelcome}>Welcome to</p>
        <h1 className={styles.heroTitle}>SMART<span>RHU</span></h1>
        <p className={styles.heroSub}>Inventory and Patient Management</p>
      </div>
    </div>
  );

  const LogoBlock = () => (
    <>
      <img src="/logo.jpg" alt="SMARTRHU Logo" className={styles.logo} />
      <p className={styles.logoSub}>Rural Healthcare Unit Lopez, Quezon</p>
      <div className={styles.divider} />
    </>
  );

  const Footer = () => (
    <p className={styles.footer}>
      RHU Lopez Quezon © 2026<br />Department of Health — Philippines
    </p>
  );

  // ─────────────────────────────────────────────────────────────
  //  SCREEN: ACCESS POINT
  // ─────────────────────────────────────────────────────────────
  if (screen === "access") return (
    <div className={styles.page}>
      <HeroPanel />
      <div className={styles.formPanel}>
        <div className={styles.formTop}>
          <LogoBlock />
          <p className={styles.accessTitle}>Secure Access</p>
          <p className={styles.accessSub}>Select your access type to continue</p>
          <div className={styles.accessBtns}>

            <button className={styles.accessBtn}
              onClick={() => { reset(); setScreen("member"); }}>
              <div className={styles.accessBtnIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <div className={styles.accessBtnText}>
                <span className={styles.accessBtnTitle}>MEMBER</span>
                <span className={styles.accessBtnDesc}>For Staffs</span>
              </div>
              <div className={styles.accessBtnArrow}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </button>

            <button className={styles.accessBtn}
              onClick={() => { reset(); setScreen("admin"); }}>
              <div className={styles.accessBtnIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div className={styles.accessBtnText}>
                <span className={styles.accessBtnTitle}>ADMIN</span>
                <span className={styles.accessBtnDesc}>For Administrator Only</span>
              </div>
              <div className={styles.accessBtnArrow}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </button>

          </div>
        </div>
        <Footer />
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  //  SCREEN: ENTER OTP
  // ─────────────────────────────────────────────────────────────
  if (screen === "otp") return (
    <div className={styles.page}>
      <HeroPanel />
      <div className={styles.formPanel}>
        <div className={styles.formTop}>
          <LogoBlock />
          <form className={styles.formInner} onSubmit={handleOtpSubmit}>
            <p className={styles.formRole}>Enter OTP</p>
            <p className={styles.formRoleSub}>
              We sent a 4-digit code to {pendingUser?.email ?? "your email"}
            </p>

            {otpError && (
              <div className={styles.errorBox}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {otpError}
              </div>
            )}

            <div style={{ margin: "20px 0" }}>
              <OtpInput length={4} value={otpDigits} onChange={setOtpDigits} disabled={otpLoading} />
            </div>

            <p style={{ textAlign: "center", fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
              {otpTimer > 0 ? `Resend available in ${otpTimer}s` : "Didn't get the code?"}
            </p>

            <button className={styles.signInBtn} type="submit" disabled={otpLoading}>
              {otpLoading ? "Verifying…" : "VERIFY"}
            </button>

            <button
              type="button"
              className={styles.backBtn}
              disabled={otpTimer > 0}
              onClick={handleResendOtp}
              style={{ opacity: otpTimer > 0 ? 0.5 : 1 }}
            >
              Resend OTP
            </button>

            <button
              type="button"
              className={styles.backBtn}
              onClick={() => { reset(); setScreen("access"); }}
            >
              ← Return to Access Point
            </button>
          </form>
        </div>
        <Footer />
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  //  SCREEN: CHANGE PASSWORD (first login)
  // ─────────────────────────────────────────────────────────────
  if (screen === "changepass") return (
    <div className={styles.page}>
      <HeroPanel />
      <div className={styles.formPanel}>
        <div className={styles.formTop}>
          <LogoBlock />
          <form className={styles.formInner} onSubmit={handleChangePassword}>
            <p className={styles.cpTitle}>CHANGE PASSWORD</p>
            <p className={styles.formRoleSub} style={{ marginBottom: 16 }}>
              You must set a new password before continuing.
            </p>

            {cpError && (
              <div className={styles.errorBox}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {cpError}
              </div>
            )}

            {/* Current Password */}
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Current Password:</label>
              <div className={styles.fieldWrap}>
                <input
                  className={styles.fieldInput}
                  type={showCurrent ? "text" : "password"}
                  value={currentPw}
                  onChange={e => setCurrentPw(e.target.value)}
                  required
                  style={{ paddingRight: 40 }}
                />
                <button type="button" className={styles.eyeBtn}
                  onClick={() => setShowCurrent(s => !s)}>
                  <EyeIcon open={showCurrent} />
                </button>
              </div>
            </div>

            {/* New Password */}
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>New Password:</label>
              <div className={styles.fieldWrap}>
                <input
                  className={styles.fieldInput}
                  type={showNew ? "text" : "password"}
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  required
                  style={{ paddingRight: 40 }}
                />
                <button type="button" className={styles.eyeBtn}
                  onClick={() => setShowNew(s => !s)}>
                  <EyeIcon open={showNew} />
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Confirm Password:</label>
              <div className={styles.fieldWrap}>
                <input
                  className={styles.fieldInput}
                  type={showConfirm ? "text" : "password"}
                  value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  required
                  style={{ paddingRight: 40 }}
                />
                <button type="button" className={styles.eyeBtn}
                  onClick={() => setShowConfirm(s => !s)}>
                  <EyeIcon open={showConfirm} />
                </button>
              </div>
            </div>

            {/* Password Conditions */}
            <p style={{ fontSize: 12, color: "#374151", marginBottom: 6, fontWeight: 600 }}>
              Conditions:
            </p>
            <ul className={styles.conditionList}>
              {pwConditions.map(c => (
                <li key={c.label} className={c.met ? styles.met : ""}>
                  {c.met ? "✓" : "✗"} {c.label}
                </li>
              ))}
            </ul>

            {/* Confirm match indicator */}
            {confirmPw.length > 0 && (
              <p style={{
                fontSize: 12,
                marginBottom: 8,
                color: newPw === confirmPw ? "#16a34a" : "#dc2626",
                fontWeight: 600,
              }}>
                {newPw === confirmPw ? "✓ Passwords match" : "✗ Passwords do not match"}
              </p>
            )}

            <button className={styles.cpBtn} type="submit" disabled={cpLoading}>
              {cpLoading ? "Saving…" : "CHANGE PASSWORD"}
            </button>

            <button type="button" className={styles.backBtn}
              onClick={() => {
                supabase.auth.signOut();
                setCurrentPw(""); setNewPw(""); setConfirmPw(""); setCpError("");
                setScreen("access");
              }}>
              ← Return to Access Point
            </button>
          </form>
        </div>
        <Footer />
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  //  SCREEN: MEMBER / ADMIN LOGIN
  // ─────────────────────────────────────────────────────────────
  const isAdmin = screen === "admin";
  return (
    <div className={styles.page}>
      <HeroPanel />
      <div className={styles.formPanel}>
        <div className={styles.formTop}>
          <LogoBlock />
          <form className={styles.formInner} onSubmit={(e) => handleSignIn(e, isAdmin)}>
            <p className={styles.formRole}>{isAdmin ? "ADMINISTRATOR" : "MEMBER"}</p>
            <p className={styles.formRoleSub}>Enter your credentials to proceed</p>

            {error && (
              <div className={styles.errorBox}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {error}
              </div>
            )}

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Email:</label>
              <input
                className={styles.fieldInput}
                type="text"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Password:</label>
              <div className={styles.fieldWrap}>
                <input
                  className={styles.fieldInput}
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  style={{ paddingRight: 40 }}
                />
                <button type="button" className={styles.eyeBtn}
                  onClick={() => setShowPass(s => !s)}>
                  <EyeIcon open={showPass} />
                </button>
              </div>
            </div>

            <div className={styles.rememberRow}>
              <label className={styles.rememberLabel}>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={e => setRemember(e.target.checked)}
                />
                Remember Me
              </label>
              <button type="button" className={styles.forgotBtn}
                onClick={() => router.push("/forgot-password")}>
                Forgot Password?
              </button>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Captcha:</label>
              <Captcha ref={captchaRef} />
              <input
                className={styles.fieldInput}
                type="text"
                placeholder="Enter the code above"
                value={captchaAnswer}
                onChange={e => setCaptchaAnswer(e.target.value)}
                required
                style={{ marginTop: 8 }}
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Verify:</label>
              <RecaptchaWidget ref={recaptchaRef} />
            </div>

            <button className={styles.signInBtn} type="submit" disabled={loading}>
              {loading ? "Verifying…" : "NEXT"}
            </button>

            <button type="button" className={styles.backBtn}
              onClick={() => { reset(); setScreen("access"); }}>
              ← Return to Access Point
            </button>
          </form>
        </div>
        <Footer />
      </div>
    </div>
  );
}