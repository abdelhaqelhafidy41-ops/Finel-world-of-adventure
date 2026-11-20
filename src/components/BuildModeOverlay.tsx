import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Hammer,
  Magnet,
  RotateCcw,
  RotateCw,
  Shield,
  X,
} from 'lucide-react';
import {
  BUILDING_CATEGORIES,
  getBlueprintById,
  getBlueprintsByCategory,
} from '../game/building/buildingCatalog';
import type {
  BuildingCategory,
  BuildingPermissionScope,
  BuildModeHudSnapshot,
  RotationIncrementDeg,
} from '../game/building/buildingTypes';
import { UI_TEXT, type Language } from '../game/i18n/translations';
import { ItemManager } from '../game/inventory/ItemManager';
import { useOrientation } from '../hooks/useOrientation';
import { detectRuntimePlatform } from '../utils/platformExit';

interface BuildModeOverlayProps {
  buildMode: BuildModeHudSnapshot;
  lang: Language;
  showMobileControls: boolean;
  onSelectCategory: (category: BuildingCategory) => void;
  onSelectBlueprint: (blueprintId: string) => void;
  onRotate: (dir: 1 | -1) => void;
  onSetRotationStep: (deg: RotationIncrementDeg) => void;
  onToggleSnap: () => void;
  onNudge: (dx: number, dz: number) => void;
  onResetNudge: () => void;
  onAdjustDistance: (delta: number) => void;
  onSetDefaultPermission: (scope: BuildingPermissionScope) => void;
  onConfirmPlace: () => void;
  onExit: () => void;
}

const ROTATION_STEPS: RotationIncrementDeg[] = [15, 30, 45, 90];
const PERMISSION_SCOPES: BuildingPermissionScope[] = [
  'owner',
  'friends',
  'party',
  'everyone',
];

