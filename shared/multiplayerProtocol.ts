import { migrateAvatarConfig, type AvatarConfig } from './profileTypes';

export type MultiplayerWorldType = 'normal' | 'adventure' | 'survival' | 'creative';
export type MultiplayerDifficultyLevel = 'easy' | 'normal' | 'hard';
export type WorldType = MultiplayerWorldType;
export type DifficultyLevel = MultiplayerDifficultyLevel;

export const MULTIPLAYER_PROTOCOL_VERSION = 1 as const;
export const MAX_WS_MESSAGE_BYTES = 4096;
export const MAX_PLAYERS_PER_ROOM = 32;
export const ALLOWED_MAX_PLAYER_COUNTS = [2, 4, 8, 16, 32] as const;
export const MIN_PLAYERS_PER_ROOM = 2;
export const MAX_ROOM_NAME_LENGTH = 36;
export const MAX_PLAYER_NAME_LENGTH = 24;
export const MAX_GAME_EVENT_NAME_LENGTH = 48;
export const MAX_CHAT_MESSAGE_LENGTH = 240;
export const CHAT_RATE_COOLDOWN_MS = 900;
export const CHAT_HISTORY_LIMIT = 40;
export const PLAYER_REPORT_DETAILS_MAX_LENGTH = 200;
export const MAX_PLAYABLE_COORD = 3600;
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_TIMEOUT_MS = 45_000;
export const HOST_DISCONNECT_GRACE_MS = 12_000;
export const PLAYER_RECONNECT_GRACE_MS = 45_000;
export const MAX_RECONNECT_ATTEMPTS = 6;
export const ROOM_INACTIVE_TIMEOUT_MS = 72 * 60 * 60 * 1000;
export const MAX_WEATHER_DURATION_MS = 900_000;
export const MAX_PLAYER_COINS = 1_000_000;
export const MAX_PLAYER_LEVEL = 100;
export const MAX_AMMO_COUNT = 240;
export const MAX_ITEM_STACK_CAP = 200;
export const MAX_REPAIR_COST_COINS = 500;

export type RoomPrivacy = 'public' | 'friends' | 'private';
export type RoomStatus = 'waiting' | 'starting' | 'in-game' | 'closed';
export type ConnectionQuality = 'excellent' | 'good' | 'poor' | 'disconnected';
export type WorldSettingsPermission = 'HOST_ONLY' | 'ALL_PLAYERS';
export type WorldTimePreset = 'sunrise' | 'noon' | 'sunset' | 'midnight';
export type WorldWeatherState = 'clear' | 'cloudy' | 'overcast' | 'rain' | 'storm' | 'fog';

export const AVATAR_PALETTE = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#8b5cf6',
  '#06b6d4',
  '#ef4444',
  '#84cc16',
] as const;

