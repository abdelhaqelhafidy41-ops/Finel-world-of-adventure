/**
 * Original Cinematic Orchestral Soundtrack Synthesizer for World of Adventure.
 *
 * Uses OfflineAudioContext to lazily render rich, stereo, reverb-infused
 * orchestral compositions on demand into seamless AudioBuffers, then plays
 * them with near-zero real-time CPU overhead on desktop, Web, and weak Android.
 *
 * 100% original compositions — zero external audio files or copyrighted motifs.
 */

export type SoundtrackTrackId =
  | 'main_menu'
  | 'exploration_peaceful'
  | 'exploration_adventure'
  | 'mountain_valley'
  | 'desert_ancient'
  | 'village_hearth'
  | 'ancient_ruins'
  | 'night_mystic'
  | 'combat_skirmish'
  | 'boss_epic'
  | 'story_event';

export interface RenderedTrack {
  readonly id: SoundtrackTrackId;
  readonly buffer: AudioBuffer;
  readonly loop: boolean;
  readonly durationSec: number;
}

type VoiceType =
  | 'strings_pad'
  | 'strings_lead'
  | 'cello'
  | 'piano'
  | 'flute'
  | 'harp'
  | 'horn'
  | 'choir'
  | 'oud'
  | 'chime';

interface NoteEvent {
  time: number; // in beats
  dur: number; // in beats
  midi: number;
  vel: number; // 0..1
  voice: VoiceType;
  pan?: number; // -1..1
}

interface DrumEvent {
  time: number; // in beats
  vel: number; // 0..1
  kind: 'taiko' | 'frame' | 'shaker' | 'cymbal' | 'timpani';
}

interface TrackScore {
  bpm: number;
  beats: number;
  loop: boolean;
  reverbWet: number;
  reverbDecay: number;
  notes: NoteEvent[];
  drums: DrumEvent[];
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Deterministic PRNG for reverb impulse & humanization micro-timing.
 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Creates a lush stereo concert-hall impulse response buffer.
 */
function createConcertHallIR(
  ctx: BaseAudioContext,
  decaySec: number,
  seed: number,
): AudioBuffer {
  const sr = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sr * decaySec));
  const ir = ctx.createBuffer(2, length, sr);
  const rand = mulberry32(seed);

  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let lp = 0;
    const damp = 0.24; // warm high-frequency absorption
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const env = Math.pow(1 - t, 2.35) * (i < sr * 0.025 ? i / (sr * 0.025) : 1);
      const white = (rand() * 2 - 1) * env;
      lp = lp + damp * (white - lp);
      data[i] = lp * 0.55;
    }
    // Distinct early reflections for stereo spatial depth
    const earlyMs = ch === 0 ? [18, 37, 62, 89] : [23, 44, 71, 96];
    for (let e = 0; e < earlyMs.length; e++) {
      const idx = Math.floor((earlyMs[e] / 1000) * sr);
      if (idx < length) {
        data[idx] += (0.28 - e * 0.05) * (e % 2 === 0 ? 1 : -1);
      }
    }
  }
  return ir;
}

/**
 * Creates a shared filtered white-noise buffer for breathy flutes & percussion.
 */
function createNoiseBuffer(ctx: BaseAudioContext, seconds = 1.5): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  const rand = mulberry32(99173);
  for (let i = 0; i < len; i++) {
    data[i] = rand() * 2 - 1;
  }
  return buf;
}

/**
 * Helper to add a rich orchestral chord (pad / strings / choir / cello).
 */
function addChord(
  notes: NoteEvent[],
  time: number,
  dur: number,
  midis: number[],
  vel: number,
  voice: VoiceType,
  panSpread = 0.35,
): void {
  const n = midis.length;
  for (let i = 0; i < n; i++) {
    const pan = n > 1 ? -panSpread + (i / (n - 1)) * (panSpread * 2) : 0;
    notes.push({
      time,
      dur,
      midi: midis[i],
      vel: vel * (i === 0 ? 1.05 : 0.92),
      voice,
      pan,
    });
  }
}

/**
 * Helper to add a melodic phrase as [beatOffset, durationBeats, midi, velocity].
 */
function addMelody(
  notes: NoteEvent[],
  startBeat: number,
  phrase: Array<[number, number, number, number]>,
  voice: VoiceType,
  pan = 0,
): void {
  for (let i = 0; i < phrase.length; i++) {
    const [off, dur, midi, vel] = phrase[i];
    notes.push({
      time: startBeat + off,
      dur,
      midi,
      vel,
      voice,
      pan,
    });
  }
}

/**
 * Helper to add flowing harp / piano / lute arpeggios across a chord.
 */
function addArpeggio(
  notes: NoteEvent[],
  startBeat: number,
  totalBeats: number,
  stepBeats: number,
  pattern: number[],
  vel: number,
  voice: VoiceType,
  pan = 0,
): void {
  const steps = Math.floor(totalBeats / stepBeats);
  for (let i = 0; i < steps; i++) {
    const midi = pattern[i % pattern.length];
    const accent = i % 4 === 0 ? 1.0 : 0.78;
    notes.push({
      time: startBeat + i * stepBeats,
      dur: stepBeats * 2.4,
      midi,
      vel: vel * accent,
      voice,
      pan: pan + ((i % 2 === 0 ? -1 : 1) * 0.08),
    });
  }
}

// ---------------------------------------------------------------------------
// 11 ORIGINAL CINEMATIC COMPOSITIONS FOR WORLD OF ADVENTURE
// ---------------------------------------------------------------------------

