import type { Language } from '../i18n/translations';
import type { QuestStatus } from '../quest/questTypes';
import type { BiomeType, NpcRoutinePeriod, WeatherState } from '../types';
import {
  type ModEventAction,
  type ModEventAreaSpec,
  type ModEventConditionNode,
  type ModEventDefinition,
  type ModEventDiagnosticEntry,
  type ModEventInventoryFullPolicy,
  type ModEventLeafCondition,
  type ModEventMultiplayerAuthority,
  type ModEventRuntimeStatus,
  type ModEventStatusEffectKind,
  type ModEventTriggerSpec,
  type ModEventTriggerType,
  type PendingWorldModReward,
  type SavedWorldModEventState,
} from './ModEventConfig';
import type { ModManager } from './ModManager';
import {
  formatDefaultModAchievementNotice,
  type ModPlayerEventStore,
} from './ModPlayerEventStore';

const MAX_PROCESSED_INSTANCE_IDS = 600;
const MAX_EVENT_RECURSION_DEPTH = 8;
const MAX_DISPATCH_EXECUTIONS = 32;

export interface ModEventContext {
  playerId?: string;
  timestamp?: number;
  worldId?: string;
  /** Unique per event occurrence (used by once_per_event & deduping kills/destruction) */
  triggerInstanceId?: string;
  npcId?: string;
  npcModId?: string;
  dialogueId?: string;
  choiceId?: string;
  entityId?: string;
  victimEntityId?: string;
  victimType?: string;
  victimModId?: string;
  entityCategory?: string;
  killerId?: string;
  causedByPlayer?: boolean;
  isEnvironmentalDeath?: boolean;
  weaponId?: string;
  toolId?: string;
  itemId?: string;
  count?: number;
  equipSlot?: string;
  recipeId?: string;
  questId?: string;
  questStatus?: QuestStatus;
  buildingId?: string;
  structureId?: string;
  blockType?: string;
  resourceKind?: string;
  success?: boolean;
  position?: { x: number; y: number; z: number };
  biome?: BiomeType;
  playerLevel?: number;
  playerHealth?: number;
  playerMaxHealth?: number;
  damageAmount?: number;
  damageType?: string;
  customEventName?: string;
  payload?: Record<string, string | number | boolean>;
  inventoryDelta?: number;
}

export interface ModEventBridge {
  getWorldId: () => string;
  getPlayerPosition: () => { x: number; y: number; z: number };
  getPlayerLevel: () => number;
  getPlayerHealth: () => { current: number; max: number };
  getBiomeAt: (x: number, z: number) => BiomeType;
  getTimeOfDay: () => { hour: number; period: NpcRoutinePeriod };
  getWeather: () => WeatherState;
  getItemCount: (itemId: string) => number;
  getQuestStatus: (questId: string) => QuestStatus;
  getLanguage: () => Language;
  resolveLocalization?: (key: string) => string | undefined;
  giveItem: (
    itemId: string,
    count: number,
    equip?: boolean,
  ) => { added: number; equipped?: boolean; itemName?: string };
  spawnWorldPickup: (opts: {
    itemId: string;
    count: number;
    x: number;
    y: number;
    z: number;
    modId: string;
    perPlayer?: boolean;
  }) => boolean;
  giveXp: (amount: number) => { leveledUp?: boolean; newLevel?: number };
  giveCurrency: (amount: number) => boolean;
  giveReputation: (amount: number, villageId?: string) => boolean;
  unlockRecipe: (recipeId: string) => boolean;
  startQuest: (questId: string) => boolean;
  completeQuest: (questId: string) => boolean;
  showNotification: (message: string) => void;
  playSound: (soundId: string) => boolean;
  spawnEntity: (opts: {
    contentId: string;
    contentType?: string;
    x: number;
    y: number;
    z: number;
    behavior?: string;
    modId: string;
  }) => boolean;
  startDialogue: (npcId: string, treeId?: string) => boolean;
  applyStatusEffect: (opts: {
    effectType: ModEventStatusEffectKind;
    amount?: number;
    multiplier?: number;
    durationSeconds?: number;
  }) => boolean;
}

export interface ModEventWorldInitOptions {
  worldId: string;
  lifecycle: 'new_world' | 'world_load';
  localPlayerId: string;
  isMultiplayer: boolean;
  isHost: boolean;
  savedWorldState?: SavedWorldModEventState | null;
}

export interface ModEventEmitSummary {
  triggerType: ModEventTriggerType;
  matchedCount: number;
  executedCount: number;
  executedEventIds: string[];
  blockedEventIds: string[];
}

interface QueuedDelayedEvent {
  eventId: string;
  triggerType: ModEventTriggerType;
  context: ModEventContext;
  remainingSec: number;
}

interface InternalRuntimeEntry {
  status: ModEventRuntimeStatus;
  executionCount: number;
  lastTriggeredAt?: number;
  lastExecutedAt?: number;
  failedReason?: string;
  errorCode?: string;
  error?: string;
}

function createEmptyWorldState(): SavedWorldModEventState {
  return {
    version: 1,
    worldFlags: {},
    executedWorldEvents: {},
    executedPlayerWorldEvents: {},
    executionCounts: {},
    cooldowns: {},
    processedInstanceIds: [],
    firstSpawnPlayers: [],
    pendingRewards: [],
  };
}

function stripNamespacePrefix(raw: string): string {
  const idx = raw.indexOf(':');
  return idx > 0 ? raw.slice(idx + 1) : raw;
}

function normalizeId(raw: string): string {
  return raw.trim().toLowerCase();
}

function matchesIdReference(
  configured: string | undefined,
  eventModId: string,
  actual: string | undefined,
  actualModId?: string,
): boolean {
  if (!configured) return true;
  if (!actual) return false;
  const cfgNorm = normalizeId(configured);
  const actNorm = normalizeId(actual);
  if (cfgNorm === actNorm) return true;

  const namespacedCfg = cfgNorm.includes(':') ? cfgNorm : `${normalizeId(eventModId)}:${cfgNorm}`;
  if (namespacedCfg === actNorm) return true;

  if (!cfgNorm.includes(':') && (!actualModId || normalizeId(actualModId) === normalizeId(eventModId))) {
    if (stripNamespacePrefix(actNorm) === cfgNorm) return true;
  }
  if (!actNorm.includes(':') && cfgNorm === `${normalizeId(eventModId)}:${actNorm}`) {
    return true;
  }
  if (stripNamespacePrefix(cfgNorm) === stripNamespacePrefix(actNorm) && !actNorm.includes(':') && !actualModId) {
    return true;
  }
  return false;
}

function isPositionInsideArea(
  pos: { x: number; y: number; z: number } | undefined,
  area: ModEventAreaSpec,
): boolean | null {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) {
    return null;
  }
  if (
    area.minX !== undefined &&
    area.maxX !== undefined &&
    area.minZ !== undefined &&
    area.maxZ !== undefined
  ) {
    if (pos.x < area.minX || pos.x > area.maxX || pos.z < area.minZ || pos.z > area.maxZ) {
      return false;
    }
    if (area.minY !== undefined && pos.y < area.minY) return false;
    if (area.maxY !== undefined && pos.y > area.maxY) return false;
    return true;
  }
  if (area.x !== undefined && area.z !== undefined) {
    const radius = area.radius ?? 4;
    const dx = pos.x - area.x;
    const dz = pos.z - area.z;
    if (dx * dx + dz * dz > radius * radius) return false;
    if (area.y !== undefined && area.radius !== undefined && Math.abs(pos.y - area.y) > Math.max(4, radius)) {
      return false;
    }
    return true;
  }
  return null;
}