export function pickAvatarColor(seedText: string): string {
  let hash = 0;
  for (let i = 0; i < seedText.length; i++) {
    hash = (hash * 31 + seedText.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export function getConnectionQuality(
  pingMs: number | null | undefined,
  isConnected = true,
): ConnectionQuality {
  if (!isConnected) return 'disconnected';
  if (pingMs === null || pingMs === undefined || !Number.isFinite(pingMs) || pingMs < 0) {
    return 'good';
  }
  if (pingMs < 80) return 'excellent';
  if (pingMs < 180) return 'good';
  return 'poor';
}

export type SyncedEntityKind = 'npc' | 'animal' | 'enemy';

export interface ServerWeaponSpec {
  id: string;
  baseDamage: number;
  minDamage?: number;
  maxDamage?: number;
  range: number;
  cooldownMs: number;
  isRanged: boolean;
  critMult: number;
  critChance: number;
  headshotMult?: number;
  minSpeed?: number;
  maxSpeed?: number;
  gravity?: number;
}

export const SERVER_WEAPON_SPECS: Record<string, ServerWeaponSpec> = {
  unarmed: {
    id: 'unarmed',
    baseDamage: 9,
    range: 2.1,
    cooldownMs: 300,
    isRanged: false,
    critMult: 1.0,
    critChance: 0,
  },
  'ranger-sword': {
    id: 'ranger-sword',
    baseDamage: 26,
    range: 2.85,
    cooldownMs: 340,
    isRanged: false,
    critMult: 1.5,
    critChance: 0.18,
  },
  'wooden-sword': {
    id: 'wooden-sword',
    baseDamage: 16,
    range: 2.6,
    cooldownMs: 320,
    isRanged: false,
    critMult: 1.5,
    critChance: 0.12,
  },
  'iron-sword': {
    id: 'iron-sword',
    baseDamage: 34,
    range: 2.95,
    cooldownMs: 360,
    isRanged: false,
    critMult: 1.5,
    critChance: 0.2,
  },
  'steel-sword': {
    id: 'steel-sword',
    baseDamage: 44,
    range: 3.05,
    cooldownMs: 320,
    isRanged: false,
    critMult: 1.5,
    critChance: 0.26,
  },
  'woodland-axe': {
    id: 'woodland-axe',
    baseDamage: 42,
    range: 2.95,
    cooldownMs: 580,
    isRanged: false,
    critMult: 1.75,
    critChance: 0.15,
  },
  'battle-axe': {
    id: 'battle-axe',
    baseDamage: 52,
    range: 3.1,
    cooldownMs: 620,
    isRanged: false,
    critMult: 1.75,
    critChance: 0.18,
  },
  'hunter-knife': {
    id: 'hunter-knife',
    baseDamage: 22,
    range: 2.25,
    cooldownMs: 210,
    isRanged: false,
    critMult: 1.75,
    critChance: 0.34,
  },
  spear: {
    id: 'spear',
    baseDamage: 36,
    range: 3.85,
    cooldownMs: 440,
    isRanged: false,
    critMult: 1.6,
    critChance: 0.22,
  },
  'hunter-bow': {
    id: 'hunter-bow',
    baseDamage: 32,
    minDamage: 10,
    maxDamage: 50,
    range: 52,
    cooldownMs: 360,
    isRanged: true,
    critMult: 1.65,
    critChance: 0.24,
    headshotMult: 2.0,
    minSpeed: 15,
    maxSpeed: 45,
    gravity: 9.8,
  },
  crossbow: {
    id: 'crossbow',
    baseDamage: 46,
    minDamage: 16,
    maxDamage: 66,
    range: 58,
    cooldownMs: 560,
    isRanged: true,
    critMult: 1.65,
    critChance: 0.28,
    headshotMult: 2.0,
    minSpeed: 22,
    maxSpeed: 56,
    gravity: 6.2,
  },
  'stone-club': {
    id: 'stone-club',
    baseDamage: 22,
    range: 2.65,
    cooldownMs: 620,
    isRanged: false,
    critMult: 1.5,
    critChance: 0.12,
  },
  'copper-sword': {
    id: 'copper-sword',
    baseDamage: 24,
    range: 2.8,
    cooldownMs: 410,
    isRanged: false,
    critMult: 1.5,
    critChance: 0.17,
  },
  'bronze-spear': {
    id: 'bronze-spear',
    baseDamage: 30,
    range: 3.7,
    cooldownMs: 520,
    isRanged: false,
    critMult: 1.6,
    critChance: 0.2,
  },
  'silver-sword': {
    id: 'silver-sword',
    baseDamage: 40,
    range: 3.0,
    cooldownMs: 390,
    isRanged: false,
    critMult: 1.5,
    critChance: 0.24,
  },
};

export const SERVER_ENEMY_MAX_HP: Record<string, number> = {
  bandit_scout: 65,
  thorn_stalker: 50,
  stone_sentinel: 120,
  ancient_monster: 95,
  ancient_guardian: 420,
};

export const SERVER_ENEMY_ATTACK_MAX_DAMAGE: Record<string, number> = {
  bandit_scout: 18,
  thorn_stalker: 16,
  stone_sentinel: 32,
  ancient_monster: 30,
  ancient_guardian: 58,
  wolf: 15,
  bear: 28,
  default: 30,
};

export type QuestScope = 'personal' | 'cooperative';
export type LootDistributionMode = 'personal' | 'shared' | 'world_drop';
export type BossAttackState =
  | 'idle'
  | 'windup_strike'
  | 'windup_slam'
  | 'enraged_roar'
  | 'recover';

export interface LootItemDropSpec {
  itemId: string;
  count: number;
  label?: string;
  chance?: number;
}

export interface EnemyLootTableSpec {
  archetype: string;
  isBoss?: boolean;
  personal: {
    xp: number;
    coins: number;
    items?: LootItemDropSpec[];
  };
  shared?: {
    xpPool: number;
    coinsPool: number;
    items?: LootItemDropSpec[];
  };
  worldDrops?: LootItemDropSpec[];
}

export const ENEMY_LOOT_TABLES: Record<string, EnemyLootTableSpec> = {
  bandit_scout: {
    archetype: 'bandit_scout',
    personal: {
      xp: 28,
      coins: 14,
      items: [{ itemId: 'arrow', count: 3, chance: 0.7 }],
    },
    worldDrops: [
      { itemId: 'hearth-loaf', count: 1, label: 'Sunstone Hearth Loaf', chance: 0.45 },
    ],
  },
  thorn_stalker: {
    archetype: 'thorn_stalker',
    personal: {
      xp: 24,
      coins: 10,
      items: [{ itemId: 'meadow-herb', count: 1, chance: 0.65 }],
    },
    worldDrops: [
      { itemId: 'mushroom', count: 1, label: 'Forest Mushroom', chance: 0.5 },
    ],
  },
  stone_sentinel: {
    archetype: 'stone_sentinel',
    personal: {
      xp: 48,
      coins: 28,
      items: [{ itemId: 'iron-ore', count: 2, chance: 0.85 }],
    },
    shared: {
      xpPool: 24,
      coinsPool: 16,
      items: [{ itemId: 'coal', count: 2 }],
    },
    worldDrops: [
      { itemId: 'rare-mineral', count: 1, label: 'Sunstone Crystal', chance: 0.65 },
    ],
  },
  ancient_monster: {
    archetype: 'ancient_monster',
    personal: {
      xp: 42,
      coins: 22,
      items: [{ itemId: 'iron-ore', count: 1, chance: 0.75 }],
    },
    shared: {
      xpPool: 20,
      coinsPool: 14,
    },
    worldDrops: [
      { itemId: 'apothecary-tonic', count: 1, label: 'Apothecary Vitality Tonic', chance: 0.4 },
    ],
  },
  ancient_guardian: {
    archetype: 'ancient_guardian',
    isBoss: true,
    personal: {
      xp: 180,
      coins: 95,
      items: [{ itemId: 'apothecary-tonic', count: 1, chance: 1 }],
    },
    shared: {
      xpPool: 120,
      coinsPool: 80,
      items: [{ itemId: 'rare-mineral', count: 2 }],
    },
    worldDrops: [
      { itemId: 'gold-ore', count: 3, label: 'Gold Ore Cache', chance: 1 },
      { itemId: 'steel-sword', count: 1, label: 'Tempered Steel Blade', chance: 0.5 },
    ],
  },
};

export interface QuestServerRewardSpec {
  questId: string;
  scope: QuestScope;
  xp: number;
  coins: number;
  items?: Array<{ itemId: string; count: number }>;
  requiredCount?: number;
  targetEnemyType?: string;
}

export const QUEST_SERVER_REWARDS: Record<string, QuestServerRewardSpec> = {
  'quest-help-village': { questId: 'quest-help-village', scope: 'personal', xp: 100, coins: 50 },
  'quest-herbalist-tonic': {
    questId: 'quest-herbalist-tonic',
    scope: 'personal',
    xp: 75,
    coins: 30,
    items: [{ itemId: 'apothecary-tonic', count: 1 }],
  },
  'quest-bakery-delivery': {
    questId: 'quest-bakery-delivery',
    scope: 'personal',
    xp: 60,
    coins: 25,
    items: [{ itemId: 'hearth-loaf', count: 1 }],
  },
  'quest-valley-survey': {
    questId: 'quest-valley-survey',
    scope: 'personal',
    xp: 90,
    coins: 40,
    items: [{ itemId: 'chronicler-seal', count: 1 }],
  },
  'quest-ridge-scouting': { questId: 'quest-ridge-scouting', scope: 'personal', xp: 85, coins: 35 },
  'quest-desert-expedition': { questId: 'quest-desert-expedition', scope: 'personal', xp: 80, coins: 45 },
  'quest-build-shelter': {
    questId: 'quest-build-shelter',
    scope: 'personal',
    xp: 95,
    coins: 40,
    items: [{ itemId: 'hearth-loaf', count: 1 }],
  },
  'quest-first-night': { questId: 'quest-first-night', scope: 'personal', xp: 100, coins: 50 },
  'quest-the-village': { questId: 'quest-the-village', scope: 'personal', xp: 150, coins: 90 },
  'quest-the-blacksmith': {
    questId: 'quest-the-blacksmith',
    scope: 'personal',
    xp: 125,
    coins: 65,
    items: [{ itemId: 'coal', count: 4 }],
  },
  'quest-the-hunter': {
    questId: 'quest-the-hunter',
    scope: 'personal',
    xp: 130,
    coins: 70,
    items: [{ itemId: 'arrow', count: 10 }],
  },
  'quest-into-the-wild': { questId: 'quest-into-the-wild', scope: 'personal', xp: 160, coins: 95 },
  'quest-the-merchant': {
    questId: 'quest-the-merchant',
    scope: 'personal',
    xp: 110,
    coins: 75,
    items: [{ itemId: 'cooked-meat', count: 2 }],
  },
  'quest-coop-ancient-monster': {
    questId: 'quest-coop-ancient-monster',
    scope: 'cooperative',
    xp: 140,
    coins: 80,
    items: [{ itemId: 'apothecary-tonic', count: 1 }],
    requiredCount: 5,
    targetEnemyType: 'ancient_monster',
  },
  'quest-coop-ancient-guardian': {
    questId: 'quest-coop-ancient-guardian',
    scope: 'cooperative',
    xp: 240,
    coins: 150,
    items: [{ itemId: 'rare-mineral', count: 2 }],
    requiredCount: 1,
    targetEnemyType: 'ancient_guardian',
  },
  'quest-coop-sanctuary-watch': {
    questId: 'quest-coop-sanctuary-watch',
    scope: 'cooperative',
    xp: 115,
    coins: 65,
    items: [{ itemId: 'arrow', count: 12 }],
    requiredCount: 4,
    targetEnemyType: 'bandit_scout',
  },
};

export interface SideQuestServerRewardSpec {
  sideQuestId: string;
  xp: number;
  coins: number;
  items?: Array<{ itemId: string; count: number }>;
  repeatable: boolean;
  cooldownMs: number;
}

export const SIDE_QUEST_SERVER_REWARDS: Record<string, SideQuestServerRewardSpec> = {
  'sq-missing-merchant': {
    sideQuestId: 'sq-missing-merchant',
    xp: 140,
    coins: 85,
    items: [{ itemId: 'hearth-loaf', count: 2 }],
    repeatable: false,
    cooldownMs: 0,
  },
  'sq-merchant-secret': {
    sideQuestId: 'sq-merchant-secret',
    xp: 125,
    coins: 75,
    items: [{ itemId: 'apothecary-tonic', count: 1 }],
    repeatable: false,
    cooldownMs: 0,
  },
  'sq-hidden-warehouse': {
    sideQuestId: 'sq-hidden-warehouse',
    xp: 165,
    coins: 110,
    items: [{ itemId: 'steel-sword', count: 1 }],
    repeatable: false,
    cooldownMs: 0,
  },
  'sq-old-debt': {
    sideQuestId: 'sq-old-debt',
    xp: 200,
    coins: 150,
    items: [{ itemId: 'frontier-badge-cloak', count: 1 }],
    repeatable: false,
    cooldownMs: 0,
  },
  'sq-bakery-rush': {
    sideQuestId: 'sq-bakery-rush',
    xp: 95,
    coins: 55,
    items: [{ itemId: 'sun-apple', count: 3 }],
    repeatable: false,
    cooldownMs: 0,
  },
  'sq-herbalist-moonlight': {
    sideQuestId: 'sq-herbalist-moonlight',
    xp: 110,
    coins: 50,
    items: [{ itemId: 'nightshade-vial', count: 2 }],
    repeatable: false,
    cooldownMs: 0,
  },
  'sq-barn-timber-repair': {
    sideQuestId: 'sq-barn-timber-repair',
    xp: 70,
    coins: 40,
    items: [{ itemId: 'wheat', count: 4 }],
    repeatable: true,
    cooldownMs: 240_000,
  },
  'sq-iron-forge-order': {
    sideQuestId: 'sq-iron-forge-order',
    xp: 120,
    coins: 70,
    items: [{ itemId: 'iron-sword', count: 1 }],
    repeatable: false,
    cooldownMs: 0,
  },
  'sq-wolves-at-pasture': {
    sideQuestId: 'sq-wolves-at-pasture',
    xp: 95,
    coins: 60,
    items: [{ itemId: 'cooked-meat', count: 2 }],
    repeatable: true,
    cooldownMs: 180_000,
  },
  'sq-bandit-bounty': {
    sideQuestId: 'sq-bandit-bounty',
    xp: 135,
    coins: 95,
    items: [{ itemId: 'arrow', count: 14 }],
    repeatable: true,
    cooldownMs: 300_000,
  },
  'sq-starlight-beacon': {
    sideQuestId: 'sq-starlight-beacon',
    xp: 120,
    coins: 65,
    items: [{ itemId: 'trail-boots', count: 1 }],
    repeatable: false,
    cooldownMs: 0,
  },
  'sq-echoes-in-cavern': {
    sideQuestId: 'sq-echoes-in-cavern',
    xp: 185,
    coins: 120,
    items: [{ itemId: 'crossbow', count: 1 }],
    repeatable: false,
    cooldownMs: 0,
  },
  'sq-rescue-herbal-scout': {
    sideQuestId: 'sq-rescue-herbal-scout',
    xp: 115,
    coins: 60,
    items: [
      { itemId: 'apothecary-tonic', count: 2 },
      { itemId: 'meadow-herb', count: 3 },
    ],
    repeatable: false,
    cooldownMs: 0,
  },
  'sq-oakhollow-homestead': {
    sideQuestId: 'sq-oakhollow-homestead',
    xp: 125,
    coins: 75,
    items: [
      { itemId: 'planks', count: 8 },
      { itemId: 'wheat', count: 5 },
    ],
    repeatable: false,
    cooldownMs: 0,
  },
  'sq-frontier-workshop': {
    sideQuestId: 'sq-frontier-workshop',
    xp: 140,
    coins: 85,
    items: [
      { itemId: 'iron-ingot', count: 4 },
      { itemId: 'stone-brick', count: 6 },
    ],
    repeatable: false,
    cooldownMs: 0,
  },
  'sq-oakhollow-seeds': {
    sideQuestId: 'sq-oakhollow-seeds',
    xp: 95,
    coins: 50,
    items: [
      { itemId: 'watering-can', count: 1 },
      { itemId: 'corn-seeds', count: 3 },
    ],
    repeatable: false,
    cooldownMs: 0,
  },
  'sq-farm-livestock': {
    sideQuestId: 'sq-farm-livestock',
    xp: 115,
    coins: 65,
    items: [
      { itemId: 'animal-feed', count: 4 },
      { itemId: 'cheese', count: 2 },
    ],
    repeatable: false,
    cooldownMs: 0,
  },
  'sq-village-revival': {
    sideQuestId: 'sq-village-revival',
    xp: 145,
    coins: 95,
    items: [
      { itemId: 'tomato-seeds', count: 3 },
      { itemId: 'potato-seeds', count: 3 },
    ],
    repeatable: false,
    cooldownMs: 0,
  },
};

const SERVER_ENEMY_ALIAS_MAP: Record<string, string> = {
  thief: 'bandit_scout',
  thieves: 'bandit_scout',
  bandit: 'bandit_scout',
  bandits: 'bandit_scout',
  bandit_scout: 'bandit_scout',
  raider: 'bandit_scout',
  raiders: 'bandit_scout',
  stalker: 'thorn_stalker',
  thorn_stalker: 'thorn_stalker',
  sentinel: 'stone_sentinel',
  golem: 'stone_sentinel',
  stone_sentinel: 'stone_sentinel',
  monster: 'ancient_monster',
  monsters: 'ancient_monster',
  ancient_monster: 'ancient_monster',
  boss: 'ancient_guardian',
  guardian: 'ancient_guardian',
  ancient_guardian: 'ancient_guardian',
};

export function normalizeServerEnemyAlias(rawType: string): string {
  const clean = rawType.trim().toLowerCase();
  if (!clean) return 'any';
  if (clean === 'any' || clean.startsWith('animal:')) return clean;
  return SERVER_ENEMY_ALIAS_MAP[clean] ?? clean;
}

export function serverEnemyTypeMatches(expectedType: string, actualType: string): boolean {
  const expected = normalizeServerEnemyAlias(expectedType);
  if (expected === 'any') return true;
  if (expected === 'animal:any') {
    return actualType.trim().toLowerCase().startsWith('animal:');
  }
  return expected === normalizeServerEnemyAlias(actualType);
}

export const SERVER_ANIMAL_MAX_HP: Record<string, number> = {
  deer: 55,
  rabbit: 22,
  wolf: 68,
  bear: 135,
  bird: 14,
  cow: 80,
  sheep: 45,
  chicken: 16,
};

export const SERVER_NPC_MAX_HP: Record<string, number> = {
  guard: 140,
  default: 100,
};

export interface ServerItemSpec {
  id: string;
  maxStack: number;
  usable: boolean;
  droppable: boolean;
  isWeapon?: boolean;
  forbidStaticPickup?: boolean;
}

export const SERVER_ITEM_CATALOG: Record<string, ServerItemSpec> = {
  compass: { id: 'compass', maxStack: 1, usable: false, droppable: false, forbidStaticPickup: true },
  journal: { id: 'journal', maxStack: 1, usable: false, droppable: false, forbidStaticPickup: true },
  'meadow-herb': { id: 'meadow-herb', maxStack: 60, usable: true, droppable: true },
  herb: { id: 'herb', maxStack: 60, usable: true, droppable: true },
  'sun-apple': { id: 'sun-apple', maxStack: 60, usable: true, droppable: true },
  apple: { id: 'apple', maxStack: 60, usable: true, droppable: true },
  'hearth-loaf': { id: 'hearth-loaf', maxStack: 40, usable: true, droppable: true },
  'apothecary-tonic': { id: 'apothecary-tonic', maxStack: 40, usable: true, droppable: true },
  'farm-grain': { id: 'farm-grain', maxStack: 10, usable: false, droppable: false, forbidStaticPickup: true },
  'chronicler-seal': { id: 'chronicler-seal', maxStack: 1, usable: false, droppable: false, forbidStaticPickup: true },
  'trail-boots': { id: 'trail-boots', maxStack: 2, usable: true, droppable: true, forbidStaticPickup: true },
  'warden-cloak': { id: 'warden-cloak', maxStack: 2, usable: true, droppable: true, forbidStaticPickup: true },
  'leather-armor': { id: 'leather-armor', maxStack: 2, usable: true, droppable: true, forbidStaticPickup: true },
  'ranger-sword': { id: 'ranger-sword', maxStack: 4, usable: true, droppable: true, isWeapon: true, forbidStaticPickup: true },
  'woodland-axe': { id: 'woodland-axe', maxStack: 4, usable: true, droppable: true, isWeapon: true, forbidStaticPickup: true },
  'hunter-bow': { id: 'hunter-bow', maxStack: 4, usable: true, droppable: true, isWeapon: true, forbidStaticPickup: true },
  'wooden-sword': { id: 'wooden-sword', maxStack: 4, usable: true, droppable: true, isWeapon: true, forbidStaticPickup: true },
  'iron-sword': { id: 'iron-sword', maxStack: 4, usable: true, droppable: true, isWeapon: true, forbidStaticPickup: true },
  'steel-sword': { id: 'steel-sword', maxStack: 4, usable: true, droppable: true, isWeapon: true, forbidStaticPickup: true },
  'battle-axe': { id: 'battle-axe', maxStack: 4, usable: true, droppable: true, isWeapon: true, forbidStaticPickup: true },
  spear: { id: 'spear', maxStack: 4, usable: true, droppable: true, isWeapon: true, forbidStaticPickup: true },
  crossbow: { id: 'crossbow', maxStack: 4, usable: true, droppable: true, isWeapon: true, forbidStaticPickup: true },
  'hunter-knife': { id: 'hunter-knife', maxStack: 4, usable: true, droppable: true, isWeapon: true, forbidStaticPickup: true },
  wood: { id: 'wood', maxStack: 200, usable: false, droppable: true },
  stone: { id: 'stone', maxStack: 200, usable: false, droppable: true },
  'iron-ore': { id: 'iron-ore', maxStack: 160, usable: false, droppable: true },
  coal: { id: 'coal', maxStack: 160, usable: false, droppable: true },
  fiber: { id: 'fiber', maxStack: 200, usable: false, droppable: true },
  hide: { id: 'hide', maxStack: 120, usable: false, droppable: true },
  leather: { id: 'leather', maxStack: 120, usable: false, droppable: true },
  wool: { id: 'wool', maxStack: 120, usable: false, droppable: true },
  feathers: { id: 'feathers', maxStack: 160, usable: false, droppable: true },
  fur: { id: 'fur', maxStack: 120, usable: false, droppable: true },
  arrow: { id: 'arrow', maxStack: MAX_AMMO_COUNT, usable: false, droppable: true },
  meat: { id: 'meat', maxStack: 80, usable: true, droppable: true },
  'cooked-meat': { id: 'cooked-meat', maxStack: 80, usable: true, droppable: true },
  torch: { id: 'torch', maxStack: 40, usable: false, droppable: true },
  bed: { id: 'bed', maxStack: 10, usable: true, droppable: true },
  mushroom: { id: 'mushroom', maxStack: 120, usable: true, droppable: true },
  berries: { id: 'berries', maxStack: 120, usable: true, droppable: true },
  flower: { id: 'flower', maxStack: 160, usable: false, droppable: true },
  sand: { id: 'sand', maxStack: 200, usable: false, droppable: true },
  cactus: { id: 'cactus', maxStack: 120, usable: true, droppable: true },
  'desert-plant': { id: 'desert-plant', maxStack: 160, usable: false, droppable: true },
  shell: { id: 'shell', maxStack: 160, usable: false, droppable: true },
  driftwood: { id: 'driftwood', maxStack: 200, usable: false, droppable: true },
  'rare-mineral': { id: 'rare-mineral', maxStack: 100, usable: false, droppable: true },
  'gold-ore': { id: 'gold-ore', maxStack: 160, usable: false, droppable: true },
  clay: { id: 'clay', maxStack: 200, usable: false, droppable: true },
  wheat: { id: 'wheat', maxStack: 200, usable: false, droppable: true },
  'traveler-satchel': { id: 'traveler-satchel', maxStack: 1, usable: false, droppable: false, forbidStaticPickup: true },
  'sunstone-tablet': { id: 'sunstone-tablet', maxStack: 1, usable: false, droppable: false, forbidStaticPickup: true },
  'shadow-sigil': { id: 'shadow-sigil', maxStack: 1, usable: false, droppable: false, forbidStaticPickup: true },
  'sunstone-key': { id: 'sunstone-key', maxStack: 1, usable: false, droppable: false, forbidStaticPickup: true },
  'oakhollow-champion-cloak': { id: 'oakhollow-champion-cloak', maxStack: 2, usable: true, droppable: true, forbidStaticPickup: true },
  'stolen-merchant-crate': { id: 'stolen-merchant-crate', maxStack: 1, usable: false, droppable: false, forbidStaticPickup: true },
  'sealed-trade-ledger': { id: 'sealed-trade-ledger', maxStack: 1, usable: false, droppable: false, forbidStaticPickup: true },
  'nightshade-vial': { id: 'nightshade-vial', maxStack: 20, usable: true, droppable: true },
  'frontier-badge-cloak': { id: 'frontier-badge-cloak', maxStack: 2, usable: true, droppable: true, forbidStaticPickup: true },
  'copper-ore': { id: 'copper-ore', maxStack: 160, usable: false, droppable: true },
  'silver-ore': { id: 'silver-ore', maxStack: 160, usable: false, droppable: true },
  gravel: { id: 'gravel', maxStack: 200, usable: false, droppable: true },
  'medicinal-herb': { id: 'medicinal-herb', maxStack: 160, usable: false, droppable: true },
  'copper-ingot': { id: 'copper-ingot', maxStack: 160, usable: false, droppable: true },
  'iron-ingot': { id: 'iron-ingot', maxStack: 160, usable: false, droppable: true },
  'silver-ingot': { id: 'silver-ingot', maxStack: 160, usable: false, droppable: true },
  'gold-ingot': { id: 'gold-ingot', maxStack: 160, usable: false, droppable: true },
  planks: { id: 'planks', maxStack: 200, usable: false, droppable: true },
  'timber-beam': { id: 'timber-beam', maxStack: 200, usable: false, droppable: true },
  'stone-brick': { id: 'stone-brick', maxStack: 200, usable: false, droppable: true },
  cloth: { id: 'cloth', maxStack: 200, usable: false, droppable: true },
  'stone-axe': { id: 'stone-axe', maxStack: 4, usable: false, droppable: true, forbidStaticPickup: true },
  'iron-axe': { id: 'iron-axe', maxStack: 4, usable: false, droppable: true, forbidStaticPickup: true },
  'stone-pickaxe': { id: 'stone-pickaxe', maxStack: 4, usable: false, droppable: true, forbidStaticPickup: true },
  'iron-pickaxe': { id: 'iron-pickaxe', maxStack: 4, usable: false, droppable: true, forbidStaticPickup: true },
  'steel-pickaxe': { id: 'steel-pickaxe', maxStack: 4, usable: false, droppable: true, forbidStaticPickup: true },
  'wooden-shovel': { id: 'wooden-shovel', maxStack: 4, usable: false, droppable: true, forbidStaticPickup: true },
  'iron-shovel': { id: 'iron-shovel', maxStack: 4, usable: false, droppable: true, forbidStaticPickup: true },
  'stone-club': { id: 'stone-club', maxStack: 4, usable: true, droppable: true, isWeapon: true, forbidStaticPickup: true },
  'copper-sword': { id: 'copper-sword', maxStack: 4, usable: true, droppable: true, isWeapon: true, forbidStaticPickup: true },
  'bronze-spear': { id: 'bronze-spear', maxStack: 4, usable: true, droppable: true, isWeapon: true, forbidStaticPickup: true },
  'silver-sword': { id: 'silver-sword', maxStack: 4, usable: true, droppable: true, isWeapon: true, forbidStaticPickup: true },
  'linen-shirt': { id: 'linen-shirt', maxStack: 2, usable: true, droppable: true, forbidStaticPickup: true },
  'traveler-trousers': { id: 'traveler-trousers', maxStack: 2, usable: true, droppable: true, forbidStaticPickup: true },
  'leather-gloves': { id: 'leather-gloves', maxStack: 2, usable: true, droppable: true, forbidStaticPickup: true },
  'hunter-cap': { id: 'hunter-cap', maxStack: 2, usable: true, droppable: true, forbidStaticPickup: true },
  'iron-helm': { id: 'iron-helm', maxStack: 2, usable: true, droppable: true, forbidStaticPickup: true },
  'fur-winter-coat': { id: 'fur-winter-coat', maxStack: 2, usable: true, droppable: true, forbidStaticPickup: true },
  'explorer-backpack': { id: 'explorer-backpack', maxStack: 2, usable: true, droppable: true, forbidStaticPickup: true },
  'expedition-pack': { id: 'expedition-pack', maxStack: 2, usable: true, droppable: true, forbidStaticPickup: true },
  'medicinal-salve': { id: 'medicinal-salve', maxStack: 40, usable: true, droppable: true },
  'crafting-table': { id: 'crafting-table', maxStack: 10, usable: true, droppable: true },
  'smelting-furnace': { id: 'smelting-furnace', maxStack: 10, usable: true, droppable: true },
  'wheat-seeds': { id: 'wheat-seeds', maxStack: 60, usable: false, droppable: true },
  'corn-seeds': { id: 'corn-seeds', maxStack: 60, usable: false, droppable: true },
  'potato-seeds': { id: 'potato-seeds', maxStack: 60, usable: false, droppable: true },
  'carrot-seeds': { id: 'carrot-seeds', maxStack: 60, usable: false, droppable: true },
  'tomato-seeds': { id: 'tomato-seeds', maxStack: 60, usable: false, droppable: true },
  'herb-seeds': { id: 'herb-seeds', maxStack: 60, usable: false, droppable: true },
  'berry-seeds': { id: 'berry-seeds', maxStack: 60, usable: false, droppable: true },
  corn: { id: 'corn', maxStack: 40, usable: true, droppable: true },
  potato: { id: 'potato', maxStack: 40, usable: true, droppable: true },
  carrot: { id: 'carrot', maxStack: 40, usable: true, droppable: true },
  tomato: { id: 'tomato', maxStack: 40, usable: true, droppable: true },
  egg: { id: 'egg', maxStack: 40, usable: false, droppable: true },
  milk: { id: 'milk', maxStack: 25, usable: true, droppable: true },
  cheese: { id: 'cheese', maxStack: 20, usable: true, droppable: true },
  cornbread: { id: 'cornbread', maxStack: 20, usable: true, droppable: true },
  'farmstead-stew': { id: 'farmstead-stew', maxStack: 20, usable: true, droppable: true },
  'animal-feed': { id: 'animal-feed', maxStack: 50, usable: false, droppable: true },
  'watering-can': { id: 'watering-can', maxStack: 1, usable: false, droppable: true, forbidStaticPickup: true },
  'wooden-hoe': { id: 'wooden-hoe', maxStack: 1, usable: false, droppable: true, forbidStaticPickup: true },
};

export const SERVER_CRAFTABLE_YIELDS: Record<
  string,
  { itemId: string; count: number }
> = {
  'recipe-bed': { itemId: 'bed', count: 1 },
  'recipe-wooden-sword': { itemId: 'wooden-sword', count: 1 },
  'recipe-hunter-knife': { itemId: 'hunter-knife', count: 1 },
  'recipe-spear': { itemId: 'spear', count: 1 },
  'recipe-iron-sword': { itemId: 'iron-sword', count: 1 },
  'recipe-steel-sword': { itemId: 'steel-sword', count: 1 },
  'recipe-battle-axe': { itemId: 'battle-axe', count: 1 },
  'recipe-hunter-bow': { itemId: 'hunter-bow', count: 1 },
  'recipe-crossbow': { itemId: 'crossbow', count: 1 },
  'recipe-arrow': { itemId: 'arrow', count: 8 },
  'recipe-driftwood-arrows': { itemId: 'arrow', count: 6 },
  'recipe-leather-armor': { itemId: 'leather-armor', count: 1 },
  'recipe-cooked-meat': { itemId: 'cooked-meat', count: 1 },
  'recipe-torch': { itemId: 'torch', count: 2 },
  'recipe-berry-tonic': { itemId: 'apothecary-tonic', count: 1 },
  'recipe-desert-tonic': { itemId: 'apothecary-tonic', count: 1 },
  'recipe-hearth-loaf': { itemId: 'hearth-loaf', count: 1 },
  'recipe-stone-axe': { itemId: 'stone-axe', count: 1 },
  'recipe-stone-pickaxe': { itemId: 'stone-pickaxe', count: 1 },
  'recipe-wooden-shovel': { itemId: 'wooden-shovel', count: 1 },
  'recipe-stone-club': { itemId: 'stone-club', count: 1 },
  'recipe-planks': { itemId: 'planks', count: 4 },
  'recipe-stone-brick': { itemId: 'stone-brick', count: 2 },
  'recipe-cloth': { itemId: 'cloth', count: 2 },
  'recipe-crafting-table': { itemId: 'crafting-table', count: 1 },
  'recipe-smelting-furnace': { itemId: 'smelting-furnace', count: 1 },
  'recipe-medicinal-salve': { itemId: 'medicinal-salve', count: 1 },
  'recipe-timber-beam': { itemId: 'timber-beam', count: 2 },
  'recipe-copper-ingot': { itemId: 'copper-ingot', count: 1 },
  'recipe-iron-ingot': { itemId: 'iron-ingot', count: 1 },
  'recipe-silver-ingot': { itemId: 'silver-ingot', count: 1 },
  'recipe-gold-ingot': { itemId: 'gold-ingot', count: 1 },
  'recipe-iron-axe': { itemId: 'iron-axe', count: 1 },
  'recipe-iron-pickaxe': { itemId: 'iron-pickaxe', count: 1 },
  'recipe-steel-pickaxe': { itemId: 'steel-pickaxe', count: 1 },
  'recipe-iron-shovel': { itemId: 'iron-shovel', count: 1 },
  'recipe-copper-sword': { itemId: 'copper-sword', count: 1 },
  'recipe-bronze-spear': { itemId: 'bronze-spear', count: 1 },
  'recipe-silver-sword': { itemId: 'silver-sword', count: 1 },
  'recipe-linen-shirt': { itemId: 'linen-shirt', count: 1 },
  'recipe-traveler-trousers': { itemId: 'traveler-trousers', count: 1 },
  'recipe-leather-gloves': { itemId: 'leather-gloves', count: 1 },
  'recipe-hunter-cap': { itemId: 'hunter-cap', count: 1 },
  'recipe-iron-helm': { itemId: 'iron-helm', count: 1 },
  'recipe-fur-winter-coat': { itemId: 'fur-winter-coat', count: 1 },
  'recipe-explorer-backpack': { itemId: 'explorer-backpack', count: 1 },
  'recipe-expedition-pack': { itemId: 'expedition-pack', count: 1 },
  'recipe-wooden-hoe': { itemId: 'wooden-hoe', count: 1 },
  'recipe-watering-can': { itemId: 'watering-can', count: 1 },
  'recipe-animal-feed': { itemId: 'animal-feed', count: 3 },
  'recipe-cornbread': { itemId: 'cornbread', count: 1 },
  'recipe-farmstead-stew': { itemId: 'farmstead-stew', count: 1 },
  'recipe-artisan-cheese': { itemId: 'cheese', count: 1 },
};

export interface SyncedEntityDelta {
  id: string;
  kind: SyncedEntityKind;
  archetype: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  state: string;
  hp?: number;
  maxHp?: number;
  isDead?: boolean;
  tx?: number;
  tz?: number;
  targetPlayerId?: string;
  isBoss?: boolean;
  bossPhase?: number;
  attackState?: string;
  dialogueState?: 'idle' | 'talking';
  dialoguePlayerId?: string;
  questState?: string;
  schedulePeriod?: string;
  worldId?: string;
  chunkId?: string;
  alive?: boolean;
  loaded?: boolean;
  questTarget?: {
    questId: string;
    objectiveId: string;
    enemyType?: string;
    lifecycle: string;
  };
}

export interface EntitySyncBatchPayload {
  entities: SyncedEntityDelta[];
  worldHours?: number;
  weather?: string;
}

export interface AuthoritativeWorldTimeState {
  worldHours: number;
  dayCount: number;
  timeScale: number;
  paused: boolean;
  fullDayDurationSeconds: number;
  anchorServerMs: number;
}

export interface AuthoritativeWorldWeatherState {
  currentState: WorldWeatherState;
  targetState: WorldWeatherState;
  intensity: number;
  dynamicEnabled: boolean;
  transitionDurationSeconds: number;
  startMs: number;
  durationMs: number;
  endMs: number;
}

export interface AuthoritativeProgressionState {
  playerId: string;
  coins: number;
  xp: number;
  level: number;
  xpToNextLevel: number;
  reason?: string;
}

export interface WorldSettingsUpdatePayload {
  worldSettingsPermission?: WorldSettingsPermission;
  preset?: WorldTimePreset;
  worldHours?: number;
  dayCount?: number;
  timeScale?: number;
  paused?: boolean;
  fullDayDurationSeconds?: number;
  weatherState?: WorldWeatherState;
  targetWeatherState?: WorldWeatherState;
  weatherIntensity?: number;
  dynamicEnabled?: boolean;
  transitionDurationSeconds?: number;
  durationMs?: number;
  triggerLightning?: boolean;
  friendlyFire?: boolean;
}

export interface EnemyAttackPlayerPayload {
  targetPlayerId: string;
  sourceKind: 'enemy' | 'animal';
  sourceId: string;
  archetype?: string;
  damage: number;
  x?: number;
  z?: number;
}

export interface RepairWeaponsPayload {
  costCoins: number;
}

export interface WorldEntitySnapshot {
  id: string;
  kind: SyncedEntityKind;
  archetype: string;
  hp: number;
  maxHp: number;
  isDead: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  state: string;
  targetPlayerId?: string;
  isBoss?: boolean;
  bossPhase?: number;
  attackState?: string;
  dialogueState?: 'idle' | 'talking';
  dialoguePlayerId?: string;
  questState?: string;
  schedulePeriod?: string;
  worldId?: string;
  chunkId?: string;
  alive?: boolean;
  loaded?: boolean;
  questTarget?: {
    questId: string;
    objectiveId: string;
    enemyType?: string;
    lifecycle: string;
  };
}

export interface BossEncounterState {
  bossId: string;
  archetype: string;
  hp: number;
  maxHp: number;
  isDead: boolean;
  state: string;
  attackState: BossAttackState;
  phase: number;
  targetPlayerId: string | null;
  damageByPlayer: Record<string, number>;
  x: number;
  y: number;
  z: number;
  yaw: number;
  killSeq: number;
  updatedAtMs: number;
}

export interface CoopQuestStateRecord {
  questId: string;
  partyId: string | null;
  objectiveId: string;
  title: string;
  status: 'active' | 'completed';
  progress: number;
  targetCount: number;
  targetEnemyType?: string;
  startedByPlayerId: string;
  startedAtMs: number;
  completedAtMs?: number | null;
  cycle: number;
  contributors: Record<string, number>;
  completedByPlayerIds: string[];
  countedTargetIds?: string[];
}

export interface LootGrantItem {
  itemId: string;
  count: number;
}

export interface LootGrantPayload {
  grantId: string;
  playerId: string;
  mode: LootDistributionMode;
  sourceKind: 'enemy' | 'boss' | 'quest' | 'coop_quest';
  sourceId: string;
  archetype?: string;
  xp: number;
  coins: number;
  items: LootGrantItem[];
  reason: string;
  timestamp: number;
}

export interface RoomContainerState {
  id: string;
  isOpen: boolean;
  items: Array<{ itemId: string; count: number }>;
  updatedBy?: string;
  updatedAtMs: number;
}

export interface RoomBuildingState {
  id: string;
  kind: string;
  state: string;
  health?: number;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  updatedBy?: string;
  updatedAtMs: number;
}

export interface RoomQuestObjectState {
  id: string;
  questId: string;
  state: string;
  updatedBy: string;
  updatedAtMs: number;
}

export interface PlayerStatisticsRecord {
  damageDealt: number;
  enemiesDefeated: number;
  animalsDefeated: number;
  resourcesCollected: number;
  questsCompleted: number;
  chestsOpened: number;
  bedsUsed: number;
  itemsCrafted: number;
}

export const PARTY_PALETTE_COLORS = [
  '#f59e0b',
  '#a855f7',
  '#06b6d4',
  '#f43f5e',
  '#84cc16',
  '#fb923c',
  '#e879f9',
  '#22d3ee',
] as const;

export const COOP_OBJECTIVE_TYPES = [
  'kill_boss',
  'protect_village',
  'collect_resources',
  'escort_npc',
  'explore_location',
  'open_dungeon',
] as const;

export type CoopObjectiveType = (typeof COOP_OBJECTIVE_TYPES)[number];

export function isValidCoopObjectiveType(value: unknown): value is CoopObjectiveType {
  return (
    typeof value === 'string' &&
    (COOP_OBJECTIVE_TYPES as readonly string[]).includes(value)
  );
}

export type CoopObjectiveStatus = 'active' | 'completed' | 'failed' | 'cancelled';

export interface CoopObjectiveContribution {
  playerId: string;
  displayName: string;
  amount: number;
  rewardXp?: number;
  rewardCoins?: number;
}

export interface CoopObjectiveRewardEntry {
  xp: number;
  coins: number;
  bonusReason: string;
}

export interface CoopObjectiveState {
  objectiveId: string;
  partyId: string;
  type: CoopObjectiveType;
  title: string;
  description: string;
  status: CoopObjectiveStatus;
  progress: number;
  targetCount: number;
  targetX?: number;
  targetZ?: number;
  targetRadius?: number;
  targetId?: string;
  startedByPlayerId: string;
  startedAt: number;
  expiresAt?: number | null;
  completedAt?: number | null;
  contributions: Record<string, CoopObjectiveContribution>;
  rewardsByPlayer: Record<string, CoopObjectiveRewardEntry>;
}

export interface PartyMemberRecord {
  playerId: string;
  publicProfileId?: string;
  displayName: string;
  playerTag?: string;
  avatar?: AvatarConfig;
  avatarColor: string;
  level: number;
  health: number;
  maxHealth: number;
  isDead: boolean;
  online: boolean;
  isReady: boolean;
  joinedAt: number;
  markerIndex: number;
  markerColor: string;
}

export interface PartyRecord {
  partyId: string;
  roomId: string;
  leaderPlayerId: string;
  members: PartyMemberRecord[];
  maxMembers: number;
  createdAt: number;
  activeObjective: CoopObjectiveState | null;
}

export interface PartyInviteRecord {
  inviteId: string;
  partyId: string;
  roomId: string;
  fromPlayerId: string;
  fromPlayerName: string;
  fromPlayerTag?: string;
  toPlayerId: string;
  toPublicProfileId?: string;
  toPlayerName: string;
  createdAt: number;
  status: 'pending' | 'accepted' | 'declined';
}

export interface PartyStateSnapshot {
  party: PartyRecord | null;
  pendingInvites: PartyInviteRecord[];
  outgoingInvites: PartyInviteRecord[];
}

export interface ServerBuildingSpec {
  id: string;
  maxHp: number;
  upgradeToId?: string;
  storageCapacity?: number;
  hasDoor?: boolean;
  isFarm?: boolean;
  farmYieldCount?: number;
}

export const SERVER_BUILDING_SPECS: Record<string, ServerBuildingSpec> = {
  'wood-foundation': { id: 'wood-foundation', maxHp: 240, upgradeToId: 'stone-foundation' },
  'stone-foundation': { id: 'stone-foundation', maxHp: 420 },
  'wood-floor': { id: 'wood-floor', maxHp: 180 },
  'wood-wall': { id: 'wood-wall', maxHp: 220, upgradeToId: 'stone-wall' },
  'stone-wall': { id: 'stone-wall', maxHp: 440, upgradeToId: 'reinforced-wall' },
  'reinforced-wall': { id: 'reinforced-wall', maxHp: 760 },
  'wood-half-wall': { id: 'wood-half-wall', maxHp: 150 },
  'timber-pillar': { id: 'timber-pillar', maxHp: 200 },
  'pitched-roof': { id: 'pitched-roof', maxHp: 240 },
  'wood-stairs': { id: 'wood-stairs', maxHp: 200 },
  'small-house': { id: 'small-house', maxHp: 520, hasDoor: true, upgradeToId: 'medium-house' },
  'medium-house': { id: 'medium-house', maxHp: 850, hasDoor: true, upgradeToId: 'large-house' },
  'large-house': { id: 'large-house', maxHp: 1350, hasDoor: true },
  'log-cabin': { id: 'log-cabin', maxHp: 640, hasDoor: true },
  'storage-building': { id: 'storage-building', maxHp: 620, hasDoor: true, storageCapacity: 20 },
  'craft-workshop': { id: 'craft-workshop', maxHp: 780, hasDoor: true },
  'defensive-wall': { id: 'defensive-wall', maxHp: 680 },
  watchtower: { id: 'watchtower', maxHp: 980 },
  'wooden-door': { id: 'wooden-door', maxHp: 220, hasDoor: true, upgradeToId: 'reinforced-door' },
  'reinforced-door': { id: 'reinforced-door', maxHp: 540, hasDoor: true },
  'framed-window': { id: 'framed-window', maxHp: 200 },
  'timber-gate': { id: 'timber-gate', maxHp: 360, hasDoor: true },
  'wooden-chest': { id: 'wooden-chest', maxHp: 220, storageCapacity: 12, upgradeToId: 'reinforced-storage-box' },
  'reinforced-storage-box': { id: 'reinforced-storage-box', maxHp: 480, storageCapacity: 20 },
  'build-workbench': { id: 'build-workbench', maxHp: 240 },
  'build-crafting-table': { id: 'build-crafting-table', maxHp: 280 },
  'build-forge': { id: 'build-forge', maxHp: 520 },
  'build-furnace': { id: 'build-furnace', maxHp: 460 },
  'small-farm-plot': { id: 'small-farm-plot', maxHp: 160, isFarm: true, farmYieldCount: 3 },
  'large-farm-field': { id: 'large-farm-field', maxHp: 240, isFarm: true, farmYieldCount: 6 },
  'farm-water-trough': { id: 'farm-water-trough', maxHp: 220 },
  'farm-chicken-coop': { id: 'farm-chicken-coop', maxHp: 280 },
  'farm-animal-pen': { id: 'farm-animal-pen', maxHp: 340 },
  'farm-silo-shed': { id: 'farm-silo-shed', maxHp: 440, storageCapacity: 16 },
  'wooden-fence': { id: 'wooden-fence', maxHp: 150 },
  'oak-bed': { id: 'oak-bed', maxHp: 180 },
  'dining-table': { id: 'dining-table', maxHp: 150 },
  'wooden-chair': { id: 'wooden-chair', maxHp: 120 },
  'lantern-post': { id: 'lantern-post', maxHp: 180 },
  'storage-shelf': { id: 'storage-shelf', maxHp: 160 },
  'stone-fireplace': { id: 'stone-fireplace', maxHp: 400 },
};

export const SERVER_CROP_SPECS: Record<
  string,
  { seedItemId: string; harvestItemId: string; baseYield: number; seedReturn: number; growthHours: number }
> = {
  wheat: { seedItemId: 'wheat-seeds', harvestItemId: 'wheat', baseYield: 3, seedReturn: 1, growthHours: 6 },
  corn: { seedItemId: 'corn-seeds', harvestItemId: 'corn', baseYield: 3, seedReturn: 1, growthHours: 8 },
  potato: { seedItemId: 'potato-seeds', harvestItemId: 'potato', baseYield: 3, seedReturn: 1, growthHours: 7 },
  carrot: { seedItemId: 'carrot-seeds', harvestItemId: 'carrot', baseYield: 4, seedReturn: 1, growthHours: 5.5 },
  tomato: { seedItemId: 'tomato-seeds', harvestItemId: 'tomato', baseYield: 3, seedReturn: 1, growthHours: 8.5 },
  herb: { seedItemId: 'herb-seeds', harvestItemId: 'medicinal-herb', baseYield: 3, seedReturn: 1, growthHours: 6.5 },
  berry: { seedItemId: 'berry-seeds', harvestItemId: 'berries', baseYield: 4, seedReturn: 1, growthHours: 9 },
};

export interface ServerVillageRepairSpec {
  id: string;
  costs: Array<{ itemId: string; count: number }>;
  xpGain: number;
  reputationGain: number;
  coinsReward: number;
}

export const SERVER_VILLAGE_REPAIRS: Record<string, ServerVillageRepairSpec> = {
  repair_storehouse: {
    id: 'repair_storehouse',
    costs: [
      { itemId: 'wood', count: 8 },
      { itemId: 'stone', count: 4 },
    ],
    xpGain: 75,
    reputationGain: 40,
    coinsReward: 25,
  },
  repair_fence: {
    id: 'repair_fence',
    costs: [
      { itemId: 'wood', count: 6 },
      { itemId: 'fiber', count: 4 },
    ],
    xpGain: 60,
    reputationGain: 30,
    coinsReward: 18,
  },
};

export interface ServerVillageProjectSpec {
  id: string;
  minVillageLevel: number;
  costs: Array<{ itemId: string; count: number }>;
  xpGain: number;
  reputationGain: number;
}

export const SERVER_VILLAGE_PROJECTS: Record<string, ServerVillageProjectSpec> = {
  proj_granary: {
    id: 'proj_granary',
    minVillageLevel: 1,
    costs: [
      { itemId: 'wood', count: 10 },
      { itemId: 'planks', count: 4 },
      { itemId: 'stone', count: 4 },
    ],
    xpGain: 95,
    reputationGain: 50,
  },
  proj_plaza_lanterns: {
    id: 'proj_plaza_lanterns',
    minVillageLevel: 2,
    costs: [
      { itemId: 'wood', count: 6 },
      { itemId: 'iron-ingot', count: 2 },
      { itemId: 'coal', count: 2 },
    ],
    xpGain: 90,
    reputationGain: 45,
  },
  proj_workshop: {
    id: 'proj_workshop',
    minVillageLevel: 2,
    costs: [
      { itemId: 'planks', count: 6 },
      { itemId: 'timber-beam', count: 2 },
      { itemId: 'stone', count: 6 },
    ],
    xpGain: 120,
    reputationGain: 60,
  },
  proj_watchtower: {
    id: 'proj_watchtower',
    minVillageLevel: 3,
    costs: [
      { itemId: 'wood', count: 12 },
      { itemId: 'stone', count: 10 },
      { itemId: 'iron-ingot', count: 3 },
    ],
    xpGain: 155,
    reputationGain: 75,
  },
};

export interface ServerMerchantOfferSpec {
  id: string;
  kind: 'item' | 'animal';
  itemId: string;
  count: number;
  basePriceCoins: number;
  minVillageLevel: number;
}

export const SERVER_MERCHANT_OFFERS: Record<string, ServerMerchantOfferSpec> = {
  'offer-wheat-seeds': { id: 'offer-wheat-seeds', kind: 'item', itemId: 'wheat-seeds', count: 3, basePriceCoins: 10, minVillageLevel: 1 },
  'offer-carrot-seeds': { id: 'offer-carrot-seeds', kind: 'item', itemId: 'carrot-seeds', count: 3, basePriceCoins: 12, minVillageLevel: 1 },
  'offer-potato-seeds': { id: 'offer-potato-seeds', kind: 'item', itemId: 'potato-seeds', count: 3, basePriceCoins: 14, minVillageLevel: 1 },
  'offer-wooden-hoe': { id: 'offer-wooden-hoe', kind: 'item', itemId: 'wooden-hoe', count: 1, basePriceCoins: 18, minVillageLevel: 1 },
  'offer-watering-can': { id: 'offer-watering-can', kind: 'item', itemId: 'watering-can', count: 1, basePriceCoins: 22, minVillageLevel: 1 },
  'offer-animal-feed': { id: 'offer-animal-feed', kind: 'item', itemId: 'animal-feed', count: 4, basePriceCoins: 14, minVillageLevel: 1 },
  'offer-buy-chicken': { id: 'offer-buy-chicken', kind: 'animal', itemId: 'egg', count: 1, basePriceCoins: 42, minVillageLevel: 1 },
  'offer-corn-seeds': { id: 'offer-corn-seeds', kind: 'item', itemId: 'corn-seeds', count: 3, basePriceCoins: 18, minVillageLevel: 2 },
  'offer-tomato-seeds': { id: 'offer-tomato-seeds', kind: 'item', itemId: 'tomato-seeds', count: 3, basePriceCoins: 18, minVillageLevel: 2 },
  'offer-herb-seeds': { id: 'offer-herb-seeds', kind: 'item', itemId: 'herb-seeds', count: 2, basePriceCoins: 22, minVillageLevel: 2 },
  'offer-buy-sheep': { id: 'offer-buy-sheep', kind: 'animal', itemId: 'wool', count: 1, basePriceCoins: 68, minVillageLevel: 2 },
  'offer-hearth-loaf': { id: 'offer-hearth-loaf', kind: 'item', itemId: 'hearth-loaf', count: 2, basePriceCoins: 16, minVillageLevel: 2 },
  'offer-berry-seeds': { id: 'offer-berry-seeds', kind: 'item', itemId: 'berry-seeds', count: 2, basePriceCoins: 24, minVillageLevel: 3 },
  'offer-buy-goat': { id: 'offer-buy-goat', kind: 'animal', itemId: 'milk', count: 1, basePriceCoins: 76, minVillageLevel: 3 },
  'offer-tonic': { id: 'offer-tonic', kind: 'item', itemId: 'apothecary-tonic', count: 1, basePriceCoins: 28, minVillageLevel: 3 },
  'offer-buy-cow': { id: 'offer-buy-cow', kind: 'animal', itemId: 'milk', count: 1, basePriceCoins: 95, minVillageLevel: 4 },
  'offer-iron-ingot': { id: 'offer-iron-ingot', kind: 'item', itemId: 'iron-ingot', count: 2, basePriceCoins: 34, minVillageLevel: 4 },
  'offer-timber-beam': { id: 'offer-timber-beam', kind: 'item', itemId: 'timber-beam', count: 3, basePriceCoins: 28, minVillageLevel: 5 },
};

export const SERVER_ITEM_SELL_VALUES: Record<string, number> = {
  wheat: 6,
  corn: 8,
  potato: 7,
  carrot: 6,
  tomato: 9,
  berries: 6,
  'medicinal-herb': 8,
  'meadow-herb': 6,
  egg: 8,
  milk: 12,
  cheese: 32,
  wool: 11,
  feathers: 5,
  cornbread: 24,
  'farmstead-stew': 38,
  'hearth-loaf': 14,
  'sun-apple': 5,
  'cooked-meat': 12,
  leather: 14,
  hide: 9,
  wood: 3,
  stone: 4,
};

export interface VillageDevelopmentSyncRecord {
  villageId: string;
  level: number;
  progressXp: number;
  reputationPoints: number;
  completedRepairIds: string[];
  completedProjectIds: string[];
  cropsHarvestedCount: number;
  tradesCompletedCount: number;
  defensesWonCount: number;
}

export interface PlayerBuiltStructureSnapshot {
  id: string;
  blueprintId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  structureHp: number;
  maxStructureHp: number;
  ownerId: string;
  ownerName: string;
  permissionScope: 'owner' | 'friends' | 'party' | 'everyone';
  createdAtMs: number;
  doorOpen?: boolean;
  storageItems?: Array<{ itemId: string; count: number }>;
  farmStage?: number;
  farmProgress?: number;
  farmSoilPrepared?: boolean;
  farmCropId?: string | null;
  farmWaterLevel?: number;
  farmPlantedAtHours?: number;
}

export interface SyncedModSpawnEntry {
  instanceId: string;
  modId: string;
  spawnId: string;
  contentId: string;
  contentType: string;
  count?: number;
  quantity?: number;
  x: number;
  y: number;
  z: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  perPlayer?: boolean;
  collected?: boolean;
  defeated?: boolean;
  collectedByPlayers?: string[];
  modelPath?: string;
  label?: string;
}

export interface RoomWorldSnapshotPayload {
  openedChests: string[];
  collectedPickups: string[];
  depletedResources: Array<{ id: string; usesRemaining: number; regenAtMs: number }>;
  doors: Array<{ id: string; isOpen: boolean }>;
  placedBeds: Array<{
    id: string;
    x: number;
    y: number;
    z: number;
    yaw: number;
    ownerId: string;
  }>;
  placedStations?: Array<{
    id: string;
    stationType: 'crafting_table' | 'furnace';
    x: number;
    y: number;
    z: number;
    yaw: number;
    ownerId: string;
  }>;
  playerBuildings?: PlayerBuiltStructureSnapshot[];
  villagesDev?: VillageDevelopmentSyncRecord[];
  droppedItems: Array<{
    id: string;
    itemId: string;
    count: number;
    label: string;
    x: number;
    y: number;
    z: number;
    droppedBy: string;
  }>;
  quests: Array<{
    questId: string;
    status: string;
    stepIndex: number;
    updatedBy: string;
    scope?: QuestScope;
  }>;
  coopQuests?: CoopQuestStateRecord[];
  bossEncounters?: BossEncounterState[];
  discoveredLandmarks: string[];
  deadEntities: Array<{ id: string; kind: SyncedEntityKind }>;
  entityStates?: WorldEntitySnapshot[];
  containers?: RoomContainerState[];
  buildingStates?: RoomBuildingState[];
  questObjects?: RoomQuestObjectState[];
  worldHours?: number;
  dayCount?: number;
  weather?: string;
  worldTime?: AuthoritativeWorldTimeState;
  worldWeather?: AuthoritativeWorldWeatherState;
  worldSettings?: AuthoritativeWorldSettings;
  worldSettingsPermission?: WorldSettingsPermission;
  serverTimestamp?: number;
  playerPosition?: { x: number; y: number; z: number; yaw: number };
  playerVitals?: AuthoritativePlayerVitals;
  playerStatistics?: PlayerStatisticsRecord;
  ammoCount?: number;
  coins?: number;
  xp?: number;
  level?: number;
  xpToNextLevel?: number;
  inventoryItemIds?: string[];
  itemCounts?: Record<string, number>;
  equippedWeaponId?: string | null;
  partyState?: PartyStateSnapshot;
  modMetadata?: ProtocolWorldModMetadata;
  modSpawns?: SyncedModSpawnEntry[];
}

/**
 * Core multiplayer message types required across client WebSocket & Durable Object room server.
 */
export const CLIENT_MESSAGE_TYPES = [
  'CONNECT',
  'DISCONNECT',
  'PING',
  'PONG',
  'JOIN_ROOM',
  'LEAVE_ROOM',
  'PLAYER_STATE',
  'GAME_EVENT',
  'ENTITY_SYNC',
  'ROOM_CHAT',
  'PLAYER_REPORT',
  'READY',
  'START_GAME',
  'KICK_PLAYER',
  'TRANSFER_HOST',
  'UPDATE_ROOM_SETTINGS',
  'WORLD_SETTINGS_UPDATE',
  'ENEMY_ATTACK_PLAYER',
  'REPAIR_WEAPONS',
  'CLOSE_ROOM',
  'PARTY_CREATE',
  'PARTY_INVITE',
  'PARTY_ACCEPT_INVITE',
  'PARTY_DECLINE_INVITE',
  'PARTY_LEAVE',
  'PARTY_KICK',
  'PARTY_TRANSFER_LEADER',
  'PARTY_SET_READY',
  'PARTY_START_OBJECTIVE',
  'PARTY_CANCEL_OBJECTIVE',
  'COOP_QUEST_START',
  'COOP_QUEST_COMPLETE',
] as const;

export type ClientMessageType = (typeof CLIENT_MESSAGE_TYPES)[number];

export const ALLOWED_WEAPON_IDS = new Set<string>([
  'ranger-sword',
  'wooden-sword',
  'iron-sword',
  'steel-sword',
  'copper-sword',
  'silver-sword',
  'stone-club',
  'woodland-axe',
  'battle-axe',
  'hunter-bow',
  'crossbow',
  'spear',
  'bronze-spear',
  'hunter-knife',
]);

export const MOD_NAMESPACED_WEAPON_PATTERN =
  /^[a-z0-9][a-z0-9._-]{1,63}:[a-z0-9][a-z0-9._-]{0,63}$/i;

export function isAllowedMultiplayerWeaponId(weaponId: string): boolean {
  if (ALLOWED_WEAPON_IDS.has(weaponId)) return true;
  if (weaponId.length <= 96 && MOD_NAMESPACED_WEAPON_PATTERN.test(weaponId)) {
    return true;
  }
  return false;
}

export const CURRENT_MOD_API_VERSION = 1;
export const SUPPORTED_MOD_SCHEMA_VERSIONS = [1, 2] as const;
export const MAX_MOD_METADATA_BYTES = 16_384;
export const MAX_MODS_PER_METADATA = 64;
export const MAX_DEPS_PER_MOD = 32;

export interface ProtocolModDependency {
  modId: string;
  versionRange?: string;
  optional?: boolean;
}

export interface ProtocolWorldModEntry {
  modId: string;
  name: string;
  version: string;
  supportedGameVersion?: string;
  compatibilityVersion?: string;
  dependencies?: ProtocolModDependency[];
  modApiVersion?: number;
  schemaVersion?: number;
  multiplayerCompatibility?: 'required' | 'optional' | 'client_only';
}

export interface ProtocolWorldModMetadata {
  modApiVersion: number;
  schemaVersion: number;
  savedAtGameVersion: string;
  mods: ProtocolWorldModEntry[];
}

export type ProtocolModCompatibilityCode =
  | 'missing_mod'
  | 'disabled_mod'
  | 'version_mismatch'
  | 'missing_dependency'
  | 'unsupported_mod'
  | 'api_version_mismatch'
  | 'schema_version_mismatch'
  | 'extra_active_mod';

export interface ProtocolModCompatibilityIssue {
  modId: string;
  modName?: string;
  code: ProtocolModCompatibilityCode;
  expectedVersion?: string;
  actualVersion?: string;
  dependencyModId?: string;
  message: string;
}

export interface ProtocolModCompatibilityReport {
  compatible: boolean;
  summary: string;
  hostModCount: number;
  issues: ProtocolModCompatibilityIssue[];
}

export interface ProtocolRoomIncompatiblePlayerAttempt {
  playerName: string;
  attemptedAt: number;
  reason: string;
  issues: ProtocolModCompatibilityIssue[];
}

export interface ProtocolRoomModCompatibilityStatus {
  requiredMods: ProtocolWorldModEntry[];
  compatiblePlayers: Array<{
    playerId: string;
    displayName: string;
    isHost: boolean;
  }>;
  incompatiblePlayers: ProtocolRoomIncompatiblePlayerAttempt[];
}

export const ALLOWED_ATTACK_ANIM_TYPES = new Set<string>([
  'melee_slash',
  'heavy_chop',
  'bow_shot',
  'spear_thrust',
  'knife_slash',
  'unarmed_punch',
]);

export function generateNetworkEntityId(playerId: string): string {
  return `ent_${playerId}`;
}

export const SERVER_MESSAGE_TYPES = [
  'CONNECT',
  'DISCONNECT',
  'PING',
  'PONG',
  'JOIN_ROOM',
  'LEAVE_ROOM',
  'PLAYER_STATE',
  'PLAYER_VITALS',
  'PROGRESSION_UPDATED',
  'POSITION_CORRECTION',
  'GAME_EVENT',
  'ENTITY_SYNC',
  'WORLD_SNAPSHOT',
  'WORLD_TIME_CHANGED',
  'WORLD_DAY_CHANGED',
  'WORLD_TIME_SCALE_CHANGED',
  'WORLD_WEATHER_CHANGED',
  'WORLD_WEATHER_INTENSITY_CHANGED',
  'WORLD_SETTINGS_UPDATED',
  'ROOM_CHAT',
  'CHAT_HISTORY',
  'REPORT_ACK',
  'READY',
  'START_GAME',
  'KICK_PLAYER',
  'TRANSFER_HOST',
  'UPDATE_ROOM_SETTINGS',
  'CLOSE_ROOM',
  'ROOM_STATE',
  'HOST_TRANSFERRED',
  'PLAYER_KICKED',
  'ROOM_CLOSED',
  'PARTY_STATE',
  'PARTY_INVITE_RECEIVED',
  'PARTY_OBJECTIVE_UPDATED',
  'PARTY_OBJECTIVE_COMPLETED',
  'COOP_QUEST_UPDATED',
  'BOSS_STATE_UPDATED',
  'LOOT_GRANTED',
  'ERROR',
] as const;

export type ServerMessageType = (typeof SERVER_MESSAGE_TYPES)[number];

export interface PlayerNetworkState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  aimYaw?: number;
  pitch?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  movementState?: 'idle' | 'walking' | 'running' | 'jumping' | 'falling';
  animState?: string;
  sprinting?: boolean;
  jumping?: boolean;
  crouching?: boolean;
  grounded?: boolean;
  weaponId?: string | null;
  bowCharging?: boolean;
  bowCharge?: number;
  shooting?: boolean;
  reloading?: boolean;
  seq?: number;
  // Server-stamped authoritative fields (stripped/rejected if sent by clients)
  networkEntityId?: string;
  health?: number;
  maxHealth?: number;
  isDead?: boolean;
  serverTime?: number;
}

export interface AuthoritativePlayerVitals {
  playerId: string;
  networkEntityId: string;
  health: number;
  maxHealth: number;
  isDead: boolean;
  reviveAtMs?: number | null;
}

export interface PositionCorrectionPayload {
  x: number;
  y: number;
  z: number;
  yaw: number;
  seq?: number;
  reason: string;
}

export interface NetworkPlayerRecord {
  playerId: string;
  publicProfileId?: string;
  networkEntityId?: string;
  displayName: string;
  playerTag?: string;
  avatarColor?: string;
  avatar?: AvatarConfig;
  isHost: boolean;
  isReady: boolean;
  pingMs?: number | null;
  connectionQuality?: ConnectionQuality;
  joinedAt: number;
  lastSeenAt: number;
  disconnectedAt?: number | null;
  level?: number;
  partyId?: string | null;
  health?: number;
  maxHealth?: number;
  isDead?: boolean;
  state?: PlayerNetworkState;
}

export interface AuthoritativeWorldSettings {
  worldType: WorldType;
  difficulty: DifficultyLevel;
  pvpEnabled: boolean;
  friendlyFire?: boolean;
  staminaUnlimited: boolean;
  spawnX: number;
  spawnY: number;
  spawnZ: number;
}

export interface RoomGameState {
  seed: number;
  worldName: string;
  worldType: WorldType;
  difficulty: DifficultyLevel;
  privacy: RoomPrivacy;
  isPrivate: boolean;
  allowFriends: boolean;
  requireAllReady: boolean;
  worldSettingsPermission?: WorldSettingsPermission;
  worldSettings?: AuthoritativeWorldSettings;
  locked: boolean;
  hasPassword: boolean;
  startedAt: number | null;
  tick: number;
  modMetadata?: ProtocolWorldModMetadata;
  modCompatibilityStatus?: ProtocolRoomModCompatibilityStatus;
}

export interface AuthoritativeRoomSnapshot {
  roomId: string;
  roomCode: string;
  roomName: string;
  hostId: string;
  hostName: string;
  players: NetworkPlayerRecord[];
  maxPlayers: number;
  status: RoomStatus;
  hasEnteredWorld?: boolean;
  gameState: RoomGameState;
  createdAt: number;
  lastActivityAt?: number;
  lastPlayerJoinedAt?: number | null;
  lastPlayerLeftAt?: number | null;
  expiresAt?: number;
  worldTime?: AuthoritativeWorldTimeState;
  worldWeather?: AuthoritativeWorldWeatherState;
  serverTimestamp?: number;
}

export interface NetworkEnvelope<
  TPayload = unknown,
  TType extends string = ServerMessageType | ClientMessageType,
> {
  v: number;
  type: TType;
  roomId: string;
  playerId: string;
  timestamp: number;
  seq?: number;
  payload?: TPayload;
}

export interface JoinRoomPayload {
  displayName: string;
  token?: string;
}

export interface ReadyPayload {
  ready: boolean;
}

export interface KickPlayerPayload {
  targetPlayerId: string;
}

export interface TransferHostPayload {
  targetPlayerId: string;
}

export interface UpdateRoomSettingsPayload {
  requireAllReady?: boolean;
  friendlyFire?: boolean;
}

export interface HostTransferredPayload {
  previousHostId: string;
  newHostId: string;
  newHostName: string;
}

export interface PlayerKickedPayload {
  targetPlayerId: string;
  targetDisplayName: string;
  kickedBy: string;
}

export interface RoomClosedPayload {
  reason: string;
  closedBy: string;
}

export interface MultiplayerInviteRecord {
  inviteId: string;
  roomId: string;
  roomCode: string;
  roomName: string;
  partyId?: string;
  fromPlayerId: string;
  fromPublicProfileId?: string;
  fromPlayerName: string;
  fromPlayerTag?: string;
  fromAvatar?: AvatarConfig;
  toPublicProfileId?: string;
  toPlayerName: string;
  worldType: WorldType;
  playerCount: number;
  maxPlayers: number;
  sentAt: number;
  modMetadata?: ProtocolWorldModMetadata;
}

export interface GameEventPayload {
  event: string;
  data?: Record<string, string | number | boolean | null | SyncedModSpawnEntry[]>;
}

export interface RoomChatMessage {
  id: string;
  playerId: string;
  publicProfileId?: string;
  playerName: string;
  playerTag?: string;
  avatar?: AvatarConfig;
  message: string;
  timestamp: number;
  isSystem?: boolean;
}

export interface RoomChatSendPayload {
  message: string;
}

export interface ChatHistoryPayload {
  messages: RoomChatMessage[];
}

export const ALLOWED_REPORT_REASONS = [
  'spam',
  'harassment',
  'cheating',
  'inappropriate_name',
  'inappropriate_profile',
  'other',
] as const;

export type PlayerReportReason = (typeof ALLOWED_REPORT_REASONS)[number];

export interface PlayerReportPayload {
  targetPlayerId: string;
  reason: PlayerReportReason;
  details?: string;
}

export interface ReportAckPayload {
  reportId: string;
  targetPlayerId: string;
  reason: PlayerReportReason;
  timestamp: number;
}

export interface ErrorPayload {
  code: string;
  message: string;
  modCompatibility?: ProtocolModCompatibilityReport;
  hostModMetadata?: ProtocolWorldModMetadata;
}

export const CLIENT_COORDINATE_EVENTS = new Set<string>([
  'COMBAT_HIT',
  'ARROW_FIRED',
  'PROJECTILE_HIT',
  'PLAYER_COLLECTED_RESOURCE',
  'ITEM_DROPPED',
  'ITEM_PICKED_UP',
  'DOOR_OPENED',
  'DOOR_CLOSED',
  'CHEST_OPENED',
  'BED_PLACED',
  'BED_USED',
  'STATION_PLACED',
  'QUEST_UPDATED',
  'CONTAINER_UPDATED',
  'BUILDING_UPDATED',
  'QUEST_OBJECT_UPDATED',
  'COOP_OBJECTIVE_PROGRESS',
  'WORLD_EVENT',
  'PLAYER_BUILD_PLACE',
  'PLAYER_BUILD_UPGRADE',
  'PLAYER_BUILD_REPAIR',
  'PLAYER_BUILD_DEMOLISH',
  'PLAYER_BUILD_PERMS',
  'PLAYER_STORAGE_TRANSFER',
  'PLAYER_FARM_TILL',
  'PLAYER_FARM_PLANT',
  'PLAYER_FARM_WATER',
  'PLAYER_FARM_HARVEST',
  'VILLAGE_REPAIR',
  'VILLAGE_PROJECT',
  'VILLAGE_DEFENSE_WON',
  'MERCHANT_BUY',
  'MERCHANT_SELL',
  'MOD_SPAWNS_SYNC',
]);

export const SERVER_ONLY_GAME_EVENTS = new Set<string>([
  'NPC_DAMAGED',
  'NPC_DIED',
  'ANIMAL_DAMAGED',
  'ANIMAL_DIED',
  'ENEMY_DAMAGED',
  'ENEMY_DIED',
  'PLAYER_DIED',
  'LOOT_GRANTED',
  'BOSS_STATE_UPDATED',
  'COOP_QUEST_UPDATED',
]);

export const ALLOWED_GAME_EVENTS = new Set<string>([
  'player:emote',
  'player:chat',
  'player:attack',
  'player:shoot',
  'player:damage-taken',
  'player:respawn',
  'player:interact',
  'world:ping-marker',
  'world:time-sync-request',
  'ITEM_USED',
  'NPC_DIALOGUE_STATE',
  ...CLIENT_COORDINATE_EVENTS,
  ...SERVER_ONLY_GAME_EVENTS,
]);

const ROOM_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;
const ROOM_CODE_RE = /^[A-Z0-9-]{4,16}$/;
const PLAYER_ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;

export function isValidRoomId(value: unknown): value is string {
  return typeof value === 'string' && ROOM_ID_RE.test(value);
}

export function isValidRoomCode(value: unknown): value is string {
  return typeof value === 'string' && ROOM_CODE_RE.test(value.trim().toUpperCase());
}

export function isValidPlayerId(value: unknown): value is string {
  return typeof value === 'string' && PLAYER_ID_RE.test(value);
}

export function sanitizeDisplayName(value: unknown, fallback = 'Adventurer'): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned.slice(0, MAX_PLAYER_NAME_LENGTH) : fallback;
}

export function sanitizeRoomName(value: unknown, fallback = 'Adventure Room'): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned.slice(0, MAX_ROOM_NAME_LENGTH) : fallback;
}

