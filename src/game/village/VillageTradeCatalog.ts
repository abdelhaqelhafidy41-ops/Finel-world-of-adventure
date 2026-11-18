import type { FarmAnimalSpecies } from '../farming/farmingTypes';
import type { VillageDevelopmentLevel } from './villageDevTypes';

export interface BuyOfferDef {
  id: string;
  kind: 'item' | 'animal';
  itemId: string;
  animalSpecies?: FarmAnimalSpecies;
  count: number;
  nameEn: string;
  nameAr: string;
  descEn: string;
  descAr: string;
  basePriceCoins: number;
  minVillageLevel: VillageDevelopmentLevel;
}

export const MERCHANT_BUY_CATALOG: ReadonlyArray<BuyOfferDef> = [
  {
    id: 'offer-wheat-seeds',
    kind: 'item',
    itemId: 'wheat-seeds',
    count: 3,
    nameEn: 'Wheat Seed Pouch (x3)',
    nameAr: 'كيس بذور القمح (×3)',
    descEn: 'Fast-growing grain seeds yielding Golden Wheat.',
    descAr: 'بذور سريعة النمو لإنتاج القمح الذهبي.',
    basePriceCoins: 10,
    minVillageLevel: 1,
  },
  {
    id: 'offer-carrot-seeds',
    kind: 'item',
    itemId: 'carrot-seeds',
    count: 3,
    nameEn: 'Carrot Seeds (x3)',
    nameAr: 'بذور الجزر (×3)',
    descEn: 'Crisp valley carrot seeds ideal for cooking.',
    descAr: 'بذور جزر طازج سريعة النضج وممتازة للطبخ.',
    basePriceCoins: 12,
    minVillageLevel: 1,
  },
  {
    id: 'offer-potato-seeds',
    kind: 'item',
    itemId: 'potato-seeds',
    count: 3,
    nameEn: 'Seed Potatoes (x3)',
    nameAr: 'درنات بطاطس للزراعة (×3)',
    descEn: 'Hearty valley potatoes for stews and rations.',
    descAr: 'بطاطس مغذية للوجبات واليخنة.',
    basePriceCoins: 14,
    minVillageLevel: 1,
  },
  {
    id: 'offer-wooden-hoe',
    kind: 'item',
    itemId: 'wooden-hoe',
    count: 1,
    nameEn: 'Farmer Wooden Hoe',
    nameAr: 'معزقة زراعية خشبية',
    descEn: 'Handy tool for preparing soil beds and farming.',
    descAr: 'أداة عملية لتجهيز التربة وحراثة الأحواض.',
    basePriceCoins: 18,
    minVillageLevel: 1,
  },
  {
    id: 'offer-watering-can',
    kind: 'item',
    itemId: 'watering-can',
    count: 1,
    nameEn: 'Copper Watering Can',
    nameAr: 'مرشة ماء نحاسية',
    descEn: 'Waters farm beds efficiently to accelerate crop growth.',
    descAr: 'تسقي أحواض الزراعة بكفاءة لتسريع نمو المحاصيل.',
    basePriceCoins: 22,
    minVillageLevel: 1,
  },
  {
    id: 'offer-animal-feed',
    kind: 'item',
    itemId: 'animal-feed',
    count: 4,
    nameEn: 'Animal Feed Bundle (x4)',
    nameAr: 'علف حيوانات المزرعة (×4)',
    descEn: 'Nutritious grain mix that boosts egg, milk, and wool output.',
    descAr: 'خليط حبوب مغذٍ يسرّع إنتاج البيض والحليب والصوف.',
    basePriceCoins: 14,
    minVillageLevel: 1,
  },
  {
    id: 'offer-buy-chicken',
    kind: 'animal',
    itemId: 'egg',
    animalSpecies: 'chicken',
    count: 1,
    nameEn: 'Farm Hen (Requires Coop)',
    nameAr: 'دجاجة مزرعة (تتطلب قن دجاج)',
    descEn: 'Lays fresh eggs near your Homestead Chicken Coop.',
    descAr: 'تبيض يوميًا بالقرب من قن الدجاج الخاص بك.',
    basePriceCoins: 42,
    minVillageLevel: 1,
  },
  {
    id: 'offer-corn-seeds',
    kind: 'item',
    itemId: 'corn-seeds',
    count: 3,
    nameEn: 'Sweet Corn Kernels (x3)',
    nameAr: 'بذور الذرة الحلوة (×3)',
    descEn: 'Tall golden stalks producing sweet corn and cornbread flour.',
    descAr: 'سيقان طويلة تنتج ذرة حلوة لصناعة خبز الذرة.',
    basePriceCoins: 18,
    minVillageLevel: 2,
  },
  {
    id: 'offer-tomato-seeds',
    kind: 'item',
    itemId: 'tomato-seeds',
    count: 3,
    nameEn: 'Sun Tomato Seeds (x3)',
    nameAr: 'بذور الطماطم (×3)',
    descEn: 'Juicy vine tomatoes prized by bakers and travelers.',
    descAr: 'طماطم ناضجة مطلوبة للطبخ والتجارة.',
    basePriceCoins: 18,
    minVillageLevel: 2,
  },
  {
    id: 'offer-herb-seeds',
    kind: 'item',
    itemId: 'herb-seeds',
    count: 2,
    nameEn: 'Silversage Herb Seeds (x2)',
    nameAr: 'بذور الأعشاب الطبية (×2)',
    descEn: 'Cultivate medicinal herbs for healing tonics.',
    descAr: 'ل زراعة الأعشاب الطبية اللازمة لجرعات الشفاء.',
    basePriceCoins: 22,
    minVillageLevel: 2,
  },
  {
    id: 'offer-buy-sheep',
    kind: 'animal',
    itemId: 'wool',
    animalSpecies: 'sheep',
    count: 1,
    nameEn: 'Domestic Sheep (Requires Pen)',
    nameAr: 'خروف أليف (يتطلب حظيرة)',
    descEn: 'Produces warm wool for beds, armor linings, and trade.',
    descAr: 'يوفر صوفًا دافئًا لصنع الأسرّة والتجارة.',
    basePriceCoins: 68,
    minVillageLevel: 2,
  },
  {
    id: 'offer-hearth-loaf',
    kind: 'item',
    itemId: 'hearth-loaf',
    count: 2,
    nameEn: 'Fresh Hearth Loaves (x2)',
    nameAr: 'أرغفة خبز طازجة (×2)',
    descEn: 'Warm village bread restoring stamina and health.',
    descAr: 'خبز قروي دافئ يعيد الصحة والطاقة.',
    basePriceCoins: 16,
    minVillageLevel: 2,
  },
  {
    id: 'offer-berry-seeds',
    kind: 'item',
    itemId: 'berry-seeds',
    count: 2,
    nameEn: 'Woodland Berry Cuttings (x2)',
    nameAr: 'شتلات التوت البري (×2)',
    descEn: 'Cultivate sweet woodland berries right in your homestead.',
    descAr: 'ازرع شجيرات التوت البري مباشرة في مزرعتك.',
    basePriceCoins: 24,
    minVillageLevel: 3,
  },
  {
    id: 'offer-buy-goat',
    kind: 'animal',
    itemId: 'milk',
    animalSpecies: 'goat',
    count: 1,
    nameEn: 'Mountain Goat (Requires Pen)',
    nameAr: 'ماعز المزرعة (يتطلب حظيرة)',
    descEn: 'Hardy milker that thrives in any valley homestead.',
    descAr: 'حيوان منتج للحليب يتأقلم مع كل الحظائر.',
    basePriceCoins: 76,
    minVillageLevel: 3,
  },
  {
    id: 'offer-tonic',
    kind: 'item',
    itemId: 'apothecary-tonic',
    count: 1,
    nameEn: 'Apothecary Tonic',
    nameAr: 'جرعة العطار العلاجية',
    descEn: 'Distilled herbal tonic for deep health recovery.',
    descAr: 'جرعة عشبية نقية لاستعادة الصحة بسرعة.',
    basePriceCoins: 28,
    minVillageLevel: 3,
  },
  {
    id: 'offer-buy-cow',
    kind: 'animal',
    itemId: 'milk',
    animalSpecies: 'cow',
    count: 1,
    nameEn: 'Dairy Cow (Requires Pen)',
    nameAr: 'بقرة حلوب (تتطلب حظيرة)',
    descEn: 'Prized livestock yielding rich fresh milk for artisan cheese.',
    descAr: 'بقرة حلوب تنتج الحليب الطازج لصنع الجبن المعتّق.',
    basePriceCoins: 95,
    minVillageLevel: 4,
  },
  {
    id: 'offer-iron-ingot',
    kind: 'item',
    itemId: 'iron-ingot',
    count: 2,
    nameEn: 'Smelted Iron Ingots (x2)',
    nameAr: 'سبائك حديد مصهور (×2)',
    descEn: 'Merchant surplus iron for village upgrades and reinforced builds.',
    descAr: 'سبائك حديد لتطوير القرى والمباني المقوّاة.',
    basePriceCoins: 34,
    minVillageLevel: 4,
  },
  {
    id: 'offer-timber-beam',
    kind: 'item',
    itemId: 'timber-beam',
    count: 3,
    nameEn: 'Seasoned Timber Beams (x3)',
    nameAr: 'عوارض خشبية معالجة (×3)',
    descEn: 'Master carpenter beams for large houses and workshops.',
    descAr: 'عوارض نجارة متينة للورش والمنازل الكبيرة.',
    basePriceCoins: 28,
    minVillageLevel: 5,
  },
];

