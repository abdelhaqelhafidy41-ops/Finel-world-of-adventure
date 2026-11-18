import { enemyTypeMatches } from '../world/WorldEntityRegistry';
import type {
  DialogueChoiceNode,
  DialogueNode,
  DialogueTree,
} from '../dialogue/dialogueTypes';
import { UI_TEXT, type Language } from '../i18n/translations';
import type { QuestObjectiveView, QuestType, QuestView } from '../quest/questTypes';
import type { NpcRoutinePeriod } from '../types';
import {
  SIDE_QUESTS,
  SIDE_QUEST_NPCS,
  SIDE_QUEST_NPC_DIRECTORY,
} from './sideQuestData';
import type {
  SavedSideQuestState,
  SideQuestAnchorRef,
  SideQuestDef,
  SideQuestJournalSnapshot,
  SideQuestKillRequest,
  SideQuestLocalSpawnDef,
  SideQuestMapMarkerInput,
  SideQuestNpcDef,
  SideQuestObjectiveDef,
  SideQuestObjectiveView,
  SideQuestRuntime,
  SideQuestState,
  SideQuestTimeWindow,
  SideQuestView,
  SideQuestWorldBridge,
} from './sideQuestTypes';

const NPC_FALLBACK_VILLAGE: Record<string, string> = {
  'npc-sq-captain-hal': 'oakhollow',
  'npc-sq-tariq': 'oakhollow',
  'npc-garrick': 'oakhollow',
  'npc-bram': 'oakhollow',
  'npc-lyra': 'oakhollow',
  'npc-toby': 'oakhollow',
  'npc-doran': 'oakhollow',
  'npc-pinehaven-healer-2': 'pinehaven',
  'npc-grandcross-merchant-0': 'grandcross',
};

const SIDE_QUEST_MAP = new Map<string, SideQuestDef>(
  SIDE_QUESTS.map((q) => [q.sideQuestId, q]),
);

const VALID_SIDE_QUEST_STATES = new Set<SideQuestState>([
  'LOCKED',
  'AVAILABLE',
  'ACTIVE',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
]);

function mapSideObjTypeToQuestType(type: SideQuestObjectiveDef['type']): QuestType {
  switch (type) {
    case 'talk_to_npc':
    case 'rescue_npc':
    case 'escort_npc':
      return 'talk_to_npc';
    case 'collect_resource':
    case 'find_item':
    case 'deliver_item':
      return 'collect_items';
    case 'craft_item':
    case 'build_structure':
      return 'craft_item';
    case 'defeat_enemy':
    case 'defeat_bandit':
    case 'protect_npc':
      return 'kill_enemies';
    case 'explore_location':
      return 'explore_area';
    default:
      return 'reach_location';
  }
}

export function matchesSideQuestTimeWindow(
  window: SideQuestTimeWindow | undefined,
  period: NpcRoutinePeriod,
): boolean {
  if (!window || window === 'any') return true;
  if (window === 'night') {
    return period === 'night' || period === 'evening';
  }
  return period === window;
}

export interface ActiveEscortSpec {
  sideQuestId: string;
  objectiveId: string;
  npcId: string;
  targetX: number;
  targetZ: number;
  radius: number;
}

export class SideQuestManager {
  private trackedSideQuestId: string | null = null;
  private reputation = 0;
  private readonly unlockedFlags = new Set<string>();
  private readonly runtimes = new Map<string, SideQuestRuntime>();
  private language: Language = 'en';

  constructor() {
    this.reset();
  }

  public setLanguage(lang: Language): void {
    this.language = lang;
  }

  public getLanguage(): Language {
    return this.language;
  }

  public getReputation(): number {
    return this.reputation;
  }

  public reset(): void {
    this.trackedSideQuestId = null;
    this.reputation = 0;
    this.unlockedFlags.clear();
    this.runtimes.clear();

    for (const def of SIDE_QUESTS) {
      this.runtimes.set(def.sideQuestId, {
        sideQuestId: def.sideQuestId,
        state: def.state,
        completedObjectiveIds: [],
        counts: {},
        creditedEntityIds: [],
        completedCount: 0,
        acceptedAtWorldHours: null,
        lastCompletedAtMs: null,
        claimedCycleKeys: [],
      });
    }
  }

  public exportState(): SavedSideQuestState {
    const quests: Record<string, SideQuestRuntime> = {};
    for (const [id, rt] of this.runtimes) {
      quests[id] = {
        sideQuestId: rt.sideQuestId,
        state: rt.state,
        completedObjectiveIds: [...rt.completedObjectiveIds],
        counts: { ...rt.counts },
        creditedEntityIds: [...rt.creditedEntityIds],
        completedCount: rt.completedCount,
        acceptedAtWorldHours: rt.acceptedAtWorldHours,
        lastCompletedAtMs: rt.lastCompletedAtMs,
        claimedCycleKeys: [...rt.claimedCycleKeys],
      };
    }
    return {
      trackedSideQuestId: this.trackedSideQuestId,
      reputation: this.reputation,
      unlockedFlags: Array.from(this.unlockedFlags),
      quests,
    };
  }

  public restoreState(saved?: SavedSideQuestState | null): void {
    this.reset();
    if (!saved || typeof saved !== 'object') {
      return;
    }

    if (typeof saved.reputation === 'number' && Number.isFinite(saved.reputation)) {
      this.reputation = Math.max(0, Math.round(saved.reputation));
    }

    if (Array.isArray(saved.unlockedFlags)) {
      for (const flag of saved.unlockedFlags) {
        if (typeof flag === 'string' && flag.trim()) {
          this.unlockedFlags.add(flag.trim());
        }
      }
    }

    if (saved.quests && typeof saved.quests === 'object') {
      for (const def of SIDE_QUESTS) {
        const entry = saved.quests[def.sideQuestId];
        if (!entry || typeof entry !== 'object') continue;
        const rt = this.runtimes.get(def.sideQuestId)!;
        if (VALID_SIDE_QUEST_STATES.has(entry.state)) {
          rt.state = entry.state;
        }
        if (Array.isArray(entry.completedObjectiveIds)) {
          rt.completedObjectiveIds = entry.completedObjectiveIds.filter(
            (id): id is string => typeof id === 'string',
          );
        }
        if (entry.counts && typeof entry.counts === 'object') {
          for (const [k, v] of Object.entries(entry.counts)) {
            if (typeof v === 'number' && Number.isFinite(v)) {
              rt.counts[k] = Math.max(0, Math.floor(v));
            }
          }
        }
        if (Array.isArray(entry.creditedEntityIds)) {
          rt.creditedEntityIds = entry.creditedEntityIds.filter(
            (id): id is string => typeof id === 'string',
          );
        }
        if (typeof entry.completedCount === 'number' && Number.isFinite(entry.completedCount)) {
          rt.completedCount = Math.max(0, Math.floor(entry.completedCount));
        }
        if (
          typeof entry.acceptedAtWorldHours === 'number' &&
          Number.isFinite(entry.acceptedAtWorldHours)
        ) {
          rt.acceptedAtWorldHours = entry.acceptedAtWorldHours;
        } else {
          rt.acceptedAtWorldHours = null;
        }
        if (
          typeof entry.lastCompletedAtMs === 'number' &&
          Number.isFinite(entry.lastCompletedAtMs)
        ) {
          rt.lastCompletedAtMs = entry.lastCompletedAtMs;
        } else {
          rt.lastCompletedAtMs = null;
        }
        if (Array.isArray(entry.claimedCycleKeys)) {
          rt.claimedCycleKeys = entry.claimedCycleKeys.filter(
            (k): k is string => typeof k === 'string',
          );
        }
      }
    }

    if (
      typeof saved.trackedSideQuestId === 'string' &&
      this.isTrackableState(this.runtimes.get(saved.trackedSideQuestId)?.state)
    ) {
      this.trackedSideQuestId = saved.trackedSideQuestId;
    } else {
      this.trackedSideQuestId = this.pickDefaultTrackedQuestId();
    }
  }

  private isTrackableState(state?: SideQuestState): boolean {
    return (
      state === 'ACTIVE' ||
      state === 'AVAILABLE' ||
      state === 'FAILED' ||
      state === 'EXPIRED'
    );
  }

  public getTrackedSideQuestId(): string | null {
    if (
      this.trackedSideQuestId &&
      this.isTrackableState(this.runtimes.get(this.trackedSideQuestId)?.state)
    ) {
      return this.trackedSideQuestId;
    }
    this.trackedSideQuestId = this.pickDefaultTrackedQuestId();
    return this.trackedSideQuestId;
  }

  public setTrackedSideQuest(sideQuestId: string | null): boolean {
    if (sideQuestId === null) {
      this.trackedSideQuestId = null;
      return true;
    }
    const rt = this.runtimes.get(sideQuestId);
    if (!rt || !this.isTrackableState(rt.state)) {
      return false;
    }
    this.trackedSideQuestId = sideQuestId;
    return true;
  }

