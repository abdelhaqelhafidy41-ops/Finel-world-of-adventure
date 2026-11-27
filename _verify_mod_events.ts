import assert from 'node:assert/strict';
import * as THREE from 'three';

// ---------- Minimal headless shims for Three.js / Browser stores ----------
function createDummyCanvasContext(): Record<string, unknown> {
  const noop = () => {};
  const imageData = { data: new Uint8ClampedArray(64 * 64 * 4), width: 64, height: 64 };
  const gradient = { addColorStop: noop };
  return new Proxy(
    {
      fillStyle: '#000',
      strokeStyle: '#000',
      font: '12px sans-serif',
      textAlign: 'left',
      textBaseline: 'top',
      lineWidth: 1,
      globalAlpha: 1,
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient,
      createPattern: () => ({}),
      createImageData: () => imageData,
      getImageData: () => imageData,
      measureText: () => ({ width: 40 }),
    },
    {
      get(target, prop) {
        if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
        return noop;
      },
    },
  );
}

if (typeof (globalThis as Record<string, unknown>).document === 'undefined') {
  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 64,
          height: 64,
          style: {},
          getContext: () => createDummyCanvasContext(),
          toDataURL: () => 'data:image/png;base64,',
        };
      }
      return { style: {}, appendChild: () => {}, setAttribute: () => {} };
    },
  };
}
if (typeof (globalThis as Record<string, unknown>).window === 'undefined') {
  const memStorage = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    localStorage: {
      getItem: (k: string) => memStorage.get(k) ?? null,
      setItem: (k: string, v: string) => memStorage.set(k, v),
      removeItem: (k: string) => memStorage.delete(k),
    },
  };
}

import {
  CURRENT_GAME_VERSION,
  MOD_API_VERSION,
  type ModAssetIndexEntry,
  type ModStateConfig,
} from './src/game/mods/modTypes';
import {
  extractWoamodEntryBytes,
  parseWoamodZipDirectory,
  validateWoamodArchiveBytes,
} from './src/game/mods/WoamodPackageValidator';
import { validateDiscoveredMods } from './src/game/mods/ModValidator';
import { ModManager } from './src/game/mods/ModManager';
import { ModEventManager, type ModEventBridge } from './src/game/mods/ModEventManager';
import { ModPlayerEventStore } from './src/game/mods/ModPlayerEventStore';
import { ItemManager } from './src/game/inventory/ItemManager';
import { InventoryManager } from './src/game/inventory/InventoryManager';
import { CraftingManager } from './src/game/inventory/CraftingManager';
import { WeaponRegistry } from './src/game/combat/weapons/WeaponRegistry';
import { CombatManager } from './src/game/combat/CombatManager';
import { WildlifeManager } from './src/game/wildlife/WildlifeManager';
import { DialogueEngine } from './src/game/dialogue/DialogueEngine';
import { StoryManager } from './src/game/story/StoryManager';
import { SideQuestManager } from './src/game/sidequest/SideQuestManager';
import { createProceduralTextures } from './src/game/world/textures';
import { migrateSaveData } from './src/game/save/saveMigrations';
import type { SaveGameData } from './src/game/save/saveTypes';
import type { RawDiscoveredModEntry, RawModAssetFile, RawModContentFile } from './src/utils/platformExit';
import type { BiomeType, NpcRoutinePeriod, WeatherState } from './src/game/types';
import type { QuestStatus } from './src/game/quest/questTypes';
import type { DialogueTree } from './src/game/dialogue/dialogueTypes';

// ---------- Store-method ZIP builder ----------
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC32_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function buildZipArchive(files: Record<string, string | Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const entries = Object.entries(files);
  for (const [rawPath, content] of entries) {
    const name = enc.encode(rawPath.replace(/\\/g, '/'));
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const sum = crc32(data);
    const l = new Uint8Array(30 + name.length);
    const ldv = new DataView(l.buffer);
    ldv.setUint32(0, 0x04034b50, true);
    ldv.setUint16(4, 20, true);
    ldv.setUint32(14, sum, true);
    ldv.setUint32(18, data.length, true);
    ldv.setUint32(22, data.length, true);
    ldv.setUint16(26, name.length, true);
    l.set(name, 30);

    const c = new Uint8Array(46 + name.length);
    const cdv = new DataView(c.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint32(16, sum, true);
    cdv.setUint32(20, data.length, true);
    cdv.setUint32(24, data.length, true);
    cdv.setUint16(28, name.length, true);
    cdv.setUint32(42, offset, true);
    c.set(name, 46);

    locals.push(l, data);
    centrals.push(c);
    offset += l.length + data.length;
  }
  const cdSize = centrals.reduce((acc, x) => acc + x.length, 0);
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, cdSize, true);
  edv.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cdSize + eocd.length);
  let cur = 0;
  for (const p of locals) {
    out.set(p, cur);
    cur += p.length;
  }
  for (const p of centrals) {
    out.set(p, cur);
    cur += p.length;
  }
  out.set(eocd, cur);
  return out;
}

const CONTENT_FOLDERS = new Set([
  'items',
  'weapons',
  'armor',
  'tools',
  'consumables',
  'resources',
  'recipes',
  'characters',
  'animals',
  'creatures',
  'monsters',
  'npcs',
  'buildings',
  'decorations',
  'spawns',
  'quests',
  'loot_tables',
  'localization',
  'events',
]);

async function rawEntryFromWoamodBytes(
  sourceId: string,
  bytes: Uint8Array,
): Promise<RawDiscoveredModEntry> {
  const { entries } = parseWoamodZipDirectory(bytes);
  const decoder = new TextDecoder('utf-8');
  const folderSet = new Set<string>();
  const contentFiles: RawModContentFile[] = [];
  const assetFiles: RawModAssetFile[] = [];
  let manifestRaw: string | null = null;

  for (const entry of entries) {
    if (entry.isDir) continue;
    const rel = entry.name;
    const parts = rel.split('/');
    const top = parts[0].toLowerCase();
    const extIdx = rel.lastIndexOf('.');
    const ext = extIdx >= 0 ? rel.slice(extIdx).toLowerCase() : '';
    if (parts.length > 1) folderSet.add(top);
    if (top === 'assets' && parts.length > 1) folderSet.add(parts[1].toLowerCase());
    if (rel === 'mod.json') {
      manifestRaw = decoder.decode(await extractWoamodEntryBytes(bytes, entry));
      continue;
    }
    if (CONTENT_FOLDERS.has(top) && ext === '.json') {
      contentFiles.push({
        category: top,
        relativePath: rel,
        rawText: decoder.decode(await extractWoamodEntryBytes(bytes, entry)),
      });
    } else {
      const category = top === 'assets' && parts[1] ? parts[1].toLowerCase() : top;
      const asset: RawModAssetFile = {
        category,
        relativePath: rel,
        sizeBytes: entry.uncompressedSize,
      };
      if (ext === '.woa3d') {
        asset.rawText = decoder.decode(await extractWoamodEntryBytes(bytes, entry));
      }
      assetFiles.push(asset);
    }
  }

  return {
    sourceId,
    sourceType: 'archive',
    installKind: 'woamod',
    packageFileName: sourceId,
    sourcePath: `Mods/${sourceId}`,
    modifiedAtMs: Date.now(),
    manifestRaw,
    manifestError: manifestRaw ? null : 'MISSING_MOD_JSON',
    presentFolders: Array.from(folderSet),
    contentFiles,
    assetFiles,
    executableFiles: [],
    archiveCorrupt: false,
  };
}

