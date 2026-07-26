'use client'
import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, ArrowLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import styles from '../components/warehouse.module.css'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const handleChange = async () => {
    setError('')
    if (!newPassword || !confirmPassword) { setError('Please fill in all fields.'); return }
    if (newPassword.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (!/[!@#$%^&*?]/.test(newPassword)) { setError('Password must have a special character.'); return }
    if (!/[0-9]/.test(newPassword)) { setError('Password must have a number.'); return }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return }

    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError('No active session. Please login first.'); setLoading(false); return }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) { setError(`Error: ${updateError.message}`); setLoading(false); return }

      showToast('Password changed successfully!')
      setTimeout(() => router.push('/'), 2000)
    } catch { setError('Something went wrong. Please try again.') }
    setLoading(false)
  }

  return (
    <div className={styles.authPage}>
      <div className={styles.authLeft}>
        <div className={styles.authLeftOverlay} />
        <img src="https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800" alt="Medical" className={styles.authLeftImg} />
        <div className={styles.authLeftText}>
          <p className={styles.authLeftSub}>Welcome to</p>
          <p className={styles.authLeftTitle}>SMART<span>RHU</span></p>
          <p className={styles.authLeftCaption}>Inventory and Patient Management</p>
        </div>
      </div>

      <div className={styles.authRight}>
        <div className={styles.authLogo}>
          <Image src="/logo.jpg" alt="Logo" width={80} height={80} className={styles.authLogoImg} />
          <p className={styles.authLogoSub}>Rural Healthcare Unit Lopez, Quezon</p>
        </div>

        <div className={styles.authForm}>
          <div className={styles.authDivider} />
          <p className={styles.authTitle}>Forgot Password</p>

          <div className={styles.authField}>
            <label className={styles.authLabel}>Current Password:</label>
            <input type="password" className={styles.authInput} value="placeholder" disabled />
          </div>

          <div className={styles.authField}>
            <label className={styles.authLabel}>New Password:</label>
            <div className={styles.authInputWrap}>
              <input
                type={showNew ? 'text' : 'password'}
                className={styles.authInput}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
              />
              <button className={styles.authEye} onClick={() => setShowNew(!showNew)}>
                {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className={styles.authField}>
            <label className={styles.authLabel}>Confirm Password:</label>
            <div className={styles.authInputWrap}>
              <input
                type={showConfirm ? 'text' : 'password'}
                className={styles.authInput}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
              />
              <button className={styles.authEye} onClick={() => setShowConfirm(!showConfirm)}>
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className={styles.conditionsBox}>
            <p className={styles.conditionsTitle}>Conditions:</p>
            <div className={`${styles.conditionItem} ${newPassword.length >= 8 ? styles.conditionMet : ''}`}>
              <span>{newPassword.length >= 8 ? '✓' : '•'}</span> Must be 8 characters at least.
            </div>
            <div className={`${styles.conditionItem} ${/[!@#$%^&*?]/.test(newPassword) ? styles.conditionMet : ''}`}>
              <span>{/[!@#$%^&*?]/.test(newPassword) ? '✓' : '•'}</span> Must have special characters (!@#$%^&*?).
            </div>
            <div className={`${styles.conditionItem} ${/[0-9]/.test(newPassword) ? styles.conditionMet : ''}`}>
              <span>{/[0-9]/.test(newPassword) ? '✓' : '•'}</span> Must have a number.
            </div>
          </div>

          {error && <div className={styles.authError}>{error}</div>}

          <button className={styles.authSignIn} style={{ background: '#991b1b' }} onClick={handleChange} disabled={loading}>
            {loading ? 'Changing...' : 'Change Password'}
          </button>

          <button className={styles.authBack} onClick={() => router.push('/')}>
            <ArrowLeft size={13} /> Return to Access Point
          </button>
        </div>

        <p className={styles.authFooter}>RHU Lopez Quezon © 2026<br />Department of Health – Philippines</p>
      </div>

      {toast && <div className={styles.toast}>✓ {toast}</div>}
    </div>
  )
}