export function isValidClientMessageType(value: unknown): value is ClientMessageType {
  return (
    typeof value === 'string' &&
    (CLIENT_MESSAGE_TYPES as readonly string[]).includes(value)
  );
}

export const FORBIDDEN_CLIENT_AUTHORITY_KEYS = new Set<string>([
  'health',
  'maxHealth',
  'isDead',
  'reviveAtMs',
  'networkEntityId',
  'serverTime',
  'inventory',
  'inventoryItemIds',
  'itemCounts',
  'ammoCount',
  'equippedWeaponId',
  'claimedRewardIds',
  'items',
  'coins',
  'currency',
  'gold',
  'balance',
  'damage',
  'seed',
  'worldSeed',
  'worldType',
  'gameMode',
  'difficulty',
  'worldSettings',
  'pvpEnabled',
  'staminaUnlimited',
  'isHost',
  'hostId',
  'hostPlayerId',
  'coHostIds',
  'isCoHost',
  'role',
  'roles',
  'permissions',
  'xp',
  'level',
  'xpToNextLevel',
]);

export function findForbiddenAuthorityKey(
  obj: unknown,
  allowedKeys?: ReadonlySet<string>,
): string | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return null;
  }
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (allowedKeys?.has(key)) continue;
    if (FORBIDDEN_CLIENT_AUTHORITY_KEYS.has(key)) {
      return key;
    }
  }
  return null;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseCorePlayerMotionFields(
  obj: Record<string, unknown>,
): { ok: true; state: PlayerNetworkState } | { ok: false; reason: string } {
  const { x, y, z, yaw } = obj;
  if (
    typeof x !== 'number' ||
    !Number.isFinite(x) ||
    typeof y !== 'number' ||
    !Number.isFinite(y) ||
    typeof z !== 'number' ||
    !Number.isFinite(z) ||
    typeof yaw !== 'number' ||
    !Number.isFinite(yaw)
  ) {
    return { ok: false, reason: 'PLAYER_STATE requires finite numeric x, y, z, yaw.' };
  }

  if (Math.abs(x) > MAX_PLAYABLE_COORD || Math.abs(z) > MAX_PLAYABLE_COORD) {
    return { ok: false, reason: 'PLAYER_STATE coordinates exceed world bounds.' };
  }
  if (y < -200 || y > 1200) {
    return { ok: false, reason: 'PLAYER_STATE elevation exceeds world bounds.' };
  }

  const state: PlayerNetworkState = {
    x: round3(x),
    y: round3(y),
    z: round3(z),
    yaw: round3(yaw),
  };

  if (typeof obj.aimYaw === 'number' && Number.isFinite(obj.aimYaw)) {
    state.aimYaw = round3(Math.max(-Math.PI * 2, Math.min(Math.PI * 2, obj.aimYaw)));
  }
  if (typeof obj.pitch === 'number' && Number.isFinite(obj.pitch)) {
    state.pitch = round3(Math.max(-Math.PI, Math.min(Math.PI, obj.pitch)));
  }
  if (typeof obj.vx === 'number' && Number.isFinite(obj.vx)) {
    state.vx = round2(Math.max(-60, Math.min(60, obj.vx)));
  }
  if (typeof obj.vy === 'number' && Number.isFinite(obj.vy)) {
    state.vy = round2(Math.max(-80, Math.min(80, obj.vy)));
  }
  if (typeof obj.vz === 'number' && Number.isFinite(obj.vz)) {
    state.vz = round2(Math.max(-60, Math.min(60, obj.vz)));
  }
  if (
    obj.movementState === 'idle' ||
    obj.movementState === 'walking' ||
    obj.movementState === 'running' ||
    obj.movementState === 'jumping' ||
    obj.movementState === 'falling'
  ) {
    state.movementState = obj.movementState;
  }
  if (typeof obj.animState === 'string' && ALLOWED_ATTACK_ANIM_TYPES.has(obj.animState)) {
    state.animState = obj.animState;
  }
  if (typeof obj.sprinting === 'boolean') {
    state.sprinting = obj.sprinting;
  }
  if (typeof obj.jumping === 'boolean') {
    state.jumping = obj.jumping;
  }
  if (typeof obj.crouching === 'boolean') {
    state.crouching = obj.crouching;
  }
  if (typeof obj.grounded === 'boolean') {
    state.grounded = obj.grounded;
  }
  if (obj.weaponId === null) {
    state.weaponId = null;
  } else if (typeof obj.weaponId === 'string') {
    if (!isAllowedMultiplayerWeaponId(obj.weaponId)) {
      return { ok: false, reason: `Unknown weaponId "${obj.weaponId}".` };
    }
    state.weaponId = obj.weaponId;
  }
  if (typeof obj.bowCharging === 'boolean') {
    state.bowCharging = obj.bowCharging;
  }
  if (typeof obj.bowCharge === 'number' && Number.isFinite(obj.bowCharge)) {
    state.bowCharge = round2(Math.max(0, Math.min(1, obj.bowCharge)));
  }
  if (typeof obj.shooting === 'boolean') {
    state.shooting = obj.shooting;
  }
  if (typeof obj.reloading === 'boolean') {
    state.reloading = obj.reloading;
  }
  if (typeof obj.seq === 'number' && Number.isInteger(obj.seq) && obj.seq >= 0) {
    state.seq = obj.seq;
  }

  return { ok: true, state };
}

