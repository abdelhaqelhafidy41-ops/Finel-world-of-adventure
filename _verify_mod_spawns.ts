import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// ---------- Minimal headless browser/WebGL shims for Three.js + Managers ----------
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

class MockWebSocket extends EventTarget {
  public peer: MockWebSocket | null = null;
  public accepted = false;
  public closed = false;
  public readyState = 1;
  accept(): void {
    this.accepted = true;
  }
  serializeAttachment(): void {}
  deserializeAttachment(): unknown {
    return null;
  }
  send(data: string): void {
    const peer = this.peer;
    if (this.closed || !peer || peer.closed) return;
    setTimeout(() => {
      peer.dispatchEvent(new MessageEvent('message', { data }));
    }, 0);
  }
  close(code = 1000, reason = ''): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event('close'), { code, reason }));
    const peer = this.peer;
    if (peer && !peer.closed) {
      setTimeout(() => {
        if (!peer.closed) {
          peer.closed = true;
          peer.readyState = 3;
          peer.dispatchEvent(Object.assign(new Event('close'), { code, reason }));
        }
      }, 0);
    }
  }
}

(globalThis as Record<string, unknown>).WebSocketPair = class {
  0: MockWebSocket;
  1: MockWebSocket;
  constructor() {
    const a = new MockWebSocket();
    const b = new MockWebSocket();
    a.peer = b;
    b.peer = a;
    this[0] = a;
    this[1] = b;
  }
};

const OrigResponse = globalThis.Response;
(globalThis as Record<string, unknown>).Response = class extends OrigResponse {
  webSocket?: unknown;
  constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
    if (init?.status === 101) {
      super(null, { status: 200 });
      Object.defineProperty(this, 'status', { value: 101 });
      this.webSocket = init.webSocket;
    } else {
      super(body, init);
    }
  }
};

import * as THREE from 'three';
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
import { ModWorldSpawner } from './src/game/mods/ModWorldSpawner';
import { ItemManager } from './src/game/inventory/ItemManager';
import { WeaponRegistry } from './src/game/combat/weapons/WeaponRegistry';
import { getBlueprintById } from './src/game/building/buildingCatalog';
import { BuildingManager } from './src/game/building/BuildingManager';
import { NPCManager } from './src/game/npc/NPCManager';
import { CombatManager } from './src/game/combat/CombatManager';
import { WildlifeManager } from './src/game/wildlife/WildlifeManager';
import { createProceduralTextures } from './src/game/world/textures';
import { worldToChunkCoords, toChunkKey } from './src/game/world/ChunkManager';
import { groundHeightAt } from './src/game/math/noise';
import type { NpcRoutinePeriod, WeatherState } from './src/game/types';
import type { QuestStatus } from './src/game/quest/questTypes';
import type { WorldInteractable } from './src/game/world/WorldManager';
import type { RawDiscoveredModEntry, RawModAssetFile, RawModContentFile } from './src/utils/platformExit';
import {
  CURRENT_MOD_API_VERSION,
  SUPPORTED_MOD_SCHEMA_VERSIONS,
  type ProtocolWorldModMetadata,
  type SyncedModSpawnEntry,
} from './shared/multiplayerProtocol';
import workerApp from './workers/multiplayer/src/index';
import { MultiplayerRoomDO } from './workers/multiplayer/src/MultiplayerRoomDO';
import { RoomDirectoryDO } from './workers/multiplayer/src/RoomDirectoryDO';

const require = createRequire(import.meta.url);
const { OfflineLanServer } = require('./electron/lanServer.cjs') as {
  OfflineLanServer: new () => {
    initRoom: (options: Record<string, unknown>) => Record<string, unknown>;
    joinPlayer: (options: Record<string, unknown>) => Record<string, unknown>;
    buildWorldSnapshotForPlayer: (playerId: string) => Record<string, unknown>;
    recordWorldStateGameEvent: (
      eventName: string,
      eventData: Record<string, unknown>,
      playerId: string,
      now: number,
    ) => void;
  };
};

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

function createMockState(idStr = 'do-id') {
  const store = new Map<string, unknown>();
  return {
    id: { toString: () => idStr, equals: () => false },
    storage: {
      get: async <T = unknown>(k: string) => store.get(k) as T | undefined,
      put: async (k: string, v: unknown) => {
        store.set(k, structuredClone(v));
      },
      delete: async (k: string) => store.delete(k),
      deleteAll: async () => store.clear(),
      setAlarm: async () => {},
      deleteAlarm: async () => {},
    },
    acceptWebSocket: () => {},
    getWebSockets: () => [],
    blockConcurrencyWhile: async <T>(cb: () => Promise<T>) => cb(),
  };
}

function createWorkerHarness() {
  const rooms = new Map<string, MultiplayerRoomDO>();
  const dirState = createMockState('global-dir');
  let dirDO: RoomDirectoryDO | null = null;
  const env: Record<string, unknown> = {
    ENVIRONMENT: 'production',
    MULTIPLAYER_ROOMS: {
      idFromName: (n: string) => ({ toString: () => n, equals: () => false }),
      idFromString: (n: string) => ({ toString: () => n, equals: () => false }),
      newUniqueId: () => ({ toString: () => 'uid', equals: () => false }),
      get: (idObj: { toString: () => string }) => {
        const key = idObj.toString();
        let instance = rooms.get(key);
        if (!instance) {
          instance = new MultiplayerRoomDO(createMockState(key) as never, env as never);
          rooms.set(key, instance);
        }
        return {
          fetch: (req: RequestInfo | URL, init?: RequestInit) =>
            instance!.fetch(typeof req === 'string' || req instanceof URL ? new Request(String(req), init) : req),
        };
      },
    },
    ROOM_DIRECTORY: {
      idFromName: (n: string) => ({ toString: () => n, equals: () => false }),
      idFromString: (n: string) => ({ toString: () => n, equals: () => false }),
      newUniqueId: () => ({ toString: () => 'uid', equals: () => false }),
      get: () => {
        if (!dirDO) dirDO = new RoomDirectoryDO(dirState as never, env as never);
        return {
          fetch: (req: RequestInfo | URL, init?: RequestInit) =>
            dirDO!.fetch(typeof req === 'string' || req instanceof URL ? new Request(String(req), init) : req),
        };
      },
    },
    PLAYER_PROFILES: {
      idFromName: (n: string) => ({ toString: () => n, equals: () => false }),
      idFromString: (n: string) => ({ toString: () => n, equals: () => false }),
      newUniqueId: () => ({ toString: () => 'uid', equals: () => false }),
      get: () => ({ fetch: async () => new OrigResponse(JSON.stringify({ ok: true }), { status: 200 }) }),
    },
  };
  let ipCounter = 10;
  async function callWorker(path: string, method = 'GET', body?: unknown) {
    const req = new Request(`https://worker.test${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        'CF-Connecting-IP': `198.51.100.${ipCounter++}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const res = await workerApp.fetch(req, env as never, {} as never);
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json: json as Record<string, unknown> };
  }
  return { env, callWorker };
}

