import assert from 'node:assert/strict';

// ---------- Minimal headless shims ----------
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

import * as THREE from 'three';
import {
  CURRENT_GAME_VERSION,
  MINIMUM_SUPPORTED_GAME_VERSION,
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
import { ModWorldSpawner } from './src/game/mods/ModWorldSpawner';
import { resolveExternalWoa3dModel } from './src/game/mods/Woa3dModelBuilder';
import { ItemManager } from './src/game/inventory/ItemManager';
import { InventoryManager } from './src/game/inventory/InventoryManager';
import { WeaponRegistry, ModDataWeapon } from './src/game/combat/weapons/WeaponRegistry';
import { DamageSystem } from './src/game/combat/DamageSystem';
import { EnemyController } from './src/game/combat/EnemyController';
import { createEnemySharedAssets } from './src/game/combat/EnemyRig';
import { BuildingManager } from './src/game/building/BuildingManager';
import { createProceduralTextures } from './src/game/world/textures';
import { NPCManager } from './src/game/npc/NPCManager';
import { CombatManager } from './src/game/combat/CombatManager';
import { WildlifeManager } from './src/game/wildlife/WildlifeManager';
import { worldToChunkCoords, toChunkKey } from './src/game/world/ChunkManager';
import { LAKE_CENTER_X, LAKE_CENTER_Z, groundHeightAt } from './src/game/math/noise';
import type { NpcRoutinePeriod, WeatherState, WorldCollider } from './src/game/types';
import type { QuestStatus } from './src/game/quest/questTypes';
import type { WorldInteractable } from './src/game/world/WorldManager';
import type { RawDiscoveredModEntry, RawModAssetFile, RawModContentFile } from './src/utils/platformExit';
import { CURRENT_MOD_API_VERSION } from './shared/multiplayerProtocol';

// Minimal valid 1x1 PNG bytes
const MINI_PNG_BYTES = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ),
);

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
      const entryBytes = await extractWoamodEntryBytes(bytes, entry);
      const asset: RawModAssetFile = {
        category,
        relativePath: rel,
        sizeBytes: entry.uncompressedSize,
      };
      if (ext === '.woa3d') {
        asset.rawText = decoder.decode(entryBytes);
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

function createHarness(modManager: ModManager, worldSpawn: { x: number; y: number; z: number }) {
  const scene = new THREE.Scene();
  const textures = createProceduralTextures(1, 'low');
  const interactables: WorldInteractable[] = [];
  const collidersByOwner = new Map<string, WorldCollider[]>();
  const pickups = new Map<string, Parameters<ConstructorParameters<typeof ModWorldSpawner>[0]['spawnPickup']>[0]>();
  const removedPickups = new Set<string>();
  const activeChunks = new Set<string>();
  const seed = 909090;

  const itemManager = new ItemManager();
  const buildings = new BuildingManager({
    scene,
    textures,
    registerCollider: (col, owner) => {
      const key = owner ?? 'default';
      const arr = collidersByOwner.get(key) ?? [];
      arr.push(col);
      collidersByOwner.set(key, arr);
    },
    unregisterColliders: (owner) => {
      collidersByOwner.delete(owner);
    },
    interactables,
  });
  const contactShadowMap = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  const npcs = new NPCManager(scene, contactShadowMap, {
    centerX: 0,
    centerZ: 0,
    elevation: groundHeightAt(0, 0),
    clearanceRadius: 24,
  });
  const playerPosition = new THREE.Vector3(worldSpawn.x, worldSpawn.y, worldSpawn.z);
  const combat = new CombatManager({
    scene,
    contactShadowMap,
    isSoftwareGl: false,
    seed,
    playerMaxHealth: 100,
    playerPosition,
    isVillageClearance: () => false,
    onPlayerDamaged: () => {},
    onPlayerDefeated: () => {},
  });
  const wildlife = new WildlifeManager(scene, contactShadowMap, false, seed, () => false);

  const flags = new Set<string>();
  const quests = new Map<string, QuestStatus>();

  const spawner = new ModWorldSpawner({
    modManager,
    itemManager,
    buildings,
    combat,
    npcs,
    wildlife,
    spawnPickup: (opts) => {
      removedPickups.delete(opts.id);
      pickups.set(opts.id, { ...opts });
      return {
        id: opts.id,
        kind: 'pickup',
        actionVerb: 'Pick up',
        message: opts.label,
        x: opts.x,
        y: opts.y,
        z: opts.z,
        position: new THREE.Vector3(opts.x, opts.y, opts.z),
        radius: 2,
        label: opts.label,
        itemId: opts.itemId,
        count: opts.count,
        collected: false,
        mesh: new THREE.Group(),
        baseY: opts.y,
        hoverPhase: 0,
        chunkKey: opts.chunkKey ?? '0,0',
        perPlayer: opts.perPlayer,
        respawnEnabled: opts.respawnEnabled,
        respawnDelaySec: opts.respawnDelaySec,
        modId: opts.modId,
        modSpawnId: opts.modSpawnId,
        hoverBob: false,
      };
    },
    removePickup: (id) => {
      pickups.delete(id);
      removedPickups.add(id);
    },
    restorePickup: (id) => removedPickups.delete(id),
    getActiveChunkKeys: () => new Set(activeChunks),
    getLandmarks: () => [],
    getVillageAnchors: () => [],
    getWorldSpawnPoint: () => worldSpawn,
    getPlayerPosition: () => playerPosition,
    getWorldHours: () => 10,
    getRoutinePeriod: (): NpcRoutinePeriod => 'morning',
    getWeatherState: (): WeatherState => 'clear',
    getQuestStatus: (qid) => quests.get(qid) ?? 'available',
    hasDialogueFlag: (f) => flags.has(f),
    getLocalPlayerId: () => 'local-tester',
  });

  const addChunkAt = (x: number, z: number): string => {
    const c = worldToChunkCoords(x, z, 120);
    const key = toChunkKey(c.cx, c.cz);
    activeChunks.add(key);
    buildings.syncActiveChunks(activeChunks);
    return key;
  };

  const removeChunkAt = (x: number, z: number): string => {
    const c = worldToChunkCoords(x, z, 120);
    const key = toChunkKey(c.cx, c.cz);
    activeChunks.delete(key);
    buildings.syncActiveChunks(activeChunks);
    spawner.onChunkDeactivated(key);
    return key;
  };

  return {
    scene,
    seed,
    itemManager,
    buildings,
    collidersByOwner,
    npcs,
    combat,
    wildlife,
    spawner,
    pickups,
    activeChunks,
    addChunkAt,
    removeChunkAt,
  };
}

async function run(): Promise<void> {
  assert.equal(CURRENT_GAME_VERSION, '1.1.25');
  assert.equal(MINIMUM_SUPPORTED_GAME_VERSION, '1.1.24');

  // 1. Stormblade full .woamod package regression test (purely data-driven archive)
  const stormModId = 'stormblade.armory';
  const stormZip = buildZipArchive({
    'mod.json': JSON.stringify({
      modId: stormModId,
      name: 'Stormblade Armory',
      version: '1.0.3',
      author: 'ModCreator',
      description: 'Regression test mod created by Mod Creator 3.9.0',
      supportedGameVersion: '>=1.1.24',
      minGameVersion: '1.1.24',
      modCreatorVersion: '3.9.0',
      modApiVersion: CURRENT_MOD_API_VERSION,
      schemaVersion: 2,
      modTypes: ['Weapon', 'NPC', 'Building'],
      categories: ['weapons', 'npcs', 'buildings', 'spawns', 'models', 'textures'],
    }),
    'weapons/stormblade.json': JSON.stringify({
      weapons: [
        {
          id: 'stormblade',
          name: 'Stormblade',
          nameAr: 'نصل العاصفة',
          weaponKind: 'sword',
          damage: 55,
          cooldown: 0.4,
          range: 3.4,
          critChance: 0,
          icon: 'sword',
          iconTexture: 'textures/stormblade_icon.png',
          modelPath: 'models/stormblade.woa3d',
        },
      ],
    }),
    'npcs/smith.json': JSON.stringify({
      npcs: [
        {
          id: 'blade_smith',
          name: 'Kael the Bladesmith',
          nameAr: 'كيل صانع النصال',
          role: 'blacksmith',
          greeting: 'The Stormblade awaits.',
          rewardItemId: 'stormblade',
          stationary: false,
        },
      ],
    }),
    'buildings/forge.json': JSON.stringify({
      buildings: [
        {
          id: 'storm_hall',
          nameEn: 'Storm Hall',
          nameAr: 'قاعة العاصفة',
          category: 'shelter',
          tier: 1,
          isHouse: true,
          width: 6,
          depth: 6,
          wallHeight: 3,
          roofHeight: 2,
          hasDoor: true,
          doorOffset: { x: 0, y: 0, z: 3, halfW: 0.7, halfD: 0.25, height: 2.2 },
          cost: [],
        },
      ],
    }),
    'models/stormblade.woa3d': JSON.stringify({
      schemaVersion: 2,
      id: 'stormblade_mesh',
      name: 'Stormblade 3D',
      type: '3d-model',
      category: '3d-model',
      meshes: [
        { name: 'blade', vertices: [[0, 0, 0], [0.1, 1.6, 0], [-0.1, 1.6, 0]], color: '#60a5fa' },
      ],
    }),
    'textures/stormblade_icon.png': MINI_PNG_BYTES,
    'spawns/stormblade_spawns.json': JSON.stringify({
      spawns: [
        {
          spawnId: 'stormblade_pedestal',
          contentType: 'weapon',
          contentId: 'stormblade',
          mode: 'absolute',
          coordinates: { x: 14.25, y: 12.5, z: 18.75 },
          rotation: { x: 0, y: 90, z: 0 },
          rotationUnit: 'degrees',
          scale: { x: 1.3, y: 1.3, z: 1.3 },
          conditions: { onNewWorld: true, onWorldLoad: true, oneTime: true },
        },
        {
          spawnId: 'bladesmith_npc',
          contentType: 'npc',
          contentId: 'blade_smith',
          mode: 'absolute',
          coordinates: { x: 22.0, y: 11.0, z: 24.0 },
          rotation: { x: 0, y: 0.5, z: 0 },
          rotationUnit: 'radians',
          conditions: { onNewWorld: true, onWorldLoad: true, onChunkLoad: true },
        },
        {
          spawnId: 'scaled_storm_hall',
          contentType: 'building',
          contentId: 'storm_hall',
          mode: 'absolute',
          coordinates: { x: 45.0, y: 14.0, z: 45.0 },
          scale: { x: 2, y: 1.5, z: 2 },
          conditions: { onNewWorld: true, onWorldLoad: true, onChunkLoad: true },
        },
        // Overlapping building must be rejected cleanly with SPAWN_PLACEMENT_OVERLAP
        {
          spawnId: 'overlapping_storm_hall',
          contentType: 'building',
          contentId: 'storm_hall',
          mode: 'absolute',
          coordinates: { x: 46.0, y: 14.0, z: 46.0 },
        },
        // Underwater building must be rejected cleanly with SPAWN_PLACEMENT_IN_WATER
        {
          spawnId: 'underwater_storm_hall',
          contentType: 'building',
          contentId: 'storm_hall',
          mode: 'absolute',
          coordinates: { x: LAKE_CENTER_X, z: LAKE_CENTER_Z },
        },
        // onNewWorld=true, onWorldLoad=false -> must spawn on new world AND restore on reload
        {
          spawnId: 'new_world_only_blade_alt',
          contentType: 'weapon',
          contentId: 'stormblade',
          mode: 'absolute',
          coordinates: { x: 16.0, y: 12.5, z: 20.0 },
          conditions: { onNewWorld: true, onWorldLoad: false, onChunkLoad: true },
        },
        // onNewWorld=false, onWorldLoad=false -> must never spawn
        {
          spawnId: 'never_spawn_rule',
          contentType: 'weapon',
          contentId: 'stormblade',
          mode: 'absolute',
          coordinates: { x: 17.0, y: 12.5, z: 21.0 },
          conditions: { onNewWorld: false, onWorldLoad: false, onChunkLoad: true },
        },
      ],
    }),
  });

  const pkgCheck = await validateWoamodArchiveBytes(stormZip, 'stormblade_armory.woamod');
  assert.equal(pkgCheck.ok, true, `Stormblade package validation failed: ${pkgCheck.message}`);
  const rawStorm = await rawEntryFromWoamodBytes('stormblade_armory.woamod', stormZip);

  // Legacy schema v1 mod without spawns and older modCreatorVersion + rejected <1.1.24 mod
  const v1ModId = 'legacy.v1_pack';
  const v1Zip = buildZipArchive({
    'mod.json': JSON.stringify({
      modId: v1ModId,
      name: 'Legacy V1 Pack',
      version: '0.9.0',
      author: 'LegacyAuthor',
      description: 'Legacy schema v1 mod without spawns',
      supportedGameVersion: '>=1.1.24',
      modCreatorVersion: '2.4.1',
      schemaVersion: 1,
    }),
    'items/charm.json': JSON.stringify({
      items: [{ id: 'ember_charm', name: 'Ember Charm', category: 'misc' }],
    }),
  });
  const badVerZip = buildZipArchive({
    'mod.json': JSON.stringify({
      modId: 'too.old_pack',
      name: 'Too Old Pack',
      version: '1.0.0',
      author: 'OldAuthor',
      description: 'Pre-1.1.24 incompatible mod',
      supportedGameVersion: '1.1.20',
      maxGameVersion: '1.1.23',
      schemaVersion: 1,
    }),
    'items/old.json': JSON.stringify({
      items: [{ id: 'old_rock', name: 'Old Rock', category: 'misc' }],
    }),
  });

  const rawV1 = await rawEntryFromWoamodBytes('legacy_v1.woamod', v1Zip);
  const rawBadVer = await rawEntryFromWoamodBytes('too_old.woamod', badVerZip);

  const cfg: ModStateConfig = {
    version: 1,
    enabledByModId: { [stormModId]: true, [v1ModId]: true, 'too.old_pack': true },
    priorityByModId: { [stormModId]: 0, [v1ModId]: 1, 'too.old_pack': 2 },
  };
  const disc = validateDiscoveredMods([rawStorm, rawV1, rawBadVer], cfg, CURRENT_GAME_VERSION);
  const stormRec = disc.records.find((r) => r.manifest.modId === stormModId)!;
  const v1Rec = disc.records.find((r) => r.manifest.modId === v1ModId)!;
  const badRec = disc.records.find((r) => r.manifest.modId === 'too.old_pack')!;

  assert.equal(stormRec.status, 'ready');
  assert.equal(stormRec.manifest.modCreatorVersion, '3.9.0');
  assert.equal(v1Rec.status, 'ready');
  assert.equal(v1Rec.manifest.modCreatorVersion, '2.4.1');
  assert.equal(badRec.status, 'incompatible');

  const modManager = ModManager.getInstance();
  modManager.getAssetResolver().clear();
  modManager.registry.unloadAll();
  for (const rec of [stormRec, v1Rec]) {
    modManager.getAssetResolver().setModAssets(rec.manifest.modId, rec.sourceId, rec.assets);
    const loadRes = modManager.registry.loadMod({
      modId: rec.manifest.modId,
      sourceId: rec.sourceId,
      manifest: rec.manifest,
      files: rec.parsedContentFiles,
      assets: rec.assets,
    });
    assert.equal(loadRes.ok, true, `Registry load failed for ${rec.manifest.modId}`);
  }
  const snapRef = modManager.getSnapshot() as unknown as {
    mods: typeof disc.records;
    activeModIds: string[];
    loadOrder: string[];
    initialized: boolean;
  };
  snapRef.mods = disc.records;
  snapRef.activeModIds = [stormModId, v1ModId];
  snapRef.loadOrder = [stormModId, v1ModId];
  snapRef.initialized = true;

  const archivesBySource = new Map<string, Uint8Array>([
    ['stormblade_armory.woamod', stormZip],
    ['legacy_v1.woamod', v1Zip],
  ]);
  modManager.getAssetResolver().setReader(async (sourceId, relPath) => {
    const zipBytes = archivesBySource.get(sourceId);
    if (!zipBytes) return { ok: false, error: 'NOT_FOUND' };
    const { entries } = parseWoamodZipDirectory(zipBytes);
    const hit = entries.find((e) => !e.isDir && e.name === relPath);
    if (!hit) return { ok: false, error: 'ASSET_NOT_FOUND' };
    const data = await extractWoamodEntryBytes(zipBytes, hit);
    return {
      ok: true,
      base64: Buffer.from(data).toString('base64'),
      mimeType: relPath.toLowerCase().endsWith('.png') ? 'image/png' : 'application/octet-stream',
    };
  });

  // Verify iconTexture asset resolution via ModManager.resolveAssetDataUrl
  const itemMgr = new ItemManager();
  const stormItem = itemMgr.getItem(`${stormModId}:stormblade`);
  assert(stormItem, 'Stormblade must register in ItemManager');
  assert.equal(stormItem.iconTexture, `${stormModId}://textures/stormblade_icon.png`);
  const iconDataUrl = await modManager.resolveAssetDataUrl(stormItem.iconTexture!);
  assert(
    iconDataUrl && iconDataUrl.startsWith('data:image/png;base64,'),
    `Mod iconTexture must resolve to a valid PNG data URL, got ${iconDataUrl}`,
  );
  const resolvedModel = resolveExternalWoa3dModel(stormItem.modelPath);
  assert(resolvedModel, 'Stormblade .woa3d model must resolve cleanly');

  // Verify WeaponRegistry + ModDataWeapon hit damage & cooldown
  const weaponRegistry = new WeaponRegistry();
  const weapon = weaponRegistry.getOrCreate(`${stormModId}:stormblade`) as ModDataWeapon;
  assert(weapon instanceof ModDataWeapon, 'WeaponRegistry must create ModDataWeapon');
  assert.equal(weapon.stats.damage, 55);
  assert.equal(weapon.stats.cooldown, 0.4);
  assert.equal(weapon.stats.range, 3.4);

  const testScene = new THREE.Scene();
  const contactShadow = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  const enemyAssets = createEnemySharedAssets(contactShadow);
  const dummyEnemy = new EnemyController(
    {
      id: 'dummy_target',
      archetypeId: 'bandit_scout',
      x: 0,
      y: 10,
      z: 2.0,
      seed: 1,
      exactPosition: true,
      customArchetype: { maxHealth: 200, damageReduction: 0 },
    },
    enemyAssets,
    testScene,
    false,
  );
  const dmgSys = new DamageSystem();
  weapon.executeHit({
    origin: new THREE.Vector3(0, 10, 0),
    yaw: 0,
    scene: testScene,
    damageSystem: dmgSys,
    enemies: [dummyEnemy],
    spawnHitSparks: () => {},
  });
  assert.equal(
    dummyEnemy.health.getCurrentHealth(),
    145,
    'ModDataWeapon.executeHit must apply configured damage (200 - 55 = 145)',
  );

  // Verify world spawns, collider scaling, water/overlap rejection, and pickup + NPC reward -> InventoryManager
  const h = createHarness(modManager, { x: 10, y: 12, z: 10 });
  h.addChunkAt(14.25, 18.75);
  h.addChunkAt(22.0, 24.0);
  h.addChunkAt(45.0, 45.0);
  h.spawner.initializeForWorld({ worldSeed: h.seed, lifecycle: 'new_world', isRemoteClient: false });

  // World pickup + InventoryManager
  const inv = new InventoryManager(itemMgr, 32);
  const stormPickup = h.pickups.get(`${stormModId}:spawn_stormblade_pedestal#0`);
  assert(stormPickup, 'Stormblade world pickup must spawn at exact coords');
  assert.equal(stormPickup.x, 14.25);
  assert.equal(stormPickup.y, 12.5);
  assert.equal(stormPickup.z, 18.75);
  inv.addItem(stormPickup.itemId, stormPickup.count);
  h.spawner.handlePickupCollected(stormPickup.id);
  assert(inv.getItemCount(`${stormModId}:stormblade`) === 1);

  // NPC dialogue reward tree gives usable stormblade too
  const smithNpc = h.npcs.getModNpc(`${stormModId}:spawn_bladesmith_npc#0`);
  assert(smithNpc, 'Bladesmith NPC must spawn');
  const tree = smithNpc.customDialogueTree;
  assert(tree?.nodes?.root?.choices?.[0]?.effects?.[0]?.type === 'giveItem');
  const giftEff = tree.nodes.root.choices[0].effects[0];
  if (giftEff.type === 'giveItem') {
    inv.addItem(giftEff.item.id, giftEff.item.count);
  }
  assert.equal(inv.getItemCount(`${stormModId}:stormblade`), 2);

  // Scaled house collider checks (house-small width=6, depth=6, scale={2, 1.5, 2} -> halfW=6, halfD=6 on floor/roof)
  const hallColliders = h.collidersByOwner.get(`pbuild:${stormModId}:spawn_scaled_storm_hall#0`) ?? [];
  const floorCol = hallColliders.find((c) => c.kind === 'box' && c.tag === 'floor');
  const roofCol = hallColliders.find((c) => c.kind === 'box' && c.tag === 'roof');
  assert(floorCol && floorCol.kind === 'box' && floorCol.halfW === 6 && floorCol.halfD === 6, 'Scaled house floor collider must scale by sx/sz (width 6 * 2 -> halfW 6)');
  assert(roofCol && roofCol.kind === 'box' && Math.abs(roofCol.minY - (14.0 + 0.35 * 1.5 + 3 * 1.5)) < 1e-6, 'Scaled house roof collider must scale vertically by sy=1.5');

  // Diagnostics for water and overlap rejection
  const diags = modManager.getSpawnDiagnostics(stormModId);
  const overlapDiag = diags.find((d) => d.spawnId === 'overlapping_storm_hall');
  const waterDiag = diags.find((d) => d.spawnId === 'underwater_storm_hall');
  assert.equal(overlapDiag?.status, 'failed');
  assert.equal(overlapDiag?.errorCode, 'SPAWN_PLACEMENT_OVERLAP');
  assert.equal(waterDiag?.status, 'failed');
  assert.equal(waterDiag?.errorCode, 'SPAWN_PLACEMENT_IN_WATER');

  // Move Bladesmith NPC, reduce HP, rotate yaw, then unload & reload chunk -> verify moved state preserved!
  smithNpc.position.set(28.5, 11.25, 27.75);
  smithNpc.restoreModEntityState({ yaw: 2.25, hp: 62, maxHealth: 100 });
  h.removeChunkAt(22.0, 24.0);
  assert.equal(h.npcs.getModNpc(`${stormModId}:spawn_bladesmith_npc#0`), undefined, 'NPC despawns on chunk unload');
  h.addChunkAt(28.5, 27.75);
  h.spawner.onChunkActivated(toChunkKey(worldToChunkCoords(28.5, 27.75, 120).cx, worldToChunkCoords(28.5, 27.75, 120).cz));
  const reloadedSmith = h.npcs.getModNpc(`${stormModId}:spawn_bladesmith_npc#0`);
  assert(reloadedSmith, 'Moved NPC must respawn when moved-to chunk reactivates');
  assert.equal(reloadedSmith.position.x, 28.5);
  assert.equal(reloadedSmith.position.z, 27.75);
  assert(Math.abs(reloadedSmith.getYaw() - 2.25) < 1e-6);
  assert.equal(reloadedSmith.hp, 62);

  // Save/load persistence: moved NPC state + onNewWorld=true,onWorldLoad=false instance restores on world_load; never_spawn stays unspawned
  const newWorldOnlyBefore = h.pickups.get(`${stormModId}:spawn_new_world_only_blade_alt#0`);
  assert(newWorldOnlyBefore, 'onNewWorld=true, onWorldLoad=false pickup must exist on new world');
  const exportedSave = h.spawner.exportSaveState();

  const hReload = createHarness(modManager, { x: 10, y: 12, z: 10 });
  hReload.addChunkAt(14.25, 18.75);
  hReload.addChunkAt(28.5, 27.75);
  hReload.addChunkAt(16.0, 20.0);
  hReload.spawner.restoreSaveState(exportedSave, hReload.seed);
  hReload.spawner.initializeForWorld({ worldSeed: hReload.seed, lifecycle: 'world_load', isRemoteClient: false });

  const smithAfterSave = hReload.npcs.getModNpc(`${stormModId}:spawn_bladesmith_npc#0`);
  assert(smithAfterSave, 'Moved NPC must restore on world load');
  assert.equal(smithAfterSave.position.x, 28.5);
  assert.equal(smithAfterSave.position.z, 27.75);
  assert.equal(smithAfterSave.hp, 62);
  assert(hReload.pickups.has(`${stormModId}:spawn_new_world_only_blade_alt#0`), 'Persisted onNewWorld=true,onWorldLoad=false instance must restore on world_load');
  assert(!hReload.pickups.has(`${stormModId}:spawn_never_spawn_rule#0`), 'Unpersisted onWorldLoad=false rule must stay unspawned');
  assert(!hReload.pickups.has(`${stormModId}:spawn_stormblade_pedestal#0`), 'Collected oneTime pickup must not respawn after save/load');

  console.log('ALL STORMBLADE + REGRESSION VERIFICATION TESTS PASSED');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