function isHourInRange(hour: number, startHour?: number, endHour?: number): boolean {
  if (startHour === undefined && endHour === undefined) return true;
  const h = ((hour % 24) + 24) % 24;
  const s = startHour !== undefined ? ((startHour % 24) + 24) % 24 : 0;
  const e = endHour !== undefined ? ((endHour % 24) + 24) % 24 : 24;
  if (startHour !== undefined && endHour !== undefined) {
    if (s <= e) return h >= s && h <= e;
    return h >= s || h <= e;
  }
  if (startHour !== undefined) return h >= s;
  return h <= e;
}

export class ModEventManager {
  private readonly modManager: ModManager;
  private readonly playerStore: ModPlayerEventStore;
  private readonly bridge: ModEventBridge;

  private initialized = false;
  private worldId = '';
  private localPlayerId = 'local-player';
  private isMultiplayer = false;
  private isHost = true;

  private worldState: SavedWorldModEventState = createEmptyWorldState();
  private readonly processedInstanceSet = new Set<string>();
  private readonly runtimeEntries = new Map<string, InternalRuntimeEntry>();
  private readonly activeSpatialEvents = new Set<string>();
  private readonly delayedQueue: QueuedDelayedEvent[] = [];

  private lastTrackedPos: { x: number; y: number; z: number } | null = null;
  private activeEventStack: string[] = [];
  private dispatchCounter = 0;
  private activeDispatchExecutions = 0;
  private pendingIdCounter = 0;