function createRuntimeHarness(modManager: ModManager, playerStore: ModPlayerEventStore) {
  const itemManager = new ItemManager();
  const inventoryManager = new InventoryManager(itemManager, 12);
  const craftingManager = new CraftingManager();
  const notifications: string[] = [];
  const soundsPlayed: string[] = [];
  const worldPickups: Array<{ itemId: string; count: number; x: number; y: number; z: number; modId: string }> = [];
  const spawnedEntities: Array<{ contentId: string; contentType?: string; x: number; y: number; z: number; modId: string }> = [];
  const startedDialogues: Array<{ npcId: string; treeId?: string }> = [];
  const statusEffectsApplied: Array<{ effectType: string; amount?: number; multiplier?: number; durationSeconds?: number }> = [];
  const questStatuses = new Map<string, QuestStatus>();

  let worldId = 'world-alpha';
  let playerLevel = 1;
  let playerXp = 0;
  let coins = 0;
  let reputation = 0;
  let playerHealth = { current: 80, max: 100 };
  let playerPos = { x: 0, y: 5, z: 4 };
  let biome: BiomeType = 'meadow';
  let hour = 10;
  let period: NpcRoutinePeriod = 'day';
  let weather: WeatherState = 'clear';

  const bridge: ModEventBridge = {
    getWorldId: () => worldId,
    getPlayerPosition: () => ({ ...playerPos }),
    getPlayerLevel: () => playerLevel,
    getPlayerHealth: () => ({ ...playerHealth }),
    getBiomeAt: () => biome,
    getTimeOfDay: () => ({ hour, period }),
    getWeather: () => weather,
    getItemCount: (itemId) => inventoryManager.getItemCount(itemId),
    getQuestStatus: (questId) => questStatuses.get(questId) ?? 'available',
    getLanguage: () => 'en',
    resolveLocalization: (key) => modManager.resolveLocalizationOverride('en', key),
    giveItem: (itemId, count, equip) => {
      const def = itemManager.getItem(itemId);
      if (!def || count <= 0) return { added: 0 };
      let added = 0;
      for (let q = Math.floor(count); q >= 1; q--) {
        if (inventoryManager.canAccept(itemId, q)) {
          inventoryManager.addItem(itemId, q);
          added = q;
          break;
        }
      }
      if (added === 0) return { added: 0, itemName: def.name };
      let equipped = false;
      if (equip) {
        const res = inventoryManager.equipItemById(itemId);
        equipped = res.action === 'equipped';
      }
      return { added, equipped, itemName: def.name };
    },
    spawnWorldPickup: (opts) => {
      worldPickups.push({
        itemId: opts.itemId,
        count: opts.count,
        x: opts.x,
        y: opts.y,
        z: opts.z,
        modId: opts.modId,
      });
      return true;
    },
    giveXp: (amount) => {
      playerXp += Math.max(0, amount);
      let leveledUp = false;
      while (playerXp >= playerLevel * 100) {
        playerXp -= playerLevel * 100;
        playerLevel += 1;
        leveledUp = true;
      }
      return { leveledUp, newLevel: playerLevel };
    },
    giveCurrency: (amount) => {
      coins += amount;
      return true;
    },
    giveReputation: (amount) => {
      reputation += amount;
      return true;
    },
    unlockRecipe: (recipeId) => {
      craftingManager.unlockRecipe(recipeId);
      return true;
    },
    startQuest: (questId) => {
      questStatuses.set(questId, 'active');
      return true;
    },
    completeQuest: (questId) => {
      questStatuses.set(questId, 'completed');
      return true;
    },
    showNotification: (message) => {
      notifications.push(message);
    },
    playSound: (soundId) => {
      const hasCustom = Boolean(modManager.getContentStore().getModSound(soundId));
      if (!hasCustom && !soundId.startsWith('core:')) return false;
      soundsPlayed.push(soundId);
      return true;
    },
    spawnEntity: (opts) => {
      spawnedEntities.push({
        contentId: opts.contentId,
        contentType: opts.contentType,
        x: opts.x,
        y: opts.y,
        z: opts.z,
        modId: opts.modId,
      });
      return true;
    },
    startDialogue: (npcId, treeId) => {
      startedDialogues.push({ npcId, treeId });
      return true;
    },
    applyStatusEffect: (opts) => {
      statusEffectsApplied.push(opts);
      return true;
    },
  };

  const eventManager = new ModEventManager(modManager, playerStore, bridge);

  return {
    itemManager,
    inventoryManager,
    craftingManager,
    eventManager,
    notifications,
    soundsPlayed,
    worldPickups,
    spawnedEntities,
    startedDialogues,
    statusEffectsApplied,
    questStatuses,
    getState: () => ({ worldId, playerLevel, playerXp, coins, reputation, playerHealth, playerPos, biome, hour, period, weather }),
    setWorldId: (id: string) => {
      worldId = id;
    },
    setPlayerLevel: (lv: number) => {
      playerLevel = lv;
    },
    setPlayerHealth: (cur: number, max = 100) => {
      playerHealth = { current: cur, max };
    },
    setPlayerPos: (x: number, y: number, z: number) => {
      playerPos = { x, y, z };
    },
    setBiome: (b: BiomeType) => {
      biome = b;
    },
    setTimeOfDay: (h: number, p: NpcRoutinePeriod) => {
      hour = h;
      period = p;
    },
    setWeather: (w: WeatherState) => {
      weather = w;
    },
  };
}

