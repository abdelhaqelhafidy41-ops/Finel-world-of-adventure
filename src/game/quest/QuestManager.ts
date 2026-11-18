import { getAllQuestDefinitions, getQuestDefinition } from './questRegistry';
import { AR_QUESTS } from '../i18n/arContent';
import { UI_TEXT, type Language } from '../i18n/translations';
import type {
  QuestDefinition,
  QuestObjectiveDef,
  QuestObjectiveView,
  QuestReward,
  QuestStatus,
  QuestView,
  QuestWorldContext,
} from './questTypes';
import type {
  CoopObjectiveState,
  CoopQuestStateRecord,
} from '../../../shared/multiplayerProtocol';
import { PLAYABLE_RADIUS } from '../math/noise';
import { isLand } from '../world/WorldPlacementValidator';
import type { BiomeType } from '../types';
import type { SavedQuestState } from '../save/saveTypes';
import { enemyTypeMatches, normalizeEnemyTypeAlias } from '../world/WorldEntityRegistry';

interface ActiveQuestRuntime {
  questId: string;
  completedObjectiveIds: Set<string>;
  talkedCounts: Map<string, number>;
  killCounts: Map<string, number>;
  craftCounts: Map<string, number>;
  sleepCounts: Map<string, number>;
  reachedLocations: Set<string>;
  exploredAreas: Set<string>;
  creditedKillEntityIds: Set<string>;
}

export interface QuestActionCallbacks {
  consumeItem: (itemId: string, count: number) => void;
  giveItem: (item: {
    id: string;
    name: string;
    description: string;
    count?: number;
    usable?: boolean;
  }) => void;
  grantRewards: (reward: QuestReward, questTitle: string) => void;
  notify: (message: string) => void;
}

/**
 * Modular QuestManager handling active quests, completed quests,
 * all quest objective types (including crafting & sleeping), HUD quest tracking, and rewards.
 */
export class QuestManager {
  private readonly active = new Map<string, ActiveQuestRuntime>();
  private readonly completed = new Set<string>();
  private readonly cancelled = new Set<string>();
  private trackedQuestId: string | null = null;
  private language: Language = 'en';
  private onQuestUpdatedCb?: (questId: string, status: string, stepIndex: number) => void;
  private onQuestCancelledCb?: (questId: string) => void;
  private isApplyingRemoteUpdate = false;
  private coopObjective: CoopObjectiveState | null = null;
  private readonly coopQuestStates = new Map<string, CoopQuestStateRecord>();
  private localPlayerId: string | null = null;

  public setLocalPlayerId(playerId: string | null): void {
    this.localPlayerId = playerId;
  }

  public setCoopObjective(obj: CoopObjectiveState | null): void {
    this.coopObjective = obj ? { ...obj } : null;
  }

  public getCoopObjective(): CoopObjectiveState | null {
    return this.coopObjective;
  }

  public setCoopQuestStates(records: CoopQuestStateRecord[]): void {
    this.coopQuestStates.clear();
    for (const r of records) {
      this.applyCoopQuestState(r);
    }
  }

  public applyCoopQuestState(record: CoopQuestStateRecord): void {
    if (!record || typeof record.questId !== 'string') return;
    this.coopQuestStates.set(record.questId, record);

    const def = getQuestDefinition(record.questId);
    if (!def) return;

    const localClaimed =
      this.completed.has(record.questId) ||
      Boolean(
        this.localPlayerId &&
          Array.isArray(record.completedByPlayerIds) &&
          record.completedByPlayerIds.includes(this.localPlayerId),
      );
    if (localClaimed) {
      this.completed.add(record.questId);
      this.active.delete(record.questId);
      return;
    }

    if (!this.active.has(record.questId)) {
      this.active.set(record.questId, {
        questId: record.questId,
        completedObjectiveIds: new Set(),
        talkedCounts: new Map(),
        killCounts: new Map(),
        craftCounts: new Map(),
        sleepCounts: new Map(),
        reachedLocations: new Set(),
        exploredAreas: new Set(),
        creditedKillEntityIds: new Set(),
      });
      if (!this.trackedQuestId) {
        this.trackedQuestId = record.questId;
      }
    }

    const rt = this.active.get(record.questId);
    if (rt) {
      for (const obj of def.objectives) {
        if (obj.type === 'kill_enemies') {
          rt.killCounts.set(obj.id, Math.max(0, record.progress));
          if (record.progress >= obj.requiredCount || record.status === 'completed') {
            rt.completedObjectiveIds.add(obj.id);
          } else {
            rt.completedObjectiveIds.delete(obj.id);
          }
        }
      }
    }
  }

  public getCoopQuestStates(): CoopQuestStateRecord[] {
    return Array.from(this.coopQuestStates.values());
  }

  public getCoopQuestState(questId: string): CoopQuestStateRecord | null {
    return this.coopQuestStates.get(questId) ?? null;
  }

  public setLanguage(lang: Language): void {
    this.language = lang;
  }

  public setOnQuestUpdated(
    cb: ((questId: string, status: string, stepIndex: number) => void) | undefined,
  ): void {
    this.onQuestUpdatedCb = cb;
  }

