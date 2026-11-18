import mainMenuThemeMp3 from '../../assets/audio/main_menu_theme.mp3';
import mainMenuThemeOgg from '../../assets/audio/main_menu_theme.ogg';
import type { AudioSettings } from '../settings/GameSettingsStore';

export interface MenuMusicStateSnapshot {
  isMenuActive: boolean;
  isPlaying: boolean;
  isFadingOut: boolean;
  isUnlocked: boolean;
  hasLoadedBuffer: boolean;
  usingFallbackAudio: boolean;
  effectiveTargetVolume: number;
}

const FADE_IN_SECONDS = 1.05;
const FADE_OUT_SECONDS = 0.85;
const BASE_MENU_MUSIC_GAIN = 0.48;
const SILENCE_TRIM_THRESHOLD = 0.0005;

/**
 * Lightweight, mobile-friendly Main Menu Music manager.
 *
 * Guarantees:
 * - Lazy-fetches & decodes ONLY the single best compressed asset (.ogg Vorbis or .mp3)
 *   and caches the AudioBuffer for reuse across returns to the main menu.
 * - Uses Web Audio API sample-accurate looping (`AudioBufferSourceNode.loop = true`)
 *   with automatic silence boundary trimming on MP3 so loop restarts have zero gap.
 * - Uses Web Audio GainNodes for smooth fade-in / fade-out transitions that work
 *   reliably on desktop, mobile browsers, and Android Capacitor WebView (even on iOS/Android
 *   where HTMLAudioElement.volume may be read-only).
 * - Strictly plays ONLY while `isMenuActive` is true (main menu / interface).
 *   Never plays inside the 3D world (`loading`, `playing`, `paused`).
 */
export class MenuMusicManager {
  private ctx: AudioContext | null = null;
  private volumeGain: GainNode | null = null;
  private fadeGain: GainNode | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;

  private decodedBuffer: AudioBuffer | null = null;
  private loopStartSec = 0;
  private loopEndSec = 0;
  private loadPromise: Promise<AudioBuffer | null> | null = null;

  private fallbackAudio: HTMLAudioElement | null = null;
  private fallbackRafId: number | null = null;
  private fallbackCurrentGain = 0;
  private usingFallback = false;

  private isMenuActive = false;
  private isPlaying = false;
  private isFadingOut = false;
  private disposed = false;
  private stopTimer: number | null = null;
  private gestureArmed = false;

  private masterVolume = 0.85;
  private musicVolume = 0.7;
  private muted = false;
  private menuMusicEnabled = true;

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