export const BuildModeOverlay: React.FC<BuildModeOverlayProps> = ({
  buildMode,
  lang,
  showMobileControls,
  onSelectCategory,
  onSelectBlueprint,
  onRotate,
  onSetRotationStep,
  onToggleSnap,
  onNudge,
  onResetNudge,
  onAdjustDistance,
  onSetDefaultPermission,
  onConfirmPlace,
  onExit,
}) => {
  const t = UI_TEXT[lang];
  const isRtl = lang === 'ar';
  const {
    isPortrait,
    width: viewportWidth,
    height: viewportHeight,
  } = useOrientation();
  const isAndroid =
    detectRuntimePlatform() === 'android' ||
    (typeof navigator !== 'undefined' &&
      /Android/i.test(navigator.userAgent || ''));
  const isPortraitMobile =
    isPortrait && (showMobileControls || isAndroid || viewportWidth <= 640);
  const [mobileCatalogOpen, setMobileCatalogOpen] = useState(true);
  const [defaultPermission, setDefaultPermission] =
    useState<BuildingPermissionScope>('friends');
  const itemManager = useMemo(() => new ItemManager(), []);

  const selectedBlueprint = useMemo(
    () => getBlueprintById(buildMode.selectedBlueprintId),
    [buildMode.selectedBlueprintId],
  );
  const categoryBlueprints = useMemo(
    () => getBlueprintsByCategory(buildMode.category),
    [buildMode.category],
  );

  const selectedName = selectedBlueprint
    ? isRtl
      ? selectedBlueprint.nameAr
      : selectedBlueprint.nameEn
    : buildMode.selectedBlueprintId;
  const selectedDesc = selectedBlueprint
    ? isRtl
      ? selectedBlueprint.descAr
      : selectedBlueprint.descEn
    : '';

  const reasonText = t.buildReasonLabels[buildMode.validationReason];

  const handleCyclePermission = () => {
    const idx = PERMISSION_SCOPES.indexOf(defaultPermission);
    const next = PERMISSION_SCOPES[(idx + 1) % PERMISSION_SCOPES.length];
    setDefaultPermission(next);
    onSetDefaultPermission(next);
  };

  if (isPortraitMobile) {
    const portraitDrawerMaxHeight = Math.max(
      240,
      Math.min(Math.round(viewportHeight * 0.64), viewportHeight - 170),
    );

    return (
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        data-testid="build-mode-overlay"
        data-portrait-layout="true"
        className="fixed inset-0 z-[35] pointer-events-none select-none flex flex-col justify-between gap-2 overflow-hidden"
        style={{
          paddingTop: 'max(10px, calc(env(safe-area-inset-top, 0px) + 8px))',
          paddingBottom:
            'max(10px, calc(env(safe-area-inset-bottom, 0px) + 8px))',
          paddingLeft:
            'max(10px, calc(env(safe-area-inset-left, 0px) + 8px))',
          paddingRight:
            'max(10px, calc(env(safe-area-inset-right, 0px) + 8px))',
        }}
      >
        {/* Top Status & Quick Action Bar */}
        <div className="pointer-events-auto shrink-0 w-full max-w-[540px] mx-auto flex flex-col gap-1.5">
          <div className="w-full px-2.5 py-2 rounded-xl bg-[#0d1712]/94 border border-[#e5a93c]/45 shadow-xl flex flex-col gap-1.5">
            {/* Row 1: Blueprint Name + Rotation + Drawer Toggle + Exit */}
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <Hammer className="w-4 h-4 text-[#e5a93c] shrink-0" />
                <span className="font-display text-xs font-bold text-[#f5f8f2] truncate">
                  {selectedName}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  dir="ltr"
                  className="px-2 py-1 rounded-lg bg-[#15241c] border border-white/12 font-mono-num text-[11px] font-semibold text-[#e6efe7]"
                >
                  {buildMode.rotationDeg}°
                </span>
                <button
                  type="button"
                  data-testid="build-mobile-catalog-toggle"
                  onClick={() => setMobileCatalogOpen((v) => !v)}
                  className="min-h-[38px] px-2.5 py-1 rounded-lg bg-[#172820] hover:bg-[#20362b] border border-[#e5a93c]/45 text-xs font-semibold text-[#f5d384] inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                >
                  {mobileCatalogOpen ? (
                    <ChevronDown className="w-4 h-4 shrink-0" />
                  ) : (
                    <ChevronUp className="w-4 h-4 shrink-0" />
                  )}
                  <span>{t.buildModeTitle}</span>
                </button>
                <button
                  type="button"
                  data-testid="build-exit-btn"
                  onClick={onExit}
                  aria-label={t.buildExitBtn}
                  className="min-h-[38px] min-w-[38px] px-2 py-1 rounded-lg bg-[#2b1a19] hover:bg-[#3c2220] border border-[#e05a47]/45 text-xs font-semibold text-[#fecaca] inline-flex items-center justify-center gap-1 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Row 2: Validation & Status Badges (wraps cleanly, never collides) */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                data-testid="build-validation-badge"
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide break-words ${
                  buildMode.validPlacement
                    ? 'bg-[#163a26] border border-[#4ade80]/55 text-[#86efac]'
                    : 'bg-[#3d1717] border border-[#f87171]/55 text-[#fca5a5]'
                }`}
              >
                {buildMode.validPlacement
                  ? t.buildValidPlacement
                  : `${t.buildInvalidPlacement}: ${reasonText}`}
              </span>
              {buildMode.snappedToId && (
                <span className="px-1.5 py-0.5 rounded-md bg-[#1d312a] border border-[#7dd3fc]/50 text-[#bae6fd] text-[10px] font-semibold">
                  {t.buildSnappedBadge}
                </span>
              )}
              {buildMode.isCreativeFree && (
                <span className="px-1.5 py-0.5 rounded-md bg-[#26293d] border border-[#93c5fd]/45 text-[#bfdbfe] text-[10px] font-semibold">
                  {t.buildCreativeFreeTag}
                </span>
              )}
            </div>
          </div>

          {/* Portrait Quick Action Strip */}
          <div className="w-full px-2 py-1.5 rounded-xl bg-[#0d1712]/92 border border-white/14 shadow-lg flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="build-rotate-left"
                onClick={() => onRotate(-1)}
                aria-label={t.buildRotateLeftBtn}
                className="min-w-[42px] min-h-[42px] px-2 rounded-lg bg-[#16271e] border border-white/14 text-[#e8efe5] flex items-center justify-center cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                type="button"
                data-testid="build-rotate-right"
                onClick={() => onRotate(1)}
                aria-label={t.buildRotateRightBtn}
                className="min-w-[42px] min-h-[42px] px-2 rounded-lg bg-[#16271e] border border-white/14 text-[#e8efe5] flex items-center justify-center cursor-pointer"
              >
                <RotateCw className="w-4 h-4" />
              </button>
              <button
                type="button"
                data-testid="build-snap-toggle"
                onClick={onToggleSnap}
                aria-label={t.buildSnapLabel}
                className={`min-w-[42px] min-h-[42px] px-2.5 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                  buildMode.snapEnabled
                    ? 'bg-[#1b3528] border-[#7dd3fc]/55 text-[#bae6fd]'
                    : 'bg-[#16271e] border-white/14 text-[#a9bdb0]'
                }`}
              >
                <Magnet className="w-4 h-4 shrink-0" />
                <span>
                  {buildMode.snapEnabled ? t.buildSnapOn : t.buildSnapOff}
                </span>
              </button>
            </div>

            <button
              type="button"
              data-testid="build-confirm-btn"
              onClick={onConfirmPlace}
              className={`min-h-[42px] px-4 rounded-xl border text-xs font-display font-bold inline-flex items-center gap-1.5 cursor-pointer shadow whitespace-nowrap ${
                buildMode.validPlacement
                  ? 'bg-[#2a7d4f] hover:bg-[#33935e] border-[#7fe094]/70 text-[#ffffff]'
                  : 'bg-[#3b201d] border-[#f87171]/55 text-[#fecaca]'
              }`}
            >
              <Check className="w-4 h-4 shrink-0" />
              <span>{t.buildPlaceBtn}</span>
            </button>
          </div>
        </div>

        {/* Open center viewport spacer so 3D placement preview stays visible and top/bottom panels never collide */}
        <div className="flex-1 min-h-[16px] pointer-events-none" />

        {/* Portrait Expandable Catalog & Controls Drawer */}
        {mobileCatalogOpen && (
          <div
            data-testid="build-portrait-drawer"
            className="hud-panel-scroll pointer-events-auto shrink-0 w-full max-w-[540px] mx-auto rounded-2xl bg-[#0d1712]/95 border border-[#2c4435] shadow-2xl overflow-y-auto overflow-x-hidden p-3 flex flex-col gap-3"
            style={{ maxHeight: `${portraitDrawerMaxHeight}px` }}
          >
            {/* Category Tabs (horizontally scrollable, never overlapping) */}
            <div
              className="shrink-0 flex flex-nowrap items-center gap-2 overflow-x-auto pb-1.5"
              style={{ touchAction: 'pan-x' }}
            >
              {BUILDING_CATEGORIES.map((cat) => {
                const active = buildMode.category === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    data-testid={`build-cat-${cat.id}`}
                    onClick={() => onSelectCategory(cat.id)}
                    className={`min-h-[40px] px-3.5 py-1.5 rounded-lg border text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer shrink-0 ${
                      active
                        ? 'bg-[#213a2c] border-[#e5a93c]/85 text-[#ffffff]'
                        : 'bg-[#14231b] border-white/10 text-[#9db4a2] hover:bg-[#1a2e23]'
                    }`}
                  >
                    {isRtl ? cat.nameAr : cat.nameEn}
                  </button>
                );
              })}
            </div>

            {/* Blueprint Cards (full-width 1-col on narrow portrait phones, 2-col on wider portrait screens) */}
            <div
              data-testid="build-blueprint-list"
              className="shrink-0 grid grid-cols-1 min-[420px]:grid-cols-2 gap-2"
            >
              {categoryBlueprints.map((bp) => {
                const active = bp.id === buildMode.selectedBlueprintId;
                const tierColor =
                  bp.tier === 'reinforced'
                    ? 'text-[#93c5fd] border-[#93c5fd]/40'
                    : bp.tier === 'stone'
                      ? 'text-[#cbd5e1] border-[#94a3b8]/40'
                      : 'text-[#e5a93c] border-[#e5a93c]/40';
                return (
                  <button
                    key={bp.id}
                    type="button"
                    data-testid={`build-bp-${bp.id}`}
                    onClick={() => onSelectBlueprint(bp.id)}
                    className={`w-full min-w-0 px-3 py-2.5 rounded-xl border text-start flex flex-col justify-between gap-2 transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#20382b] border-[#e5a93c] text-[#ffffff]'
                        : 'bg-[#14231b] border-white/12 text-[#d7e3d6] hover:bg-[#1a2e23]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <span className="text-xs font-semibold leading-snug break-words whitespace-normal min-w-0">
                        {isRtl ? bp.nameAr : bp.nameEn}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded border text-[10px] font-mono-num uppercase shrink-0 ${tierColor}`}
                      >
                        {bp.tier === 'reinforced'
                          ? 'Fe'
                          : bp.tier === 'stone'
                            ? 'St'
                            : 'Wd'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#a5baa8]">
                      {bp.costs.map((c) => (
                        <span
                          key={c.itemId}
                          className="px-2 py-0.5 rounded bg-[#0c1510] border border-white/8 break-words max-w-full"
                        >
                          {itemManager.getName(c.itemId, lang)} ×{c.count}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Selected Description, Required Materials & Friends/Permission Button */}
            <div className="shrink-0 flex flex-col gap-2.5 px-3 py-2.5 rounded-xl bg-[#13221a] border border-white/10">
              {selectedDesc && (
                <p className="text-xs text-[#c2d4c5] leading-relaxed break-words whitespace-normal">
                  {selectedDesc}
                </p>
              )}

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-[#e5a93c]">
                  {t.buildRequiredMaterials}:
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {buildMode.costStatus.map((cost) => (
                    <span
                      key={cost.itemId}
                      className={`px-2.5 py-1 rounded-md border text-xs font-mono-num font-semibold break-words max-w-full ${
                        cost.enough
                          ? 'bg-[#173322] border-[#4ade80]/40 text-[#9bf0b8]'
                          : 'bg-[#361818] border-[#f87171]/45 text-[#fca5a5]'
                      }`}
                    >
                      {cost.name}: {buildMode.isCreativeFree ? '∞' : cost.owned}
                      /{cost.required}
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-1.5 border-t border-white/10">
                <button
                  type="button"
                  data-testid="build-default-perm-btn"
                  onClick={handleCyclePermission}
                  className="w-full min-h-[40px] px-3 py-1.5 rounded-lg bg-[#192b21] hover:bg-[#22392c] border border-white/14 text-xs font-semibold text-[#dce8dd] inline-flex items-center justify-center gap-2 cursor-pointer"
                  title={t.buildDefaultPermLabel}
                >
                  <Shield className="w-4 h-4 text-[#7fe094] shrink-0" />
                  <span className="break-words">
                    {t.buildPermLabels[defaultPermission]}
                  </span>
                </button>
              </div>
            </div>

            {/* Rotation Steps & Fine Alignment Controls */}
            <div className="shrink-0 flex flex-col gap-2">
              {/* Rotation Increment Buttons */}
              <div className="grid grid-cols-4 gap-1.5">
                {ROTATION_STEPS.map((deg) => (
                  <button
                    key={deg}
                    type="button"
                    data-testid={`build-rot-step-${deg}`}
                    onClick={() => onSetRotationStep(deg)}
                    className={`min-h-[42px] px-2 rounded-lg border font-mono-num text-xs font-bold cursor-pointer flex items-center justify-center ${
                      buildMode.rotationStepDeg === deg
                        ? 'bg-[#223b2d] border-[#e5a93c] text-[#f6d37a]'
                        : 'bg-[#14231b] border-white/10 text-[#9db4a2]'
                    }`}
                  >
                    {deg}°
                  </button>
                ))}
              </div>

              {/* Nudge & Distance Fine Alignment (horizontally scrollable on ultra-narrow screens, never overlapping) */}
              <div
                className="flex flex-nowrap items-center justify-between gap-1.5 overflow-x-auto pb-0.5"
                style={{ touchAction: 'pan-x' }}
              >
                <button
                  type="button"
                  onClick={() => onNudge(-0.5, 0)}
                  aria-label={t.buildNudgeLeft}
                  title={t.buildNudgeLeft}
                  className="shrink-0 min-w-[40px] min-h-[42px] flex-1 rounded-lg bg-[#14231b] hover:bg-[#1d3126] border border-white/12 text-[#dce8dd] flex items-center justify-center cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onNudge(0, 0.5)}
                  aria-label={t.buildNudgeForward}
                  title={t.buildNudgeForward}
                  className="shrink-0 min-w-[40px] min-h-[42px] flex-1 rounded-lg bg-[#14231b] hover:bg-[#1d3126] border border-white/12 text-[#dce8dd] flex items-center justify-center cursor-pointer"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onNudge(0, -0.5)}
                  aria-label={t.buildNudgeBack}
                  title={t.buildNudgeBack}
                  className="shrink-0 min-w-[40px] min-h-[42px] flex-1 rounded-lg bg-[#14231b] hover:bg-[#1d3126] border border-white/12 text-[#dce8dd] flex items-center justify-center cursor-pointer"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onNudge(0.5, 0)}
                  aria-label={t.buildNudgeRight}
                  title={t.buildNudgeRight}
                  className="shrink-0 min-w-[40px] min-h-[42px] flex-1 rounded-lg bg-[#14231b] hover:bg-[#1d3126] border border-white/12 text-[#dce8dd] flex items-center justify-center cursor-pointer"
                >
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onAdjustDistance(-0.7)}
                  className="shrink-0 min-w-[42px] min-h-[42px] flex-1 px-2 rounded-lg bg-[#14231b] hover:bg-[#1d3126] border border-white/12 font-mono-num text-xs font-bold text-[#dce8dd] cursor-pointer"
                  title="-"
                >
                  -m
                </button>
                <button
                  type="button"
                  onClick={() => onAdjustDistance(0.7)}
                  className="shrink-0 min-w-[42px] min-h-[42px] flex-1 px-2 rounded-lg bg-[#14231b] hover:bg-[#1d3126] border border-white/12 font-mono-num text-xs font-bold text-[#dce8dd] cursor-pointer"
                  title="+"
                >
                  +m
                </button>
                <button
                  type="button"
                  onClick={onResetNudge}
                  className="shrink-0 min-w-[40px] min-h-[42px] flex-1 px-2 rounded-lg bg-[#14231b] hover:bg-[#1d3126] border border-white/12 text-xs font-semibold text-[#9eb5a3] cursor-pointer"
                >
                  0
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      data-testid="build-mode-overlay"
      className="fixed inset-0 z-[35] pointer-events-none select-none mobile-hud-safe"
    >
      {/* Top Status & Placement Readout Bar */}
      <div
        className="pointer-events-auto absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 w-[min(95vw,600px)]"
        style={{
          top: 'max(12px, env(safe-area-inset-top, 0px))',
        }}
      >
        <div className="w-full px-3 py-2 rounded-xl bg-[#0d1712]/92 border border-[#e5a93c]/45 shadow-xl flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Hammer className="w-4 h-4 text-[#e5a93c] shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-display text-xs sm:text-sm font-bold text-[#f5f8f2] truncate">
                  {selectedName}
                </span>
                <span
                  data-testid="build-validation-badge"
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${
                    buildMode.validPlacement
                      ? 'bg-[#163a26] border border-[#4ade80]/55 text-[#86efac]'
                      : 'bg-[#3d1717] border border-[#f87171]/55 text-[#fca5a5]'
                  }`}
                >
                  {buildMode.validPlacement
                    ? t.buildValidPlacement
                    : `${t.buildInvalidPlacement}: ${reasonText}`}
                </span>
                {buildMode.snappedToId && (
                  <span className="px-1.5 py-0.5 rounded-md bg-[#1d312a] border border-[#7dd3fc]/50 text-[#bae6fd] text-[10px] font-semibold">
                    {t.buildSnappedBadge}
                  </span>
                )}
                {buildMode.isCreativeFree && (
                  <span className="px-1.5 py-0.5 rounded-md bg-[#26293d] border border-[#93c5fd]/45 text-[#bfdbfe] text-[10px] font-semibold">
                    {t.buildCreativeFreeTag}
                  </span>
                )}
              </div>
              {!showMobileControls && (
                <p className="text-[10px] text-[#9eb5a3] mt-0.5 truncate">
                  {t.buildControlsHint}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <span
              dir="ltr"
              className="px-2 py-1 rounded-lg bg-[#15241c] border border-white/12 font-mono-num text-[11px] font-semibold text-[#e6efe7]"
            >
              {buildMode.rotationDeg}°
            </span>
            {showMobileControls && (
              <button
                type="button"
                data-testid="build-mobile-catalog-toggle"
                onClick={() => setMobileCatalogOpen((v) => !v)}
                className="min-h-[44px] px-2.5 py-1.5 rounded-lg bg-[#172820] hover:bg-[#20362b] border border-[#e5a93c]/45 text-xs font-semibold text-[#f5d384] inline-flex items-center gap-1 cursor-pointer"
              >
                {mobileCatalogOpen ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronUp className="w-4 h-4" />
                )}
                <span>{t.buildModeTitle}</span>
              </button>
            )}
            <button
              type="button"
              data-testid="build-exit-btn"
              onClick={onExit}
              className="min-h-[44px] px-2.5 py-1.5 rounded-lg bg-[#2b1a19] hover:bg-[#3c2220] border border-[#e05a47]/45 text-xs font-semibold text-[#fecaca] inline-flex items-center gap-1 cursor-pointer"
            >
              <X className="w-4 h-4" />
              <span className="hidden sm:inline">{t.buildExitBtn}</span>
            </button>
          </div>
        </div>

        {/* Mobile Quick Action Strip (always visible without blocking joystick/camera) */}
        {showMobileControls && (
          <div className="w-full px-2 py-1.5 rounded-xl bg-[#0d1712]/90 border border-white/14 shadow-lg flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-testid="build-rotate-left"
                onClick={() => onRotate(-1)}
                aria-label={t.buildRotateLeftBtn}
                className="min-w-[44px] min-h-[44px] px-2 rounded-lg bg-[#16271e] border border-white/14 text-[#e8efe5] flex items-center justify-center cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                type="button"
                data-testid="build-rotate-right"
                onClick={() => onRotate(1)}
                aria-label={t.buildRotateRightBtn}
                className="min-w-[44px] min-h-[44px] px-2 rounded-lg bg-[#16271e] border border-white/14 text-[#e8efe5] flex items-center justify-center cursor-pointer"
              >
                <RotateCw className="w-4 h-4" />
              </button>
              <button
                type="button"
                data-testid="build-snap-toggle"
                onClick={onToggleSnap}
                aria-label={t.buildSnapLabel}
                className={`min-w-[44px] min-h-[44px] px-2.5 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer ${
                  buildMode.snapEnabled
                    ? 'bg-[#1b3528] border-[#7dd3fc]/55 text-[#bae6fd]'
                    : 'bg-[#16271e] border-white/14 text-[#a9bdb0]'
                }`}
              >
                <Magnet className="w-4 h-4" />
                <span className="hidden xs:inline">
                  {buildMode.snapEnabled ? t.buildSnapOn : t.buildSnapOff}
                </span>
              </button>
            </div>

            <button
              type="button"
              data-testid="build-confirm-btn"
              onClick={onConfirmPlace}
              className={`min-h-[44px] px-4 rounded-xl border text-xs font-display font-bold inline-flex items-center gap-1.5 cursor-pointer shadow ${
                buildMode.validPlacement
                  ? 'bg-[#2a7d4f] hover:bg-[#33935e] border-[#7fe094]/70 text-[#ffffff]'
                  : 'bg-[#3b201d] border-[#f87171]/55 text-[#fecaca]'
              }`}
            >
              <Check className="w-4 h-4" />
              <span>{t.buildPlaceBtn}</span>
            </button>
          </div>
        )}
      </div>

      {/* Desktop Bottom Dock OR Mobile Expandable Catalog Drawer */}
      {(!showMobileControls || mobileCatalogOpen) && (
        <div
          className={`hud-panel-scroll pointer-events-auto absolute left-1/2 -translate-x-1/2 rounded-2xl bg-[#0d1712]/95 border border-[#2c4435] shadow-2xl p-2.5 sm:p-3 flex flex-col gap-2.5 ${
            showMobileControls
              ? 'w-[min(96vw,640px)] bottom-2 max-h-[calc(100dvh-132px)] overflow-y-auto overflow-x-hidden'
              : 'w-[min(95vw,820px)] bottom-3'
          }`}
        >
          {/* Category Tabs */}
          <div
            className="shrink-0 flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-1"
            style={{ touchAction: 'pan-x' }}
          >
            {BUILDING_CATEGORIES.map((cat) => {
              const active = buildMode.category === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  data-testid={`build-cat-${cat.id}`}
                  onClick={() => onSelectCategory(cat.id)}
                  className={`min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer shrink-0 ${
                    active
                      ? 'bg-[#213a2c] border-[#e5a93c]/85 text-[#ffffff]'
                      : 'bg-[#14231b] border-white/10 text-[#9db4a2] hover:bg-[#1a2e23]'
                  }`}
                >
                  {isRtl ? cat.nameAr : cat.nameEn}
                </button>
              );
            })}
          </div>

          {/* Blueprint Selector Strip */}
          <div
            data-testid="build-blueprint-list"
            className="shrink-0 flex flex-nowrap items-stretch gap-2 overflow-x-auto pb-1.5"
            style={{ touchAction: 'pan-x' }}
          >
            {categoryBlueprints.map((bp) => {
              const active = bp.id === buildMode.selectedBlueprintId;
              const tierColor =
                bp.tier === 'reinforced'
                  ? 'text-[#93c5fd] border-[#93c5fd]/40'
                  : bp.tier === 'stone'
                    ? 'text-[#cbd5e1] border-[#94a3b8]/40'
                    : 'text-[#e5a93c] border-[#e5a93c]/40';
              return (
                <button
                  key={bp.id}
                  type="button"
                  data-testid={`build-bp-${bp.id}`}
                  onClick={() => onSelectBlueprint(bp.id)}
                  className={`min-w-[148px] max-w-[178px] px-2.5 py-2 rounded-xl border text-start flex flex-col justify-between gap-1 transition-colors cursor-pointer shrink-0 ${
                    active
                      ? 'bg-[#20382b] border-[#e5a93c] text-[#ffffff]'
                      : 'bg-[#14231b] border-white/12 text-[#d7e3d6] hover:bg-[#1a2e23]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <span className="text-xs font-semibold leading-snug line-clamp-2">
                      {isRtl ? bp.nameAr : bp.nameEn}
                    </span>
                    <span
                      className={`px-1 py-0.5 rounded border text-[9px] font-mono-num uppercase shrink-0 ${tierColor}`}
                    >
                      {bp.tier === 'reinforced'
                        ? 'Fe'
                        : bp.tier === 'stone'
                          ? 'St'
                          : 'Wd'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 text-[10px] text-[#a5baa8]">
                    {bp.costs.map((c) => (
                      <span
                        key={c.itemId}
                        className="px-1.5 py-0.5 rounded bg-[#0c1510] border border-white/8 truncate max-w-[115px]"
                      >
                        {itemManager.getName(c.itemId, lang)} ×{c.count}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected Description & Required Materials */}
          <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-[#13221a] border border-white/10">
            <div className="min-w-0 flex-1">
              {selectedDesc && (
                <p className="text-[11px] text-[#b4c8b7] leading-snug break-words whitespace-normal mb-1.5">
                  {selectedDesc}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold text-[#e5a93c]">
                  {t.buildRequiredMaterials}:
                </span>
                {buildMode.costStatus.map((cost) => (
                  <span
                    key={cost.itemId}
                    className={`px-2 py-0.5 rounded-md border text-[11px] font-mono-num font-semibold ${
                      cost.enough
                        ? 'bg-[#173322] border-[#4ade80]/40 text-[#9bf0b8]'
                        : 'bg-[#361818] border-[#f87171]/45 text-[#fca5a5]'
                    }`}
                  >
                    {cost.name}: {buildMode.isCreativeFree ? '∞' : cost.owned}/
                    {cost.required}
                  </span>
                ))}
              </div>
            </div>

            {/* Default Permission Scope Toggle */}
            <button
              type="button"
              data-testid="build-default-perm-btn"
              onClick={handleCyclePermission}
              className="min-h-[38px] px-2.5 py-1 rounded-lg bg-[#192b21] hover:bg-[#22392c] border border-white/14 text-[11px] font-semibold text-[#dce8dd] inline-flex items-center gap-1.5 cursor-pointer shrink-0"
              title={t.buildDefaultPermLabel}
            >
              <Shield className="w-3.5 h-3.5 text-[#7fe094]" />
              <span>{t.buildPermLabels[defaultPermission]}</span>
            </button>
          </div>

          {/* Bottom Controls Row: Rotation Increment, Nudge, Distance, Snap, Confirm/Exit */}
          <div className="shrink-0 flex flex-wrap items-center justify-between gap-2">
            {/* Rotation & Step */}
            <div className="flex flex-wrap items-center gap-1">
              {ROTATION_STEPS.map((deg) => (
                <button
                  key={deg}
                  type="button"
                  data-testid={`build-rot-step-${deg}`}
                  onClick={() => onSetRotationStep(deg)}
                  className={`min-h-[40px] sm:min-h-[36px] px-2 rounded-lg border font-mono-num text-[11px] font-bold cursor-pointer ${
                    buildMode.rotationStepDeg === deg
                      ? 'bg-[#223b2d] border-[#e5a93c] text-[#f6d37a]'
                      : 'bg-[#14231b] border-white/10 text-[#9db4a2]'
                  }`}
                >
                  {deg}°
                </button>
              ))}
              {!showMobileControls && (
                <>
                  <button
                    type="button"
                    data-testid="build-rotate-left"
                    onClick={() => onRotate(-1)}
                    title={t.buildRotateLeftBtn}
                    className="min-h-[36px] px-2.5 rounded-lg bg-[#16271e] hover:bg-[#20362b] border border-white/14 text-[#e8efe5] inline-flex items-center gap-1 text-xs cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    data-testid="build-rotate-right"
                    onClick={() => onRotate(1)}
                    title={t.buildRotateRightBtn}
                    className="min-h-[36px] px-2.5 rounded-lg bg-[#16271e] hover:bg-[#20362b] border border-white/14 text-[#e8efe5] inline-flex items-center gap-1 text-xs cursor-pointer"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>

            {/* Nudge & Distance Fine Alignment */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onNudge(-0.5, 0)}
                aria-label={t.buildNudgeLeft}
                title={t.buildNudgeLeft}
                className="min-w-[38px] min-h-[38px] rounded-lg bg-[#14231b] hover:bg-[#1d3126] border border-white/12 text-[#dce8dd] flex items-center justify-center cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onNudge(0, 0.5)}
                aria-label={t.buildNudgeForward}
                title={t.buildNudgeForward}
                className="min-w-[38px] min-h-[38px] rounded-lg bg-[#14231b] hover:bg-[#1d3126] border border-white/12 text-[#dce8dd] flex items-center justify-center cursor-pointer"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onNudge(0, -0.5)}
                aria-label={t.buildNudgeBack}
                title={t.buildNudgeBack}
                className="min-w-[38px] min-h-[38px] rounded-lg bg-[#14231b] hover:bg-[#1d3126] border border-white/12 text-[#dce8dd] flex items-center justify-center cursor-pointer"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onNudge(0.5, 0)}
                aria-label={t.buildNudgeRight}
                title={t.buildNudgeRight}
                className="min-w-[38px] min-h-[38px] rounded-lg bg-[#14231b] hover:bg-[#1d3126] border border-white/12 text-[#dce8dd] flex items-center justify-center cursor-pointer"
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onAdjustDistance(-0.7)}
                className="min-h-[38px] px-2 rounded-lg bg-[#14231b] hover:bg-[#1d3126] border border-white/12 font-mono-num text-xs font-bold text-[#dce8dd] cursor-pointer"
                title="-"
              >
                -m
              </button>
              <button
                type="button"
                onClick={() => onAdjustDistance(0.7)}
                className="min-h-[38px] px-2 rounded-lg bg-[#14231b] hover:bg-[#1d3126] border border-white/12 font-mono-num text-xs font-bold text-[#dce8dd] cursor-pointer"
                title="+"
              >
                +m
              </button>
              <button
                type="button"
                onClick={onResetNudge}
                className="min-h-[38px] px-2 rounded-lg bg-[#14231b] hover:bg-[#1d3126] border border-white/12 text-[11px] font-semibold text-[#9eb5a3] cursor-pointer"
              >
                0
              </button>
            </div>

            {/* Desktop Snap + Confirm + Exit */}
            {!showMobileControls && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  data-testid="build-snap-toggle"
                  onClick={onToggleSnap}
                  className={`min-h-[38px] px-3 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                    buildMode.snapEnabled
                      ? 'bg-[#1b3528] border-[#7dd3fc]/55 text-[#bae6fd]'
                      : 'bg-[#16271e] border-white/14 text-[#a9bdb0]'
                  }`}
                >
                  <Magnet className="w-3.5 h-3.5" />
                  <span>
                    {buildMode.snapEnabled ? t.buildSnapOn : t.buildSnapOff}
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="build-confirm-btn"
                  onClick={onConfirmPlace}
                  className={`min-h-[38px] px-4 rounded-xl border text-xs font-display font-bold inline-flex items-center gap-1.5 cursor-pointer shadow ${
                    buildMode.validPlacement
                      ? 'bg-[#2a7d4f] hover:bg-[#33935e] border-[#7fe094]/70 text-[#ffffff]'
                      : 'bg-[#3b201d] border-[#f87171]/55 text-[#fecaca]'
                  }`}
                >
                  <Check className="w-4 h-4" />
                  <span>{t.buildPlaceBtn}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
