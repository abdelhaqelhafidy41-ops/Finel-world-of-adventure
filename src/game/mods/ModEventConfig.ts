import type { BiomeType, NpcRoutinePeriod, WeatherState } from '../types';
import type { QuestStatus } from '../quest/questTypes';
import {
  CORE_PROTECTED_IDS,
  resolveModCrossReference,
  resolveModObjectIdentifier,
} from './ModNamespaceRegistry';
import type { ModDiagnostic } from './modTypes';

export const MAX_EVENT_CONDITION_DEPTH = 12;
export const MAX_EVENT_ACTIONS = 24;

export const MOD_EVENT_TRIGGER_TYPES = [
  // World & Player Lifecycle
  'new_world_created',
  'player_first_spawn',
  'player_respawn',
  'world_loaded',
  'player_enter_area',
  'player_reach_coordinates',
  'player_level_reached',
  'item_collected',
  'inventory_changed',
  'item_equipped',
  // NPC & Dialogue
  'npc_talk_start',
  'dialogue_started',
  'dialogue_completed',
  'dialogue_choice_selected',
  'npc_interaction',
  'npc_quest_completed',
  // Combat & Entity Kills
  'animal_killed',
  'monster_killed',
  'enemy_killed',
  'boss_killed',
  'entity_killed',
  'entity_killed_with_weapon',
  'player_damaged',
  // Destruction & Gathering
  'block_broken',
  'object_destroyed',
  'tree_chopped',
  'ore_mined',
  'resource_gathered',
  'container_destroyed',
  'structure_destroyed',
  // Quest, Crafting & Building
  'quest_started',
  'quest_completed',
  'quest_failed',
  'item_crafted',
  'recipe_completed',
  'building_placed',
  'structure_completed',
  // Chained / Custom
  'custom_event',
] as const;

export type ModEventTriggerType = (typeof MOD_EVENT_TRIGGER_TYPES)[number];

export type ModEventExecutionMode =
  | 'once_per_world'
  | 'once_per_player'
  | 'once_per_player_per_world'
  | 'once_per_event'
  | 'repeatable'
  | 'repeatable_with_cooldown'
  | 'max_executions';

export type ModEventMultiplayerAuthority =
  | 'any'
  | 'host_only'
  | 'singleplayer_only'
  | 'server_or_host'
  | 'local_player_only';

export type ModEventInventoryFullPolicy = 'spawn_pickup' | 'pending' | 'fail';

export type ModEventStatusEffectKind =
  | 'heal'
  | 'stamina'
  | 'heal_over_time'
  | 'speed_boost'
  | 'damage_boost'
  | 'defense_boost'
  | 'stamina_regen';

export interface ModEventAreaSpec {
  x?: number;
  y?: number;
  z?: number;
  radius?: number;
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
  minZ?: number;
  maxZ?: number;
}

export interface ModEventTriggerSpec {
  type: ModEventTriggerType;
  npcId?: string;
  entityId?: string;
  entityCategory?: string;
  itemId?: string;
  weaponId?: string;
  recipeId?: string;
  questId?: string;
  choiceId?: string;
  dialogueId?: string;
  buildingId?: string;
  blockType?: string;
  resourceKind?: string;
  eventName?: string;
  targetLevel?: number;
  minLevel?: number;
  area?: ModEventAreaSpec;
  allowNonPlayerKill?: boolean;
  allowEnvironmentalDeath?: boolean;
}

export interface ModEventLeafCondition {
  playerLevel?: { min?: number; max?: number; equals?: number };
  inventoryContains?: Array<{ itemId: string; count: number }>;
  inventoryMissing?: Array<{ itemId: string; maxCount: number }>;
  npcId?: string[];
  entityId?: string[];
  entityCategory?: string[];
  weaponId?: string[];
  biome?: BiomeType[];
  position?: ModEventAreaSpec;
  timeOfDay?: {
    startHour?: number;
    endHour?: number;
    periods?: NpcRoutinePeriod[];
  };
  weather?: WeatherState[];
  questStatus?: {
    questId: string;
    statuses: QuestStatus[];
  };
  worldFlags?: {
    required?: string[];
    forbidden?: string[];
    any?: string[];
  };
  playerHealth?: {
    min?: number;
    max?: number;
    minPercent?: number;
    maxPercent?: number;
  };
  multiplayerAuthority?: ModEventMultiplayerAuthority;
}

export type ModEventConditionNode =
  | { kind: 'all'; conditions: ModEventConditionNode[] }
  | { kind: 'any'; conditions: ModEventConditionNode[] }
  | { kind: 'not'; condition: ModEventConditionNode }
  | { kind: 'leaf'; predicate: ModEventLeafCondition }
  | { kind: 'invalid'; reason: string };

export interface ModEventActionBase {
  inventoryFullPolicy?: ModEventInventoryFullPolicy;
}

export type ModEventAction =
  | (ModEventActionBase & {
      type: 'give_item';
      itemId: string;
      count: number;
    })
  | (ModEventActionBase & {
      type: 'give_weapon';
      itemId: string;
      count: number;
      equip?: boolean;
    })
  | (ModEventActionBase & {
      type: 'give_items';
      items: Array<{ itemId: string; count: number }>;
    })
  | (ModEventActionBase & {
      type: 'spawn_world_pickup';
      itemId: string;
      count: number;
      x?: number;
      y?: number;
      z?: number;
      offsetX?: number;
      offsetY?: number;
      offsetZ?: number;
      perPlayer?: boolean;
    })
  | {
      type: 'give_xp';
      amount: number;
    }
  | {
      type: 'give_currency';
      amount: number;
    }
  | {
      type: 'give_reputation';
      amount: number;
      villageId?: string;
    }
  | {
      type: 'unlock_achievement';
      achievementId: string;
      title?: string;
      description?: string;
      localizedTitle?: Record<string, string>;
    }
  | {
      type: 'unlock_recipe';
      recipeId: string;
    }
  | {
      type: 'start_quest';
      questId: string;
    }
  | {
      type: 'complete_quest';
      questId: string;
    }
  | {
      type: 'set_world_flag';
      flag: string;
      value: boolean;
    }
  | {
      type: 'show_notification';
      message?: string;
      localizationKey?: string;
      localized?: Record<string, string>;
    }
  | {
      type: 'play_sound';
      soundId: string;
    }
  | {
      type: 'spawn_entity';
      contentId: string;
      contentType?: string;
      x?: number;
      y?: number;
      z?: number;
      offsetX?: number;
      offsetY?: number;
      offsetZ?: number;
      behavior?: string;
    }
  | {
      type: 'start_dialogue';
      npcId: string;
      treeId?: string;
    }
  | {
      type: 'apply_status_effect';
      effectType: ModEventStatusEffectKind;
      amount?: number;
      multiplier?: number;
      durationSeconds?: number;
    }
  | {
      type: 'emit_event';
      eventName: string;
      payload?: Record<string, string | number | boolean>;
    };

export interface ModEventDefinition {
  /** Globally unique namespaced ID: ${modId}:event:${localId} or ${modId}:${localId} */
  id: string;
  eventId: string;
  modId: string;
  name?: string;
  description?: string;
  sourceFile: string;
  schemaVersion: number;
  enabled: boolean;
  trigger: ModEventTriggerSpec;
  condition: ModEventConditionNode | null;
  actions: ModEventAction[];
  executionMode: ModEventExecutionMode;
  cooldownSeconds: number;
  maxExecutions?: number;
  priority: number;
  executionTiming: 'sync' | 'queued';
  delaySeconds: number;
  inventoryFullPolicy: ModEventInventoryFullPolicy;
  multiplayerAuthority: ModEventMultiplayerAuthority;
  validationError?: {
    code: string;
    message: string;
  };
  raw: Record<string, unknown>;
}

export type ModEventRuntimeStatus =
  | 'registered'
  | 'executed'
  | 'blocked_condition'
  | 'blocked_limit'
  | 'blocked_cooldown'
  | 'blocked_authority'
  | 'blocked_cycle'
  | 'pending_inventory'
  | 'disabled'
  | 'failed';

export interface ModEventDiagnosticEntry {
  modId: string;
  eventId: string;
  fullId: string;
  triggerType: string;
  executionMode: ModEventExecutionMode;
  status: ModEventRuntimeStatus;
  executionCount: number;
  lastTriggeredAt?: number;
  lastExecutedAt?: number;
  failedReason?: string;
  errorCode?: string;
  error?: string;
}

