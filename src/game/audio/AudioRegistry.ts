/**
 * Declarative Audio Asset / Cue Registry, Priority Tiers, Spatial Attenuation,
 * Anti-Repeat Variant Selection, and Missing-Cue Telemetry for World of Adventure.
 *
 * Pure TypeScript (zero DOM/WebAudio hard dependency) so it works identically in
 * browser, Android Capacitor WebView, and automated Node verification tests.
 */

export type AudioPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export type AudioBus = 'effects' | 'ambient' | 'ui' | 'voice';

export type AudioCategoryBus = 'master' | 'music' | 'sfx' | 'ambient' | 'ui';

export type AudioCategory =
  | 'sword'
  | 'tool'
  | 'breaking'
  | 'pickup'
  | 'throwing'
  | 'bow'
  | 'combat'
  | 'building'
  | 'footstep'
  | 'environment'
  | 'ui';

export type FootstepSurface =
  | 'grass'
  | 'dirt'
  | 'stone'
  | 'sand'
  | 'wood'
  | 'snow'
  | 'water';

export type ImpactMaterial = 'wood' | 'stone' | 'armor' | 'flesh' | 'water' | 'dirt' | 'glass' | 'plant';

export type BreakMaterial = 'wood' | 'stone' | 'glass' | 'plant' | 'crate' | 'resource_node';

export type PickupCategory = 'resource' | 'weapon' | 'food' | 'quest' | 'coins';

export type AudioCueId =
  // 1. Sword & Melee
  | 'sword_swing'
  | 'sword_swing_fast'
  | 'sword_swing_heavy'
  | 'spear_thrust'
  | 'knife_slash'
  | 'unarmed_swing'
  | 'sword_hit'
  | 'sword_hit_armor'
  | 'sword_hit_wood'
  | 'sword_hit_stone'
  | 'sword_block'
  | 'sword_impact'
  // 2. Tools
  | 'tool_axe_swing'
  | 'tool_axe_tree'
  | 'tool_pickaxe_stone'
  | 'tool_pickaxe_iron'
  | 'tool_pickaxe_gold'
  | 'tool_shovel_dig'
  | 'tool_mining'
  | 'tool_harvesting'
  | 'tool_crafting'
  | 'tool_break'
  | 'smelting'
  // 3. Breaking
  | 'break_wood'
  | 'break_stone'
  | 'break_glass'
  | 'break_plant'
  | 'break_crate'
  | 'break_resource_node'
  // 4. Item Pickup
  | 'pickup_resource'
  | 'pickup_weapon'
  | 'pickup_food'
  | 'pickup_quest'
  | 'pickup_coins'
  // 5. Throwing & Projectiles
  | 'item_throw'
  | 'item_drop'
  | 'projectile_launch'
  | 'arrow_release'
  | 'arrow_impact'
  // 6. Bow
  | 'bow_pull'
  | 'bow_charge'
  | 'bow_full_charge'
  | 'bow_release'
  | 'bow_empty'
  | 'arrow_fly'
  | 'arrow_hit_wood'
  | 'arrow_hit_stone'
  | 'arrow_hit_enemy'
  | 'arrow_hit_armor'
  | 'arrow_hit_water'
  // 7. Combat
  | 'player_hit'
  | 'enemy_hit'
  | 'critical_hit'
  | 'shield_block'
  | 'enemy_death'
  | 'player_death'
  | 'armor_impact'
  | 'unarmed_hit'
  // 8. Building & Interaction
  | 'door_open'
  | 'door_close'
  | 'chest_open'
  | 'chest_close'
  | 'crafting'
  | 'object_place'
  | 'object_remove'
  | 'building_place'
  | 'build_upgrade'
  | 'build_repair'
  | 'build_error'
  | 'farm_plant'
  | 'farm_water'
  | 'farm_harvest'
  | 'animal_happy'
  | 'village_upgrade'
  | 'trade_coin'
  | 'resource_collect'
  | 'interact'
  | 'ui_click'
  | 'jump'
  | 'land'
  // 9. Footsteps
  | 'footstep_grass'
  | 'footstep_dirt'
  | 'footstep_stone'
  | 'footstep_sand'
  | 'footstep_wood'
  | 'footstep_snow'
  | 'footstep_water'
  // 10. Environment Ambience (continuous + event layers, routed to dedicated ambient bus)
  | 'env_forest'
  | 'env_desert'
  | 'env_village'
  | 'env_mountains'
  | 'env_caves'
  | 'env_water'
  | 'env_rain'
  | 'env_storm'
  | 'env_night';

