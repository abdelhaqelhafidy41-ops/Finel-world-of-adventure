import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  FolderCog,
  Package,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { UI_TEXT, type Language } from '../../game/i18n/translations';
import {
  CURRENT_GAME_VERSION,
  captureWorldModMetadata,
  getModManager,
  inspectWorldSaveMods,
  type ModsSnapshot,
  type WorldModInspectionResult,
  type WorldModMetadataEntry,
  type WorldModSelectionEntry,
  type WorldSaveModInspectEntry,
} from '../../game/mods';
import { SaveManager } from '../../game/save/SaveManager';
import type { SaveGameData, SaveSlotId } from '../../game/save/saveTypes';
import { ModsPanel } from './ModsPanel';

interface WorldModRecoveryModalProps {
  lang: Language;
  slotId: SaveSlotId;
  saveData: SaveGameData;
  initialInspection: WorldModInspectionResult;
  onSaveConfigUpdated?: (updatedSave: SaveGameData) => void;
  onLaunch: (
    overrideModSelection: {
      selectionMode: 'vanilla' | 'custom';
      selectedMods: WorldModSelectionEntry[];
    },
    safeRecoveryMode: boolean,
  ) => void;
  onClose: () => void;
}

interface DraftModConfigRow {
  modId: string;
  enabled: boolean;
}

function buildInitialDraft(saveData: SaveGameData): DraftModConfigRow[] {
  const savedMods = [...(saveData.modMetadata?.mods ?? [])].sort(
    (a, b) => (a.loadOrder ?? 0) - (b.loadOrder ?? 0) || a.modId.localeCompare(b.modId),
  );
  return savedMods.map((m) => ({
    modId: m.modId,
    enabled: m.enabled !== false,
  }));
}

