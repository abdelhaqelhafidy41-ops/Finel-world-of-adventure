export type CropId =
  | 'wheat'
  | 'corn'
  | 'potato'
  | 'carrot'
  | 'tomato'
  | 'herb'
  | 'berry';

export type FarmAnimalSpecies = 'chicken' | 'sheep' | 'cow' | 'goat';

export interface CropDefinition {
  id: CropId;
  seedItemId: string;
  harvestItemId: string;
  nameEn: string;
  nameAr: string;
  /** World-hours to reach full maturity when watered */
  growthWorldHours: number;
  /** Base harvest item yield on a small plot (large field scales up) */
  baseYield: number;
  /** Seed return count per harvest */
  seedReturnMin: number;
  seedReturnMax: number;
  requiresWater: boolean;
  /** Visual colors for stage 2 and stage 3 meshes */
  sproutHex: number;
  matureHex: number;
  accentHex: number;
}

export interface FarmPlotSnapshot {
  structureId: string;
  blueprintId: string;
  title: string;
  soilPrepared: boolean;
  cropId: CropId | null;
  cropName: string;
  stage: number; // 0..3
  growthProgress: number; // 0..1
  waterLevel: number; // 0..1
  isRaining: boolean;
  nearWaterSource: boolean;
  hasWateringCan: boolean;
  hasHoe: boolean;
  estimatedHoursRemaining: number | null;
  canHarvest: boolean;
  availableSeeds: Array<{
    cropId: CropId;
    seedItemId: string;
    cropName: string;
    seedCount: number;
    growthWorldHours: number;
    estimatedYield: number;
  }>;
  isCreativeFree: boolean;
}

export interface FarmAnimalRecord {
  id: string;
  species: FarmAnimalSpecies;
  homeVillageId?: string;
  homeStructureId?: string;
  homeX: number;
  homeZ: number;
  penRadius: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  lastProducedWorldHours: number;
  fedUntilWorldHours: number;
  ownerId: string;
}

export interface SavedFarmAnimal {
  id: string;
  species: FarmAnimalSpecies;
  homeVillageId?: string;
  homeStructureId?: string;
  homeX: number;
  homeZ: number;
  penRadius: number;
  lastProducedWorldHours: number;
  fedUntilWorldHours: number;
  ownerId: string;
}