  constructor(
    modManager: ModManager,
    playerStore: ModPlayerEventStore,
    bridge: ModEventBridge,
  ) {
    this.modManager = modManager;
    this.playerStore = playerStore;
    this.bridge = bridge;
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public getWorldFlag(flag: string): boolean {
    return Boolean(this.worldState.worldFlags[flag]);
  }

  public getAllWorldFlags(): Record<string, boolean> {
    return { ...this.worldState.worldFlags };
  }

  public setWorldFlag(flag: string, value: boolean): void {
    const clean = flag.trim();
    if (!clean) return;
    this.worldState.worldFlags[clean] = Boolean(value);
  }

  public initializeForWorld(opts: ModEventWorldInitOptions): void {
    this.worldId = opts.worldId || 'world';
    this.localPlayerId = opts.localPlayerId || 'local-player';
    this.isMultiplayer = opts.isMultiplayer;
    this.isHost = opts.isMultiplayer ? opts.isHost : true;
    this.initialized = true;

    this.delayedQueue.length = 0;
    this.activeSpatialEvents.clear();
    this.activeEventStack = [];
    this.activeDispatchExecutions = 0;
    this.lastTrackedPos = null;
    this.runtimeEntries.clear();

    this.restoreWorldState(opts.savedWorldState);
    this.seedInitialDiagnostics();

    if (opts.lifecycle === 'new_world') {
      this.emit('new_world_created', {
        worldId: this.worldId,
        playerId: this.localPlayerId,
        triggerInstanceId: `new_world:${this.worldId}`,
      });
    }

    // Fire player_first_spawn at most once per player in this world
    if (!this.worldState.firstSpawnPlayers.includes(this.localPlayerId)) {
      this.worldState.firstSpawnPlayers.push(this.localPlayerId);
      this.emit('player_first_spawn', {
        worldId: this.worldId,
        playerId: this.localPlayerId,
        triggerInstanceId: `first_spawn:${this.worldId}:${this.localPlayerId}`,
      });
    }

    if (opts.lifecycle === 'world_load') {
      this.emit('world_loaded', {
        worldId: this.worldId,
        playerId: this.localPlayerId,
        triggerInstanceId: `world_load:${this.worldId}:${Date.now()}`,
      });
      this.retryPendingRewards('world_load');
    }

    this.publishDiagnostics();
  }

  public restoreWorldState(saved?: SavedWorldModEventState | null): void {
    const next = createEmptyWorldState();
    this.processedInstanceSet.clear();

    if (saved && typeof saved === 'object') {
      if (saved.worldFlags && typeof saved.worldFlags === 'object') {
        for (const [k, v] of Object.entries(saved.worldFlags)) {
          if (typeof v === 'boolean' && k) next.worldFlags[k] = v;
        }
      }
      if (saved.executedWorldEvents && typeof saved.executedWorldEvents === 'object') {
        for (const [k, v] of Object.entries(saved.executedWorldEvents)) {
          if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
            next.executedWorldEvents[k] = v;
          }
        }
      }
      if (saved.executedPlayerWorldEvents && typeof saved.executedPlayerWorldEvents === 'object') {
        for (const [k, v] of Object.entries(saved.executedPlayerWorldEvents)) {
          if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
            next.executedPlayerWorldEvents[k] = v;
          }
        }
      }
      if (saved.executionCounts && typeof saved.executionCounts === 'object') {
        for (const [k, v] of Object.entries(saved.executionCounts)) {
          if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
            next.executionCounts[k] = v;
          }
        }
      }
      if (saved.cooldowns && typeof saved.cooldowns === 'object') {
        for (const [k, v] of Object.entries(saved.cooldowns)) {
          if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
            next.cooldowns[k] = v;
          }
        }
      }
      if (Array.isArray(saved.processedInstanceIds)) {
        for (const id of saved.processedInstanceIds.slice(-MAX_PROCESSED_INSTANCE_IDS)) {
          if (typeof id === 'string' && id) {
            next.processedInstanceIds.push(id);
            this.processedInstanceSet.add(id);
          }
        }
      }
      if (Array.isArray(saved.firstSpawnPlayers)) {
        for (const pid of saved.firstSpawnPlayers) {
          if (typeof pid === 'string' && pid && !next.firstSpawnPlayers.includes(pid)) {
            next.firstSpawnPlayers.push(pid);
          }
        }
      }
      if (Array.isArray(saved.pendingRewards)) {
        for (const entry of saved.pendingRewards.slice(0, 128)) {
          if (entry && typeof entry.id === 'string' && Array.isArray(entry.items) && entry.items.length > 0) {
            next.pendingRewards.push({
              ...entry,
              items: entry.items.map((it) => ({ ...it })),
            });
          }
        }
      }
    }

    // Merge pending rewards persisted in localStorage store for this world/player
    const storedPending = this.playerStore.getPendingRewards(this.worldId, this.localPlayerId);
    for (const sp of storedPending) {
      if (!next.pendingRewards.some((p) => p.id === sp.id)) {
        next.pendingRewards.push({
          ...sp,
          items: sp.items.map((it) => ({ ...it })),
        });
      }
    }

    this.worldState = next;
  }

  public exportWorldState(): SavedWorldModEventState {
    return {
      version: 1,
      worldFlags: { ...this.worldState.worldFlags },
      executedWorldEvents: { ...this.worldState.executedWorldEvents },
      executedPlayerWorldEvents: { ...this.worldState.executedPlayerWorldEvents },
      executionCounts: { ...this.worldState.executionCounts },
      cooldowns: { ...this.worldState.cooldowns },
      processedInstanceIds: [...this.worldState.processedInstanceIds],
      firstSpawnPlayers: [...this.worldState.firstSpawnPlayers],
      pendingRewards: this.worldState.pendingRewards.map((r) => ({
        ...r,
        items: r.items.map((it) => ({ ...it })),
      })),
    };
  }

  public reset(): void {
    this.initialized = false;
    this.worldId = '';
    this.worldState = createEmptyWorldState();
    this.processedInstanceSet.clear();
    this.runtimeEntries.clear();
    this.activeSpatialEvents.clear();
    this.delayedQueue.length = 0;
    this.lastTrackedPos = null;
    this.activeEventStack = [];
    this.activeDispatchExecutions = 0;
    this.modManager.clearRuntimeEventDiagnostics();
  }

  public update(dt: number): void {
    if (!this.initialized || this.delayedQueue.length === 0) return;
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (step <= 0) return;

    const ready: QueuedDelayedEvent[] = [];
    for (let i = this.delayedQueue.length - 1; i >= 0; i--) {
      const q = this.delayedQueue[i];
      q.remainingSec -= step;
      if (q.remainingSec <= 0) {
        this.delayedQueue.splice(i, 1);
        ready.unshift(q);
      }
    }

    if (ready.length === 0) return;

    const allEvents = this.modManager.getAllModEvents();
    const byId = new Map<string, ModEventDefinition>();
    for (const ev of allEvents) byId.set(ev.id, ev);

    let changed = false;
    for (const q of ready) {
      const def = byId.get(q.eventId);
      if (!def) continue;
      this.tryExecuteMatchedEvent(def, q.triggerType, q.context, true);
      changed = true;
    }

    if (changed) {
      this.publishDiagnostics();
    }
  }

  /**
   * Called on movement updates; triggers spatial events only on outside -> inside transitions
   * (zero continuous firing while standing inside an area).
   */
  public updatePlayerPosition(x: number, y: number, z: number, forceCheck = false): void {
    if (!this.initialized) return;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    if (
      !forceCheck &&
      this.lastTrackedPos &&
      Math.hypot(x - this.lastTrackedPos.x, y - this.lastTrackedPos.y, z - this.lastTrackedPos.z) < 0.05
    ) {
      return;
    }
    this.lastTrackedPos = { x, y, z };

    const spatialDefs = this.modManager
      .getAllModEvents()
      .filter(
        (ev) =>
          ev.enabled &&
          !ev.validationError &&
          (ev.trigger.type === 'player_enter_area' || ev.trigger.type === 'player_reach_coordinates') &&
          Boolean(ev.trigger.area),
      )
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

    if (spatialDefs.length === 0) return;

    const pos = { x, y, z };
    let changed = false;

    for (const ev of spatialDefs) {
      const area = ev.trigger.area;
      if (!area) continue;
      const inside = isPositionInsideArea(pos, area);
      if (inside === null) continue;
      const wasInside = this.activeSpatialEvents.has(ev.id);

      if (inside && !wasInside) {
        this.activeSpatialEvents.add(ev.id);
        this.tryExecuteMatchedEvent(
          ev,
          ev.trigger.type,
          {
            worldId: this.worldId,
            playerId: this.localPlayerId,
            position: pos,
            triggerInstanceId: `spatial:${ev.id}:${Date.now()}`,
          },
          false,
        );
        changed = true;
      } else if (!inside && wasInside) {
        this.activeSpatialEvents.delete(ev.id);
      }
    }

    if (changed) {
      this.publishDiagnostics();
    }
  }

  public retryPendingRewards(reason: 'inventory_changed' | 'world_load' | 'manual' = 'manual'): number {
    if (!this.initialized) return 0;
    const queue = this.worldState.pendingRewards;
    if (!queue || queue.length === 0) return 0;

    let deliveredRecords = 0;
    const remaining: PendingWorldModReward[] = [];

    for (const rec of queue) {
      if (rec.playerScopeId !== this.localPlayerId || (rec.worldId && rec.worldId !== this.worldId)) {
        remaining.push(rec);
        continue;
      }
      const leftoverItems: Array<{ itemId: string; count: number; equip?: boolean }> = [];
      let deliveredAny = false;

      for (const item of rec.items) {
        const res = this.bridge.giveItem(item.itemId, item.count, item.equip);
        if (res.added > 0) {
          deliveredAny = true;
        }
        const rem = Math.max(0, item.count - res.added);
        if (rem > 0) {
          leftoverItems.push({ ...item, count: rem });
        }
      }

      if (leftoverItems.length === 0) {
        deliveredRecords += 1;
        const entry = this.runtimeEntries.get(rec.fullEventId);
        if (entry && entry.status === 'pending_inventory') {
          entry.status = 'executed';
          entry.lastExecutedAt = Date.now();
          entry.failedReason = undefined;
        }
        this.modManager.appendRuntimeEventLog(
          'info',
          `Delivered pending reward for "${rec.fullEventId}" (${reason}).`,
          rec.modId,
        );
      } else {
        remaining.push({
          ...rec,
          items: leftoverItems,
          attempts: rec.attempts + (deliveredAny ? 0 : 1),
        });
      }
    }

    this.worldState.pendingRewards = remaining;
    this.playerStore.replacePendingRewardsForWorld(
      this.worldId,
      this.localPlayerId,
      remaining.filter((r) => r.playerScopeId === this.localPlayerId && r.worldId === this.worldId),
    );

    if (deliveredRecords > 0) {
      this.publishDiagnostics();
    }
    return deliveredRecords;
  }

  public getPendingRewardCount(): number {
    return this.worldState.pendingRewards.length;
  }

  public emit(
    triggerType: ModEventTriggerType,
    rawContext: ModEventContext = {},
  ): ModEventEmitSummary {
    const summary: ModEventEmitSummary = {
      triggerType,
      matchedCount: 0,
      executedCount: 0,
      executedEventIds: [],
      blockedEventIds: [],
    };
    if (!this.initialized) return summary;

    const isRootDispatch = this.activeEventStack.length === 0;
    if (isRootDispatch) {
      this.activeDispatchExecutions = 0;
      this.dispatchCounter += 1;
    }

    const pos = rawContext.position ?? this.bridge.getPlayerPosition();
    const health = this.bridge.getPlayerHealth();
    const ctx: ModEventContext = {
      ...rawContext,
      playerId: rawContext.playerId || this.localPlayerId,
      worldId: rawContext.worldId || this.worldId,
      timestamp: rawContext.timestamp ?? Date.now(),
      position: pos,
      playerLevel: rawContext.playerLevel ?? this.bridge.getPlayerLevel(),
      playerHealth: rawContext.playerHealth ?? health.current,
      playerMaxHealth: rawContext.playerMaxHealth ?? health.max,
    };

    const candidates = this.modManager
      .getAllModEvents()
      .filter((ev) => ev.trigger.type === triggerType)
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

    for (const ev of candidates) {
      if (!this.matchesTriggerFilters(ev, ctx)) {
        continue;
      }
      summary.matchedCount += 1;

      if (ev.validationError) {
        const entry = this.ensureRuntimeEntry(ev);
        entry.status = 'failed';
        entry.lastTriggeredAt = ctx.timestamp;
        entry.errorCode = ev.validationError.code;
        entry.error = ev.validationError.message;
        entry.failedReason = ev.validationError.message;
        summary.blockedEventIds.push(ev.id);
        continue;
      }

      if (!ev.enabled) {
        const entry = this.ensureRuntimeEntry(ev);
        entry.status = 'disabled';
        entry.lastTriggeredAt = ctx.timestamp;
        summary.blockedEventIds.push(ev.id);
        continue;
      }

      if (ev.delaySeconds > 0) {
        this.delayedQueue.push({
          eventId: ev.id,
          triggerType,
          context: { ...ctx },
          remainingSec: ev.delaySeconds,
        });
        continue;
      }

      const executed = this.tryExecuteMatchedEvent(ev, triggerType, ctx, false);
      if (executed) {
        summary.executedCount += 1;
        summary.executedEventIds.push(ev.id);
      } else {
        summary.blockedEventIds.push(ev.id);
      }
    }

    if (isRootDispatch && summary.matchedCount > 0) {
      this.publishDiagnostics();
    }

    return summary;
  }

  private tryExecuteMatchedEvent(
    ev: ModEventDefinition,
    triggerType: ModEventTriggerType,
    ctx: ModEventContext,
    skipDelayCheck: boolean,
  ): boolean {
    void skipDelayCheck;
    const nowMs = ctx.timestamp ?? Date.now();
    const playerScopeId = ctx.playerId || this.localPlayerId;
    const entry = this.ensureRuntimeEntry(ev);
    entry.lastTriggeredAt = nowMs;

    if (!ev.enabled) {
      entry.status = 'disabled';
      return false;
    }

    if (ev.validationError) {
      entry.status = 'failed';
      entry.errorCode = ev.validationError.code;
      entry.error = ev.validationError.message;
      entry.failedReason = ev.validationError.message;
      return false;
    }

    // Recursion & cycle protection for emit_event chains
    if (
      this.activeEventStack.includes(ev.id) ||
      this.activeEventStack.length >= MAX_EVENT_RECURSION_DEPTH ||
      this.activeDispatchExecutions >= MAX_DISPATCH_EXECUTIONS
    ) {
      entry.status = 'blocked_cycle';
      entry.failedReason =
        this.activeEventStack.includes(ev.id)
          ? `Blocked recursive event cycle involving "${ev.id}".`
          : `Blocked event dispatch exceeding recursion/chain budget.`;
      this.modManager.appendRuntimeEventLog('warn', entry.failedReason, ev.modId);
      return false;
    }

    // Multiplayer authority check
    if (!this.checkAuthority(ev.multiplayerAuthority, playerScopeId)) {
      entry.status = 'blocked_authority';
      entry.failedReason = `Authority "${ev.multiplayerAuthority}" disallowed in current session.`;
      return false;
    }

    // Execution limits & deduplication check
    const instanceKey = ctx.triggerInstanceId
      ? `${ev.id}::${ctx.triggerInstanceId}`
      : `${ev.id}::dispatch:${this.dispatchCounter}`;
    const limitCheck = this.checkExecutionLimits(ev, playerScopeId, nowMs, instanceKey);
    if (!limitCheck.allowed) {
      entry.status = limitCheck.status;
      entry.failedReason = limitCheck.reason;
      return false;
    }

    // Condition tree evaluation (fail safely if unresolvable)
    if (ev.condition) {
      const condRes = this.evaluateConditionNode(ev, ev.condition, ctx, playerScopeId);
      if (!condRes.passed) {
        entry.status = condRes.diagnosticError ? 'failed' : 'blocked_condition';
        entry.failedReason = condRes.reason ?? 'Condition not satisfied.';
        if (condRes.diagnosticError) {
          entry.errorCode = 'CONDITION_EVALUATION_ERROR';
          entry.error = condRes.reason;
          this.modManager.appendRuntimeEventLog(
            'warn',
            `Event "${ev.id}" condition evaluation failed safely: ${condRes.reason}`,
            ev.modId,
          );
        }
        return false;
      }
    }

    // Execute actions inside cycle-protected stack
    this.activeEventStack.push(ev.id);
    this.activeDispatchExecutions += 1;
    let actionOutcome: {
      succeededActions: number;
      failedActions: number;
      queuedPendingInventory: boolean;
      failureReasons: string[];
    };
    try {
      actionOutcome = this.executeActions(ev, triggerType, ctx, playerScopeId, nowMs);
    } finally {
      this.activeEventStack.pop();
    }

    if (
      actionOutcome.failedActions > 0 &&
      actionOutcome.succeededActions === 0 &&
      !actionOutcome.queuedPendingInventory
    ) {
      entry.status = 'failed';
      entry.failedReason = actionOutcome.failureReasons[0] ?? 'All event actions failed.';
      entry.error = entry.failedReason;
      return false;
    }

    // Record execution limits after actions succeed or queue safely
    this.recordExecution(ev, playerScopeId, nowMs, instanceKey);
    entry.executionCount = this.getRecordedWorldOrPlayerCount(ev, playerScopeId);
    entry.lastExecutedAt = nowMs;
    entry.status = actionOutcome.queuedPendingInventory ? 'pending_inventory' : 'executed';
    entry.failedReason =
      actionOutcome.failureReasons.length > 0 ? actionOutcome.failureReasons[0] : undefined;
    entry.errorCode = undefined;
    entry.error = undefined;
    return true;
  }

  private matchesTriggerFilters(ev: ModEventDefinition, ctx: ModEventContext): boolean {
    const t = ev.trigger;

    // Critical: kill events default to requiring player attribution unless explicitly opted in
    const isKillTrigger =
      t.type === 'animal_killed' ||
      t.type === 'monster_killed' ||
      t.type === 'enemy_killed' ||
      t.type === 'boss_killed' ||
      t.type === 'entity_killed' ||
      t.type === 'entity_killed_with_weapon';

    if (isKillTrigger) {
      if (ctx.isEnvironmentalDeath && !t.allowEnvironmentalDeath) {
        return false;
      }
      if (ctx.causedByPlayer === false && !t.allowNonPlayerKill && !(ctx.isEnvironmentalDeath && t.allowEnvironmentalDeath)) {
        return false;
      }
      if (t.type === 'entity_killed_with_weapon' && !ctx.weaponId) {
        return false;
      }
    }

    // Destruction / gathering / crafting must have succeeded
    const requiresSuccess =
      t.type === 'block_broken' ||
      t.type === 'object_destroyed' ||
      t.type === 'tree_chopped' ||
      t.type === 'ore_mined' ||
      t.type === 'resource_gathered' ||
      t.type === 'container_destroyed' ||
      t.type === 'structure_destroyed' ||
      t.type === 'item_crafted' ||
      t.type === 'recipe_completed';
    if (requiresSuccess && ctx.success === false) {
      return false;
    }

    if (t.npcId && !matchesIdReference(t.npcId, ev.modId, ctx.npcId, ctx.npcModId)) {
      return false;
    }
    const targetEntityId = ctx.victimEntityId ?? ctx.entityId;
    const targetModId = ctx.victimModId ?? ctx.npcModId;
    if (t.entityId && !matchesIdReference(t.entityId, ev.modId, targetEntityId, targetModId)) {
      // Also allow matching against victimType (species/archetype like 'wolf', 'bandit_scout')
      if (!matchesIdReference(t.entityId, ev.modId, ctx.victimType, targetModId)) {
        return false;
      }
    }
    if (t.entityCategory) {
      const cat = (ctx.entityCategory ?? ctx.victimType ?? '').trim().toLowerCase();
      if (cat !== t.entityCategory) return false;
    }
    if (t.itemId && !matchesIdReference(t.itemId, ev.modId, ctx.itemId)) {
      return false;
    }
    if (t.weaponId && !matchesIdReference(t.weaponId, ev.modId, ctx.weaponId)) {
      return false;
    }
    if (t.recipeId && !matchesIdReference(t.recipeId, ev.modId, ctx.recipeId)) {
      return false;
    }
    if (t.questId && !matchesIdReference(t.questId, ev.modId, ctx.questId)) {
      return false;
    }
    if (t.dialogueId) {
      if (!ctx.dialogueId || normalizeId(ctx.dialogueId) !== normalizeId(t.dialogueId)) {
        return false;
      }
    }
    if (t.choiceId) {
      if (!ctx.choiceId || normalizeId(ctx.choiceId) !== normalizeId(t.choiceId)) {
        return false;
      }
    }
    if (t.buildingId && !matchesIdReference(t.buildingId, ev.modId, ctx.buildingId ?? ctx.structureId)) {
      return false;
    }
    if (t.blockType) {
      const actualBlock = (ctx.blockType ?? ctx.resourceKind ?? ctx.itemId ?? '').trim().toLowerCase();
      if (actualBlock !== t.blockType.trim().toLowerCase()) return false;
    }
    if (t.resourceKind) {
      const actualKind = (ctx.resourceKind ?? ctx.itemId ?? '').trim().toLowerCase();
      if (actualKind !== t.resourceKind.trim().toLowerCase()) return false;
    }
    if (t.eventName) {
      if (!matchesIdReference(t.eventName, ev.modId, ctx.customEventName)) {
        return false;
      }
    }
    if (t.targetLevel !== undefined) {
      const lvl = ctx.playerLevel ?? this.bridge.getPlayerLevel();
      if (lvl !== t.targetLevel) return false;
    }
    if (t.minLevel !== undefined) {
      const lvl = ctx.playerLevel ?? this.bridge.getPlayerLevel();
      if (lvl < t.minLevel) return false;
    }
    if (t.area && t.type !== 'player_enter_area' && t.type !== 'player_reach_coordinates') {
      const inside = isPositionInsideArea(ctx.position, t.area);
      if (inside !== true) return false;
    }
    return true;
  }

  private checkAuthority(
    authority: ModEventMultiplayerAuthority,
    eventPlayerId: string,
  ): boolean {
    switch (authority) {
      case 'any':
        return true;
      case 'singleplayer_only':
        return !this.isMultiplayer;
      case 'host_only':
      case 'server_or_host':
        return !this.isMultiplayer || this.isHost;
      case 'local_player_only':
        return eventPlayerId === this.localPlayerId;
      default:
        return false;
    }
  }

  private checkExecutionLimits(
    ev: ModEventDefinition,
    playerScopeId: string,
    nowMs: number,
    instanceKey: string,
  ): { allowed: boolean; status: ModEventRuntimeStatus; reason?: string } {
    if (this.processedInstanceSet.has(instanceKey)) {
      return {
        allowed: false,
        status: 'blocked_limit',
        reason: 'Duplicate trigger instance already processed.',
      };
    }

    const pwKey = `${playerScopeId}::${ev.id}`;
    const worldCount = this.worldState.executedWorldEvents[ev.id] ?? 0;
    const totalCount = this.worldState.executionCounts[ev.id] ?? worldCount;
    const playerWorldCount = Math.max(
      this.worldState.executedPlayerWorldEvents[pwKey] ?? 0,
      this.playerStore.getExecutionCountForPlayerInWorld(playerScopeId, this.worldId, ev.id),
    );
    const playerGlobalCount = this.playerStore.getExecutionCountForPlayer(playerScopeId, ev.id);

    switch (ev.executionMode) {
      case 'once_per_world':
        if (worldCount > 0) {
          return {
            allowed: false,
            status: 'blocked_limit',
            reason: 'Event already executed once in this world.',
          };
        }
        return { allowed: true, status: 'registered' };
      case 'once_per_player':
        if (playerGlobalCount > 0) {
          return {
            allowed: false,
            status: 'blocked_limit',
            reason: 'Event already executed once for this player.',
          };
        }
        return { allowed: true, status: 'registered' };
      case 'once_per_player_per_world':
        if (playerWorldCount > 0) {
          return {
            allowed: false,
            status: 'blocked_limit',
            reason: 'Event already executed once for this player in this world.',
          };
        }
        return { allowed: true, status: 'registered' };
      case 'once_per_event':
        return { allowed: true, status: 'registered' };
      case 'max_executions': {
        const limit = ev.maxExecutions ?? 1;
        if (totalCount >= limit) {
          return {
            allowed: false,
            status: 'blocked_limit',
            reason: `Reached max executions limit (${limit}).`,
          };
        }
        return { allowed: true, status: 'registered' };
      }
      case 'repeatable_with_cooldown': {
        if (ev.maxExecutions !== undefined && totalCount >= ev.maxExecutions) {
          return {
            allowed: false,
            status: 'blocked_limit',
            reason: `Reached max executions limit (${ev.maxExecutions}).`,
          };
        }
        const cooldownMs = Math.max(0, ev.cooldownSeconds * 1000);
        const lastMs = Math.max(
          this.worldState.cooldowns[pwKey] ?? 0,
          this.playerStore.getLastCooldownMs(playerScopeId, this.worldId, ev.id),
        );
        if (cooldownMs > 0 && lastMs > 0 && nowMs - lastMs < cooldownMs) {
          return {
            allowed: false,
            status: 'blocked_cooldown',
            reason: `Event is on cooldown (${Math.ceil((cooldownMs - (nowMs - lastMs)) / 1000)}s remaining).`,
          };
        }
        return { allowed: true, status: 'registered' };
      }
      case 'repeatable':
      default:
        if (ev.maxExecutions !== undefined && totalCount >= ev.maxExecutions) {
          return {
            allowed: false,
            status: 'blocked_limit',
            reason: `Reached max executions limit (${ev.maxExecutions}).`,
          };
        }
        return { allowed: true, status: 'registered' };
    }
  }

  private recordExecution(
    ev: ModEventDefinition,
    playerScopeId: string,
    nowMs: number,
    instanceKey: string,
  ): void {
    const pwKey = `${playerScopeId}::${ev.id}`;
    this.worldState.executedWorldEvents[ev.id] =
      (this.worldState.executedWorldEvents[ev.id] ?? 0) + 1;
    this.worldState.executionCounts[ev.id] =
      (this.worldState.executionCounts[ev.id] ?? 0) + 1;
    this.worldState.executedPlayerWorldEvents[pwKey] =
      (this.worldState.executedPlayerWorldEvents[pwKey] ?? 0) + 1;
    this.worldState.cooldowns[pwKey] = nowMs;

    if (!this.processedInstanceSet.has(instanceKey)) {
      this.processedInstanceSet.add(instanceKey);
      this.worldState.processedInstanceIds.push(instanceKey);
      if (this.worldState.processedInstanceIds.length > MAX_PROCESSED_INSTANCE_IDS) {
        const dropped = this.worldState.processedInstanceIds.shift();
        if (dropped) this.processedInstanceSet.delete(dropped);
      }
    }

    this.playerStore.markExecutedForPlayer(playerScopeId, ev.id);
    this.playerStore.markExecutedForPlayerInWorld(playerScopeId, this.worldId, ev.id);
    this.playerStore.setLastCooldownMs(playerScopeId, this.worldId, ev.id, nowMs);
  }

  private getRecordedWorldOrPlayerCount(
    ev: ModEventDefinition,
    playerScopeId: string,
  ): number {
    if (ev.executionMode === 'once_per_player') {
      return this.playerStore.getExecutionCountForPlayer(playerScopeId, ev.id);
    }
    if (ev.executionMode === 'once_per_player_per_world') {
      const pwKey = `${playerScopeId}::${ev.id}`;
      return Math.max(
        this.worldState.executedPlayerWorldEvents[pwKey] ?? 0,
        this.playerStore.getExecutionCountForPlayerInWorld(playerScopeId, this.worldId, ev.id),
      );
    }
    return this.worldState.executionCounts[ev.id] ?? this.worldState.executedWorldEvents[ev.id] ?? 0;
  }

  private evaluateConditionNode(
    ev: ModEventDefinition,
    node: ModEventConditionNode,
    ctx: ModEventContext,
    playerScopeId: string,
  ): { passed: boolean; reason?: string; diagnosticError?: boolean } {
    if (node.kind === 'invalid') {
      return { passed: false, reason: node.reason, diagnosticError: true };
    }
    if (node.kind === 'all') {
      for (const child of node.conditions) {
        const res = this.evaluateConditionNode(ev, child, ctx, playerScopeId);
        if (!res.passed) return res;
      }
      return { passed: true };
    }
    if (node.kind === 'any') {
      let lastError: string | undefined;
      for (const child of node.conditions) {
        const res = this.evaluateConditionNode(ev, child, ctx, playerScopeId);
        if (res.passed) return { passed: true };
        if (res.diagnosticError) lastError = res.reason;
      }
      return {
        passed: false,
        reason: lastError ?? 'None of the OR conditions matched.',
        diagnosticError: Boolean(lastError && node.conditions.length === 1),
      };
    }
    if (node.kind === 'not') {
      const res = this.evaluateConditionNode(ev, node.condition, ctx, playerScopeId);
      if (res.diagnosticError) {
        // Fail safely: do not turn an invalid/unresolvable condition into true via NOT
        return res;
      }
      return {
        passed: !res.passed,
        reason: res.passed ? 'Negated condition was true.' : undefined,
      };
    }

    return this.evaluateLeafCondition(ev, node.predicate, ctx, playerScopeId);
  }

  private evaluateLeafCondition(
    ev: ModEventDefinition,
    pred: ModEventLeafCondition,
    ctx: ModEventContext,
    playerScopeId: string,
  ): { passed: boolean; reason?: string; diagnosticError?: boolean } {
    if (pred.multiplayerAuthority) {
      if (!this.checkAuthority(pred.multiplayerAuthority, playerScopeId)) {
        return {
          passed: false,
          reason: `Multiplayer authority "${pred.multiplayerAuthority}" rejected.`,
        };
      }
    }

    if (pred.playerLevel) {
      const lvl = ctx.playerLevel ?? this.bridge.getPlayerLevel();
      if (!Number.isFinite(lvl)) {
        return { passed: false, reason: 'Player level unavailable.', diagnosticError: true };
      }
      if (pred.playerLevel.equals !== undefined && lvl !== pred.playerLevel.equals) {
        return { passed: false, reason: `Player level ${lvl} != ${pred.playerLevel.equals}.` };
      }
      if (pred.playerLevel.min !== undefined && lvl < pred.playerLevel.min) {
        return { passed: false, reason: `Player level ${lvl} < ${pred.playerLevel.min}.` };
      }
      if (pred.playerLevel.max !== undefined && lvl > pred.playerLevel.max) {
        return { passed: false, reason: `Player level ${lvl} > ${pred.playerLevel.max}.` };
      }
    }

    if (pred.inventoryContains && pred.inventoryContains.length > 0) {
      for (const req of pred.inventoryContains) {
        const count = this.bridge.getItemCount(req.itemId);
        if (!Number.isFinite(count)) {
          return {
            passed: false,
            reason: `Unable to query item count for "${req.itemId}".`,
            diagnosticError: true,
          };
        }
        if (count < req.count) {
          return {
            passed: false,
            reason: `Requires ${req.count}x ${req.itemId} (has ${count}).`,
          };
        }
      }
    }

    if (pred.inventoryMissing && pred.inventoryMissing.length > 0) {
      for (const req of pred.inventoryMissing) {
        const count = this.bridge.getItemCount(req.itemId);
        if (!Number.isFinite(count)) {
          return {
            passed: false,
            reason: `Unable to query item count for "${req.itemId}".`,
            diagnosticError: true,
          };
        }
        if (count > req.maxCount) {
          return {
            passed: false,
            reason: `Item ${req.itemId} exceeds allowed max (${count} > ${req.maxCount}).`,
          };
        }
      }
    }

    if (pred.npcId && pred.npcId.length > 0) {
      const matched = pred.npcId.some((id) =>
        matchesIdReference(id, ev.modId, ctx.npcId, ctx.npcModId),
      );
      if (!matched) {
        return { passed: false, reason: `NPC ID "${ctx.npcId ?? ''}" did not match.` };
      }
    }

    if (pred.entityId && pred.entityId.length > 0) {
      const actualId = ctx.victimEntityId ?? ctx.entityId;
      const actualMod = ctx.victimModId ?? ctx.npcModId;
      const matched = pred.entityId.some(
        (id) =>
          matchesIdReference(id, ev.modId, actualId, actualMod) ||
          matchesIdReference(id, ev.modId, ctx.victimType, actualMod),
      );
      if (!matched) {
        return { passed: false, reason: `Entity ID "${actualId ?? ''}" did not match.` };
      }
    }

    if (pred.entityCategory && pred.entityCategory.length > 0) {
      const cat = (ctx.entityCategory ?? ctx.victimType ?? '').trim().toLowerCase();
      if (!cat || !pred.entityCategory.includes(cat)) {
        return { passed: false, reason: `Entity category "${cat}" did not match.` };
      }
    }

    if (pred.weaponId && pred.weaponId.length > 0) {
      const matched = pred.weaponId.some((id) =>
        matchesIdReference(id, ev.modId, ctx.weaponId),
      );
      if (!matched) {
        return { passed: false, reason: `Weapon "${ctx.weaponId ?? ''}" did not match.` };
      }
    }

    if (pred.biome && pred.biome.length > 0) {
      const pos = ctx.position ?? this.bridge.getPlayerPosition();
      const biome = ctx.biome ?? this.bridge.getBiomeAt(pos.x, pos.z);
      if (!biome) {
        return { passed: false, reason: 'Biome state unavailable.', diagnosticError: true };
      }
      if (!pred.biome.includes(biome)) {
        return { passed: false, reason: `Biome "${biome}" is not in allowed list.` };
      }
    }

    if (pred.position) {
      const pos = ctx.position ?? this.bridge.getPlayerPosition();
      const inside = isPositionInsideArea(pos, pred.position);
      if (inside === null) {
        return { passed: false, reason: 'Position unavailable for area condition.', diagnosticError: true };
      }
      if (!inside) {
        return { passed: false, reason: 'Player position outside configured area.' };
      }
    }

    if (pred.timeOfDay) {
      const tod = this.bridge.getTimeOfDay();
      if (!tod || !Number.isFinite(tod.hour)) {
        return { passed: false, reason: 'Time of day unavailable.', diagnosticError: true };
      }
      if (!isHourInRange(tod.hour, pred.timeOfDay.startHour, pred.timeOfDay.endHour)) {
        return { passed: false, reason: `Hour ${tod.hour.toFixed(1)} outside allowed window.` };
      }
      if (pred.timeOfDay.periods && pred.timeOfDay.periods.length > 0) {
        if (!pred.timeOfDay.periods.includes(tod.period)) {
          return { passed: false, reason: `Time period "${tod.period}" not matched.` };
        }
      }
    }

    if (pred.weather && pred.weather.length > 0) {
      const weather = this.bridge.getWeather();
      if (!weather) {
        return { passed: false, reason: 'Weather state unavailable.', diagnosticError: true };
      }
      if (!pred.weather.includes(weather)) {
        return { passed: false, reason: `Weather "${weather}" not matched.` };
      }
    }

    if (pred.questStatus) {
      const qStatus = this.bridge.getQuestStatus(pred.questStatus.questId);
      if (!qStatus) {
        return {
          passed: false,
          reason: `Quest status unavailable for "${pred.questStatus.questId}".`,
          diagnosticError: true,
        };
      }
      if (!pred.questStatus.statuses.includes(qStatus)) {
        return {
          passed: false,
          reason: `Quest "${pred.questStatus.questId}" status "${qStatus}" did not match.`,
        };
      }
    }

    if (pred.worldFlags) {
      if (pred.worldFlags.required) {
        for (const f of pred.worldFlags.required) {
          if (!this.worldState.worldFlags[f]) {
            return { passed: false, reason: `Required world flag "${f}" is false.` };
          }
        }
      }
      if (pred.worldFlags.forbidden) {
        for (const f of pred.worldFlags.forbidden) {
          if (this.worldState.worldFlags[f]) {
            return { passed: false, reason: `Forbidden world flag "${f}" is true.` };
          }
        }
      }
      if (pred.worldFlags.any && pred.worldFlags.any.length > 0) {
        const anySet = pred.worldFlags.any.some((f) => Boolean(this.worldState.worldFlags[f]));
        if (!anySet) {
          return { passed: false, reason: 'None of worldFlags.any flags are set.' };
        }
      }
    }

    if (pred.playerHealth) {
      const current = ctx.playerHealth ?? this.bridge.getPlayerHealth().current;
      const max = ctx.playerMaxHealth ?? this.bridge.getPlayerHealth().max;
      if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) {
        return { passed: false, reason: 'Player health unavailable.', diagnosticError: true };
      }
      const pct = (current / max) * 100;
      if (pred.playerHealth.min !== undefined && current < pred.playerHealth.min) {
        return { passed: false, reason: `Health ${current} < ${pred.playerHealth.min}.` };
      }
      if (pred.playerHealth.max !== undefined && current > pred.playerHealth.max) {
        return { passed: false, reason: `Health ${current} > ${pred.playerHealth.max}.` };
      }
      if (pred.playerHealth.minPercent !== undefined && pct < pred.playerHealth.minPercent) {
        return { passed: false, reason: `Health% ${pct.toFixed(0)}% < ${pred.playerHealth.minPercent}%.` };
      }
      if (pred.playerHealth.maxPercent !== undefined && pct > pred.playerHealth.maxPercent) {
        return { passed: false, reason: `Health% ${pct.toFixed(0)}% > ${pred.playerHealth.maxPercent}%.` };
      }
    }

    return { passed: true };
  }

  private executeActions(
    ev: ModEventDefinition,
    _triggerType: ModEventTriggerType,
    ctx: ModEventContext,
    playerScopeId: string,
    nowMs: number,
  ): {
    succeededActions: number;
    failedActions: number;
    queuedPendingInventory: boolean;
    failureReasons: string[];
  } {
    let succeededActions = 0;
    let failedActions = 0;
    let queuedPendingInventory = false;
    const failureReasons: string[] = [];

    for (const action of ev.actions) {
      const res = this.executeSingleAction(ev, action, ctx, playerScopeId, nowMs);
      if (res.pendingQueued) {
        queuedPendingInventory = true;
      }
      if (res.ok) {
        succeededActions += 1;
      } else {
        failedActions += 1;
        if (res.reason) failureReasons.push(res.reason);
      }
    }

    return { succeededActions, failedActions, queuedPendingInventory, failureReasons };
  }

  private executeSingleAction(
    ev: ModEventDefinition,
    action: ModEventAction,
    ctx: ModEventContext,
    playerScopeId: string,
    nowMs: number,
  ): { ok: boolean; pendingQueued?: boolean; reason?: string } {
    const lang = this.bridge.getLanguage();
    const policy: ModEventInventoryFullPolicy =
      ('inventoryFullPolicy' in action && action.inventoryFullPolicy) ||
      ev.inventoryFullPolicy ||
      'spawn_pickup';

    switch (action.type) {
      case 'give_item':
      case 'give_weapon': {
        const equip = action.type === 'give_weapon' ? Boolean(action.equip) : false;
        return this.grantItemWithPolicy(
          ev,
          [{ itemId: action.itemId, count: action.count, equip }],
          policy,
          ctx,
          playerScopeId,
          nowMs,
        );
      }
      case 'give_items': {
        return this.grantItemWithPolicy(
          ev,
          action.items.map((it) => ({ itemId: it.itemId, count: it.count })),
          policy,
          ctx,
          playerScopeId,
          nowMs,
        );
      }
      case 'spawn_world_pickup': {
        const basePos = ctx.position ?? this.bridge.getPlayerPosition();
        const x = action.x ?? basePos.x + (action.offsetX ?? 0);
        const y = action.y ?? basePos.y + (action.offsetY ?? 0);
        const z = action.z ?? basePos.z + (action.offsetZ ?? 0);
        const ok = this.bridge.spawnWorldPickup({
          itemId: action.itemId,
          count: action.count,
          x,
          y,
          z,
          modId: ev.modId,
          perPlayer: action.perPlayer,
        });
        return ok
          ? { ok: true }
          : { ok: false, reason: `Failed spawning world pickup "${action.itemId}".` };
      }
      case 'give_xp': {
        this.bridge.giveXp(action.amount);
        return { ok: true };
      }
      case 'give_currency': {
        const ok = this.bridge.giveCurrency(action.amount);
        return ok ? { ok: true } : { ok: false, reason: 'Failed granting currency.' };
      }
      case 'give_reputation': {
        const ok = this.bridge.giveReputation(action.amount, action.villageId);
        return ok ? { ok: true } : { ok: false, reason: 'Failed granting reputation.' };
      }
      case 'unlock_achievement': {
        const res = this.playerStore.unlockAchievement(playerScopeId, {
          modId: ev.modId,
          achievementId: action.achievementId,
          title: action.localizedTitle?.[lang] ?? action.localizedTitle?.en ?? action.title,
          description: action.description,
          worldId: this.worldId,
        });
        if (res.newlyUnlocked) {
          const title =
            action.localizedTitle?.[lang] ??
            action.localizedTitle?.en ??
            action.title ??
            action.achievementId;
          this.bridge.showNotification(formatDefaultModAchievementNotice(title, lang));
        }
        return { ok: true };
      }
      case 'unlock_recipe': {
        const ok = this.bridge.unlockRecipe(action.recipeId);
        return ok
          ? { ok: true }
          : { ok: false, reason: `Failed unlocking recipe "${action.recipeId}".` };
      }
      case 'start_quest': {
        const ok = this.bridge.startQuest(action.questId);
        return ok
          ? { ok: true }
          : { ok: false, reason: `Failed starting quest "${action.questId}".` };
      }
      case 'complete_quest': {
        const ok = this.bridge.completeQuest(action.questId);
        return ok
          ? { ok: true }
          : { ok: false, reason: `Failed completing quest "${action.questId}".` };
      }
      case 'set_world_flag': {
        this.setWorldFlag(action.flag, action.value);
        return { ok: true };
      }
      case 'show_notification': {
        const localizedKeyText = action.localizationKey
          ? this.bridge.resolveLocalization?.(action.localizationKey) ??
            this.modManager.resolveLocalizationOverride(lang, action.localizationKey)
          : undefined;
        const msg =
          localizedKeyText ??
          action.localized?.[lang] ??
          action.localized?.en ??
          action.message ??
          ev.name ??
          ev.eventId;
        this.bridge.showNotification(msg);
        return { ok: true };
      }
      case 'play_sound': {
        const ok = this.bridge.playSound(action.soundId);
        return ok
          ? { ok: true }
          : { ok: false, reason: `Failed playing sound "${action.soundId}".` };
      }
      case 'spawn_entity': {
        const basePos = ctx.position ?? this.bridge.getPlayerPosition();
        const x = action.x ?? basePos.x + (action.offsetX ?? 1.5);
        const y = action.y ?? basePos.y + (action.offsetY ?? 0);
        const z = action.z ?? basePos.z + (action.offsetZ ?? 1.5);
        const ok = this.bridge.spawnEntity({
          contentId: action.contentId,
          contentType: action.contentType,
          x,
          y,
          z,
          behavior: action.behavior,
          modId: ev.modId,
        });
        return ok
          ? { ok: true }
          : { ok: false, reason: `Failed spawning entity "${action.contentId}".` };
      }
      case 'start_dialogue': {
        const ok = this.bridge.startDialogue(action.npcId, action.treeId);
        return ok
          ? { ok: true }
          : { ok: false, reason: `Failed starting dialogue with "${action.npcId}".` };
      }
      case 'apply_status_effect': {
        const ok = this.bridge.applyStatusEffect({
          effectType: action.effectType,
          amount: action.amount,
          multiplier: action.multiplier,
          durationSeconds: action.durationSeconds,
        });
        return ok
          ? { ok: true }
          : { ok: false, reason: `Failed applying status effect "${action.effectType}".` };
      }
      case 'emit_event': {
        this.emit('custom_event', {
          worldId: this.worldId,
          playerId: ctx.playerId ?? playerScopeId,
          customEventName: action.eventName,
          payload: action.payload,
          position: ctx.position,
          npcId: ctx.npcId,
          npcModId: ctx.npcModId,
          entityId: ctx.entityId,
          victimEntityId: ctx.victimEntityId,
          weaponId: ctx.weaponId,
          itemId: ctx.itemId,
          questId: ctx.questId,
          triggerInstanceId: `chained:${ev.id}:${action.eventName}:${this.dispatchCounter}:${this.activeDispatchExecutions}`,
        });
        return { ok: true };
      }
    }
  }

  private grantItemWithPolicy(
    ev: ModEventDefinition,
    items: Array<{ itemId: string; count: number; equip?: boolean }>,
    policy: ModEventInventoryFullPolicy,
    ctx: ModEventContext,
    playerScopeId: string,
    nowMs: number,
  ): { ok: boolean; pendingQueued?: boolean; reason?: string } {
    const overflow: Array<{ itemId: string; count: number; equip?: boolean }> = [];
    let anyAdded = false;

    for (const req of items) {
      const res = this.bridge.giveItem(req.itemId, req.count, req.equip);
      if (res.added > 0) {
        anyAdded = true;
      }
      const remaining = Math.max(0, req.count - res.added);
      if (remaining > 0) {
        overflow.push({ ...req, count: remaining });
      }
    }

    if (overflow.length === 0) {
      return { ok: true };
    }

    if (policy === 'fail') {
      return {
        ok: anyAdded,
        reason: `Inventory full while granting ${overflow.map((o) => o.itemId).join(', ')}.`,
      };
    }

    if (policy === 'pending') {
      this.pendingIdCounter += 1;
      const pendingEntry: PendingWorldModReward = {
        id: `pend:${ev.id}:${nowMs}:${this.pendingIdCounter}`,
        modId: ev.modId,
        eventId: ev.eventId,
        fullEventId: ev.id,
        playerScopeId,
        worldId: this.worldId,
        items: overflow,
        createdAt: nowMs,
        attempts: 1,
      };
      this.worldState.pendingRewards.push(pendingEntry);
      this.playerStore.addPendingReward(pendingEntry);
      this.modManager.appendRuntimeEventLog(
        'warn',
        `Inventory full for "${ev.id}" — queued ${overflow.map((o) => `${o.count}x ${o.itemId}`).join(', ')} in pending rewards.`,
        ev.modId,
      );
      return {
        ok: true,
        pendingQueued: true,
        reason: `Inventory full; reward queued as pending.`,
      };
    }

    // policy === 'spawn_pickup'
    const basePos = ctx.position ?? this.bridge.getPlayerPosition();
    let allSpawned = true;
    for (let i = 0; i < overflow.length; i++) {
      const ov = overflow[i];
      const angle = i * 0.85;
      const offset = overflow.length > 1 ? 0.6 : 0;
      const spawned = this.bridge.spawnWorldPickup({
        itemId: ov.itemId,
        count: ov.count,
        x: basePos.x + Math.cos(angle) * offset,
        y: basePos.y,
        z: basePos.z + Math.sin(angle) * offset,
        modId: ev.modId,
      });
      if (!spawned) allSpawned = false;
    }

    return allSpawned
      ? { ok: true }
      : {
          ok: anyAdded,
          reason: `Inventory full and failed spawning overflow pickup for ${overflow.map((o) => o.itemId).join(', ')}.`,
        };
  }

  private ensureRuntimeEntry(ev: ModEventDefinition): InternalRuntimeEntry {
    let entry = this.runtimeEntries.get(ev.id);
    if (!entry) {
      const count = this.getRecordedWorldOrPlayerCount(ev, this.localPlayerId);
      entry = {
        status: ev.validationError
          ? 'failed'
          : !ev.enabled
            ? 'disabled'
            : count > 0
              ? 'executed'
              : 'registered',
        executionCount: count,
        ...(ev.validationError
          ? {
              errorCode: ev.validationError.code,
              error: ev.validationError.message,
              failedReason: ev.validationError.message,
            }
          : {}),
      };
      this.runtimeEntries.set(ev.id, entry);
    }
    return entry;
  }

  private seedInitialDiagnostics(): void {
    const events = this.modManager.getAllModEvents();
    for (const ev of events) {
      this.ensureRuntimeEntry(ev);
    }
  }

  public getDiagnostics(modId?: string): ModEventDiagnosticEntry[] {
    const events = modId
      ? this.modManager.getModEvents(modId)
      : this.modManager.getAllModEvents();

    return events.map((ev) => {
      const entry = this.ensureRuntimeEntry(ev);
      const count = Math.max(
        entry.executionCount,
        this.getRecordedWorldOrPlayerCount(ev, this.localPlayerId),
      );
      return {
        modId: ev.modId,
        eventId: ev.eventId,
        fullId: ev.id,
        triggerType: ev.trigger.type,
        executionMode: ev.executionMode,
        status: entry.status,
        executionCount: count,
        ...(entry.lastTriggeredAt ? { lastTriggeredAt: entry.lastTriggeredAt } : {}),
        ...(entry.lastExecutedAt ? { lastExecutedAt: entry.lastExecutedAt } : {}),
        ...(entry.failedReason ? { failedReason: entry.failedReason } : {}),
        ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
        ...(entry.error ? { error: entry.error } : {}),
      };
    });
  }

  private publishDiagnostics(): void {
    this.modManager.setRuntimeEventDiagnostics(this.getDiagnostics());
  }
}
