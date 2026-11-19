import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Cloud,
  CloudOff,
  Copy,
  Edit3,
  KeyRound,
  LogIn,
  LogOut,
  RefreshCw,
  Settings,
  Shield,
  Trash2,
  X,
} from 'lucide-react';
import type { AvatarConfig, FavoriteGameMode } from '../../../shared/profileTypes';
import type { Language } from '../../game/i18n/translations';
import { copyTextToClipboard } from '../../game/multiplayer/inviteUtils';
import { AuthService } from '../../game/profile/AuthService';
import { ProfileManager } from '../../game/profile/ProfileManager';
import { CloudSaveService } from '../../game/save/CloudSaveService';
import { AvatarBadge } from './AvatarBadge';
import { AvatarPickerModal } from './AvatarPickerModal';

type AccountTab = 'overview' | 'edit' | 'settings';

interface AccountCloudModalProps {
  lang: Language;
  onClose: () => void;
  onOpenAuthModal: () => void;
  onCloudRestored?: () => void;
  onNotice?: (msg: string) => void;
}

export const AccountCloudModal: React.FC<AccountCloudModalProps> = ({
  lang,
  onClose,
  onOpenAuthModal,
  onCloudRestored,
  onNotice,
}) => {
  const isAr = lang === 'ar';
  const [tab, setTab] = useState<AccountTab>('overview');
  const [account, setAccount] = useState(() => AuthService.getCloudAccount());
  const [isCloudSignedIn, setIsCloudSignedIn] = useState(() =>
    AuthService.isSignedInCloudAccount(),
  );
  const [profileSnap, setProfileSnap] = useState(() => ProfileManager.getSnapshot());
  const [syncSnap, setSyncSnap] = useState(() => CloudSaveService.getSnapshot());

  // Edit profile state
  const [draftName, setDraftName] = useState(
    account?.displayName ?? profileSnap.profile?.displayName ?? '',
  );
  const [draftBio, setDraftBio] = useState(
    account?.bio ?? profileSnap.profile?.bio ?? '',
  );
  const [draftCountry, setDraftCountry] = useState(
    account?.country ?? profileSnap.profile?.country ?? '',
  );
  const [draftMode, setDraftMode] = useState<FavoriteGameMode>(
    account?.favoriteGameMode ?? profileSnap.profile?.favoriteGameMode ?? 'normal',
  );
  const [draftAvatar, setDraftAvatar] = useState<AvatarConfig>(
    account?.avatar ??
      profileSnap.profile?.avatar ?? { kind: 'preset', value: 'ranger', color: '#10b981' },
  );
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);

  // Change password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Delete account confirmation state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    const unsubAuth = AuthService.subscribe(() => {
      setAccount(AuthService.getCloudAccount());
      setIsCloudSignedIn(AuthService.isSignedInCloudAccount());
    });
    const unsubProf = ProfileManager.subscribe((s) => setProfileSnap(s));
    const unsubSync = CloudSaveService.subscribe((s) => setSyncSnap(s));
    return () => {
      unsubAuth();
      unsubProf();
      unsubSync();
    };
  }, []);

  const displayProfile = account
    ? {
        displayName: account.displayName,
        publicProfileId: account.publicProfileId,
        playerTag: account.playerTag,
        avatar: account.avatar,
        stats: account.stats,
        email: account.email,
      }
    : profileSnap.profile
      ? {
          displayName: profileSnap.profile.displayName,
          publicProfileId: profileSnap.profile.publicProfileId,
          playerTag: profileSnap.profile.playerTag,
          avatar: profileSnap.profile.avatar,
          stats: profileSnap.profile.stats,
          email: null,
        }
      : null;

  const syncBadge = (() => {
    if (!isCloudSignedIn) {
      return {
        label: isAr ? 'حساب محلي (غير مرتبط بالسحابة)' : 'Offline Local Profile',
        cls: 'bg-[#272011] border-[#e5a93c]/45 text-[#f7d488]',
        icon: <CloudOff className="w-3.5 h-3.5" />,
      };
    }
    switch (syncSnap.state) {
      case 'syncing':
        return {
          label: isAr ? 'جاري المزامنة...' : 'Syncing...',
          cls: 'bg-[#2b2514] border-[#e5a93c]/45 text-[#f7d488]',
          icon: <RefreshCw className="w-3.5 h-3.5 animate-spin" />,
        };
      case 'offline':
        return {
          label: isAr ? 'غير متصل بالإنترنت' : 'Offline',
          cls: 'bg-[#1f2421] border-white/15 text-[#b5c2b9]',
          icon: <CloudOff className="w-3.5 h-3.5" />,
        };
      case 'failed':
      case 'conflict':
        return {
          label: isAr ? 'فشلت المزامنة' : 'Sync Failed',
          cls: 'bg-[#2a1618] border-[#e05a47]/45 text-[#f4b1a7]',
          icon: <AlertTriangle className="w-3.5 h-3.5" />,
        };
      default:
        return {
          label: isAr ? 'تم الحفظ السحابي' : 'Cloud Saved',
          cls: 'bg-[#173222] border-[#7fe094]/45 text-[#9ef0b0]',
          icon: <Cloud className="w-3.5 h-3.5" />,
        };
    }
  })();

  const handleSyncNow = async () => {
    if (!isCloudSignedIn || busy) return;
    setFeedback(null);
    setBusy(true);
    try {
      const ok = await CloudSaveService.uploadAllLocalDataToCloud();
      setFeedback({
        kind: ok ? 'ok' : 'err',
        text: ok
          ? isAr
            ? 'تمت مزامنة تقدمك وعوالمك مع السحابة بنجاح.'
            : 'Progress and worlds synchronized to Cloud Save.'
          : isAr
            ? 'تعذرت المزامنة حالياً. سيتم إعادة المحاولة تلقائياً.'
            : 'Sync failed. Pending changes will retry automatically.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreFromCloud = async () => {
    if (!isCloudSignedIn || busy) return;
    setFeedback(null);
    setBusy(true);
    try {
      await CloudSaveService.downloadAndRestoreAllFromCloud();
      onCloudRestored?.();
      setFeedback({
        kind: 'ok',
        text: isAr
          ? 'تم تحميل أحدث نسخة سحابية بنجاح.'
          : 'Downloaded latest cloud save data.',
      });
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Download failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setFeedback(null);
    setBusy(true);
    try {
      if (isCloudSignedIn) {
        const updated = await AuthService.updateAccountProfile({
          displayName: draftName.trim(),
          avatar: draftAvatar,
          bio: draftBio.trim(),
          country: draftCountry.trim(),
          favoriteGameMode: draftMode,
        });
        ProfileManager.syncFromCloudAccount(updated);
      } else {
        await ProfileManager.updateProfile({
          displayName: draftName.trim(),
          avatar: draftAvatar,
          bio: draftBio.trim(),
          country: draftCountry.trim(),
          favoriteGameMode: draftMode,
        });
      }
      setFeedback({
        kind: 'ok',
        text: isAr ? 'تم تحديث الملف الشخصي بنجاح.' : 'Profile updated successfully.',
      });
      setTab('overview');
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Failed to update profile.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCloudSignedIn || busy) return;
    setFeedback(null);
    setBusy(true);
    try {
      const msg = await AuthService.changePassword({
        currentPassword,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setFeedback({ kind: 'ok', text: msg });
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Password change failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await CloudSaveService.flushPendingQueue();
      await AuthService.logoutAccount();
      CloudSaveService.resetLocalSyncState();
      onNotice?.(
        isAr
          ? 'تم تسجيل الخروج. بياناتك السحابية ما زالت محفوظة بأمان.'
          : 'Logged out. Your cloud account data remains safely stored online.',
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCloudSignedIn || busy) return;
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      setFeedback({
        kind: 'err',
        text: isAr
          ? 'اكتب كلمة DELETE للتأكيد النهائي.'
          : 'Please type DELETE to confirm permanent deletion.',
      });
      return;
    }
    setFeedback(null);
    setBusy(true);
    try {
      await AuthService.deleteAccount(deletePassword);
      CloudSaveService.resetLocalSyncState();
      ProfileManager.clearLocalProfileCache();
      onNotice?.(
        isAr
          ? 'تم حذف حسابك السحابي وبياناتك نهائياً.'
          : 'Your online account and cloud saves have been permanently deleted.',
      );
      onClose();
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Account deletion failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCopyId = async () => {
    if (!displayProfile?.publicProfileId) return;
    const ok = await copyTextToClipboard(displayProfile.publicProfileId);
    if (ok) {
      setCopiedId(true);
      window.setTimeout(() => setCopiedId(false), 1800);
    }
  };

  return (
    <div
      dir={isAr ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#060d09]/80 backdrop-blur-md p-3 sm:p-6 pointer-events-auto"
      role="dialog"
      aria-modal="true"
      data-testid="account-cloud-modal"
    >
      <div className="woa-surface w-full max-w-xl max-h-[92dvh] flex flex-col rounded-2xl bg-[#101c16]/96 border border-[#2b4436] text-[#f2f6ef] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Shield className="w-5 h-5 text-[#e5a93c] shrink-0" />
            <h2 className="font-display font-bold text-base sm:text-xl truncate">
              {isAr ? 'الحساب والملف الشخصي والحفظ السحابي' : 'ACCOUNT / PROFILE'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-[#182920] hover:bg-[#22392d] border border-white/12 flex items-center justify-center text-[#dce5d8] cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sub-Navigation */}
        <div className="px-5 pt-3 flex items-center gap-2 border-b border-white/10 pb-3">
          <button
            type="button"
            onClick={() => {
              setFeedback(null);
              setTab('overview');
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
              tab === 'overview'
                ? 'bg-[#1a3c2a] border border-[#7fe094]/60 text-[#e9f7ed]'
                : 'bg-[#0d1712] border border-white/10 text-[#9db1a1]'
            }`}
          >
            {isAr ? 'الملف والحفظ السحابي' : 'Profile & Cloud Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setFeedback(null);
              setTab('edit');
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer inline-flex items-center gap-1 ${
              tab === 'edit'
                ? 'bg-[#1a3c2a] border border-[#7fe094]/60 text-[#e9f7ed]'
                : 'bg-[#0d1712] border border-white/10 text-[#9db1a1]'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>{isAr ? 'تعديل الملف' : 'Edit Profile'}</span>
          </button>
          {isCloudSignedIn && (
            <button
              type="button"
              onClick={() => {
                setFeedback(null);
                setTab('settings');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer inline-flex items-center gap-1 ${
                tab === 'settings'
                  ? 'bg-[#2a2313] border border-[#e5a93c]/60 text-[#f7d488]'
                  : 'bg-[#0d1712] border border-white/10 text-[#9db1a1]'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>{isAr ? 'إعدادات الحساب' : 'Account Settings'}</span>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {feedback && (
            <div
              className={`p-3 rounded-xl border text-xs ${
                feedback.kind === 'err'
                  ? 'bg-[#2a1618] border-[#e05a47]/45 text-[#f6d5d0]'
                  : 'bg-[#13291e] border-[#7fe094]/40 text-[#dcf5e3]'
              }`}
            >
              {feedback.text}
            </div>
          )}

          {/* OVERVIEW TAB */}
          {tab === 'overview' && (
            <div className="space-y-4">
              {/* Identity Card */}
              <div className="p-4 rounded-xl bg-[#0b1611] border border-[#294335] flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  {displayProfile && (
                    <AvatarBadge
                      avatar={displayProfile.avatar}
                      seed={displayProfile.publicProfileId}
                      displayName={displayProfile.displayName}
                      size="md"
                      status="online"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="font-display font-bold text-base text-white truncate">
                      {displayProfile?.displayName || (isAr ? 'مغامر' : 'Adventurer')}
                    </div>
                    {displayProfile?.publicProfileId && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span dir="ltr" className="font-mono-num text-xs text-[#e5a93c]">
                          {displayProfile.publicProfileId}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleCopyId()}
                          className="p-1 rounded bg-[#16291f] text-[#9db1a1] hover:text-white cursor-pointer"
                        >
                          {copiedId ? (
                            <Check className="w-3 h-3 text-[#7fe094]" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    )}
                    {displayProfile?.email && (
                      <div dir="ltr" className="text-[11px] text-[#8fa594] truncate">
                        {displayProfile.email}
                      </div>
                    )}
                  </div>
                </div>

                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${syncBadge.cls}`}
                >
                  {syncBadge.icon}
                  <span>{syncBadge.label}</span>
                </span>
              </div>

              {/* Progression Stats */}
              {displayProfile && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="p-3 rounded-xl bg-[#0b1611] border border-white/10">
                    <div className="text-[10px] uppercase text-[#8fa594]">
                      {isAr ? 'المستوى' : 'Level'}
                    </div>
                    <div className="font-mono-num text-lg font-bold text-[#e5a93c]">
                      {displayProfile.stats.level}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#0b1611] border border-white/10">
                    <div className="text-[10px] uppercase text-[#8fa594]">XP</div>
                    <div className="font-mono-num text-lg font-bold text-[#7fe094]">
                      {displayProfile.stats.xp}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#0b1611] border border-white/10">
                    <div className="text-[10px] uppercase text-[#8fa594]">
                      {isAr ? 'المهام المكتملة' : 'Quests'}
                    </div>
                    <div className="font-mono-num text-lg font-bold text-white">
                      {displayProfile.stats.questsCompleted}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#0b1611] border border-white/10">
                    <div className="text-[10px] uppercase text-[#8fa594]">
                      {isAr ? 'الأعداء المهزومون' : 'Defeated'}
                    </div>
                    <div className="font-mono-num text-lg font-bold text-white">
                      {displayProfile.stats.enemiesDefeated}
                    </div>
                  </div>
                </div>
              )}

              {/* Cloud Save Actions */}
              {isCloudSignedIn ? (
                <div className="p-4 rounded-xl bg-[#0b1611] border border-[#294335] space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-display font-bold uppercase text-[#c9d7cb]">
                      {isAr ? 'الحفظ السحابي (CLOUD SAVE)' : 'CLOUD SAVE'}
                    </span>
                    <span className="text-[11px] text-[#8fa594]">
                      {syncSnap.lastSyncedAt
                        ? `${isAr ? 'آخر مزامنة:' : 'Last synchronized:'} ${new Date(
                            syncSnap.lastSyncedAt,
                          ).toLocaleTimeString()}`
                        : isAr
                          ? 'لم تتم المزامنة بعد'
                          : 'Not synchronized yet'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleSyncNow()}
                      data-testid="cloud-sync-now-btn"
                      className="min-h-[42px] px-3.5 rounded-xl bg-[#276d46] hover:bg-[#318656] disabled:opacity-60 border border-[#7fe094]/60 text-white text-xs font-display font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
                      <span>{isAr ? 'مزامنة الآن (SYNC NOW)' : 'SYNC NOW'}</span>
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleRestoreFromCloud()}
                      className="min-h-[42px] px-3.5 rounded-xl bg-[#182920] hover:bg-[#22392d] disabled:opacity-60 border border-white/12 text-[#dce5d8] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Cloud className="w-4 h-4 text-[#7fe094]" />
                      <span>{isAr ? 'استعادة من السحابة' : 'Restore From Cloud'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-[#17261d] border border-[#e5a93c]/45 space-y-3">
                  <p className="text-xs text-[#e8efe5] leading-relaxed">
                    {isAr
                      ? 'أنت تلعب حالياً بحفظ محلي فقط. سجّل الدخول أو أنشئ حساباً سحابياً لحماية مستواك وعوالمك من الضياع عند حذف اللعبة.'
                      : 'You are currently playing with local saves only. Sign in or create an online account to back up your level, items, quests, and worlds.'}
                  </p>
                  <button
                    type="button"
                    data-testid="account-open-auth-btn"
                    onClick={() => {
                      onClose();
                      onOpenAuthModal();
                    }}
                    className="w-full min-h-[44px] px-4 rounded-xl bg-[#276d46] hover:bg-[#318656] border border-[#7fe094]/60 text-white font-display font-bold text-sm inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>
                      {isAr
                        ? 'تسجيل الدخول / إنشاء حساب سحابي'
                        : 'LOGIN / CREATE CLOUD ACCOUNT'}
                    </span>
                  </button>
                </div>
              )}

              {isCloudSignedIn && (
                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleLogout()}
                    className="min-h-[40px] px-4 rounded-xl bg-[#182920] hover:bg-[#22392d] border border-white/12 text-xs font-semibold text-[#dce5d8] inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>{isAr ? 'تسجيل الخروج' : 'LOG OUT'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('settings')}
                    className="min-h-[40px] px-4 rounded-xl bg-[#2a1618] hover:bg-[#3a1f22] border border-[#e05a47]/40 text-xs font-semibold text-[#f4b1a7] inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>{isAr ? 'حذف الحساب' : 'DELETE ACCOUNT'}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* EDIT PROFILE TAB */}
          {tab === 'edit' && (
            <form onSubmit={handleSaveProfile} className="space-y-3">
              <div className="flex items-center gap-3">
                <AvatarBadge
                  avatar={draftAvatar}
                  seed={displayProfile?.publicProfileId || 'WA-LOCAL'}
                  displayName={draftName || 'Adventurer'}
                  size="md"
                />
                <button
                  type="button"
                  onClick={() => setAvatarPickerOpen(true)}
                  className="min-h-[40px] px-3.5 rounded-xl bg-[#182920] hover:bg-[#22392d] border border-[#345443] text-xs font-semibold text-[#dce5d8] cursor-pointer"
                >
                  {isAr ? 'تغيير الصورة الرمزية' : 'Change Avatar'}
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#dce5d8] mb-1">
                  {isAr ? 'اسم اللاعب' : 'Display Name'}
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  maxLength={20}
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl bg-[#0a140f] border border-[#2f493b] focus:border-[#7fe094] focus:outline-none text-sm text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#dce5d8] mb-1">
                  {isAr ? 'نبذة شخصية' : 'Bio'}
                </label>
                <textarea
                  rows={2}
                  maxLength={160}
                  value={draftBio}
                  onChange={(e) => setDraftBio(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#0a140f] border border-[#2f493b] focus:border-[#7fe094] focus:outline-none text-sm text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#dce5d8] mb-1">
                    {isAr ? 'الدولة / المنطقة' : 'Country / Region'}
                  </label>
                  <input
                    type="text"
                    maxLength={40}
                    value={draftCountry}
                    onChange={(e) => setDraftCountry(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-[#0a140f] border border-[#2f493b] text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#dce5d8] mb-1">
                    {isAr ? 'النمط المفضل' : 'Favorite Mode'}
                  </label>
                  <select
                    value={draftMode}
                    onChange={(e) => setDraftMode(e.target.value as FavoriteGameMode)}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-[#0a140f] border border-[#2f493b] text-sm text-white"
                  >
                    <option value="normal">Normal</option>
                    <option value="survival">Survival</option>
                    <option value="adventure">Adventure</option>
                    <option value="creative">Creative</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[44px] px-4 rounded-xl bg-[#276d46] hover:bg-[#318656] border border-[#7fe094]/60 text-white font-display font-bold text-sm cursor-pointer"
              >
                {busy
                  ? isAr
                    ? 'جاري الحفظ...'
                    : 'Saving...'
                  : isAr
                    ? 'حفظ التغييرات'
                    : 'Save Profile Changes'}
              </button>
            </form>
          )}

          {/* ACCOUNT SETTINGS TAB */}
          {tab === 'settings' && isCloudSignedIn && (
            <div className="space-y-4">
              {/* Change Password */}
              <form
                onSubmit={handleChangePassword}
                className="p-4 rounded-xl bg-[#0b1611] border border-[#274033] space-y-3"
              >
                <div className="flex items-center gap-2 font-display font-bold text-xs uppercase text-[#e5a93c]">
                  <KeyRound className="w-4 h-4" />
                  <span>{isAr ? 'تغيير كلمة المرور' : 'CHANGE PASSWORD'}</span>
                </div>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder={isAr ? 'كلمة المرور الحالية' : 'Current Password'}
                  className="w-full min-h-[40px] px-3 rounded-xl bg-[#08100c] border border-[#2f493b] text-sm text-white"
                />
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={
                    isAr ? 'كلمة المرور الجديدة (8 أحرف على الأقل)' : 'New Password (min 8 chars)'
                  }
                  className="w-full min-h-[40px] px-3 rounded-xl bg-[#08100c] border border-[#2f493b] text-sm text-white"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[40px] px-4 rounded-xl bg-[#2a2313] hover:bg-[#3a3019] border border-[#e5a93c]/60 text-xs font-display font-bold text-[#f7d488] cursor-pointer"
                >
                  {isAr ? 'تحديث كلمة المرور' : 'Update Password'}
                </button>
              </form>

              {/* Danger Zone: Delete Account */}
              <div className="p-4 rounded-xl bg-[#241214] border border-[#e05a47]/45 space-y-3">
                <div className="flex items-center gap-2 font-display font-bold text-xs uppercase text-[#f4b1a7]">
                  <AlertTriangle className="w-4 h-4 text-[#e05a47]" />
                  <span>{isAr ? 'حذف الحساب نهائياً' : 'DELETE ACCOUNT'}</span>
                </div>
                <p className="text-xs text-[#e3b8b2] leading-relaxed">
                  {isAr
                    ? 'حذف حسابك يزيل حسابك السحابي وكل التقدم والعوالم المحفوظة نهائياً ولا يمكن التراجع عنه. (حذف اللعبة من جهازك لا يحذف حسابك السحابي).'
                    : 'This permanently deletes your online account and all cloud-saved progression. This action cannot be undone. (Uninstalling the app does NOT delete your cloud account.)'}
                </p>

                {!deleteDialogOpen ? (
                  <button
                    type="button"
                    onClick={() => setDeleteDialogOpen(true)}
                    data-testid="account-delete-open-btn"
                    className="min-h-[40px] px-4 rounded-xl bg-[#4a1c20] hover:bg-[#61242a] border border-[#e05a47]/60 text-xs font-display font-bold text-white cursor-pointer"
                  >
                    {isAr ? 'حذف حسابي نهائياً' : 'Delete My Account'}
                  </button>
                ) : (
                  <form onSubmit={handleDeleteAccount} className="space-y-2.5 pt-1">
                    <div className="text-xs font-bold text-white">
                      {isAr ? 'هل أنت متأكد من حذف حسابك؟' : 'Delete your account?'}
                    </div>
                    <input
                      type="password"
                      required
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                      placeholder={isAr ? 'أدخل كلمة المرور للتأكيد' : 'Enter your password'}
                      className="w-full min-h-[40px] px-3 rounded-xl bg-[#120a0b] border border-[#e05a47]/45 text-sm text-white"
                    />
                    <input
                      type="text"
                      required
                      dir="ltr"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder='Type "DELETE" to confirm'
                      className="w-full min-h-[40px] px-3 rounded-xl bg-[#120a0b] border border-[#e05a47]/45 text-sm font-mono-num text-white"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={busy}
                        data-testid="account-delete-confirm-btn"
                        className="flex-1 min-h-[40px] px-4 rounded-xl bg-[#b9342a] hover:bg-[#d13d32] text-xs font-display font-bold text-white cursor-pointer"
                      >
                        {busy
                          ? isAr
                            ? 'جاري الحذف...'
                            : 'Deleting...'
                          : isAr
                            ? 'تأكيد الحذف النهائي'
                            : 'Permanently Delete'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteDialogOpen(false);
                          setDeletePassword('');
                          setDeleteConfirmText('');
                        }}
                        className="min-h-[40px] px-3 rounded-xl bg-[#182920] text-xs text-[#dce5d8] cursor-pointer"
                      >
                        {isAr ? 'إلغاء' : 'Cancel'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {avatarPickerOpen && (
        <AvatarPickerModal
          lang={lang}
          initialAvatar={draftAvatar}
          playerName={draftName || 'Adventurer'}
          onSelect={(av) => {
            setDraftAvatar(av);
            setAvatarPickerOpen(false);
          }}
          onClose={() => setAvatarPickerOpen(false)}
        />
      )}
    </div>
  );
};