  private pickDefaultTrackedQuestId(): string | null {
    for (const def of SIDE_QUESTS) {
      if (this.runtimes.get(def.sideQuestId)?.state === 'ACTIVE') {
        return def.sideQuestId;
      }
    }
    return null;
  }

  public getQuestState(sideQuestId: string): SideQuestState {
    return this.runtimes.get(sideQuestId)?.state ?? 'LOCKED';
  }

  public getCompletedObjectiveCount(sideQuestId: string): number {
    return this.runtimes.get(sideQuestId)?.completedObjectiveIds.length ?? 0;
  }

  public applyRemoteSideQuestUpdate(
    sideQuestId: string,
    status: string,
    stepIndex: number,
    bridge: SideQuestWorldBridge,
  ): void {
    const def = SIDE_QUEST_MAP.get(sideQuestId);
    const rt = this.runtimes.get(sideQuestId);
    if (!def || !rt) return;

    const normalized = status.toUpperCase();
    if (normalized === 'COMPLETED') {
      rt.state = 'COMPLETED';
      rt.completedCount = Math.max(1, rt.completedCount);
      rt.completedObjectiveIds = def.objectives.map((o) => o.id);
      for (const obj of def.objectives) {
        rt.counts[obj.id] = obj.requiredCount;
      }
      const cycleKey = `${def.sideQuestId}:c${rt.completedCount}`;
      if (!rt.claimedCycleKeys.includes(cycleKey)) {
        rt.claimedCycleKeys.push(cycleKey);
      }
      if (def.rewards.unlockFlag) {
        this.unlockedFlags.add(def.rewards.unlockFlag);
      }
      this.reconcileAvailability(bridge);
      if (this.trackedSideQuestId === sideQuestId) {
        this.trackedSideQuestId = this.pickDefaultTrackedQuestId();
      }
      return;
    }

    if (normalized === 'FAILED') {
      rt.state = 'FAILED';
      return;
    }

    if (normalized === 'EXPIRED') {
      rt.state = 'EXPIRED';
      return;
    }

    if (normalized === 'ACTIVE') {
      rt.state = 'ACTIVE';
      const clampedStep = Math.max(0, Math.min(def.objectives.length, Math.floor(stepIndex)));
      rt.completedObjectiveIds = def.objectives
        .slice(0, clampedStep)
        .map((o) => o.id);
      for (let i = 0; i < def.objectives.length; i++) {
        const obj = def.objectives[i];
        rt.counts[obj.id] = i < clampedStep ? obj.requiredCount : (rt.counts[obj.id] ?? 0);
      }
      return;
    }

    if (normalized === 'AVAILABLE' || normalized === 'LOCKED') {
      rt.state = normalized as SideQuestState;
      this.reconcileAvailability(bridge);
    }
  }

  public hasFlag(flag: string): boolean {
    return this.unlockedFlags.has(flag);
  }

  public isQuestCompletedOnce(sideQuestId: string): boolean {
    const rt = this.runtimes.get(sideQuestId);
    if (!rt) return false;
    return rt.state === 'COMPLETED' || rt.completedCount > 0;
  }

  private getMinRequiredLevel(def: SideQuestDef): number {
    return Math.max(1, def.requiredLevel, def.availability?.minLevel ?? 1);
  }

  private evaluateAvailabilityGate(
    def: SideQuestDef,
    bridge: Pick<
      SideQuestWorldBridge,
      | 'playerLevel'
      | 'routinePeriod'
      | 'isStoryQuestCompleted'
      | 'hasStoryFlag'
      | 'getVillageCoords'
    >,
    lang = this.language,
  ): { ok: boolean; lockReason?: string } {
    for (const preId of def.prerequisites) {
      if (!this.isQuestCompletedOnce(preId)) {
        const preDef = SIDE_QUEST_MAP.get(preId);
        const preTitle = preDef
          ? lang === 'ar'
            ? preDef.titleAr
            : preDef.title
          : preId;
        return {
          ok: false,
          lockReason:
            lang === 'ar'
              ? `تتطلب إتمام: ${preTitle}`
              : `Requires: ${preTitle}`,
        };
      }
    }

    const minLvl = this.getMinRequiredLevel(def);
    if (bridge.playerLevel < minLvl) {
      return {
        ok: false,
        lockReason:
          lang === 'ar'
            ? `تتطلب المستوى ${minLvl}`
            : `Requires Level ${minLvl}`,
      };
    }

    const rules = def.availability;
    if (rules?.requiredStoryQuests) {
      for (const sqId of rules.requiredStoryQuests) {
        if (!bridge.isStoryQuestCompleted(sqId)) {
          return {
            ok: false,
            lockReason:
              lang === 'ar'
                ? 'تتطلب تقدمًا إضافيًا في القصة الرئيسية'
                : 'Requires further Main Story progress',
          };
        }
      }
    }

    if (rules?.requiredStoryFlags) {
      for (const flag of rules.requiredStoryFlags) {
        if (!bridge.hasStoryFlag(flag) && !this.unlockedFlags.has(flag)) {
          return {
            ok: false,
            lockReason:
              lang === 'ar'
                ? 'مقفلة حتى يتحقق شرط القصة'
                : 'Locked until story condition is met',
          };
        }
      }
    }

    if (rules?.requiredVillages) {
      for (const vid of rules.requiredVillages) {
        const vInfo = bridge.getVillageCoords(vid);
        if (!vInfo?.discovered) {
          return {
            ok: false,
            lockReason:
              lang === 'ar'
                ? `تتطلب اكتشاف قرية (${vid})`
                : `Requires discovering ${vid}`,
          };
        }
      }
    }

    if (rules?.requireRescueNpcId) {
      const flagKey = `sq:rescued:${rules.requireRescueNpcId}`;
      if (!this.unlockedFlags.has(flagKey)) {
        return {
          ok: false,
          lockReason:
            lang === 'ar'
              ? 'تتطلب إنقاذ الشخصية المرتبطة أولاً'
              : 'Requires rescuing the linked character first',
        };
      }
    }

    if (
      rules?.timeWindow &&
      !matchesSideQuestTimeWindow(rules.timeWindow, bridge.routinePeriod)
    ) {
      return {
        ok: false,
        lockReason:
          rules.timeWindow === 'night'
            ? lang === 'ar'
              ? 'تُعرض مساءً وليلاً فقط'
              : 'Offered during Evening & Night'
            : lang === 'ar'
              ? 'تُعرض في وقت محدد من اليوم'
              : `Offered during ${rules.timeWindow}`,
      };
    }

    return { ok: true };
  }

  private getCooldownRemainingSeconds(
    def: SideQuestDef,
    rt: SideQuestRuntime,
    nowMs: number,
  ): number {
    if (!def.repeatable || !rt.lastCompletedAtMs || !def.cooldownSeconds) {
      return 0;
    }
    const elapsedMs = Math.max(0, nowMs - rt.lastCompletedAtMs);
    const totalMs = def.cooldownSeconds * 1000;
    return elapsedMs >= totalMs ? 0 : Math.ceil((totalMs - elapsedMs) / 1000);
  }

  /**
   * Re-evaluates LOCKED <-> AVAILABLE gates and repeatable cooldown resets
   * without touching already ACTIVE, FAILED, EXPIRED, or non-repeatable COMPLETED quests.
   */
  public reconcileAvailability(
    bridge: Pick<
      SideQuestWorldBridge,
      | 'playerLevel'
      | 'routinePeriod'
      | 'isStoryQuestCompleted'
      | 'hasStoryFlag'
      | 'getVillageCoords'
    >,
    nowMs = Date.now(),
  ): boolean {
    let changed = false;

    for (const def of SIDE_QUESTS) {
      const rt = this.runtimes.get(def.sideQuestId)!;

      // Reset repeatable quest after cooldown finishes
      if (rt.state === 'COMPLETED' && def.repeatable) {
        if (this.getCooldownRemainingSeconds(def, rt, nowMs) === 0) {
          rt.completedObjectiveIds = [];
          rt.counts = {};
          rt.creditedEntityIds = [];
          rt.acceptedAtWorldHours = null;
          const gate = this.evaluateAvailabilityGate(def, bridge);
          rt.state = gate.ok ? 'AVAILABLE' : 'LOCKED';
          changed = true;
        }
        continue;
      }

      if (rt.state === 'LOCKED' || rt.state === 'AVAILABLE') {
        const gate = this.evaluateAvailabilityGate(def, bridge);
        const targetState: SideQuestState = gate.ok ? 'AVAILABLE' : 'LOCKED';
        if (rt.state !== targetState) {
          rt.state = targetState;
          changed = true;
        }
      }
    }

    return changed;
  }

  private getCurrentActiveObjective(
    def: SideQuestDef,
    rt: SideQuestRuntime,
  ): SideQuestObjectiveDef | null {
    for (const obj of def.objectives) {
      if (!rt.completedObjectiveIds.includes(obj.id)) {
        return obj;
      }
    }
    return null;
  }

