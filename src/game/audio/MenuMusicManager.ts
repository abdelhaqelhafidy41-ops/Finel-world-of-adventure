import type { BiomeType } from '../types';
import type { AudioSettings } from '../settings/GameSettingsStore';
import {
  renderSoundtrackTrack,
  type RenderedTrack,
  type SoundtrackTrackId,
} from './SoundtrackSynthesizer';

export interface MenuMusicStateSnapshot {
  isMenuActive: boolean;
  isPlaying: boolean;
  isFadingOut: boolean;
  isUnlocked: boolean;
  hasLoadedBuffer: boolean;
  usingFallbackAudio: boolean;
  effectiveTargetVolume: number;
  activeTrackId?: SoundtrackTrackId | null;
}

export interface WorldMusicContext {
  biome: BiomeType;
  nightFactor: number; // 0..1
  villageProximity: number; // 0..1
  caveFactor: number; // 0..1
  ruinsProximity?: number; // 0..1
  altitudeMeters: number;
  combatIntensity: number; // 0..1
  bossActive?: boolean;
}

export type MusicSceneMode = 'menu' | 'loading' | 'world' | 'paused';

const BASE_MUSIC_GAIN = 0.52;
const PAUSED_DUCK_FACTOR = 0.36;
const MAX_CACHED_BUFFERS = 2;

const MENU_FADE_IN_SEC = 1.25;
const MENU_FADE_OUT_SEC = 0.95;
const EXPLORATION_CROSSFADE_SEC = 2.8;
const COMBAT_ENTER_CROSSFADE_SEC = 1.1;
const COMBAT_EXIT_CROSSFADE_SEC = 2.6;
const STORY_CROSSFADE_SEC = 0.9;

const MIN_EXPLORATION_HOLD_SEC = 14;
const EXPLORATION_ROTATION_SEC = 76;
const COMBAT_RELEASE_HOLD_SEC = 6.0;
const BOSS_RELEASE_HOLD_SEC = 6.5;
const STORY_COOLDOWN_SEC = 45;

interface ActiveDeck {
  trackId: SoundtrackTrackId;
  source: AudioBufferSourceNode;
  gain: GainNode;
  stopTimer: number | null;
}

/**
 * Intelligent Cinematic Soundtrack Manager for World of Adventure.
 *
 * Replaces the legacy static menu loop with an original, lazy-rendered
 * orchestral soundtrack covering:
 * - Main Menu (strictly isolated to `'menu'` mode)
 * - Rotating World Exploration (Peaceful & Adventure)
 * - Biome & Location Themes (Mountain/Valley, Desert, Village, Ancient Ruins)
 * - Nighttime Mystic Exploration
 * - Combat & High-Stakes Boss Battles
 * - Short Cinematic Story / Discovery Vignettes
 *
 * Mobile & Weak-Android Optimized:
 * - Lazy OfflineAudioContext synthesis per track on demand
 * - Strict 2-buffer LRU cache (automatically unloads unused tracks)
 * - Zero per-frame oscillator CPU cost during playback
 * - Sample-accurate dual-deck crossfading with zero abrupt cuts or overlaps
 */
export class MenuMusicManager {
  private ctx: AudioContext | null = null;
  private masterMusicGain: GainNode | null = null;

  private activeDeck: ActiveDeck | null = null;
  private outgoingDeck: ActiveDeck | null = null;

  // Strict LRU cache (max 2 buffers in RAM at any time)
  private readonly bufferCache = new Map<SoundtrackTrackId, RenderedTrack>();
  private readonly pendingRenders = new Map<
    SoundtrackTrackId,
    Promise<RenderedTrack | null>
  >();

  private sceneMode: MusicSceneMode = 'menu';
  private desiredTrackId: SoundtrackTrackId | null = null;
  private activeTrackId: SoundtrackTrackId | null = null;
  private isFadingOut = false;
  private disposed = false;
  private gestureArmed = false;
  private lowPowerMode = false;

  private masterVolume = 0.85;
  private musicVolume = 0.7;
  private muted = false;
  private menuMusicEnabled = true;

