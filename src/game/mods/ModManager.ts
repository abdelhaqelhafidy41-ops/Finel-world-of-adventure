import { AUDIO_CUE_REGISTRY } from '../audio/AudioRegistry';
import { AudioManager } from '../audio/AudioManager';
import { BUILDING_BLUEPRINTS } from '../building/buildingCatalog';
import { setExternalBlueprintProvider } from '../building/buildingCatalog';
import { WeaponRegistry } from '../combat/weapons/WeaponRegistry';
import { CraftingManager } from '../inventory/CraftingManager';
import { ItemManager } from '../inventory/ItemManager';
import rawItems from '../inventory/items.json';
import rawRecipes from '../inventory/recipes.json';
import rawQuests from '../quest/quests.json';
import { SIDE_QUESTS } from '../sidequest/sideQuestData';
import { STORY_QUESTS } from '../story/storyCampaign';
import type { ModAssetReadResult } from '../../utils/platformExit';
import {
  DefaultModContentStore,
  type ModContentRegistryMap,
} from './handlers/defaultModHandlers';
import { ModAssetResolver } from './ModAssetResolver';
import { ModContentRegistry } from './ModContentRegistry';
import { CORE_PROTECTED_IDS } from './ModNamespaceRegistry';
import { ModStorageAdapter } from './ModStorageAdapter';
import { validateDiscoveredMods } from './ModValidator';
import {
  captureWorldModMetadata,
  evaluateMultiplayerModCompatibility,
  evaluateSaveModCompatibility,
  inspectWorldSaveMods,
} from './ModWorldCompatibility';
import type { SaveGameData } from '../save/saveTypes';
import {
  CURRENT_GAME_VERSION,
  MOD_API_VERSION,
  MOD_CONTENT_SCHEMA_VERSION,
  type ModCompatibilityEvaluation,
  type ModContentHandler,
  type ModContentType,
  type ModInstallProgress,
  type ModLogEntry,
  type ModLogLevel,
  type ModRecord,
  type ModsSnapshot,
  type ModStateConfig,
  type WorldModInspectionResult,
  type WorldModMetadataSnapshot,
  type WorldModSelectionEntry,
} from './modTypes';
import type {
  ModEventCrossReferenceResolvers,
  ModEventDefinition,
  ModEventDiagnosticEntry,
} from './ModEventConfig';
import type { ModSpawnDefinition, ModSpawnDiagnosticEntry } from './ModSpawnConfig';
import { setExternalWoa3dModelProvider } from './Woa3dModelBuilder';