  private isObjectiveEnabled(
    def: SideQuestDef,
    rt: SideQuestRuntime,
    obj: SideQuestObjectiveDef,
  ): boolean {
    if (rt.state !== 'ACTIVE') return false;
    if (!def.sequential) return true;
    const current = this.getCurrentActiveObjective(def, rt);
    return current?.id === obj.id;
  }

  public isReadyToTurnIn(
    def: SideQuestDef,
    rt: SideQuestRuntime,
    bridge?: Pick<SideQuestWorldBridge, 'getItemCount'>,
  ): boolean {
    if (rt.state !== 'ACTIVE') return false;
    const allReqDone = def.requiredObjectives.every((id) =>
      rt.completedObjectiveIds.includes(id),
    );
    if (!allReqDone) return false;

    if (bridge) {
      for (const obj of def.objectives) {
        if (obj.consumeOnComplete && obj.itemId) {
          if (bridge.getItemCount(obj.itemId) < obj.requiredCount) {
            return false;
          }
        }
      }
    }
    return true;
  }

  public acceptQuest(
    sideQuestId: string,
    bridge: SideQuestWorldBridge,
    notify?: (msg: string) => void,
    nowMs = Date.now(),
  ): boolean {
    this.reconcileAvailability(bridge, nowMs);
    const def = SIDE_QUEST_MAP.get(sideQuestId);
    const rt = this.runtimes.get(sideQuestId);
    if (!def || !rt) return false;
    if (rt.state !== 'AVAILABLE') return false;

    const gate = this.evaluateAvailabilityGate(def, bridge);
    if (!gate.ok) return false;

    rt.state = 'ACTIVE';
    rt.completedObjectiveIds = [];
    rt.counts = {};
    rt.creditedEntityIds = [];
    rt.acceptedAtWorldHours = bridge.totalWorldHours;
    this.trackedSideQuestId = def.sideQuestId;

    if (notify) {
      const title = this.language === 'ar' ? def.titleAr : def.title;
      notify(UI_TEXT[this.language].sideQuestAcceptedNotice(title));
    }

    // Evaluate immediately in case the player already holds required resources/items
    this.update(bridge, notify, nowMs);
    return true;
  }

  public abandonQuest(
    sideQuestId: string,
    bridge: SideQuestWorldBridge,
    notify?: (msg: string) => void,
    nowMs = Date.now(),
  ): boolean {
    const def = SIDE_QUEST_MAP.get(sideQuestId);
    const rt = this.runtimes.get(sideQuestId);
    if (!def || !rt) return false;
    if (rt.state !== 'ACTIVE' && rt.state !== 'FAILED' && rt.state !== 'EXPIRED') {
      return false;
    }

    rt.completedObjectiveIds = [];
    rt.counts = {};
    rt.creditedEntityIds = [];
    rt.acceptedAtWorldHours = null;
    rt.state = 'AVAILABLE';
    this.reconcileAvailability(bridge, nowMs);

    if (this.trackedSideQuestId === sideQuestId) {
      this.trackedSideQuestId = this.pickDefaultTrackedQuestId();
    }

    if (notify) {
      const title = this.language === 'ar' ? def.titleAr : def.title;
      notify(UI_TEXT[this.language].sideQuestAbandonedNotice(title));
    }
    return true;
  }

  public retryQuest(
    sideQuestId: string,
    bridge: SideQuestWorldBridge,
    notify?: (msg: string) => void,
    nowMs = Date.now(),
  ): boolean {
    const def = SIDE_QUEST_MAP.get(sideQuestId);
    const rt = this.runtimes.get(sideQuestId);
    if (!def || !rt) return false;
    if (rt.state !== 'FAILED' && rt.state !== 'EXPIRED') return false;

    const gate = this.evaluateAvailabilityGate(def, bridge);
    if (!gate.ok) return false;

    rt.state = 'ACTIVE';
    rt.completedObjectiveIds = [];
    rt.counts = {};
    rt.creditedEntityIds = [];
    rt.acceptedAtWorldHours = bridge.totalWorldHours;
    this.trackedSideQuestId = def.sideQuestId;

    if (notify) {
      const title = this.language === 'ar' ? def.titleAr : def.title;
      notify(UI_TEXT[this.language].sideQuestAcceptedNotice(title));
    }

    this.update(bridge, notify, nowMs);
    return true;
  }

  public failQuest(
    sideQuestId: string,
    notify?: (msg: string) => void,
  ): boolean {
    const def = SIDE_QUEST_MAP.get(sideQuestId);
    const rt = this.runtimes.get(sideQuestId);
    if (!def || !rt || rt.state !== 'ACTIVE') return false;

    rt.state = 'FAILED';
    if (notify) {
      const title = this.language === 'ar' ? def.titleAr : def.title;
      notify(UI_TEXT[this.language].sideQuestFailedNotice(title));
    }
    return true;
  }

  public expireQuest(
    sideQuestId: string,
    notify?: (msg: string) => void,
  ): boolean {
    const def = SIDE_QUEST_MAP.get(sideQuestId);
    const rt = this.runtimes.get(sideQuestId);
    if (!def || !rt || rt.state !== 'ACTIVE') return false;

    rt.state = 'EXPIRED';
    if (notify) {
      const title = this.language === 'ar' ? def.titleAr : def.title;
      notify(UI_TEXT[this.language].sideQuestExpiredNotice(title));
    }
    return true;
  }

  public completeQuest(
    sideQuestId: string,
    bridge: SideQuestWorldBridge,
    notify?: (msg: string) => void,
    nowMs = Date.now(),
  ): boolean {
    const def = SIDE_QUEST_MAP.get(sideQuestId);
    const rt = this.runtimes.get(sideQuestId);
    if (!def || !rt) return false;

    // Anti-duplicate guard
    if (!def.repeatable && (rt.state === 'COMPLETED' || rt.completedCount > 0)) {
      return false;
    }

    const cycleNumber = rt.completedCount + 1;
    const cycleKey = `${def.sideQuestId}:c${cycleNumber}`;
    if (rt.claimedCycleKeys.includes(cycleKey)) {
      return false;
    }

    if (!this.isReadyToTurnIn(def, rt)) {
      return false;
    }

    // Verify required turn-in items are present before consuming or mutating state
    const requiredToConsume = new Map<string, number>();
    for (const obj of def.objectives) {
      if (obj.consumeOnComplete && obj.itemId) {
        const prevNeed = requiredToConsume.get(obj.itemId) ?? 0;
        requiredToConsume.set(obj.itemId, Math.max(prevNeed, obj.requiredCount));
      }
    }
    for (const [itemId, needed] of requiredToConsume) {
      if (bridge.getItemCount(itemId) < needed) {
        if (notify) {
          notify(UI_TEXT[this.language].sideQuestMissingItemsNotice);
        }
        return false;
      }
    }

    // Consume quest turn-in items safely after validation
    for (const [itemId, needed] of requiredToConsume) {
      bridge.consumeItem(itemId, needed);
    }

    rt.claimedCycleKeys.push(cycleKey);
    if (rt.claimedCycleKeys.length > 64) {
      rt.claimedCycleKeys = rt.claimedCycleKeys.slice(-64);
    }
    rt.completedCount = cycleNumber;
    rt.lastCompletedAtMs = nowMs;
    rt.acceptedAtWorldHours = null;
    rt.state = 'COMPLETED';

    if (def.rewards.reputation && def.rewards.reputation > 0) {
      this.reputation += def.rewards.reputation;
    }
    if (def.rewards.unlockFlag) {
      this.unlockedFlags.add(def.rewards.unlockFlag);
    }

    if (def.rewards.items) {
      for (const item of def.rewards.items) {
        bridge.giveItem(item.id, item.count);
      }
    }

    const questTitle = this.language === 'ar' ? def.titleAr : def.title;
    bridge.grantRewards(def.rewards.xp, def.rewards.coins, questTitle, {
      sideQuestId: def.sideQuestId,
      cycleKey,
      repeatable: def.repeatable,
      items: def.rewards.items,
    });

    this.reconcileAvailability(bridge, nowMs);
    if (this.trackedSideQuestId === sideQuestId) {
      this.trackedSideQuestId = this.pickDefaultTrackedQuestId();
    }
    return true;
  }

  private markObjectiveCompleted(
    def: SideQuestDef,
    rt: SideQuestRuntime,
    obj: SideQuestObjectiveDef,
    notify?: (msg: string) => void,
  ): boolean {
    if (rt.completedObjectiveIds.includes(obj.id)) return false;
    rt.completedObjectiveIds.push(obj.id);
    rt.counts[obj.id] = obj.requiredCount;

    if (notify) {
      const desc = this.language === 'ar' ? obj.descriptionAr : obj.descriptionEn;
      notify(`${UI_TEXT[this.language].objectiveCompletePrefix}: ${desc}`);
      const allDone = def.requiredObjectives.every((id) =>
        rt.completedObjectiveIds.includes(id),
      );
      if (allDone) {
        const title = this.language === 'ar' ? def.titleAr : def.title;
        notify(UI_TEXT[this.language].sideQuestReadyNotice(title));
      }
    }
    return true;
  }