  // Intelligent state machine timers (seconds via performance.now)
  private lastTrackChangeAtSec = 0;
  private lastExplorationRotationAtSec = 0;
  private explorationVariantIndex = 0;
  private combatLatchUntilSec = 0;
  private bossLatchUntilSec = 0;
  private storyActiveUntilSec = 0;
  private lastStoryTriggeredAtSec = -999;
  private storyRestoreTimer: number | null = null;
  private lastWorldCtx: WorldMusicContext | null = null;
  private transitionSeq = 0;

  private boundUnlockHandler = () => {
    this.handleUserGestureUnlock();
  };

  private boundVisibilityHandler = () => {
    this.handleVisibilityChange();
  };

  constructor(initialAudio?: Partial<AudioSettings>) {
    if (initialAudio) {
      this.applySettings(initialAudio, { immediate: true });
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.boundVisibilityHandler);
    }
  }

  public setLowPowerMode(lowPower: boolean): void {
    if (this.lowPowerMode === lowPower) return;
    this.lowPowerMode = lowPower;
  }

  /**
   * Backwards-compatible setter used by AudioManager when toggling menu state.
   */
  public setMenuActive(active: boolean): void {
    this.setSceneMode(active ? 'menu' : this.sceneMode === 'menu' ? 'world' : this.sceneMode);
  }

  /**
   * Synchronizes soundtrack state with the current game scene mode:
   * - `'menu'`: Plays ONLY the Main Menu theme (if `menuMusicEnabled`).
   * - `'loading'`: Smoothly fades out menu/world music during transitions.
   * - `'world'`: Stops Main Menu music strictly and transitions to world soundtrack.
   * - `'paused'`: Softly ducks active world music without restarting.
   */
  public setSceneMode(mode: MusicSceneMode): void {
    if (this.disposed) return;
    const prevMode = this.sceneMode;
    this.sceneMode = mode;

    if (mode === 'menu') {
      this.combatLatchUntilSec = 0;
      this.bossLatchUntilSec = 0;
      this.storyActiveUntilSec = 0;
      this.clearStoryRestoreTimer();
      this.updateMasterMusicGain(false);
      if (this.shouldPlayCurrentMode()) {
        void this.transitionToTrack('main_menu', MENU_FADE_IN_SEC);
      } else {
        this.fadeOutAll(MENU_FADE_OUT_SEC);
      }
      return;
    }

    if (mode === 'loading') {
      this.fadeOutAll(MENU_FADE_OUT_SEC);
      return;
    }

    if (mode === 'paused') {
      // Never play main menu music while paused in-world
      if (this.activeTrackId === 'main_menu') {
        this.fadeOutAll(0.45);
      } else {
        this.updateMasterMusicGain(false);
      }
      return;
    }

    // mode === 'world'
    this.updateMasterMusicGain(false);
    if (prevMode === 'menu' || this.activeTrackId === 'main_menu') {
      // Strictly exit main menu theme and smoothly enter world exploration
      const nextTrack = this.lastWorldCtx
        ? this.selectWorldTrack(this.lastWorldCtx, this.nowSec(), true)
        : 'exploration_peaceful';
      if (this.shouldPlayCurrentMode()) {
        void this.transitionToTrack(nextTrack, EXPLORATION_CROSSFADE_SEC);
      } else {
        this.fadeOutAll(MENU_FADE_OUT_SEC);
      }
    } else if (prevMode === 'loading' || (!this.activeDeck && this.shouldPlayCurrentMode())) {
      const nextTrack = this.lastWorldCtx
        ? this.selectWorldTrack(this.lastWorldCtx, this.nowSec(), true)
        : 'exploration_peaceful';
      if (this.shouldPlayCurrentMode()) {
        void this.transitionToTrack(nextTrack, EXPLORATION_CROSSFADE_SEC);
      }
    }
  }

  /**
   * Called periodically (~5 Hz) during active gameplay to evaluate biome,
   * village, ruins, night, combat, and boss music transitions with hysteresis.
   */
  public updateWorldContext(ctx: WorldMusicContext): void {
    if (this.disposed || this.sceneMode !== 'world') return;
    this.lastWorldCtx = ctx;

    if (!this.shouldPlayCurrentMode()) {
      if (this.activeDeck && !this.isFadingOut) {
        this.fadeOutAll(0.5);
      }
      return;
    }

    const now = this.nowSec();

    // Update urgent state latches so brief lulls in combat don't thrash music
    if (ctx.bossActive) {
      this.bossLatchUntilSec = now + BOSS_RELEASE_HOLD_SEC;
    }
    if (ctx.combatIntensity >= 0.45) {
      this.combatLatchUntilSec = now + COMBAT_RELEASE_HOLD_SEC;
    }

    // While a short story vignette is playing (unless a boss interrupts), let it finish
    if (now < this.storyActiveUntilSec && !ctx.bossActive) {
      return;
    }

    const forceImmediate = !this.activeDeck || this.activeTrackId === 'main_menu';
    const nextTrack = this.selectWorldTrack(ctx, now, forceImmediate);
    if (!nextTrack || nextTrack === this.desiredTrackId) {
      return;
    }

    const isEnteringUrgent = nextTrack === 'boss_epic' || nextTrack === 'combat_skirmish';
    const isLeavingUrgent =
      this.activeTrackId === 'boss_epic' || this.activeTrackId === 'combat_skirmish';
    const fadeSec = isEnteringUrgent
      ? COMBAT_ENTER_CROSSFADE_SEC
      : isLeavingUrgent
        ? COMBAT_EXIT_CROSSFADE_SEC
        : EXPLORATION_CROSSFADE_SEC;

    void this.transitionToTrack(nextTrack, fadeSec);
  }

  /**
   * Triggers a short cinematic story/discovery music vignette (with cooldown)
   * and smoothly crossfades back to the active world track when finished.
   */
  public triggerStoryCue(
    _kind: 'discovery' | 'revelation' | 'chapter_complete' = 'discovery',
  ): void {
    if (this.disposed || this.sceneMode !== 'world') return;
    if (!this.shouldPlayCurrentMode()) return;

    const now = this.nowSec();
    // Do not interrupt active boss battles or spam story stingers
    if (now < this.bossLatchUntilSec) return;
    if (now - this.lastStoryTriggeredAtSec < STORY_COOLDOWN_SEC) return;

    this.lastStoryTriggeredAtSec = now;
    this.storyActiveUntilSec = now + 13.5;
    this.clearStoryRestoreTimer();

    void this.transitionToTrack('story_event', STORY_CROSSFADE_SEC);

    if (typeof window !== 'undefined') {
      this.storyRestoreTimer = window.setTimeout(() => {
        this.storyRestoreTimer = null;
        if (this.disposed || this.sceneMode !== 'world') return;
        this.storyActiveUntilSec = 0;
        const resumeTrack = this.lastWorldCtx
          ? this.selectWorldTrack(this.lastWorldCtx, this.nowSec(), true)
          : 'exploration_peaceful';
        if (this.shouldPlayCurrentMode()) {
          void this.transitionToTrack(resumeTrack, EXPLORATION_CROSSFADE_SEC);
        }
      }, 13200);
    }
  }

  public applySettings(
    audio: Partial<AudioSettings>,
    opts: { immediate?: boolean } = {},
  ): void {
    if (this.disposed) return;

    if (typeof audio.masterVolume === 'number' && Number.isFinite(audio.masterVolume)) {
      this.masterVolume = Math.max(0, Math.min(1, audio.masterVolume));
    }
    if (typeof audio.musicVolume === 'number' && Number.isFinite(audio.musicVolume)) {
      this.musicVolume = Math.max(0, Math.min(1, audio.musicVolume));
    }
    if (typeof audio.muted === 'boolean') {
      this.muted = audio.muted;
    }
    if (typeof audio.menuMusicEnabled === 'boolean') {
      this.menuMusicEnabled = audio.menuMusicEnabled;
    }

    this.updateMasterMusicGain(Boolean(opts.immediate));

    if (this.shouldPlayCurrentMode()) {
      if (!this.activeDeck || this.isFadingOut) {
        const target =
          this.sceneMode === 'menu'
            ? 'main_menu'
            : this.lastWorldCtx
              ? this.selectWorldTrack(this.lastWorldCtx, this.nowSec(), true)
              : 'exploration_peaceful';
        void this.transitionToTrack(
          target,
          this.sceneMode === 'menu' ? MENU_FADE_IN_SEC : EXPLORATION_CROSSFADE_SEC,
        );
      }
    } else if (this.activeDeck && !this.isFadingOut) {
      this.fadeOutAll(0.45);
    }
  }

  public getState(): MenuMusicStateSnapshot {
    return {
      isMenuActive: this.sceneMode === 'menu',
      isPlaying: Boolean(this.activeDeck) && !this.isFadingOut,
      isFadingOut: this.isFadingOut,
      isUnlocked: this.ctx ? this.ctx.state === 'running' : false,
      hasLoadedBuffer: this.bufferCache.size > 0,
      usingFallbackAudio: false,
      effectiveTargetVolume: this.getEffectiveTargetVolume(),
      activeTrackId: this.activeTrackId,
    };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disarmUserGestureListeners();
    this.clearStoryRestoreTimer();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
    }
    this.stopDeckImmediate(this.activeDeck);
    this.stopDeckImmediate(this.outgoingDeck);
    this.activeDeck = null;
    this.outgoingDeck = null;
    this.activeTrackId = null;
    this.desiredTrackId = null;
    this.bufferCache.clear();
    this.pendingRenders.clear();
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.masterMusicGain = null;
  }

  // -------------------------------------------------------------------------
  // INTELLIGENT TRACK SELECTION STATE MACHINE
  // -------------------------------------------------------------------------

  private selectWorldTrack(
    ctx: WorldMusicContext,
    nowSec: number,
    forceImmediate: boolean,
  ): SoundtrackTrackId {
    // 1. High-stakes Boss Battle (only for true boss encounters)
    if (ctx.bossActive || nowSec < this.bossLatchUntilSec) {
      return 'boss_epic';
    }

    // 2. Active Combat Encounter
    if (ctx.combatIntensity >= 0.45 || nowSec < this.combatLatchUntilSec) {
      return 'combat_skirmish';
    }

    // Determine desired ambient/exploration track
    let candidate: SoundtrackTrackId;
    const ruinsProx = ctx.ruinsProximity ?? 0;

    if (ruinsProx >= 0.42 || ctx.caveFactor >= 0.48) {
      candidate = 'ancient_ruins';
    } else if (ctx.villageProximity >= 0.5 && ctx.nightFactor < 0.72) {
      candidate = 'village_hearth';
    } else if (ctx.nightFactor >= 0.58) {
      candidate = 'night_mystic';
    } else if (ctx.biome === 'Desert') {
      candidate = 'desert_ancient';
    } else if (ctx.biome === 'Mountains' || ctx.altitudeMeters >= 24) {
      candidate = 'mountain_valley';
    } else {
      // Intelligently rotate between Peaceful & Adventure exploration tracks
      if (nowSec - this.lastExplorationRotationAtSec >= EXPLORATION_ROTATION_SEC) {
        this.explorationVariantIndex = (this.explorationVariantIndex + 1) % 2;
        this.lastExplorationRotationAtSec = nowSec;
      }
      candidate =
        this.explorationVariantIndex === 0
          ? 'exploration_peaceful'
          : 'exploration_adventure';
    }

    // Respect minimum hold time for non-urgent transitions so borders never thrash
    if (
      !forceImmediate &&
      this.activeTrackId &&
      this.activeTrackId !== 'combat_skirmish' &&
      this.activeTrackId !== 'boss_epic' &&
      this.activeTrackId !== 'story_event' &&
      this.activeTrackId !== 'main_menu' &&
      candidate !== this.activeTrackId &&
      nowSec - this.lastTrackChangeAtSec < MIN_EXPLORATION_HOLD_SEC
    ) {
      return this.activeTrackId;
    }

    return candidate;
  }

  // -------------------------------------------------------------------------
  // AUDIO GRAPH, LAZY BUFFER POOL & DUAL-DECK CROSSFADER
  // -------------------------------------------------------------------------

  private nowSec(): number {
    return typeof performance !== 'undefined' ? performance.now() * 0.001 : Date.now() * 0.001;
  }

  private getEffectiveTargetVolume(): number {
    if (this.muted) return 0;
    if (this.sceneMode === 'menu' && !this.menuMusicEnabled) return 0;
    if (this.sceneMode === 'loading') return 0;
    const duck = this.sceneMode === 'paused' ? PAUSED_DUCK_FACTOR : 1.0;
    return this.masterVolume * this.musicVolume * BASE_MUSIC_GAIN * duck;
  }

  private shouldPlayCurrentMode(): boolean {
    if (this.disposed) return false;
    if (this.sceneMode === 'loading') return false;
    if (this.muted) return false;
    if (this.sceneMode === 'menu' && !this.menuMusicEnabled) return false;
    if (this.getEffectiveTargetVolume() <= 0.0005) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    return true;
  }

  private ensureAudioGraph(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (this.ctx) return this.ctx;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return null;

    const ctx = new AudioCtx();
    const masterGain = ctx.createGain();
    masterGain.gain.value = this.getEffectiveTargetVolume();
    masterGain.connect(ctx.destination);

    this.ctx = ctx;
    this.masterMusicGain = masterGain;
    return ctx;
  }

  private updateMasterMusicGain(immediate: boolean): void {
    if (!this.ctx || !this.masterMusicGain) return;
    const target = this.getEffectiveTargetVolume();
    const now = this.ctx.currentTime;
    if (immediate) {
      this.masterMusicGain.gain.cancelScheduledValues(now);
      this.masterMusicGain.gain.setValueAtTime(target, now);
    } else {
      this.masterMusicGain.gain.setTargetAtTime(target, now, 0.08);
    }
  }

  private async getOrRenderTrack(id: SoundtrackTrackId): Promise<RenderedTrack | null> {
    const cached = this.bufferCache.get(id);
    if (cached) {
      // Refresh LRU order
      this.bufferCache.delete(id);
      this.bufferCache.set(id, cached);
      return cached;
    }

    const inflight = this.pendingRenders.get(id);
    if (inflight) return inflight;

    const p = renderSoundtrackTrack(id, this.lowPowerMode)
      .then((track) => {
        this.pendingRenders.delete(id);
        if (!track || this.disposed) return null;
        this.bufferCache.set(id, track);
        this.evictOldBuffers(id);
        return track;
      })
      .catch(() => {
        this.pendingRenders.delete(id);
        return null;
      });

    this.pendingRenders.set(id, p);
    return p;
  }

  private evictOldBuffers(keepId: SoundtrackTrackId): void {
    while (this.bufferCache.size > MAX_CACHED_BUFFERS) {
      let evicted = false;
      for (const key of this.bufferCache.keys()) {
        if (
          key !== keepId &&
          key !== this.activeTrackId &&
          key !== this.outgoingDeck?.trackId
        ) {
          this.bufferCache.delete(key);
          evicted = true;
          break;
        }
      }
      if (!evicted) break;
    }
  }

  private async transitionToTrack(
    targetId: SoundtrackTrackId,
    fadeSec: number,
  ): Promise<void> {
    if (!this.shouldPlayCurrentMode()) return;

    // Enforce strict menu/world separation
    if (this.sceneMode === 'menu' && targetId !== 'main_menu') return;
    if (this.sceneMode !== 'menu' && targetId === 'main_menu') return;

    this.desiredTrackId = targetId;
    const seq = ++this.transitionSeq;

    const ctx = this.ensureAudioGraph();
    if (!ctx || !this.masterMusicGain) return;

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Blocked until user gesture
      }
      if ((ctx.state as string) !== 'running') {
        this.armUserGestureListeners();
        return;
      }
    }

    this.disarmUserGestureListeners();
    if (seq !== this.transitionSeq || !this.shouldPlayCurrentMode()) return;

    // If already playing this exact track, just ensure it's ramped back to 1.0
    if (this.activeDeck && this.activeDeck.trackId === targetId) {
      this.isFadingOut = false;
      this.clearDeckStopTimer(this.activeDeck);
      const now = ctx.currentTime;
      const cur = Math.max(0.0001, this.activeDeck.gain.gain.value);
      this.activeDeck.gain.gain.cancelScheduledValues(now);
      this.activeDeck.gain.gain.setValueAtTime(cur, now);
      this.activeDeck.gain.gain.linearRampToValueAtTime(1.0, now + Math.min(1.0, fadeSec));
      return;
    }

    const rendered = await this.getOrRenderTrack(targetId);
    if (!rendered || this.disposed) return;
    if (seq !== this.transitionSeq || !this.shouldPlayCurrentMode()) return;
    if ((ctx.state as string) !== 'running') {
      this.armUserGestureListeners();
      return;
    }
    // Re-check strict menu/world separation after async render
    if (this.sceneMode === 'menu' && targetId !== 'main_menu') return;
    if (this.sceneMode !== 'menu' && targetId === 'main_menu') return;

    // Stop any previous outgoing deck immediately so at most 2 decks crossfade
    if (this.outgoingDeck) {
      this.stopDeckImmediate(this.outgoingDeck);
      this.outgoingDeck = null;
    }

    const now = ctx.currentTime;

    // Fade out current active deck smoothly
    if (this.activeDeck) {
      const oldDeck = this.activeDeck;
      this.outgoingDeck = oldDeck;
      this.clearDeckStopTimer(oldDeck);
      const cur = Math.max(0.0001, oldDeck.gain.gain.value);
      oldDeck.gain.gain.cancelScheduledValues(now);
      oldDeck.gain.gain.setValueAtTime(cur, now);
      oldDeck.gain.gain.linearRampToValueAtTime(0.0001, now + fadeSec);
      if (typeof window !== 'undefined') {
        oldDeck.stopTimer = window.setTimeout(() => {
          if (this.outgoingDeck === oldDeck) {
            this.stopDeckImmediate(oldDeck);
            this.outgoingDeck = null;
          }
        }, Math.ceil(fadeSec * 1000) + 60);
      } else {
        this.stopDeckImmediate(oldDeck);
        this.outgoingDeck = null;
      }
    }

    // Start new incoming deck with smooth fade-in
    const src = ctx.createBufferSource();
    src.buffer = rendered.buffer;
    src.loop = rendered.loop;
    src.loopStart = 0;
    src.loopEnd = rendered.buffer.duration;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(1.0, now + fadeSec);

    src.connect(gain);
    gain.connect(this.masterMusicGain);
    src.start(now);

    const nextDeck: ActiveDeck = {
      trackId: targetId,
      source: src,
      gain,
      stopTimer: null,
    };

    this.activeDeck = nextDeck;
    this.activeTrackId = targetId;
    this.isFadingOut = false;
    this.lastTrackChangeAtSec = this.nowSec();
    if (targetId === 'exploration_peaceful' || targetId === 'exploration_adventure') {
      this.lastExplorationRotationAtSec = this.lastTrackChangeAtSec;
    }
    this.evictOldBuffers(targetId);
  }

  private fadeOutAll(durationSec: number): void {
    this.transitionSeq++;
    this.desiredTrackId = null;
    this.disarmUserGestureListeners();

    if (!this.ctx) {
      this.stopDeckImmediate(this.activeDeck);
      this.stopDeckImmediate(this.outgoingDeck);
      this.activeDeck = null;
      this.outgoingDeck = null;
      this.activeTrackId = null;
      this.isFadingOut = false;
      return;
    }

    const now = this.ctx.currentTime;
    this.isFadingOut = Boolean(this.activeDeck || this.outgoingDeck);

    const fadeDeck = (deck: ActiveDeck | null, clearActive: boolean) => {
      if (!deck) return;
      this.clearDeckStopTimer(deck);
      const cur = Math.max(0.0001, deck.gain.gain.value);
      deck.gain.gain.cancelScheduledValues(now);
      deck.gain.gain.setValueAtTime(cur, now);
      deck.gain.gain.linearRampToValueAtTime(0.0001, now + durationSec);
      if (typeof window !== 'undefined') {
        deck.stopTimer = window.setTimeout(() => {
          this.stopDeckImmediate(deck);
          if (clearActive && this.activeDeck === deck) {
            this.activeDeck = null;
            this.activeTrackId = null;
            this.isFadingOut = false;
          }
          if (!clearActive && this.outgoingDeck === deck) {
            this.outgoingDeck = null;
          }
        }, Math.ceil(durationSec * 1000) + 50);
      } else {
        this.stopDeckImmediate(deck);
        if (clearActive) {
          this.activeDeck = null;
          this.activeTrackId = null;
          this.isFadingOut = false;
        } else {
          this.outgoingDeck = null;
        }
      }
    };

    fadeDeck(this.activeDeck, true);
    fadeDeck(this.outgoingDeck, false);
  }

  private clearDeckStopTimer(deck: ActiveDeck): void {
    if (deck.stopTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(deck.stopTimer);
      deck.stopTimer = null;
    }
  }

  private stopDeckImmediate(deck: ActiveDeck | null): void {
    if (!deck) return;
    this.clearDeckStopTimer(deck);
    try {
      deck.source.stop();
    } catch {
      // Ignore already stopped
    }
    try {
      deck.source.disconnect();
      deck.gain.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }

  private clearStoryRestoreTimer(): void {
    if (this.storyRestoreTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.storyRestoreTimer);
      this.storyRestoreTimer = null;
    }
  }

  private armUserGestureListeners(): void {
    if (this.gestureArmed || typeof window === 'undefined') return;
    this.gestureArmed = true;
    window.addEventListener('pointerdown', this.boundUnlockHandler, {
      capture: true,
      passive: true,
    });
    window.addEventListener('touchstart', this.boundUnlockHandler, {
      capture: true,
      passive: true,
    });
    window.addEventListener('keydown', this.boundUnlockHandler, {
      capture: true,
      passive: true,
    });
    window.addEventListener('click', this.boundUnlockHandler, {
      capture: true,
      passive: true,
    });
  }

  private disarmUserGestureListeners(): void {
    if (!this.gestureArmed || typeof window === 'undefined') return;
    this.gestureArmed = false;
    window.removeEventListener('pointerdown', this.boundUnlockHandler, true);
    window.removeEventListener('touchstart', this.boundUnlockHandler, true);
    window.removeEventListener('keydown', this.boundUnlockHandler, true);
    window.removeEventListener('click', this.boundUnlockHandler, true);
  }

  private handleUserGestureUnlock(): void {
    if (this.disposed) {
      this.disarmUserGestureListeners();
      return;
    }
    if (!this.shouldPlayCurrentMode()) {
      this.disarmUserGestureListeners();
      return;
    }
    const target =
      this.desiredTrackId ??
      (this.sceneMode === 'menu'
        ? 'main_menu'
        : this.lastWorldCtx
          ? this.selectWorldTrack(this.lastWorldCtx, this.nowSec(), true)
          : 'exploration_peaceful');
    void this.transitionToTrack(
      target,
      this.sceneMode === 'menu' ? MENU_FADE_IN_SEC : EXPLORATION_CROSSFADE_SEC,
    );
  }

  private handleVisibilityChange(): void {
    if (this.disposed || typeof document === 'undefined') return;
    if (document.hidden) {
      if (this.activeDeck) {
        this.fadeOutAll(0.3);
      }
    } else if (this.shouldPlayCurrentMode()) {
      const target =
        this.sceneMode === 'menu'
          ? 'main_menu'
          : this.lastWorldCtx
            ? this.selectWorldTrack(this.lastWorldCtx, this.nowSec(), true)
            : 'exploration_peaceful';
      void this.transitionToTrack(
        target,
        this.sceneMode === 'menu' ? MENU_FADE_IN_SEC : EXPLORATION_CROSSFADE_SEC,
      );
    }
  }
}
