import {
  ALL_SAVE_SLOTS,
  CURRENT_SAVE_VERSION,
  type DifficultyLevel,
  type SaveGameData,
  type SaveGameMeta,
  type SaveSlotId,
  type SavedCameraState,
  type SavedCraftingState,
  type SavedInventoryState,
  type SavedPlayerState,
  type SavedQuestState,
  type SavedTimeState,
  type SavedWeatherState,
  type SavedWorldState,
  type WorldSaveModSummary,
  type WorldType,
} from './saveTypes';
import type { SavedStoryState } from '../story/storyTypes';
import type { SavedSideQuestState } from '../sidequest/sideQuestTypes';
import type { SavedVillageDevelopmentState } from '../village/villageDevTypes';
import type { WorldModMetadataSnapshot } from '../mods/modTypes';
import type { SavedPlayerModEventState } from '../mods/ModPlayerEventStore';
import { getBiomeAt } from '../math/noise';
import {
  deletePersistentWorldBundle,
  persistWorldBundle,
} from './LocalWorldStorage';
import { migrateSaveData } from './saveMigrations';

function deriveWorldModSummary(
  modMetadata?: WorldModMetadataSnapshot,
): WorldSaveModSummary {
  if (!modMetadata) {
    return { selectionMode: 'vanilla', enabledCount: 0, modIds: [] };
  }
  const enabledMods = (modMetadata.mods ?? []).filter((m) => m.enabled !== false);
  const selectionMode: 'vanilla' | 'custom' =
    modMetadata.selectionMode === 'vanilla' && enabledMods.length === 0
      ? 'vanilla'
      : modMetadata.selectionMode === 'custom' || (modMetadata.mods ?? []).length > 0
        ? 'custom'
        : 'vanilla';
  return {
    selectionMode,
    enabledCount: enabledMods.length,
    modIds: enabledMods.map((m) => m.modId),
  };
}

const STORAGE_PREFIX = 'woa_save_v1_';
const WORLD_INDEX_KEY = 'woa_world_ids_v1';
const LAST_SLOT_KEY = 'woa_last_save_slot_v1';

export function getSaveStorageKey(slotId: SaveSlotId): string {
  return `${STORAGE_PREFIX}${slotId}`;
}

export function generateWorldId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0');
  return `world-${ts}-${rand}`;
}

export interface SaveSourceState {
  worldId: string;
  worldName: string;
  worldType: WorldType;
  difficulty: DifficultyLevel;
  createdAtMs: number;
  thumbnailDataUrl?: string;
  playTimeSeconds: number;
  timeLabel: string;
  player: SavedPlayerState;
  inventory: SavedInventoryState;
  quests: SavedQuestState;
  story?: SavedStoryState;
  sideQuests?: SavedSideQuestState;
  villageDev?: SavedVillageDevelopmentState;
  crafting?: SavedCraftingState;
  time: SavedTimeState;
  weather: SavedWeatherState;
  world: SavedWorldState;
  camera?: SavedCameraState;
  audio?: {
    footstepVolume?: number;
  };
  modMetadata?: WorldModMetadataSnapshot;
  playerModEventState?: SavedPlayerModEventState;
}

export interface SaveResult {
  ok: boolean;
  meta?: SaveGameMeta;
  error?: string;
}

/**
 * Unified SaveManager handling serialization, multi-world indexing,
 * metadata stamping, localStorage mirror + isolated per-world disk persistence,
 * and world deletion.
 */
export class SaveManager {
  private static cloudHooks: {
    onSave?: (slotId: SaveSlotId) => void;
    onDelete?: (slotId: SaveSlotId) => void;
  } = {};

  public static registerCloudHooks(hooks: {
    onSave?: (slotId: SaveSlotId) => void;
    onDelete?: (slotId: SaveSlotId) => void;
  }): void {
    SaveManager.cloudHooks = hooks;
  }

