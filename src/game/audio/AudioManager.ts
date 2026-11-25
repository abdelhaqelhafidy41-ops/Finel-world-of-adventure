import type * as THREE from 'three';
import type {
  AudioCategoryBus,
  AudioCueId,
  SpatialAudioPosition,
} from './AudioRegistry';
import {
  MenuMusicManager,
  type MenuMusicStateSnapshot,
} from './MenuMusicManager';
import {
  type EnvironmentAudioState,
  type PlayCueOptions,
  SoundEngine,
} from './SoundEngine';
import {
  type AudioSettings,
  GameSettingsStore,
  createDefaultExtendedSettings,
  loadExtendedSettings,
} from '../settings/GameSettingsStore';
import { AUDIO_CUE_REGISTRY } from './AudioRegistry';
import type { ModSoundDescriptor } from '../mods/modTypes';

export type AudioSceneMode = 'menu' | 'loading' | 'world' | 'paused';

export interface AudioDiagnosticsSnapshot {
  sceneMode: AudioSceneMode;
  settings: AudioSettings;
  music: MenuMusicStateSnapshot;
  sfx: ReturnType<SoundEngine['getDiagnostics']>;
  categoryLevels: Record<AudioCategoryBus, number>;
}

function clampUnit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function normalizeAudioSettings(
  input: Partial<AudioSettings>,
  base: AudioSettings,
): AudioSettings {
  return {
    masterVolume: clampUnit(input.masterVolume, base.masterVolume),
    musicVolume: clampUnit(input.musicVolume, base.musicVolume),
    effectsVolume: clampUnit(input.effectsVolume, base.effectsVolume),
    ambientVolume: clampUnit(input.ambientVolume, base.ambientVolume),
    uiVolume: clampUnit(input.uiVolume, base.uiVolume),
    voiceVolume: clampUnit(input.voiceVolume, base.voiceVolume),
    footstepVolume: clampUnit(input.footstepVolume, base.footstepVolume),
    muted: typeof input.muted === 'boolean' ? input.muted : base.muted,
    menuMusicEnabled:
      typeof input.menuMusicEnabled === 'boolean'
        ? input.menuMusicEnabled
        : base.menuMusicEnabled,
    soundEffectsEnabled:
      typeof input.soundEffectsEnabled === 'boolean'
        ? input.soundEffectsEnabled
        : base.soundEffectsEnabled,
  };
}

/**
 * Single centralized AudioManager for World of Adventure Multiplayer 2.
 *
 * Unifies:
 * - Main Menu Music (`MenuMusicManager`) — strictly active ONLY in `'menu'` mode
 * - Gameplay / 3D Positional SFX (`SoundEngine` SFX & Voice buses)
 * - Dynamic Environmental Ambience (`SoundEngine` Ambient bus)
 * - UI Interaction Cues (`SoundEngine` UI bus)
 * - 5 Independent Categories: MASTER, MUSIC, SFX, AMBIENT, UI
 * - Persisted user preferences (`GameSettingsStore`)
 * - Smooth scene/weather/biome/indoor/combat transitions & low-power voice capping
 */
export class AudioManager {
  private static externalModSoundProvider:
    | ((soundId: string) => ModSoundDescriptor | undefined)
    | null = null;

  public readonly sfx: SoundEngine;
  public readonly music: MenuMusicManager;

  private settings: AudioSettings;
  private sceneMode: AudioSceneMode = 'menu';
  private disposed = false;

  public static setExternalModSoundProvider(
    provider: ((soundId: string) => ModSoundDescriptor | undefined) | null,
  ): void {
    AudioManager.externalModSoundProvider = provider;
  }

  constructor(initialAudio?: Partial<AudioSettings>) {
    const restored = loadExtendedSettings().audio;
    const defaults = createDefaultExtendedSettings().audio;
    this.settings = normalizeAudioSettings(initialAudio ?? restored, defaults);

    this.sfx = new SoundEngine();
    this.music = new MenuMusicManager(this.settings);
    this.syncEngines(true);
  }

  public getModSoundDescriptor(soundId: string): ModSoundDescriptor | undefined {
    // Core audio cue IDs cannot be hijacked by mod sound definitions
    if (soundId in AUDIO_CUE_REGISTRY) {
      return undefined;
    }
    return AudioManager.externalModSoundProvider?.(soundId);
  }

  public getSceneMode(): AudioSceneMode {
    return this.sceneMode;
  }

  public getSettings(): AudioSettings {
    return { ...this.settings };
  }

  /**
   * Transitions audio scene mode smoothly:
   * - `'menu'`: Main Menu music smoothly fades in (if enabled); world ambience fades out.
   * - `'loading'`, `'world'`, `'paused'`: Main Menu music is strictly disabled & faded out.
   * - `'paused'` / `'loading'`: Continuous world ambience smoothly ramps down.
   */
  public setSceneMode(mode: AudioSceneMode): void {
    if (this.disposed) return;
    this.sceneMode = mode;

    // Strict separation: Menu music plays ONLY on Main Menu; world soundtrack plays in-world
    this.music.setSceneMode(mode);

    if (mode !== 'world') {
      this.sfx.stopWorldAmbienceSmooth(mode === 'menu' ? 0.16 : 0.12);
    }
  }