  private checkObjectiveCountProgress(
    def: SideQuestDef,
    rt: SideQuestRuntime,
    obj: SideQuestObjectiveDef,
    newCount: number,
    notify?: (msg: string) => void,
  ): boolean {
    const prev = rt.counts[obj.id] ?? 0;
    const clamped = Math.max(0, Math.min(obj.requiredCount, newCount));
    let changed = clamped !== prev;
    rt.counts[obj.id] = clamped;
    if (clamped >= obj.requiredCount) {
      if (this.markObjectiveCompleted(def, rt, obj, notify)) {
        changed = true;
      }
    }
    return changed;
  }

  public update(
    bridge: SideQuestWorldBridge,
    notify?: (msg: string) => void,
    nowMs = Date.now(),
  ): boolean {
    let changed = this.reconcileAvailability(bridge, nowMs);

    for (const def of SIDE_QUESTS) {
      const rt = this.runtimes.get(def.sideQuestId)!;
      if (rt.state !== 'ACTIVE') continue;

      // Expiration check if timed quest exceeded its world-hour limit
      if (
        typeof def.expirationHours === 'number' &&
        def.expirationHours > 0 &&
        rt.acceptedAtWorldHours !== null &&
        bridge.totalWorldHours - rt.acceptedAtWorldHours >= def.expirationHours
      ) {
        if (this.expireQuest(def.sideQuestId, notify)) {
          changed = true;
        }
        continue;
      }

      for (const obj of def.objectives) {
        if (obj.type === 'protect_npc' && obj.npcId) {
          if (
            bridge.isNpcAlive(obj.npcId) === false &&
            this.isObjectiveEnabled(def, rt, obj)
          ) {
            this.failQuest(def.sideQuestId, notify);
            changed = true;
            break;
          }
        }

        // Keep inventory-dependent gather/deliver/find steps accurate if items are spent/dropped
        if (
          (obj.type === 'collect_resource' ||
            obj.type === 'find_item' ||
            obj.type === 'deliver_item') &&
          obj.itemId
        ) {
          const itemCount = bridge.getItemCount(obj.itemId);
          if (
            rt.completedObjectiveIds.includes(obj.id) &&
            obj.consumeOnComplete &&
            itemCount < obj.requiredCount
          ) {
            rt.completedObjectiveIds = rt.completedObjectiveIds.filter(
              (id) => id !== obj.id,
            );
            rt.counts[obj.id] = Math.min(obj.requiredCount, itemCount);
            changed = true;
          }
        }

        if (rt.completedObjectiveIds.includes(obj.id)) continue;
        if (!this.isObjectiveEnabled(def, rt, obj)) continue;

        switch (obj.type) {
          case 'reach_location':
          case 'explore_location': {
            const target = this.resolveObjectiveCoords(obj, bridge);
            if (target) {
              const rad = obj.radius ?? 26;
              const dist = Math.hypot(
                bridge.playerX - target.x,
                bridge.playerZ - target.z,
              );
              if (dist <= rad) {
                if (this.markObjectiveCompleted(def, rt, obj, notify)) {
                  changed = true;
                }
              }
            }
            break;
          }
          case 'collect_resource':
          case 'find_item': {
            if (obj.itemId) {
              const count = bridge.getItemCount(obj.itemId);
              if (this.checkObjectiveCountProgress(def, rt, obj, count, notify)) {
                changed = true;
              }
            }
            break;
          }
          case 'deliver_item': {
            if (obj.itemId) {
              const count = bridge.getItemCount(obj.itemId);
              const clamped = Math.min(obj.requiredCount, count);
              if ((rt.counts[obj.id] ?? 0) !== clamped) {
                rt.counts[obj.id] = clamped;
                changed = true;
              }
            }
            break;
          }
          case 'escort_npc': {
            if (obj.escortNpcId && obj.escortTargetAnchor) {
              const target = this.resolveAnchorCoords(obj.escortTargetAnchor, bridge);
              const npcPos = bridge.getNpcPosition(obj.escortNpcId);
              const alive = bridge.isNpcAlive(obj.escortNpcId);
              if (alive === false) {
                this.failQuest(def.sideQuestId, notify);
                changed = true;
                break;
              }
              if (target) {
                const rad = obj.radius ?? 18;
                const playerDist = Math.hypot(
                  bridge.playerX - target.x,
                  bridge.playerZ - target.z,
                );
                const npcDist = npcPos
                  ? Math.hypot(npcPos.x - target.x, npcPos.z - target.z)
                  : Infinity;
                if (npcDist <= rad || (playerDist <= rad && npcDist <= rad + 18)) {
                  this.unlockedFlags.add(`sq:escorted:${obj.escortNpcId}`);
                  if (this.markObjectiveCompleted(def, rt, obj, notify)) {
                    changed = true;
                  }
                }
              }
            }
            break;
          }
          case 'build_structure': {
            if (bridge.getBuiltStructureCount) {
              const builtCount = bridge.getBuiltStructureCount({
                blueprintId: obj.buildingId,
                category: obj.buildingCategory,
              });
              if (builtCount > (rt.counts[obj.id] ?? 0)) {
                if (this.checkObjectiveCountProgress(def, rt, obj, builtCount, notify)) {
                  changed = true;
                }
              }
            }
            break;
          }
          default:
            break;
        }
      }
    }

    return changed;
  }

  public onNpcTalked(
    npcId: string,
    bridge: Pick<SideQuestWorldBridge, 'getItemCount'>,
    notify?: (msg: string) => void,
  ): boolean {
    let changed = false;

    for (const def of SIDE_QUESTS) {
      const rt = this.runtimes.get(def.sideQuestId)!;
      if (rt.state !== 'ACTIVE') continue;

      for (const obj of def.objectives) {
        if (rt.completedObjectiveIds.includes(obj.id)) continue;
        if (!this.isObjectiveEnabled(def, rt, obj)) continue;

        if (obj.type === 'talk_to_npc' && obj.npcId === npcId) {
          if (this.markObjectiveCompleted(def, rt, obj, notify)) {
            changed = true;
            break;
          }
        } else if (
          obj.type === 'deliver_item' &&
          obj.npcId === npcId &&
          obj.itemId &&
          bridge.getItemCount(obj.itemId) >= obj.requiredCount
        ) {
          if (this.markObjectiveCompleted(def, rt, obj, notify)) {
            changed = true;
            break;
          }
        }
      }
    }

    return changed;
  }

  public onNpcRescued(
    rescueIdOrNpcId: string,
    notify?: (msg: string) => void,
  ): boolean {
    let changed = false;

    for (const def of SIDE_QUESTS) {
      const rt = this.runtimes.get(def.sideQuestId)!;
      if (rt.state !== 'ACTIVE') continue;

      for (const obj of def.objectives) {
        if (rt.completedObjectiveIds.includes(obj.id)) continue;
        if (!this.isObjectiveEnabled(def, rt, obj)) continue;
        if (
          obj.type === 'rescue_npc' &&
          (obj.npcId === rescueIdOrNpcId || obj.localSpawn?.id === rescueIdOrNpcId)
        ) {
          this.unlockedFlags.add(`sq:rescued:${rescueIdOrNpcId}`);
          if (this.markObjectiveCompleted(def, rt, obj, notify)) {
            changed = true;
          }
        }
      }
    }

    return changed;
  }

  public onEnemyKilled(
    enemyType: string,
    entityId?: string,
    notify?: (msg: string) => void,
  ): boolean {
    let changed = false;

    for (const def of SIDE_QUESTS) {
      const rt = this.runtimes.get(def.sideQuestId)!;
      if (rt.state !== 'ACTIVE') continue;

      for (const obj of def.objectives) {
        if (rt.completedObjectiveIds.includes(obj.id)) continue;
        if (!this.isObjectiveEnabled(def, rt, obj)) continue;
        if (
          obj.type !== 'defeat_enemy' &&
          obj.type !== 'defeat_bandit' &&
          obj.type !== 'protect_npc'
        ) {
          continue;
        }

        const expected =
          obj.type === 'defeat_bandit'
            ? 'bandit_scout'
            : (obj.enemyType ?? 'any');
        if (!enemyTypeMatches(expected, enemyType)) continue;

        if (entityId) {
          const token = `${obj.id}:${entityId}`;
          if (rt.creditedEntityIds.includes(token)) continue;
          rt.creditedEntityIds.push(token);
        }

        const nextCount = (rt.counts[obj.id] ?? 0) + 1;
        if (this.checkObjectiveCountProgress(def, rt, obj, nextCount, notify)) {
          changed = true;
        }
      }
    }

    return changed;
  }

