import type { Language } from '../i18n/translations';

export interface PlayerModAchievementRecord {
  achievementId: string;
  modId: string;
  title?: string;
  description?: string;
  worldId?: string;
  unlockedAt: number;
}

export interface PendingModRewardRecord {
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

export interface SavedPlayerModEventState {
  version: number;
  executedPlayerEvents: Record<string, number>;
  executedPlayerWorldEvents?: Record<string, number>;
  playerCooldowns?: Record<string, number>;
  unlockedAchievements: Record<string, PlayerModAchievementRecord>;
  pendingRewards?: PendingModRewardRecord[];
}

const STORAGE_KEY = 'woa_mod_player_event_store_v1';

function createEmptyState(): SavedPlayerModEventState {
  return {
    version: 1,
    executedPlayerEvents: {},
    executedPlayerWorldEvents: {},
    playerCooldowns: {},
    unlockedAchievements: {},
    pendingRewards: [],
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
      const executedWorld: Record<string, number> = {};
      if (obj.executedPlayerWorldEvents && typeof obj.executedPlayerWorldEvents === 'object' && !Array.isArray(obj.executedPlayerWorldEvents)) {
        for (const [k, v] of Object.entries(obj.executedPlayerWorldEvents as Record<string, unknown>)) {
          if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && k.length > 0 && k.length <= 320) {
            executedWorld[k] = v;
          }
        }
      }
      const cooldowns: Record<string, number> = {};
      if (obj.playerCooldowns && typeof obj.playerCooldowns === 'object' && !Array.isArray(obj.playerCooldowns)) {
        for (const [k, v] of Object.entries(obj.playerCooldowns as Record<string, unknown>)) {
          if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && k.length > 0 && k.length <= 320) {
            cooldowns[k] = v;
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
      const pendingRewards: PendingModRewardRecord[] = [];
      if (Array.isArray(obj.pendingRewards)) {
        for (const rawPend of obj.pendingRewards.slice(0, 128)) {
          if (!rawPend || typeof rawPend !== 'object' || Array.isArray(rawPend)) continue;
          const p = rawPend as Record<string, unknown>;
          if (
            typeof p.id !== 'string' ||
            typeof p.modId !== 'string' ||
            typeof p.fullEventId !== 'string' ||
            typeof p.worldId !== 'string' ||
            !Array.isArray(p.items)
          ) {
            continue;
          }
          const items = p.items
            .filter((it): it is { itemId: string; count: number; equip?: boolean } =>
              Boolean(
                it &&
                  typeof it === 'object' &&
                  typeof (it as { itemId?: unknown }).itemId === 'string' &&
                  typeof (it as { count?: unknown }).count === 'number',
              ),
            )
            .map((it) => ({
              itemId: it.itemId,
              count: Math.max(1, Math.floor(it.count)),
              ...(typeof it.equip === 'boolean' ? { equip: it.equip } : {}),
            }));
          if (items.length === 0) continue;
          pendingRewards.push({
            id: p.id,
            modId: p.modId,
            eventId: typeof p.eventId === 'string' ? p.eventId : p.fullEventId,
            fullEventId: p.fullEventId,
            playerScopeId: typeof p.playerScopeId === 'string' ? p.playerScopeId : 'local-player',
            worldId: p.worldId,
            items,
            createdAt: typeof p.createdAt === 'number' && Number.isFinite(p.createdAt) ? p.createdAt : Date.now(),
            attempts: typeof p.attempts === 'number' && Number.isFinite(p.attempts) ? p.attempts : 0,
          });
        }
      }
      this.state = {
        version: 1,
        executedPlayerEvents: executed,
        executedPlayerWorldEvents: executedWorld,
        playerCooldowns: cooldowns,
        unlockedAchievements: achievements,
        pendingRewards,
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

  private buildWorldExecutionKey(playerScopeId: string, worldId: string, fullEventId: string): string {
    return `${playerScopeId}::${worldId}::${fullEventId}`;
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

  public hasExecutedForPlayerInWorld(
    playerScopeId: string,
    worldId: string,
    fullEventId: string,
  ): boolean {
    this.ensureLoaded();
    const key = this.buildWorldExecutionKey(playerScopeId, worldId, fullEventId);
    return ((this.state.executedPlayerWorldEvents ?? {})[key] ?? 0) > 0;
  }

  public getExecutionCountForPlayerInWorld(
    playerScopeId: string,
    worldId: string,
    fullEventId: string,
  ): number {
    this.ensureLoaded();
    const key = this.buildWorldExecutionKey(playerScopeId, worldId, fullEventId);
    return (this.state.executedPlayerWorldEvents ?? {})[key] ?? 0;
  }

  public markExecutedForPlayerInWorld(
    playerScopeId: string,
    worldId: string,
    fullEventId: string,
  ): void {
    this.ensureLoaded();
    if (!this.state.executedPlayerWorldEvents) {
      this.state.executedPlayerWorldEvents = {};
    }
    const key = this.buildWorldExecutionKey(playerScopeId, worldId, fullEventId);
    this.state.executedPlayerWorldEvents[key] =
      (this.state.executedPlayerWorldEvents[key] ?? 0) + 1;
    this.persist();
  }

  public getLastCooldownMs(playerScopeId: string, worldId: string, fullEventId: string): number {
    this.ensureLoaded();
    const key = this.buildWorldExecutionKey(playerScopeId, worldId, fullEventId);
    return (this.state.playerCooldowns ?? {})[key] ?? 0;
  }

  public setLastCooldownMs(
    playerScopeId: string,
    worldId: string,
    fullEventId: string,
    timestampMs: number,
  ): void {
    this.ensureLoaded();
    if (!this.state.playerCooldowns) {
      this.state.playerCooldowns = {};
    }
    const key = this.buildWorldExecutionKey(playerScopeId, worldId, fullEventId);
    this.state.playerCooldowns[key] = timestampMs;
    this.persist();
  }

  public addPendingReward(entry: PendingModRewardRecord): void {
    this.ensureLoaded();
    const list = this.state.pendingRewards ?? [];
    if (list.some((r) => r.id === entry.id)) return;
    this.state.pendingRewards = [...list.slice(-99), entry];
    this.persist();
  }

  public getPendingRewards(worldId?: string, playerScopeId?: string): PendingModRewardRecord[] {
    this.ensureLoaded();
    return (this.state.pendingRewards ?? []).filter(
      (r) =>
        (!worldId || r.worldId === worldId) &&
        (!playerScopeId || r.playerScopeId === playerScopeId),
    );
  }

  public replacePendingRewardsForWorld(
    worldId: string,
    playerScopeId: string,
    nextWorldRewards: PendingModRewardRecord[],
  ): void {
    this.ensureLoaded();
    const others = (this.state.pendingRewards ?? []).filter(
      (r) => !(r.worldId === worldId && r.playerScopeId === playerScopeId),
    );
    this.state.pendingRewards = [...others, ...nextWorldRewards];
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
      executedPlayerWorldEvents: { ...(this.state.executedPlayerWorldEvents ?? {}) },
      playerCooldowns: { ...(this.state.playerCooldowns ?? {}) },
      unlockedAchievements: { ...this.state.unlockedAchievements },
      pendingRewards: [...(this.state.pendingRewards ?? [])],
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
        executedPlayerWorldEvents: { ...(snapshot.executedPlayerWorldEvents ?? {}) },
        playerCooldowns: { ...(snapshot.playerCooldowns ?? {}) },
        unlockedAchievements: { ...(snapshot.unlockedAchievements ?? {}) },
        pendingRewards: Array.isArray(snapshot.pendingRewards)
          ? [...snapshot.pendingRewards]
          : [],
      };
    }
    this.persist();
  }

  public mergeSnapshot(snapshot?: SavedPlayerModEventState | null): void {
    if (!snapshot) return;
    this.ensureLoaded();
    for (const [k, v] of Object.entries(snapshot.executedPlayerEvents ?? {})) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        this.state.executedPlayerEvents[k] = Math.max(
          this.state.executedPlayerEvents[k] ?? 0,
          v,
        );
      }
    }
    if (!this.state.executedPlayerWorldEvents) {
      this.state.executedPlayerWorldEvents = {};
    }
    for (const [k, v] of Object.entries(snapshot.executedPlayerWorldEvents ?? {})) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        this.state.executedPlayerWorldEvents[k] = Math.max(
          this.state.executedPlayerWorldEvents[k] ?? 0,
          v,
        );
      }
    }
    if (!this.state.playerCooldowns) {
      this.state.playerCooldowns = {};
    }
    for (const [k, v] of Object.entries(snapshot.playerCooldowns ?? {})) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        this.state.playerCooldowns[k] = Math.max(
          this.state.playerCooldowns[k] ?? 0,
          v,
        );
      }
    }
    for (const [k, rec] of Object.entries(snapshot.unlockedAchievements ?? {})) {
      if (rec && !this.state.unlockedAchievements[k]) {
        this.state.unlockedAchievements[k] = { ...rec };
      }
    }
    const pending = this.state.pendingRewards ?? [];
    for (const pr of snapshot.pendingRewards ?? []) {
      if (pr && pr.id && !pending.some((existing) => existing.id === pr.id)) {
        pending.push({
          ...pr,
          items: pr.items.map((it) => ({ ...it })),
        });
      }
    }
    this.state.pendingRewards = pending.slice(-128);
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
