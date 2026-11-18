import type { Language } from '../i18n/translations';
import type { NpcRole, NpcRoutinePeriod } from '../types';

export type SideQuestState =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED';

export type SideQuestCategory =
  | 'rescue'
  | 'delivery'
  | 'hunting'
  | 'gathering'
  | 'exploration'
  | 'village';

export type SideQuestObjectiveType =
  | 'talk_to_npc'
  | 'reach_location'
  | 'explore_location'
  | 'collect_resource'
  | 'deliver_item'
  | 'defeat_enemy'
  | 'defeat_bandit'
  | 'find_item'
  | 'protect_npc'
  | 'rescue_npc'
  | 'escort_npc'
  | 'craft_item'
  | 'build_structure';

export type SideQuestTimeWindow = 'any' | NpcRoutinePeriod;

export type SideQuestAnchorRef =
  | { kind: 'npc'; npcId: string; offsetX?: number; offsetZ?: number }
  | { kind: 'location'; locationId: string; offsetX?: number; offsetZ?: number }
  | { kind: 'village'; villageId: string; offsetX?: number; offsetZ?: number }
  | { kind: 'point'; x: number; z: number };

export interface SideQuestLocalSpawnDef {
  id: string;
  kind: 'pickup' | 'rescue_npc';
  labelEn: string;
  labelAr: string;
  anchor: SideQuestAnchorRef;
  itemId?: string;
  count?: number;
  escortNpcId?: string;
}

export interface SideQuestObjectiveDef {
  id: string;
  type: SideQuestObjectiveType;
  descriptionEn: string;
  descriptionAr: string;
  requiredCount: number;
  npcId?: string;
  locationId?: string;
  villageId?: string;
  itemId?: string;
  enemyType?: string;
  radius?: number;
  anchor?: SideQuestAnchorRef;
  markerRole: 'npc' | 'location' | 'enemy' | 'investigation' | 'escort';
  consumeOnComplete?: boolean;
  localSpawn?: SideQuestLocalSpawnDef;
  escortNpcId?: string;
  escortTargetAnchor?: SideQuestAnchorRef;
  buildingId?: string;
  buildingCategory?: string;
}

export interface SideQuestRewardItem {
  id: string;
  count: number;
}

export interface SideQuestRewardDef {
  xp: number;
  coins: number;
  reputation?: number;
  items?: SideQuestRewardItem[];
  summaryEn: string;
  summaryAr: string;
  unlockFlag?: string;
}

export interface SideQuestAvailabilityRules {
  minLevel?: number;
  requiredStoryQuests?: string[];
  requiredStoryFlags?: string[];
  requiredVillages?: string[];
  timeWindow?: SideQuestTimeWindow;
  requireRescueNpcId?: string;
}

export interface SideQuestNpcDef {
  npcId: string;
  nameEn: string;
  nameAr: string;
  role: NpcRole;
  titleEn: string;
  titleAr: string;
  personalityEn: string;
  personalityAr: string;
  locationEn: string;
  locationAr: string;
  anchor: SideQuestAnchorRef;
  greetingsEn: Record<NpcRoutinePeriod, string>;
  greetingsAr: Record<NpcRoutinePeriod, string>;
  questIds: string[];
  unlockWhenQuestCompleted?: string;
}

export interface SideQuestDialogueCopy {
  introEn: string[];
  introAr: string[];
  acceptReplyEn: string;
  acceptReplyAr: string;
  declineReplyEn: string;
  declineReplyAr: string;
  progressEn: string[];
  progressAr: string[];
  turnInEn: string[];
  turnInAr: string[];
  followUpEn: string;
  followUpAr: string;
}

export interface SideQuestDef {
  sideQuestId: string;
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  category: SideQuestCategory;
  giverNpcId: string;
  turnInNpcId: string;
  location: string;
  locationAr: string;
  objectives: SideQuestObjectiveDef[];
  requiredObjectives: string[];
  rewards: SideQuestRewardDef;
  prerequisites: string[];
  requiredLevel: number;
  state: SideQuestState;
  sequential: boolean;
  repeatable: boolean;
  cooldownSeconds?: number;
  expirationHours?: number | null;
  chainId?: string;
  chainOrder?: number;
  chainTitleEn?: string;
  chainTitleAr?: string;
  availability?: SideQuestAvailabilityRules;
  dialogue: SideQuestDialogueCopy;
}