  public setOnQuestCancelled(cb: ((questId: string) => void) | undefined): void {
    this.onQuestCancelledCb = cb;
  }

  public isQuestCancelled(questId: string): boolean {
    return this.cancelled.has(questId);
  }

  public cancelQuest(questId: string): boolean {
    const hadActive = this.active.delete(questId);
    this.coopQuestStates.delete(questId);
    this.cancelled.add(questId);
    if (this.trackedQuestId === questId) {
      const next = this.active.keys().next();
      this.trackedQuestId = next.done ? null : next.value;
    }
    this.onQuestCancelledCb?.(questId);
    return hadActive;
  }

  private emitQuestUpdated(questId: string): void {
    if (this.isApplyingRemoteUpdate || !this.onQuestUpdatedCb) return;
    const def = getQuestDefinition(questId);
    if (!def) return;
    if (def.scope === 'cooperative' && this.localPlayerId) return;
    if (this.completed.has(questId)) {
      this.onQuestUpdatedCb(questId, 'completed', def.objectives.length);
      return;
    }
    const rt = this.active.get(questId);
    if (!rt) return;
    this.onQuestUpdatedCb(questId, 'active', rt.completedObjectiveIds.size);
  }

  public exportSyncQuests(): Array<{ questId: string; status: string; stepIndex: number }> {
    const out: Array<{ questId: string; status: string; stepIndex: number }> = [];
    for (const questId of this.completed) {
      const def = getQuestDefinition(questId);
      out.push({
        questId,
        status: 'completed',
        stepIndex: def?.objectives.length ?? 0,
      });
    }
    for (const [questId, rt] of this.active) {
      out.push({
        questId,
        status: 'active',
        stepIndex: rt.completedObjectiveIds.size,
      });
    }
    return out;
  }

  public applyRemoteQuestUpdate(
    questId: string,
    status: string,
    stepIndex: number,
    ctx?: QuestWorldContext,
  ): void {
    const def = getQuestDefinition(questId);
    if (!def) return;

    this.isApplyingRemoteUpdate = true;
    try {
      if (status === 'completed') {
        this.active.delete(questId);
        this.completed.add(questId);
        if (this.trackedQuestId === questId) {
          const next = this.active.keys().next();
          this.trackedQuestId = next.done ? null : next.value;
        }
        return;
      }

      if (this.completed.has(questId)) {
        return;
      }

      let runtime = this.active.get(questId);
      if (!runtime) {
        runtime = {
          questId,
          completedObjectiveIds: new Set(),
          talkedCounts: new Map(),
          killCounts: new Map(),
          craftCounts: new Map(),
          sleepCounts: new Map(),
          reachedLocations: new Set(),
          exploredAreas: new Set(),
          creditedKillEntityIds: new Set(),
        };
        this.active.set(questId, runtime);
        if (!this.trackedQuestId) {
          this.trackedQuestId = questId;
        }
      }

      const clampedStep = Math.max(0, Math.min(def.objectives.length, stepIndex));
      for (let i = 0; i < clampedStep; i++) {
        const obj = def.objectives[i];
        runtime.completedObjectiveIds.add(obj.id);
        if (obj.type === 'reach_location') {
          runtime.reachedLocations.add(obj.id);
        } else if (obj.type === 'explore_area') {
          runtime.exploredAreas.add(obj.id);
        } else if (obj.type === 'kill_enemies') {
          runtime.killCounts.set(obj.id, obj.requiredCount);
        } else if (obj.type === 'craft_item') {
          runtime.craftCounts.set(obj.id, obj.requiredCount);
        } else if (obj.type === 'sleep_night') {
          runtime.sleepCounts.set(obj.id, obj.requiredCount);
        } else if (obj.type === 'talk_to_npc') {
          runtime.talkedCounts.set(obj.id, 1);
        }
      }

      if (ctx) {
        this.evaluateRuntime(def, runtime, ctx, false);
      }
    } finally {
      this.isApplyingRemoteUpdate = false;
    }
  }

  private getQuestTitle(def: QuestDefinition): string {
    if (this.language === 'ar') {
      return AR_QUESTS[def.id]?.title ?? def.titleAr ?? def.title;
    }
    return def.title;
  }

  private getObjectiveDesc(def: QuestDefinition, obj: QuestObjectiveDef): string {
    if (this.language === 'ar') {
      return AR_QUESTS[def.id]?.objectives[obj.id] ?? obj.descriptionAr ?? obj.description;
    }
    return obj.description;
  }