  public onItemCrafted(
    itemId: string,
    count = 1,
    notify?: (msg: string) => void,
  ): boolean {
    let changed = false;
    for (const def of SIDE_QUESTS) {
      const rt = this.runtimes.get(def.sideQuestId)!;
      if (rt.state !== 'ACTIVE') continue;

      for (const obj of def.objectives) {
        if (rt.completedObjectiveIds.includes(obj.id)) continue;
        if (!this.isObjectiveEnabled(def, rt, obj)) continue;
        if (obj.type === 'craft_item' && obj.itemId === itemId) {
          const next = (rt.counts[obj.id] ?? 0) + Math.max(1, count);
          if (this.checkObjectiveCountProgress(def, rt, obj, next, notify)) {
            changed = true;
          }
        }
      }
    }
    return changed;
  }

  public onStructureBuilt(
    blueprintId: string,
    category: string,
    notify?: (msg: string) => void,
  ): boolean {
    let changed = false;
    for (const def of SIDE_QUESTS) {
      const rt = this.runtimes.get(def.sideQuestId)!;
      if (rt.state !== 'ACTIVE') continue;

      for (const obj of def.objectives) {
        if (rt.completedObjectiveIds.includes(obj.id)) continue;
        if (!this.isObjectiveEnabled(def, rt, obj)) continue;
        if (obj.type !== 'build_structure') continue;
        const matchesId = !obj.buildingId || obj.buildingId === blueprintId;
        const matchesCat = !obj.buildingCategory || obj.buildingCategory === category;
        if (!matchesId || !matchesCat) continue;
        const next = (rt.counts[obj.id] ?? 0) + 1;
        if (this.checkObjectiveCountProgress(def, rt, obj, next, notify)) {
          changed = true;
        }
      }
    }
    return changed;
  }

  public resolveAnchorCoords(
    anchor: SideQuestAnchorRef | undefined,
    bridge: Pick<
      SideQuestWorldBridge,
      'getNpcPosition' | 'getLocationCoords' | 'getVillageCoords' | 'resolveLandPoint'
    >,
  ): { x: number; z: number } | null {
    if (!anchor) return null;
    switch (anchor.kind) {
      case 'npc': {
        const live = bridge.getNpcPosition(anchor.npcId);
        if (live) {
          const rx = live.x + (anchor.offsetX ?? 0);
          const rz = live.z + (anchor.offsetZ ?? 0);
          return anchor.offsetX || anchor.offsetZ
            ? bridge.resolveLandPoint(rx, rz)
            : live;
        }
        const sqNpc = SIDE_QUEST_NPCS.find((n) => n.npcId === anchor.npcId);
        if (sqNpc) {
          return this.resolveAnchorCoords(sqNpc.anchor, bridge);
        }
        const vid = NPC_FALLBACK_VILLAGE[anchor.npcId];
        if (vid) {
          const v = bridge.getVillageCoords(vid);
          if (v) {
            return bridge.resolveLandPoint(
              v.x + (anchor.offsetX ?? 0),
              v.z + (anchor.offsetZ ?? 0),
            );
          }
        }
        return null;
      }
      case 'location': {
        const loc = bridge.getLocationCoords(anchor.locationId);
        if (!loc) return null;
        return bridge.resolveLandPoint(
          loc.x + (anchor.offsetX ?? 0),
          loc.z + (anchor.offsetZ ?? 0),
        );
      }
      case 'village': {
        const v = bridge.getVillageCoords(anchor.villageId);
        if (!v) return null;
        return bridge.resolveLandPoint(
          v.x + (anchor.offsetX ?? 0),
          v.z + (anchor.offsetZ ?? 0),
        );
      }
      case 'point':
        return bridge.resolveLandPoint(anchor.x, anchor.z);
    }
  }

  private resolveObjectiveCoords(
    obj: SideQuestObjectiveDef,
    bridge: Pick<
      SideQuestWorldBridge,
      'getNpcPosition' | 'getLocationCoords' | 'getVillageCoords' | 'resolveLandPoint'
    >,
  ): { x: number; z: number } | null {
    if (obj.anchor) return this.resolveAnchorCoords(obj.anchor, bridge);
    if (obj.npcId) {
      return this.resolveAnchorCoords({ kind: 'npc', npcId: obj.npcId }, bridge);
    }
    if (obj.locationId) {
      return this.resolveAnchorCoords(
        { kind: 'location', locationId: obj.locationId },
        bridge,
      );
    }
    if (obj.villageId) {
      return this.resolveAnchorCoords(
        { kind: 'village', villageId: obj.villageId },
        bridge,
      );
    }
    return null;
  }

  public getActiveKillRequests(
    bridge: Pick<
      SideQuestWorldBridge,
      'getNpcPosition' | 'getLocationCoords' | 'getVillageCoords' | 'resolveLandPoint'
    >,
  ): SideQuestKillRequest[] {
    const out: SideQuestKillRequest[] = [];
    for (const def of SIDE_QUESTS) {
      const rt = this.runtimes.get(def.sideQuestId)!;
      if (rt.state !== 'ACTIVE') continue;

      for (const obj of def.objectives) {
        if (rt.completedObjectiveIds.includes(obj.id)) continue;
        if (!this.isObjectiveEnabled(def, rt, obj)) continue;
        if (
          obj.type !== 'defeat_enemy' &&
          obj.type !== 'defeat_bandit' &&
          obj.type !== 'protect_npc'
        ) {
          continue;
        }
        const expected =
          obj.type === 'defeat_bandit'
            ? 'bandit_scout'
            : (obj.enemyType ?? 'bandit_scout');
        // Wildlife kills (e.g. animal:wolf) roam naturally in plains/woods; only combat enemies use combat quest targets
        if (expected.startsWith('animal:')) continue;

        const anchor = this.resolveObjectiveCoords(obj, bridge);
        out.push({
          sideQuestId: def.sideQuestId,
          objectiveId: obj.id,
          enemyType: expected,
          requiredCount: obj.requiredCount,
          currentCount: rt.counts[obj.id] ?? 0,
          targetX: anchor?.x,
          targetZ: anchor?.z,
        });
      }
    }
    return out;
  }

  public getActiveEscortSpecs(
    bridge: Pick<
      SideQuestWorldBridge,
      'getNpcPosition' | 'getLocationCoords' | 'getVillageCoords' | 'resolveLandPoint'
    >,
  ): ActiveEscortSpec[] {
    const out: ActiveEscortSpec[] = [];
    for (const def of SIDE_QUESTS) {
      const rt = this.runtimes.get(def.sideQuestId)!;
      if (rt.state !== 'ACTIVE') continue;
      for (const obj of def.objectives) {
        if (rt.completedObjectiveIds.includes(obj.id)) continue;
        if (!this.isObjectiveEnabled(def, rt, obj)) continue;
        if (obj.type !== 'escort_npc' || !obj.escortNpcId || !obj.escortTargetAnchor) {
          continue;
        }
        const target = this.resolveAnchorCoords(obj.escortTargetAnchor, bridge);
        if (!target) continue;
        out.push({
          sideQuestId: def.sideQuestId,
          objectiveId: obj.id,
          npcId: obj.escortNpcId,
          targetX: target.x,
          targetZ: target.z,
          radius: obj.radius ?? 18,
        });
      }
    }
    return out;
  }

  public shouldSpawnSideQuestNpc(
    npcDef: SideQuestNpcDef,
    playerX: number,
    playerZ: number,
    bridge: Pick<
      SideQuestWorldBridge,
      'getNpcPosition' | 'getLocationCoords' | 'getVillageCoords' | 'resolveLandPoint'
    >,
    streamRadius = 175,
  ): { spawn: boolean; x: number; z: number } {
    // Active escort always keeps the escorted NPC streamed with the player
    const escorts = this.getActiveEscortSpecs(bridge);
    const activeEscort = escorts.find((e) => e.npcId === npcDef.npcId);
    if (activeEscort) {
      const nearPlayer = bridge.resolveLandPoint(playerX + 1.8, playerZ + 1.8);
      return { spawn: true, x: nearPlayer.x, z: nearPlayer.z };
    }

    if (
      npcDef.unlockWhenQuestCompleted &&
      !this.isQuestCompletedOnce(npcDef.unlockWhenQuestCompleted)
    ) {
      return { spawn: false, x: 0, z: 0 };
    }

    const coords = this.resolveAnchorCoords(npcDef.anchor, bridge);
    if (!coords) return { spawn: false, x: 0, z: 0 };
    const distSq = (coords.x - playerX) ** 2 + (coords.z - playerZ) ** 2;
    return {
      spawn: distSq <= streamRadius * streamRadius,
      x: coords.x,
      z: coords.z,
    };
  }