  public setMenuActive(active: boolean): void {
    if (this.disposed) return;
    if (this.isMenuActive === active) {
      if (active && this.shouldPlay() && !this.isPlaying) {
        void this.ensurePlayingWithFadeIn();
      }
      return;
    }
    this.isMenuActive = active;
    if (active) {
      this.clearStopTimer();
      this.isFadingOut = false;
      if (this.shouldPlay()) {
        void this.ensurePlayingWithFadeIn();
      }
    } else {
      this.fadeOutAndStop(FADE_OUT_SECONDS);
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

    const targetVol = this.getEffectiveTargetVolume();
    if (this.ctx && this.volumeGain) {
      const now = this.ctx.currentTime;
      if (opts.immediate) {
        this.volumeGain.gain.cancelScheduledValues(now);
        this.volumeGain.gain.setValueAtTime(targetVol, now);
      } else {
        this.volumeGain.gain.setTargetAtTime(targetVol, now, 0.04);
      }
    }

    if (this.usingFallback && this.fallbackAudio) {
      this.applyFallbackVolume(this.fallbackCurrentGain);
    }

    if (this.isMenuActive) {
      if (this.shouldPlay()) {
        if (!this.isPlaying || this.isFadingOut) {
          this.clearStopTimer();
          this.isFadingOut = false;
          void this.ensurePlayingWithFadeIn();
        }
      } else if (this.isPlaying && !this.isFadingOut) {
        this.fadeOutAndStop(0.45);
      }
    }
  }

  public getState(): MenuMusicStateSnapshot {
    return {
      isMenuActive: this.isMenuActive,
      isPlaying: this.isPlaying,
      isFadingOut: this.isFadingOut,
      isUnlocked: this.ctx ? this.ctx.state === 'running' : false,
      hasLoadedBuffer: Boolean(this.decodedBuffer),
      usingFallbackAudio: this.usingFallback,
      effectiveTargetVolume: this.getEffectiveTargetVolume(),
    };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.isMenuActive = false;
    this.clearStopTimer();
    this.disarmUserGestureListeners();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
    }
    this.stopSourceImmediate();
    if (this.fallbackRafId !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(this.fallbackRafId);
      this.fallbackRafId = null;
    }
    if (this.fallbackAudio) {
      try {
        this.fallbackAudio.pause();
        this.fallbackAudio.removeAttribute('src');
        this.fallbackAudio.load();
      } catch {
        // Ignore cleanup errors
      }
      this.fallbackAudio = null;
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.volumeGain = null;
    this.fadeGain = null;
    this.decodedBuffer = null;
    this.loadPromise = null;
  }

  private getEffectiveTargetVolume(): number {
    if (this.muted || !this.menuMusicEnabled) return 0;
    return this.masterVolume * this.musicVolume * BASE_MENU_MUSIC_GAIN;
  }

  private shouldPlay(): boolean {
    if (this.disposed || !this.isMenuActive) return false;
    if (this.muted || !this.menuMusicEnabled) return false;
    if (this.getEffectiveTargetVolume() <= 0.0005) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    return true;
  }

  private selectPreferredTrackUrl(): string {
    if (typeof document !== 'undefined') {
      try {
        const probe = document.createElement('audio');
        if (probe && typeof probe.canPlayType === 'function') {
          const canOgg = probe.canPlayType('audio/ogg; codecs="vorbis"');
          if (canOgg === 'probably' || canOgg === 'maybe') {
            return mainMenuThemeOgg;
          }
        }
      } catch {
        // Fall through to MP3
      }
    }
    return mainMenuThemeMp3;
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
    const volumeGain = ctx.createGain();
    volumeGain.gain.value = this.getEffectiveTargetVolume();

    const fadeGain = ctx.createGain();
    fadeGain.gain.value = 0;

    fadeGain.connect(volumeGain);
    volumeGain.connect(ctx.destination);

    this.ctx = ctx;
    this.volumeGain = volumeGain;
    this.fadeGain = fadeGain;
    return ctx;
  }

  private async ensureDecodedBuffer(ctx: AudioContext): Promise<AudioBuffer | null> {
    if (this.decodedBuffer) return this.decodedBuffer;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      const candidates = [this.selectPreferredTrackUrl()];
      if (!candidates.includes(mainMenuThemeMp3)) {
        candidates.push(mainMenuThemeMp3);
      }

      for (const url of candidates) {
        try {
          const response = await fetch(url);
          if (!response.ok) continue;
          const arrayBuffer = await response.arrayBuffer();
          const decoded = await ctx.decodeAudioData(arrayBuffer);
          if (this.disposed) return null;

          const bounds = this.detectGaplessLoopBounds(decoded, url === mainMenuThemeOgg);
          this.decodedBuffer = decoded;
          this.loopStartSec = bounds.start;
          this.loopEndSec = bounds.end;
          return decoded;
        } catch {
          // Try fallback format candidate
        }
      }
      return null;
    })();

