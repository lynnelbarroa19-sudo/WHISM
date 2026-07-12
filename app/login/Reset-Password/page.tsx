"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { logAction } from "@/app/utils/auditLogs";
// login.module.css lives in app/login/ — this file is in app/login/Reset-Password/
import styles from "../login.module.css";

export default function ResetPasswordPage() {
  const router = useRouter();

  const [ready,     setReady]     = useState(false);   // recovery session detected?
  const [newPw,     setNewPw]     = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showNew,     setShowNew]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(false);

  const pwConditions = [
    { label: "Must be 8 characters at least.",                     met: newPw.length >= 8 },
    { label: "Must have special characters e.g (!,@,#,$,%,&,*?).", met: /[!@#$%&*?]/.test(newPw) },
    { label: "Must have a number.",                                met: /\d/.test(newPw) },
  ];

  // ─────────────────────────────────────────────────────────────
  //  Detect the recovery session created by the email link
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    // When the user arrives from the reset email, Supabase fires a
    // PASSWORD_RECOVERY event and establishes a temporary session.
    const { data: sub } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent) => {
        if (event === "PASSWORD_RECOVERY") setReady(true);
      }
    );

    // Also check immediately in case the event already fired.
    supabase.auth.getSession().then(
      ({ data }: { data: { session: Session | null } }) => {
        if (data.session) setReady(true);
      }
    );

    return () => sub.subscription.unsubscribe();
  }, []);

  // ─────────────────────────────────────────────────────────────
  //  UPDATE PASSWORD
  // ─────────────────────────────────────────────────────────────
  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);

    try {
      if (!pwConditions.every(c => c.met))
        throw new Error("Password does not meet all conditions.");
      if (newPw !== confirmPw)
        throw new Error("Passwords do not match.");

      // Update the password for the recovery session's user.
      const { data: updated, error: updateErr } =
        await supabase.auth.updateUser({ password: newPw });
      if (updateErr) throw new Error(updateErr.message);

      const email = updated.user?.email ?? "Unknown";

      await logAction({
        user_name:   email,
        user_role:   "—",
        action:      "RESET_PASSWORD",
        module:      "Auth",
        description: `Password reset completed for ${email}`,
        status:      "success",
      });

      // Sign out so they log in fresh with the new password.
      await supabase.auth.signOut();
      setDone(true);
    } catch (err: any) {
      setError(err.message ?? "Could not update password.");
      await logAction({
        user_name:   "Unknown",
        user_role:   "—",
        action:      "RESET_PASSWORD",
        module:      "Auth",
        description: `Failed password reset — ${err.message}`,
        status:      "error",
      });
    } finally {
      setLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  UI HELPERS  (mirror the login page)
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
  //  DONE STATE
  // ─────────────────────────────────────────────────────────────
  if (done) return (
    <div className={styles.page}>
      <HeroPanel />
      <div className={styles.formPanel}>
        <div className={styles.formTop}>
          <LogoBlock />
          <div className={styles.formInner}>
            <p className={styles.cpTitle}>PASSWORD UPDATED</p>
            <p className={styles.formRoleSub} style={{ marginBottom: 16 }}>
              Your password has been changed. Please log in with your new password.
            </p>
            <button
              type="button"
              className={styles.signInBtn}
              onClick={() => router.push("/login")}
            >
              GO TO LOGIN
            </button>
          </div>
        </div>
        <Footer />
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  //  INVALID / EXPIRED LINK
  // ─────────────────────────────────────────────────────────────
  if (!ready) return (
    <div className={styles.page}>
      <HeroPanel />
      <div className={styles.formPanel}>
        <div className={styles.formTop}>
          <LogoBlock />
          <div className={styles.formInner}>
            <p className={styles.cpTitle}>VERIFYING LINK…</p>
            <p className={styles.formRoleSub} style={{ marginBottom: 16 }}>
              If this message does not change, your reset link may be invalid or
              expired. Please request a new one.
            </p>
            <button
              type="button"
              className={styles.backBtn}
              onClick={() => router.push("/forgot-password")}
            >
              ← Request a new link
            </button>
          </div>
        </div>
        <Footer />
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  //  RESET FORM
  // ─────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <HeroPanel />
      <div className={styles.formPanel}>
        <div className={styles.formTop}>
          <LogoBlock />
          <form className={styles.formInner} onSubmit={handleUpdate}>
            <p className={styles.cpTitle}>SET NEW PASSWORD</p>
            <p className={styles.formRoleSub} style={{ marginBottom: 16 }}>
              Choose a new password for your account.
            </p>

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

            {/* Conditions */}
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

            <button className={styles.cpBtn} type="submit" disabled={loading}>
              {loading ? "Saving…" : "UPDATE PASSWORD"}
            </button>

            <button type="button" className={styles.backBtn}
              onClick={() => router.push("/login")}>
              ← Return to Login
            </button>
          </form>
        </div>
        <Footer />
      </div>
    </div>
  );
}