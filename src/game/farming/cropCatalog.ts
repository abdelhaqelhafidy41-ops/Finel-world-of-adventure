import type { CropDefinition, CropId, FarmAnimalSpecies } from './farmingTypes';
import type { Language } from '../i18n/translations';

export const CROP_CATALOG: Record<CropId, CropDefinition> = {
  wheat: {
    id: 'wheat',
    seedItemId: 'wheat-seeds',
    harvestItemId: 'wheat',
    nameEn: 'Golden Wheat',
    nameAr: 'قمح ذهبي',
    growthWorldHours: 6,
    baseYield: 3,
    seedReturnMin: 1,
    seedReturnMax: 2,
    requiresWater: true,
    sproutHex: 0x5c9e44,
    matureHex: 0xe5b842,
    accentHex: 0xf0ce65,
  },
  corn: {
    id: 'corn',
    seedItemId: 'corn-seeds',
    harvestItemId: 'corn',
    nameEn: 'Sweet Corn',
    nameAr: 'ذرة حلوة',
    growthWorldHours: 8,
    baseYield: 3,
    seedReturnMin: 1,
    seedReturnMax: 2,
    requiresWater: true,
    sproutHex: 0x4c943c,
    matureHex: 0x5ca342,
    accentHex: 0xf4cc44,
  },
  potato: {
    id: 'potato',
    seedItemId: 'potato-seeds',
    harvestItemId: 'potato',
    nameEn: 'Valley Potato',
    nameAr: 'بطاطس الوادي',
    growthWorldHours: 7,
    baseYield: 3,
    seedReturnMin: 1,
    seedReturnMax: 2,
    requiresWater: true,
    sproutHex: 0x4b8e3f,
    matureHex: 0x3f7b38,
    accentHex: 0xc29e68,
  },
  carrot: {
    id: 'carrot',
    seedItemId: 'carrot-seeds',
    harvestItemId: 'carrot',
    nameEn: 'Crisp Carrot',
    nameAr: 'جزر طازج',
    growthWorldHours: 5.5,
    baseYield: 4,
    seedReturnMin: 1,
    seedReturnMax: 2,
    requiresWater: true,
    sproutHex: 0x549c49,
    matureHex: 0x488a3e,
    accentHex: 0xec7b26,
  },
  tomato: {
    id: 'tomato',
    seedItemId: 'tomato-seeds',
    harvestItemId: 'tomato',
    nameEn: 'Sun Tomato',
    nameAr: 'طماطم ناضجة',
    growthWorldHours: 8.5,
    baseYield: 3,
    seedReturnMin: 1,
    seedReturnMax: 2,
    requiresWater: true,
    sproutHex: 0x4a8f3d,
    matureHex: 0x3b7b32,
    accentHex: 0xd93c34,
  },
  herb: {
    id: 'herb',
    seedItemId: 'herb-seeds',
    harvestItemId: 'medicinal-herb',
    nameEn: 'Silversage Herb',
    nameAr: 'عشبة المريمية الطبية',
    growthWorldHours: 6.5,
    baseYield: 3,
    seedReturnMin: 1,
    seedReturnMax: 2,
    requiresWater: true,
    sproutHex: 0x62a87b,
    matureHex: 0x76bf92,
    accentHex: 0xc7e8d4,
  },
  berry: {
    id: 'berry',
    seedItemId: 'berry-seeds',
    harvestItemId: 'berries',
    nameEn: 'Woodland Berries',
    nameAr: 'توت بري',
    growthWorldHours: 9,
    baseYield: 4,
    seedReturnMin: 1,
    seedReturnMax: 2,
    requiresWater: true,
    sproutHex: 0x3b7e3c,
    matureHex: 0x2f6930,
    accentHex: 0xb92b49,
  },
};

export const ALL_CROPS: CropDefinition[] = Object.values(CROP_CATALOG);

export function getCropById(cropId: string | null | undefined): CropDefinition | undefined {
  if (!cropId) return undefined;
  return CROP_CATALOG[cropId as CropId];
}

export function getCropBySeedItemId(seedItemId: string): CropDefinition | undefined {
  return ALL_CROPS.find((c) => c.seedItemId === seedItemId);
}

export function getCropDisplayName(cropId: string | null | undefined, lang: Language): string {
  const def = getCropById(cropId);
  if (!def) return lang === 'ar' ? 'فارغ' : 'Empty';
  return lang === 'ar' ? def.nameAr : def.nameEn;
}

export interface FarmAnimalProductSpec {
  species: FarmAnimalSpecies;
  nameEn: string;
  nameAr: string;
  produceItemId: string;
  produceCount: number;
  intervalWorldHours: number;
  actionVerbEn: string;
  actionVerbAr: string;
  favoriteFeedItems: string[];
  shopCostCoins: number;
}

export const FARM_ANIMAL_SPECS: Record<FarmAnimalSpecies, FarmAnimalProductSpec> = {
  chicken: {
    species: 'chicken',
    nameEn: 'Farm Hen',
    nameAr: 'دجاجة المزرعة',
    produceItemId: 'egg',
    produceCount: 1,
    intervalWorldHours: 4.5,
    actionVerbEn: 'Collect Egg',
    actionVerbAr: 'جمع البيض',
    favoriteFeedItems: ['animal-feed', 'wheat', 'corn', 'wheat-seeds'],
    shopCostCoins: 42,
  },
  sheep: {
    species: 'sheep',
    nameEn: 'Domestic Sheep',
    nameAr: 'خروف أليف',
    produceItemId: 'wool',
    produceCount: 2,
    intervalWorldHours: 7.5,
    actionVerbEn: 'Shear Wool',
    actionVerbAr: 'جزّ الصوف',
    favoriteFeedItems: ['animal-feed', 'wheat', 'carrot'],
    shopCostCoins: 68,
  },
  cow: {
    species: 'cow',
    nameEn: 'Dairy Cow',
    nameAr: 'بقرة حلوب',
    produceItemId: 'milk',
    produceCount: 1,
    intervalWorldHours: 6.5,
    actionVerbEn: 'Milk Cow',
    actionVerbAr: 'حلب البقرة',
    favoriteFeedItems: ['animal-feed', 'wheat', 'corn', 'carrot'],
    shopCostCoins: 95,
  },
  goat: {
    species: 'goat',
    nameEn: 'Mountain Goat',
    nameAr: 'ماعز المزرعة',
    produceItemId: 'milk',
    produceCount: 1,
    intervalWorldHours: 5.5,
    actionVerbEn: 'Milk Goat',
    actionVerbAr: 'حلب الماعز',
    favoriteFeedItems: ['animal-feed', 'wheat', 'carrot', 'berries'],
    shopCostCoins: 76,
  },
};

export function getFarmAnimalName(species: FarmAnimalSpecies, lang: Language): string {
  const spec = FARM_ANIMAL_SPECS[species];
  return lang === 'ar' ? spec.nameAr : spec.nameEn;
}