export interface PendingWorldModReward {
  id: string;
  modId: string;
  eventId: string;
  fullEventId: string;
  playerScopeId: string;
  worldId: string;
  items: Array<{ itemId: string; count: number; equip?: boolean }>;
  createdAt: number;
  attempts: number;
}

export interface SavedWorldModEventState {
  version: number;
  worldFlags: Record<string, boolean>;
  executedWorldEvents: Record<string, number>;
  executedPlayerWorldEvents: Record<string, number>;
  executionCounts: Record<string, number>;
  cooldowns: Record<string, number>;
  processedInstanceIds: string[];
  firstSpawnPlayers: string[];
  pendingRewards: PendingWorldModReward[];
}

const VALID_TRIGGER_SET = new Set<string>(MOD_EVENT_TRIGGER_TYPES);
const TRIGGER_ALIAS_MAP: Record<string, ModEventTriggerType> = {
  new_world: 'new_world_created',
  on_new_world: 'new_world_created',
  onnewworld: 'new_world_created',
  world_create: 'new_world_created',
  world_created: 'new_world_created',
  first_spawn: 'player_first_spawn',
  on_first_spawn: 'player_first_spawn',
  onfirstspawn: 'player_first_spawn',
  player_created: 'player_first_spawn',
  respawn: 'player_respawn',
  on_player_respawn: 'player_respawn',
  world_load: 'world_loaded',
  on_world_load: 'world_loaded',
  onworldload: 'world_loaded',
  enter_area: 'player_enter_area',
  area_enter: 'player_enter_area',
  zone_enter: 'player_enter_area',
  on_area_enter: 'player_enter_area',
  onareaenter: 'player_enter_area',
  reach_coordinates: 'player_reach_coordinates',
  coordinates_reached: 'player_reach_coordinates',
  enter_coordinates: 'player_reach_coordinates',
  level_up: 'player_level_reached',
  level_reached: 'player_level_reached',
  on_level_up: 'player_level_reached',
  pickup_collected: 'item_collected',
  item_pickup: 'item_collected',
  item_acquired: 'item_collected',
  on_item_collected: 'item_collected',
  on_inventory_changed: 'inventory_changed',
  inventory_updated: 'inventory_changed',
  weapon_equipped: 'item_equipped',
  equipment_changed: 'item_equipped',
  on_item_equipped: 'item_equipped',
  talk_to_npc: 'npc_talk_start',
  on_npc_talk: 'npc_talk_start',
  npc_talk: 'npc_talk_start',
  on_dialogue_start: 'dialogue_started',
  dialogue_start: 'dialogue_started',
  dialogue_ended: 'dialogue_completed',
  on_dialogue_complete: 'dialogue_completed',
  npc_dialogue_complete: 'dialogue_completed',
  dialogue_choice: 'dialogue_choice_selected',
  on_dialogue_choice: 'dialogue_choice_selected',
  interact_npc: 'npc_interaction',
  on_npc_interact: 'npc_interaction',
  npc_quest_turnin: 'npc_quest_completed',
  on_animal_killed: 'animal_killed',
  wildlife_killed: 'animal_killed',
  on_monster_killed: 'monster_killed',
  on_enemy_killed: 'enemy_killed',
  enemy_defeated: 'enemy_killed',
  on_boss_killed: 'boss_killed',
  boss_defeated: 'boss_killed',
  on_entity_killed: 'entity_killed',
  mob_killed: 'entity_killed',
  killed_with_weapon: 'entity_killed_with_weapon',
  weapon_kill: 'entity_killed_with_weapon',
  on_player_damaged: 'player_damaged',
  damage_taken: 'player_damaged',
  on_block_broken: 'block_broken',
  block_destroyed: 'block_broken',
  on_object_destroyed: 'object_destroyed',
  prop_destroyed: 'object_destroyed',
  on_tree_chopped: 'tree_chopped',
  tree_felled: 'tree_chopped',
  on_ore_mined: 'ore_mined',
  mine_ore: 'ore_mined',
  on_resource_gathered: 'resource_gathered',
  node_gathered: 'resource_gathered',
  herb_gathered: 'resource_gathered',
  chest_destroyed: 'container_destroyed',
  crate_destroyed: 'container_destroyed',
  building_destroyed: 'structure_destroyed',
  building_demolished: 'structure_destroyed',
  on_quest_start: 'quest_started',
  quest_accepted: 'quest_started',
  on_quest_complete: 'quest_completed',
  quest_finished: 'quest_completed',
  on_quest_failed: 'quest_failed',
  quest_cancelled: 'quest_failed',
  on_item_crafted: 'item_crafted',
  crafted_item: 'item_crafted',
  on_recipe_completed: 'recipe_completed',
  craft_completed: 'recipe_completed',
  structure_placed: 'building_placed',
  on_building_placed: 'building_placed',
  building_completed: 'structure_completed',
  building_upgraded: 'structure_completed',
  mod_event: 'custom_event',
  triggered_event: 'custom_event',
  chained_event: 'custom_event',
};

const FORBIDDEN_CODE_KEYS = new Set([
  'script',
  'code',
  'eval',
  'function',
  'fn',
  'callback',
  'js',
  'javascript',
  '__proto__',
  'prototype',
  'constructor',
]);

const VALID_BIOMES = new Set<string>([
  'Plains',
  'Forest',
  'Desert',
  'Mountains',
  'Snow',
  'Coast',
]);

const VALID_WEATHER = new Set<string>([
  'clear',
  'cloudy',
  'overcast',
  'rain',
  'storm',
  'fog',
]);

const VALID_PERIODS = new Set<string>(['morning', 'day', 'evening', 'night']);

const VALID_QUEST_STATUS = new Set<string>([
  'available',
  'active',
  'completed',
  'locked',
  'failed',
]);

function isRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val && typeof val === 'object' && !Array.isArray(val));
}

function finiteNum(val: unknown): number | undefined {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function nonEmptyString(val: unknown): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stringList(val: unknown): string[] {
  if (typeof val === 'string') {
    const s = val.trim();
    return s ? [s] : [];
  }
  if (Array.isArray(val)) {
    return val
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim());
  }
  return [];
}

function resolveMaybeModRef(modId: string, rawRef: string): string {
  const clean = rawRef.trim();
  if (!clean) return clean;
  return resolveModCrossReference(modId, clean, CORE_PROTECTED_IDS);
}

function findForbiddenCodeField(
  value: unknown,
  depth = 0,
): string | null {
  if (depth > 14 || !value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 64); i++) {
      const hit = findForbiddenCodeField(value[i], depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_CODE_KEYS.has(lower)) {
      return key;
    }
    const child = (value as Record<string, unknown>)[key];
    const hit = findForbiddenCodeField(child, depth + 1);
    if (hit) return hit;
  }
  return null;
}

export function normalizeTriggerType(rawType: unknown): ModEventTriggerType | null {
  if (typeof rawType !== 'string') return null;
  const raw = rawType.trim();
  if (!raw) return null;
  const snake = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
  if (VALID_TRIGGER_SET.has(snake)) {
    return snake as ModEventTriggerType;
  }
  const compact = snake.replace(/_/g, '');
  if (TRIGGER_ALIAS_MAP[snake]) {
    return TRIGGER_ALIAS_MAP[snake];
  }
  if (TRIGGER_ALIAS_MAP[compact]) {
    return TRIGGER_ALIAS_MAP[compact];
  }
  return null;
}

