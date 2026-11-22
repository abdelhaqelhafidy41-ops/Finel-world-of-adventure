import { detectRuntimePlatform } from '../../utils/platformExit';
import { migrateSaveData } from './saveMigrations';
import {
  CURRENT_SAVE_VERSION,
  type SaveGameData,
  type SaveSlotId,
} from './saveTypes';

export const WORLD_BUNDLE_SAVE_VERSION = 1;

const IDB_DB_NAME = 'woa_persistent_worlds_v1';
const IDB_STORE_NAME = 'worlds';
const STORAGE_PREFIX = 'woa_save_v1_';
const WORLD_INDEX_KEY = 'woa_world_ids_v1';

export interface WorldSaveBundle {
  saveVersion: number;
  worldData: {
    saveVersion: number;
    version: number;
    meta: SaveGameData['meta'];
  };
  settings: {
    worldType: SaveGameData['meta']['worldType'];
    difficulty: SaveGameData['meta']['difficulty'];
    camera?: SaveGameData['camera'];
    audio?: SaveGameData['audio'];
    timeSettings: {
      fullDayDurationSeconds: number;
      timeScale: number;
      paused: boolean;
    };
    weatherSettings: {
      dynamicEnabled: boolean;
      transitionDurationSeconds: number;
      quality: SaveGameData['weather']['quality'];
      maxStateDurationSeconds?: number;
    };
  };
  playerData: {
    player: SaveGameData['player'];
    inventory: SaveGameData['inventory'];
    quests: SaveGameData['quests'];
    story?: SaveGameData['story'];
    sideQuests?: SaveGameData['sideQuests'];
    crafting?: SaveGameData['crafting'];
  };
  worldState: {
    world: SaveGameData['world'];
    time: {
      worldHours: number;
      dayCount: number;
    };
    weather: {
      currentState: SaveGameData['weather']['currentState'];
      targetState: SaveGameData['weather']['targetState'];
      transitionProgress: number;
      windAngleRad: number;
      weatherStartTime?: number;
      weatherDuration?: number;
      weatherRemainingTime?: number;
    };
    villageDev?: SaveGameData['villageDev'];
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function sanitizePersistentWorldId(worldId: string): string | null {
  if (typeof worldId !== 'string') return null;
  const trimmed = worldId.trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(trimmed)) return null;
  if (trimmed === '.' || trimmed === '..') return null;
  return trimmed;
}

export function splitSaveDataToBundle(data: SaveGameData): WorldSaveBundle {
  return {
    saveVersion: WORLD_BUNDLE_SAVE_VERSION,
    worldData: {
      saveVersion: WORLD_BUNDLE_SAVE_VERSION,
      version: data.version || CURRENT_SAVE_VERSION,
      meta: { ...data.meta },
    },
    settings: {
      worldType: data.meta.worldType,
      difficulty: data.meta.difficulty,
      ...(data.camera ? { camera: { ...data.camera } } : {}),
      ...(data.audio ? { audio: { ...data.audio } } : {}),
      timeSettings: {
        fullDayDurationSeconds: data.time.fullDayDurationSeconds,
        timeScale: data.time.timeScale,
        paused: data.time.paused,
      },
      weatherSettings: {
        dynamicEnabled: data.weather.dynamicEnabled,
        transitionDurationSeconds: data.weather.transitionDurationSeconds,
        quality: data.weather.quality,
        ...(typeof data.weather.maxStateDurationSeconds === 'number'
          ? { maxStateDurationSeconds: data.weather.maxStateDurationSeconds }
          : {}),
      },
    },
    playerData: {
      player: data.player,
      inventory: data.inventory,
      quests: data.quests,
      ...(data.story ? { story: data.story } : {}),
      ...(data.sideQuests ? { sideQuests: data.sideQuests } : {}),
      ...(data.crafting ? { crafting: data.crafting } : {}),
    },
    worldState: {
      world: data.world,
      time: {
        worldHours: data.time.worldHours,
        dayCount: data.time.dayCount,
      },
      weather: {
        currentState: data.weather.currentState,
        targetState: data.weather.targetState,
        transitionProgress: data.weather.transitionProgress,
        windAngleRad: data.weather.windAngleRad,
        ...(typeof data.weather.weatherStartTime === 'number'
          ? { weatherStartTime: data.weather.weatherStartTime }
          : {}),
        ...(typeof data.weather.weatherDuration === 'number'
          ? { weatherDuration: data.weather.weatherDuration }
          : {}),
        ...(typeof data.weather.weatherRemainingTime === 'number'
          ? { weatherRemainingTime: data.weather.weatherRemainingTime }
          : {}),
      },
      ...(data.villageDev ? { villageDev: data.villageDev } : {}),
    },
  };
}

export function assembleSaveDataFromBundle(
  worldId: string,
  rawBundle: unknown,
): SaveGameData | null {
  if (!isRecord(rawBundle)) return null;
  const worldData = isRecord(rawBundle.worldData) ? rawBundle.worldData : null;
  if (!worldData || !isRecord(worldData.meta)) return null;

  const settings = isRecord(rawBundle.settings) ? rawBundle.settings : {};
  const playerData = isRecord(rawBundle.playerData) ? rawBundle.playerData : {};
  const worldState = isRecord(rawBundle.worldState) ? rawBundle.worldState : {};

  const timeSettings = isRecord(settings.timeSettings) ? settings.timeSettings : {};
  const timeState = isRecord(worldState.time) ? worldState.time : {};
  const weatherSettings = isRecord(settings.weatherSettings)
    ? settings.weatherSettings
    : {};
  const weatherState = isRecord(worldState.weather) ? worldState.weather : {};

  const assembled: Record<string, unknown> = {
    version:
      typeof worldData.version === 'number'
        ? worldData.version
        : CURRENT_SAVE_VERSION,
    meta: {
      ...worldData.meta,
      slotId: worldData.meta.slotId || worldId,
      worldId: worldData.meta.worldId || worldId,
      worldType: settings.worldType || worldData.meta.worldType,
      difficulty: settings.difficulty || worldData.meta.difficulty,
    },
    player: playerData.player,
    inventory: playerData.inventory,
    quests: playerData.quests,
    ...(playerData.story ? { story: playerData.story } : {}),
    ...(playerData.sideQuests ? { sideQuests: playerData.sideQuests } : {}),
    ...(playerData.crafting ? { crafting: playerData.crafting } : {}),
    time: {
      ...timeSettings,
      ...timeState,
    },
    weather: {
      ...weatherSettings,
      ...weatherState,
    },
    world: worldState.world,
    ...(settings.camera ? { camera: settings.camera } : {}),
    ...(settings.audio ? { audio: settings.audio } : {}),
    ...(worldState.villageDev ? { villageDev: worldState.villageDev } : {}),
  };

  const migrated = migrateSaveData(assembled);
  if (!migrated) return null;
  migrated.data.meta.slotId = worldId;
  migrated.data.meta.worldId = migrated.data.meta.worldId || worldId;
  return migrated.data;
}

// ---------- IndexedDB helper for Web persistent isolated world storage ----------

function openWorldsDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbListWorldIds(): Promise<string[]> {
  const db = await openWorldsDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.getAllKeys();
      req.onsuccess = () => {
        const keys = Array.isArray(req.result)
          ? req.result.filter((k): k is string => typeof k === 'string')
          : [];
        resolve(keys);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

async function idbReadBundle(worldId: string): Promise<WorldSaveBundle | null> {
  const db = await openWorldsDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.get(worldId);
      req.onsuccess = () => {
        resolve(isRecord(req.result) ? (req.result as unknown as WorldSaveBundle) : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbWriteBundle(worldId: string, bundle: WorldSaveBundle): Promise<boolean> {
  const db = await openWorldsDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      store.put(bundle, worldId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function idbDeleteBundle(worldId: string): Promise<boolean> {
  const db = await openWorldsDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      store.delete(worldId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

// ---------- Native / Web backend dispatch & per-world sequential queue ----------

const perWorldWriteChain = new Map<string, Promise<unknown>>();
const activeWritePromises = new Set<Promise<unknown>>();

function enqueueWorldTask<T>(worldId: string, task: () => Promise<T>): Promise<T> {
  const previous = perWorldWriteChain.get(worldId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  perWorldWriteChain.set(worldId, next);
  activeWritePromises.add(next);
  void next.finally(() => {
    activeWritePromises.delete(next);
    if (perWorldWriteChain.get(worldId) === next) {
      perWorldWriteChain.delete(worldId);
    }
  });
  return next;
}

async function backendListWorldIds(): Promise<string[]> {
  const platform = detectRuntimePlatform();
  if (platform === 'electron' && window.desktopApp?.worldStorage?.listWorlds) {
    try {
      const res = await window.desktopApp.worldStorage.listWorlds();
      if (res?.ok && Array.isArray(res.worldIds)) {
        return res.worldIds.filter((id): id is string => typeof id === 'string');
      }
    } catch {
      // Fallback
    }
  }
  if (platform === 'android' && window.AndroidNativeBridge?.listSavedWorldIds) {
    try {
      const raw = window.AndroidNativeBridge.listSavedWorldIds();
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed) && parsed.ok && Array.isArray(parsed.worldIds)) {
        return parsed.worldIds.filter((id): id is string => typeof id === 'string');
      }
    } catch {
      // Fallback
    }
  }
  return idbListWorldIds();
}

async function backendReadBundle(worldId: string): Promise<WorldSaveBundle | null> {
  const safeId = sanitizePersistentWorldId(worldId);
  if (!safeId) return null;

  const platform = detectRuntimePlatform();
  if (platform === 'electron' && window.desktopApp?.worldStorage?.readBundle) {
    try {
      const res = await window.desktopApp.worldStorage.readBundle(safeId);
      if (res?.ok && isRecord(res.bundle)) {
        return res.bundle as unknown as WorldSaveBundle;
      }
    } catch {
      return null;
    }
  }
  if (platform === 'android' && window.AndroidNativeBridge?.readWorldBundle) {
    try {
      const raw = window.AndroidNativeBridge.readWorldBundle(safeId);
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed) && parsed.ok && isRecord(parsed.bundle)) {
        return parsed.bundle as unknown as WorldSaveBundle;
      }
    } catch {
      return null;
    }
  }
  return idbReadBundle(safeId);
}

async function backendWriteBundle(
  worldId: string,
  bundle: WorldSaveBundle,
): Promise<boolean> {
  const safeId = sanitizePersistentWorldId(worldId);
  if (!safeId) return false;

  const platform = detectRuntimePlatform();
  if (platform === 'electron' && window.desktopApp?.worldStorage?.writeBundle) {
    try {
      const res = await window.desktopApp.worldStorage.writeBundle(
        safeId,
        bundle as unknown as Record<string, unknown>,
      );
      if (res?.ok) return true;
    } catch {
      // Fallback to IndexedDB
    }
  }
  if (platform === 'android' && window.AndroidNativeBridge?.writeWorldBundle) {
    try {
      const resRaw = window.AndroidNativeBridge.writeWorldBundle(
        safeId,
        JSON.stringify(bundle),
      );
      const parsed: unknown = JSON.parse(resRaw);
      if (isRecord(parsed) && parsed.ok) return true;
    } catch {
      // Fallback to IndexedDB
    }
  }
  return idbWriteBundle(safeId, bundle);
}

async function backendDeleteBundle(worldId: string): Promise<boolean> {
  const safeId = sanitizePersistentWorldId(worldId);
  if (!safeId) return false;

  const platform = detectRuntimePlatform();
  if (platform === 'electron' && window.desktopApp?.worldStorage?.deleteWorld) {
    try {
      const res = await window.desktopApp.worldStorage.deleteWorld(safeId);
      if (res?.ok) return true;
    } catch {
      // Fallback
    }
  }
  if (platform === 'android' && window.AndroidNativeBridge?.deleteWorldBundle) {
    try {
      const resRaw = window.AndroidNativeBridge.deleteWorldBundle(safeId);
      const parsed: unknown = JSON.parse(resRaw);
      if (isRecord(parsed) && parsed.ok) return true;
    } catch {
      // Fallback
    }
  }
  return idbDeleteBundle(safeId);
}

// ---------- Public Persistent World Storage API ----------

let hydratedOnce = false;
let hydrationPromise: Promise<void> | null = null;

export async function persistWorldBundle(
  slotId: SaveSlotId,
  data: SaveGameData,
): Promise<boolean> {
  const safeId = sanitizePersistentWorldId(slotId);
  if (!safeId) return false;
  // Verify SaveGameData passes migration/schema validation before persisting to disk
  const validated = migrateSaveData(data);
  if (!validated) return false;

  const bundle = splitSaveDataToBundle(validated.data);
  return enqueueWorldTask(safeId, () => backendWriteBundle(safeId, bundle));
}

export async function readPersistentWorldBundle(
  slotId: SaveSlotId,
): Promise<SaveGameData | null> {
  const safeId = sanitizePersistentWorldId(slotId);
  if (!safeId) return null;
  const rawBundle = await backendReadBundle(safeId);
  if (!rawBundle) return null;
  return assembleSaveDataFromBundle(safeId, rawBundle);
}

export async function deletePersistentWorldBundle(
  slotId: SaveSlotId,
): Promise<boolean> {
  const safeId = sanitizePersistentWorldId(slotId);
  if (!safeId) return false;
  return enqueueWorldTask(safeId, () => backendDeleteBundle(safeId));
}

export async function flushPendingWorldSaves(): Promise<void> {
  while (activeWritePromises.size > 0) {
    const batch = Array.from(activeWritePromises);
    await Promise.allSettled(batch);
  }
}

/**
 * Hydrates localStorage mirror from persistent isolated per-world disk/IndexedDB
 * storage on app launch, and migrates any legacy localStorage-only worlds into
 * dedicated persistent folders (`GameData/Worlds/<worldId>/`).
 */
export async function hydratePersistentWorldStorage(
  force = false,
): Promise<void> {
  if (hydratedOnce && !force) return;
  if (hydrationPromise && !force) return hydrationPromise;

  hydrationPromise = (async () => {
    try {
      if (typeof localStorage === 'undefined') {
        hydratedOnce = true;
        return;
      }

      const diskIds = await backendListWorldIds();
      const indexSet = new Set<string>();
      try {
        const rawIndex = localStorage.getItem(WORLD_INDEX_KEY);
        if (rawIndex) {
          const parsed: unknown = JSON.parse(rawIndex);
          if (Array.isArray(parsed)) {
            for (const entry of parsed) {
              if (typeof entry === 'string' && sanitizePersistentWorldId(entry)) {
                indexSet.add(entry);
              }
            }
          }
        }
      } catch {
        // Ignore malformed index
      }

      const mergedIds = new Set<string>([...diskIds, ...indexSet]);

      for (const worldId of mergedIds) {
        let localData: SaveGameData | null = null;
        try {
          const localRaw = localStorage.getItem(`${STORAGE_PREFIX}${worldId}`);
          if (localRaw) {
            const parsedLocal: unknown = JSON.parse(localRaw);
            const migratedLocal = migrateSaveData(parsedLocal);
            if (migratedLocal) {
              migratedLocal.data.meta.slotId = worldId;
              migratedLocal.data.meta.worldId =
                migratedLocal.data.meta.worldId || worldId;
              localData = migratedLocal.data;
            }
          }
        } catch {
          localData = null;
        }

        const diskData = diskIds.includes(worldId)
          ? await readPersistentWorldBundle(worldId)
          : null;

        if (diskData && (!localData || diskData.meta.savedAtMs >= localData.meta.savedAtMs)) {
          try {
            localStorage.setItem(
              `${STORAGE_PREFIX}${worldId}`,
              JSON.stringify(diskData),
            );
          } catch {
            // If quota exceeded, mirror without thumbnail so world listing stays intact
            try {
              const lean: SaveGameData = {
                ...diskData,
                meta: { ...diskData.meta, thumbnailDataUrl: undefined },
              };
              localStorage.setItem(
                `${STORAGE_PREFIX}${worldId}`,
                JSON.stringify(lean),
              );
            } catch {
              // Ignore localStorage quota errors; disk copy remains intact
            }
          }
          indexSet.add(worldId);
        } else if (localData && (!diskData || localData.meta.savedAtMs > diskData.meta.savedAtMs)) {
          await persistWorldBundle(worldId, localData);
          indexSet.add(worldId);
        } else if (diskData) {
          indexSet.add(worldId);
        }
      }

      try {
        localStorage.setItem(
          WORLD_INDEX_KEY,
          JSON.stringify(Array.from(indexSet)),
        );
      } catch {
        // Ignore storage quota errors
      }
      hydratedOnce = true;
    } catch {
      hydratedOnce = true;
    }
  })();

  await hydrationPromise;
}

export interface LanSavedWorldSeedPayload {
  seed: number;
  worldName: string;
  worldType: SaveGameData['meta']['worldType'];
  difficulty: SaveGameData['meta']['difficulty'];
  worldTime: Record<string, unknown>;
  worldWeather: Record<string, unknown>;
  savedWorldState: Record<string, unknown>;
}

/**
 * Converts a saved Single-Player/Host world into initial LAN server room options
 * so Offline LAN hosts can launch any saved world and sync its state to guests.
 */
export function buildLanRoomSeedFromSaveData(
  saved: SaveGameData,
): LanSavedWorldSeedPayload {
  const weatherState = saved.weather.currentState;
  const weatherIntensity =
    weatherState === 'storm'
      ? 0.9
      : weatherState === 'rain'
        ? 0.72
        : weatherState === 'fog'
          ? 0.6
          : weatherState === 'cloudy'
            ? 0.4
            : 0;

  return {
    seed: saved.world.worldSeed,
    worldName: saved.meta.worldName,
    worldType: saved.meta.worldType ?? saved.world.worldType,
    difficulty: saved.meta.difficulty ?? saved.world.difficulty,
    worldTime: {
      worldHours: saved.time.worldHours,
      dayCount: saved.time.dayCount,
      fullDayDurationSeconds: saved.time.fullDayDurationSeconds,
      timeScale: saved.time.timeScale,
      paused: saved.time.paused,
    },
    worldWeather: {
      currentState: saved.weather.currentState,
      targetState: saved.weather.targetState,
      intensity: weatherIntensity,
      dynamicEnabled: saved.weather.dynamicEnabled,
      transitionDurationSeconds: saved.weather.transitionDurationSeconds,
    },
    savedWorldState: {
      openedChests: saved.world.openedChestIds ?? [],
      collectedPickups: saved.world.collectedInteractableIds ?? [],
      depletedResources: (saved.world.depletedNodes ?? []).map((n) => ({
        id: n.id,
        usesRemaining: n.usesRemaining,
        regenAtMs: Date.now() + 90_000,
      })),
      doors: (saved.world.doorStates ?? []).map((d) => ({
        id: d.id,
        isOpen: Boolean(d.isOpen),
      })),
      placedBeds: (saved.world.placedBeds ?? []).map((b) => ({
        id: b.id,
        x: b.x,
        y: 0,
        z: b.z,
        yaw: b.yaw,
        ownerId: 'host',
      })),
      placedStations: (saved.world.placedStations ?? []).map((s) => ({
        id: s.id,
        stationType: s.stationType,
        x: s.x,
        y: 0,
        z: s.z,
        yaw: s.yaw,
        ownerId: 'host',
      })),
      playerBuildings: (saved.world.playerBuildings ?? []).map((pb) => ({
        id: pb.id,
        blueprintId: pb.blueprintId,
        x: pb.x,
        y: pb.y,
        z: pb.z,
        yaw: pb.yaw,
        structureHp: pb.health,
        maxStructureHp: pb.maxHealth,
        ownerId: pb.ownerId,
        ownerName: pb.ownerName,
        permissionScope: pb.permission,
        createdAtMs: pb.createdAtMs,
        ...(pb.doorOpen !== undefined ? { doorOpen: pb.doorOpen } : {}),
        ...(pb.storageItems
          ? {
              storageItems: pb.storageItems.map((it) => ({
                itemId: it.itemId,
                count: it.count,
              })),
            }
          : {}),
        ...(pb.farmState
          ? {
              farmStage: pb.farmState.stage,
              farmProgress: pb.farmState.growthProgress,
              farmSoilPrepared: pb.farmState.soilPrepared,
              farmCropId: pb.farmState.cropId ?? null,
              farmWaterLevel: pb.farmState.waterLevel,
              farmPlantedAtHours: pb.farmState.plantedAtWorldHours ?? undefined,
            }
          : {}),
      })),
      villagesDev: Object.values(saved.villageDev?.villages ?? {}).map((v) => ({
        villageId: v.villageId,
        level: v.level,
        progressXp: v.progressXp,
        reputationPoints: v.reputationPoints,
        completedRepairIds: v.completedRepairIds ?? [],
        completedProjectIds: v.completedProjectIds ?? [],
        cropsHarvestedCount: v.cropsHarvestedCount ?? 0,
        tradesCompletedCount: v.tradesCompletedCount ?? 0,
        defensesWonCount: v.defensesWonCount ?? 0,
      })),
      discoveredLandmarks:
        saved.world.discoveredLandmarkIds && saved.world.discoveredLandmarkIds.length > 0
          ? saved.world.discoveredLandmarkIds
          : ['spawn-glade'],
      droppedItems: (saved.world.droppedPickups ?? []).map((d) => ({
        id: d.id,
        itemId: d.itemId,
        count: d.count,
        label: d.label,
        x: d.x,
        y: 0,
        z: d.z,
        droppedBy: 'host',
      })),
      deadEntities: [
        ...(saved.world.defeatedEnemyIds ?? []).map((id) => ({
          id,
          kind: 'enemy',
        })),
        ...(saved.world.killedAnimalIds ?? []).map((id) => ({
          id,
          kind: 'animal',
        })),
      ],
    },
  };
}
