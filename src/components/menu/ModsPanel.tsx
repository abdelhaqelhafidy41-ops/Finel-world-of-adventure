import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Eye,
  FileArchive,
  FileWarning,
  FolderOpen,
  HardDrive,
  Info,
  Package,
  RefreshCw,
  RotateCw,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { UI_TEXT, type Language } from '../../game/i18n/translations';
import {
  getModManager,
  STANDARD_MOD_FOLDERS,
  type ModInstallStage,
  type ModRecord,
  type ModsSnapshot,
  type ModValidationStatus,
} from '../../game/mods';
import {
  requestAndroidSafFolder,
  requestAndroidStoragePermission,
} from '../../game/settings/AndroidSettingsSync';
import type { AndroidStorageStatus } from '../../utils/platformExit';

type ModFilterTab = 'installed' | 'enabled' | 'disabled';

interface ModsPanelProps {
  lang: Language;
  androidStorageStatus?: AndroidStorageStatus | null;
}

export const ModsPanel: React.FC<ModsPanelProps> = ({
  lang,
  androidStorageStatus,
}) => {
  const t = UI_TEXT[lang];
  const isRtl = lang === 'ar';
  const modManager = useMemo(() => getModManager(), []);
  const [snap, setSnap] = useState<ModsSnapshot>(() => modManager.getSnapshot());
  const [filterTab, setFilterTab] = useState<ModFilterTab>('installed');
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [confirmRemoveKey, setConfirmRemoveKey] = useState<string | null>(null);
  const [detailsEntryKey, setDetailsEntryKey] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const noticeTimerRef = useRef<number>(0);

  useEffect(() => {
    const unsub = modManager.subscribe((next) => setSnap(next));
    if (!modManager.getSnapshot().initialized) {
      void modManager.initialize();
    } else {
      void modManager.refreshMods();
    }
    return () => {
      unsub();
      window.clearTimeout(noticeTimerRef.current);
    };
  }, [modManager]);

  const selectedModForDetails = useMemo(
    () =>
      detailsEntryKey
        ? snap.mods.find((m) => m.entryKey === detailsEntryKey) ?? null
        : null,
    [detailsEntryKey, snap.mods],
  );

  useEffect(() => {
    if (!selectedModForDetails) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setDetailsEntryKey(null);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [selectedModForDetails]);

  const showTempNotice = (ok: boolean, text: string) => {
    setNotice({ ok, text });
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 3600);
  };

  const formatByteSize = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${bytes} B`;
  };

  const getInstallStageLabel = (stage: ModInstallStage): string => {
    switch (stage) {
      case 'reading':
        return t.modsStageReading;
      case 'validating':
        return t.modsStageValidating;
      case 'extracting':
        return t.modsStageExtracting;
      case 'finalizing':
        return t.modsStageFinalizing;
      case 'cleaning_up':
        return t.modsStageCleaningUp;
      case 'completed':
        return t.modsStageCompleted;
      case 'failed':
      default:
        return t.modsStageFailed;
    }
  };

  const mapImportErrorText = (rawErr?: string, detail?: string): string => {
    let base: string;
    switch (rawErr) {
      case 'INVALID_MOD_PACKAGE_NAME':
      case 'INVALID_PACKAGE_EXTENSION':
      case 'INVALID_MOD_PACKAGE_EXTENSION':
        base = t.modsErrorInvalidPackageName;
        break;
      case 'INVALID_PACKAGE_SIZE':
        base = t.modsErrorInvalidPackageSize;
        break;
      case 'PATH_TRAVERSAL_BLOCKED':
      case 'ZIP_PATH_TRAVERSAL_BLOCKED':
        base = t.modsErrorPathTraversal;
        break;
      case 'UNSAFE_EXECUTABLE_CONTENT':
        base = t.modsErrorUnsafeExecutable;
        break;
      case 'REQUIRED_FILES_MISSING':
      case 'INVALID_MOD_JSON_ROOT':
      case 'MISSING_MOD_JSON':
      case 'INVALID_MOD_ID':
      case 'MISSING_REQUIRED_FIELD':
      case 'INVALID_SEMVER_VERSION':
      case 'INVALID_SUPPORTED_GAME_VERSION':
      case 'INVALID_DEPENDENCY_DECLARATION':
        base = t.modsErrorRequiredFilesMissing;
        break;
      case 'UNSUPPORTED_GAME_VERSION':
        base = t.modsErrorUnsupportedVersion;
        break;
      case 'DUPLICATE_MOD_ID':
        base = t.modsErrorDuplicateModId;
        break;
      case 'MISSING_DEPENDENCY':
      case 'SELF_DEPENDENCY':
      case 'DEPENDENCY_NOT_ACTIVE':
        base = t.modsErrorMissingDependency;
        break;
      case 'DEPENDENCY_VERSION_MISMATCH':
        base = t.modsErrorDepMismatch;
        break;
      case 'TARGET_ALREADY_EXISTS':
        base = t.modsErrorTargetExists;
        break;
      case 'INVALID_ZIP_SIGNATURE':
      case 'CORRUPT_MOD_ARCHIVE':
      case 'CORRUPT_PACKAGE_DATA':
      case 'CORRUPT_CONTENT_JSON':
      case 'CORRUPT_ZIP_EOCD':
      case 'CORRUPT_ZIP_CENTRAL_DIR':
      case 'CORRUPT_ZIP_LOCAL_HEADER':
      case 'CORRUPT_ZIP_BOUNDS':
      case 'UNSUPPORTED_ZIP_COMPRESSION':
      case 'ZIP_BOMB_LIMIT_EXCEEDED':
      case 'MOD_TOO_MANY_FILES':
      case 'ZIP_ENTRY_TOO_LARGE':
        base = t.modsErrorCorruptPackage;
        break;
      case 'PERMISSION_REQUIRED':
        base = t.modsErrorPermissionRequired;
        break;
      default:
        base = rawErr || 'IMPORT_ERROR';
        break;
    }
    return detail && !base.includes(detail) ? `${base} (${detail})` : base;
  };

  const handleImportButtonClick = async () => {
    if (importing) return;
    if (modManager.hasNativeModPicker()) {
      setImporting(true);
      try {
        const res = await modManager.importModViaNativePicker();
        if (!res.cancelled) {
          if (res.ok) {
            showTempNotice(true, t.modsImportSuccessNotice(res.sourceId ?? 'mod'));
          } else {
            showTempNotice(
              false,
              t.modsImportErrorNotice(mapImportErrorText(res.error, res.detail)),
            );
          }
        }
      } finally {
        setImporting(false);
      }
      return;
    }

    fileInputRef.current?.click();
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const res = await modManager.importModPackage(file);
      if (res.ok) {
        showTempNotice(true, t.modsImportSuccessNotice(res.sourceId ?? file.name));
      } else {
        showTempNotice(
          false,
          t.modsImportErrorNotice(mapImportErrorText(res.error, res.detail)),
        );
      }
    } finally {
      setImporting(false);
    }
  };

  const handleReloadMods = async () => {
    if (reloading || snap.scanning) return;
    setReloading(true);
    try {
      const res = await modManager.reloadMods();
      showTempNotice(
        res.issueCount === 0,
        t.modsReloadSuccessNotice(res.reloadedCount, res.issueCount),
      );
    } finally {
      setReloading(false);
    }
  };

  const getStatusMeta = (
    status: ModValidationStatus,
  ): { label: string; badgeClass: string } => {
    switch (status) {
      case 'ready':
        return {
          label: t.modsStatusReady,
          badgeClass: 'bg-[#1e3d2b] border-[#387451] text-[#8be39f]',
        };
      case 'disabled':
        return {
          label: t.modsStatusDisabled,
          badgeClass: 'bg-[#1a2520] border-white/15 text-[#a7b9aa]',
        };
      case 'incompatible':
        return {
          label: t.modsStatusIncompatible,
          badgeClass: 'bg-[#3b2e16] border-[#d69e36]/50 text-[#f3ca6e]',
        };
      case 'missing_dependency':
        return {
          label: t.modsStatusMissingDep,
          badgeClass: 'bg-[#3b2e16] border-[#d69e36]/50 text-[#f3ca6e]',
        };
      case 'dependency_disabled':
        return {
          label: t.modsStatusDepDisabled,
          badgeClass: 'bg-[#322c19] border-[#c49940]/45 text-[#ecc674]',
        };
      case 'circular_dependency':
        return {
          label: t.modsStatusCircularDep,
          badgeClass: 'bg-[#401d1c] border-[#d1635a]/50 text-[#f29b94]',
        };
      case 'duplicate':
        return {
          label: t.modsStatusDuplicate,
          badgeClass: 'bg-[#3b2a19] border-[#d98a3f]/50 text-[#f5b472]',
        };
      case 'incomplete':
        return {
          label: t.modsStatusIncomplete,
          badgeClass: 'bg-[#3b2e16] border-[#d69e36]/50 text-[#f3ca6e]',
        };
      case 'unsafe':
        return {
          label: t.modsStatusUnsafe,
          badgeClass: 'bg-[#4a1818] border-[#e05b5b]/60 text-[#ff9c9c]',
        };
      case 'corrupted':
      default:
        return {
          label: t.modsStatusCorrupted,
          badgeClass: 'bg-[#401d1c] border-[#d1635a]/50 text-[#f29b94]',
        };
    }
  };

  const getClearStatusMessages = (mod: ModRecord): string[] => {
    const msgs: string[] = [];
    if (mod.status === 'corrupted') {
      msgs.push(t.modsClearSummaryCorruptedPackage);
    } else if (mod.status === 'incomplete' || mod.status === 'unsafe') {
      msgs.push(t.modsClearSummaryInvalidMod);
    } else if (mod.status === 'incompatible') {
      msgs.push(
        t.modsClearSummaryUnsupportedVersion(
          mod.manifest.supportedGameVersion,
          snap.gameVersion,
        ),
      );
    } else if (
      mod.status === 'missing_dependency' ||
      mod.status === 'dependency_disabled' ||
      mod.status === 'circular_dependency'
    ) {
      msgs.push(t.modsClearSummaryMissingDep);
    } else if (mod.status === 'duplicate') {
      msgs.push(t.modsClearSummaryDuplicateId);
    }
    if (mod.incompatibleAssets.length > 0) {
      msgs.push(t.modsClearSummaryIncompatibleAsset(mod.incompatibleAssets.length));
    }
    return msgs;
  };

  const canEnableMod = (mod: ModRecord): boolean => {
    if (mod.enabled) return true;
    return (
      mod.status !== 'corrupted' &&
      mod.status !== 'unsafe' &&
      mod.status !== 'duplicate' &&
      mod.status !== 'incomplete'
    );
  };

  const enabledMods = useMemo(
    () => snap.mods.filter((m) => m.enabled && m.loaded),
    [snap.mods],
  );
  const disabledMods = useMemo(
    () => snap.mods.filter((m) => !m.enabled || !m.loaded),
    [snap.mods],
  );

  const visibleMods = useMemo(() => {
    if (filterTab === 'enabled') return enabledMods;
    if (filterTab === 'disabled') return disabledMods;
    return snap.mods;
  }, [disabledMods, enabledMods, filterTab, snap.mods]);

  const issueCount = useMemo(
    () =>
      snap.mods.filter(
        (m) =>
          (m.status !== 'ready' && m.status !== 'disabled') ||
          m.incompatibleAssets.length > 0,
      ).length,
    [snap.mods],
  );

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="space-y-4" data-testid="mods-panel">
      {/* Header, Mods Directory & Primary Toolbar */}
      <div className="p-3.5 rounded-xl bg-[#0c1712] border border-white/10 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
          <div>
            <h3 className="font-display text-sm sm:text-base font-bold text-[#f4f7f1] flex items-center gap-2">
              <Package className="w-4 h-4 text-[#e5a93c]" />
              <span>{t.modsTitle}</span>
            </h3>
            <p className="text-xs text-[#9cb19e] mt-0.5 leading-relaxed">
              {t.modsSubtitle}
            </p>
          </div>
          <span
            dir="ltr"
            className="text-[11px] font-mono-num px-2.5 py-1 rounded-lg bg-[#12221a] border border-white/10 text-[#d3e2d3] self-start shrink-0"
          >
            v{snap.gameVersion}
          </span>
        </div>

        {/* Directory path + Open Mods Folder */}
        <div className="p-2.5 rounded-lg bg-[#08100c] border border-white/10 flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex items-center gap-2 text-xs text-[#c7d6c6]">
              <HardDrive className="w-3.5 h-3.5 text-[#e5a93c] shrink-0" />
              <span className="font-semibold text-[#e2ece0] shrink-0">
                {t.modsFolderLabel}:
              </span>
              <span
                dir="ltr"
                data-testid="mods-dir-path"
                className="font-mono-num text-[11px] text-[#9fb5a1] truncate"
                title={snap.modsDir}
              >
                {snap.modsDir || '...'}
              </span>
            </div>

            {snap.platform === 'electron' && (
              <button
                type="button"
                data-testid="mods-open-folder-btn"
                onClick={() => void modManager.openModsFolder()}
                className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#16281e] hover:bg-[#1e3528] border border-white/12 text-xs font-semibold text-[#e6efe3] inline-flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <FolderOpen className="w-3.5 h-3.5 text-[#e5a93c]" />
                <span>{t.modsOpenFolderBtn}</span>
              </button>
            )}
          </div>

          {snap.platform === 'android' &&
            androidStorageStatus &&
            !androidStorageStatus.writable && (
              <div className="pt-1.5 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-[#f3ca6e]">
                  {t.androidStoragePermHint}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => requestAndroidStoragePermission()}
                    className="min-h-[34px] px-3 py-1 rounded-lg bg-[#e5a93c] hover:bg-[#eeb750] text-[#111914] font-display font-bold text-[11px] cursor-pointer"
                  >
                    {t.androidStorageGrantBtn}
                  </button>
                  <button
                    type="button"
                    onClick={() => requestAndroidSafFolder()}
                    className="min-h-[34px] px-3 py-1 rounded-lg bg-[#182920] hover:bg-[#22392d] border border-white/12 text-[11px] font-semibold text-[#e6efe3] cursor-pointer"
                  >
                    {t.androidStorageChooseFolderBtn}
                  </button>
                </div>
              </div>
            )}
        </div>

        {/* Action Buttons Row: Import Mod / Refresh Mods / Reload Mods */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="px-2.5 py-1 rounded-lg bg-[#13231b] border border-white/10 text-[#dce6d9] font-medium">
              {t.modsDiscoveredLabel}:{' '}
              <strong className="font-mono-num text-[#e5a93c]">
                {snap.mods.length}
              </strong>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-[#13231b] border border-white/10 text-[#dce6d9] font-medium">
              {t.modsActiveLabel}:{' '}
              <strong className="font-mono-num text-[#7fe094]">
                {enabledMods.length}
              </strong>
            </span>
            {issueCount > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-[#2e2015] border border-[#d69e36]/40 text-[#f3ca6e] font-medium">
                {t.modsIssuesLabel}:{' '}
                <strong className="font-mono-num">{issueCount}</strong>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".woamod,application/octet-stream,application/zip"
              onChange={handleImportFileChange}
              className="hidden"
              data-testid="mods-import-input"
            />
            <button
              type="button"
              data-testid="mods-import-btn"
              disabled={importing}
              onClick={() => void handleImportButtonClick()}
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#e5a93c] hover:bg-[#eeb750] disabled:opacity-60 text-[#111914] font-display font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{t.modsImportBtn}</span>
            </button>
            <button
              type="button"
              data-testid="mods-refresh-btn"
              disabled={snap.scanning || reloading}
              onClick={() => void modManager.refreshMods()}
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#182920] hover:bg-[#22392d] disabled:opacity-60 border border-[#2f493b] text-xs font-semibold text-[#e6efe3] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-[#e5a93c] ${snap.scanning ? 'animate-spin' : ''}`}
              />
              <span>{t.modsRefreshBtn}</span>
            </button>
            <button
              type="button"
              data-testid="mods-reload-btn"
              disabled={snap.scanning || reloading}
              onClick={() => void handleReloadMods()}
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#182920] hover:bg-[#22392d] disabled:opacity-60 border border-[#2f493b] text-xs font-semibold text-[#e6efe3] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCw
                className={`w-3.5 h-3.5 text-[#7fe094] ${reloading ? 'animate-spin' : ''}`}
              />
              <span>{t.modsReloadBtn}</span>
            </button>
          </div>
        </div>

        {/* Filter Tabs: Installed / Enabled / Disabled */}
        <div
          role="tablist"
          aria-label={t.modsTitle}
          className="pt-1 grid grid-cols-3 gap-1.5"
        >
          {(
            [
              {
                id: 'installed' as const,
                label: t.modsFilterInstalled,
                count: snap.mods.length,
              },
              {
                id: 'enabled' as const,
                label: t.modsFilterEnabled,
                count: enabledMods.length,
              },
              {
                id: 'disabled' as const,
                label: t.modsFilterDisabled,
                count: disabledMods.length,
              },
            ] as const
          ).map((ft) => {
            const active = filterTab === ft.id;
            return (
              <button
                key={ft.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`mods-filter-${ft.id}`}
                onClick={() => setFilterTab(ft.id)}
                className={`min-h-[38px] px-2.5 py-1.5 rounded-xl border text-xs font-display font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#21382b] border-[#e5a93c] text-white'
                    : 'bg-[#08100c] hover:bg-[#14231b] border-white/10 text-[#b4c6b5]'
                }`}
              >
                <span className="truncate">{ft.label}</span>
                <span
                  dir="ltr"
                  className={`font-mono-num text-[11px] px-1.5 py-0.2 rounded ${
                    active ? 'bg-[#e5a93c] text-[#111914]' : 'bg-[#14241c] text-[#9fb5a1]'
                  }`}
                >
                  {ft.count}
                </span>
              </button>
            );
          })}
        </div>

        {snap.installProgress && (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(snap.installProgress.percent)}
            data-testid="mods-install-progress"
            className="p-3 rounded-xl bg-[#08100c] border border-[#e5a93c]/40 space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="min-w-0 flex items-center gap-2">
                <FileArchive className="w-4 h-4 text-[#e5a93c] shrink-0" />
                <span className="font-display font-bold text-[#f4f7f1]">
                  {t.modsInstallProgressTitle}
                </span>
                <span
                  dir="ltr"
                  className="font-mono-num text-[11px] text-[#a7bca9] truncate"
                >
                  {snap.installProgress.fileName}
                </span>
              </div>
              <span
                dir="ltr"
                className="font-mono-num text-xs font-bold text-[#e5a93c] shrink-0"
              >
                {Math.min(100, Math.max(0, Math.round(snap.installProgress.percent)))}%
              </span>
            </div>

            <div className="w-full h-2 rounded-full bg-[#13231b] overflow-hidden border border-white/10">
              <div
                className={`h-full transition-all duration-150 ${
                  snap.installProgress.stage === 'failed'
                    ? 'bg-[#c85a53]'
                    : snap.installProgress.stage === 'completed'
                      ? 'bg-[#57c478]'
                      : 'bg-[#e5a93c]'
                }`}
                style={{
                  width: `${Math.min(100, Math.max(2, Math.round(snap.installProgress.percent)))}%`,
                }}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#9fb5a1]">
              <span className="font-medium text-[#dce8dc]">
                {getInstallStageLabel(snap.installProgress.stage)}
              </span>
              <div dir="ltr" className="flex items-center gap-2 font-mono-num">
                {snap.installProgress.totalBytes > 0 && (
                  <span>
                    {formatByteSize(snap.installProgress.processedBytes)} /{' '}
                    {formatByteSize(snap.installProgress.totalBytes)}
                  </span>
                )}
                {typeof snap.installProgress.entriesTotal === 'number' &&
                  snap.installProgress.entriesTotal > 0 && (
                    <span>
                      ·{' '}
                      {t.modsInstallEntriesLabel(
                        snap.installProgress.entriesDone ?? 0,
                        snap.installProgress.entriesTotal,
                      )}
                    </span>
                  )}
              </div>
            </div>

            {snap.installProgress.currentEntry && (
              <div
                dir="ltr"
                className="font-mono-num text-[10px] text-[#7f9683] truncate"
              >
                {snap.installProgress.currentEntry}
              </div>
            )}
          </div>
        )}

        {notice && (
          <div
            role="status"
            data-testid="mods-notice-banner"
            className={`px-3 py-2 rounded-lg text-xs font-medium border flex items-center gap-2 ${
              notice.ok
                ? 'bg-[#173022] border-[#387451] text-[#8be39f]'
                : 'bg-[#3c1b1b] border-[#c85a53] text-[#f4a5a0]'
            }`}
          >
            {notice.ok ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{notice.text}</span>
          </div>
        )}
      </div>

      {/* Mods List or Empty State */}
      {snap.mods.length === 0 ? (
        <div
          data-testid="mods-empty-state"
          className="p-5 rounded-xl bg-[#0c1712] border border-white/10 text-center space-y-2"
        >
          <Package className="w-8 h-8 text-[#e5a93c]/70 mx-auto" />
          <div className="font-display font-bold text-sm text-[#edf3ea]">
            {t.modsEmptyTitle}
          </div>
          <p className="text-xs text-[#9eb2a0] max-w-md mx-auto leading-relaxed">
            {t.modsEmptyHint}
          </p>
          <p
            dir="ltr"
            className="text-[11px] font-mono-num text-[#7f9683] max-w-lg mx-auto leading-relaxed pt-1"
          >
            {t.modsEmptyStructureHint}
          </p>
        </div>
      ) : visibleMods.length === 0 ? (
        <div
          data-testid="mods-filter-empty-state"
          className="p-5 rounded-xl bg-[#0c1712] border border-white/10 text-center space-y-1.5"
        >
          <Package className="w-7 h-7 text-[#9fb5a1]/70 mx-auto" />
          <div className="font-display font-bold text-sm text-[#edf3ea]">
            {t.modsFilterEmptyTitle}
          </div>
          <p className="text-xs text-[#9eb2a0] max-w-md mx-auto">
            {t.modsFilterEmptyHint}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5" data-testid="mods-list">
          {visibleMods.map((mod) => {
            const statusMeta = getStatusMeta(mod.status);
            const isConfirming = confirmRemoveKey === mod.entryKey;
            const visibleDiagnostics = mod.diagnostics.filter(
              (d) => d.severity !== 'info',
            );
            const clearSummaries = getClearStatusMessages(mod);

            return (
              <div
                key={mod.entryKey}
                data-testid={`mod-card-${mod.manifest.modId}`}
                className="p-3.5 rounded-xl bg-[#0c1712] border border-white/10 space-y-2.5"
              >
                <div className="flex flex-col gap-2.5">
                  <div className="min-w-0 space-y-1.5">
                    {/* Mod Name, Version, Status, Compatibility Status, Package Source */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-display font-bold text-sm text-[#f4f7f1]">
                        {mod.manifest.name}
                      </span>
                      <span
                        dir="ltr"
                        className="text-[11px] font-mono-num px-2 py-0.5 rounded bg-[#14241c] border border-white/10 text-[#d0dfd0]"
                      >
                        v{mod.manifest.version}
                      </span>
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${statusMeta.badgeClass}`}
                      >
                        {statusMeta.label}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border ${
                          mod.gameCompatible
                            ? 'bg-[#14281f] border-[#2f5b43] text-[#9de3af]'
                            : 'bg-[#3b2e16] border-[#d69e36]/50 text-[#f3ca6e]'
                        }`}
                      >
                        {mod.gameCompatible ? (
                          <ShieldCheck className="w-3 h-3" />
                        ) : (
                          <AlertTriangle className="w-3 h-3" />
                        )}
                        <span>
                          {mod.gameCompatible
                            ? t.modsCompatibleBadge
                            : t.modsUnsupportedVersionBadge}
                        </span>
                      </span>
                      <span
                        data-testid={`mod-kind-${mod.manifest.modId}`}
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded border ${
                          mod.installKind === 'woamod'
                            ? 'bg-[#2a2112] border-[#d69e36]/45 text-[#f3ca6e]'
                            : 'bg-[#112722] border-[#388875]/45 text-[#88dfd0]'
                        }`}
                      >
                        {mod.installKind === 'woamod' ? (
                          <FileArchive className="w-3 h-3" />
                        ) : (
                          <FolderOpen className="w-3 h-3" />
                        )}
                        <span>
                          {mod.installKind === 'woamod'
                            ? t.modsKindWoamod
                            : t.modsKindDevelopment}
                        </span>
                      </span>
                    </div>

                    {/* Author, Mod ID, Folders, Content/Assets */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[#9cb09e]">
                      <span>{t.modsByAuthor(mod.manifest.author)}</span>
                      <span dir="ltr" className="font-mono-num text-[#7f9683]">
                        {t.modsModIdLabel}: {mod.manifest.modId}
                      </span>
                      <span>
                        {t.modsFoldersCoverageLabel(
                          mod.presentFolders.length,
                          STANDARD_MOD_FOLDERS.length,
                        )}
                      </span>
                      <span>
                        {t.modsContentAssetsLabel(
                          mod.contentFileCount,
                          mod.assetFileCount,
                        )}
                      </span>
                    </div>

                    {/* Description */}
                    <p className="text-xs text-[#c7d6c6] leading-relaxed">
                      {mod.manifest.description || t.modsNoDescription}
                    </p>

                    {/* Dependencies & Categories */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <span
                        dir="ltr"
                        className="text-[10px] font-mono-num px-1.5 py-0.5 rounded bg-[#11201a] border border-white/10 text-[#9db4a1]"
                      >
                        {t.modsDependenciesLabel}:{' '}
                        {mod.manifest.dependencies.length > 0
                          ? mod.manifest.dependencies
                              .map((d) =>
                                d.versionRange ? `${d.modId} (${d.versionRange})` : d.modId,
                              )
                              .join(', ')
                          : t.modsNoDependencies}
                      </span>
                      {mod.manifest.categories.map((cat) => (
                        <span
                          key={cat}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-[#14251c] border border-white/10 text-[#b4c8b6]"
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Per-Mod Actions Row: Load Priority / View Details / Enable-Disable / Remove */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/5">
                    {mod.hasValidManifest ? (
                      <div
                        className="inline-flex items-center rounded-lg bg-[#08100c] border border-white/10 px-1.5 py-1 gap-1"
                        title={t.modsPriorityLabel}
                      >
                        <span className="text-[10px] text-[#8fa492] px-1">
                          {t.modsPriorityLabel}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void modManager.setModPriority(
                              mod.manifest.modId,
                              mod.effectivePriority - 1,
                            )
                          }
                          aria-label="Decrease priority"
                          className="w-6 h-6 rounded bg-[#14241c] hover:bg-[#1e3529] flex items-center justify-center text-[#dce6d9] cursor-pointer"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                        <span
                          dir="ltr"
                          className="min-w-[24px] text-center font-mono-num text-[11px] font-bold text-[#e5a93c]"
                        >
                          {mod.effectivePriority}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void modManager.setModPriority(
                              mod.manifest.modId,
                              mod.effectivePriority + 1,
                            )
                          }
                          aria-label="Increase priority"
                          className="w-6 h-6 rounded bg-[#14241c] hover:bg-[#1e3529] flex items-center justify-center text-[#dce6d9] cursor-pointer"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <span />
                    )}

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        data-testid={`mod-details-${mod.manifest.modId}`}
                        onClick={() => setDetailsEntryKey(mod.entryKey)}
                        className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#14241c] hover:bg-[#1d3428] border border-white/12 text-xs font-medium text-[#dce8dc] inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5 text-[#e5a93c]" />
                        <span>{t.modsViewDetailsBtn}</span>
                      </button>

                      {mod.hasValidManifest && (
                        <>
                          {mod.enabled ? (
                            <button
                              type="button"
                              data-testid={`mod-disable-${mod.manifest.modId}`}
                              onClick={() =>
                                void modManager.setModEnabled(mod.manifest.modId, false)
                              }
                              className="min-h-[34px] px-3 py-1 rounded-lg text-xs font-display font-bold border bg-[#2a3f33] hover:bg-[#334d3e] border-white/15 text-[#eef5ec] transition-colors cursor-pointer"
                            >
                              {t.modsDisableBtn}
                            </button>
                          ) : (
                            <button
                              type="button"
                              data-testid={`mod-enable-${mod.manifest.modId}`}
                              disabled={!canEnableMod(mod)}
                              onClick={() =>
                                void modManager.setModEnabled(mod.manifest.modId, true)
                              }
                              className="min-h-[34px] px-3 py-1 rounded-lg text-xs font-display font-bold border bg-[#e5a93c] hover:bg-[#eeb750] border-[#e5a93c] text-[#111914] disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
                            >
                              {t.modsEnableBtn}
                            </button>
                          )}
                        </>
                      )}

                      {isConfirming ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            data-testid={`mod-remove-confirm-${mod.manifest.modId}`}
                            onClick={async () => {
                              setConfirmRemoveKey(null);
                              await modManager.removeMod(
                                mod.sourceId,
                                mod.hasValidManifest ? mod.manifest.modId : undefined,
                              );
                            }}
                            className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#c4453d] hover:bg-[#d8544b] text-xs font-bold text-white cursor-pointer"
                          >
                            {t.modsRemoveConfirmYes}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRemoveKey(null)}
                            className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#16271e] border border-white/12 text-xs text-[#d6e2d5] cursor-pointer"
                          >
                            {t.backBtn}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          data-testid={`mod-remove-${mod.manifest.modId}`}
                          onClick={() => setConfirmRemoveKey(mod.entryKey)}
                          className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#18251e] hover:bg-[#3a1f1f] border border-white/12 hover:border-[#c85a53]/50 text-xs text-[#e2aba6] inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{t.modsRemoveBtn}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Error & Warning Status Summary */}
                {(clearSummaries.length > 0 || visibleDiagnostics.length > 0) && (
                  <div className="pt-2 border-t border-white/10 space-y-1">
                    {clearSummaries.map((msg, idx) => (
                      <div
                        key={`summary-${idx}`}
                        className="text-[11px] font-semibold flex items-start gap-1.5 text-[#f6bf78]"
                      >
                        <FileWarning className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{msg}</span>
                      </div>
                    ))}
                    {visibleDiagnostics.map((diag, idx) => (
                      <div
                        key={`${diag.code}-${idx}`}
                        className={`text-[11px] flex items-start gap-1.5 ${
                          diag.severity === 'error'
                            ? 'text-[#f29b94]'
                            : 'text-[#f3ca6e]'
                        }`}
                      >
                        {diag.severity === 'error' ? (
                          <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        )}
                        <span>{diag.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Instant Save Note & Logs Toggle */}
      <div className="p-3 rounded-xl bg-[#0c1712] border border-white/10 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] text-[#9cb09e]">
            <Info className="w-3.5 h-3.5 text-[#e5a93c] shrink-0" />
            <span>{t.modsInstantSaveNote}</span>
          </div>

          <button
            type="button"
            data-testid="mods-logs-toggle-btn"
            onClick={() => setLogsExpanded((prev) => !prev)}
            className="min-h-[32px] px-2.5 py-1 rounded-lg bg-[#14251c] hover:bg-[#1c3227] border border-white/12 text-[11px] font-semibold text-[#dfe8dc] inline-flex items-center gap-1.5 cursor-pointer"
          >
            <ScrollText className="w-3.5 h-3.5 text-[#e5a93c]" />
            <span>{logsExpanded ? t.modsLogsHideBtn : t.modsLogsShowBtn}</span>
            <span className="font-mono-num text-[#9ab19e]">
              ({snap.logs.length})
            </span>
          </button>
        </div>

        {logsExpanded && (
          <div className="pt-2 border-t border-white/10 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#e2ece0]">
                {t.modsLogsTitle}
              </span>
              {snap.logs.length > 0 && (
                <button
                  type="button"
                  onClick={() => modManager.clearLogs()}
                  className="text-[11px] text-[#a7bba9] hover:text-white cursor-pointer"
                >
                  {t.modsLogsClearBtn}
                </button>
              )}
            </div>

            {snap.logs.length === 0 ? (
              <p className="text-[11px] text-[#849987]">{t.modsLogsEmpty}</p>
            ) : (
              <div
                dir="ltr"
                className="max-h-40 overflow-y-auto space-y-1 pr-1 font-mono-num text-[11px]"
              >
                {snap.logs.map((entry) => (
                  <div
                    key={entry.id}
                    className={`px-2 py-1 rounded bg-[#08100c] border border-white/5 ${
                      entry.level === 'error'
                        ? 'text-[#f29b94]'
                        : entry.level === 'warn'
                          ? 'text-[#f3ca6e]'
                          : 'text-[#b7ccb9]'
                    }`}
                  >
                    <span className="text-[#728976]">
                      [{new Date(entry.timestampMs).toLocaleTimeString()}]
                    </span>{' '}
                    <span className="uppercase font-bold">{entry.level}</span>:{' '}
                    {entry.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* View Details Modal */}
      {selectedModForDetails && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#060d09]/82 backdrop-blur-sm p-3 sm:p-5 pointer-events-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mod-details-title"
          data-testid="mod-details-modal"
          onClick={() => setDetailsEntryKey(null)}
        >
          <div
            dir={isRtl ? 'rtl' : 'ltr'}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl max-h-[86dvh] flex flex-col rounded-2xl bg-[#101c16] border border-[#2d4839] text-[#f2f6ef] shadow-2xl overflow-hidden"
          >
            {/* Details Header */}
            <div className="px-4 sm:px-5 py-3.5 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h4
                  id="mod-details-title"
                  className="font-display font-bold text-base sm:text-lg text-white truncate"
                >
                  {selectedModForDetails.manifest.name}
                </h4>
                <div
                  dir="ltr"
                  className="font-mono-num text-xs text-[#9eb4a0] truncate"
                >
                  {selectedModForDetails.manifest.modId} · v
                  {selectedModForDetails.manifest.version}
                </div>
              </div>
              <button
                type="button"
                data-testid="mod-details-close-btn"
                onClick={() => setDetailsEntryKey(null)}
                aria-label={t.modsCloseDetailsBtn}
                className="min-w-[40px] min-h-[40px] rounded-xl bg-[#182920] hover:bg-[#22392d] border border-white/12 flex items-center justify-center text-[#dce5d8] cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Details Scroll Body */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs">
              {/* Key Metadata Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <DetailField
                  label={t.modsAuthorLabel}
                  value={selectedModForDetails.manifest.author}
                />
                <DetailField
                  label={t.modsCompatibilityLabel}
                  value={`${
                    selectedModForDetails.gameCompatible
                      ? t.modsCompatibleBadge
                      : t.modsUnsupportedVersionBadge
                  } (${selectedModForDetails.manifest.supportedGameVersion || '?'})`}
                />
                <DetailField
                  label={t.modsPriorityLabel}
                  value={String(selectedModForDetails.effectivePriority)}
                  ltr
                />
                <DetailField
                  label={t.modsLoadOrderLabel}
                  value={
                    selectedModForDetails.loadOrderIndex !== null
                      ? `#${selectedModForDetails.loadOrderIndex + 1}`
                      : '-'
                  }
                  ltr
                />
                <DetailField
                  label={t.modsOriginLabel}
                  value={
                    selectedModForDetails.installKind === 'woamod'
                      ? t.modsKindWoamod
                      : t.modsKindDevelopment
                  }
                />
                {selectedModForDetails.installKind === 'woamod' &&
                  selectedModForDetails.packageFileName && (
                    <DetailField
                      label={t.modsPackageFileLabel}
                      value={selectedModForDetails.packageFileName}
                      ltr
                    />
                  )}
                {selectedModForDetails.installKind === 'woamod' &&
                  selectedModForDetails.installedAtMs && (
                    <DetailField
                      label={t.modsInstalledAtLabel}
                      value={new Date(
                        selectedModForDetails.installedAtMs,
                      ).toLocaleString()}
                      ltr
                    />
                  )}
              </div>

              {/* Description */}
              <div className="p-3 rounded-xl bg-[#0c1712] border border-white/10 space-y-1">
                <div className="text-[11px] font-semibold text-[#9eb4a0]">
                  {t.modsDescriptionLabel}
                </div>
                <p className="text-xs text-[#e4ece1] leading-relaxed">
                  {selectedModForDetails.manifest.description || t.modsNoDescription}
                </p>
              </div>

              {/* Source Path */}
              <div className="p-3 rounded-xl bg-[#0c1712] border border-white/10 space-y-1">
                <div className="text-[11px] font-semibold text-[#9eb4a0]">
                  {t.modsSourcePathLabel} (
                  {selectedModForDetails.installKind === 'woamod'
                    ? t.modsKindWoamod
                    : t.modsKindDevelopment}
                  )
                </div>
                <div
                  dir="ltr"
                  className="font-mono-num text-[11px] text-[#b9cbb9] break-all"
                >
                  {selectedModForDetails.sourcePath}
                </div>
                {selectedModForDetails.installKind === 'development' && (
                  <div className="text-[10px] text-[#88dfd0] pt-0.5">
                    {t.modsDevBadgeHint}
                  </div>
                )}
              </div>

              {/* Dependencies */}
              <div className="p-3 rounded-xl bg-[#0c1712] border border-white/10 space-y-1.5">
                <div className="text-[11px] font-semibold text-[#9eb4a0]">
                  {t.modsDependenciesLabel}
                </div>
                {selectedModForDetails.manifest.dependencies.length === 0 ? (
                  <div className="text-xs text-[#c7d6c6]">{t.modsNoDependencies}</div>
                ) : (
                  <div className="space-y-1">
                    {selectedModForDetails.manifest.dependencies.map((dep) => {
                      const found = snap.mods.find(
                        (m) => m.hasValidManifest && m.manifest.modId === dep.modId,
                      );
                      return (
                        <div
                          key={dep.modId}
                          dir="ltr"
                          className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#08100c] border border-white/5 font-mono-num text-[11px]"
                        >
                          <span className="text-[#e3ece1]">
                            {dep.modId} {dep.versionRange ? `(${dep.versionRange})` : ''}
                          </span>
                          <span
                            className={
                              found?.loaded
                                ? 'text-[#7fe094]'
                                : 'text-[#f3ca6e]'
                            }
                          >
                            {found
                              ? found.loaded
                                ? `v${found.manifest.version} · loaded`
                                : found.status
                              : 'missing'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Standard Folder Structure */}
              <div className="p-3 rounded-xl bg-[#0c1712] border border-white/10 space-y-2">
                <div className="text-[11px] font-semibold text-[#9eb4a0]">
                  {t.modsFoldersLabel} (
                  {selectedModForDetails.presentFolders.length}/
                  {STANDARD_MOD_FOLDERS.length})
                </div>
                <div dir="ltr" className="flex flex-wrap gap-1.5">
                  {STANDARD_MOD_FOLDERS.map((folder) => {
                    const present =
                      selectedModForDetails.presentFolders.includes(folder);
                    return (
                      <span
                        key={folder}
                        className={`text-[10px] font-mono-num px-2 py-0.5 rounded border ${
                          present
                            ? 'bg-[#173122] border-[#387451] text-[#8be39f]'
                            : 'bg-[#08100c] border-white/8 text-[#6f8473]'
                        }`}
                      >
                        {folder}/
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Data & Assets Breakdown */}
              <div className="p-3 rounded-xl bg-[#0c1712] border border-white/10 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-[#9eb4a0]">
                  <span>
                    {t.modsContentFilesLabel}:{' '}
                    <strong className="font-mono-num text-white">
                      {selectedModForDetails.parsedContentFiles.length}
                    </strong>
                  </span>
                  <span>
                    {t.modsAssetsFilesLabel}:{' '}
                    <strong className="font-mono-num text-white">
                      {selectedModForDetails.assets.length}
                    </strong>
                  </span>
                </div>
                {(selectedModForDetails.parsedContentFiles.length > 0 ||
                  selectedModForDetails.assets.length > 0) && (
                  <div
                    dir="ltr"
                    className="max-h-28 overflow-y-auto space-y-1 font-mono-num text-[11px] text-[#bfd0c0]"
                  >
                    {selectedModForDetails.parsedContentFiles.map((cf) => (
                      <div key={cf.relativePath} className="truncate">
                        [data:{cf.category}] {cf.relativePath}
                      </div>
                    ))}
                    {selectedModForDetails.assets.map((af) => (
                      <div key={af.relativePath} className="truncate text-[#9ab49e]">
                        [asset:{af.category}] {af.relativePath} (
                        {Math.max(1, Math.round(af.sizeBytes / 1024))} KB)
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* World Spawn Rules & Runtime Diagnostics */}
              {(() => {
                const modId = selectedModForDetails.manifest.modId;
                const liveDiagnostics = modManager.getSpawnDiagnostics(modId);
                const declaredRules = modManager.getModSpawnRules(modId);
                return (
                  <div
                    data-testid="mods-spawn-diagnostics-section"
                    className="p-3 rounded-xl bg-[#0c1712] border border-white/10 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-[#9eb4a0]">
                      <span>{t.modsSpawnDiagnosticsTitle}</span>
                      <span dir="ltr" className="font-mono-num text-white">
                        {liveDiagnostics.length > 0
                          ? liveDiagnostics.length
                          : declaredRules.length}
                      </span>
                    </div>

                    {liveDiagnostics.length === 0 && declaredRules.length === 0 ? (
                      <div className="text-xs text-[#9eb4a0]">{t.modsNoSpawnRules}</div>
                    ) : liveDiagnostics.length > 0 ? (
                      <div className="max-h-48 overflow-y-auto space-y-1.5">
                        {liveDiagnostics.map((entry) => {
                          const isError = entry.status === 'failed';
                          const isOk =
                            entry.status === 'spawned' ||
                            entry.status === 'collected' ||
                            entry.status === 'defeated';
                          return (
                            <div
                              key={`${entry.modId}:${entry.spawnId}`}
                              className={`p-2 rounded-lg border text-[11px] space-y-1 ${
                                isError
                                  ? 'bg-[#341616] border-[#c85a53]/45 text-[#f4a5a0]'
                                  : isOk
                                    ? 'bg-[#102318] border-[#387451]/45 text-[#d7eadb]'
                                    : 'bg-[#181f1b] border-white/10 text-[#d3dfd5]'
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span
                                  dir="ltr"
                                  className="font-mono-num font-semibold text-white truncate"
                                >
                                  [{entry.contentType}] {entry.contentId} ({entry.modId}:{entry.spawnId})
                                </span>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    isError
                                      ? 'bg-[#c85a53]/30 text-[#ffb8b3]'
                                      : isOk
                                        ? 'bg-[#387451]/40 text-[#8be39f]'
                                        : 'bg-white/10 text-[#f3ca6e]'
                                  }`}
                                >
                                  {t.modsSpawnStatusLabel(entry.status)}
                                </span>
                              </div>
                              <div
                                dir="ltr"
                                className="font-mono-num text-[10px] text-[#b4c8b6] flex flex-wrap gap-x-3 gap-y-0.5"
                              >
                                <span>
                                  {t.modsSpawnModeLabel}: {entry.mode}
                                </span>
                                <span>
                                  {t.modsSpawnConfiguredLabel}: ({entry.configuredCoords.x},{' '}
                                  {entry.configuredCoords.y ?? t.modsSpawnAutoY},{' '}
                                  {entry.configuredCoords.z})
                                </span>
                                {entry.resolvedCoords && (
                                  <span>
                                    {t.modsSpawnResolvedLabel}: (
                                    {Number(entry.resolvedCoords.x.toFixed(3))},{' '}
                                    {Number(entry.resolvedCoords.y.toFixed(3))},{' '}
                                    {Number(entry.resolvedCoords.z.toFixed(3))})
                                  </span>
                                )}
                                <span>
                                  {t.modsSpawnRotationLabel}: ({Number(entry.rotation.x.toFixed(3))},{' '}
                                  {Number(entry.rotation.y.toFixed(3))},{' '}
                                  {Number(entry.rotation.z.toFixed(3))})
                                </span>
                                <span>
                                  {t.modsSpawnScaleLabel}: ({Number(entry.scale.x.toFixed(3))},{' '}
                                  {Number(entry.scale.y.toFixed(3))},{' '}
                                  {Number(entry.scale.z.toFixed(3))})
                                </span>
                                {entry.targetChunk && (
                                  <span>
                                    {t.modsSpawnChunkLabel}: {entry.targetChunk}
                                  </span>
                                )}
                                <span>
                                  {t.modsSpawnInstancesLabel}: {entry.instanceCount}
                                </span>
                                <span>
                                  {t.modsSpawnAlreadySpawnedLabel}:{' '}
                                  {entry.alreadySpawned ? t.modsSpawnYesLabel : t.modsSpawnNoLabel}
                                </span>
                                <span>
                                  {t.modsSpawnSavedLabel}:{' '}
                                  {entry.saved ? t.modsSpawnYesLabel : t.modsSpawnNoLabel}
                                </span>
                              </div>
                              {entry.failedCondition && (
                                <div
                                  dir="ltr"
                                  className="font-mono-num text-[10px] text-[#f3ca6e]"
                                >
                                  {entry.failedCondition}
                                </div>
                              )}
                              {entry.error && (
                                <div
                                  dir="ltr"
                                  className="font-mono-num text-[10px] text-[#ffb8b3] break-all"
                                >
                                  {entry.errorCode ? `[${entry.errorCode}] ` : ''}
                                  {entry.error}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="text-[10px] text-[#88dfd0]">
                          {t.modsSpawnMenuPreviewHint}
                        </div>
                        <div className="max-h-40 overflow-y-auto space-y-1">
                          {declaredRules.map((rule) => (
                            <div
                              key={rule.id}
                              dir="ltr"
                              className="p-2 rounded-lg bg-[#08100c] border border-white/8 font-mono-num text-[10px] text-[#c7d6c6] space-y-0.5"
                            >
                              <div className="font-semibold text-white">
                                [{rule.contentType}] {rule.contentId} ({rule.modId}:{rule.spawnId})
                              </div>
                              <div className="flex flex-wrap gap-x-3 text-[#9fb5a1]">
                                <span>
                                  {t.modsSpawnModeLabel}: {rule.unsupportedMode ?? rule.mode}
                                </span>
                                <span>
                                  {t.modsSpawnConfiguredLabel}: ({rule.position.x},{' '}
                                  {rule.position.y ?? t.modsSpawnAutoY}, {rule.position.z})
                                </span>
                                <span>
                                  {t.modsSpawnRotationLabel}: ({Number(rule.rotation.x.toFixed(3))},{' '}
                                  {Number(rule.rotation.y.toFixed(3))},{' '}
                                  {Number(rule.rotation.z.toFixed(3))})
                                </span>
                                <span>
                                  {t.modsSpawnScaleLabel}: ({Number(rule.scale.x.toFixed(3))},{' '}
                                  {Number(rule.scale.y.toFixed(3))},{' '}
                                  {Number(rule.scale.z.toFixed(3))})
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Event Runtime & Reward Diagnostics */}
              {(() => {
                const modId = selectedModForDetails.manifest.modId;
                const eventDiagnostics = modManager.getEventDiagnostics(modId);
                return (
                  <div
                    data-testid="mods-event-diagnostics-section"
                    className="p-3 rounded-xl bg-[#0c1712] border border-white/10 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-[#9eb4a0]">
                      <span>{t.modsEventDiagnosticsTitle}</span>
                      <span dir="ltr" className="font-mono-num text-white">
                        {eventDiagnostics.length}
                      </span>
                    </div>

                    {eventDiagnostics.length === 0 ? (
                      <div className="text-xs text-[#9eb4a0]">{t.modsNoEventRules}</div>
                    ) : (
                      <div className="max-h-48 overflow-y-auto space-y-1.5">
                        {eventDiagnostics.map((entry) => {
                          const isError = entry.status === 'failed';
                          const isOk = entry.status === 'executed';
                          return (
                            <div
                              key={entry.fullId}
                              className={`p-2 rounded-lg border text-[11px] space-y-1 ${
                                isError
                                  ? 'bg-[#341616] border-[#c85a53]/45 text-[#f4a5a0]'
                                  : isOk
                                    ? 'bg-[#102318] border-[#387451]/45 text-[#d7eadb]'
                                    : 'bg-[#181f1b] border-white/10 text-[#d3dfd5]'
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span
                                  dir="ltr"
                                  className="font-mono-num font-semibold text-white truncate"
                                >
                                  {entry.fullId}
                                </span>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    isError
                                      ? 'bg-[#c85a53]/30 text-[#ffb8b3]'
                                      : isOk
                                        ? 'bg-[#387451]/40 text-[#8be39f]'
                                        : 'bg-white/10 text-[#f3ca6e]'
                                  }`}
                                >
                                  {t.modsEventStatusLabel(entry.status)}
                                </span>
                              </div>
                              <div
                                dir="ltr"
                                className="font-mono-num text-[10px] text-[#b4c8b6] flex flex-wrap gap-x-3 gap-y-0.5"
                              >
                                <span>
                                  {t.modsEventTriggerLabel}: {entry.triggerType}
                                </span>
                                <span>
                                  {t.modsEventExecutionModeLabel}: {entry.executionMode}
                                </span>
                                <span>
                                  {t.modsEventExecutionsLabel}: {entry.executionCount}
                                </span>
                              </div>
                              {entry.failedReason && (
                                <div
                                  dir="ltr"
                                  className="font-mono-num text-[10px] text-[#f3ca6e] break-all"
                                >
                                  {entry.errorCode ? `[${entry.errorCode}] ` : ''}
                                  {entry.failedReason}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Incompatible Assets if any */}
              {selectedModForDetails.incompatibleAssets.length > 0 && (
                <div className="p-3 rounded-xl bg-[#271b10] border border-[#c88a36]/45 space-y-1.5">
                  <div className="text-[11px] font-semibold text-[#f3ca6e]">
                    {t.modsIncompatibleAssetsLabel}
                  </div>
                  <div
                    dir="ltr"
                    className="max-h-24 overflow-y-auto space-y-1 font-mono-num text-[11px] text-[#f5d28f]"
                  >
                    {selectedModForDetails.incompatibleAssets.map((ia) => (
                      <div key={ia.relativePath}>
                        {ia.relativePath} ({ia.reason})
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Errors & Warnings */}
              <div className="p-3 rounded-xl bg-[#0c1712] border border-white/10 space-y-1.5">
                <div className="text-[11px] font-semibold text-[#9eb4a0]">
                  {t.modsErrorWarningTitle}
                </div>
                {selectedModForDetails.diagnostics.filter((d) => d.severity !== 'info')
                  .length === 0 ? (
                  <div className="text-xs text-[#7fe094] flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{t.modsNoErrorsOrWarnings}</span>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {selectedModForDetails.diagnostics
                      .filter((d) => d.severity !== 'info')
                      .map((diag, idx) => (
                        <div
                          key={`${diag.code}-${idx}`}
                          className={`text-[11px] p-2 rounded-lg border ${
                            diag.severity === 'error'
                              ? 'bg-[#341616] border-[#c85a53]/45 text-[#f4a5a0]'
                              : 'bg-[#2b2212] border-[#c89636]/45 text-[#f3ca6e]'
                          }`}
                        >
                          <div className="font-semibold">{diag.message}</div>
                          {diag.detail && (
                            <div
                              dir="ltr"
                              className="font-mono-num text-[10px] opacity-85 mt-0.5 break-all"
                            >
                              {diag.detail}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>

            {/* Details Footer */}
            <div className="px-4 sm:px-5 py-3 border-t border-white/10 bg-[#0c1611] flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setDetailsEntryKey(null)}
                className="min-h-[40px] px-5 py-2 rounded-xl bg-[#e5a93c] hover:bg-[#eeb750] text-[#111914] font-display font-bold text-xs cursor-pointer"
              >
                {t.modsCloseDetailsBtn}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const DetailField: React.FC<{ label: string; value: string; ltr?: boolean }> = ({
  label,
  value,
  ltr = false,
}) => (
  <div className="p-2.5 rounded-xl bg-[#0c1712] border border-white/10">
    <div className="text-[10px] text-[#94aa97]">{label}</div>
    <div
      dir={ltr ? 'ltr' : undefined}
      className="text-xs font-semibold text-[#eef4ec] mt-0.5 truncate"
    >
      {value}
    </div>
  </div>
);