export const WorldModRecoveryModal: React.FC<WorldModRecoveryModalProps> = ({
  lang,
  slotId,
  saveData,
  initialInspection,
  onSaveConfigUpdated,
  onLaunch,
  onClose,
}) => {
  const t = UI_TEXT[lang];
  const isRtl = lang === 'ar';
  const modManager = useMemo(() => getModManager(), []);

  const [modsSnapshot, setModsSnapshot] = useState<ModsSnapshot>(() =>
    modManager.getSnapshot(),
  );
  const [workingSave, setWorkingSave] = useState<SaveGameData>(saveData);
  const [draftRows, setDraftRows] = useState<DraftModConfigRow[]>(() =>
    buildInitialDraft(saveData),
  );
  const [modsManagerOpen, setModsManagerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setWorkingSave(saveData);
    setDraftRows(buildInitialDraft(saveData));
    setNotice(null);
  }, [saveData]);

  useEffect(() => {
    const unsub = modManager.subscribe(setModsSnapshot);
    return unsub;
  }, [modManager]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (modsManagerOpen) {
          setModsManagerOpen(false);
          void modManager.refreshMods();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modManager, modsManagerOpen, onClose]);

  const selectionMode: 'vanilla' | 'custom' = useMemo(() => {
    const hasAnyEnabled = draftRows.some((r) => r.enabled);
    if (workingSave.modMetadata?.selectionMode === 'vanilla' && !hasAnyEnabled) {
      return 'vanilla';
    }
    return hasAnyEnabled || draftRows.length > 0 ? 'custom' : 'vanilla';
  }, [draftRows, workingSave.modMetadata?.selectionMode]);

  const previewSaveData = useMemo<SaveGameData>(() => {
    const savedById = new Map<string, WorldModMetadataEntry>(
      (workingSave.modMetadata?.mods ?? []).map((m) => [m.modId, m]),
    );
    const previewEntries: WorldModMetadataEntry[] = draftRows.map((row, idx) => {
      const prev = savedById.get(row.modId);
      if (prev) {
        return {
          ...prev,
          enabled: row.enabled,
          loadOrder: idx,
        };
      }
      const installed = modsSnapshot.mods.find((m) => m.manifest.modId === row.modId);
      return {
        modId: row.modId,
        name: installed?.manifest.name ?? row.modId,
        version: installed?.manifest.version ?? '0.0.0',
        loadOrder: idx,
        enabled: row.enabled,
        supportedGameVersion: installed?.manifest.supportedGameVersion,
        compatible: installed ? installed.gameCompatible && installed.hasValidManifest : false,
        modApiVersion: installed?.manifest.modApiVersion ?? modsSnapshot.modApiVersion,
        schemaVersion: installed?.manifest.schemaVersion ?? modsSnapshot.schemaVersion,
      };
    });

    return {
      ...workingSave,
      modMetadata: {
        modApiVersion: workingSave.modMetadata?.modApiVersion ?? modsSnapshot.modApiVersion,
        schemaVersion: workingSave.modMetadata?.schemaVersion ?? modsSnapshot.schemaVersion,
        savedAtGameVersion: workingSave.modMetadata?.savedAtGameVersion ?? CURRENT_GAME_VERSION,
        selectionMode,
        mods: previewEntries,
      },
    };
  }, [draftRows, modsSnapshot, selectionMode, workingSave]);

  const liveInspection = useMemo<WorldModInspectionResult>(() => {
    if (!previewSaveData.modMetadata && initialInspection) {
      return initialInspection;
    }
    return inspectWorldSaveMods(previewSaveData, modsSnapshot);
  }, [initialInspection, modsSnapshot, previewSaveData]);

  const selectedModSelections = useMemo<WorldModSelectionEntry[]>(
    () =>
      draftRows.map((row, idx) => ({
        modId: row.modId,
        enabled: row.enabled,
        loadOrder: idx,
      })),
    [draftRows],
  );

  const handleToggleEntry = (modId: string) => {
    setDraftRows((prev) =>
      prev.map((row) =>
        row.modId === modId ? { ...row, enabled: !row.enabled } : row,
      ),
    );
  };

  const handleMoveEntry = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= draftRows.length) return;
    setDraftRows((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const handleRefreshMods = async () => {
    setRefreshing(true);
    try {
      await modManager.refreshMods();
    } finally {
      setRefreshing(false);
    }
  };

  const handleSaveWorldModConfig = async () => {
    setSavingConfig(true);
    try {
      const nextMeta = captureWorldModMetadata(modsSnapshot, {
        selectionMode,
        configuredEntries: selectedModSelections,
        preservedEntries: workingSave.modMetadata?.mods ?? [],
      });
      const updated = SaveManager.updateSavedWorldModMetadata(slotId, nextMeta);
      if (updated) {
        setWorkingSave(updated);
        setDraftRows(buildInitialDraft(updated));
        onSaveConfigUpdated?.(updated);
        setNotice(t.worldRecoveryConfigSavedNotice);
      }
    } finally {
      setSavingConfig(false);
    }
  };

  const getStatusBadge = (entry: WorldSaveModInspectEntry) => {
    switch (entry.status) {
      case 'missing':
        return {
          text: t.worldRecoveryStatusMissing,
          cls: 'bg-[#3d1b1a] border-[#e05a47]/65 text-[#ffb4a8]',
        };
      case 'incompatible':
        return {
          text: t.worldRecoveryStatusIncompatible,
          cls: 'bg-[#3d1b1a] border-[#e05a47]/65 text-[#ffb4a8]',
        };
      case 'version_changed':
        return {
          text: t.worldRecoveryStatusVersionChanged(
            entry.savedVersion,
            entry.installedVersion ?? entry.savedVersion,
          ),
          cls: 'bg-[#362811] border-[#e5a93c]/60 text-[#ffd782]',
        };
      case 'disabled_globally':
        return {
          text: t.worldRecoveryStatusDisabledGlobally,
          cls: 'bg-[#172e23] border-[#7fe094]/45 text-[#9ee8ae]',
        };
      case 'disabled_world':
        return {
          text: t.worldRecoveryStatusDisabledWorld,
          cls: 'bg-[#17221c] border-white/15 text-[#9cb0a0]',
        };
      case 'ready':
      default:
        return {
          text: t.worldRecoveryStatusReady,
          cls: 'bg-[#163123] border-[#7fe094]/50 text-[#8ce89f]',
        };
    }
  };

  const apiOrSchemaIssues = liveInspection.evaluation.issues.filter(
    (i) => i.code === 'api_version_mismatch' || i.code === 'schema_version_mismatch',
  );
  const orphaned = liveInspection.orphanedContent;
  const sampleOrphanedIds = [
    ...orphaned.unknownItemIds,
    ...orphaned.unknownQuestIds,
    ...orphaned.unknownBuildingIds,
    ...orphaned.unknownRecipeIds,
  ].slice(0, 6);

  const hasIssuesRemaining = liveInspection.requiresWarningBeforeLoad;

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#060e0a]/82 backdrop-blur-md p-3 sm:p-6 mobile-hud-safe pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="world-recovery-title"
      data-testid="world-mod-recovery-modal"
    >
      <div className="woa-surface w-full max-w-2xl max-h-[92dvh] flex flex-col rounded-2xl bg-[#101c16]/96 border border-[#e5a93c]/45 text-[#f2f6ef] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                hasIssuesRemaining
                  ? 'bg-[#e5a93c]/18 text-[#e5a93c]'
                  : 'bg-[#7fe094]/18 text-[#7fe094]'
              }`}
            >
              {hasIssuesRemaining ? (
                <ShieldAlert className="w-5 h-5" />
              ) : (
                <ShieldCheck className="w-5 h-5" />
              )}
            </div>
            <div className="min-w-0">
              <h2
                id="world-recovery-title"
                className="font-display text-lg sm:text-xl font-bold tracking-tight truncate"
              >
                {t.worldRecoveryTitle}
              </h2>
              <p className="text-xs sm:text-sm font-medium text-[#e5a93c] truncate mt-0.5">
                {t.worldRecoverySubtitle(workingSave.meta.worldName)}
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="world-recovery-close-btn"
            aria-label={t.cancelBtn}
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] rounded-xl bg-[#182920] hover:bg-[#22392d] border border-white/12 inline-flex items-center justify-center text-[#dce5d8] cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          {/* Status Banner */}
          <div
            data-testid="world-recovery-status-banner"
            className={`rounded-xl border p-3 flex items-start gap-2.5 text-xs sm:text-sm leading-relaxed ${
              hasIssuesRemaining
                ? 'bg-[#2a1f10] border-[#e5a93c]/45 text-[#fae3b0]'
                : 'bg-[#122b1e] border-[#7fe094]/45 text-[#c7f2d0]'
            }`}
          >
            {hasIssuesRemaining ? (
              <AlertTriangle className="w-4 h-4 text-[#e5a93c] shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-[#7fe094] shrink-0 mt-0.5" />
            )}
            <span>
              {hasIssuesRemaining
                ? t.worldRecoveryWarningBanner
                : t.worldRecoveryResolvedBanner}
            </span>
          </div>

          {notice && (
            <div
              role="status"
              data-testid="world-recovery-notice"
              className="rounded-xl border border-[#7fe094]/45 bg-[#122a1d] px-3 py-2 text-xs font-medium text-[#bfeec9]"
            >
              {notice}
            </div>
          )}

          {/* Preserved Modded Content Summary */}
          {(orphaned.totalUnknownReferences > 0 || liveInspection.entries.length > 0) && (
            <div
              data-testid="world-recovery-orphaned-box"
              className="rounded-xl bg-[#0c1611] border border-[#2b4436] p-3.5"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-[#e6eee4]">
                <Package className="w-4 h-4 text-[#e5a93c]" />
                <span>{t.worldRecoveryOrphanedTitle}</span>
              </div>
              <p className="text-xs text-[#a5b9a8] mt-1">
                {t.worldRecoveryOrphanedDesc(
                  orphaned.unknownItemIds.length,
                  orphaned.unknownQuestIds.length,
                  orphaned.unknownBuildingIds.length,
                  orphaned.unknownRecipeIds.length,
                )}
              </p>
              {sampleOrphanedIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2" dir="ltr">
                  {sampleOrphanedIds.map((id) => (
                    <span
                      key={id}
                      className="px-2 py-0.5 rounded bg-[#16261d] border border-white/10 font-mono-num text-[10px] text-[#dce5d8]"
                    >
                      {id}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* API/Schema Mismatch Alerts */}
          {apiOrSchemaIssues.length > 0 && (
            <div className="rounded-xl bg-[#351817] border border-[#e05a47]/55 p-3 space-y-1">
              {apiOrSchemaIssues.map((issue) => (
                <p key={issue.code + issue.modId} className="text-xs text-[#ffb4a8]">
                  {issue.message}
                </p>
              ))}
            </div>
          )}

          {/* Mod Action Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="world-recovery-refresh-btn"
              disabled={refreshing}
              onClick={() => void handleRefreshMods()}
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#182920] hover:bg-[#22392d] border border-[#2f493b] text-xs font-semibold text-[#e4ece1] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{t.worldRecoveryRefreshBtn}</span>
            </button>

            <button
              type="button"
              data-testid="world-recovery-manage-mods-btn"
              onClick={() => setModsManagerOpen(true)}
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#192f24] hover:bg-[#234031] border border-[#e5a93c]/45 text-xs font-semibold text-[#f7e2b2] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <FolderCog className="w-3.5 h-3.5 text-[#e5a93c]" />
              <span>{t.worldRecoveryManageModsBtn}</span>
            </button>

            <button
              type="button"
              data-testid="world-recovery-save-config-btn"
              disabled={savingConfig}
              onClick={() => void handleSaveWorldModConfig()}
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#182920] hover:bg-[#22392d] border border-[#7fe094]/40 text-xs font-semibold text-[#bfeec9] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{t.worldRecoverySaveConfigBtn}</span>
            </button>
          </div>

          {/* Required / Saved World Mods List */}
          {liveInspection.entries.length > 0 && (
            <div className="space-y-2">
              {liveInspection.entries.map((entry, idx) => {
                const badge = getStatusBadge(entry);
                return (
                  <div
                    key={entry.modId}
                    data-testid={`world-recovery-mod-row-${entry.modId}`}
                    className="rounded-xl bg-[#0c1611] border border-[#263d31] p-3 flex flex-col sm:flex-row sm:items-center gap-2.5"
                  >
                    <div className="flex items-start gap-2.5 flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={entry.savedEnabled}
                        aria-label={entry.name}
                        data-testid={`world-recovery-toggle-${entry.modId}`}
                        onChange={() => handleToggleEntry(entry.modId)}
                        className="w-4 h-4 mt-0.5 accent-[#e5a93c] cursor-pointer shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-display font-bold text-xs sm:text-sm text-[#f7faf5] truncate">
                            {entry.name}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${badge.cls}`}
                          >
                            {badge.text}
                          </span>
                        </div>
                        <div
                          dir="ltr"
                          className="text-[11px] font-mono-num text-[#8da392] mt-0.5 flex flex-wrap items-center gap-x-2"
                        >
                          <span>#{idx + 1}</span>
                          <span>{entry.modId}</span>
                          <span>{t.worldRecoverySavedVersion(entry.savedVersion)}</span>
                          {entry.installedVersion && (
                            <span>
                              · {t.worldRecoveryInstalledVersion(entry.installedVersion)}
                            </span>
                          )}
                        </div>
                        {entry.diagnosticMessages.length > 0 && (
                          <p className="text-[11px] text-[#f2a699] mt-1">
                            {entry.diagnosticMessages[0]}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                      {entry.savedEnabled &&
                        (entry.status === 'missing' || entry.status === 'incompatible') && (
                          <button
                            type="button"
                            data-testid={`world-recovery-disable-${entry.modId}`}
                            onClick={() => handleToggleEntry(entry.modId)}
                            className="px-2.5 py-1 rounded-lg bg-[#2f1a1a] hover:bg-[#432323] border border-[#e05a47]/45 text-[11px] font-medium text-[#ffb4a8] cursor-pointer"
                          >
                            {t.worldRecoveryRemoveMissingBtn}
                          </button>
                        )}
                      <button
                        type="button"
                        disabled={idx === 0}
                        title={t.worldModsMoveUp}
                        aria-label={t.worldModsMoveUp}
                        onClick={() => handleMoveEntry(idx, -1)}
                        className="p-1.5 rounded-lg bg-[#16261d] hover:bg-[#22392d] disabled:opacity-35 text-[#dce5d8] cursor-pointer disabled:cursor-not-allowed"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === liveInspection.entries.length - 1}
                        title={t.worldModsMoveDown}
                        aria-label={t.worldModsMoveDown}
                        onClick={() => handleMoveEntry(idx, 1)}
                        className="p-1.5 rounded-lg bg-[#16261d] hover:bg-[#22392d] disabled:opacity-35 text-[#dce5d8] cursor-pointer disabled:cursor-not-allowed"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-4 border-t border-white/10 bg-[#0c1611]/94 space-y-2.5 shrink-0">
          <div className="flex flex-col sm:flex-row-reverse gap-2.5">
            <button
              type="button"
              data-testid="world-recovery-safe-mode-btn"
              onClick={() =>
                onLaunch(
                  {
                    selectionMode,
                    selectedMods: selectedModSelections,
                  },
                  true,
                )
              }
              className={`flex-1 min-h-[46px] px-4 py-2.5 rounded-xl font-display font-bold text-sm transition-colors cursor-pointer inline-flex items-center justify-center gap-2 ${
                hasIssuesRemaining
                  ? 'bg-[#e5a93c] hover:bg-[#eeb750] text-[#111914]'
                  : 'bg-[#1a3427] hover:bg-[#234534] border border-[#e5a93c]/50 text-[#f7e2b2]'
              }`}
            >
              <ShieldAlert className="w-4 h-4" />
              <span>{t.worldRecoveryEnterSafeBtn}</span>
            </button>

            <button
              type="button"
              data-testid="world-recovery-load-btn"
              onClick={() =>
                onLaunch(
                  {
                    selectionMode,
                    selectedMods: selectedModSelections,
                  },
                  false,
                )
              }
              className={`flex-1 min-h-[46px] px-4 py-2.5 rounded-xl font-display font-bold text-sm transition-colors cursor-pointer ${
                hasIssuesRemaining
                  ? 'bg-[#21332a] hover:bg-[#2c4438] border border-white/15 text-[#dce5d8]'
                  : 'bg-[#e5a93c] hover:bg-[#eeb750] text-[#111914]'
              }`}
            >
              {t.worldRecoveryLoadAnywayBtn}
            </button>

            <button
              type="button"
              data-testid="world-recovery-cancel-btn"
              onClick={onClose}
              className="sm:min-w-[100px] min-h-[46px] px-4 py-2.5 rounded-xl bg-[#16231c] hover:bg-[#203329] border border-[#2f493b] text-sm font-semibold text-[#e4ece1] transition-colors cursor-pointer"
            >
              {t.cancelBtn}
            </button>
          </div>
          <p className="text-[11px] text-[#9ab09e] leading-snug text-center">
            {t.worldRecoverySafeModeDesc}
          </p>
        </div>
      </div>

      {/* Embedded Mods Manager Overlay */}
      {modsManagerOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[#040a07]/85 backdrop-blur-md p-3 sm:p-6 mobile-hud-safe"
          role="dialog"
          aria-modal="true"
          data-testid="world-recovery-mods-overlay"
        >
          <div className="woa-surface w-full max-w-3xl max-h-[90dvh] flex flex-col rounded-2xl bg-[#101c16] border border-[#2b4436] text-[#f2f6ef] shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
              <h3 className="font-display text-lg font-bold">
                {t.worldRecoveryManageModsBtn}
              </h3>
              <button
                type="button"
                data-testid="world-recovery-close-mods-overlay"
                onClick={() => {
                  setModsManagerOpen(false);
                  void modManager.refreshMods();
                }}
                className="min-w-[40px] min-h-[40px] rounded-xl bg-[#182920] hover:bg-[#22392d] border border-white/12 inline-flex items-center justify-center text-[#dce5d8] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 sm:p-5 overflow-y-auto flex-1">
              <ModsPanel lang={lang} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