const CORE_ITEM_IDS = new Set<string>(
  Array.isArray(rawItems)
    ? rawItems
        .map((r) => (r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string' ? (r as { id: string }).id : ''))
        .filter((id) => id.length > 0)
    : [],
);
const CORE_RECIPE_IDS = new Set<string>(
  Array.isArray(rawRecipes)
    ? rawRecipes
        .map((r) => (r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string' ? (r as { id: string }).id : ''))
        .filter((id) => id.length > 0)
    : [],
);
const CORE_QUEST_IDS = new Set<string>([
  ...(Array.isArray(rawQuests)
    ? rawQuests
        .map((r) => (r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string' ? (r as { id: string }).id : ''))
        .filter((id) => id.length > 0)
    : []),
  ...STORY_QUESTS.map((q) => q.questId),
  ...SIDE_QUESTS.map((q) => q.sideQuestId),
]);
const CORE_BLUEPRINT_IDS = new Set<string>(BUILDING_BLUEPRINTS.map((bp) => bp.id));

const MAX_LOG_ENTRIES = 120;

export class ModManager {
  private static instance: ModManager | null = null;

  public readonly registry = new ModContentRegistry();
  private readonly contentStore = new DefaultModContentStore();
  private readonly storage = new ModStorageAdapter();
  private readonly assetResolver = new ModAssetResolver((sourceId, relPath) =>
    this.storage.readAsset(sourceId, relPath),
  );

  private stateConfig: ModStateConfig = {
    version: 1,
    enabledByModId: {},
    priorityByModId: {},
  };

  private worldModScope: {
    selectionMode: 'vanilla' | 'custom';
    selectedMods: WorldModSelectionEntry[];
  } | null = null;

  private snapshot: ModsSnapshot;
  private readonly listeners = new Set<(snap: ModsSnapshot) => void>();
  private runtimeSpawnDiagnostics: ModSpawnDiagnosticEntry[] = [];
  private runtimeSpawnDiagSignature = '';
  private runtimeEventDiagnostics: ModEventDiagnosticEntry[] = [];
  private runtimeEventDiagSignature = '';
  private initPromise: Promise<ModsSnapshot> | null = null;
  private refreshPromise: Promise<ModsSnapshot> | null = null;
  private logCounter = 0;

  private constructor() {
    for (const handler of this.contentStore.createHandlers()) {
      this.registry.registerHandler(handler);
    }

    ItemManager.setExternalItemProvider(() => this.contentStore.getAllModItems());
    CraftingManager.setExternalRecipeProvider(() =>
      this.contentStore.getAllModRecipes(),
    );
    setExternalBlueprintProvider(() => this.contentStore.getAllModBlueprints());
    WeaponRegistry.setExternalWeaponProvider((weaponId) =>
      this.contentStore.getModWeaponStats(weaponId),
    );
    AudioManager.setExternalModSoundProvider((soundId) =>
      this.contentStore.getModSound(soundId),
    );
    setExternalWoa3dModelProvider((modelRef) =>
      this.contentStore.getModModel(modelRef),
    );

    this.snapshot = {
      initialized: false,
      scanning: false,
      modsDir: '',
      writable: false,
      platform: this.storage.getPlatform(),
      gameVersion: CURRENT_GAME_VERSION,
      modApiVersion: MOD_API_VERSION,
      schemaVersion: MOD_CONTENT_SCHEMA_VERSION,
      mods: [],
      activeModIds: [],
      loadOrder: [],
      logs: [],
      lastScanAtMs: null,
      reloadedAtMs: null,
      lastError: null,
      installProgress: null,
    };
  }

  public static getInstance(): ModManager {
    if (!ModManager.instance) {
      ModManager.instance = new ModManager();
    }
    return ModManager.instance;
  }

  public getSnapshot(): ModsSnapshot {
    return this.snapshot;
  }

  public getContentStore(): DefaultModContentStore {
    return this.contentStore;
  }

  public getContentRegistry<K extends keyof ModContentRegistryMap>(
    type: K,
  ): ModContentRegistryMap[K] {
    return this.contentStore.getRegistry(type);
  }

  public getAssetResolver(): ModAssetResolver {
    return this.assetResolver;
  }

  public async resolveAssetDataUrl(canonicalRef: string): Promise<string | null> {
    return this.assetResolver.resolveDataUrl(canonicalRef);
  }

  public getActiveWorldModMetadata(): WorldModMetadataSnapshot {
    if (this.worldModScope) {
      return captureWorldModMetadata(this.snapshot, {
        selectionMode: this.worldModScope.selectionMode,
        configuredEntries: this.worldModScope.selectedMods,
        gameVersion: CURRENT_GAME_VERSION,
      });
    }
    return captureWorldModMetadata(this.snapshot, CURRENT_GAME_VERSION);
  }

  public evaluateSaveCompatibility(
    saveModMeta: WorldModMetadataSnapshot | undefined,
  ): ModCompatibilityEvaluation {
    return evaluateSaveModCompatibility(saveModMeta, this.snapshot);
  }

  public inspectSaveMods(saveData: SaveGameData): WorldModInspectionResult {
    return inspectWorldSaveMods(saveData, this.snapshot);
  }

  public async applyWorldModSelection(selection: {
    selectionMode: 'vanilla' | 'custom';
    selectedMods?: WorldModSelectionEntry[];
  }): Promise<ModsSnapshot> {
    await this.initialize();
    this.worldModScope = {
      selectionMode: selection.selectionMode,
      selectedMods: [...(selection.selectedMods ?? [])].sort(
        (a, b) => a.loadOrder - b.loadOrder || a.modId.localeCompare(b.modId),
      ),
    };
    return this.refreshMods();
  }

  public async clearWorldModScope(): Promise<ModsSnapshot> {
    if (!this.worldModScope) {
      return this.snapshot;
    }
    this.worldModScope = null;
    await this.initialize();
    return this.refreshMods();
  }

  public evaluateMultiplayerCompatibility(
    mode: 'singleplayer' | 'lan' | 'online',
    remoteMeta: WorldModMetadataSnapshot | undefined,
  ): ModCompatibilityEvaluation {
    return evaluateMultiplayerModCompatibility(mode, remoteMeta, this.snapshot);
  }

  /**
   * Aligns local active mods to match a remote multiplayer host when all required mods are installed locally:
   * - Enables all host `required` mods that are already discovered locally.
   * - Disables local active `required` gameplay mods not present on the host.
   * - Preserves `client_only` cosmetic mods.
   */
  public async applyMultiplayerModPreset(
    remoteMeta: WorldModMetadataSnapshot | undefined,
  ): Promise<ModsSnapshot> {
    await this.initialize();
    const remoteMods = remoteMeta?.mods ?? [];
    const requiredHostIds = new Set(
      remoteMods
        .filter((m) => (m.multiplayerCompatibility ?? 'required') !== 'client_only')
        .map((m) => m.modId),
    );

    const nextEnabled: Record<string, boolean> = {
      ...this.stateConfig.enabledByModId,
    };

    for (const rec of this.snapshot.mods) {
      const modId = rec.manifest.modId;
      if (requiredHostIds.has(modId)) {
        nextEnabled[modId] = true;
        continue;
      }
      const isClientOnly =
        rec.manifest.multiplayerCompatibility === 'client_only' ||
        (rec.parsedContentFiles.length === 0 && rec.assets.length === 0) ||
        (rec.parsedContentFiles.every((f) =>
          ['textures', 'sounds', 'music', 'localization', 'assets', 'models'].includes(
            f.category.toLowerCase(),
          ),
        ) &&
          rec.assets.every((a) =>
            ['textures', 'sounds', 'music', 'localization', 'assets', 'models'].includes(
              a.category.toLowerCase(),
            ),
          ));

      if (!isClientOnly && (nextEnabled[modId] ?? true)) {
        nextEnabled[modId] = false;
      }
    }

    this.stateConfig = {
      ...this.stateConfig,
      enabledByModId: nextEnabled,
    };
    await this.storage.writeState(this.stateConfig);
    this.appendLog('info', 'Aligned local active mods to multiplayer host preset.');
    return this.refreshMods();
  }

  public subscribe(listener: (snap: ModsSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public registerCustomHandler(handler: ModContentHandler): void {
    this.registry.registerHandler(handler);
  }

  public resolveLocalizationOverride(lang: string, key: string): string | undefined {
    return this.contentStore.resolveLocalization(lang, key);
  }

  public getModDescriptors(category: string) {
    return this.contentStore.getDescriptors(category);
  }

  public getAllModSpawnRules(): ModSpawnDefinition[] {
    return this.contentStore.getAllModSpawns();
  }

  public getModSpawnRules(modId: string): ModSpawnDefinition[] {
    return this.contentStore.getModSpawnsForMod(modId);
  }

  public resolveContentForSpawn(spawn: ModSpawnDefinition) {
    return this.contentStore.resolveContentForSpawn(spawn);
  }

  public setRuntimeSpawnDiagnostics(entries: ModSpawnDiagnosticEntry[]): void {
    const signature = entries
      .map(
        (e) =>
          `${e.modId}:${e.spawnId}:${e.status}:${e.instanceCount}:${e.saved ? 1 : 0}:${e.errorCode ?? ''}:${e.failedCondition ?? ''}:${
            e.resolvedCoords
              ? `${e.resolvedCoords.x.toFixed(2)},${e.resolvedCoords.y.toFixed(2)},${e.resolvedCoords.z.toFixed(2)}`
              : ''
          }`,
      )
      .join('|');
    this.runtimeSpawnDiagnostics = entries.map((e) => ({
      ...e,
      configuredCoords: { ...e.configuredCoords },
      resolvedCoords: e.resolvedCoords ? { ...e.resolvedCoords } : null,
      rotation: { ...e.rotation },
      scale: { ...e.scale },
    }));
    if (signature !== this.runtimeSpawnDiagSignature) {
      this.runtimeSpawnDiagSignature = signature;
      if (this.listeners.size > 0) {
        this.emit();
      }
    }
  }

  public clearRuntimeSpawnDiagnostics(): void {
    this.runtimeSpawnDiagnostics = [];
    this.runtimeSpawnDiagSignature = '';
  }

  public getSpawnDiagnostics(modId?: string): ModSpawnDiagnosticEntry[] {
    if (this.runtimeSpawnDiagnostics.length > 0) {
      return modId
        ? this.runtimeSpawnDiagnostics.filter((d) => d.modId === modId)
        : this.runtimeSpawnDiagnostics;
    }
    const rules = modId ? this.getModSpawnRules(modId) : this.getAllModSpawnRules();
    return rules.map((r) => ({
      modId: r.modId,
      contentId: r.contentId,
      spawnId: r.spawnId,
      contentType: r.contentType,
      mode: r.unsupportedMode ?? r.mode,
      configuredCoords: { ...r.position },
      resolvedCoords: null,
      rotation: { ...r.rotation },
      scale: { ...r.scale },
      status: r.validationError ? 'failed' : !r.enabled ? 'disabled' : 'pending_condition',
      targetChunk: null,
      alreadySpawned: false,
      saved: false,
      instanceCount: 0,
      ...(r.validationError
        ? { errorCode: r.validationError.code, error: r.validationError.message }
        : {}),
    }));
  }

  public getAllModEvents(): ModEventDefinition[] {
    return this.contentStore.getAllModEvents();
  }

  public getModEvents(modId: string): ModEventDefinition[] {
    return this.contentStore.getModEventsForMod(modId);
  }

  public setRuntimeEventDiagnostics(entries: ModEventDiagnosticEntry[]): void {
    const signature = entries
      .map(
        (e) =>
          `${e.fullId}:${e.status}:${e.executionCount}:${e.lastTriggeredAt ?? 0}:${e.lastExecutedAt ?? 0}:${e.failedReason ?? ''}:${e.errorCode ?? ''}`,
      )
      .join('|');
    this.runtimeEventDiagnostics = entries.map((e) => ({ ...e }));
    if (signature !== this.runtimeEventDiagSignature) {
      this.runtimeEventDiagSignature = signature;
      if (this.listeners.size > 0) {
        this.emit();
      }
    }
  }

  public clearRuntimeEventDiagnostics(): void {
    this.runtimeEventDiagnostics = [];
    this.runtimeEventDiagSignature = '';
  }

  public getEventDiagnostics(modId?: string): ModEventDiagnosticEntry[] {
    if (this.runtimeEventDiagnostics.length > 0) {
      return modId
        ? this.runtimeEventDiagnostics.filter((d) => d.modId === modId)
        : this.runtimeEventDiagnostics;
    }
    const defs = modId ? this.getModEvents(modId) : this.getAllModEvents();
    return defs.map((ev) => ({
      modId: ev.modId,
      eventId: ev.eventId,
      fullId: ev.id,
      triggerType: ev.trigger.type,
      executionMode: ev.executionMode,
      status: ev.validationError ? 'failed' : !ev.enabled ? 'disabled' : 'registered',
      executionCount: 0,
      ...(ev.validationError
        ? { errorCode: ev.validationError.code, error: ev.validationError.message }
        : {}),
    }));
  }

  public appendRuntimeEventLog(
    level: ModLogLevel,
    message: string,
    modId?: string,
  ): void {
    this.appendLog(level, message, modId);
    if (this.listeners.size > 0) {
      this.emit();
    }
  }

  private buildEventCrossReferenceResolvers(): ModEventCrossReferenceResolvers {
    return {
      hasItemOrWeapon: (itemId: string) =>
        CORE_ITEM_IDS.has(itemId) ||
        Boolean(this.contentStore.getItemDefinition(itemId)) ||
        Boolean(this.contentStore.getModWeaponStats(itemId)),
      hasRecipe: (recipeId: string) =>
        CORE_RECIPE_IDS.has(recipeId) ||
        this.contentStore.registries.recipes.has(recipeId),
      hasQuest: (questId: string) =>
        CORE_QUEST_IDS.has(questId) ||
        this.contentStore.registries.quests.has(questId),
      hasSound: (soundId: string) =>
        soundId in AUDIO_CUE_REGISTRY ||
        Boolean(this.contentStore.getModSound(soundId)),
      hasEntityOrBlueprint: (contentId: string) =>
        CORE_BLUEPRINT_IDS.has(contentId) ||
        CORE_PROTECTED_IDS.has(contentId) ||
        Boolean(this.contentStore.getBlueprint(contentId)) ||
        Boolean(this.contentStore.getEntityDescriptor('monsters', contentId)) ||
        Boolean(this.contentStore.getEntityDescriptor('animals', contentId)) ||
        Boolean(this.contentStore.getEntityDescriptor('npcs', contentId)) ||
        Boolean(this.contentStore.getEntityDescriptor('characters', contentId)),
    };
  }

  public async initialize(): Promise<ModsSnapshot> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const info = await this.storage.getModsInfo();
      this.stateConfig = await this.storage.readState();
      this.snapshot = {
        ...this.snapshot,
        modsDir: info.modsDir,
        writable: info.writable,
        platform: info.platform,
        lastError: info.error ?? null,
      };
      const result = await this.refreshMods();
      this.snapshot = {
        ...this.snapshot,
        initialized: true,
      };
      this.emit();
      return result;
    })();
    return this.initPromise;
  }

  public async refreshMods(): Promise<ModsSnapshot> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      this.snapshot = {
        ...this.snapshot,
        scanning: true,
        lastError: null,
      };
      this.emit();

      try {
        const info = await this.storage.getModsInfo();
        const discovered = await this.storage.discoverRawMods();

        // Safely unload all active mod content before rebuilding state cleanly
        this.unloadAllActiveModsInternal(false);

        const effectiveStateConfig: ModStateConfig = (() => {
          if (!this.worldModScope) {
            return this.stateConfig;
          }
          const scopedEnabled: Record<string, boolean> = {};
          const scopedPriority: Record<string, number> = {
            ...this.stateConfig.priorityByModId,
          };
          for (const rawEntry of discovered.entries) {
            if (rawEntry.manifestRaw) {
              try {
                const parsed = JSON.parse(rawEntry.manifestRaw) as { modId?: unknown };
                if (typeof parsed.modId === 'string' && parsed.modId.trim()) {
                  scopedEnabled[parsed.modId.trim()] = false;
                }
              } catch {
                // ignore
              }
            }
          }
          if (this.worldModScope.selectionMode === 'custom') {
            for (const sel of this.worldModScope.selectedMods) {
              scopedEnabled[sel.modId] = sel.enabled;
              scopedPriority[sel.modId] = sel.loadOrder;
            }
          }
          return {
            version: this.stateConfig.version,
            enabledByModId: scopedEnabled,
            priorityByModId: scopedPriority,
          };
        })();

        const { records, loadOrder } = validateDiscoveredMods(
          discovered.entries,
          effectiveStateConfig,
          CURRENT_GAME_VERSION,
        );

        const recordByModId = new Map<string, ModRecord>();
        for (const rec of records) {
          if (rec.status === 'ready') {
            recordByModId.set(rec.manifest.modId, rec);
          } else {
            this.logRecordIssues(rec);
          }
        }

        const activeModIds: string[] = [];
        for (const modId of loadOrder) {
          const rec = recordByModId.get(modId);
          if (!rec) continue;

          this.assetResolver.setModAssets(modId, rec.sourceId, rec.assets);

          const loadRes = this.registry.loadMod({
            modId,
            sourceId: rec.sourceId,
            manifest: rec.manifest,
            files: rec.parsedContentFiles,
            assets: rec.assets,
          });
          rec.diagnostics.push(...loadRes.diagnostics);

          if (loadRes.ok) {
            const spawnDiags = this.contentStore.validateSpawnsForMod(modId, rec.assets);
            if (spawnDiags.length > 0) {
              rec.diagnostics.push(...spawnDiags);
              for (const sd of spawnDiags) {
                if (sd.severity === 'error' || sd.severity === 'warning') {
                  this.appendLog('warn', sd.message, modId, rec.sourceId);
                }
              }
            }
          }

          if (!loadRes.ok) {
            this.assetResolver.removeModAssets(modId);
            rec.loaded = false;
            rec.loadedEntriesCount = 0;
            rec.status = 'corrupted';
            this.appendLog(
              'error',
              `Mod "${rec.manifest.name}" (${modId}) rolled back due to content errors.`,
              modId,
              rec.sourceId,
            );
          } else {
            rec.loaded = true;
            rec.loadedEntriesCount = loadRes.loadedEntries;
            activeModIds.push(modId);
            this.appendLog(
              'info',
              `Loaded mod "${rec.manifest.name}" v${rec.manifest.version} (${loadRes.loadedEntries} entries, ${rec.assets.length} assets).`,
              modId,
              rec.sourceId,
            );
          }
        }

        const eventResolvers = this.buildEventCrossReferenceResolvers();
        for (const modId of activeModIds) {
          const rec = recordByModId.get(modId);
          if (!rec) continue;
          const eventDiags = this.contentStore.validateEventsForMod(modId, eventResolvers);
          if (eventDiags.length > 0) {
            rec.diagnostics.push(...eventDiags);
            for (const ed of eventDiags) {
              if (ed.severity === 'error' || ed.severity === 'warning') {
                this.appendLog('warn', ed.message, modId, rec.sourceId);
              }
            }
          }
        }

        this.snapshot = {
          ...this.snapshot,
          initialized: true,
          scanning: false,
          modsDir: discovered.modsDir || info.modsDir,
          writable: info.writable,
          platform: info.platform,
          mods: records,
          activeModIds,
          loadOrder: activeModIds,
          lastScanAtMs: Date.now(),
          lastError: discovered.ok ? null : (discovered.error ?? 'MOD_SCAN_FAILED'),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'MOD_REFRESH_FAILED';
        this.appendLog('error', `Mod scan error: ${msg}`);
        this.snapshot = {
          ...this.snapshot,
          initialized: true,
          scanning: false,
          lastError: msg,
        };
      } finally {
        this.refreshPromise = null;
        this.emit();
      }

      return this.snapshot;
    })();

    return this.refreshPromise;
  }

  public async setModEnabled(modId: string, enabled: boolean): Promise<ModsSnapshot> {
    this.stateConfig = {
      ...this.stateConfig,
      enabledByModId: {
        ...this.stateConfig.enabledByModId,
        [modId]: enabled,
      },
    };
    await this.storage.writeState(this.stateConfig);
    this.appendLog(
      'info',
      `${enabled ? 'Enabled' : 'Disabled'} mod "${modId}".`,
      modId,
    );
    return this.refreshMods();
  }

  public async setModPriority(modId: string, priority: number): Promise<ModsSnapshot> {
    const cleanPriority = Number.isFinite(priority) ? Math.trunc(priority) : 0;
    this.stateConfig = {
      ...this.stateConfig,
      priorityByModId: {
        ...this.stateConfig.priorityByModId,
        [modId]: cleanPriority,
      },
    };
    await this.storage.writeState(this.stateConfig);
    this.appendLog(
      'info',
      `Updated load priority for "${modId}" to ${cleanPriority}.`,
      modId,
    );
    return this.refreshMods();
  }

  public async removeMod(
    sourceId: string,
    modId?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (modId) {
      this.assetResolver.removeModAssets(modId);
      this.registry.unloadMod(modId);
      const nextEnabled = { ...this.stateConfig.enabledByModId };
      const nextPriority = { ...this.stateConfig.priorityByModId };
      delete nextEnabled[modId];
      delete nextPriority[modId];
      this.stateConfig = {
        ...this.stateConfig,
        enabledByModId: nextEnabled,
        priorityByModId: nextPriority,
      };
      await this.storage.writeState(this.stateConfig);
    }

    const res = await this.storage.deleteMod(sourceId);
    if (res.ok) {
      this.appendLog(
        'info',
        `Removed local mod "${sourceId}".`,
        modId,
        sourceId,
      );
      await this.refreshMods();
    } else {
      this.appendLog(
        'error',
        `Failed removing "${sourceId}": ${res.error ?? 'UNKNOWN_ERROR'}`,
        modId,
        sourceId,
      );
      this.emit();
    }
    return res;
  }

  public hasNativeModPicker(): boolean {
    return this.storage.hasNativeModPicker();
  }

  public async reloadMods(): Promise<{
    snapshot: ModsSnapshot;
    reloadedCount: number;
    issueCount: number;
  }> {
    this.unloadAllActiveModsInternal(false);
    const snap = await this.refreshMods();
    const reloadedCount = snap.activeModIds.length;
    const issueCount = snap.mods.filter(
      (m) => m.status !== 'ready' && m.status !== 'disabled',
    ).length;
    this.appendLog(
      'info',
      `Reloaded ${reloadedCount} active mod(s)${issueCount > 0 ? ` (${issueCount} issue(s) skipped safely)` : ''}.`,
    );
    this.snapshot = {
      ...this.snapshot,
      reloadedAtMs: Date.now(),
    };
    this.emit();
    return {
      snapshot: this.snapshot,
      reloadedCount,
      issueCount,
    };
  }

  public setInstallProgress(progress: ModInstallProgress | null): void {
    this.snapshot = {
      ...this.snapshot,
      installProgress: progress,
    };
    this.emit();
  }

  public async importModViaNativePicker(): Promise<{
    ok: boolean;
    cancelled?: boolean;
    sourceId?: string;
    modId?: string;
    error?: string;
    detail?: string;
  }> {
    const res = await this.storage.requestNativeModImport((progress) => {
      this.setInstallProgress(progress);
    });
    if (res.cancelled) {
      this.setInstallProgress(null);
      return res;
    }
    if (res.ok) {
      this.setInstallProgress({
        active: true,
        fileName: res.sourceId ?? 'package.woamod',
        stage: 'finalizing',
        percent: 98,
        processedBytes: 0,
        totalBytes: 0,
      });
      this.appendLog(
        'info',
        `Installed .woamod package "${res.sourceId ?? 'package'}" safely.`,
        res.modId,
        res.sourceId,
      );
      await this.refreshMods();
      this.setInstallProgress({
        active: false,
        fileName: res.sourceId ?? 'package.woamod',
        stage: 'completed',
        percent: 100,
        processedBytes: 0,
        totalBytes: 0,
      });
      window.setTimeout(() => {
        if (this.snapshot.installProgress?.stage === 'completed') {
          this.setInstallProgress(null);
        }
      }, 2200);
    } else {
      this.setInstallProgress(null);
      this.appendLog(
        'error',
        `Mod import failed: ${res.error ?? 'MOD_IMPORT_FAILED'}${res.detail ? ` (${res.detail})` : ''}`,
      );
      this.emit();
    }
    return res;
  }

  public async importModPackage(
    file: File,
  ): Promise<{
    ok: boolean;
    sourceId?: string;
    modId?: string;
    error?: string;
    detail?: string;
  }> {
    this.setInstallProgress({
      active: true,
      fileName: file.name,
      stage: 'reading',
      percent: 1,
      processedBytes: 0,
      totalBytes: file.size || 0,
    });

    const res = await this.storage.importPackageFile(file, {
      existingMods: this.snapshot.mods,
      gameVersion: CURRENT_GAME_VERSION,
      onProgress: (progress) => {
        this.setInstallProgress(progress);
      },
    });

    if (res.ok) {
      this.appendLog(
        'info',
        `Installed .woamod package "${res.sourceId ?? file.name}".`,
        res.modId,
        res.sourceId,
      );
      await this.refreshMods();
      this.setInstallProgress({
        active: false,
        fileName: file.name,
        stage: 'completed',
        percent: 100,
        processedBytes: file.size || 0,
        totalBytes: file.size || 0,
      });
      window.setTimeout(() => {
        if (this.snapshot.installProgress?.stage === 'completed') {
          this.setInstallProgress(null);
        }
      }, 2200);
    } else {
      this.setInstallProgress(null);
      this.appendLog(
        'error',
        `Failed installing "${file.name}": ${res.error ?? 'IMPORT_ERROR'}${res.detail ? ` (${res.detail})` : ''}`,
      );
      this.emit();
    }
    return res;
  }

  public async readModAsset(
    sourceId: string,
    relativePath: string,
  ): Promise<ModAssetReadResult> {
    return this.storage.readAsset(sourceId, relativePath);
  }

  public async openModsFolder(): Promise<{ ok: boolean; error?: string }> {
    return this.storage.openModsFolder();
  }

  public clearLogs(): void {
    this.snapshot = {
      ...this.snapshot,
      logs: [],
    };
    this.emit();
  }

  private unloadAllActiveModsInternal(emitAfter: boolean): void {
    this.assetResolver.clear();
    this.registry.unloadAll();
    this.clearRuntimeSpawnDiagnostics();
    this.clearRuntimeEventDiagnostics();
    if (emitAfter) {
      this.snapshot = {
        ...this.snapshot,
        activeModIds: [],
        loadOrder: [],
      };
      this.emit();
    }
  }

  private logRecordIssues(rec: ModRecord): void {
    const firstError = rec.diagnostics.find((d) => d.severity === 'error');
    if (firstError) {
      this.appendLog(
        'warn',
        `Skipped "${rec.manifest.name}" (${rec.status}): ${firstError.message}`,
        rec.hasValidManifest ? rec.manifest.modId : undefined,
        rec.sourceId,
      );
    }
  }

  private appendLog(
    level: ModLogLevel,
    message: string,
    modId?: string,
    sourceId?: string,
  ): void {
    this.logCounter += 1;
    const entry: ModLogEntry = {
      id: `modlog-${Date.now()}-${this.logCounter}`,
      timestampMs: Date.now(),
      level,
      modId,
      sourceId,
      message,
    };
    const nextLogs = [entry, ...this.snapshot.logs].slice(0, MAX_LOG_ENTRIES);
    this.snapshot = {
      ...this.snapshot,
      logs: nextLogs,
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }
}

export function getModManager(): ModManager {
  return ModManager.getInstance();
}