export const SELLABLE_FARM_AND_TRADE_PRIORITY = new Set<string>([
  'wheat',
  'corn',
  'potato',
  'carrot',
  'tomato',
  'berries',
  'medicinal-herb',
  'egg',
  'milk',
  'cheese',
  'wool',
  'feathers',
  'cornbread',
  'farmstead-stew',
  'hearth-loaf',
  'berry-jam',
  'sun-apple',
  'cooked-meat',
  'leather',
  'pelts',
]);

export function computeDiscountedPrice(
  basePriceCoins: number,
  discountPct: number,
): number {
  return Math.max(1, Math.round(basePriceCoins * (1 - discountPct / 100)));
}

export function computeSellPrice(
  baseValueCoins: number,
  sellBonusPct: number,
): number {
  const base = Math.max(1, Math.round(baseValueCoins * 0.72));
  return Math.max(1, Math.round(base * (1 + sellBonusPct / 100)));
}

export function isMerchantDialogueNpc(npcId: string, role?: string): boolean {
  const r = (role ?? '').toLowerCase();
  if (
    r.includes('merchant') ||
    r.includes('trader') ||
    r.includes('baker') ||
    r.includes('apothecary') ||
    r.includes('outfitter') ||
    r.includes('farmer') ||
    r.includes('tinker')
  ) {
    return true;
  }
  return (
    npcId === 'npc-maren' ||
    npcId === 'npc-toby' ||
    npcId === 'npc-lyra' ||
    npcId === 'npc-doran' ||
    npcId === 'npc-sq-tariq'
  );
}

export function isVillageStewardNpc(npcId: string, role?: string): boolean {
  const r = (role ?? '').toLowerCase();
  if (
    r.includes('elder') ||
    r.includes('captain') ||
    r.includes('steward') ||
    r.includes('warden') ||
    r.includes('blacksmith') ||
    r.includes('merchant')
  ) {
    return true;
  }
  return (
    npcId === 'npc-elder' ||
    npcId === 'npc-rowan' ||
    npcId === 'npc-bram' ||
    npcId === 'npc-maren'
  );
}
