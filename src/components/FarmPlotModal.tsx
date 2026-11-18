import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  CloudRain,
  Droplets,
  Shovel,
  Sprout,
  Wheat,
  X,
} from 'lucide-react';
import type { CropId, FarmPlotSnapshot } from '../game/farming/farmingTypes';
import { UI_TEXT, type Language } from '../game/i18n/translations';

interface FarmPlotModalProps {
  snapshot: FarmPlotSnapshot;
  lang: Language;
  onTillSoil: (structureId: string) => void;
  onPlantSeed: (structureId: string, cropId: CropId) => void;
  onWaterPlot: (structureId: string) => void;
  onHarvestPlot: (structureId: string) => void;
  onClose: () => void;
}

export const FarmPlotModal: React.FC<FarmPlotModalProps> = ({
  snapshot,
  lang,
  onTillSoil,
  onPlantSeed,
  onWaterPlot,
  onHarvestPlot,
  onClose,
}) => {
  const t = UI_TEXT[lang];
  const isRtl = lang === 'ar';

  const defaultSeedCropId = useMemo<CropId | null>(() => {
    const firstOwned = snapshot.availableSeeds.find(
      (s) => snapshot.isCreativeFree || s.seedCount > 0,
    );
    return firstOwned?.cropId ?? snapshot.availableSeeds[0]?.cropId ?? null;
  }, [snapshot.availableSeeds, snapshot.isCreativeFree]);

  const [selectedCropId, setSelectedCropId] = useState<CropId | null>(defaultSeedCropId);
  const activeCropId =
    selectedCropId && snapshot.availableSeeds.some((s) => s.cropId === selectedCropId)
      ? selectedCropId
      : defaultSeedCropId;

  const pickedSeed = snapshot.availableSeeds.find((s) => s.cropId === activeCropId) ?? null;
  const waterPct = Math.round(Math.max(0, Math.min(1, snapshot.waterLevel)) * 100);
  const growthPct = Math.round(Math.max(0, Math.min(1, snapshot.growthProgress)) * 100);
  const canWaterNow =
    snapshot.soilPrepared &&
    (snapshot.isCreativeFree ||
      snapshot.hasWateringCan ||
      snapshot.nearWaterSource ||
      snapshot.isRaining);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#09110d]/74 p-2.5 sm:p-4 mobile-hud-safe"
      role="dialog"
      aria-modal="true"
      aria-labelledby="farm-plot-modal-title"
      data-testid="farm-plot-modal"
    >
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl bg-[#101c16] border border-[#2a3f33] p-4 sm:p-6 text-[#f1f5ee] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#182c20] border border-[#2e4b39] flex items-center justify-center shrink-0">
              <Sprout className="w-5 h-5 text-[#7fe094]" />
            </div>
            <div className="min-w-0">
              <h2
                id="farm-plot-modal-title"
                className="font-display text-lg sm:text-xl font-bold leading-tight truncate"
              >
                {snapshot.title}
              </h2>
              <p className="text-xs text-[#9cb0a0] mt-0.5">{t.farmPlotTitle}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            data-testid="farm-plot-close-btn"
            aria-label={t.closeBtn}
            className="min-w-[44px] min-h-[44px] rounded-lg bg-[#192a21] hover:bg-[#22392d] border border-[#2f493b] flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Soil & Moisture Status Card */}
        <div className="rounded-xl bg-[#14231b] border border-[#263c2f] p-3.5 mb-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-semibold ${
                snapshot.soilPrepared
                  ? 'bg-[#193524] border-[#3d704f] text-[#9beea8]'
                  : 'bg-[#2c2419] border-[#5e4b2e] text-[#f0cf88]'
              }`}
            >
              <Shovel className="w-3.5 h-3.5" />
              <span>{snapshot.soilPrepared ? t.farmSoilReady : t.farmSoilUntilled}</span>
            </span>

            <div className="flex flex-wrap items-center gap-1.5">
              {snapshot.isRaining && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#18303b] border border-[#3a687d] text-[11px] font-medium text-[#8ad8f0]">
                  <CloudRain className="w-3 h-3" />
                  <span>{t.farmWateredRainBadge}</span>
                </span>
              )}
              {snapshot.nearWaterSource && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#18303b] border border-[#3a687d] text-[11px] font-medium text-[#8ad8f0]">
                  <Droplets className="w-3 h-3" />
                  <span>{t.farmWateredTroughBadge}</span>
                </span>
              )}
            </div>
          </div>

          {/* Moisture Meter */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-[#a8c4cf] inline-flex items-center gap-1.5">
                <Droplets className="w-3.5 h-3.5 text-[#5ec2eb]" />
                <span>{t.farmWateredStatus(waterPct)}</span>
              </span>
              <span className="text-[11px] text-[#8ea595]">{t.farmWateredBonusNotice}</span>
            </div>
            <div className="h-2 rounded-full bg-[#0b140f] border border-white/10 overflow-hidden">
              <div
                className="h-full bg-[#4fb5e6] transition-all duration-300"
                style={{ width: `${waterPct}%` }}
              />
            </div>
          </div>

          {/* Active Crop Progress (if planted) */}
          {snapshot.cropId && (
            <div className="pt-2 border-t border-white/10">
              <div className="flex items-center justify-between gap-2 text-xs mb-1">
                <span className="font-semibold text-[#f3f6ef] inline-flex items-center gap-1.5">
                  <Wheat className="w-3.5 h-3.5 text-[#e5a93c]" />
                  <span>{t.farmCropProgressLabel(snapshot.cropName, growthPct)}</span>
                </span>
                <span className="px-2 py-0.5 rounded bg-[#1a2e22] border border-white/10 text-[11px] text-[#cce0cf]">
                  {t.farmStageLabel(snapshot.stage)}
                  {snapshot.estimatedHoursRemaining !== null && snapshot.stage < 3
                    ? ` · ${snapshot.estimatedHoursRemaining.toFixed(1)}h`
                    : ''}
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-[#0b140f] border border-white/10 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    snapshot.canHarvest ? 'bg-[#e5a93c]' : 'bg-[#63c47a]'
                  }`}
                  style={{ width: `${growthPct}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Step 1: Till Soil */}
        {!snapshot.soilPrepared && (
          <div className="rounded-xl bg-[#15241c] border border-[#2c4536] p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs sm:text-sm text-[#c7d9c9]">{t.farmSoilUntilled}</p>
            <button
              type="button"
              onClick={() => onTillSoil(snapshot.structureId)}
              data-testid="farm-till-btn"
              className="w-full sm:w-auto min-h-[44px] px-5 py-2 rounded-xl bg-[#e5a93c] hover:bg-[#eeb750] text-[#111914] font-display font-bold text-xs sm:text-sm inline-flex items-center justify-center gap-2 cursor-pointer shrink-0"
            >
              <Shovel className="w-4 h-4" />
              <span>{t.farmTillSoilBtn}</span>
            </button>
          </div>
        )}

        {/* Step 2: Select & Plant Seed (when soil tilled & empty) */}
        {snapshot.soilPrepared && !snapshot.cropId && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs sm:text-sm font-bold text-[#e8efe5]">{t.farmSeedLabel}</h3>
            </div>

            {snapshot.availableSeeds.every(
              (s) => !snapshot.isCreativeFree && s.seedCount <= 0,
            ) && (
              <div className="px-3 py-2.5 rounded-xl bg-[#241f14] border border-[#594726] text-xs text-[#ecd08b]">
                {t.farmNoSeedsHint}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {snapshot.availableSeeds.map((seed) => {
                const owned = snapshot.isCreativeFree || seed.seedCount > 0;
                const active = seed.cropId === activeCropId;
                return (
                  <button
                    key={seed.cropId}
                    type="button"
                    disabled={!owned}
                    onClick={() => setSelectedCropId(seed.cropId)}
                    data-testid={`farm-seed-${seed.cropId}`}
                    className={`min-h-[54px] px-3 py-2.5 rounded-xl border text-start transition-colors flex items-center justify-between gap-2 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                      active
                        ? 'bg-[#20382a] border-[#e5a93c] text-[#ffffff]'
                        : 'bg-[#14231b] border-white/10 hover:bg-[#1a2e22] text-[#dce7dc]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs sm:text-sm font-semibold truncate">
                        {seed.cropName}
                      </div>
                      <div className="text-[11px] text-[#9eb4a3] mt-0.5 flex items-center gap-2">
                        <span>{t.farmGrowthHoursLabel(seed.growthWorldHours)}</span>
                        <span>·</span>
                        <span>{t.farmYieldLabel(seed.estimatedYield)}</span>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-md bg-[#0c1510] border border-white/10 font-mono-num text-xs font-bold text-[#e5a93c] shrink-0">
                      {snapshot.isCreativeFree ? '∞' : `×${seed.seedCount}`}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={!canWaterNow}
                onClick={() => onWaterPlot(snapshot.structureId)}
                data-testid="farm-water-btn"
                className="min-h-[44px] px-4 py-2 rounded-xl bg-[#18313b] hover:bg-[#204250] disabled:opacity-45 border border-[#3a6c82] text-xs sm:text-sm font-semibold text-[#bde8f8] inline-flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
              >
                <Droplets className="w-4 h-4" />
                <span>{t.farmWaterCropBtn}</span>
              </button>

              {pickedSeed && (snapshot.isCreativeFree || pickedSeed.seedCount > 0) && (
                <button
                  type="button"
                  onClick={() => onPlantSeed(snapshot.structureId, pickedSeed.cropId)}
                  data-testid="farm-plant-btn"
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-[#2a7d4f] hover:bg-[#34945e] border border-[#7fe094]/65 text-xs sm:text-sm font-display font-bold text-[#ffffff] inline-flex items-center gap-2 cursor-pointer"
                >
                  <Sprout className="w-4 h-4" />
                  <span>{t.farmPlantSeedBtn(pickedSeed.cropName)}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step 3 / 4: Growing or Mature Actions */}
        {snapshot.soilPrepared && snapshot.cropId && (
          <div className="space-y-3">
            {!canWaterNow && !snapshot.canHarvest && (
              <p className="px-3 py-2 rounded-lg bg-[#16261d] border border-white/10 text-xs text-[#9eb4a3]">
                {t.farmWaterNeedsSourceHint}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              {!snapshot.canHarvest && (
                <button
                  type="button"
                  disabled={!canWaterNow}
                  onClick={() => onWaterPlot(snapshot.structureId)}
                  data-testid="farm-water-btn"
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-[#18313b] hover:bg-[#204250] disabled:opacity-45 border border-[#3a6c82] text-xs sm:text-sm font-semibold text-[#bde8f8] inline-flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Droplets className="w-4 h-4" />
                  <span>{t.farmWaterCropBtn}</span>
                </button>
              )}

              {snapshot.canHarvest && (
                <button
                  type="button"
                  onClick={() => onHarvestPlot(snapshot.structureId)}
                  data-testid="farm-harvest-btn"
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-[#e5a93c] hover:bg-[#eeb750] text-[#111914] font-display font-bold text-xs sm:text-sm inline-flex items-center gap-2 cursor-pointer shadow-md"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{t.farmHarvestBtn}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