  public getPendingLocalSpawns(
    playerX: number,
    playerZ: number,
    bridge: Pick<
      SideQuestWorldBridge,
      | 'getNpcPosition'
      | 'getLocationCoords'
      | 'getVillageCoords'
      | 'resolveLandPoint'
      | 'getItemCount'
    >,
    streamRadius = 165,
  ): Array<{
    def: SideQuestLocalSpawnDef;
    x: number;
    z: number;
    sideQuestId: string;
  }> {
    const out: Array<{
      def: SideQuestLocalSpawnDef;
      x: number;
      z: number;
      sideQuestId: string;
    }> = [];
    const rSq = streamRadius * streamRadius;

    for (const def of SIDE_QUESTS) {
      const rt = this.runtimes.get(def.sideQuestId)!;
      if (rt.state !== 'ACTIVE') continue;

      for (const obj of def.objectives) {
        if (!obj.localSpawn) continue;
        if (rt.completedObjectiveIds.includes(obj.id)) continue;
        if (!this.isObjectiveEnabled(def, rt, obj)) continue;
        if (obj.itemId && bridge.getItemCount(obj.itemId) >= obj.requiredCount) {
          continue;
        }
        const coords = this.resolveAnchorCoords(obj.localSpawn.anchor, bridge);
        if (!coords) continue;
        if ((coords.x - playerX) ** 2 + (coords.z - playerZ) ** 2 <= rSq) {
          out.push({
            def: obj.localSpawn,
            x: coords.x,
            z: coords.z,
            sideQuestId: def.sideQuestId,
          });
        }
      }
    }

    return out;
  }

  public getMapMarkers(
    bridge: Pick<
      SideQuestWorldBridge,
      | 'getNpcPosition'
      | 'getLocationCoords'
      | 'getVillageCoords'
      | 'resolveLandPoint'
      | 'getItemCount'
    >,
    lang = this.language,
  ): SideQuestMapMarkerInput[] {
    const out: SideQuestMapMarkerInput[] = [];
    const trackedId = this.getTrackedSideQuestId();

    for (const def of SIDE_QUESTS) {
      const rt = this.runtimes.get(def.sideQuestId)!;
      if (rt.state === 'LOCKED' || rt.state === 'COMPLETED') continue;

      const title = lang === 'ar' ? def.titleAr : def.title;
      const isTracked = def.sideQuestId === trackedId;

      if (rt.state === 'AVAILABLE' || rt.state === 'FAILED' || rt.state === 'EXPIRED') {
        const giver = this.resolveAnchorCoords(
          { kind: 'npc', npcId: def.giverNpcId },
          bridge,
        );
        if (!giver || !Number.isFinite(giver.x) || !Number.isFinite(giver.z)) {
          continue;
        }
        out.push({
          id: `sq-avail-${def.sideQuestId}`,
          sideQuestId: def.sideQuestId,
          markerKind: 'side_quest_available',
          label: title,
          subtitle:
            rt.state === 'EXPIRED'
              ? lang === 'ar'
                ? 'انتهى الوقت — أعد المحاولة من السجل أو صاحب المهمة'
                : 'Expired — Retry from Side Quests or quest giver'
              : rt.state === 'FAILED'
                ? lang === 'ar'
                  ? 'فشلت المهمة — أعد المحاولة'
                  : 'Failed — Retry quest'
                : lang === 'ar'
                  ? 'مهمة جانبية متاحة'
                  : 'Available Side Quest',
          x: giver.x,
          z: giver.z,
          tracked: isTracked,
        });
        continue;
      }

      // ACTIVE side quest
      if (this.isReadyToTurnIn(def, rt, bridge)) {
        const turnIn = this.resolveAnchorCoords(
          { kind: 'npc', npcId: def.turnInNpcId },
          bridge,
        );
        if (turnIn && Number.isFinite(turnIn.x) && Number.isFinite(turnIn.z)) {
          out.push({
            id: `sq-turnin-${def.sideQuestId}`,
            sideQuestId: def.sideQuestId,
            markerKind: 'side_quest_turnin',
            label: title,
            subtitle:
              lang === 'ar'
                ? 'مكتملة الأهداف — سلّم المهمة'
                : 'Ready to Turn In — Speak with recipient',
            x: turnIn.x,
            z: turnIn.z,
            tracked: isTracked,
          });
        }
        continue;
      }

      const activeObj = this.getCurrentActiveObjective(def, rt);
      if (!activeObj) continue;
      const coords =
        activeObj.type === 'escort_npc' && activeObj.escortTargetAnchor
          ? this.resolveAnchorCoords(activeObj.escortTargetAnchor, bridge)
          : this.resolveObjectiveCoords(activeObj, bridge);
      if (!coords || !Number.isFinite(coords.x) || !Number.isFinite(coords.z)) {
        continue;
      }

      const markerKind: SideQuestMapMarkerInput['markerKind'] =
        activeObj.markerRole === 'enemy'
          ? 'side_quest_target'
          : activeObj.markerRole === 'npc'
            ? 'side_quest_giver'
            : 'side_quest_active';

      out.push({
        id: `sq-obj-${def.sideQuestId}-${activeObj.id}`,
        sideQuestId: def.sideQuestId,
        markerKind,
        label: title,
        subtitle:
          lang === 'ar' ? activeObj.descriptionAr : activeObj.descriptionEn,
        x: coords.x,
        z: coords.z,
        radius:
          activeObj.radius ??
          (activeObj.markerRole === 'enemy' ||
          activeObj.markerRole === 'investigation'
            ? 34
            : undefined),
        tracked: isTracked,
      });
    }

    return out;
  }

  private getNpcDisplayName(npcId: string, lang: Language): string {
    const entry = SIDE_QUEST_NPC_DIRECTORY[npcId];
    if (entry) return lang === 'ar' ? entry.nameAr : entry.nameEn;
    return npcId;
  }

  private toObjectiveView(
    def: SideQuestDef,
    rt: SideQuestRuntime,
    obj: SideQuestObjectiveDef,
    lang: Language,
  ): SideQuestObjectiveView {
    const completed = rt.completedObjectiveIds.includes(obj.id);
    const current = completed
      ? obj.requiredCount
      : Math.min(obj.requiredCount, rt.counts[obj.id] ?? 0);
    return {
      id: obj.id,
      type: obj.type,
      description: lang === 'ar' ? obj.descriptionAr : obj.descriptionEn,
      current,
      target: obj.requiredCount,
      completed,
      active: !completed && this.isObjectiveEnabled(def, rt, obj),
    };
  }

  public toSideQuestView(
    def: SideQuestDef,
    bridge: Pick<
      SideQuestWorldBridge,
      | 'playerLevel'
      | 'routinePeriod'
      | 'totalWorldHours'
      | 'isStoryQuestCompleted'
      | 'hasStoryFlag'
      | 'getVillageCoords'
      | 'getItemCount'
    >,
    lang = this.language,
    nowMs = Date.now(),
  ): SideQuestView {
    const rt = this.runtimes.get(def.sideQuestId)!;
    const objectives = def.objectives.map((o) =>
      this.toObjectiveView(def, rt, o, lang),
    );
    const ready = this.isReadyToTurnIn(def, rt, bridge);
    const doneCount = objectives.filter((o) => o.completed).length;
    const currentObj =
      objectives.find((o) => o.active) ?? objectives.find((o) => !o.completed);
    const gate = this.evaluateAvailabilityGate(def, bridge, lang);

    const remainingHours =
      rt.state === 'ACTIVE' &&
      typeof def.expirationHours === 'number' &&
      rt.acceptedAtWorldHours !== null
        ? Math.max(
            0,
            Math.round(
              (def.expirationHours -
                (bridge.totalWorldHours - rt.acceptedAtWorldHours)) *
                10,
            ) / 10,
          )
        : null;

    const cooldownRemainingSeconds = this.getCooldownRemainingSeconds(
      def,
      rt,
      nowMs,
    );

    let currentObjectiveText = '';
    if (rt.state === 'COMPLETED') {
      currentObjectiveText =
        cooldownRemainingSeconds > 0
          ? lang === 'ar'
            ? `مكتملة · متاحة مجددًا خلال ${cooldownRemainingSeconds}ث`
            : `Completed · Repeatable in ${cooldownRemainingSeconds}s`
          : lang === 'ar'
            ? 'مهمة جانبية مكتملة'
            : 'Side Quest Completed';
    } else if (ready) {
      const turnInName = this.getNpcDisplayName(def.turnInNpcId, lang);
      currentObjectiveText =
        lang === 'ar'
          ? `جاهزة للتسليم — عد إلى ${turnInName}`
          : `Ready to Turn In — Speak with ${turnInName}`;
    } else if (rt.state === 'EXPIRED') {
      currentObjectiveText =
        lang === 'ar'
          ? 'انتهت المهلة الزمنية — أعد المحاولة'
          : 'Time Expired — Retry when ready';
    } else if (rt.state === 'FAILED') {
      currentObjectiveText =
        lang === 'ar'
          ? 'فشلت المهمة — أعد المحاولة'
          : 'Failed — Retry quest';
    } else if (rt.state === 'LOCKED') {
      currentObjectiveText =
        gate.lockReason ??
        (lang === 'ar' ? 'مقفلة حاليًا' : 'Currently locked');
    } else if (rt.state === 'AVAILABLE') {
      const giverName = this.getNpcDisplayName(def.giverNpcId, lang);
      currentObjectiveText =
        lang === 'ar'
          ? `تحدّث مع ${giverName} أو اقبل من السجل`
          : `Speak with ${giverName} or Accept in Journal`;
    } else if (currentObj) {
      currentObjectiveText =
        currentObj.target > 1
          ? `${currentObj.description} (${currentObj.current}/${currentObj.target})`
          : currentObj.description;
    }

    return {
      sideQuestId: def.sideQuestId,
      title: lang === 'ar' ? def.titleAr : def.title,
      description: lang === 'ar' ? def.descriptionAr : def.description,
      category: def.category,
      state: rt.state,
      giverNpcId: def.giverNpcId,
      giverName: this.getNpcDisplayName(def.giverNpcId, lang),
      turnInNpcId: def.turnInNpcId,
      turnInName: this.getNpcDisplayName(def.turnInNpcId, lang),
      location: lang === 'ar' ? def.locationAr : def.location,
      objectives,
      requiredObjectives: [...def.requiredObjectives],
      currentObjectiveText,
      progressText: `${doneCount}/${objectives.length}`,
      rewards: def.rewards,
      rewardSummary: lang === 'ar' ? def.rewards.summaryAr : def.rewards.summaryEn,
      prerequisites: [...def.prerequisites],
      requiredLevel: this.getMinRequiredLevel(def),
      repeatable: def.repeatable,
      expirationHours: def.expirationHours ?? null,
      remainingHours,
      cooldownRemainingSeconds,
      completedCount: rt.completedCount,
      chainId: def.chainId,
      chainOrder: def.chainOrder,
      chainTitle: lang === 'ar' ? def.chainTitleAr : def.chainTitleEn,
      timeWindow: def.availability?.timeWindow ?? 'any',
      lockReason: rt.state === 'LOCKED' ? gate.lockReason : undefined,
      tracked: def.sideQuestId === this.getTrackedSideQuestId(),
      readyToTurnIn: ready,
    };
  }