function parseAreaSpec(
  raw: unknown,
): { ok: true; area: ModEventAreaSpec } | { ok: false; reason: string } {
  if (!isRecord(raw)) {
    return { ok: false, reason: 'Area/position filter must be an object.' };
  }
  const area: ModEventAreaSpec = {};
  const x = finiteNum(raw.x);
  const y = finiteNum(raw.y);
  const z = finiteNum(raw.z);
  const radius = finiteNum(raw.radius);
  const minX = finiteNum(raw.minX);
  const maxX = finiteNum(raw.maxX);
  const minY = finiteNum(raw.minY);
  const maxY = finiteNum(raw.maxY);
  const minZ = finiteNum(raw.minZ);
  const maxZ = finiteNum(raw.maxZ);

  if (raw.x !== undefined && x === undefined) return { ok: false, reason: 'Invalid area x.' };
  if (raw.y !== undefined && y === undefined) return { ok: false, reason: 'Invalid area y.' };
  if (raw.z !== undefined && z === undefined) return { ok: false, reason: 'Invalid area z.' };
  if (raw.radius !== undefined && (radius === undefined || radius <= 0)) {
    return { ok: false, reason: 'Area radius must be positive finite number.' };
  }
  if (x !== undefined) area.x = x;
  if (y !== undefined) area.y = y;
  if (z !== undefined) area.z = z;
  if (radius !== undefined) area.radius = radius;
  if (minX !== undefined) area.minX = minX;
  if (maxX !== undefined) area.maxX = maxX;
  if (minY !== undefined) area.minY = minY;
  if (maxY !== undefined) area.maxY = maxY;
  if (minZ !== undefined) area.minZ = minZ;
  if (maxZ !== undefined) area.maxZ = maxZ;

  const hasRadial = area.x !== undefined && area.z !== undefined;
  const hasBox =
    area.minX !== undefined &&
    area.maxX !== undefined &&
    area.minZ !== undefined &&
    area.maxZ !== undefined;
  if (!hasRadial && !hasBox) {
    return { ok: false, reason: 'Area filter requires (x, z) or (minX, maxX, minZ, maxZ).' };
  }
  if (hasBox && area.minX! > area.maxX!) {
    return { ok: false, reason: 'Area minX cannot exceed maxX.' };
  }
  if (hasBox && area.minZ! > area.maxZ!) {
    return { ok: false, reason: 'Area minZ cannot exceed maxZ.' };
  }
  return { ok: true, area };
}