/**
 * Validates an untrusted client-sent PLAYER_STATE payload.
 * Rejects any forbidden server-authoritative fields.
 */
export function validatePlayerStatePayload(
  raw: unknown,
): { ok: true; state: PlayerNetworkState } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'PLAYER_STATE payload must be an object.' };
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_CLIENT_AUTHORITY_KEYS.has(key)) {
      return {
        ok: false,
        reason: `Client cannot modify authoritative field "${key}".`,
      };
    }
  }
  return parseCorePlayerMotionFields(obj);
}

/**
 * Parses a server-relayed PLAYER_STATE payload on the receiving client,
 * preserving server-stamped authoritative vitals & entity identity.
 */
export function parseRelayedPlayerStatePayload(
  raw: unknown,
): { ok: true; state: PlayerNetworkState } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'PLAYER_STATE payload must be an object.' };
  }
  const obj = raw as Record<string, unknown>;
  const core = parseCorePlayerMotionFields(obj);
  if (!core.ok) return core;

  if (typeof obj.networkEntityId === 'string' && obj.networkEntityId.length > 0) {
    core.state.networkEntityId = obj.networkEntityId;
  }
  if (typeof obj.health === 'number' && Number.isFinite(obj.health)) {
    core.state.health = Math.max(0, Math.round(obj.health));
  }
  if (typeof obj.maxHealth === 'number' && Number.isFinite(obj.maxHealth)) {
    core.state.maxHealth = Math.max(1, Math.round(obj.maxHealth));
  }
  if (typeof obj.isDead === 'boolean') {
    core.state.isDead = obj.isDead;
  }
  if (typeof obj.serverTime === 'number' && Number.isFinite(obj.serverTime)) {
    core.state.serverTime = obj.serverTime;
  }
  return core;
}