async function run(): Promise<void> {
  const modV2 = 'adventure.event_runtime_v2';
  const modV1 = 'legacy.event_runtime_v1';

  // Build schema v2 package with events/*.json + inline events + bad diagnostic test event
  const zipV2 = buildZipArchive({
    'mod.json': JSON.stringify({
      modId: modV2,
      name: 'Generic Event Runtime Pack',
      version: '2.0.0',
      author: 'QA',
      description: 'Exercises generic mod event triggers, conditions, actions, limits, and persistence',
      supportedGameVersion: CURRENT_GAME_VERSION,
      minGameVersion: '1.1.24',
      modApiVersion: MOD_API_VERSION,
      schemaVersion: 2,
      categories: ['items', 'weapons', 'recipes', 'npcs', 'monsters', 'animals', 'buildings', 'quests', 'sounds', 'localization', 'events'],
    }),
    'items/relics.json': JSON.stringify({
      items: [
        { id: 'starter_compass', name: 'Wayfinder Charm', category: 'material', stackable: true, maxStack: 10 },
        { id: 'phoenix_crest', name: 'Phoenix Crest', category: 'material', stackable: true, maxStack: 10 },
        {
          id: 'sky_gem',
          name: 'Sky Gem',
          category: 'material',
          stackable: true,
          maxStack: 20,
          events: [
            {
              eventId: 'inline_gem_collected',
              trigger: { type: 'item_collected' },
              executionMode: 'repeatable',
              actions: [{ type: 'give_currency', amount: 15 }],
            },
          ],
        },
        { id: 'heavy_ingot', name: 'Heavy Ingot', category: 'material', stackable: false, maxStack: 1 },
      ],
    }),
    'weapons/blades.json': JSON.stringify({
      weapons: [
        {
          id: 'runeblade',
          name: 'Runeblade',
          weaponKind: 'sword',
          damage: 42,
          cooldown: 0.35,
          range: 3.1,
          events: [
            {
              eventId: 'inline_runeblade_equipped',
              trigger: { type: 'item_equipped' },
              executionMode: 'once_per_world',
              actions: [{ type: 'apply_status_effect', effectType: 'damage_boost', multiplier: 1.3, durationSeconds: 20 }],
            },
          ],
        },
      ],
    }),
    'recipes/mod_recipes.json': JSON.stringify({
      recipes: [
        {
          id: 'forge_phoenix_crest',
          resultItemId: 'phoenix_crest',
          resultCount: 1,
          category: 'equipment',
          station: 'hand',
          ingredients: [{ itemId: 'sky_gem', count: 1 }],
        },
      ],
    }),
    'npcs/npcs.json': JSON.stringify({
      npcs: [
        {
          id: 'mod_archivist',
          name: 'Archivist Sera',
          role: 'scholar',
          homeX: 10,
          homeZ: 10,
          events: [
            {
              eventId: 'inline_archivist_greet',
              trigger: { type: 'npc_talk_start' },
              executionMode: 'repeatable',
              actions: [{ type: 'show_notification', message: 'Archivist greeted!' }],
            },
          ],
        },
      ],
    }),
    'monsters/beasts.json': JSON.stringify({
      monsters: [
        { id: 'void_stalker', name: 'Void Stalker', maxHealth: 35, damage: 6, speed: 3.5, xpReward: 20, coinReward: 10 },
        { id: 'abyss_titan', name: 'Abyss Titan', isBoss: true, maxHealth: 80, damage: 12, speed: 3.0, xpReward: 90, coinReward: 50 },
      ],
    }),
    'animals/fauna.json': JSON.stringify({
      animals: [
        { id: 'frost_stag', name: 'Frost Stag', maxHealth: 25, isPredator: false },
      ],
    }),
    'buildings/structures.json': JSON.stringify({
      buildings: [
        { id: 'waystone_shrine', name: 'Waystone Shrine', category: 'utility', width: 2, depth: 2, height: 3 },
      ],
    }),
    'sounds/sfx.json': JSON.stringify({
      sounds: [
        { id: 'chime_reward', audioPath: 'assets/sounds/chime_reward.wav', bus: 'ui', volume: 0.8 },
      ],
    }),
    'assets/sounds/chime_reward.wav': new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]),
    'localization/en.json': JSON.stringify({
      starter_msg: 'Welcome to the realm, adventurer!',
    }),
    'events/runtime_events.json': JSON.stringify({
      events: [
        // 1. Starter weapon/item on new world / first spawn (must NEVER re-grant on world_loaded!)
        {
          eventId: 'starter_pack_on_new_world',
          trigger: { type: 'new_world_created' },
          executionMode: 'once_per_world',
          actions: [
            { type: 'give_item', itemId: 'starter_compass', count: 1 },
            { type: 'give_weapon', itemId: 'runeblade', count: 1, equip: true },
            { type: 'show_notification', localizationKey: 'starter_msg' },
            { type: 'play_sound', soundId: 'chime_reward' },
          ],
        },
        {
          eventId: 'first_spawn_banner',
          trigger: { type: 'player_first_spawn' },
          executionMode: 'once_per_player_per_world',
          actions: [{ type: 'give_xp', amount: 110 }],
        },
        {
          eventId: 'world_load_ping',
          trigger: { type: 'world_loaded' },
          executionMode: 'repeatable',
          actions: [{ type: 'set_world_flag', flag: 'seen_world_load', value: true }],
        },
        // 2. Account-wide once_per_player test
        {
          eventId: 'account_first_respawn_gift',
          trigger: { type: 'player_respawn' },
          executionMode: 'once_per_player',
          actions: [{ type: 'unlock_achievement', achievementId: 'phoenix_risen', title: 'Phoenix Risen' }],
        },
        // 3. Spatial transition trigger
        {
          eventId: 'enter_sacred_circle',
          trigger: { type: 'player_enter_area', area: { x: 100, z: 100, radius: 10 } },
          executionMode: 'repeatable',
          actions: [{ type: 'give_currency', amount: 25 }],
        },
        {
          eventId: 'reach_ridge_coords',
          trigger: { type: 'player_reach_coordinates', area: { minX: 195, maxX: 205, minZ: 195, maxZ: 205 } },
          executionMode: 'once_per_world',
          actions: [{ type: 'unlock_recipe', recipeId: 'forge_phoenix_crest' }],
        },
        // 4. Level & Inventory triggers
        {
          eventId: 'level_3_blessing',
          trigger: { type: 'player_level_reached', targetLevel: 3 },
          executionMode: 'once_per_world',
          actions: [{ type: 'give_reputation', amount: 30 }],
        },
        // 5. Dialogue & NPC (strict choice, completion, base-game & mod NPCs)
        {
          eventId: 'base_elder_dialogue_start',
          trigger: { type: 'dialogue_started', npcId: 'elder-marcus' },
          executionMode: 'repeatable',
          actions: [{ type: 'set_world_flag', flag: 'elder_started', value: true }],
        },
        {
          eventId: 'elder_choice_blessing',
          trigger: { type: 'dialogue_choice_selected', npcId: 'elder-marcus', choiceId: 'choice_blessing' },
          executionMode: 'once_per_world',
          actions: [{ type: 'give_currency', amount: 77 }],
        },
        {
          eventId: 'elder_dialogue_complete',
          trigger: { type: 'dialogue_completed', npcId: 'elder-marcus' },
          executionMode: 'repeatable',
          actions: [{ type: 'start_quest', questId: 'q_mod_chronicle' }],
        },
        {
          eventId: 'npc_interaction_ping',
          trigger: { type: 'npc_interaction', npcId: 'mod_archivist' },
          executionMode: 'repeatable',
          actions: [{ type: 'set_world_flag', flag: 'archivist_interacted', value: true }],
        },
        {
          eventId: 'npc_quest_done_reward',
          trigger: { type: 'npc_quest_completed', npcId: 'mod_archivist' },
          executionMode: 'once_per_world',
          actions: [{ type: 'give_currency', amount: 200 }],
        },
        // 6. Combat & Kill triggers (once per death, environmental guard, weapon filter)
        {
          eventId: 'monster_kill_reward',
          trigger: { type: 'monster_killed', entityId: 'void_stalker' },
          executionMode: 'repeatable',
          actions: [{ type: 'give_xp', amount: 40 }],
        },
        {
          eventId: 'weapon_kill_reward',
          trigger: { type: 'entity_killed_with_weapon', weaponId: 'runeblade' },
          executionMode: 'repeatable',
          actions: [{ type: 'apply_status_effect', effectType: 'heal', amount: 15 }],
        },
        {
          eventId: 'boss_kill_trophy',
          trigger: { type: 'boss_killed' },
          executionMode: 'once_per_world',
          actions: [{ type: 'spawn_entity', contentId: 'mod_archivist', contentType: 'npc', offsetX: 2, offsetZ: 2 }],
        },
        {
          eventId: 'animal_kill_env_allowed',
          trigger: { type: 'animal_killed', allowEnvironmentalDeath: true, allowNonPlayerKill: true },
          executionMode: 'repeatable',
          actions: [{ type: 'set_world_flag', flag: 'env_animal_died', value: true }],
        },
        {
          eventId: 'player_hurt_speed_burst',
          trigger: { type: 'player_damaged' },
          executionMode: 'repeatable_with_cooldown',
          cooldownSeconds: 5,
          actions: [{ type: 'apply_status_effect', effectType: 'speed_boost', multiplier: 1.4, durationSeconds: 4 }],
        },
        // 7. Destruction & Gathering
        {
          eventId: 'tree_chop_bonus',
          trigger: { type: 'tree_chopped' },
          executionMode: 'max_executions',
          maxExecutions: 2,
          actions: [{ type: 'give_currency', amount: 5 }],
        },
        {
          eventId: 'ore_mine_bonus',
          trigger: { type: 'ore_mined', blockType: 'iron-ore' },
          executionMode: 'repeatable',
          actions: [{ type: 'give_currency', amount: 8 }],
        },
        {
          eventId: 'container_destroy_alert',
          trigger: { type: 'container_destroyed' },
          executionMode: 'repeatable',
          actions: [{ type: 'set_world_flag', flag: 'chest_smashed', value: true }],
        },
        // 8. Quest, Crafting, Building
        {
          eventId: 'craft_crest_complete',
          trigger: { type: 'item_crafted', itemId: 'phoenix_crest' },
          executionMode: 'once_per_world',
          actions: [{ type: 'complete_quest', questId: 'q_mod_chronicle' }],
        },
        {
          eventId: 'building_placed_flag',
          trigger: { type: 'building_placed', buildingId: 'waystone_shrine' },
          executionMode: 'once_per_world',
          actions: [{ type: 'start_dialogue', npcId: 'mod_archivist', treeId: 'shrine_blessing' }],
        },
        // 9. Complex Condition AST (all + any + not + biome/weather/time/health/quest/flags)
        {
          eventId: 'storm_ritual_chain',
          trigger: { type: 'resource_gathered', resourceKind: 'iron-ore' },
          condition: {
            kind: 'all',
            conditions: [
              { weather: ['rain', 'storm'] },
              { biome: ['highlands', 'ruins'] },
              { timeOfDay: { periods: ['night'] } },
              { playerHealth: { minPercent: 20, maxPercent: 95 } },
              { questStatus: { questId: 'q_mod_chronicle', statuses: ['completed'] } },
              {
                kind: 'any',
                conditions: [
                  { worldFlags: { required: ['ritual_ready'] } },
                  { inventoryContains: [{ itemId: 'phoenix_crest', count: 1 }] },
                ],
              },
              {
                kind: 'not',
                condition: { worldFlags: { required: ['ritual_blocked'] } },
              },
            ],
          },
          actions: [
            { type: 'emit_event', eventName: 'ritual_awakened', payload: { tier: 2 } },
          ],
        },
        {
          eventId: 'chained_ritual_awakened',
          trigger: { type: 'custom_event', eventName: 'ritual_awakened' },
          actions: [{ type: 'give_currency', amount: 500 }],
        },
        // 10. Chained cycle guard (self-triggering loop must safely halt without hanging)
        {
          eventId: 'cycle_loop_a',
          trigger: { type: 'custom_event', eventName: 'loop_ping' },
          executionMode: 'repeatable',
          actions: [
            { type: 'give_currency', amount: 1 },
            { type: 'emit_event', eventName: 'loop_ping' },
          ],
        },
        // 11. Inventory full policy tests
        {
          eventId: 'policy_pending_event',
          trigger: { type: 'custom_event', eventName: 'grant_pending_gem' },
          inventoryFullPolicy: 'pending',
          actions: [{ type: 'give_item', itemId: 'sky_gem', count: 1 }],
        },
        {
          eventId: 'policy_drop_event',
          trigger: { type: 'custom_event', eventName: 'grant_drop_gem' },
          inventoryFullPolicy: 'spawn_pickup',
          actions: [{ type: 'give_item', itemId: 'sky_gem', count: 1 }],
        },
        {
          eventId: 'policy_fail_event',
          trigger: { type: 'custom_event', eventName: 'grant_fail_gem' },
          inventoryFullPolicy: 'fail',
          actions: [{ type: 'give_item', itemId: 'sky_gem', count: 1 }],
        },
        // 12. Delayed queued trigger + Multiplayer Authority conditions
        {
          eventId: 'delayed_custom_reward',
          trigger: { type: 'custom_event', eventName: 'trigger_delayed' },
          delaySeconds: 1.5,
          actions: [{ type: 'give_currency', amount: 44 }],
        },
        {
          eventId: 'host_only_reward',
          trigger: { type: 'custom_event', eventName: 'authority_probe' },
          condition: { multiplayerAuthority: 'host_only' },
          actions: [{ type: 'set_world_flag', flag: 'host_probe_ok', value: true }],
        },
        {
          eventId: 'singleplayer_only_reward',
          trigger: { type: 'custom_event', eventName: 'authority_probe' },
          condition: { multiplayerAuthority: 'singleplayer_only' },
          actions: [{ type: 'set_world_flag', flag: 'sp_probe_ok', value: true }],
        },
        // 13. Unresolvable invalid condition leaf -> must fail safely
        {
          eventId: 'invalid_leaf_condition_event',
          trigger: { type: 'custom_event', eventName: 'invalid_leaf_probe' },
          condition: { bogusOperator: true },
          actions: [{ type: 'give_currency', amount: 9999 }],
        },
        // 14. Malformed event (unsupported trigger) -> recorded as failed diagnostic cleanly
        {
          eventId: 'malformed_trigger_event',
          trigger: { type: 'nonexistent_trigger_xyz' },
          actions: [{ type: 'give_currency', amount: 999 }],
        },
      ],
    }),
  });

  // Schema v1 mod package test
  const zipV1 = buildZipArchive({
    'mod.json': JSON.stringify({
      modId: modV1,
      name: 'Legacy v1 Pack',
      version: '1.0.0',
      author: 'QA',
      description: 'Validates schema v1 support + minGameVersion 1.1.24',
      supportedGameVersion: '1.1.24',
      minGameVersion: '1.1.24',
      modApiVersion: MOD_API_VERSION,
      schemaVersion: 1,
      categories: ['events'],
    }),
    'events/legacy.json': JSON.stringify({
      events: [
        {
          eventId: 'legacy_v1_welcome',
          trigger: { type: 'new_world_created' },
          executionMode: 'once_per_world',
          actions: [{ type: 'give_currency', amount: 33 }],
        },
      ],
    }),
  });

  const v2Check = await validateWoamodArchiveBytes(zipV2, 'event_v2.woamod');
  assert.equal(v2Check.ok, true, `v2 .woamod invalid: ${v2Check.message}`);
  const v1Check = await validateWoamodArchiveBytes(zipV1, 'event_v1.woamod');
  assert.equal(v1Check.ok, true, `v1 .woamod invalid: ${v1Check.message}`);

  const rawV2 = await rawEntryFromWoamodBytes('event_v2.woamod', zipV2);
  const rawV1 = await rawEntryFromWoamodBytes('event_v1.woamod', zipV1);
  const cfg: ModStateConfig = {
    version: 1,
    enabledByModId: { [modV2]: true, [modV1]: true },
    priorityByModId: { [modV2]: 10, [modV1]: 0 },
  };
  const disc = validateDiscoveredMods([rawV2, rawV1], cfg, CURRENT_GAME_VERSION);
  assert.equal(disc.records.length, 2);
  for (const r of disc.records) {
    assert.equal(r.status, 'ready', `Record ${r.manifest.modId} failed: ${JSON.stringify(r.diagnostics)}`);
  }

  const modManager = ModManager.getInstance();
  modManager.getAssetResolver().clear();
  modManager.registry.unloadAll();
  for (let i = 0; i < disc.records.length; i++) {
    const rec = disc.records[i];
    const raw = i === 0 ? rawV2 : rawV1;
    const assets: ModAssetIndexEntry[] = rec.assets;
    modManager.getAssetResolver().setModAssets(rec.manifest.modId, raw.sourceId, assets);
    const loadRes = modManager.registry.loadMod({
      modId: rec.manifest.modId,
      sourceId: raw.sourceId,
      manifest: rec.manifest,
      files: rec.parsedContentFiles,
      assets,
    });
    assert.equal(loadRes.ok, true, `Registry load failed for ${rec.manifest.modId}: ${JSON.stringify(loadRes.diagnostics)}`);
  }

  const playerStore = new ModPlayerEventStore();
  playerStore.clearForTests();
  const h = createRuntimeHarness(modManager, playerStore);

  // ---------- TEST 1: New World Creation + First Spawn vs World Reload ----------
  h.eventManager.initializeForWorld({
    worldId: 'world-alpha',
    lifecycle: 'new_world',
    localPlayerId: 'player-1',
    isMultiplayer: false,
    isHost: true,
  });

  // Starter items + equipped runeblade + xp + notification + sound + schema v1 currency (33)
  assert.equal(h.inventoryManager.getItemCount(`${modV2}:starter_compass`), 1, 'Starter compass granted on new world');
  assert.equal(h.inventoryManager.getItemCount(`${modV2}:runeblade`), 1, 'Starter runeblade granted on new world');
  assert.equal(h.inventoryManager.getEquippedWeaponId(), `${modV2}:runeblade`, 'Runeblade equipped on new world');
  assert.equal(h.notifications.includes('Welcome to the realm, adventurer!'), true, 'Localized notification shown');
  assert(h.soundsPlayed.some((s) => s.includes('chime_reward')), 'Custom mod sound played');
  // 110 XP from player_first_spawn leveled player from 1 -> 2 with 10 XP left
  assert.equal(h.getState().playerLevel, 2, 'First spawn XP leveled player to 2');
  assert.equal(h.getState().coins, 33, 'Schema v1 new_world_created reward granted');

  // Verify reloading the SAME world does NOT re-grant starter items or first-spawn XP
  const savedWorldState = h.eventManager.exportWorldState();
  h.eventManager.initializeForWorld({
    worldId: 'world-alpha',
    lifecycle: 'world_load',
    localPlayerId: 'player-1',
    isMultiplayer: false,
    isHost: true,
    savedWorldState,
  });
  assert.equal(h.inventoryManager.getItemCount(`${modV2}:starter_compass`), 1, 'Reload must NOT duplicate starter compass');
  assert.equal(h.getState().playerLevel, 2, 'Reload must NOT re-grant first-spawn XP');
  assert.equal(h.getState().coins, 33, 'Reload must NOT re-grant schema v1 world reward');
  assert.equal(h.eventManager.getWorldFlag('seen_world_load'), true, 'world_loaded trigger executed');

  // ---------- TEST 2: Save Migration + Player Store Cross-World Persistence ----------
  const fakeSave: SaveGameData = {
    version: 3,
    meta: {
      slotId: 'slot-1',
      worldName: 'Test',
      savedAtMs: Date.now(),
      createdAtMs: Date.now(),
      playTimeSeconds: 10,
      worldType: 'normal',
      difficulty: 'normal',
      biome: 'meadow',
      level: 2,
      timeLabel: 'Day',
      weatherState: 'clear',
      completedQuestsCount: 0,
      activeQuestsCount: 0,
      worldSeed: 12345,
    },
    player: {
      position: { x: 0, y: 5, z: 4 },
      rotation: { yaw: 0, cameraYaw: 0, cameraPitch: 0 },
      health: 100,
      stamina: 100,
      level: 2,
      xp: 10,
      coins: 33,
    },
    inventory: h.inventoryManager.exportState(),
    quests: { active: [], completed: [] },
    time: { worldHours: 10, dayCount: 1, fullDayDurationSeconds: 360, timeScale: 1, paused: false },
    weather: { currentState: 'clear', targetState: 'clear', transitionProgress: 1, durationRemaining: 60 },
    world: {
      worldSeed: 12345,
      worldType: 'normal',
      difficulty: 'normal',
      discoveredLandmarkIds: [],
      collectedInteractableIds: [],
      droppedPickups: [],
      dialogueFlags: [],
      defeatedEnemyIds: [],
      modEventState: savedWorldState,
    },
    playerModEventState: playerStore.exportSnapshot(),
  };
  const migrated = migrateSaveData(fakeSave);
  assert.equal(migrated.ok, true);
  assert(migrated.data.world.modEventState, 'Save migration must preserve world.modEventState');
  assert(migrated.data.playerModEventState, 'Save migration must preserve playerModEventState');

  // Player respawn unlocks once_per_player achievement
  h.eventManager.emit('player_respawn', { triggerInstanceId: 'respawn:1' });
  assert.equal(playerStore.getUnlockedAchievements('player-1').length, 1, 'Achievement unlocked on respawn');

  // ---------- TEST 3: Spatial Transitions (Edge-only, zero polling spam) ----------
  h.eventManager.updatePlayerPosition(0, 5, 0, true);
  h.eventManager.updatePlayerPosition(100, 5, 100); // enter
  assert.equal(h.getState().coins, 58, 'Entering sacred circle grants +25 coins');
  h.eventManager.updatePlayerPosition(101, 5, 101); // still inside -> must NOT re-fire!
  h.eventManager.updatePlayerPosition(102, 5, 102); // still inside -> must NOT re-fire!
  assert.equal(h.getState().coins, 58, 'Staying inside area must NOT re-trigger event');
  h.eventManager.updatePlayerPosition(130, 5, 130); // exit
  h.eventManager.updatePlayerPosition(100, 5, 100); // re-enter repeatable area
  assert.equal(h.getState().coins, 83, 'Re-entering repeatable area triggers +25 again');

  // Reach box coordinates (once_per_world)
  h.eventManager.updatePlayerPosition(200, 5, 200);
  h.eventManager.updatePlayerPosition(300, 5, 300);
  h.eventManager.updatePlayerPosition(200, 5, 200);
  assert.equal(
    h.craftingManager.exportState().unlockedRecipeIds.includes(`${modV2}:forge_phoenix_crest`),
    true,
    'reach_coordinates unlocked recipe once',
  );

  // ---------- TEST 4: Inline Triggers + Real DialogueEngine Choice/Cancel/Completion ----------
  h.eventManager.emit('item_collected', { itemId: `${modV2}:sky_gem`, count: 1 });
  assert.equal(h.getState().coins, 98, 'Inline gem item_collected granted +15 coins');
  h.eventManager.emit('item_equipped', { itemId: `${modV2}:runeblade`, weaponId: `${modV2}:runeblade` });
  assert(
    h.statusEffectsApplied.some((e) => e.effectType === 'damage_boost'),
    'Inline weapon item_equipped applied damage_boost',
  );

  const coinsBeforeDialogue = h.getState().coins;
  const dlgEngine = new DialogueEngine({
    playerX: 0,
    playerZ: 0,
    currentBiome: 'meadow',
    getItemCount: (id) => h.inventoryManager.getItemCount(id),
    getDiscoveredLandmarksCount: () => 1,
    giveItem: () => {},
    consumeItem: () => {},
    grantRewards: () => {},
    healPlayer: () => {},
    repairWeapons: () => {},
    notify: () => {},
  });
  dlgEngine.setModEventHooks({
    onNpcTalkStart: (ctx) => h.eventManager.emit('npc_talk_start', ctx),
    onDialogueStarted: (ctx) => h.eventManager.emit('dialogue_started', ctx),
    onDialogueChoiceSelected: (ctx) => h.eventManager.emit('dialogue_choice_selected', ctx),
    onDialogueCompleted: (ctx) => h.eventManager.emit('dialogue_completed', ctx),
  });

  const testTree: DialogueTree = {
    id: 'elder_test_tree',
    npcId: 'elder-marcus',
    defaultStartNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        speaker: 'Elder Marcus',
        lines: ['Greetings.'],
        choices: [
          { id: 'choice_farewell', label: 'Farewell', nextNodeId: 'end_node' },
          { id: 'choice_blessing', label: 'Accept Blessing', nextNodeId: 'end_node' },
        ],
      },
      end_node: {
        id: 'end_node',
        speaker: 'Elder Marcus',
        lines: ['Go well.'],
        isEnd: true,
      },
    },
  };

  // Start dialogue + pick WRONG choice + close
  dlgEngine.startDialogue({ npcId: 'elder-marcus', name: 'Elder Marcus', role: 'elder' }, testTree);
  assert.equal(h.eventManager.getWorldFlag('elder_started'), true, 'dialogue_started fired for base NPC');
  assert.equal(h.getState().coins, coinsBeforeDialogue, 'Opening dialogue must NOT grant choice reward');
  dlgEngine.selectChoice(0); // choice_farewell
  assert.equal(h.getState().coins, coinsBeforeDialogue, 'Non-matching choice must NOT grant choice_blessing reward');
  // Cancel dialogue early without terminal close(true)
  dlgEngine.startDialogue({ npcId: 'elder-marcus', name: 'Elder Marcus', role: 'elder' }, testTree);
  dlgEngine.close(false);
  assert.equal(h.questStatuses.get('q_mod_chronicle'), undefined, 'Cancelling dialogue must NOT fire dialogue_completed');

  // Select choice_blessing and reach terminal completion
  dlgEngine.selectChoice(1); // choice_blessing
  assert.equal(h.getState().coins, coinsBeforeDialogue + 77, 'Matching choice granted +77 coins');
  dlgEngine.advance(); // hits terminal end_node -> close(true)
  assert.equal(h.questStatuses.get('q_mod_chronicle'), 'active', 'dialogue_completed started quest');

  // Mod NPC interaction + inline npc_talk_start + npc_quest_completed
  h.eventManager.emit('npc_interaction', { npcId: `${modV2}:mod_archivist`, npcModId: modV2 });
  assert.equal(h.eventManager.getWorldFlag('archivist_interacted'), true, 'Mod NPC interaction fired');
  dlgEngine.startDialogue({ npcId: `${modV2}:mod_archivist`, npcModId: modV2, name: 'Sera', role: 'scholar' });
  assert(h.notifications.includes('Archivist greeted!'), 'Inline mod NPC talk trigger fired');
  h.eventManager.emit('npc_quest_completed', { npcId: `${modV2}:mod_archivist`, questId: 'q_mod_chronicle' });
  assert.equal(h.getState().coins, coinsBeforeDialogue + 77 + 200, 'npc_quest_completed rewarded +200 coins');

  // ---------- TEST 5: Real CombatManager + WildlifeManager Kill & Damage Guards ----------
  const scene = new THREE.Scene();
  const textures = createProceduralTextures();
  const combat = new CombatManager({
    scene,
    contactShadowMap: textures.contactShadowMap,
    isSoftwareGl: true,
    seed: 101,
    playerMaxHealth: 100,
    playerPosition: new THREE.Vector3(0, 5, 4),
    weaponMount: new THREE.Group(),
    onPlayerDamaged: () => {},
    onPlayerDefeated: () => {},
    onEnemyHit: () => {},
    onEnemyDefeated: (enemy, killMeta) => {
      const ctx = {
        victimEntityId: enemy.id,
        victimType: enemy.archetype.id,
        victimModId: enemy.modId,
        entityCategory: enemy.archetype.isBoss ? 'boss' : 'monster',
        weaponId: killMeta?.weaponId,
        killerId: killMeta?.killerSourceId,
        causedByPlayer: killMeta?.causedByPlayer ?? true,
        isEnvironmentalDeath: Boolean(killMeta?.isEnvironmentalDeath),
        position: { x: enemy.position.x, y: enemy.position.y, z: enemy.position.z },
        triggerInstanceId: `kill:${enemy.id}`,
      };
      h.eventManager.emit('entity_killed', ctx);
      h.eventManager.emit('monster_killed', ctx);
      if (enemy.archetype.isBoss) h.eventManager.emit('boss_killed', ctx);
      if (ctx.weaponId && ctx.causedByPlayer && !ctx.isEnvironmentalDeath) {
        h.eventManager.emit('entity_killed_with_weapon', ctx);
      }
    },
  });

  // Register modded monsters on CombatManager archetypes and spawn one
  const stalkerArch = modManager.getContentStore().getMonsterById(`${modV2}:void_stalker`);
  assert(stalkerArch, 'Modded void_stalker registered in ContentStore');
  const enemy = combat.spawnDirectEnemy({
    id: 'test-stalker-1',
    archetypeId: `${modV2}:void_stalker`,
    modId: modV2,
    x: 10,
    y: 5,
    z: 10,
  });
  assert(enemy, 'CombatManager spawned modded enemy');

  const xpBeforeKill = h.getState().playerXp + h.getState().playerLevel * 100;
  // Non-lethal hit must NOT trigger kill reward
  enemy.applyAuthoritativeHealth(20, 35, { killerSourceId: `player:${modV2}:runeblade` });
  assert.equal(h.getState().playerXp + h.getState().playerLevel * 100, xpBeforeKill, 'Non-lethal damage must NOT trigger kill event');
  assert.equal(h.statusEffectsApplied.filter((s) => s.effectType === 'heal').length, 0);

  // Lethal hit triggers ONCE
  enemy.applyAuthoritativeHealth(0, 35, { killerSourceId: `player:${modV2}:runeblade` });
  assert.equal(h.statusEffectsApplied.filter((s) => s.effectType === 'heal').length, 1, 'entity_killed_with_weapon fired once');
  // Duplicate lethal call must NOT double-fire!
  enemy.applyAuthoritativeHealth(0, 35, { killerSourceId: `player:${modV2}:runeblade` });
  assert.equal(h.statusEffectsApplied.filter((s) => s.effectType === 'heal').length, 1, 'Duplicate kill callback did NOT double-fire');

  // Environmental monster kill (no player weapon / environmental) must NOT trigger weapon kill or player-only monster kill
  const healCountBeforeEnv = h.statusEffectsApplied.filter((s) => s.effectType === 'heal').length;
  h.eventManager.emit('monster_killed', {
    victimEntityId: 'env-stalker',
    victimType: `${modV2}:void_stalker`,
    victimModId: modV2,
    entityCategory: 'monster',
    causedByPlayer: false,
    isEnvironmentalDeath: true,
    triggerInstanceId: 'kill:env-stalker',
  });
  assert.equal(
    h.statusEffectsApplied.filter((s) => s.effectType === 'heal').length,
    healCountBeforeEnv,
    'Environmental death must NOT grant weapon kill reward',
  );

  // WildlifeManager animal kill with explicit allowEnvironmentalDeath/allowNonPlayerKill
  const wildlife = new WildlifeManager(scene, textures.contactShadowMap, true, 123);
  let animalKilledHookFired = 0;
  wildlife.setCallbacks({
    onAnimalKilled: (id, species, pos, _drops, meta) => {
      animalKilledHookFired += 1;
      h.eventManager.emit('animal_killed', {
        victimEntityId: id,
        victimType: species,
        victimModId: meta?.modId,
        entityCategory: 'animal',
        causedByPlayer: meta?.causedByPlayer ?? false,
        isEnvironmentalDeath: meta?.isEnvironmentalDeath ?? false,
        position: pos,
        triggerInstanceId: `kill:${id}`,
      });
    },
  });
  wildlife.spawnModAnimal({
    id: 'test-stag-1',
    species: `${modV2}:frost_stag`,
    modId: modV2,
    x: 4,
    z: 4,
  });
  const stagKilled = wildlife.damageAnimal('test-stag-1', 999, 0, 0, 'environment');
  assert.equal(stagKilled, true);
  assert.equal(animalKilledHookFired, 1);
  assert.equal(h.eventManager.getWorldFlag('env_animal_died'), true, 'Animal kill with allowEnvironmentalDeath fired');

  // Player damaged cooldown check
  h.eventManager.emit('player_damaged', { damageAmount: 10 });
  h.eventManager.emit('player_damaged', { damageAmount: 10 }); // within 5s cooldown
  assert.equal(
    h.statusEffectsApplied.filter((s) => s.effectType === 'speed_boost').length,
    1,
    'repeatable_with_cooldown blocked immediate second damage trigger',
  );

  // Boss killed -> spawn_entity
  h.eventManager.emit('boss_killed', {
    victimEntityId: 'boss-1',
    victimType: `${modV2}:abyss_titan`,
    victimModId: modV2,
    causedByPlayer: true,
    position: { x: 25, y: 5, z: 25 },
  });
  assert(
    h.spawnedEntities.some((e) => e.contentId === 'mod_archivist' && e.x === 27 && e.z === 27),
    'boss_killed spawned entity at offset position',
  );

  // ---------- TEST 6: Destruction, Gathering, Max Executions, Crafting, Building ----------
  // Failed destruction must NOT execute
  h.eventManager.emit('tree_chopped', { blockType: 'wood', success: false, triggerInstanceId: 'fail-chop' });
  const coinsAfterChopFail = h.getState().coins;
  // Valid chops capped at max_executions = 2
  h.eventManager.emit('tree_chopped', { blockType: 'wood', success: true, triggerInstanceId: 'chop-1' });
  h.eventManager.emit('tree_chopped', { blockType: 'wood', success: true, triggerInstanceId: 'chop-2' });
  h.eventManager.emit('tree_chopped', { blockType: 'wood', success: true, triggerInstanceId: 'chop-3' });
  assert.equal(h.getState().coins, coinsAfterChopFail + 10, 'max_executions=2 capped tree_chopped rewards');

  h.eventManager.emit('ore_mined', { blockType: 'iron-ore', success: true, triggerInstanceId: 'mine-1' });
  h.eventManager.emit('container_destroyed', { structureId: 'chest-9', success: true, triggerInstanceId: 'cont-1' });
  assert.equal(h.eventManager.getWorldFlag('chest_smashed'), true);

  // Crafting & Building
  h.inventoryManager.addItem(`${modV2}:phoenix_crest`, 1);
  h.eventManager.emit('item_crafted', { itemId: `${modV2}:phoenix_crest`, count: 1, success: true });
  assert.equal(h.questStatuses.get('q_mod_chronicle'), 'completed', 'Crafting phoenix_crest completed quest');

  h.eventManager.emit('building_placed', { buildingId: `${modV2}:waystone_shrine`, success: true });
  assert(
    h.startedDialogues.some((d) => d.npcId === 'mod_archivist' && d.treeId === 'shrine_blessing'),
    'building_placed triggered start_dialogue action',
  );

  // ---------- TEST 7: Complex Condition AST + Custom Event Chaining + Cycle Guard ----------
  h.setWeather('storm');
  h.setBiome('highlands');
  h.setTimeOfDay(23, 'night');
  h.setPlayerHealth(60, 100);
  // Missing flag? Phoenix crest in inventory satisfies the ANY clause, NOT ritual_blocked satisfies NOT clause!
  const coinsBeforeStorm = h.getState().coins;
  h.eventManager.emit('resource_gathered', { resourceKind: 'iron-ore', success: true });
  assert.equal(h.getState().coins, coinsBeforeStorm + 500, 'Complex AND/ANY/NOT + custom_event chain awarded +500 coins');

  // Cycle guard test: loop_ping self-triggers emit_event -> must halt cleanly under cap without throwing
  h.eventManager.emit('custom_event', { customEventName: 'loop_ping' });
  assert(h.getState().coins > coinsBeforeStorm + 500, 'Cyclic custom_event bounded cleanly without infinite recursion');

  // Unresolvable leaf condition must fail safely
  const coinsBeforeInvalid = h.getState().coins;
  h.eventManager.emit('custom_event', { customEventName: 'invalid_leaf_probe' });
  assert.equal(h.getState().coins, coinsBeforeInvalid, 'Unresolvable condition failed safely without executing actions');

  // ---------- TEST 8: Delayed Execution & InventoryFullPolicy ----------
  const coinsBeforeDelay = h.getState().coins;
  h.eventManager.emit('custom_event', { customEventName: 'trigger_delayed' });
  assert.equal(h.getState().coins, coinsBeforeDelay, 'Delayed event waits until elapsed time passes');
  h.eventManager.update(1.6);
  assert.equal(h.getState().coins, coinsBeforeDelay + 44, 'Delayed event fired after 1.6s update(dt)');

  // Fill all 12 inventory slots with non-stackable heavy ingots
  while (h.inventoryManager.canAccept(`${modV2}:heavy_ingot`, 1)) {
    h.inventoryManager.addItem(`${modV2}:heavy_ingot`, 1);
  }
  assert.equal(h.inventoryManager.canAccept(`${modV2}:sky_gem`, 1), false, 'Inventory must now be full for sky_gem');

  // 'pending' policy queues overflow reward
  const pickupsBefore = h.worldPickups.length;
  h.eventManager.emit('custom_event', { customEventName: 'grant_pending_gem' });
  assert.equal(h.eventManager.getPendingRewardCount(), 1, 'Pending policy queued reward when inventory full');
  assert.equal(h.worldPickups.length, pickupsBefore, 'Pending policy did not drop pickup');

  // 'spawn_pickup' policy drops pickup on ground
  h.eventManager.emit('custom_event', { customEventName: 'grant_drop_gem' });
  assert.equal(h.worldPickups.length, pickupsBefore + 1, 'spawn_pickup policy dropped item in world');

  // 'fail' policy rejects without dropping or queueing
  const gemsBeforeFail = h.inventoryManager.getItemCount(`${modV2}:sky_gem`);
  h.eventManager.emit('custom_event', { customEventName: 'grant_fail_gem' });
  assert.equal(h.inventoryManager.getItemCount(`${modV2}:sky_gem`), gemsBeforeFail, 'fail policy gave no item');

  // Free space -> retryPendingRewards delivers queued sky_gem!
  h.inventoryManager.removeItem(`${modV2}:heavy_ingot`, 1);
  const delivered = h.eventManager.retryPendingRewards('inventory_changed');
  assert.equal(delivered, 1, 'Freed slot delivered pending reward');
  assert.equal(h.eventManager.getPendingRewardCount(), 0);
  assert.equal(h.inventoryManager.getItemCount(`${modV2}:sky_gem`), gemsBeforeFail + 1);

  // ---------- TEST 9: Multiplayer Authority Modes & Cross-World once_per_player ----------
  const hRemote = createRuntimeHarness(modManager, playerStore);
  hRemote.eventManager.initializeForWorld({
    worldId: 'world-beta',
    lifecycle: 'new_world',
    localPlayerId: 'player-1',
    isMultiplayer: true,
    isHost: false,
  });
  hRemote.eventManager.emit('custom_event', { customEventName: 'authority_probe' });
  assert.equal(hRemote.eventManager.getWorldFlag('host_probe_ok'), false, 'Remote client blocked host_only');
  assert.equal(hRemote.eventManager.getWorldFlag('sp_probe_ok'), false, 'MP client blocked singleplayer_only');

  // Because player-1 already unlocked account-wide achievement in world-alpha, once_per_player stays executed in world-beta!
  hRemote.eventManager.emit('player_respawn', { triggerInstanceId: 'respawn:world-beta' });
  const remoteDiags = hRemote.eventManager.getDiagnostics(modV2);
  const respawnDiag = remoteDiags.find((d) => d.eventId === 'account_first_respawn_gift');
  assert.equal(respawnDiag?.status, 'blocked_limit', 'once_per_player remains blocked across worlds');

  const malformedDiag = remoteDiags.find((d) => d.eventId === 'malformed_trigger_event');
  assert.equal(malformedDiag?.status, 'failed', 'Malformed trigger recorded cleanly as failed diagnostic');

  // Level 3 check in SP
  h.setPlayerLevel(3);
  h.eventManager.emit('player_level_reached', { playerLevel: 3 });
  assert.equal(h.getState().reputation, 30, 'player_level_reached awarded +30 reputation');

  console.log('ALL MOD EVENT RUNTIME VERIFICATIONS PASSED!');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
