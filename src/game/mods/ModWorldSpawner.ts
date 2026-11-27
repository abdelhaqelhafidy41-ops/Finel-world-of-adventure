import type * as THREE from 'three';
import type {
  BiomeType,
  NpcDialogueChoice,
  NpcRole,
  NpcRoutinePeriod,
  WeatherState,
  WorldLandmark,
} from '../types';
import { WATER_LEVEL, getBiomeAt, groundHeightAt, seededRandom } from '../math/noise';
import { isWater } from '../world/WorldPlacementValidator';
import { worldToChunkCoords, toChunkKey } from '../world/ChunkManager';
import type { WorldInteractable } from '../world/WorldManager';
import type { BuildingManager } from '../building/BuildingManager';
import { getBlueprintById } from '../building/buildingCatalog';
import type { CombatManager } from '../combat/CombatManager';
import type { EnemyArchetypeId } from '../combat/combatTypes';
import type { NPCManager } from '../npc/NPCManager';
import type { NpcConfig } from '../npc/NPCBase';
import type { WildlifeManager } from '../wildlife/WildlifeManager';
import type { AnimalSpecies } from '../wildlife/wildlifeTypes';
import type {
  DialogueChoiceNode,
  DialogueEffect,
  DialogueNode,
  DialogueTree,
} from '../dialogue/dialogueTypes';
import type { QuestStatus } from '../quest/questTypes';
import type {
  SavedModSpawnInstanceState,
  SavedModSpawnState,
} from '../save/saveTypes';
import type { SyncedModSpawnEntry } from '../../../shared/multiplayerProtocol';
import type { ItemManager } from '../inventory/ItemManager';
import { ModManager } from './ModManager';
import { resolveModCrossReference } from './ModNamespaceRegistry';
import type {
  ModSpawnDefinition,
  ModSpawnDiagnosticEntry,
  ModSpawnVec3,
} from './ModSpawnConfig';
import { resolveExternalWoa3dModel } from './Woa3dModelBuilder';
import type { ModGenericEntityDescriptor } from './modTypes';

export interface ModWorldSpawnerDeps {
  modManager: ModManager;
  itemManager: ItemManager;
  buildings: BuildingManager;
  combat: CombatManager;
  npcs: NPCManager;
  wildlife: WildlifeManager;
  spawnPickup: (opts: {
    id: string;
    itemId: string;
    count: number;
    label: string;
    x: number;
    y: number;
    z: number;
    rotationX?: number;
    rotationY?: number;
    rotationZ?: number;
    scaleX?: number;
    scaleY?: number;
    scaleZ?: number;
    modelPath?: string;
    categoryHint?: string;
    chunkKey?: string;
    perPlayer?: boolean;
    respawnEnabled?: boolean;
    respawnDelaySec?: number;
    modId?: string;
    modSpawnId?: string;
    hoverBob?: boolean;
  }) => WorldInteractable;
  removePickup: (id: string) => void;
  restorePickup: (id: string) => boolean;
  getActiveChunkKeys: () => Set<string>;
  getLandmarks: () => ReadonlyArray<WorldLandmark>;
  getVillageAnchors: () => ReadonlyArray<{ id: string; name: string; x: number; y: number; z: number }>;
  getWorldSpawnPoint: () => { x: number; y: number; z: number };
  getPlayerPosition: () => THREE.Vector3 | { x: number; y: number; z: number };
  getWorldHours: () => number;
  getRoutinePeriod: () => NpcRoutinePeriod;
  getWeatherState: () => WeatherState;
  getQuestStatus: (questId: string) => QuestStatus;
  hasDialogueFlag: (flag: string) => boolean;
  getLocalPlayerId?: () => string;
}

interface PlannedInstance {
  instanceId: string;
  rule: ModSpawnDefinition;
  index: number;
  x: number;
  y: number;
  z: number;
  chunkKey: string;
  resolvedModelPath?: string;
  displayLabel: string;
}

interface RuleRuntimeState {
  rule: ModSpawnDefinition;
  planned: PlannedInstance[];
  errorCode?: string;
  errorMessage?: string;
  activeInstanceIds: Set<string>;
  lastDiagnosticStatus: ModSpawnDiagnosticEntry['status'];
  failedCondition?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === 'object' && !Array.isArray(v));
}

function hashSeed(input: string, baseSeed: number): number {
  let h = (2166136261 ^ (baseSeed | 0)) >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1337;
}

function normalizeNpcRole(raw: unknown): NpcRole {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  switch (s) {
    case 'elder':
    case 'guard':
    case 'merchant':
    case 'traveling_merchant':
    case 'blacksmith':
    case 'farmer':
    case 'hunter':
    case 'woodcutter':
    case 'carpenter':
    case 'villager':
      return s;
    default:
      return 'villager';
  }
}

function normalizeEnemyArchetype(raw: unknown): EnemyArchetypeId {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  switch (s) {
    case 'bandit_scout':
    case 'thorn_stalker':
    case 'stone_sentinel':
    case 'ancient_monster':
    case 'ancient_guardian':
      return s;
    case 'boss':
    case 'guardian':
      return 'ancient_guardian';
    case 'golem':
    case 'sentinel':
      return 'stone_sentinel';
    case 'stalker':
    case 'beast':
      return 'thorn_stalker';
    case 'monster':
      return 'ancient_monster';
    default:
      return 'bandit_scout';
  }
}

function normalizeAnimalSpecies(raw: unknown): AnimalSpecies {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  switch (s) {
    case 'deer':
    case 'rabbit':
    case 'wolf':
    case 'bear':
    case 'bird':
    case 'cow':
    case 'sheep':
    case 'chicken':
      return s;
    default:
      return 'deer';
  }
}

export class ModWorldSpawner {
  private readonly deps: ModWorldSpawnerDeps;
  private worldSeed = 1337;
  private lifecycle: 'new_world' | 'world_load' = 'new_world';
  private isRemoteClient = false;
  private elapsedSeconds = 0;

  private readonly ruleStates = new Map<string, RuleRuntimeState>();
  private readonly activeById = new Map<string, PlannedInstance>();
  private readonly collectedKeys = new Set<string>();
  private readonly perPlayerCollectedKeys = new Set<string>();
  private readonly oneTimeTriggeredKeys = new Set<string>();
  private readonly defeatedKeys = new Set<string>();
  private readonly respawnTimers = new Map<string, number>();
  private readonly areaEnteredRules = new Set<string>();
  private readonly persistedInstances = new Map<string, SavedModSpawnInstanceState>();
  private readonly hostSyncedEntries = new Map<string, SyncedModSpawnEntry>();

  constructor(deps: ModWorldSpawnerDeps) {
    this.deps = deps;
  }

  public reset(options?: {
    worldSeed?: number;
    lifecycle?: 'new_world' | 'world_load';
    isRemoteClient?: boolean;
  }): void {
    this.clearAllSpawnedEntities();
    this.ruleStates.clear();
    this.activeById.clear();
    this.collectedKeys.clear();
    this.perPlayerCollectedKeys.clear();
    this.oneTimeTriggeredKeys.clear();
    this.defeatedKeys.clear();
    this.respawnTimers.clear();
    this.areaEnteredRules.clear();
    this.persistedInstances.clear();
    this.hostSyncedEntries.clear();
    this.elapsedSeconds = 0;

    if (typeof options?.worldSeed === 'number' && Number.isFinite(options.worldSeed)) {
      this.worldSeed = options.worldSeed;
    }
    if (options?.lifecycle) {
      this.lifecycle = options.lifecycle;
    }
    if (typeof options?.isRemoteClient === 'boolean') {
      this.isRemoteClient = options.isRemoteClient;
    }
  }

  public clearAllSpawnedEntities(): void {
    for (const inst of this.activeById.values()) {
      this.despawnInstance(inst);
    }
    this.activeById.clear();
    for (const st of this.ruleStates.values()) {
      st.activeInstanceIds.clear();
    }
    this.deps.modManager.clearRuntimeSpawnDiagnostics();
  }

