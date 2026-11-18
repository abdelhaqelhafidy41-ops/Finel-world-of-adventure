import React, { useEffect, useState } from 'react';
import {
  Accessibility,
  ArrowLeft,
  Check,
  Gamepad2,
  Languages,
  Monitor,
  RotateCcw,
  Sliders,
  Volume2,
} from 'lucide-react';
import { UI_TEXT, type Language } from '../../game/i18n/translations';
import type {
  CameraPerspective,
  GameSettings,
  MobileControlSettings,
} from '../../game/types';
import { DEFAULT_MOBILE_SETTINGS } from '../../game/types';
import type { DifficultyLevel } from '../../game/save/saveTypes';
import {
  DEFAULT_GRAPHICS_SETTINGS,
  type FpsLimitOption,
  type GraphicsSettings,
  type QualityPreset,
  type ShadowQualityTier,
  type ViewDistanceTier,
} from '../../game/engine/GraphicsQualityManager';
import {
  createDefaultExtendedSettings,
  type AudioSettings,
  type ExtendedGameSettings,
  type TextSizePreference,
} from '../../game/settings/GameSettingsStore';

export type SettingsTabId =
  | 'graphics'
  | 'audio'
  | 'controls'
  | 'gameplay'
  | 'accessibility';

interface SettingsScreenProps {
  lang: Language;
  graphicsSettings: GraphicsSettings;
  extendedSettings: ExtendedGameSettings;
  gameSettings: GameSettings;
  mobileSettings: MobileControlSettings;
  showMobileControls: boolean;
  onApply: (payload: {
    lang: Language;
    graphics: GraphicsSettings;
    extended: ExtendedGameSettings;
    game: GameSettings;
    mobile: MobileControlSettings;
  }) => void;
  onPreviewAudio?: (audio: AudioSettings) => void;
  onResetAll: () => void;
  onOpenCustomizeControls: () => void;
  onBack: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  lang,
  graphicsSettings,
  extendedSettings,
  gameSettings,
  mobileSettings,
  showMobileControls,
  onApply,
  onPreviewAudio,
  onResetAll,
  onOpenCustomizeControls,
  onBack,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('graphics');
  const [draftLang, setDraftLang] = useState<Language>(lang);
  const [draftGraphics, setDraftGraphics] =
    useState<GraphicsSettings>(graphicsSettings);
  const [draftExtended, setDraftExtended] =
    useState<ExtendedGameSettings>(extendedSettings);
  const [draftGame, setDraftGame] = useState<GameSettings>(gameSettings);
  const [draftMobile, setDraftMobile] =
    useState<MobileControlSettings>(mobileSettings);
  const [appliedBanner, setAppliedBanner] = useState(false);

  // Sync incoming resets from parent if reset button clicked
  useEffect(() => {
    setDraftLang(lang);
    setDraftGraphics(graphicsSettings);
    setDraftExtended(extendedSettings);
    setDraftGame(gameSettings);
    setDraftMobile(mobileSettings);
  }, [
    lang,
    graphicsSettings,
    extendedSettings,
    gameSettings,
    mobileSettings,
  ]);