function parseConditionNode(
  modId: string,
  raw: unknown,
  depth = 0,
): { node: ModEventConditionNode; error?: string } {
  if (depth > MAX_EVENT_CONDITION_DEPTH) {
    const reason = `Condition nesting exceeds max depth (${MAX_EVENT_CONDITION_DEPTH}).`;
    return { node: { kind: 'invalid', reason }, error: reason };
  }
  if (!isRecord(raw)) {
    const reason = 'Condition node must be an object.';
    return { node: { kind: 'invalid', reason }, error: reason };
  }

  // Combinator: ALL / AND
  const allArr = Array.isArray(raw.all)
    ? raw.all
    : Array.isArray(raw.and)
      ? raw.and
      : raw.operator === 'and' && Array.isArray(raw.conditions)
        ? raw.conditions
        : null;
  if (allArr) {
    const children: ModEventConditionNode[] = [];
    for (const child of allArr.slice(0, 32)) {
      const parsed = parseConditionNode(modId, child, depth + 1);
      if (parsed.error) return { node: parsed.node, error: parsed.error };
      children.push(parsed.node);
    }
    return { node: { kind: 'all', conditions: children } };
  }

  // Combinator: ANY / OR
  const anyArr = Array.isArray(raw.any)
    ? raw.any
    : Array.isArray(raw.or)
      ? raw.or
      : raw.operator === 'or' && Array.isArray(raw.conditions)
        ? raw.conditions
        : null;
  if (anyArr) {
    const children: ModEventConditionNode[] = [];
    for (const child of anyArr.slice(0, 32)) {
      const parsed = parseConditionNode(modId, child, depth + 1);
      if (parsed.error) return { node: parsed.node, error: parsed.error };
      children.push(parsed.node);
    }
    return { node: { kind: 'any', conditions: children } };
  }

  // Combinator: NOT
  if (raw.not !== undefined || (raw.operator === 'not' && raw.condition !== undefined)) {
    const target = raw.not !== undefined ? raw.not : raw.condition;
    const parsed = parseConditionNode(modId, target, depth + 1);
    if (parsed.error) return { node: parsed.node, error: parsed.error };
    return { node: { kind: 'not', condition: parsed.node } };
  }

  if (typeof raw.operator === 'string' && !['and', 'or', 'not'].includes(raw.operator)) {
    const reason = `Unsupported condition operator "${raw.operator}".`;
    return { node: { kind: 'invalid', reason }, error: reason };
  }

  const predicate: ModEventLeafCondition = {};
  let hasAnyField = false;

  // Support Mod Creator typed leaf style: { type: 'playerLevel', min: 2 }
  const typedKind = nonEmptyString(raw.type);
  if (typedKind) {
    const lowerType = typedKind.toLowerCase();
    if (lowerType === 'playerlevel' || lowerType === 'level') {
      const min = finiteNum(raw.min ?? raw.minLevel);
      const max = finiteNum(raw.max ?? raw.maxLevel);
      const equals = finiteNum(raw.equals ?? raw.level);
      if (min === undefined && max === undefined && equals === undefined) {
        const reason = 'playerLevel condition requires numeric min, max, or equals.';
        return { node: { kind: 'invalid', reason }, error: reason };
      }
      predicate.playerLevel = {
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        ...(equals !== undefined ? { equals } : {}),
      };
      return { node: { kind: 'leaf', predicate } };
    }
    if (lowerType === 'inventorycontains' || lowerType === 'hasitem' || lowerType === 'has_item') {
      const itemId = nonEmptyString(raw.itemId ?? raw.id);
      if (!itemId) {
        const reason = 'inventoryContains condition requires itemId.';
        return { node: { kind: 'invalid', reason }, error: reason };
      }
      const count = Math.max(1, Math.floor(finiteNum(raw.count ?? raw.minCount) ?? 1));
      predicate.inventoryContains = [{ itemId: resolveMaybeModRef(modId, itemId), count }];
      return { node: { kind: 'leaf', predicate } };
    }
    if (lowerType === 'inventorymissing' || lowerType === 'missingitem' || lowerType === 'missing_item') {
      const itemId = nonEmptyString(raw.itemId ?? raw.id);
      if (!itemId) {
        const reason = 'inventoryMissing condition requires itemId.';
        return { node: { kind: 'invalid', reason }, error: reason };
      }
      const maxCount = Math.max(0, Math.floor(finiteNum(raw.maxCount ?? raw.count) ?? 0));
      predicate.inventoryMissing = [{ itemId: resolveMaybeModRef(modId, itemId), maxCount }];
      return { node: { kind: 'leaf', predicate } };
    }
    if (lowerType === 'worldflag' || lowerType === 'flag') {
      const flag = nonEmptyString(raw.flag ?? raw.name);
      if (!flag) {
        const reason = 'worldFlag condition requires flag name.';
        return { node: { kind: 'invalid', reason }, error: reason };
      }
      const expected = raw.expected !== false && raw.value !== false;
      predicate.worldFlags = expected ? { required: [flag] } : { forbidden: [flag] };
      return { node: { kind: 'leaf', predicate } };
    }
    if (lowerType === 'queststatus' || lowerType === 'quest') {
      const qid = nonEmptyString(raw.questId);
      const statuses = stringList(raw.statuses ?? raw.status).filter((s) =>
        VALID_QUEST_STATUS.has(s),
      ) as QuestStatus[];
      if (!qid || statuses.length === 0) {
        const reason = 'questStatus condition requires valid questId and status.';
        return { node: { kind: 'invalid', reason }, error: reason };
      }
      predicate.questStatus = { questId: resolveMaybeModRef(modId, qid), statuses };
      return { node: { kind: 'leaf', predicate } };
    }
    if (lowerType === 'biome') {
      const biomes = stringList(raw.biome ?? raw.biomes).filter((b) => VALID_BIOMES.has(b)) as BiomeType[];
      if (biomes.length === 0) {
        const reason = 'biome condition requires valid biome name.';
        return { node: { kind: 'invalid', reason }, error: reason };
      }
      predicate.biome = biomes;
      return { node: { kind: 'leaf', predicate } };
    }
    if (lowerType === 'weather') {
      const weather = stringList(raw.weather).filter((w) => VALID_WEATHER.has(w)) as WeatherState[];
      if (weather.length === 0) {
        const reason = 'weather condition requires valid weather state.';
        return { node: { kind: 'invalid', reason }, error: reason };
      }
      predicate.weather = weather;
      return { node: { kind: 'leaf', predicate } };
    }
    if (lowerType === 'area' || lowerType === 'position' || lowerType === 'coordinates') {
      const parsedArea = parseAreaSpec(raw.area ?? raw);
      if (!parsedArea.ok) {
        return { node: { kind: 'invalid', reason: parsedArea.reason }, error: parsedArea.reason };
      }
      predicate.position = parsedArea.area;
      return { node: { kind: 'leaf', predicate } };
    }
    const unknownReason = `Unsupported condition type "${typedKind}".`;
    return { node: { kind: 'invalid', reason: unknownReason }, error: unknownReason };
  }

  // Flat predicate fields (standard Mod Creator v1/v2 export)
  if (raw.playerLevel !== undefined || raw.minLevel !== undefined || raw.maxLevel !== undefined) {
    hasAnyField = true;
    const src = raw.playerLevel;
    if (typeof src === 'number' && Number.isFinite(src)) {
      predicate.playerLevel = { min: src };
    } else if (isRecord(src)) {
      const min = finiteNum(src.min);
      const max = finiteNum(src.max);
      const equals = finiteNum(src.equals);
      if (min === undefined && max === undefined && equals === undefined) {
        const reason = 'Invalid playerLevel condition bounds.';
        return { node: { kind: 'invalid', reason }, error: reason };
      }
      if (min !== undefined && max !== undefined && min > max) {
        const reason = 'playerLevel min cannot exceed max.';
        return { node: { kind: 'invalid', reason }, error: reason };
      }
      predicate.playerLevel = {
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        ...(equals !== undefined ? { equals } : {}),
      };
    } else {
      const min = finiteNum(raw.minLevel);
      const max = finiteNum(raw.maxLevel);
      if (min === undefined && max === undefined) {
        const reason = 'Invalid level condition.';
        return { node: { kind: 'invalid', reason }, error: reason };
      }
      predicate.playerLevel = {
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
      };
    }
  }

  if (raw.inventoryContains !== undefined || raw.hasItem !== undefined) {
    hasAnyField = true;
    const rawInv = raw.inventoryContains ?? raw.hasItem;
    const list: Array<{ itemId: string; count: number }> = [];
    const itemsArr = Array.isArray(rawInv) ? rawInv : [rawInv];
    for (const entry of itemsArr) {
      if (typeof entry === 'string' && entry.trim()) {
        list.push({ itemId: resolveMaybeModRef(modId, entry), count: 1 });
      } else if (isRecord(entry) && nonEmptyString(entry.itemId ?? entry.id)) {
        const id = nonEmptyString(entry.itemId ?? entry.id)!;
        const count = Math.max(1, Math.floor(finiteNum(entry.count ?? entry.minCount) ?? 1));
        list.push({ itemId: resolveMaybeModRef(modId, id), count });
      } else {
        const reason = 'Malformed inventoryContains entry.';
        return { node: { kind: 'invalid', reason }, error: reason };
      }
    }
    predicate.inventoryContains = list;
  }

  if (raw.inventoryMissing !== undefined || raw.missingItem !== undefined) {
    hasAnyField = true;
    const rawMiss = raw.inventoryMissing ?? raw.missingItem;
    const list: Array<{ itemId: string; maxCount: number }> = [];
    const itemsArr = Array.isArray(rawMiss) ? rawMiss : [rawMiss];
    for (const entry of itemsArr) {
      if (typeof entry === 'string' && entry.trim()) {
        list.push({ itemId: resolveMaybeModRef(modId, entry), maxCount: 0 });
      } else if (isRecord(entry) && nonEmptyString(entry.itemId ?? entry.id)) {
        const id = nonEmptyString(entry.itemId ?? entry.id)!;
        const maxCount = Math.max(0, Math.floor(finiteNum(entry.maxCount ?? entry.count) ?? 0));
        list.push({ itemId: resolveMaybeModRef(modId, id), maxCount });
      } else {
        const reason = 'Malformed inventoryMissing entry.';
        return { node: { kind: 'invalid', reason }, error: reason };
      }
    }
    predicate.inventoryMissing = list;
  }

  if (raw.npcId !== undefined || raw.npcIds !== undefined) {
    hasAnyField = true;
    const npcs = stringList(raw.npcId ?? raw.npcIds);
    if (npcs.length === 0) {
      const reason = 'npcId condition requires non-empty value.';
      return { node: { kind: 'invalid', reason }, error: reason };
    }
    predicate.npcId = npcs;
  }

  if (raw.entityId !== undefined || raw.entityIds !== undefined) {
    hasAnyField = true;
    const ids = stringList(raw.entityId ?? raw.entityIds);
    if (ids.length === 0) {
      const reason = 'entityId condition requires non-empty value.';
      return { node: { kind: 'invalid', reason }, error: reason };
    }
    predicate.entityId = ids;
  }

  if (raw.entityCategory !== undefined || raw.entityCategories !== undefined) {
    hasAnyField = true;
    const cats = stringList(raw.entityCategory ?? raw.entityCategories).map((s) =>
      s.toLowerCase(),
    );
    if (cats.length === 0) {
      const reason = 'entityCategory condition requires non-empty value.';
      return { node: { kind: 'invalid', reason }, error: reason };
    }
    predicate.entityCategory = cats;
  }

  if (raw.weaponId !== undefined || raw.weaponIds !== undefined) {
    hasAnyField = true;
    const wids = stringList(raw.weaponId ?? raw.weaponIds).map((id) =>
      resolveMaybeModRef(modId, id),
    );
    if (wids.length === 0) {
      const reason = 'weaponId condition requires non-empty value.';
      return { node: { kind: 'invalid', reason }, error: reason };
    }
    predicate.weaponId = wids;
  }

  if (raw.biome !== undefined || raw.biomes !== undefined) {
    hasAnyField = true;
    const list = stringList(raw.biome ?? raw.biomes);
    const valid = list.filter((b) => VALID_BIOMES.has(b)) as BiomeType[];
    if (valid.length === 0 || valid.length !== list.length) {
      const reason = `Invalid biome value in condition (${list.join(', ')}).`;
      return { node: { kind: 'invalid', reason }, error: reason };
    }
    predicate.biome = valid;
  }

  if (raw.position !== undefined || raw.area !== undefined) {
    hasAnyField = true;
    const parsedArea = parseAreaSpec(raw.position ?? raw.area);
    if (!parsedArea.ok) {
      return { node: { kind: 'invalid', reason: parsedArea.reason }, error: parsedArea.reason };
    }
    predicate.position = parsedArea.area;
  }

  if (raw.timeOfDay !== undefined) {
    hasAnyField = true;
    if (!isRecord(raw.timeOfDay)) {
      const reason = 'timeOfDay condition must be an object.';
      return { node: { kind: 'invalid', reason }, error: reason };
    }
    const startHour = finiteNum(raw.timeOfDay.startHour);
    const endHour = finiteNum(raw.timeOfDay.endHour);
    const periodsRaw = stringList(raw.timeOfDay.periods ?? raw.timeOfDay.period);
    const periods = periodsRaw.filter((p) => VALID_PERIODS.has(p)) as NpcRoutinePeriod[];
    if (
      startHour === undefined &&
      endHour === undefined &&
      periods.length === 0
    ) {
      const reason = 'timeOfDay condition requires startHour/endHour or periods.';
      return { node: { kind: 'invalid', reason }, error: reason };
    }
    predicate.timeOfDay = {
      ...(startHour !== undefined ? { startHour } : {}),
      ...(endHour !== undefined ? { endHour } : {}),
      ...(periods.length > 0 ? { periods } : {}),
    };
  }

  if (raw.weather !== undefined) {
    hasAnyField = true;
    const list = stringList(raw.weather);
    const valid = list.filter((w) => VALID_WEATHER.has(w)) as WeatherState[];
    if (valid.length === 0 || valid.length !== list.length) {
      const reason = `Invalid weather condition (${list.join(', ')}).`;
      return { node: { kind: 'invalid', reason }, error: reason };
    }
    predicate.weather = valid;
  }

  if (raw.questStatus !== undefined) {
    hasAnyField = true;
    if (!isRecord(raw.questStatus)) {
      const reason = 'questStatus condition must be an object.';
      return { node: { kind: 'invalid', reason }, error: reason };
    }
    const qid = nonEmptyString(raw.questStatus.questId);
    const rawStatuses = stringList(
      raw.questStatus.statuses ?? raw.questStatus.status ?? raw.questStatus.in,
    );
    const statuses = rawStatuses.filter((s) =>
      VALID_QUEST_STATUS.has(s),
    ) as QuestStatus[];
    if (!qid || statuses.length === 0 || statuses.length !== rawStatuses.length) {
      const reason = 'questStatus requires valid questId and status values.';
      return { node: { kind: 'invalid', reason }, error: reason };
    }
    predicate.questStatus = {
      questId: resolveMaybeModRef(modId, qid),
      statuses,
    };
  }

  if (
    raw.worldFlags !== undefined ||
    raw.requiredFlag !== undefined ||
    raw.forbiddenFlag !== undefined
  ) {
    hasAnyField = true;
    const required: string[] = [];
    const forbidden: string[] = [];
    const anyFlags: string[] = [];
    if (typeof raw.requiredFlag === 'string' && raw.requiredFlag.trim()) {
      required.push(raw.requiredFlag.trim());
    }
    if (typeof raw.forbiddenFlag === 'string' && raw.forbiddenFlag.trim()) {
      forbidden.push(raw.forbiddenFlag.trim());
    }
    if (isRecord(raw.worldFlags)) {
      required.push(...stringList(raw.worldFlags.required ?? raw.worldFlags.all));
      forbidden.push(...stringList(raw.worldFlags.forbidden ?? raw.worldFlags.none));
      anyFlags.push(...stringList(raw.worldFlags.any));
    } else if (typeof raw.worldFlags === 'string' || Array.isArray(raw.worldFlags)) {
      required.push(...stringList(raw.worldFlags));
    } else if (raw.worldFlags !== undefined) {
      const reason = 'worldFlags condition has invalid shape.';
      return { node: { kind: 'invalid', reason }, error: reason };
    }
    if (required.length === 0 && forbidden.length === 0 && anyFlags.length === 0) {
      const reason = 'worldFlags condition cannot be empty.';
      return { node: { kind: 'invalid', reason }, error: reason };
    }
    predicate.worldFlags = {
      ...(required.length > 0 ? { required } : {}),
      ...(forbidden.length > 0 ? { forbidden } : {}),
      ...(anyFlags.length > 0 ? { any: anyFlags } : {}),
    };
  }

  if (raw.playerHealth !== undefined) {
    hasAnyField = true;
    if (!isRecord(raw.playerHealth)) {
      const reason = 'playerHealth condition must be an object.';
      return { node: { kind: 'invalid', reason }, error: reason };
    }
    const min = finiteNum(raw.playerHealth.min);
    const max = finiteNum(raw.playerHealth.max);
    const minPercent = finiteNum(raw.playerHealth.minPercent);
    const maxPercent = finiteNum(raw.playerHealth.maxPercent);
    if (
      min === undefined &&
      max === undefined &&
      minPercent === undefined &&
      maxPercent === undefined
    ) {
      const reason = 'playerHealth requires min, max, minPercent, or maxPercent.';
      return { node: { kind: 'invalid', reason }, error: reason };
    }
    predicate.playerHealth = {
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(minPercent !== undefined ? { minPercent } : {}),
      ...(maxPercent !== undefined ? { maxPercent } : {}),
    };
  }

  if (raw.multiplayerAuthority !== undefined) {
    hasAnyField = true;
    const auth = parseAuthorityMode(raw.multiplayerAuthority);
    if (!auth) {
      const reason = `Invalid multiplayerAuthority "${String(raw.multiplayerAuthority)}".`;
      return { node: { kind: 'invalid', reason }, error: reason };
    }
    predicate.multiplayerAuthority = auth;
  }

  if (!hasAnyField) {
    const keys = Object.keys(raw);
    const reason =
      keys.length > 0
        ? `Unknown condition keys (${keys.join(', ')}).`
        : 'Empty condition object is invalid.';
    return { node: { kind: 'invalid', reason }, error: reason };
  }

  return { node: { kind: 'leaf', predicate } };
}