const COORDINATE_DATA_KEYS = new Set<string>([
  'x',
  'y',
  'z',
  'originX',
  'originY',
  'originZ',
  'dirX',
  'dirY',
  'dirZ',
  'yaw',
]);

export function validateGameEventPayload(
  raw: unknown,
  allowServerBroadcastFields = false,
): { ok: true; payload: GameEventPayload } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'GAME_EVENT payload must be an object.' };
  }
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.event !== 'string' ||
    obj.event.length === 0 ||
    obj.event.length > MAX_GAME_EVENT_NAME_LENGTH ||
    !ALLOWED_GAME_EVENTS.has(obj.event)
  ) {
    return { ok: false, reason: 'Unsupported or invalid GAME_EVENT name.' };
  }

  if (!allowServerBroadcastFields && SERVER_ONLY_GAME_EVENTS.has(obj.event)) {
    return {
      ok: false,
      reason: `Event "${obj.event}" is server-authoritative and cannot be emitted directly by clients.`,
    };
  }

  const allowsCoords = allowServerBroadcastFields || CLIENT_COORDINATE_EVENTS.has(obj.event);
  const sanitizedData: Record<string, string | number | boolean | null | SyncedModSpawnEntry[]> = {};
  if (obj.data !== undefined) {
    if (!obj.data || typeof obj.data !== 'object' || Array.isArray(obj.data)) {
      return { ok: false, reason: 'GAME_EVENT data must be a flat record.' };
    }
    const entries = Object.entries(obj.data as Record<string, unknown>).slice(0, 18);
    for (const [key, val] of entries) {
      if (key.length === 0 || key.length > 32) continue;
      if (!allowServerBroadcastFields) {
        const allowBuildingHealth = obj.event === 'BUILDING_UPDATED' && key === 'health';
        if (!allowBuildingHealth && (FORBIDDEN_CLIENT_AUTHORITY_KEYS.has(key) || key === 'position')) {
          return {
            ok: false,
            reason: `Client cannot supply authoritative gameplay field "${key}" in GAME_EVENT.`,
          };
        }
        if (!allowsCoords && COORDINATE_DATA_KEYS.has(key)) {
          return {
            ok: false,
            reason: `Client cannot supply coordinate field "${key}" in "${obj.event}".`,
          };
        }
      }
      if (obj.event === 'MOD_SPAWNS_SYNC' && key === 'modSpawns' && Array.isArray(val)) {
        const sanitizedSpawns: SyncedModSpawnEntry[] = [];
        for (const rawEntry of val.slice(0, 64)) {
          if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
          const e = rawEntry as Record<string, unknown>;
          if (
            typeof e.instanceId !== 'string' ||
            typeof e.modId !== 'string' ||
            typeof e.spawnId !== 'string' ||
            typeof e.contentId !== 'string' ||
            typeof e.contentType !== 'string' ||
            typeof e.x !== 'number' ||
            !Number.isFinite(e.x) ||
            Math.abs(e.x) > MAX_PLAYABLE_COORD ||
            typeof e.y !== 'number' ||
            !Number.isFinite(e.y) ||
            e.y < -200 ||
            e.y > 1200 ||
            typeof e.z !== 'number' ||
            !Number.isFinite(e.z) ||
            Math.abs(e.z) > MAX_PLAYABLE_COORD
          ) {
            continue;
          }
          const rx = typeof e.rotationX === 'number' && Number.isFinite(e.rotationX) ? e.rotationX : 0;
          const ry = typeof e.rotationY === 'number' && Number.isFinite(e.rotationY) ? e.rotationY : 0;
          const rz = typeof e.rotationZ === 'number' && Number.isFinite(e.rotationZ) ? e.rotationZ : 0;
          const sx = typeof e.scaleX === 'number' && Number.isFinite(e.scaleX) && e.scaleX > 0 ? e.scaleX : 1;
          const sy = typeof e.scaleY === 'number' && Number.isFinite(e.scaleY) && e.scaleY > 0 ? e.scaleY : 1;
          const sz = typeof e.scaleZ === 'number' && Number.isFinite(e.scaleZ) && e.scaleZ > 0 ? e.scaleZ : 1;
          const rawQty =
            typeof e.count === 'number' && Number.isFinite(e.count)
              ? e.count
              : typeof e.quantity === 'number' && Number.isFinite(e.quantity)
                ? e.quantity
                : undefined;
          const safeQty =
            rawQty !== undefined && rawQty >= 1
              ? Math.min(999, Math.trunc(rawQty))
              : undefined;
          sanitizedSpawns.push({
            instanceId: e.instanceId.slice(0, 128),
            modId: e.modId.slice(0, 64),
            spawnId: e.spawnId.slice(0, 64),
            contentId: e.contentId.slice(0, 96),
            contentType: e.contentType.slice(0, 32),
            ...(safeQty !== undefined ? { count: safeQty, quantity: safeQty } : {}),
            x: e.x,
            y: e.y,
            z: e.z,
            rotationX: rx,
            rotationY: ry,
            rotationZ: rz,
            scaleX: sx,
            scaleY: sy,
            scaleZ: sz,
            ...(e.perPlayer === true ? { perPlayer: true } : {}),
            ...(typeof e.collected === 'boolean' ? { collected: e.collected } : {}),
            ...(typeof e.defeated === 'boolean' ? { defeated: e.defeated } : {}),
            ...(typeof e.modelPath === 'string' && e.modelPath.trim()
              ? { modelPath: e.modelPath.slice(0, 200) }
              : {}),
            ...(typeof e.label === 'string' && e.label.trim()
              ? { label: e.label.slice(0, 96) }
              : {}),
          });
        }
        sanitizedData[key] = sanitizedSpawns;
      } else if (typeof val === 'string') {
        sanitizedData[key] = val.slice(0, 160);
      } else if (typeof val === 'number' && Number.isFinite(val)) {
        if (
          (key === 'x' || key === 'z' || key === 'originX' || key === 'originZ') &&
          Math.abs(val) > MAX_PLAYABLE_COORD
        ) {
          return {
            ok: false,
            reason: `Coordinate "${key}" exceeds world bounds.`,
          };
        }
        if ((key === 'y' || key === 'originY') && (val < -200 || val > 1200)) {
          return {
            ok: false,
            reason: `Elevation "${key}" exceeds world bounds.`,
          };
        }
        sanitizedData[key] = round3(val);
      } else if (typeof val === 'boolean' || val === null) {
        sanitizedData[key] = val;
      }
    }
  }

  return {
    ok: true,
    payload: {
      event: obj.event,
      data: sanitizedData,
    },
  };
}