  public getRegisteredWorldIds(): string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];

    try {
      const raw = localStorage.getItem(WORLD_INDEX_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const id of parsed) {
            if (typeof id === 'string' && id.trim() && !seen.has(id)) {
              seen.add(id);
              ordered.push(id);
            }
          }
        }
      }
    } catch {
      // Ignore parse errors
    }

    // Also include legacy slot keys if they exist in localStorage
    for (const legacyId of ALL_SAVE_SLOTS) {
      try {
        if (localStorage.getItem(getSaveStorageKey(legacyId)) && !seen.has(legacyId)) {
          seen.add(legacyId);
          ordered.push(legacyId);
        }
      } catch {
        // Ignore storage errors
      }
    }

    return ordered;
  }

  private setRegisteredWorldIds(ids: string[]): void {
    try {
      localStorage.setItem(WORLD_INDEX_KEY, JSON.stringify(ids));
    } catch {
      // Ignore storage quota errors
    }
  }

  private registerWorldId(worldId: string): void {
    const existing = this.getRegisteredWorldIds();
    if (!existing.includes(worldId)) {
      this.setRegisteredWorldIds([worldId, ...existing]);
    }
  }

  public buildSaveData(slotId: SaveSlotId, source: SaveSourceState): SaveGameData {
    const now = Date.now();
    const biome = getBiomeAt(source.player.position.x, source.player.position.z);

    const meta: SaveGameMeta = {
      slotId,
      worldId: source.worldId || slotId,
      worldName: source.worldName || 'Oakhollow Valley',
      worldType: source.worldType,
      difficulty: source.difficulty,
      version: CURRENT_SAVE_VERSION,
      createdAtMs: source.createdAtMs || now,
      savedAtIso: new Date(now).toISOString(),
      savedAtMs: now,
      playTimeSeconds: Math.max(0, Math.round(source.playTimeSeconds)),
      biome,
      level: source.player.level,
      timeLabel: source.timeLabel,
      weatherState: source.weather.currentState,
      completedQuestsCount: source.quests.completed.length,
      activeQuestsCount: source.quests.active.length,
      worldSeed: source.world.worldSeed,
      thumbnailDataUrl: source.thumbnailDataUrl,
      modSummary: deriveWorldModSummary(source.modMetadata),
    };

    return {
      version: CURRENT_SAVE_VERSION,
      meta,
      player: source.player,
      inventory: source.inventory,
      quests: source.quests,
      ...(source.story ? { story: source.story } : {}),
      ...(source.sideQuests ? { sideQuests: source.sideQuests } : {}),
      ...(source.villageDev ? { villageDev: source.villageDev } : {}),
      ...(source.crafting ? { crafting: source.crafting } : {}),
      time: source.time,
      weather: source.weather,
      world: source.world,
      ...(source.camera ? { camera: source.camera } : {}),
      ...(source.audio ? { audio: source.audio } : {}),
      ...(source.modMetadata ? { modMetadata: source.modMetadata } : {}),
      ...(source.playerModEventState ? { playerModEventState: source.playerModEventState } : {}),
    };
  }

  public saveToSlot(slotId: SaveSlotId, source: SaveSourceState): SaveResult {
    try {
      const built = this.buildSaveData(slotId, source);
      const validated = migrateSaveData(built);
      if (!validated) {
        return { ok: false, error: 'Save data failed schema validation.' };
      }
      const data = validated.data;
      data.meta.slotId = slotId;
      data.meta.worldId = data.meta.worldId || slotId;

      try {
        localStorage.setItem(getSaveStorageKey(slotId), JSON.stringify(data));
      } catch {
        // Retry localStorage without thumbnail; disk bundle keeps full payload
        try {
          const leanData: SaveGameData = {
            ...data,
            meta: { ...data.meta, thumbnailDataUrl: undefined },
          };
          localStorage.setItem(getSaveStorageKey(slotId), JSON.stringify(leanData));
        } catch {
          // Proceed with isolated persistent disk / IndexedDB save
        }
      }

      void persistWorldBundle(slotId, data);
      this.registerWorldId(slotId);
      this.setLastActiveSlot(slotId);
      SaveManager.cloudHooks.onSave?.(slotId);
      return { ok: true, meta: data.meta };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Storage write failed',
      };
    }
  }

  public deleteSave(slotId: SaveSlotId): boolean {
    try {
      localStorage.removeItem(getSaveStorageKey(slotId));
      const next = this.getRegisteredWorldIds().filter((id) => id !== slotId);
      this.setRegisteredWorldIds(next);
      if (this.getLastActiveSlot() === slotId) {
        localStorage.removeItem(LAST_SLOT_KEY);
      }
      void deletePersistentWorldBundle(slotId);
      SaveManager.cloudHooks.onDelete?.(slotId);
      return true;
    } catch {
      return false;
    }
  }

  public setLastActiveSlot(slotId: SaveSlotId): void {
    try {
      localStorage.setItem(LAST_SLOT_KEY, slotId);
    } catch {
      // Ignore storage quota errors
    }
  }

  public getLastActiveSlot(): SaveSlotId | null {
    try {
      const val = localStorage.getItem(LAST_SLOT_KEY);
      if (val && val.trim().length > 0) {
        return val;
      }
    } catch {
      // Ignore storage access errors
    }
    return null;
  }

  /**
   * Updates only a world save's mod configuration & summary metadata without
   * altering or dropping any player, inventory, quest, or building state.
   */
  public static updateSavedWorldModMetadata(
    slotId: SaveSlotId,
    nextMeta: WorldModMetadataSnapshot,
  ): SaveGameData | null {
    try {
      const raw = localStorage.getItem(getSaveStorageKey(slotId));
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      const migrated = migrateSaveData(parsed);
      if (!migrated) return null;

      const updated: SaveGameData = {
        ...migrated.data,
        meta: {
          ...migrated.data.meta,
          modSummary: deriveWorldModSummary(nextMeta),
        },
        modMetadata: nextMeta,
      };

      const revalidated = migrateSaveData(updated);
      if (!revalidated) return null;
      const finalData = revalidated.data;

      try {
        localStorage.setItem(getSaveStorageKey(slotId), JSON.stringify(finalData));
      } catch {
        const leanData: SaveGameData = {
          ...finalData,
          meta: { ...finalData.meta, thumbnailDataUrl: undefined },
        };
        localStorage.setItem(getSaveStorageKey(slotId), JSON.stringify(leanData));
      }

      void persistWorldBundle(slotId, finalData);
      SaveManager.cloudHooks.onSave?.(slotId);
      return finalData;
    } catch {
      return null;
    }
  }
}