function parseAuthorityMode(raw: unknown): ModEventMultiplayerAuthority | null {
  if (typeof raw !== 'string') return null;
  const clean = raw.trim().toLowerCase();
  if (
    clean === 'any' ||
    clean === 'host_only' ||
    clean === 'singleplayer_only' ||
    clean === 'server_or_host' ||
    clean === 'local_player_only'
  ) {
    return clean;
  }
  return null;
}

function parseInventoryPolicy(raw: unknown): ModEventInventoryFullPolicy | undefined {
  if (typeof raw !== 'string') return undefined;
  const clean = raw.trim().toLowerCase();
  if (clean === 'spawn_pickup' || clean === 'drop' || clean === 'drop_pickup') {
    return 'spawn_pickup';
  }
  if (clean === 'pending' || clean === 'queue') {
    return 'pending';
  }
  if (clean === 'fail' || clean === 'reject') {
    return 'fail';
  }
  return undefined;
}

function sanitizeAction(
  modId: string,
  raw: unknown,
): { action?: ModEventAction; error?: string } {
  if (!isRecord(raw)) {
    return { error: 'Action entry must be an object.' };
  }
  const rawType = nonEmptyString(raw.type ?? raw.action);
  if (!rawType) {
    return { error: 'Action entry requires "type".' };
  }
  const normType = rawType
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();

  const inventoryFullPolicy = parseInventoryPolicy(
    raw.inventoryFullPolicy ?? raw.onInventoryFull,
  );
  const policySpread = inventoryFullPolicy ? { inventoryFullPolicy } : {};

  switch (normType) {
    case 'give_item':
    case 'add_item': {
      const itemId = nonEmptyString(raw.itemId ?? raw.id);
      if (!itemId) return { error: 'give_item requires itemId.' };
      const count = Math.max(1, Math.min(999, Math.floor(finiteNum(raw.count ?? raw.quantity ?? raw.amount) ?? 1)));
      return {
        action: {
          type: 'give_item',
          itemId: resolveMaybeModRef(modId, itemId),
          count,
          ...policySpread,
        },
      };
    }
    case 'give_weapon':
    case 'add_weapon': {
      const itemId = nonEmptyString(raw.weaponId ?? raw.itemId ?? raw.id);
      if (!itemId) return { error: 'give_weapon requires itemId or weaponId.' };
      const count = Math.max(1, Math.min(20, Math.floor(finiteNum(raw.count ?? raw.quantity) ?? 1)));
      return {
        action: {
          type: 'give_weapon',
          itemId: resolveMaybeModRef(modId, itemId),
          count,
          ...(typeof raw.equip === 'boolean' ? { equip: raw.equip } : {}),
          ...policySpread,
        },
      };
    }
    case 'give_items':
    case 'add_items': {
      if (!Array.isArray(raw.items) || raw.items.length === 0) {
        return { error: 'give_items requires non-empty items array.' };
      }
      const items: Array<{ itemId: string; count: number }> = [];
      for (const entry of raw.items.slice(0, 24)) {
        if (typeof entry === 'string' && entry.trim()) {
          items.push({ itemId: resolveMaybeModRef(modId, entry), count: 1 });
        } else if (isRecord(entry) && nonEmptyString(entry.itemId ?? entry.id)) {
          const itemId = resolveMaybeModRef(modId, nonEmptyString(entry.itemId ?? entry.id)!);
          const count = Math.max(1, Math.min(999, Math.floor(finiteNum(entry.count ?? entry.quantity ?? entry.amount) ?? 1)));
          items.push({ itemId, count });
        } else {
          return { error: 'give_items contains malformed item entry.' };
        }
      }
      return {
        action: {
          type: 'give_items',
          items,
          ...policySpread,
        },
      };
    }
    case 'spawn_world_pickup':
    case 'spawn_pickup':
    case 'drop_item': {
      const itemId = nonEmptyString(raw.itemId ?? raw.id);
      if (!itemId) return { error: 'spawn_world_pickup requires itemId.' };
      const count = Math.max(1, Math.min(999, Math.floor(finiteNum(raw.count ?? raw.quantity) ?? 1)));
      const x = finiteNum(raw.x);
      const y = finiteNum(raw.y);
      const z = finiteNum(raw.z);
      const offsetX = finiteNum(raw.offsetX);
      const offsetY = finiteNum(raw.offsetY);
      const offsetZ = finiteNum(raw.offsetZ);
      return {
        action: {
          type: 'spawn_world_pickup',
          itemId: resolveMaybeModRef(modId, itemId),
          count,
          ...(x !== undefined ? { x } : {}),
          ...(y !== undefined ? { y } : {}),
          ...(z !== undefined ? { z } : {}),
          ...(offsetX !== undefined ? { offsetX } : {}),
          ...(offsetY !== undefined ? { offsetY } : {}),
          ...(offsetZ !== undefined ? { offsetZ } : {}),
          ...(typeof raw.perPlayer === 'boolean' ? { perPlayer: raw.perPlayer } : {}),
          ...policySpread,
        },
      };
    }
    case 'give_xp':
    case 'add_xp': {
      const amount = Math.max(1, Math.min(1_000_000, Math.floor(finiteNum(raw.amount ?? raw.xp) ?? 0)));
      if (amount <= 0) return { error: 'give_xp requires positive amount.' };
      return { action: { type: 'give_xp', amount } };
    }
    case 'give_currency':
    case 'give_coins':
    case 'add_coins':
    case 'add_currency': {
      const amount = Math.max(1, Math.min(1_000_000, Math.floor(finiteNum(raw.amount ?? raw.coins) ?? 0)));
      if (amount <= 0) return { error: 'give_currency requires positive amount.' };
      return { action: { type: 'give_currency', amount } };
    }
    case 'give_reputation':
    case 'add_reputation': {
      const amount = Math.max(-1000, Math.min(10_000, Math.floor(finiteNum(raw.amount ?? raw.reputation) ?? 0)));
      if (amount === 0) return { error: 'give_reputation requires non-zero amount.' };
      return {
        action: {
          type: 'give_reputation',
          amount,
          ...(nonEmptyString(raw.villageId) ? { villageId: nonEmptyString(raw.villageId) } : {}),
        },
      };
    }
    case 'unlock_achievement':
    case 'grant_achievement': {
      const rawAch = nonEmptyString(raw.achievementId ?? raw.id);
      if (!rawAch) return { error: 'unlock_achievement requires achievementId.' };
      const achievementId = rawAch.includes(':') ? rawAch : `${modId}:${rawAch}`;
      const localizedTitle = isRecord(raw.localizedTitle ?? raw.localized)
        ? Object.fromEntries(
            Object.entries((raw.localizedTitle ?? raw.localized) as Record<string, unknown>)
              .filter(([, v]) => typeof v === 'string')
              .map(([k, v]) => [k, v as string]),
          )
        : undefined;
      return {
        action: {
          type: 'unlock_achievement',
          achievementId,
          ...(nonEmptyString(raw.title) ? { title: nonEmptyString(raw.title) } : {}),
          ...(nonEmptyString(raw.description) ? { description: nonEmptyString(raw.description) } : {}),
          ...(localizedTitle && Object.keys(localizedTitle).length > 0 ? { localizedTitle } : {}),
        },
      };
    }
    case 'unlock_recipe':
    case 'learn_recipe': {
      const recipeId = nonEmptyString(raw.recipeId ?? raw.id);
      if (!recipeId) return { error: 'unlock_recipe requires recipeId.' };
      return {
        action: {
          type: 'unlock_recipe',
          recipeId: resolveMaybeModRef(modId, recipeId),
        },
      };
    }
    case 'start_quest':
    case 'accept_quest': {
      const questId = nonEmptyString(raw.questId ?? raw.id);
      if (!questId) return { error: 'start_quest requires questId.' };
      return {
        action: {
          type: 'start_quest',
          questId: resolveMaybeModRef(modId, questId),
        },
      };
    }
    case 'complete_quest':
    case 'finish_quest': {
      const questId = nonEmptyString(raw.questId ?? raw.id);
      if (!questId) return { error: 'complete_quest requires questId.' };
      return {
        action: {
          type: 'complete_quest',
          questId: resolveMaybeModRef(modId, questId),
        },
      };
    }
    case 'set_world_flag':
    case 'set_flag':
    case 'clear_world_flag': {
      const flag = nonEmptyString(raw.flag ?? raw.name ?? raw.key);
      if (!flag) return { error: 'set_world_flag requires flag.' };
      const value =
        normType === 'clear_world_flag'
          ? false
          : raw.value !== undefined
            ? Boolean(raw.value)
            : true;
      return {
        action: {
          type: 'set_world_flag',
          flag,
          value,
        },
      };
    }
    case 'show_notification':
    case 'notify':
    case 'show_message': {
      const message = nonEmptyString(raw.message ?? raw.text ?? raw.en);
      const localizationKey = nonEmptyString(raw.localizationKey ?? raw.key);
      const localized = isRecord(raw.localized)
        ? Object.fromEntries(
            Object.entries(raw.localized)
              .filter(([, v]) => typeof v === 'string')
              .map(([k, v]) => [k, v as string]),
          )
        : undefined;
      if (!message && !localizationKey && (!localized || Object.keys(localized).length === 0)) {
        return { error: 'show_notification requires message, localized, or localizationKey.' };
      }
      return {
        action: {
          type: 'show_notification',
          ...(message ? { message } : {}),
          ...(localizationKey ? { localizationKey } : {}),
          ...(localized && Object.keys(localized).length > 0 ? { localized } : {}),
        },
      };
    }
    case 'play_sound':
    case 'sound': {
      const soundId = nonEmptyString(raw.soundId ?? raw.id);
      if (!soundId) return { error: 'play_sound requires soundId.' };
      return {
        action: {
          type: 'play_sound',
          soundId: resolveMaybeModRef(modId, soundId),
        },
      };
    }
    case 'spawn_entity':
    case 'spawn': {
      const contentId = nonEmptyString(raw.contentId ?? raw.entityId ?? raw.id);
      if (!contentId) return { error: 'spawn_entity requires contentId or entityId.' };
      const x = finiteNum(raw.x);
      const y = finiteNum(raw.y);
      const z = finiteNum(raw.z);
      const offsetX = finiteNum(raw.offsetX);
      const offsetY = finiteNum(raw.offsetY);
      const offsetZ = finiteNum(raw.offsetZ);
      return {
        action: {
          type: 'spawn_entity',
          contentId: resolveMaybeModRef(modId, contentId),
          ...(nonEmptyString(raw.contentType) ? { contentType: nonEmptyString(raw.contentType)!.toLowerCase() } : {}),
          ...(x !== undefined ? { x } : {}),
          ...(y !== undefined ? { y } : {}),
          ...(z !== undefined ? { z } : {}),
          ...(offsetX !== undefined ? { offsetX } : {}),
          ...(offsetY !== undefined ? { offsetY } : {}),
          ...(offsetZ !== undefined ? { offsetZ } : {}),
          ...(nonEmptyString(raw.behavior) ? { behavior: nonEmptyString(raw.behavior) } : {}),
        },
      };
    }
    case 'start_dialogue':
    case 'open_dialogue': {
      const npcId = nonEmptyString(raw.npcId ?? raw.id);
      if (!npcId) return { error: 'start_dialogue requires npcId.' };
      return {
        action: {
          type: 'start_dialogue',
          npcId: resolveMaybeModRef(modId, npcId),
          ...(nonEmptyString(raw.treeId) ? { treeId: nonEmptyString(raw.treeId) } : {}),
        },
      };
    }
    case 'apply_status_effect':
    case 'status_effect':
    case 'buff': {
      const rawEffect = nonEmptyString(raw.effectType ?? raw.effect ?? raw.kind ?? raw.stat);
      if (!rawEffect) return { error: 'apply_status_effect requires effectType.' };
      const effectKey = rawEffect
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[\s-]+/g, '_')
        .toLowerCase();
      const validEffects = new Set<string>([
        'heal',
        'stamina',
        'heal_over_time',
        'speed_boost',
        'damage_boost',
        'defense_boost',
        'stamina_regen',
      ]);
      const mappedEffect =
        effectKey === 'health'
          ? 'heal'
          : effectKey === 'speed'
            ? 'speed_boost'
            : effectKey === 'damage' || effectKey === 'attack'
              ? 'damage_boost'
              : effectKey === 'defense' || effectKey === 'armor'
                ? 'defense_boost'
                : effectKey;
      if (!validEffects.has(mappedEffect)) {
        return { error: `Unsupported status effect "${rawEffect}".` };
      }
      const amount = finiteNum(raw.amount ?? raw.value);
      const multiplier = finiteNum(raw.multiplier);
      const durationSeconds = finiteNum(raw.durationSeconds ?? raw.duration);
      return {
        action: {
          type: 'apply_status_effect',
          effectType: mappedEffect as ModEventStatusEffectKind,
          ...(amount !== undefined ? { amount } : {}),
          ...(multiplier !== undefined ? { multiplier } : {}),
          ...(durationSeconds !== undefined
            ? { durationSeconds: Math.max(0.5, Math.min(300, durationSeconds)) }
            : {}),
        },
      };
    }
    case 'emit_event':
    case 'trigger_event':
    case 'dispatch_event': {
      const eventName = nonEmptyString(raw.eventName ?? raw.eventId ?? raw.name ?? raw.id);
      if (!eventName) return { error: 'emit_event requires eventName.' };
      const payload: Record<string, string | number | boolean> = {};
      if (isRecord(raw.payload)) {
        for (const [k, v] of Object.entries(raw.payload).slice(0, 16)) {
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            payload[k] = v;
          }
        }
      }
      return {
        action: {
          type: 'emit_event',
          eventName: resolveMaybeModRef(modId, eventName),
          ...(Object.keys(payload).length > 0 ? { payload } : {}),
        },
      };
    }
    default:
      return { error: `Unsupported event action type "${rawType}".` };
  }
}