function createHarness(modManager: ModManager, worldSpawn: { x: number; y: number; z: number }) {
  const scene = new THREE.Scene();
  const textures = createProceduralTextures(1, 'low');
  const interactables: WorldInteractable[] = [];
  const pickups = new Map<string, Parameters<ConstructorParameters<typeof ModWorldSpawner>[0]['spawnPickup']>[0]>();
  const removedPickups = new Set<string>();
  const activeChunks = new Set<string>();
  const seed = 424242;

  const itemManager = new ItemManager();
  const buildings = new BuildingManager({
    scene,
    textures,
    registerCollider: () => {},
    unregisterColliders: () => {},
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

  let worldHours = 9.0;
  let weather: WeatherState = 'clear';
  const flags = new Set<string>();
  const quests = new Map<string, QuestStatus>();
  let localPlayerId = 'host-player';

  const getRoutinePeriod = (): NpcRoutinePeriod => {
    const h = ((worldHours % 24) + 24) % 24;
    if (h >= 5 && h < 11) return 'morning';
    if (h >= 11 && h < 17) return 'midday';
    if (h >= 17 && h < 21) return 'evening';
    return 'night';
  };

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
    getLandmarks: () => [
      { id: 'lm_ancient_arch', name: 'Ancient Arch', kind: 'ruins', x: 300, z: -200, discovered: true },
    ],
    getVillageAnchors: () => [
      { id: 'village_oakridge', name: 'Oakridge', x: 80, y: 12.5, z: -40 },
    ],
    getWorldSpawnPoint: () => worldSpawn,
    getPlayerPosition: () => playerPosition,
    getWorldHours: () => worldHours,
    getRoutinePeriod,
    getWeatherState: () => weather,
    getQuestStatus: (qid) => quests.get(qid) ?? 'available',
    hasDialogueFlag: (f) => flags.has(f),
    getLocalPlayerId: () => localPlayerId,
  });

  const addChunkAt = (x: number, z: number): string => {
    const c = worldToChunkCoords(x, z, 120);
    const key = toChunkKey(c.cx, c.cz);
    activeChunks.add(key);
    buildings.syncActiveChunks(activeChunks);
    return key;
  };

  return {
    seed,
    itemManager,
    buildings,
    npcs,
    combat,
    wildlife,
    spawner,
    pickups,
    activeChunks,
    playerPosition,
    addChunkAt,
    setHours: (h: number) => {
      worldHours = h;
    },
    setWeather: (w: WeatherState) => {
      weather = w;
    },
    setFlag: (f: string, enabled = true) => {
      if (enabled) flags.add(f);
      else flags.delete(f);
    },
    setQuestStatus: (qid: string, st: QuestStatus) => quests.set(qid, st),
    setLocalPlayerId: (pid: string) => {
      localPlayerId = pid;
    },
  };
}

