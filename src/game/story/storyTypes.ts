import type { Language } from '../i18n/translations';
import type { QuestView } from '../quest/questTypes';
import type { DialogueTree } from '../dialogue/dialogueTypes';

export type StoryQuestState =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'ACTIVE'
  | 'OBJECTIVE_COMPLETED'
  | 'COMPLETED'
  | 'FAILED';

export type StoryObjectiveType =
  | 'talk_to_npc'
  | 'reach_location'
  | 'explore_location'
  | 'collect_resource'
  | 'defeat_enemy'
  | 'defeat_bandit'
  | 'find_item'
  | 'protect_npc'
  | 'rescue_npc'
  | 'open_chest'
  | 'discover_village'
  | 'enter_building'
  | 'complete_quest';

export type StoryMarkerRole =
  | 'npc'
  | 'destination'
  | 'investigation'
  | 'enemy'
  | 'objective';

export type StoryAnchorRef =
  | { kind: 'npc'; npcId: string }
  | { kind: 'location'; locationId: string }
  | { kind: 'village'; villageId: string }
  | { kind: 'chest'; chestId: string; locationId?: string }
  | { kind: 'between'; fromVillageId: string; toLocationId: string; t: number }
  | { kind: 'offset_location'; locationId: string; dx: number; dz: number }
  | { kind: 'coords'; x: number; z: number };

export interface StoryLocalSpawnDef {
  id: string;
  kind: 'pickup' | 'rescue_npc';
  objectiveId: string;
  itemId?: string;
  count?: number;
  labelEn: string;
  labelAr: string;
  anchor: StoryAnchorRef;
}

export interface StoryObjectiveDef {
  id: string;
  type: StoryObjectiveType;
  descriptionEn: string;
  descriptionAr: string;
  requiredCount: number;
  npcId?: string;
  locationId?: string;
  villageId?: string;
  chestId?: string;
  itemId?: string;
  enemyType?: string;
  targetQuestId?: string;
  radius?: number;
  markerRole: StoryMarkerRole;
  anchor?: StoryAnchorRef;
  localSpawn?: StoryLocalSpawnDef;
  consumeOnComplete?: boolean;
}

export interface StoryRewardDef {
  xp: number;
  coins: number;
  items?: Array<{ id: string; count: number }>;
  unlockFlag?: string;
  summaryEn: string;
  summaryAr: string;
}

export interface StoryQuestDef {
  questId: string;
  chapterId: string;
  orderInChapter: number;
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  objectives: StoryObjectiveDef[];
  requiredObjectives: string[];
  rewards: StoryRewardDef;
  prerequisites: string[];
  state: StoryQuestState;
  giverNpcId: string;
  turnInNpcId: string;
  sequential: boolean;
}

export interface StoryChapterDef {
  chapterId: string;
  number: number;
  titleEn: string;
  titleAr: string;
  subtitleEn: string;
  subtitleAr: string;
  questIds: string[];
}

export interface StoryDialogueEntry {
  speakerEn: string;
  speakerAr: string;
  linesEn: string[];
  linesAr: string[];
}

export interface StoryQuestRuntime {
  questId: string;
  state: StoryQuestState;
  completedObjectiveIds: string[];
  counts: Record<string, number>;
  creditedEntityIds: string[];
  protectBaselineKills?: Record<string, number>;
}

export interface SavedStoryState {
  currentChapterId: string;
  trackedQuestId: string | null;
  unlockedFlags: string[];
  quests: Record<string, StoryQuestRuntime>;
}

export interface StoryObjectiveView {
  id: string;
  type: StoryObjectiveType;
  description: string;
  current: number;
  target: number;
  completed: boolean;
  active: boolean;
}

export interface StoryQuestView {
  questId: string;
  chapterId: string;
  title: string;
  description: string;
  state: StoryQuestState;
  giverNpcId: string;
  turnInNpcId: string;
  objectives: StoryObjectiveView[];
  requiredObjectives: string[];
  currentObjectiveText: string;
  progressText: string;
  rewards: StoryRewardDef;
  rewardSummary: string;
  prerequisites: string[];
  tracked: boolean;
}

export interface StoryChapterView {
  chapterId: string;
  number: number;
  title: string;
  subtitle: string;
  unlocked: boolean;
  completed: boolean;
  current: boolean;
  quests: StoryQuestView[];
}

export interface StoryJournalSnapshot {
  currentChapterId: string;
  currentChapterNumber: number;
  totalChapters: number;
  campaignCompleted: boolean;
  activeMainQuest: StoryQuestView | null;
  chapters: StoryChapterView[];
  completedQuestCount: number;
  totalQuestCount: number;
}

export interface StoryMapMarkerInput {
  id: string;
  questId: string;
  role: StoryMarkerRole;
  label: string;
  subtitle: string;
  x: number;
  z: number;
  radius?: number;
  tracked: boolean;
}

export interface StoryKillRequest {
  questId: string;
  objectiveId: string;
  enemyType: string;
  requiredCount: number;
  currentCount: number;
  targetX?: number;
  targetZ?: number;
}

export interface StoryWorldBridge {
  playerX: number;
  playerY: number;
  playerZ: number;
  indoorFactor: number;
  enteredBuildingRecently: boolean;
  getItemCount: (itemId: string) => number;
  getNpcPosition: (npcId: string) => { x: number; z: number } | null;
  isNpcAlive: (npcId: string) => boolean | null;
  getLocationCoords: (locationId: string) => { x: number; z: number; discovered: boolean } | null;
  getVillageCoords: (villageId: string) => { x: number; z: number; discovered: boolean } | null;
  isChestOpened: (chestId: string) => boolean;
  getChestCoords: (chestId: string) => { x: number; z: number } | null;
  resolveLandPoint: (x: number, z: number) => { x: number; z: number };
  giveItem: (itemId: string, count: number) => void;
  consumeItem: (itemId: string, count: number) => void;
  grantRewards: (xp: number, coins: number, questTitle: string) => void;
  notify: (message: string) => void;
}

export type StoryDialogueProvider = (
  npcId: string,
  lang: Language,
  fallbackBuilder: () => DialogueTree | null,
) => DialogueTree | null;

export type { QuestView };
