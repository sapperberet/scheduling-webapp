"use client";

import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

// Lazy-load icons to avoid pulling the entire react-icons bundle into the initial client chunk
const HiCog6Tooth = dynamic(() => import('react-icons/hi2').then((m) => m.HiCog6Tooth), { ssr: false });
const HiUser = dynamic(() => import('react-icons/hi2').then((m) => m.HiUser), { ssr: false });
const HiKey = dynamic(() => import('react-icons/hi2').then((m) => m.HiKey), { ssr: false });
const HiEye = dynamic(() => import('react-icons/hi2').then((m) => m.HiEye), { ssr: false });
const HiEyeSlash = dynamic(() => import('react-icons/hi2').then((m) => m.HiEyeSlash), { ssr: false });
const HiArrowLeft = dynamic(() => import('react-icons/hi2').then((m) => m.HiArrowLeft), { ssr: false });
const HiLockClosed = dynamic(() => import('react-icons/hi2').then((m) => m.HiLockClosed), { ssr: false });
const HiExclamationTriangle = dynamic(() => import('react-icons/hi2').then((m) => m.HiExclamationTriangle), { ssr: false });
import SettingsSkeleton from '@/components/SettingsSkeleton';

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  
  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showWarning, setShowWarning] = useState(false);
  const [currentUsername, setCurrentUsername] = useState('');

  // Authentication check - show minimal UI ASAP without background fetches
  useEffect(() => {
    if (status === 'loading') return;

    if (!session || session.user?.role !== 'admin') {
      router.push('/login');
      return;
    }

    // Show current username from session immediately
    const displayName = session.user?.name || session.user?.email || 'admin';
    setCurrentUsername(displayName);

    // End the skeleton as soon as auth is validated - do NOT fetch in background
    // This prevents the 20-second delay
    setPageLoading(false);
  }, [session, status, router]);

  const validateForm = () => {
    if (!currentPassword) {
      setError('Current password is required');
      return false;
    }
    
    if (!newUsername.trim()) {
      setError('Username is required');
      return false;
    }
    
    if (!newPassword) {
      setError('New password is required');
      return false;
    }
    
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters');
      return false;
    }
    
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match');
      return false;
    }
    
    
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    if (!validateForm()) {
      return;
    }
    
    // Show warning about logout
    setShowWarning(true);
  };

  const confirmUpdate = async () => {
    setLoading(true);
    setShowWarning(false);
    
    try {
      const response = await fetch('/api/settings/update-credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword,
          newUsername,
          newPassword
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to update credentials');
      }

      // Success! Credentials updated
      setSuccess(data.message || 'Credentials updated successfully. You will be automatically logged out.');
      
      // Clear form
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      
      // Auto logout after 3 seconds
      setTimeout(() => {
        signOut({ callbackUrl: '/login' });
      }, 3000);

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An error occurred while updating credentials';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const cancelUpdate = () => {
    setShowWarning(false);
  };

  if (status === 'loading' || pageLoading) {
    return <SettingsSkeleton />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-slate-50/50 to-blue-50/30 dark:from-gray-900 dark:via-gray-900 dark:to-slate-800 py-6 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push('/')}
            className="flex items-center space-x-2 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 transition-colors mb-4"
          >
            <HiArrowLeft className="w-5 h-5" />
            <span>Back to Dashboard</span>
          </button>
          
          <div className="flex items-center space-x-3">
            <div className="h-12 w-12 bg-gradient-to-br from-blue-600 to-teal-600 rounded-xl flex items-center justify-center">
              <HiCog6Tooth className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Account Settings</h1>
              <p className="text-gray-600 dark:text-gray-400">Update your login credentials</p>
            </div>
          </div>
        </div>

        {/* Main Form */}
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 p-8">
          {/* Warning Modal */}
          {showWarning && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-2xl border border-gray-200 dark:border-gray-700 max-w-md w-full mx-4">
                <div className="text-center">
                  <div className="mx-auto h-12 w-12 bg-amber-100 dark:bg-amber-900/20 rounded-full flex items-center justify-center mb-4">
                    <HiExclamationTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    Update Credentials?
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
                    Your credentials will be updated and you will be automatically logged out. Email notifications for credential backup/recovery have been disabled.
                  </p>
                  <div className="flex space-x-3">
                    <button
                      onClick={cancelUpdate}
                      className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-600 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={confirmUpdate}
                      disabled={loading}
                      className="flex-1 px-4 py-2 text-white bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-colors disabled:opacity-50"
                    >
                      {loading ? 'Updating...' : 'Confirm'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Current Username Display */}
            {currentUsername && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                <h4 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">Current Login Information</h4>
                <div className="text-sm text-blue-800 dark:text-blue-200">
                  <strong>Current Username:</strong> <code className="bg-blue-100 dark:bg-blue-900/50 px-2 py-1 rounded text-xs">{currentUsername}</code>
                </div>
              </div>
            )}

            {/* Error/Success Messages */}
            {error && (
              <div className="bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-900/20 dark:to-rose-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 px-4 py-3 rounded-xl">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  <span className="font-medium">{error}</span>
                </div>
              </div>
            )}
            
            {success && (
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300 px-4 py-3 rounded-xl">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="font-medium">{success}</span>
                </div>
              </div>
            )}

            {/* Current Password */}
            <div>
              <label htmlFor="currentPassword" className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
                <div className="flex items-center space-x-2">
                  <HiLockClosed className="w-4 h-4" />
                  <span>Current Password</span>
                </div>
              </label>
              <div className="relative">
                <input
                  id="currentPassword"
                  type={showCurrentPassword ? 'text' : 'password'}
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white/90 dark:bg-gray-700/90 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 selection:bg-blue-200 selection:text-blue-900 dark:selection:bg-blue-700 dark:selection:text-white"
                  placeholder="Enter your current password"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  {showCurrentPassword ? <HiEyeSlash className="w-5 h-5" /> : <HiEye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* New Username */}
            <div>
              <label htmlFor="newUsername" className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
                <div className="flex items-center space-x-2">
                  <HiUser className="w-4 h-4" />
                  <span>New Username</span>
                </div>
              </label>
              <input
                id="newUsername"
                type="text"
                required
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white/90 dark:bg-gray-700/90 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 selection:bg-blue-200 selection:text-blue-900 dark:selection:bg-blue-700 dark:selection:text-white"
                placeholder="Enter new username"
              />
            </div>

            {/* New Password */}
            <div>
              <label htmlFor="newPassword" className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
                <div className="flex items-center space-x-2">
                  <HiKey className="w-4 h-4" />
                  <span>New Password</span>
                </div>
              </label>
              <div className="relative">
                <input
                  id="newPassword"
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white/90 dark:bg-gray-700/90 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 selection:bg-blue-200 selection:text-blue-900 dark:selection:bg-blue-700 dark:selection:text-white"
                  placeholder="Enter new password (minimum 6 characters)"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  {showNewPassword ? <HiEyeSlash className="w-5 h-5" /> : <HiEye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
                <div className="flex items-center space-x-2">
                  <HiKey className="w-4 h-4" />
                  <span>Confirm New Password</span>
                </div>
              </label>
              <div className="relative">
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white/90 dark:bg-gray-700/90 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 selection:bg-blue-200 selection:text-blue-900 dark:selection:bg-blue-700 dark:selection:text-white"
                  placeholder="Confirm new password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  {showConfirmPassword ? <HiEyeSlash className="w-5 h-5" /> : <HiEye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Backup Email field removed - email functionality disabled */}

            {/* Submit Button */}
            <div className="pt-4">
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-4 px-6 border border-transparent text-base font-semibold rounded-xl text-white transition-all duration-300 shadow-lg hover:shadow-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                <div className="flex items-center space-x-2">
                  <HiCog6Tooth className="w-5 h-5" />
                  <span>Update Credentials</span>
                </div>
              </button>
            </div>
          </form>

          {/* Security Notice */}
          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
            <h4 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">Security Notice</h4>
            <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
              <li>• You will be automatically logged out after updating credentials</li>
              <li>• Use a strong password with at least 6 characters</li>
            </ul>
          </div>

          {/* Local Solver Download */}

 
          
        </div>
      </div>
    </div>
  );
}