export interface AudioCueDefinition {
  id: AudioCueId;
  category: AudioCategory;
  priority: AudioPriority;
  bus: AudioBus;
  variantCount: number;
  baseGain: number;
  minIntervalMs: number;
  refDistance: number;
  maxDistance: number;
  rolloff: number;
  looping?: boolean;
}

export const PRIORITY_WEIGHT: Record<AudioPriority, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

const def = (
  id: AudioCueId,
  category: AudioCategory,
  priority: AudioPriority,
  opts: Partial<Omit<AudioCueDefinition, 'id' | 'category' | 'priority'>> = {},
): AudioCueDefinition => ({
  id,
  category,
  priority,
  bus: opts.bus ?? 'effects',
  variantCount: opts.variantCount ?? 4,
  baseGain: opts.baseGain ?? 0.22,
  minIntervalMs: opts.minIntervalMs ?? 35,
  refDistance: opts.refDistance ?? 3.5,
  maxDistance: opts.maxDistance ?? 42,
  rolloff: opts.rolloff ?? 0.14,
  ...(opts.looping ? { looping: true } : {}),
});

export const AUDIO_CUE_REGISTRY: Record<AudioCueId, AudioCueDefinition> = {
  // 1. Swords / Melee
  sword_swing: def('sword_swing', 'sword', 'HIGH', { variantCount: 5, baseGain: 0.24, minIntervalMs: 55, maxDistance: 36 }),
  sword_swing_fast: def('sword_swing_fast', 'sword', 'HIGH', { variantCount: 5, baseGain: 0.21, minIntervalMs: 45, maxDistance: 32 }),
  sword_swing_heavy: def('sword_swing_heavy', 'sword', 'HIGH', { variantCount: 4, baseGain: 0.28, minIntervalMs: 75, maxDistance: 40 }),
  spear_thrust: def('spear_thrust', 'sword', 'HIGH', { variantCount: 4, baseGain: 0.22, minIntervalMs: 55, maxDistance: 34 }),
  knife_slash: def('knife_slash', 'sword', 'HIGH', { variantCount: 5, baseGain: 0.20, minIntervalMs: 40, maxDistance: 28 }),
  unarmed_swing: def('unarmed_swing', 'sword', 'HIGH', { variantCount: 4, baseGain: 0.16, minIntervalMs: 50, maxDistance: 24 }),
  sword_hit: def('sword_hit', 'sword', 'HIGH', { variantCount: 5, baseGain: 0.25, minIntervalMs: 35, maxDistance: 40 }),
  sword_hit_armor: def('sword_hit_armor', 'sword', 'HIGH', { variantCount: 5, baseGain: 0.26, minIntervalMs: 35, maxDistance: 45 }),
  sword_hit_wood: def('sword_hit_wood', 'sword', 'MEDIUM', { variantCount: 4, baseGain: 0.22, minIntervalMs: 65, maxDistance: 36 }),
  sword_hit_stone: def('sword_hit_stone', 'sword', 'MEDIUM', { variantCount: 4, baseGain: 0.22, minIntervalMs: 65, maxDistance: 38 }),
  sword_block: def('sword_block', 'sword', 'HIGH', { variantCount: 4, baseGain: 0.28, minIntervalMs: 45, maxDistance: 46 }),
  sword_impact: def('sword_impact', 'sword', 'HIGH', { variantCount: 4, baseGain: 0.26, minIntervalMs: 40, maxDistance: 42 }),

  // 2. Tools
  tool_axe_swing: def('tool_axe_swing', 'tool', 'HIGH', { variantCount: 4, baseGain: 0.24, minIntervalMs: 70, maxDistance: 36 }),
  tool_axe_tree: def('tool_axe_tree', 'tool', 'MEDIUM', { variantCount: 5, baseGain: 0.25, minIntervalMs: 90, maxDistance: 44 }),
  tool_pickaxe_stone: def('tool_pickaxe_stone', 'tool', 'MEDIUM', { variantCount: 5, baseGain: 0.24, minIntervalMs: 90, maxDistance: 46 }),
  tool_pickaxe_iron: def('tool_pickaxe_iron', 'tool', 'MEDIUM', { variantCount: 4, baseGain: 0.25, minIntervalMs: 90, maxDistance: 48 }),
  tool_pickaxe_gold: def('tool_pickaxe_gold', 'tool', 'MEDIUM', { variantCount: 4, baseGain: 0.26, minIntervalMs: 90, maxDistance: 48 }),
  tool_shovel_dig: def('tool_shovel_dig', 'tool', 'MEDIUM', { variantCount: 4, baseGain: 0.21, minIntervalMs: 90, maxDistance: 32 }),
  tool_mining: def('tool_mining', 'tool', 'MEDIUM', { variantCount: 4, baseGain: 0.24, minIntervalMs: 90, maxDistance: 44 }),
  tool_harvesting: def('tool_harvesting', 'tool', 'MEDIUM', { variantCount: 5, baseGain: 0.20, minIntervalMs: 70, maxDistance: 28 }),
  tool_crafting: def('tool_crafting', 'tool', 'MEDIUM', { variantCount: 4, baseGain: 0.24, minIntervalMs: 90, maxDistance: 36 }),
  tool_break: def('tool_break', 'breaking', 'HIGH', { variantCount: 2, baseGain: 0.28, minIntervalMs: 120, maxDistance: 28 }),
  smelting: def('smelting', 'building', 'MEDIUM', { variantCount: 3, baseGain: 0.24, minIntervalMs: 100, maxDistance: 36 }),

  // 3. Breaking
  break_wood: def('break_wood', 'breaking', 'MEDIUM', { variantCount: 4, baseGain: 0.26, minIntervalMs: 80, maxDistance: 42 }),
  break_stone: def('break_stone', 'breaking', 'MEDIUM', { variantCount: 4, baseGain: 0.28, minIntervalMs: 80, maxDistance: 48 }),
  break_glass: def('break_glass', 'breaking', 'MEDIUM', { variantCount: 4, baseGain: 0.25, minIntervalMs: 80, maxDistance: 42 }),
  break_plant: def('break_plant', 'breaking', 'LOW', { variantCount: 4, baseGain: 0.19, minIntervalMs: 65, maxDistance: 26 }),
  break_crate: def('break_crate', 'breaking', 'MEDIUM', { variantCount: 4, baseGain: 0.27, minIntervalMs: 80, maxDistance: 42 }),
  break_resource_node: def('break_resource_node', 'breaking', 'MEDIUM', { variantCount: 4, baseGain: 0.26, minIntervalMs: 80, maxDistance: 44 }),

  // 4. Item Pickup
  pickup_resource: def('pickup_resource', 'pickup', 'MEDIUM', { variantCount: 4, baseGain: 0.19, minIntervalMs: 45, maxDistance: 24 }),
  pickup_weapon: def('pickup_weapon', 'pickup', 'HIGH', { variantCount: 3, baseGain: 0.23, minIntervalMs: 60, maxDistance: 24 }),
  pickup_food: def('pickup_food', 'pickup', 'MEDIUM', { variantCount: 4, baseGain: 0.19, minIntervalMs: 45, maxDistance: 24 }),
  pickup_quest: def('pickup_quest', 'pickup', 'HIGH', { variantCount: 2, baseGain: 0.24, bus: 'effects', minIntervalMs: 100, maxDistance: 24 }),
  pickup_coins: def('pickup_coins', 'pickup', 'MEDIUM', { variantCount: 4, baseGain: 0.21, minIntervalMs: 45, maxDistance: 24 }),

  // 5. Throwing & Projectiles
  item_throw: def('item_throw', 'throwing', 'MEDIUM', { variantCount: 4, baseGain: 0.20, minIntervalMs: 55, maxDistance: 28 }),
  item_drop: def('item_drop', 'throwing', 'MEDIUM', { variantCount: 4, baseGain: 0.18, minIntervalMs: 55, maxDistance: 24 }),
  projectile_launch: def('projectile_launch', 'throwing', 'HIGH', { variantCount: 4, baseGain: 0.23, minIntervalMs: 55, maxDistance: 36 }),
  arrow_release: def('arrow_release', 'throwing', 'HIGH', { variantCount: 4, baseGain: 0.24, minIntervalMs: 55, maxDistance: 40 }),
  arrow_impact: def('arrow_impact', 'throwing', 'MEDIUM', { variantCount: 4, baseGain: 0.21, minIntervalMs: 35, maxDistance: 40 }),

  // 6. Bow
  bow_pull: def('bow_pull', 'bow', 'HIGH', { variantCount: 4, baseGain: 0.16, minIntervalMs: 120, maxDistance: 26 }),
  bow_charge: def('bow_charge', 'bow', 'LOW', { variantCount: 4, baseGain: 0.08, minIntervalMs: 190, maxDistance: 20 }),
  bow_full_charge: def('bow_full_charge', 'bow', 'HIGH', { variantCount: 2, baseGain: 0.14, minIntervalMs: 220, maxDistance: 18 }),
  bow_release: def('bow_release', 'bow', 'HIGH', { variantCount: 4, baseGain: 0.25, minIntervalMs: 55, maxDistance: 42 }),
  bow_empty: def('bow_empty', 'bow', 'HIGH', { variantCount: 2, baseGain: 0.15, minIntervalMs: 120, maxDistance: 18 }),
  arrow_fly: def('arrow_fly', 'bow', 'LOW', { variantCount: 4, baseGain: 0.15, minIntervalMs: 90, maxDistance: 28 }),
  arrow_hit_wood: def('arrow_hit_wood', 'bow', 'MEDIUM', { variantCount: 5, baseGain: 0.23, minIntervalMs: 35, maxDistance: 42 }),
  arrow_hit_stone: def('arrow_hit_stone', 'bow', 'MEDIUM', { variantCount: 5, baseGain: 0.22, minIntervalMs: 35, maxDistance: 44 }),
  arrow_hit_enemy: def('arrow_hit_enemy', 'bow', 'HIGH', { variantCount: 5, baseGain: 0.26, minIntervalMs: 35, maxDistance: 46 }),
  arrow_hit_armor: def('arrow_hit_armor', 'bow', 'HIGH', { variantCount: 4, baseGain: 0.26, minIntervalMs: 35, maxDistance: 48 }),
  arrow_hit_water: def('arrow_hit_water', 'bow', 'LOW', { variantCount: 4, baseGain: 0.20, minIntervalMs: 55, maxDistance: 38 }),

  // 7. Combat
  player_hit: def('player_hit', 'combat', 'HIGH', { variantCount: 4, baseGain: 0.27, minIntervalMs: 85, maxDistance: 24 }),
  enemy_hit: def('enemy_hit', 'combat', 'HIGH', { variantCount: 5, baseGain: 0.24, minIntervalMs: 35, maxDistance: 42 }),
  critical_hit: def('critical_hit', 'combat', 'HIGH', { variantCount: 4, baseGain: 0.30, minIntervalMs: 40, maxDistance: 46 }),
  shield_block: def('shield_block', 'combat', 'HIGH', { variantCount: 4, baseGain: 0.27, minIntervalMs: 45, maxDistance: 44 }),
  enemy_death: def('enemy_death', 'combat', 'HIGH', { variantCount: 4, baseGain: 0.26, minIntervalMs: 70, maxDistance: 48 }),
  player_death: def('player_death', 'combat', 'HIGH', { variantCount: 2, baseGain: 0.30, minIntervalMs: 300, maxDistance: 24 }),
  armor_impact: def('armor_impact', 'combat', 'HIGH', { variantCount: 4, baseGain: 0.24, minIntervalMs: 45, maxDistance: 42 }),
  unarmed_hit: def('unarmed_hit', 'combat', 'HIGH', { variantCount: 4, baseGain: 0.21, minIntervalMs: 45, maxDistance: 32 }),

  // 8. Building & Interaction
  door_open: def('door_open', 'building', 'MEDIUM', { variantCount: 4, baseGain: 0.22, minIntervalMs: 90, maxDistance: 34 }),
  door_close: def('door_close', 'building', 'MEDIUM', { variantCount: 4, baseGain: 0.22, minIntervalMs: 90, maxDistance: 34 }),
  chest_open: def('chest_open', 'building', 'MEDIUM', { variantCount: 3, baseGain: 0.25, minIntervalMs: 120, maxDistance: 34 }),
  chest_close: def('chest_close', 'building', 'MEDIUM', { variantCount: 3, baseGain: 0.22, minIntervalMs: 120, maxDistance: 34 }),
  crafting: def('crafting', 'building', 'MEDIUM', { variantCount: 4, baseGain: 0.24, minIntervalMs: 100, maxDistance: 32 }),
  object_place: def('object_place', 'building', 'MEDIUM', { variantCount: 4, baseGain: 0.23, minIntervalMs: 75, maxDistance: 34 }),
  object_remove: def('object_remove', 'building', 'MEDIUM', { variantCount: 4, baseGain: 0.21, minIntervalMs: 75, maxDistance: 34 }),
  building_place: def('building_place', 'building', 'MEDIUM', { variantCount: 4, baseGain: 0.25, minIntervalMs: 90, maxDistance: 40 }),
  build_upgrade: def('build_upgrade', 'building', 'MEDIUM', { variantCount: 3, baseGain: 0.26, minIntervalMs: 90, maxDistance: 40 }),
  build_repair: def('build_repair', 'building', 'MEDIUM', { variantCount: 3, baseGain: 0.23, minIntervalMs: 90, maxDistance: 36 }),
  build_error: def('build_error', 'ui', 'HIGH', { variantCount: 2, baseGain: 0.16, bus: 'ui', minIntervalMs: 110, maxDistance: 20 }),
  farm_plant: def('farm_plant', 'tool', 'MEDIUM', { variantCount: 3, baseGain: 0.20, minIntervalMs: 70, maxDistance: 26 }),
  farm_water: def('farm_water', 'tool', 'MEDIUM', { variantCount: 3, baseGain: 0.21, minIntervalMs: 80, maxDistance: 28 }),
  farm_harvest: def('farm_harvest', 'pickup', 'MEDIUM', { variantCount: 3, baseGain: 0.23, minIntervalMs: 70, maxDistance: 28 }),
  animal_happy: def('animal_happy', 'pickup', 'MEDIUM', { variantCount: 3, baseGain: 0.20, minIntervalMs: 110, maxDistance: 28 }),
  village_upgrade: def('village_upgrade', 'building', 'HIGH', { variantCount: 2, baseGain: 0.28, minIntervalMs: 150, maxDistance: 45 }),
  trade_coin: def('trade_coin', 'ui', 'HIGH', { variantCount: 3, baseGain: 0.22, bus: 'ui', minIntervalMs: 65, maxDistance: 20 }),
  resource_collect: def('resource_collect', 'building', 'MEDIUM', { variantCount: 4, baseGain: 0.20, minIntervalMs: 65, maxDistance: 28 }),
  interact: def('interact', 'ui', 'MEDIUM', { variantCount: 2, baseGain: 0.16, bus: 'ui', minIntervalMs: 55, maxDistance: 20 }),
  ui_click: def('ui_click', 'ui', 'HIGH', { variantCount: 2, baseGain: 0.14, bus: 'ui', minIntervalMs: 35, maxDistance: 20 }),
  jump: def('jump', 'footstep', 'MEDIUM', { variantCount: 3, baseGain: 0.13, minIntervalMs: 120, maxDistance: 24 }),
  land: def('land', 'footstep', 'MEDIUM', { variantCount: 4, baseGain: 0.16, minIntervalMs: 90, maxDistance: 28 }),

  // 9. Footsteps (calibrated soft & natural; modulated by user's footstepVolume default 0.30)
  footstep_grass: def('footstep_grass', 'footstep', 'LOW', { variantCount: 6, baseGain: 0.085, minIntervalMs: 110, maxDistance: 20 }),
  footstep_dirt: def('footstep_dirt', 'footstep', 'LOW', { variantCount: 6, baseGain: 0.09, minIntervalMs: 110, maxDistance: 20 }),
  footstep_stone: def('footstep_stone', 'footstep', 'LOW', { variantCount: 6, baseGain: 0.095, minIntervalMs: 110, maxDistance: 22 }),
  footstep_sand: def('footstep_sand', 'footstep', 'LOW', { variantCount: 6, baseGain: 0.085, minIntervalMs: 110, maxDistance: 18 }),
  footstep_wood: def('footstep_wood', 'footstep', 'LOW', { variantCount: 6, baseGain: 0.10, minIntervalMs: 110, maxDistance: 22 }),
  footstep_snow: def('footstep_snow', 'footstep', 'LOW', { variantCount: 6, baseGain: 0.09, minIntervalMs: 110, maxDistance: 18 }),
  footstep_water: def('footstep_water', 'footstep', 'LOW', { variantCount: 5, baseGain: 0.11, minIntervalMs: 110, maxDistance: 24 }),

  // 10. Environment Ambience
  env_forest: def('env_forest', 'environment', 'LOW', { variantCount: 1, baseGain: 0.12, bus: 'ambient', looping: true, minIntervalMs: 0, maxDistance: 120 }),
  env_desert: def('env_desert', 'environment', 'LOW', { variantCount: 1, baseGain: 0.11, bus: 'ambient', looping: true, minIntervalMs: 0, maxDistance: 120 }),
  env_village: def('env_village', 'environment', 'LOW', { variantCount: 1, baseGain: 0.10, bus: 'ambient', looping: true, minIntervalMs: 0, maxDistance: 120 }),
  env_mountains: def('env_mountains', 'environment', 'LOW', { variantCount: 1, baseGain: 0.14, bus: 'ambient', looping: true, minIntervalMs: 0, maxDistance: 120 }),
  env_caves: def('env_caves', 'environment', 'LOW', { variantCount: 1, baseGain: 0.14, bus: 'ambient', looping: true, minIntervalMs: 0, maxDistance: 120 }),
  env_water: def('env_water', 'environment', 'LOW', { variantCount: 1, baseGain: 0.13, bus: 'ambient', looping: true, minIntervalMs: 0, maxDistance: 120 }),
  env_rain: def('env_rain', 'environment', 'LOW', { variantCount: 1, baseGain: 0.22, bus: 'ambient', looping: true, minIntervalMs: 0, maxDistance: 120 }),
  env_storm: def('env_storm', 'environment', 'LOW', { variantCount: 1, baseGain: 0.25, bus: 'ambient', looping: true, minIntervalMs: 0, maxDistance: 120 }),
  env_night: def('env_night', 'environment', 'LOW', { variantCount: 1, baseGain: 0.10, bus: 'ambient', looping: true, minIntervalMs: 0, maxDistance: 120 }),
};