function buildTrackScore(id: SoundtrackTrackId): TrackScore {
  const notes: NoteEvent[] = [];
  const drums: DrumEvent[] = [];

  switch (id) {
    // 1. MAIN MENU — "Horizons Uncharted" (D Dorian / D Minor -> F -> A -> D, 72 BPM, 36 beats = 30s)
    case 'main_menu': {
      const bpm = 72;
      const beats = 36;
      // Progression: Dm9(4) | Bbmaj7(4) | Csus2(4) | Dm(4) | Fmaj7(4) | C/E(4) | Bbmaj7(4) | A7sus4->A(4) | Dm9(4)
      const prog: Array<{ b: number; bass: number; pad: number[]; arp: number[] }> = [
        { b: 0, bass: 38, pad: [50, 57, 60, 64], arp: [50, 57, 62, 64, 69, 64, 62, 57] },
        { b: 4, bass: 34, pad: [46, 53, 57, 62], arp: [46, 53, 58, 62, 65, 62, 58, 53] },
        { b: 8, bass: 36, pad: [48, 55, 60, 62], arp: [48, 55, 60, 62, 67, 62, 60, 55] },
        { b: 12, bass: 38, pad: [50, 57, 62, 65], arp: [50, 57, 62, 65, 69, 65, 62, 57] },
        { b: 16, bass: 41, pad: [53, 57, 60, 64], arp: [53, 60, 64, 69, 72, 69, 64, 60] },
        { b: 20, bass: 40, pad: [52, 55, 60, 67], arp: [52, 55, 60, 64, 67, 64, 60, 55] },
        { b: 24, bass: 34, pad: [46, 53, 58, 62], arp: [46, 53, 58, 62, 69, 65, 62, 58] },
        { b: 28, bass: 33, pad: [45, 52, 57, 61], arp: [45, 52, 57, 62, 61, 57, 52, 45] },
        { b: 32, bass: 38, pad: [50, 57, 60, 64], arp: [50, 57, 62, 64, 69, 64, 62, 57] },
      ];

      for (let i = 0; i < prog.length; i++) {
        const p = prog[i];
        const swell = i >= 4 && i <= 7 ? 0.52 : 0.38;
        notes.push({ time: p.b, dur: 4.3, midi: p.bass, vel: swell * 1.15, voice: 'cello', pan: 0.2 });
        addChord(notes, p.b, 4.3, p.pad, swell, 'strings_pad', 0.48);
        if (i === 0 || i === 4 || i === 6 || i === 8) {
          addChord(notes, p.b, 4.4, [p.pad[1], p.pad[2] + 12], 0.24, 'choir', 0.55);
        }
        addArpeggio(notes, p.b, 4, 0.5, p.arp, i < 4 ? 0.26 : 0.3, 'harp', -0.22);
      }

      // Opening cinematic piano motif (calm & mysterious, beats 0..16)
      addMelody(
        notes,
        0,
        [
          [0.5, 2.5, 69, 0.42],
          [3.0, 1.0, 67, 0.34],
          [4.0, 3.0, 65, 0.44],
          [7.0, 1.0, 62, 0.34],
          [8.0, 2.0, 64, 0.4],
          [10.0, 2.0, 67, 0.44],
          [12.0, 3.5, 69, 0.48],
        ],
        'piano',
        0.15,
      );

      // Gradual orchestral development: soaring violin + French horn theme (beats 16..32)
      addMelody(
        notes,
        16,
        [
          [0.0, 2.5, 72, 0.52],
          [2.5, 1.5, 74, 0.48],
          [4.0, 2.0, 76, 0.55],
          [6.0, 2.0, 72, 0.46],
          [8.0, 2.5, 74, 0.54],
          [10.5, 1.5, 72, 0.48],
          [12.0, 2.0, 69, 0.5],
          [14.0, 2.0, 67, 0.46],
          [16.0, 3.6, 69, 0.42],
        ],
        'strings_lead',
        -0.25,
      );

      // Warm noble horn responses
      addMelody(
        notes,
        16,
        [
          [0.0, 3.8, 53, 0.42],
          [4.0, 3.8, 55, 0.44],
          [8.0, 3.8, 58, 0.48],
          [12.0, 3.8, 57, 0.44],
        ],
        'horn',
        0.28,
      );

      // Delicate flute echo in final resolution bar
      addMelody(
        notes,
        32,
        [
          [0.5, 1.5, 74, 0.32],
          [2.0, 1.8, 76, 0.3],
        ],
        'flute',
        -0.15,
      );

      // Distant cinematic timpani swells during development
      for (const b of [16, 20, 24, 28, 32]) {
        drums.push({ time: b, vel: b === 24 ? 0.42 : 0.3, kind: 'timpani' });
      }
      drums.push({ time: 15.5, vel: 0.22, kind: 'cymbal' });
      drums.push({ time: 23.5, vel: 0.25, kind: 'cymbal' });

      return { bpm, beats, loop: true, reverbWet: 0.46, reverbDecay: 2.7, notes, drums };
    }

    // 2. PEACEFUL EXPLORATION — "Sunlit Meadows of Eld" (G Lydian / G Major, 76 BPM, 32 beats)
    case 'exploration_peaceful': {
      const bpm = 76;
      const beats = 32;
      const chords: Array<{ b: number; bass: number; pad: number[]; arp: number[] }> = [
        { b: 0, bass: 43, pad: [55, 59, 62, 66], arp: [55, 62, 66, 67, 71, 67, 66, 62] },
        { b: 4, bass: 45, pad: [57, 61, 64, 67], arp: [57, 64, 67, 69, 73, 69, 67, 64] },
        { b: 8, bass: 40, pad: [52, 59, 62, 67], arp: [52, 59, 62, 67, 71, 67, 62, 59] },
        { b: 12, bass: 36, pad: [48, 55, 59, 64], arp: [48, 55, 59, 64, 67, 64, 59, 55] },
        { b: 16, bass: 43, pad: [55, 59, 62, 67], arp: [55, 59, 62, 67, 71, 67, 62, 59] },
        { b: 20, bass: 42, pad: [54, 59, 62, 66], arp: [54, 59, 62, 66, 71, 66, 62, 59] },
        { b: 24, bass: 36, pad: [48, 55, 60, 64], arp: [48, 55, 60, 64, 67, 64, 60, 55] },
        { b: 28, bass: 38, pad: [50, 57, 62, 66], arp: [50, 57, 60, 62, 66, 62, 60, 57] },
      ];
      for (const c of chords) {
        notes.push({ time: c.b, dur: 4.2, midi: c.bass, vel: 0.34, voice: 'cello', pan: 0.22 });
        addChord(notes, c.b, 4.3, c.pad, 0.32, 'strings_pad', 0.45);
        addArpeggio(notes, c.b, 4, 0.5, c.arp, 0.26, 'harp', -0.25);
      }
      // Felt piano gentle reflection (beats 0..16)
      addMelody(
        notes,
        0,
        [
          [0.0, 2.0, 71, 0.38],
          [2.0, 2.0, 74, 0.36],
          [4.0, 2.5, 73, 0.38],
          [6.5, 1.5, 71, 0.32],
          [8.0, 3.0, 67, 0.4],
          [11.0, 1.0, 69, 0.32],
          [12.0, 3.6, 71, 0.36],
        ],
        'piano',
        0.18,
      );
      // Woodwind flute pastoral melody (beats 16..32)
      addMelody(
        notes,
        16,
        [
          [0.5, 1.5, 74, 0.4],
          [2.0, 2.0, 79, 0.44],
          [4.0, 2.0, 78, 0.42],
          [6.0, 2.0, 74, 0.38],
          [8.0, 2.5, 76, 0.42],
          [10.5, 1.5, 74, 0.36],
          [12.0, 3.5, 71, 0.4],
        ],
        'flute',
        -0.18,
      );
      return { bpm, beats, loop: true, reverbWet: 0.44, reverbDecay: 2.5, notes, drums };
    }

    // 3. ADVENTURE EXPLORATION — "The Road Beyond the Ridge" (E Minor / G Major heroic, 96 BPM, 32 beats)
    case 'exploration_adventure': {
      const bpm = 96;
      const beats = 32;
      const chords: Array<{ b: number; bass: number; pad: number[]; arp: number[] }> = [
        { b: 0, bass: 40, pad: [52, 59, 64, 67], arp: [52, 59, 64, 67, 71, 67, 64, 59] },
        { b: 4, bass: 36, pad: [48, 55, 60, 64], arp: [48, 55, 60, 64, 67, 64, 60, 55] },
        { b: 8, bass: 43, pad: [55, 59, 62, 67], arp: [55, 62, 67, 71, 74, 71, 67, 62] },
        { b: 12, bass: 38, pad: [50, 57, 62, 66], arp: [50, 57, 62, 66, 69, 66, 62, 57] },
        { b: 16, bass: 40, pad: [52, 59, 64, 67], arp: [52, 59, 64, 67, 71, 67, 64, 59] },
        { b: 20, bass: 36, pad: [48, 55, 60, 64], arp: [48, 55, 60, 64, 71, 67, 64, 60] },
        { b: 24, bass: 45, pad: [57, 60, 64, 69], arp: [57, 60, 64, 69, 72, 69, 64, 60] },
        { b: 28, bass: 38, pad: [50, 57, 62, 66], arp: [50, 57, 62, 66, 69, 66, 62, 57] },
      ];
      for (let i = 0; i < chords.length; i++) {
        const c = chords[i];
        notes.push({ time: c.b, dur: 4.1, midi: c.bass, vel: 0.44, voice: 'cello', pan: 0.25 });
        addChord(notes, c.b, 4.1, c.pad, 0.36, 'strings_pad', 0.45);
        addArpeggio(notes, c.b, 4, 0.5, c.arp, 0.28, 'harp', -0.2);
      }
      // Heroic strings + horn call-and-response
      addMelody(
        notes,
        0,
        [
          [0, 1.5, 71, 0.48],
          [1.5, 0.5, 74, 0.42],
          [2, 2.0, 76, 0.52],
          [4, 1.5, 74, 0.46],
          [5.5, 0.5, 72, 0.42],
          [6, 2.0, 71, 0.46],
          [8, 1.5, 74, 0.52],
          [9.5, 0.5, 76, 0.48],
          [10, 2.0, 79, 0.56],
          [12, 3.5, 78, 0.5],
          [16, 1.5, 76, 0.52],
          [17.5, 0.5, 74, 0.46],
          [18, 2.0, 71, 0.48],
          [20, 2.0, 72, 0.5],
          [22, 2.0, 74, 0.52],
          [24, 2.5, 76, 0.54],
          [26.5, 1.5, 74, 0.48],
          [28, 3.5, 74, 0.46],
        ],
        'strings_lead',
        -0.2,
      );
      addMelody(
        notes,
        8,
        [
          [0, 3.6, 55, 0.42],
          [4, 3.6, 57, 0.44],
          [8, 3.6, 59, 0.46],
          [12, 3.6, 60, 0.48],
          [16, 3.6, 57, 0.44],
          [20, 3.6, 54, 0.42],
        ],
        'horn',
        0.28,
      );
      // Soft driving adventure percussion
      for (let b = 0; b < beats; b += 4) {
        drums.push({ time: b, vel: 0.36, kind: 'frame' });
        drums.push({ time: b + 1.5, vel: 0.22, kind: 'frame' });
        drums.push({ time: b + 2.5, vel: 0.28, kind: 'frame' });
        for (let s = 0; s < 4; s += 0.5) {
          drums.push({ time: b + s, vel: s % 1 === 0 ? 0.14 : 0.08, kind: 'shaker' });
        }
      }
      return { bpm, beats, loop: true, reverbWet: 0.4, reverbDecay: 2.3, notes, drums };
    }

    // 4. MOUNTAIN / VALLEY — "Winds of the High Crags" (C Dorian, 66 BPM, 32 beats)
    case 'mountain_valley': {
      const bpm = 66;
      const beats = 32;
      const prog = [
        { b: 0, bass: 36, pad: [48, 55, 60, 62] },
        { b: 8, bass: 34, pad: [46, 53, 58, 62] },
        { b: 16, bass: 41, pad: [53, 57, 60, 65] },
        { b: 24, bass: 31, pad: [43, 50, 55, 58] },
      ];
      for (const p of prog) {
        notes.push({ time: p.b, dur: 8.2, midi: p.bass, vel: 0.4, voice: 'cello', pan: 0.15 });
        addChord(notes, p.b, 8.2, p.pad, 0.34, 'strings_pad', 0.55);
        addChord(notes, p.b, 8.2, [p.pad[1], p.pad[2] + 12], 0.22, 'choir', 0.6);
      }
      // Echoing mountain flute calls
      addMelody(
        notes,
        2,
        [
          [0, 3.0, 74, 0.38],
          [3, 1.5, 72, 0.32],
          [4.5, 2.5, 67, 0.36],
          [10, 2.5, 70, 0.38],
          [12.5, 1.5, 72, 0.34],
          [14, 3.5, 74, 0.4],
          [22, 2.5, 77, 0.38],
          [24.5, 1.5, 74, 0.34],
          [26, 3.5, 72, 0.36],
        ],
        'flute',
        -0.3,
      );
      // Spacious distant French horn fifths & crystal piano droplets
      addMelody(
        notes,
        0,
        [
          [0, 6.0, 55, 0.36],
          [8, 6.0, 53, 0.34],
          [16, 6.0, 57, 0.38],
          [24, 6.0, 50, 0.34],
        ],
        'horn',
        0.35,
      );
      addMelody(
        notes,
        0,
        [
          [1, 3, 79, 0.26],
          [6, 3, 74, 0.24],
          [11, 3, 77, 0.26],
          [19, 3, 81, 0.28],
          [27, 4, 74, 0.24],
        ],
        'piano',
        0.2,
      );
      return { bpm, beats, loop: true, reverbWet: 0.56, reverbDecay: 3.1, notes, drums };
    }

    // 5. DESERT — "Sands of the Sunstone" (D Hijaz / Phrygian Dominant, 78 BPM, 32 beats)
    case 'desert_ancient': {
      const bpm = 78;
      const beats = 32;
      // Scale degrees in D Hijaz: D(62), Eb(63), F#(66), G(67), A(69), Bb(70), C(72), D(74)
      const drones = [
        { b: 0, bass: 38, pad: [50, 57, 62] },
        { b: 8, bass: 39, pad: [51, 58, 63] },
        { b: 16, bass: 38, pad: [50, 57, 66] },
        { b: 24, bass: 36, pad: [48, 55, 62] },
      ];
      for (const d of drones) {
        notes.push({ time: d.b, dur: 8.2, midi: d.bass, vel: 0.38, voice: 'cello', pan: 0.15 });
        addChord(notes, d.b, 8.2, d.pad, 0.3, 'strings_pad', 0.48);
      }
      // Plucked oud rhythmic ostinato
      const oudBars = [
        [62, 69, 66, 63, 62, 69, 67, 66],
        [63, 70, 67, 63, 62, 66, 69, 66],
        [62, 69, 70, 69, 66, 67, 66, 63],
        [60, 67, 63, 62, 60, 62, 66, 69],
      ];
      for (let bar = 0; bar < 4; bar++) {
        addArpeggio(notes, bar * 8, 8, 0.5, oudBars[bar], 0.32, 'oud', -0.22);
      }
      // Ancient breathy woodwind melody
      addMelody(
        notes,
        2,
        [
          [0, 2.0, 74, 0.4],
          [2, 1.0, 72, 0.35],
          [3, 1.0, 70, 0.36],
          [4, 2.5, 69, 0.42],
          [8, 2.0, 70, 0.38],
          [10, 1.5, 69, 0.36],
          [11.5, 0.5, 66, 0.34],
          [12, 3.0, 63, 0.38],
          [16, 2.0, 66, 0.4],
          [18, 1.5, 69, 0.42],
          [19.5, 0.5, 70, 0.38],
          [20, 3.0, 74, 0.44],
          [24, 2.0, 72, 0.38],
          [26, 3.5, 69, 0.36],
        ],
        'flute',
        0.24,
      );
      // Warm hand frame-drum desert pulse
      for (let b = 0; b < beats; b += 4) {
        drums.push({ time: b, vel: 0.34, kind: 'frame' });
        drums.push({ time: b + 1.5, vel: 0.2, kind: 'frame' });
        drums.push({ time: b + 2.0, vel: 0.16, kind: 'shaker' });
        drums.push({ time: b + 3.0, vel: 0.24, kind: 'frame' });
        drums.push({ time: b + 3.5, vel: 0.12, kind: 'shaker' });
      }
      return { bpm, beats, loop: true, reverbWet: 0.45, reverbDecay: 2.4, notes, drums };
    }

    // 6. VILLAGE — "Lanterns at Oakhollow" (F Major / D Minor warm folk, 84 BPM, 32 beats)
    case 'village_hearth': {
      const bpm = 84;
      const beats = 32;
      const chords = [
        { b: 0, bass: 41, pad: [53, 57, 60], arp: [53, 57, 60, 65, 60, 57, 60, 65] },
        { b: 4, bass: 36, pad: [48, 55, 60], arp: [48, 55, 60, 64, 60, 55, 60, 64] },
        { b: 8, bass: 38, pad: [50, 57, 62], arp: [50, 57, 62, 65, 62, 57, 62, 65] },
        { b: 12, bass: 34, pad: [46, 53, 58], arp: [46, 53, 58, 62, 58, 53, 58, 62] },
        { b: 16, bass: 41, pad: [53, 57, 60], arp: [53, 57, 60, 65, 69, 65, 60, 57] },
        { b: 20, bass: 34, pad: [46, 53, 58], arp: [46, 53, 58, 62, 65, 62, 58, 53] },
        { b: 24, bass: 43, pad: [55, 58, 62], arp: [55, 58, 62, 67, 62, 58, 62, 67] },
        { b: 28, bass: 36, pad: [48, 55, 60], arp: [48, 55, 58, 60, 64, 60, 58, 55] },
      ];
      for (const c of chords) {
        notes.push({ time: c.b, dur: 4.1, midi: c.bass, vel: 0.34, voice: 'cello', pan: 0.2 });
        addChord(notes, c.b, 4.1, c.pad, 0.25, 'strings_pad', 0.38);
        addArpeggio(notes, c.b, 4, 0.5, c.arp, 0.3, 'harp', -0.24);
      }
      // Warm friendly wooden flute + soft piano duet
      addMelody(
        notes,
        0,
        [
          [0, 1.5, 69, 0.4],
          [1.5, 0.5, 72, 0.36],
          [2, 2.0, 74, 0.42],
          [4, 2.0, 72, 0.38],
          [6, 2.0, 67, 0.36],
          [8, 1.5, 69, 0.4],
          [9.5, 0.5, 70, 0.36],
          [10, 2.0, 69, 0.38],
          [12, 3.5, 65, 0.4],
        ],
        'flute',
        0.18,
      );
      addMelody(
        notes,
        16,
        [
          [0, 2.0, 72, 0.38],
          [2, 2.0, 77, 0.4],
          [4, 2.0, 74, 0.38],
          [6, 2.0, 70, 0.36],
          [8, 1.5, 72, 0.38],
          [9.5, 0.5, 74, 0.36],
          [10, 2.0, 72, 0.38],
          [12, 3.5, 69, 0.38],
        ],
        'piano',
        -0.12,
      );
      return { bpm, beats, loop: true, reverbWet: 0.38, reverbDecay: 2.0, notes, drums };
    }

    // 7. ANCIENT RUINS — "Echoes of Forgotten Stone" (B Phrygian / B Minor, 62 BPM, 32 beats)
    case 'ancient_ruins': {
      const bpm = 62;
      const beats = 32;
      const prog = [
        { b: 0, bass: 35, pad: [47, 54, 59, 62] },
        { b: 8, bass: 36, pad: [48, 55, 60, 64] },
        { b: 16, bass: 33, pad: [45, 52, 57, 60] },
        { b: 24, bass: 35, pad: [47, 54, 58, 62] },
      ];
      for (const p of prog) {
        notes.push({ time: p.b, dur: 8.3, midi: p.bass, vel: 0.42, voice: 'cello', pan: 0.1 });
        addChord(notes, p.b, 8.3, p.pad, 0.34, 'strings_pad', 0.55);
        addChord(notes, p.b, 8.3, [p.pad[1], p.pad[3]], 0.28, 'choir', 0.62);
      }
      // Mysterious echoing ancient chimes & dark felt piano
      addMelody(
        notes,
        0,
        [
          [1, 5.0, 71, 0.34],
          [7, 4.0, 72, 0.32],
          [13, 5.0, 67, 0.34],
          [21, 5.0, 69, 0.34],
          [27, 4.5, 66, 0.32],
        ],
        'chime',
        -0.32,
      );
      addMelody(
        notes,
        4,
        [
          [0, 3.0, 62, 0.3],
          [3, 3.0, 60, 0.28],
          [12, 3.0, 64, 0.3],
          [15, 3.0, 62, 0.28],
          [22, 4.0, 59, 0.32],
        ],
        'piano',
        0.25,
      );
      drums.push({ time: 0, vel: 0.28, kind: 'timpani' });
      drums.push({ time: 16, vel: 0.26, kind: 'timpani' });
      return { bpm, beats, loop: true, reverbWet: 0.6, reverbDecay: 3.3, notes, drums };
    }

    // 8. NIGHT — "Under Silver Constellations" (A Minor / Fmaj7 nocturne, 60 BPM, 32 beats)
    case 'night_mystic': {
      const bpm = 60;
      const beats = 32;
      const prog = [
        { b: 0, bass: 33, pad: [45, 52, 57, 60] },
        { b: 8, bass: 41, pad: [53, 57, 60, 64] },
        { b: 16, bass: 38, pad: [50, 57, 60, 64] },
        { b: 24, bass: 40, pad: [52, 55, 59, 64] },
      ];
      for (const p of prog) {
        notes.push({ time: p.b, dur: 8.3, midi: p.bass, vel: 0.3, voice: 'cello', pan: 0.12 });
        addChord(notes, p.b, 8.3, p.pad, 0.26, 'strings_pad', 0.5);
        addChord(notes, p.b, 8.3, [p.pad[2], p.pad[3] + 12], 0.16, 'choir', 0.55);
      }
      // Delicate night felt piano nocturne
      addMelody(
        notes,
        0,
        [
          [0.5, 3.0, 72, 0.34],
          [3.5, 2.5, 71, 0.3],
          [6.0, 2.0, 69, 0.32],
          [8.5, 3.5, 76, 0.36],
          [12.0, 3.5, 72, 0.32],
          [16.5, 3.0, 74, 0.34],
          [19.5, 2.5, 72, 0.3],
          [22.0, 2.0, 69, 0.32],
          [24.5, 3.5, 71, 0.34],
          [28.0, 3.5, 67, 0.3],
        ],
        'piano',
        0.1,
      );
      // Shimmering starlight harp droplets
      addMelody(
        notes,
        0,
        [
          [2, 3, 81, 0.2],
          [10, 3, 84, 0.22],
          [18, 3, 81, 0.2],
          [26, 3, 79, 0.2],
        ],
        'chime',
        -0.3,
      );
      return { bpm, beats, loop: true, reverbWet: 0.55, reverbDecay: 3.1, notes, drums };
    }

    // 9. COMBAT — "Steel and Shadow" (D Minor intense orchestral, 124 BPM, 32 beats)
    case 'combat_skirmish': {
      const bpm = 124;
      const beats = 32;
      const roots = [38, 38, 34, 36, 38, 38, 34, 33]; // Dm | Dm | Bb | C | Dm | Dm | Bb | A
      for (let bar = 0; bar < 8; bar++) {
        const b = bar * 4;
        const r = roots[bar];
        // Urgent cello eighth-note ostinato
        for (let s = 0; s < 8; s++) {
          const accent = s % 2 === 0 ? 0.46 : 0.34;
          notes.push({
            time: b + s * 0.5,
            dur: 0.45,
            midi: r + (s === 6 ? 7 : s === 7 ? 5 : 0),
            vel: accent,
            voice: 'cello',
            pan: 0.22,
          });
        }
        // Brass power fifths
        addChord(notes, b, 3.7, [r + 12, r + 19], 0.46, 'horn', 0.32);
        // Driving combat percussion
        drums.push({ time: b, vel: 0.62, kind: 'taiko' });
        drums.push({ time: b + 1.5, vel: 0.44, kind: 'taiko' });
        drums.push({ time: b + 2.0, vel: 0.5, kind: 'frame' });
        drums.push({ time: b + 3.0, vel: 0.54, kind: 'taiko' });
        drums.push({ time: b + 3.5, vel: 0.38, kind: 'frame' });
      }
      // Intense soaring violin combat lead
      addMelody(
        notes,
        0,
        [
          [0, 1.5, 69, 0.52],
          [1.5, 0.5, 70, 0.48],
          [2, 2.0, 74, 0.56],
          [4, 1.5, 72, 0.52],
          [5.5, 0.5, 70, 0.48],
          [6, 2.0, 69, 0.52],
          [8, 2.0, 70, 0.54],
          [10, 2.0, 74, 0.58],
          [12, 2.0, 72, 0.54],
          [14, 2.0, 76, 0.56],
          [16, 1.5, 77, 0.6],
          [17.5, 0.5, 76, 0.54],
          [18, 2.0, 74, 0.58],
          [20, 2.0, 72, 0.54],
          [22, 2.0, 70, 0.52],
          [24, 2.0, 74, 0.58],
          [26, 2.0, 70, 0.54],
          [28, 3.5, 69, 0.56],
        ],
        'strings_lead',
        -0.25,
      );
      drums.push({ time: 15.5, vel: 0.32, kind: 'cymbal' });
      drums.push({ time: 31.5, vel: 0.34, kind: 'cymbal' });
      return { bpm, beats, loop: true, reverbWet: 0.36, reverbDecay: 2.1, notes, drums };
    }

    // 10. BOSS / MAJOR BATTLE — "Colossus of the Realm" (C Minor epic, 134 BPM, 48 beats)
    case 'boss_epic': {
      const bpm = 134;
      const beats = 48;
      // 12-bar dramatic progression: Cm | Cm | Ab | Bb | Cm | Eb | Fm | G | Ab | Bb | Fm | G
      const prog = [36, 36, 32, 34, 36, 39, 41, 43, 32, 34, 41, 43];
      for (let bar = 0; bar < 12; bar++) {
        const b = bar * 4;
        const r = prog[bar];
        const climax = bar >= 8;
        // Relentless low string ostinato
        for (let s = 0; s < 8; s++) {
          notes.push({
            time: b + s * 0.5,
            dur: 0.42,
            midi: r + (s % 4 === 3 ? 7 : 0),
            vel: s % 2 === 0 ? 0.52 : 0.38,
            voice: 'cello',
            pan: 0.2,
          });
        }
        // Massive brass & epic choir
        addChord(notes, b, 3.8, [r + 12, r + 19, r + 24], climax ? 0.58 : 0.48, 'horn', 0.4);
        addChord(notes, b, 3.9, [r + 19, r + 24, r + 27], climax ? 0.42 : 0.3, 'choir', 0.6);
        // Thunderous war percussion
        drums.push({ time: b, vel: 0.72, kind: 'taiko' });
        drums.push({ time: b + 1.0, vel: 0.45, kind: 'timpani' });
        drums.push({ time: b + 1.5, vel: 0.52, kind: 'taiko' });
        drums.push({ time: b + 2.0, vel: 0.62, kind: 'taiko' });
        drums.push({ time: b + 2.5, vel: 0.44, kind: 'frame' });
        drums.push({ time: b + 3.0, vel: 0.66, kind: 'taiko' });
        drums.push({ time: b + 3.5, vel: 0.5, kind: 'timpani' });
        if (bar % 4 === 0) {
          drums.push({ time: b, vel: 0.38, kind: 'cymbal' });
        }
      }
      // Dramatic soaring boss melody
      addMelody(
        notes,
        0,
        [
          [0, 3.0, 72, 0.6],
          [3, 1.0, 74, 0.54],
          [4, 2.0, 75, 0.62],
          [6, 2.0, 74, 0.56],
          [8, 3.0, 72, 0.6],
          [11, 1.0, 70, 0.54],
          [12, 3.5, 74, 0.6],
          [16, 2.0, 75, 0.62],
          [18, 2.0, 79, 0.66],
          [20, 2.0, 77, 0.62],
          [22, 2.0, 75, 0.58],
          [24, 3.0, 77, 0.64],
          [27, 1.0, 75, 0.58],
          [28, 3.5, 74, 0.62],
          [32, 2.0, 79, 0.68],
          [34, 2.0, 80, 0.68],
          [36, 2.0, 82, 0.7],
          [38, 2.0, 79, 0.64],
          [40, 3.0, 77, 0.66],
          [43, 1.0, 75, 0.6],
          [44, 3.6, 74, 0.64],
        ],
        'strings_lead',
        -0.28,
      );
      return { bpm, beats, loop: true, reverbWet: 0.42, reverbDecay: 2.5, notes, drums };
    }

    // 11. STORY / DISCOVERY / CHAPTER EVENT — "Turning of the Age" (Eb Major emotional swell, 74 BPM, 16 beats = 13s one-shot)
    case 'story_event': {
      const bpm = 74;
      const beats = 16;
      const prog = [
        { b: 0, bass: 36, pad: [48, 55, 60, 63] }, // Cm
        { b: 4, bass: 32, pad: [44, 51, 56, 60] }, // Ab
        { b: 8, bass: 39, pad: [51, 58, 63, 67] }, // Eb
        { b: 12, bass: 34, pad: [46, 53, 58, 62] }, // Bb -> resolves warmly
      ];
      for (const p of prog) {
        notes.push({ time: p.b, dur: 4.2, midi: p.bass, vel: 0.44, voice: 'cello', pan: 0.15 });
        addChord(notes, p.b, 4.3, p.pad, 0.42, 'strings_pad', 0.5);
        addChord(notes, p.b, 4.3, [p.pad[1], p.pad[2] + 12], 0.28, 'choir', 0.55);
      }
      addMelody(
        notes,
        0,
        [
          [0, 2.0, 72, 0.48],
          [2, 2.0, 74, 0.5],
          [4, 2.5, 75, 0.55],
          [6.5, 1.5, 77, 0.52],
          [8, 3.5, 79, 0.58],
          [12, 3.5, 74, 0.48],
        ],
        'strings_lead',
        -0.2,
      );
      addMelody(
        notes,
        0,
        [
          [0, 3.8, 55, 0.44],
          [4, 3.8, 56, 0.46],
          [8, 3.8, 58, 0.5],
          [12, 3.6, 58, 0.42],
        ],
        'horn',
        0.25,
      );
      addMelody(
        notes,
        0,
        [
          [0.5, 2.5, 79, 0.36],
          [8.0, 4.0, 82, 0.38],
        ],
        'chime',
        0.15,
      );
      drums.push({ time: 0, vel: 0.32, kind: 'timpani' });
      drums.push({ time: 8, vel: 0.42, kind: 'timpani' });
      drums.push({ time: 7.5, vel: 0.28, kind: 'cymbal' });
      return { bpm, beats, loop: false, reverbWet: 0.5, reverbDecay: 2.8, notes, drums };
    }
  }
}

