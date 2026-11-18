import type * as THREE from 'three';
import {
  type AudioCueDefinition,
  type AudioCueId,
  type BreakMaterial,
  type FootstepSurface,
  type ImpactMaterial,
  PRIORITY_WEIGHT,
  type PickupCategory,
  type SpatialAudioPosition,
  VariationTracker,
  computeSpatialAudioParams,
  resolveSoundCue,
} from './AudioRegistry';

export interface ActiveVoiceSlot {
  id: number;
  cueId: AudioCueId;
  priority: number;
  startedAtMs: number;
  expiresAtMs: number;
  onPreempt?: () => void;
}

/**
 * Pure priority & polyphony scheduler with per-cue cooldown debouncing.
 * Prevents simultaneous distortion/clipping on mobile & low-end Android CPUs.
 */
export class AudioVoiceScheduler {
  private readonly active: ActiveVoiceSlot[] = [];
  private readonly lastTriggeredAt = new Map<string, number>();
  private nextId = 1;

  constructor(public maxVoices = 14) {}

  public pruneExpired(nowMs: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i].expiresAtMs <= nowMs) {
        this.active.splice(i, 1);
      }
    }
  }

  public getActiveCount(nowMs = Date.now()): number {
    this.pruneExpired(nowMs);
    return this.active.length;
  }

  public tryAcquire(
    cue: AudioCueDefinition,
    durationMs: number,
    nowMs = Date.now(),
    cooldownKey?: string,
  ): ActiveVoiceSlot | null {
    const key = cooldownKey ?? cue.id;
    const prevMs = this.lastTriggeredAt.get(key) ?? -Infinity;
    if (cue.minIntervalMs > 0 && nowMs - prevMs < cue.minIntervalMs) {
      return null;
    }

    this.pruneExpired(nowMs);
    const weight = PRIORITY_WEIGHT[cue.priority];

    if (this.active.length >= this.maxVoices) {
      // Find lowest priority (and oldest among ties)
      let victimIdx = -1;
      let victimWeight = Infinity;
      let victimStarted = Infinity;
      for (let i = 0; i < this.active.length; i++) {
        const slot = this.active[i];
        if (
          slot.priority < victimWeight ||
          (slot.priority === victimWeight && slot.startedAtMs < victimStarted)
        ) {
          victimWeight = slot.priority;
          victimStarted = slot.startedAtMs;
          victimIdx = i;
        }
      }

      if (victimIdx === -1 || weight <= victimWeight) {
        return null;
      }

      const [evicted] = this.active.splice(victimIdx, 1);
      try {
        evicted.onPreempt?.();
      } catch {
        // Ignore cleanup errors during voice preemption
      }
    }

    const slot: ActiveVoiceSlot = {
      id: this.nextId++,
      cueId: cue.id,
      priority: weight,
      startedAtMs: nowMs,
      expiresAtMs: nowMs + Math.max(40, durationMs),
    };
    this.active.push(slot);
    this.lastTriggeredAt.set(key, nowMs);
    return slot;
  }

  public clear(): void {
    this.active.length = 0;
    this.lastTriggeredAt.clear();
  }
}

export interface EnvironmentAudioState {
  active: boolean;
  elapsed: number;
  biome: 'Plains' | 'Forest' | 'Mountains' | 'Desert' | 'Beach';
  rainIntensity: number;
  windStrength: number;
  isStorm: boolean;
  nightFactor: number;
  villageProximity: number; // 0..1 (1 inside village)
  waterProximity: number; // 0..1 (1 at shoreline / in water)
  caveFactor: number; // 0..1 (1 inside cave/mine/overhang)
  altitudeMeters: number;
  indoorFactor?: number; // 0..1 (1 inside house/roof cover — muffles outside ambience)
  combatIntensity?: number; // 0..1 (active aggro / recent combat — ducks peaceful birds/village chatter)
}

export interface PlayCueOptions {
  position?: SpatialAudioPosition;
  intensity?: number;
  pitchScale?: number;
  chargeProgress?: number;
  cooldownKey?: string;
}