export function sanitizeModEventDefinition(
  modId: string,
  rawEntry: unknown,
  sourceFile: string,
  diagnostics: ModDiagnostic[],
  options?: {
    index?: number;
    defaultTrigger?: Partial<ModEventTriggerSpec>;
  },
): ModEventDefinition | null {
  if (!isRecord(rawEntry)) {
    diagnostics.push({
      code: 'INVALID_EVENT_DEFINITION',
      severity: 'error',
      message: `${sourceFile}: Event entry must be a JSON object.`,
    });
    return null;
  }

  const forbiddenKey = findForbiddenCodeField(rawEntry);
  if (forbiddenKey) {
    diagnostics.push({
      code: 'UNSAFE_EVENT_SCRIPT',
      severity: 'error',
      message: `${sourceFile}: Event contains forbidden executable/prototype field "${forbiddenKey}".`,
    });
    return null;
  }

  const rawId =
    nonEmptyString(rawEntry.id) ??
    nonEmptyString(rawEntry.eventId) ??
    `event_${(options?.index ?? 0) + 1}`;
  const localOrNamespaced = rawId.includes(':')
    ? rawId
    : rawId.startsWith('event_')
      ? `${modId}:${rawId}`
      : `${modId}:${rawId}`;

  const idRes = resolveModObjectIdentifier(
    modId,
    localOrNamespaced,
    CORE_PROTECTED_IDS,
  );
  if (!idRes.ok) {
    diagnostics.push({
      code: idRes.code,
      severity: 'error',
      message: `${sourceFile}: ${idRes.message}`,
    });
    return null;
  }

  const fullId = idRes.fullId;
  const eventId = idRes.objectId;

  // Trigger parsing (supports trigger object OR triggerType string OR inline default)
  const rawTrigger = isRecord(rawEntry.trigger) ? rawEntry.trigger : null;
  const rawTriggerType =
    rawTrigger?.type ??
    rawTrigger?.event ??
    rawEntry.triggerType ??
    (typeof rawEntry.trigger === 'string' ? rawEntry.trigger : undefined) ??
    rawEntry.eventType ??
    options?.defaultTrigger?.type;

  const triggerType = normalizeTriggerType(rawTriggerType);
  if (!triggerType) {
    diagnostics.push({
      code: 'INVALID_EVENT_TRIGGER',
      severity: 'error',
      message: `${sourceFile} (${fullId}): Unsupported or missing trigger "${String(rawTriggerType ?? '')}".`,
    });
    return null;
  }

  const triggerSrc = rawTrigger ?? rawEntry;
  const trigger: ModEventTriggerSpec = {
    type: triggerType,
    ...(nonEmptyString(triggerSrc.npcId ?? options?.defaultTrigger?.npcId)
      ? { npcId: nonEmptyString(triggerSrc.npcId ?? options?.defaultTrigger?.npcId) }
      : {}),
    ...(nonEmptyString(triggerSrc.entityId ?? options?.defaultTrigger?.entityId)
      ? { entityId: nonEmptyString(triggerSrc.entityId ?? options?.defaultTrigger?.entityId) }
      : {}),
    ...(nonEmptyString(triggerSrc.entityCategory ?? options?.defaultTrigger?.entityCategory)
      ? {
          entityCategory: nonEmptyString(
            triggerSrc.entityCategory ?? options?.defaultTrigger?.entityCategory,
          )!.toLowerCase(),
        }
      : {}),
    ...(nonEmptyString(triggerSrc.itemId ?? options?.defaultTrigger?.itemId)
      ? { itemId: resolveMaybeModRef(modId, nonEmptyString(triggerSrc.itemId ?? options?.defaultTrigger?.itemId)!) }
      : {}),
    ...(nonEmptyString(triggerSrc.weaponId ?? options?.defaultTrigger?.weaponId)
      ? { weaponId: resolveMaybeModRef(modId, nonEmptyString(triggerSrc.weaponId ?? options?.defaultTrigger?.weaponId)!) }
      : {}),
    ...(nonEmptyString(triggerSrc.recipeId ?? options?.defaultTrigger?.recipeId)
      ? { recipeId: resolveMaybeModRef(modId, nonEmptyString(triggerSrc.recipeId ?? options?.defaultTrigger?.recipeId)!) }
      : {}),
    ...(nonEmptyString(triggerSrc.questId ?? options?.defaultTrigger?.questId)
      ? { questId: resolveMaybeModRef(modId, nonEmptyString(triggerSrc.questId ?? options?.defaultTrigger?.questId)!) }
      : {}),
    ...(nonEmptyString(triggerSrc.choiceId)
      ? { choiceId: nonEmptyString(triggerSrc.choiceId) }
      : {}),
    ...(nonEmptyString(triggerSrc.dialogueId)
      ? { dialogueId: nonEmptyString(triggerSrc.dialogueId) }
      : {}),
    ...(nonEmptyString(triggerSrc.buildingId)
      ? { buildingId: resolveMaybeModRef(modId, nonEmptyString(triggerSrc.buildingId)!) }
      : {}),
    ...(nonEmptyString(triggerSrc.blockType)
      ? { blockType: nonEmptyString(triggerSrc.blockType) }
      : {}),
    ...(nonEmptyString(triggerSrc.resourceKind)
      ? { resourceKind: nonEmptyString(triggerSrc.resourceKind) }
      : {}),
    ...(nonEmptyString(triggerSrc.eventName ?? triggerSrc.customEventId)
      ? {
          eventName: resolveMaybeModRef(
            modId,
            nonEmptyString(triggerSrc.eventName ?? triggerSrc.customEventId)!,
          ),
        }
      : {}),
    ...(finiteNum(triggerSrc.targetLevel) !== undefined
      ? { targetLevel: finiteNum(triggerSrc.targetLevel) }
      : {}),
    ...(finiteNum(triggerSrc.minLevel) !== undefined
      ? { minLevel: finiteNum(triggerSrc.minLevel) }
      : {}),
    ...(typeof triggerSrc.allowNonPlayerKill === 'boolean'
      ? { allowNonPlayerKill: triggerSrc.allowNonPlayerKill }
      : {}),
    ...(typeof triggerSrc.allowEnvironmentalDeath === 'boolean'
      ? { allowEnvironmentalDeath: triggerSrc.allowEnvironmentalDeath }
      : {}),
  };

  if (
    triggerSrc.area !== undefined ||
    triggerSrc.position !== undefined ||
    (triggerSrc.x !== undefined && triggerSrc.z !== undefined)
  ) {
    const areaRes = parseAreaSpec(triggerSrc.area ?? triggerSrc.position ?? triggerSrc);
    if (!areaRes.ok) {
      diagnostics.push({
        code: 'INVALID_EVENT_CONDITION',
        severity: 'error',
        message: `${sourceFile} (${fullId}): ${areaRes.reason}`,
      });
      return null;
    }
    trigger.area = areaRes.area;
  }

  // Conditions
  let condition: ModEventConditionNode | null = null;
  let validationError: { code: string; message: string } | undefined;
  const rawCondition = rawEntry.conditions ?? rawEntry.condition;
  if (rawCondition !== undefined && rawCondition !== null) {
    if (Array.isArray(rawCondition)) {
      const parsed = parseConditionNode(modId, { all: rawCondition }, 0);
      condition = parsed.node;
      if (parsed.error) {
        validationError = { code: 'INVALID_EVENT_CONDITION', message: parsed.error };
      }
    } else {
      const parsed = parseConditionNode(modId, rawCondition, 0);
      condition = parsed.node;
      if (parsed.error) {
        validationError = { code: 'INVALID_EVENT_CONDITION', message: parsed.error };
      }
    }
  }

  if (validationError) {
    diagnostics.push({
      code: validationError.code,
      severity: 'error',
      message: `${sourceFile} (${fullId}): ${validationError.message}`,
    });
  }

  // Actions / Rewards (supports `actions` and `rewards` aliases)
  const rawActionsSource = rawEntry.actions ?? rawEntry.rewards ?? [];
  const rawActionList = Array.isArray(rawActionsSource)
    ? rawActionsSource
    : isRecord(rawActionsSource)
      ? [rawActionsSource]
      : [];
  const actions: ModEventAction[] = [];
  for (const rawAct of rawActionList.slice(0, MAX_EVENT_ACTIONS)) {
    const res = sanitizeAction(modId, rawAct);
    if (res.error || !res.action) {
      const msg = res.error ?? 'Invalid event action.';
      validationError = validationError ?? { code: 'INVALID_EVENT_ACTION', message: msg };
      diagnostics.push({
        code: 'INVALID_EVENT_ACTION',
        severity: 'error',
        message: `${sourceFile} (${fullId}): ${msg}`,
      });
    } else {
      actions.push(res.action);
    }
  }

  // Execution mode
  let executionMode: ModEventExecutionMode = 'once_per_world';
  const rawMode = nonEmptyString(rawEntry.executionMode ?? rawEntry.repeatMode ?? rawEntry.scope)?.toLowerCase();
  const cooldownSeconds = Math.max(
    0,
    Math.min(86400, finiteNum(rawEntry.cooldownSeconds ?? rawEntry.cooldown) ?? 0),
  );
  const maxExecutionsRaw = finiteNum(rawEntry.maxExecutions ?? rawEntry.limit);
  const maxExecutions =
    maxExecutionsRaw !== undefined && maxExecutionsRaw >= 1
      ? Math.floor(maxExecutionsRaw)
      : undefined;

  if (
    rawMode === 'once_per_world' ||
    rawMode === 'world' ||
    rawMode === 'one_time_world'
  ) {
    executionMode = 'once_per_world';
  } else if (rawMode === 'once_per_player' || rawMode === 'player') {
    executionMode = 'once_per_player';
  } else if (
    rawMode === 'once_per_player_per_world' ||
    rawMode === 'player_world' ||
    rawMode === 'per_player_world'
  ) {
    executionMode = 'once_per_player_per_world';
  } else if (rawMode === 'once_per_event' || rawMode === 'event' || rawMode === 'per_instance') {
    executionMode = 'once_per_event';
  } else if (rawMode === 'repeatable_with_cooldown' || rawMode === 'cooldown') {
    executionMode = 'repeatable_with_cooldown';
  } else if (rawMode === 'max_executions') {
    executionMode = 'max_executions';
  } else if (rawMode === 'repeatable') {
    executionMode = cooldownSeconds > 0 ? 'repeatable_with_cooldown' : 'repeatable';
  } else if (rawEntry.repeatable === true) {
    executionMode =
      maxExecutions !== undefined
        ? 'max_executions'
        : cooldownSeconds > 0
          ? 'repeatable_with_cooldown'
          : 'repeatable';
  } else if (rawEntry.once === false && rawEntry.oneTime === false) {
    executionMode = cooldownSeconds > 0 ? 'repeatable_with_cooldown' : 'repeatable';
  } else if (maxExecutions !== undefined && !rawMode) {
    executionMode = 'max_executions';
  }

  const priority = Math.max(-1000, Math.min(1000, finiteNum(rawEntry.priority) ?? 0));
  const timingRaw = nonEmptyString(rawEntry.executionTiming ?? rawEntry.timing)?.toLowerCase();
  const executionTiming: 'sync' | 'queued' = timingRaw === 'queued' ? 'queued' : 'sync';
  const delaySeconds = Math.max(0, Math.min(60, finiteNum(rawEntry.delaySeconds) ?? 0));
  const inventoryFullPolicy =
    parseInventoryPolicy(rawEntry.inventoryFullPolicy ?? rawEntry.onInventoryFull) ??
    'spawn_pickup';
  const multiplayerAuthority =
    parseAuthorityMode(rawEntry.multiplayerAuthority ?? rawEntry.authority) ?? 'any';

  const schemaVersion = finiteNum(rawEntry.schemaVersion) ?? 2;

  return {
    id: fullId,
    eventId,
    modId,
    ...(nonEmptyString(rawEntry.name) ? { name: nonEmptyString(rawEntry.name) } : {}),
    ...(nonEmptyString(rawEntry.description)
      ? { description: nonEmptyString(rawEntry.description) }
      : {}),
    sourceFile,
    schemaVersion,
    enabled: rawEntry.enabled !== false,
    trigger,
    condition,
    actions,
    executionMode,
    cooldownSeconds,
    ...(maxExecutions !== undefined ? { maxExecutions } : {}),
    priority,
    executionTiming,
    delaySeconds,
    inventoryFullPolicy,
    multiplayerAuthority,
    ...(validationError ? { validationError } : {}),
    raw: rawEntry,
  };
}