  public applySettings(
    patch: Partial<AudioSettings>,
    opts: { persist?: boolean; immediate?: boolean } = {},
  ): AudioSettings {
    if (this.disposed) return { ...this.settings };
    this.settings = normalizeAudioSettings(patch, this.settings);
    this.syncEngines(Boolean(opts.immediate));

    if (opts.persist) {
      GameSettingsStore.update({ audio: { ...this.settings } });
    }
    return { ...this.settings };
  }

  public setCategoryVolume(
    category: AudioCategoryBus,
    volume: number,
    persist = true,
  ): AudioSettings {
    const clamped = clampUnit(volume, 1);
    const patch: Partial<AudioSettings> = {};
    if (category === 'master') patch.masterVolume = clamped;
    else if (category === 'music') patch.musicVolume = clamped;
    else if (category === 'sfx') patch.effectsVolume = clamped;
    else if (category === 'ambient') patch.ambientVolume = clamped;
    else if (category === 'ui') patch.uiVolume = clamped;
    return this.applySettings(patch, { persist });
  }

  public setMuted(muted: boolean, persist = true): AudioSettings {
    return this.applySettings({ muted }, { persist });
  }

  public setMenuMusicEnabled(enabled: boolean, persist = true): AudioSettings {
    return this.applySettings({ menuMusicEnabled: enabled }, { persist });
  }

  public setSoundEffectsEnabled(
    enabled: boolean,
    persist = true,
  ): AudioSettings {
    return this.applySettings({ soundEffectsEnabled: enabled }, { persist });
  }

  public setLowPowerMode(lowPower: boolean): void {
    if (this.disposed) return;
    this.sfx.setLowPowerMode(lowPower);
    this.music.setLowPowerMode(lowPower);
  }

  public unlock(): void {
    if (this.disposed) return;
    this.sfx.unlock();
  }

  public playUiClick(): boolean {
    if (this.disposed) return false;
    if (
      this.settings.muted ||
      this.settings.masterVolume <= 0.001 ||
      this.settings.uiVolume <= 0.001
    ) {
      return false;
    }
    this.sfx.unlock();
    return this.sfx.playCue('ui_click');
  }

  public playCue(
    cueId: AudioCueId | string,
    opts: PlayCueOptions = {},
  ): boolean {
    if (this.disposed) return false;
    return this.sfx.playCue(cueId, opts);
  }

  public updateListener(
    pos: THREE.Vector3 | SpatialAudioPosition,
    yaw: number,
  ): void {
    if (this.disposed) return;
    this.sfx.updateListener(pos, yaw);
  }

  public updateEnvironment(env: EnvironmentAudioState): void {
    if (this.disposed) return;
    if (this.sceneMode !== 'world') {
      this.sfx.stopWorldAmbienceSmooth(0.14);
      return;
    }
    this.sfx.updateEnvironmentAudio(env);
    this.music.updateWorldContext({
      biome: env.biome,
      nightFactor: env.nightFactor,
      villageProximity: env.villageProximity,
      caveFactor: env.caveFactor,
      ruinsProximity: env.ruinsProximity ?? 0,
      altitudeMeters: env.altitudeMeters,
      combatIntensity: env.combatIntensity ?? 0,
      bossActive: Boolean(env.bossActive),
    });
  }

  public triggerStoryMusic(
    kind: 'discovery' | 'revelation' | 'chapter_complete' = 'discovery',
  ): void {
    if (this.disposed || this.sceneMode !== 'world') return;
    this.music.triggerStoryCue(kind);
  }

  public getEffectiveCategoryLevels(): Record<AudioCategoryBus, number> {
    if (this.settings.muted || this.settings.masterVolume <= 0.001) {
      return { master: 0, music: 0, sfx: 0, ambient: 0, ui: 0 };
    }
    const master = this.settings.masterVolume;
    const musicAllowed =
      this.sceneMode === 'menu'
        ? this.settings.menuMusicEnabled
        : this.sceneMode === 'world' || this.sceneMode === 'paused';
    return {
      master,
      music: musicAllowed ? master * this.settings.musicVolume : 0,
      sfx: this.settings.soundEffectsEnabled
        ? master * this.settings.effectsVolume
        : 0,
      ambient: master * this.settings.ambientVolume,
      ui: master * this.settings.uiVolume,
    };
  }

  public getDiagnostics(): AudioDiagnosticsSnapshot {
    return {
      sceneMode: this.sceneMode,
      settings: { ...this.settings },
      music: this.music.getState(),
      sfx: this.sfx.getDiagnostics(),
      categoryLevels: this.getEffectiveCategoryLevels(),
    };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.music.dispose();
    this.sfx.dispose();
  }

  private syncEngines(immediate: boolean): void {
    this.sfx.setAudioVolumes({
      masterVolume: this.settings.masterVolume,
      musicVolume: this.settings.musicVolume,
      effectsVolume: this.settings.effectsVolume,
      ambientVolume: this.settings.ambientVolume,
      uiVolume: this.settings.uiVolume,
      voiceVolume: this.settings.voiceVolume,
      footstepVolume: this.settings.footstepVolume,
      muted: this.settings.muted,
      soundEffectsEnabled: this.settings.soundEffectsEnabled,
    });
    this.music.applySettings(this.settings, { immediate });
  }
}

let sharedAudioManager: AudioManager | null = null;

export function getAudioManager(): AudioManager {
  if (!sharedAudioManager) {
    sharedAudioManager = new AudioManager();
  }
  return sharedAudioManager;
}

export function resetAudioManagerForTests(): void {
  if (sharedAudioManager) {
    sharedAudioManager.dispose();
    sharedAudioManager = null;
  }
}
