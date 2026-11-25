import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Compass,
  Dices,
  Flame,
  Hammer,
  Package,
  Shield,
  Sparkles,
} from 'lucide-react';
import { UI_TEXT, type Language } from '../../game/i18n/translations';
import type {
  DifficultyLevel,
  NewWorldOptions,
  WorldType,
} from '../../game/save/saveTypes';
import {
  getModManager,
  type ModRecord,
  type ModsSnapshot,
  type WorldModSelectionEntry,
} from '../../game/mods';
import { DEFAULT_WORLD_SEED } from '../../game/math/noise';
import {
  STAMINA_BY_MODE,
  isInfiniteStaminaMode,
} from '../../game/player/staminaConfig';

interface CreateWorldScreenProps {
  lang: Language;
  defaultDifficulty?: DifficultyLevel;
  onCreateWorld: (options: NewWorldOptions) => void;
  onBack: () => void;
}

const HARD_INCOMPATIBLE_STATUSES = new Set<ModRecord['status']>([
  'incompatible',
  'corrupted',
  'incomplete',
  'unsafe',
  'duplicate',
  'missing_dependency',
  'circular_dependency',
]);

function isModSelectableForWorld(rec: ModRecord): boolean {
  return (
    rec.hasValidManifest &&
    rec.gameCompatible &&
    !HARD_INCOMPATIBLE_STATUSES.has(rec.status)
  );
}

function deduplicateModsForSelection(mods: ReadonlyArray<ModRecord>): ModRecord[] {
  const byId = new Map<string, ModRecord>();
  for (const rec of mods) {
    const id = rec.manifest.modId;
    if (!id) continue;
    const prev = byId.get(id);
    if (
      !prev ||
      (!isModSelectableForWorld(prev) && isModSelectableForWorld(rec)) ||
      (!prev.loaded && rec.loaded)
    ) {
      byId.set(id, rec);
    }
  }
  return Array.from(byId.values()).sort(
    (a, b) =>
      (a.effectivePriority ?? a.manifest.loadPriority ?? 100) -
        (b.effectivePriority ?? b.manifest.loadPriority ?? 100) ||
      a.manifest.modId.localeCompare(b.manifest.modId),
  );
}

interface OrderedWorldModRow {
  modId: string;
  enabled: boolean;
}

function generateRandomSeed(): number {
  return Math.floor(100000 + Math.random() * 899999);
}