export function validateEntitySyncBatchPayload(
  raw: unknown,
): { ok: true; payload: EntitySyncBatchPayload } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'ENTITY_SYNC payload must be an object.' };
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.entities)) {
    return { ok: false, reason: 'ENTITY_SYNC requires an entities array.' };
  }
  if (obj.entities.length > 22) {
    return { ok: false, reason: 'ENTITY_SYNC batch exceeds maximum entity count (22).' };
  }

  const sanitized: SyncedEntityDelta[] = [];
  for (const item of obj.entities) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    if (
      typeof rec.id !== 'string' ||
      rec.id.length === 0 ||
      rec.id.length > 64 ||
      (rec.kind !== 'npc' && rec.kind !== 'animal' && rec.kind !== 'enemy') ||
      typeof rec.archetype !== 'string' ||
      rec.archetype.length === 0 ||
      rec.archetype.length > 32 ||
      typeof rec.x !== 'number' ||
      !Number.isFinite(rec.x) ||
      typeof rec.y !== 'number' ||
      !Number.isFinite(rec.y) ||
      typeof rec.z !== 'number' ||
      !Number.isFinite(rec.z) ||
      typeof rec.yaw !== 'number' ||
      !Number.isFinite(rec.yaw) ||
      typeof rec.state !== 'string' ||
      rec.state.length === 0 ||
      rec.state.length > 24
    ) {
      return { ok: false, reason: 'Invalid entity delta entry in ENTITY_SYNC.' };
    }
    if (
      Math.abs(rec.x) > MAX_PLAYABLE_COORD ||
      Math.abs(rec.z) > MAX_PLAYABLE_COORD ||
      rec.y < -200 ||
      rec.y > 1200
    ) {
      continue;
    }

    const delta: SyncedEntityDelta = {
      id: rec.id,
      kind: rec.kind,
      archetype: rec.archetype,
      x: round2(rec.x),
      y: round2(rec.y),
      z: round2(rec.z),
      yaw: round2(rec.yaw),
      state: rec.state,
    };
    if (typeof rec.tx === 'number' && Number.isFinite(rec.tx)) {
      delta.tx = round2(rec.tx);
    }
    if (typeof rec.tz === 'number' && Number.isFinite(rec.tz)) {
      delta.tz = round2(rec.tz);
    }
    if (typeof rec.hp === 'number' && Number.isFinite(rec.hp)) {
      delta.hp = Math.max(0, Math.round(rec.hp));
    }
    if (typeof rec.maxHp === 'number' && Number.isFinite(rec.maxHp)) {
      delta.maxHp = Math.max(1, Math.round(rec.maxHp));
    }
    if (typeof rec.isDead === 'boolean') {
      delta.isDead = rec.isDead;
    }
    if (typeof rec.targetPlayerId === 'string' && isValidPlayerId(rec.targetPlayerId)) {
      delta.targetPlayerId = rec.targetPlayerId;
    }
    if (typeof rec.isBoss === 'boolean') {
      delta.isBoss = rec.isBoss;
    }
    if (typeof rec.bossPhase === 'number' && Number.isFinite(rec.bossPhase)) {
      delta.bossPhase = Math.max(1, Math.min(4, Math.round(rec.bossPhase)));
    }
    if (typeof rec.attackState === 'string' && rec.attackState.length > 0 && rec.attackState.length <= 24) {
      delta.attackState = rec.attackState;
    }
    if (rec.dialogueState === 'idle' || rec.dialogueState === 'talking') {
      delta.dialogueState = rec.dialogueState;
    }
    if (typeof rec.dialoguePlayerId === 'string' && isValidPlayerId(rec.dialoguePlayerId)) {
      delta.dialoguePlayerId = rec.dialoguePlayerId;
    }
    if (typeof rec.questState === 'string' && rec.questState.length > 0 && rec.questState.length <= 24) {
      delta.questState = rec.questState;
    }
    if (typeof rec.schedulePeriod === 'string' && rec.schedulePeriod.length > 0 && rec.schedulePeriod.length <= 16) {
      delta.schedulePeriod = rec.schedulePeriod;
    }
    if (typeof rec.worldId === 'string' && rec.worldId.length > 0 && rec.worldId.length <= 32) {
      delta.worldId = rec.worldId;
    }
    if (typeof rec.chunkId === 'string' && rec.chunkId.length > 0 && rec.chunkId.length <= 32) {
      delta.chunkId = rec.chunkId;
    }
    if (typeof rec.alive === 'boolean') {
      delta.alive = rec.alive;
    }
    if (typeof rec.loaded === 'boolean') {
      delta.loaded = rec.loaded;
    }
    if (rec.questTarget && typeof rec.questTarget === 'object' && !Array.isArray(rec.questTarget)) {
      const qt = rec.questTarget as Record<string, unknown>;
      if (
        typeof qt.questId === 'string' &&
        qt.questId.length > 0 &&
        qt.questId.length <= 64 &&
        typeof qt.objectiveId === 'string' &&
        qt.objectiveId.length > 0 &&
        qt.objectiveId.length <= 64 &&
        typeof qt.lifecycle === 'string' &&
        qt.lifecycle.length > 0 &&
        qt.lifecycle.length <= 32
      ) {
        delta.questTarget = {
          questId: qt.questId,
          objectiveId: qt.objectiveId,
          lifecycle: qt.lifecycle,
          ...(typeof qt.enemyType === 'string' && qt.enemyType.length > 0 && qt.enemyType.length <= 32
            ? { enemyType: qt.enemyType }
            : {}),
        };
      }
    }
    sanitized.push(delta);
  }

  const out: EntitySyncBatchPayload = { entities: sanitized };
  if (typeof obj.worldHours === 'number' && Number.isFinite(obj.worldHours)) {
    out.worldHours = round3(((obj.worldHours % 24) + 24) % 24);
  }
  if (typeof obj.weather === 'string' && obj.weather.length <= 24) {
    out.weather = obj.weather;
  }
  return { ok: true, payload: out };
}

export function sanitizeChatText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n?/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateChatMessageInput(
  raw: unknown,
): { ok: true; message: string } | { ok: false; code: string; reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      code: 'INVALID_CHAT_PAYLOAD',
      reason: 'ROOM_CHAT payload must be an object.',
    };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.message !== 'string') {
    return {
      ok: false,
      code: 'INVALID_CHAT_PAYLOAD',
      reason: 'ROOM_CHAT requires a string message.',
    };
  }
  const cleaned = sanitizeChatText(obj.message);
  if (cleaned.length === 0) {
    return {
      ok: false,
      code: 'EMPTY_CHAT_MESSAGE',
      reason: 'Chat message cannot be empty.',
    };
  }
  if (cleaned.length > MAX_CHAT_MESSAGE_LENGTH) {
    return {
      ok: false,
      code: 'CHAT_TOO_LONG',
      reason: `Chat message exceeds ${MAX_CHAT_MESSAGE_LENGTH} characters.`,
    };
  }
  return { ok: true, message: cleaned };
}

export function parseRelayedChatMessage(raw: unknown): RoomChatMessage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.id !== 'string' ||
    obj.id.length === 0 ||
    typeof obj.playerId !== 'string' ||
    typeof obj.playerName !== 'string' ||
    typeof obj.message !== 'string' ||
    typeof obj.timestamp !== 'number' ||
    !Number.isFinite(obj.timestamp)
  ) {
    return null;
  }
  const cleanedMsg = sanitizeChatText(obj.message).slice(0, MAX_CHAT_MESSAGE_LENGTH);
  if (!cleanedMsg) return null;
  return {
    id: obj.id.slice(0, 64),
    playerId: obj.playerId.slice(0, 64),
    ...(typeof obj.publicProfileId === 'string' && obj.publicProfileId.length > 0
      ? { publicProfileId: obj.publicProfileId.slice(0, 32) }
      : {}),
    playerName: sanitizeDisplayName(obj.playerName),
    ...(typeof obj.playerTag === 'string' && /^\d{4}$/.test(obj.playerTag)
      ? { playerTag: obj.playerTag }
      : {}),
    ...(obj.avatar && typeof obj.avatar === 'object'
      ? { avatar: migrateAvatarConfig(obj.avatar as AvatarConfig).avatar }
      : {}),
    message: cleanedMsg,
    timestamp: Math.round(obj.timestamp),
    ...(obj.isSystem === true ? { isSystem: true } : {}),
  };
}