  const handleBackClick = React.useCallback(() => {
    onPreviewAudio?.(extendedSettings.audio);
    onBack();
  }, [extendedSettings.audio, onBack, onPreviewAudio]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleBackClick();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleBackClick]);

  const t = UI_TEXT[draftLang];
  const isRtl = draftLang === 'ar';

  const tabs: Array<{
    id: SettingsTabId;
    label: string;
    icon: React.ReactNode;
  }> = [
    { id: 'graphics', label: t.tabGraphics, icon: <Monitor className="w-4 h-4" /> },
    { id: 'audio', label: t.tabAudio, icon: <Volume2 className="w-4 h-4" /> },
    { id: 'controls', label: t.tabControls, icon: <Gamepad2 className="w-4 h-4" /> },
    { id: 'gameplay', label: t.tabGameplay, icon: <Sliders className="w-4 h-4" /> },
    {
      id: 'accessibility',
      label: t.tabAccessibility,
      icon: <Accessibility className="w-4 h-4" />,
    },
  ];

  const updateDraftAudio = (patch: Partial<AudioSettings>) => {
    setDraftExtended((ext) => {
      const nextAudio: AudioSettings = { ...ext.audio, ...patch };
      onPreviewAudio?.(nextAudio);
      return {
        ...ext,
        audio: nextAudio,
      };
    });
    if (typeof patch.muted === 'boolean') {
      setDraftGame((g) => ({ ...g, muted: patch.muted! }));
    }
  };

  const handleApplyClick = () => {
    onApply({
      lang: draftLang,
      graphics: draftGraphics,
      extended: {
        ...draftExtended,
        audio: {
          ...draftExtended.audio,
        },
        camera: {
          ...draftExtended.camera,
          sensitivity: draftGame.mouseSensitivity,
          invertY: draftGame.invertY,
        },
      },
      game: {
        ...draftGame,
        muted: draftExtended.audio.muted,
      },
      mobile: draftMobile,
    });
    setAppliedBanner(true);
    window.setTimeout(() => setAppliedBanner(false), 1800);
  };

  const handleResetClick = () => {
    const defExt = createDefaultExtendedSettings();
    setDraftGraphics({ ...DEFAULT_GRAPHICS_SETTINGS });
    setDraftExtended(defExt);
    setDraftGame({
      mouseSensitivity: defExt.camera.sensitivity,
      muted: defExt.audio.muted,
      invertY: defExt.camera.invertY,
    });
    setDraftMobile({ ...DEFAULT_MOBILE_SETTINGS });
    onPreviewAudio?.(defExt.audio);
    onResetAll();
  };

  const cameraPerspectives: Array<{ id: CameraPerspective; label: string }> = [
    { id: 'first-person', label: t.perspectiveFirstPerson },
    { id: 'second-person', label: t.perspectiveSecondPerson },
    { id: 'third-person', label: t.perspectiveThirdPerson },
  ];

  const qualityPresets: Array<{ id: QualityPreset; label: string }> = [
    { id: 'auto', label: t.tierAuto },
    { id: 'very-low', label: t.tierVeryLow },
    { id: 'low', label: t.tierLow },
    { id: 'medium', label: t.tierMedium },
    { id: 'high', label: t.tierHigh },
    { id: 'ultra', label: t.tierUltra },
  ];

  const viewDistOptions: Array<{ id: 'auto' | ViewDistanceTier; label: string }> = [
    { id: 'auto', label: t.tierAuto },
    { id: 'low', label: t.tierLow },
    { id: 'medium', label: t.tierMedium },
    { id: 'high', label: t.tierHigh },
    { id: 'ultra', label: t.tierUltra },
  ];

  const shadowOptions: Array<{ id: 'auto' | ShadowQualityTier; label: string }> = [
    { id: 'auto', label: t.tierAuto },
    { id: 'off', label: t.tierOff },
    { id: 'low', label: t.tierLow },
    { id: 'medium', label: t.tierMedium },
    { id: 'high', label: t.tierHigh },
  ];

  const fpsLimits: Array<{ value: FpsLimitOption; label: string }> = [
    { value: 'auto', label: t.tierAuto },
    { value: 30, label: '30 FPS' },
    { value: 45, label: '45 FPS' },
    { value: 60, label: '60 FPS' },
  ];

  const difficulties: Array<{ id: DifficultyLevel; label: string }> = [
    { id: 'easy', label: t.diffEasy },
    { id: 'normal', label: t.diffNormal },
    { id: 'hard', label: t.diffHard },
  ];

  const textSizes: Array<{ id: TextSizePreference; label: string }> = [
    { id: 'small', label: t.textSizeSmall },
    { id: 'normal', label: t.textSizeNormal },
    { id: 'large', label: t.textSizeLarge },
  ];

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#08110c]/76 backdrop-blur-md p-2.5 sm:p-6 mobile-hud-safe pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-screen-title"
      data-testid="settings-screen"
    >
      <div className="woa-surface w-full max-w-2xl max-h-[90dvh] flex flex-col rounded-2xl bg-[#101c16]/95 border border-[#2b4436] text-[#f2f6ef] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div>
            <h2
              id="settings-screen-title"
              className="font-display text-xl sm:text-2xl font-bold tracking-tight"
            >
              {t.settingsTitle}
            </h2>
            <p className="woa-muted-text text-xs text-[#9db1a1] mt-0.5 hidden sm:block">
              {t.settingsSubtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={handleBackClick}
            data-testid="settings-back-top"
            className="min-w-[44px] min-h-[44px] px-3 rounded-xl bg-[#182920] hover:bg-[#22392d] border border-white/12 inline-flex items-center justify-center gap-1.5 text-xs font-medium text-[#dce5d8] cursor-pointer shrink-0"
          >
            <ArrowLeft className={`w-4 h-4 ${isRtl ? 'rotate-180' : ''}`} />
            <span className="hidden sm:inline">{t.backBtn}</span>
          </button>
        </div>

        {/* 5 Category Tabs */}
        <div
          role="tablist"
          aria-label={t.settingsTitle}
          className="px-3 sm:px-5 py-2.5 border-b border-white/10 bg-[#0b1510]/85 flex items-center gap-1.5 overflow-x-auto shrink-0"
        >
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`settings-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-[40px] px-3 py-1.5 rounded-xl border text-xs font-display font-bold tracking-wide inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#e5a93c] border-[#ffd88a]/50 text-[#111914]'
                    : 'bg-[#14231b] hover:bg-[#1c3026] border-white/10 text-[#c9d9ca]'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-5">
          {activeTab === 'graphics' && (
            <div className="space-y-4" data-testid="settings-panel-graphics">
              <div>
                <div className="text-xs font-semibold text-[#e6eee4] mb-2">
                  {t.graphicsPresetLabel}
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                  {qualityPresets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      data-testid={`gfx-preset-${p.id}`}
                      onClick={() =>
                        setDraftGraphics((g) => ({ ...g, preset: p.id }))
                      }
                      className={`min-h-[40px] px-2 py-1.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                        draftGraphics.preset === p.id
                          ? 'bg-[#21382b] border-[#e5a93c] text-white'
                          : 'bg-[#0c1712] border-white/10 text-[#b7c8b8] hover:bg-[#15251d]'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-[#e6eee4] mb-2">
                  {t.viewDistanceLabel}
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                  {viewDistOptions.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() =>
                        setDraftGraphics((g) => ({ ...g, viewDistance: o.id }))
                      }
                      className={`min-h-[38px] px-1.5 py-1 rounded-xl border text-xs font-medium cursor-pointer ${
                        draftGraphics.viewDistance === o.id
                          ? 'bg-[#21382b] border-[#e5a93c] text-white'
                          : 'bg-[#0c1712] border-white/10 text-[#b7c8b8] hover:bg-[#15251d]'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-[#e6eee4] mb-2">
                  {t.shadowQualityLabel}
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                  {shadowOptions.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() =>
                        setDraftGraphics((g) => ({ ...g, shadowQuality: o.id }))
                      }
                      className={`min-h-[38px] px-1.5 py-1 rounded-xl border text-xs font-medium cursor-pointer ${
                        draftGraphics.shadowQuality === o.id
                          ? 'bg-[#21382b] border-[#e5a93c] text-white'
                          : 'bg-[#0c1712] border-white/10 text-[#b7c8b8] hover:bg-[#15251d]'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-[#e6eee4] mb-2">
                  {t.fpsLimitLabel}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {fpsLimits.map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() =>
                        setDraftGraphics((g) => ({ ...g, fpsLimit: f.value }))
                      }
                      className={`min-h-[38px] px-2 py-1 rounded-xl border text-xs font-mono-num font-semibold cursor-pointer ${
                        draftGraphics.fpsLimit === f.value
                          ? 'bg-[#21382b] border-[#e5a93c] text-white'
                          : 'bg-[#0c1712] border-white/10 text-[#b7c8b8] hover:bg-[#15251d]'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-white/10">
                <ToggleRow
                  label={t.vsyncLabel}
                  checked={draftExtended.vsync}
                  testId="toggle-vsync"
                  onChange={(v) =>
                    setDraftExtended((ext) => ({ ...ext, vsync: v }))
                  }
                />
                <ToggleRow
                  label={t.dynamicQualityLabel}
                  checked={draftExtended.dynamicQuality}
                  testId="toggle-dynamic-quality"
                  onChange={(v) =>
                    setDraftExtended((ext) => ({ ...ext, dynamicQuality: v }))
                  }
                />
              </div>
            </div>
          )}

          {activeTab === 'audio' && (
            <div className="space-y-4" data-testid="settings-panel-audio">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="font-display text-xs font-bold uppercase tracking-wider text-[#e5a93c]">
                  {t.audioSectionTitle}
                </span>
              </div>

              <div className="space-y-2.5">
                <SegmentedOnOffRow
                  label={t.menuMusicLabel}
                  enabled={draftExtended.audio.menuMusicEnabled}
                  onLabel={t.audioToggleOn}
                  offLabel={t.audioToggleOff}
                  testIdPrefix="toggle-menu-music"
                  onChange={(enabled) =>
                    updateDraftAudio({ menuMusicEnabled: enabled })
                  }
                />

                <SegmentedOnOffRow
                  label={t.soundEffectsLabel}
                  enabled={draftExtended.audio.soundEffectsEnabled}
                  onLabel={t.audioToggleOn}
                  offLabel={t.audioToggleOff}
                  testIdPrefix="toggle-sound-effects"
                  onChange={(enabled) =>
                    updateDraftAudio({ soundEffectsEnabled: enabled })
                  }
                />
              </div>

              <div className="space-y-3 pt-1">
                <SliderRow
                  id="slider-master-vol"
                  label={t.masterVolumeLabel}
                  valueText={`${Math.round(draftExtended.audio.masterVolume * 100)}%`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={draftExtended.audio.masterVolume}
                  onChange={(val) => updateDraftAudio({ masterVolume: val })}
                />

                <SliderRow
                  id="slider-music-vol"
                  label={t.musicVolumeLabel}
                  valueText={`${Math.round(draftExtended.audio.musicVolume * 100)}%`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={draftExtended.audio.musicVolume}
                  onChange={(val) => updateDraftAudio({ musicVolume: val })}
                />

                <SliderRow
                  id="slider-effects-vol"
                  label={t.effectsVolumeLabel}
                  valueText={`${Math.round(draftExtended.audio.effectsVolume * 100)}%`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={draftExtended.audio.effectsVolume}
                  onChange={(val) => updateDraftAudio({ effectsVolume: val })}
                />

                <SliderRow
                  id="slider-ambient-vol"
                  label={t.ambientVolumeLabel}
                  valueText={`${Math.round(draftExtended.audio.ambientVolume * 100)}%`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={draftExtended.audio.ambientVolume}
                  onChange={(val) => updateDraftAudio({ ambientVolume: val })}
                />

                <SliderRow
                  id="slider-ui-vol"
                  label={t.uiVolumeLabel}
                  valueText={`${Math.round(draftExtended.audio.uiVolume * 100)}%`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={draftExtended.audio.uiVolume}
                  onChange={(val) => updateDraftAudio({ uiVolume: val })}
                />

                <SliderRow
                  id="slider-voice-vol"
                  label={t.voiceVolumeLabel}
                  valueText={`${Math.round(draftExtended.audio.voiceVolume * 100)}%`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={draftExtended.audio.voiceVolume}
                  onChange={(val) => updateDraftAudio({ voiceVolume: val })}
                />

                <SliderRow
                  id="slider-footstep-vol"
                  label={t.footstepVolumeLabel}
                  valueText={`${Math.round(draftExtended.audio.footstepVolume * 100)}%`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={draftExtended.audio.footstepVolume}
                  onChange={(val) => updateDraftAudio({ footstepVolume: val })}
                />
              </div>

              <div className="pt-2 border-t border-white/10">
                <ToggleRow
                  label={t.muted}
                  checked={draftExtended.audio.muted}
                  testId="toggle-audio-muted"
                  onChange={(v) => updateDraftAudio({ muted: v })}
                />
              </div>
            </div>
          )}

          {activeTab === 'controls' && (
            <div className="space-y-4" data-testid="settings-panel-controls">
              <div>
                <div className="text-xs font-semibold text-[#e6eee4] mb-2">
                  {t.cameraPerspectiveLabel}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {cameraPerspectives.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      data-testid={`camera-perspective-${p.id}`}
                      onClick={() =>
                        setDraftExtended((ext) => ({
                          ...ext,
                          camera: { ...ext.camera, perspective: p.id },
                        }))
                      }
                      className={`min-h-[40px] px-2 py-1.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                        draftExtended.camera.perspective === p.id
                          ? 'bg-[#21382b] border-[#e5a93c] text-white'
                          : 'bg-[#0c1712] border-white/10 text-[#b7c8b8] hover:bg-[#15251d]'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <SliderRow
                id="slider-mouse-sens"
                label={t.cameraSensitivityLabel}
                valueText={`${draftGame.mouseSensitivity.toFixed(1)}x`}
                min={0.3}
                max={2.5}
                step={0.1}
                value={draftGame.mouseSensitivity}
                onChange={(val) => {
                  setDraftGame((g) => ({ ...g, mouseSensitivity: val }));
                  setDraftExtended((ext) => ({
                    ...ext,
                    camera: { ...ext.camera, sensitivity: val },
                  }));
                }}
              />

              <ToggleRow
                label={t.cameraInvertYLabel}
                checked={draftGame.invertY}
                testId="toggle-invert-mouse-y"
                onChange={(v) => {
                  setDraftGame((g) => ({ ...g, invertY: v }));
                  setDraftExtended((ext) => ({
                    ...ext,
                    camera: { ...ext.camera, invertY: v },
                  }));
                }}
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <SliderRow
                  id="slider-camera-distance"
                  label={t.cameraDistanceLabel}
                  valueText={`${draftExtended.camera.distance.toFixed(1)}m`}
                  min={3.2}
                  max={11.0}
                  step={0.2}
                  value={draftExtended.camera.distance}
                  onChange={(val) =>
                    setDraftExtended((ext) => ({
                      ...ext,
                      camera: { ...ext.camera, distance: val },
                    }))
                  }
                />
                <SliderRow
                  id="slider-camera-height"
                  label={t.cameraHeightLabel}
                  valueText={`${draftExtended.camera.height.toFixed(2)}m`}
                  min={0.8}
                  max={2.6}
                  step={0.05}
                  value={draftExtended.camera.height}
                  onChange={(val) =>
                    setDraftExtended((ext) => ({
                      ...ext,
                      camera: { ...ext.camera, height: val },
                    }))
                  }
                />
                <SliderRow
                  id="slider-camera-smoothing"
                  label={t.cameraSmoothingLabel}
                  valueText={`${draftExtended.camera.smoothing.toFixed(1)}x`}
                  min={0.3}
                  max={2.0}
                  step={0.1}
                  value={draftExtended.camera.smoothing}
                  onChange={(val) =>
                    setDraftExtended((ext) => ({
                      ...ext,
                      camera: { ...ext.camera, smoothing: val },
                    }))
                  }
                />
              </div>

              <div className="pt-2 border-t border-white/10 space-y-2.5">
                <div className="text-xs font-semibold text-[#e6eee4]">
                  {t.indicatorOffsetTitle}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <SliderRow
                    id="slider-indicator-offset-x"
                    label={t.indicatorOffsetXLabel}
                    valueText={`${draftExtended.camera.interactionIndicatorOffsetX >= 0 ? '+' : ''}${draftExtended.camera.interactionIndicatorOffsetX.toFixed(2)}`}
                    min={-1.5}
                    max={1.5}
                    step={0.05}
                    value={draftExtended.camera.interactionIndicatorOffsetX}
                    onChange={(val) =>
                      setDraftExtended((ext) => ({
                        ...ext,
                        camera: {
                          ...ext.camera,
                          interactionIndicatorOffsetX: val,
                        },
                      }))
                    }
                  />
                  <SliderRow
                    id="slider-indicator-offset-y"
                    label={t.indicatorOffsetYLabel}
                    valueText={`${draftExtended.camera.interactionIndicatorOffsetY >= 0 ? '+' : ''}${draftExtended.camera.interactionIndicatorOffsetY.toFixed(2)}`}
                    min={-1.0}
                    max={1.0}
                    step={0.05}
                    value={draftExtended.camera.interactionIndicatorOffsetY}
                    onChange={(val) =>
                      setDraftExtended((ext) => ({
                        ...ext,
                        camera: {
                          ...ext.camera,
                          interactionIndicatorOffsetY: val,
                        },
                      }))
                    }
                  />
                  <SliderRow
                    id="slider-indicator-offset-z"
                    label={t.indicatorOffsetZLabel}
                    valueText={`${draftExtended.camera.interactionIndicatorOffsetZ >= 0 ? '+' : ''}${draftExtended.camera.interactionIndicatorOffsetZ.toFixed(2)}`}
                    min={-1.5}
                    max={1.5}
                    step={0.05}
                    value={draftExtended.camera.interactionIndicatorOffsetZ}
                    onChange={(val) =>
                      setDraftExtended((ext) => ({
                        ...ext,
                        camera: {
                          ...ext.camera,
                          interactionIndicatorOffsetZ: val,
                        },
                      }))
                    }
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-white/10 space-y-3">
                <ToggleRow
                  label={t.enableTouchControls}
                  checked={draftMobile.touchControlsEnabled ?? showMobileControls}
                  testId="toggle-touch-controls"
                  onChange={(v) =>
                    setDraftMobile((m) => ({
                      ...m,
                      touchControlsEnabled: v,
                      forceMobileControls: v,
                    }))
                  }
                />

                {/* Movement Controls: Joystick vs D-Pad */}
                <div data-testid="settings-movement-controls-section">
                  <div className="text-xs font-semibold text-[#e6eee4] mb-2">
                    {t.movementControlsLabel}
                  </div>
                  <div
                    role="radiogroup"
                    aria-label={t.movementControlsLabel}
                    className="grid grid-cols-2 gap-2"
                  >
                    {(
                      [
                        { id: 'joystick', label: t.movementModeJoystick },
                        { id: 'dpad', label: t.movementModeDpad },
                      ] as const
                    ).map((opt) => {
                      const active =
                        (draftMobile.movementControlMode ?? 'joystick') === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          data-testid={`settings-movement-mode-${opt.id}`}
                          onClick={() =>
                            setDraftMobile((m) => ({
                              ...m,
                              movementControlMode: opt.id,
                            }))
                          }
                          className={`min-h-[48px] px-3 py-2 rounded-xl border flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                            active
                              ? 'bg-[#21382b] border-[#e5a93c] text-white'
                              : 'bg-[#0c1712] border-white/10 text-[#b7c8b8] hover:bg-[#15251d]'
                          }`}
                        >
                          <span className="inline-flex items-center gap-2 min-w-0">
                            <span
                              className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                                active
                                  ? 'border-[#e5a93c]'
                                  : 'border-[#6d8574]'
                              }`}
                            >
                              {active && (
                                <span className="w-1.5 h-1.5 rounded-full bg-[#e5a93c]" />
                              )}
                            </span>
                            <span className="text-xs sm:text-sm font-semibold truncate">
                              {opt.label}
                            </span>
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide shrink-0 ${
                              active
                                ? 'bg-[#e5a93c] text-[#111914]'
                                : 'bg-white/5 text-[#8ea493]'
                            }`}
                          >
                            {active ? t.optionSelectedBadge : t.optionSelectBadge}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <SliderRow
                  id="slider-touch-sens"
                  label={t.touchCamSensitivity}
                  valueText={`${draftMobile.cameraSensitivity.toFixed(1)}x`}
                  min={0.4}
                  max={2.2}
                  step={0.1}
                  value={draftMobile.cameraSensitivity}
                  onChange={(val) =>
                    setDraftMobile((m) => ({ ...m, cameraSensitivity: val }))
                  }
                />

                <button
                  type="button"
                  data-testid="settings-customize-controls-btn"
                  onClick={() => {
                    if (
                      draftMobile.movementControlMode !==
                        mobileSettings.movementControlMode ||
                      draftMobile.touchControlsEnabled !==
                        mobileSettings.touchControlsEnabled
                    ) {
                      handleApplyClick();
                    }
                    onOpenCustomizeControls();
                  }}
                  className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#182c21] hover:bg-[#213c2d] border border-[#345845] text-sm font-semibold text-[#eef5ec] flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Gamepad2 className="w-4 h-4 text-[#e5a93c]" />
                  <span>{t.customizeControls}</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'gameplay' && (
            <div className="space-y-4" data-testid="settings-panel-gameplay">
              <div>
                <div className="text-xs font-semibold text-[#e6eee4] mb-2">
                  {t.difficultyLabel}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {difficulties.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      data-testid={`gameplay-diff-${d.id}`}
                      onClick={() =>
                        setDraftExtended((ext) => ({
                          ...ext,
                          gameplay: { ...ext.gameplay, difficulty: d.id },
                        }))
                      }
                      className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs sm:text-sm font-semibold cursor-pointer ${
                        draftExtended.gameplay.difficulty === d.id
                          ? 'bg-[#21382b] border-[#e5a93c] text-white'
                          : 'bg-[#0c1712] border-white/10 text-[#b7c8b8] hover:bg-[#15251d]'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <SliderRow
                id="slider-fov"
                label={t.fovLabel}
                valueText={`${Math.round(draftExtended.gameplay.fov)}°`}
                min={55}
                max={100}
                step={1}
                value={draftExtended.gameplay.fov}
                onChange={(val) =>
                  setDraftExtended((ext) => ({
                    ...ext,
                    gameplay: { ...ext.gameplay, fov: val },
                  }))
                }
              />

              <SliderRow
                id="slider-weather-max-duration"
                label={t.weatherMaxDurationLabel}
                valueText={`${Math.round(draftExtended.gameplay.weatherMaxDurationSeconds / 60)}${t.minutesShort}`}
                min={120}
                max={900}
                step={60}
                value={draftExtended.gameplay.weatherMaxDurationSeconds}
                onChange={(val) =>
                  setDraftExtended((ext) => ({
                    ...ext,
                    gameplay: { ...ext.gameplay, weatherMaxDurationSeconds: val },
                  }))
                }
              />

              <ToggleRow
                label={t.showFpsLabel}
                checked={draftExtended.gameplay.showFps}
                testId="toggle-show-fps"
                onChange={(v) =>
                  setDraftExtended((ext) => ({
                    ...ext,
                    gameplay: { ...ext.gameplay, showFps: v },
                  }))
                }
              />

              <ToggleRow
                label={t.showHudLabel}
                checked={draftExtended.gameplay.showHud}
                testId="toggle-show-hud"
                onChange={(v) =>
                  setDraftExtended((ext) => ({
                    ...ext,
                    gameplay: { ...ext.gameplay, showHud: v },
                  }))
                }
              />

              <ToggleRow
                label={t.showPlayerNamesLabel}
                checked={draftExtended.gameplay.showPlayerNames}
                testId="toggle-show-player-names"
                onChange={(v) =>
                  setDraftExtended((ext) => ({
                    ...ext,
                    gameplay: { ...ext.gameplay, showPlayerNames: v },
                  }))
                }
              />

              <ToggleRow
                label={t.showFriendsOnMapLabel}
                checked={draftExtended.gameplay.showFriendsOnMap}
                testId="toggle-show-friends-on-map"
                onChange={(v) =>
                  setDraftExtended((ext) => ({
                    ...ext,
                    gameplay: { ...ext.gameplay, showFriendsOnMap: v },
                  }))
                }
              />

              <ToggleRow
                label={t.showPartyMembersOnMapLabel}
                checked={draftExtended.gameplay.showPartyMembersOnMap}
                testId="toggle-show-party-on-map"
                onChange={(v) =>
                  setDraftExtended((ext) => ({
                    ...ext,
                    gameplay: { ...ext.gameplay, showPartyMembersOnMap: v },
                  }))
                }
              />

              <ToggleRow
                label={`${t.miniMapOrientationLabel} (${
                  draftExtended.gameplay.miniMapRotate
                    ? t.miniMapRotating
                    : t.miniMapNorthUp
                })`}
                checked={draftExtended.gameplay.miniMapRotate}
                testId="toggle-minimap-rotate"
                onChange={(v) =>
                  setDraftExtended((ext) => ({
                    ...ext,
                    gameplay: { ...ext.gameplay, miniMapRotate: v },
                  }))
                }
              />

              <ToggleRow
                label={t.showBowTrajectoryLabel}
                checked={draftExtended.gameplay.showBowTrajectory}
                testId="toggle-show-bow-trajectory"
                onChange={(v) =>
                  setDraftExtended((ext) => ({
                    ...ext,
                    gameplay: { ...ext.gameplay, showBowTrajectory: v },
                  }))
                }
              />

              <ToggleRow
                label={t.showBiomeDebugLabel}
                checked={draftExtended.gameplay.showBiomeDebug}
                testId="toggle-show-biome-debug"
                onChange={(v) =>
                  setDraftExtended((ext) => ({
                    ...ext,
                    gameplay: { ...ext.gameplay, showBiomeDebug: v },
                  }))
                }
              />

              {import.meta.env.DEV && (
                <ToggleRow
                  label={t.showWorldGenDebugLabel}
                  checked={draftExtended.gameplay.showWorldGenDebug}
                  testId="toggle-show-worldgen-debug"
                  onChange={(v) =>
                    setDraftExtended((ext) => ({
                      ...ext,
                      gameplay: { ...ext.gameplay, showWorldGenDebug: v },
                    }))
                  }
                />
              )}

              <div className="pt-2 border-t border-white/10">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-xs sm:text-sm font-medium text-[#dce5d8]">
                    <Languages className="w-4 h-4 text-[#e5a93c]" />
                    {t.languageLabel}
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      data-testid="settings-lang-en"
                      onClick={() => setDraftLang('en')}
                      className={`min-h-[38px] px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                        draftLang === 'en'
                          ? 'bg-[#21382b] border-[#e5a93c] text-white'
                          : 'bg-[#0c1712] border-white/10 text-[#b7c8b8]'
                      }`}
                    >
                      English
                    </button>
                    <button
                      type="button"
                      data-testid="settings-lang-ar"
                      onClick={() => setDraftLang('ar')}
                      className={`min-h-[38px] px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                        draftLang === 'ar'
                          ? 'bg-[#21382b] border-[#e5a93c] text-white'
                          : 'bg-[#0c1712] border-white/10 text-[#b7c8b8]'
                      }`}
                    >
                      العربية
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'accessibility' && (
            <div className="space-y-4" data-testid="settings-panel-accessibility">
              <SliderRow
                id="slider-ui-scale"
                label={t.uiScaleLabel}
                valueText={`${Math.round(draftExtended.accessibility.uiScale * 100)}%`}
                min={0.85}
                max={1.25}
                step={0.05}
                value={draftExtended.accessibility.uiScale}
                onChange={(val) =>
                  setDraftExtended((ext) => ({
                    ...ext,
                    accessibility: { ...ext.accessibility, uiScale: val },
                  }))
                }
              />

              <div>
                <div className="text-xs font-semibold text-[#e6eee4] mb-2">
                  {t.textSizeLabel}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {textSizes.map((sz) => (
                    <button
                      key={sz.id}
                      type="button"
                      data-testid={`text-size-${sz.id}`}
                      onClick={() =>
                        setDraftExtended((ext) => ({
                          ...ext,
                          accessibility: {
                            ...ext.accessibility,
                            textSize: sz.id,
                          },
                        }))
                      }
                      className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs sm:text-sm font-semibold cursor-pointer ${
                        draftExtended.accessibility.textSize === sz.id
                          ? 'bg-[#21382b] border-[#e5a93c] text-white'
                          : 'bg-[#0c1712] border-white/10 text-[#b7c8b8] hover:bg-[#15251d]'
                      }`}
                    >
                      {sz.label}
                    </button>
                  ))}
                </div>
              </div>

              <ToggleRow
                label={t.highContrastLabel}
                checked={draftExtended.accessibility.highContrast}
                testId="toggle-high-contrast"
                onChange={(v) =>
                  setDraftExtended((ext) => ({
                    ...ext,
                    accessibility: { ...ext.accessibility, highContrast: v },
                  }))
                }
              />

              <ToggleRow
                label={t.reducedMotionLabel}
                checked={draftExtended.accessibility.reducedMotion}
                testId="toggle-reduced-motion"
                onChange={(v) =>
                  setDraftExtended((ext) => ({
                    ...ext,
                    accessibility: { ...ext.accessibility, reducedMotion: v },
                  }))
                }
              />
            </div>
          )}
        </div>

        {/* Footer Actions: APPLY / RESET / BACK */}
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-t border-white/10 bg-[#0c1611]/92 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0">
          {appliedBanner ? (
            <span
              data-testid="settings-applied-banner"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7fe094]"
            >
              <Check className="w-4 h-4" />
              {t.settingsAppliedNotice}
            </span>
          ) : (
            <span className="hidden sm:inline text-xs text-[#889e8c]" />
          )}

          <div className="flex flex-col sm:flex-row-reverse gap-2 sm:gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              data-testid="settings-apply-btn"
              onClick={handleApplyClick}
              className="min-h-[44px] sm:min-w-[120px] px-5 py-2.5 rounded-xl bg-[#e5a93c] hover:bg-[#eeb750] text-[#111914] font-display font-bold text-sm transition-colors cursor-pointer"
            >
              {t.applyBtn}
            </button>
            <button
              type="button"
              data-testid="settings-reset-btn"
              onClick={handleResetClick}
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-[#192b22] hover:bg-[#22392d] border border-[#2f493b] text-sm font-medium text-[#e4ece1] inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{t.resetBtn}</span>
            </button>
            <button
              type="button"
              data-testid="settings-back-btn"
              onClick={handleBackClick}
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-[#14221a] hover:bg-[#1c2f24] border border-white/12 text-sm font-medium text-[#dce5d8] transition-colors cursor-pointer"
            >
              {t.backBtn}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ToggleRow: React.FC<{
  label: string;
  checked: boolean;
  testId?: string;
  onChange: (checked: boolean) => void;
}> = ({ label, checked, testId, onChange }) => (
  <label className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#0c1712] border border-white/10 flex items-center justify-between gap-3 cursor-pointer">
    <span className="text-xs sm:text-sm font-medium text-[#e4ece1]">{label}</span>
    <input
      type="checkbox"
      data-testid={testId}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="w-5 h-5 accent-[#e5a93c] rounded cursor-pointer shrink-0"
    />
  </label>
);

const SegmentedOnOffRow: React.FC<{
  label: string;
  enabled: boolean;
  onLabel: string;
  offLabel: string;
  testIdPrefix: string;
  onChange: (enabled: boolean) => void;
}> = ({ label, enabled, onLabel, offLabel, testIdPrefix, onChange }) => (
  <div className="min-h-[46px] px-3.5 py-2 rounded-xl bg-[#0c1712] border border-white/10 flex items-center justify-between gap-3">
    <span className="text-xs sm:text-sm font-medium text-[#e4ece1]">{label}</span>
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center rounded-lg bg-[#08100c] border border-white/10 p-0.5 shrink-0"
    >
      <button
        type="button"
        aria-pressed={enabled}
        data-testid={`${testIdPrefix}-on`}
        onClick={() => onChange(true)}
        className={`min-h-[34px] min-w-[54px] px-3 py-1 rounded-md text-xs font-display font-bold tracking-wide transition-colors cursor-pointer ${
          enabled
            ? 'bg-[#e5a93c] text-[#111914]'
            : 'text-[#9db1a1] hover:text-[#e4ece1]'
        }`}
      >
        {onLabel}
      </button>
      <button
        type="button"
        aria-pressed={!enabled}
        data-testid={`${testIdPrefix}-off`}
        onClick={() => onChange(false)}
        className={`min-h-[34px] min-w-[54px] px-3 py-1 rounded-md text-xs font-display font-bold tracking-wide transition-colors cursor-pointer ${
          !enabled
            ? 'bg-[#2a3f33] text-[#f2f6ef] border border-white/15'
            : 'text-[#9db1a1] hover:text-[#e4ece1]'
        }`}
      >
        {offLabel}
      </button>
    </div>
  </div>
);

const SliderRow: React.FC<{
  id: string;
  label: string;
  valueText: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}> = ({ id, label, valueText, min, max, step, value, onChange }) => (
  <div className="p-3 rounded-xl bg-[#0c1712] border border-white/10">
    <div className="flex items-center justify-between text-xs sm:text-sm font-medium text-[#e4ece1] mb-2">
      <label htmlFor={id}>{label}</label>
      <span className="font-mono-num text-[#e5a93c]" dir="ltr">
        {valueText}
      </span>
    </div>
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full h-7 accent-[#e5a93c] cursor-pointer touch-pan-y"
    />
  </div>
);