  public validateQuestActivation(
    def: QuestDefinition,
    ctx?: QuestWorldContext,
  ): { valid: boolean; reason?: string } {
    if (!def.objectives || def.objectives.length === 0) {
      return { valid: false, reason: 'Quest has no objectives.' };
    }
    if (ctx?.hasNpc && def.giverNpcId && !ctx.hasNpc(def.giverNpcId)) {
      return { valid: false, reason: `Quest giver NPC ${def.giverNpcId} not found.` };
    }
    if (ctx?.hasNpc && def.turnInNpcId && !ctx.hasNpc(def.turnInNpcId)) {
      return { valid: false, reason: `Quest turn-in NPC ${def.turnInNpcId} not found.` };
    }

    const giverPos = def.giverNpcId ? (ctx?.getNpcPosition?.(def.giverNpcId) ?? null) : null;

    for (const obj of def.objectives) {
      if (obj.type === 'talk_to_npc') {
        if (ctx?.hasNpc && !ctx.hasNpc(obj.npcId)) {
          return { valid: false, reason: `Target NPC ${obj.npcId} does not exist.` };
        }
      } else if (obj.type === 'deliver_items') {
        if (obj.requiredCount <= 0) {
          return { valid: false, reason: `Invalid deliver count for ${obj.itemId}.` };
        }
        if (ctx?.hasNpc && !ctx.hasNpc(obj.targetNpcId)) {
          return { valid: false, reason: `Delivery NPC ${obj.targetNpcId} does not exist.` };
        }
        if (
          ctx?.validateResourceLocation &&
          ctx.getItemCount(obj.itemId) < obj.requiredCount
        ) {
          const resCheck = ctx.validateResourceLocation(obj.itemId, giverPos?.x, giverPos?.z);
          if (!resCheck.valid) {
            return resCheck;
          }
        }
      } else if (obj.type === 'collect_items') {
        if (obj.requiredCount <= 0) {
          return { valid: false, reason: `Invalid collect count for ${obj.itemId}.` };
        }
        if (
          ctx?.validateResourceLocation &&
          ctx.getItemCount(obj.itemId) < obj.requiredCount
        ) {
          const resCheck = ctx.validateResourceLocation(obj.itemId, giverPos?.x, giverPos?.z);
          if (!resCheck.valid) {
            return resCheck;
          }
        }
      } else if (obj.type === 'reach_location') {
        if (
          !Number.isFinite(obj.x) ||
          !Number.isFinite(obj.z) ||
          obj.radius <= 0 ||
          Math.hypot(obj.x, obj.z) > PLAYABLE_RADIUS - 20 ||
          !isLand(obj.x, obj.z, 0.25)
        ) {
          return { valid: false, reason: `Reach location (${obj.x}, ${obj.z}) is not on reachable land.` };
        }
      } else if (obj.type === 'kill_enemies') {
        if (obj.requiredCount <= 0) {
          return { valid: false, reason: `Invalid kill count for ${obj.enemyType}.` };
        }
        if (ctx?.validateKillTarget) {
          const killCheck = ctx.validateKillTarget(obj, def.giverNpcId);
          if (!killCheck.valid) {
            return { valid: false, reason: killCheck.reason ?? `No valid spawn location for ${obj.enemyType}.` };
          }
        }
      } else if (obj.type === 'craft_item' || obj.type === 'sleep_night') {
        if (obj.requiredCount <= 0) {
          return { valid: false, reason: 'Objective requiredCount must be positive.' };
        }
      }
    }

    return { valid: true };
  }

  public acceptQuest(
    questId: string,
    ctx?: QuestWorldContext,
    initiatorNpcId?: string,
  ): boolean {
    const def = getQuestDefinition(questId);
    if (!def || this.completed.has(questId) || this.active.has(questId)) {
      return false;
    }
    const validation = this.validateQuestActivation(def, ctx);
    if (!validation.valid) {
      return false;
    }
    this.cancelled.delete(questId);

    const runtime: ActiveQuestRuntime = {
      questId,
      completedObjectiveIds: new Set(),
      talkedCounts: new Map(),
      killCounts: new Map(),
      craftCounts: new Map(),
      sleepCounts: new Map(),
      reachedLocations: new Set(),
      exploredAreas: new Set(),
      creditedKillEntityIds: new Set(),
    };
    this.active.set(questId, runtime);
    this.trackedQuestId = questId;

    // If the quest begins by speaking with the NPC we're already talking to, satisfy step 1 immediately
    if (initiatorNpcId && def.objectives.length > 0) {
      const first = def.objectives[0];
      if (first.type === 'talk_to_npc' && first.npcId === initiatorNpcId) {
        runtime.completedObjectiveIds.add(first.id);
      }
    }

    if (ctx) {
      this.evaluateRuntime(def, runtime, ctx, false);
    }

    this.emitQuestUpdated(questId);
    return true;
  }