export function validatePlayerReportPayload(
  raw: unknown,
  reporterPlayerId: string,
): { ok: true; payload: PlayerReportPayload } | { ok: false; code: string; reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      code: 'INVALID_REPORT_PAYLOAD',
      reason: 'PLAYER_REPORT payload must be an object.',
    };
  }
  const obj = raw as Record<string, unknown>;
  if (!isValidPlayerId(obj.targetPlayerId)) {
    return {
      ok: false,
      code: 'INVALID_TARGET_PLAYER',
      reason: 'PLAYER_REPORT requires a valid targetPlayerId.',
    };
  }
  if (obj.targetPlayerId === reporterPlayerId) {
    return {
      ok: false,
      code: 'CANNOT_REPORT_SELF',
      reason: 'You cannot report yourself.',
    };
  }
  if (
    typeof obj.reason !== 'string' ||
    !(ALLOWED_REPORT_REASONS as readonly string[]).includes(obj.reason)
  ) {
    return {
      ok: false,
      code: 'INVALID_REPORT_REASON',
      reason: 'PLAYER_REPORT requires a valid report reason.',
    };
  }
  let details: string | undefined;
  if (typeof obj.details === 'string') {
    const cleanedDetails = sanitizeChatText(obj.details).slice(
      0,
      PLAYER_REPORT_DETAILS_MAX_LENGTH,
    );
    if (cleanedDetails.length > 0) {
      details = cleanedDetails;
    }
  }
  return {
    ok: true,
    payload: {
      targetPlayerId: obj.targetPlayerId,
      reason: obj.reason as PlayerReportReason,
      ...(details ? { details } : {}),
    },
  };
}

const VALID_MOD_COMPAT_MODES = new Set(['required', 'optional', 'client_only']);
const SAFE_MOD_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/i;
const PROTOCOL_SEMVER_RE =
  /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const FORBIDDEN_MOD_METADATA_KEYS = new Set([
  'script',
  'scripts',
  'code',
  'eval',
  'executable',
  'executables',
  'binary',
  'binaries',
  'payload',
  'file',
  'files',
  'archive',
  'archivebytes',
  'dataurl',
  'filepath',
  'sourcepath',
  'assets',
  'models',
  'textures',
  'sounds',
  'music',
  'dll',
  'so',
  'wasm',
  'native',
  'buffer',
  'bytes',
  'base64',
  'content',
  'contents',
  'entry',
  'main',
]);
const FORBIDDEN_PATH_OR_EXEC_PATTERN =
  /(?:\.\.|[/\\]|%2e|\0|\.(?:js|mjs|cjs|ts|tsx|jsx|exe|dll|so|dylib|apk|dex|jar|bat|cmd|ps1|sh|wasm|py|rb|php)$)/i;

interface ProtocolSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

export function parseProtocolSemver(input: string): ProtocolSemver | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 48) return null;
  const match = PROTOCOL_SEMVER_RE.exec(trimmed);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = match[2] !== undefined ? Number(match[2]) : 0;
  const patch = match[3] !== undefined ? Number(match[3]) : 0;
  if (
    !Number.isInteger(major) ||
    !Number.isInteger(minor) ||
    !Number.isInteger(patch) ||
    major < 0 ||
    minor < 0 ||
    patch < 0
  ) {
    return null;
  }
  return {
    major,
    minor,
    patch,
    prerelease: match[4] ?? null,
  };
}

function compareProtocolSemver(a: ProtocolSemver, b: ProtocolSemver): number {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

function matchSingleProtocolComparator(version: ProtocolSemver, token: string): boolean {
  const clean = token.trim();
  if (!clean || clean === '*' || clean.toLowerCase() === 'x') return true;

  if (clean.startsWith('^')) {
    const base = parseProtocolSemver(clean.slice(1));
    if (!base) return false;
    if (compareProtocolSemver(version, base) < 0) return false;
    if (base.major > 0) return version.major === base.major;
    if (base.minor > 0) return version.major === 0 && version.minor === base.minor;
    return version.major === 0 && version.minor === 0 && version.patch === base.patch;
  }

  if (clean.startsWith('~')) {
    const rawBody = clean.slice(1).trim();
    const parts = rawBody.replace(/^v/, '').split('.');
    const base = parseProtocolSemver(rawBody);
    if (!base) return false;
    if (compareProtocolSemver(version, base) < 0) return false;
    if (parts.length <= 1) return version.major === base.major;
    return version.major === base.major && version.minor === base.minor;
  }

  const wildcardMatch = /^v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i.exec(clean);
  if (
    wildcardMatch &&
    (wildcardMatch[1] === 'x' ||
      wildcardMatch[1] === '*' ||
      wildcardMatch[2] === 'x' ||
      wildcardMatch[2] === '*' ||
      wildcardMatch[3] === 'x' ||
      wildcardMatch[3] === '*' ||
      wildcardMatch[2] === undefined ||
      wildcardMatch[3] === undefined)
  ) {
    const wMajor = wildcardMatch[1];
    const wMinor = wildcardMatch[2];
    const wPatch = wildcardMatch[3];
    if (wMajor !== 'x' && wMajor !== '*' && version.major !== Number(wMajor)) {
      return false;
    }
    if (
      wMinor !== undefined &&
      wMinor !== 'x' &&
      wMinor !== '*' &&
      version.minor !== Number(wMinor)
    ) {
      return false;
    }
    if (
      wPatch !== undefined &&
      wPatch !== 'x' &&
      wPatch !== '*' &&
      version.patch !== Number(wPatch)
    ) {
      return false;
    }
    return true;
  }

  let op = '=';
  let verStr = clean;
  if (clean.startsWith('>=')) {
    op = '>=';
    verStr = clean.slice(2);
  } else if (clean.startsWith('<=')) {
    op = '<=';
    verStr = clean.slice(2);
  } else if (clean.startsWith('>')) {
    op = '>';
    verStr = clean.slice(1);
  } else if (clean.startsWith('<')) {
    op = '<';
    verStr = clean.slice(1);
  } else if (clean.startsWith('=')) {
    op = '=';
    verStr = clean.slice(1);
  }

  const target = parseProtocolSemver(verStr);
  if (!target) return false;
  const cmp = compareProtocolSemver(version, target);

  switch (op) {
    case '>=':
      return cmp >= 0;
    case '<=':
      return cmp <= 0;
    case '>':
      return cmp > 0;
    case '<':
      return cmp < 0;
    case '=':
    default:
      return cmp === 0;
  }
}

export function isValidProtocolSemverRange(rangeExpr: string): boolean {
  if (typeof rangeExpr !== 'string' || !rangeExpr.trim() || rangeExpr.length > 48) {
    return false;
  }
  const orClauses = rangeExpr
    .split('||')
    .map((s) => s.trim())
    .filter(Boolean);
  if (orClauses.length === 0) return false;

  return orClauses.every((clause) => {
    const hyphenMatch = /^(.+?)\s+-\s+(.+)$/.exec(clause);
    if (hyphenMatch) {
      return Boolean(
        parseProtocolSemver(hyphenMatch[1]) && parseProtocolSemver(hyphenMatch[2]),
      );
    }
    const tokens = clause.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    return tokens.every((tok) => {
      if (tok === '*' || tok.toLowerCase() === 'x') return true;
      return (
        parseProtocolSemver(tok.replace(/^[~^=<>]+/, '')) !== null ||
        /^v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i.test(tok)
      );
    });
  });
}

export function satisfiesProtocolSemverRange(
  versionStr: string,
  rangeExpr: string,
): boolean {
  const version = parseProtocolSemver(versionStr);
  if (!version) return false;
  if (typeof rangeExpr !== 'string' || !rangeExpr.trim() || rangeExpr.length > 48) {
    return false;
  }

  const orClauses = rangeExpr
    .split('||')
    .map((s) => s.trim())
    .filter(Boolean);
  if (orClauses.length === 0) return false;

  return orClauses.some((clause) => {
    const hyphenMatch = /^(.+?)\s+-\s+(.+)$/.exec(clause);
    if (hyphenMatch) {
      return (
        matchSingleProtocolComparator(version, `>=${hyphenMatch[1].trim()}`) &&
        matchSingleProtocolComparator(version, `<=${hyphenMatch[2].trim()}`)
      );
    }
    const tokens = clause.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    return tokens.every((tok) => matchSingleProtocolComparator(version, tok));
  });
}

function sanitizeModTextField(raw: unknown, maxLen: number, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, maxLen);
}

function sanitizeProtocolModDependencies(rawDeps: unknown): ProtocolModDependency[] | undefined {
  if (!Array.isArray(rawDeps) || rawDeps.length === 0) return undefined;
  const out: ProtocolModDependency[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawDeps.length && out.length < MAX_DEPS_PER_MOD; i += 1) {
    const dep = rawDeps[i];
    if (typeof dep === 'string') {
      const modId = dep.trim().slice(0, 64);
      if (!modId || !SAFE_MOD_ID_PATTERN.test(modId) || seen.has(modId)) continue;
      seen.add(modId);
      out.push({ modId });
      continue;
    }
    if (!dep || typeof dep !== 'object' || Array.isArray(dep)) continue;
    const rec = dep as Record<string, unknown>;
    const modId = typeof rec.modId === 'string' ? rec.modId.trim().slice(0, 64) : '';
    if (!modId || !SAFE_MOD_ID_PATTERN.test(modId) || seen.has(modId)) continue;
    const rawRange =
      typeof rec.versionRange === 'string'
        ? rec.versionRange.trim().slice(0, 32)
        : undefined;
    const versionRange =
      rawRange && isValidProtocolSemverRange(rawRange) ? rawRange : undefined;
    seen.add(modId);
    out.push({
      modId,
      ...(versionRange ? { versionRange } : {}),
      ...(rec.optional === true ? { optional: true } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

export type ModMetadataValidationResult =
  | { ok: true; value: ProtocolWorldModMetadata | null }
  | {
      ok: false;
      status: 400 | 413;
      error: 'INVALID_MOD_METADATA' | 'MOD_METADATA_TOO_LARGE';
      message: string;
    };

function hasForbiddenModFieldOrTraversal(
  obj: Record<string, unknown>,
): string | null {
  for (const [k, v] of Object.entries(obj)) {
    if (FORBIDDEN_MOD_METADATA_KEYS.has(k.toLowerCase())) {
      return `Forbidden mod metadata field "${k}" is not allowed.`;
    }
    if (typeof v === 'string' && FORBIDDEN_PATH_OR_EXEC_PATTERN.test(v)) {
      return `Unsafe path or executable reference in "${k}".`;
    }
  }
  return null;
}

/**
 * Strict validator for untrusted client/host mod metadata received over HTTP.
 * Unlike `sanitizeProtocolWorldModMetadata`, this EXPLICITLY REJECTS malformed,
 * path-traversal, executable-referencing, or oversized metadata payloads instead of
 * silently stripping bad entries into a vanilla empty list.
 */
export function validateUntrustedProtocolModMetadata(
  raw: unknown,
): ModMetadataValidationResult {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_MOD_METADATA',
      message: 'Mod metadata must be a JSON object.',
    };
  }

  try {
    const serialized = JSON.stringify(raw);
    const byteLen = new TextEncoder().encode(serialized).byteLength;
    if (byteLen > MAX_MOD_METADATA_BYTES) {
      return {
        ok: false,
        status: 413,
        error: 'MOD_METADATA_TOO_LARGE',
        message: `Mod metadata exceeds maximum size (${MAX_MOD_METADATA_BYTES} bytes).`,
      };
    }
  } catch {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_MOD_METADATA',
      message: 'Mod metadata is not serializable.',
    };
  }

  const obj = raw as Record<string, unknown>;
  const rootViolation = hasForbiddenModFieldOrTraversal(obj);
  if (rootViolation) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_MOD_METADATA',
      message: rootViolation,
    };
  }

  if (
    obj.savedAtGameVersion !== undefined &&
    (typeof obj.savedAtGameVersion !== 'string' ||
      !isValidProtocolSemverRange(obj.savedAtGameVersion.trim()))
  ) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_MOD_METADATA',
      message: 'Mod metadata contains an invalid savedAtGameVersion.',
    };
  }

  if (
    obj.modApiVersion !== undefined &&
    (typeof obj.modApiVersion !== 'number' || !Number.isFinite(obj.modApiVersion) || obj.modApiVersion < 1)
  ) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_MOD_METADATA',
      message: 'Mod metadata contains an invalid modApiVersion.',
    };
  }

  if (
    obj.schemaVersion !== undefined &&
    (typeof obj.schemaVersion !== 'number' || !Number.isFinite(obj.schemaVersion) || obj.schemaVersion < 1)
  ) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_MOD_METADATA',
      message: 'Mod metadata contains an invalid schemaVersion.',
    };
  }

  if (obj.mods !== undefined && !Array.isArray(obj.mods)) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_MOD_METADATA',
      message: 'Mod metadata "mods" field must be an array.',
    };
  }

  const rawMods = Array.isArray(obj.mods) ? obj.mods : [];
  if (rawMods.length > MAX_MODS_PER_METADATA) {
    return {
      ok: false,
      status: 413,
      error: 'MOD_METADATA_TOO_LARGE',
      message: `Mod metadata exceeds maximum limit of ${MAX_MODS_PER_METADATA} mods.`,
    };
  }

  for (let i = 0; i < rawMods.length; i += 1) {
    const entry = rawMods[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return {
        ok: false,
        status: 400,
        error: 'INVALID_MOD_METADATA',
        message: `Mod entry at mods[${i}] must be an object.`,
      };
    }
    const rec = entry as Record<string, unknown>;
    const entryViolation = hasForbiddenModFieldOrTraversal(rec);
    if (entryViolation) {
      return {
        ok: false,
        status: 400,
        error: 'INVALID_MOD_METADATA',
        message: `mods[${i}]: ${entryViolation}`,
      };
    }

    const modId = typeof rec.modId === 'string' ? rec.modId.trim() : '';
    if (!modId || !SAFE_MOD_ID_PATTERN.test(modId) || FORBIDDEN_PATH_OR_EXEC_PATTERN.test(modId)) {
      return {
        ok: false,
        status: 400,
        error: 'INVALID_MOD_METADATA',
        message: `Invalid modId at mods[${i}].`,
      };
    }

    const version = typeof rec.version === 'string' ? rec.version.trim() : '';
    if (!version || !parseProtocolSemver(version)) {
      return {
        ok: false,
        status: 400,
        error: 'INVALID_MOD_METADATA',
        message: `Invalid version "${version || 'missing'}" for mod "${modId}".`,
      };
    }

    if (
      rec.compatibilityVersion !== undefined &&
      (typeof rec.compatibilityVersion !== 'string' ||
        !isValidProtocolSemverRange(rec.compatibilityVersion.trim()))
    ) {
      return {
        ok: false,
        status: 400,
        error: 'INVALID_MOD_METADATA',
        message: `Invalid compatibilityVersion for mod "${modId}".`,
      };
    }

    if (
      rec.supportedGameVersion !== undefined &&
      (typeof rec.supportedGameVersion !== 'string' ||
        !isValidProtocolSemverRange(rec.supportedGameVersion.trim()))
    ) {
      return {
        ok: false,
        status: 400,
        error: 'INVALID_MOD_METADATA',
        message: `Invalid supportedGameVersion for mod "${modId}".`,
      };
    }

    if (
      rec.multiplayerCompatibility !== undefined &&
      (typeof rec.multiplayerCompatibility !== 'string' ||
        !VALID_MOD_COMPAT_MODES.has(rec.multiplayerCompatibility.trim()))
    ) {
      return {
        ok: false,
        status: 400,
        error: 'INVALID_MOD_METADATA',
        message: `Invalid multiplayerCompatibility mode for mod "${modId}".`,
      };
    }

    if (rec.dependencies !== undefined) {
      if (!Array.isArray(rec.dependencies)) {
        return {
          ok: false,
          status: 400,
          error: 'INVALID_MOD_METADATA',
          message: `Mod "${modId}" dependencies must be an array.`,
        };
      }
      if (rec.dependencies.length > MAX_DEPS_PER_MOD) {
        return {
          ok: false,
          status: 413,
          error: 'MOD_METADATA_TOO_LARGE',
          message: `Mod "${modId}" exceeds maximum dependencies (${MAX_DEPS_PER_MOD}).`,
        };
      }
      for (let d = 0; d < rec.dependencies.length; d += 1) {
        const dep = rec.dependencies[d];
        if (typeof dep === 'string') {
          const dId = dep.trim();
          if (!dId || !SAFE_MOD_ID_PATTERN.test(dId) || FORBIDDEN_PATH_OR_EXEC_PATTERN.test(dId)) {
            return {
              ok: false,
              status: 400,
              error: 'INVALID_MOD_METADATA',
              message: `Invalid dependency id in mod "${modId}".`,
            };
          }
          continue;
        }
        if (!dep || typeof dep !== 'object' || Array.isArray(dep)) {
          return {
            ok: false,
            status: 400,
            error: 'INVALID_MOD_METADATA',
            message: `Invalid dependency entry in mod "${modId}".`,
          };
        }
        const depRec = dep as Record<string, unknown>;
        const depViolation = hasForbiddenModFieldOrTraversal(depRec);
        if (depViolation) {
          return {
            ok: false,
            status: 400,
            error: 'INVALID_MOD_METADATA',
            message: `Dependency in "${modId}": ${depViolation}`,
          };
        }
        const dId = typeof depRec.modId === 'string' ? depRec.modId.trim() : '';
        if (!dId || !SAFE_MOD_ID_PATTERN.test(dId) || FORBIDDEN_PATH_OR_EXEC_PATTERN.test(dId)) {
          return {
            ok: false,
            status: 400,
            error: 'INVALID_MOD_METADATA',
            message: `Invalid dependency modId in mod "${modId}".`,
          };
        }
        if (
          depRec.versionRange !== undefined &&
          (typeof depRec.versionRange !== 'string' ||
            !isValidProtocolSemverRange(depRec.versionRange.trim()))
        ) {
          return {
            ok: false,
            status: 400,
            error: 'INVALID_MOD_METADATA',
            message: `Invalid dependency versionRange for "${dId}" in "${modId}".`,
          };
        }
      }
    }
  }

  return {
    ok: true,
    value: sanitizeProtocolWorldModMetadata(raw),
  };
}

