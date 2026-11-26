import React, { useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  RefreshCw,
  Wand2,
  X,
} from 'lucide-react';
import type { ProtocolModCompatibilityReport, ProtocolWorldModMetadata } from '../../../shared/multiplayerProtocol';
import { UI_TEXT, type Language } from '../../game/i18n/translations';
import { getModManager } from '../../game/mods';

interface ModCompatibilityPanelProps {
  lang: Language;
  report: ProtocolModCompatibilityReport;
  hostModMetadata?: ProtocolWorldModMetadata;
  titleOverride?: string;
  subtitleOverride?: string;
  onAfterRefresh?: () => Promise<void> | void;
  onRetryAction?: () => Promise<void> | void;
  onDismiss?: () => void;
}

export const ModCompatibilityPanel: React.FC<ModCompatibilityPanelProps> = ({
  lang,
  report,
  hostModMetadata,
  titleOverride,
  subtitleOverride,
  onAfterRefresh,
  onRetryAction,
  onDismiss,
}) => {
  const t = UI_TEXT[lang];
  const [busy, setBusy] = useState<'refresh' | 'match' | null>(null);

  const requiredHostMods = (hostModMetadata?.mods ?? []).filter(
    (m) => (m.multiplayerCompatibility ?? 'required') !== 'client_only',
  );

  // Can resolve purely via local enable/disable toggle preset ONLY when no external
  // downloads/updates are needed (i.e. no missing/version/API/schema errors).
  const canMatchLocally =
    report.issues.length > 0 &&
    report.issues.every(
      (i) => i.code === 'disabled_mod' || i.code === 'extra_active_mod',
    );

  const resolveIssueLabel = (code: ProtocolModCompatibilityReport['issues'][number]['code']) => {
    switch (code) {
      case 'missing_mod':
        return t.mpModIssueMissing;
      case 'disabled_mod':
        return t.mpModIssueDisabled;
      case 'version_mismatch':
        return t.mpModIssueVersionMismatch;
      case 'missing_dependency':
        return t.mpModIssueMissingDependency;
      case 'unsupported_mod':
        return t.mpModIssueUnsupported;
      case 'api_version_mismatch':
      case 'schema_version_mismatch':
        return t.mpModIssueApiMismatch;
      case 'extra_active_mod':
      default:
        return t.mpModIssueExtraActive;
    }
  };

  const handleRefreshMods = async () => {
    if (busy) return;
    setBusy('refresh');
    try {
      await getModManager().refreshMods();
      await onAfterRefresh?.();
    } finally {
      setBusy(null);
    }
  };

  const handleMatchPreset = async () => {
    if (busy || !canMatchLocally) return;
    setBusy('match');
    try {
      await getModManager().applyMultiplayerModPreset(hostModMetadata);
      if (onRetryAction) {
        await onRetryAction();
      } else {
        await onAfterRefresh?.();
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      data-testid="mp-mod-compatibility-panel"
      className="p-3.5 sm:p-4 rounded-xl bg-[#271517]/95 border border-[#e05a47]/55 text-[#f7e7e4] space-y-3"
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#3c1d21] border border-[#e05a47]/50 flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle className="w-4 h-4 text-[#f28b7d]" />
          </div>
          <div className="min-w-0">
            <h4 className="font-display font-bold text-sm sm:text-base text-white">
              {titleOverride ?? t.mpModCompatMismatchTitle}
            </h4>
            <p className="text-xs text-[#e8bfba] mt-0.5 leading-snug">
              {subtitleOverride ?? t.mpModCompatBlockedHint}
            </p>
          </div>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t.mpDismissBtn}
            className="p-1.5 rounded-lg bg-[#381d20] hover:bg-[#4c262a] border border-white/10 text-[#f2c4be] cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Host Requirement Summary */}
      <div className="p-2.5 rounded-lg bg-[#160e10]/80 border border-white/10 space-y-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#d9b6b0] inline-flex items-center gap-1.5">
            <Boxes className="w-3.5 h-3.5 text-[#e5a93c]" />
            {t.mpHostRequiredModsLabel}
          </span>
          <span className="px-2 py-0.5 rounded bg-[#182920] border border-[#2f493b] text-[10px] font-bold text-[#dce5d8]">
            {requiredHostMods.length === 0
              ? t.mpModsVanillaBadge
              : t.mpModsRequiredCountBadge(requiredHostMods.length)}
          </span>
        </div>

        {requiredHostMods.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {requiredHostMods.map((mod) => (
              <span
                key={mod.modId}
                dir="ltr"
                className="px-2 py-0.5 rounded bg-[#0c1611] border border-[#2f493b] text-[11px] font-mono-num text-[#dce5d8]"
              >
                {mod.name} ({mod.modId} v{mod.version})
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Detailed Issue Rows */}
      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
        {report.issues.map((issue, idx) => (
          <div
            key={`${issue.modId}:${issue.code}:${idx}`}
            className="p-2.5 rounded-lg bg-[#190e10] border border-[#e05a47]/35 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display font-bold text-white truncate">
                  {issue.modName ?? issue.modId}
                </span>
                <span
                  dir="ltr"
                  className="font-mono-num text-[10px] text-[#cba39e]"
                >
                  {issue.modId}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-[#3b1c20] border border-[#e05a47]/45 text-[10px] font-bold text-[#f7b1a7]">
                  {resolveIssueLabel(issue.code)}
                </span>
                {issue.dependencyModId && (
                  <span
                    dir="ltr"
                    className="px-1.5 py-0.5 rounded bg-[#2b1f14] border border-[#e5a93c]/40 text-[10px] font-mono-num text-[#f7d488]"
                  >
                    {issue.dependencyModId}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#deb7b2] mt-0.5 leading-snug">
                {issue.message}
              </p>
            </div>
            {(issue.expectedVersion || issue.actualVersion) && (
              <div
                dir="ltr"
                className="text-[10px] font-mono-num text-[#e6cbc7] shrink-0 flex flex-col sm:items-end gap-0.5"
              >
                {issue.expectedVersion && (
                  <span className="text-[#9ef0b0]">
                    {t.mpModExpectedLabel(issue.expectedVersion)}
                  </span>
                )}
                {issue.actualVersion && (
                  <span className="text-[#f4b1a7]">
                    {t.mpModLocalLabel(issue.actualVersion)}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {report.summary && report.summary.includes('\n') && (
        <div
          data-testid="mp-mod-rejection-summary"
          className="p-2.5 rounded-lg bg-[#160e10]/85 border border-[#e05a47]/30 text-[11px] text-[#f3d1cc] whitespace-pre-line leading-relaxed font-mono-num"
        >
          {report.summary}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        {canMatchLocally && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void handleMatchPreset()}
            data-testid="mp-match-room-mods-btn"
            className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-[#276d46] hover:bg-[#318656] disabled:opacity-60 border border-[#7fe094]/60 text-xs font-display font-bold text-white inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>{t.mpMatchRoomModsBtn}</span>
          </button>
        )}

        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void handleRefreshMods()}
          data-testid="mp-refresh-mods-btn"
          className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#182920] hover:bg-[#22392d] disabled:opacity-60 border border-[#345443] text-xs font-semibold text-[#dce5d8] inline-flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`} />
          <span>{t.mpRefreshModsBtn}</span>
        </button>

        {!canMatchLocally && onRetryAction && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onRetryAction()}
            className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#e5a93c] hover:bg-[#eeb750] disabled:opacity-60 text-xs font-display font-bold text-[#111914] inline-flex items-center gap-1.5 cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{t.mpRetryConnectionBtn}</span>
          </button>
        )}
      </div>
    </div>
  );
};