  public completeQuest(
    questId: string,
    ctx: QuestWorldContext,
    callbacks: QuestActionCallbacks,
  ): boolean {
    const def = getQuestDefinition(questId);
    if (!def || this.completed.has(questId)) {
      return false;
    }
    const coop = def.scope === 'cooperative' ? this.coopQuestStates.get(questId) : undefined;
    const runtime = this.active.get(questId);
    if (!runtime && !(coop && (coop.status === 'completed' || coop.progress >= coop.targetCount))) {
      return false;
    }

    // Consume required items for objectives configured with consumeOnComplete
    for (const obj of def.objectives) {
      if (
        (obj.type === 'collect_items' || obj.type === 'deliver_items') &&
        obj.consumeOnComplete
      ) {
        if (ctx.getItemCount(obj.itemId) < obj.requiredCount) {
          return false;
        }
      }
    }

    for (const obj of def.objectives) {
      if (
        (obj.type === 'collect_items' || obj.type === 'deliver_items') &&
        obj.consumeOnComplete
      ) {
        callbacks.consumeItem(obj.itemId, obj.requiredCount);
      }
    }

    this.active.delete(questId);
    this.completed.add(questId);

    // Grant item, XP, coin, and stat rewards (server handles multiplayer cooperative rewards via LOOT_GRANTED)
    if (!(def.scope === 'cooperative' && this.localPlayerId)) {
      if (def.reward.items) {
        for (const item of def.reward.items) {
          callbacks.giveItem(item);
        }
      }
      callbacks.grantRewards(def.reward, this.getQuestTitle(def));
    }

    // Move HUD tracker to next remaining active quest if needed
    if (this.trackedQuestId === questId) {
      const next = this.active.keys().next();
      this.trackedQuestId = next.done ? null : next.value;
    }

    this.emitQuestUpdated(questId);
    return true;
  }

  public setTrackedQuest(questId: string | null): void {
    if (questId === null) {
      this.trackedQuestId = null;
      return;
    }
    if (this.active.has(questId)) {
      this.trackedQuestId = questId;
    }
  }

  public getTrackedQuestId(): string | null {
    if (this.trackedQuestId && this.active.has(this.trackedQuestId)) {
      return this.trackedQuestId;
    }
    const first = this.active.keys().next();
    return first.done ? null : first.value;
  }

  public getTrackedQuestView(ctx: QuestWorldContext): QuestView | null {
    const id = this.getTrackedQuestId();
    if (!id) return null;
    return this.getQuestView(id, ctx);
  }

  public getQuestStatus(questId: string, ctx: QuestWorldContext): QuestStatus {
    const def = getQuestDefinition(questId);
    if (!def) return 'available';

    const coop = def.scope === 'cooperative' ? this.coopQuestStates.get(questId) : undefined;
    if (coop) {
      const localClaimed =
        this.completed.has(questId) ||
        Boolean(this.localPlayerId && coop.completedByPlayerIds.includes(this.localPlayerId));
      if (localClaimed) return 'completed';
      if (coop.status === 'completed' || coop.progress >= coop.targetCount) {
        return 'ready';
      }
      return 'active';
    }

    if (this.completed.has(questId)) return 'completed';
    const runtime = this.active.get(questId);
    if (!runtime) return 'available';

    this.evaluateRuntime(def, runtime, ctx, false);
    const allDone = def.objectives.every((obj) =>
      this.isObjectiveDone(def, runtime, obj, ctx),
    );
    return allDone ? 'ready' : 'active';
  }

  /**
   * Called each gameplay tick (or after inventory/landmark updates) to progress
   * reach_location, explore_area, and collect_items objectives.
   */
  public update(ctx: QuestWorldContext, notify?: (msg: string) => void): boolean {
    let changed = false;
    for (const [questId, runtime] of this.active) {
      const def = getQuestDefinition(questId);
      if (!def) continue;
      if (this.evaluateRuntime(def, runtime, ctx, true, notify)) {
        changed = true;
        this.emitQuestUpdated(questId);
      }
    }
    return changed;
  }

  /**
   * Fires when the player initiates dialogue with an NPC.
   * Advances at most one active talk_to_npc or deliver_items step per conversation.
   */
  public onNpcTalked(
    npcId: string,
    ctx: QuestWorldContext,
    notify?: (msg: string) => void,
  ): boolean {
    let changed = false;
    for (const [questId, runtime] of this.active) {
      const def = getQuestDefinition(questId);
      if (!def) continue;

      const activeObjs = this.getCurrentlyActiveObjectives(def, runtime, ctx);
      for (const obj of activeObjs) {
        if (obj.type === 'talk_to_npc' && obj.npcId === npcId) {
          runtime.completedObjectiveIds.add(obj.id);
          runtime.talkedCounts.set(obj.id, 1);
          changed = true;
          this.evaluateRuntime(def, runtime, ctx, false);
          if (notify) {
            const nextView = this.getQuestView(questId, ctx);
            if (nextView && nextView.status === 'active') {
              notify(`${this.getQuestTitle(def)}: ${nextView.currentObjectiveText}`);
            }
          }
          break; // Advance one talk step per interaction
        }

        if (
          obj.type === 'deliver_items' &&
          obj.targetNpcId === npcId &&
          ctx.getItemCount(obj.itemId) >= obj.requiredCount
        ) {
          runtime.completedObjectiveIds.add(obj.id);
          changed = true;
          break;
        }
      }
      if (changed) {
        this.emitQuestUpdated(questId);
      }
    }
    return changed;
  }