    const result = await this.loadPromise;
    if (!result) {
      this.loadPromise = null;
    }
    return result;
  }

  private detectGaplessLoopBounds(
    buffer: AudioBuffer,
    isSampleExactFormat: boolean,
  ): { start: number; end: number } {
    if (isSampleExactFormat || buffer.length === 0) {
      return { start: 0, end: buffer.duration };
    }
    // Trim leading/trailing encoder delay frames (< -66 dBFS) for seamless MP3 looping
    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
    const len = buffer.length;
    const maxLead = Math.min(len - 1, Math.floor(buffer.sampleRate * 0.15));
    let startIdx = 0;
    while (
      startIdx < maxLead &&
      Math.abs(ch0[startIdx]) < SILENCE_TRIM_THRESHOLD &&
      Math.abs(ch1[startIdx]) < SILENCE_TRIM_THRESHOLD
    ) {
      startIdx += 1;
    }
    const minTail = Math.max(startIdx + 1, len - Math.floor(buffer.sampleRate * 0.15));
    let endIdx = len - 1;
    while (
      endIdx > minTail &&
      Math.abs(ch0[endIdx]) < SILENCE_TRIM_THRESHOLD &&
      Math.abs(ch1[endIdx]) < SILENCE_TRIM_THRESHOLD
    ) {
      endIdx -= 1;
    }
    return {
      start: startIdx / buffer.sampleRate,
      end: (endIdx + 1) / buffer.sampleRate,
    };
  }

  private async ensurePlayingWithFadeIn(): Promise<void> {
    if (!this.shouldPlay()) return;
    const ctx = this.ensureAudioGraph();
    if (!ctx) {
      this.startFallbackPlayback();
      return;
    }

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Autoplay restriction before user interaction
      }
      // Wait for user interaction gesture if still suspended
      if ((ctx.state as string) !== 'running') {
        this.armUserGestureListeners();
        return;
      }
    }

    this.disarmUserGestureListeners();
    if (!this.shouldPlay()) return;

    const buffer = await this.ensureDecodedBuffer(ctx);
    if (!this.shouldPlay()) return;

    if (!buffer) {
      this.startFallbackPlayback();
      return;
    }

    // Re-check context running state after async fetch/decode
    if ((ctx.state as string) !== 'running') {
      this.armUserGestureListeners();
      return;
    }

    this.startOrResumeSourceNode(ctx, buffer);
  }

  private startOrResumeSourceNode(ctx: AudioContext, buffer: AudioBuffer): void {
    if (!this.fadeGain || !this.volumeGain) return;
    this.clearStopTimer();
    this.isFadingOut = false;

    const now = ctx.currentTime;
    this.volumeGain.gain.cancelScheduledValues(now);
    this.volumeGain.gain.setValueAtTime(this.getEffectiveTargetVolume(), now);

    if (this.sourceNode && this.isPlaying) {
      // Currently fading out? Smoothly ramp back up from current gain
      const currentFade = this.fadeGain.gain.value;
      this.fadeGain.gain.cancelScheduledValues(now);
      this.fadeGain.gain.setValueAtTime(currentFade, now);
      this.fadeGain.gain.linearRampToValueAtTime(1, now + FADE_IN_SECONDS);
      return;
    }

    this.stopSourceImmediate();

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = this.loopStartSec;
    src.loopEnd = this.loopEndSec > this.loopStartSec ? this.loopEndSec : buffer.duration;
    src.connect(this.fadeGain);

    this.fadeGain.gain.cancelScheduledValues(now);
    this.fadeGain.gain.setValueAtTime(0.0001, now);
    this.fadeGain.gain.linearRampToValueAtTime(1, now + FADE_IN_SECONDS);

    src.start(now, this.loopStartSec);
    this.sourceNode = src;
    this.isPlaying = true;
  }

  private fadeOutAndStop(durationSec: number): void {
    this.disarmUserGestureListeners();
    this.clearStopTimer();

    if (this.usingFallback && this.fallbackAudio) {
      this.isFadingOut = true;
      this.rampFallbackTo(0, durationSec * 1000, () => {
        if (!this.isMenuActive || !this.shouldPlay()) {
          this.fallbackAudio?.pause();
          if (this.fallbackAudio) {
            this.fallbackAudio.currentTime = 0;
          }
          this.isPlaying = false;
          this.isFadingOut = false;
        }
      });
      return;
    }

    if (!this.isPlaying || !this.ctx || !this.fadeGain) {
      this.isPlaying = false;
      this.isFadingOut = false;
      return;
    }

    this.isFadingOut = true;
    const now = this.ctx.currentTime;
    const currentFade = Math.max(0, this.fadeGain.gain.value);
    this.fadeGain.gain.cancelScheduledValues(now);
    this.fadeGain.gain.setValueAtTime(currentFade, now);
    this.fadeGain.gain.linearRampToValueAtTime(0, now + durationSec);

    if (typeof window !== 'undefined') {
      this.stopTimer = window.setTimeout(() => {
        this.stopTimer = null;
        if (!this.shouldPlay() || this.isFadingOut) {
          this.stopSourceImmediate();
        }
      }, Math.ceil(durationSec * 1000) + 40);
    } else {
      this.stopSourceImmediate();
    }
  }

  private stopSourceImmediate(): void {
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
      } catch {
        // Ignore already stopped
      }
      try {
        this.sourceNode.disconnect();
      } catch {
        // Ignore disconnect error
      }
      this.sourceNode = null;
    }
    this.isPlaying = false;
    this.isFadingOut = false;
  }

  private clearStopTimer(): void {
    if (this.stopTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.stopTimer);
      this.stopTimer = null;
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
    if (!this.shouldPlay()) {
      this.disarmUserGestureListeners();
      return;
    }
    void this.ensurePlayingWithFadeIn();
  }

  private handleVisibilityChange(): void {
    if (this.disposed || typeof document === 'undefined') return;
    if (document.hidden) {
      if (this.isPlaying) {
        this.fadeOutAndStop(0.25);
      }
    } else if (this.isMenuActive && this.shouldPlay()) {
      this.clearStopTimer();
      this.isFadingOut = false;
      void this.ensurePlayingWithFadeIn();
    }
  }

  private startFallbackPlayback(): void {
    if (typeof window === 'undefined' || !this.shouldPlay()) return;
    this.usingFallback = true;
    if (!this.fallbackAudio) {
      const el = new Audio(this.selectPreferredTrackUrl());
      el.loop = true;
      el.preload = 'auto';
      el.volume = 0;
      this.fallbackAudio = el;
    }
    this.clearStopTimer();
    this.isFadingOut = false;

    const playPromise = this.fallbackAudio.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => {
          this.disarmUserGestureListeners();
          if (!this.shouldPlay()) {
            this.fallbackAudio?.pause();
            this.isPlaying = false;
            return;
          }
          this.isPlaying = true;
          this.rampFallbackTo(1, FADE_IN_SECONDS * 1000);
        })
        .catch(() => {
          this.armUserGestureListeners();
        });
    } else {
      this.isPlaying = true;
      this.rampFallbackTo(1, FADE_IN_SECONDS * 1000);
    }
  }

  private applyFallbackVolume(fadeRatio: number): void {
    if (!this.fallbackAudio) return;
    try {
      this.fallbackAudio.volume = Math.max(
        0,
        Math.min(1, this.getEffectiveTargetVolume() * fadeRatio),
      );
    } catch {
      // Some mobile browsers treat HTMLAudioElement.volume as read-only
    }
  }

  private rampFallbackTo(
    targetRatio: number,
    durationMs: number,
    onDone?: () => void,
  ): void {
    if (typeof window === 'undefined') {
      this.fallbackCurrentGain = targetRatio;
      this.applyFallbackVolume(targetRatio);
      onDone?.();
      return;
    }
    if (this.fallbackRafId !== null) {
      window.cancelAnimationFrame(this.fallbackRafId);
      this.fallbackRafId = null;
    }
    const startRatio = this.fallbackCurrentGain;
    const startTime = performance.now();
    const step = (now: number) => {
      const t = durationMs <= 0 ? 1 : Math.min(1, (now - startTime) / durationMs);
      this.fallbackCurrentGain = startRatio + (targetRatio - startRatio) * t;
      this.applyFallbackVolume(this.fallbackCurrentGain);
      if (t < 1 && !this.disposed) {
        this.fallbackRafId = window.requestAnimationFrame(step);
      } else {
        this.fallbackRafId = null;
        onDone?.();
      }
    };
    this.fallbackRafId = window.requestAnimationFrame(step);
  }
}