const missingCueWarnings = new Set<string>();

/**
 * Resolves a cue definition with explicit missing-asset validation and logging.
 * Never silently ignores typos or missing asset entries.
 */
export function resolveSoundCue(
  cueId: string,
  onWarning?: (message: string) => void,
): AudioCueDefinition | null {
  const entry = (AUDIO_CUE_REGISTRY as Record<string, AudioCueDefinition | undefined>)[cueId];
  if (entry) return entry;

  if (!missingCueWarnings.has(cueId)) {
    missingCueWarnings.add(cueId);
    const message = `[AudioRegistry] Missing audio cue/asset configuration for "${cueId}". Register this cue in AudioRegistry.ts.`;
    if (onWarning) {
      onWarning(message);
    } else if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn(message);
    }
  }
  return null;
}

export function getLoggedMissingCues(): string[] {
  return Array.from(missingCueWarnings);
}

export function clearLoggedMissingCues(): void {
  missingCueWarnings.clear();
}

/**
 * Tracks the last played variant index per sound group and guarantees that
 * repeated triggers never select the exact same variant consecutively when variantCount >= 2.
 */
export class VariationTracker {
  private readonly lastVariantByGroup = new Map<string, number>();

  public pickVariant(
    groupKey: string,
    variantCount: number,
    rng: () => number = Math.random,
  ): number {
    if (variantCount <= 1) {
      this.lastVariantByGroup.set(groupKey, 0);
      return 0;
    }
    const prev = this.lastVariantByGroup.get(groupKey);
    let next: number;
    if (prev === undefined || prev < 0 || prev >= variantCount) {
      next = Math.floor(rng() * variantCount) % variantCount;
    } else {
      const offset = 1 + Math.floor(rng() * (variantCount - 1));
      next = (prev + offset) % variantCount;
    }
    this.lastVariantByGroup.set(groupKey, next);
    return next;
  }