  /**
   * Event hook for combat enemies or hunted wildlife: advances matching kill_enemies objectives.
   * Deduplicates repeated death notifications for the same authoritative `targetEntityId`.
   */
  public onEnemyKilled(
    enemyType: string,
    ctx: QuestWorldContext,
    notify?: (msg: string) => void,
    targetEntityId?: string,
  ): boolean {
    let changed = false;
    for (const [questId, runtime] of this.active) {
      if (this.cancelled.has(questId) || this.completed.has(questId)) continue;
      const def = getQuestDefinition(questId);
      if (!def) continue;
      if (def.scope === 'cooperative' && this.localPlayerId) continue;
      if (targetEntityId && runtime.creditedKillEntityIds.has(targetEntityId)) continue;

      const activeObjs = this.getCurrentlyActiveObjectives(def, runtime, ctx);
      let questCredited = false;
      for (const obj of activeObjs) {
        if (obj.type !== 'kill_enemies') continue;
        const current = runtime.killCounts.get(obj.id) ?? 0;
        if (current >= obj.requiredCount) continue;
        if (!enemyTypeMatches(obj.enemyType, enemyType)) continue;

        const next = Math.min(obj.requiredCount, current + 1);
        runtime.killCounts.set(obj.id, next);
        if (next >= obj.requiredCount) {
          runtime.completedObjectiveIds.add(obj.id);
        }
        questCredited = true;
        changed = true;
        this.evaluateRuntime(def, runtime, ctx, false);
        if (notify) {
          notify(
            `${this.getQuestTitle(def)}: ${this.getObjectiveDesc(def, obj)} (${next}/${obj.requiredCount})`,
          );
        }
      }
      if (questCredited) {
        if (targetEntityId) {
          runtime.creditedKillEntityIds.add(targetEntityId);
        }
        this.emitQuestUpdated(questId);
      }
    }
    return changed;
  }

  /**
   * Returns all currently active kill objectives that still need remaining targets spawned/killed.
   */
  public getActiveKillObjectives(ctx: QuestWorldContext): Array<{
    questId: string;
    objectiveId: string;
    enemyType: string;
    canonicalEnemyType: string;
    requiredCount: number;
    currentCount: number;
    remainingCount: number;
    targetX?: number;
    targetZ?: number;
    targetBiome?: BiomeType;
  }> {
    const out: Array<{
      questId: string;
      objectiveId: string;
      enemyType: string;
      canonicalEnemyType: string;
      requiredCount: number;
      currentCount: number;
      remainingCount: number;
      targetX?: number;
      targetZ?: number;
      targetBiome?: BiomeType;
    }> = [];

    for (const [questId, runtime] of this.active) {
      if (this.cancelled.has(questId) || this.completed.has(questId)) continue;
      const def = getQuestDefinition(questId);
      if (!def) continue;
      const activeObjs = this.getCurrentlyActiveObjectives(def, runtime, ctx);
      for (const obj of activeObjs) {
        if (obj.type !== 'kill_enemies') continue;
        const coop = def.scope === 'cooperative' ? this.coopQuestStates.get(questId) : undefined;
        const currentCount = coop ? coop.progress : (runtime.killCounts.get(obj.id) ?? 0);
        const targetCount = coop ? coop.targetCount : obj.requiredCount;
        const remainingCount = Math.max(0, targetCount - currentCount);
        if (remainingCount <= 0) continue;
        const giverPos = def.giverNpcId ? (ctx.getNpcPosition?.(def.giverNpcId) ?? null) : null;
        out.push({
          questId,
          objectiveId: obj.id,
          enemyType: obj.enemyType,
          canonicalEnemyType: normalizeEnemyTypeAlias(obj.enemyType),
          requiredCount: targetCount,
          currentCount,
          remainingCount,
          targetX: obj.targetX ?? giverPos?.x,
          targetZ: obj.targetZ ?? giverPos?.z,
          targetBiome: obj.targetBiome,
        });
      }
    }
    return out;
  }

  /**
   * Event hook for crafted items: advances matching craft_item objectives.
   */
  public onItemCrafted(
    itemId: string,
    count: number,
    ctx: QuestWorldContext,
    notify?: (msg: string) => void,
  ): boolean {
    let changed = false;
    for (const [questId, runtime] of this.active) {
      const def = getQuestDefinition(questId);
      if (!def) continue;
      const activeObjs = this.getCurrentlyActiveObjectives(def, runtime, ctx);
      for (const obj of activeObjs) {
        if (obj.type === 'craft_item' && obj.itemId === itemId) {
          const next = (runtime.craftCounts.get(obj.id) ?? 0) + Math.max(1, count);
          runtime.craftCounts.set(obj.id, next);
          if (next >= obj.requiredCount) {
            runtime.completedObjectiveIds.add(obj.id);
          }
          changed = true;
          this.evaluateRuntime(def, runtime, ctx, false);
          if (notify) {
            notify(
              `${this.getQuestTitle(def)}: ${this.getObjectiveDesc(def, obj)} (${Math.min(next, obj.requiredCount)}/${obj.requiredCount})`,
            );
          }
          this.emitQuestUpdated(questId);
        }
      }
    }
    return changed;
  }

