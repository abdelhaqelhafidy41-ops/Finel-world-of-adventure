import type { Language } from '../i18n/translations';

export interface PlayerModAchievementRecord {
  achievementId: string;
  modId: string;
  title?: string;
  description?: string;
  worldId?: string;
  unlockedAt: number;
}

export interface SavedPlayerModEventState {
  version: number;
  executedPlayerEvents: Record<string, number>;
  unlockedAchievements: Record<string, PlayerModAchievementRecord>;
}

const STORAGE_KEY = 'woa_mod_player_event_store_v1';

function createEmptyState(): SavedPlayerModEventState {
  return {
    version: 1,
    executedPlayerEvents: {},
    unlockedAchievements: {},
  };
}

function getStorageSafe(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore restricted storage contexts
  }
  return null;
}

export class ModPlayerEventStore {
  private state: SavedPlayerModEventState = createEmptyState();
  private loaded = false;

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const storage = getStorageSafe();
    if (!storage) return;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      const obj = parsed as Record<string, unknown>;
      const executed: Record<string, number> = {};
      if (obj.executedPlayerEvents && typeof obj.executedPlayerEvents === 'object' && !Array.isArray(obj.executedPlayerEvents)) {
        for (const [k, v] of Object.entries(obj.executedPlayerEvents as Record<string, unknown>)) {
          if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && k.length > 0 && k.length <= 256) {
            executed[k] = v;
          }
        }
      }
      const achievements: Record<string, PlayerModAchievementRecord> = {};
      if (obj.unlockedAchievements && typeof obj.unlockedAchievements === 'object' && !Array.isArray(obj.unlockedAchievements)) {
        for (const [k, v] of Object.entries(obj.unlockedAchievements as Record<string, unknown>)) {
          if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
          const rec = v as Record<string, unknown>;
          if (typeof rec.achievementId !== 'string' || typeof rec.modId !== 'string') continue;
          achievements[k] = {
            achievementId: rec.achievementId,
            modId: rec.modId,
            ...(typeof rec.title === 'string' ? { title: rec.title } : {}),
            ...(typeof rec.description === 'string' ? { description: rec.description } : {}),
            ...(typeof rec.worldId === 'string' ? { worldId: rec.worldId } : {}),
            unlockedAt:
              typeof rec.unlockedAt === 'number' && Number.isFinite(rec.unlockedAt)
                ? rec.unlockedAt
                : Date.now(),
          };
        }
      }
      this.state = {
        version: 1,
        executedPlayerEvents: executed,
        unlockedAchievements: achievements,
      };
    } catch {
      this.state = createEmptyState();
    }
  }

  private persist(): void {
    const storage = getStorageSafe();
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Ignore quota errors cleanly
    }
  }

  private buildExecutionKey(playerScopeId: string, fullEventId: string): string {
    return `${playerScopeId}::${fullEventId}`;
  }

  public hasExecutedForPlayer(playerScopeId: string, fullEventId: string): boolean {
    this.ensureLoaded();
    const key = this.buildExecutionKey(playerScopeId, fullEventId);
    return (this.state.executedPlayerEvents[key] ?? 0) > 0;
  }

  public getExecutionCountForPlayer(playerScopeId: string, fullEventId: string): number {
    this.ensureLoaded();
    const key = this.buildExecutionKey(playerScopeId, fullEventId);
    return this.state.executedPlayerEvents[key] ?? 0;
  }

  public markExecutedForPlayer(playerScopeId: string, fullEventId: string): void {
    this.ensureLoaded();
    const key = this.buildExecutionKey(playerScopeId, fullEventId);
    this.state.executedPlayerEvents[key] = (this.state.executedPlayerEvents[key] ?? 0) + 1;
    this.persist();
  }

  public unlockAchievement(
    playerScopeId: string,
    record: {
      modId: string;
      achievementId: string;
      title?: string;
      description?: string;
      worldId?: string;
    },
  ): { newlyUnlocked: boolean; entry: PlayerModAchievementRecord } {
    this.ensureLoaded();
    const storageKey = `${playerScopeId}::${record.achievementId}`;
    const existing = this.state.unlockedAchievements[storageKey];
    if (existing) {
      return { newlyUnlocked: false, entry: existing };
    }
    const entry: PlayerModAchievementRecord = {
      achievementId: record.achievementId,
      modId: record.modId,
      ...(record.title ? { title: record.title } : {}),
      ...(record.description ? { description: record.description } : {}),
      ...(record.worldId ? { worldId: record.worldId } : {}),
      unlockedAt: Date.now(),
    };
    this.state.unlockedAchievements[storageKey] = entry;
    this.persist();
    return { newlyUnlocked: true, entry };
  }

  public getUnlockedAchievements(playerScopeId?: string): PlayerModAchievementRecord[] {
    this.ensureLoaded();
    if (!playerScopeId) {
      return Object.values(this.state.unlockedAchievements);
    }
    const prefix = `${playerScopeId}::`;
    return Object.entries(this.state.unlockedAchievements)
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => v);
  }

  public exportSnapshot(): SavedPlayerModEventState {
    this.ensureLoaded();
    return {
      version: 1,
      executedPlayerEvents: { ...this.state.executedPlayerEvents },
      unlockedAchievements: { ...this.state.unlockedAchievements },
    };
  }

  public restoreSnapshot(snapshot?: SavedPlayerModEventState | null): void {
    this.loaded = true;
    if (!snapshot) {
      this.state = createEmptyState();
    } else {
      this.state = {
        version: 1,
        executedPlayerEvents: { ...(snapshot.executedPlayerEvents ?? {}) },
        unlockedAchievements: { ...(snapshot.unlockedAchievements ?? {}) },
      };
    }
    this.persist();
  }

  public clearForTests(): void {
    this.loaded = true;
    this.state = createEmptyState();
    const storage = getStorageSafe();
    if (storage) {
      try {
        storage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore
      }
    }
  }
}

let sharedPlayerEventStore: ModPlayerEventStore | null = null;

export function getModPlayerEventStore(): ModPlayerEventStore {
  if (!sharedPlayerEventStore) {
    sharedPlayerEventStore = new ModPlayerEventStore();
  }
  return sharedPlayerEventStore;
}

export function formatDefaultModAchievementNotice(
  title: string,
  lang: Language,
): string {
  return lang === 'ar'
    ? `تم فتح إنجاز: ${title}`
    : `Achievement Unlocked: ${title}`;
}
