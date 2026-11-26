import type { EquipSlot } from '../inventory/inventoryTypes';
import type { SavedStoryState } from '../story/storyTypes';
import type { SavedSideQuestState } from '../sidequest/sideQuestTypes';
import type { BiomeType, CameraPerspective, NpcRoutinePeriod } from '../types';
import type { WeatherQuality, WeatherState } from '../world/WeatherManager';
import type { SavedPlayerBuilding } from '../building/buildingTypes';
import type { SavedVillageDevelopmentState } from '../village/villageDevTypes';
import type {
  WorldModMetadataSnapshot,
  WorldModSelectionEntry,
} from '../mods/modTypes';

export const CURRENT_SAVE_VERSION = 6;

export type LegacySaveSlotId = 'autosave' | 'slot-1' | 'slot-2' | 'slot-3';
export type SaveSlotId = LegacySaveSlotId | (string & {});

export type WorldType = 'normal' | 'adventure' | 'survival' | 'creative';
export type DifficultyLevel = 'easy' | 'normal' | 'hard';

export interface NewWorldOptions {
  worldName: string;
  seed: number;
  worldType: WorldType;
  difficulty: DifficultyLevel;
  modMode?: 'vanilla' | 'modded';
  selectedMods?: WorldModSelectionEntry[];
}

export interface WorldSaveModSummary {
  selectionMode: 'vanilla' | 'custom';
  enabledCount: number;
  modIds: string[];
}

export const MANUAL_SAVE_SLOTS: LegacySaveSlotId[] = [
  'slot-1',
  'slot-2',
  'slot-3',
];
export const ALL_SAVE_SLOTS: LegacySaveSlotId[] = [
  'autosave',
  'slot-1',
  'slot-2',
  'slot-3',
];

export interface SavedPlayerState {
  position: {
    x: number;
    y: number;
    z: number;
  };
  rotation: {
    yaw: number;
    cameraYaw: number;
    cameraPitch: number;
  };
  health: number;
  stamina: number;
  staminaIsInfinite?: boolean;
  staminaConfigVersion?: number;
  level: number;
  xp: number;
  coins: number;
}

export interface SavedInventorySlot {
  slotIndex: number;
  itemId: string;
  count: number;
  equipped: boolean;
  durability?: number;
  maxDurability?: number;
}

export interface SavedInventoryState {
  capacity: number;
  slots: SavedInventorySlot[];
  equippedBySlot: Partial<Record<EquipSlot, string>>;
}

export interface SavedQuestActiveEntry {
  questId: string;
  completedObjectiveIds: string[];
  talkedCounts: Record<string, number>;
  killCounts: Record<string, number>;
  craftCounts?: Record<string, number>;
  sleepCounts?: Record<string, number>;
  reachedLocations: string[];
  exploredAreas: string[];
  creditedKillEntityIds?: string[];
}

export interface SavedQuestState {
  active: SavedQuestActiveEntry[];
  completed: string[];
  trackedQuestId: string | null;
}

export interface SavedTimeState {
  worldHours: number;
  dayCount: number;
  fullDayDurationSeconds: number;
  timeScale: number;
  paused: boolean;
}

export interface SavedWeatherState {
  currentState: WeatherState;
  targetState: WeatherState;
  transitionProgress: number;
  dynamicEnabled: boolean;
  transitionDurationSeconds: number;
  quality: WeatherQuality;
  windAngleRad: number;
  weatherStartTime?: number;
  weatherDuration?: number;
  weatherRemainingTime?: number;
  maxStateDurationSeconds?: number;
}

export interface SavedCameraState {
  perspective: CameraPerspective;
  sensitivity: number;
  distance: number;
  height: number;
  smoothing: number;
  invertY: boolean;
  interactionIndicatorOffsetX: number;
  interactionIndicatorOffsetY: number;
  interactionIndicatorOffsetZ: number;
}

export interface SavedDroppedPickup {
  id: string;
  itemId: string;
  count: number;
  label: string;
  x: number;
  z: number;
}

export interface SavedPlacedBed {
  id: string;
  x: number;
  z: number;
  yaw: number;
}

export interface SavedPlacedStation {
  id: string;
  stationType: 'crafting_table' | 'furnace';
  x: number;
  z: number;
  yaw: number;
}

export interface SavedCraftingState {
  craftedRecipeIds: string[];
  unlockedRecipeIds: string[];
}

export interface SavedDepletedNode {
  id: string;
  usesRemaining: number;
  regenAtElapsed: number;
}

export interface SavedNpcState {
  id: string;
  x: number;
  z: number;
  yaw: number;
  hp?: number;
  maxHealth?: number;
  isDead?: boolean;
  dialogueState?: 'idle' | 'talking';
  questState?: string;
  lastPeriod?: NpcRoutinePeriod;
  sleepStage?:
    | 'outdoor'
    | 'going_to_door'
    | 'entering_door'
    | 'going_to_bed'
    | 'sleeping'
    | 'exiting_door';
}

export interface SavedDoorState {
  id: string;
  isOpen: boolean;
}

export interface SavedQuestTargetEntry {
  id: string;
  archetypeId: string;
  x: number;
  z: number;
  hp: number | null;
  defeated: boolean;
  questId: string;
  objectiveId: string;
  enemyType: string;
}

export interface SavedWorldState {
  worldSeed: number;
  worldType: WorldType;
  difficulty: DifficultyLevel;
  discoveredLandmarkIds: string[];
  collectedInteractableIds: string[];
  droppedPickups: SavedDroppedPickup[];
  dialogueFlags: string[];
  defeatedEnemyIds: string[];
  questTargets?: SavedQuestTargetEntry[];
  npcStates?: SavedNpcState[];
  placedBeds?: SavedPlacedBed[];
  placedStations?: SavedPlacedStation[];
  playerBuildings?: SavedPlayerBuilding[];
  depletedNodes?: SavedDepletedNode[];
  openedChestIds?: string[];
  doorStates?: SavedDoorState[];
  destroyedIds?: string[];
  customChanges?: Array<{ id: string; data: Record<string, unknown> }>;
  killedAnimalIds?: string[];
  fogOfWar?: {
    gridSize: number;
    discoveredB64: string;
  };
  waypoint?: {
    x: number;
    z: number;
    label?: string;
  } | null;
}

export interface SaveGameMeta {
  slotId: SaveSlotId;
  worldId: string;
  worldName: string;
  worldType: WorldType;
  difficulty: DifficultyLevel;
  version: number;
  createdAtMs: number;
  savedAtIso: string;
  savedAtMs: number;
  playTimeSeconds: number;
  biome: BiomeType;
  level: number;
  timeLabel: string;
  weatherState: WeatherState;
  completedQuestsCount: number;
  activeQuestsCount: number;
  worldSeed: number;
  thumbnailDataUrl?: string;
  modSummary?: WorldSaveModSummary;
}

export interface SaveGameData {
  version: number;
  meta: SaveGameMeta;
  player: SavedPlayerState;
  inventory: SavedInventoryState;
  quests: SavedQuestState;
  story?: SavedStoryState;
  sideQuests?: SavedSideQuestState;
  crafting?: SavedCraftingState;
  villageDev?: SavedVillageDevelopmentState;
  time: SavedTimeState;
  weather: SavedWeatherState;
  world: SavedWorldState;
  camera?: SavedCameraState;
  audio?: {
    footstepVolume?: number;
  };
  modMetadata?: WorldModMetadataSnapshot;
}

export interface SaveSlotSummary {
  slotId: SaveSlotId;
  isAutosave: boolean;
  exists: boolean;
  meta: SaveGameMeta | null;
}