  /**
   * Event hook for sleeping in a bed: advances matching sleep_night objectives.
   */
  public onPlayerSlept(
    ctx: QuestWorldContext,
    notify?: (msg: string) => void,
  ): boolean {
    let changed = false;
    for (const [questId, runtime] of this.active) {
      const def = getQuestDefinition(questId);
      if (!def) continue;
      const activeObjs = this.getCurrentlyActiveObjectives(def, runtime, ctx);
      for (const obj of activeObjs) {
        if (obj.type === 'sleep_night') {
          const next = (runtime.sleepCounts.get(obj.id) ?? 0) + 1;
          runtime.sleepCounts.set(obj.id, next);
          if (next >= obj.requiredCount) {
            runtime.completedObjectiveIds.add(obj.id);
          }
          changed = true;
          this.evaluateRuntime(def, runtime, ctx, false);
          if (notify) {
            notify(
              `${this.getQuestTitle(def)}: ${this.getObjectiveDesc(def, obj)} (${Math.min(next, obj.requiredCount)}/${obj.requiredCount})`,
            );
          }
          this.emitQuestUpdated(questId);
        }
      }
    }
    return changed;
  }

  public getQuestView(questId: string, ctx: QuestWorldContext): QuestView | null {
    const def = getQuestDefinition(questId);
    if (!def) return null;

    const status = this.getQuestStatus(questId, ctx);
    const runtime = this.active.get(questId);
    const sequential = def.sequential !== false;
    const trackedId = this.getTrackedQuestId();

    const t = UI_TEXT[this.language];
    const isAr = this.language === 'ar';
    const arMeta = isAr ? AR_QUESTS[def.id] : undefined;
    const title = arMeta?.title ?? (isAr ? (def.titleAr ?? def.title) : def.title);
    const description = arMeta?.description ?? (isAr ? (def.descriptionAr ?? def.description) : def.description);
    const rewardSummary = arMeta?.rewardSummary ?? (isAr ? (def.rewardSummaryAr ?? def.rewardSummary) : def.rewardSummary);

    const coop = def.scope === 'cooperative' ? this.coopQuestStates.get(questId) : undefined;
    const coopClaimed = Boolean(
      coop &&
        (this.completed.has(questId) ||
          (this.localPlayerId && coop.completedByPlayerIds.includes(this.localPlayerId))),
    );

    const objectiveViews: QuestObjectiveView[] = [];
    let foundFirstIncomplete = false;

    for (const obj of def.objectives) {
      const isCoopKill = Boolean(coop && obj.type === 'kill_enemies');
      const isCompleted =
        status === 'completed'
          ? true
          : isCoopKill && coop
            ? coop.progress >= coop.targetCount || coop.status === 'completed'
            : runtime
              ? this.isObjectiveDone(def, runtime, obj, ctx)
              : false;

      const isActive =
        status === 'active' || status === 'ready'
          ? sequential
            ? !isCompleted && !foundFirstIncomplete
            : !isCompleted
          : false;

      if (!isCompleted) {
        foundFirstIncomplete = true;
      }

      const rawCounts = this.getObjectiveCounts(
        obj,
        runtime,
        ctx,
        status === 'completed',
      );
      const current =
        isCoopKill && coop
          ? Math.min(coop.progress, coop.targetCount)
          : rawCounts.current;
      const target = isCoopKill && coop ? coop.targetCount : rawCounts.target;

      objectiveViews.push({
        id: obj.id,
        type: obj.type,
        description: arMeta?.objectives[obj.id] ?? (isAr ? (obj.descriptionAr ?? obj.description) : obj.description),
        current,
        target,
        completed: isCompleted,
        active: isActive,
      });
    }

    const activeStep =
      objectiveViews.find((o) => o.active) ??
      objectiveViews[objectiveViews.length - 1];

    let currentObjectiveText = description;
    if (status === 'completed') {
      currentObjectiveText = t.completedWord;
    } else if (status === 'ready') {
      currentObjectiveText = def.turnInNpcId
        ? t.readyToTurnIn
        : t.readyToComplete;
    } else if (activeStep) {
      currentObjectiveText =
        activeStep.target > 1
          ? `${activeStep.description} (${activeStep.current}/${activeStep.target})`
          : activeStep.description;
    }

    const completedCount = objectiveViews.filter((o) => o.completed).length;
    const progressText =
      status === 'completed'
        ? t.completedWord
        : status === 'ready'
          ? `${def.turnInNpcId ? t.readyToTurnIn : t.readyToComplete} (${completedCount}/${objectiveViews.length})`
          : status === 'active'
            ? currentObjectiveText
            : `${t.availablePrefix} · ${objectiveViews[0]?.description ?? title}`;

    return {
      id: def.id,
      title,
      description,
      scope: def.scope ?? 'personal',
      status,
      giverNpcId: def.giverNpcId,
      turnInNpcId: def.turnInNpcId,
      objectives: objectiveViews,
      currentObjectiveText,
      progressText,
      reward: def.reward,
      rewardSummary,
      tracked: trackedId === def.id,
      ...(coop
        ? {
            coopProgress: coop.progress,
            coopTargetCount: coop.targetCount,
            coopContributorCount: Object.keys(coop.contributors ?? {}).length,
            coopClaimed,
          }
        : {}),
    };
  }