  public getTrackedHudQuestView(
    bridge: Pick<
      SideQuestWorldBridge,
      | 'playerLevel'
      | 'routinePeriod'
      | 'totalWorldHours'
      | 'isStoryQuestCompleted'
      | 'hasStoryFlag'
      | 'getVillageCoords'
      | 'getItemCount'
    >,
    lang = this.language,
  ): QuestView | null {
    const id = this.getTrackedSideQuestId();
    if (!id) return null;
    const def = SIDE_QUEST_MAP.get(id);
    if (!def) return null;
    const v = this.toSideQuestView(def, bridge, lang);
    if (v.state === 'LOCKED' || v.state === 'COMPLETED') return null;

    const status = v.readyToTurnIn
      ? 'ready'
      : v.state === 'AVAILABLE'
        ? 'available'
        : 'active';

    const objectives: QuestObjectiveView[] = v.objectives.map((o) => ({
      id: o.id,
      type: mapSideObjTypeToQuestType(o.type),
      description: o.description,
      current: o.current,
      target: o.target,
      completed: o.completed,
      active: o.active,
    }));

    return {
      id: v.sideQuestId,
      title: `[${lang === 'ar' ? 'جانبية' : 'Side'}] ${v.title}`,
      description: v.description,
      scope: 'personal',
      status,
      giverNpcId: v.giverNpcId,
      turnInNpcId: v.turnInNpcId,
      objectives,
      currentObjectiveText: v.currentObjectiveText,
      progressText: v.progressText,
      reward: {
        xp: v.rewards.xp,
        coins: v.rewards.coins,
      },
      rewardSummary: v.rewardSummary,
      tracked: true,
    };
  }

  public getJournalSnapshot(
    bridge: Pick<
      SideQuestWorldBridge,
      | 'playerLevel'
      | 'routinePeriod'
      | 'totalWorldHours'
      | 'isStoryQuestCompleted'
      | 'hasStoryFlag'
      | 'getVillageCoords'
      | 'getItemCount'
    >,
    lang = this.language,
    nowMs = Date.now(),
  ): SideQuestJournalSnapshot {
    this.reconcileAvailability(bridge, nowMs);

    const activeQuests: SideQuestView[] = [];
    const availableQuests: SideQuestView[] = [];
    const lockedQuests: SideQuestView[] = [];
    const completedQuests: SideQuestView[] = [];
    const failedOrExpiredQuests: SideQuestView[] = [];
    let totalUniqueCompleted = 0;

    for (const def of SIDE_QUESTS) {
      const view = this.toSideQuestView(def, bridge, lang, nowMs);
      const rt = this.runtimes.get(def.sideQuestId)!;
      if (rt.completedCount > 0) {
        totalUniqueCompleted += 1;
      }

      if (view.state === 'ACTIVE') {
        activeQuests.push(view);
      } else if (view.state === 'AVAILABLE') {
        availableQuests.push(view);
      } else if (view.state === 'LOCKED') {
        lockedQuests.push(view);
      } else if (view.state === 'COMPLETED') {
        completedQuests.push(view);
      } else {
        failedOrExpiredQuests.push(view);
      }
    }

    return {
      reputation: this.reputation,
      activeQuests,
      availableQuests,
      lockedQuests,
      completedQuests,
      failedOrExpiredQuests,
      trackedSideQuestId: this.getTrackedSideQuestId(),
      totalUniqueCompleted,
      totalQuests: SIDE_QUESTS.length,
    };
  }