// ---------------------------------------------------------------------------
// INSTRUMENT VOICE RENDERERS
// ---------------------------------------------------------------------------

function scheduleVoiceNote(
  ctx: OfflineAudioContext,
  dryBus: AudioNode,
  wetBus: AudioNode,
  noiseBuf: AudioBuffer,
  startTime: number,
  durSec: number,
  midi: number,
  vel: number,
  voice: VoiceType,
  pan: number,
): void {
  const freq = midiToFreq(midi);
  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-0.9, Math.min(0.9, pan));

  const outGain = ctx.createGain();
  outGain.connect(panner);
  panner.connect(dryBus);
  panner.connect(wetBus);

  const t0 = Math.max(0, startTime);
  const tEnd = t0 + durSec;

  if (voice === 'strings_pad' || voice === 'strings_lead' || voice === 'cello') {
    const isLead = voice === 'strings_lead';
    const isCello = voice === 'cello';
    const detunes = isLead ? [-7, 0, 7] : isCello ? [-5, 5] : [-9, 0, 9];
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(isCello ? 780 : isLead ? 2400 : 1450, t0);
    filter.Q.value = isLead ? 1.1 : 0.7;
    filter.connect(outGain);

    const attack = isLead ? Math.min(0.24, durSec * 0.3) : isCello ? Math.min(0.18, durSec * 0.25) : Math.min(0.55, durSec * 0.35);
    const release = isLead ? 0.35 : 0.55;
    const peak = vel * (isLead ? 0.14 : isCello ? 0.17 : 0.085);

    outGain.gain.setValueAtTime(0.0001, t0);
    outGain.gain.linearRampToValueAtTime(peak, t0 + attack);
    outGain.gain.setValueAtTime(peak * 0.92, Math.max(t0 + attack + 0.01, tEnd - 0.08));
    outGain.gain.exponentialRampToValueAtTime(0.0001, tEnd + release);

    // Subtle expressive vibrato for lead strings
    let vibOsc: OscillatorNode | null = null;
    let vibGain: GainNode | null = null;
    if (isLead && durSec > 0.45) {
      vibOsc = ctx.createOscillator();
      vibGain = ctx.createGain();
      vibOsc.frequency.value = 5.1;
      vibGain.gain.setValueAtTime(0, t0);
      vibGain.gain.linearRampToValueAtTime(freq * 0.0085, t0 + Math.min(0.45, durSec * 0.5));
      vibOsc.connect(vibGain);
      vibOsc.start(t0);
      vibOsc.stop(tEnd + release + 0.05);
    }

    for (let i = 0; i < detunes.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = i === 1 && !isCello ? 'triangle' : 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = detunes[i];
      if (vibGain) vibGain.connect(osc.frequency);
      osc.connect(filter);
      osc.start(t0);
      osc.stop(tEnd + release + 0.05);
    }
    return;
  }

  if (voice === 'horn') {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(340, t0);
    filter.frequency.exponentialRampToValueAtTime(1450, t0 + Math.min(0.32, durSec * 0.35));
    filter.frequency.exponentialRampToValueAtTime(620, tEnd + 0.35);
    filter.connect(outGain);

    const attack = Math.min(0.22, durSec * 0.25);
    const peak = vel * 0.14;
    outGain.gain.setValueAtTime(0.0001, t0);
    outGain.gain.linearRampToValueAtTime(peak, t0 + attack);
    outGain.gain.setValueAtTime(peak * 0.88, Math.max(t0 + attack + 0.01, tEnd - 0.08));
    outGain.gain.exponentialRampToValueAtTime(0.0001, tEnd + 0.4);

    for (const det of [-4, 4]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = det;
      osc.connect(filter);
      osc.start(t0);
      osc.stop(tEnd + 0.45);
    }
    return;
  }

  if (voice === 'choir') {
    // Warm formant-filtered "ooh/aah" ethereal choir pad
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 540;
    f1.Q.value = 2.4;

    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1120;
    f2.Q.value = 3.2;

    f1.connect(outGain);
    f2.connect(outGain);

    const attack = Math.min(0.85, durSec * 0.4);
    const peak = vel * 0.13;
    outGain.gain.setValueAtTime(0.0001, t0);
    outGain.gain.linearRampToValueAtTime(peak, t0 + attack);
    outGain.gain.setValueAtTime(peak * 0.9, Math.max(t0 + attack + 0.01, tEnd - 0.1));
    outGain.gain.exponentialRampToValueAtTime(0.0001, tEnd + 0.7);

    for (const det of [-8, 8]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = det;
      osc.connect(f1);
      osc.connect(f2);
      osc.start(t0);
      osc.stop(tEnd + 0.75);
    }
    return;
  }

  if (voice === 'flute') {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2800;
    filter.connect(outGain);

    const attack = Math.min(0.14, durSec * 0.25);
    const peak = vel * 0.15;
    outGain.gain.setValueAtTime(0.0001, t0);
    outGain.gain.linearRampToValueAtTime(peak, t0 + attack);
    outGain.gain.setValueAtTime(peak * 0.86, Math.max(t0 + attack + 0.01, tEnd - 0.06));
    outGain.gain.exponentialRampToValueAtTime(0.0001, tEnd + 0.24);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;

    const vib = ctx.createOscillator();
    const vibGain = ctx.createGain();
    vib.frequency.value = 5.4;
    vibGain.gain.setValueAtTime(0, t0);
    vibGain.gain.linearRampToValueAtTime(freq * 0.011, t0 + Math.min(0.35, durSec * 0.5));
    vib.connect(vibGain);
    vibGain.connect(osc.frequency);
    osc.connect(filter);
    osc.start(t0);
    vib.start(t0);
    osc.stop(tEnd + 0.28);
    vib.stop(tEnd + 0.28);

    // Subtle breathy air transient
    const breath = ctx.createBufferSource();
    breath.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(3400, freq * 2.0);
    bp.Q.value = 3.0;
    const bGain = ctx.createGain();
    bGain.gain.setValueAtTime(0.0001, t0);
    bGain.gain.linearRampToValueAtTime(peak * 0.22, t0 + 0.06);
    bGain.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.min(0.28, durSec));
    breath.connect(bp);
    bp.connect(bGain);
    bGain.connect(outGain);
    breath.start(t0);
    breath.stop(t0 + Math.min(0.32, durSec + 0.05));
    return;
  }

  if (voice === 'piano' || voice === 'harp' || voice === 'oud' || voice === 'chime') {
    const isPiano = voice === 'piano';
    const isOud = voice === 'oud';
    const isChime = voice === 'chime';

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const startCut = isChime ? 5200 : isOud ? 2600 : isPiano ? 2100 : 3000;
    const endCut = isChime ? 1800 : isOud ? 680 : isPiano ? 480 : 750;
    filter.frequency.setValueAtTime(startCut, t0);
    filter.frequency.exponentialRampToValueAtTime(endCut, t0 + Math.max(0.4, durSec * 0.85));
    filter.connect(outGain);

    const decay = isChime ? Math.max(2.2, durSec) : isPiano ? Math.max(1.4, durSec) : Math.max(0.85, durSec * 0.9);
    const peak = vel * (isChime ? 0.1 : isPiano ? 0.16 : 0.14);
    outGain.gain.setValueAtTime(0.0001, t0);
    outGain.gain.linearRampToValueAtTime(peak, t0 + 0.012);
    outGain.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);

    const harmonics: Array<[number, number, OscillatorType]> = isChime
      ? [
          [1, 1.0, 'sine'],
          [2.756, 0.35, 'sine'],
          [5.4, 0.14, 'sine'],
        ]
      : isOud
        ? [
            [1, 1.0, 'triangle'],
            [2, 0.45, 'sawtooth'],
          ]
        : [
            [1, 1.0, 'triangle'],
            [2, 0.36, 'sine'],
            [3, 0.14, 'sine'],
          ];

    for (const [ratio, amp, type] of harmonics) {
      const osc = ctx.createOscillator();
      const hg = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq * ratio;
      hg.gain.value = amp;
      osc.connect(hg);
      hg.connect(filter);
      osc.start(t0);
      osc.stop(t0 + decay + 0.05);
    }
  }
}

