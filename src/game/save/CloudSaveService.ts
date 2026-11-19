import {
  CLOUD_SAVE_SCHEMA_VERSION,
  type CloudPlayerSavePayload,
  type CloudSyncState,
  type CloudWorldSaveRecord,
  type CloudWorldSaveSummary,
} from '../../../shared/accountTypes';
import { createEmptyProfileStats } from '../../../shared/profileTypes';
import { loadSavedLanguage, saveLanguage } from '../i18n/translations';
import { AuthService, resolveAccountApiBaseUrl } from '../profile/AuthService';
import { ProfileManager } from '../profile/ProfileManager';
import { GameSettingsStore } from '../settings/GameSettingsStore';
import { LoadManager } from './LoadManager';
import { getSaveStorageKey, SaveManager } from './SaveManager';
import type { SaveGameData } from './saveTypes';

const CLOUD_META_STORAGE_KEY = 'woa_cloud_sync_meta_v1';
const CLOUD_BACKUP_STORAGE_KEY = 'woa_cloud_local_backup_v1';
const DEBOUNCE_PLAYER_SAVE_MS = 3500;
const DEBOUNCE_WORLD_SAVE_MS = 5000;
const MAX_RETRY_BACKOFF_MS = 60_000;

export interface CloudSyncSnapshot {
  state: CloudSyncState;
  lastSyncedAt: number | null;
  playerRevision: number;
  pendingPlayerSync: boolean;
  pendingWorldIds: string[];
  lastError: string | null;
  cloudWorlds: CloudWorldSaveSummary[];
}

interface StoredCloudSyncMeta {
  playerRevision: number;
  worldRevisions: Record<string, number>;
  lastSyncedAt: number | null;
  pendingPlayerSync: boolean;
  pendingWorldIds: string[];
}

function readSyncMeta(): StoredCloudSyncMeta {
  try {
    const raw = localStorage.getItem(CLOUD_META_STORAGE_KEY);
    if (!raw) {
      return {
        playerRevision: 0,
        worldRevisions: {},
        lastSyncedAt: null,
        pendingPlayerSync: false,
        pendingWorldIds: [],
      };
    }
    const p = JSON.parse(raw) as Partial<StoredCloudSyncMeta>;
    return {
      playerRevision: typeof p.playerRevision === 'number' ? p.playerRevision : 0,
      worldRevisions:
        p.worldRevisions && typeof p.worldRevisions === 'object' ? p.worldRevisions : {},
      lastSyncedAt: typeof p.lastSyncedAt === 'number' ? p.lastSyncedAt : null,
      pendingPlayerSync: Boolean(p.pendingPlayerSync),
      pendingWorldIds: Array.isArray(p.pendingWorldIds)
        ? p.pendingWorldIds.filter((x): x is string => typeof x === 'string')
        : [],
    };
  } catch {
    return {
      playerRevision: 0,
      worldRevisions: {},
      lastSyncedAt: null,
      pendingPlayerSync: false,
      pendingWorldIds: [],
    };
  }
}