/**
 * Strict allowlist sanitizer for multiplayer mod metadata.
 * Exchanges ONLY safe mod metadata & compatibility identifiers — strips any scripts,
 * paths, executables, asset blobs, or unrelated progression/currency/account data.
 */
export function sanitizeProtocolWorldModMetadata(
  raw: unknown,
): ProtocolWorldModMetadata | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const rawApiVersion =
    typeof obj.modApiVersion === 'number' && Number.isFinite(obj.modApiVersion)
      ? Math.max(1, Math.min(999, Math.round(obj.modApiVersion)))
      : CURRENT_MOD_API_VERSION;
  const rawSchemaVersion =
    typeof obj.schemaVersion === 'number' && Number.isFinite(obj.schemaVersion)
      ? Math.max(1, Math.min(999, Math.round(obj.schemaVersion)))
      : 1;
  const savedAtGameVersion = sanitizeModTextField(
    obj.savedAtGameVersion,
    24,
    '1.1.25',
  );

  const rawMods = Array.isArray(obj.mods) ? obj.mods : [];
  const modsById = new Map<string, ProtocolWorldModEntry>();
  for (let i = 0; i < rawMods.length && modsById.size < MAX_MODS_PER_METADATA; i += 1) {
    const entry = rawMods[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    const rawModId =
      typeof rec.modId === 'string' ? rec.modId.trim().slice(0, 64) : '';
    if (!rawModId || !SAFE_MOD_ID_PATTERN.test(rawModId)) continue;
    const compatRaw =
      typeof rec.multiplayerCompatibility === 'string'
        ? rec.multiplayerCompatibility.trim()
        : 'required';
    const multiplayerCompatibility = VALID_MOD_COMPAT_MODES.has(compatRaw)
      ? (compatRaw as 'required' | 'optional' | 'client_only')
      : 'required';
    const entryApiVersion =
      typeof rec.modApiVersion === 'number' && Number.isFinite(rec.modApiVersion)
        ? Math.max(1, Math.min(999, Math.round(rec.modApiVersion)))
        : rawApiVersion;
    const entrySchemaVersion =
      typeof rec.schemaVersion === 'number' && Number.isFinite(rec.schemaVersion)
        ? Math.max(1, Math.min(999, Math.round(rec.schemaVersion)))
        : rawSchemaVersion;

    const rawSupportedGame =
      typeof rec.supportedGameVersion === 'string'
        ? rec.supportedGameVersion.trim().slice(0, 32)
        : '';
    const supportedGameVersion =
      rawSupportedGame && isValidProtocolSemverRange(rawSupportedGame)
        ? rawSupportedGame
        : undefined;

    const rawCompatVer =
      typeof rec.compatibilityVersion === 'string'
        ? rec.compatibilityVersion.trim().slice(0, 32)
        : '';
    const compatibilityVersion =
      rawCompatVer && isValidProtocolSemverRange(rawCompatVer)
        ? rawCompatVer
        : undefined;

    const dependencies = sanitizeProtocolModDependencies(rec.dependencies);

    modsById.set(rawModId, {
      modId: rawModId,
      name: sanitizeModTextField(rec.name, 64, rawModId),
      version: sanitizeModTextField(rec.version, 32, '1.0.0'),
      ...(supportedGameVersion ? { supportedGameVersion } : {}),
      ...(compatibilityVersion ? { compatibilityVersion } : {}),
      ...(dependencies ? { dependencies } : {}),
      modApiVersion: entryApiVersion,
      schemaVersion: entrySchemaVersion,
      multiplayerCompatibility,
    });
  }

  const mods = Array.from(modsById.values()).sort((a, b) =>
    a.modId.localeCompare(b.modId),
  );

  return {
    modApiVersion: rawApiVersion,
    schemaVersion: rawSchemaVersion,
    savedAtGameVersion,
    mods,
  };
}

function areProtocolModVersionsCompatible(
  hostMod: ProtocolWorldModEntry,
  clientMod: ProtocolWorldModEntry,
): { ok: boolean; expectedLabel: string } {
  const hostRange = hostMod.compatibilityVersion?.trim();
  const clientRange = clientMod.compatibilityVersion?.trim();

  if (hostRange || clientRange) {
    const hostSatisfied = hostRange
      ? satisfiesProtocolSemverRange(clientMod.version, hostRange)
      : true;
    const clientSatisfied = clientRange
      ? satisfiesProtocolSemverRange(hostMod.version, clientRange)
      : true;
    return {
      ok: hostSatisfied && clientSatisfied,
      expectedLabel: hostRange
        ? `${hostRange} (host ${hostMod.version})`
        : hostMod.version,
    };
  }

  return {
    ok: clientMod.version === hostMod.version,
    expectedLabel: hostMod.version,
  };
}

/**
 * Formats a clear multi-line player-facing compatibility rejection message.
 */
export function formatProtocolModCompatibilityMessage(
  report: ProtocolModCompatibilityReport,
): string {
  if (report.compatible || report.issues.length === 0) {
    return report.hostModCount === 0
      ? 'Vanilla compatible.'
      : 'Mod configuration is compatible.';
  }

  const missingLines: string[] = [];
  const dependencyLines: string[] = [];
  const incompatibleLines: string[] = [];
  const unsupportedLines: string[] = [];
  const extraLines: string[] = [];

  for (const issue of report.issues) {
    const label = issue.modName || issue.modId;
    switch (issue.code) {
      case 'missing_mod':
      case 'disabled_mod':
        missingLines.push(
          `- ${label} (${issue.expectedVersion || issue.modId})`,
        );
        break;
      case 'missing_dependency':
        dependencyLines.push(
          `- ${label}${issue.dependencyModId ? ` -> ${issue.dependencyModId}` : ''}${issue.expectedVersion ? ` (${issue.expectedVersion})` : ''}`,
        );
        break;
      case 'unsupported_mod':
        unsupportedLines.push(`- ${label}: ${issue.message}`);
        break;
      case 'extra_active_mod':
        extraLines.push(
          `- ${label} (${issue.modId}${issue.actualVersion ? ` ${issue.actualVersion}` : ''})`,
        );
        break;
      case 'version_mismatch':
      case 'api_version_mismatch':
      case 'schema_version_mismatch':
      default:
        incompatibleLines.push(
          issue.expectedVersion || issue.actualVersion
            ? `- ${label}\n  Required: ${issue.expectedVersion ?? 'unknown'}\n  Installed: ${issue.actualVersion ?? 'unknown'}`
            : `- ${label}: ${issue.message}`,
        );
        break;
    }
  }

  const lines: string[] = ['Cannot join this world.'];
  if (missingLines.length > 0) {
    lines.push('Missing required mods:', ...missingLines);
  }
  if (dependencyLines.length > 0) {
    lines.push('Missing dependencies:', ...dependencyLines);
  }
  if (incompatibleLines.length > 0) {
    lines.push('Incompatible mods:', ...incompatibleLines);
  }
  if (unsupportedLines.length > 0) {
    lines.push('Unsupported mods:', ...unsupportedLines);
  }
  if (extraLines.length > 0) {
    lines.push('Extra active mods not enabled on host:', ...extraLines);
  }
  return lines.join('\n');
}

/**
 * Authoritative multiplayer mod compatibility verifier shared across worker, LAN servers, and client.
 * - Host is authoritative and determines required mods.
 * - Client-only cosmetic mods (`client_only`) never block compatibility.
 * - Extra active client gameplay mods (`required`) not present on host are rejected.
 * - Supports compatibilityVersion SemVer ranges (e.g. `1.x`, `^1.0.0`), supportedGameVersion checks, and dependency checks.
 * - Vanilla hosts and vanilla clients remain 100% compatible even when client metadata is omitted or empty.
 */
export function verifyMultiplayerModCompatibility(
  rawHostMeta: ProtocolWorldModMetadata | null | undefined,
  rawClientMeta: ProtocolWorldModMetadata | null | undefined,
  currentGameVersion = '1.1.25',
): ProtocolModCompatibilityReport {
  const hostMeta = sanitizeProtocolWorldModMetadata(rawHostMeta);
  const clientMeta = sanitizeProtocolWorldModMetadata(rawClientMeta);

  const issues: ProtocolModCompatibilityIssue[] = [];
  const hostMods = hostMeta?.mods ?? [];
  const clientMods = clientMeta?.mods ?? [];
  const hostRequiredCount = hostMods.filter(
    (m) => (m.multiplayerCompatibility ?? 'required') !== 'client_only',
  ).length;
  const effectiveGameVersion = hostMeta?.savedAtGameVersion || currentGameVersion;

  const clientById = new Map<string, ProtocolWorldModEntry>();
  for (const cm of clientMods) {
    clientById.set(cm.modId, cm);
  }

  if (hostMeta) {
    if (hostMeta.modApiVersion > CURRENT_MOD_API_VERSION) {
      issues.push({
        modId: '__mod_api__',
        code: 'api_version_mismatch',
        expectedVersion: `<= v${CURRENT_MOD_API_VERSION}`,
        actualVersion: `v${hostMeta.modApiVersion}`,
        message: `Room requires Mod API v${hostMeta.modApiVersion} (supported <= v${CURRENT_MOD_API_VERSION}).`,
      });
    }
    if (
      !(SUPPORTED_MOD_SCHEMA_VERSIONS as readonly number[]).includes(
        hostMeta.schemaVersion,
      )
    ) {
      issues.push({
        modId: '__mod_schema__',
        code: 'schema_version_mismatch',
        expectedVersion: SUPPORTED_MOD_SCHEMA_VERSIONS.join(', '),
        actualVersion: String(hostMeta.schemaVersion),
        message: `Room uses unsupported mod schema v${hostMeta.schemaVersion}.`,
      });
    }
  }

  const hostRequiredIds = new Set<string>();
  const hostAllowedClientIds = new Set<string>();
  for (const hostMod of hostMods) {
    const compat = hostMod.multiplayerCompatibility ?? 'required';
    if (compat === 'client_only') {
      continue;
    }

    hostRequiredIds.add(hostMod.modId);
    hostAllowedClientIds.add(hostMod.modId);
    for (const dep of hostMod.dependencies ?? []) {
      if (dep.optional !== true) {
        hostAllowedClientIds.add(dep.modId);
      }
    }
    const clientMod = clientById.get(hostMod.modId);

    if (!clientMod) {
      if (compat === 'required') {
        issues.push({
          modId: hostMod.modId,
          modName: hostMod.name,
          code: 'missing_mod',
          expectedVersion: hostMod.compatibilityVersion ?? hostMod.version,
          message: `Missing required mod "${hostMod.name}" (${hostMod.modId} v${hostMod.version}).`,
        });
      }
      continue;
    }

    if (compat === 'required') {
      const versionCheck = areProtocolModVersionsCompatible(hostMod, clientMod);
      if (!versionCheck.ok) {
        issues.push({
          modId: hostMod.modId,
          modName: hostMod.name,
          code: 'version_mismatch',
          expectedVersion: versionCheck.expectedLabel,
          actualVersion: clientMod.version,
          message: `Mod "${hostMod.name}" version incompatible (Required: ${versionCheck.expectedLabel}, Installed: ${clientMod.version}).`,
        });
      }

      if (
        clientMod.supportedGameVersion &&
        !satisfiesProtocolSemverRange(effectiveGameVersion, clientMod.supportedGameVersion)
      ) {
        issues.push({
          modId: hostMod.modId,
          modName: hostMod.name,
          code: 'unsupported_mod',
          expectedVersion: effectiveGameVersion,
          actualVersion: clientMod.supportedGameVersion,
          message: `Mod "${hostMod.name}" does not support game version ${effectiveGameVersion} (supports ${clientMod.supportedGameVersion}).`,
        });
      }
    }

    if (
      typeof hostMod.modApiVersion === 'number' &&
      typeof clientMod.modApiVersion === 'number' &&
      hostMod.modApiVersion !== clientMod.modApiVersion
    ) {
      issues.push({
        modId: hostMod.modId,
        modName: hostMod.name,
        code: 'api_version_mismatch',
        expectedVersion: `v${hostMod.modApiVersion}`,
        actualVersion: `v${clientMod.modApiVersion}`,
        message: `Mod "${hostMod.name}" API version mismatch (host v${hostMod.modApiVersion}, local v${clientMod.modApiVersion}).`,
      });
    }

    if (
      typeof hostMod.schemaVersion === 'number' &&
      typeof clientMod.schemaVersion === 'number' &&
      hostMod.schemaVersion !== clientMod.schemaVersion
    ) {
      issues.push({
        modId: hostMod.modId,
        modName: hostMod.name,
        code: 'schema_version_mismatch',
        expectedVersion: `v${hostMod.schemaVersion}`,
        actualVersion: `v${clientMod.schemaVersion}`,
        message: `Mod "${hostMod.name}" schema version mismatch (host v${hostMod.schemaVersion}, local v${clientMod.schemaVersion}).`,
      });
    }

    // Verify required dependencies declared on the host mod or local copy are present and compatible
    const depCandidates: ProtocolModDependency[] = [
      ...(hostMod.dependencies ?? []),
      ...(clientMod.dependencies ?? []),
    ];
    const checkedDepIds = new Set<string>();
    for (const dep of depCandidates) {
      if (dep.optional === true || checkedDepIds.has(dep.modId)) continue;
      checkedDepIds.add(dep.modId);
      const installedDep = clientById.get(dep.modId);
      if (!installedDep) {
        issues.push({
          modId: hostMod.modId,
          modName: hostMod.name,
          code: 'missing_dependency',
          dependencyModId: dep.modId,
          expectedVersion: dep.versionRange,
          message: `Mod "${hostMod.name}" requires dependency "${dep.modId}"${dep.versionRange ? ` (${dep.versionRange})` : ''}.`,
        });
      } else if (
        dep.versionRange &&
        !satisfiesProtocolSemverRange(installedDep.version, dep.versionRange)
      ) {
        issues.push({
          modId: hostMod.modId,
          modName: hostMod.name,
          code: 'missing_dependency',
          dependencyModId: dep.modId,
          expectedVersion: dep.versionRange,
          actualVersion: installedDep.version,
          message: `Mod "${hostMod.name}" requires dependency "${dep.modId}" (${dep.versionRange}), installed v${installedDep.version}.`,
        });
      }
    }
  }

  for (const clientMod of clientMods) {
    const compat = clientMod.multiplayerCompatibility ?? 'required';
    if (compat !== 'required') continue;
    if (!hostAllowedClientIds.has(clientMod.modId)) {
      issues.push({
        modId: clientMod.modId,
        modName: clientMod.name,
        code: 'extra_active_mod',
        expectedVersion: hostRequiredCount === 0 ? 'Vanilla (None)' : undefined,
        actualVersion: clientMod.version,
        message:
          hostRequiredCount === 0
            ? `Host is running a Vanilla world. Disable active gameplay mod "${clientMod.name}" (${clientMod.modId}) to join.`
            : `Local gameplay mod "${clientMod.name}" (${clientMod.modId} v${clientMod.version}) is not active on the host.`,
      });
    }
  }

  const compatible = issues.length === 0;
  const preliminary: ProtocolModCompatibilityReport = {
    compatible,
    summary: '',
    hostModCount: hostRequiredCount,
    issues,
  };
  preliminary.summary = formatProtocolModCompatibilityMessage(preliminary);
  return preliminary;
}


