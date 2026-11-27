import { enemyTypeMatches } from '../world/WorldEntityRegistry';
import type {
  DialogueChoiceNode,
  DialogueNode,
  DialogueTree,
} from '../dialogue/dialogueTypes';
import { UI_TEXT, type Language } from '../i18n/translations';
import type { QuestObjectiveView, QuestType, QuestView } from '../quest/questTypes';
import {
  STORY_CHAPTERS,
  STORY_DIALOGUE_SCRIPTS,
  STORY_QUESTS,
} from './storyCampaign';
import type {
  SavedStoryState,
  StoryAnchorRef,
  StoryChapterDef,
  StoryChapterView,
  StoryJournalSnapshot,
  StoryKillRequest,
  StoryLocalSpawnDef,
  StoryMapMarkerInput,
  StoryObjectiveDef,
  StoryObjectiveView,
  StoryQuestDef,
  StoryQuestRuntime,
  StoryQuestState,
  StoryQuestView,
  StoryWorldBridge,
} from './storyTypes';

const NPC_HOME_VILLAGE: Record<string, string> = {
  'npc-thorne': 'oakhollow',
  'npc-doran': 'oakhollow',
  'npc-alden': 'oakhollow',
  'npc-rowan': 'oakhollow',
  'npc-greenfields-guard-4': 'greenfields',
  'npc-pinehaven-guard-3': 'pinehaven',
  'npc-cragwatch-guard-2': 'cragwatch',
  'npc-cragwatch-elder-3': 'cragwatch',
  'npc-grandcross-elder-4': 'grandcross',
  'npc-sunspire-elder-3': 'sunspire',
};

const QUEST_MAP = new Map<string, StoryQuestDef>(
  STORY_QUESTS.map((q) => [q.questId, q]),
);
const CHAPTER_MAP = new Map<string, StoryChapterDef>(
  STORY_CHAPTERS.map((c) => [c.chapterId, c]),
);

