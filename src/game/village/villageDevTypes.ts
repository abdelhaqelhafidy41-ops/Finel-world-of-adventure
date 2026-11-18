export type VillageDevelopmentLevel = 1 | 2 | 3 | 4 | 5;

export type VillageReputationRank =
  | 'stranger'
  | 'helper'
  | 'friend'
  | 'trusted'
  | 'honored';

export interface VillageProjectCost {
  itemId: string;
  count: number;
}

export interface VillageRepairSiteDef {
  id: string;
  nameEn: string;
  nameAr: string;
  descEn: string;
  descAr: string;
  kind: 'storehouse' | 'fence' | 'well' | 'watchpost';
  offsetX: number;
  offsetZ: number;
  yaw: number;
  costs: VillageProjectCost[];
  xpGain: number;
  reputationGain: number;
  coinsReward: number;
}

export interface VillageProjectDef {
  id: string;
  nameEn: string;
  nameAr: string;
  descEn: string;
  descAr: string;
  kind: 'granary' | 'workshop' | 'watchtower' | 'plaza_lanterns';
  minVillageLevel: VillageDevelopmentLevel;
  offsetX: number;
  offsetZ: number;
  yaw: number;
  costs: VillageProjectCost[];
  xpGain: number;
  reputationGain: number;
  unlockSummaryEn: string;
  unlockSummaryAr: string;
}

export interface VillageDevelopmentRecord {
  villageId: string;
  level: VillageDevelopmentLevel;
  progressXp: number;
  reputationPoints: number;
  completedRepairIds: string[];
  completedProjectIds: string[];
  cropsHarvestedCount: number;
  tradesCompletedCount: number;
  defensesWonCount: number;
  lastRaidWorldHours: number;
}

export interface SavedVillageDevelopmentState {
  villages: Record<string, VillageDevelopmentRecord>;
  farmAnimals?: import('../farming/farmingTypes').SavedFarmAnimal[];
}

export interface VillageDevelopmentSnapshot {
  villageId: string;
  villageName: string;
  level: VillageDevelopmentLevel;
  levelName: string;
  progressXp: number;
  nextLevelXp: number;
  reputationPoints: number;
  reputationRank: VillageReputationRank;
  reputationLabel: string;
  tradeDiscountPct: number;
  sellBonusPct: number;
  defenseActive: boolean;
  defenseRemainingCount: number;
  repairs: Array<{
    id: string;
    name: string;
    desc: string;
    completed: boolean;
    xpGain: number;
    reputationGain: number;
    coinsReward: number;
    costs: Array<{
      itemId: string;
      name: string;
      required: number;
      owned: number;
      enough: boolean;
    }>;
    canComplete: boolean;
  }>;
  projects: Array<{
    id: string;
    name: string;
    desc: string;
    unlockSummary: string;
    minVillageLevel: VillageDevelopmentLevel;
    levelMet: boolean;
    completed: boolean;
    xpGain: number;
    reputationGain: number;
    costs: Array<{
      itemId: string;
      name: string;
      required: number;
      owned: number;
      enough: boolean;
    }>;
    canBuild: boolean;
  }>;
  perksUnlocked: string[];
}

export interface MerchantTradeOffer {
  id: string;
  kind: 'item' | 'animal';
  itemId: string;
  animalSpecies?: import('../farming/farmingTypes').FarmAnimalSpecies;
  count: number;
  name: string;
  description: string;
  basePriceCoins: number;
  finalPriceCoins: number;
  minVillageLevel: VillageDevelopmentLevel;
  locked: boolean;
  ownedCount: number;
}

export interface MerchantSellEntry {
  itemId: string;
  name: string;
  ownedCount: number;
  unitSellCoins: number;
}

export interface MerchantTradeSnapshot {
  npcId: string;
  merchantName: string;
  villageId: string;
  villageName: string;
  villageLevel: VillageDevelopmentLevel;
  reputationRank: VillageReputationRank;
  reputationLabel: string;
  discountPct: number;
  sellBonusPct: number;
  playerCoins: number;
  hasPlayerPenNearby: boolean;
  buyOffers: MerchantTradeOffer[];
  sellEntries: MerchantSellEntry[];
}
