"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, getRouteForRole } from "@/lib/supabase";
import { useAuth, AuthUser } from "@/context/AuthContext";
import { logAction } from "@/app/utils/auditLogs";
import styles from "./login.module.css";

type Screen = "access" | "member" | "admin" | "changepass";

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

  function reset() {
    setEmail(""); setPassword(""); setError("");
    setShowPass(false); setRemember(false);
  }

  // ─────────────────────────────────────────────────────────────
  //  SIGN IN
  // ─────────────────────────────────────────────────────────────
  async function handleSignIn(e: React.FormEvent, forAdmin = false) {
    e.preventDefault();
    setError(""); setLoading(true);

    const cleanEmail = email.trim().toLowerCase();

    try {
      let userRecord: any = null;

      // 1. Try signing in directly with email
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (!authErr) {
        // Signed in with full email
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
        // 2. Try matching by email prefix (in case partial email was typed)
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

      // 2.5 Account status check — block suspended / inactive users
      const acctStatus = String(userRecord.status ?? "active").toLowerCase();
      if (acctStatus !== "active") {
        await supabase.auth.signOut();
        const reason =
          acctStatus === "suspended"
            ? "Your account has been suspended. Please contact the administrator."
            : acctStatus === "inactive"
            ? "Your account is inactive. Please contact the administrator."
            : "Your account is not active. Please contact the administrator.";
        throw new Error(reason);
      }

      // 3. Role checks
      const role = String(userRecord.role ?? "").toLowerCase();
      if (!role) throw new Error("This account has no role assigned. Contact the administrator.");
      if (forAdmin && role !== "admin") throw new Error("Access denied. Admin only.");
      if (!forAdmin && role === "admin") throw new Error("Use the Admin login instead.");

      // 4. Build auth user object
      const loggedInUser: AuthUser = {
        id:           userRecord.user_id,
        name:         `${userRecord.first_name} ${userRecord.last_name}`,
        firstName:    userRecord.first_name,
        lastName:     userRecord.last_name,
        role,
        initials:     makeInitials(userRecord.first_name, userRecord.last_name),
        email:        userRecord.email,
        isFirstLogin: userRecord.is_first_login,
      };

      login(loggedInUser);

      // 5. Audit log — success
      await logAction({
        user_name:   `${userRecord.first_name} ${userRecord.last_name}`,
        user_role:   userRecord.role,
        action:      "LOGIN",
        module:      "Auth",
        description: `${userRecord.role} logged in (${userRecord.email})`,
        status:      "success",
      });

      // 6. First-login → force password change
      if (userRecord.is_first_login) {
        setScreen("changepass");
        setLoading(false);
        return;
      }

      router.push(getRouteForRole(role));
    } catch (err: any) {
      setError(err.message ?? "Invalid credentials.");

      // Audit log — failure
      await logAction({
        user_name:   email.trim() || "Unknown",
        user_role:   "—",
        action:      "FAILED_LOGIN",
        module:      "Auth",
        description: `Failed login attempt: ${email.trim()} — ${err.message}`,
        status:      "error",
      });
    } finally {
      setLoading(false);
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
      setCpError(err.message);
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

            <button className={styles.signInBtn} type="submit" disabled={loading}>
              {loading ? "Signing in…" : "SIGN IN"}
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