function parseSeedInput(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return generateRandomSeed();
  if (/^-?\d+$/.test(trimmed)) {
    const num = Math.abs(parseInt(trimmed, 10));
    return num > 0 ? num : DEFAULT_WORLD_SEED;
  }
  let hash = 2166136261;
  for (let i = 0; i < trimmed.length; i++) {
    hash ^= trimmed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || DEFAULT_WORLD_SEED;
}

export const CreateWorldScreen: React.FC<CreateWorldScreenProps> = ({
  lang,
  defaultDifficulty = 'normal',
  onCreateWorld,
  onBack,
}) => {
  const t = UI_TEXT[lang];
  const isRtl = lang === 'ar';
  const modManager = useMemo(() => getModManager(), []);

  const [worldName, setWorldName] = useState(() =>
    lang === 'ar' ? 'وادي أوكهولو' : 'Oakhollow Chronicle',
  );
  const [seedInput, setSeedInput] = useState<string>(() =>
    String(generateRandomSeed()),
  );
  const [worldType, setWorldType] = useState<WorldType>('normal');
  const [difficulty, setDifficulty] =
    useState<DifficultyLevel>(defaultDifficulty);
  const [nameError, setNameError] = useState<string | null>(null);

  const [modsSnapshot, setModsSnapshot] = useState<ModsSnapshot>(() =>
    modManager.getSnapshot(),
  );
  const availableMods = useMemo(
    () => deduplicateModsForSelection(modsSnapshot.mods),
    [modsSnapshot.mods],
  );
  const userChoseModeRef = useRef(false);
  const [modMode, setModMode] = useState<'vanilla' | 'modded'>(() => {
    const initial = deduplicateModsForSelection(modManager.getSnapshot().mods);
    return initial.some((m) => isModSelectableForWorld(m) && m.status === 'active')
      ? 'modded'
      : 'vanilla';
  });
  const [orderedMods, setOrderedMods] = useState<OrderedWorldModRow[]>(() =>
    deduplicateModsForSelection(modManager.getSnapshot().mods).map((m) => ({
      modId: m.manifest.modId,
      enabled: isModSelectableForWorld(m) && m.status === 'active',
    })),
  );

  useEffect(() => {
    const unsub = modManager.subscribe((next) => setModsSnapshot(next));
    void modManager.initialize().then(() => modManager.refreshMods());
    return unsub;
  }, [modManager]);

  useEffect(() => {
    const recordMap = new Map(availableMods.map((m) => [m.manifest.modId, m]));
    setOrderedMods((prev) => {
      const seen = new Set<string>();
      const next: OrderedWorldModRow[] = [];
      for (const row of prev) {
        const rec = recordMap.get(row.modId);
        if (!rec) continue;
        seen.add(row.modId);
        next.push({
          modId: row.modId,
          enabled: isModSelectableForWorld(rec) ? row.enabled : false,
        });
      }
      for (const rec of availableMods) {
        const id = rec.manifest.modId;
        if (seen.has(id)) continue;
        next.push({
          modId: id,
          enabled: isModSelectableForWorld(rec) && rec.status === 'active',
        });
      }
      return next;
    });

    if (!userChoseModeRef.current) {
      const hasAnyActiveReady = availableMods.some(
        (m) => isModSelectableForWorld(m) && m.status === 'active',
      );
      setModMode(hasAnyActiveReady ? 'modded' : 'vanilla');
    }
  }, [availableMods]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onBack]);

  const recordById = useMemo(
    () => new Map(availableMods.map((m) => [m.manifest.modId, m])),
    [availableMods],
  );

  const selectedModCount = useMemo(
    () => orderedMods.filter((m) => m.enabled && Boolean(recordById.get(m.modId))).length,
    [orderedMods, recordById],
  );

  const handleToggleModEntry = (modId: string) => {
    const rec = recordById.get(modId);
    if (!rec || !isModSelectableForWorld(rec)) return;
    setOrderedMods((prev) =>
      prev.map((row) =>
        row.modId === modId ? { ...row, enabled: !row.enabled } : row,
      ),
    );
  };

  const handleMoveMod = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= orderedMods.length) return;
    setOrderedMods((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const handleEnableReadyMods = () => {
    setOrderedMods((prev) =>
      prev.map((row) => {
        const rec = recordById.get(row.modId);
        return {
          ...row,
          enabled: Boolean(rec && isModSelectableForWorld(rec)),
        };
      }),
    );
  };

  const handleDisableAllMods = () => {
    setOrderedMods((prev) => prev.map((row) => ({ ...row, enabled: false })));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = worldName.trim();
    if (!cleaned) {
      setNameError(t.worldNameRequiredError);
      return;
    }
    setNameError(null);

    const selectedMods: WorldModSelectionEntry[] =
      modMode === 'vanilla'
        ? []
        : orderedMods.map((row, idx) => ({
            modId: row.modId,
            enabled: row.enabled,
            loadOrder: idx,
          }));

    onCreateWorld({
      worldName: cleaned.slice(0, 40),
      seed: parseSeedInput(seedInput),
      worldType,
      difficulty,
      modMode,
      selectedMods,
    });
  };

  const worldTypes: Array<{
    id: WorldType;
    label: string;
    desc: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'normal',
      label: t.worldTypeNormal,
      desc: t.worldTypeNormalDesc,
      icon: <Compass className="w-4 h-4" />,
    },
    {
      id: 'adventure',
      label: t.worldTypeAdventure,
      desc: t.worldTypeAdventureDesc,
      icon: <Sparkles className="w-4 h-4" />,
    },
    {
      id: 'survival',
      label: t.worldTypeSurvival,
      desc: t.worldTypeSurvivalDesc,
      icon: <Flame className="w-4 h-4" />,
    },
    {
      id: 'creative',
      label: t.worldTypeCreative,
      desc: t.worldTypeCreativeDesc,
      icon: <Hammer className="w-4 h-4" />,
    },
  ];

  const difficulties: Array<{ id: DifficultyLevel; label: string }> = [
    { id: 'easy', label: t.diffEasy },
    { id: 'normal', label: t.diffNormal },
    { id: 'hard', label: t.diffHard },
  ];

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#08110c]/72 backdrop-blur-md p-3 sm:p-6 mobile-hud-safe pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-world-title"
      data-testid="create-world-screen"
    >
      <form
        onSubmit={handleSubmit}
        className="woa-surface w-full max-w-xl max-h-[90dvh] flex flex-col rounded-2xl bg-[#101c16]/94 border border-[#2b4436] text-[#f2f6ef] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div>
            <h2
              id="create-world-title"
              className="font-display text-xl sm:text-2xl font-bold tracking-tight"
            >
              {t.createWorldTitle}
            </h2>
            <p className="woa-muted-text text-xs sm:text-sm text-[#9db1a1] mt-0.5">
              {t.createWorldSubtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            data-testid="create-world-back-top"
            className="min-w-[44px] min-h-[44px] px-3 rounded-xl bg-[#182920] hover:bg-[#22392d] border border-white/12 inline-flex items-center justify-center gap-1.5 text-xs font-medium text-[#dce5d8] cursor-pointer shrink-0"
          >
            <ArrowLeft className={`w-4 h-4 ${isRtl ? 'rotate-180' : ''}`} />
            <span className="hidden sm:inline">{t.backBtn}</span>
          </button>
        </div>

        {/* Scrollable Fields */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          {/* World Name */}
          <div>
            <label
              htmlFor="world-name-input"
              className="block text-xs sm:text-sm font-semibold text-[#e6eee4] mb-1.5"
            >
              {t.worldNameLabel}
            </label>
            <input
              id="world-name-input"
              type="text"
              data-testid="world-name-input"
              maxLength={40}
              value={worldName}
              onChange={(e) => {
                setWorldName(e.target.value);
                if (nameError && e.target.value.trim()) setNameError(null);
              }}
              placeholder={t.worldNamePlaceholder}
              className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#0a140f] border border-[#2f493b] focus:border-[#e5a93c] focus:outline-none text-sm text-[#f7faf5] placeholder-[#687e6d]"
            />
            {nameError && (
              <p
                data-testid="world-name-error"
                className="mt-1.5 text-xs font-medium text-[#f28b7d]"
              >
                {nameError}
              </p>
            )}
          </div>

          {/* World Seed */}
          <div>
            <label
              htmlFor="world-seed-input"
              className="block text-xs sm:text-sm font-semibold text-[#e6eee4] mb-1.5"
            >
              {t.worldSeedLabel}
            </label>
            <div className="flex gap-2">
              <input
                id="world-seed-input"
                type="text"
                data-testid="world-seed-input"
                maxLength={24}
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                placeholder={t.worldSeedPlaceholder}
                dir="ltr"
                className="flex-1 min-w-0 min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#0a140f] border border-[#2f493b] focus:border-[#e5a93c] focus:outline-none text-sm font-mono-num text-[#f7faf5] placeholder-[#687e6d]"
              />
              <button
                type="button"
                data-testid="random-seed-btn"
                onClick={() => setSeedInput(String(generateRandomSeed()))}
                className="min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#192c22] hover:bg-[#233d2f] border border-[#345443] text-xs sm:text-sm font-medium text-[#f2f6ef] inline-flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Dices className="w-4 h-4 text-[#e5a93c]" />
                <span>{t.randomSeedBtn}</span>
              </button>
            </div>
          </div>

          {/* World Type */}
          <div>
            <div className="text-xs sm:text-sm font-semibold text-[#e6eee4] mb-2">
              {t.worldTypeLabel}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {worldTypes.map((wt) => {
                const selected = worldType === wt.id;
                const modeStamina = STAMINA_BY_MODE[wt.id];
                const isInf = isInfiniteStaminaMode(wt.id);
                const staminaBadge = isInf ? '∞' : String(modeStamina);
                return (
                  <button
                    key={wt.id}
                    type="button"
                    data-testid={`world-type-${wt.id}`}
                    aria-pressed={selected}
                    onClick={() => setWorldType(wt.id)}
                    className={`min-h-[60px] p-3 rounded-xl border text-start transition-colors cursor-pointer flex items-start gap-2.5 ${
                      selected
                        ? 'bg-[#20382b] border-[#e5a93c] text-[#ffffff]'
                        : 'bg-[#0c1712] hover:bg-[#15251d] border-[#294034] text-[#dce5d8]'
                    }`}
                  >
                    <span
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                        selected
                          ? 'bg-[#e5a93c] text-[#111914]'
                          : 'bg-white/8 text-[#e5a93c]'
                      }`}
                    >
                      {wt.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-display font-bold text-sm leading-tight truncate">
                          {wt.label}
                        </span>
                        <span
                          dir="ltr"
                          data-testid={`world-type-stamina-${wt.id}`}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono-num font-bold shrink-0 ${
                            isInf
                              ? 'bg-[#0c2734] border border-[#38bdf8]/45 text-[#7dd3fc]'
                              : 'bg-[#17281e] border border-[#2f493b] text-[#e6b34d]'
                          }`}
                        >
                          {t.staminaModeBadge(staminaBadge)}
                        </span>
                      </span>
                      <span className="woa-muted-text block text-[11px] text-[#9cb0a0] mt-0.5 leading-snug">
                        {wt.desc}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Difficulty */}
          <div>
            <div className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[#e6eee4] mb-2">
              <Shield className="w-4 h-4 text-[#7fe094]" />
              <span>{t.difficultyLabel}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {difficulties.map((d) => {
                const selected = difficulty === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    data-testid={`difficulty-${d.id}`}
                    aria-pressed={selected}
                    onClick={() => setDifficulty(d.id)}
                    className={`min-h-[44px] px-3 py-2 rounded-xl border font-display font-semibold text-xs sm:text-sm transition-colors cursor-pointer ${
                      selected
                        ? 'bg-[#20382b] border-[#e5a93c] text-[#ffffff]'
                        : 'bg-[#0c1712] hover:bg-[#15251d] border-[#294034] text-[#b9cbbd]'
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* World Mods & Isolation */}
          <div data-testid="create-world-mods-section">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[#e6eee4]">
                <Package className="w-4 h-4 text-[#e5a93c]" />
                <span>{t.worldModsSectionTitle}</span>
              </div>
              <span className="text-[11px] font-mono-num text-[#9db1a1]">
                {modMode === 'vanilla'
                  ? t.worldBadgeVanilla
                  : t.worldBadgeModded(selectedModCount)}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="world-mods-mode-vanilla"
                aria-pressed={modMode === 'vanilla'}
                onClick={() => {
                  userChoseModeRef.current = true;
                  setModMode('vanilla');
                }}
                className={`p-3 rounded-xl border text-start transition-colors cursor-pointer ${
                  modMode === 'vanilla'
                    ? 'bg-[#20382b] border-[#e5a93c] text-[#ffffff]'
                    : 'bg-[#0c1712] hover:bg-[#15251d] border-[#294034] text-[#dce5d8]'
                }`}
              >
                <div className="font-display font-bold text-xs sm:text-sm">
                  {t.worldModsModeVanilla}
                </div>
                <div className="text-[11px] text-[#9cb0a0] mt-0.5 leading-snug">
                  {t.worldModsModeVanillaDesc}
                </div>
              </button>

              <button
                type="button"
                data-testid="world-mods-mode-modded"
                aria-pressed={modMode === 'modded'}
                onClick={() => {
                  userChoseModeRef.current = true;
                  setModMode('modded');
                }}
                className={`p-3 rounded-xl border text-start transition-colors cursor-pointer ${
                  modMode === 'modded'
                    ? 'bg-[#20382b] border-[#e5a93c] text-[#ffffff]'
                    : 'bg-[#0c1712] hover:bg-[#15251d] border-[#294034] text-[#dce5d8]'
                }`}
              >
                <div className="font-display font-bold text-xs sm:text-sm">
                  {t.worldModsModeModded}
                </div>
                <div className="text-[11px] text-[#9cb0a0] mt-0.5 leading-snug">
                  {t.worldModsModeModdedDesc}
                </div>
              </button>
            </div>

            {modMode === 'modded' && (
              <div className="mt-2.5 rounded-xl bg-[#0a140f] border border-[#294034] p-3 space-y-2">
                {orderedMods.length === 0 ? (
                  <p className="text-xs text-[#9cb0a0] leading-relaxed">
                    {t.worldModsEmptyInstalledHint}
                  </p>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-white/8">
                      <span className="text-[11px] font-medium text-[#b5c7b7]">
                        {t.worldBadgeModded(selectedModCount)}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          data-testid="world-mods-enable-all"
                          onClick={handleEnableReadyMods}
                          className="px-2.5 py-1 rounded-lg bg-[#192c22] hover:bg-[#233d2f] border border-[#345443] text-[11px] font-medium text-[#dce5d8] cursor-pointer"
                        >
                          {t.worldModsEnableAllBtn}
                        </button>
                        <button
                          type="button"
                          data-testid="world-mods-clear-all"
                          onClick={handleDisableAllMods}
                          className="px-2.5 py-1 rounded-lg bg-[#16231c] hover:bg-[#1f3127] border border-white/10 text-[11px] font-medium text-[#b5c7b7] cursor-pointer"
                        >
                          {t.worldModsClearAllBtn}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                      {orderedMods.map((row, idx) => {
                        const rec = recordById.get(row.modId);
                        if (!rec) return null;
                        const selectable = isModSelectableForWorld(rec);
                        const depCount = rec.manifest.dependencies.length;
                        return (
                          <div
                            key={row.modId}
                            data-testid={`create-world-mod-row-${row.modId}`}
                            className={`flex items-center gap-2 p-2 rounded-lg border ${
                              row.enabled && selectable
                                ? 'bg-[#172b20] border-[#e5a93c]/55'
                                : 'bg-[#0e1b14] border-white/10'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={row.enabled && selectable}
                              disabled={!selectable}
                              aria-label={rec.manifest.name}
                              data-testid={`create-world-mod-toggle-${row.modId}`}
                              onChange={() => handleToggleModEntry(row.modId)}
                              className="w-4 h-4 accent-[#e5a93c] cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-display font-semibold text-xs text-[#f2f6ef] truncate">
                                  {rec.manifest.name}
                                </span>
                                <span
                                  dir="ltr"
                                  className="text-[10px] font-mono-num text-[#9db1a1]"
                                >
                                  v{rec.manifest.version}
                                </span>
                                {selectable ? (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[#7fe094]">
                                    <CheckCircle2 className="w-3 h-3" />
                                    #{idx + 1}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[#f28b7d]">
                                    <AlertTriangle className="w-3 h-3" />
                                    {t.worldRecoveryStatusIncompatible}
                                  </span>
                                )}
                              </div>
                              <div
                                dir="ltr"
                                className="text-[10px] font-mono-num text-[#7f9483] truncate"
                              >
                                {rec.manifest.modId}
                                {depCount > 0 ? ` · ${depCount} dep(s)` : ''}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                disabled={idx === 0}
                                title={t.worldModsMoveUp}
                                aria-label={t.worldModsMoveUp}
                                onClick={() => handleMoveMod(idx, -1)}
                                className="p-1 rounded bg-[#16261d] hover:bg-[#22392d] disabled:opacity-35 text-[#dce5d8] cursor-pointer disabled:cursor-not-allowed"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === orderedMods.length - 1}
                                title={t.worldModsMoveDown}
                                aria-label={t.worldModsMoveDown}
                                onClick={() => handleMoveMod(idx, 1)}
                                className="p-1 rounded bg-[#16261d] hover:bg-[#22392d] disabled:opacity-35 text-[#dce5d8] cursor-pointer disabled:cursor-not-allowed"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-4 border-t border-white/10 bg-[#0c1611]/90 flex flex-col sm:flex-row-reverse gap-2.5 shrink-0">
          <button
            type="submit"
            data-testid="create-world-submit-btn"
            className="flex-1 min-h-[48px] px-5 py-3 rounded-xl bg-[#e5a93c] hover:bg-[#eeb750] text-[#111914] font-display font-bold text-sm sm:text-base tracking-wide transition-colors cursor-pointer"
          >
            {t.createWorldBtn}
          </button>
          <button
            type="button"
            data-testid="create-world-back-btn"
            onClick={onBack}
            className="sm:min-w-[120px] min-h-[48px] px-4 py-3 rounded-xl bg-[#182920] hover:bg-[#22382c] border border-[#2f493b] text-sm font-semibold text-[#e4ece1] transition-colors cursor-pointer"
          >
            {t.backBtn}
          </button>
        </div>
      </form>
    </div>
  );
};

