import React from 'react';
import {
  Award,
  CheckCircle2,
  Hammer,
  Landmark,
  Lock,
  ShieldAlert,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import type { VillageDevelopmentSnapshot } from '../game/village/villageDevTypes';
import { UI_TEXT, type Language } from '../game/i18n/translations';

interface VillageDevelopmentModalProps {
  snapshot: VillageDevelopmentSnapshot;
  lang: Language;
  onCompleteRepair: (villageId: string, repairId: string) => void;
  onCompleteProject: (villageId: string, projectId: string) => void;
  onStartDefense: (villageId: string) => void;
  onClose: () => void;
}

export const VillageDevelopmentModal: React.FC<VillageDevelopmentModalProps> = ({
  snapshot,
  lang,
  onCompleteRepair,
  onCompleteProject,
  onStartDefense,
  onClose,
}) => {
  const t = UI_TEXT[lang];
  const isRtl = lang === 'ar';
  const levelProgressPct =
    snapshot.level >= 5
      ? 100
      : Math.round(
          Math.max(0, Math.min(1, snapshot.progressXp / Math.max(1, snapshot.nextLevelXp))) *
            100,
        );

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#09110d]/74 p-2.5 sm:p-4 mobile-hud-safe"
      role="dialog"
      aria-modal="true"
      aria-labelledby="village-dev-title"
      data-testid="village-dev-modal"
    >
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className="w-full max-w-3xl max-h-[90dvh] overflow-y-auto rounded-2xl bg-[#101c16] border border-[#2a3f33] p-4 sm:p-6 text-[#f1f5ee] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#182920] border border-[#2e4838] flex items-center justify-center shrink-0">
              <Landmark className="w-5 h-5 text-[#e5a93c]" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="village-dev-title"
                  className="font-display text-lg sm:text-xl font-bold leading-tight truncate"
                >
                  {snapshot.villageName}
                </h2>
                <span className="px-2 py-0.5 rounded-md bg-[#3c2d16] border border-[#6b4f24] text-[11px] font-bold text-[#f5c76b]">
                  {t.villageLevelBadge(snapshot.level)} · {snapshot.levelName}
                </span>
              </div>
              <p className="text-xs text-[#9cb0a0] mt-0.5">{t.villageDevTitle}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            data-testid="village-dev-close-btn"
            aria-label={t.closeBtn}
            className="min-w-[44px] min-h-[44px] rounded-lg bg-[#192a21] hover:bg-[#22392d] border border-[#2f493b] flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Level & Reputation Summary Card */}
        <div className="rounded-xl bg-[#14231b] border border-[#263c2f] p-3.5 mb-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-semibold text-[#e6efe7]">
                  {t.villageLevelBadge(snapshot.level)}
                </span>
                <span className="font-mono-num text-[11px] text-[#a7bca9]">
                  {snapshot.level >= 5
                    ? `${snapshot.progressXp} XP (MAX)`
                    : `${snapshot.progressXp} / ${snapshot.nextLevelXp} XP`}
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-[#0b140f] border border-white/10 overflow-hidden">
                <div
                  className="h-full bg-[#e5a93c] transition-all duration-300"
                  style={{ width: `${levelProgressPct}%` }}
                />
              </div>
            </div>

            <div className="rounded-lg bg-[#0d1712] border border-white/10 px-3 py-2 flex flex-col justify-center">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 text-[#a7bca9]">
                  <Award className="w-3.5 h-3.5 text-[#7fe094]" />
                  <span>{t.villageReputationLabel}:</span>
                </span>
                <span className="font-bold text-[#9beea8]">
                  {snapshot.reputationLabel} ({snapshot.reputationPoints})
                </span>
              </div>
              <p className="text-[11px] text-[#9ab09f] mt-0.5">
                {t.villageRepDiscountHint(snapshot.tradeDiscountPct, snapshot.sellBonusPct)}
              </p>
            </div>
          </div>

          {/* Unlocked Market & Village Perks */}
          <div className="pt-2 border-t border-white/10">
            <div className="text-[11px] font-semibold text-[#e5a93c] mb-1.5 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{t.villagePerksTitle}</span>
            </div>
            {snapshot.perksUnlocked.length === 0 ? (
              <p className="text-xs text-[#93a896]">{t.villageNoPerksYet}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {snapshot.perksUnlocked.map((perk) => (
                  <span
                    key={perk}
                    className="px-2.5 py-1 rounded-lg bg-[#182e22] border border-[#325b43] text-[11px] text-[#bfeec6]"
                  >
                    {perk}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Repairs & Projects Sections */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Repairs */}
          <div className="space-y-2.5">
            <h3 className="text-xs sm:text-sm font-bold text-[#f2f6ef] flex items-center gap-1.5">
              <Wrench className="w-4 h-4 text-[#e5a93c]" />
              <span>{t.villageRepairsTitle}</span>
            </h3>
            {snapshot.repairs.map((rep) => (
              <div
                key={rep.id}
                className="rounded-xl bg-[#14231b] border border-[#263c2f] p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-semibold text-[#f3f6ef]">
                      {rep.name}
                    </div>
                    <p className="text-[11px] text-[#9eb4a3] mt-0.5 leading-snug">
                      {rep.desc}
                    </p>
                  </div>
                  {rep.completed && (
                    <span className="px-2 py-0.5 rounded-md bg-[#183825] border border-[#3a7552] text-[10px] font-bold text-[#9bf0b8] shrink-0 inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>{t.villageRepairCompletedBadge}</span>
                    </span>
                  )}
                </div>

                {!rep.completed && (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {rep.costs.map((c) => (
                        <span
                          key={c.itemId}
                          className={`px-2 py-0.5 rounded-md border text-[11px] font-mono-num ${
                            c.enough
                              ? 'bg-[#173322] border-[#3d704f] text-[#9bf0b8]'
                              : 'bg-[#361818] border-[#783535] text-[#fca5a5]'
                          }`}
                        >
                          {c.name}: {c.owned}/{c.required}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] text-[#e5a93c]">
                        +{rep.xpGain} XP · +{rep.coinsReward} {t.coinsLabel}
                      </span>
                      <button
                        type="button"
                        disabled={!rep.canComplete}
                        onClick={() => onCompleteRepair(snapshot.villageId, rep.id)}
                        data-testid={`village-repair-${rep.id}`}
                        className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-[#e5a93c] hover:bg-[#eeb750] disabled:opacity-45 text-[#111914] font-display font-bold text-xs cursor-pointer disabled:cursor-not-allowed"
                      >
                        {t.villageRepairDoneBtn}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Development Projects */}
          <div className="space-y-2.5">
            <h3 className="text-xs sm:text-sm font-bold text-[#f2f6ef] flex items-center gap-1.5">
              <Hammer className="w-4 h-4 text-[#7fe094]" />
              <span>{t.villageProjectsTitle}</span>
            </h3>
            {snapshot.projects.map((proj) => (
              <div
                key={proj.id}
                className="rounded-xl bg-[#14231b] border border-[#263c2f] p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-semibold text-[#f3f6ef]">
                      {proj.name}
                    </div>
                    <p className="text-[11px] text-[#9eb4a3] mt-0.5 leading-snug">
                      {proj.desc}
                    </p>
                    <p className="text-[11px] text-[#e5a93c]/90 mt-0.5">
                      {proj.unlockSummary}
                    </p>
                  </div>
                  {proj.completed ? (
                    <span className="px-2 py-0.5 rounded-md bg-[#183825] border border-[#3a7552] text-[10px] font-bold text-[#9bf0b8] shrink-0 inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>{t.villageProjectCompletedBadge}</span>
                    </span>
                  ) : !proj.levelMet ? (
                    <span className="px-2 py-0.5 rounded-md bg-[#2a2216] border border-[#5e4a28] text-[10px] font-semibold text-[#f0cf88] shrink-0 inline-flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      <span>{t.villageProjectLockedBadge(proj.minVillageLevel)}</span>
                    </span>
                  ) : null}
                </div>

                {!proj.completed && (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {proj.costs.map((c) => (
                        <span
                          key={c.itemId}
                          className={`px-2 py-0.5 rounded-md border text-[11px] font-mono-num ${
                            c.enough
                              ? 'bg-[#173322] border-[#3d704f] text-[#9bf0b8]'
                              : 'bg-[#361818] border-[#783535] text-[#fca5a5]'
                          }`}
                        >
                          {c.name}: {c.owned}/{c.required}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] text-[#7fe094]">
                        +{proj.xpGain} XP · +{proj.reputationGain} Rep
                      </span>
                      <button
                        type="button"
                        disabled={!proj.canBuild}
                        onClick={() => onCompleteProject(snapshot.villageId, proj.id)}
                        data-testid={`village-project-${proj.id}`}
                        className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-[#2a7d4f] hover:bg-[#34945e] disabled:opacity-45 border border-[#7fe094]/60 text-[#ffffff] font-display font-bold text-xs cursor-pointer disabled:cursor-not-allowed"
                      >
                        {t.villageProjectBuildBtn}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Optional Village Defense Event */}
        <div className="rounded-xl bg-[#18221d] border border-[#3d4d3e] p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <ShieldAlert className="w-5 h-5 text-[#e5a93c] shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-xs sm:text-sm font-bold text-[#f3f6ef]">
                {t.villageDefenseTitle}
              </div>
              <p className="text-[11px] text-[#a7bca9] mt-0.5">{t.villageDefenseDesc}</p>
            </div>
          </div>

          {snapshot.defenseActive ? (
            <span className="px-3 py-2 rounded-lg bg-[#3b1c1c] border border-[#8f3f3f] text-xs font-bold text-[#fecaca] shrink-0 text-center">
              {t.villageDefenseActiveBadge(snapshot.defenseRemainingCount)}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onStartDefense(snapshot.villageId)}
              data-testid="village-defense-start-btn"
              className="min-h-[42px] px-4 py-2 rounded-xl bg-[#3c2618] hover:bg-[#4e311f] border border-[#e5a93c]/60 text-xs font-display font-bold text-[#fbd38d] shrink-0 cursor-pointer"
            >
              {t.villageDefenseStartBtn}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