export function extractInlineEventDefinitions(
  modId: string,
  rawOwner: unknown,
  sourceFile: string,
  diagnostics: ModDiagnostic[],
  defaultTrigger?: Partial<ModEventTriggerSpec>,
): ModEventDefinition[] {
  if (!isRecord(rawOwner)) return [];
  const rawList = Array.isArray(rawOwner.events)
    ? rawOwner.events
    : Array.isArray(rawOwner.triggers)
      ? rawOwner.triggers
      : isRecord(rawOwner.event)
        ? [rawOwner.event]
        : [];
  const out: ModEventDefinition[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const def = sanitizeModEventDefinition(modId, rawList[i], sourceFile, diagnostics, {
      index: i,
      defaultTrigger,
    });
    if (def) out.push(def);
  }
  return out;
}

export interface ModEventCrossReferenceResolvers {
  hasItemOrWeapon: (itemId: string) => boolean;
  hasRecipe: (recipeId: string) => boolean;
  hasQuest: (questId: string) => boolean;
  hasSound: (soundId: string) => boolean;
  hasEntityOrBlueprint: (contentId: string) => boolean;
}

export function validateModEventCrossReferences(
  eventDef: ModEventDefinition,
  resolvers: ModEventCrossReferenceResolvers,
): ModDiagnostic[] {
  const diags: ModDiagnostic[] = [];
  for (const action of eventDef.actions) {
    if (action.type === 'give_item' || action.type === 'give_weapon' || action.type === 'spawn_world_pickup') {
      if (!resolvers.hasItemOrWeapon(action.itemId)) {
        diags.push({
          code: 'MOD_EVENT_UNKNOWN_ITEM',
          severity: 'warning',
          message: `Mod event "${eventDef.id}" references unknown item/weapon "${action.itemId}".`,
        });
      }
    } else if (action.type === 'give_items') {
      for (const it of action.items) {
        if (!resolvers.hasItemOrWeapon(it.itemId)) {
          diags.push({
            code: 'MOD_EVENT_UNKNOWN_ITEM',
            severity: 'warning',
            message: `Mod event "${eventDef.id}" references unknown item "${it.itemId}".`,
          });
        }
      }
    } else if (action.type === 'unlock_recipe') {
      if (!resolvers.hasRecipe(action.recipeId)) {
        diags.push({
          code: 'MOD_EVENT_UNKNOWN_RECIPE',
          severity: 'warning',
          message: `Mod event "${eventDef.id}" references unknown recipe "${action.recipeId}".`,
        });
      }
    } else if (action.type === 'start_quest' || action.type === 'complete_quest') {
      if (!resolvers.hasQuest(action.questId)) {
        diags.push({
          code: 'MOD_EVENT_UNKNOWN_QUEST',
          severity: 'warning',
          message: `Mod event "${eventDef.id}" references unknown quest "${action.questId}".`,
        });
      }
    } else if (action.type === 'play_sound') {
      if (!resolvers.hasSound(action.soundId)) {
        diags.push({
          code: 'MOD_EVENT_UNKNOWN_SOUND',
          severity: 'warning',
          message: `Mod event "${eventDef.id}" references unknown sound "${action.soundId}".`,
        });
      }
    } else if (action.type === 'spawn_entity') {
      if (!resolvers.hasEntityOrBlueprint(action.contentId)) {
        diags.push({
          code: 'MOD_EVENT_UNKNOWN_ENTITY',
          severity: 'warning',
          message: `Mod event "${eventDef.id}" references unknown entity "${action.contentId}".`,
        });
      }
    }
  }
  return diags;
}