function mapStoryObjTypeToQuestType(type: StoryObjectiveDef['type']): QuestType {
  switch (type) {
    case 'talk_to_npc':
      return 'talk_to_npc';
    case 'collect_resource':
    case 'find_item':
    case 'open_chest':
      return 'collect_items';
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

export class StoryManager {
  private currentChapterId = 'ch1';
  private trackedQuestId: string | null = 'story-ch1-q1';
  private readonly unlockedFlags = new Set<string>();
  private readonly runtimes = new Map<string, StoryQuestRuntime>();
  private language: Language = 'en';
  private modEventHooks: {
    onQuestStarted?: (questId: string) => void;
    onQuestCompleted?: (questId: string) => void;
    onQuestFailed?: (questId: string) => void;
  } | null = null;

  constructor() {
    this.reset();
  }

  public setModEventHooks(
    hooks: {
      onQuestStarted?: (questId: string) => void;
      onQuestCompleted?: (questId: string) => void;
      onQuestFailed?: (questId: string) => void;
    } | null,
  ): void {
    this.modEventHooks = hooks;
  }

  public setLanguage(lang: Language): void {
    this.language = lang;
  }

  public getLanguage(): Language {
    return this.language;
  }

  public reset(): void {
    this.currentChapterId = 'ch1';
    this.trackedQuestId = 'story-ch1-q1';
    this.unlockedFlags.clear();
    this.runtimes.clear();

    for (const def of STORY_QUESTS) {
      this.runtimes.set(def.questId, {
        questId: def.questId,
        state: def.state,
        completedObjectiveIds: [],
        counts: {},
        creditedEntityIds: [],
      });
    }
  }

  public exportState(): SavedStoryState {
    const quests: Record<string, StoryQuestRuntime> = {};
    for (const [id, rt] of this.runtimes) {
      quests[id] = {
        questId: rt.questId,
        state: rt.state,
        completedObjectiveIds: [...rt.completedObjectiveIds],
        counts: { ...rt.counts },
        creditedEntityIds: [...rt.creditedEntityIds],
      };
    }
    return {
      currentChapterId: this.currentChapterId,
      trackedQuestId: this.trackedQuestId,
      unlockedFlags: Array.from(this.unlockedFlags),
      quests,
    };
  }

  public restoreState(saved?: SavedStoryState | null): void {
    this.reset();
    if (!saved || typeof saved !== 'object') {
      return;
    }

    if (typeof saved.currentChapterId === 'string' && CHAPTER_MAP.has(saved.currentChapterId)) {
      this.currentChapterId = saved.currentChapterId;
    }
    if (Array.isArray(saved.unlockedFlags)) {
      for (const f of saved.unlockedFlags) {
        if (typeof f === 'string' && f.trim()) {
          this.unlockedFlags.add(f);
        }
      }
    }

    if (saved.quests && typeof saved.quests === 'object') {
      for (const def of STORY_QUESTS) {
        const entry = saved.quests[def.questId];
        if (!entry) continue;
        const rt = this.runtimes.get(def.questId)!;
        const validStates: StoryQuestState[] = [
          'LOCKED',
          'AVAILABLE',
          'ACTIVE',
          'OBJECTIVE_COMPLETED',
          'COMPLETED',
          'FAILED',
        ];
        if (validStates.includes(entry.state)) {
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
      }
    }

    this.reconcileUnlocks(false);

    if (
      typeof saved.trackedQuestId === 'string' &&
      this.isTrackableState(this.runtimes.get(saved.trackedQuestId)?.state)
    ) {
      this.trackedQuestId = saved.trackedQuestId;
    } else {
      this.trackedQuestId = this.pickDefaultTrackedQuestId();
    }
  }

  private isTrackableState(state?: StoryQuestState): boolean {
    return (
      state === 'ACTIVE' ||
      state === 'OBJECTIVE_COMPLETED' ||
      state === 'AVAILABLE' ||
      state === 'FAILED'
    );
  }

  public getTrackedQuestId(): string | null {
    if (
      this.trackedQuestId &&
      this.isTrackableState(this.runtimes.get(this.trackedQuestId)?.state)
    ) {
      return this.trackedQuestId;
    }
    this.trackedQuestId = this.pickDefaultTrackedQuestId();
    return this.trackedQuestId;
  }

  public setTrackedQuest(questId: string | null): boolean {
    if (questId === null) {
      this.trackedQuestId = null;
      return true;
    }
    const rt = this.runtimes.get(questId);
    if (!rt || !this.isTrackableState(rt.state)) {
      return false;
    }
    this.trackedQuestId = questId;
    return true;
  }

  public getQuestState(questId: string): StoryQuestState {
    return this.runtimes.get(questId)?.state ?? 'LOCKED';
  }

  public hasUnlockedFlag(flag: string): boolean {
    return this.unlockedFlags.has(flag);
  }

  public isCampaignCompleted(): boolean {
    return (
      this.unlockedFlags.has('story:campaign_completed') ||
      this.runtimes.get('story-ch6-q2')?.state === 'COMPLETED'
    );
  }

  public getCompletedQuestIds(): string[] {
    const ids: string[] = [];
    for (const [id, rt] of this.runtimes) {
      if (rt.state === 'COMPLETED') {
        ids.push(id);
      }
    }
    return ids;
  }

  public getCurrentChapterId(): string {
    return this.currentChapterId;
  }

  private pickDefaultTrackedQuestId(): string | null {
    for (const q of STORY_QUESTS) {
      const s = this.runtimes.get(q.questId)?.state;
      if (s === 'ACTIVE' || s === 'OBJECTIVE_COMPLETED') {
        return q.questId;
      }
    }
    for (const q of STORY_QUESTS) {
      const s = this.runtimes.get(q.questId)?.state;
      if (s === 'FAILED' || s === 'AVAILABLE') {
        return q.questId;
      }
    }
    return null;
  }

  private getCurrentActiveObjective(
    def: StoryQuestDef,
    rt: StoryQuestRuntime,
  ): StoryObjectiveDef | null {
    for (const obj of def.objectives) {
      if (!rt.completedObjectiveIds.includes(obj.id)) {
        return obj;
      }
    }
    return null;
  }

  private isObjectiveEnabled(
    def: StoryQuestDef,
    rt: StoryQuestRuntime,
    obj: StoryObjectiveDef,
  ): boolean {
    if (rt.state !== 'ACTIVE') return false;
    if (!def.sequential) return true;
    const current = this.getCurrentActiveObjective(def, rt);
    return current?.id === obj.id;
  }

  private markObjectiveCompleted(
    def: StoryQuestDef,
    rt: StoryQuestRuntime,
    obj: StoryObjectiveDef,
    notify?: (msg: string) => void,
  ): boolean {
    if (rt.completedObjectiveIds.includes(obj.id)) return false;
    rt.completedObjectiveIds.push(obj.id);
    rt.counts[obj.id] = obj.requiredCount;

    const lang = this.language;
    const desc = lang === 'ar' ? obj.descriptionAr : obj.descriptionEn;
    if (notify) {
      notify(`${UI_TEXT[lang].objectiveCompletePrefix}: ${desc}`);
    }

    const allRequiredDone = def.requiredObjectives.every((reqId) =>
      rt.completedObjectiveIds.includes(reqId),
    );
    if (allRequiredDone && rt.state === 'ACTIVE') {
      rt.state = 'OBJECTIVE_COMPLETED';
      if (notify) {
        const qTitle = lang === 'ar' ? def.titleAr : def.title;
        notify(
          lang === 'ar'
            ? `أُنجزت أهداف القصة: ${qTitle} — عد لتسليم المهمة!`
            : `Story Objectives Complete: ${qTitle} — Return to complete!`,
        );
      }
    }
    return true;
  }

  private checkObjectiveCountProgress(
    def: StoryQuestDef,
    rt: StoryQuestRuntime,
    obj: StoryObjectiveDef,
    newCount: number,
    notify?: (msg: string) => void,
  ): boolean {
    const prev = rt.counts[obj.id] ?? 0;
    const clamped = Math.max(prev, Math.min(obj.requiredCount, newCount));
    let changed = clamped !== prev;
    rt.counts[obj.id] = clamped;
    if (clamped >= obj.requiredCount) {
      if (this.markObjectiveCompleted(def, rt, obj, notify)) {
        changed = true;
      }
    }
    return changed;
  }

  public startQuest(questId: string, notify?: (msg: string) => void): boolean {
    const def = QUEST_MAP.get(questId);
    const rt = this.runtimes.get(questId);
    if (!def || !rt) return false;
    if (rt.state !== 'AVAILABLE' && rt.state !== 'FAILED') return false;

    const prereqsMet = def.prerequisites.every(
      (pid) => this.runtimes.get(pid)?.state === 'COMPLETED',
    );
    if (!prereqsMet) return false;

    rt.state = 'ACTIVE';
    if (rt.completedObjectiveIds.length > 0 && rt.state === 'ACTIVE') {
      // Preserve prior objective progress only if retrying isn't a reset
    }
    this.currentChapterId = def.chapterId;
    this.trackedQuestId = def.questId;
    this.modEventHooks?.onQuestStarted?.(def.questId);

    if (notify) {
      const lang = this.language;
      const title = lang === 'ar' ? def.titleAr : def.title;
      notify(UI_TEXT[lang].storyQuestStartedNotice(title));
    }
    return true;
  }

  public retryFailedQuest(questId: string, notify?: (msg: string) => void): boolean {
    const def = QUEST_MAP.get(questId);
    const rt = this.runtimes.get(questId);
    if (!def || !rt || rt.state !== 'FAILED') return false;

    rt.state = 'ACTIVE';
    // Reset failed combat/protect objective counts so player cleanly fights again
    for (const obj of def.objectives) {
      if (obj.type === 'protect_npc' || obj.type === 'defeat_enemy' || obj.type === 'defeat_bandit') {
        rt.completedObjectiveIds = rt.completedObjectiveIds.filter((id) => id !== obj.id);
        rt.counts[obj.id] = 0;
      }
    }
    this.trackedQuestId = def.questId;
    this.currentChapterId = def.chapterId;
    this.modEventHooks?.onQuestStarted?.(def.questId);
    if (notify) {
      const title = this.language === 'ar' ? def.titleAr : def.title;
      notify(UI_TEXT[this.language].storyQuestStartedNotice(title));
    }
    return true;
  }

  public failQuest(questId: string, notify?: (msg: string) => void): boolean {
    const def = QUEST_MAP.get(questId);
    const rt = this.runtimes.get(questId);
    if (!def || !rt) return false;
    if (rt.state !== 'ACTIVE' && rt.state !== 'OBJECTIVE_COMPLETED') return false;
    rt.state = 'FAILED';
    this.modEventHooks?.onQuestFailed?.(def.questId);
    if (notify) {
      const title = this.language === 'ar' ? def.titleAr : def.title;
      notify(UI_TEXT[this.language].storyQuestFailedNotice(title));
    }
    return true;
  }

  public completeQuest(
    questId: string,
    bridge: StoryWorldBridge,
    notify?: (msg: string) => void,
  ): boolean {
    const def = QUEST_MAP.get(questId);
    const rt = this.runtimes.get(questId);
    if (!def || !rt) return false;
    if (rt.state !== 'OBJECTIVE_COMPLETED') return false;

    for (const obj of def.objectives) {
      if (obj.consumeOnComplete && obj.itemId) {
        if (bridge.getItemCount(obj.itemId) >= obj.requiredCount) {
          bridge.consumeItem(obj.itemId, obj.requiredCount);
        }
      }
    }

    rt.state = 'COMPLETED';
    if (def.rewards.unlockFlag) {
      this.unlockedFlags.add(def.rewards.unlockFlag);
    }

    if (def.rewards.items) {
      for (const item of def.rewards.items) {
        bridge.giveItem(item.id, item.count);
      }
    }
    const questTitle = this.language === 'ar' ? def.titleAr : def.title;
    bridge.grantRewards(def.rewards.xp, def.rewards.coins, questTitle);

    this.reconcileUnlocks(true, notify);
    this.trackedQuestId = this.pickDefaultTrackedQuestId();
    this.modEventHooks?.onQuestCompleted?.(def.questId);
    return true;
  }

  private reconcileUnlocks(autoActivateNext: boolean, notify?: (msg: string) => void): void {
    // 1. Complete any pending `complete_quest` objectives on active quests
    for (const def of STORY_QUESTS) {
      const rt = this.runtimes.get(def.questId);
      if (!rt || rt.state !== 'ACTIVE') continue;
      for (const obj of def.objectives) {
        if (obj.type === 'complete_quest' && obj.targetQuestId) {
          if (this.runtimes.get(obj.targetQuestId)?.state === 'COMPLETED') {
            this.markObjectiveCompleted(def, rt, obj, notify);
          }
        }
      }
    }

    // 2. Promote LOCKED quests whose prerequisites are all COMPLETED
    const newlyUnlocked: StoryQuestDef[] = [];
    for (const def of STORY_QUESTS) {
      const rt = this.runtimes.get(def.questId);
      if (!rt || rt.state !== 'LOCKED') continue;
      const prereqsMet = def.prerequisites.every(
        (pid) => this.runtimes.get(pid)?.state === 'COMPLETED',
      );
      if (prereqsMet) {
        rt.state = 'AVAILABLE';
        newlyUnlocked.push(def);
      }
    }

    // 3. Auto-activate the primary linear continuation so the player always has a clear active quest
    if (autoActivateNext) {
      const hasAnyActive = STORY_QUESTS.some((q) => {
        const st = this.runtimes.get(q.questId)?.state;
        return st === 'ACTIVE' || st === 'OBJECTIVE_COMPLETED';
      });
      if (!hasAnyActive) {
        const firstAvail =
          newlyUnlocked[0] ??
          STORY_QUESTS.find((q) => this.runtimes.get(q.questId)?.state === 'AVAILABLE');
        if (firstAvail) {
          this.startQuest(firstAvail.questId, notify);
        }
      }
    }

    // Update currentChapterId to highest unlocked / active chapter
    let activeChapter: StoryChapterDef | null = null;
    for (const ch of STORY_CHAPTERS) {
      const anyActiveOrAvail = ch.questIds.some((qid) => {
        const st = this.runtimes.get(qid)?.state;
        return st === 'ACTIVE' || st === 'OBJECTIVE_COMPLETED' || st === 'FAILED' || st === 'AVAILABLE';
      });
      if (anyActiveOrAvail) {
        activeChapter = ch;
        break;
      }
    }
    if (activeChapter) {
      this.currentChapterId = activeChapter.chapterId;
    } else if (this.isCampaignCompleted()) {
      this.currentChapterId = 'ch6';
    }
  }

  public update(bridge: StoryWorldBridge, notify?: (msg: string) => void): boolean {
    let changed = false;

    for (const def of STORY_QUESTS) {
      const rt = this.runtimes.get(def.questId);
      if (!rt) continue;

      if (rt.state === 'ACTIVE') {
        for (const obj of def.objectives) {
          if (rt.completedObjectiveIds.includes(obj.id)) continue;

          // Check failure condition on protect_npc even while objective is active
          if (obj.type === 'protect_npc' && obj.npcId) {
            const alive = bridge.isNpcAlive(obj.npcId);
            if (alive === false && this.isObjectiveEnabled(def, rt, obj)) {
              this.failQuest(def.questId, notify);
              changed = true;
              break;
            }
          }

          if (!this.isObjectiveEnabled(def, rt, obj)) continue;

          switch (obj.type) {
            case 'reach_location':
            case 'explore_location': {
              const target = this.resolveObjectiveCoords(obj, bridge);
              if (target) {
                const rad = obj.radius ?? (obj.type === 'explore_location' ? 28 : 42);
                const dist = Math.hypot(bridge.playerX - target.x, bridge.playerZ - target.z);
                if (dist <= rad) {
                  if (this.markObjectiveCompleted(def, rt, obj, notify)) {
                    changed = true;
                  }
                }
              }
              break;
            }
            case 'discover_village': {
              if (obj.villageId) {
                const vInfo = bridge.getVillageCoords(obj.villageId);
                if (vInfo) {
                  const dist = Math.hypot(bridge.playerX - vInfo.x, bridge.playerZ - vInfo.z);
                  if (vInfo.discovered || dist <= 52) {
                    if (this.markObjectiveCompleted(def, rt, obj, notify)) {
                      changed = true;
                    }
                  }
                }
              }
              break;
            }
            case 'collect_resource':
            case 'find_item': {
              if (obj.itemId) {
                const count = bridge.getItemCount(obj.itemId);
                if (count > 0 && this.checkObjectiveCountProgress(def, rt, obj, count, notify)) {
                  changed = true;
                }
              }
              break;
            }
            case 'open_chest': {
              if (obj.chestId && bridge.isChestOpened(obj.chestId)) {
                const chestCoords = bridge.getChestCoords(obj.chestId);
                const nearChest =
                  !chestCoords ||
                  Math.hypot(bridge.playerX - chestCoords.x, bridge.playerZ - chestCoords.z) <= 28;
                if (nearChest && this.markObjectiveCompleted(def, rt, obj, notify)) {
                  changed = true;
                }
              }
              break;
            }
            case 'enter_building': {
              if (bridge.indoorFactor > 0.2 || bridge.enteredBuildingRecently) {
                if (this.markObjectiveCompleted(def, rt, obj, notify)) {
                  changed = true;
                }
              }
              break;
            }
            case 'complete_quest': {
              if (obj.targetQuestId && this.runtimes.get(obj.targetQuestId)?.state === 'COMPLETED') {
                if (this.markObjectiveCompleted(def, rt, obj, notify)) {
                  changed = true;
                }
              }
              break;
            }
            default:
              break;
          }
        }
      }
    }

    return changed;
  }

  public onNpcTalked(
    npcId: string,
    notify?: (msg: string) => void,
  ): boolean {
    let changed = false;
    for (const def of STORY_QUESTS) {
      const rt = this.runtimes.get(def.questId);
      if (!rt || rt.state !== 'ACTIVE') continue;

      for (const obj of def.objectives) {
        if (rt.completedObjectiveIds.includes(obj.id)) continue;
        if (!this.isObjectiveEnabled(def, rt, obj)) continue;
        if (obj.type === 'talk_to_npc' && obj.npcId === npcId) {
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
    for (const def of STORY_QUESTS) {
      const rt = this.runtimes.get(def.questId);
      if (!rt || rt.state !== 'ACTIVE') continue;

      for (const obj of def.objectives) {
        if (rt.completedObjectiveIds.includes(obj.id)) continue;
        if (!this.isObjectiveEnabled(def, rt, obj)) continue;
        if (
          obj.type === 'rescue_npc' &&
          (obj.npcId === rescueIdOrNpcId || obj.localSpawn?.id === rescueIdOrNpcId)
        ) {
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
    opts?: {
      questBinding?: { questId: string; objectiveId: string };
      killPos?: { x: number; z: number };
      bridge?: Pick<
        StoryWorldBridge,
        'getNpcPosition' | 'getLocationCoords' | 'getVillageCoords' | 'getChestCoords' | 'resolveLandPoint'
      >;
    },
  ): boolean {
    let changed = false;
    for (const def of STORY_QUESTS) {
      const rt = this.runtimes.get(def.questId);
      if (!rt || rt.state !== 'ACTIVE') continue;

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
          obj.type === 'defeat_bandit' ? 'bandit_scout' : (obj.enemyType ?? 'any');
        if (!enemyTypeMatches(expected, enemyType)) continue;

        const matchesExactBinding =
          opts?.questBinding?.questId === def.questId &&
          opts?.questBinding?.objectiveId === obj.id;
        if (!matchesExactBinding) {
          // Do not credit an enemy explicitly bound to a different quest/objective
          if (opts?.questBinding) continue;
          // For location-bound objectives, ignore unrelated enemies killed far outside the quest area
          if (
            (obj.anchor || obj.locationId || obj.villageId) &&
            opts?.killPos &&
            opts?.bridge
          ) {
            const areaCoords = this.resolveObjectiveCoords(obj, opts.bridge);
            if (
              areaCoords &&
              Math.hypot(opts.killPos.x - areaCoords.x, opts.killPos.z - areaCoords.z) > 95
            ) {
              continue;
            }
          }
        }

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

  public onChestOpened(chestId: string, notify?: (msg: string) => void): boolean {
    let changed = false;
    for (const def of STORY_QUESTS) {
      const rt = this.runtimes.get(def.questId);
      if (!rt || rt.state !== 'ACTIVE') continue;
      for (const obj of def.objectives) {
        if (rt.completedObjectiveIds.includes(obj.id)) continue;
        if (!this.isObjectiveEnabled(def, rt, obj)) continue;
        if (obj.type === 'open_chest' && obj.chestId === chestId) {
          if (this.markObjectiveCompleted(def, rt, obj, notify)) {
            changed = true;
          }
        }
      }
    }
    return changed;
  }

  public onVillageDiscovered(villageId: string, notify?: (msg: string) => void): boolean {
    let changed = false;
    for (const def of STORY_QUESTS) {
      const rt = this.runtimes.get(def.questId);
      if (!rt || rt.state !== 'ACTIVE') continue;
      for (const obj of def.objectives) {
        if (rt.completedObjectiveIds.includes(obj.id)) continue;
        if (!this.isObjectiveEnabled(def, rt, obj)) continue;
        if (obj.type === 'discover_village' && obj.villageId === villageId) {
          if (this.markObjectiveCompleted(def, rt, obj, notify)) {
            changed = true;
          }
        }
      }
    }
    return changed;
  }

  public onBuildingEntered(notify?: (msg: string) => void): boolean {
    let changed = false;
    for (const def of STORY_QUESTS) {
      const rt = this.runtimes.get(def.questId);
      if (!rt || rt.state !== 'ACTIVE') continue;
      for (const obj of def.objectives) {
        if (rt.completedObjectiveIds.includes(obj.id)) continue;
        if (!this.isObjectiveEnabled(def, rt, obj)) continue;
        if (obj.type === 'enter_building') {
          if (this.markObjectiveCompleted(def, rt, obj, notify)) {
            changed = true;
          }
        }
      }
    }
    return changed;
  }

  public resolveAnchorCoords(
    anchor: StoryAnchorRef | undefined,
    bridge: Pick<
      StoryWorldBridge,
      'getNpcPosition' | 'getLocationCoords' | 'getVillageCoords' | 'getChestCoords' | 'resolveLandPoint'
    >,
  ): { x: number; z: number } | null {
    if (!anchor) return null;
    switch (anchor.kind) {
      case 'npc': {
        const live = bridge.getNpcPosition(anchor.npcId);
        if (live) return live;
        const homeVillageId = NPC_HOME_VILLAGE[anchor.npcId];
        if (homeVillageId) {
          const v = bridge.getVillageCoords(homeVillageId);
          if (v) return { x: v.x, z: v.z };
        }
        return null;
      }
      case 'location': {
        const loc = bridge.getLocationCoords(anchor.locationId);
        return loc ? { x: loc.x, z: loc.z } : null;
      }
      case 'village': {
        const v = bridge.getVillageCoords(anchor.villageId);
        return v ? { x: v.x, z: v.z } : null;
      }
      case 'chest': {
        const chest = bridge.getChestCoords(anchor.chestId);
        if (chest) return chest;
        if (anchor.locationId) {
          const loc = bridge.getLocationCoords(anchor.locationId);
          return loc ? { x: loc.x, z: loc.z } : null;
        }
        return null;
      }
      case 'between': {
        const fromV = bridge.getVillageCoords(anchor.fromVillageId);
        const toL = bridge.getLocationCoords(anchor.toLocationId);
        if (!fromV || !toL) return null;
        const rx = fromV.x + (toL.x - fromV.x) * anchor.t;
        const rz = fromV.z + (toL.z - fromV.z) * anchor.t;
        return bridge.resolveLandPoint(rx, rz);
      }
      case 'offset_location': {
        const loc = bridge.getLocationCoords(anchor.locationId);
        if (!loc) return null;
        return bridge.resolveLandPoint(loc.x + anchor.dx, loc.z + anchor.dz);
      }
      case 'coords':
        return bridge.resolveLandPoint(anchor.x, anchor.z);
    }
  }

  private resolveObjectiveCoords(
    obj: StoryObjectiveDef,
    bridge: Pick<
      StoryWorldBridge,
      'getNpcPosition' | 'getLocationCoords' | 'getVillageCoords' | 'getChestCoords' | 'resolveLandPoint'
    >,
  ): { x: number; z: number } | null {
    if (obj.anchor) {
      return this.resolveAnchorCoords(obj.anchor, bridge);
    }
    if (obj.npcId) {
      return this.resolveAnchorCoords({ kind: 'npc', npcId: obj.npcId }, bridge);
    }
    if (obj.locationId) {
      return this.resolveAnchorCoords({ kind: 'location', locationId: obj.locationId }, bridge);
    }
    if (obj.villageId) {
      return this.resolveAnchorCoords({ kind: 'village', villageId: obj.villageId }, bridge);
    }
    return null;
  }

  /**
   * Returns enemy targets needed by active story quests for CombatManager.ensureQuestTargets.
   */
  public getActiveKillRequests(
    bridge: Pick<
      StoryWorldBridge,
      'getNpcPosition' | 'getLocationCoords' | 'getVillageCoords' | 'getChestCoords' | 'resolveLandPoint'
    >,
  ): StoryKillRequest[] {
    const out: StoryKillRequest[] = [];
    for (const def of STORY_QUESTS) {
      const rt = this.runtimes.get(def.questId);
      if (!rt || rt.state !== 'ACTIVE') continue;

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
        const anchor =
          obj.type === 'protect_npc' && obj.villageId
            ? (() => {
                const v = bridge.getVillageCoords(obj.villageId);
                return v ? bridge.resolveLandPoint(v.x + 34, v.z + 14) : null;
              })()
            : this.resolveObjectiveCoords(obj, bridge);

        out.push({
          questId: def.questId,
          objectiveId: obj.id,
          enemyType:
            obj.type === 'defeat_bandit' ? 'bandit_scout' : (obj.enemyType ?? 'bandit_scout'),
          requiredCount: obj.requiredCount,
          currentCount: rt.counts[obj.id] ?? 0,
          targetX: anchor?.x,
          targetZ: anchor?.z,
        });
      }
    }
    return out;
  }

  /**
   * Lazy-streaming helper: returns temporary clues / captive rescue interactables only for ACTIVE objectives
   * whose locations are within `streamRadius` meters of the player.
   */
  public getPendingLocalSpawns(
    playerX: number,
    playerZ: number,
    bridge: Pick<
      StoryWorldBridge,
      'getNpcPosition' | 'getLocationCoords' | 'getVillageCoords' | 'getChestCoords' | 'resolveLandPoint' | 'getItemCount'
    >,
    streamRadius = 165,
  ): Array<{
    def: StoryLocalSpawnDef;
    x: number;
    z: number;
    questId: string;
  }> {
    const out: Array<{ def: StoryLocalSpawnDef; x: number; z: number; questId: string }> = [];
    const rSq = streamRadius * streamRadius;

    for (const q of STORY_QUESTS) {
      const rt = this.runtimes.get(q.questId);
      if (!rt || rt.state !== 'ACTIVE') continue;

      for (const obj of q.objectives) {
        if (!obj.localSpawn) continue;
        if (rt.completedObjectiveIds.includes(obj.id)) continue;
        if (!this.isObjectiveEnabled(q, rt, obj)) continue;
        if (obj.itemId && bridge.getItemCount(obj.itemId) >= obj.requiredCount) continue;

        const coords = this.resolveAnchorCoords(obj.localSpawn.anchor, bridge);
        if (!coords) continue;
        const dSq = (coords.x - playerX) ** 2 + (coords.z - playerZ) ** 2;
        if (dSq <= rSq) {
          out.push({
            def: obj.localSpawn,
            x: coords.x,
            z: coords.z,
            questId: q.questId,
          });
        }
      }
    }
    return out;
  }

  /**
   * Produces valid, dry-land world coordinates for active/available/turn-in story map pins.
   */
  public getMapMarkers(
    bridge: Pick<
      StoryWorldBridge,
      'getNpcPosition' | 'getLocationCoords' | 'getVillageCoords' | 'getChestCoords' | 'resolveLandPoint'
    >,
    lang = this.language,
  ): StoryMapMarkerInput[] {
    const out: StoryMapMarkerInput[] = [];
    const trackedId = this.getTrackedQuestId();

    for (const q of STORY_QUESTS) {
      const rt = this.runtimes.get(q.questId);
      if (!rt) continue;
      if (rt.state === 'LOCKED' || rt.state === 'COMPLETED') continue;

      const title = lang === 'ar' ? q.titleAr : q.title;
      const isTracked = q.questId === trackedId;

      if (rt.state === 'OBJECTIVE_COMPLETED') {
        const turnIn = this.resolveAnchorCoords({ kind: 'npc', npcId: q.turnInNpcId }, bridge);
        if (turnIn && Number.isFinite(turnIn.x) && Number.isFinite(turnIn.z)) {
          out.push({
            id: `story-turnin-${q.questId}`,
            questId: q.questId,
            role: 'npc',
            label: title,
            subtitle:
              lang === 'ar'
                ? 'المهمة جاهزة للتسليم — تحدث مع صاحب المهمة'
                : 'Ready to complete — Speak with quest contact',
            x: turnIn.x,
            z: turnIn.z,
            tracked: isTracked,
          });
        }
        continue;
      }

      if (rt.state === 'AVAILABLE' || rt.state === 'FAILED') {
        const giver = this.resolveAnchorCoords({ kind: 'npc', npcId: q.giverNpcId }, bridge);
        if (giver && Number.isFinite(giver.x) && Number.isFinite(giver.z)) {
          out.push({
            id: `story-avail-${q.questId}`,
            questId: q.questId,
            role: 'npc',
            label: title,
            subtitle:
              rt.state === 'FAILED'
                ? lang === 'ar'
                  ? 'فشلت المهمة — أعد المحاولة من السجل أو المتحدث'
                  : 'Failed — Retry from Story Journal or speaker'
                : lang === 'ar'
                  ? 'مهمة قصة متاحة'
                  : 'Available Story Quest',
            x: giver.x,
            z: giver.z,
            tracked: isTracked,
          });
        }
        continue;
      }

      // ACTIVE quest -> pin current active objective
      const currentObj = this.getCurrentActiveObjective(q, rt);
      if (!currentObj) continue;
      const coords = this.resolveObjectiveCoords(currentObj, bridge);
      if (!coords || !Number.isFinite(coords.x) || !Number.isFinite(coords.z)) continue;

      out.push({
        id: `story-obj-${q.questId}-${currentObj.id}`,
        questId: q.questId,
        role: currentObj.markerRole,
        label: title,
        subtitle: lang === 'ar' ? currentObj.descriptionAr : currentObj.descriptionEn,
        x: coords.x,
        z: coords.z,
        radius:
          currentObj.radius ??
          (currentObj.markerRole === 'enemy' || currentObj.markerRole === 'investigation'
            ? 38
            : undefined),
        tracked: isTracked,
      });
    }

    return out;
  }

  private toObjectiveView(
    def: StoryQuestDef,
    rt: StoryQuestRuntime,
    obj: StoryObjectiveDef,
    lang: Language,
  ): StoryObjectiveView {
    const completed = rt.completedObjectiveIds.includes(obj.id);
    const current = completed ? obj.requiredCount : Math.min(obj.requiredCount, rt.counts[obj.id] ?? 0);
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

  public toQuestView(def: StoryQuestDef, lang = this.language): StoryQuestView {
    const rt = this.runtimes.get(def.questId) ?? {
      questId: def.questId,
      state: def.state,
      completedObjectiveIds: [],
      counts: {},
      creditedEntityIds: [],
    };
    const objectives = def.objectives.map((o) => this.toObjectiveView(def, rt, o, lang));
    const currentObj = objectives.find((o) => o.active) ?? objectives.find((o) => !o.completed);
    const doneCount = objectives.filter((o) => o.completed).length;

    let currentObjectiveText = '';
    if (rt.state === 'COMPLETED') {
      currentObjectiveText = lang === 'ar' ? 'مهمة قصة مكتملة' : 'Story Quest Completed';
    } else if (rt.state === 'OBJECTIVE_COMPLETED') {
      currentObjectiveText =
        lang === 'ar'
          ? 'الأهداف مكتملة — عد لتسليم المهمة!'
          : 'Objectives Complete — Return to complete quest!';
    } else if (rt.state === 'FAILED') {
      currentObjectiveText =
        lang === 'ar' ? 'فشلت المهمة — اضغط إعادة المحاولة' : 'Failed — Retry quest';
    } else if (rt.state === 'LOCKED') {
      currentObjectiveText =
        lang === 'ar' ? 'مغلق حتى إتمام المهام السابقة' : 'Locked until earlier story quests complete';
    } else if (rt.state === 'AVAILABLE') {
      currentObjectiveText =
        lang === 'ar' ? 'مهمة متاحة للبدء' : 'Available to start';
    } else if (currentObj) {
      currentObjectiveText =
        currentObj.target > 1
          ? `${currentObj.description} (${currentObj.current}/${currentObj.target})`
          : currentObj.description;
    }

    return {
      questId: def.questId,
      chapterId: def.chapterId,
      title: lang === 'ar' ? def.titleAr : def.title,
      description: lang === 'ar' ? def.descriptionAr : def.description,
      state: rt.state,
      giverNpcId: def.giverNpcId,
      turnInNpcId: def.turnInNpcId,
      objectives,
      requiredObjectives: [...def.requiredObjectives],
      currentObjectiveText,
      progressText: `${doneCount}/${objectives.length}`,
      rewards: def.rewards,
      rewardSummary: lang === 'ar' ? def.rewards.summaryAr : def.rewards.summaryEn,
      prerequisites: [...def.prerequisites],
      tracked: def.questId === this.getTrackedQuestId(),
    };
  }

  /**
   * Adapts the tracked Story Quest into QuestView for seamless display inside existing HudOverlay tracker.
   */
  public getTrackedHudQuestView(lang = this.language): QuestView | null {
    const id = this.getTrackedQuestId();
    if (!id) return null;
    const def = QUEST_MAP.get(id);
    if (!def) return null;
    const sv = this.toQuestView(def, lang);
    if (sv.state === 'LOCKED' || sv.state === 'COMPLETED') return null;

    const status =
      sv.state === 'OBJECTIVE_COMPLETED'
        ? 'ready'
        : sv.state === 'AVAILABLE'
          ? 'available'
          : 'active';

    const objectives: QuestObjectiveView[] = sv.objectives.map((o) => ({
      id: o.id,
      type: mapStoryObjTypeToQuestType(o.type),
      description: o.description,
      current: o.current,
      target: o.target,
      completed: o.completed,
      active: o.active,
    }));

    return {
      id: sv.questId,
      title: `[${lang === 'ar' ? 'القصة' : 'Story'}] ${sv.title}`,
      description: sv.description,
      scope: 'personal',
      status,
      giverNpcId: sv.giverNpcId,
      turnInNpcId: sv.turnInNpcId,
      objectives,
      currentObjectiveText: sv.currentObjectiveText,
      progressText: sv.progressText,
      reward: {
        xp: sv.rewards.xp,
        coins: sv.rewards.coins,
      },
      rewardSummary: sv.rewardSummary,
      tracked: true,
    };
  }

  public getJournalSnapshot(lang = this.language): StoryJournalSnapshot {
    const chapters: StoryChapterView[] = STORY_CHAPTERS.map((ch) => {
      const quests = ch.questIds
        .map((id) => QUEST_MAP.get(id))
        .filter((d): d is StoryQuestDef => Boolean(d))
        .map((d) => this.toQuestView(d, lang));
      const unlocked = quests.some((q) => q.state !== 'LOCKED');
      const completed = quests.length > 0 && quests.every((q) => q.state === 'COMPLETED');
      return {
        chapterId: ch.chapterId,
        number: ch.number,
        title: lang === 'ar' ? ch.titleAr : ch.titleEn,
        subtitle: lang === 'ar' ? ch.subtitleAr : ch.subtitleEn,
        unlocked,
        completed,
        current: ch.chapterId === this.currentChapterId,
        quests,
      };
    });

    const currentChapter =
      CHAPTER_MAP.get(this.currentChapterId) ?? STORY_CHAPTERS[0];

    const trackedId = this.getTrackedQuestId();
    const allQuestViews = chapters.flatMap((c) => c.quests);
    const activeMainQuest =
      allQuestViews.find((q) => q.questId === trackedId) ??
      allQuestViews.find(
        (q) =>
          q.state === 'ACTIVE' ||
          q.state === 'OBJECTIVE_COMPLETED' ||
          q.state === 'FAILED' ||
          q.state === 'AVAILABLE',
      ) ??
      allQuestViews[allQuestViews.length - 1] ??
      null;

    const completedQuestCount = allQuestViews.filter(
      (q) => q.state === 'COMPLETED',
    ).length;

    return {
      currentChapterId: currentChapter.chapterId,
      currentChapterNumber: currentChapter.number,
      totalChapters: STORY_CHAPTERS.length,
      campaignCompleted: this.isCampaignCompleted(),
      activeMainQuest,
      chapters,
      completedQuestCount,
      totalQuestCount: STORY_QUESTS.length,
    };
  }

  /**
   * Builds a non-destructive Story DialogueTree overlay for NPCs participating in the current
   * campaign beat (Turn-In, Failed Retry, Doran's Wooden Sword gift, Quest Offer, or Briefing),
   * while offering a clean choice to enter the NPC's normal village dialogue whenever desired.
   */
  public buildNpcDialogueTree(
    npcId: string,
    bridge: StoryWorldBridge,
    lang: Language,
    fallbackTreeBuilder: () => DialogueTree | null,
    actions: {
      completeStoryQuest: (questId: string) => void;
      startStoryQuest: (questId: string) => void;
      retryStoryQuest: (questId: string) => void;
      grantDoranWoodenSword: () => void;
    },
  ): DialogueTree | null {
    // Priority 1: NPC is turn-in target for an OBJECTIVE_COMPLETED story quest
    const turnInDef = STORY_QUESTS.find((q) => {
      const rt = this.runtimes.get(q.questId);
      return rt?.state === 'OBJECTIVE_COMPLETED' && q.turnInNpcId === npcId;
    });

    if (turnInDef) {
      const script =
        STORY_DIALOGUE_SCRIPTS[`${turnInDef.questId}:turnin`] ??
        STORY_DIALOGUE_SCRIPTS[`${turnInDef.questId}:${npcId}`];
      const qTitle = lang === 'ar' ? turnInDef.titleAr : turnInDef.title;
      const rewardLine =
        lang === 'ar' ? turnInDef.rewards.summaryAr : turnInDef.rewards.summaryEn;
      const lines = script
        ? lang === 'ar'
          ? script.linesAr
          : script.linesEn
        : [
            lang === 'ar'
              ? `عمل رائع! لقد أنجزت أهداف "${qTitle}". المكافأة: ${rewardLine}.`
              : `Well done! You completed all objectives for "${qTitle}". Reward: ${rewardLine}.`,
          ];
      actions.completeStoryQuest(turnInDef.questId);
      const nextFollowupChoices: DialogueChoiceNode[] = [
        {
          id: 'story-done-close',
          label: lang === 'ar' ? 'شكرًا لك (إغلاق)' : 'Thank you (Close)',
          nextNodeId: null,
        },
      ];
      return this.mergeWithFallbackTree(
        npcId,
        script ? (lang === 'ar' ? script.speakerAr : script.speakerEn) : undefined,
        lines,
        nextFollowupChoices,
        lang,
        fallbackTreeBuilder,
      );
    }

    // Priority 2: Special Ch1 Q1 Blacksmith Doran Wooden Sword assistance if player lacks wooden-sword
    if (npcId === 'npc-doran') {
      const ch1q1 = this.runtimes.get('story-ch1-q1');
      if (ch1q1?.state === 'ACTIVE' && bridge.getItemCount('wooden-sword') < 1) {
        const script = STORY_DIALOGUE_SCRIPTS['story-ch1-q1:npc-doran'];
        actions.grantDoranWoodenSword();
        return this.mergeWithFallbackTree(
          npcId,
          lang === 'ar' ? script.speakerAr : script.speakerEn,
          lang === 'ar' ? script.linesAr : script.linesEn,
          [
            {
              id: 'story-doran-thanks',
              label: lang === 'ar' ? 'شكرًا على السيف!' : 'Thank you for the sword!',
              nextNodeId: null,
            },
          ],
          lang,
          fallbackTreeBuilder,
        );
      }
    }

    // Priority 3: FAILED story quest retry with giver or Elder Thorne
    const failedDef = STORY_QUESTS.find((q) => {
      const rt = this.runtimes.get(q.questId);
      return (
        rt?.state === 'FAILED' &&
        (q.giverNpcId === npcId || q.turnInNpcId === npcId || npcId === 'npc-thorne')
      );
    });
    if (failedDef) {
      actions.retryStoryQuest(failedDef.questId);
      const qTitle = lang === 'ar' ? failedDef.titleAr : failedDef.title;
      return this.mergeWithFallbackTree(
        npcId,
        undefined,
        [
          lang === 'ar'
            ? `استجمع قواك أيها المغامر! أعدنا تفعيل مهمة "${qTitle}"—عد لحماية الموقع الآن.`
            : `Rally your strength, adventurer! "${qTitle}" has been restarted—return to hold the line!`,
        ],
        [
          {
            id: 'story-retry-ok',
            label: lang === 'ar' ? 'أنا مستعد الآن!' : "I'm ready now!",
            nextNodeId: null,
          },
        ],
        lang,
        fallbackTreeBuilder,
      );
    }

    // Priority 4: AVAILABLE story quest offered by this NPC
    const availDef = STORY_QUESTS.find((q) => {
      const rt = this.runtimes.get(q.questId);
      return rt?.state === 'AVAILABLE' && q.giverNpcId === npcId;
    });
    if (availDef) {
      actions.startStoryQuest(availDef.questId);
      const qTitle = lang === 'ar' ? availDef.titleAr : availDef.title;
      const qDesc = lang === 'ar' ? availDef.descriptionAr : availDef.description;
      const script = STORY_DIALOGUE_SCRIPTS[`${availDef.questId}:${npcId}`];
      const lines = script
        ? lang === 'ar'
          ? script.linesAr
          : script.linesEn
        : [`${qTitle}: ${qDesc}`];
      return this.mergeWithFallbackTree(
        npcId,
        script ? (lang === 'ar' ? script.speakerAr : script.speakerEn) : undefined,
        lines,
        [
          {
            id: 'story-accept-ok',
            label: lang === 'ar' ? 'سأباشر المهمة فورًا' : "I'll set out right away",
            nextNodeId: null,
          },
        ],
        lang,
        fallbackTreeBuilder,
      );
    }

    // Priority 5: Active story quest speaker briefing
    const activeScriptDef = STORY_QUESTS.find((q) => {
      const rt = this.runtimes.get(q.questId);
      if (!rt || rt.state !== 'ACTIVE') return false;
      return (
        Boolean(STORY_DIALOGUE_SCRIPTS[`${q.questId}:${npcId}`]) &&
        (q.giverNpcId === npcId ||
          q.objectives.some((o) => o.npcId === npcId))
      );
    });

    if (activeScriptDef) {
      const script = STORY_DIALOGUE_SCRIPTS[`${activeScriptDef.questId}:${npcId}`];
      if (script) {
        return this.mergeWithFallbackTree(
          npcId,
          lang === 'ar' ? script.speakerAr : script.speakerEn,
          lang === 'ar' ? script.linesAr : script.linesEn,
          [
            {
              id: 'story-brief-ok',
              label: lang === 'ar' ? 'فهمت، لننطلق' : 'Understood',
              nextNodeId: null,
            },
          ],
          lang,
          fallbackTreeBuilder,
        );
      }
    }

    return null;
  }

  private mergeWithFallbackTree(
    npcId: string,
    speaker: string | undefined,
    lines: string[],
    baseChoices: DialogueChoiceNode[],
    lang: Language,
    fallbackTreeBuilder: () => DialogueTree | null,
  ): DialogueTree {
    const fallback = fallbackTreeBuilder();
    const nodes: Record<string, DialogueNode> = {
      story_entry: {
        id: 'story_entry',
        speaker,
        lines,
        choices: [...baseChoices],
      },
    };

    if (fallback && fallback.nodes[fallback.defaultStartNodeId]) {
      for (const [k, v] of Object.entries(fallback.nodes)) {
        if (k !== 'story_entry') {
          nodes[k] = v;
        }
      }
      nodes.story_entry.choices!.unshift({
        id: 'story_continue_town_talk',
        label: lang === 'ar' ? 'حديث القرية والمهام الجانبية' : 'Village Matters & Side Quests',
        nextNodeId: fallback.defaultStartNodeId,
      });
    }

    return {
      npcId,
      defaultStartNodeId: 'story_entry',
      nodes,
    };
  }
}