  public restoreSaveState(
    saveState: SavedModSpawnState | undefined,
    worldSeed: number,
  ): void {
    this.reset({
      worldSeed,
      lifecycle: 'world_load',
      isRemoteClient: false,
    });
    if (!saveState) return;
    for (const k of saveState.collectedKeys ?? []) {
      this.collectedKeys.add(k);
    }
    for (const k of saveState.perPlayerCollectedKeys ?? []) {
      this.perPlayerCollectedKeys.add(k);
    }
    for (const k of saveState.oneTimeTriggeredKeys ?? []) {
      this.oneTimeTriggeredKeys.add(k);
    }
    for (const k of saveState.defeatedKeys ?? []) {
      this.defeatedKeys.add(k);
    }
    for (const [k, v] of Object.entries(saveState.respawnTimers ?? {})) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        this.respawnTimers.set(k, v);
      }
    }
    for (const inst of saveState.instances ?? []) {
      if (inst?.instanceId) {
        this.persistedInstances.set(inst.instanceId, { ...inst });
      }
    }
  }

  public exportSaveState(): SavedModSpawnState {
    for (const inst of this.activeById.values()) {
      this.captureLiveEntityState(inst);
    }

    const instances: SavedModSpawnInstanceState[] = [];
    const seen = new Set<string>();

    for (const st of this.ruleStates.values()) {
      for (const p of st.planned) {
        const saved = this.persistedInstances.get(p.instanceId);
        const isActive = this.activeById.has(p.instanceId);
        const collected = this.isCollected(p.instanceId, p.rule.conditions.perPlayerPickup);
        const defeated = this.defeatedKeys.has(p.instanceId);
        const hasRespawn = this.respawnTimers.has(p.instanceId);
        if (!isActive && !saved && !collected && !defeated && !hasRespawn) {
          continue;
        }
        seen.add(p.instanceId);
        instances.push({
          instanceId: p.instanceId,
          modId: p.rule.modId,
          spawnId: p.rule.spawnId,
          contentId: p.rule.contentId,
          contentType: p.rule.contentType,
          x: saved?.x ?? p.x,
          y: saved?.y ?? p.y,
          z: saved?.z ?? p.z,
          rotationX: p.rule.rotation.x,
          rotationY: saved?.yaw ?? p.rule.rotation.y,
          rotationZ: p.rule.rotation.z,
          scaleX: p.rule.scale.x,
          scaleY: p.rule.scale.y,
          scaleZ: p.rule.scale.z,
          collected,
          defeated,
          ...(hasRespawn
            ? { respawnAtElapsed: this.respawnTimers.get(p.instanceId) }
            : {}),
          ...(saved?.yaw !== undefined ? { yaw: saved.yaw } : {}),
          ...(saved?.hp !== undefined ? { hp: saved.hp } : {}),
          ...(saved?.maxHealth !== undefined ? { maxHealth: saved.maxHealth } : {}),
          ...(saved?.isDead !== undefined ? { isDead: saved.isDead } : {}),
          ...(saved?.dialogueState !== undefined ? { dialogueState: saved.dialogueState } : {}),
          ...(saved?.questState !== undefined ? { questState: saved.questState } : {}),
          ...(saved?.health !== undefined ? { health: saved.health } : {}),
          ...(saved?.doorOpen !== undefined ? { doorOpen: saved.doorOpen } : {}),
        });
      }
    }

    for (const [id, inst] of this.persistedInstances.entries()) {
      if (!seen.has(id)) {
        instances.push({ ...inst });
      }
    }

    const respawnObj: Record<string, number> = {};
    this.respawnTimers.forEach((v, k) => {
      respawnObj[k] = v;
    });

    return {
      collectedKeys: Array.from(this.collectedKeys),
      perPlayerCollectedKeys: Array.from(this.perPlayerCollectedKeys),
      oneTimeTriggeredKeys: Array.from(this.oneTimeTriggeredKeys),
      defeatedKeys: Array.from(this.defeatedKeys),
      respawnTimers: respawnObj,
      instances,
    };
  }

  /**
   * Builds and plans all active mod spawn rules, then immediately materializes
   * rules whose conditions and loaded chunks are already satisfied.
   */
  public initializeForWorld(options?: {
    worldSeed?: number;
    lifecycle?: 'new_world' | 'world_load';
    isRemoteClient?: boolean;
  }): void {
    if (typeof options?.worldSeed === 'number' && Number.isFinite(options.worldSeed)) {
      this.worldSeed = options.worldSeed;
    }
    if (options?.lifecycle) {
      this.lifecycle = options.lifecycle;
    }
    if (typeof options?.isRemoteClient === 'boolean') {
      this.isRemoteClient = options.isRemoteClient;
    }

    if (this.isRemoteClient) {
      this.reconcileRemoteClientSpawns();
      return;
    }

    const rules = this.deps.modManager.getAllModSpawnRules();
    this.ruleStates.clear();

    // Two-pass planning so relative_to_reference can also resolve earlier/sibling mod spawns.
    const unresolvedRefRules: ModSpawnDefinition[] = [];
    for (const rule of rules) {
      if (rule.mode === 'relative_to_reference') {
        unresolvedRefRules.push(rule);
        continue;
      }
      this.planSingleRule(rule);
    }
    for (const rule of unresolvedRefRules) {
      this.planSingleRule(rule);
    }

    this.evaluateAndMaterialize(this.deps.getActiveChunkKeys());
    this.publishDiagnostics();
  }

  public onChunkActivated(chunkKey: string): void {
    if (this.isRemoteClient) {
      this.reconcileRemoteClientSpawns(chunkKey);
      return;
    }
    const activeChunks = this.deps.getActiveChunkKeys();
    activeChunks.add(chunkKey);
    this.evaluateAndMaterialize(activeChunks);
    this.publishDiagnostics();
  }

  public onChunkDeactivated(chunkKey: string): void {
    for (const inst of Array.from(this.activeById.values())) {
      if (inst.rule.conditions.onChunkLoad && inst.chunkKey === chunkKey) {
        this.despawnInstance(inst);
      }
    }
    this.publishDiagnostics();
  }

  public update(dt: number, elapsed: number): void {
    if (dt < 0) return;
    this.elapsedSeconds = elapsed;
    if (this.isRemoteClient) return;

    // 1. Check live monster / animal defeat states & start respawn timers if enabled
    for (const inst of Array.from(this.activeById.values())) {
      if (inst.rule.contentType === 'monster') {
        if (this.deps.combat.isEnemyBlueprintDefeated(inst.instanceId)) {
          this.defeatedKeys.add(inst.instanceId);
          this.activeById.delete(inst.instanceId);
          this.ruleStates.get(inst.rule.id)?.activeInstanceIds.delete(inst.instanceId);
          this.scheduleRespawnIfEnabled(inst);
        }
      } else if (inst.rule.contentType === 'animal') {
        const animal = this.deps.wildlife.animals.find((a) => a.id === inst.instanceId);
        if (!animal || animal.isDead) {
          this.defeatedKeys.add(inst.instanceId);
          this.deps.wildlife.removeModAnimal(inst.instanceId);
          this.activeById.delete(inst.instanceId);
          this.ruleStates.get(inst.rule.id)?.activeInstanceIds.delete(inst.instanceId);
          this.scheduleRespawnIfEnabled(inst);
        }
      }
    }

    // 2. Process expired respawn timers
    let respawnChanged = false;
    for (const [instanceId, readyAt] of Array.from(this.respawnTimers.entries())) {
      if (elapsed >= readyAt) {
        this.respawnTimers.delete(instanceId);
        this.collectedKeys.delete(instanceId);
        this.defeatedKeys.delete(instanceId);
        const perKey = this.perPlayerKey(instanceId);
        this.perPlayerCollectedKeys.delete(perKey);
        this.deps.restorePickup(instanceId);
        respawnChanged = true;
      }
    }

    // 3. Re-evaluate rules (handles conditional time/weather/quest/flag/areaEnter/distance spawns)
    const activeChunks = this.deps.getActiveChunkKeys();
    const changed = this.evaluateAndMaterialize(activeChunks);
    if (changed || respawnChanged) {
      this.publishDiagnostics();
    }
  }

  public handlePickupCollected(pickupId: string, pickerPlayerId?: string): boolean {
    const inst = this.activeById.get(pickupId) ?? this.findPlannedInstance(pickupId);
    if (!inst) return false;
    const isPerPlayer = inst.rule.conditions.perPlayerPickup;

    if (isPerPlayer) {
      const localId = pickerPlayerId ?? this.deps.getLocalPlayerId?.() ?? 'local';
      this.perPlayerCollectedKeys.add(this.perPlayerKey(pickupId, localId));
      // If collected by remote player in perPlayer mode, keep visible locally
      if (pickerPlayerId && pickerPlayerId !== (this.deps.getLocalPlayerId?.() ?? 'local')) {
        return true;
      }
    } else {
      this.collectedKeys.add(pickupId);
    }

    if (inst.rule.conditions.respawn.oneTime) {
      this.oneTimeTriggeredKeys.add(inst.rule.id);
    }
    this.activeById.delete(pickupId);
    this.ruleStates.get(inst.rule.id)?.activeInstanceIds.delete(pickupId);
    this.scheduleRespawnIfEnabled(inst);
    this.publishDiagnostics();
    return true;
  }

  public handleRemotePickupCollected(
    pickupId: string,
    pickerPlayerId: string,
    localPlayerId: string,
  ): void {
    const synced = this.hostSyncedEntries.get(pickupId);
    if (synced) {
      if (synced.perPlayer) {
        if (!synced.collectedByPlayers) synced.collectedByPlayers = [];
        if (!synced.collectedByPlayers.includes(pickerPlayerId)) {
          synced.collectedByPlayers.push(pickerPlayerId);
        }
        if (pickerPlayerId === localPlayerId) {
          this.perPlayerCollectedKeys.add(this.perPlayerKey(pickupId, localPlayerId));
          this.deps.removePickup(pickupId);
        }
      } else {
        synced.collected = true;
        this.collectedKeys.add(pickupId);
        this.deps.removePickup(pickupId);
      }
    }
    this.handlePickupCollected(pickupId, pickerPlayerId);
  }

  public exportSyncedSpawns(): SyncedModSpawnEntry[] {
    const out: SyncedModSpawnEntry[] = [];
    for (const st of this.ruleStates.values()) {
      for (const p of st.planned) {
        out.push({
          instanceId: p.instanceId,
          modId: p.rule.modId,
          spawnId: p.rule.spawnId,
          contentId: p.rule.contentId,
          contentType: p.rule.contentType,
          x: p.x,
          y: p.y,
          z: p.z,
          rotationX: p.rule.rotation.x,
          rotationY: p.rule.rotation.y,
          rotationZ: p.rule.rotation.z,
          scaleX: p.rule.scale.x,
          scaleY: p.rule.scale.y,
          scaleZ: p.rule.scale.z,
          ...(p.rule.conditions.perPlayerPickup ? { perPlayer: true } : {}),
          collected: this.collectedKeys.has(p.instanceId),
          defeated: this.defeatedKeys.has(p.instanceId),
          ...(p.resolvedModelPath ? { modelPath: p.resolvedModelPath } : {}),
          label: p.displayLabel,
        });
      }
    }
    return out;
  }

  public applyHostSyncedSpawns(
    entries: ReadonlyArray<SyncedModSpawnEntry>,
    localPlayerId?: string,
  ): void {
    this.isRemoteClient = true;
    this.clearAllSpawnedEntities();
    this.hostSyncedEntries.clear();
    const pid = localPlayerId ?? this.deps.getLocalPlayerId?.() ?? 'local';

    for (const entry of entries) {
      this.hostSyncedEntries.set(entry.instanceId, { ...entry });
      if (entry.collected && !entry.perPlayer) {
        this.collectedKeys.add(entry.instanceId);
      }
      if (entry.defeated) {
        this.defeatedKeys.add(entry.instanceId);
      }
      if (entry.collectedByPlayers?.includes(pid)) {
        this.perPlayerCollectedKeys.add(this.perPlayerKey(entry.instanceId, pid));
      }
    }

    this.reconcileRemoteClientSpawns();
    this.publishSyncedDiagnostics(entries);
  }

  private reconcileRemoteClientSpawns(onlyChunkKey?: string): void {
    const activeChunks = this.deps.getActiveChunkKeys();
    const localPid = this.deps.getLocalPlayerId?.() ?? 'local';
    const rulesByKey = new Map<string, ModSpawnDefinition>();
    for (const r of this.deps.modManager.getAllModSpawnRules()) {
      rulesByKey.set(`${r.modId}:${r.spawnId}`, r);
    }

    for (const entry of this.hostSyncedEntries.values()) {
      const c = worldToChunkCoords(entry.x, entry.z, 120);
      const chunkKey = toChunkKey(c.cx, c.cz);
      if (onlyChunkKey && chunkKey !== onlyChunkKey) continue;
      if (!activeChunks.has(chunkKey)) continue;

      if (entry.defeated) continue;
      if (entry.perPlayer) {
        if (this.perPlayerCollectedKeys.has(this.perPlayerKey(entry.instanceId, localPid))) {
          continue;
        }
      } else if (entry.collected || this.collectedKeys.has(entry.instanceId)) {
        continue;
      }

      if (this.activeById.has(entry.instanceId)) continue;

      const matchedRule = rulesByKey.get(`${entry.modId}:${entry.spawnId}`);
      const rule: ModSpawnDefinition = matchedRule ?? {
        id: `${entry.modId}:spawn:${entry.spawnId}`,
        spawnId: entry.spawnId,
        modId: entry.modId,
        contentId: entry.contentId,
        contentType: entry.contentType as ModSpawnDefinition['contentType'],
        sourceFile: 'host-sync',
        enabled: true,
        mode: 'absolute',
        position: { x: entry.x, y: entry.y, z: entry.z },
        hasExplicitY: true,
        rotation: { x: entry.rotationX, y: entry.rotationY, z: entry.rotationZ },
        rotationUnit: 'radians',
        scale: { x: entry.scaleX, y: entry.scaleY, z: entry.scaleZ },
        quantity: 1,
        conditions: {
          onNewWorld: true,
          onWorldLoad: true,
          onChunkLoad: true,
          onAreaEnter: false,
          maxActiveInstances: 1,
          respawn: { enabled: false, delaySeconds: 0, oneTime: true },
          perPlayerPickup: Boolean(entry.perPlayer),
        },
        raw: {},
      };

      const planned: PlannedInstance = {
        instanceId: entry.instanceId,
        rule,
        index: 0,
        x: entry.x,
        y: entry.y,
        z: entry.z,
        chunkKey,
        resolvedModelPath: entry.modelPath,
        displayLabel: entry.label ?? entry.contentId,
      };
      this.spawnInstance(planned);
    }
  }

  private planSingleRule(rule: ModSpawnDefinition): void {
    const state: RuleRuntimeState = {
      rule,
      planned: [],
      activeInstanceIds: new Set(),
      lastDiagnosticStatus: rule.validationError
        ? 'failed'
        : !rule.enabled
          ? 'disabled'
          : 'pending_condition',
    };
    this.ruleStates.set(rule.id, state);

    if (!rule.enabled) {
      state.lastDiagnosticStatus = 'disabled';
      return;
    }

    if (rule.validationError) {
      state.errorCode = rule.validationError.code;
      state.errorMessage = rule.validationError.message;
      state.lastDiagnosticStatus = 'failed';
      return;
    }

    const content = this.deps.modManager.resolveContentForSpawn(rule);
    if (!content.found) {
      state.errorCode = 'SPAWN_CONTENT_NOT_REGISTERED';
      state.errorMessage = `Content "${rule.contentId}" (${rule.contentType}) is not registered.`;
      state.lastDiagnosticStatus = 'failed';
      return;
    }

    if (content.modelPath) {
      const model = resolveExternalWoa3dModel(content.modelPath);
      if (!model) {
        state.errorCode = 'SPAWN_MODEL_MISSING';
        state.errorMessage = `Model "${content.modelPath}" for "${rule.contentId}" could not be loaded.`;
        state.lastDiagnosticStatus = 'failed';
        return;
      }
    }

    const displayLabel =
      content.item?.name ??
      content.blueprint?.nameEn ??
      content.entity?.name ??
      rule.contentId;

    const coordsRes = this.resolveRuleCoordinates(rule);
    if (!coordsRes.ok) {
      state.errorCode = coordsRes.code;
      state.errorMessage = coordsRes.message;
      state.lastDiagnosticStatus = 'failed';
      return;
    }

    const plannedList: PlannedInstance[] = [];
    const isStructureRule = rule.contentType === 'building' || rule.contentType === 'decoration';
    const structureBp = isStructureRule ? getBlueprintById(rule.contentId) : undefined;
    const allowWater = rule.raw.allowWater === true;
    const allowOverlap = rule.raw.allowOverlap === true;

    for (let i = 0; i < coordsRes.points.length; i++) {
      const pt = coordsRes.points[i];
      const instanceId = `${rule.id}#${i}`;
      const persisted = this.persistedInstances.get(instanceId);
      const finalPt = persisted ? { x: persisted.x, y: persisted.y, z: persisted.z } : pt;

      if (isStructureRule && structureBp && !persisted) {
        if (!allowWater) {
          const groundH = groundHeightAt(finalPt.x, finalPt.z);
          if (
            isWater(finalPt.x, finalPt.z, groundH) &&
            (!rule.hasExplicitY || finalPt.y <= WATER_LEVEL + 0.05)
          ) {
            state.errorCode = 'SPAWN_PLACEMENT_IN_WATER';
            state.errorMessage = `Structure "${rule.contentId}" at (${finalPt.x.toFixed(2)}, ${finalPt.y.toFixed(2)}, ${finalPt.z.toFixed(2)}) cannot be placed in water.`;
            state.lastDiagnosticStatus = 'failed';
            return;
          }
        }
        if (!allowOverlap) {
          const myHalfW = Math.max(0.4, structureBp.width * 0.5 * Math.abs(rule.scale.x));
          const myHalfD = Math.max(0.4, structureBp.depth * 0.5 * Math.abs(rule.scale.z));
          const myH = Math.max(0.5, structureBp.height * Math.abs(rule.scale.y));
          const overlapsStructure = (
            ox: number,
            oy: number,
            oz: number,
            ohw: number,
            ohd: number,
            oh: number,
          ): boolean => {
            const dx = Math.abs(finalPt.x - ox);
            const dz = Math.abs(finalPt.z - oz);
            const yOverlap = finalPt.y < oy + oh - 0.1 && finalPt.y + myH > oy + 0.1;
            return yOverlap && dx < (myHalfW + ohw) * 0.85 && dz < (myHalfD + ohd) * 0.85;
          };

          for (const existing of this.deps.buildings.getAllStructures()) {
            if (existing.id === instanceId) continue;
            const otherBp = getBlueprintById(existing.blueprintId);
            const ohw = Math.max(0.4, (otherBp?.width ?? 2) * 0.5 * Math.abs(existing.scaleX ?? 1));
            const ohd = Math.max(0.4, (otherBp?.depth ?? 2) * 0.5 * Math.abs(existing.scaleZ ?? 1));
            const oh = Math.max(0.5, (otherBp?.height ?? 2) * Math.abs(existing.scaleY ?? 1));
            if (overlapsStructure(existing.x, existing.y, existing.z, ohw, ohd, oh)) {
              state.errorCode = 'SPAWN_PLACEMENT_OVERLAP';
              state.errorMessage = `Structure "${rule.contentId}" overlaps existing structure "${existing.id}".`;
              state.lastDiagnosticStatus = 'failed';
              return;
            }
          }
          for (const otherState of this.ruleStates.values()) {
            if (otherState.rule.id === rule.id) continue;
            if (
              otherState.rule.contentType !== 'building' &&
              otherState.rule.contentType !== 'decoration'
            ) {
              continue;
            }
            const otherBp = getBlueprintById(otherState.rule.contentId);
            const ohw = Math.max(0.4, (otherBp?.width ?? 2) * 0.5 * Math.abs(otherState.rule.scale.x));
            const ohd = Math.max(0.4, (otherBp?.depth ?? 2) * 0.5 * Math.abs(otherState.rule.scale.z));
            const oh = Math.max(0.5, (otherBp?.height ?? 2) * Math.abs(otherState.rule.scale.y));
            for (const op of otherState.planned) {
              if (overlapsStructure(op.x, op.y, op.z, ohw, ohd, oh)) {
                state.errorCode = 'SPAWN_PLACEMENT_OVERLAP';
                state.errorMessage = `Structure "${rule.contentId}" overlaps planned structure "${op.instanceId}".`;
                state.lastDiagnosticStatus = 'failed';
                return;
              }
            }
          }
        }
      }

      const chunkCoords = worldToChunkCoords(finalPt.x, finalPt.z, 120);
      const chunkKey = toChunkKey(chunkCoords.cx, chunkCoords.cz);
      plannedList.push({
        instanceId,
        rule,
        index: i,
        x: finalPt.x,
        y: finalPt.y,
        z: finalPt.z,
        chunkKey,
        resolvedModelPath: content.modelPath,
        displayLabel,
      });
    }

    state.planned.push(...plannedList);
  }

  private resolveRuleCoordinates(rule: ModSpawnDefinition):
    | { ok: true; points: ModSpawnVec3[] }
    | { ok: false; code: string; message: string } {
    if (rule.unsupportedMode) {
      return {
        ok: false,
        code: 'UNSUPPORTED_SPAWN_MODE',
        message: `Unsupported spawn mode "${rule.unsupportedMode}".`,
      };
    }

    const quantity = Math.max(1, rule.quantity);

    if (rule.mode === 'absolute') {
      const x = rule.position.x;
      const z = rule.position.z;
      const y = rule.hasExplicitY ? rule.position.y! : groundHeightAt(x, z);
      const points: ModSpawnVec3[] = [];
      for (let i = 0; i < quantity; i++) {
        points.push({ x, y, z });
      }
      return { ok: true, points };
    }

    if (rule.mode === 'relative_to_world_spawn') {
      const spawn = this.deps.getWorldSpawnPoint();
      const x = spawn.x + rule.position.x;
      const z = spawn.z + rule.position.z;
      const y = rule.hasExplicitY ? spawn.y + rule.position.y! : groundHeightAt(x, z);
      const points: ModSpawnVec3[] = [];
      for (let i = 0; i < quantity; i++) {
        points.push({ x, y, z });
      }
      return { ok: true, points };
    }

    if (rule.mode === 'relative_to_reference') {
      const refPos = this.resolveReferenceObjectPosition(
        rule.referenceObjectId,
        rule.modId,
      );
      if (!refPos) {
        return {
          ok: false,
          code: 'MISSING_REFERENCE_OBJECT',
          message: `Reference object "${rule.referenceObjectId ?? ''}" could not be resolved in the world.`,
        };
      }
      const x = refPos.x + rule.position.x;
      const z = refPos.z + rule.position.z;
      const y = rule.hasExplicitY ? refPos.y + rule.position.y! : groundHeightAt(x, z);
      const points: ModSpawnVec3[] = [];
      for (let i = 0; i < quantity; i++) {
        points.push({ x, y, z });
      }
      return { ok: true, points };
    }

    if (rule.mode === 'random_in_area') {
      const area = rule.area;
      if (!area) {
        return {
          ok: false,
          code: 'INVALID_SPAWN_AREA',
          message: 'random_in_area spawn requires valid minX/maxX/minZ/maxZ area bounds.',
        };
      }

      const rand = seededRandom(
        hashSeed(`${rule.modId}:${rule.spawnId}`, area.seed ?? this.worldSeed),
      );
      const points: ModSpawnVec3[] = [];
      const maxAttempts = Math.max(24, area.quantity * 28);
      const minDistSq = area.minDistance * area.minDistance;

      for (let attempt = 0; attempt < maxAttempts && points.length < area.quantity; attempt++) {
        const px = area.minX + rand() * (area.maxX - area.minX);
        const pz = area.minZ + rand() * (area.maxZ - area.minZ);
        let tooClose = false;
        if (minDistSq > 0) {
          for (let j = 0; j < points.length; j++) {
            const dx = points[j].x - px;
            const dz = points[j].z - pz;
            if (dx * dx + dz * dz < minDistSq) {
              tooClose = true;
              break;
            }
          }
        }
        if (tooClose) continue;

        let py: number;
        if (rule.hasExplicitY) {
          py = rule.position.y!;
        } else if (area.minY !== undefined && area.maxY !== undefined) {
          const lo = Math.min(area.minY, area.maxY);
          const hi = Math.max(area.minY, area.maxY);
          py = lo + rand() * (hi - lo);
        } else {
          py = groundHeightAt(px, pz);
        }
        points.push({ x: px, y: py, z: pz });
      }

      if (points.length === 0) {
        return {
          ok: false,
          code: 'SPAWN_AREA_PLACEMENT_FAILED',
          message: `Could not generate any valid coordinates within area [${area.minX}..${area.maxX}, ${area.minZ}..${area.maxZ}] with minDistance ${area.minDistance}.`,
        };
      }
      return { ok: true, points };
    }

    return {
      ok: false,
      code: 'UNSUPPORTED_SPAWN_MODE',
      message: `Unsupported spawn mode "${String(rule.mode)}".`,
    };
  }

  private resolveReferenceObjectPosition(
    refId: string | undefined,
    modId: string,
  ): { x: number; y: number; z: number } | null {
    if (!refId || !refId.trim()) return null;
    const raw = refId.trim();
    const namespaced = resolveModCrossReference(modId, raw);

    // 1. Villages
    for (const v of this.deps.getVillageAnchors()) {
      if (v.id === raw || v.id === namespaced || v.name.toLowerCase() === raw.toLowerCase()) {
        return { x: v.x, y: v.y, z: v.z };
      }
    }

    // 2. Landmarks
    for (const lm of this.deps.getLandmarks()) {
      if (lm.id === raw || lm.id === namespaced || lm.name.toLowerCase() === raw.toLowerCase()) {
        return { x: lm.x, y: groundHeightAt(lm.x, lm.z), z: lm.z };
      }
    }

    // 3. NPCs
    for (const npc of this.deps.npcs.npcs) {
      if (npc.id === raw || npc.id === namespaced || npc.name.toLowerCase() === raw.toLowerCase()) {
        return { x: npc.position.x, y: npc.position.y, z: npc.position.z };
      }
    }

    // 4. Built / Mod structures
    for (const st of this.deps.buildings.getAllStructures()) {
      if (st.id === raw || st.id === namespaced || st.blueprintId === raw || st.blueprintId === namespaced) {
        return { x: st.x, y: st.y, z: st.z };
      }
    }

    // 5. Previously planned mod spawn rules
    for (const st of this.ruleStates.values()) {
      if (
        (st.rule.spawnId === raw ||
          st.rule.id === raw ||
          st.rule.contentId === raw ||
          st.rule.contentId === namespaced) &&
        st.planned.length > 0
      ) {
        const first = st.planned[0];
        return { x: first.x, y: first.y, z: first.z };
      }
    }

    return null;
  }

  private evaluateAndMaterialize(activeChunks: Set<string>): boolean {
    let changed = false;

    for (const st of this.ruleStates.values()) {
      if (!st.rule.enabled) {
        st.lastDiagnosticStatus = 'disabled';
        continue;
      }
      if (st.errorCode) {
        st.lastDiagnosticStatus = 'failed';
        continue;
      }

      const cond = st.rule.conditions;

      // Lifecycle check: allow world_load restoration if instances were already persisted from new_world
      if (
        this.lifecycle === 'new_world' &&
        !cond.onNewWorld &&
        st.activeInstanceIds.size === 0
      ) {
        st.lastDiagnosticStatus = 'pending_condition';
        st.failedCondition = 'trigger:onNewWorld=false';
        continue;
      }
      const hasPersistedInstance = st.planned.some((p) => this.persistedInstances.has(p.instanceId));
      if (
        this.lifecycle === 'world_load' &&
        !cond.onWorldLoad &&
        !hasPersistedInstance &&
        st.activeInstanceIds.size === 0
      ) {
        st.lastDiagnosticStatus = 'pending_condition';
        st.failedCondition = 'trigger:onWorldLoad=false';
        continue;
      }

      // One-time completed check
      if (cond.respawn.oneTime && this.oneTimeTriggeredKeys.has(st.rule.id)) {
        if (st.planned.every((p) => this.isCollected(p.instanceId, cond.perPlayerPickup))) {
          st.lastDiagnosticStatus = 'collected';
          st.failedCondition = undefined;
          continue;
        }
        if (st.planned.every((p) => this.defeatedKeys.has(p.instanceId))) {
          st.lastDiagnosticStatus = 'defeated';
          st.failedCondition = undefined;
          continue;
        }
      }

      // Rule-level environmental/quest/flag conditions
      const condFail = this.checkRuleConditions(st.rule, st.planned[0]);
      if (condFail) {
        st.lastDiagnosticStatus = 'pending_condition';
        st.failedCondition = condFail;
        // Despawn transient conditional spawns if condition ceases to match
        if (
          cond.timeOfDay !== undefined ||
          cond.weather !== undefined ||
          cond.playerDistance !== undefined ||
          cond.requiredFlag !== undefined ||
          cond.forbiddenFlag !== undefined ||
          cond.questStatus !== undefined
        ) {
          for (const id of Array.from(st.activeInstanceIds)) {
            const inst = this.activeById.get(id);
            if (inst) {
              this.despawnInstance(inst);
              changed = true;
            }
          }
        }
        continue;
      }

      st.failedCondition = undefined;

      // Evaluate each planned instance for chunk readiness, spatial conditions, collection/defeat state, and caps
      let anySpawned = false;
      let anyPendingChunk = false;
      let anyCollected = false;
      let anyDefeated = false;
      let anyWaitingRespawn = false;
      let firstInstanceCondFail: string | undefined;

      for (const inst of st.planned) {
        if (this.isCollected(inst.instanceId, cond.perPlayerPickup)) {
          anyCollected = true;
          if (this.respawnTimers.has(inst.instanceId)) anyWaitingRespawn = true;
          continue;
        }
        if (this.defeatedKeys.has(inst.instanceId)) {
          anyDefeated = true;
          if (this.respawnTimers.has(inst.instanceId)) anyWaitingRespawn = true;
          continue;
        }

        const instCondFail = this.checkInstanceSpatialConditions(st.rule, inst);
        if (instCondFail) {
          if (!firstInstanceCondFail) firstInstanceCondFail = instCondFail;
          if (cond.playerDistance !== undefined && this.activeById.has(inst.instanceId)) {
            this.despawnInstance(inst);
            changed = true;
          }
          continue;
        }

        if (cond.onChunkLoad && !activeChunks.has(inst.chunkKey)) {
          anyPendingChunk = true;
          continue;
        }

        if (this.activeById.has(inst.instanceId)) {
          anySpawned = true;
          continue;
        }

        if (st.activeInstanceIds.size >= cond.maxActiveInstances) {
          continue;
        }

        if (this.spawnInstance(inst)) {
          anySpawned = true;
          changed = true;
        }
      }

      if (anySpawned || st.activeInstanceIds.size > 0) {
        st.lastDiagnosticStatus = 'spawned';
      } else if (anyWaitingRespawn) {
        st.lastDiagnosticStatus = 'waiting_respawn';
      } else if (anyPendingChunk) {
        st.lastDiagnosticStatus = 'pending_chunk';
      } else if (anyCollected) {
        st.lastDiagnosticStatus = 'collected';
      } else if (anyDefeated) {
        st.lastDiagnosticStatus = 'defeated';
      } else {
        st.lastDiagnosticStatus = 'pending_condition';
        if (firstInstanceCondFail) {
          st.failedCondition = firstInstanceCondFail;
        }
      }
    }

    return changed;
  }

  private checkRuleConditions(
    rule: ModSpawnDefinition,
    sampleInst?: PlannedInstance,
  ): string | undefined {
    const cond = rule.conditions;

    // timeOfDay
    if (cond.timeOfDay) {
      const hours = ((this.deps.getWorldHours() % 24) + 24) % 24;
      const period = this.deps.getRoutinePeriod();
      if (cond.timeOfDay.periods && cond.timeOfDay.periods.length > 0) {
        if (!cond.timeOfDay.periods.includes(period)) {
          return `timeOfDay.period (${period} not in [${cond.timeOfDay.periods.join(',')}])`;
        }
      }
      if (cond.timeOfDay.startHour !== undefined || cond.timeOfDay.endHour !== undefined) {
        const start = cond.timeOfDay.startHour ?? 0;
        const end = cond.timeOfDay.endHour ?? 24;
        const inRange = start <= end ? hours >= start && hours <= end : hours >= start || hours <= end;
        if (!inRange) {
          return `timeOfDay.hour (${hours.toFixed(1)}h not in ${start}..${end})`;
        }
      }
    }

    // weather
    if (cond.weather && cond.weather.length > 0) {
      const curWeather = this.deps.getWeatherState();
      if (!cond.weather.includes(curWeather)) {
        return `weather (${curWeather} not in [${cond.weather.join(',')}])`;
      }
    }

    // quest condition
    if (cond.questId) {
      const qStatus = this.deps.getQuestStatus(cond.questId);
      const allowed: QuestStatus[] = cond.questStatus ?? ['active', 'ready', 'completed'];
      if (!allowed.includes(qStatus)) {
        return `quest:${cond.questId} (${qStatus} not in [${allowed.join(',')}])`;
      }
    }

    // dialogue flags
    if (cond.requiredFlag && !this.deps.hasDialogueFlag(cond.requiredFlag)) {
      return `requiredFlag:${cond.requiredFlag}`;
    }
    if (cond.forbiddenFlag && this.deps.hasDialogueFlag(cond.forbiddenFlag)) {
      return `forbiddenFlag:${cond.forbiddenFlag}`;
    }

    // Fallback spatial check when planned list has a single entry (preserves existing rule-level behavior when areaEnter not triggered)
    if (!sampleInst && cond.onAreaEnter && !this.areaEnteredRules.has(rule.id)) {
      const playerPos = this.deps.getPlayerPosition();
      const radius = cond.areaEnterRadius ?? 28;
      const dist = Math.hypot(playerPos.x - rule.position.x, playerPos.z - rule.position.z);
      if (dist <= radius) {
        this.areaEnteredRules.add(rule.id);
      } else {
        return `onAreaEnter (${dist.toFixed(1)}m > ${radius}m)`;
      }
    }

    return undefined;
  }

  private checkInstanceSpatialConditions(
    rule: ModSpawnDefinition,
    inst: PlannedInstance,
  ): string | undefined {
    const cond = rule.conditions;
    const playerPos = this.deps.getPlayerPosition();

    // onAreaEnter
    if (cond.onAreaEnter && !this.areaEnteredRules.has(rule.id)) {
      const radius = cond.areaEnterRadius ?? 28;
      const dist = Math.hypot(playerPos.x - inst.x, playerPos.z - inst.z);
      if (dist <= radius) {
        this.areaEnteredRules.add(rule.id);
      } else {
        return `onAreaEnter (${dist.toFixed(1)}m > ${radius}m)`;
      }
    }

    // biomes
    if (cond.biomes && cond.biomes.length > 0) {
      const biome = getBiomeAt(inst.x, inst.z) as BiomeType;
      if (!cond.biomes.includes(biome)) {
        return `biome (${biome} not in [${cond.biomes.join(',')}])`;
      }
    }

    // playerDistance
    if (cond.playerDistance) {
      const dx = playerPos.x - inst.x;
      const dz = playerPos.z - inst.z;
      const dist = Math.hypot(dx, dz);
      if (cond.playerDistance.min !== undefined && dist < cond.playerDistance.min) {
        return `playerDistance (${dist.toFixed(1)}m < min ${cond.playerDistance.min}m)`;
      }
      if (cond.playerDistance.max !== undefined && dist > cond.playerDistance.max) {
        return `playerDistance (${dist.toFixed(1)}m > max ${cond.playerDistance.max}m)`;
      }
    }

    return undefined;
  }

  private spawnInstance(inst: PlannedInstance): boolean {
    const { rule } = inst;
    const type = rule.contentType;
    const saved = this.persistedInstances.get(inst.instanceId);
    const spawnX = saved?.x ?? inst.x;
    const spawnY = saved?.y ?? inst.y;
    const spawnZ = saved?.z ?? inst.z;
    inst.x = spawnX;
    inst.y = spawnY;
    inst.z = spawnZ;
    const cCoords = worldToChunkCoords(spawnX, spawnZ, 120);
    inst.chunkKey = toChunkKey(cCoords.cx, cCoords.cz);

    if (
      type === 'item' ||
      type === 'weapon' ||
      type === 'armor' ||
      type === 'tool' ||
      type === 'consumable' ||
      type === 'resource'
    ) {
      const itemDef = this.deps.itemManager.getItem(rule.contentId);
      const label = itemDef?.name ?? inst.displayLabel;
      const categoryHint =
        type === 'weapon'
          ? 'weapons'
          : type === 'tool'
            ? 'tools'
            : 'items';
      this.deps.spawnPickup({
        id: inst.instanceId,
        itemId: rule.contentId,
        count: 1,
        label,
        x: spawnX,
        y: spawnY,
        z: spawnZ,
        rotationX: rule.rotation.x,
        rotationY: saved?.yaw ?? rule.rotation.y,
        rotationZ: rule.rotation.z,
        scaleX: rule.scale.x,
        scaleY: rule.scale.y,
        scaleZ: rule.scale.z,
        modelPath: inst.resolvedModelPath ?? itemDef?.modelPath,
        categoryHint,
        chunkKey: inst.chunkKey,
        perPlayer: rule.conditions.perPlayerPickup,
        respawnEnabled: rule.conditions.respawn.enabled,
        respawnDelaySec: rule.conditions.respawn.delaySeconds,
        modId: rule.modId,
        modSpawnId: rule.spawnId,
        hoverBob: false,
      });
    } else if (type === 'building' || type === 'decoration') {
      const bp = getBlueprintById(rule.contentId);
      if (!bp) return false;
      this.deps.buildings.addOrUpdateStructure({
        id: inst.instanceId,
        blueprintId: bp.id,
        category: bp.category,
        tier: bp.tier,
        x: spawnX,
        y: spawnY,
        z: spawnZ,
        yaw: saved?.yaw ?? rule.rotation.y,
        rotationX: rule.rotation.x,
        rotationZ: rule.rotation.z,
        scaleX: rule.scale.x,
        scaleY: rule.scale.y,
        scaleZ: rule.scale.z,
        health: saved?.health ?? bp.maxHealth,
        maxHealth: bp.maxHealth,
        ...(saved?.doorOpen !== undefined ? { doorOpen: saved.doorOpen } : {}),
        ownerId: 'mod',
        ownerName: rule.modId,
        permission: 'everyone',
        createdAtMs: Date.now(),
        isModSpawn: true,
        modSpawnId: rule.spawnId,
        modId: rule.modId,
      });
    } else if (type === 'npc' || type === 'character') {
      const content = this.deps.modManager.resolveContentForSpawn(rule);
      const ent = content.entity;
      const cfg = this.buildNpcConfig(inst, ent);
      const npc = this.deps.npcs.spawnModNpc(cfg);
      if (saved) {
        npc.restoreModEntityState({
          yaw: saved.yaw,
          hp: saved.hp,
          maxHealth: saved.maxHealth,
          isDead: saved.isDead,
          dialogueState: saved.dialogueState,
        });
      }
    } else if (type === 'monster') {
      const content = this.deps.modManager.resolveContentForSpawn(rule);
      const raw = content.entity?.raw ?? {};
      const archetypeId = normalizeEnemyArchetype(raw.archetype ?? raw.template ?? rule.behavior);
      const customArchetype = {
        ...(typeof raw.name === 'string' && raw.name.trim() ? { name: raw.name.trim() } : {}),
        ...(typeof raw.nameAr === 'string' && raw.nameAr.trim() ? { nameAr: raw.nameAr.trim() } : {}),
        ...(typeof raw.maxHealth === 'number' && raw.maxHealth > 0 ? { maxHealth: raw.maxHealth } : {}),
        ...(typeof raw.hp === 'number' && raw.hp > 0 ? { maxHealth: raw.hp } : {}),
        ...(typeof raw.damage === 'number' && raw.damage > 0 ? { damage: raw.damage } : {}),
        ...(typeof raw.moveSpeed === 'number' && raw.moveSpeed > 0 ? { moveSpeed: raw.moveSpeed } : {}),
        ...(typeof raw.chaseSpeed === 'number' && raw.chaseSpeed > 0 ? { chaseSpeed: raw.chaseSpeed } : {}),
        ...(typeof raw.detectionRange === 'number' && raw.detectionRange > 0 ? { detectionRange: raw.detectionRange } : {}),
        ...(typeof raw.attackRange === 'number' && raw.attackRange > 0 ? { attackRange: raw.attackRange } : {}),
        ...(typeof raw.xpReward === 'number' && raw.xpReward >= 0 ? { xpReward: raw.xpReward } : {}),
        ...(typeof raw.coinReward === 'number' && raw.coinReward >= 0 ? { coinReward: raw.coinReward } : {}),
      };
      this.deps.combat.registerModEnemyBlueprint({
        id: inst.instanceId,
        archetypeId,
        x: spawnX,
        y: spawnY,
        z: spawnZ,
        seed: hashSeed(inst.instanceId, this.worldSeed),
        rotationX: rule.rotation.x,
        rotationY: saved?.yaw ?? rule.rotation.y,
        rotationZ: rule.rotation.z,
        scaleX: rule.scale.x,
        scaleY: rule.scale.y,
        scaleZ: rule.scale.z,
        customArchetype,
        respawnEnabled: rule.conditions.respawn.enabled,
        respawnDelaySeconds: rule.conditions.respawn.delaySeconds,
        savedHp: saved?.hp,
        modId: rule.modId,
        modSpawnId: rule.spawnId,
        materializeNow: true,
      });
    } else if (type === 'animal') {
      const content = this.deps.modManager.resolveContentForSpawn(rule);
      const raw = content.entity?.raw ?? {};
      const species = normalizeAnimalSpecies(raw.species ?? raw.animalType);
      const animal = this.deps.wildlife.spawnModAnimal({
        id: inst.instanceId,
        species,
        home: { x: spawnX, z: spawnZ },
        y: spawnY,
        exactPosition: true,
        rotationX: rule.rotation.x,
        rotationY: saved?.yaw ?? rule.rotation.y,
        rotationZ: rule.rotation.z,
        scaleVec: { ...rule.scale },
        maxHpOverride: typeof raw.maxHealth === 'number' && raw.maxHealth > 0 ? raw.maxHealth : undefined,
        attackDamageOverride: typeof raw.damage === 'number' && raw.damage >= 0 ? raw.damage : undefined,
        walkSpeedOverride: typeof raw.walkSpeed === 'number' && raw.walkSpeed > 0 ? raw.walkSpeed : undefined,
        runSpeedOverride: typeof raw.runSpeed === 'number' && raw.runSpeed > 0 ? raw.runSpeed : undefined,
        stationary: rule.behavior === 'stationary' || raw.stationary === true,
        modId: rule.modId,
        modSpawnId: rule.spawnId,
        seed: hashSeed(inst.instanceId, this.worldSeed),
        variant: inst.index % 3,
      });
      if (saved) {
        if (typeof saved.yaw === 'number' && Number.isFinite(saved.yaw)) {
          animal.yaw = saved.yaw;
        }
        if (typeof saved.hp === 'number' && Number.isFinite(saved.hp)) {
          animal.hp = Math.max(0, Math.min(animal.maxHp, saved.hp));
        }
      }
    } else {
      return false;
    }

    this.activeById.set(inst.instanceId, inst);
    this.ruleStates.get(rule.id)?.activeInstanceIds.add(inst.instanceId);
    return true;
  }

  private captureLiveEntityState(inst: PlannedInstance): void {
    const prev = this.persistedInstances.get(inst.instanceId);
    const type = inst.rule.contentType;
    const entry: SavedModSpawnInstanceState = {
      ...(prev ?? {}),
      instanceId: inst.instanceId,
      modId: inst.rule.modId,
      spawnId: inst.rule.spawnId,
      contentId: inst.rule.contentId,
      contentType: type,
      x: inst.x,
      y: inst.y,
      z: inst.z,
      rotationX: inst.rule.rotation.x,
      rotationY: prev?.yaw ?? inst.rule.rotation.y,
      rotationZ: inst.rule.rotation.z,
      scaleX: inst.rule.scale.x,
      scaleY: inst.rule.scale.y,
      scaleZ: inst.rule.scale.z,
      collected: this.isCollected(inst.instanceId, inst.rule.conditions.perPlayerPickup),
      defeated: this.defeatedKeys.has(inst.instanceId),
      ...(this.respawnTimers.has(inst.instanceId)
        ? { respawnAtElapsed: this.respawnTimers.get(inst.instanceId) }
        : {}),
    };

    if (type === 'npc' || type === 'character') {
      const npc = this.deps.npcs.getModNpc(inst.instanceId);
      if (npc) {
        entry.x = npc.position.x;
        entry.y = npc.position.y;
        entry.z = npc.position.z;
        entry.yaw = npc.getYaw();
        entry.rotationY = entry.yaw;
        entry.hp = npc.hp;
        entry.maxHealth = npc.maxHealth;
        entry.isDead = npc.isDead;
        entry.dialogueState = npc.getSyncDialogueState();
        entry.questState = npc.getSyncQuestState();
      }
    } else if (type === 'monster') {
      const enemy = this.deps.combat.getModEnemyController(inst.instanceId);
      if (enemy) {
        entry.x = enemy.position.x;
        entry.y = enemy.position.y;
        entry.z = enemy.position.z;
        entry.yaw = enemy.yaw;
        entry.rotationY = entry.yaw;
        entry.hp = enemy.health.getCurrentHealth();
        entry.maxHealth = enemy.health.getMaxHealth();
        entry.isDead = enemy.health.isDead();
      }
    } else if (type === 'animal') {
      const animal = this.deps.wildlife.getModAnimal(inst.instanceId);
      if (animal) {
        entry.x = animal.position.x;
        entry.y = animal.position.y;
        entry.z = animal.position.z;
        entry.yaw = animal.yaw;
        entry.rotationY = entry.yaw;
        entry.hp = animal.hp;
        entry.maxHealth = animal.maxHp;
        entry.isDead = animal.isDead;
      }
    } else if (type === 'building' || type === 'decoration') {
      const st = this.deps.buildings.getStructureById(inst.instanceId);
      if (st) {
        entry.x = st.x;
        entry.y = st.y;
        entry.z = st.z;
        entry.yaw = st.yaw;
        entry.rotationY = st.yaw;
        entry.health = st.health;
        if (st.doorOpen !== undefined) {
          entry.doorOpen = st.doorOpen;
        }
      }
    }

    inst.x = entry.x;
    inst.y = entry.y;
    inst.z = entry.z;
    const c = worldToChunkCoords(entry.x, entry.z, 120);
    inst.chunkKey = toChunkKey(c.cx, c.cz);
    this.persistedInstances.set(inst.instanceId, entry);
  }

  private despawnInstance(inst: PlannedInstance): void {
    this.captureLiveEntityState(inst);
    const type = inst.rule.contentType;
    if (
      type === 'item' ||
      type === 'weapon' ||
      type === 'armor' ||
      type === 'tool' ||
      type === 'consumable' ||
      type === 'resource'
    ) {
      this.deps.removePickup(inst.instanceId);
    } else if (type === 'building' || type === 'decoration') {
      this.deps.buildings.removeStructure(inst.instanceId);
    } else if (type === 'npc' || type === 'character') {
      this.deps.npcs.removeModNpc(inst.instanceId);
    } else if (type === 'monster') {
      this.deps.combat.unregisterModEnemyBlueprint(inst.instanceId);
    } else if (type === 'animal') {
      this.deps.wildlife.removeModAnimal(inst.instanceId);
    }
    this.activeById.delete(inst.instanceId);
    this.ruleStates.get(inst.rule.id)?.activeInstanceIds.delete(inst.instanceId);
  }

  private buildNpcConfig(
    inst: PlannedInstance,
    ent: ModGenericEntityDescriptor | undefined,
  ): NpcConfig {
    const raw = ent?.raw ?? {};
    const name =
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : inst.displayLabel;
    const nameAr =
      typeof raw.nameAr === 'string' && raw.nameAr.trim() ? raw.nameAr.trim() : name;
    const role = normalizeNpcRole(raw.role);
    const title =
      typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Traveler';
    const titleAr =
      typeof raw.titleAr === 'string' && raw.titleAr.trim() ? raw.titleAr.trim() : title;

    const greetingStr =
      typeof raw.greeting === 'string' && raw.greeting.trim()
        ? raw.greeting.trim()
        : `Greetings, adventurer. I am ${name}.`;
    const greetingArStr =
      typeof raw.greetingAr === 'string' && raw.greetingAr.trim()
        ? raw.greetingAr.trim()
        : greetingStr;

    const rawGreetings = isRecord(raw.greetings) ? raw.greetings : {};
    const greetings: Record<NpcRoutinePeriod, string> = {
      morning: typeof rawGreetings.morning === 'string' ? rawGreetings.morning : greetingStr,
      midday: typeof rawGreetings.midday === 'string' ? rawGreetings.midday : greetingStr,
      evening: typeof rawGreetings.evening === 'string' ? rawGreetings.evening : greetingStr,
      night: typeof rawGreetings.night === 'string' ? rawGreetings.night : greetingStr,
    };

    const rawGreetingsAr = isRecord(raw.greetingsAr) ? raw.greetingsAr : {};
    const greetingsAr: Record<NpcRoutinePeriod, string> = {
      morning: typeof rawGreetingsAr.morning === 'string' ? rawGreetingsAr.morning : greetingArStr,
      midday: typeof rawGreetingsAr.midday === 'string' ? rawGreetingsAr.midday : greetingArStr,
      evening: typeof rawGreetingsAr.evening === 'string' ? rawGreetingsAr.evening : greetingArStr,
      night: typeof rawGreetingsAr.night === 'string' ? rawGreetingsAr.night : greetingArStr,
    };

    const choices: NpcDialogueChoice[] = Array.isArray(raw.choices)
      ? raw.choices
          .filter(isRecord)
          .map((c, idx) => ({
            id: typeof c.id === 'string' ? c.id : `choice_${idx}`,
            label: typeof c.label === 'string' ? c.label : 'Continue',
            reply: typeof c.reply === 'string' ? c.reply : greetingStr,
            nextState: c.nextState === 'close' ? 'close' : 'continue',
          }))
      : [];

    const customDialogueTree = this.buildDialogueTreeFromModNpc(inst, raw, name);
    const stationary =
      inst.rule.behavior === 'stationary' ||
      raw.stationary === true ||
      raw.behavior === 'stationary';

    return {
      id: inst.instanceId,
      name,
      nameAr,
      role,
      title,
      titleAr,
      spawn: { x: inst.x, z: inst.z },
      spawnY: inst.y,
      exactPosition: true,
      initialRotation: { ...inst.rule.rotation },
      initialScale: { ...inst.rule.scale },
      stationary,
      walkSpeed: typeof raw.walkSpeed === 'number' && raw.walkSpeed > 0 ? raw.walkSpeed : 2.1,
      interactionRadius:
        typeof raw.interactionRadius === 'number' && raw.interactionRadius > 0
          ? raw.interactionRadius
          : 3.4,
      location:
        typeof raw.location === 'string' && raw.location.trim()
          ? raw.location.trim()
          : 'Wilderness',
      locationAr:
        typeof raw.locationAr === 'string' && raw.locationAr.trim()
          ? raw.locationAr.trim()
          : 'البرية',
      personality:
        typeof raw.personality === 'string' ? raw.personality : 'Modded character.',
      personalityAr:
        typeof raw.personalityAr === 'string' ? raw.personalityAr : 'شخصية مضافة.',
      greetings,
      greetingsAr,
      choices,
      schedule: [
        {
          period: 'morning',
          activityLabel: 'Keeping Watch',
          anchor: { x: inst.x, z: inst.z },
          mode: stationary ? 'station' : 'wander',
          wanderRadius: stationary ? 0 : 4.5,
          facingYaw: inst.rule.rotation.y,
        },
        {
          period: 'midday',
          activityLabel: 'Keeping Watch',
          anchor: { x: inst.x, z: inst.z },
          mode: stationary ? 'station' : 'wander',
          wanderRadius: stationary ? 0 : 4.5,
          facingYaw: inst.rule.rotation.y,
        },
        {
          period: 'evening',
          activityLabel: 'Keeping Watch',
          anchor: { x: inst.x, z: inst.z },
          mode: stationary ? 'station' : 'wander',
          wanderRadius: stationary ? 0 : 4.5,
          facingYaw: inst.rule.rotation.y,
        },
        {
          period: 'night',
          activityLabel: 'Keeping Watch',
          anchor: { x: inst.x, z: inst.z },
          mode: stationary ? 'station' : 'wander',
          wanderRadius: stationary ? 0 : 4.5,
          facingYaw: inst.rule.rotation.y,
        },
      ],
      ...(customDialogueTree ? { customDialogueTree } : {}),
      isModSpawn: true,
      modSpawnId: inst.rule.spawnId,
      modId: inst.rule.modId,
      chunkKey: inst.chunkKey,
      seed: hashSeed(inst.instanceId, this.worldSeed),
    };
  }

  private buildDialogueTreeFromModNpc(
    inst: PlannedInstance,
    raw: Record<string, unknown>,
    speakerName: string,
  ): DialogueTree | undefined {
    const rawTree = isRecord(raw.dialogueTree)
      ? raw.dialogueTree
      : isRecord(raw.dialogue)
        ? raw.dialogue
        : undefined;
    if (!rawTree && !raw.rewardItemId && !raw.giveItemId) return undefined;

    const convertEffects = (list: unknown): DialogueEffect[] => {
      if (!Array.isArray(list)) return [];
      const effects: DialogueEffect[] = [];
      for (const eff of list) {
        if (!isRecord(eff) || typeof eff.type !== 'string') continue;
        if (eff.type === 'giveItem') {
          const itemObj = isRecord(eff.item) ? eff.item : eff;
          const rawItemId = typeof itemObj.id === 'string'
            ? itemObj.id
            : typeof itemObj.itemId === 'string'
              ? itemObj.itemId
              : '';
          if (!rawItemId) continue;
          const fullItemId = resolveModCrossReference(inst.rule.modId, rawItemId);
          const itemDef = this.deps.itemManager.getItem(fullItemId);
          effects.push({
            type: 'giveItem',
            item: {
              id: fullItemId,
              name: itemDef?.name ?? (typeof itemObj.name === 'string' ? itemObj.name : fullItemId),
              description:
                itemDef?.description ??
                (typeof itemObj.description === 'string' ? itemObj.description : ''),
              count: typeof itemObj.count === 'number' && itemObj.count > 0 ? itemObj.count : 1,
              usable: itemDef?.usable ?? Boolean(itemObj.usable),
            },
          });
        } else if (eff.type === 'startQuest' && typeof eff.questId === 'string') {
          effects.push({
            type: 'startQuest',
            questId: resolveModCrossReference(inst.rule.modId, eff.questId),
          });
        } else if (eff.type === 'completeQuest' && typeof eff.questId === 'string') {
          effects.push({
            type: 'completeQuest',
            questId: resolveModCrossReference(inst.rule.modId, eff.questId),
          });
        } else if (eff.type === 'setFlag' && typeof eff.flag === 'string') {
          effects.push({ type: 'setFlag', flag: eff.flag });
        } else if (eff.type === 'notice' && typeof eff.message === 'string') {
          effects.push({ type: 'notice', message: eff.message });
        }
      }
      return effects;
    };

    if (rawTree && isRecord(rawTree.nodes)) {
      const nodes: Record<string, DialogueNode> = {};
      for (const [nodeId, rawNode] of Object.entries(rawTree.nodes)) {
        if (!isRecord(rawNode)) continue;
        const lines = Array.isArray(rawNode.lines)
          ? rawNode.lines.filter((l): l is string => typeof l === 'string')
          : typeof rawNode.text === 'string'
            ? [rawNode.text]
            : ['...'];
        const choices: DialogueChoiceNode[] | undefined = Array.isArray(rawNode.choices)
          ? rawNode.choices
              .filter(isRecord)
              .map((c, idx) => ({
                id: typeof c.id === 'string' ? c.id : `c_${idx}`,
                label: typeof c.label === 'string' ? c.label : 'Continue',
                nextNodeId: typeof c.nextNodeId === 'string' ? c.nextNodeId : null,
                ...(Array.isArray(c.effects) ? { effects: convertEffects(c.effects) } : {}),
              }))
          : undefined;
        nodes[nodeId] = {
          id: nodeId,
          speaker: typeof rawNode.speaker === 'string' ? rawNode.speaker : speakerName,
          lines,
          ...(choices ? { choices } : {}),
          ...(rawNode.nextNodeId !== undefined
            ? { nextNodeId: typeof rawNode.nextNodeId === 'string' ? rawNode.nextNodeId : null }
            : {}),
          ...(Array.isArray(rawNode.onEnterEffects)
            ? { onEnterEffects: convertEffects(rawNode.onEnterEffects) }
            : {}),
          ...(typeof rawNode.questId === 'string'
            ? { questId: resolveModCrossReference(inst.rule.modId, rawNode.questId) }
            : {}),
        };
      }
      const startId =
        typeof rawTree.defaultStartNodeId === 'string' && nodes[rawTree.defaultStartNodeId]
          ? rawTree.defaultStartNodeId
          : Object.keys(nodes)[0] ?? 'start';
      if (nodes[startId]) {
        return {
          npcId: inst.instanceId,
          defaultStartNodeId: startId,
          nodes,
        };
      }
    }

    const rewardRawId =
      typeof raw.rewardItemId === 'string'
        ? raw.rewardItemId
        : typeof raw.giveItemId === 'string'
          ? raw.giveItemId
          : '';
    if (rewardRawId) {
      const fullItemId = resolveModCrossReference(inst.rule.modId, rewardRawId);
      const itemDef = this.deps.itemManager.getItem(fullItemId);
      const flagKey = `mod_reward_${inst.instanceId}`;
      const greetingLine =
        typeof raw.greeting === 'string' && raw.greeting.trim()
          ? raw.greeting.trim()
          : `Take this ${itemDef?.name ?? fullItemId}, traveler.`;
      return {
        npcId: inst.instanceId,
        defaultStartNodeId: 'root',
        entryRules: [
          { condition: { flagSet: flagKey }, nodeId: 'after' },
        ],
        nodes: {
          root: {
            id: 'root',
            speaker: speakerName,
            lines: [greetingLine],
            choices: [
              {
                id: 'accept_gift',
                label: `Accept ${itemDef?.name ?? fullItemId}`,
                nextNodeId: 'given',
                effects: [
                  {
                    type: 'giveItem',
                    item: {
                      id: fullItemId,
                      name: itemDef?.name ?? fullItemId,
                      description: itemDef?.description ?? '',
                      count: 1,
                      usable: itemDef?.usable ?? false,
                    },
                  },
                  { type: 'setFlag', flag: flagKey },
                ],
              },
              {
                id: 'leave',
                label: 'Not now.',
                nextNodeId: null,
              },
            ],
          },
          given: {
            id: 'given',
            speaker: speakerName,
            lines: [`May ${itemDef?.name ?? fullItemId} serve you well.`],
            nextNodeId: null,
          },
          after: {
            id: 'after',
            speaker: speakerName,
            lines: [greetingLine],
            nextNodeId: null,
          },
        },
      };
    }

    return undefined;
  }

  private scheduleRespawnIfEnabled(inst: PlannedInstance): void {
    const resp = inst.rule.conditions.respawn;
    if (!resp.enabled || resp.oneTime || resp.delaySeconds <= 0) return;
    this.respawnTimers.set(inst.instanceId, this.elapsedSeconds + resp.delaySeconds);
  }

  private perPlayerKey(instanceId: string, playerId?: string): string {
    const pid = playerId ?? this.deps.getLocalPlayerId?.() ?? 'local';
    return `${pid}::${instanceId}`;
  }

  private isCollected(instanceId: string, perPlayer: boolean): boolean {
    if (perPlayer) {
      return this.perPlayerCollectedKeys.has(this.perPlayerKey(instanceId));
    }
    return this.collectedKeys.has(instanceId);
  }

  private findPlannedInstance(instanceId: string): PlannedInstance | undefined {
    for (const st of this.ruleStates.values()) {
      const hit = st.planned.find((p) => p.instanceId === instanceId);
      if (hit) return hit;
    }
    return undefined;
  }

  private publishDiagnostics(): void {
    const entries: ModSpawnDiagnosticEntry[] = [];
    for (const st of this.ruleStates.values()) {
      const first = st.planned[0];
      entries.push({
        modId: st.rule.modId,
        contentId: st.rule.contentId,
        spawnId: st.rule.spawnId,
        contentType: st.rule.contentType,
        mode: st.rule.unsupportedMode ?? st.rule.mode,
        configuredCoords: { ...st.rule.position },
        resolvedCoords: first ? { x: first.x, y: first.y, z: first.z } : null,
        rotation: { ...st.rule.rotation },
        scale: { ...st.rule.scale },
        status: st.lastDiagnosticStatus,
        targetChunk: first ? first.chunkKey : null,
        alreadySpawned: st.activeInstanceIds.size > 0,
        saved: st.planned.some(
          (p) =>
            this.persistedInstances.has(p.instanceId) ||
            this.isCollected(p.instanceId, st.rule.conditions.perPlayerPickup) ||
            this.defeatedKeys.has(p.instanceId),
        ),
        ...(st.failedCondition ? { failedCondition: st.failedCondition } : {}),
        ...(st.errorCode ? { errorCode: st.errorCode } : {}),
        ...(st.errorMessage ? { error: st.errorMessage } : {}),
        instanceCount: st.activeInstanceIds.size,
      });
    }
    this.deps.modManager.setRuntimeSpawnDiagnostics(entries);
  }

  private publishSyncedDiagnostics(entries: ReadonlyArray<SyncedModSpawnEntry>): void {
    const diag: ModSpawnDiagnosticEntry[] = entries.map((e) => {
      const c = worldToChunkCoords(e.x, e.z, 120);
      const chunkKey = toChunkKey(c.cx, c.cz);
      const isActive = this.activeById.has(e.instanceId);
      const isCollected = this.isCollected(e.instanceId, Boolean(e.perPlayer));
      return {
        modId: e.modId,
        contentId: e.contentId,
        spawnId: e.spawnId,
        contentType: e.contentType as ModSpawnDefinition['contentType'],
        mode: 'host_synced',
        configuredCoords: { x: e.x, y: e.y, z: e.z },
        resolvedCoords: { x: e.x, y: e.y, z: e.z },
        rotation: { x: e.rotationX, y: e.rotationY, z: e.rotationZ },
        scale: { x: e.scaleX, y: e.scaleY, z: e.scaleZ },
        status: isActive
          ? 'spawned'
          : isCollected
            ? 'collected'
            : e.defeated
              ? 'defeated'
              : 'pending_chunk',
        targetChunk: chunkKey,
        alreadySpawned: isActive,
        saved: Boolean(e.collected || e.defeated),
        instanceCount: isActive ? 1 : 0,
      };
    });
    this.deps.modManager.setRuntimeSpawnDiagnostics(diag);
  }

  public spawnDynamicEntity(opts: {
    contentId: string;
    contentType?: string;
    x: number;
    y?: number;
    z: number;
    behavior?: string;
    modId: string;
    instanceId?: string;
  }): boolean {
    const store = this.deps.modManager.getContentStore();
    const fullId = opts.contentId.includes(':')
      ? opts.contentId
      : `${opts.modId}:${opts.contentId}`;
    const candidateIds = Array.from(new Set([opts.contentId, fullId]));
    const typeHint = (opts.contentType ?? '').trim().toLowerCase();

    const safeGroundY = Number.isFinite(opts.y)
      ? Math.max(WATER_LEVEL + 0.15, opts.y as number)
      : Math.max(WATER_LEVEL + 0.15, groundHeightAt(opts.x, opts.z));
    const chunk = worldToChunkCoords(opts.x, opts.z, 120);
    const chunkKey = toChunkKey(chunk.cx, chunk.cz);
    const instanceId =
      opts.instanceId ??
      `modev_spawn:${opts.modId}:${opts.contentId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`;

    // 1. Pickup-like items
    if (
      !typeHint ||
      typeHint === 'item' ||
      typeHint === 'weapon' ||
      typeHint === 'armor' ||
      typeHint === 'tool' ||
      typeHint === 'consumable' ||
      typeHint === 'resource'
    ) {
      for (const cid of candidateIds) {
        const itemDef = this.deps.itemManager.getItem(cid) ?? store.getItemDefinition(cid);
        if (itemDef) {
          this.deps.spawnPickup({
            id: instanceId,
            itemId: itemDef.id,
            count: 1,
            label: itemDef.name,
            x: opts.x,
            y: safeGroundY + 0.12,
            z: opts.z,
            modelPath: itemDef.modelPath,
            categoryHint: itemDef.category === 'weapon' ? 'weapon' : undefined,
            chunkKey,
            modId: opts.modId,
            hoverBob: false,
          });
          return true;
        }
      }
    }

    // 2. Buildings / decorations
    if (!typeHint || typeHint === 'building' || typeHint === 'decoration') {
      for (const cid of candidateIds) {
        const bp = getBlueprintById(cid) ?? store.getBlueprint(cid);
        if (bp) {
          this.deps.buildings.addOrUpdateStructure({
            id: instanceId,
            blueprintId: bp.id,
            category: bp.category,
            tier: bp.tier,
            x: opts.x,
            y: safeGroundY,
            z: opts.z,
            yaw: 0,
            health: bp.maxHealth,
            maxHealth: bp.maxHealth,
            ownerId: 'mod',
            ownerName: opts.modId,
            permission: 'everyone',
            createdAtMs: Date.now(),
            isModSpawn: true,
            modId: opts.modId,
          });
          return true;
        }
      }
    }

    // 3. Mod NPC / character
    if (!typeHint || typeHint === 'npc' || typeHint === 'character') {
      for (const cid of candidateIds) {
        const ent =
          store.getEntityDescriptor('npcs', cid) ??
          store.getEntityDescriptor('characters', cid);
        if (ent) {
          const fakeInst: PlannedInstance = {
            instanceId,
            index: 0,
            x: opts.x,
            y: safeGroundY,
            z: opts.z,
            chunkKey,
            displayLabel: ent.name || cid,
            rule: {
              id: instanceId,
              modId: opts.modId,
              spawnId: cid,
              contentId: cid,
              contentType: typeHint === 'character' ? 'character' : 'npc',
              mode: 'exact_coords',
              position: { x: opts.x, y: safeGroundY, z: opts.z },
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
              count: 1,
              behavior: opts.behavior,
              conditions: {
                respawn: { enabled: false, delaySeconds: 0, oneTime: true },
                perPlayerPickup: false,
              },
              enabled: true,
              sourceFile: 'event',
            },
          };
          const cfg = this.buildNpcConfig(fakeInst, ent);
          this.deps.npcs.spawnModNpc(cfg);
          return true;
        }
      }
    }

    // 4. Monster (mod descriptor or base enemy archetype)
    if (!typeHint || typeHint === 'monster' || typeHint === 'enemy' || typeHint === 'boss') {
      for (const cid of candidateIds) {
        const ent = store.getEntityDescriptor('monsters', cid);
        if (ent) {
          const raw = ent.raw ?? {};
          const archetypeId = normalizeEnemyArchetype(raw.archetype ?? raw.template ?? opts.behavior);
          this.deps.combat.registerModEnemyBlueprint({
            id: instanceId,
            archetypeId,
            x: opts.x,
            y: safeGroundY,
            z: opts.z,
            seed: hashSeed(instanceId, this.worldSeed),
            customArchetype: {
              ...(typeof raw.name === 'string' && raw.name.trim() ? { name: raw.name.trim() } : {}),
              ...(typeof raw.nameAr === 'string' && raw.nameAr.trim() ? { nameAr: raw.nameAr.trim() } : {}),
              ...(typeof raw.maxHealth === 'number' && raw.maxHealth > 0 ? { maxHealth: raw.maxHealth } : {}),
              ...(typeof raw.damage === 'number' && raw.damage > 0 ? { damage: raw.damage } : {}),
              ...(typeHint === 'boss' || raw.isBoss === true ? { isBoss: true } : {}),
            },
            respawnEnabled: false,
            respawnDelaySeconds: 0,
            modId: opts.modId,
            materializeNow: true,
          });
          return true;
        }
      }
      const lowerCid = opts.contentId.trim().toLowerCase();
      if (
        lowerCid === 'bandit_scout' ||
        lowerCid === 'thorn_stalker' ||
        lowerCid === 'stone_sentinel' ||
        lowerCid === 'ancient_monster' ||
        lowerCid === 'ancient_guardian' ||
        typeHint === 'monster' ||
        typeHint === 'enemy' ||
        typeHint === 'boss'
      ) {
        const archetypeId = normalizeEnemyArchetype(
          lowerCid || (typeHint === 'boss' ? 'ancient_guardian' : opts.behavior),
        );
        this.deps.combat.registerModEnemyBlueprint({
          id: instanceId,
          archetypeId,
          x: opts.x,
          y: safeGroundY,
          z: opts.z,
          seed: hashSeed(instanceId, this.worldSeed),
          respawnEnabled: false,
          respawnDelaySeconds: 0,
          modId: opts.modId,
          materializeNow: true,
        });
        return true;
      }
    }

    // 5. Animal (mod descriptor or base species)
    if (!typeHint || typeHint === 'animal') {
      for (const cid of candidateIds) {
        const ent = store.getEntityDescriptor('animals', cid);
        if (ent) {
          const raw = ent.raw ?? {};
          const species = normalizeAnimalSpecies(raw.species ?? raw.animalType);
          this.deps.wildlife.spawnModAnimal({
            id: instanceId,
            species,
            home: { x: opts.x, z: opts.z },
            y: safeGroundY,
            exactPosition: true,
            stationary: opts.behavior === 'stationary' || raw.stationary === true,
            modId: opts.modId,
            seed: hashSeed(instanceId, this.worldSeed),
          });
          return true;
        }
      }
      const lowerCid = opts.contentId.trim().toLowerCase();
      if (
        lowerCid === 'deer' ||
        lowerCid === 'rabbit' ||
        lowerCid === 'wolf' ||
        lowerCid === 'bear' ||
        lowerCid === 'bird' ||
        lowerCid === 'cow' ||
        lowerCid === 'sheep' ||
        lowerCid === 'chicken' ||
        typeHint === 'animal'
      ) {
        this.deps.wildlife.spawnModAnimal({
          id: instanceId,
          species: normalizeAnimalSpecies(lowerCid),
          home: { x: opts.x, z: opts.z },
          y: safeGroundY,
          exactPosition: true,
          stationary: opts.behavior === 'stationary',
          modId: opts.modId,
          seed: hashSeed(instanceId, this.worldSeed),
        });
        return true;
      }
    }

    return false;
  }
}