/**
 * Procedural + cached-kernel Web Audio API sound engine for World of Adventure.
 *
 * Guarantees:
 * - Zero audio buffers or contexts created at startup or main menu (`unlock()` is called on world entry).
 * - Strict separation: all gameplay & environment audio routes ONLY into `effectsGain` / `voiceGain`
 *   (Master * SFX Volume), completely independent of Menu Music (`musicVolume` / `musicGain`).
 * - Priority-preempting polyphony cap (`MAX_CONCURRENT_VOICES = 14`) + anti-repeat variant selector.
 * - 3D positional distance attenuation & stereo panning relative to active listener.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private effectsGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private uiGain: GainNode | null = null;
  private voiceGain: GainNode | null = null;
  private muted = false;
  private soundEffectsEnabled = true;
  private masterVolume = 0.85;
  private musicVolume = 0.7;
  private effectsVolume = 0.9;
  private ambientVolume = 0.8;
  private uiVolume = 0.85;
  private voiceVolume = 0.9;
  private footstepVolume = 0.3;
  private lowPowerMode = false;

  // Reusable audio buffer cache & lazy shared PCM noise buffers (initialized once on unlock)
  private readonly audioBufferCache = new Map<string, AudioBuffer>();
  private noiseBuffer: AudioBuffer | null = null;
  private longNoiseBuffer: AudioBuffer | null = null;
  private brownNoiseBuffer: AudioBuffer | null = null;
  private crackleBuffer: AudioBuffer | null = null;

  // Voice & variation coordination
  private readonly voiceScheduler = new AudioVoiceScheduler(14);
  private readonly variationTracker = new VariationTracker();

  // Listener state for automatic 3D attenuation/panning
  private listenerX = 0;
  private listenerY = 0;
  private listenerZ = 0;
  private listenerYaw = 0;

  // Bow charging dynamic timer
  private lastBowChargeProgress = 0;
  private lastBowChargeSoundMs = 0;

  // Persistent pooled ambient audio graph (routed exclusively through ambientGain!)
  private ambientInitialized = false;
  private rainSource: AudioBufferSourceNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;

  private windSource: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;

  private foliageSource: AudioBufferSourceNode | null = null;
  private foliageFilter: BiquadFilterNode | null = null;
  private foliageGain: GainNode | null = null;

  private waterSource: AudioBufferSourceNode | null = null;
  private waterFilter: BiquadFilterNode | null = null;
  private waterGain: GainNode | null = null;

  private caveSource: AudioBufferSourceNode | null = null;
  private caveFilter: BiquadFilterNode | null = null;
  private caveGain: GainNode | null = null;

  private nightSource: AudioBufferSourceNode | null = null;
  private nightFilter: BiquadFilterNode | null = null;
  private nightGain: GainNode | null = null;

  // Occasional low-priority ambient one-shot timers
  private nextBirdChirpAt = 2.0;
  private nextCaveDripAt = 3.5;
  private nextVillageToneAt = 5.0;

  public unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.masterVolume * 0.55;
      this.masterGain.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicVolume;
      this.musicGain.connect(this.masterGain);

      this.effectsGain = this.ctx.createGain();
      this.effectsGain.gain.value = this.soundEffectsEnabled ? this.effectsVolume : 0;
      this.effectsGain.connect(this.masterGain);

      this.ambientGain = this.ctx.createGain();
      this.ambientGain.gain.value = this.ambientVolume;
      this.ambientGain.connect(this.masterGain);

      this.uiGain = this.ctx.createGain();
      this.uiGain.gain.value = this.uiVolume;
      this.uiGain.connect(this.masterGain);

      this.voiceGain = this.ctx.createGain();
      this.voiceGain.gain.value = this.soundEffectsEnabled ? this.voiceVolume : 0;
      this.voiceGain.connect(this.masterGain);

      // Lazily allocate reusable shared PCM buffers once audio unlocks
      this.noiseBuffer = this.createNoiseBuffer(this.ctx, 0.6);
      this.longNoiseBuffer = this.createPinkNoiseBuffer(this.ctx, 3.0);
      this.brownNoiseBuffer = this.createBrownNoiseBuffer(this.ctx, 3.0);
      this.crackleBuffer = this.createCrackleBuffer(this.ctx, 0.85);
      this.audioBufferCache.set('__noise_short', this.noiseBuffer);
      this.audioBufferCache.set('__noise_pink', this.longNoiseBuffer);
      this.audioBufferCache.set('__noise_brown', this.brownNoiseBuffer);
      this.audioBufferCache.set('__noise_crackle', this.crackleBuffer);
      this.initAmbientBedGraph(this.ctx, this.ambientGain);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  public updateListener(pos: THREE.Vector3 | SpatialAudioPosition, yaw: number): void {
    this.listenerX = pos.x;
    this.listenerY = pos.y ?? 0;
    this.listenerZ = pos.z;
    this.listenerYaw = yaw;
  }

  public setLowPowerMode(lowPower: boolean): void {
    this.lowPowerMode = lowPower;
    this.voiceScheduler.maxVoices = lowPower ? 10 : 14;
  }

  public isLowPowerMode(): boolean {
    return this.lowPowerMode;
  }

  public getCachedBuffer(key: string): AudioBuffer | undefined {
    return this.audioBufferCache.get(key);
  }

  public setCachedBuffer(key: string, buffer: AudioBuffer): void {
    this.audioBufferCache.set(key, buffer);
  }

  public hasCachedBuffer(key: string): boolean {
    return this.audioBufferCache.has(key);
  }

  public getCacheSize(): number {
    return this.audioBufferCache.size;
  }

  public clearBufferCache(): void {
    this.audioBufferCache.clear();
  }

  public setAudioVolumes(vols: {
    masterVolume?: number;
    musicVolume?: number;
    effectsVolume?: number;
    ambientVolume?: number;
    uiVolume?: number;
    voiceVolume?: number;
    footstepVolume?: number;
    muted?: boolean;
    soundEffectsEnabled?: boolean;
  }): void {
    if (vols.masterVolume !== undefined && Number.isFinite(vols.masterVolume)) {
      this.masterVolume = Math.max(0, Math.min(1, vols.masterVolume));
    }
    if (vols.musicVolume !== undefined && Number.isFinite(vols.musicVolume)) {
      this.musicVolume = Math.max(0, Math.min(1, vols.musicVolume));
    }
    if (vols.effectsVolume !== undefined && Number.isFinite(vols.effectsVolume)) {
      this.effectsVolume = Math.max(0, Math.min(1, vols.effectsVolume));
    }
    if (vols.ambientVolume !== undefined && Number.isFinite(vols.ambientVolume)) {
      this.ambientVolume = Math.max(0, Math.min(1, vols.ambientVolume));
    }
    if (vols.uiVolume !== undefined && Number.isFinite(vols.uiVolume)) {
      this.uiVolume = Math.max(0, Math.min(1, vols.uiVolume));
    }
    if (vols.voiceVolume !== undefined && Number.isFinite(vols.voiceVolume)) {
      this.voiceVolume = Math.max(0, Math.min(1, vols.voiceVolume));
    }
    if (vols.footstepVolume !== undefined && Number.isFinite(vols.footstepVolume)) {
      this.footstepVolume = Math.max(0, Math.min(1, vols.footstepVolume));
    }
    if (vols.muted !== undefined) {
      this.muted = vols.muted;
    }
    if (vols.soundEffectsEnabled !== undefined) {
      this.soundEffectsEnabled = vols.soundEffectsEnabled;
    }

    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        this.muted ? 0 : this.masterVolume * 0.55,
        now,
        0.04,
      );
    }
    if (this.musicGain) {
      this.musicGain.gain.setTargetAtTime(this.musicVolume, now, 0.04);
    }
    if (this.effectsGain) {
      this.effectsGain.gain.setTargetAtTime(
        this.soundEffectsEnabled ? this.effectsVolume : 0,
        now,
        0.04,
      );
    }
    if (this.ambientGain) {
      this.ambientGain.gain.setTargetAtTime(this.ambientVolume, now, 0.05);
    }
    if (this.uiGain) {
      this.uiGain.gain.setTargetAtTime(this.uiVolume, now, 0.03);
    }
    if (this.voiceGain) {
      this.voiceGain.gain.setTargetAtTime(
        this.soundEffectsEnabled ? this.voiceVolume : 0,
        now,
        0.04,
      );
    }
  }

  public setMuted(muted: boolean): void {
    this.setAudioVolumes({ muted });
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public isSoundEffectsEnabled(): boolean {
    return this.soundEffectsEnabled;
  }

  public getEffectiveSfxMultiplier(): number {
    if (this.muted || !this.soundEffectsEnabled) return 0;
    return this.masterVolume * this.effectsVolume;
  }

  public getEffectiveAmbientMultiplier(): number {
    if (this.muted) return 0;
    return this.masterVolume * this.ambientVolume;
  }

  public getEffectiveUiMultiplier(): number {
    if (this.muted) return 0;
    return this.masterVolume * this.uiVolume;
  }

  public getDiagnostics() {
    return {
      unlocked: Boolean(this.ctx && this.ctx.state === 'running'),
      muted: this.muted,
      lowPowerMode: this.lowPowerMode,
      maxVoices: this.voiceScheduler.maxVoices,
      activeVoices: this.voiceScheduler.getActiveCount(),
      cacheSize: this.audioBufferCache.size,
      effectiveMultipliers: {
        master: this.muted ? 0 : this.masterVolume,
        sfx: this.getEffectiveSfxMultiplier(),
        ambient: this.getEffectiveAmbientMultiplier(),
        ui: this.getEffectiveUiMultiplier(),
      },
    };
  }

  private createNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private createPinkNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + white * 0.1848) * 0.18));
    }
    return buffer;
  }

  private createBrownNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.025 * white) / 1.025;
      data[i] = Math.max(-1, Math.min(1, lastOut * 3.1));
    }
    return buffer;
  }

  private createCrackleBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let env = 0;
    for (let i = 0; i < length; i++) {
      if (Math.random() < 0.016) {
        env = (0.35 + Math.random() * 0.65) * (Math.random() < 0.5 ? 1 : -1);
      } else {
        env *= 0.86;
      }
      data[i] = Math.max(-1, Math.min(1, env + (Math.random() * 2 - 1) * 0.06));
    }
    return buffer;
  }

  private initAmbientBedGraph(ctx: AudioContext, ambientBus: GainNode): void {
    if (this.ambientInitialized || !this.longNoiseBuffer || !this.brownNoiseBuffer) return;
    this.ambientInitialized = true;

    const createLoopLayer = (
      buf: AudioBuffer,
      type: BiquadFilterType,
      freq: number,
      q: number,
      offsetSec: number,
    ) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;

      const gain = ctx.createGain();
      gain.gain.value = 0;

      src.connect(filter);
      filter.connect(gain);
      gain.connect(ambientBus);
      src.start(ctx.currentTime, offsetSec);
      return { src, filter, gain };
    };

    const rain = createLoopLayer(this.longNoiseBuffer, 'lowpass', 1600, 0.7, 0.0);
    this.rainSource = rain.src;
    this.rainFilter = rain.filter;
    this.rainGain = rain.gain;

    const wind = createLoopLayer(this.longNoiseBuffer, 'bandpass', 340, 2.4, 1.1);
    this.windSource = wind.src;
    this.windFilter = wind.filter;
    this.windGain = wind.gain;

    const foliage = createLoopLayer(this.longNoiseBuffer, 'bandpass', 1350, 1.1, 0.45);
    this.foliageSource = foliage.src;
    this.foliageFilter = foliage.filter;
    this.foliageGain = foliage.gain;

    const water = createLoopLayer(this.longNoiseBuffer, 'bandpass', 720, 0.85, 1.85);
    this.waterSource = water.src;
    this.waterFilter = water.filter;
    this.waterGain = water.gain;

    const cave = createLoopLayer(this.brownNoiseBuffer, 'lowpass', 135, 1.4, 0.7);
    this.caveSource = cave.src;
    this.caveFilter = cave.filter;
    this.caveGain = cave.gain;

    const night = createLoopLayer(this.longNoiseBuffer, 'highpass', 2600, 0.9, 2.15);
    this.nightSource = night.src;
    this.nightFilter = night.filter;
    this.nightGain = night.gain;
  }

  /**
   * Smoothly ramps all world ambient layers down to silence (used on pause, sleep, or returning to menu).
   */
  public stopWorldAmbienceSmooth(timeConstantSec = 0.14): void {
    if (!this.ctx || !this.ambientInitialized) return;
    const now = this.ctx.currentTime;
    const gains = [
      this.rainGain,
      this.windGain,
      this.foliageGain,
      this.waterGain,
      this.caveGain,
      this.nightGain,
    ];
    for (const g of gains) {
      g?.gain.setTargetAtTime(0, now, timeConstantSec);
    }
  }

  /**
   * Smoothly updates all continuous gameplay environment audio layers
   * (forest, desert, village, mountains, caves, water, rain, storm, night,
   * indoor muffling, and combat tension ducking).
   * Strictly routes into `ambientGain`, NEVER `musicGain`.
   */
  public updateEnvironmentAudio(env: EnvironmentAudioState): void {
    if (!this.ctx || !this.ambientInitialized) return;
    if (!env.active) {
      this.stopWorldAmbienceSmooth(0.14);
      return;
    }

    const now = this.ctx.currentTime;
    const audible = !this.muted && this.ambientVolume > 0.001 && this.masterVolume > 0.001;
    const indoor = Math.max(0, Math.min(1, env.indoorFactor ?? 0));
    const combat = Math.max(0, Math.min(1, env.combatIntensity ?? 0));
    const night = Math.max(0, Math.min(1, env.nightFactor));

    // Inside houses: outside rain/wind/foliage/water/night muffle & quieten naturally
    const outsideAtten = 1 - indoor * 0.74;
    const filterMuffle = 1 - indoor * 0.52;
    // Night: outdoors ambience softens cleanly; peaceful birds/village duck during combat
    const nightQuiet = 1 - night * 0.28;
    const peacefulDuck = 1 - combat * 0.58;

    // 1. Rain & Storm bed
    if (this.rainGain && this.rainFilter) {
      const stormBoost = env.isStorm ? 1.15 : 1.0;
      const targetRain = audible
        ? Math.max(0, Math.min(0.26, env.rainIntensity * 0.22 * stormBoost * outsideAtten))
        : 0;
      const targetRainFreq = (950 + env.rainIntensity * (env.isStorm ? 2100 : 1550)) * filterMuffle;
      this.rainGain.gain.setTargetAtTime(targetRain, now, 0.28);
      this.rainFilter.frequency.setTargetAtTime(targetRainFreq, now, 0.28);
    }

    // 2. Wind (biome-shaped: mountain howl, desert dry breeze, storm gale)
    if (this.windGain && this.windFilter) {
      const gust = 0.8 + 0.2 * Math.sin(env.elapsed * 0.65) * Math.cos(env.elapsed * 0.27);
      const altitudeWind =
        env.biome === 'Mountains'
          ? Math.min(0.55, Math.max(0, (env.altitudeMeters - 24) / 38))
          : 0;
      const desertBreeze = env.biome === 'Desert' ? 0.16 : 0;
      const combinedWind = Math.max(env.windStrength, altitudeWind, desertBreeze);
      const windThreshold = Math.max(0, combinedWind - 0.12) / 0.88;
      const caveMuffle = 1 - env.caveFactor * 0.72;
      const targetWind = audible
        ? Math.max(
            0,
            Math.min(
              0.18,
              windThreshold * 0.15 * gust * caveMuffle * outsideAtten * nightQuiet,
            ),
          )
        : 0;
      const baseWindFreq =
        env.biome === 'Mountains'
          ? 380
          : env.biome === 'Desert'
            ? 290
            : 230;
      const targetWindFreq = (baseWindFreq + combinedWind * 440 * gust) * filterMuffle;
      this.windGain.gain.setTargetAtTime(targetWind, now, 0.32);
      this.windFilter.frequency.setTargetAtTime(targetWindFreq, now, 0.32);
    }

    // 3. Forest / Foliage breeze rustle
    if (this.foliageGain && this.foliageFilter) {
      const forestMix =
        env.biome === 'Forest' ? 1.0 : env.biome === 'Plains' ? 0.38 : 0.05;
      const breeze = 0.45 + Math.min(0.55, env.windStrength * 0.7);
      const sway = 0.82 + 0.18 * Math.sin(env.elapsed * 0.9);
      const targetFoliage = audible
        ? Math.max(
            0,
            Math.min(
              0.065,
              forestMix *
                breeze *
                0.055 *
                sway *
                (1 - env.caveFactor * 0.85) *
                outsideAtten *
                nightQuiet,
            ),
          )
        : 0;
      this.foliageGain.gain.setTargetAtTime(targetFoliage, now, 0.35);
      this.foliageFilter.frequency.setTargetAtTime(
        (1150 + env.windStrength * 520 + 180 * Math.sin(env.elapsed * 0.5)) * filterMuffle,
        now,
        0.35,
      );
    }

    // 4. Water (shoreline, lake, river, beach waves)
    if (this.waterGain && this.waterFilter) {
      const waveCycle = 0.75 + 0.25 * Math.sin(env.elapsed * 1.15);
      const baseWater = env.biome === 'Beach' ? Math.max(env.waterProximity, 0.35) : env.waterProximity;
      const targetWater = audible
        ? Math.max(0, Math.min(0.11, baseWater * 0.095 * waveCycle * outsideAtten * nightQuiet))
        : 0;
      this.waterGain.gain.setTargetAtTime(targetWater, now, 0.32);
      this.waterFilter.frequency.setTargetAtTime((620 + waveCycle * 320) * filterMuffle, now, 0.32);
    }

    // 5. Caves / Mine resonance + subtle low combat tension bed
    if (this.caveGain) {
      const caveFloor = Math.max(env.caveFactor * 0.10, combat * 0.035);
      const targetCave = audible
        ? Math.max(0, Math.min(0.11, caveFloor))
        : 0;
      this.caveGain.gain.setTargetAtTime(targetCave, now, 0.4);
    }

    // 6. Night cricket/nocturnal hush (muted indoors, during storm, deep caves, or high peaks)
    if (this.nightGain && this.nightFilter) {
      const canChirpNight =
        night > 0.35 &&
        env.rainIntensity < 0.25 &&
        env.biome !== 'Desert' &&
        env.altitudeMeters < 38 &&
        indoor < 0.7;
      const pulse = 0.55 + 0.45 * Math.max(0, Math.sin(env.elapsed * 7.5));
      const nightMix = canChirpNight ? ((night - 0.35) / 0.65) : 0;
      const targetNight = audible
        ? Math.max(
            0,
            Math.min(
              0.035,
              nightMix * 0.032 * pulse * (1 - env.caveFactor * 0.7) * outsideAtten * peacefulDuck,
            ),
          )
        : 0;
      this.nightGain.gain.setTargetAtTime(targetNight, now, 0.35);
    }

    // 7. Lightweight procedural ambient one-shots
    if (!audible || !this.ambientGain) return;

    if (
      (env.biome === 'Forest' || env.biome === 'Plains') &&
      night < 0.35 &&
      !env.isStorm &&
      env.rainIntensity < 0.25 &&
      env.caveFactor < 0.3 &&
      indoor < 0.5 &&
      combat < 0.35 &&
      env.elapsed >= this.nextBirdChirpAt
    ) {
      this.nextBirdChirpAt = env.elapsed + (env.biome === 'Forest' ? 3.2 : 5.4) + Math.random() * 4.5;
      this.playAmbientBirdChirp((env.biome === 'Forest' ? 0.042 : 0.028) * peacefulDuck * outsideAtten);
    }

    if (env.caveFactor > 0.35 && env.elapsed >= this.nextCaveDripAt) {
      this.nextCaveDripAt = env.elapsed + 2.4 + Math.random() * 3.8;
      this.playAmbientCaveDrip(env.caveFactor);
    }

    if (
      env.villageProximity > 0.45 &&
      night < 0.55 &&
      combat < 0.35 &&
      env.elapsed >= this.nextVillageToneAt
    ) {
      this.nextVillageToneAt = env.elapsed + 5.5 + Math.random() * 6.5;
      this.playAmbientVillageAccent(env.villageProximity * peacefulDuck * (1 - indoor * 0.4));
    }
  }

  /**
   * Backward-compatible weather updater delegating to `updateEnvironmentAudio`.
   */
  public updateWeatherAudio(
    rainIntensity: number,
    windStrength: number,
    active: boolean,
    elapsed = 0,
  ): void {
    this.updateEnvironmentAudio({
      active,
      elapsed,
      biome: 'Plains',
      rainIntensity,
      windStrength,
      isStorm: rainIntensity > 0.72,
      nightFactor: 0,
      villageProximity: 0,
      waterProximity: 0,
      caveFactor: 0,
      altitudeMeters: 4,
      indoorFactor: 0,
      combatIntensity: 0,
    });
  }

  private playAmbientBirdChirp(peak: number): void {
    if (!this.ctx || !this.ambientGain || this.muted || this.ambientVolume <= 0.001) return;
    const slot = this.voiceScheduler.tryAcquire(
      resolveSoundCue('env_forest')!,
      240,
      Date.now(),
      'ambient_bird',
    );
    if (!slot) return;

    const now = this.ctx.currentTime;
    const baseFreq = 2150 + Math.random() * 1450;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * (1.28 + Math.random() * 0.2), now + 0.055);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.92, now + 0.13);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0008, now);
    g.gain.linearRampToValueAtTime(Math.max(0.001, peak), now + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.14);

    const dest = this.createPannedSubmix(Math.random() * 1.4 - 0.7, 1, this.ambientGain);
    osc.connect(g);
    g.connect(dest);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  private playAmbientCaveDrip(caveFactor: number): void {
    if (!this.ctx || !this.ambientGain || this.muted || this.ambientVolume <= 0.001) return;
    const slot = this.voiceScheduler.tryAcquire(
      resolveSoundCue('env_caves')!,
      220,
      Date.now(),
      'ambient_drip',
    );
    if (!slot) return;

    const now = this.ctx.currentTime;
    const f = 920 + Math.random() * 560;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, now);
    osc.frequency.exponentialRampToValueAtTime(f * 1.45, now + 0.045);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0008, now);
    g.gain.linearRampToValueAtTime(0.045 * caveFactor, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.12);

    const dest = this.createPannedSubmix(Math.random() * 1.3 - 0.65, 1, this.ambientGain);
    osc.connect(g);
    g.connect(dest);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  private playAmbientVillageAccent(proximity: number): void {
    if (!this.ctx || !this.ambientGain || this.muted || this.ambientVolume <= 0.001) return;
    const slot = this.voiceScheduler.tryAcquire(
      resolveSoundCue('env_village')!,
      260,
      Date.now(),
      'ambient_village',
    );
    if (!slot) return;

    const now = this.ctx.currentTime;
    const isForge = Math.random() < 0.5;
    const osc = this.ctx.createOscillator();
    osc.type = isForge ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(isForge ? 1180 + Math.random() * 240 : 280 + Math.random() * 70, now);
    osc.frequency.exponentialRampToValueAtTime(isForge ? 890 : 120, now + 0.14);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0008, now);
    g.gain.linearRampToValueAtTime(Math.max(0.001, 0.025 * proximity), now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.18);

    const dest = this.createPannedSubmix(Math.random() * 1.4 - 0.7, 1, this.ambientGain);
    osc.connect(g);
    g.connect(dest);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  /**
   * Synthesizes layered procedural thunder (crack for nearby strikes + rolling sub-bass rumble).
   */
  public playThunder(intensity = 0.85, distanceMeters = 400): void {
    if (this.muted || this.ambientVolume <= 0.001 || !this.ctx || !this.masterGain || !this.longNoiseBuffer) return;
    const now = this.ctx.currentTime;
    const distFactor = Math.max(0.32, Math.min(1.0, 1 - (distanceMeters - 180) / 950));
    const power = Math.max(0.25, Math.min(1.0, intensity)) * distFactor;
    const rumbleDuration = 2.1 + (1 - distFactor) * 1.9;

    const ambientBus = this.ambientGain ?? this.masterGain;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.longNoiseBuffer;

    const rumbleFilter = this.ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.setValueAtTime(160 + distFactor * 260, now);
    rumbleFilter.frequency.exponentialRampToValueAtTime(38, now + rumbleDuration);
    rumbleFilter.Q.value = 1.1;

    const rumbleGain = this.ctx.createGain();
    rumbleGain.gain.setValueAtTime(0.001, now);
    rumbleGain.gain.linearRampToValueAtTime(0.46 * power, now + 0.09);
    rumbleGain.gain.setValueAtTime(0.36 * power, now + 0.28);
    rumbleGain.gain.linearRampToValueAtTime(0.29 * power, now + 0.65);
    rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + rumbleDuration);

    noise.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(ambientBus);
    noise.start(now, Math.random() * 0.7, rumbleDuration + 0.05);

    const subOsc = this.ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(56 + distFactor * 22, now);
    subOsc.frequency.exponentialRampToValueAtTime(26, now + 1.35);

    const subGain = this.ctx.createGain();
    subGain.gain.setValueAtTime(0.001, now);
    subGain.gain.linearRampToValueAtTime(0.28 * power, now + 0.06);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 1.45);

    subOsc.connect(subGain);
    subGain.connect(ambientBus);
    subOsc.start(now);
    subOsc.stop(now + 1.5);

    if (distanceMeters < 420 && this.noiseBuffer) {
      const crack = this.ctx.createBufferSource();
      crack.buffer = this.noiseBuffer;

      const crackFilter = this.ctx.createBiquadFilter();
      crackFilter.type = 'bandpass';
      crackFilter.frequency.setValueAtTime(980, now);
      crackFilter.frequency.exponentialRampToValueAtTime(190, now + 0.34);
      crackFilter.Q.value = 0.85;

      const crackGain = this.ctx.createGain();
      crackGain.gain.setValueAtTime(0.001, now);
      crackGain.gain.linearRampToValueAtTime(0.34 * power, now + 0.014);
      crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

      crack.connect(crackFilter);
      crackFilter.connect(crackGain);
      crackGain.connect(ambientBus);
      crack.start(now, 0, 0.4);
    }
  }

  private createPannedSubmix(
    pan: number,
    gainScale: number,
    busDest: AudioNode,
  ): AudioNode {
    if (!this.ctx) return busDest;
    const attenuationNode = this.ctx.createGain();
    attenuationNode.gain.value = Math.max(0, Math.min(1.5, gainScale));
    if (typeof this.ctx.createStereoPanner === 'function' && Math.abs(pan) > 0.02) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      attenuationNode.connect(panner);
      panner.connect(busDest);
    } else {
      attenuationNode.connect(busDest);
    }
    return attenuationNode;
  }

  /**
   * Central cue player supporting:
   * - Declarative missing-cue logging
   * - Priority-based voice limiting
   * - Anti-repeat variation selection
   * - 3D spatial distance attenuation & stereo panning
   */
  public playCue(cueId: AudioCueId | string, opts: PlayCueOptions = {}): boolean {
    const cue = resolveSoundCue(cueId);
    if (!cue) return false;
    if (this.muted || this.masterVolume <= 0.001 || !this.ctx) return false;

    if (cue.bus === 'ui') {
      if (this.uiVolume <= 0.001) return false;
    } else if (cue.bus === 'ambient') {
      if (this.ambientVolume <= 0.001) return false;
    } else {
      if (!this.soundEffectsEnabled || this.effectsVolume <= 0.001) return false;
    }

    const busDest =
      cue.bus === 'ui'
        ? (this.uiGain ?? this.masterGain)
        : cue.bus === 'ambient'
          ? (this.ambientGain ?? this.masterGain)
          : cue.bus === 'voice'
            ? (this.voiceGain ?? this.effectsGain ?? this.masterGain)
            : (this.effectsGain ?? this.masterGain);
    if (!busDest) return false;

    let spatialGain = 1;
    let pan = 0;
    if (opts.position) {
      const sp = computeSpatialAudioParams(
        opts.position,
        { x: this.listenerX, y: this.listenerY, z: this.listenerZ },
        this.listenerYaw,
        cue.refDistance,
        cue.maxDistance,
        cue.rolloff,
      );
      if (!sp.audible) return false;
      spatialGain = sp.attenuation;
      pan = sp.pan;
    }

    const durationMs = this.estimateCueDurationMs(cue.id);
    const slot = this.voiceScheduler.tryAcquire(
      cue,
      durationMs,
      Date.now(),
      opts.cooldownKey,
    );
    if (!slot) return false;

    const variant = this.variationTracker.pickVariant(cue.id, cue.variantCount);
    const pitchJitter =
      (opts.pitchScale ?? 1) * (0.94 + (variant / Math.max(1, cue.variantCount)) * 0.12 + (Math.random() - 0.5) * 0.04);
    const intensity = Math.max(0.15, Math.min(1.6, opts.intensity ?? 1.0));
    const finalScale = Math.max(0.001, spatialGain * intensity);
    const out = this.createPannedSubmix(pan, finalScale, busDest);

    this.synthesizeCue(cue, out, variant, pitchJitter, opts);
    return true;
  }

  private estimateCueDurationMs(cueId: AudioCueId): number {
    if (cueId.startsWith('footstep_')) return 130;
    if (cueId.startsWith('break_')) return 340;
    if (cueId === 'chest_open' || cueId === 'door_open' || cueId === 'door_close') return 320;
    if (cueId === 'pickup_quest' || cueId === 'enemy_death' || cueId === 'player_death') return 320;
    return 210;
  }

  // =========================================================================
  // High-level Domain Sound APIs (Clean Gameplay Subsystems Integration)
  // =========================================================================

  /**
   * 1. Sword & Melee Weapon Swings
   */
  public playWeaponSwing(
    weaponId?: string | null,
    pos?: SpatialAudioPosition,
  ): void {
    const id = (weaponId ?? '').toLowerCase();
    if (id === 'hunter-knife') {
      this.playCue('knife_slash', { position: pos });
    } else if (id === 'wooden-sword') {
      this.playCue('sword_swing_fast', { position: pos });
    } else if (id === 'woodland-axe' || id === 'battle-axe' || id === 'stone-club') {
      this.playCue('tool_axe_swing', { position: pos });
    } else if (id === 'spear' || id === 'bronze-spear') {
      this.playCue('spear_thrust', { position: pos });
    } else if (
      id === 'steel-sword' ||
      id === 'iron-sword' ||
      id === 'ranger-sword' ||
      id === 'copper-sword' ||
      id === 'silver-sword'
    ) {
      this.playCue('sword_swing', { position: pos });
    } else if (!id) {
      this.playCue('unarmed_swing', { position: pos });
    } else {
      this.playCue('sword_swing', { position: pos });
    }
  }

  public playAttackSwing(weaponId?: string | null, pos?: SpatialAudioPosition): void {
    this.playWeaponSwing(weaponId, pos);
  }

  public playHeavySwordSwing(pos?: SpatialAudioPosition): void {
    this.playCue('sword_swing_heavy', { position: pos });
  }

  public playMeleeImpact(
    material: ImpactMaterial,
    opts: {
      isCrit?: boolean;
      weaponId?: string | null;
      position?: SpatialAudioPosition;
    } = {},
  ): void {
    if (material === 'armor') {
      this.playCue('sword_hit_armor', { position: opts.position });
      if (opts.isCrit) {
        this.playCue('critical_hit', { position: opts.position, intensity: 0.75 });
      }
      return;
    }
    if (material === 'wood') {
      this.playCue('sword_hit_wood', { position: opts.position });
      return;
    }
    if (material === 'stone') {
      this.playCue('sword_hit_stone', { position: opts.position });
      return;
    }
    if (material === 'glass') {
      this.playCue('break_glass', { position: opts.position, intensity: 0.65 });
      return;
    }
    if (opts.isCrit) {
      this.playCue('critical_hit', { position: opts.position });
      return;
    }
    if (!opts.weaponId || opts.weaponId === 'unarmed') {
      this.playCue('unarmed_hit', { position: opts.position });
    } else {
      this.playCue('sword_hit', { position: opts.position });
    }
  }

  public playWeaponBlock(isShield = false, pos?: SpatialAudioPosition): void {
    this.playCue(isShield ? 'shield_block' : 'sword_block', { position: pos });
  }

  /**
   * 2. Tools & Resource Gathering
   */
  public playResourceToolAction(
    resourceKind: string,
    depleted = false,
    pos?: SpatialAudioPosition,
  ): void {
    const kind = resourceKind.toLowerCase();
    if (kind === 'wood' || kind === 'driftwood') {
      this.playCue('tool_axe_tree', { position: pos });
      if (depleted) {
        this.playMaterialBreak('wood', pos);
      }
    } else if (kind === 'stone') {
      this.playCue('tool_pickaxe_stone', { position: pos });
      if (depleted) {
        this.playMaterialBreak('stone', pos);
      }
    } else if (kind === 'iron-ore' || kind === 'copper-ore' || kind === 'coal') {
      this.playCue('tool_pickaxe_iron', { position: pos });
      if (depleted) {
        this.playMaterialBreak('resource_node', pos);
      }
    } else if (kind === 'gold-ore' || kind === 'silver-ore' || kind === 'rare-mineral') {
      this.playCue('tool_pickaxe_gold', { position: pos });
      if (depleted) {
        this.playMaterialBreak('resource_node', pos);
      }
    } else if (kind === 'sand' || kind === 'clay' || kind === 'gravel') {
      this.playCue('tool_shovel_dig', { position: pos });
      if (depleted) {
        this.playMaterialBreak('resource_node', pos);
      }
    } else if (
      kind === 'fiber' ||
      kind === 'wheat' ||
      kind === 'flower' ||
      kind === 'mushroom' ||
      kind === 'berries' ||
      kind === 'cactus' ||
      kind === 'desert-plant' ||
      kind === 'meadow-herb' ||
      kind === 'medicinal-herb'
    ) {
      this.playCue('tool_harvesting', { position: pos });
      if (depleted) {
        this.playMaterialBreak('plant', pos);
      }
    } else {
      this.playCue('resource_collect', { position: pos });
      if (depleted) {
        this.playMaterialBreak('resource_node', pos);
      }
    }
  }

  public playToolBreak(pos?: SpatialAudioPosition): void {
    this.playCue('tool_break', { position: pos });
  }

  /**
   * 3. Material-specific Breaking
   */
  public playMaterialBreak(material: BreakMaterial, pos?: SpatialAudioPosition): void {
    const map: Record<BreakMaterial, AudioCueId> = {
      wood: 'break_wood',
      stone: 'break_stone',
      glass: 'break_glass',
      plant: 'break_plant',
      crate: 'break_crate',
      resource_node: 'break_resource_node',
    };
    this.playCue(map[material], { position: pos });
  }

  /**
   * 4. Item Pickup
   */
  public playItemPickup(
    category: PickupCategory,
    pos?: SpatialAudioPosition,
  ): void {
    const map: Record<PickupCategory, AudioCueId> = {
      resource: 'pickup_resource',
      weapon: 'pickup_weapon',
      food: 'pickup_food',
      quest: 'pickup_quest',
      coins: 'pickup_coins',
    };
    this.playCue(map[category], { position: pos });
  }

  /**
   * 5. Throwing & Dropping
   */
  public playItemDropOrThrow(
    isThrow = false,
    pos?: SpatialAudioPosition,
  ): void {
    this.playCue(isThrow ? 'item_throw' : 'item_drop', { position: pos });
  }

  /**
   * 6. Bow Mechanics
   */
  public playBowDraw(): void {
    this.lastBowChargeProgress = 0;
    this.lastBowChargeSoundMs = Date.now();
    this.playCue('bow_pull');
  }

  public updateBowChargeProgress(progress: number): void {
    const nowMs = Date.now();
    if (
      progress > 0.15 &&
      progress < 0.96 &&
      progress - this.lastBowChargeProgress >= 0.22 &&
      nowMs - this.lastBowChargeSoundMs >= 220
    ) {
      this.lastBowChargeProgress = progress;
      this.lastBowChargeSoundMs = nowMs;
      this.playCue('bow_charge', {
        chargeProgress: progress,
        pitchScale: 0.85 + progress * 0.45,
      });
    }
  }

  public playBowFullCharge(): void {
    this.playCue('bow_full_charge');
  }

  public playBowRelease(charge = 1, pos?: SpatialAudioPosition): void {
    const clamped = Math.max(0.2, Math.min(1, charge));
    this.playCue('bow_release', {
      position: pos,
      intensity: 0.65 + clamped * 0.45,
      pitchScale: 0.88 + clamped * 0.24,
    });
  }

  public playBowEmpty(): void {
    this.playCue('bow_empty');
  }

  public playArrowFly(pos?: SpatialAudioPosition): void {
    this.playCue('arrow_fly', { position: pos });
  }

  public playArrowImpact(
    material: 'wood' | 'stone' | 'enemy' | 'armor' | 'water' | 'dirt',
    pos?: SpatialAudioPosition,
    isCrit = false,
  ): void {
    if (material === 'wood') {
      this.playCue('arrow_hit_wood', { position: pos });
    } else if (material === 'stone') {
      this.playCue('arrow_hit_stone', { position: pos });
    } else if (material === 'armor') {
      this.playCue('arrow_hit_armor', { position: pos });
    } else if (material === 'water') {
      this.playCue('arrow_hit_water', { position: pos });
    } else if (material === 'enemy') {
      this.playCue('arrow_hit_enemy', {
        position: pos,
        intensity: isCrit ? 1.25 : 1.0,
        pitchScale: isCrit ? 1.15 : 1.0,
      });
    } else {
      this.playCue('arrow_impact', { position: pos });
    }
  }

  public playArrowStick(
    x?: number,
    y?: number,
    z?: number,
    material: 'wood' | 'stone' | 'water' | 'dirt' = 'wood',
  ): void {
    const pos =
      x !== undefined && y !== undefined && z !== undefined
        ? { x, y, z }
        : undefined;
    this.playArrowImpact(material, pos);
  }

  /**
   * 7. Combat Events
   */
  public playHitImpact(
    isCrit = false,
    opts?: { armored?: boolean; weaponId?: string | null; position?: SpatialAudioPosition },
  ): void {
    this.playMeleeImpact(opts?.armored ? 'armor' : 'flesh', {
      isCrit,
      weaponId: opts?.weaponId ?? 'ranger-sword',
      position: opts?.position,
    });
  }

  public playEnemyDefeat(pos?: SpatialAudioPosition): void {
    this.playCue('enemy_death', { position: pos });
  }

  public playPlayerHurt(hasArmor = false): void {
    this.playCue('player_hit');
    if (hasArmor) {
      this.playCue('armor_impact', { intensity: 0.72 });
    }
  }

  public playPlayerDefeat(): void {
    this.playCue('player_death');
  }

  /**
   * 8. Doors, Chests, Crafting, Building
   */
  public playDoorState(isOpen: boolean, pos?: SpatialAudioPosition): void {
    this.playCue(isOpen ? 'door_open' : 'door_close', { position: pos });
  }

  public playChestState(isOpen: boolean, pos?: SpatialAudioPosition): void {
    this.playCue(isOpen ? 'chest_open' : 'chest_close', { position: pos });
  }

  public playCrafting(itemId?: string): void {
    if (itemId && (itemId.includes('-ingot') || itemId === 'smelting-furnace')) {
      this.playCue('smelting');
      return;
    }
    const isMetal = Boolean(
      itemId &&
        (itemId.includes('sword') ||
          itemId.includes('axe') ||
          itemId.includes('pickaxe') ||
          itemId.includes('iron') ||
          itemId.includes('steel') ||
          itemId.includes('copper') ||
          itemId.includes('bronze') ||
          itemId.includes('silver') ||
          itemId.includes('crossbow') ||
          itemId.includes('knife')),
    );
    this.playCue(isMetal ? 'tool_crafting' : 'crafting');
  }

  public playObjectPlace(isBuilding = false, pos?: SpatialAudioPosition): void {
    this.playCue(isBuilding ? 'building_place' : 'object_place', { position: pos });
  }

  public playObjectRemove(pos?: SpatialAudioPosition): void {
    this.playCue('object_remove', { position: pos });
  }

  public playBuildUpgrade(pos?: SpatialAudioPosition): void {
    this.playCue('build_upgrade', { position: pos });
  }

  public playBuildRepair(pos?: SpatialAudioPosition): void {
    this.playCue('build_repair', { position: pos });
  }

  public playBuildError(): void {
    this.playCue('build_error');
  }

  public playInteract(): void {
    this.playCue('interact');
  }

  public playUiClick(): void {
    this.playCue('ui_click');
  }

  public playFarmPlant(pos?: SpatialAudioPosition): void {
    this.playCue('farm_plant', { position: pos });
  }

  public playFarmWater(pos?: SpatialAudioPosition): void {
    this.playCue('farm_water', { position: pos });
  }

  public playFarmHarvest(pos?: SpatialAudioPosition): void {
    this.playCue('farm_harvest', { position: pos });
  }

  public playAnimalHappy(pos?: SpatialAudioPosition): void {
    this.playCue('animal_happy', { position: pos });
  }

  public playVillageUpgrade(pos?: SpatialAudioPosition): void {
    this.playCue('village_upgrade', { position: pos });
  }

  public playTradeCoin(): void {
    this.playCue('trade_coin');
  }

  /**
   * 9. Footsteps, Jump, Land with Surface Awareness & Low Calibrated Volume
   */
  public playFootstepSurface(
    movement: boolean | 'walking' | 'running' | 'sprinting' | 'crouching' = false,
    surface: FootstepSurface = 'grass',
  ): void {
    if (this.footstepVolume <= 0.001) return;
    const mode: 'walking' | 'running' | 'sprinting' | 'crouching' =
      typeof movement === 'boolean'
        ? movement
          ? 'sprinting'
          : 'walking'
        : movement;

    const cueMap: Record<FootstepSurface, AudioCueId> = {
      grass: 'footstep_grass',
      dirt: 'footstep_dirt',
      stone: 'footstep_stone',
      sand: 'footstep_sand',
      wood: 'footstep_wood',
      snow: 'footstep_snow',
      water: 'footstep_water',
    };
    const modeScale =
      mode === 'crouching'
        ? 0.45
        : mode === 'walking'
          ? 0.78
          : mode === 'running'
            ? 1.0
            : 1.18;

    // Keep footsteps subtle and realistic; modulated by footstepVolume (default 0.30)
    const intensity = Math.max(0.05, Math.min(1.15, modeScale * (this.footstepVolume / 0.3) * 0.75));
    const pitchScale =
      mode === 'crouching' ? 0.88 : mode === 'sprinting' ? 1.08 : 1.0;

    this.playCue(cueMap[surface], { intensity, pitchScale });
  }

  public playFootstep(
    movement: boolean | 'walking' | 'running' | 'sprinting' | 'crouching' = false,
    surface: FootstepSurface = 'grass',
  ): void {
    this.playFootstepSurface(movement, surface);
  }

  public playJump(): void {
    this.playCue('jump');
  }

  public playLand(impactStrength = 1, surface: FootstepSurface = 'dirt'): void {
    const strength = Math.min(Math.max(impactStrength, 0.35), 1.6);
    this.playCue('land', { intensity: strength });
    if (surface === 'water') {
      this.playCue('footstep_water', {
        intensity: Math.min(1.4, strength * 1.15),
        cooldownKey: 'land_splash',
      });
    }
  }

  // =========================================================================
  // Procedural Multi-Layered Acoustic Synthesizer (One-shot Cue Dispatch)
  // =========================================================================

  private synthesizeCue(
    cue: AudioCueDefinition,
    out: AudioNode,
    variant: number,
    pitch: number,
    opts: PlayCueOptions,
  ): void {
    if (!this.ctx) return;
    const gScale = cue.baseGain;
    const id = cue.id;

    // --- 1. SWORD & MELEE ---
    if (id === 'sword_swing' || id === 'sword_swing_fast' || id === 'knife_slash') {
      const dur = id === 'knife_slash' ? 0.11 : id === 'sword_swing_fast' ? 0.13 : 0.17;
      const startF = (id === 'knife_slash' ? 1450 : id === 'sword_swing_fast' ? 1250 : 960) * pitch;
      this.synthNoiseSweep(out, startF, startF * 0.32, 1.5, gScale, dur, 'bandpass', false);
      this.synthTone(out, 'sine', 420 * pitch, 240 * pitch, gScale * 0.25, dur * 0.7);
      return;
    }
    if (id === 'sword_swing_heavy' || id === 'tool_axe_swing') {
      this.synthNoiseSweep(out, 540 * pitch, 145 * pitch, 1.15, gScale * 1.1, 0.24, 'bandpass', true);
      this.synthTone(out, 'triangle', 145 * pitch, 62 * pitch, gScale * 0.55, 0.2);
      return;
    }
    if (id === 'spear_thrust' || id === 'unarmed_swing') {
      const f = (id === 'spear_thrust' ? 1150 : 680) * pitch;
      this.synthNoiseSweep(out, f, f * 0.38, 1.8, gScale, 0.13, 'bandpass', false);
      return;
    }
    if (id === 'sword_hit' || id === 'enemy_hit' || id === 'sword_impact') {
      this.synthTone(out, 'triangle', 210 * pitch, 64 * pitch, gScale * 0.95, 0.12);
      this.synthNoiseSweep(out, 1650 * pitch, 480 * pitch, 1.1, gScale * 0.72, 0.08, 'bandpass', false);
      return;
    }
    if (id === 'critical_hit') {
      this.synthTone(out, 'sawtooth', 310 * pitch, 72 * pitch, gScale * 0.85, 0.15);
      this.synthTone(out, 'sine', 960 * pitch, 520 * pitch, gScale * 0.45, 0.14);
      this.synthNoiseSweep(out, 2400 * pitch, 620 * pitch, 1.3, gScale * 0.75, 0.11, 'bandpass', false);
      return;
    }
    if (id === 'sword_hit_armor' || id === 'armor_impact' || id === 'sword_block' || id === 'shield_block') {
      const isShield = id === 'shield_block';
      const ringF = (id === 'sword_block' ? 1120 : 880) * pitch;
      this.synthMetallicClang(out, ringF, gScale * 0.9, isShield ? 0.17 : 0.22);
      if (isShield) {
        this.synthTone(out, 'triangle', 175 * pitch, 65 * pitch, gScale * 0.85, 0.13);
      }
      this.synthNoiseSweep(out, 2600 * pitch, 950 * pitch, 1.8, gScale * 0.45, 0.06, 'bandpass', false);
      return;
    }
    if (id === 'sword_hit_wood' || id === 'tool_axe_tree') {
      this.synthTone(out, 'triangle', 165 * pitch, 68 * pitch, gScale * 0.95, 0.11);
      this.synthTone(out, 'sine', 420 * pitch, 210 * pitch, gScale * 0.48, 0.08);
      this.synthNoiseSweep(out, 1300 * pitch, 420 * pitch, 1.3, gScale * 0.65, 0.09, 'bandpass', true);
      return;
    }
    if (id === 'sword_hit_stone' || id === 'tool_pickaxe_stone' || id === 'tool_mining') {
      this.synthMetallicClang(out, 1980 * pitch, gScale * 0.55, 0.14);
      this.synthNoiseSweep(out, 2200 * pitch, 780 * pitch, 1.5, gScale * 0.75, 0.11, 'bandpass', true);
      return;
    }

    // --- 2. TOOLS ---
    if (id === 'tool_pickaxe_iron' || id === 'tool_pickaxe_gold') {
      const baseF = (id === 'tool_pickaxe_gold' ? 1820 : 1460) * pitch;
      this.synthMetallicClang(out, baseF, gScale * 0.75, id === 'tool_pickaxe_gold' ? 0.24 : 0.18);
      this.synthNoiseSweep(out, 2400 * pitch, 900 * pitch, 1.3, gScale * 0.55, 0.09, 'bandpass', true);
      return;
    }
    if (id === 'tool_shovel_dig') {
      this.synthNoiseSweep(out, 620 * pitch, 1180 * pitch, 1.0, gScale * 0.9, 0.16, 'bandpass', true);
      this.synthTone(out, 'sine', 120 * pitch, 65 * pitch, gScale * 0.5, 0.12);
      return;
    }
    if (id === 'tool_harvesting' || id === 'resource_collect') {
      this.synthNoiseSweep(out, 2100 * pitch, 950 * pitch, 1.2, gScale * 0.85, 0.1, 'bandpass', true);
      this.synthTone(out, 'sine', 520 * pitch, 320 * pitch, gScale * 0.3, 0.07);
      return;
    }
    if (id === 'tool_crafting' || id === 'crafting' || id === 'smelting') {
      const now = this.ctx.currentTime;
      if (id === 'smelting') {
        this.synthNoiseSweep(out, 1850 * pitch, 620 * pitch, 1.2, gScale * 0.72, 0.24, 'bandpass', true);
        this.synthTone(out, 'triangle', 145 * pitch, 95 * pitch, gScale * 0.65, 0.18, now);
        this.synthMetallicClang(out, 980 * pitch, gScale * 0.45, 0.14, 0.08);
      } else if (id === 'tool_crafting') {
        this.synthMetallicClang(out, 1280 * pitch, gScale * 0.7, 0.14, 0);
        this.synthMetallicClang(out, 1360 * pitch, gScale * 0.75, 0.16, 0.11);
      } else {
        this.synthTone(out, 'triangle', 260 * pitch, 120 * pitch, gScale * 0.75, 0.08, now);
        this.synthTone(out, 'triangle', 340 * pitch, 160 * pitch, gScale * 0.75, 0.09, now + 0.095);
        this.synthNoiseSweep(out, 1200 * pitch, 550 * pitch, 1.4, gScale * 0.4, 0.12, 'bandpass', false);
      }
      return;
    }
    if (id === 'tool_break') {
      const now = this.ctx.currentTime;
      this.synthTone(out, 'sawtooth', 260 * pitch, 72 * pitch, gScale * 0.85, 0.18, now);
      this.synthNoiseSweep(out, 1750 * pitch, 380 * pitch, 1.0, gScale * 0.8, 0.22, 'bandpass', true);
      this.synthMetallicClang(out, 620 * pitch, gScale * 0.5, 0.16, 0.05);
      return;
    }

    // --- 3. BREAKING ---
    if (id === 'break_wood' || id === 'break_crate') {
      const now = this.ctx.currentTime;
      this.synthTone(out, 'triangle', 175 * pitch, 58 * pitch, gScale * 0.9, 0.16, now);
      this.synthNoiseSweep(out, 1450 * pitch, 340 * pitch, 1.1, gScale * 0.85, 0.24, 'bandpass', true);
      this.synthTone(out, 'square', 310 * pitch, 140 * pitch, gScale * 0.35, 0.08, now + 0.075);
      return;
    }
    if (id === 'break_stone' || id === 'break_resource_node') {
      const now = this.ctx.currentTime;
      this.synthTone(out, 'sine', 120 * pitch, 36 * pitch, gScale * 1.0, 0.26, now);
      this.synthNoiseSweep(out, 1100 * pitch, 220 * pitch, 0.9, gScale * 0.9, 0.30, 'lowpass', true);
      return;
    }
    if (id === 'break_glass') {
      const now = this.ctx.currentTime;
      this.synthNoiseSweep(out, 5200 * pitch, 2400 * pitch, 0.8, gScale * 0.95, 0.26, 'highpass', true);
      this.synthTone(out, 'sine', 3400 * pitch, 2800 * pitch, gScale * 0.42, 0.12, now);
      this.synthTone(out, 'sine', 4700 * pitch, 3900 * pitch, gScale * 0.35, 0.14, now + 0.05);
      return;
    }
    if (id === 'break_plant') {
      this.synthNoiseSweep(out, 2400 * pitch, 820 * pitch, 1.1, gScale * 0.9, 0.14, 'bandpass', true);
      return;
    }

    // --- 4. ITEM PICKUP ---
    if (id === 'pickup_resource') {
      const now = this.ctx.currentTime;
      this.synthTone(out, 'triangle', 360 * pitch, 480 * pitch, gScale * 0.72, 0.075, now);
      this.synthNoiseSweep(out, 1100 * pitch, 650 * pitch, 1.2, gScale * 0.45, 0.06, 'bandpass', false);
      return;
    }
    if (id === 'pickup_weapon') {
      this.synthMetallicClang(out, 1420 * pitch, gScale * 0.65, 0.13);
      this.synthTone(out, 'triangle', 440 * pitch, 660 * pitch, gScale * 0.55, 0.1);
      return;
    }
    if (id === 'pickup_food') {
      this.synthNoiseSweep(out, 1750 * pitch, 880 * pitch, 1.4, gScale * 0.65, 0.07, 'bandpass', true);
      this.synthTone(out, 'sine', 520 * pitch, 720 * pitch, gScale * 0.55, 0.08);
      return;
    }
    if (id === 'pickup_quest') {
      const now = this.ctx.currentTime;
      this.synthTone(out, 'triangle', 587.33 * pitch, 587.33 * pitch, gScale * 0.68, 0.11, now);
      this.synthTone(out, 'triangle', 880 * pitch, 880 * pitch, gScale * 0.75, 0.2, now + 0.07);
      return;
    }
    if (id === 'pickup_coins') {
      const now = this.ctx.currentTime;
      this.synthTone(out, 'sine', 2380 * pitch, 2450 * pitch, gScale * 0.65, 0.075, now);
      this.synthTone(out, 'sine', 3120 * pitch, 3220 * pitch, gScale * 0.65, 0.11, now + 0.048);
      return;
    }

    // --- 5. THROWING & DROPPING ---
    if (id === 'item_throw' || id === 'projectile_launch') {
      this.synthNoiseSweep(out, 980 * pitch, 360 * pitch, 1.4, gScale * 0.9, 0.13, 'bandpass', false);
      return;
    }
    if (id === 'item_drop') {
      this.synthTone(out, 'sine', 155 * pitch, 68 * pitch, gScale * 0.8, 0.09);
      this.synthNoiseSweep(out, 780 * pitch, 360 * pitch, 1.1, gScale * 0.45, 0.07, 'lowpass', false);
      return;
    }

    // --- 6. BOW & ARROWS ---
    if (id === 'bow_pull') {
      this.synthTone(out, 'triangle', 112 * pitch, 188 * pitch, gScale * 0.65, 0.16);
      this.synthNoiseSweep(out, 620 * pitch, 980 * pitch, 1.8, gScale * 0.35, 0.15, 'bandpass', true);
      return;
    }
    if (id === 'bow_charge') {
      const prog = opts.chargeProgress ?? 0.5;
      this.synthTone(out, 'triangle', (140 + prog * 95) * pitch, (165 + prog * 110) * pitch, gScale * 0.6, 0.09);
      this.synthNoiseSweep(out, (700 + prog * 500) * pitch, (850 + prog * 550) * pitch, 2.2, gScale * 0.4, 0.09, 'bandpass', true);
      return;
    }
    if (id === 'bow_full_charge') {
      this.synthTone(out, 'sine', 660 * pitch, 880 * pitch, gScale * 0.6, 0.11);
      return;
    }
    if (id === 'bow_release' || id === 'arrow_release') {
      this.synthTone(out, 'triangle', 235 * pitch, 76 * pitch, gScale * 0.85, 0.14);
      this.synthNoiseSweep(out, 1550 * pitch, 460 * pitch, 1.6, gScale * 0.8, 0.14, 'bandpass', false);
      return;
    }
    if (id === 'bow_empty') {
      this.synthTone(out, 'square', 250 * pitch, 115 * pitch, gScale * 0.55, 0.065);
      return;
    }
    if (id === 'arrow_fly') {
      this.synthNoiseSweep(out, 1680 * pitch, 840 * pitch, 2.1, gScale * 0.78, 0.12, 'bandpass', false);
      return;
    }
    if (id === 'arrow_hit_wood' || id === 'arrow_impact') {
      this.synthTone(out, 'triangle', 205 * pitch, 74 * pitch, gScale * 0.9, 0.09);
      this.synthNoiseSweep(out, 1320 * pitch, 480 * pitch, 1.6, gScale * 0.55, 0.06, 'bandpass', false);
      return;
    }
    if (id === 'arrow_hit_stone') {
      this.synthMetallicClang(out, 2240 * pitch, gScale * 0.55, 0.1);
      this.synthNoiseSweep(out, 2700 * pitch, 1100 * pitch, 1.5, gScale * 0.55, 0.08, 'bandpass', true);
      return;
    }
    if (id === 'arrow_hit_enemy') {
      this.synthTone(out, 'triangle', 230 * pitch, 65 * pitch, gScale * 0.95, 0.1);
      this.synthNoiseSweep(out, 1900 * pitch, 620 * pitch, 1.2, gScale * 0.65, 0.07, 'bandpass', false);
      return;
    }
    if (id === 'arrow_hit_armor') {
      this.synthMetallicClang(out, 1780 * pitch, gScale * 0.8, 0.18);
      return;
    }
    if (id === 'arrow_hit_water') {
      this.synthNoiseSweep(out, 780 * pitch, 240 * pitch, 0.9, gScale * 0.9, 0.18, 'lowpass', false);
      this.synthTone(out, 'sine', 340 * pitch, 180 * pitch, gScale * 0.45, 0.09);
      return;
    }

    // --- 7. COMBAT ---
    if (id === 'player_hit') {
      this.synthTone(out, 'sawtooth', 148 * pitch, 52 * pitch, gScale * 0.85, 0.16);
      this.synthNoiseSweep(out, 900 * pitch, 280 * pitch, 1.1, gScale * 0.55, 0.1, 'lowpass', false);
      return;
    }
    if (id === 'unarmed_hit') {
      this.synthTone(out, 'sine', 165 * pitch, 58 * pitch, gScale * 0.9, 0.09);
      this.synthNoiseSweep(out, 740 * pitch, 310 * pitch, 1.1, gScale * 0.45, 0.06, 'lowpass', false);
      return;
    }
    if (id === 'enemy_death') {
      const now = this.ctx.currentTime;
      this.synthTone(out, 'triangle', 340 * pitch, 520 * pitch, gScale * 0.7, 0.12, now);
      this.synthTone(out, 'triangle', 520 * pitch, 680 * pitch, gScale * 0.65, 0.16, now + 0.075);
      return;
    }
    if (id === 'player_death') {
      const now = this.ctx.currentTime;
      this.synthTone(out, 'sawtooth', 180 * pitch, 62 * pitch, gScale * 0.78, 0.25, now);
      this.synthTone(out, 'sine', 120 * pitch, 42 * pitch, gScale * 0.75, 0.28, now + 0.08);
      return;
    }

    // --- 8. BUILDING & INTERACTION ---
    if (id === 'door_open') {
      const now = this.ctx.currentTime;
      this.synthTone(out, 'square', 420 * pitch, 240 * pitch, gScale * 0.3, 0.035, now);
      this.synthNoiseSweep(out, 310 * pitch, 520 * pitch, 4.2, gScale * 0.75, 0.22, 'bandpass', false);
      return;
    }
    if (id === 'door_close') {
      const now = this.ctx.currentTime;
      this.synthNoiseSweep(out, 460 * pitch, 220 * pitch, 2.2, gScale * 0.5, 0.14, 'bandpass', false);
      this.synthTone(out, 'triangle', 142 * pitch, 54 * pitch, gScale * 0.95, 0.12, now + 0.085);
      return;
    }
    if (id === 'chest_open') {
      const now = this.ctx.currentTime;
      this.synthMetallicClang(out, 1180 * pitch, gScale * 0.45, 0.09, 0);
      this.synthNoiseSweep(out, 340 * pitch, 620 * pitch, 3.2, gScale * 0.65, 0.2, 'bandpass', false);
      this.synthTone(out, 'sine', 660 * pitch, 990 * pitch, gScale * 0.45, 0.18, now + 0.09);
      return;
    }
    if (id === 'chest_close') {
      const now = this.ctx.currentTime;
      this.synthTone(out, 'triangle', 155 * pitch, 64 * pitch, gScale * 0.9, 0.13, now);
      this.synthMetallicClang(out, 1020 * pitch, gScale * 0.4, 0.09, 0.06);
      return;
    }
    if (id === 'object_place' || id === 'building_place') {
      this.synthTone(out, 'triangle', 165 * pitch, 62 * pitch, gScale * 0.95, 0.14);
      this.synthNoiseSweep(out, 880 * pitch, 340 * pitch, 1.3, gScale * 0.55, 0.11, 'bandpass', false);
      return;
    }
    if (id === 'object_remove') {
      this.synthTone(out, 'triangle', 210 * pitch, 95 * pitch, gScale * 0.85, 0.11);
      this.synthNoiseSweep(out, 1100 * pitch, 460 * pitch, 1.2, gScale * 0.5, 0.1, 'bandpass', false);
      return;
    }
    if (id === 'build_upgrade') {
      const now = this.ctx.currentTime;
      this.synthMetallicClang(out, 780 * pitch, gScale * 0.5, 0.11, 0);
      this.synthTone(out, 'triangle', 260 * pitch, 520 * pitch, gScale * 0.85, 0.16, now + 0.04);
      this.synthTone(out, 'sine', 640 * pitch, 880 * pitch, gScale * 0.55, 0.14, now + 0.09);
      return;
    }
    if (id === 'build_repair') {
      const now = this.ctx.currentTime;
      this.synthTone(out, 'triangle', 190 * pitch, 110 * pitch, gScale * 0.78, 0.09, now);
      this.synthMetallicClang(out, 940 * pitch, gScale * 0.38, 0.08, 0.05);
      return;
    }
    if (id === 'build_error') {
      const now = this.ctx.currentTime;
      this.synthTone(out, 'sawtooth', 210 * pitch, 150 * pitch, gScale * 0.55, 0.08, now);
      this.synthTone(out, 'sawtooth', 165 * pitch, 120 * pitch, gScale * 0.55, 0.11, now + 0.07);
      return;
    }
    if (id === 'interact') {
      const now = this.ctx.currentTime;
      this.synthTone(out, 'triangle', 440 * pitch, 440 * pitch, gScale * 0.72, 0.08, now);
      this.synthTone(out, 'triangle', 587.33 * pitch, 587.33 * pitch, gScale * 0.72, 0.14, now + 0.055);
      return;
    }
    if (id === 'ui_click') {
      this.synthTone(out, 'sine', 520 * pitch, 740 * pitch, gScale * 0.65, 0.065);
      return;
    }
    if (id === 'farm_plant') {
      this.synthNoiseSweep(out, 620 * pitch, 240 * pitch, 1.1, gScale * 0.75, 0.11, 'bandpass', false);
      this.synthTone(out, 'triangle', 280 * pitch, 360 * pitch, gScale * 0.45, 0.08);
      return;
    }
    if (id === 'farm_water') {
      this.synthNoiseSweep(out, 920 * pitch, 290 * pitch, 1.0, gScale * 0.85, 0.2, 'lowpass', true);
      this.synthTone(out, 'sine', 380 * pitch, 510 * pitch, gScale * 0.35, 0.11);
      return;
    }
    if (id === 'farm_harvest') {
      const now = this.ctx.currentTime;
      this.synthNoiseSweep(out, 1900 * pitch, 820 * pitch, 1.3, gScale * 0.65, 0.09, 'bandpass', true);
      this.synthTone(out, 'triangle', 520 * pitch, 780 * pitch, gScale * 0.55, 0.12, now + 0.03);
      return;
    }
    if (id === 'animal_happy') {
      const now = this.ctx.currentTime;
      this.synthTone(out, 'sine', 420 * pitch, 560 * pitch, gScale * 0.65, 0.09, now);
      this.synthTone(out, 'sine', 580 * pitch, 740 * pitch, gScale * 0.55, 0.11, now + 0.07);
      return;
    }
    if (id === 'village_upgrade') {
      const now = this.ctx.currentTime;
      this.synthTone(out, 'triangle', 392 * pitch, 392 * pitch, gScale * 0.7, 0.12, now);
      this.synthTone(out, 'triangle', 493.88 * pitch, 493.88 * pitch, gScale * 0.7, 0.12, now + 0.08);
      this.synthTone(out, 'triangle', 587.33 * pitch, 783.99 * pitch, gScale * 0.75, 0.22, now + 0.16);
      return;
    }
    if (id === 'trade_coin') {
      const now = this.ctx.currentTime;
      this.synthTone(out, 'sine', 2280 * pitch, 2400 * pitch, gScale * 0.6, 0.07, now);
      this.synthTone(out, 'sine', 3040 * pitch, 3200 * pitch, gScale * 0.6, 0.11, now + 0.045);
      return;
    }
    if (id === 'jump') {
      this.synthTone(out, 'triangle', 155 * pitch, 340 * pitch, gScale * 0.9, 0.16);
      return;
    }
    if (id === 'land') {
      this.synthTone(out, 'sine', 118 * pitch, 42 * pitch, gScale * 0.95, 0.14);
      this.synthNoiseSweep(out, 460 * pitch, 180 * pitch, 1.0, gScale * 0.4, 0.09, 'lowpass', false);
      return;
    }

    // --- 9. SURFACE-SPECIFIC QUIET FOOTSTEPS ---
    if (id === 'footstep_grass') {
      this.synthNoiseSweep(out, (540 + variant * 42) * pitch, 320 * pitch, 1.15, gScale, 0.085, 'bandpass', true);
      return;
    }
    if (id === 'footstep_dirt') {
      this.synthNoiseSweep(out, (450 + variant * 35) * pitch, 240 * pitch, 1.1, gScale * 0.85, 0.08, 'bandpass', false);
      this.synthTone(out, 'sine', 112 * pitch, 56 * pitch, gScale * 0.55, 0.06);
      return;
    }
    if (id === 'footstep_stone') {
      this.synthNoiseSweep(out, (1320 + variant * 85) * pitch, 740 * pitch, 1.8, gScale * 0.82, 0.055, 'bandpass', false);
      this.synthTone(out, 'triangle', 168 * pitch, 82 * pitch, gScale * 0.55, 0.048);
      return;
    }
    if (id === 'footstep_sand') {
      this.synthNoiseSweep(out, (960 + variant * 55) * pitch, 520 * pitch, 0.95, gScale * 0.95, 0.105, 'bandpass', false);
      return;
    }
    if (id === 'footstep_wood') {
      this.synthTone(out, 'triangle', (215 + variant * 14) * pitch, 92 * pitch, gScale * 0.85, 0.075);
      this.synthTone(out, 'sine', (430 + variant * 22) * pitch, 260 * pitch, gScale * 0.42, 0.055);
      return;
    }
    if (id === 'footstep_snow') {
      this.synthNoiseSweep(out, (2050 + variant * 120) * pitch, 1120 * pitch, 1.45, gScale * 0.9, 0.095, 'bandpass', true);
      return;
    }
    if (id === 'footstep_water') {
      this.synthNoiseSweep(out, (680 + variant * 40) * pitch, 280 * pitch, 1.0, gScale * 0.95, 0.125, 'lowpass', false);
      this.synthTone(out, 'sine', 310 * pitch, 190 * pitch, gScale * 0.35, 0.07);
      return;
    }
  }

  private synthTone(
    out: AudioNode,
    type: OscillatorType,
    startFreq: number,
    endFreq: number,
    peakGain: number,
    durationSec: number,
    startAt?: number,
  ): void {
    if (!this.ctx) return;
    const t0 = startAt ?? this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(24, startFreq), t0);
    if (Math.abs(endFreq - startFreq) > 1) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(24, endFreq), t0 + durationSec);
    }

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0008, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, peakGain), t0 + Math.min(0.015, durationSec * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + durationSec);

    osc.connect(g);
    g.connect(out);
    osc.start(t0);
    osc.stop(t0 + durationSec + 0.012);
  }

  private synthNoiseSweep(
    out: AudioNode,
    startFreq: number,
    endFreq: number,
    q: number,
    peakGain: number,
    durationSec: number,
    filterType: BiquadFilterType,
    useCrackle: boolean,
  ): void {
    if (!this.ctx) return;
    const buf = useCrackle && this.crackleBuffer ? this.crackleBuffer : this.noiseBuffer;
    if (!buf) return;

    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(Math.max(40, startFreq), t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), t0 + durationSec);
    filter.Q.setValueAtTime(q, t0);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0008, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, peakGain), t0 + Math.min(0.018, durationSec * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + durationSec);

    src.connect(filter);
    filter.connect(g);
    g.connect(out);

    const maxOffset = Math.max(0, buf.duration - durationSec - 0.05);
    src.start(t0, maxOffset > 0 ? Math.random() * maxOffset : 0, durationSec + 0.02);
  }

  private synthMetallicClang(
    out: AudioNode,
    baseFreq: number,
    peakGain: number,
    durationSec: number,
    delaySec = 0,
  ): void {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delaySec;
    const partials = [1.0, 1.54, 2.27];
    const gains = [0.55, 0.35, 0.22];
    for (let i = 0; i < partials.length; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(baseFreq * partials[i], t0);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * partials[i] * 0.94, t0 + durationSec);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0008, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, peakGain * gains[i]), t0 + 0.007);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + durationSec * (1 - i * 0.14));

      osc.connect(g);
      g.connect(out);
      osc.start(t0);
      osc.stop(t0 + durationSec + 0.015);
    }
  }

  public dispose(): void {
    const sources = [
      this.rainSource,
      this.windSource,
      this.foliageSource,
      this.waterSource,
      this.caveSource,
      this.nightSource,
    ];
    for (const s of sources) {
      try {
        s?.stop();
      } catch {
        // Ignore already stopped
      }
    }
    this.rainSource = null;
    this.windSource = null;
    this.foliageSource = null;
    this.waterSource = null;
    this.caveSource = null;
    this.nightSource = null;
    this.ambientInitialized = false;
    this.voiceScheduler.clear();
    this.variationTracker.clear();
    this.audioBufferCache.clear();
    this.noiseBuffer = null;
    this.longNoiseBuffer = null;
    this.brownNoiseBuffer = null;
    this.crackleBuffer = null;
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
      this.masterGain = null;
      this.effectsGain = null;
      this.ambientGain = null;
      this.uiGain = null;
      this.voiceGain = null;
      this.musicGain = null;
    }
  }
}