async function run(): Promise<void> {
  // 1. Build a rich generic .woamod package exercising all spawn types, modes, conditions & failures
  const modId = 'chronicle.test_pack';
  const archive = buildZipArchive({
    'mod.json': JSON.stringify({
      modId,
      name: 'Chronicle Test Pack',
      version: '1.2.0',
      author: 'QA',
      description: 'Generic spawn verification package for schema v2 + 1.1.25',
      supportedGameVersion: '1.1.25',
      minGameVersion: '1.1.24',
      modApiVersion: MOD_API_VERSION,
      schemaVersion: 2,
      modTypes: ['Weapon', 'Decoration', 'NPC', 'Monster', 'Animal'],
      categories: [
        'weapons',
        'armor',
        'consumables',
        'decorations',
        'npcs',
        'monsters',
        'animals',
        'spawns',
        'models',
      ],
      multiplayerCompatibility: 'required',
    }),
    'weapons/blades.json': JSON.stringify({
      weapons: [
        {
          id: 'storm_saber',
          name: 'Storm Saber',
          nameAr: 'سيف العاصفة',
          weaponKind: 'sword',
          damage: 48,
          cooldown: 0.35,
          range: 3.3,
          icon: 'sword',
          modelPath: 'assets/models/storm_saber.woa3d',
        },
      ],
    }),
    'armor/cloaks.json': JSON.stringify({
      armor: [
        {
          id: 'aether_cloak',
          name: 'Aether Cloak',
          armorSlot: 'chest',
          armorBonus: 14,
          icon: 'shield',
        },
      ],
    }),
    'consumables/tonics.json': JSON.stringify({
      consumables: [
        {
          id: 'starlight_tonic',
          name: 'Starlight Tonic',
          category: 'consumable',
          usable: true,
          healAmount: 35,
          icon: 'potion',
        },
      ],
    }),
    'decorations/structures.json': JSON.stringify({
      decorations: [
        {
          id: 'runic_obelisk',
          nameEn: 'Runic Obelisk',
          nameAr: 'مسلة رونية',
          category: 'decor',
          material: 'stone',
          sizeX: 2,
          sizeZ: 2,
          height: 4,
          cost: [],
          modelPath: 'assets/models/runic_obelisk.woa3d',
        },
        {
          id: 'broken_missing_model_statue',
          nameEn: 'Missing Model Statue',
          category: 'decor',
          material: 'stone',
          sizeX: 1,
          sizeZ: 1,
          height: 2,
          modelPath: 'assets/models/does_not_exist.woa3d',
        },
      ],
    }),
    'npcs/archivist.json': JSON.stringify({
      npcs: [
        {
          id: 'archivist_orin',
          name: 'Archivist Orin',
          nameAr: 'الأرشيفي أورين',
          role: 'elder',
          title: 'Keeper',
          titleAr: 'الحافظ',
          greeting: 'Seek the saber.',
          rewardItemId: 'storm_saber',
          stationary: true,
        },
      ],
    }),
    'monsters/stalkers.json': JSON.stringify({
      monsters: [
        {
          id: 'void_stalker',
          name: 'Void Stalker',
          nameAr: 'متربص الفراغ',
          archetype: 'thorn_stalker',
          maxHealth: 220,
          damage: 24,
        },
      ],
    }),
    'animals/fauna.json': JSON.stringify({
      animals: [
        {
          id: 'frost_stag',
          name: 'Frost Stag',
          species: 'deer',
          maxHealth: 95,
          stationary: true,
        },
      ],
    }),
    'assets/models/storm_saber.woa3d': JSON.stringify({
      schemaVersion: 2,
      id: 'storm_saber_model',
      name: 'Storm Saber 3D',
      type: '3d-model',
      category: '3d-model',
      modCategory: 'Weapon',
      meshes: [
        { name: 'blade', vertices: [[0, 0, 0], [0.08, 1.5, 0], [-0.08, 1.5, 0]], color: '#38bdf8' },
      ],
    }),
    'assets/models/runic_obelisk.woa3d': JSON.stringify({
      schemaVersion: 2,
      id: 'runic_obelisk_model',
      name: 'Runic Obelisk 3D',
      type: '3d-model',
      category: '3d-model',
      modCategory: 'Decoration',
      meshes: [
        { name: 'pillar', vertices: [[-0.5, 0, -0.5], [0.5, 4, 0.5], [0, 4.5, 0]], color: '#818cf8' },
      ],
    }),
    'spawns/world_spawns.json': JSON.stringify({
      spawns: [
        // 1. Exact negative decimal coords, rotation in degrees, non-uniform scale
        {
          spawnId: 'obelisk_exact',
          contentType: 'decoration',
          contentId: 'runic_obelisk',
          mode: 'absolute',
          coordinates: { x: -142.375, y: 18.625, z: 89.125 },
          rotation: { x: 15, y: 90, z: -30 },
          rotationUnit: 'degrees',
          scale: { x: 1.5, y: 2.25, z: 0.75 },
          conditions: { onNewWorld: true, onWorldLoad: true, onChunkLoad: true },
        },
        // 2. Exact weapon pickup near spawn (oneTime pickup)
        {
          spawnId: 'saber_pickup',
          contentType: 'weapon',
          contentId: 'storm_saber',
          mode: 'absolute',
          x: -140.5,
          y: 19.25,
          z: 91.75,
          rotationY: 45,
          rotationUnit: 'degrees',
          scale: { x: 1.2, y: 1.2, z: 1.2 },
          conditions: { onNewWorld: true, onWorldLoad: true, onChunkLoad: true, oneTime: true },
        },
        // 3. Relative to world spawn
        {
          spawnId: 'archivist_rel_spawn',
          contentType: 'npc',
          contentId: 'archivist_orin',
          mode: 'relative_to_world_spawn',
          coordinates: { x: 4.25, y: 0.5, z: -6.75 },
          rotation: { x: 0, y: 1.25, z: 0 },
          rotationUnit: 'radians',
          behavior: 'stationary',
        },
        // 4. Relative to sibling mod spawn reference (runic_obelisk -> offset +5, +0.25, -3.5)
        {
          spawnId: 'tonic_near_obelisk',
          contentType: 'consumable',
          contentId: 'starlight_tonic',
          mode: 'relative_to_reference',
          referenceObjectId: 'obelisk_exact',
          coordinates: { x: 5.0, y: 0.25, z: -3.5 },
          conditions: {
            perPlayerPickup: true,
            respawn: { enabled: true, delaySeconds: 10 },
          },
        },
        // 5. Random within area with quantity=4 and minDistance=6
        {
          spawnId: 'random_cloaks_grove',
          contentType: 'armor',
          contentId: 'aether_cloak',
          mode: 'random_in_area',
          area: { minX: 10, maxX: 38, minZ: 10, maxZ: 38, quantity: 4, minDistance: 6 },
          conditions: { respawn: { enabled: true, delaySeconds: 5, oneTime: false } },
        },
        // 6. Monster in a distant chunk (off initial active chunks -> tests onChunkLoad activation/deactivation)
        {
          spawnId: 'distant_void_stalker',
          contentType: 'monster',
          contentId: 'void_stalker',
          mode: 'absolute',
          coordinates: { x: 520.5, y: 24.0, z: -410.25 },
          rotation: { x: 0, y: 2.1, z: 0 },
          rotationUnit: 'radians',
          scale: { x: 1.4, y: 1.4, z: 1.4 },
          conditions: { onChunkLoad: true, respawn: { enabled: true, delaySeconds: 4 } },
        },
        // 7. Animal with timeOfDay=night & weather=rain condition
        {
          spawnId: 'storm_stag_conditional',
          contentType: 'animal',
          contentId: 'frost_stag',
          mode: 'absolute',
          coordinates: { x: 18.0, y: 11.5, z: -12.0 },
          conditions: {
            timeOfDay: { periods: ['night'] },
            weather: ['rain'],
          },
        },
        // 8. Area enter + quest + flag conditional pickup
        {
          spawnId: 'quest_flag_saber_cache',
          contentType: 'weapon',
          contentId: 'storm_saber',
          mode: 'absolute',
          coordinates: { x: 200.0, y: 15.0, z: 200.0 },
          conditions: {
            onAreaEnter: true,
            areaEnterRadius: 12,
            questId: 'q_chronicle',
            questStatus: ['active'],
            requiredFlag: 'ritual_lit',
            forbiddenFlag: 'ritual_cursed',
          },
        },
        // 9. World-load only rule (must stay pending on new_world, spawn on world_load)
        {
          spawnId: 'reload_only_tonic',
          contentType: 'consumable',
          contentId: 'starlight_tonic',
          mode: 'absolute',
          coordinates: { x: 26.0, y: 12.0, z: 4.0 },
          conditions: { onNewWorld: false, onWorldLoad: true },
        },
        // 10. Failure case: Missing reference object (must NOT fall back to 0,0,0)
        {
          spawnId: 'bad_missing_ref',
          contentType: 'consumable',
          contentId: 'starlight_tonic',
          mode: 'relative_to_reference',
          referenceObjectId: 'nonexistent_monolith',
          coordinates: { x: 1, y: 0, z: 1 },
        },
        // 11. Failure case: Unsupported spawn mode
        {
          spawnId: 'bad_mode_rule',
          contentType: 'consumable',
          contentId: 'starlight_tonic',
          mode: 'orbital_drop',
          coordinates: { x: 10, y: 50, z: 10 },
        },
        // 12. Failure case: Missing contentId
        {
          spawnId: 'bad_missing_content',
          contentType: 'weapon',
          contentId: 'ghost_blade',
          mode: 'absolute',
          coordinates: { x: 10, y: 10, z: 10 },
        },
        // 13. Failure case: Missing .woa3d model asset
        {
          spawnId: 'bad_missing_model',
          contentType: 'decoration',
          contentId: 'broken_missing_model_statue',
          mode: 'absolute',
          coordinates: { x: 12, y: 10, z: 12 },
        },
        // 14. Failure case: Invalid NaN coordinate
        {
          spawnId: 'bad_nan_coords',
          contentType: 'consumable',
          contentId: 'starlight_tonic',
          mode: 'absolute',
          coordinates: { x: 'not_a_number', y: 5, z: 5 },
        },
      ],
    }),
  });

  const pkgVal = await validateWoamodArchiveBytes(archive, 'chronicle_test_pack.woamod');
  assert.equal(pkgVal.ok, true, `Package validation failed: ${pkgVal.message}`);
  const rawMod = await rawEntryFromWoamodBytes('chronicle_test_pack.woamod', archive);
  const cfg: ModStateConfig = {
    version: 1,
    enabledByModId: { [modId]: true },
    priorityByModId: { [modId]: 0 },
  };
  const disc = validateDiscoveredMods([rawMod], cfg, CURRENT_GAME_VERSION);
  assert.equal(disc.records.length, 1);
  assert.equal(disc.records[0].status, 'ready', `Discovery failed: ${JSON.stringify(disc.records[0].diagnostics)}`);

  // Register into ModManager singleton stores directly
  const modManager = ModManager.getInstance();
  modManager.getAssetResolver().clear();
  modManager.registry.unloadAll();
  const assets: ModAssetIndexEntry[] = disc.records[0].assets;
  modManager.getAssetResolver().setModAssets(modId, rawMod.sourceId, assets);
  const regRes = modManager.registry.loadMod({
    modId,
    sourceId: rawMod.sourceId,
    manifest: disc.records[0].manifest,
    files: disc.records[0].parsedContentFiles,
    assets,
  });
  assert.equal(regRes.ok, true, `Registry load failed: ${JSON.stringify(regRes.diagnostics)}`);

  // Populate ModManager snapshot activeModIds & metadata
  const snapRef = modManager.getSnapshot() as unknown as {
    mods: typeof disc.records;
    activeModIds: string[];
    loadOrder: string[];
    initialized: boolean;
  };
  snapRef.mods = disc.records;
  snapRef.activeModIds = [modId];
  snapRef.loadOrder = [modId];
  snapRef.initialized = true;

  // Verify WeaponRegistry + buildingCatalog resolution
  const weaponReg = new WeaponRegistry();
  const modWeapon = weaponReg.getOrCreate(`${modId}:storm_saber`);
  assert(modWeapon, 'WeaponRegistry must create modded storm_saber weapon');
  assert.equal(modWeapon.stats.damage, 48);
  assert.equal(modWeapon.stats.modelPath, `${modId}://assets/models/storm_saber.woa3d`);

  const obeliskBp = getBlueprintById(`${modId}:runic_obelisk`);
  assert(obeliskBp, 'buildingCatalog must expose modded runic_obelisk blueprint');
  assert.equal(obeliskBp.modelPath, `${modId}://assets/models/runic_obelisk.woa3d`);

  // 2. Test New World Spawn Resolution & Diagnostics
  const worldSpawn = { x: 24, y: 5, z: -16 };
  const h1 = createHarness(modManager, worldSpawn);

  // Activate chunks near worldSpawn, obelisk (-142.375, 89.125), grove (10..38), quest spot (200, 200), stag (18, -12)
  h1.addChunkAt(worldSpawn.x, worldSpawn.z);
  h1.addChunkAt(-142.375, 89.125);
  h1.addChunkAt(20, 20);
  h1.addChunkAt(200, 200);
  h1.addChunkAt(18, -12);
  // Leave distant_void_stalker chunk (520.5, -410.25) INACTIVE initially

  h1.spawner.initializeForWorld({
    worldSeed: h1.seed,
    lifecycle: 'new_world',
    isRemoteClient: false,
  });

  // 2a. Verify exact negative decimal coordinates, degrees->radians rotation, and scale on BuildingManager
  const obeliskStruct = h1.buildings.getStructureById(`${modId}:spawn_obelisk_exact#0`);
  assert(obeliskStruct, 'Runic Obelisk must spawn in BuildingManager');
  assert.equal(obeliskStruct.x, -142.375);
  assert.equal(obeliskStruct.y, 18.625);
  assert.equal(obeliskStruct.z, 89.125);
  assert(Math.abs((obeliskStruct.rotationX ?? 0) - (15 * Math.PI) / 180) < 1e-6);
  assert(Math.abs(obeliskStruct.yaw - (90 * Math.PI) / 180) < 1e-6);
  assert(Math.abs((obeliskStruct.rotationZ ?? 0) - (-30 * Math.PI) / 180) < 1e-6);
  assert.equal(obeliskStruct.scaleX, 1.5);
  assert.equal(obeliskStruct.scaleY, 2.25);
  assert.equal(obeliskStruct.scaleZ, 0.75);

  // 2b. Verify exact weapon pickup spawn
  const saberPickup = h1.pickups.get(`${modId}:spawn_saber_pickup#0`);
  assert(saberPickup, 'Storm Saber pickup must spawn at exact coordinates');
  assert.equal(saberPickup.x, -140.5);
  assert.equal(saberPickup.y, 19.25);
  assert.equal(saberPickup.z, 91.75);
  assert(Math.abs((saberPickup.rotationY ?? 0) - (45 * Math.PI) / 180) < 1e-6);
  assert.equal(saberPickup.scaleX, 1.2);

  // 2c. Verify relative_to_world_spawn NPC at exact offset without safe-land relocation
  const archivistNpc = h1.npcs.npcs.find((n) => n.id === `${modId}:spawn_archivist_rel_spawn#0`);
  assert(archivistNpc, 'Archivist Orin NPC must spawn via NPCManager');
  assert(Math.abs(archivistNpc.position.x - (worldSpawn.x + 4.25)) < 1e-5);
  assert(Math.abs(archivistNpc.position.y - (worldSpawn.y + 0.5)) < 1e-5);
  assert(Math.abs(archivistNpc.position.z - (worldSpawn.z - 6.75)) < 1e-5);
  assert(Math.abs(archivistNpc.getYaw() - 1.25) < 1e-5);
  const customTree = h1.npcs.getCustomDialogueTree(archivistNpc.id);
  assert(customTree, 'Mod NPC with rewardItemId must register a DialogueTree granting mod item');
  const acceptChoice = customTree.nodes.root.choices?.find((c) => c.id === 'accept_gift');
  assert(
    acceptChoice?.effects?.some((e) => e.type === 'giveItem' && e.item.id === `${modId}:storm_saber`),
    'DialogueTree choice effect must grant namespaced storm_saber',
  );

  // 2d. Verify relative_to_reference pointing to sibling mod spawn obelisk_exact
  const tonicPickup = h1.pickups.get(`${modId}:spawn_tonic_near_obelisk#0`);
  assert(tonicPickup, 'Relative-to-reference pickup must resolve sibling mod spawn');
  assert.equal(tonicPickup.x, -142.375 + 5.0);
  assert.equal(tonicPickup.y, 18.625 + 0.25);
  assert.equal(tonicPickup.z, 89.125 - 3.5);
  assert.equal(tonicPickup.perPlayer, true);

  // 2e. Verify random_in_area deterministic bounds + minDistance
  const areaPoints: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < 4; i++) {
    const p = h1.pickups.get(`${modId}:spawn_random_cloaks_grove#${i}`);
    assert(p, `Area spawn instance #${i} must exist`);
    assert(p.x >= 10 && p.x <= 38 && p.z >= 10 && p.z <= 38, 'Random area spawn must stay in bounds');
    assert.equal(p.y, groundHeightAt(p.x, p.z));
    areaPoints.push({ x: p.x, y: p.y, z: p.z });
  }
  for (let i = 0; i < areaPoints.length; i++) {
    for (let j = i + 1; j < areaPoints.length; j++) {
      const dist = Math.hypot(areaPoints[i].x - areaPoints[j].x, areaPoints[i].z - areaPoints[j].z);
      assert(dist >= 6 - 1e-6, `Area spawn minDistance violated: ${dist}`);
    }
  }
  // Confirm determinism with second harness & same worldSeed
  const hDeterminism = createHarness(modManager, worldSpawn);
  hDeterminism.addChunkAt(20, 20);
  hDeterminism.spawner.initializeForWorld({ worldSeed: h1.seed, lifecycle: 'new_world' });
  for (let i = 0; i < 4; i++) {
    const p2 = hDeterminism.pickups.get(`${modId}:spawn_random_cloaks_grove#${i}`)!;
    assert.equal(p2.x, areaPoints[i].x, 'random_in_area X must be deterministic for same seed');
    assert.equal(p2.z, areaPoints[i].z, 'random_in_area Z must be deterministic for same seed');
  }

  // 2f. Verify strict diagnostics with ZERO silent fallback for all 5 failure rules
  const diags = modManager.getSpawnDiagnostics(modId);
  const bySpawnId = new Map(diags.map((d) => [d.spawnId, d]));

  assert.equal(bySpawnId.get('bad_missing_ref')?.status, 'failed');
  assert.equal(bySpawnId.get('bad_missing_ref')?.errorCode, 'MISSING_REFERENCE_OBJECT');
  assert.equal(bySpawnId.get('bad_missing_ref')?.resolvedCoords, null);
  assert.equal(h1.pickups.has(`${modId}:spawn_bad_missing_ref#0`), false);

  assert.equal(bySpawnId.get('bad_mode_rule')?.status, 'failed');
  assert.equal(bySpawnId.get('bad_mode_rule')?.errorCode, 'UNSUPPORTED_SPAWN_MODE');
  assert.equal(bySpawnId.get('bad_mode_rule')?.resolvedCoords, null);

  assert.equal(bySpawnId.get('bad_missing_content')?.status, 'failed');
  assert.equal(bySpawnId.get('bad_missing_content')?.errorCode, 'SPAWN_CONTENT_NOT_REGISTERED');

  assert.equal(bySpawnId.get('bad_missing_model')?.status, 'failed');
  assert.equal(bySpawnId.get('bad_missing_model')?.errorCode, 'SPAWN_MODEL_MISSING');

  assert.equal(bySpawnId.get('bad_nan_coords')?.status, 'failed');
  assert.equal(bySpawnId.get('bad_nan_coords')?.errorCode, 'INVALID_SPAWN_COORDINATES');

  // 3. Verify conditional spawns (onChunkLoad, timeOfDay + weather, areaEnter + quest + flag, onNewWorld=false)
  assert.equal(bySpawnId.get('distant_void_stalker')?.status, 'pending_chunk');
  assert.equal(
    h1.combat.enemies.find((e) => e.id === `${modId}:spawn_distant_void_stalker#0`),
    undefined,
  );

  const distantChunk = h1.addChunkAt(520.5, -410.25);
  h1.spawner.onChunkActivated(distantChunk);
  const stalker = h1.combat.enemies.find((e) => e.id === `${modId}:spawn_distant_void_stalker#0`);
  assert(stalker, 'Monster must spawn when its chunk activates');
  assert.equal(stalker.position.x, 520.5);
  assert.equal(stalker.position.y, 24.0);
  assert.equal(stalker.position.z, -410.25);
  assert.equal(stalker.archetype.maxHealth, 220);

  h1.spawner.onChunkDeactivated(distantChunk);
  assert.equal(
    h1.combat.enemies.find((e) => e.id === `${modId}:spawn_distant_void_stalker#0`),
    undefined,
    'Chunk-bound mod monster must despawn cleanly when chunk deactivates',
  );

  // Night + Rain conditional animal
  assert.equal(h1.wildlife.animals.some((a) => a.id === `${modId}:spawn_storm_stag_conditional#0`), false);
  h1.setHours(23.0);
  h1.setWeather('rain');
  h1.spawner.update(0.1, 1.0);
  const stag = h1.wildlife.animals.find((a) => a.id === `${modId}:spawn_storm_stag_conditional#0`);
  assert(stag, 'Frost Stag must spawn when timeOfDay=night & weather=rain match');
  assert.equal(stag.position.x, 18.0);
  assert.equal(stag.position.y, 11.5);
  assert.equal(stag.position.z, -12.0);
  h1.setHours(10.0);
  h1.spawner.update(0.1, 2.0);
  assert.equal(
    h1.wildlife.animals.some((a) => a.id === `${modId}:spawn_storm_stag_conditional#0`),
    false,
    'Conditional spawn must despawn when condition ceases to match',
  );

  // Quest + Flag + AreaEnter spawn
  assert.equal(h1.pickups.has(`${modId}:spawn_quest_flag_saber_cache#0`), false);
  h1.setQuestStatus('q_chronicle', 'active');
  h1.setFlag('ritual_lit', true);
  h1.playerPosition.set(195, 15, 200); // within 12m
  h1.spawner.update(0.1, 3.0);
  assert(
    h1.pickups.has(`${modId}:spawn_quest_flag_saber_cache#0`),
    'Quest+flag+areaEnter spawn must activate when all three hold',
  );
  h1.setFlag('ritual_cursed', true);
  h1.spawner.update(0.1, 3.5);
  assert.equal(
    h1.pickups.has(`${modId}:spawn_quest_flag_saber_cache#0`),
    false,
    'forbiddenFlag must suppress/despawn conditional spawn',
  );

  // onNewWorld: false stayed pending on new_world
  assert.equal(h1.pickups.has(`${modId}:spawn_reload_only_tonic#0`), false);

  // 4. Test Pickup Collection, Respawn Timer & Save/Load Persistence
  // Collect oneTime saber pickup & non-oneTime grove cloak #0
  assert.equal(h1.spawner.handlePickupCollected(`${modId}:spawn_saber_pickup#0`), true);
  assert.equal(h1.spawner.handlePickupCollected(`${modId}:spawn_random_cloaks_grove#0`), true);
  const savedState = h1.spawner.exportSaveState();

  // Save/load into fresh harness with lifecycle='world_load'
  const hLoaded = createHarness(modManager, worldSpawn);
  hLoaded.addChunkAt(worldSpawn.x, worldSpawn.z);
  hLoaded.addChunkAt(-142.375, 89.125);
  hLoaded.addChunkAt(20, 20);
  hLoaded.spawner.restoreSaveState(savedState, h1.seed);
  hLoaded.spawner.initializeForWorld({ worldSeed: h1.seed, lifecycle: 'world_load' });

  assert.equal(
    hLoaded.pickups.has(`${modId}:spawn_saber_pickup#0`),
    false,
    'oneTime collected mod pickup must NOT respawn after save/load',
  );
  assert(
    hLoaded.pickups.has(`${modId}:spawn_reload_only_tonic#0`),
    'onWorldLoad=true (onNewWorld=false) rule must spawn after world load',
  );
  // Advance past 5s respawn delay for grove cloak #0
  hLoaded.spawner.update(0.1, 10.0);
  assert(
    hLoaded.pickups.has(`${modId}:spawn_random_cloaks_grove#0`),
    'Respawn-enabled mod pickup must respawn once delay elapsed',
  );

  // 5. Test Online Multiplayer DO + Offline LAN Server Spawn Sync & Pickup Authority
  const hostSyncedSpawns = h1.spawner.exportSyncedSpawns();
  assert(hostSyncedSpawns.length >= 6, 'Host must export synced mod spawn entries');

  const mpModMeta: ProtocolWorldModMetadata = {
    savedAtGameVersion: CURRENT_GAME_VERSION,
    modApiVersion: CURRENT_MOD_API_VERSION,
    schemaVersion: SUPPORTED_MOD_SCHEMA_VERSIONS[1],
    mods: [
      {
        modId,
        name: 'Chronicle Test Pack',
        version: '1.2.0',
        supportedGameVersion: '>=1.1.24',
        schemaVersion: 2,
        modApiVersion: CURRENT_MOD_API_VERSION,
        multiplayerCompatibility: 'required',
        dependencies: [],
      },
    ],
  };

  // 5a. Online Cloudflare DO test with real WebSocket upgrade
  const doRooms = new Map<string, MultiplayerRoomDO>();
  const dirMock = createMockState('dir-spawns');
  let dirDoInst: RoomDirectoryDO | null = null;
  const mpEnv: Record<string, unknown> = {
    ENVIRONMENT: 'production',
    MULTIPLAYER_ROOMS: {
      idFromName: (n: string) => ({ toString: () => n, equals: () => false }),
      idFromString: (n: string) => ({ toString: () => n, equals: () => false }),
      newUniqueId: () => ({ toString: () => 'uid', equals: () => false }),
      get: (idObj: { toString: () => string }) => {
        const key = idObj.toString();
        let inst = doRooms.get(key);
        if (!inst) {
          inst = new MultiplayerRoomDO(createMockState(key) as never, mpEnv as never);
          doRooms.set(key, inst);
        }
        return {
          fetch: (r: RequestInfo | URL, init?: RequestInit) =>
            inst!.fetch(typeof r === 'string' || r instanceof URL ? new Request(String(r), init) : r),
        };
      },
    },
    ROOM_DIRECTORY: {
      idFromName: (n: string) => ({ toString: () => n, equals: () => false }),
      idFromString: (n: string) => ({ toString: () => n, equals: () => false }),
      newUniqueId: () => ({ toString: () => 'uid', equals: () => false }),
      get: () => {
        if (!dirDoInst) dirDoInst = new RoomDirectoryDO(dirMock as never, mpEnv as never);
        return {
          fetch: (r: RequestInfo | URL, init?: RequestInit) =>
            dirDoInst!.fetch(typeof r === 'string' || r instanceof URL ? new Request(String(r), init) : r),
        };
      },
    },
    PLAYER_PROFILES: {
      idFromName: (n: string) => ({ toString: () => n, equals: () => false }),
      idFromString: (n: string) => ({ toString: () => n, equals: () => false }),
      newUniqueId: () => ({ toString: () => 'uid', equals: () => false }),
      get: () => ({ fetch: async () => new OrigResponse(JSON.stringify({ ok: true }), { status: 200 }) }),
    },
  };

  const wReq = async (path: string, method = 'GET', body?: unknown) => {
    const r = await workerApp.fetch(
      new Request(`https://worker.test${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
          'CF-Connecting-IP': '198.51.100.77',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
      mpEnv as never,
      {} as never,
    );
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };

  const rCreate = await wReq('/api/multiplayer/rooms', 'POST', {
    roomName: 'DO Spawn Sync',
    playerName: 'Host',
    worldName: 'TestWorld',
    privacy: 'public',
    modMetadata: mpModMeta,
  });
  assert.equal(rCreate.status, 200);
  const mpRoom = rCreate.json.room as { roomId: string; roomCode: string };
  const mpRoomId = mpRoom.roomId;
  const mpHostPlayerId = String(rCreate.json.playerId);
  const mpHostToken = String(rCreate.json.sessionToken);

  const connectClient = async (playerId: string, token: string) => {
    const res = await workerApp.fetch(
      new Request(
        `https://worker.test/api/multiplayer/ws?roomId=${encodeURIComponent(mpRoomId)}&playerId=${encodeURIComponent(playerId)}&token=${encodeURIComponent(token)}`,
        {
          headers: { Upgrade: 'websocket', Origin: 'http://localhost:3000' },
        },
      ),
      mpEnv as never,
      {} as never,
    );
    assert.equal(res.status, 101);
    const ws = (res as unknown as { webSocket: MockWebSocket }).webSocket;
    const msgs: Array<Record<string, unknown>> = [];
    ws.addEventListener('message', (ev) => {
      msgs.push(JSON.parse(String((ev as MessageEvent).data)) as Record<string, unknown>);
    });
    ws.accept();
    await new Promise((r) => setTimeout(r, 15));
    return { ws, msgs };
  };

  const hostWs = await connectClient(mpHostPlayerId, mpHostToken);
  const sendWs = (ws: MockWebSocket, playerId: string, type: string, payload?: unknown) => {
    ws.send(JSON.stringify({ v: 1, type, roomId: mpRoomId, playerId, timestamp: Date.now(), payload }));
  };

  sendWs(hostWs.ws, mpHostPlayerId, 'START_GAME');
  await new Promise((r) => setTimeout(r, 40));

  // Send MOD_SPAWNS_SYNC from host in <=2400B batches (just like GameEngine.sendHostModSpawnsSync)
  const sendBatches = async () => {
    const chunks: SyncedModSpawnEntry[][] = [];
    let cur: SyncedModSpawnEntry[] = [];
    for (const entry of hostSyncedSpawns) {
      cur.push(entry);
      if (JSON.stringify({ modSpawns: cur, replace: chunks.length === 0, done: false }).length > 2200) {
        if (cur.length > 1) {
          cur.pop();
          chunks.push(cur);
          cur = [entry];
        } else {
          chunks.push(cur);
          cur = [];
        }
      }
    }
    if (cur.length > 0 || chunks.length === 0) chunks.push(cur);

    for (let i = 0; i < chunks.length; i++) {
      sendWs(hostWs.ws, mpHostPlayerId, 'GAME_EVENT', {
        event: 'MOD_SPAWNS_SYNC',
        data: {
          modSpawns: chunks[i],
          replace: i === 0,
          done: i === chunks.length - 1,
        },
      });
    }
    await new Promise((r) => setTimeout(r, 40));
  };
  await sendBatches();

  // Join and connect client AFTER host started world & synced spawns
  const rJoin = await wReq('/api/multiplayer/rooms/join', 'POST', {
    roomCodeOrId: mpRoom.roomCode,
    playerName: 'Client',
    clientModMetadata: mpModMeta,
  });
  assert.equal(rJoin.status, 200);
  const mpClientPlayerId = String(rJoin.json.playerId);
  const mpClientToken = String(rJoin.json.sessionToken);

  const clientWs = await connectClient(mpClientPlayerId, mpClientToken);
  await new Promise((r) => setTimeout(r, 40));
  const snapMsg = clientWs.msgs.find((m) => m.type === 'WORLD_SNAPSHOT');
  assert(snapMsg, `Late-joining DO client must receive WORLD_SNAPSHOT (got types: ${clientWs.msgs.map((m) => m.type).join(',')}; host msgs: ${hostWs.msgs.map((m) => m.type).join(',')})`);
  const snapshotPayload = (snapMsg.payload as { snapshot?: { modSpawns?: SyncedModSpawnEntry[] }; modSpawns?: SyncedModSpawnEntry[] }).snapshot
    ?? (snapMsg.payload as { modSpawns?: SyncedModSpawnEntry[] });
  assert(
    Array.isArray(snapshotPayload.modSpawns) && snapshotPayload.modSpawns.length === hostSyncedSpawns.length,
    `WORLD_SNAPSHOT.modSpawns length mismatch: expected ${hostSyncedSpawns.length}, got ${snapshotPayload.modSpawns?.length}`,
  );

  // Feed snapshot.modSpawns into remote client ModWorldSpawner & verify exact coordinates match host
  const hRemoteClient = createHarness(modManager, worldSpawn);
  hRemoteClient.setLocalPlayerId(mpClientPlayerId);
  hRemoteClient.addChunkAt(-142.375, 89.125);
  hRemoteClient.addChunkAt(worldSpawn.x, worldSpawn.z);
  hRemoteClient.spawner.applyHostSyncedSpawns(snapshotPayload.modSpawns!, mpClientPlayerId);

  const clientObelisk = hRemoteClient.buildings.getStructureById(`${modId}:spawn_obelisk_exact#0`);
  assert(clientObelisk, 'Remote client must mount synced mod building at exact host coords');
  assert.equal(clientObelisk.x, -142.375);
  assert.equal(clientObelisk.y, 18.625);
  assert.equal(clientObelisk.z, 89.125);
  assert.equal(clientObelisk.scaleX, 1.5);

  const clientTonic = hRemoteClient.pickups.get(`${modId}:spawn_tonic_near_obelisk#0`);
  assert(clientTonic, 'Remote client must see perPlayer mod pickup before collecting it');

  // Host picks up perPlayer tonic -> server records perPlayerPickups for host only -> client still has it!
  sendWs(hostWs.ws, mpHostPlayerId, 'GAME_EVENT', {
    event: 'ITEM_PICKED_UP',
    data: {
      pickupId: `${modId}:spawn_tonic_near_obelisk#0`,
      itemId: `${modId}:starlight_tonic`,
      count: 1,
      perPlayer: true,
    },
  });
  await new Promise((r) => setTimeout(r, 30));
  hRemoteClient.spawner.handleRemotePickupCollected(
    `${modId}:spawn_tonic_near_obelisk#0`,
    mpHostPlayerId,
    mpClientPlayerId,
  );
  assert(
    hRemoteClient.pickups.has(`${modId}:spawn_tonic_near_obelisk#0`),
    'perPlayer mod pickup collected by host must remain visible for remote client',
  );

  // Client picks up shared storm_saber pickup (>32 chars ID) and equips it without WEAPON_NOT_OWNED
  sendWs(clientWs.ws, mpClientPlayerId, 'GAME_EVENT', {
    event: 'ITEM_PICKED_UP',
    data: {
      pickupId: `${modId}:spawn_saber_pickup#0`,
      itemId: `${modId}:storm_saber`,
      count: 1,
    },
  });
  await new Promise((r) => setTimeout(r, 30));

  const errCountBefore = clientWs.msgs.filter((m) => m.type === 'ERROR').length;
  sendWs(clientWs.ws, mpClientPlayerId, 'PLAYER_STATE', {
    x: 0,
    y: 10,
    z: 0,
    yaw: 0,
    pitch: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    weaponId: `${modId}:storm_saber`,
    movementState: 'idle',
    grounded: true,
  });
  await new Promise((r) => setTimeout(r, 30));
  const newErrors = clientWs.msgs.slice(errCountBefore).filter((m) => m.type === 'ERROR');
  assert.equal(
    newErrors.length,
    0,
    `Equipping picked-up mod weapon must not trigger DO error: ${JSON.stringify(newErrors)}`,
  );

  // 5b. Offline LAN Server test
  const lan = new OfflineLanServer();
  const lanInit = lan.initRoom({
    roomName: 'LAN Spawn Sync',
    playerName: 'LanHost',
    worldName: 'LanWorld',
    seed: h1.seed,
    modMetadata: mpModMeta,
  }) as { ok?: boolean; playerId?: string };
  assert.equal(lanInit.ok, true);
  const lanHostId = String(lanInit.playerId);

  const lanJoin = lan.joinPlayer({
    playerName: 'LanGuest',
    clientModMetadata: mpModMeta,
  }) as { status: number; body?: { ok?: boolean; playerId?: string } };
  assert.equal(lanJoin.body?.ok, true);
  const lanGuestId = String(lanJoin.body?.playerId);

  lan.recordWorldStateGameEvent(
    'MOD_SPAWNS_SYNC',
    { modSpawns: hostSyncedSpawns, replace: true, done: true },
    lanHostId,
    Date.now(),
  );
  lan.recordWorldStateGameEvent(
    'ITEM_PICKED_UP',
    {
      pickupId: `${modId}:spawn_tonic_near_obelisk#0`,
      itemId: `${modId}:starlight_tonic`,
      count: 1,
      perPlayer: true,
    },
    lanHostId,
    Date.now(),
  );
  const lanSnapGuest = lan.buildWorldSnapshotForPlayer(lanGuestId) as {
    modSpawns?: Array<SyncedModSpawnEntry>;
  };
  const lanSnapHost = lan.buildWorldSnapshotForPlayer(lanHostId) as {
    modSpawns?: Array<SyncedModSpawnEntry>;
  };
  assert(
    Array.isArray(lanSnapGuest.modSpawns) && lanSnapGuest.modSpawns.length === hostSyncedSpawns.length,
    'LAN snapshot must include synced modSpawns',
  );
  const lanTonicForGuest = lanSnapGuest.modSpawns.find(
    (e) => e.instanceId === `${modId}:spawn_tonic_near_obelisk#0`,
  );
  const lanTonicForHost = lanSnapHost.modSpawns?.find(
    (e) => e.instanceId === `${modId}:spawn_tonic_near_obelisk#0`,
  );
  assert(
    !lanTonicForGuest?.collectedByPlayers?.includes(lanGuestId) &&
      !lanTonicForGuest?.collected &&
      Boolean(lanTonicForHost?.collectedByPlayers?.includes(lanHostId)),
    'LAN snapshot must isolate perPlayer pickup collection state per player',
  );

  hostWs.ws.close();
  clientWs.ws.close();

  console.log('ALL MOD SPAWN VERIFICATION TESTS PASSED:', {
    gameVersion: CURRENT_GAME_VERSION,
    totalDiagnostics: diags.length,
    spawnedBuildingExact: {
      x: obeliskStruct.x,
      y: obeliskStruct.y,
      z: obeliskStruct.z,
    },
    failedDiagnosticsVerified: [
      'bad_missing_ref',
      'bad_mode_rule',
      'bad_missing_content',
      'bad_missing_model',
      'bad_nan_coords',
    ].length,
    hostSyncedSpawnCount: hostSyncedSpawns.length,
    onlineDoSyncedCount: snapshotPayload.modSpawns?.length,
    lanSyncedCount: lanSnapGuest.modSpawns?.length,
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
