import React, { useEffect, useState } from 'react';
import { KeyRound, Loader2, Lock, Mail, User as UserIcon, X } from 'lucide-react';
import type { Lang } from '../i18n';
import {
  registerWithEmail,
  sendMemberPasswordReset,
  signInWithEmail,
  signInWithGoogle,
} from '../services/commerceService';

export type AuthModalMode = 'login' | 'register' | 'reset';

interface AuthModalProps {
  open: boolean;
  initialMode?: AuthModalMode;
  initialEmail?: string;
  defaultSponsorCode?: string;
  lang: Lang;
  onClose: () => void;
  onSuccess?: () => void;
}

export function AuthModal({
  open,
  initialMode = 'login',
  initialEmail = '',
  defaultSponsorCode = '',
  lang,
  onClose,
  onSuccess,
}: AuthModalProps) {
  const [mode, setMode] = useState<AuthModalMode>(initialMode);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [sponsorCode, setSponsorCode] = useState(defaultSponsorCode);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      if (initialEmail) setEmail(initialEmail);
      if (defaultSponsorCode) setSponsorCode(defaultSponsorCode);
      setErrorMsg('');
      setSuccessMsg('');
    }
  }, [open, initialMode, initialEmail, defaultSponsorCode]);

  if (!open) return null;

  const mapAuthError = (err: unknown): string => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password')) {
      return lang === 'th'
        ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง (สามารถกดรีเซ็ตรหัสผ่านได้ด้านล่าง)'
        : 'Invalid email or password. Use Reset Password below if needed.';
    }
    if (msg.includes('auth/user-not-found')) {
      return lang === 'th'
        ? 'ไม่พบบัญชีผู้ใช้สำหรับอีเมลนี้'
        : 'No account found with this email address.';
    }
    if (msg.includes('auth/email-already-in-use')) {
      return lang === 'th'
        ? 'อีเมลนี้ถูกลงทะเบียนไว้แล้ว กรุณาเข้าสู่ระบบหรือกดรีเซ็ตรหัสผ่าน'
        : 'This email is already registered. Please sign in or reset your password.';
    }
    if (msg.includes('auth/weak-password')) {
      return lang === 'th'
        ? 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร'
        : 'Password must be at least 6 characters.';
    }
    if (msg.includes('auth/operation-not-allowed')) {
      return lang === 'th'
        ? 'ยังไม่ได้เปิดใช้งานระบบ Email/Password ใน Firebase Console (Authentication → Sign-in method) กรุณาใช้ Google Login ชั่วคราวหรือเปิดใช้งานใน Firebase Console'
        : 'Email/Password sign-in is not enabled in Firebase Console yet. Enable it under Authentication → Sign-in method or sign in with Google.';
    }
    return msg;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setBusy(true);

    try {
      if (mode === 'login') {
        await signInWithEmail(email, password);
        onSuccess?.();
        onClose();
      } else if (mode === 'register') {
        await registerWithEmail(email, password, displayName, sponsorCode);
        onSuccess?.();
        onClose();
      } else {
        await sendMemberPasswordReset(email);
        setSuccessMsg(
          lang === 'th'
            ? `ส่งลิงก์รีเซ็ตรหัสผ่านไปที่ ${email.trim()} เรียบร้อยแล้ว กรุณาตรวจสอบกล่องจดหมาย (หรือโฟลเดอร์ Spam/Junk)`
            : `Password reset link sent to ${email.trim()}. Please check your inbox (and spam folder).`
        );
      }
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setBusy(true);
    try {
      await signInWithGoogle();
      onSuccess?.();
      onClose();
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-[1px]">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-slate-800" />
            <h2 className="text-base font-semibold text-slate-900">
              {mode === 'login'
                ? lang === 'th'
                  ? 'เข้าสู่ระบบสมาชิก Vela Commerce'
                  : 'Member Sign In'
                : mode === 'register'
                ? lang === 'th'
                  ? 'สมัครสมาชิกใหม่'
                  : 'Create Member Account'
                : lang === 'th'
                ? 'รีเซ็ตรหัสผ่าน (Reset Password)'
                : 'Reset Password'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="px-6 pt-4">
          <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-lg text-xs font-medium">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMsg('');
                setSuccessMsg('');
              }}
              className={`py-1.5 rounded-md transition-colors ${
                mode === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {lang === 'th' ? 'เข้าสู่ระบบ' : 'Sign In'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setErrorMsg('');
                setSuccessMsg('');
              }}
              className={`py-1.5 rounded-md transition-colors ${
                mode === 'register' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {lang === 'th' ? 'สมัครสมาชิก' : 'Register'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('reset');
                setErrorMsg('');
                setSuccessMsg('');
              }}
              className={`py-1.5 rounded-md transition-colors ${
                mode === 'reset' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {lang === 'th' ? 'ลืมรหัสผ่าน' : 'Reset'}
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {mode === 'register' && (
            <div>
              <label className="text-xs text-slate-600 block mb-1">
                {lang === 'th' ? 'ชื่อ-นามสกุลสมาชิก' : 'Member Full Name'}
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={lang === 'th' ? 'เช่น สมชาย ใจดี' : 'Full Name'}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-slate-600 block mb-1">
              {lang === 'th' ? 'อีเมล (Username)' : 'Email Address (Username)'}
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="member@email.com"
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>

          {mode !== 'reset' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-slate-600">
                  {lang === 'th' ? 'รหัสผ่าน (Password)' : 'Password'}
                </label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode('reset');
                      setErrorMsg('');
                      setSuccessMsg('');
                    }}
                    className="text-xs text-emerald-700 hover:text-emerald-800 font-medium"
                  >
                    {lang === 'th' ? 'ลืมรหัสผ่าน / Reset Password?' : 'Forgot / Reset Password?'}
                  </button>
                )}
              </div>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>
          )}

          {mode === 'register' && (
            <div>
              <label className="text-xs text-slate-600 block mb-1">
                {lang === 'th' ? 'รหัสผู้แนะนำ (ไม่บังคับ)' : 'Sponsor Referral Code (Optional)'}
              </label>
              <input
                type="text"
                value={sponsorCode}
                onChange={(e) => setSponsorCode(e.target.value)}
                placeholder="VELA-XXXXXX"
                className="w-full px-3 py-2 text-sm font-mono uppercase border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          )}

          {mode === 'reset' && (
            <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 border border-slate-200 rounded-lg p-3">
              {lang === 'th'
                ? 'กรอกอีเมลที่ใช้สมัครสมาชิก ระบบจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปยังอีเมลของคุณทันที'
                : 'Enter your registered email address and we will send a password reset link directly to your inbox.'}
            </p>
          )}

          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
              {successMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>
              {mode === 'login'
                ? lang === 'th'
                  ? 'เข้าสู่ระบบด้วย Username & Password'
                  : 'Sign In with Email & Password'
                : mode === 'register'
                ? lang === 'th'
                  ? 'สมัครสมาชิกและเข้าสู่ระบบ'
                  : 'Create Account'
                : lang === 'th'
                ? 'ส่งลิงก์ Reset Password ทางอีเมล'
                : 'Send Password Reset Email'}
            </span>
          </button>

          {mode !== 'reset' && (
            <>
              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-[11px]">
                  <span className="px-2 bg-white text-slate-500">
                    {lang === 'th' ? 'หรือ' : 'OR'}
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={handleGoogleSignIn}
                className="w-full py-2.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                {lang === 'th' ? 'เข้าสู่ระบบด้วย Google Account' : 'Continue with Google'}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