function writeSyncMeta(meta: StoredCloudSyncMeta): void {
  try {
    localStorage.setItem(CLOUD_META_STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // Ignore storage quota errors
  }
}

class CloudSaveServiceImpl {
  private readonly saveManager = new SaveManager();
  private readonly loadManager = new LoadManager();
  private meta: StoredCloudSyncMeta = readSyncMeta();
  private state: CloudSyncState = 'idle';
  private lastError: string | null = null;
  private cloudWorlds: CloudWorldSaveSummary[] = [];
  private playerDebounceTimer: number | null = null;
  private worldDebounceTimers = new Map<string, number>();
  private retryTimer: number | null = null;
  private retryAttempt = 0;
  private listenersBound = false;
  private readonly listeners = new Set<(snap: CloudSyncSnapshot) => void>();

  constructor() {
    this.bindOnlineListeners();
  }

  private bindOnlineListeners(): void {
    if (this.listenersBound || typeof window === 'undefined') return;
    this.listenersBound = true;
    window.addEventListener('online', () => {
      if (AuthService.isSignedInCloudAccount()) {
        this.retryAttempt = 0;
        void this.flushPendingQueue();
      }
    });
    window.addEventListener('offline', () => {
      this.setState('offline');
    });
    document.addEventListener('visibilitychange', () => {
      if (
        document.visibilityState === 'hidden' &&
        AuthService.isSignedInCloudAccount() &&
        (this.meta.pendingPlayerSync || this.meta.pendingWorldIds.length > 0)
      ) {
        void this.flushPendingQueue();
      }
    });
  }

  private setState(next: CloudSyncState, error: string | null = null): void {
    this.state = next;
    this.lastError = error;
    this.notify();
  }

  private notify(): void {
    const snap = this.getSnapshot();
    for (const fn of this.listeners) {
      try {
        fn(snap);
      } catch {
        // Ignore subscriber errors
      }
    }
  }

  public getSnapshot(): CloudSyncSnapshot {
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return {
      state: isOffline ? 'offline' : this.state,
      lastSyncedAt: this.meta.lastSyncedAt,
      playerRevision: this.meta.playerRevision,
      pendingPlayerSync: this.meta.pendingPlayerSync,
      pendingWorldIds: [...this.meta.pendingWorldIds],
      lastError: this.lastError,
      cloudWorlds: [...this.cloudWorlds],
    };
  }

  public subscribe(listener: (snap: CloudSyncSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private isReadyForNetwork(): { ok: true; baseUrl: string } | { ok: false } {
    const baseUrl = resolveAccountApiBaseUrl();
    if (!baseUrl || !AuthService.isSignedInCloudAccount()) {
      return { ok: false };
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setState('offline');
      return { ok: false };
    }
    return { ok: true, baseUrl };
  }

  /**
   * Checks whether the current device already has local worlds or local progression
   * so we can ask "Cloud save or local save?" instead of silently overwriting.
   */
  public hasLocalData(): boolean {
    const worlds = this.loadManager.listSavedWorlds();
    if (worlds.length > 0) return true;
    const profile = ProfileManager.getProfile();
    if (profile && (profile.stats.level > 1 || profile.stats.xp > 0 || profile.stats.playTimeSeconds > 60)) {
      return true;
    }
    return false;
  }

  /**
   * Creates a safe local backup snapshot before applying cloud data over local storage.
   */
  public backupLocalSavesBeforeOverwrite(): void {
    try {
      const ids = this.saveManager.getRegisteredWorldIds();
      const worlds: Record<string, string | null> = {};
      for (const id of ids) {
        worlds[id] = localStorage.getItem(getSaveStorageKey(id));
      }
      const backup = {
        backedUpAt: Date.now(),
        worldIds: ids,
        worlds,
      };
      localStorage.setItem(CLOUD_BACKUP_STORAGE_KEY, JSON.stringify(backup));
    } catch {
      // Non-fatal if storage quota is tight
    }
  }

  /**
   * Builds a consolidated CloudPlayerSavePayload from existing game managers
   * (ProfileManager, latest SaveGameData, GameSettingsStore, language).
   */
  public buildLocalPlayerPayload(): CloudPlayerSavePayload {
    const profile = ProfileManager.getProfile();
    const savedWorlds = this.loadManager.listSavedWorlds();
    const latestMeta = savedWorlds[0] ?? null;
    const loadedLatest = latestMeta ? this.loadManager.loadSlot(latestMeta.slotId) : null;
    const latestWorld: SaveGameData | null =
      loadedLatest && loadedLatest.ok ? loadedLatest.data : null;
    const settings = GameSettingsStore.get();
    const language = loadSavedLanguage();

    const stats = profile?.stats ?? createEmptyProfileStats();
    const level = Math.max(stats.level || 1, latestWorld?.player.level || 1);
    const xp = Math.max(stats.xp || 0, latestWorld?.player.xp || 0);
    const coins = latestWorld?.player.coins ?? 0;

    return {
      saveVersion: CLOUD_SAVE_SCHEMA_VERSION,
      revision: this.meta.playerRevision,
      updatedAt: Date.now(),
      progress: {
        level,
        xp,
        xpToNextLevel: stats.xpToNextLevel || 100,
        coins,
        secondaryCurrencies: {},
        maxHealth: Math.max(100, latestWorld?.player.health ?? 100),
        maxStamina: Math.max(100, latestWorld?.player.stamina ?? 100),
        unlockedCharacters: [],
        unlockedAbilities: [],
        skills: {},
        stats: {
          ...stats,
          level,
          xp,
        },
      },
      inventory: (latestWorld?.inventory as unknown as Record<string, unknown>) ?? {},
      quests: {
        ...(latestWorld?.quests ? { quests: latestWorld.quests } : {}),
        ...(latestWorld?.story ? { story: latestWorld.story } : {}),
        ...(latestWorld?.sideQuests ? { sideQuests: latestWorld.sideQuests } : {}),
      },
      achievements: [],
      settings: {
        language,
        gameSettings: settings,
      },
    };
  }

  /**
   * Applies downloaded cloud player data & cloud worlds safely into local cache/storage.
   */
  public applyCloudDataToLocal(
    playerSave: CloudPlayerSavePayload | null,
    worlds: CloudWorldSaveRecord[],
  ): void {
    this.backupLocalSavesBeforeOverwrite();

    if (playerSave) {
      this.meta.playerRevision = playerSave.revision;
      const langSetting = playerSave.settings?.language;
      if (langSetting === 'ar' || langSetting === 'en') {
        saveLanguage(langSetting);
      }
      if (
        playerSave.settings?.gameSettings &&
        typeof playerSave.settings.gameSettings === 'object'
      ) {
        try {
          GameSettingsStore.update(
            playerSave.settings.gameSettings as Parameters<typeof GameSettingsStore.update>[0],
          );
        } catch {
          // Keep existing settings if partial/incompatible
        }
      }
    }

    // Restore cloud worlds into SaveManager localStorage slots
    if (Array.isArray(worlds) && worlds.length > 0) {
      const existingIds = this.saveManager.getRegisteredWorldIds();
      const mergedIds = [...existingIds];

      for (const w of worlds) {
        if (!w.worldId || !w.data || typeof w.data !== 'object') continue;
        try {
          const payload = w.data as unknown as SaveGameData;
          if (payload.meta && payload.player && payload.world) {
            localStorage.setItem(getSaveStorageKey(w.worldId), JSON.stringify(payload));
            if (!mergedIds.includes(w.worldId)) {
              mergedIds.unshift(w.worldId);
            }
            this.meta.worldRevisions[w.worldId] = w.revision;
          }
        } catch {
          // Ignore storage quota errors for individual world
        }
      }

      try {
        localStorage.setItem('woa_world_ids_v1', JSON.stringify(mergedIds));
        if (worlds[0]?.worldId) {
          this.saveManager.setLastActiveSlot(worlds[0].worldId);
        }
      } catch {
        // Ignore
      }
    }

    this.meta.lastSyncedAt = Date.now();
    this.meta.pendingPlayerSync = false;
    this.meta.pendingWorldIds = [];
    writeSyncMeta(this.meta);
    this.setState('synced');
  }

  public async savePlayerData(options?: {
    payload?: CloudPlayerSavePayload;
    forceOverwrite?: boolean;
  }): Promise<{ ok: boolean; conflict?: boolean; save?: CloudPlayerSavePayload | null; error?: string }> {
    const net = this.isReadyForNetwork();
    if (!net.ok) {
      this.meta.pendingPlayerSync = true;
      writeSyncMeta(this.meta);
      this.notify();
      return { ok: false, error: 'Offline — queued for sync.' };
    }

    this.setState('syncing');
    const payload = options?.payload ?? this.buildLocalPlayerPayload();

    try {
      const res = await fetch(`${net.baseUrl}/player/save`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          ...AuthService.getBearerHeaders(),
        },
        body: JSON.stringify({
          ...payload,
          baseRevision: this.meta.playerRevision,
          forceOverwrite: Boolean(options?.forceOverwrite),
        }),
      });

      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        message?: string;
        save?: CloudPlayerSavePayload;
      } | null;

      if (res.status === 409 && data?.error === 'SAVE_CONFLICT') {
        this.setState('conflict', 'Newer cloud save exists on server.');
        return { ok: false, conflict: true, error: data.message };
      }

      if (!res.ok || !data?.ok || !data.save) {
        throw new Error(data?.message || data?.error || 'Cloud save failed.');
      }

      this.meta.playerRevision = data.save.revision;
      this.meta.lastSyncedAt = Date.now();
      this.meta.pendingPlayerSync = false;
      writeSyncMeta(this.meta);
      this.retryAttempt = 0;
      this.setState('synced');
      return { ok: true, save: data.save };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Cloud save failed.';
      this.meta.pendingPlayerSync = true;
      writeSyncMeta(this.meta);
      this.setState('failed', msg);
      this.scheduleRetry();
      return { ok: false, error: msg };
    }
  }

  public async loadPlayerData(): Promise<CloudPlayerSavePayload | null> {
    const net = this.isReadyForNetwork();
    if (!net.ok) return null;

    this.setState('syncing');
    try {
      const res = await fetch(`${net.baseUrl}/player/save`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...AuthService.getBearerHeaders(),
        },
      });
      if (!res.ok) throw new Error('Failed to download cloud player save.');
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        save?: CloudPlayerSavePayload | null;
      } | null;
      if (data?.ok && data.save) {
        this.meta.playerRevision = data.save.revision;
        this.meta.lastSyncedAt = Date.now();
        writeSyncMeta(this.meta);
        this.setState('synced');
        return data.save;
      }
      this.setState('synced');
      return null;
    } catch (err) {
      this.setState('failed', err instanceof Error ? err.message : 'Download failed.');
      return null;
    }
  }

  public async saveWorldData(
    worldId: string,
    saveData?: SaveGameData | null,
    options?: { forceOverwrite?: boolean },
  ): Promise<{ ok: boolean; error?: string }> {
    let resolved: SaveGameData | null = saveData ?? null;
    if (!resolved) {
      const loaded = this.loadManager.loadSlot(worldId);
      resolved = loaded.ok ? loaded.data : null;
    }
    if (!resolved) return { ok: false, error: 'Local world save not found.' };

    const net = this.isReadyForNetwork();
    if (!net.ok) {
      if (!this.meta.pendingWorldIds.includes(worldId)) {
        this.meta.pendingWorldIds.push(worldId);
        writeSyncMeta(this.meta);
        this.notify();
      }
      return { ok: false, error: 'Offline — world queued for sync.' };
    }

    this.setState('syncing');
    // Strip heavy base64 thumbnail if huge so weak mobile devices upload fast
    const lightData: SaveGameData = {
      ...resolved,
      meta: {
        ...resolved.meta,
        thumbnailDataUrl: undefined,
      },
    };

    try {
      const res = await fetch(`${net.baseUrl}/world-saves/${encodeURIComponent(worldId)}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          ...AuthService.getBearerHeaders(),
        },
        body: JSON.stringify({
          worldId,
          worldName: resolved.meta.worldName,
          worldSeed: resolved.world.worldSeed,
          worldMode: resolved.meta.worldType,
          difficulty: resolved.meta.difficulty,
          saveVersion: resolved.version,
          playTimeSeconds: resolved.meta.playTimeSeconds,
          level: resolved.player.level,
          createdAt: resolved.meta.createdAtMs,
          baseRevision: this.meta.worldRevisions[worldId] ?? 0,
          forceOverwrite: Boolean(options?.forceOverwrite),
          data: lightData,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        message?: string;
        world?: CloudWorldSaveSummary;
      } | null;

      if (!res.ok || !json?.ok || !json.world) {
        throw new Error(json?.message || json?.error || 'Failed to save world to cloud.');
      }

      this.meta.worldRevisions[worldId] = json.world.revision;
      this.meta.pendingWorldIds = this.meta.pendingWorldIds.filter((id) => id !== worldId);
      this.meta.lastSyncedAt = Date.now();
      writeSyncMeta(this.meta);
      this.setState('synced');
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'World cloud sync failed.';
      if (!this.meta.pendingWorldIds.includes(worldId)) {
        this.meta.pendingWorldIds.push(worldId);
        writeSyncMeta(this.meta);
      }
      this.setState('failed', msg);
      this.scheduleRetry();
      return { ok: false, error: msg };
    }
  }

  public async loadWorldData(): Promise<CloudWorldSaveRecord[]> {
    const net = this.isReadyForNetwork();
    if (!net.ok) return [];

    this.setState('syncing');
    try {
      const res = await fetch(`${net.baseUrl}/world-saves?includeData=1`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...AuthService.getBearerHeaders(),
        },
      });
      if (!res.ok) throw new Error('Failed to load cloud worlds.');
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        worlds?: CloudWorldSaveRecord[];
      } | null;
      const list = data?.ok && Array.isArray(data.worlds) ? data.worlds : [];
      this.cloudWorlds = list.map(({ data: _d, ...summary }) => summary);
      this.setState('synced');
      return list;
    } catch (err) {
      this.setState('failed', err instanceof Error ? err.message : 'Failed to load cloud worlds.');
      return [];
    }
  }

  public async deleteWorldData(worldId: string): Promise<void> {
    const net = this.isReadyForNetwork();
    if (!net.ok) return;
    try {
      await fetch(`${net.baseUrl}/world-saves/${encodeURIComponent(worldId)}`, {
        method: 'DELETE',
        headers: AuthService.getBearerHeaders(),
      });
      delete this.meta.worldRevisions[worldId];
      this.cloudWorlds = this.cloudWorlds.filter((w) => w.worldId !== worldId);
      writeSyncMeta(this.meta);
      this.notify();
    } catch {
      // Ignore offline delete error
    }
  }

  public async syncPlayerData(forceOverwrite = false): Promise<boolean> {
    const res = await this.savePlayerData({ forceOverwrite });
    return res.ok;
  }

  public async syncWorldData(worldId?: string, forceOverwrite = false): Promise<boolean> {
    if (worldId) {
      const res = await this.saveWorldData(worldId, undefined, { forceOverwrite });
      return res.ok;
    }
    const ids = this.saveManager.getRegisteredWorldIds();
    let allOk = true;
    for (const id of ids) {
      const res = await this.saveWorldData(id, undefined, { forceOverwrite });
      if (!res.ok) allOk = false;
    }
    return allOk;
  }

  public async uploadAllLocalDataToCloud(): Promise<boolean> {
    const pOk = await this.syncPlayerData(true);
    const wOk = await this.syncWorldData(undefined, true);
    return pOk && wOk;
  }

  public async downloadAndRestoreAllFromCloud(): Promise<{
    playerSave: CloudPlayerSavePayload | null;
    worlds: CloudWorldSaveRecord[];
  }> {
    const [playerSave, worlds] = await Promise.all([
      this.loadPlayerData(),
      this.loadWorldData(),
    ]);
    this.applyCloudDataToLocal(playerSave, worlds);
    return { playerSave, worlds };
  }

  public schedulePlayerSave(): void {
    if (!AuthService.isSignedInCloudAccount()) return;
    this.meta.pendingPlayerSync = true;
    writeSyncMeta(this.meta);
    if (this.playerDebounceTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.playerDebounceTimer);
    }
    if (typeof window !== 'undefined') {
      this.playerDebounceTimer = window.setTimeout(() => {
        this.playerDebounceTimer = null;
        void this.savePlayerData();
      }, DEBOUNCE_PLAYER_SAVE_MS);
    }
  }

  public scheduleWorldSave(worldId: string): void {
    if (!AuthService.isSignedInCloudAccount() || !worldId) return;
    if (!this.meta.pendingWorldIds.includes(worldId)) {
      this.meta.pendingWorldIds.push(worldId);
      writeSyncMeta(this.meta);
    }
    const existingTimer = this.worldDebounceTimers.get(worldId);
    if (existingTimer !== undefined && typeof window !== 'undefined') {
      window.clearTimeout(existingTimer);
    }
    if (typeof window !== 'undefined') {
      const t = window.setTimeout(() => {
        this.worldDebounceTimers.delete(worldId);
        void this.saveWorldData(worldId);
      }, DEBOUNCE_WORLD_SAVE_MS);
      this.worldDebounceTimers.set(worldId, t);
    }
  }

  public async flushPendingQueue(): Promise<void> {
    if (!AuthService.isSignedInCloudAccount()) return;
    if (this.meta.pendingPlayerSync) {
      await this.savePlayerData();
    }
    const worldsToSync = [...this.meta.pendingWorldIds];
    for (const id of worldsToSync) {
      await this.saveWorldData(id);
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null || typeof window === 'undefined') return;
    this.retryAttempt += 1;
    const delay = Math.min(MAX_RETRY_BACKOFF_MS, 2000 * Math.pow(2, this.retryAttempt - 1));
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (AuthService.isSignedInCloudAccount()) {
        void this.flushPendingQueue();
      }
    }, delay);
  }

  public resetLocalSyncState(): void {
    this.meta = {
      playerRevision: 0,
      worldRevisions: {},
      lastSyncedAt: null,
      pendingPlayerSync: false,
      pendingWorldIds: [],
    };
    this.cloudWorlds = [];
    this.lastError = null;
    this.state = 'idle';
    writeSyncMeta(this.meta);
    this.notify();
  }
}

export const CloudSaveService = new CloudSaveServiceImpl();