export interface SideQuestRuntime {
  sideQuestId: string;
  state: SideQuestState;
  completedObjectiveIds: string[];
  counts: Record<string, number>;
  creditedEntityIds: string[];
  completedCount: number;
  acceptedAtWorldHours: number | null;
  lastCompletedAtMs: number | null;
  claimedCycleKeys: string[];
}

export interface SavedSideQuestState {
  trackedSideQuestId: string | null;
  reputation: number;
  unlockedFlags: string[];
  quests: Record<string, SideQuestRuntime>;
}

export interface SideQuestObjectiveView {
  id: string;
  type: SideQuestObjectiveType;
  description: string;
  current: number;
  target: number;
  completed: boolean;
  active: boolean;
}

export interface SideQuestView {
  sideQuestId: string;
  title: string;
  description: string;
  category: SideQuestCategory;
  state: SideQuestState;
  giverNpcId: string;
  giverName: string;
  turnInNpcId: string;
  turnInName: string;
  location: string;
  objectives: SideQuestObjectiveView[];
  requiredObjectives: string[];
  currentObjectiveText: string;
  progressText: string;
  rewards: SideQuestRewardDef;
  rewardSummary: string;
  prerequisites: string[];
  requiredLevel: number;
  repeatable: boolean;
  expirationHours: number | null;
  remainingHours: number | null;
  cooldownRemainingSeconds: number;
  completedCount: number;
  chainId?: string;
  chainOrder?: number;
  chainTitle?: string;
  timeWindow: SideQuestTimeWindow;
  lockReason?: string;
  tracked: boolean;
  readyToTurnIn: boolean;
}

export interface SideQuestJournalSnapshot {
  reputation: number;
  activeQuests: SideQuestView[];
  availableQuests: SideQuestView[];
  lockedQuests: SideQuestView[];
  completedQuests: SideQuestView[];
  failedOrExpiredQuests: SideQuestView[];
  trackedSideQuestId: string | null;
  totalUniqueCompleted: number;
  totalQuests: number;
}

export interface SideQuestKillRequest {
  sideQuestId: string;
  objectiveId: string;
  enemyType: string;
  requiredCount: number;
  currentCount: number;
  targetX?: number;
  targetZ?: number;
}

export interface SideQuestMapMarkerInput {
  id: string;
  sideQuestId: string;
  markerKind:
    | 'side_quest_available'
    | 'side_quest_active'
    | 'side_quest_giver'
    | 'side_quest_target'
    | 'side_quest_turnin';
  label: string;
  subtitle: string;
  x: number;
  z: number;
  radius?: number;
  tracked: boolean;
}

export interface SideQuestWorldBridge {
  readonly playerX: number;
  readonly playerY: number;
  readonly playerZ: number;
  readonly playerLevel: number;
  readonly routinePeriod: NpcRoutinePeriod;
  readonly totalWorldHours: number;
  getItemCount: (itemId: string) => number;
  getNpcPosition: (npcId: string) => { x: number; z: number } | null;
  isNpcAlive: (npcId: string) => boolean | null;
  getLocationCoords: (
    locationId: string,
  ) => { x: number; z: number; discovered: boolean } | null;
  getVillageCoords: (
    villageId: string,
  ) => { x: number; z: number; discovered: boolean } | null;
  isStoryQuestCompleted: (storyQuestId: string) => boolean;
  hasStoryFlag: (flag: string) => boolean;
  getBuiltStructureCount?: (filter?: { blueprintId?: string; category?: string }) => number;
  resolveLandPoint: (x: number, z: number) => { x: number; z: number };
  giveItem: (itemId: string, count: number) => void;
  consumeItem: (itemId: string, count: number) => void;
  grantRewards: (
    xp: number,
    coins: number,
    questTitle: string,
    meta?: {
      sideQuestId: string;
      cycleKey: string;
      repeatable: boolean;
      items?: SideQuestRewardItem[];
    },
  ) => void;
  notify: (message: string) => void;
}

export interface SideQuestNpcDirectoryEntry {
  npcId: string;
  nameEn: string;
  nameAr: string;
  roleEn: string;
  roleAr: string;
  locationEn: string;
  locationAr: string;
  personalityEn: string;
  personalityAr: string;
}

export interface SideQuestDialogueActions {
  acceptSideQuest: (sideQuestId: string) => boolean;
  completeSideQuest: (sideQuestId: string) => boolean;
  retrySideQuest: (sideQuestId: string) => boolean;
  abandonSideQuest: (sideQuestId: string) => boolean;
}

export type SideQuestLang = Language;