function scheduleDrumHit(
  ctx: OfflineAudioContext,
  dryBus: AudioNode,
  wetBus: AudioNode,
  noiseBuf: AudioBuffer,
  startTime: number,
  vel: number,
  kind: DrumEvent['kind'],
): void {
  const t0 = Math.max(0, startTime);

  if (kind === 'taiko' || kind === 'timpani' || kind === 'frame') {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const isTaiko = kind === 'taiko';
    const isTimpani = kind === 'timpani';
    const fStart = isTaiko ? 105 : isTimpani ? 118 : 165;
    const fEnd = isTaiko ? 42 : isTimpani ? 58 : 78;
    const decay = isTimpani ? 0.85 : isTaiko ? 0.48 : 0.24;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(fStart, t0);
    osc.frequency.exponentialRampToValueAtTime(fEnd, t0 + (isTaiko ? 0.12 : 0.09));

    const peak = vel * (isTaiko ? 0.38 : isTimpani ? 0.32 : 0.24);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);

    osc.connect(g);
    g.connect(dryBus);
    g.connect(wetBus);
    osc.start(t0);
    osc.stop(t0 + decay + 0.04);

    // Woody beater snap
    const snap = ctx.createBufferSource();
    snap.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = isTaiko ? 420 : 880;
    bp.Q.value = 1.4;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(peak * 0.35, t0);
    sg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.055);
    snap.connect(bp);
    bp.connect(sg);
    sg.connect(dryBus);
    snap.start(t0);
    snap.stop(t0 + 0.065);
    return;
  }

  if (kind === 'shaker' || kind === 'cymbal') {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = kind === 'cymbal' ? 3800 : 5200;
    const g = ctx.createGain();
    const dur = kind === 'cymbal' ? 1.4 : 0.07;
    const peak = vel * (kind === 'cymbal' ? 0.11 : 0.07);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + (kind === 'cymbal' ? 0.22 : 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(hp);
    hp.connect(g);
    g.connect(dryBus);
    g.connect(wetBus);
    src.start(t0);
    src.stop(t0 + dur + 0.04);
  }
}

