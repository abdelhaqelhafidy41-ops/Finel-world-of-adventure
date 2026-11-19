import React, { useState } from 'react';
import {
  ArrowLeft,
  Cloud,
  CloudDownload,
  CloudUpload,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  ShieldCheck,
  User,
  UserPlus,
  WifiOff,
  X,
} from 'lucide-react';
import type { AuthResponsePayload } from '../../../shared/accountTypes';
import type { Language } from '../../game/i18n/translations';
import { AuthService, formatAuthError } from '../../game/profile/AuthService';
import { ProfileManager } from '../../game/profile/ProfileManager';
import { CloudSaveService } from '../../game/save/CloudSaveService';

export type AccountAuthView =
  | 'welcome'
  | 'login'
  | 'register'
  | 'forgot'
  | 'reset'
  | 'conflict';

interface AccountAuthModalProps {
  lang: Language;
  initialView?: AccountAuthView;
  isFirstLaunch?: boolean;
  onClose: () => void;
  onPlayOffline?: () => void;
  onAuthComplete?: (message?: string) => void;
}

export const AccountAuthModal: React.FC<AccountAuthModalProps> = ({
  lang,
  initialView = 'welcome',
  isFirstLaunch = false,
  onClose,
  onPlayOffline,
  onAuthComplete,
}) => {
  const isAr = lang === 'ar';
  const [view, setView] = useState<AccountAuthView>(initialView);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showResetNewPassword, setShowResetNewPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAuth, setPendingAuth] = useState<AuthResponsePayload | null>(null);

  const switchView = (nextView: AccountAuthView) => {
    setError(null);
    setShowLoginPassword(false);
    setShowRegisterPassword(false);
    setShowConfirmPassword(false);
    setShowResetNewPassword(false);
    setView(nextView);
  };

  const showPasswordLabel = isAr ? 'إظهار كلمة المرور' : 'Show password';
  const hidePasswordLabel = isAr ? 'إخفاء كلمة المرور' : 'Hide password';

  const finalizeCloudLogin = async (
    authRes: AuthResponsePayload,
    mode: 'auto' | 'useCloud' | 'uploadLocal',
  ) => {
    if (authRes.account) {
      ProfileManager.syncFromCloudAccount(authRes.account);
    }

    const hasCloudProgress =
      Boolean(authRes.worldSaves && authRes.worldSaves.length > 0) ||
      Boolean(
        authRes.playerSave &&
          (authRes.playerSave.progress.level > 1 ||
            authRes.playerSave.progress.xp > 0 ||
            authRes.playerSave.progress.coins > 0 ||
            authRes.playerSave.revision > 1),
      );
    const hasLocal = CloudSaveService.hasLocalData();

    if (mode === 'auto' && hasLocal && hasCloudProgress) {
      setPendingAuth(authRes);
      setView('conflict');
      return;
    }

    if (mode === 'useCloud' || (mode === 'auto' && hasCloudProgress)) {
      await CloudSaveService.downloadAndRestoreAllFromCloud();
      onAuthComplete?.(
        isAr
          ? 'تم تسجيل الدخول واستعادة بياناتك السحابية بنجاح.'
          : 'Logged in and restored your cloud save data.',
      );
      onClose();
      return;
    }

    if (mode === 'uploadLocal' || (mode === 'auto' && hasLocal && !hasCloudProgress)) {
      await CloudSaveService.uploadAllLocalDataToCloud();
      onAuthComplete?.(
        isAr
          ? 'تم تسجيل الدخول ورفع تقدمك المحلي إلى السحابة.'
          : 'Logged in and uploaded your local progress to the cloud.',
      );
      onClose();
      return;
    }

    await CloudSaveService.downloadAndRestoreAllFromCloud();
    onAuthComplete?.(
      isAr ? 'تم تسجيل الدخول إلى حسابك السحابي.' : 'Signed in to your cloud account.',
    );
    onClose();
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await AuthService.loginAccount({
        email: email.trim(),
        password,
      });
      await finalizeCloudLogin(res, 'auto');
    } catch (err) {
      setError(formatAuthError(err, lang, 'login'));
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);
    if (password.length < 8) {
      setError(
        isAr
          ? 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.'
          : 'Password must be at least 8 characters long.',
      );
      return;
    }
    if (password !== confirmPassword) {
      setError(isAr ? 'كلمتا المرور غير متطابقتين.' : 'Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await AuthService.registerAccount({
        displayName: displayName.trim(),
        email: email.trim(),
        password,
        language: lang,
      });
      if (res.account) {
        ProfileManager.syncFromCloudAccount(res.account);
      }
      if (CloudSaveService.hasLocalData()) {
        await CloudSaveService.uploadAllLocalDataToCloud();
      }
      onAuthComplete?.(
        isAr
          ? 'تم إنشاء حسابك وحفظ بياناتك على السحابة!'
          : 'Account created and linked to Cloud Save!',
      );
      onClose();
    } catch (err) {
      setError(formatAuthError(err, lang, 'register'));
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await AuthService.forgotPassword(email.trim());
      setNotice(
        res.devResetCode
          ? `${res.message} (Dev Code: ${res.devResetCode})`
          : res.message,
      );
      setView('reset');
    } catch (err) {
      setError(formatAuthError(err, lang, 'forgot'));
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const msg = await AuthService.resetPassword({
        email: email.trim(),
        code: resetCode.trim(),
        newPassword,
      });
      setNotice(msg);
      setPassword('');
      setNewPassword('');
      setResetCode('');
      setView('login');
    } catch (err) {
      setError(formatAuthError(err, lang, 'reset'));
    } finally {
      setBusy(false);
    }
  };

  const handlePlayOffline = () => {
    AuthService.markFirstLaunchPromptSeen();
    onPlayOffline?.();
    onClose();
  };

  return (
    <div
      dir={isAr ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#060d09]/82 backdrop-blur-md p-3 sm:p-6 pointer-events-auto"
      role="dialog"
      aria-modal="true"
      data-testid="account-auth-modal"
    >
      <div className="woa-surface w-full max-w-md max-h-[92dvh] flex flex-col rounded-2xl bg-[#101c16]/96 border border-[#2b4436] text-[#f2f6ef] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#162d21] border border-[#7fe094]/40 flex items-center justify-center shrink-0">
              <Cloud className="w-5 h-5 text-[#7fe094]" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display font-bold text-base sm:text-lg truncate">
                {view === 'register'
                  ? isAr
                    ? 'إنشاء حساب سحابي'
                    : 'Create Account'
                  : view === 'login'
                    ? isAr
                      ? 'تسجيل الدخول'
                      : 'Login'
                    : view === 'forgot' || view === 'reset'
                      ? isAr
                        ? 'استعادة الحساب'
                        : 'Account Recovery'
                      : view === 'conflict'
                        ? isAr
                          ? 'الحفظ السحابي أم المحلي؟'
                          : 'Cloud Save or Local Save?'
                        : isAr
                          ? 'حساب World of Adventure'
                          : 'World of Adventure Account'}
              </h2>
              <p className="text-[11px] text-[#9db1a1] truncate">
                {isAr
                  ? 'احفظ تقدمك وعوالمك بأمان على السحابة'
                  : 'Keep your progress & worlds safely backed up online'}
              </p>
            </div>
          </div>
          {!isFirstLaunch && view !== 'conflict' && (
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-[#182920] hover:bg-[#22392d] border border-white/12 flex items-center justify-center text-[#dce5d8] cursor-pointer shrink-0"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-[#2a1618] border border-[#e05a47]/45 text-xs text-[#f6d5d0]">
              {error}
            </div>
          )}
          {notice && (
            <div className="p-3 rounded-xl bg-[#13291e] border border-[#7fe094]/40 text-xs text-[#dcf5e3]">
              {notice}
            </div>
          )}

          {/* WELCOME (FIRST LAUNCH) */}
          {view === 'welcome' && (
            <div className="space-y-3" data-testid="auth-welcome-view">
              <p className="text-xs sm:text-sm text-[#c7d7cb] leading-relaxed">
                {isAr
                  ? 'سجّل الدخول أو أنشئ حساباً لحفظ مستواك ومخزونك ومهامك وعوالمك على السحابة، واستعادتها حتى بعد حذف اللعبة أو تغيير الجهاز.'
                  : 'Sign in or create an online account so your level, inventory, quests, profile, and worlds survive uninstalls and device changes.'}
              </p>

              <button
                type="button"
                data-testid="auth-open-login-btn"
                onClick={() => {
                  setError(null);
                  setView('login');
                }}
                className="w-full min-h-[46px] px-4 rounded-xl bg-[#276d46] hover:bg-[#318656] border border-[#7fe094]/60 text-white font-display font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                <span>{isAr ? 'تسجيل الدخول (LOGIN)' : 'LOGIN'}</span>
              </button>

              <button
                type="button"
                data-testid="auth-open-register-btn"
                onClick={() => {
                  setError(null);
                  setView('register');
                }}
                className="w-full min-h-[46px] px-4 rounded-xl bg-[#192b22] hover:bg-[#223a2e] border border-[#e5a93c]/50 text-[#f7d488] font-display font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
                <span>{isAr ? 'إنشاء حساب (CREATE ACCOUNT)' : 'CREATE ACCOUNT'}</span>
              </button>

              <button
                type="button"
                data-testid="auth-play-offline-btn"
                onClick={handlePlayOffline}
                className="w-full min-h-[44px] px-4 rounded-xl bg-[#0d1712] hover:bg-[#15241c] border border-white/12 text-[#b8cabd] font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <WifiOff className="w-4 h-4" />
                <span>{isAr ? 'اللعب بدون إنترنت (PLAY OFFLINE)' : 'PLAY OFFLINE'}</span>
              </button>
            </div>
          )}

          {/* LOGIN */}
          {view === 'login' && (
            <form onSubmit={handleLogin} className="space-y-3" data-testid="auth-login-form">
              <div>
                <label className="block text-xs font-semibold text-[#dce5d8] mb-1">
                  {isAr ? 'البريد الإلكتروني' : 'Email Address'}
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#7d9785] absolute top-3.5 start-3" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="explorer@example.com"
                    className="w-full min-h-[44px] ps-9 pe-3 rounded-xl bg-[#0a140f] border border-[#2f493b] focus:border-[#7fe094] focus:outline-none text-sm text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#dce5d8] mb-1">
                  {isAr ? 'كلمة المرور' : 'Password'}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#7d9785] absolute top-3.5 start-3 pointer-events-none" />
                  <input
                    type={showLoginPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    data-testid="login-password-input"
                    className="w-full min-h-[44px] ps-9 pe-11 rounded-xl bg-[#0a140f] border border-[#2f493b] focus:border-[#7fe094] focus:outline-none text-sm text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword((prev) => !prev)}
                    aria-label={showLoginPassword ? hidePasswordLabel : showPasswordLabel}
                    aria-pressed={showLoginPassword}
                    data-testid="login-password-toggle"
                    className="absolute inset-y-0 end-1 my-auto w-9 h-9 rounded-lg flex items-center justify-center text-[#9db1a1] hover:text-white active:bg-white/10 transition-colors cursor-pointer touch-manipulation"
                  >
                    {showLoginPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[46px] px-4 rounded-xl bg-[#276d46] hover:bg-[#318656] disabled:opacity-60 border border-[#7fe094]/60 text-white font-display font-bold text-sm cursor-pointer"
              >
                {busy
                  ? isAr
                    ? 'جاري تسجيل الدخول...'
                    : 'Logging in...'
                  : isAr
                    ? 'تسجيل الدخول'
                    : 'LOGIN'}
              </button>

              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  type="button"
                  onClick={() => switchView('forgot')}
                  className="text-[#e5a93c] hover:underline cursor-pointer"
                >
                  {isAr ? 'نسيت كلمة المرور؟' : 'Forgot Password?'}
                </button>
                <button
                  type="button"
                  onClick={() => switchView('register')}
                  className="text-[#7fe094] hover:underline cursor-pointer"
                >
                  {isAr ? 'إنشاء حساب جديد' : 'Create Account'}
                </button>
              </div>
            </form>
          )}

          {/* REGISTER */}
          {view === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3" data-testid="auth-register-form">
              <div>
                <label className="block text-xs font-semibold text-[#dce5d8] mb-1">
                  {isAr ? 'اسم اللاعب' : 'Display Name'}
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-[#7d9785] absolute top-3.5 start-3" />
                  <input
                    type="text"
                    required
                    minLength={3}
                    maxLength={20}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={isAr ? 'اسم المغامر' : 'AdventurerName'}
                    className="w-full min-h-[44px] ps-9 pe-3 rounded-xl bg-[#0a140f] border border-[#2f493b] focus:border-[#7fe094] focus:outline-none text-sm text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#dce5d8] mb-1">
                  {isAr ? 'البريد الإلكتروني' : 'Email Address'}
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#7d9785] absolute top-3.5 start-3" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="explorer@example.com"
                    className="w-full min-h-[44px] ps-9 pe-3 rounded-xl bg-[#0a140f] border border-[#2f493b] focus:border-[#7fe094] focus:outline-none text-sm text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#dce5d8] mb-1">
                  {isAr ? 'كلمة المرور (8 أحرف على الأقل)' : 'Password (min 8 chars)'}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#7d9785] absolute top-3.5 start-3 pointer-events-none" />
                  <input
                    type={showRegisterPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    data-testid="register-password-input"
                    className="w-full min-h-[44px] ps-9 pe-11 rounded-xl bg-[#0a140f] border border-[#2f493b] focus:border-[#7fe094] focus:outline-none text-sm text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRegisterPassword((prev) => !prev)}
                    aria-label={showRegisterPassword ? hidePasswordLabel : showPasswordLabel}
                    aria-pressed={showRegisterPassword}
                    data-testid="register-password-toggle"
                    className="absolute inset-y-0 end-1 my-auto w-9 h-9 rounded-lg flex items-center justify-center text-[#9db1a1] hover:text-white active:bg-white/10 transition-colors cursor-pointer touch-manipulation"
                  >
                    {showRegisterPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#dce5d8] mb-1">
                  {isAr ? 'تأكيد كلمة المرور' : 'Confirm Password'}
                </label>
                <div className="relative">
                  <ShieldCheck className="w-4 h-4 text-[#7d9785] absolute top-3.5 start-3 pointer-events-none" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    data-testid="register-confirm-password-input"
                    className="w-full min-h-[44px] ps-9 pe-11 rounded-xl bg-[#0a140f] border border-[#2f493b] focus:border-[#7fe094] focus:outline-none text-sm text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    aria-label={showConfirmPassword ? hidePasswordLabel : showPasswordLabel}
                    aria-pressed={showConfirmPassword}
                    data-testid="register-confirm-password-toggle"
                    className="absolute inset-y-0 end-1 my-auto w-9 h-9 rounded-lg flex items-center justify-center text-[#9db1a1] hover:text-white active:bg-white/10 transition-colors cursor-pointer touch-manipulation"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[46px] px-4 rounded-xl bg-[#276d46] hover:bg-[#318656] disabled:opacity-60 border border-[#7fe094]/60 text-white font-display font-bold text-sm cursor-pointer"
              >
                {busy
                  ? isAr
                    ? 'جاري إنشاء الحساب...'
                    : 'Creating Account...'
                  : isAr
                    ? 'إنشاء الحساب'
                    : 'CREATE ACCOUNT'}
              </button>

              <div className="text-center text-xs pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setView('login');
                  }}
                  className="text-[#9db1a1] hover:text-white cursor-pointer"
                >
                  {isAr ? 'لديك حساب بالفعل؟ تسجيل الدخول' : 'Already have an account? Login'}
                </button>
              </div>
            </form>
          )}

          {/* FORGOT PASSWORD */}
          {view === 'forgot' && (
            <form onSubmit={handleForgotPassword} className="space-y-3">
              <p className="text-xs text-[#b8cabd]">
                {isAr
                  ? 'أدخل بريدك الإلكتروني المسجل للحصول على رمز استعادة كلمة المرور.'
                  : 'Enter your registered email address to receive a password recovery code.'}
              </p>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="explorer@example.com"
                className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#0a140f] border border-[#2f493b] focus:border-[#e5a93c] focus:outline-none text-sm text-white"
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[44px] px-4 rounded-xl bg-[#2a2313] hover:bg-[#3a3019] border border-[#e5a93c]/60 text-[#f7d488] font-display font-bold text-sm cursor-pointer"
              >
                {busy
                  ? isAr
                    ? 'جاري الإرسال...'
                    : 'Sending...'
                  : isAr
                    ? 'إرسال رمز الاستعادة'
                    : 'Send Recovery Code'}
              </button>
              <button
                type="button"
                onClick={() => setView('login')}
                className="inline-flex items-center gap-1.5 text-xs text-[#9db1a1] hover:text-white cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{isAr ? 'العودة لتسجيل الدخول' : 'Back to Login'}</span>
              </button>
            </form>
          )}

          {/* RESET PASSWORD */}
          {view === 'reset' && (
            <form onSubmit={handleResetPassword} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#dce5d8] mb-1">
                  {isAr ? 'رمز الاستعادة' : 'Reset Code'}
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-[#e5a93c] absolute top-3.5 start-3" />
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value.toUpperCase())}
                    placeholder="AB12CD"
                    className="w-full min-h-[44px] ps-9 pe-3 rounded-xl bg-[#0a140f] border border-[#2f493b] focus:border-[#e5a93c] focus:outline-none text-sm font-mono-num tracking-widest text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#dce5d8] mb-1">
                  {isAr ? 'كلمة المرور الجديدة' : 'New Password'}
                </label>
                <div className="relative">
                  <input
                    type={showResetNewPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full min-h-[44px] ps-3.5 pe-11 rounded-xl bg-[#0a140f] border border-[#2f493b] focus:border-[#7fe094] focus:outline-none text-sm text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetNewPassword((prev) => !prev)}
                    aria-label={showResetNewPassword ? hidePasswordLabel : showPasswordLabel}
                    aria-pressed={showResetNewPassword}
                    className="absolute inset-y-0 end-1 my-auto w-9 h-9 rounded-lg flex items-center justify-center text-[#9db1a1] hover:text-white active:bg-white/10 transition-colors cursor-pointer touch-manipulation"
                  >
                    {showResetNewPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[44px] px-4 rounded-xl bg-[#276d46] hover:bg-[#318656] border border-[#7fe094]/60 text-white font-display font-bold text-sm cursor-pointer"
              >
                {busy
                  ? isAr
                    ? 'جاري التحديث...'
                    : 'Updating...'
                  : isAr
                    ? 'تعيين كلمة المرور الجديدة'
                    : 'Reset Password'}
              </button>
            </form>
          )}

          {/* CLOUD VS LOCAL CONFLICT / MIGRATION */}
          {view === 'conflict' && pendingAuth && (
            <div className="space-y-3" data-testid="auth-save-conflict-view">
              <p className="text-xs sm:text-sm text-[#dce5d8] leading-relaxed">
                {isAr
                  ? 'تم العثور على بيانات محفوظة محلياً وأخرى على السحابة. أي نسخة تريد استخدامها؟ (سيتم أخذ نسخة احتياطية محلية آمنة قبل الاستبدال).'
                  : 'Both local saves and cloud saves exist for this account. Which save would you like to keep? (A safe local backup is created before replacing local data.)'}
              </p>

              <div className="p-3 rounded-xl bg-[#0b1611] border border-[#274033] text-xs space-y-1">
                <div className="font-semibold text-[#7fe094]">
                  {isAr ? 'بيانات السحابة:' : 'Cloud Save:'}
                </div>
                <div className="text-[#c9d7cb]">
                  {isAr ? 'المستوى:' : 'Level:'}{' '}
                  {pendingAuth.playerSave?.progress.level ?? pendingAuth.account?.stats.level ?? 1} ·{' '}
                  {isAr ? 'العوالم:' : 'Worlds:'} {pendingAuth.worldSaves?.length ?? 0}
                </div>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await finalizeCloudLogin(pendingAuth, 'useCloud');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="w-full min-h-[46px] px-4 rounded-xl bg-[#276d46] hover:bg-[#318656] border border-[#7fe094]/60 text-white font-display font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <CloudDownload className="w-4 h-4" />
                <span>{isAr ? 'استخدام الحفظ السحابي (USE CLOUD SAVE)' : 'USE CLOUD SAVE'}</span>
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await finalizeCloudLogin(pendingAuth, 'uploadLocal');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="w-full min-h-[46px] px-4 rounded-xl bg-[#2a2313] hover:bg-[#3a3019] border border-[#e5a93c]/60 text-[#f7d488] font-display font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <CloudUpload className="w-4 h-4" />
                <span>{isAr ? 'رفع الحفظ المحلي (UPLOAD LOCAL SAVE)' : 'UPLOAD LOCAL SAVE'}</span>
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPendingAuth(null);
                  onClose();
                }}
                className="w-full min-h-[42px] px-4 rounded-xl bg-[#182920] hover:bg-[#22392d] border border-white/12 text-xs font-semibold text-[#dce5d8] cursor-pointer"
              >
                {isAr ? 'إلغاء (CANCEL)' : 'CANCEL'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
