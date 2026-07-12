'use client'
import { useState, useEffect, useRef } from 'react'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import Image from 'next/image'
import { User, Lock, Eye, EyeOff, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type SettingsTab = 'profile' | 'password'

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile')
  const [photo, setPhoto] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const userId = typeof window !== 'undefined' ? localStorage.getItem('userId') : null

  useEffect(() => {
    fetchProfile()
  }, [])

  const fetchProfile = async () => {
    if (!userId) return

    const { data, error } = await supabase
      .from('users')
      .select('username, email, avatar_url')
      .eq('user_id', userId)
      .single()

    if (data) {
      setUsername(data.username || '')
      setEmail(data.email || '')
      if (data.avatar_url) {
        setPhoto(data.avatar_url)
      }
    }
  }

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast(msg)
    setToastType(type)
    setTimeout(() => setToast(''), 3000)
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0]
  if (!file || !userId) return

  setUploading(true)

  try {
    const fileExt = file.name.split('.').pop()
    const filePath = `${userId}/avatar.${fileExt}`

    console.log('Uploading to path:', filePath)
    console.log('File:', file.name, file.size, file.type)

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file, { upsert: true })

    console.log('Upload result:', uploadData, uploadError)

    if (uploadError) {
      console.error('Upload error details:', uploadError)
      showToast(`Error: ${uploadError.message}`, 'error')
      setUploading(false)
      return
    }

    const { data: urlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath)

    console.log('Public URL:', urlData.publicUrl)

    const { error: updateError } = await supabase
      .from('users')
      .update({ avatar_url: urlData.publicUrl })
      .eq('user_id', userId)

    console.log('Update error:', updateError)

    if (updateError) {
      showToast(`Error saving photo: ${updateError.message}`, 'error')
      setUploading(false)
      return
    }

    setPhoto(urlData.publicUrl)
    localStorage.setItem('userAvatar', urlData.publicUrl)
    window.dispatchEvent(new Event('avatarUpdated'))
    showToast('Photo uploaded successfully!', 'success')

  } catch (err) {
    console.error('Caught error:', err)
    showToast('Something went wrong!', 'error')
  }
  setUploading(false)
}

  const handleSaveProfile = async () => {
    if (!username || !email) {
      showToast('Please fill in all fields.', 'error')
      return
    }
    if (!userId) return

    const { error } = await supabase
      .from('users')
      .update({ username, email })
      .eq('user_id', userId)

    if (error) {
      showToast('Error saving profile!', 'error')
      return
    }

    // Update localStorage
    localStorage.setItem('userName', username)
    localStorage.setItem('userEmail', email)

    // Dispatch event so Topbar updates immediately
    window.dispatchEvent(new Event('profileUpdated'))

    showToast('Profile saved successfully!', 'success')
  }

  const validatePassword = () => {
    if (!currentPassword) return 'Please enter your current password.'
    if (newPassword.length < 8) return 'Password must be at least 8 characters.'
    if (!/[!@#$%^&*?]/.test(newPassword)) return 'Password must have a special character (!@#$%^&*?).'
    if (!/[0-9]/.test(newPassword)) return 'Password must have a number.'
    if (newPassword !== confirmPassword) return 'Passwords do not match.'
    return null
  }

  const handleChangePassword = async () => {
    const error = validatePassword()
    if (error) {
      showToast(error, 'error')
      return
    }

    // Verify current password by re-authenticating
    const userEmail = localStorage.getItem('userEmail') || ''
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: userEmail,
      password: currentPassword,
    })

    if (signInError) {
      showToast('Current password is incorrect.', 'error')
      return
    }

    // Update password via Supabase Auth
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    })

    if (updateError) {
      showToast('Error changing password!', 'error')
      return
    }

    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    showToast('Password changed successfully!', 'success')
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-[#0f1410]">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Topbar />
        <main className="p-5 overflow-y-auto bg-gray-50 dark:bg-[#0f1410]">
          <div className="flex gap-4 h-full">

            {/* Settings Sidebar */}
            <div className="w-52 flex-shrink-0 bg-green-800 dark:bg-[#0d3d1a] rounded-2xl p-5 flex flex-col">
              <h2 className="text-xl font-medium text-white mb-6">Settings</h2>
              <nav className="flex flex-col gap-2">
                <button
                  onClick={() => setActiveTab('profile')}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors text-left
                    ${activeTab === 'profile'
                      ? 'bg-white/20 text-white'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                  <User size={16} />
                  User Profile
                </button>
                <button
                  onClick={() => setActiveTab('password')}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors text-left
                    ${activeTab === 'password'
                      ? 'bg-white/20 text-white'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                  <Lock size={16} />
                  Password
                </button>
              </nav>
            </div>

            {/* Content Area */}
            <div className="flex-1 bg-green-50 dark:bg-[#161d17] border border-gray-200 dark:border-[#2a3a2a] rounded-2xl p-8">

              {/* User Profile Tab */}
              {activeTab === 'profile' && (
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-[#7aba7a] mb-6">User Profile</p>

                  <div className="flex flex-col items-center mb-6">
                    <div className="w-36 h-36 rounded-full bg-gray-200 dark:bg-[#2a3a2a] flex items-center justify-center overflow-hidden mb-3 border-2 border-gray-300 dark:border-[#3a4a3a]">
                      {photo ? (
                        <img src={photo} alt="Profile" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-gray-500 dark:text-[#4a6a4a] text-sm font-medium">PHOTO</span>
                      )}
                    </div>
                    <button
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading}
                      className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-[#2a3a2a] rounded-lg text-xs text-gray-600 dark:text-[#9ab89a] hover:bg-white dark:hover:bg-[#1e2e1e] transition-colors disabled:opacity-60">
                      <Upload size={13} />
                      {uploading ? 'Uploading...' : 'Upload Photo'}
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                  </div>

                  <div className="max-w-md mx-auto flex flex-col gap-4">
                    <div className="flex items-center gap-4">
                      <label className="text-sm text-gray-600 dark:text-[#9ab89a] w-24 flex-shrink-0 text-right">Username:</label>
                      <input
                        type="text"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        className="flex-1 border border-gray-300 dark:border-[#2a3a2a] rounded-lg px-3 py-1.5 text-sm outline-none bg-white dark:bg-[#0f1410] text-gray-700 dark:text-[#9ab89a] focus:border-green-600 transition-colors"
                      />
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="text-sm text-gray-600 dark:text-[#9ab89a] w-24 flex-shrink-0 text-right">Email:</label>
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        className="flex-1 border border-gray-300 dark:border-[#2a3a2a] rounded-lg px-3 py-1.5 text-sm outline-none bg-white dark:bg-[#0f1410] text-gray-700 dark:text-[#9ab89a] focus:border-green-600 transition-colors"
                      />
                    </div>
                    <div className="flex justify-end mt-2">
                      <button
                        onClick={handleSaveProfile}
                        className="px-8 py-2 bg-green-800 dark:bg-[#0d3d1a] hover:bg-green-700 text-white text-sm font-medium rounded-full transition-colors">
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Password Tab */}
              {activeTab === 'password' && (
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-[#7aba7a] mb-6">Password</p>

                  <div className="max-w-lg mx-auto">
                    <div className="bg-gray-100 dark:bg-[#1a2a1a] rounded-2xl p-6 flex flex-col gap-5 mb-6">

                      <div>
                        <label className="text-sm text-gray-600 dark:text-[#9ab89a] mb-1.5 block">Current Password:</label>
                        <input
                          type="password"
                          value={currentPassword}
                          onChange={e => setCurrentPassword(e.target.value)}
                          className="w-full border border-gray-300 dark:border-[#2a3a2a] rounded-lg px-3 py-2 text-sm outline-none bg-white dark:bg-[#0f1410] text-gray-700 dark:text-[#9ab89a] focus:border-green-600 transition-colors"
                        />
                      </div>

                      <div>
                        <label className="text-sm text-gray-600 dark:text-[#9ab89a] mb-1.5 block">New Password:</label>
                        <div className="relative">
                          <input
                            type={showNew ? 'text' : 'password'}
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            className="w-full border border-gray-300 dark:border-[#2a3a2a] rounded-lg px-3 py-2 pr-10 text-sm outline-none bg-white dark:bg-[#0f1410] text-gray-700 dark:text-[#9ab89a] focus:border-green-600 transition-colors"
                          />
                          <button type="button" onClick={() => setShowNew(!showNew)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-[#9ab89a] transition-colors">
                            {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="text-sm text-gray-600 dark:text-[#9ab89a] mb-1.5 block">Confirm Password:</label>
                        <div className="relative">
                          <input
                            type={showConfirm ? 'text' : 'password'}
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            className="w-full border border-gray-300 dark:border-[#2a3a2a] rounded-lg px-3 py-2 pr-10 text-sm outline-none bg-white dark:bg-[#0f1410] text-gray-700 dark:text-[#9ab89a] focus:border-green-600 transition-colors"
                          />
                          <button type="button" onClick={() => setShowConfirm(!showConfirm)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-[#9ab89a] transition-colors">
                            {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </div>

                      <div className="text-xs text-gray-500 dark:text-[#7a9a7a]">
                        <p className="mb-1 font-medium">Conditions:</p>
                        <ul className="flex flex-col gap-1 pl-3">
                          <li className={`flex items-center gap-1.5 ${newPassword.length >= 8 ? 'text-green-600' : ''}`}>
                            <span>{newPassword.length >= 8 ? '✓' : '•'}</span> Must be 8 characters at least.
                          </li>
                          <li className={`flex items-center gap-1.5 ${/[!@#$%^&*?]/.test(newPassword) ? 'text-green-600' : ''}`}>
                            <span>{/[!@#$%^&*?]/.test(newPassword) ? '✓' : '•'}</span> Must have special characters e.g (!,@,#,$,%,&,*?).
                          </li>
                          <li className={`flex items-center gap-1.5 ${/[0-9]/.test(newPassword) ? 'text-green-600' : ''}`}>
                            <span>{/[0-9]/.test(newPassword) ? '✓' : '•'}</span> Must have a number.
                          </li>
                        </ul>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        onClick={handleChangePassword}
                        className="px-8 py-2 bg-green-800 dark:bg-[#0d3d1a] hover:bg-green-700 text-white text-sm font-medium rounded-full transition-colors">
                        Change
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 text-white text-sm px-6 py-3 rounded-full shadow-lg z-50 transition-all
          ${toastType === 'success' ? 'bg-green-700' : 'bg-red-500'}`}>
          {toastType === 'success' ? '✓' : '✕'} {toast}
        </div>
      )}
    </div>
  )
}