  /**
   * Builds non-destructive bilingual branching dialogue for Side Quest offers, turn-ins,
   * retries, and in-progress updates, always allowing players to accept OR decline,
   * and preserving access to standard village/shop dialogue.
   */
  public buildNpcDialogueTree(
    npcId: string,
    bridge: SideQuestWorldBridge,
    lang: Language,
    fallbackTreeBuilder: () => DialogueTree | null,
  ): DialogueTree | null {
    this.reconcileAvailability(bridge);

    const turnInQuests = SIDE_QUESTS.filter((def) => {
      const rt = this.runtimes.get(def.sideQuestId)!;
      return def.turnInNpcId === npcId && this.isReadyToTurnIn(def, rt, bridge);
    });

    const retryQuests = SIDE_QUESTS.filter((def) => {
      const rt = this.runtimes.get(def.sideQuestId)!;
      return (
        (rt.state === 'FAILED' || rt.state === 'EXPIRED') &&
        (def.giverNpcId === npcId || def.turnInNpcId === npcId) &&
        this.evaluateAvailabilityGate(def, bridge).ok
      );
    });

    const availableQuests = SIDE_QUESTS.filter((def) => {
      const rt = this.runtimes.get(def.sideQuestId)!;
      return rt.state === 'AVAILABLE' && def.giverNpcId === npcId;
    });

    const activeQuests = SIDE_QUESTS.filter((def) => {
      const rt = this.runtimes.get(def.sideQuestId)!;
      if (rt.state !== 'ACTIVE' || this.isReadyToTurnIn(def, rt, bridge)) {
        return false;
      }
      return (
        def.giverNpcId === npcId ||
        def.turnInNpcId === npcId ||
        def.objectives.some((o) => o.npcId === npcId)
      );
    });

    const sqNpc = SIDE_QUEST_NPCS.find((n) => n.npcId === npcId);

    // Build quest-specific nodes cleanly
    const nodes: Record<string, DialogueNode> = {};
    const speakerName = sqNpc
      ? lang === 'ar'
        ? sqNpc.nameAr
        : sqNpc.nameEn
      : undefined;

    const addTurnInNodes = (def: SideQuestDef, backNodeId: string | null) => {
      const nodeId = `sq_turnin_${def.sideQuestId}`;
      const doneNodeId = `sq_turnin_done_${def.sideQuestId}`;
      const rewardLine =
        lang === 'ar' ? def.rewards.summaryAr : def.rewards.summaryEn;
      const lines = lang === 'ar' ? def.dialogue.turnInAr : def.dialogue.turnInEn;
      nodes[nodeId] = {
        id: nodeId,
        speaker: speakerName,
        lines: [
          ...lines,
          `${lang === 'ar' ? 'المكافأة' : 'Reward'}: ${rewardLine}`,
        ],
        choices: [
          {
            id: `sq-claim-${def.sideQuestId}`,
            label:
              lang === 'ar'
                ? 'تسليم المهمة واستلام المكافأة'
                : 'Turn In & Claim Reward',
            nextNodeId: doneNodeId,
            questTag: 'complete',
            effects: [{ type: 'sideQuestComplete', sideQuestId: def.sideQuestId }],
          },
          {
            id: `sq-hold-${def.sideQuestId}`,
            label: lang === 'ar' ? 'لاحقًا' : 'Hold for now',
            nextNodeId: backNodeId,
          },
        ],
      };
      nodes[doneNodeId] = {
        id: doneNodeId,
        speaker: speakerName,
        lines: [
          lang === 'ar' ? def.dialogue.followUpAr : def.dialogue.followUpEn,
        ],
        nextNodeId: backNodeId,
      };
      return nodeId;
    };

    const addOfferNodes = (def: SideQuestDef, backNodeId: string | null) => {
      const nodeId = `sq_offer_${def.sideQuestId}`;
      const accId = `sq_accept_${def.sideQuestId}`;
      const decId = `sq_decline_${def.sideQuestId}`;
      const rewardLine =
        lang === 'ar' ? def.rewards.summaryAr : def.rewards.summaryEn;
      const lines = lang === 'ar' ? def.dialogue.introAr : def.dialogue.introEn;
      nodes[nodeId] = {
        id: nodeId,
        speaker: speakerName,
        lines: [
          ...lines,
          `${lang === 'ar' ? 'المكافأة' : 'Reward'}: ${rewardLine}`,
        ],
        choices: [
          {
            id: `sq-yes-${def.sideQuestId}`,
            label: lang === 'ar' ? 'قبول المهمة الجانبية' : 'Accept Side Quest',
            nextNodeId: accId,
            questTag: 'accept',
            effects: [{ type: 'sideQuestAccept', sideQuestId: def.sideQuestId }],
          },
          {
            id: `sq-no-${def.sideQuestId}`,
            label: lang === 'ar' ? 'ليس الآن (رفض)' : 'Not now (Decline)',
            nextNodeId: decId,
          },
        ],
      };
      nodes[accId] = {
        id: accId,
        speaker: speakerName,
        lines: [
          lang === 'ar'
            ? def.dialogue.acceptReplyAr
            : def.dialogue.acceptReplyEn,
        ],
        nextNodeId: backNodeId,
      };
      nodes[decId] = {
        id: decId,
        speaker: speakerName,
        lines: [
          lang === 'ar'
            ? def.dialogue.declineReplyAr
            : def.dialogue.declineReplyEn,
        ],
        nextNodeId: backNodeId,
      };
      return nodeId;
    };

    const addRetryNodes = (def: SideQuestDef, backNodeId: string | null) => {
      const nodeId = `sq_retry_${def.sideQuestId}`;
      const accId = `sq_retry_ok_${def.sideQuestId}`;
      const qTitle = lang === 'ar' ? def.titleAr : def.title;
      nodes[nodeId] = {
        id: nodeId,
        speaker: speakerName,
        lines: [
          lang === 'ar'
            ? `لم تكتمل مهمة "${qTitle}" في المحاولة السابقة. هل تود إعادة المحاولة الآن؟`
            : `"${qTitle}" was not finished on the last attempt. Would you like to try again?`,
        ],
        choices: [
          {
            id: `sq-retry-yes-${def.sideQuestId}`,
            label: lang === 'ar' ? 'نعم، أعد تفعيل المهمة' : 'Yes, Restart Side Quest',
            nextNodeId: accId,
            questTag: 'accept',
            effects: [{ type: 'sideQuestRetry', sideQuestId: def.sideQuestId }],
          },
          {
            id: `sq-retry-no-${def.sideQuestId}`,
            label: lang === 'ar' ? 'ليس الآن' : 'Maybe later',
            nextNodeId: backNodeId,
          },
        ],
      };
      nodes[accId] = {
        id: accId,
        speaker: speakerName,
        lines: [
          lang === 'ar'
            ? def.dialogue.acceptReplyAr
            : def.dialogue.acceptReplyEn,
        ],
        nextNodeId: backNodeId,
      };
      return nodeId;
    };

    const fallback = fallbackTreeBuilder();
    const fallbackStartId =
      fallback && fallback.nodes[fallback.defaultStartNodeId]
        ? fallback.defaultStartNodeId
        : null;

    if (fallback) {
      for (const [k, v] of Object.entries(fallback.nodes)) {
        nodes[k] = v;
      }
    }

    const totalPendingInteractions =
      turnInQuests.length + retryQuests.length + availableQuests.length;

    // If NPC has nothing actionable right now
    if (totalPendingInteractions === 0 && activeQuests.length === 0) {
      if (!sqNpc) return null;
      // Custom Side Quest NPC with completed quests only -> warm personality greeting + followUp
      const completedFromNpc = SIDE_QUESTS.find((q) => {
        const rt = this.runtimes.get(q.sideQuestId)!;
        return rt.completedCount > 0 && q.giverNpcId === npcId;
      });
      const greeting =
        lang === 'ar'
          ? sqNpc.greetingsAr[bridge.routinePeriod]
          : sqNpc.greetingsEn[bridge.routinePeriod];
      const lines = completedFromNpc
        ? [
            greeting,
            lang === 'ar'
              ? completedFromNpc.dialogue.followUpAr
              : completedFromNpc.dialogue.followUpEn,
          ]
        : [greeting];
      return {
        npcId,
        defaultStartNodeId: 'sq_custom_chat',
        nodes: {
          sq_custom_chat: {
            id: 'sq_custom_chat',
            speaker: speakerName,
            lines,
            choices: [
              {
                id: 'sq-chat-close',
                label: lang === 'ar' ? 'إلى اللقاء' : 'Farewell',
                nextNodeId: null,
              },
            ],
          },
        },
      };
    }

    // Single unambiguous priority turn-in / retry / offer / progress
    const fallbackChoice: DialogueChoiceNode | null = fallbackStartId
      ? {
          id: 'sq_to_town_talk',
          label:
            lang === 'ar'
              ? 'الحديث العام ومهام القرية'
              : 'General Chat & Village Quests',
          nextNodeId: fallbackStartId,
        }
      : null;

    if (totalPendingInteractions === 1) {
      let entryNodeId: string;
      if (turnInQuests.length === 1) {
        entryNodeId = addTurnInNodes(turnInQuests[0], null);
      } else if (retryQuests.length === 1) {
        entryNodeId = addRetryNodes(retryQuests[0], null);
      } else {
        entryNodeId = addOfferNodes(availableQuests[0], null);
      }
      if (fallbackChoice && nodes[entryNodeId]?.choices) {
        nodes[entryNodeId].choices!.push(fallbackChoice);
      }
      return {
        npcId,
        defaultStartNodeId: entryNodeId,
        nodes,
      };
    }

    if (totalPendingInteractions > 1) {
      const hubChoices: DialogueChoiceNode[] = [];
      for (const q of turnInQuests) {
        const targetId = addTurnInNodes(q, null);
        hubChoices.push({
          id: `sq_hub_turnin_${q.sideQuestId}`,
          label: `${lang === 'ar' ? 'تسليم' : 'Turn In'}: ${lang === 'ar' ? q.titleAr : q.title}`,
          nextNodeId: targetId,
          questTag: 'complete',
        });
      }
      for (const q of retryQuests) {
        const targetId = addRetryNodes(q, null);
        hubChoices.push({
          id: `sq_hub_retry_${q.sideQuestId}`,
          label: `${lang === 'ar' ? 'إعادة' : 'Retry'}: ${lang === 'ar' ? q.titleAr : q.title}`,
          nextNodeId: targetId,
        });
      }
      for (const q of availableQuests) {
        const targetId = addOfferNodes(q, null);
        hubChoices.push({
          id: `sq_hub_offer_${q.sideQuestId}`,
          label: `${lang === 'ar' ? 'مهمة جانبية' : 'Side Quest'}: ${lang === 'ar' ? q.titleAr : q.title}`,
          nextNodeId: targetId,
        });
      }
      if (fallbackChoice) hubChoices.push(fallbackChoice);
      hubChoices.push({
        id: 'sq_hub_close',
        label: lang === 'ar' ? 'إغلاق' : 'Close',
        nextNodeId: null,
      });

      const greeting = sqNpc
        ? lang === 'ar'
          ? sqNpc.greetingsAr[bridge.routinePeriod]
          : sqNpc.greetingsEn[bridge.routinePeriod]
        : lang === 'ar'
          ? 'مرحبًا أيها المغامر، لدي ما قد يهمك.'
          : 'Hello adventurer, I have some matters to discuss.';

      nodes.sq_hub = {
        id: 'sq_hub',
        speaker: speakerName,
        lines: [greeting],
        choices: hubChoices,
      };
      return {
        npcId,
        defaultStartNodeId: 'sq_hub',
        nodes,
      };
    }

    // Active quest in progress
    const activeQ = activeQuests[0];
    const progressLines =
      lang === 'ar' ? activeQ.dialogue.progressAr : activeQ.dialogue.progressEn;
    const progressChoices: DialogueChoiceNode[] = [];
    if (fallbackChoice) progressChoices.push(fallbackChoice);
    progressChoices.push({
      id: 'sq_prog_ok',
      label: lang === 'ar' ? 'مفهوم، سأواصل المهمة' : 'Understood',
      nextNodeId: null,
    });
    nodes.sq_progress = {
      id: 'sq_progress',
      speaker: speakerName,
      lines: progressLines,
      choices: progressChoices,
    };

    return {
      npcId,
      defaultStartNodeId: 'sq_progress',
      nodes,
    };
  }
}
