import type { CraftingStationType } from '../inventory/inventoryTypes';
import type { DoorState } from '../types';

export type BuildingCategory =
  | 'structures'
  | 'doors_windows'
  | 'storage'
  | 'crafting'
  | 'farming'
  | 'furniture';

export type StructureMaterialTier = 'wood' | 'stone' | 'reinforced';

export type BuildingPermissionScope =
  | 'owner'
  | 'friends'
  | 'party'
  | 'everyone';

export type RotationIncrementDeg = 15 | 30 | 45 | 90;

export type SnapAnchorType =
  | 'foundation'
  | 'floor'
  | 'wall'
  | 'door'
  | 'window'
  | 'roof'
  | 'fence'
  | 'stairs';

export interface BuildingCostItem {
  itemId: string;
  count: number;
}

export interface SnapAnchorDef {
  localX: number;
  localY: number;
  localZ: number;
  yawOffset?: number;
  anchorType: SnapAnchorType;
  accepts: SnapAnchorType[];
}

export interface BuildingBlueprint {
  id: string;
  category: BuildingCategory;
  tier: StructureMaterialTier;
  nameEn: string;
  nameAr: string;
  descEn: string;
  descAr: string;
  /** Width along local X in meters */
  width: number;
  /** Depth along local Z in meters */
  depth: number;
  /** Total height above grade in meters */
  height: number;
  wallHeight?: number;
  roofHeight?: number;
  /** Placement clearances & terrain constraints */
  waterBuffer: number;
  maxSlope: number;
  maxRelief: number;
  /** Can be placed indoors / on top of player floor/foundation */
  allowOnFloor?: boolean;
  /** Modular roof / upper piece that elevates to wall top when snapped or placed */
  isFloorPiece?: boolean;
  isRoofPiece?: boolean;
  isHouse?: boolean;
  isWallPiece?: boolean;
  isDoorPiece?: boolean;
  isGatePiece?: boolean;
  isWindowPiece?: boolean;
  isFencePiece?: boolean;
  isStairsPiece?: boolean;
  isPillarPiece?: boolean;
  isFarmPlot?: boolean;
  isWaterTrough?: boolean;
  isCoop?: boolean;
  isAnimalPen?: boolean;
  isDecorative?: boolean;
  /** Material costs required at confirmation */
  costs: BuildingCostItem[];
  maxHealth: number;
  repairCosts: BuildingCostItem[];
  upgradeToId?: string;
  upgradeCosts?: BuildingCostItem[];
  /** Functional attachments */
  hasDoor?: boolean;
  doorOffset?: { x: number; y: number; z: number; halfW: number; halfD: number; height: number };
  hasBed?: boolean;
  bedOffset?: { x: number; y: number; z: number; yawOffset: number };
  stationType?: Exclude<CraftingStationType, 'hand'>;
  stationOffset?: { x: number; y: number; z: number; yawOffset?: number };
  storageCapacity?: number;
  storageOffset?: { x: number; y: number; z: number };
  farmYieldCount?: number;
  farmGrowthSeconds?: number;
  /** Snap metadata */
  snapType?: SnapAnchorType;
  snapAnchors?: SnapAnchorDef[];
}

export interface PlayerStructureStorageItem {
  itemId: string;
  count: number;
  durability?: number;
  maxDurability?: number;
}

export interface PlayerStructureDoorState {
  isOpen: boolean;
  state: DoorState;
}

export interface PlayerStructureFarmState {
  stage: number; // 0..3 (3 = ready to harvest)
  growthProgress: number; // 0..1
  plantedAtElapsed: number;
  soilPrepared?: boolean;
  cropId?: string | null;
  waterLevel?: number; // 0..1
  plantedAtWorldHours?: number | null;
  lastUpdatedWorldHours?: number;
}

export interface PlayerBuiltStructure {
  id: string;
  blueprintId: string;
  category: BuildingCategory;
  tier: StructureMaterialTier;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  maxHealth: number;
  ownerId: string;
  ownerName: string;
  permission: BuildingPermissionScope;
  createdAtMs: number;
  doorOpen?: boolean;
  storageItems?: PlayerStructureStorageItem[];
  farmState?: PlayerStructureFarmState;
}

export interface SavedPlayerBuilding {
  id: string;
  blueprintId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  maxHealth: number;
  ownerId: string;
  ownerName: string;
  permission: BuildingPermissionScope;
  createdAtMs: number;
  doorOpen?: boolean;
  storageItems?: PlayerStructureStorageItem[];
  farmState?: PlayerStructureFarmState;
}

export type PlacementValidationReason =
  | 'valid'
  | 'out_of_bounds'
  | 'in_water'
  | 'near_water'
  | 'slope_too_steep'
  | 'uneven_terrain'
  | 'colliding_structure'
  | 'inside_village_protected'
  | 'blocking_road'
  | 'near_npc_spawn'
  | 'near_quest_object'
  | 'missing_materials'
  | 'permission_denied';

export interface PlacementValidationResult {
  valid: boolean;
  reason: PlacementValidationReason;
  alignedX: number;
  alignedY: number;
  alignedZ: number;
  alignedYaw: number;
  snappedToId?: string;
  snappedType?: SnapAnchorType;
}

export interface BuildModeCostStatus {
  itemId: string;
  name: string;
  required: number;
  owned: number;
  enough: boolean;
}

export interface BuildModeHudSnapshot {
  active: boolean;
  category: BuildingCategory;
  selectedBlueprintId: string;
  rotationDeg: number;
  rotationStepDeg: RotationIncrementDeg;
  snapEnabled: boolean;
  validPlacement: boolean;
  validationReason: PlacementValidationReason;
  snappedToId?: string;
  hasAllMaterials: boolean;
  isCreativeFree: boolean;
  costStatus: BuildModeCostStatus[];
  placedCount: number;
  targetedStructureId?: string | null;
}

export interface StorageModalSnapshot {
  structureId: string;
  title: string;
  capacity: number;
  items: PlayerStructureStorageItem[];
  permission: BuildingPermissionScope;
  canModify: boolean;
}

export interface StructureManageSnapshot {
  structureId: string;
  blueprintId: string;
  name: string;
  tier: StructureMaterialTier;
  health: number;
  maxHealth: number;
  ownerId: string;
  ownerName: string;
  isOwner: boolean;
  canManage: boolean;
  permission: BuildingPermissionScope;
  canRepair: boolean;
  repairCosts: BuildModeCostStatus[];
  upgradeBlueprintId?: string;
  upgradeName?: string;
  canUpgrade: boolean;
  upgradeCosts: BuildModeCostStatus[];
  hasStorage: boolean;
  storageCount: number;
  refundItems: Array<{ itemId: string; name: string; count: number }>;
  isCreativeFree: boolean;
}