/**
 * Renders a complete original orchestral soundtrack buffer asynchronously
 * using OfflineAudioContext with seamless loop tail wrap-around.
 */
export async function renderSoundtrackTrack(
  id: SoundtrackTrackId,
  lowPowerMode = false,
): Promise<RenderedTrack | null> {
  if (typeof window === 'undefined') return null;
  const OfflineCtx =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!OfflineCtx) return null;

  const score = buildTrackScore(id);
  const secPerBeat = 60 / score.bpm;
  const loopDurationSec = score.beats * secPerBeat;
  const tailSec = score.loop ? Math.min(3.0, score.reverbDecay + 0.4) : 2.6;
  const totalRenderSec = loopDurationSec + tailSec;

  // Optimized sample rate: 22050 Hz in low-power mobile mode, 32000 Hz standard
  const sampleRate = lowPowerMode ? 22050 : 32000;
  const totalFrames = Math.ceil(totalRenderSec * sampleRate);
  const offline = new OfflineCtx(2, totalFrames, sampleRate);

  const dryBus = offline.createGain();
  dryBus.gain.value = 0.88;

  const wetSend = offline.createGain();
  wetSend.gain.value = score.reverbWet;

  const convolver = offline.createConvolver();
  convolver.buffer = createConcertHallIR(offline, score.reverbDecay, id.length * 1337 + 42);

  const masterWarmth = offline.createBiquadFilter();
  masterWarmth.type = 'lowshelf';
  masterWarmth.frequency.value = 180;
  masterWarmth.gain.value = 2.0;

  dryBus.connect(masterWarmth);
  wetSend.connect(convolver);
  convolver.connect(masterWarmth);
  masterWarmth.connect(offline.destination);

  const noiseBuf = createNoiseBuffer(offline, 1.6);

  for (let i = 0; i < score.notes.length; i++) {
    const n = score.notes[i];
    scheduleVoiceNote(
      offline,
      dryBus,
      wetSend,
      noiseBuf,
      n.time * secPerBeat,
      n.dur * secPerBeat,
      n.midi,
      n.vel,
      n.voice,
      n.pan ?? 0,
    );
  }

  for (let i = 0; i < score.drums.length; i++) {
    const d = score.drums[i];
    scheduleDrumHit(
      offline,
      dryBus,
      wetSend,
      noiseBuf,
      d.time * secPerBeat,
      d.vel,
      d.kind,
    );
  }

  const rendered = await offline.startRendering();

  if (!score.loop) {
    // Normalize gently with soft limiter and return full one-shot buffer
    applySoftLimiter(rendered);
    return {
      id,
      buffer: rendered,
      loop: false,
      durationSec: rendered.duration,
    };
  }

  // Seamless loop wrap: fold the reverb tail past loopDurationSec back into [0..tailSec]
  const loopFrames = Math.floor(loopDurationSec * sampleRate);
  const loopBuf = offline.createBuffer(2, loopFrames, sampleRate);
  const tailFrames = Math.min(loopFrames, rendered.length - loopFrames);

  for (let ch = 0; ch < 2; ch++) {
    const src = rendered.getChannelData(ch);
    const dst = loopBuf.getChannelData(ch);
    dst.set(src.subarray(0, loopFrames));
    for (let i = 0; i < tailFrames; i++) {
      dst[i] += src[loopFrames + i];
    }
  }

  applySoftLimiter(loopBuf);

  return {
    id,
    buffer: loopBuf,
    loop: true,
    durationSec: loopBuf.duration,
  };
}

function applySoftLimiter(buffer: AudioBuffer): void {
  let peak = 0.001;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  const targetPeak = 0.82;
  const gain = Math.min(1.6, targetPeak / peak);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const x = d[i] * gain;
      // Warm soft-clip saturation prevents any digital clipping
      d[i] = Math.tanh(x * 1.05) * 0.92;
    }
  }
}