  public getActiveQuests(ctx: QuestWorldContext): QuestView[] {
    const result: QuestView[] = [];
    for (const questId of this.active.keys()) {
      const view = this.getQuestView(questId, ctx);
      if (view) result.push(view);
    }
    return result;
  }

  public getCompletedQuests(ctx: QuestWorldContext): QuestView[] {
    const result: QuestView[] = [];
    for (const questId of this.completed) {
      const view = this.getQuestView(questId, ctx);
      if (view) result.push(view);
    }
    return result;
  }

  public getAvailableQuests(ctx: QuestWorldContext): QuestView[] {
    const result: QuestView[] = [];
    for (const def of getAllQuestDefinitions()) {
      if (!this.active.has(def.id) && !this.completed.has(def.id)) {
        const view = this.getQuestView(def.id, ctx);
        if (view) result.push(view);
      }
    }
    return result;
  }

  public getAllQuestsForJournal(ctx: QuestWorldContext): QuestView[] {
    return getAllQuestDefinitions()
      .map((def) => this.getQuestView(def.id, ctx))
      .filter((v): v is QuestView => v !== null);
  }

  private getCurrentlyActiveObjectives(
    def: QuestDefinition,
    runtime: ActiveQuestRuntime,
    ctx: QuestWorldContext,
  ): QuestObjectiveDef[] {
    const sequential = def.sequential !== false;
    if (!sequential) {
      return def.objectives.filter(
        (obj) => !this.isObjectiveDone(def, runtime, obj, ctx),
      );
    }
    const next = def.objectives.find(
      (obj) => !this.isObjectiveDone(def, runtime, obj, ctx),
    );
    return next ? [next] : [];
  }

  private evaluateRuntime(
    def: QuestDefinition,
    runtime: ActiveQuestRuntime,
    ctx: QuestWorldContext,
    allowNotify: boolean,
    notify?: (msg: string) => void,
  ): boolean {
    let changed = false;
    const sequential = def.sequential !== false;

    for (const obj of def.objectives) {
      const alreadyDone = runtime.completedObjectiveIds.has(obj.id);
      let newlyDone = false;

      if (obj.type === 'reach_location') {
        const dist = Math.hypot(ctx.playerX - obj.x, ctx.playerZ - obj.z);
        if (dist <= obj.radius) {
          runtime.reachedLocations.add(obj.id);
          if (!alreadyDone) newlyDone = true;
        }
      } else if (obj.type === 'explore_area') {
        let explored = false;
        if (obj.biome && ctx.currentBiome === obj.biome) {
          explored = true;
        } else if (
          obj.minLandmarks !== undefined &&
          ctx.getDiscoveredLandmarksCount() >= obj.minLandmarks
        ) {
          explored = true;
        } else if (obj.areaCenter) {
          const dist = Math.hypot(
            ctx.playerX - obj.areaCenter.x,
            ctx.playerZ - obj.areaCenter.z,
          );
          if (dist <= obj.areaCenter.radius) explored = true;
        }
        if (explored) {
          runtime.exploredAreas.add(obj.id);
          if (!alreadyDone) newlyDone = true;
        }
      } else if (obj.type === 'collect_items') {
        const count = ctx.getItemCount(obj.itemId);
        if (count >= obj.requiredCount) {
          if (!alreadyDone) newlyDone = true;
        } else if (obj.consumeOnComplete && alreadyDone) {
          runtime.completedObjectiveIds.delete(obj.id);
          changed = true;
        }
      } else if (obj.type === 'craft_item') {
        // If player already holds the crafted item when reaching this step, count it
        const crafted = Math.max(
          runtime.craftCounts.get(obj.id) ?? 0,
          ctx.getItemCount(obj.itemId),
        );
        if (crafted >= obj.requiredCount && !alreadyDone) {
          runtime.craftCounts.set(obj.id, crafted);
          newlyDone = true;
        }
      }

      if (newlyDone) {
        runtime.completedObjectiveIds.add(obj.id);
        changed = true;
        if (allowNotify && notify) {
          notify(
            `${UI_TEXT[this.language].objectiveCompletePrefix}: ${this.getObjectiveDesc(def, obj)}`,
          );
        }
      }

      if (sequential && !this.isObjectiveDone(def, runtime, obj, ctx)) {
        break;
      }
    }

    return changed;
  }

  private isObjectiveDone(
    _def: QuestDefinition,
    runtime: ActiveQuestRuntime,
    obj: QuestObjectiveDef,
    ctx: QuestWorldContext,
  ): boolean {
    switch (obj.type) {
      case 'talk_to_npc':
        return runtime.completedObjectiveIds.has(obj.id);
      case 'collect_items':
        return obj.consumeOnComplete
          ? ctx.getItemCount(obj.itemId) >= obj.requiredCount
          : runtime.completedObjectiveIds.has(obj.id) ||
              ctx.getItemCount(obj.itemId) >= obj.requiredCount;
      case 'deliver_items':
        return (
          runtime.completedObjectiveIds.has(obj.id) &&
          (!obj.consumeOnComplete || ctx.getItemCount(obj.itemId) >= obj.requiredCount)
        );
      case 'reach_location':
        return runtime.reachedLocations.has(obj.id);
      case 'explore_area':
        return runtime.exploredAreas.has(obj.id);
      case 'kill_enemies':
        return (runtime.killCounts.get(obj.id) ?? 0) >= obj.requiredCount;
      case 'craft_item':
        return (
          runtime.completedObjectiveIds.has(obj.id) ||
          (runtime.craftCounts.get(obj.id) ?? 0) >= obj.requiredCount
        );
      case 'sleep_night':
        return (
          runtime.completedObjectiveIds.has(obj.id) ||
          (runtime.sleepCounts.get(obj.id) ?? 0) >= obj.requiredCount
        );
    }
  }