  public getLastVariant(groupKey: string): number | undefined {
    return this.lastVariantByGroup.get(groupKey);
  }

  public clear(): void {
    this.lastVariantByGroup.clear();
  }
}

export interface SpatialAudioPosition {
  x: number;
  y?: number;
  z: number;
}

export interface ComputedSpatialAudio {
  distance: number;
  audible: boolean;
  attenuation: number; // 0..1 gain multiplier
  pan: number; // -1..1 stereo pan relative to listener facing yaw
}

/**
 * Computes smooth 3D distance attenuation and stereo azimuth panning using the
 * listener's yaw (where forward is (+sin(yaw), 0, +cos(yaw)) and right is (-cos(yaw), 0, +sin(yaw))
 * in Three.js' right-handed character space).
 */
export function computeSpatialAudioParams(
  sourcePos: SpatialAudioPosition,
  listenerPos: SpatialAudioPosition,
  listenerYaw: number,
  refDistance = 3.5,
  maxDistance = 42,
  rolloff = 0.14,
): ComputedSpatialAudio {
  const dx = sourcePos.x - listenerPos.x;
  const dy = (sourcePos.y ?? 0) - (listenerPos.y ?? 0);
  const dz = sourcePos.z - listenerPos.z;
  const distance = Math.hypot(dx, dy, dz);

  if (distance >= maxDistance) {
    return { distance, audible: false, attenuation: 0, pan: 0 };
  }

  if (distance <= 0.05) {
    return { distance, audible: true, attenuation: 1, pan: 0 };
  }

  const effectiveDist = Math.max(0, distance - refDistance);
  const inverseAtt = 1 / (1 + rolloff * effectiveDist);
  // Smooth cosine taper across the final 25% of maxDistance so sounds never hard-clip
  const fadeStart = maxDistance * 0.75;
  const edgeTaper =
    distance > fadeStart
      ? Math.max(0, 1 - (distance - fadeStart) / Math.max(0.001, maxDistance - fadeStart))
      : 1;
  const attenuation = Math.max(0, Math.min(1, inverseAtt * edgeTaper * edgeTaper));

  // Horizontal right vector relative to camera/player yaw:
  // Character forward = (sin(yaw), cos(yaw)), right-hand side on screen = (-cos(yaw), sin(yaw))
  const hDist = Math.hypot(dx, dz) || 1;
  const rightX = -Math.cos(listenerYaw);
  const rightZ = Math.sin(listenerYaw);
  const rawPan = ((dx / hDist) * rightX + (dz / hDist) * rightZ) * Math.min(1, distance / 3.5);
  const pan = Math.max(-0.92, Math.min(0.92, rawPan));

  return {
    distance,
    audible: attenuation > 0.006,
    attenuation,
    pan,
  };
}