  private getObjectiveCounts(
    obj: QuestObjectiveDef,
    runtime: ActiveQuestRuntime | undefined,
    ctx: QuestWorldContext,
    forceComplete: boolean,
  ): { current: number; target: number } {
    switch (obj.type) {
      case 'collect_items':
      case 'deliver_items': {
        const current = forceComplete
          ? obj.requiredCount
          : Math.min(ctx.getItemCount(obj.itemId), obj.requiredCount);
        return { current, target: obj.requiredCount };
      }
      case 'kill_enemies': {
        const raw = runtime?.killCounts.get(obj.id) ?? 0;
        return {
          current: forceComplete ? obj.requiredCount : Math.min(raw, obj.requiredCount),
          target: obj.requiredCount,
        };
      }
      case 'craft_item': {
        const raw = runtime?.craftCounts.get(obj.id) ?? 0;
        return {
          current: forceComplete ? obj.requiredCount : Math.min(raw, obj.requiredCount),
          target: obj.requiredCount,
        };
      }
      case 'sleep_night': {
        const raw = runtime?.sleepCounts.get(obj.id) ?? 0;
        return {
          current: forceComplete ? obj.requiredCount : Math.min(raw, obj.requiredCount),
          target: obj.requiredCount,
        };
      }
      case 'explore_area': {
        if (obj.minLandmarks !== undefined) {
          const raw = ctx.getDiscoveredLandmarksCount();
          return {
            current: forceComplete ? obj.minLandmarks : Math.min(raw, obj.minLandmarks),
            target: obj.minLandmarks,
          };
        }
        const done = forceComplete || Boolean(runtime?.exploredAreas.has(obj.id));
        return { current: done ? 1 : 0, target: 1 };
      }
      case 'reach_location': {
        const done = forceComplete || Boolean(runtime?.reachedLocations.has(obj.id));
        return { current: done ? 1 : 0, target: 1 };
      }
      case 'talk_to_npc': {
        const done =
          forceComplete || Boolean(runtime?.completedObjectiveIds.has(obj.id));
        return { current: done ? 1 : 0, target: 1 };
      }
    }
  }

  public reset(): void {
    this.active.clear();
    this.completed.clear();
    this.cancelled.clear();
    this.trackedQuestId = null;
    this.coopObjective = null;
    this.coopQuestStates.clear();
  }

  public exportState(): SavedQuestState {
    const active: SavedQuestState['active'] = [];
    for (const [questId, rt] of this.active) {
      active.push({
        questId,
        completedObjectiveIds: Array.from(rt.completedObjectiveIds),
        talkedCounts: Object.fromEntries(rt.talkedCounts.entries()),
        killCounts: Object.fromEntries(rt.killCounts.entries()),
        craftCounts: Object.fromEntries(rt.craftCounts.entries()),
        sleepCounts: Object.fromEntries(rt.sleepCounts.entries()),
        reachedLocations: Array.from(rt.reachedLocations),
        exploredAreas: Array.from(rt.exploredAreas),
        creditedKillEntityIds: Array.from(rt.creditedKillEntityIds),
      });
    }
    return {
      active,
      completed: Array.from(this.completed),
      trackedQuestId: this.trackedQuestId,
    };
  }

  public restoreState(state: SavedQuestState): void {
    this.reset();

    for (const qId of state.completed) {
      if (getQuestDefinition(qId)) {
        this.completed.add(qId);
      }
    }

    for (const entry of state.active) {
      if (!getQuestDefinition(entry.questId) || this.completed.has(entry.questId)) {
        continue;
      }
      this.active.set(entry.questId, {
        questId: entry.questId,
        completedObjectiveIds: new Set(entry.completedObjectiveIds),
        talkedCounts: new Map(Object.entries(entry.talkedCounts ?? {})),
        killCounts: new Map(Object.entries(entry.killCounts ?? {})),
        craftCounts: new Map(Object.entries(entry.craftCounts ?? {})),
        sleepCounts: new Map(Object.entries(entry.sleepCounts ?? {})),
        reachedLocations: new Set(entry.reachedLocations),
        exploredAreas: new Set(entry.exploredAreas),
        creditedKillEntityIds: new Set(entry.creditedKillEntityIds ?? []),
      });
    }

    this.trackedQuestId =
      state.trackedQuestId && this.active.has(state.trackedQuestId)
        ? state.trackedQuestId
        : null;
  }
}
