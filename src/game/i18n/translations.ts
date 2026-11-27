import type {
  BiomeType,
  CameraPerspective,
  NpcRole,
  NpcRoutinePeriod,
  PlayerMovementState,
} from '../types';
import type { EquipSlot, ItemCategory } from '../inventory/inventoryTypes';
import type { QuestStatus } from '../quest/questTypes';
import type { SideQuestCategory, SideQuestState } from '../sidequest/sideQuestTypes';
import type {
  BuildingPermissionScope,
  PlacementValidationReason,
} from '../building/buildingTypes';

import { syncLanguageSettingToAndroid } from '../settings/AndroidSettingsSync';
import { syncLanguageSettingToWindows } from '../settings/WindowsSettingsSync';

export type Language = 'en' | 'ar';

export const LANGUAGE_STORAGE_KEY = 'woa_language_v1';

export function loadSavedLanguage(): Language {
  try {
    const val = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (val === 'ar' || val === 'en') return val;
  } catch {
    // Ignore storage access errors
  }
  return 'en';
}

export function saveLanguage(lang: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // Ignore storage access errors
  }
  syncLanguageSettingToAndroid(lang);
  syncLanguageSettingToWindows(lang);
}

export const BIOME_LABELS: Record<Language, Record<BiomeType, string>> = {
  en: {
    Plains: 'Plains',
    Forest: 'Forest',
    Mountains: 'Mountains',
    Desert: 'Desert',
    Beach: 'Beach',
  },
  ar: {
    Plains: 'السهول',
    Forest: 'الغابة',
    Mountains: 'الجبال',
    Desert: 'الصحراء',
    Beach: 'الشاطئ',
  },
};

export const CARDINAL_LABELS: Record<Language, string[]> = {
  en: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
  ar: ['ش', 'ش.ق', 'ق', 'ج.ق', 'ج', 'ج.غ', 'غ', 'ش.غ'],
};

export const MOVEMENT_LABELS: Record<
  Language,
  Record<PlayerMovementState, string>
> = {
  en: {
    idle: 'idle',
    walking: 'walking',
    running: 'running',
    jumping: 'jumping',
    falling: 'falling',
    swimming: 'swimming',
  },
  ar: {
    idle: 'واقف',
    walking: 'يمشي',
    running: 'يركض',
    jumping: 'يقفز',
    falling: 'يهبط',
    swimming: 'يسبح',
  },
};

export const PERIOD_LABELS: Record<Language, Record<NpcRoutinePeriod, string>> = {
  en: {
    morning: 'Morning',
    midday: 'Midday',
    evening: 'Evening',
    night: 'Night',
  },
  ar: {
    morning: 'الصباح',
    midday: 'الظهيرة',
    evening: 'المساء',
    night: 'الليل',
  },
};

export const ROLE_LABELS: Record<Language, Record<NpcRole, string>> = {
  en: {
    villager: 'Villager',
    merchant: 'Merchant',
    farmer: 'Farmer',
    guard: 'Guard',
    blacksmith: 'Blacksmith',
    hunter: 'Hunter',
    woodcutter: 'Woodcutter',
    fisherman: 'Fisherman',
    healer: 'Healer',
    innkeeper: 'Innkeeper',
    carpenter: 'Carpenter',
    miner: 'Miner',
    elder: 'Village Elder',
    traveling_merchant: 'Traveling Merchant',
  },
  ar: {
    villager: 'قروي',
    merchant: 'تاجر',
    farmer: 'مزارع',
    guard: 'حارس',
    blacksmith: 'حدّاد',
    hunter: 'صيّاد',
    woodcutter: 'حطّاب',
    fisherman: 'صيّاد سمك',
    healer: 'معالج',
    innkeeper: 'صاحب النُزل',
    carpenter: 'نجّار',
    miner: 'عامل منجم',
    elder: 'شيخ القرية',
    traveling_merchant: 'تاجر متجوّل',
  },
};

export const QUEST_STATUS_LABELS: Record<Language, Record<QuestStatus, string>> = {
  en: {
    available: 'Available',
    active: 'Active',
    ready: 'Ready to Turn In',
    completed: 'Completed',
  },
  ar: {
    available: 'متاحة',
    active: 'نشطة',
    ready: 'جاهزة للتسليم',
    completed: 'مكتملة',
  },
};

export const ITEM_CATEGORY_LABELS: Record<
  Language,
  Record<ItemCategory | 'all', string>
> = {
  en: {
    all: 'All',
    weapon: 'Weapons',
    consumable: 'Consumables',
    quest: 'Quest',
    equipment: 'Equipment',
    material: 'Materials',
    tool: 'Tools',
  },
  ar: {
    all: 'الكل',
    weapon: 'الأسلحة',
    consumable: 'مستهلكات',
    quest: 'مهام',
    equipment: 'معدات',
    material: 'مواد',
    tool: 'أدوات',
  },
};

export const EQUIP_SLOT_LABELS: Record<Language, Record<EquipSlot, string>> = {
  en: {
    weapon: 'Weapon',
    head: 'Head',
    body: 'Body / Cloak',
    legs: 'Legs',
    hands: 'Hands',
    boots: 'Boots',
    backpack: 'Backpack',
    accessory: 'Accessory',
  },
  ar: {
    weapon: 'السلاح',
    head: 'الرأس',
    body: 'الجسم / العباءة',
    legs: 'الساقان',
    hands: 'اليدان',
    boots: 'الأحذية',
    backpack: 'الحقيبة',
    accessory: 'إكسسوار',
  },
};

export const ACTION_VERB_AR: Record<string, string> = {
  'Talk to': 'تحدّث مع',
  'Gather': 'اجمع',
  'Pick up': 'التقط',
  'Inspect': 'تفقّد',
  'Read': 'اقرأ',
  'Draw Water': 'اسحب ماء',
  'Chop': 'اقطع',
  'Mine': 'استخرج',
  'Open': 'افتح',
  'Close': 'أغلق',
  'Sleep': 'نم',
  'Harvest': 'احصد',
  'Survey': 'معاينة',
  'Dig': 'احفر',
  'Collect': 'اجمع',
  'Craft': 'اصنع',
  'Open Storage': 'افتح المخزن',
  'Check Crop': 'تفقّد المحصول',
  'Manage': 'إدارة',
  'Till Soil': 'حراثة التربة',
  'Plant Seeds': 'زراعة البذور',
  'Tend Crop': 'رعاية المحصول',
  'Collect Egg': 'جمع البيض',
  'Shear Wool': 'جزّ الصوف',
  'Milk Cow': 'حلب البقرة',
  'Milk Goat': 'حلب الماعز',
  'Feed / Tend': 'إطعام ورعاية',
  'Village Board': 'لوحة القرية',
};

export const VILLAGE_NAME_AR: Record<string, string> = {
  oakhollow: 'أوكهولو',
  pinehaven: 'ملاذ الصنوبر',
  greenfields: 'المروج الخضراء',
  cragwatch: 'مرصد الجرف',
  riverford: 'معبر النهر',
  windmere: 'بحيرة الريح',
  grandcross: 'المفترق الكبير',
  sunspire: 'واحة شمس الذرى',
  glenwatch: 'مرصد الوادي',
};

export const VILLAGE_KIND_LABELS: Record<Language, Record<string, string>> = {
  en: {
    oakhollow: 'Heartland Village',
    forest: 'Forest Village',
    farming: 'Farming Village',
    mountain: 'Mountain Village',
    river: 'River Village',
    plains: 'Plains Village',
    trading: 'Trading Town',
    desert: 'Desert Settlement',
    oasis: 'Oasis Settlement',
    coastal: 'Coastal Village',
    valley: 'Valley Village',
  },
  ar: {
    oakhollow: 'قرية القلب',
    forest: 'قرية الغابة',
    farming: 'قرية زراعية',
    mountain: 'قرية جبلية',
    river: 'قرية النهر',
    plains: 'قرية السهول',
    trading: 'بلدة تجارية',
    desert: 'مستوطنة صحراوية',
    oasis: 'واحة صحراوية',
    coastal: 'قرية ساحلية',
    valley: 'قرية الوادي',
  },
};

const dynamicVillageNamesAr = new Map<string, string>();

export function registerDynamicVillageNameAr(id: string, nameAr: string): void {
  dynamicVillageNamesAr.set(id, nameAr);
}

export function clearDynamicVillageNamesAr(): void {
  dynamicVillageNamesAr.clear();
}

export function getLocalizedVillageName(
  id: string,
  fallbackName: string,
  lang: Language,
): string {
  if (lang === 'en') return fallbackName;
  return dynamicVillageNamesAr.get(id) ?? VILLAGE_NAME_AR[id] ?? fallbackName;
}

export const RESOURCE_NODE_LABELS_AR: Record<string, string> = {
  wood: 'شجرة خشب',
  stone: 'صخرة حجرية',
  'copper-ore': 'عرق خام النحاس',
  'iron-ore': 'عرق خام الحديد',
  'silver-ore': 'عرق خام الفضة',
  'gold-ore': 'عرق خام الذهب',
  coal: 'طبقة الفحم',
  clay: 'كتلة طين نهري',
  gravel: 'كومة حصى',
  wheat: 'حزمة قمح ذهبي',
  fiber: 'حزمة ألياف',
  mushroom: 'فطر الغابة',
  berries: 'شجيرة توت',
  flower: 'أزهار برية',
  'medicinal-herb': 'عشبة طبية',
  sand: 'كومة رمال',
  cactus: 'صبّار صحراوي',
  'desert-plant': 'عشبة صحراوية',
  shell: 'صدفة بحرية',
  driftwood: 'خشب طافٍ',
  'rare-mineral': 'بلورة نادرة',
};

export const INTERACTABLE_LABEL_AR: Record<string, string> = {
  'cairn-glade': 'رجم الدرب الحجري',
  'sign-glade': 'لافتة درب النهر',
  'sign-lake': 'لافتة ضفاف البحيرة',
  'sign-desert': 'لافتة حافة الكثبان',
  'sign-mountains': 'لافتة ممر المرتفعات',
  'sign-beach': 'لافتة الخليج الساحلي',
  'village-well': 'بئر أوكهولو',
  'village-bakery': 'مخبز حجر الشمس',
  'village-apothecary': 'صيدلية الصفصاف',
  'village-outfitters': 'متجر أدوات الوادي',
  'village-farm': 'مزرعة أوكهولو',
  'village-noticeboard': 'لوحة إعلانات أوكهولو',
  'village-signpost': 'لافتة قرية أوكهولو',
  'village-square': 'ساحة قرية أوكهولو',
  'spawn-glade': 'المرج المشمس',
  'loc-abandoned-cabin': 'الكوخ المهجور',
  'loc-forest-camp': 'مخيم الغابة',
  'loc-hunter-camp': 'مخيم الصيادين',
  'loc-ruined-village': 'القرية المهدّمة',
  'loc-ancient-tower': 'البرج الأثري',
  'loc-sunstone-mine': 'منجم حجر الشمس',
  'loc-echoing-cave': 'كهف الصدى',
  'loc-ridge-watchtower': 'برج مراقبة الجرف',
  'loc-ancient-ruins': 'الآثار القديمة',
  'loc-hidden-treasure': 'خليج الكنز المخفي',
  'pinehaven-well': 'بئر ملاذ الصنوبر',
  'pinehaven-signpost': 'لافتة ملاذ الصنوبر',
  'greenfields-well': 'بئر المروج الخضراء',
  'greenfields-signpost': 'لافتة المروج الخضراء',
  'cragwatch-well': 'بئر مرصد الجرف',
  'cragwatch-signpost': 'لافتة مرصد الجرف',
  'riverford-well': 'بئر معبر النهر',
  'riverford-signpost': 'لافتة معبر النهر',
  'windmere-well': 'بئر بحيرة الريح',
  'windmere-signpost': 'لافتة بحيرة الريح',
  'grandcross-well': 'بئر المفترق الكبير',
  'grandcross-signpost': 'لافتة المفترق الكبير',
  'sunspire-well': 'بئر واحة شمس الذرى',
  'sunspire-signpost': 'لافتة واحة شمس الذرى',
  'glenwatch-well': 'بئر مرصد الوادي',
  'glenwatch-signpost': 'لافتة مرصد الوادي',
};

export const INTERACTABLE_MESSAGE_AR: Record<string, string> = {
  'cairn-glade': 'رجم الوادي: «غربًا تقع بحيرة الزمرد؛ وشرقًا كثبان الشمس؛ وجنوبًا البحر.»',
  'sign-glade': 'معبر النهر · اتبع الجدول شمالًا إلى بحيرة الجبل أو جنوبًا إلى الشاطئ.',
  'sign-lake': 'البحيرة الهامسة · مياه جبلية صافية تنبع من القمم الشمالية.',
  'sign-desert': 'صحراء حجر الشمس · كثبان ذهبية وهضاب رملية متموجة أمامك.',
  'sign-mountains': 'القمم الشمالية · سلاسل جبلية مكسوة بالثلوج ترتفع فوق خط الأشجار.',
  'sign-beach': 'الساحل الذهبي · شواطئ رملية تلتقي بالخليج الجنوبي.',
  'village-well': 'سحبت ماءً عذبًا باردًا من بئر أوكهولو (+10 صحة وتجدّد التحمّل).',
  'village-bakery': 'مخبز حجر الشمس: أرغفة دافئة وفطائر عسل تبرد على المنضدة.',
  'village-apothecary': 'صيدلية الصفصاف: أعشاب مجففة وقوارير إكسير تصطف على الرفوف.',
  'village-outfitters': 'متجر أدوات الوادي: حقائب وفوانيس وأحذية متينة للمستكشفين.',
  'village-farm': 'مزرعة أوكهولو: قمح ذهبي وخضراوات طازجة تنضج تحت الشمس.',
  'village-noticeboard': 'لوحة أوكهولو: «الممرات الجبلية شمالًا، كثبان الشمس شرقًا، والبحيرة غربًا.»',
  'village-signpost': 'مرحبًا بك في قرية أوكهولو — بئر ماء عذب وساحة سوق في الأمام.',
};

export function translateInteractableVerb(verb: string, lang: Language): string {
  if (lang === 'en') return verb;
  return ACTION_VERB_AR[verb] ?? verb;
}

export function translateInteractableLabel(
  id: string,
  fallbackLabel: string,
  lang: Language,
): string {
  if (lang === 'en') return fallbackLabel;
  if (INTERACTABLE_LABEL_AR[id]) return INTERACTABLE_LABEL_AR[id];
  if (id.endsWith('-plaque')) {
    const baseId = id.slice(0, -'-plaque'.length);
    const baseName = INTERACTABLE_LABEL_AR[baseId];
    return baseName ? `لوحة ${baseName}` : fallbackLabel;
  }
  if (id.endsWith('-bed')) {
    return 'سرير مريح';
  }
  if (id.endsWith('-door')) {
    return 'باب الكوخ';
  }
  if (id.endsWith('-well')) {
    const baseId = id.slice(0, -'-well'.length);
    const vName = VILLAGE_NAME_AR[baseId];
    return vName ? `بئر ${vName}` : 'بئر القرية';
  }
  if (id.endsWith('-signpost')) {
    const baseId = id.slice(0, -'-signpost'.length);
    const vName = VILLAGE_NAME_AR[baseId];
    return vName ? `لافتة ${vName}` : 'لافتة القرية';
  }
  if (id.includes('-station-') || id.startsWith('placed-crafting_table') || id.startsWith('placed-furnace')) {
    if (id.includes('furnace')) return 'فرن الصهر';
    if (id.includes('forge')) return 'الحدّادة والمطرقة';
    if (id.includes('workbench')) return 'طاولة الحرفي';
    return 'طاولة الصناعة';
  }
  return fallbackLabel;
}

export function translateInteractableMessage(
  id: string,
  fallbackMessage: string,
  lang: Language,
): string {
  if (lang === 'en') return fallbackMessage;
  if (INTERACTABLE_MESSAGE_AR[id]) return INTERACTABLE_MESSAGE_AR[id];
  if (id.endsWith('-well')) {
    const baseId = id.slice(0, -'-well'.length);
    const vName = VILLAGE_NAME_AR[baseId] ?? baseId;
    return `سحبت ماءً عذبًا باردًا من بئر ${vName} (+12 صحة وتجدّد التحمّل).`;
  }
  if (id.endsWith('-signpost')) {
    const baseId = id.slice(0, -'-signpost'.length);
    const vName = VILLAGE_NAME_AR[baseId] ?? baseId;
    return `مرحبًا بك في ${vName} — استكشف المنازل والحدادة والمتاجر في الجوار.`;
  }
  if (id.endsWith('-plaque')) {
    const baseId = id.slice(0, -'-plaque'.length);
    const locName = INTERACTABLE_LABEL_AR[baseId] ?? fallbackMessage;
    return `معلم مكتشف: ${locName}.`;
  }
  if (id.includes('-station-') || id.startsWith('placed-crafting_table') || id.startsWith('placed-furnace')) {
    if (id.includes('furnace')) return 'تم فتح قائمة التصنيع عند فرن الصهر.';
    if (id.includes('forge')) return 'تم فتح قائمة التصنيع عند الحدّادة.';
    if (id.includes('workbench')) return 'تم فتح قائمة التصنيع عند طاولة الحرفي.';
    return 'تم فتح قائمة التصنيع عند طاولة الصناعة.';
  }
  return fallbackMessage;
}

export interface UiStrings {
  gameTitle: string;
  openWorldSubtitle: string;
  heroTagline: string;
  startAdventure: string;
  titleControlsHint: string;
  titleTouchControlsHint: string;
  soundOn: string;
  soundOff: string;
  audioOn: string;
  muted: string;
  languageLabel: string;
  loadingDefault: string;
  health: string;
  stamina: string;
  waterSuffix: string;
  levelShort: string;
  xpShort: string;
  pressEPrefix: string;
  pressEMiddle: string;
  desktopHint: string;
  gamePaused: string;
  resumeAdventure: string;
  returnToSpawn: string;
  mobileTouchSettings: string;
  activeStatus: string;
  desktopStatus: string;
  mouseSensitivity: string;
  invertMouseY: string;
  controlsMove: string;
  controlsCamera: string;
  controlsJump: string;
  controlsSprint: string;
  controlsInteract: string;
  controlsAttack: string;
  controlsPackMap: string;
  controlsPause: string;
  mouseWord: string;
  clickWord: string;
  // Mobile settings & overlay
  touchDetected: string;
  desktopPreviewHint: string;
  reset: string;
  forceMobileControls: string;
  forceMobileDesc: string;
  joystickSize: string;
  buttonSize: string;
  controlOpacity: string;
  touchCamSensitivity: string;
  invertTouchY: string;
  visibleTouchButtons: string;
  done: string;
  btnJumpLabel: string;
  btnAttackLabel: string;
  btnInteractLabel: string;
  btnInventoryLabel: string;
  btnMapLabel: string;
  btnPauseLabel: string;
  btnQuestsLabel: string;
  customizeControls: string;
  customizeBannerHint: string;
  customizeDone: string;
  customizeReset: string;
  resetControlsBtn: string;
  resetPortraitControls: string;
  resetLandscapeControls: string;
  resetAllControls: string;
  resetConfirmTitle: string;
  resetConfirmYes: string;
  resetConfirmCancel: string;
  miniMapTitle: string;
  sprintActiveHint: string;
  saveSettingsBtn: string;
  settingsSavedNotice: string;
  enableTouchControls: string;
  touchOn: string;
  touchOff: string;
  controlSizeLabel: string;
  sizeSmall: string;
  sizeMedium: string;
  sizeLarge: string;
  portraitCameraTitle: string;
  portraitAutoAdapt: string;
  portraitFovComfort: string;
  fullscreenEnter: string;
  fullscreenExit: string;
  selectedControlLabel: string;
  controlSizePx: string;
  controlPosPct: string;
  showControlBtn: string;
  hideControlBtn: string;
  hiddenTag: string;
  portraitModeLabel: string;
  landscapeModeLabel: string;
  ctrlJoystick: string;
  ctrlDpad: string;
  movementControlsLabel: string;
  movementModeJoystick: string;
  movementModeDpad: string;
  optionSelectedBadge: string;
  optionSelectBadge: string;
  dpadUpLabel: string;
  dpadDownLabel: string;
  dpadLeftLabel: string;
  dpadRightLabel: string;
  ctrlSprint: string;
  ctrlJump: string;
  ctrlAttack: string;
  ctrlInteract: string;
  ctrlInventory: string;
  ctrlMap: string;
  ctrlPause: string;
  ctrlQuests: string;
  mobQuests: string;
  mobPack: string;
  mobMap: string;
  mobHit: string;
  mobJump: string;
  mobSprint: string;
  // Inventory Modal
  explorerPack: string;
  slotsUsed: string;
  equippedGear: string;
  noEquippedSlot: string;
  selectItemHint: string;
  useItem: string;
  equipItem: string;
  unequipItem: string;
  dropItem: string;
  questItemLocked: string;
  toolItemLocked: string;
  stackLabel: string;
  bonusMaxHp: string;
  bonusMaxStam: string;
  bonusSpeed: string;
  villageQuests: string;
  emptyCategory: string;
  inventoryFooterHint: string;
  // World Map
  worldMap: string;
  positionLabel: string;
  northMountains: string;
  southCoastline: string;
  whiteArrowLegend: string;
  goldDotsLegend: string;
  mapVillageName: string;
  mapVillageSubtitle: string;
  mapVillageServiceTag: string;
  mapDiscoveredTag: string;
  mapUndiscoveredTag: string;
  mapRegionLake: string;
  mapRegionDesert: string;
  mapRegionMountains: string;
  mapRegionCoast: string;
  mapHerbPatchName: string;
  mapCenterPlayer: string;
  mapResetView: string;
  mapZoomIn: string;
  mapZoomOut: string;
  mapLegendTitle: string;
  mapLegendPlayer: string;
  mapLegendVillage: string;
  mapLegendQuestActive: string;
  mapLegendQuestTurnin: string;
  mapLegendQuestAvailable: string;
  mapLegendLocation: string;
  mapLegendHerb: string;
  mapHintControls: string;
  mapDistanceAway: (meters: number) => string;
  mapFocusMarker: string;
  mapSelectHint: string;
  mapShowLegend: string;
  mapHideLegend: string;
  // Quest Journal
  questJournal: string;
  levelAdventurer: (lvl: number) => string;
  coinsLabel: string;
  tabActive: (n: number) => string;
  tabCompleted: (n: number) => string;
  tabAvailable: (n: number) => string;
  emptyActiveQuests: string;
  emptyCompletedQuests: string;
  emptyAvailableQuests: string;
  trackedBtn: string;
  trackHudBtn: string;
  rewardLabel: string;
  // Dialogue Modal
  lineOf: (idx: number, total: number) => string;
  nextLineHint: string;
  chooseKeyHint: (n: number) => string;
  closeKeyHint: string;
  closeBtn: string;
  nextBtn: string;
  endConversation: string;
  questBadgeComplete: string;
  questBadgeQuest: string;
  questAvailableBadge: string;
  questActiveBadge: string;
  questReadyBadge: string;
  questCompletedBadge: string;
  // Notices
  statsAlreadyFull: string;
  usedItemNotice: (name: string, parts: string[]) => string;
  equippedNotice: (name: string) => string;
  unequippedNotice: (name: string) => string;
  droppedNotice: (name: string, count: number) => string;
  pickedUpNotice: (name: string, count: number) => string;
  gatheredHerbNotice: string;
  packFullNotice: string;
  cannotDropNotice: string;
  objectiveCompletePrefix: string;
  questCompletedPrefix: string;
  levelUpSuffix: (lvl: number) => string;
  readyToTurnIn: string;
  readyToComplete: string;
  availablePrefix: string;
  completedWord: string;
  enemyDefeatedNotice: (name: string, xp: number, coins: number) => string;
  playerDefeatedNotice: string;
  unarmedLabel: string;
  damageShort: string;
  cooldownShort: string;
  rangeShort: string;
  rangedTag: string;
  meleeTag: string;
  unequipShort: string;
  weaponSwitchKeyHint: string;
  // Day & Night Cycle / Clock UI
  dayLabel: string;
  timeControlsTitle: string;
  dayLengthLabel: string;
  timeSpeedLabel: string;
  pauseTimeLabel: string;
  resumeTimeLabel: string;
  presetSunrise: string;
  presetNoon: string;
  presetSunset: string;
  presetMidnight: string;
  secondsShort: string;
  minutesShort: string;
  pausedTag: string;
  // Weather System UI
  weatherControlsTitle: string;
  weatherDynamicLabel: string;
  weatherAutoOn: string;
  weatherAutoOff: string;
  weatherTransitionLabel: string;
  weatherQualityLabel: string;
  weatherQualityLow: string;
  weatherQualityMedium: string;
  weatherQualityHigh: string;
  weatherWindLabel: string;
  weatherLightningBtn: string;
  weatherTransitioningTo: (target: string) => string;
  // Save & Load System
  continueAdventure: string;
  newGame: string;
  loadGame: string;
  saveLoadTitle: string;
  quickSave: string;
  saveSlotAutosave: string;
  saveSlotManual: (n: number) => string;
  emptySlotLabel: string;
  saveBtn: string;
  overwriteBtn: string;
  loadBtn: string;
  deleteSaveBtn: string;
  confirmDeleteSave: string;
  cancelBtn: string;
  savedNotice: (slotLabel: string) => string;
  loadedNotice: (slotLabel: string) => string;
  deletedNotice: (slotLabel: string) => string;
  saveFailedNotice: string;
  loadFailedNotice: string;
  modsCompatWarningNotice: (count: number) => string;
  questsCountLabel: (completed: number, active: number) => string;
  seedLabel: string;
  playTimeLabel: string;
  saveSlotsFooterHint: string;
  // Optional AI NPC Dialogue
  aiTabStory: string;
  aiTabChat: string;
  aiToggleOn: string;
  aiToggleOff: string;
  aiStatusAvailable: string;
  aiStatusOffline: string;
  aiStatusDisabled: string;
  aiInputPlaceholder: (npcName: string) => string;
  aiSendBtn: string;
  aiThinking: (npcName: string) => string;
  aiClearHistoryBtn: string;
  aiEmptyGreeting: (npcName: string, location: string) => string;
  aiOfflineNote: string;
  aiDisabledNote: string;
  aiLocationLabel: string;
  aiFallbackTag: string;
  // Load stages
  loadInitWebgl: string;
  loadTextures: string;
  loadBiomes: string;
  loadSpawn: string;
  loadReady: string;
  // Graphics & Performance Settings
  graphicsSettingsTitle: string;
  graphicsSettingsSubtitle: string;
  graphicsPresetLabel: string;
  graphicsModeLabel: string;
  modeBalanced: string;
  modePerformance: string;
  modeQuality: string;
  tierAuto: string;
  tierVeryLow: string;
  tierLow: string;
  tierMedium: string;
  tierHigh: string;
  tierUltra: string;
  tierOff: string;
  renderScaleLabel: string;
  viewDistanceLabel: string;
  shadowQualityLabel: string;
  textureQualityLabel: string;
  vegetationDensityLabel: string;
  effectsQualityLabel: string;
  waterQualityLabel: string;
  postProcessingLabel: string;
  antiAliasingLabel: string;
  aaOff: string;
  aaFxaa: string;
  aaMsaa: string;
  fpsLimitLabel: string;
  fpsUncapped: string;
  showDebugOverlayLabel: string;
  showDebugOverlayDesc: string;
  resetGraphicsAutoBtn: string;
  hardwareProfileLabel: string;
  effectiveTierLabel: string;
  dynamicAdaptTag: string;
  deviceDesktop: string;
  deviceMobile: string;
  deviceTablet: string;
  // Debug Performance Overlay
  debugPerfTitle: string;
  debugPerfCloseHint: string;
  debugFps: string;
  debugFrameTime: string;
  debugDrawCalls: string;
  debugTriangles: string;
  debugGeometries: string;
  debugTextures: string;
  debugHeap: string;
  debugObjects: string;
  debugNpcs: string;
  debugAnimals: string;
  debugChunks: string;
  debugRenderScale: string;
  debugQuality: string;
  debugMode: string;
  debugDevice: string;
  // Main Menu & World Management
  menuSubtitle: string;
  menuNewWorld: string;
  menuContinue: string;
  menuLoadWorld: string;
  menuSettings: string;
  menuExitGame: string;
  noSavedWorldTitle: string;
  noSavedWorldDesc: string;
  createNewWorldCta: string;
  createWorldTitle: string;
  createWorldSubtitle: string;
  worldNameLabel: string;
  worldNamePlaceholder: string;
  worldNameRequiredError: string;
  worldSeedLabel: string;
  worldSeedPlaceholder: string;
  randomSeedBtn: string;
  worldTypeLabel: string;
  worldTypeNormal: string;
  worldTypeNormalDesc: string;
  worldTypeAdventure: string;
  worldTypeAdventureDesc: string;
  worldTypeSurvival: string;
  worldTypeSurvivalDesc: string;
  worldTypeCreative: string;
  worldTypeCreativeDesc: string;
  difficultyLabel: string;
  diffEasy: string;
  diffNormal: string;
  diffHard: string;
  createWorldBtn: string;
  backBtn: string;
  loadWorldTitle: string;
  loadWorldSubtitle: string;
  noWorldsFoundTitle: string;
  noWorldsFoundDesc: string;
  playWorldBtn: string;
  deleteWorldBtn: string;
  deleteWorldConfirmTitle: string;
  deleteWorldConfirmDesc: string;
  deleteBtn: string;
  lastPlayedLabel: string;
  // Settings Screen
  settingsTitle: string;
  settingsSubtitle: string;
  tabGraphics: string;
  tabAudio: string;
  tabControls: string;
  tabGameplay: string;
  tabAccessibility: string;
  applyBtn: string;
  resetBtn: string;
  settingsAppliedNotice: string;
  vsyncLabel: string;
  dynamicQualityLabel: string;
  audioSectionTitle: string;
  masterVolumeLabel: string;
  musicVolumeLabel: string;
  effectsVolumeLabel: string;
  ambientVolumeLabel: string;
  uiVolumeLabel: string;
  voiceVolumeLabel: string;
  menuMusicLabel: string;
  soundEffectsLabel: string;
  audioToggleOn: string;
  audioToggleOff: string;
  fovLabel: string;
  showFpsLabel: string;
  showHudLabel: string;
  uiScaleLabel: string;
  textSizeLabel: string;
  textSizeSmall: string;
  textSizeNormal: string;
  textSizeLarge: string;
  highContrastLabel: string;
  reducedMotionLabel: string;
  // Exit & Pause Confirmations
  exitConfirmTitle: string;
  exitConfirmDesc: string;
  webExitNoticeDesc: string;
  okBtn: string;
  pauseResume: string;
  pauseSaveWorld: string;
  pauseSettings: string;
  pauseMainMenu: string;
  pauseExitGame: string;
  unsavedMainMenuTitle: string;
  unsavedMainMenuDesc: string;
  saveAndExitBtn: string;
  discardAndExitBtn: string;
  worldAndTimeTools: string;
  // Crafting, Durability, Gathering & Sleep
  craftTab: string;
  craftBtn: string;
  craftCategoryAll: string;
  craftCategoryCamp: string;
  craftCategoryWeapon: string;
  craftCategoryTools: string;
  craftCategoryArmor: string;
  craftCategoryClothing: string;
  craftCategoryBuilding: string;
  craftCategoryMaterial: string;
  craftCategoryProvisions: string;
  craftStationHand: string;
  craftStationTable: string;
  craftStationForge: string;
  craftStationFurnace: string;
  craftStationWorkbench: string;
  craftStatusAvailable: string;
  craftStatusMissing: string;
  craftStatusLocked: string;
  craftLockStation: (stationName: string) => string;
  craftLockLevel: (lvl: number) => string;
  craftLockTool: (toolLabel: string) => string;
  craftLockPrereq: (prereqName: string) => string;
  craftLockStory: string;
  availableStationsLabel: string;
  craftDurationSec: (sec: number) => string;
  craftingInProgress: string;
  craftMaterialsNeeded: string;
  craftedNotice: (name: string, count: number) => string;
  craftedFailIngredients: string;
  sleepTransitionLabel: string;
  goodMorningNotice: string;
  cannotSleepDayNotice: string;
  bedPlacedNotice: string;
  portraitRecommendationText: string;
  portraitRecommendationDismissAria: string;
  updateAvailableTitle: string;
  updateAvailableBody: string;
  updateCurrentVersionLabel: string;
  updateNewVersionLabel: string;
  updateNowBtn: string;
  updateCloseBtn: string;
  updateDontShowAgainBtn: string;
  bedCannotPlaceNotice: string;
  placeBedBtn: string;
  placeStationBtn: string;
  stationPlacedNotice: (name: string) => string;
  stationCannotPlaceNotice: string;
  toolRequiredNotice: (toolLabel: string, resourceName: string) => string;
  toolBrokenNotice: (name: string) => string;
  durabilityShort: string;
  bonusCapacity: string;
  toolPickaxeTier1: string;
  toolPickaxeTier2: string;
  toolAxeName: string;
  toolPickaxeName: string;
  toolShovelName: string;
  toolTierLabel: (tier: number) => string;
  durabilityLabel: string;
  weaponBrokenNotice: (name: string) => string;
  weaponsRepairedNotice: (cost: number) => string;
  repairNeedCoinsNotice: (cost: number) => string;
  chestOpenedNotice: (label: string, summary: string) => string;
  harvestedResourceNotice: (name: string, count: number) => string;
  damageReductionLabel: string;
  // Stamina mode & Interactive Mini-Map / Waypoints / Fog of War
  staminaUnlimitedLabel: string;
  staminaModeBadge: (maxLabel: string) => string;
  pauseMap: string;
  miniMapOrientationLabel: string;
  miniMapNorthUp: string;
  miniMapRotating: string;
  waypointLabel: string;
  setWaypointPrompt: string;
  setWaypointBtn: string;
  removeWaypointBtn: string;
  waypointSetNotice: string;
  waypointRemovedNotice: string;
  mapLegendWaypoint: string;
  mapLegendUnexplored: string;
  // Bow & Arrow Charge System
  bowChargeLabel: string;
  bowMaxLabel: string;
  bowCancelledNotice: string;
  mobAim: string;
  mobShoot: string;
  bowPowerTitle: string;
  bowTierWeak: string;
  bowTierLow: string;
  bowTierStrong: string;
  bowTierMaximum: string;
  bowNoArrowsNotice: string;
  bowNoArrowsShort: string;
  bowHeadshotNotice: string;
  bowNpcWarningNotice: string;
  showBowTrajectoryLabel: string;
  bowCancelHint: string;
  arrowsLabel: string;
  // Procedural World Generation & Resource Nodes
  villageDiscoveredNotice: (name: string) => string;
  mapLegendResource: string;
  showWorldGenDebugLabel: string;
  // Footstep Volume, Weather Duration, Camera Perspectives & Interaction Indicator
  footstepVolumeLabel: string;
  cameraSettingsTitle: string;
  cameraPerspectiveLabel: string;
  perspectiveFirstPerson: string;
  perspectiveSecondPerson: string;
  perspectiveThirdPerson: string;
  perspectiveShort1p: string;
  perspectiveShort2p: string;
  perspectiveShort3p: string;
  cameraSensitivityLabel: string;
  cameraDistanceLabel: string;
  cameraHeightLabel: string;
  cameraSmoothingLabel: string;
  cameraInvertYLabel: string;
  indicatorOffsetTitle: string;
  indicatorOffsetXLabel: string;
  indicatorOffsetYLabel: string;
  indicatorOffsetZLabel: string;
  weatherMaxDurationLabel: string;
  btnCameraLabel: string;
  ctrlCamera: string;
  mobCamera: string;
  cameraPerspectiveNotice: (mode: CameraPerspective) => string;
  showBiomeDebugLabel: string;
  biomeDebugPrefix: string;
  // Multiplayer Menu & Lobby UI
  menuMultiplayer: string;
  mpSubtitle: string;
  mpCreateRoom: string;
  mpJoinRoom: string;
  mpQuickJoin: string;
  mpFriends: string;
  mpInvites: string;
  mpReady: string;
  mpReadyActive: string;
  mpNotReady: string;
  mpStartGame: string;
  mpLeaveRoom: string;
  mpPlayerNameLabel: string;
  mpPlayerNamePlaceholder: string;
  mpRoomNameLabel: string;
  mpRoomNamePlaceholder: string;
  mpRoomNameRequired: string;
  mpRoomCodeLabel: string;
  mpRoomCodePlaceholder: string;
  mpRoomCodeRequired: string;
  mpMaxPlayersLabel: string;
  mpPrivacyLabel: string;
  mpPrivacyPublic: string;
  mpPrivacyFriends: string;
  mpPrivacyPrivate: string;
  mpPasswordLabel: string;
  mpPasswordOptionalPlaceholder: string;
  mpRoomBrowserTitle: string;
  mpSearchRoomsPlaceholder: string;
  mpRefreshBtn: string;
  mpNoRoomsTitle: string;
  mpNoRoomsDesc: string;
  mpFriendsSubtitle: string;
  mpAddFriendPlaceholder: string;
  mpAddFriendBtn: string;
  mpNoFriendsTitle: string;
  mpNoFriendsDesc: string;
  mpInvitesSubtitle: string;
  mpNoInvitesTitle: string;
  mpNoInvitesDesc: string;
  mpAcceptBtn: string;
  mpDeclineBtn: string;
  mpInviteBtn: string;
  mpLobbyTitle: string;
  mpPlayerListTitle: string;
  mpHostLabel: string;
  mpYouLabel: string;
  mpOpenSlotLabel: string;
  mpCopyCodeBtn: string;
  mpCodeCopiedNotice: string;
  mpPlayersCount: (current: number, max: number) => string;
  mpServerStatusDisconnected: string;
  mpServerNoticeBanner: string;
  mpQuickJoinUnavailable: string;
  mpJoinRequiresBackend: string;
  mpStartRequiresBackend: string;
  mpFriendActionRequiresBackend: string;
  mpLocalLobbyPreviewNotice: string;
  mpGameModeLabel: string;
  mpPrivateRoomLabel: string;
  mpAllowFriendsLabel: string;
  mpToggleOn: string;
  mpToggleOff: string;
  mpRoomLabel: string;
  mpPlayersShort: (current: number, max: number) => string;
  mpInviteFriends: string;
  mpKickPlayer: string;
  mpCloseRoom: string;
  mpRoomLockedLabel: string;
  mpCreatingRoom: string;
  mpStartingGame: string;
  mpServerStatusConnected: string;
  mpBackendRequiredForCreate: string;
  mpNotConfiguredTitle: string;
  mpNotConfiguredHint: string;
  mpStatusConnecting: string;
  mpStatusConnected: string;
  mpStatusDisconnected: string;
  mpStatusServerUnavailable: string;
  mpStatusReconnecting: string;
  mpHostTransferredNotice: (newHostName: string) => string;
  mpKickedNotice: string;
  mpPlayerKickedNotice: (name: string) => string;
  mpRoomClosedNotice: string;
  mpStartingWorldNotice: (roomCode: string, modeLabel: string) => string;
  // Multiplayer Invitations & Verification Errors
  mpEnterRoomCodeLabel: string;
  mpRoomLinkLabel: string;
  mpCopyLinkBtn: string;
  mpShareBtn: string;
  mpLinkCopiedNotice: string;
  mpInviteFriendsSubtitle: string;
  mpInviteTargetPlaceholder: string;
  mpSendInviteBtn: string;
  mpInviteSentNotice: (name: string) => string;
  mpInvitedToPlayNotification: (name: string) => string;
  mpErrorRoomNotFound: string;
  mpErrorRoomFull: string;
  mpErrorGameAlreadyStarted: string;
  mpErrorUnableToConnect: string;
  mpErrorRoomCreationFailed: string;
  mpVerifyingRoom: string;
  mpRemoveFriendBtn: string;
  // Multiplayer Lobby Extensions (Connection Quality, Ready Policy, Host Transfer, Authoritative World)
  mpRequireAllReadyLabel: string;
  mpTransferHost: string;
  mpConnectionQualityLabel: string;
  mpQualityExcellent: string;
  mpQualityGood: string;
  mpQualityPoor: string;
  mpQualityDisconnected: string;
  mpPingUnit: string;
  mpWaitingForReadyHint: (ready: number, total: number) => string;
  mpWorldSeedLabel: string;
  mpAuthoritativeConfigBadge: string;
  // Multiplayer Room Chat, Player Interaction Menu, Moderation & Reporting
  mpRoomChatTitle: string;
  mpRoomChatOpenBtn: string;
  mpRoomChatPlaceholder: string;
  mpRoomChatSendBtn: string;
  mpRoomChatEmpty: string;
  mpRoomChatSpamNotice: string;
  mpRoomChatDuplicateNotice: string;
  mpRoomChatTooLongNotice: (max: number) => string;
  mpRoomChatDisconnectedNotice: string;
  mpRoomChatMutedSuppressed: (count: number) => string;
  mpRoomChatTabsChat: string;
  mpRoomChatTabsPlayers: string;
  mpActionViewProfile: string;
  mpActionInvite: string;
  mpActionMute: string;
  mpActionUnmute: string;
  mpActionBlock: string;
  mpActionUnblock: string;
  mpActionReport: string;
  mpActionAddFriend: string;
  mpActionRemoveFriend: string;
  mpBadgeMuted: string;
  mpBadgeBlocked: string;
  mpBadgeFriend: string;
  mpProfileTitle: string;
  mpProfileRoleLabel: string;
  mpProfileRoleHost: string;
  mpProfileRolePlayer: string;
  mpProfileStatusLabel: string;
  mpProfileHealthLabel: string;
  mpProfileJoinedAtLabel: string;
  mpProfileLocalSocialNote: string;
  mpPlayerMutedNotice: (name: string) => string;
  mpPlayerUnmutedNotice: (name: string) => string;
  mpPlayerBlockedNotice: (name: string) => string;
  mpPlayerUnblockedNotice: (name: string) => string;
  mpFriendAddedNotice: (name: string) => string;
  mpReportTitle: string;
  mpReportSubtitle: (name: string) => string;
  mpReportReasonLabel: string;
  mpReportReasonSpam: string;
  mpReportReasonHarassment: string;
  mpReportReasonCheating: string;
  mpReportReasonInappropriateName: string;
  mpReportReasonInappropriateProfile: string;
  mpReportReasonOther: string;
  mpReportDetailsLabel: string;
  mpReportDetailsPlaceholder: string;
  mpReportSubmitBtn: string;
  mpReportSubmittedNotice: (name: string) => string;
  mpReportDuplicateNotice: string;
  // Multiplayer Connection Resilience & Reconnect
  mpConnectionLostTitle: string;
  mpReconnectingSubtitle: string;
  mpReconnectAttemptLabel: (attempt: number, max: number) => string;
  mpReconnectFailedTitle: string;
  mpReconnectFailedDesc: string;
  mpRetryConnectionBtn: string;
  mpReturnToMenuBtn: string;
  mpRoomClosedReturnNotice: string;
  mpOfflineCannotConnectNotice: string;
  // Player Profile & Identity System
  showPlayerNamesLabel: string;
  profileCreateTitle: string;
  profileCreateSubtitle: string;
  profilePictureLabel: string;
  profileSelectAvatarTitle: string;
  profilePresetsTab: string;
  profileGeneratedTab: string;
  profileUploadTab: string;
  profileChooseFileBtn: string;
  profileUploadHint: string;
  profileUploadTooLargeErr: string;
  profileUploadInvalidFormatErr: string;
  profileUploadDecodeErr: string;
  profileAvatarSavedBtn: string;
  profileChangeAvatarBtn: string;
  profilePlayerNameLabel: string;
  profilePlayerNameHint: string;
  profilePlayerIdLabel: string;
  profilePermanentBadge: string;
  profileIdImmutableNote: string;
  profilePlayerTagLabel: string;
  profileBioLabel: string;
  profileBioPlaceholder: string;
  profileCountryLabel: string;
  profileCountryPlaceholder: string;
  profileFavoriteModeLabel: string;
  profileStatusLabel: string;
  profileStatusOnline: string;
  profileStatusInGame: string;
  profileStatusAway: string;
  profileStatusOffline: string;
  profileCreateSubmitBtn: string;
  profileSavingBtn: string;
  profileEditBtn: string;
  profileSaveBtn: string;
  profileCancelEditBtn: string;
  profileStatisticsTitle: string;
  profileStatLevel: string;
  profileStatExperience: string;
  profileStatPlayTime: string;
  profileStatWorldsCreated: string;
  profileStatWorldsJoined: string;
  profileStatQuestsCompleted: string;
  profileStatEnemiesDefeated: string;
  profileStatAnimalsDefeated: string;
  profileStatVillagesDiscovered: string;
  profileStatResourcesCollected: string;
  profileStatDistanceTraveled: string;
  profilePrivacyTitle: string;
  profilePrivacyShowOnline: string;
  profilePrivacyShowNames: string;
  profilePrivacyAllowFriends: string;
  profilePrivacyAllowInvites: string;
  profilePrivacyAllowMessages: string;
  profileMsgPrivacyEveryone: string;
  profileMsgPrivacyFriends: string;
  profileMsgPrivacyNobody: string;
  profileBlockedPlayersTitle: string;
  profileCopyIdBtn: string;
  profileIdCopiedNotice: string;
  profileSearchPlayerTitle: string;
  profileSearchPlayerPlaceholder: string;
  profileSearchBtn: string;
  profileNoSearchResults: string;
  profileFriendRequestsIncoming: string;
  profileFriendRequestsOutgoing: string;
  profileSendFriendRequestBtn: string;
  profileCancelRequestBtn: string;
  profilePendingRequestBadge: string;
  profileDirectMessageBtn: string;
  profileDirectMessagesTitle: string;
  profileDmPlaceholder: string;
  profileDmEmpty: string;
  profileDmUnavailable: string;
  profileViewFullProfileBtn: string;
  profileOpenBtn: string;
  profileInviteToastText: (name: string, tag: string, roomName: string) => string;
  profileFriendsCategoryOnline: string;
  profileFriendsCategoryInGame: string;
  profileFriendsCategoryOffline: string;
  profilePagePrev: string;
  profilePageNext: string;
  mapLegendFriend: string;
  mapLegendRoomPlayer: string;
  showFriendsOnMapLabel: string;
  mpWorldSettingsPermissionLabel: string;
  mpWorldSettingsHostOnly: string;
  mpWorldSettingsAllPlayers: string;
  mpWorldSettingsHostOnlyNotice: string;
  mpErrorRoomExpired: string;
  showPartyMembersOnMapLabel: string;
  mapLegendPartyMember: string;
  mapLegendCoopObjective: string;
  partyTitle: string;
  partySubtitle: string;
  partyBtnLabel: string;
  partyCreateBtn: string;
  partyLeaveBtn: string;
  partyNoPartyTitle: string;
  partyNoPartyDesc: string;
  partyLeaderBadge: string;
  partyMemberTag: string;
  partyMembersCount: (count: number, max: number) => string;
  partyReadyBtn: string;
  partyReadyActive: string;
  partyNotReady: string;
  partyKickBtn: string;
  partyTransferLeaderBtn: string;
  partyInviteTitle: string;
  partyInviteBtn: string;
  partyInvitedBadge: string;
  partyPendingInvitesTitle: string;
  partyInviteReceivedNotice: (fromName: string) => string;
  partyCreatedNotice: string;
  partyJoinedNotice: string;
  partyLeftNotice: string;
  partyLeaderTransferredNotice: (name: string) => string;
  partyDuplicateInviteNotice: string;
  partyFullNotice: string;
  partyFriendlyFireLabel: string;
  partyFriendlyFireOnDesc: string;
  partyFriendlyFireOffDesc: string;
  partyFriendlyFireBlockedNotice: string;
  partyDistanceMeters: (m: number) => string;
  coopObjectiveTitle: string;
  coopObjectiveStartBtn: string;
  coopObjectiveCancelBtn: string;
  coopObjectiveLeaderOnlyHint: string;
  coopObjectiveActiveLabel: string;
  coopObjectiveCompletedNotice: (title: string, xp: number, coins: number) => string;
  coopObjectiveStartedNotice: (title: string) => string;
  coopObjectiveNoneActive: string;
  coopTypeKillBoss: string;
  coopTypeProtectVillage: string;
  coopTypeCollectResources: string;
  coopTypeEscortNpc: string;
  coopTypeExploreLocation: string;
  coopTypeOpenDungeon: string;
  questScopePersonal: string;
  questScopeCoop: string;
  questStartCoopBtn: string;
  questClaimRewardBtn: string;
  questCoopActiveHint: string;
  questCoopContributors: (count: number) => string;
  coopQuestsSectionTitle: string;
  bossTargetLabel: (name: string) => string;
  bossPhaseLabel: (phase: number) => string;
  bossStateLabel: (state: string) => string;
  lootGrantedNotice: (summary: string) => string;
  coopQuestStartedNotice: (title: string) => string;
  coopQuestCompletedNotice: (title: string) => string;
  // Main Story Campaign
  tabStory: (done: number, total: number) => string;
  storyCampaignTitle: string;
  storyChapterProgress: (current: number, total: number) => string;
  storyActiveQuestLabel: string;
  storyNextObjectiveLabel: string;
  storyCompletedCampaignTitle: string;
  storyCompletedCampaignDesc: string;
  storyStartQuestBtn: string;
  storyRetryQuestBtn: string;
  storyCompleteFallbackHint: string;
  storyStateLabels: Record<
    'LOCKED' | 'AVAILABLE' | 'ACTIVE' | 'OBJECTIVE_COMPLETED' | 'COMPLETED' | 'FAILED',
    string
  >;
  storyQuestStartedNotice: (title: string) => string;
  storyQuestFailedNotice: (title: string) => string;
  storyRescuedNotice: (name: string) => string;
  storyRescueActionVerb: string;
  mapLegendStoryObjective: string;
  // Side Quests System
  mapLegendSideQuestAvailable: string;
  mapLegendSideQuestActive: string;
  mapLegendSideQuestTurnin: string;
  sideQuestAcceptedNotice: (title: string) => string;
  sideQuestAbandonedNotice: (title: string) => string;
  sideQuestFailedNotice: (title: string) => string;
  sideQuestExpiredNotice: (title: string) => string;
  sideQuestMissingItemsNotice: string;
  sideQuestReadyNotice: (title: string) => string;
  tabSideQuests: (done: number, total: number) => string;
  sideQuestsSectionTitle: string;
  sideQuestsSubtitle: string;
  sideQuestReputationLabel: string;
  sideQuestAcceptBtn: string;
  sideQuestAbandonBtn: string;
  sideQuestRetryBtn: string;
  sideQuestRepeatableBadge: string;
  sideQuestTimedBadge: (hours: number) => string;
  sideQuestCooldownBadge: (sec: number) => string;
  sideQuestGiverLabel: string;
  sideQuestLocationLabel: string;
  sideQuestLevelReqBadge: (lvl: number) => string;
  sideQuestNightOnlyBadge: string;
  sideQuestCompletedCountBadge: (count: number) => string;
  sideQuestFilterAll: string;
  sideQuestGroupActive: string;
  sideQuestGroupAvailable: string;
  sideQuestGroupFailed: string;
  sideQuestGroupLocked: string;
  sideQuestGroupCompleted: string;
  sideQuestEmptyNotice: string;
  sideQuestStateLabels: Record<SideQuestState, string>;
  sideQuestCategoryLabels: Record<SideQuestCategory, string>;
  // Building & Construction System
  buildModeTitle: string;
  buildModeBtn: string;
  buildManageBtn: string;
  buildExitBtn: string;
  buildPlaceBtn: string;
  buildRotateLeftBtn: string;
  buildRotateRightBtn: string;
  buildSnapLabel: string;
  buildSnapOn: string;
  buildSnapOff: string;
  buildSnappedBadge: string;
  buildNudgeForward: string;
  buildNudgeBack: string;
  buildNudgeLeft: string;
  buildNudgeRight: string;
  buildValidPlacement: string;
  buildInvalidPlacement: string;
  buildCreativeFreeTag: string;
  buildRequiredMaterials: string;
  buildMissingMaterialsNotice: string;
  buildPlacedNotice: (name: string) => string;
  buildInvalidNotice: (reasonLabel: string) => string;
  buildPermissionDeniedNotice: string;
  buildReasonLabels: Record<PlacementValidationReason, string>;
  buildStorageTitle: string;
  buildStorageCapacityLabel: (used: number, max: number) => string;
  buildStorageBackpack: string;
  buildStorageVault: string;
  buildStorageEmpty: string;
  buildStorageDepositBtn: string;
  buildStorageWithdrawBtn: string;
  buildStorageAllBtn: string;
  buildStorageFullNotice: string;
  buildManageTitle: string;
  buildManageOwnerLabel: string;
  buildManageHealthLabel: string;
  buildManageRepairBtn: string;
  buildManageRepairedNotice: string;
  buildManageUpgradeBtn: (nextName: string) => string;
  buildManageUpgradedNotice: (nextName: string) => string;
  buildManagePermLabel: string;
  buildPermLabels: Record<BuildingPermissionScope, string>;
  buildManageDemolishBtn: string;
  buildManageDemolishConfirm: string;
  buildManageDemolishCancel: string;
  buildManageDemolishRefundHint: string;
  buildManageDemolishNotEmpty: string;
  buildDemolishedNotice: string;
  buildFarmGrowingNotice: (pct: number) => string;
  buildFarmHarvestedNotice: (count: number) => string;
  buildControlsHint: string;
  buildDefaultPermLabel: string;
  // Farming, Animals, Village Development & Trade
  farmPlotTitle: string;
  farmSoilReady: string;
  farmSoilUntilled: string;
  farmWateredStatus: (pct: number) => string;
  farmWateredRainBadge: string;
  farmWateredTroughBadge: string;
  farmTillSoilBtn: string;
  farmPlantSeedBtn: (seedName: string) => string;
  farmWaterCropBtn: string;
  farmWaterNeedsSourceHint: string;
  farmWateredBonusNotice: string;
  farmHarvestBtn: string;
  farmNoSeedsHint: string;
  farmSeedLabel: string;
  farmGrowthHoursLabel: (hours: number) => string;
  farmYieldLabel: (count: number) => string;
  farmStageLabel: (stage: number) => string;
  farmCropProgressLabel: (cropName: string, pct: number) => string;
  farmTilledNotice: string;
  farmPlantedNotice: (cropName: string) => string;
  farmWateredNotice: string;
  farmCropHarvestedNotice: (cropName: string, count: number, seedName: string, seedCount: number) => string;
  farmAnimalCollectedNotice: (animalName: string, itemName: string, count: number) => string;
  farmAnimalFedNotice: (animalName: string, hoursLeft: number) => string;
  farmAnimalRestingNotice: (animalName: string, hoursLeft: number) => string;
  farmFoundSeedNotice: (seedName: string) => string;
  dialogueOpenMarketBtn: string;
  dialogueOpenVillageDevBtn: string;
  villageDevTitle: string;
  villageLevelBadge: (lvl: number) => string;
  villageReputationLabel: string;
  villageRepDiscountHint: (discountPct: number, sellBonusPct: number) => string;
  villageRepairsTitle: string;
  villageProjectsTitle: string;
  villagePerksTitle: string;
  villageNoPerksYet: string;
  villageRepairDoneBtn: string;
  villageRepairCompletedBadge: string;
  villageProjectBuildBtn: string;
  villageProjectCompletedBadge: string;
  villageProjectLockedBadge: (minLevel: number) => string;
  villageDefenseTitle: string;
  villageDefenseDesc: string;
  villageDefenseStartBtn: string;
  villageDefenseActiveBadge: (remaining: number) => string;
  villageDefenseStartedNotice: (villageName: string, count: number) => string;
  villageDefenseProgressNotice: (remaining: number) => string;
  villageDefenseWonNotice: (villageName: string) => string;
  villageUpgradeLevelNotice: (villageName: string, level: number) => string;
  villageRepairSuccessNotice: (name: string) => string;
  villageProjectSuccessNotice: (name: string) => string;
  merchantTradeTitle: string;
  merchantBuyTab: string;
  merchantSellTab: string;
  merchantBuyBtn: string;
  merchantSellOneBtn: string;
  merchantSellAllBtn: string;
  merchantLockedLevel: (minLevel: number) => string;
  merchantRequiresPenHint: string;
  merchantHasPenHint: string;
  merchantEmptySellHint: string;
  merchantNotEnoughCoinsNotice: string;
  merchantBoughtNotice: (name: string, coins: number) => string;
  merchantBoughtAnimalNotice: (speciesName: string) => string;
  merchantSoldNotice: (name: string, count: number, coins: number) => string;
  // Persistent World & Offline LAN Saved World Hosting
  hostLanBtn: string;
  lanWorldSourceNew: string;
  lanWorldSourceSaved: string;
  lanSelectSavedWorld: string;
  lanNoSavedWorldsHint: string;
  lanSavedWorldHostNote: string;
  // Android Visible Shared Storage Status
  androidStorageTitle: string;
  androidStorageStateInitialized: string;
  androidStorageStateAvailable: string;
  androidStorageStatePermissionRequired: string;
  androidStorageStateNotAccessible: string;
  androidStorageGrantBtn: string;
  androidStorageChooseFolderBtn: string;
  androidStoragePermHint: string;
  // Local Mods System
  menuMods: string;
  tabMods: string;
  modsTitle: string;
  modsSubtitle: string;
  modsFolderLabel: string;
  modsOpenFolderBtn: string;
  modsRefreshBtn: string;
  modsImportBtn: string;
  modsDiscoveredLabel: string;
  modsActiveLabel: string;
  modsIssuesLabel: string;
  modsEmptyTitle: string;
  modsEmptyHint: string;
  modsEmptyStructureHint: string;
  modsStatusReady: string;
  modsStatusDisabled: string;
  modsStatusIncompatible: string;
  modsStatusMissingDep: string;
  modsStatusDepDisabled: string;
  modsStatusCircularDep: string;
  modsStatusDuplicate: string;
  modsStatusCorrupted: string;
  modsStatusIncomplete: string;
  modsStatusUnsafe: string;
  modsEnableBtn: string;
  modsDisableBtn: string;
  modsRemoveBtn: string;
  modsRemoveConfirmTitle: string;
  modsRemoveConfirmDesc: (name: string) => string;
  modsRemoveConfirmYes: string;
  modsByAuthor: (author: string) => string;
  modsPriorityLabel: string;
  modsDependenciesLabel: string;
  modsFoldersCoverageLabel: (present: number, total: number) => string;
  modsContentAssetsLabel: (contentCount: number, assetCount: number) => string;
  modsLogsTitle: string;
  modsLogsShowBtn: string;
  modsLogsHideBtn: string;
  modsLogsClearBtn: string;
  modsLogsEmpty: string;
  modsInstantSaveNote: string;
  modsImportSuccessNotice: (name: string) => string;
  modsImportErrorNotice: (err: string) => string;
  modsReloadBtn: string;
  modsReloadSuccessNotice: (activeCount: number, issueCount: number) => string;
  modsViewDetailsBtn: string;
  modsFilterInstalled: string;
  modsFilterEnabled: string;
  modsFilterDisabled: string;
  modsFilterEmptyTitle: string;
  modsFilterEmptyHint: string;
  modsCompatibilityLabel: string;
  modsCompatibleBadge: string;
  modsUnsupportedVersionBadge: string;
  modsModIdLabel: string;
  modsVersionLabel: string;
  modsAuthorLabel: string;
  modsDescriptionLabel: string;
  modsNoDescription: string;
  modsSupportedGameVersionLabel: string;
  modsLoadOrderLabel: string;
  modsNoDependencies: string;
  modsErrorWarningTitle: string;
  modsNoErrorsOrWarnings: string;
  modsSourcePathLabel: string;
  modsContentFilesLabel: string;
  modsAssetsFilesLabel: string;
  modsIncompatibleAssetsLabel: string;
  modsFoldersLabel: string;
  modsCloseDetailsBtn: string;
  modsClearSummaryInvalidMod: string;
  modsClearSummaryUnsupportedVersion: (required: string, current: string) => string;
  modsClearSummaryMissingDep: string;
  modsClearSummaryDuplicateId: string;
  modsClearSummaryCorruptedPackage: string;
  modsClearSummaryIncompatibleAsset: (count: number) => string;
  modsErrorInvalidPackageName: string;
  modsErrorInvalidPackageSize: string;
  modsErrorCorruptPackage: string;
  modsErrorPermissionRequired: string;
  modsKindDevelopment: string;
  modsKindWoamod: string;
  modsOriginLabel: string;
  modsPackageFileLabel: string;
  modsInstalledAtLabel: string;
  modsDevBadgeHint: string;
  modsInstallProgressTitle: string;
  modsStageReading: string;
  modsStageValidating: string;
  modsStageExtracting: string;
  modsStageFinalizing: string;
  modsStageCleaningUp: string;
  modsStageCompleted: string;
  modsStageFailed: string;
  modsInstallEntriesLabel: (done: number, total: number) => string;
  modsErrorPathTraversal: string;
  modsErrorUnsafeExecutable: string;
  modsErrorRequiredFilesMissing: string;
  modsErrorUnsupportedVersion: string;
  modsErrorDuplicateModId: string;
  modsErrorMissingDependency: string;
  modsErrorDepMismatch: string;
  modsErrorTargetExists: string;
  worldModsSectionTitle: string;
  worldModsModeVanilla: string;
  worldModsModeVanillaDesc: string;
  worldModsModeModded: string;
  worldModsModeModdedDesc: string;
  worldModsEmptyInstalledHint: string;
  worldModsEnableAllBtn: string;
  worldModsClearAllBtn: string;
  worldModsMoveUp: string;
  worldModsMoveDown: string;
  worldBadgeVanilla: string;
  worldBadgeModded: (count: number) => string;
  worldRecoveryTitle: string;
  worldRecoverySubtitle: (worldName: string) => string;
  worldRecoveryWarningBanner: string;
  worldRecoveryResolvedBanner: string;
  worldRecoveryStatusMissing: string;
  worldRecoveryStatusVersionChanged: (saved: string, installed: string) => string;
  worldRecoveryStatusIncompatible: string;
  worldRecoveryStatusReady: string;
  worldRecoveryStatusDisabledWorld: string;
  worldRecoveryStatusDisabledGlobally: string;
  worldRecoverySavedVersion: (v: string) => string;
  worldRecoveryInstalledVersion: (v: string) => string;
  worldRecoveryOrphanedTitle: string;
  worldRecoveryOrphanedDesc: (
    items: number,
    quests: number,
    buildings: number,
    recipes: number,
  ) => string;
  worldRecoveryManageModsBtn: string;
  worldRecoveryRefreshBtn: string;
  worldRecoverySaveConfigBtn: string;
  worldRecoveryConfigSavedNotice: string;
  worldRecoveryEnterSafeBtn: string;
  worldRecoverySafeModeDesc: string;
  worldRecoveryLoadAnywayBtn: string;
  worldRecoveryRemoveMissingBtn: string;
  modsSafeRecoveryEnteredNotice: string;
  modsSafeRecoveryReadOnlyNotice: string;
  hudSafeRecoveryBadge: string;
  // Multiplayer Mod Compatibility Verification
  mpModCompatMismatchTitle: string;
  mpModsVanillaBadge: string;
  mpModsRequiredCountBadge: (count: number) => string;
  mpModCompatOkBadge: string;
  mpModCompatBlockedHint: string;
  mpModPresetAppliedNotice: string;
  mpRefreshModsBtn: string;
  mpMatchRoomModsBtn: string;
  mpHostRequiredModsLabel: string;
  mpModIssueMissing: string;
  mpModIssueDisabled: string;
  mpModIssueVersionMismatch: string;
  mpModIssueApiMismatch: string;
  mpModIssueExtraActive: string;
  mpModIssueMissingDependency: string;
  mpModIssueUnsupported: string;
  mpModHostSavedMismatchHint: string;
  mpModExpectedLabel: (version: string) => string;
  mpModLocalLabel: (version: string) => string;
  mpDismissBtn: string;
  mpLanModStatusTitle: string;
  mpLanRequiredModsTitle: string;
  mpLanCompatiblePlayersTitle: string;
  mpLanIncompatiblePlayersTitle: string;
  mpLanNoIncompatiblePlayers: string;
  mpLanVanillaNoMods: string;
  // Mod World Spawn Diagnostics
  modsSpawnDiagnosticsTitle: string;
  modsNoSpawnRules: string;
  modsSpawnConfiguredLabel: string;
  modsSpawnResolvedLabel: string;
  modsSpawnModeLabel: string;
  modsSpawnChunkLabel: string;
  modsSpawnInstancesLabel: string;
  modsSpawnMenuPreviewHint: string;
  modsSpawnStatusLabel: (status: string) => string;
  modsSpawnAutoY: string;
  modsSpawnRotationLabel: string;
  modsSpawnScaleLabel: string;
  modsSpawnAlreadySpawnedLabel: string;
  modsSpawnSavedLabel: string;
  modsSpawnYesLabel: string;
  modsSpawnNoLabel: string;
}

export const UI_TEXT: Record<Language, UiStrings> = {
  en: {
    gameTitle: 'World of Adventure',
    openWorldSubtitle: 'Open-World 3D Valley',
    heroTagline:
      'Roam sunlit emerald ridges, weave through pine and oak groves, and explore Oakhollow Village across a living WebGL valley.',
    startAdventure: 'Start Adventure',
    titleControlsHint:
      'WASD Move · Mouse Look · Space Jump · Shift Sprint · I Inventory · Esc Pause',
    titleTouchControlsHint:
      'Left Joystick Move · Drag Right Side Camera · Tap Jump, Hit & Interact',
    soundOn: 'Sound On',
    soundOff: 'Sound Off',
    audioOn: 'Audio On',
    muted: 'Muted',
    languageLabel: 'Language',
    loadingDefault: 'Preparing world...',
    health: 'Health',
    stamina: 'Stamina',
    waterSuffix: 'Water',
    levelShort: 'Lv.',
    xpShort: 'XP',
    pressEPrefix: 'Press',
    pressEMiddle: 'to',
    desktopHint:
      'Click world to lock mouse · Drag to orbit · E Interact · I Inventory · J Quests · F Hit · Esc Pause',
    gamePaused: 'Game Paused',
    resumeAdventure: 'Resume Adventure',
    returnToSpawn: 'Return to Valley Spawn',
    mobileTouchSettings: 'Mobile Touch Settings',
    activeStatus: 'Active',
    desktopStatus: 'Desktop',
    mouseSensitivity: 'Mouse Sensitivity',
    invertMouseY: 'Invert Mouse Y-Axis',
    controlsMove: 'Move',
    controlsCamera: 'Camera',
    controlsJump: 'Jump',
    controlsSprint: 'Sprint',
    controlsInteract: 'Interact',
    controlsAttack: 'Attack',
    controlsPackMap: 'Pack / Quests / Map',
    controlsPause: 'Pause',
    mouseWord: 'Mouse',
    clickWord: 'F / Click',
    touchDetected: 'Touch device detected',
    desktopPreviewHint: 'Desktop mode · Toggle preview below',
    reset: 'Reset',
    forceMobileControls: 'Force Mobile Controls on Desktop',
    forceMobileDesc: 'Preview and test touch controls with a mouse',
    joystickSize: 'Joystick Size',
    buttonSize: 'Button Size',
    controlOpacity: 'Button & Joystick Opacity',
    touchCamSensitivity: 'Touch Camera Sensitivity',
    invertTouchY: 'Invert Touch Camera Y-Axis',
    visibleTouchButtons: 'Visible Touch Buttons',
    done: 'Done',
    btnJumpLabel: 'Jump Button',
    btnAttackLabel: 'Attack Button',
    btnInteractLabel: 'Interact Button',
    btnInventoryLabel: 'Inventory Button',
    btnMapLabel: 'Map Button',
    btnPauseLabel: 'Pause Button',
    btnQuestsLabel: 'Quests Button',
    customizeControls: 'Customize Controls',
    customizeBannerHint: 'Drag to move · Use corner handle to resize',
    customizeDone: 'DONE',
    customizeReset: 'RESET',
    resetControlsBtn: 'Reset Controls',
    resetPortraitControls: 'RESET PORTRAIT CONTROLS',
    resetLandscapeControls: 'RESET LANDSCAPE CONTROLS',
    resetAllControls: 'Reset Both Layouts',
    resetConfirmTitle: 'Reset control layout positions to defaults?',
    resetConfirmYes: 'Reset',
    resetConfirmCancel: 'Cancel',
    miniMapTitle: 'Mini-Map',
    sprintActiveHint: 'Outer Ring: Sprint',
    saveSettingsBtn: 'Save Settings',
    settingsSavedNotice: 'Mobile control settings saved.',
    enableTouchControls: 'Enable Touch Controls',
    touchOn: 'ON',
    touchOff: 'OFF',
    controlSizeLabel: 'Control Size',
    sizeSmall: 'Small',
    sizeMedium: 'Medium',
    sizeLarge: 'Large',
    portraitCameraTitle: 'Portrait Camera',
    portraitAutoAdapt: 'Auto-Adapt Portrait FOV & Distance',
    portraitFovComfort: 'Portrait View Comfort',
    fullscreenEnter: 'Fullscreen',
    fullscreenExit: 'Exit Fullscreen',
    selectedControlLabel: 'Selected',
    controlSizePx: 'Size',
    controlPosPct: 'Pos',
    showControlBtn: 'Show',
    hideControlBtn: 'Hide',
    hiddenTag: 'Hidden',
    portraitModeLabel: 'Portrait',
    landscapeModeLabel: 'Landscape',
    ctrlJoystick: 'Joystick',
    ctrlDpad: 'D-Pad',
    movementControlsLabel: 'Movement Controls',
    movementModeJoystick: 'Joystick',
    movementModeDpad: 'D-Pad',
    optionSelectedBadge: 'SELECTED',
    optionSelectBadge: 'SELECT',
    dpadUpLabel: 'Move Forward',
    dpadDownLabel: 'Move Backward',
    dpadLeftLabel: 'Move Left',
    dpadRightLabel: 'Move Right',
    ctrlSprint: 'Sprint',
    ctrlJump: 'Jump',
    ctrlAttack: 'Attack',
    ctrlInteract: 'Interact',
    ctrlInventory: 'Inventory',
    ctrlMap: 'Map',
    ctrlPause: 'Pause',
    ctrlQuests: 'Quests',
    mobQuests: 'Quests',
    mobPack: 'Pack',
    mobMap: 'Map',
    mobHit: 'Hit',
    mobJump: 'Jump',
    mobSprint: 'Sprint',
    explorerPack: 'Explorer Pack',
    slotsUsed: 'slots used',
    equippedGear: 'Equipped Gear',
    noEquippedSlot: 'Empty',
    selectItemHint: 'Select any item slot to inspect, use, equip, or drop it.',
    useItem: 'Use Item',
    equipItem: 'Equip',
    unequipItem: 'Unequip',
    dropItem: 'Drop',
    questItemLocked: 'Quest & essential tools stay safely in your pack.',
    toolItemLocked: 'Essential explorer gear cannot be dropped.',
    stackLabel: 'Stack',
    bonusMaxHp: 'Max Health',
    bonusMaxStam: 'Max Stamina',
    bonusSpeed: 'Move Speed',
    villageQuests: 'Village Quests',
    emptyCategory: 'No items in this category yet.',
    inventoryFooterHint:
      'Press I to toggle Pack · Speak with villagers or explore the valley to find more items.',
    worldMap: 'World Map',
    positionLabel: 'Position',
    northMountains: 'N · Mountains',
    southCoastline: 'S · Coastline',
    whiteArrowLegend: 'White Arrow: Explorer',
    goldDotsLegend: 'Gold Dots: Landmarks',
    mapVillageName: 'Oakhollow Village',
    mapVillageSubtitle: 'Central Square & Services',
    mapVillageServiceTag: 'Village Service',
    mapDiscoveredTag: 'Discovered Landmark',
    mapUndiscoveredTag: 'Unexplored Landmark',
    mapRegionLake: 'Whispering Lake',
    mapRegionDesert: 'Sunstone Desert',
    mapRegionMountains: 'Northern Peaks',
    mapRegionCoast: 'Golden Coastline',
    mapHerbPatchName: 'Meadow Herb Patch',
    mapCenterPlayer: 'Center on Player',
    mapResetView: 'Reset View',
    mapZoomIn: 'Zoom In',
    mapZoomOut: 'Zoom Out',
    mapLegendTitle: 'Map Legend',
    mapLegendPlayer: 'Player & Direction',
    mapLegendVillage: 'Village & Services',
    mapLegendQuestActive: 'Active Quest Objective',
    mapLegendQuestTurnin: 'Ready to Turn In (?)',
    mapLegendQuestAvailable: 'Available Quest (!)',
    mapLegendLocation: 'Important Locations',
    mapLegendHerb: 'Meadow Herbs',
    mapHintControls:
      'Drag to Pan · Scroll / + - to Zoom · WASD Pan · C Center · M / Esc Close',
    mapDistanceAway: (meters) => `${meters}m away`,
    mapFocusMarker: 'Focus',
    mapSelectHint: 'Click any marker for details or toggle categories in the legend.',
    mapShowLegend: 'Legend',
    mapHideLegend: 'Hide Legend',
    questJournal: 'Quest Journal',
    levelAdventurer: (lvl) => `Level ${lvl} Adventurer`,
    coinsLabel: 'Coins',
    tabActive: (n) => `Active (${n})`,
    tabCompleted: (n) => `Completed (${n})`,
    tabAvailable: (n) => `Available (${n})`,
    emptyActiveQuests:
      'No active quests yet. Speak with villagers in Oakhollow Square to pick up quests!',
    emptyCompletedQuests:
      'No quests completed yet. Complete objectives and return to quest givers to earn XP & coins.',
    emptyAvailableQuests:
      'You have accepted or completed every quest currently posted in Oakhollow!',
    trackedBtn: 'Tracked',
    trackHudBtn: 'Track on HUD',
    rewardLabel: 'Reward:',
    lineOf: (idx, total) => `Line ${idx} of ${total}`,
    nextLineHint: 'Press Enter / Space / E for Next',
    chooseKeyHint: (n) => `Keys 1–${n} or ↑↓ + Enter`,
    closeKeyHint: 'Press Enter / Esc to Close',
    closeBtn: 'Close',
    nextBtn: 'Next',
    endConversation: 'End Conversation',
    questBadgeComplete: 'Complete',
    questBadgeQuest: 'Quest',
    questAvailableBadge: 'Quest Available',
    questActiveBadge: 'Quest Active',
    questReadyBadge: 'Ready to Turn In',
    questCompletedBadge: 'Quest Completed',
    statsAlreadyFull: 'Health and stamina are already full.',
    usedItemNotice: (name, parts) => `Used ${name} (${parts.join(', ')}).`,
    equippedNotice: (name) => `Equipped ${name}.`,
    unequippedNotice: (name) => `Unequipped ${name}.`,
    droppedNotice: (name, count) =>
      `Dropped ${name}${count > 1 ? ` ×${count}` : ''} onto the ground.`,
    pickedUpNotice: (name, count) =>
      `Picked up ${name}${count > 1 ? ` ×${count}` : ''}.`,
    gatheredHerbNotice: 'Gathered Meadow Herb (+15 Health, added to Explorer Pack).',
    packFullNotice: 'Explorer Pack is full!',
    cannotDropNotice: 'This item cannot be dropped.',
    objectiveCompletePrefix: 'Objective Complete',
    questCompletedPrefix: 'Quest Completed',
    levelUpSuffix: (lvl) => ` · Level ${lvl}!`,
    readyToTurnIn: 'Ready to turn in',
    readyToComplete: 'Ready to complete',
    availablePrefix: 'Available',
    completedWord: 'Completed',
    enemyDefeatedNotice: (name, xp, coins) =>
      `Defeated ${name} (+${xp} XP, +${coins} Coins)`,
    playerDefeatedNotice:
      'Fallen in battle — revived at the Valley Sanctuary.',
    unarmedLabel: 'Unarmed',
    damageShort: 'DMG',
    cooldownShort: 'CD',
    rangeShort: 'Range',
    rangedTag: 'Ranged',
    meleeTag: 'Melee',
    unequipShort: 'Unequip',
    weaponSwitchKeyHint: '1–9 Switch · X Unequip',
    dayLabel: 'Day',
    timeControlsTitle: 'Day & Night Cycle',
    dayLengthLabel: 'Full Day Length',
    timeSpeedLabel: 'Time Speed',
    pauseTimeLabel: 'Pause Clock',
    resumeTimeLabel: 'Resume Clock',
    presetSunrise: 'Sunrise 06:00',
    presetNoon: 'Noon 12:00',
    presetSunset: 'Sunset 18:00',
    presetMidnight: 'Midnight 00:00',
    secondsShort: 's',
    minutesShort: 'm',
    pausedTag: 'Paused',
    weatherControlsTitle: 'Dynamic Weather',
    weatherDynamicLabel: 'Auto Weather Cycle',
    weatherAutoOn: 'Auto',
    weatherAutoOff: 'Locked',
    weatherTransitionLabel: 'Transition Speed',
    weatherQualityLabel: 'Rain Density',
    weatherQualityLow: 'Low',
    weatherQualityMedium: 'Med',
    weatherQualityHigh: 'High',
    weatherWindLabel: 'Wind',
    weatherLightningBtn: 'Trigger Lightning',
    weatherTransitioningTo: (target) => `Shifting to ${target}`,
    continueAdventure: 'Continue',
    newGame: 'New Game',
    loadGame: 'Load Game',
    saveLoadTitle: 'Save & Load Slots',
    quickSave: 'Quick Save',
    saveSlotAutosave: 'Autosave',
    saveSlotManual: (n) => `Save Slot ${n}`,
    emptySlotLabel: 'Empty Slot',
    saveBtn: 'Save',
    overwriteBtn: 'Overwrite',
    loadBtn: 'Load',
    deleteSaveBtn: 'Delete',
    confirmDeleteSave: 'Confirm?',
    cancelBtn: 'Cancel',
    savedNotice: (slotLabel) => `Saved progress to ${slotLabel}.`,
    loadedNotice: (slotLabel) => `Loaded save from ${slotLabel}.`,
    deletedNotice: (slotLabel) => `Deleted ${slotLabel}.`,
    saveFailedNotice: 'Could not save game (storage unavailable).',
    loadFailedNotice: 'Save data could not be loaded.',
    modsCompatWarningNotice: (count) =>
      `Loaded world with ${count} mod compatibility notice(s).`,
    questsCountLabel: (completed, active) =>
      `${completed} Done · ${active} Active`,
    seedLabel: 'Seed',
    playTimeLabel: 'Played',
    saveSlotsFooterHint:
      'Versioned saves preserve position, gear, inventory, quests, seed, time, weather & world state.',
    aiTabStory: 'Story & Quests',
    aiTabChat: 'Ask Freely',
    aiToggleOn: 'AI Chat: On',
    aiToggleOff: 'AI Chat: Off',
    aiStatusAvailable: 'Gemini Live',
    aiStatusOffline: 'Offline Character Mode',
    aiStatusDisabled: 'AI Off',
    aiInputPlaceholder: (npcName) => `Ask ${npcName} anything...`,
    aiSendBtn: 'Send',
    aiThinking: (npcName) => `${npcName} is thinking...`,
    aiClearHistoryBtn: 'Clear Chat',
    aiEmptyGreeting: (npcName, location) =>
      `Start a dynamic conversation with ${npcName} here at ${location}. They'll remember what you talk about this session.`,
    aiOfflineNote:
      'Gemini AI is currently unavailable — in-character local responses are active, and all Story & Quest dialogues work normally.',
    aiDisabledNote:
      'Optional AI dialogue is turned off. Enable it above for Gemini-powered conversations or keep using Story & Quests.',
    aiLocationLabel: 'Location',
    aiFallbackTag: 'Local',
    loadInitWebgl: 'Initializing WebGL renderer...',
    loadTextures: 'Synthesizing terrain textures & sky...',
    loadBiomes: 'Generating seeded open-world biomes...',
    loadSpawn: 'Spawning adventurer & warming shaders...',
    loadReady: 'Ready for adventure',
    graphicsSettingsTitle: 'Graphics & Performance',
    graphicsSettingsSubtitle: 'Adaptive rendering, LODs, shaders & frame pacing',
    graphicsPresetLabel: 'Quality Preset',
    graphicsModeLabel: 'Graphics Mode',
    modeBalanced: 'Balanced',
    modePerformance: 'Performance',
    modeQuality: 'Quality',
    tierAuto: 'Auto',
    tierVeryLow: 'Very Low',
    tierLow: 'Low',
    tierMedium: 'Medium',
    tierHigh: 'High',
    tierUltra: 'Ultra',
    tierOff: 'Off',
    renderScaleLabel: 'Render Scale',
    viewDistanceLabel: 'View Distance',
    shadowQualityLabel: 'Shadow Quality',
    textureQualityLabel: 'Texture Quality',
    vegetationDensityLabel: 'Vegetation Density',
    effectsQualityLabel: 'Effects Quality',
    waterQualityLabel: 'Water Quality',
    postProcessingLabel: 'Post-Processing',
    antiAliasingLabel: 'Anti-Aliasing',
    aaOff: 'Off',
    aaFxaa: 'FXAA',
    aaMsaa: 'MSAA',
    fpsLimitLabel: 'FPS Limit',
    fpsUncapped: 'Uncapped',
    showDebugOverlayLabel: 'Performance Debug Overlay (F3)',
    showDebugOverlayDesc: 'Show live FPS, draw calls, triangles, memory & chunk stats',
    resetGraphicsAutoBtn: 'Reset to Auto',
    hardwareProfileLabel: 'Detected Hardware',
    effectiveTierLabel: 'Active Quality',
    dynamicAdaptTag: 'Dynamic FPS',
    deviceDesktop: 'Desktop',
    deviceMobile: 'Mobile',
    deviceTablet: 'Tablet',
    debugPerfTitle: 'Performance Monitor',
    debugPerfCloseHint: 'F3 to toggle',
    debugFps: 'FPS',
    debugFrameTime: 'Frame',
    debugDrawCalls: 'Draw Calls',
    debugTriangles: 'Triangles',
    debugGeometries: 'Geometries',
    debugTextures: 'Textures',
    debugHeap: 'JS Heap',
    debugObjects: 'Objects',
    debugNpcs: 'Active NPCs',
    debugAnimals: 'Active Wildlife',
    debugChunks: 'Chunks (Act/Tot)',
    debugRenderScale: 'Render Scale',
    debugQuality: 'Quality',
    debugMode: 'Mode',
    debugDevice: 'Device',
    menuSubtitle: 'Explore. Survive. Discover.',
    menuNewWorld: 'NEW WORLD',
    menuContinue: 'CONTINUE',
    menuLoadWorld: 'LOAD WORLD',
    menuSettings: 'SETTINGS',
    menuExitGame: 'EXIT GAME',
    noSavedWorldTitle: 'No saved world found.',
    noSavedWorldDesc: 'Create a new world to begin your adventure across Oakhollow Valley.',
    createNewWorldCta: 'CREATE NEW WORLD',
    createWorldTitle: 'Create New World',
    createWorldSubtitle: 'Choose a world name, terrain seed, mode, and challenge level.',
    worldNameLabel: 'World Name',
    worldNamePlaceholder: 'Oakhollow Chronicle',
    worldNameRequiredError: 'Please enter a world name.',
    worldSeedLabel: 'World Seed',
    worldSeedPlaceholder: 'Random or custom seed',
    randomSeedBtn: 'Random',
    worldTypeLabel: 'World Type',
    worldTypeNormal: 'Normal',
    worldTypeNormalDesc: 'Balanced valley exploration, quests, and combat.',
    worldTypeAdventure: 'Adventure',
    worldTypeAdventureDesc: 'Story-driven expeditions with starter travel supplies.',
    worldTypeSurvival: 'Survival',
    worldTypeSurvivalDesc: 'Demanding stamina & stronger foes across the wilds.',
    worldTypeCreative: 'Creative',
    worldTypeCreativeDesc: 'Unlimited stamina & peaceful damage-free roaming.',
    difficultyLabel: 'Difficulty',
    diffEasy: 'Easy',
    diffNormal: 'Normal',
    diffHard: 'Hard',
    createWorldBtn: 'CREATE WORLD',
    backBtn: 'BACK',
    loadWorldTitle: 'Load World',
    loadWorldSubtitle: 'Select a saved world to resume or manage.',
    noWorldsFoundTitle: 'No saved worlds yet',
    noWorldsFoundDesc: 'Start a new world to record your explorations, inventory, and quests.',
    playWorldBtn: 'PLAY WORLD',
    deleteWorldBtn: 'DELETE WORLD',
    deleteWorldConfirmTitle: 'Delete this world?',
    deleteWorldConfirmDesc: 'This action cannot be undone.',
    deleteBtn: 'DELETE',
    lastPlayedLabel: 'Last Played',
    settingsTitle: 'Settings',
    settingsSubtitle: 'Tune graphics, audio, controls, gameplay, and accessibility.',
    tabGraphics: 'GRAPHICS',
    tabAudio: 'AUDIO',
    tabControls: 'CONTROLS',
    tabGameplay: 'GAMEPLAY',
    tabAccessibility: 'ACCESSIBILITY',
    applyBtn: 'APPLY',
    resetBtn: 'RESET',
    settingsAppliedNotice: 'Settings applied.',
    vsyncLabel: 'VSync',
    dynamicQualityLabel: 'Dynamic Quality',
    audioSectionTitle: 'Audio & Music',
    masterVolumeLabel: 'Master Volume',
    musicVolumeLabel: 'Music Volume',
    effectsVolumeLabel: 'SFX Volume',
    ambientVolumeLabel: 'Ambient Volume',
    uiVolumeLabel: 'UI Volume',
    voiceVolumeLabel: 'Voice & Dialogue',
    menuMusicLabel: 'Menu Music',
    soundEffectsLabel: 'Sound Effects',
    audioToggleOn: 'ON',
    audioToggleOff: 'OFF',
    fovLabel: 'Field of View (FOV)',
    showFpsLabel: 'Show FPS Counter',
    showHudLabel: 'Show Gameplay HUD',
    uiScaleLabel: 'UI Scale',
    textSizeLabel: 'Text Size',
    textSizeSmall: 'Small',
    textSizeNormal: 'Normal',
    textSizeLarge: 'Large',
    highContrastLabel: 'High Contrast UI',
    reducedMotionLabel: 'Reduced Motion',
    exitConfirmTitle: 'Exit World of Adventure?',
    exitConfirmDesc: 'Any unsaved progress may be lost.',
    webExitNoticeDesc: 'To exit the game, close this browser tab.',
    okBtn: 'OK',
    pauseResume: 'RESUME',
    pauseSaveWorld: 'SAVE WORLD',
    pauseSettings: 'SETTINGS',
    pauseMainMenu: 'MAIN MENU',
    pauseExitGame: 'EXIT GAME',
    unsavedMainMenuTitle: 'Return to Main Menu?',
    unsavedMainMenuDesc: 'You have unsaved progress in this world.',
    saveAndExitBtn: 'SAVE & EXIT',
    discardAndExitBtn: 'EXIT WITHOUT SAVING',
    worldAndTimeTools: 'World, Time & Weather Tools',
    craftTab: 'Crafting',
    craftBtn: 'Craft',
    craftCategoryAll: 'All',
    craftCategoryCamp: 'Camp & Gear',
    craftCategoryWeapon: 'Weapons',
    craftCategoryTools: 'Tools',
    craftCategoryArmor: 'Armor',
    craftCategoryClothing: 'Clothing',
    craftCategoryBuilding: 'Building',
    craftCategoryMaterial: 'Materials',
    craftCategoryProvisions: 'Provisions',
    craftStationHand: 'By Hand',
    craftStationTable: 'Crafting Table',
    craftStationForge: 'Blacksmith Forge',
    craftStationFurnace: 'Smelting Furnace',
    craftStationWorkbench: 'Tailor Workbench',
    craftStatusAvailable: 'AVAILABLE',
    craftStatusMissing: 'MISSING MATERIALS',
    craftStatusLocked: 'LOCKED',
    craftLockStation: (stationName) => `Requires nearby ${stationName}`,
    craftLockLevel: (lvl) => `Requires Level ${lvl}`,
    craftLockTool: (toolLabel) => `Requires ${toolLabel}`,
    craftLockPrereq: (prereqName) => `Craft ${prereqName} first`,
    craftLockStory: 'Complete the required Main Story chapter first',
    availableStationsLabel: 'Active Stations',
    craftDurationSec: (sec) => `${sec.toFixed(1)}s`,
    craftingInProgress: 'Crafting...',
    craftMaterialsNeeded: 'Required Materials',
    craftedNotice: (name, count) =>
      `Crafted ${name}${count > 1 ? ` ×${count}` : ''}.`,
    craftedFailIngredients: 'Missing required materials for crafting.',
    sleepTransitionLabel: 'Sleeping...',
    goodMorningNotice: 'Good morning.',
    cannotSleepDayNotice: 'You can only rest at evening or night.',
    bedPlacedNotice: 'Camp Bed placed nearby. Interact with it at night to rest.',
    portraitRecommendationText:
      'For the best experience, hold your phone vertically for a smoother and more enjoyable experience.',
    portraitRecommendationDismissAria: 'Dismiss orientation tip',
    updateAvailableTitle: 'New update available!',
    updateAvailableBody:
      'Update the game to enjoy the new features, bug fixes, and an improved gameplay experience.',
    updateCurrentVersionLabel: 'Current Version',
    updateNewVersionLabel: 'New Version',
    updateNowBtn: 'Update Now',
    updateCloseBtn: 'Close',
    updateDontShowAgainBtn: "Don't show this message again",
    bedCannotPlaceNotice: 'Cannot place bed on water or steep terrain.',
    placeBedBtn: 'Place Bed',
    placeStationBtn: 'Place Station',
    stationPlacedNotice: (name) => `${name} placed nearby. Approach it and press E to craft.`,
    stationCannotPlaceNotice: 'Cannot place station on water or steep terrain.',
    toolRequiredNotice: (toolLabel, resourceName) =>
      `Requires ${toolLabel} to mine ${resourceName}.`,
    toolBrokenNotice: (name) => `${name} broke from wear!`,
    durabilityShort: 'Durability',
    bonusCapacity: 'Pack Slots',
    toolPickaxeTier1: 'Stone Pickaxe or better',
    toolPickaxeTier2: 'Iron Pickaxe or better',
    toolAxeName: 'Axe',
    toolPickaxeName: 'Pickaxe',
    toolShovelName: 'Shovel',
    toolTierLabel: (tier) => `Tier ${tier}`,
    durabilityLabel: 'Durability',
    weaponBrokenNotice: (name) => `${name} broke from wear!`,
    weaponsRepairedNotice: (cost) =>
      cost > 0 ? `Weapons repaired (-${cost} Coins).` : 'Weapons repaired.',
    repairNeedCoinsNotice: (cost) =>
      `Need ${cost} Coins or no damaged weapons to repair.`,
    chestOpenedNotice: (label, summary) => `Opened ${label}: ${summary}.`,
    harvestedResourceNotice: (name, count) => `Harvested ${name} +${count}.`,
    damageReductionLabel: 'Defense',
    staminaUnlimitedLabel: '∞ Unlimited',
    staminaModeBadge: (maxLabel) => `Stamina: ${maxLabel}`,
    pauseMap: 'MAP',
    miniMapOrientationLabel: 'Mini-Map Orientation',
    miniMapNorthUp: 'North-Up',
    miniMapRotating: 'Rotate with Player',
    waypointLabel: 'Waypoint',
    setWaypointPrompt: 'Set waypoint?',
    setWaypointBtn: 'SET WAYPOINT',
    removeWaypointBtn: 'Remove Waypoint',
    waypointSetNotice: 'Personal waypoint placed on map.',
    waypointRemovedNotice: 'Waypoint removed.',
    mapLegendWaypoint: 'Personal Waypoint',
    mapLegendUnexplored: 'Unexplored Territory',
    bowChargeLabel: 'CHARGE',
    bowMaxLabel: 'MAX',
    bowCancelledNotice: 'Bow shot cancelled.',
    mobAim: 'Hold',
    mobShoot: 'SHOOT',
    bowPowerTitle: 'BOW POWER',
    bowTierWeak: 'Weak',
    bowTierLow: 'Low',
    bowTierStrong: 'Strong',
    bowTierMaximum: 'Maximum',
    bowNoArrowsNotice: 'No arrows left! Craft arrows in your pack.',
    bowNoArrowsShort: 'NO ARROWS',
    bowHeadshotNotice: 'Headshot!',
    bowNpcWarningNotice: 'Watch your aim! Villagers live peacefully here.',
    showBowTrajectoryLabel: 'Show Bow Trajectory',
    bowCancelHint: 'Right-click or C to cancel',
    arrowsLabel: 'Arrows',
    villageDiscoveredNotice: (name) => `Village Discovered: ${name}`,
    mapLegendResource: 'Resource Nodes',
    showWorldGenDebugLabel: 'World Generation Debug',
    footstepVolumeLabel: 'Footstep Volume',
    cameraSettingsTitle: 'Camera & Perspective',
    cameraPerspectiveLabel: 'Camera Perspective',
    perspectiveFirstPerson: 'First Person',
    perspectiveSecondPerson: 'Second Person',
    perspectiveThirdPerson: 'Third Person',
    perspectiveShort1p: '1P',
    perspectiveShort2p: '2P',
    perspectiveShort3p: '3P',
    cameraSensitivityLabel: 'Camera Sensitivity',
    cameraDistanceLabel: 'Camera Distance',
    cameraHeightLabel: 'Camera Height',
    cameraSmoothingLabel: 'Camera Smoothing',
    cameraInvertYLabel: 'Invert Camera Y',
    indicatorOffsetTitle: 'Interaction Indicator Offset',
    indicatorOffsetXLabel: 'Indicator Offset X (Side)',
    indicatorOffsetYLabel: 'Indicator Offset Y (Vertical)',
    indicatorOffsetZLabel: 'Indicator Offset Z (Depth)',
    weatherMaxDurationLabel: 'Max Weather Duration',
    btnCameraLabel: 'Camera View',
    ctrlCamera: 'Camera',
    mobCamera: 'View',
    cameraPerspectiveNotice: (mode) =>
      `Camera: ${mode === 'first-person' ? 'First Person' : mode === 'second-person' ? 'Second Person' : 'Third Person'}`,
    showBiomeDebugLabel: 'Show Biome Debug',
    biomeDebugPrefix: 'BIOME',
    menuMultiplayer: 'MULTIPLAYER',
    mpSubtitle: 'Co-op lobbies, room browser, friends & invites.',
    mpCreateRoom: 'CREATE ROOM',
    mpJoinRoom: 'JOIN ROOM',
    mpQuickJoin: 'QUICK JOIN',
    mpFriends: 'FRIENDS',
    mpInvites: 'INVITES',
    mpReady: 'READY',
    mpReadyActive: 'READY ✓',
    mpNotReady: 'Not Ready',
    mpStartGame: 'START GAME',
    mpLeaveRoom: 'LEAVE ROOM',
    mpPlayerNameLabel: 'Player Name',
    mpPlayerNamePlaceholder: 'Adventurer',
    mpRoomNameLabel: 'Room Name',
    mpRoomNamePlaceholder: 'Oakhollow Co-op Expedition',
    mpRoomNameRequired: 'Please enter a room name.',
    mpRoomCodeLabel: 'ROOM CODE',
    mpRoomCodePlaceholder: 'e.g. A7K9P2',
    mpRoomCodeRequired: 'Please enter a room code.',
    mpMaxPlayersLabel: 'Max Players',
    mpPrivacyLabel: 'Room Visibility',
    mpPrivacyPublic: 'Public',
    mpPrivacyFriends: 'Friends Only',
    mpPrivacyPrivate: 'Private',
    mpPasswordLabel: 'Password (Optional)',
    mpPasswordOptionalPlaceholder: 'Leave blank for no password',
    mpRoomBrowserTitle: 'Room Browser',
    mpSearchRoomsPlaceholder: 'Filter by room or host name...',
    mpRefreshBtn: 'Refresh',
    mpNoRoomsTitle: 'No live rooms found',
    mpNoRoomsDesc:
      'Active public rooms will appear here once the Cloudflare Workers & Durable Objects server is connected.',
    mpFriendsSubtitle: 'Manage online friends and send room invitations.',
    mpAddFriendPlaceholder: 'Enter player name or ID...',
    mpAddFriendBtn: 'Add',
    mpNoFriendsTitle: 'No friends listed yet',
    mpNoFriendsDesc:
      'Add a friend player name above so you can quickly invite them to your rooms.',
    mpInvitesSubtitle: 'Pending multiplayer room invitations.',
    mpNoInvitesTitle: 'No pending invites',
    mpNoInvitesDesc:
      'Room invitations from friends will appear here when online multiplayer is connected.',
    mpAcceptBtn: 'Accept',
    mpDeclineBtn: 'Decline',
    mpInviteBtn: 'Invite',
    mpLobbyTitle: 'Room Lobby',
    mpPlayerListTitle: 'Player List',
    mpHostLabel: 'Host',
    mpYouLabel: 'You',
    mpOpenSlotLabel: 'Open Slot',
    mpCopyCodeBtn: 'COPY CODE',
    mpCodeCopiedNotice: 'Room code copied.',
    mpPlayersCount: (current, max) => `${current} / ${max} Players`,
    mpServerStatusDisconnected:
      'Online backend: Not connected (Cloudflare Workers + Durable Objects)',
    mpServerNoticeBanner:
      'Multiplayer UI ready. Live rooms and matchmaking activate when the Cloudflare Workers + Durable Objects backend is connected.',
    mpQuickJoinUnavailable:
      'Quick Join is unavailable until the online multiplayer server is connected.',
    mpJoinRequiresBackend:
      'Joining remote rooms requires the Cloudflare Workers & Durable Objects server connection.',
    mpStartRequiresBackend:
      'Starting a multiplayer match requires the Cloudflare Workers & Durable Objects server connection.',
    mpFriendActionRequiresBackend:
      'Friend requests and invitations require the online multiplayer server connection.',
    mpLocalLobbyPreviewNotice:
      'Lobby preview mode — remote players can join once the Cloudflare Workers & Durable Objects server is connected.',
    mpGameModeLabel: 'Game Mode',
    mpPrivateRoomLabel: 'Private Room',
    mpAllowFriendsLabel: 'Allow Friends',
    mpToggleOn: 'ON',
    mpToggleOff: 'OFF',
    mpRoomLabel: 'Room',
    mpPlayersShort: (current, max) => `Players: ${current}/${max}`,
    mpInviteFriends: 'INVITE FRIENDS',
    mpKickPlayer: 'KICK PLAYER',
    mpCloseRoom: 'CLOSE ROOM',
    mpRoomLockedLabel: 'Room Locked',
    mpCreatingRoom: 'Creating Room...',
    mpStartingGame: 'Starting Game...',
    mpServerStatusConnected:
      'Online backend: Connected (Cloudflare Workers + Durable Objects)',
    mpBackendRequiredForCreate:
      'Multiplayer server is not configured. Please configure VITE_MULTIPLAYER_URL.',
    mpNotConfiguredTitle: 'Multiplayer server is not configured.',
    mpNotConfiguredHint: 'Please configure VITE_MULTIPLAYER_URL.',
    mpStatusConnecting: 'Connecting...',
    mpStatusConnected: 'Connected',
    mpStatusDisconnected: 'Disconnected',
    mpStatusServerUnavailable: 'Server unavailable',
    mpStatusReconnecting: 'Reconnecting...',
    mpHostTransferredNotice: (newHostName) =>
      `Previous host disconnected. ${newHostName} is now the room host.`,
    mpKickedNotice: 'You were removed from the room by the host.',
    mpPlayerKickedNotice: (name) => `${name} was kicked from the room.`,
    mpRoomClosedNotice: 'The host closed the room.',
    mpStartingWorldNotice: (roomCode, modeLabel) =>
      `Starting multiplayer world · Room ${roomCode} · ${modeLabel}`,
    mpEnterRoomCodeLabel: 'ENTER ROOM CODE',
    mpRoomLinkLabel: 'ROOM LINK',
    mpCopyLinkBtn: 'COPY LINK',
    mpShareBtn: 'SHARE',
    mpLinkCopiedNotice: 'Room link copied.',
    mpInviteFriendsSubtitle: 'Share your room code or link, or invite a friend directly.',
    mpInviteTargetPlaceholder: 'Enter friend player name...',
    mpSendInviteBtn: 'Send Invite',
    mpInviteSentNotice: (name) => `Invitation sent to ${name}.`,
    mpInvitedToPlayNotification: (name) => `${name} invited you to play.`,
    mpErrorRoomNotFound: 'Room no longer exists.',
    mpErrorRoomFull: 'Room is full.',
    mpErrorGameAlreadyStarted: 'GAME ALREADY STARTED',
    mpErrorUnableToConnect: 'Unable to connect to multiplayer server.',
    mpErrorRoomCreationFailed: 'Room creation failed.',
    mpVerifyingRoom: 'Verifying room...',
    mpRemoveFriendBtn: 'Remove',
    mpRequireAllReadyLabel: 'REQUIRE ALL PLAYERS READY',
    mpTransferHost: 'TRANSFER HOST',
    mpConnectionQualityLabel: 'Connection',
    mpQualityExcellent: 'Excellent',
    mpQualityGood: 'Good',
    mpQualityPoor: 'Poor',
    mpQualityDisconnected: 'Disconnected',
    mpPingUnit: 'ms',
    mpWaitingForReadyHint: (ready, total) =>
      `Waiting for all players to be ready (${ready}/${total})`,
    mpWorldSeedLabel: 'World Seed',
    mpAuthoritativeConfigBadge: 'Server-Authoritative World',
    mpRoomChatTitle: 'ROOM CHAT',
    mpRoomChatOpenBtn: 'Chat (T)',
    mpRoomChatPlaceholder: 'Type a message to the room...',
    mpRoomChatSendBtn: 'Send',
    mpRoomChatEmpty: 'No messages yet. Say hello to your party!',
    mpRoomChatSpamNotice: 'Slow down — please wait a moment before sending another message.',
    mpRoomChatDuplicateNotice: 'Please do not repeat the same message.',
    mpRoomChatTooLongNotice: (max) => `Message cannot exceed ${max} characters.`,
    mpRoomChatDisconnectedNotice: 'Chat is paused until the room connection is ready.',
    mpRoomChatMutedSuppressed: (count) =>
      `${count} message${count === 1 ? '' : 's'} hidden from muted or blocked players.`,
    mpRoomChatTabsChat: 'ROOM CHAT',
    mpRoomChatTabsPlayers: 'PLAYERS',
    mpActionViewProfile: 'VIEW PROFILE',
    mpActionInvite: 'INVITE',
    mpActionMute: 'MUTE',
    mpActionUnmute: 'UNMUTE',
    mpActionBlock: 'BLOCK',
    mpActionUnblock: 'UNBLOCK',
    mpActionReport: 'REPORT',
    mpActionAddFriend: 'Add Friend',
    mpActionRemoveFriend: 'Remove Friend',
    mpBadgeMuted: 'Muted',
    mpBadgeBlocked: 'Blocked',
    mpBadgeFriend: 'Friend',
    mpProfileTitle: 'Player Profile',
    mpProfileRoleLabel: 'Room Role',
    mpProfileRoleHost: 'Room Host',
    mpProfileRolePlayer: 'Party Member',
    mpProfileStatusLabel: 'Status',
    mpProfileHealthLabel: 'Vitals',
    mpProfileJoinedAtLabel: 'Joined Room',
    mpProfileLocalSocialNote:
      'Local friend & moderation list (account sync activates automatically if persistent accounts are added later).',
    mpPlayerMutedNotice: (name) => `${name} muted. Their chat messages are now hidden.`,
    mpPlayerUnmutedNotice: (name) => `${name} unmuted.`,
    mpPlayerBlockedNotice: (name) => `${name} blocked. Chat messages and invites are hidden.`,
    mpPlayerUnblockedNotice: (name) => `${name} unblocked.`,
    mpFriendAddedNotice: (name) => `${name} added to your friends list.`,
    mpReportTitle: 'Report Player',
    mpReportSubtitle: (name) => `Submit a moderation report for ${name} in this room.`,
    mpReportReasonLabel: 'Reason',
    mpReportReasonSpam: 'Spam or Flooding',
    mpReportReasonHarassment: 'Harassment or Abusive Chat',
    mpReportReasonCheating: 'Cheating or Exploiting',
    mpReportReasonInappropriateName: 'Inappropriate Player Name',
    mpReportReasonInappropriateProfile: 'Inappropriate Profile or Avatar',
    mpReportReasonOther: 'Other',
    mpReportDetailsLabel: 'Additional Details (Optional)',
    mpReportDetailsPlaceholder: 'Briefly describe what happened...',
    mpReportSubmitBtn: 'Submit Report',
    mpReportSubmittedNotice: (name) => `Report submitted for ${name}.`,
    mpReportDuplicateNotice: 'You have already reported this player in this room.',
    mpConnectionLostTitle: 'CONNECTION LOST',
    mpReconnectingSubtitle: 'Connection lost. Reconnecting...',
    mpReconnectAttemptLabel: (attempt, max) => `Attempt ${attempt} of ${max}`,
    mpReconnectFailedTitle: 'CONNECTION LOST',
    mpReconnectFailedDesc:
      'Unable to reconnect to the multiplayer room after several attempts.',
    mpRetryConnectionBtn: 'Retry',
    mpReturnToMenuBtn: 'Multiplayer Menu',
    mpRoomClosedReturnNotice: 'The room closed. Returning to the multiplayer menu.',
    mpOfflineCannotConnectNotice:
      'No internet connection. Please check your network and try again.',
    showPlayerNamesLabel: 'Show Player Names',
    profileCreateTitle: 'CREATE YOUR PROFILE',
    profileCreateSubtitle: 'Set up your permanent explorer identity before entering online worlds.',
    profilePictureLabel: 'PROFILE PICTURE',
    profileSelectAvatarTitle: 'AVATAR',
    profilePresetsTab: 'Presets',
    profileGeneratedTab: 'Generated',
    profileUploadTab: 'Upload Image',
    profileChooseFileBtn: 'Choose Image (PNG, JPEG, WebP)',
    profileUploadHint: 'Resized cleanly to 128×128 square · Max 5 MB · No scripts or metadata.',
    profileUploadTooLargeErr: 'Image exceeds the size limit. Choose a smaller photo.',
    profileUploadInvalidFormatErr: 'Unsupported file format. Select a valid PNG, JPEG, or WebP image.',
    profileUploadDecodeErr: 'Unable to decode this image file.',
    profileAvatarSavedBtn: 'Use Selected Avatar',
    profileChangeAvatarBtn: 'Change Avatar',
    profilePlayerNameLabel: 'PLAYER NAME',
    profilePlayerNameHint: '3–20 characters · Arabic, English & numbers supported.',
    profilePlayerIdLabel: 'PLAYER ID',
    profilePermanentBadge: 'Permanent',
    profileIdImmutableNote: 'Assigned permanently by the server and cannot be changed.',
    profilePlayerTagLabel: 'PLAYER TAG (OPTIONAL)',
    profileBioLabel: 'BIO (OPTIONAL)',
    profileBioPlaceholder: 'Tell fellow explorers about your playstyle...',
    profileCountryLabel: 'COUNTRY / REGION (OPTIONAL)',
    profileCountryPlaceholder: 'e.g. Jordan, US, EU...',
    profileFavoriteModeLabel: 'FAVORITE GAME MODE',
    profileStatusLabel: 'STATUS',
    profileStatusOnline: 'ONLINE',
    profileStatusInGame: 'IN GAME',
    profileStatusAway: 'AWAY',
    profileStatusOffline: 'OFFLINE',
    profileCreateSubmitBtn: 'CREATE PROFILE',
    profileSavingBtn: 'Saving...',
    profileEditBtn: 'EDIT PROFILE',
    profileSaveBtn: 'SAVE PROFILE',
    profileCancelEditBtn: 'Cancel',
    profileStatisticsTitle: 'STATISTICS',
    profileStatLevel: 'LEVEL',
    profileStatExperience: 'EXPERIENCE',
    profileStatPlayTime: 'PLAY TIME',
    profileStatWorldsCreated: 'WORLDS CREATED',
    profileStatWorldsJoined: 'WORLDS JOINED',
    profileStatQuestsCompleted: 'QUESTS COMPLETED',
    profileStatEnemiesDefeated: 'ENEMIES DEFEATED',
    profileStatAnimalsDefeated: 'ANIMALS DEFEATED',
    profileStatVillagesDiscovered: 'VILLAGES DISCOVERED',
    profileStatResourcesCollected: 'RESOURCES COLLECTED',
    profileStatDistanceTraveled: 'DISTANCE TRAVELED',
    profilePrivacyTitle: 'PRIVACY & ONLINE VISIBILITY',
    profilePrivacyShowOnline: 'Show Online Status',
    profilePrivacyShowNames: 'Show Player Names Above Heads',
    profilePrivacyAllowFriends: 'Allow Friend Requests',
    profilePrivacyAllowInvites: 'Allow Room Invites',
    profilePrivacyAllowMessages: 'Direct Messages',
    profileMsgPrivacyEveryone: 'Everyone',
    profileMsgPrivacyFriends: 'Friends Only',
    profileMsgPrivacyNobody: 'Nobody',
    profileBlockedPlayersTitle: 'Blocked Players',
    profileCopyIdBtn: 'Copy ID',
    profileIdCopiedNotice: 'Player ID copied.',
    profileSearchPlayerTitle: 'SEARCH PLAYER',
    profileSearchPlayerPlaceholder: 'Search by Player ID (WA-...), Name#Tag, #Tag, or Name...',
    profileSearchBtn: 'Search',
    profileNoSearchResults: 'No matching players found.',
    profileFriendRequestsIncoming: 'Incoming Friend Requests',
    profileFriendRequestsOutgoing: 'Outgoing Requests',
    profileSendFriendRequestBtn: 'Add Friend',
    profileCancelRequestBtn: 'Cancel Request',
    profilePendingRequestBadge: 'Request Sent',
    profileDirectMessageBtn: 'Message',
    profileDirectMessagesTitle: 'Direct Messages',
    profileDmPlaceholder: 'Write a private message...',
    profileDmEmpty: 'No messages yet.',
    profileDmUnavailable: 'Online service required for direct messages.',
    profileViewFullProfileBtn: 'FULL ONLINE PROFILE',
    profileOpenBtn: 'Profile',
    profileInviteToastText: (name, tag, roomName) =>
      `${name}${tag ? ` #${tag}` : ''} invited you to: ${roomName}`,
    profileFriendsCategoryOnline: 'ONLINE',
    profileFriendsCategoryInGame: 'IN GAME',
    profileFriendsCategoryOffline: 'OFFLINE',
    profilePagePrev: 'Prev',
    profilePageNext: 'Next',
    mapLegendFriend: 'Friend',
    mapLegendRoomPlayer: 'Room Player',
    showFriendsOnMapLabel: 'Show Room Players & Friends on Map',
    mpWorldSettingsPermissionLabel: 'Time & Weather Control',
    mpWorldSettingsHostOnly: 'Host Only',
    mpWorldSettingsAllPlayers: 'All Players',
    mpWorldSettingsHostOnlyNotice: 'Only the room host can change world time and weather right now.',
    mpErrorRoomExpired: 'This room has expired after 72 hours of inactivity.',
    showPartyMembersOnMapLabel: 'Show Party Members on Map',
    mapLegendPartyMember: 'Party Member',
    mapLegendCoopObjective: 'Co-op Objective',
    partyTitle: 'Adventure Party',
    partySubtitle: 'Coordinate with allies across Oakhollow without pooling personal loot or XP',
    partyBtnLabel: 'Party',
    partyCreateBtn: 'Create Party',
    partyLeaveBtn: 'Leave Party',
    partyNoPartyTitle: 'No Active Party',
    partyNoPartyDesc: 'Form a co-op party to track allies on maps, rally village guards, and tackle shared objectives.',
    partyLeaderBadge: 'Leader',
    partyMemberTag: 'Party Ally',
    partyMembersCount: (count, max) => `${count}/${max} Members`,
    partyReadyBtn: 'Ready Up',
    partyReadyActive: 'Ready',
    partyNotReady: 'Preparing',
    partyKickBtn: 'Remove',
    partyTransferLeaderBtn: 'Make Leader',
    partyInviteTitle: 'Invite Friends & Room Players',
    partyInviteBtn: 'Invite',
    partyInvitedBadge: 'Invited',
    partyPendingInvitesTitle: 'Pending Party Invitations',
    partyInviteReceivedNotice: (fromName) => `${fromName} invited you to join their party!`,
    partyCreatedNotice: 'Adventure party formed!',
    partyJoinedNotice: 'Joined the party!',
    partyLeftNotice: 'You left the party.',
    partyLeaderTransferredNotice: (name) => `${name} is now the party leader.`,
    partyDuplicateInviteNotice: 'An invitation is already pending for this player.',
    partyFullNotice: 'Party has reached the room limit.',
    partyFriendlyFireLabel: 'Friendly Fire',
    partyFriendlyFireOnDesc: 'Party members can damage each other',
    partyFriendlyFireOffDesc: 'Party members cannot harm each other',
    partyFriendlyFireBlockedNotice: 'Friendly fire is OFF — party members are protected.',
    partyDistanceMeters: (m) => `${m}m`,
    coopObjectiveTitle: 'Cooperative Objectives',
    coopObjectiveStartBtn: 'Start Objective',
    coopObjectiveCancelBtn: 'Cancel',
    coopObjectiveLeaderOnlyHint: 'Only the party leader can start or cancel co-op objectives.',
    coopObjectiveActiveLabel: 'Active Objective',
    coopObjectiveCompletedNotice: (title, xp, coins) =>
      `Co-op Objective Complete: ${title}! Earned ${xp} XP & ${coins} coins.`,
    coopObjectiveStartedNotice: (title) => `Co-op Objective Started: ${title}`,
    coopObjectiveNoneActive: 'No cooperative objective active.',
    coopTypeKillBoss: 'Slay Bandits / Boss',
    coopTypeProtectVillage: 'Protect the Village',
    coopTypeCollectResources: 'Collect Resources',
    coopTypeEscortNpc: 'Escort Village Elder',
    coopTypeExploreLocation: 'Explore Frontier Site',
    coopTypeOpenDungeon: 'Open Dungeon Vaults',
    questScopePersonal: 'Personal',
    questScopeCoop: 'Cooperative',
    questStartCoopBtn: 'Start Co-op Quest',
    questClaimRewardBtn: 'Claim Personal Reward',
    questCoopActiveHint: 'Shared party progress · Personal rewards per player',
    questCoopContributors: (count) => `${count} Contributors`,
    coopQuestsSectionTitle: 'Cooperative Party Quests',
    bossTargetLabel: (name) => `Target: ${name}`,
    bossPhaseLabel: (phase) => `Phase ${phase}`,
    bossStateLabel: (state) => {
      switch (state) {
        case 'windup_slam':
          return 'Seismic Slam';
        case 'windup_strike':
          return 'Heavy Strike';
        case 'enraged_roar':
          return 'Enraged!';
        case 'recover':
          return 'Staggered';
        default:
          return 'Engaged';
      }
    },
    lootGrantedNotice: (summary) => `Loot Received: ${summary}`,
    coopQuestStartedNotice: (title) => `Co-op Quest Started: ${title}`,
    coopQuestCompletedNotice: (title) => `Co-op Quest Ready / Completed: ${title}`,
    tabStory: (done, total) => `Story (${done}/${total})`,
    storyCampaignTitle: 'Main Story Campaign',
    storyChapterProgress: (current, total) => `Chapter ${current} of ${total}`,
    storyActiveQuestLabel: 'Active Story Quest',
    storyNextObjectiveLabel: 'Next Objective',
    storyCompletedCampaignTitle: 'Campaign Complete — Legend of Oakhollow',
    storyCompletedCampaignDesc:
      'You uncovered the secret of the Sunstone Vault and saved the valley. Free exploration, crafting, and side quests remain open.',
    storyStartQuestBtn: 'Begin Chapter Quest',
    storyRetryQuestBtn: 'Retry Quest',
    storyCompleteFallbackHint: 'Speak with Elder Thorne or follow the gold Star marker on your map.',
    storyStateLabels: {
      LOCKED: 'Locked',
      AVAILABLE: 'Available',
      ACTIVE: 'Active',
      OBJECTIVE_COMPLETED: 'Ready to Turn In',
      COMPLETED: 'Completed',
      FAILED: 'Failed',
    },
    storyQuestStartedNotice: (title) => `Main Story Started: ${title}`,
    storyQuestFailedNotice: (title) => `Story Quest Failed: ${title}`,
    storyRescuedNotice: (name) => `Rescued ${name}!`,
    storyRescueActionVerb: 'Rescue',
    mapLegendStoryObjective: 'Main Story Objective / NPC',
    mapLegendSideQuestAvailable: 'Available Side Quest',
    mapLegendSideQuestActive: 'Active Side Quest Objective',
    mapLegendSideQuestTurnin: 'Side Quest Ready to Turn In',
    sideQuestAcceptedNotice: (title) => `Side Quest Accepted: ${title}`,
    sideQuestAbandonedNotice: (title) => `Side Quest Abandoned: ${title}`,
    sideQuestFailedNotice: (title) => `Side Quest Failed: ${title}`,
    sideQuestExpiredNotice: (title) => `Side Quest Expired: ${title}`,
    sideQuestMissingItemsNotice:
      'You are missing required items needed to complete this side quest.',
    sideQuestReadyNotice: (title) => `Side Quest Ready to Turn In: ${title}`,
    tabSideQuests: (done, total) => `Side (${done}/${total})`,
    sideQuestsSectionTitle: 'Optional Side Quests',
    sideQuestsSubtitle:
      'Optional stories, bounties, deliveries, and rescues across the valley — never required to finish the main story.',
    sideQuestReputationLabel: 'Valley Reputation',
    sideQuestAcceptBtn: 'Accept Side Quest',
    sideQuestAbandonBtn: 'Abandon',
    sideQuestRetryBtn: 'Retry',
    sideQuestRepeatableBadge: 'Repeatable',
    sideQuestTimedBadge: (hours) => `${hours}h remaining`,
    sideQuestCooldownBadge: (sec) => `Cooldown ${sec}s`,
    sideQuestGiverLabel: 'Quest Giver',
    sideQuestLocationLabel: 'Location',
    sideQuestLevelReqBadge: (lvl) => `Lv. ${lvl}+`,
    sideQuestNightOnlyBadge: 'Evening & Night',
    sideQuestCompletedCountBadge: (count) => `Cleared ×${count}`,
    sideQuestFilterAll: 'All',
    sideQuestGroupActive: 'Active Side Quests',
    sideQuestGroupAvailable: 'Available Side Quests',
    sideQuestGroupFailed: 'Failed / Expired',
    sideQuestGroupLocked: 'Locked Side Quests',
    sideQuestGroupCompleted: 'Completed Side Quests',
    sideQuestEmptyNotice: 'No side quests match this category filter.',
    sideQuestStateLabels: {
      LOCKED: 'Locked',
      AVAILABLE: 'Available',
      ACTIVE: 'Active',
      COMPLETED: 'Completed',
      FAILED: 'Failed',
      EXPIRED: 'Expired',
    },
    sideQuestCategoryLabels: {
      rescue: 'Rescue',
      delivery: 'Delivery',
      hunting: 'Hunting',
      gathering: 'Gathering',
      exploration: 'Exploration',
      village: 'Village',
    },
    buildModeTitle: 'Build Mode',
    buildModeBtn: 'Build',
    buildManageBtn: 'Manage',
    buildExitBtn: 'Exit Build',
    buildPlaceBtn: 'Place',
    buildRotateLeftBtn: 'Rotate -',
    buildRotateRightBtn: 'Rotate +',
    buildSnapLabel: 'Snap',
    buildSnapOn: 'Snap On',
    buildSnapOff: 'Free Place',
    buildSnappedBadge: 'Snapped',
    buildNudgeForward: 'Fwd',
    buildNudgeBack: 'Back',
    buildNudgeLeft: 'Left',
    buildNudgeRight: 'Right',
    buildValidPlacement: 'Valid Placement',
    buildInvalidPlacement: 'Invalid Placement',
    buildCreativeFreeTag: 'Creative Mode — Free Placement',
    buildRequiredMaterials: 'Required Materials',
    buildMissingMaterialsNotice: 'You are missing required building materials.',
    buildPlacedNotice: (name) => `Constructed ${name}.`,
    buildInvalidNotice: (reasonLabel) => `Cannot place: ${reasonLabel}`,
    buildPermissionDeniedNotice: 'You do not have permission to use this structure.',
    buildReasonLabels: {
      valid: 'Ready to place',
      out_of_bounds: 'Outside buildable valley bounds',
      in_water: 'Cannot build inside water or ocean',
      near_water: 'Too close to water shoreline',
      slope_too_steep: 'Terrain slope is too steep',
      uneven_terrain: 'Ground is too uneven here',
      colliding_structure: 'Blocked by terrain object or structure',
      inside_village_protected: 'Protected village grounds',
      blocking_road: 'Cannot block village roads or trails',
      near_npc_spawn: 'Too close to an NPC station',
      near_quest_object: 'Too close to a quest landmark or ruin',
      missing_materials: 'Missing required materials',
      permission_denied: 'Permission denied',
    },
    buildStorageTitle: 'Structure Storage',
    buildStorageCapacityLabel: (used, max) => `${used} / ${max} Slots`,
    buildStorageBackpack: 'Your Backpack',
    buildStorageVault: 'Stored Contents',
    buildStorageEmpty: 'No items stored in this structure.',
    buildStorageDepositBtn: 'Store',
    buildStorageWithdrawBtn: 'Take',
    buildStorageAllBtn: 'Stack',
    buildStorageFullNotice: 'Structure storage is full.',
    buildManageTitle: 'Manage Structure',
    buildManageOwnerLabel: 'Builder',
    buildManageHealthLabel: 'Durability',
    buildManageRepairBtn: 'Repair',
    buildManageRepairedNotice: 'Structure repaired to full durability.',
    buildManageUpgradeBtn: (nextName) => `Upgrade → ${nextName}`,
    buildManageUpgradedNotice: (nextName) => `Upgraded structure to ${nextName}.`,
    buildManagePermLabel: 'Access Permissions',
    buildPermLabels: {
      owner: 'Owner Only',
      friends: 'Friends',
      party: 'Party',
      everyone: 'Everyone',
    },
    buildManageDemolishBtn: 'Demolish',
    buildManageDemolishConfirm: 'Confirm Demolish',
    buildManageDemolishCancel: 'Keep',
    buildManageDemolishRefundHint: 'Refunds 50% of base materials.',
    buildManageDemolishNotEmpty: 'Empty this storage structure before demolishing it.',
    buildDemolishedNotice: 'Structure demolished.',
    buildFarmGrowingNotice: (pct) => `Golden Wheat is growing (${pct}%).`,
    buildFarmHarvestedNotice: (count) => `Harvested Golden Wheat ×${count}!`,
    buildControlsHint: 'R Rotate · Tab Snap · F / Click Place · B Exit',
    buildDefaultPermLabel: 'Access',
    farmPlotTitle: 'Farm Bed Management',
    farmSoilReady: 'Fertile Tilled Soil',
    farmSoilUntilled: 'Untilled Soil — Till before planting',
    farmWateredStatus: (pct) => `Moisture: ${pct}%`,
    farmWateredRainBadge: 'Rain-Fed',
    farmWateredTroughBadge: 'Near Trough',
    farmTillSoilBtn: 'Till Soil',
    farmPlantSeedBtn: (seedName) => `Plant ${seedName}`,
    farmWaterCropBtn: 'Water Plot',
    farmWaterNeedsSourceHint: 'Carry a Watering Can or build near rain, river, or Water Trough for instant watering.',
    farmWateredBonusNotice: 'Hydrated soil accelerates crop growth.',
    farmHarvestBtn: 'Harvest Mature Crop',
    farmNoSeedsHint: 'No seeds in backpack — gather wild plants or visit a village merchant.',
    farmSeedLabel: 'Select Seed',
    farmGrowthHoursLabel: (hours) => `~${hours}h growth`,
    farmYieldLabel: (count) => `Yields ×${count}`,
    farmStageLabel: (stage) =>
      stage >= 3 ? 'Mature' : stage === 2 ? 'Tall Sprouts' : stage === 1 ? 'Seedling' : 'Empty',
    farmCropProgressLabel: (cropName, pct) => `${cropName} · ${pct}%`,
    farmTilledNotice: 'Soil tilled and ready for planting.',
    farmPlantedNotice: (cropName) => `Planted ${cropName}! Keep watered to grow faster.`,
    farmWateredNotice: 'Farm bed watered.',
    farmCropHarvestedNotice: (cropName, count, seedName, seedCount) =>
      seedCount > 0
        ? `Harvested ${cropName} ×${count} (+${seedName} ×${seedCount})!`
        : `Harvested ${cropName} ×${count}!`,
    farmAnimalCollectedNotice: (animalName, itemName, count) =>
      `Collected ${itemName} ×${count} from ${animalName}.`,
    farmAnimalFedNotice: (animalName, hoursLeft) =>
      `Fed ${animalName}! Ready in ~${hoursLeft.toFixed(1)}h.`,
    farmAnimalRestingNotice: (animalName, hoursLeft) =>
      `${animalName} is resting. Ready in ~${hoursLeft.toFixed(1)}h (feed Wheat or Animal Feed to speed up).`,
    farmFoundSeedNotice: (seedName) => `Found ${seedName}!`,
    dialogueOpenMarketBtn: 'Trade & Seeds',
    dialogueOpenVillageDevBtn: 'Village Dev',
    villageDevTitle: 'Village Development',
    villageLevelBadge: (lvl) => `Level ${lvl}`,
    villageReputationLabel: 'Reputation',
    villageRepDiscountHint: (discountPct, sellBonusPct) =>
      `Market: -${discountPct}% buy prices · +${sellBonusPct}% sell prices`,
    villageRepairsTitle: 'Community Repairs',
    villageProjectsTitle: 'Development Projects',
    villagePerksTitle: 'Unlocked Village Perks',
    villageNoPerksYet: 'Complete repairs, trade, or harvest nearby to reach Level 2.',
    villageRepairDoneBtn: 'Complete Repair',
    villageRepairCompletedBadge: 'Repaired',
    villageProjectBuildBtn: 'Build Project',
    villageProjectCompletedBadge: 'Built',
    villageProjectLockedBadge: (minLevel) => `Requires Village Lv ${minLevel}`,
    villageDefenseTitle: 'Village Defense Patrol',
    villageDefenseDesc: 'Repel bandits prowling the outskirts to earn major village XP, coins, and reputation.',
    villageDefenseStartBtn: 'Defend Village (3 Raiders)',
    villageDefenseActiveBadge: (remaining) => `${remaining} Raider(s) Remaining`,
    villageDefenseStartedNotice: (villageName, count) =>
      `${villageName} Defense started! ${count} raiders spotted at the outskirts.`,
    villageDefenseProgressNotice: (remaining) =>
      `Raider defeated! ${remaining} remaining around the village.`,
    villageDefenseWonNotice: (villageName) =>
      `${villageName} secured! Villagers cheer your defense (+130 Village XP, +65 Reputation).`,
    villageUpgradeLevelNotice: (villageName, level) =>
      `${villageName} advanced to Development Level ${level}! New market stock unlocked.`,
    villageRepairSuccessNotice: (name) => `Repair completed: ${name}!`,
    villageProjectSuccessNotice: (name) => `Village project constructed: ${name}!`,
    merchantTradeTitle: 'Village Market & Trade',
    merchantBuyTab: 'Buy Goods',
    merchantSellTab: 'Sell Harvest',
    merchantBuyBtn: 'Buy',
    merchantSellOneBtn: 'Sell 1',
    merchantSellAllBtn: 'Sell All',
    merchantLockedLevel: (minLevel) => `Village Lv ${minLevel}`,
    merchantRequiresPenHint: 'Build a Chicken Coop or Livestock Pen nearby to purchase animals.',
    merchantHasPenHint: 'Coop/Pen detected nearby — purchased livestock will move right in!',
    merchantEmptySellHint: 'No crops, animal products, or tradeable goods in your backpack.',
    merchantNotEnoughCoinsNotice: 'Not enough coins.',
    merchantBoughtNotice: (name, coins) => `Purchased ${name} for ${coins} Coins.`,
    merchantBoughtAnimalNotice: (speciesName) =>
      `Purchased ${speciesName}! Assigned to your nearest coop/pen.`,
    merchantSoldNotice: (name, count, coins) => `Sold ${name} ×${count} for +${coins} Coins.`,
    hostLanBtn: 'Host Offline LAN',
    lanWorldSourceNew: 'New World',
    lanWorldSourceSaved: 'Saved World',
    lanSelectSavedWorld: 'Select Saved World',
    lanNoSavedWorldsHint: 'No saved local worlds found yet. Create a new world to save progress automatically.',
    lanSavedWorldHostNote: 'Saved world progress updates on your device automatically. Connected guests do not save your world locally.',
    androidStorageTitle: 'Save Folder Storage',
    androidStorageStateInitialized: 'Successfully initialized',
    androidStorageStateAvailable: 'Available',
    androidStorageStatePermissionRequired: 'Permission required',
    androidStorageStateNotAccessible: 'Not accessible',
    androidStorageGrantBtn: 'Grant Access',
    androidStorageChooseFolderBtn: 'Choose Folder (SAF)',
    androidStoragePermHint: 'Grant storage permission to save worlds and settings directly inside /storage/emulated/0/World of Adventure/.',
    menuMods: 'Mods',
    tabMods: 'Mods',
    modsTitle: 'Local Mods Manager',
    modsSubtitle: 'Discover, validate, enable, disable, and manage offline data & asset mods.',
    modsFolderLabel: 'Mods Directory',
    modsOpenFolderBtn: 'Open Mods Folder',
    modsRefreshBtn: 'Refresh Mods',
    modsImportBtn: 'Import .woamod',
    modsDiscoveredLabel: 'Installed',
    modsActiveLabel: 'Enabled',
    modsIssuesLabel: 'Issues',
    modsEmptyTitle: 'No installed mods found',
    modsEmptyHint: 'Place unpacked development mod folders into the Mods directory above, or click Import .woamod to install a local .woamod package offline.',
    modsEmptyStructureHint: 'Standard structure: mod.json + items/, weapons/, recipes/, quests/, characters/, creatures/, npcs/, buildings/, models/, textures/, sounds/, music/, localization/, assets/.',
    modsStatusReady: 'Enabled',
    modsStatusDisabled: 'Disabled',
    modsStatusIncompatible: 'Unsupported Version',
    modsStatusMissingDep: 'Missing Dependency',
    modsStatusDepDisabled: 'Dependency Disabled',
    modsStatusCircularDep: 'Circular Dependency',
    modsStatusDuplicate: 'Duplicate Mod ID',
    modsStatusCorrupted: 'Corrupted Package',
    modsStatusIncomplete: 'Invalid Mod',
    modsStatusUnsafe: 'Invalid Mod (Blocked)',
    modsEnableBtn: 'Enable',
    modsDisableBtn: 'Disable',
    modsRemoveBtn: 'Remove',
    modsRemoveConfirmTitle: 'Remove Mod?',
    modsRemoveConfirmDesc: (name) =>
      `Delete "${name}" permanently from your local Mods folder?`,
    modsRemoveConfirmYes: 'Delete Mod',
    modsByAuthor: (author) => `by ${author}`,
    modsPriorityLabel: 'Load Priority',
    modsDependenciesLabel: 'Dependencies',
    modsFoldersCoverageLabel: (present, total) => `${present}/${total} folders`,
    modsContentAssetsLabel: (contentCount, assetCount) =>
      `${contentCount} data · ${assetCount} assets`,
    modsLogsTitle: 'Validation & Load Log',
    modsLogsShowBtn: 'View Logs',
    modsLogsHideBtn: 'Hide Logs',
    modsLogsClearBtn: 'Clear',
    modsLogsEmpty: 'No mod loader events recorded yet.',
    modsInstantSaveNote: 'Mod enable, disable, and priority changes apply offline and save immediately.',
    modsImportSuccessNotice: (name) => `Successful installation: "${name}" was added to your local Mods folder.`,
    modsImportErrorNotice: (err) => `Import failed: ${err}`,
    modsReloadBtn: 'Reload Mods',
    modsReloadSuccessNotice: (activeCount, issueCount) =>
      issueCount > 0
        ? `Reloaded ${activeCount} enabled mod(s) (${issueCount} mod(s) with issues skipped safely).`
        : `Reloaded ${activeCount} enabled mod(s) cleanly.`,
    modsViewDetailsBtn: 'View Details',
    modsFilterInstalled: 'Installed Mods',
    modsFilterEnabled: 'Enabled Mods',
    modsFilterDisabled: 'Disabled Mods',
    modsFilterEmptyTitle: 'No mods in this filter',
    modsFilterEmptyHint: 'Switch filters or install/enable a local mod to view entries here.',
    modsCompatibilityLabel: 'Compatibility',
    modsCompatibleBadge: 'Compatible',
    modsUnsupportedVersionBadge: 'Unsupported Version',
    modsModIdLabel: 'Mod ID',
    modsVersionLabel: 'Version',
    modsAuthorLabel: 'Author',
    modsDescriptionLabel: 'Description',
    modsNoDescription: 'No description provided in mod.json.',
    modsSupportedGameVersionLabel: 'Supported Game Version',
    modsLoadOrderLabel: 'Load Order',
    modsNoDependencies: 'None',
    modsErrorWarningTitle: 'Error & Warning Status',
    modsNoErrorsOrWarnings: 'No errors or warnings. Ready for safe loading.',
    modsSourcePathLabel: 'Source Location',
    modsContentFilesLabel: 'Data Files',
    modsAssetsFilesLabel: 'Compatible Assets',
    modsIncompatibleAssetsLabel: 'Incompatible Assets (Skipped)',
    modsFoldersLabel: 'Standard Mod Folders',
    modsCloseDetailsBtn: 'Close',
    modsClearSummaryInvalidMod: 'Invalid mod: missing or malformed mod.json or required metadata.',
    modsClearSummaryUnsupportedVersion: (required, current) =>
      `Unsupported version: requires game ${required || 'unknown'}, current version is ${current}.`,
    modsClearSummaryMissingDep: 'Missing dependency: one or more required dependency mods are unavailable, disabled, or out of range.',
    modsClearSummaryDuplicateId: 'Duplicate Mod ID: another installed mod already uses this Mod ID.',
    modsClearSummaryCorruptedPackage: 'Corrupted package: archive structure or mod data JSON could not be read safely.',
    modsClearSummaryIncompatibleAsset: (count) =>
      `Incompatible asset: ${count} unsupported or oversized asset file(s) skipped safely.`,
    modsErrorInvalidPackageName: 'Invalid mod package file. Only official .woamod packages are accepted.',
    modsErrorInvalidPackageSize: 'Package size is empty or exceeds the safe 150 MB limit.',
    modsErrorCorruptPackage: 'Corrupted package: the selected .woamod archive or its JSON data is damaged or invalid.',
    modsErrorPermissionRequired: 'Storage permission required to write inside World of Adventure/Mods/.',
    modsKindDevelopment: 'Development / Unpacked',
    modsKindWoamod: 'Installed .woamod',
    modsOriginLabel: 'Mod Format',
    modsPackageFileLabel: 'Package Archive',
    modsInstalledAtLabel: 'Installed Date',
    modsDevBadgeHint: 'Loaded directly from an unpacked folder inside Mods/',
    modsInstallProgressTitle: 'Installing .woamod Package',
    modsStageReading: 'Reading package',
    modsStageValidating: 'Validating structure & safety',
    modsStageExtracting: 'Extracting files safely',
    modsStageFinalizing: 'Finalizing installation',
    modsStageCleaningUp: 'Cleaning up incomplete files',
    modsStageCompleted: 'Installation complete',
    modsStageFailed: 'Installation failed',
    modsInstallEntriesLabel: (done, total) => `${done}/${total} files`,
    modsErrorPathTraversal: 'Security violation blocked: unsafe path traversal or symbolic link detected inside the archive.',
    modsErrorUnsafeExecutable: 'Security violation blocked: executable files or native libraries are forbidden in mods.',
    modsErrorRequiredFilesMissing: 'Invalid mod: required mod.json metadata or standard mod folders are missing.',
    modsErrorUnsupportedVersion: 'Unsupported version: this .woamod package does not support the current game version.',
    modsErrorDuplicateModId: 'Duplicate Mod ID: a mod with the same Mod ID is already installed.',
    modsErrorMissingDependency: 'Missing dependency: install and enable required dependency mods first.',
    modsErrorDepMismatch: 'Dependency conflict: an installed dependency does not match the required version.',
    modsErrorTargetExists: 'Target folder already exists inside Mods/. Remove the existing mod before reinstalling.',
    worldModsSectionTitle: 'World Mods & Isolation',
    worldModsModeVanilla: 'Vanilla World',
    worldModsModeVanillaDesc: 'No mods enabled. Completely isolated from your modded worlds.',
    worldModsModeModded: 'Select Mods',
    worldModsModeModdedDesc: 'Choose active mods and load order saved specifically with this world.',
    worldModsEmptyInstalledHint: 'No local mods installed yet. This world will start in isolated Vanilla mode.',
    worldModsEnableAllBtn: 'Enable Ready',
    worldModsClearAllBtn: 'Disable All',
    worldModsMoveUp: 'Move mod earlier in load order',
    worldModsMoveDown: 'Move mod later in load order',
    worldBadgeVanilla: 'Vanilla',
    worldBadgeModded: (count) => `${count} ${count === 1 ? 'Mod' : 'Mods'}`,
    worldRecoveryTitle: 'World Mod Check & Safe Recovery',
    worldRecoverySubtitle: (worldName) => `${worldName}`,
    worldRecoveryWarningBanner:
      'Mod configuration issues were detected before loading. Your modded items, quests, and buildings are preserved intact.',
    worldRecoveryResolvedBanner:
      'All required mods for this world are ready. You can save the updated config or launch normally.',
    worldRecoveryStatusMissing: 'Missing Mod',
    worldRecoveryStatusVersionChanged: (saved, installed) =>
      `Version Changed (Saved v${saved} -> Installed v${installed})`,
    worldRecoveryStatusIncompatible: 'Incompatible Mod',
    worldRecoveryStatusReady: 'Ready',
    worldRecoveryStatusDisabledWorld: 'Disabled for World',
    worldRecoveryStatusDisabledGlobally: 'World-Scoped (Enable on Load)',
    worldRecoverySavedVersion: (v) => `Saved v${v}`,
    worldRecoveryInstalledVersion: (v) => `Installed v${v}`,
    worldRecoveryOrphanedTitle: 'Preserved Modded Content in Save',
    worldRecoveryOrphanedDesc: (items, quests, buildings, recipes) =>
      `${items} item(s), ${quests} quest(s), ${buildings} building(s), ${recipes} recipe(s) preserved safely without deletion.`,
    worldRecoveryManageModsBtn: 'Manage / Import Mods',
    worldRecoveryRefreshBtn: 'Refresh Mods',
    worldRecoverySaveConfigBtn: 'Save World Mod Config',
    worldRecoveryConfigSavedNotice: 'Updated world mod configuration saved without altering world data.',
    worldRecoveryEnterSafeBtn: 'Safe Recovery Mode',
    worldRecoverySafeModeDesc:
      'Opens the world for inspection with autosave and destructive overwrites disabled.',
    worldRecoveryLoadAnywayBtn: 'Load World',
    worldRecoveryRemoveMissingBtn: 'Disable Entry',
    modsSafeRecoveryEnteredNotice:
      'Safe Recovery Mode active: autosave and overwrite saves are disabled to protect modded content.',
    modsSafeRecoveryReadOnlyNotice:
      'Safe Recovery Mode prevents overwriting this save slot. Use another slot to save a copy.',
    hudSafeRecoveryBadge: 'Safe Recovery (Autosave Off)',
    mpModCompatMismatchTitle: 'Mod Compatibility Required',
    mpModsVanillaBadge: 'Vanilla',
    mpModsRequiredCountBadge: (count) => `${count} ${count === 1 ? 'Mod' : 'Mods'}`,
    mpModCompatOkBadge: 'Mods Ready',
    mpModCompatBlockedHint: 'Resolve the mod differences below before entering this multiplayer world.',
    mpModPresetAppliedNotice: 'Active local mods aligned with the host configuration.',
    mpRefreshModsBtn: 'Refresh Mods',
    mpMatchRoomModsBtn: 'Match Room Mods',
    mpHostRequiredModsLabel: 'Host Mod Configuration',
    mpModIssueMissing: 'Missing Mod',
    mpModIssueDisabled: 'Installed (Disabled)',
    mpModIssueVersionMismatch: 'Version Mismatch',
    mpModIssueApiMismatch: 'API / Schema Mismatch',
    mpModIssueExtraActive: 'Extra Gameplay Mod Active',
    mpModIssueMissingDependency: 'Missing Dependency',
    mpModIssueUnsupported: 'Unsupported Version',
    mpModHostSavedMismatchHint: 'This saved world uses a different mod configuration than your currently active local mods.',
    mpModExpectedLabel: (version) => `Host: ${version}`,
    mpModLocalLabel: (version) => `Yours: ${version}`,
    mpDismissBtn: 'Dismiss',
    mpLanModStatusTitle: 'LAN Mod Compatibility',
    mpLanRequiredModsTitle: 'Required Mods',
    mpLanCompatiblePlayersTitle: 'Compatible Players',
    mpLanIncompatiblePlayersTitle: 'Incompatible Players',
    mpLanNoIncompatiblePlayers: 'No rejected join attempts.',
    mpLanVanillaNoMods: 'None (Vanilla World)',
    modsSpawnDiagnosticsTitle: 'World Spawn Rules & Diagnostics',
    modsNoSpawnRules: 'No world spawn rules declared by this mod.',
    modsSpawnConfiguredLabel: 'Configured',
    modsSpawnResolvedLabel: 'Resolved',
    modsSpawnModeLabel: 'Mode',
    modsSpawnChunkLabel: 'Chunk',
    modsSpawnInstancesLabel: 'Active',
    modsSpawnMenuPreviewHint: 'Defined in package (enter a world to evaluate live runtime coordinates)',
    modsSpawnStatusLabel: (status) => {
      switch (status) {
        case 'spawned':
          return 'Spawned';
        case 'pending_chunk':
          return 'Waiting for Chunk';
        case 'condition_unmet':
          return 'Condition Unmet';
        case 'collected':
          return 'Collected';
        case 'defeated':
          return 'Defeated';
        case 'failed':
          return 'Failed';
        default:
          return status;
      }
    },
    modsSpawnAutoY: 'auto',
    modsSpawnRotationLabel: 'Rot',
    modsSpawnScaleLabel: 'Scale',
    modsSpawnAlreadySpawnedLabel: 'Spawned',
    modsSpawnSavedLabel: 'Saved',
    modsSpawnYesLabel: 'Yes',
    modsSpawnNoLabel: 'No',
  },
  ar: {
    gameTitle: 'عالم المغامرة',
    openWorldSubtitle: 'وادي ثلاثي الأبعاد مفتوح',
    heroTagline:
      'تجوّل عبر التلال المشمسة، واستكشف غابات الصنوبر والبلوط، وتعرّف على قرية أوكهولو في عالم مفتوح حي بتقنية WebGL.',
    startAdventure: 'ابدأ المغامرة',
    titleControlsHint:
      'WASD للحركة · الفأرة للكاميرا · مسافة للقفز · Shift للركض · I للحقيبة · Esc للإيقاف',
    titleTouchControlsHint:
      'عصا اليسار للحركة · اسحب اليمين للكاميرا · أزرار القفز والهجوم والتفاعل',
    soundOn: 'الصوت مفعل',
    soundOff: 'الصوت مكتوم',
    audioOn: 'الصوت يعمل',
    muted: 'مكتوم',
    languageLabel: 'اللغة',
    loadingDefault: 'جارٍ تجهيز العالم...',
    health: 'الصحة',
    stamina: 'التحمّل',
    waterSuffix: 'ماء',
    levelShort: 'مستوى ',
    xpShort: 'خبرة',
    pressEPrefix: 'اضغط',
    pressEMiddle: 'لـ',
    desktopHint:
      'انقر على العالم لتثبيت الفأرة · اسحب للتدوير · E للتفاعل · I للحقيبة · J للمهام · F للهجوم · Esc للإيقاف',
    gamePaused: 'تم إيقاف اللعبة مؤقتًا',
    resumeAdventure: 'استئناف المغامرة',
    returnToSpawn: 'العودة إلى نقطة البداية',
    mobileTouchSettings: 'إعدادات اللمس للهاتف',
    activeStatus: 'مفعّل',
    desktopStatus: 'سطح المكتب',
    mouseSensitivity: 'حساسية الفأرة',
    invertMouseY: 'عكس محور Y للفأرة',
    controlsMove: 'الحركة',
    controlsCamera: 'الكاميرا',
    controlsJump: 'القفز',
    controlsSprint: 'الركض',
    controlsInteract: 'التفاعل',
    controlsAttack: 'الهجوم',
    controlsPackMap: 'الحقيبة / المهام / الخريطة',
    controlsPause: 'الإيقاف',
    mouseWord: 'الفأرة',
    clickWord: 'F / نقر',
    touchDetected: 'تم اكتشاف شاشة لمس',
    desktopPreviewHint: 'وضع سطح المكتب · فعّل المعاينة بالأسفل',
    reset: 'إعادة ضبط',
    forceMobileControls: 'تفعيل أزرار الهاتف دائمًا',
    forceMobileDesc: 'اعرض وجرّب أزرار اللمس على أي جهاز',
    joystickSize: 'حجم عصا التحكم',
    buttonSize: 'حجم الأزرار',
    controlOpacity: 'شفافية الأزرار والعصا',
    touchCamSensitivity: 'حساسية كاميرا اللمس',
    invertTouchY: 'عكس محور Y باللمس',
    visibleTouchButtons: 'الأزرار الظاهرة على الشاشة',
    done: 'تم',
    btnJumpLabel: 'زر القفز',
    btnAttackLabel: 'زر الهجوم',
    btnInteractLabel: 'زر التفاعل',
    btnInventoryLabel: 'زر الحقيبة',
    btnMapLabel: 'زر الخريطة',
    btnPauseLabel: 'زر الإيقاف',
    btnQuestsLabel: 'زر المهام',
    customizeControls: 'تخصيص عناصر التحكم',
    customizeBannerHint: 'اسحب للتحريك · استخدم زاوية التحديد لتغيير الحجم',
    customizeDone: 'تم',
    customizeReset: 'إعادة ضبط',
    resetControlsBtn: 'إعادة ضبط الأزرار',
    resetPortraitControls: 'إعادة ضبط الوضع العمودي',
    resetLandscapeControls: 'إعادة ضبط الوضع الأفقي',
    resetAllControls: 'إعادة ضبط الوضعين معًا',
    resetConfirmTitle: 'هل تريد إعادة مواقع عناصر التحكم إلى الإعدادات الافتراضية؟',
    resetConfirmYes: 'إعادة ضبط',
    resetConfirmCancel: 'إلغاء',
    miniMapTitle: 'خريطة مصغّرة',
    sprintActiveHint: 'الحافة الخارجية: ركض',
    saveSettingsBtn: 'حفظ الإعدادات',
    settingsSavedNotice: 'تم حفظ إعدادات التحكم باللمس.',
    enableTouchControls: 'تفعيل أزرار اللمس',
    touchOn: 'تشغيل',
    touchOff: 'إيقاف',
    controlSizeLabel: 'حجم عناصر التحكم',
    sizeSmall: 'صغير',
    sizeMedium: 'متوسط',
    sizeLarge: 'كبير',
    portraitCameraTitle: 'كاميرا الوضع العمودي',
    portraitAutoAdapt: 'ملاءمة مجال الرؤية تلقائيًا عموديًا',
    portraitFovComfort: 'اتساع الرؤية العمودية',
    fullscreenEnter: 'ملء الشاشة',
    fullscreenExit: 'إنهاء ملء الشاشة',
    selectedControlLabel: 'المحدد',
    controlSizePx: 'الحجم',
    controlPosPct: 'الموقع',
    showControlBtn: 'إظهار',
    hideControlBtn: 'إخفاء',
    hiddenTag: 'مخفي',
    portraitModeLabel: 'عمودي',
    landscapeModeLabel: 'أفقي',
    ctrlJoystick: 'عصا الحركة',
    ctrlDpad: 'أزرار الاتجاهات',
    movementControlsLabel: 'عناصر التحكم في الحركة',
    movementModeJoystick: 'عصا التحكم',
    movementModeDpad: 'أزرار الاتجاهات',
    optionSelectedBadge: 'مُحدّد',
    optionSelectBadge: 'اختيار',
    dpadUpLabel: 'التحرك للأمام',
    dpadDownLabel: 'التحرك للخلف',
    dpadLeftLabel: 'التحرك لليسار',
    dpadRightLabel: 'التحرك لليمين',
    ctrlSprint: 'الركض',
    ctrlJump: 'القفز',
    ctrlAttack: 'الهجوم',
    ctrlInteract: 'التفاعل',
    ctrlInventory: 'الحقيبة',
    ctrlMap: 'الخريطة',
    ctrlPause: 'الإيقاف',
    ctrlQuests: 'المهام',
    mobQuests: 'المهام',
    mobPack: 'الحقيبة',
    mobMap: 'الخريطة',
    mobHit: 'هجوم',
    mobJump: 'قفز',
    mobSprint: 'ركض',
    explorerPack: 'حقيبة المستكشف',
    slotsUsed: 'خانات مستخدمة',
    equippedGear: 'العتاد المجهّز',
    noEquippedSlot: 'فارغ',
    selectItemHint: 'اختر أي عنصر لمعاينة تفاصيله أو استخدامه أو تجهيزه أو إسقاطه.',
    useItem: 'استخدام',
    equipItem: 'تجهيز',
    unequipItem: 'إزالة التجهيز',
    dropItem: 'إسقاط',
    questItemLocked: 'عناصر المهام والأدوات الأساسية محفوظة ولا يمكن إسقاطها.',
    toolItemLocked: 'أدوات الاستكشاف الأساسية لا يمكن إسقاطها.',
    stackLabel: 'التكديس',
    bonusMaxHp: 'أقصى صحة',
    bonusMaxStam: 'أقصى تحمّل',
    bonusSpeed: 'سرعة الحركة',
    villageQuests: 'مهام القرية',
    emptyCategory: 'لا توجد عناصر في هذا التصنيف حاليًا.',
    inventoryFooterHint:
      'اضغط I لفتح/إغلاق الحقيبة · تحدّث مع القرويين أو استكشف الوادي لجمع المزيد.',
    worldMap: 'خريطة العالم',
    positionLabel: 'الموقع',
    northMountains: 'ش · الجبال',
    southCoastline: 'ج · الساحل',
    whiteArrowLegend: 'السهم الأبيض: المستكشف',
    goldDotsLegend: 'النقاط الذهبية: المعالم',
    mapVillageName: 'قرية أوكهولو',
    mapVillageSubtitle: 'الساحة المركزية والخدمات',
    mapVillageServiceTag: 'خدمة القرية',
    mapDiscoveredTag: 'معلم مكتشف',
    mapUndiscoveredTag: 'معلم غير مستكشف',
    mapRegionLake: 'البحيرة الهامسة',
    mapRegionDesert: 'صحراء حجر الشمس',
    mapRegionMountains: 'القمم الشمالية',
    mapRegionCoast: 'الساحل الذهبي',
    mapHerbPatchName: 'عشبة المروج',
    mapCenterPlayer: 'تمركز على اللاعب',
    mapResetView: 'إعادة العرض',
    mapZoomIn: 'تكبير',
    mapZoomOut: 'تصغير',
    mapLegendTitle: 'مفتاح الخريطة',
    mapLegendPlayer: 'موقع اللاعب واتجاهه',
    mapLegendVillage: 'القرية والخدمات',
    mapLegendQuestActive: 'هدف المهمة النشطة',
    mapLegendQuestTurnin: 'مهمة جاهزة للتسليم (؟)',
    mapLegendQuestAvailable: 'مهمة متاحة (!)',
    mapLegendLocation: 'مواقع مهمة ومعالم',
    mapLegendHerb: 'أعشاب المروج',
    mapHintControls:
      'اسحب للتحريك · عجلة الفأرة / + - للتكبير · WASD تحريك · C تمركز · M / Esc إغلاق',
    mapDistanceAway: (meters) => `على بُعد ${meters} م`,
    mapFocusMarker: 'تركيز',
    mapSelectHint: 'انقر على أي علامة للتفاصيل أو بدّل الفئات من المفتاح.',
    mapShowLegend: 'المفتاح',
    mapHideLegend: 'إخفاء المفتاح',
    questJournal: 'سجل المهام',
    levelAdventurer: (lvl) => `مغامر المستوى ${lvl}`,
    coinsLabel: 'عملة',
    tabActive: (n) => `النشطة (${n})`,
    tabCompleted: (n) => `المكتملة (${n})`,
    tabAvailable: (n) => `المتاحة (${n})`,
    emptyActiveQuests:
      'لا توجد مهام نشطة بعد. تحدّث مع سكان ساحة أوكهولو للحصول على المهام!',
    emptyCompletedQuests:
      'لم تكمل أي مهمة بعد. أنجز الأهداف وعد إلى أصحاب المهام لنيل الخبرة والعملات.',
    emptyAvailableQuests: 'لقد قبلت أو أنهيت جميع المهام المتاحة في أوكهولو حاليًا!',
    trackedBtn: 'متابَعة',
    trackHudBtn: 'تتبّع على الشاشة',
    rewardLabel: 'المكافأة:',
    lineOf: (idx, total) => `السطر ${idx} من ${total}`,
    nextLineHint: 'اضغط Enter أو مسافة أو E للمتابعة',
    chooseKeyHint: (n) => `المفاتيح 1–${n} أو الأسهم + Enter`,
    closeKeyHint: 'اضغط Enter أو Esc للإغلاق',
    closeBtn: 'إغلاق',
    nextBtn: 'التالي',
    endConversation: 'إنهاء المحادثة',
    questBadgeComplete: 'إتمام',
    questBadgeQuest: 'مهمة',
    questAvailableBadge: 'مهمة متاحة',
    questActiveBadge: 'مهمة نشطة',
    questReadyBadge: 'جاهزة للتسليم',
    questCompletedBadge: 'مهمة مكتملة',
    statsAlreadyFull: 'الصحة والتحمّل ممتلئان بالفعل.',
    usedItemNotice: (name, parts) => `تم استخدام ${name} (${parts.join('، ')}).`,
    equippedNotice: (name) => `تم تجهيز ${name}.`,
    unequippedNotice: (name) => `تمت إزالة ${name}.`,
    droppedNotice: (name, count) =>
      `تم إسقاط ${name}${count > 1 ? ` ×${count}` : ''} على الأرض.`,
    pickedUpNotice: (name, count) =>
      `تم التقاط ${name}${count > 1 ? ` ×${count}` : ''}.`,
    gatheredHerbNotice: 'تم جمع عشبة المروج (+15 صحة، وأُضيفت إلى حقيبتك).',
    packFullNotice: 'حقيبة المستكشف ممتلئة!',
    cannotDropNotice: 'لا يمكن إسقاط هذا العنصر.',
    objectiveCompletePrefix: 'هدف مكتمل',
    questCompletedPrefix: 'اكتملت المهمة',
    levelUpSuffix: (lvl) => ` · المستوى ${lvl}!`,
    readyToTurnIn: 'جاهزة للتسليم',
    readyToComplete: 'جاهزة للإتمام',
    availablePrefix: 'متاحة',
    completedWord: 'مكتملة',
    enemyDefeatedNotice: (name, xp, coins) =>
      `تم القضاء على ${name} (+${xp} خبرة، +${coins} عملة)`,
    playerDefeatedNotice:
      'سقطت في القتال — تمت استعادة عافيتك في ملاذ الوادي.',
    unarmedLabel: 'بدون سلاح',
    damageShort: 'ضرر',
    cooldownShort: 'تهدئة',
    rangeShort: 'مدى',
    rangedTag: 'بعيد',
    meleeTag: 'قريب',
    unequipShort: 'إزالة',
    weaponSwitchKeyHint: '1–9 تبديل · X إزالة',
    dayLabel: 'اليوم',
    timeControlsTitle: 'دورة الليل والنهار',
    dayLengthLabel: 'مدة اليوم الكامل',
    timeSpeedLabel: 'سرعة الزمن',
    pauseTimeLabel: 'إيقاف الوقت',
    resumeTimeLabel: 'استئناف الوقت',
    presetSunrise: 'الشروق 06:00',
    presetNoon: 'الظهيرة 12:00',
    presetSunset: 'الغروب 18:00',
    presetMidnight: 'منتصف الليل 00:00',
    secondsShort: 'ث',
    minutesShort: 'د',
    pausedTag: 'متوقف',
    weatherControlsTitle: 'الطقس الديناميكي',
    weatherDynamicLabel: 'تغيّر الطقس التلقائي',
    weatherAutoOn: 'تلقائي',
    weatherAutoOff: 'مثبت',
    weatherTransitionLabel: 'سرعة التحوّل',
    weatherQualityLabel: 'كثافة المطر',
    weatherQualityLow: 'منخفضة',
    weatherQualityMedium: 'متوسطة',
    weatherQualityHigh: 'عالية',
    weatherWindLabel: 'الرياح',
    weatherLightningBtn: 'إطلاق برق ورعد',
    weatherTransitioningTo: (target) => `يتحوّل إلى ${target}`,
    continueAdventure: 'متابعة المغامرة',
    newGame: 'لعبة جديدة',
    loadGame: 'تحميل لعبة',
    saveLoadTitle: 'خانات الحفظ والتحميل',
    quickSave: 'حفظ سريع',
    saveSlotAutosave: 'حفظ تلقائي',
    saveSlotManual: (n) => `خانة الحفظ ${n}`,
    emptySlotLabel: 'خانة فارغة',
    saveBtn: 'حفظ',
    overwriteBtn: 'استبدال',
    loadBtn: 'تحميل',
    deleteSaveBtn: 'حذف',
    confirmDeleteSave: 'تأكيد الحذف؟',
    cancelBtn: 'إلغاء',
    savedNotice: (slotLabel) => `تم حفظ التقدّم في ${slotLabel}.`,
    loadedNotice: (slotLabel) => `تم تحميل الحفظ من ${slotLabel}.`,
    deletedNotice: (slotLabel) => `تم حذف ${slotLabel}.`,
    saveFailedNotice: 'تعذر حفظ اللعبة (مساحة التخزين غير متاحة).',
    loadFailedNotice: 'تعذر تحميل بيانات الحفظ.',
    modsCompatWarningNotice: (count) =>
      `تم تحميل العالم مع ${count} تنبيه(ات) لتوافق المودات.`,
    questsCountLabel: (completed, active) =>
      `${completed} مكتملة · ${active} نشطة`,
    seedLabel: 'البذرة',
    playTimeLabel: 'المدة',
    saveSlotsFooterHint:
      'يحفظ النظام المرقم الموقع والعتاد والحقيبة والمهام وبذرة العالم والوقت والطقس وحالة العالم.',
    aiTabStory: 'القصة والمهام',
    aiTabChat: 'محادثة حرة',
    aiToggleOn: 'الذكاء الاصطناعي: مفعل',
    aiToggleOff: 'الذكاء الاصطناعي: معطل',
    aiStatusAvailable: 'Gemini متصل',
    aiStatusOffline: 'وضع الشخصية المحلي',
    aiStatusDisabled: 'الذكاء معطل',
    aiInputPlaceholder: (npcName) => `اسأل ${npcName} عن أي شيء...`,
    aiSendBtn: 'إرسال',
    aiThinking: (npcName) => `${npcName} يفكر...`,
    aiClearHistoryBtn: 'مسح المحادثة',
    aiEmptyGreeting: (npcName, location) =>
      `ابدأ محادثة حرة مع ${npcName} هنا في ${location}. سيتذكر تفاصيل حديثكما خلال هذه الجلسة.`,
    aiOfflineNote:
      'خدمة Gemini غير متاحة حاليًا — الردود المحلية المتوافقة مع الشخصية نشطة، وجميع مهام القصة تعمل كالمعتاد.',
    aiDisabledNote:
      'المحادثة بالذكاء الاصطناعي متوقفة اختياريًا. يمكنك تفعيلها من الأعلى أو متابعة القصة والمهام.',
    aiLocationLabel: 'الموقع',
    aiFallbackTag: 'محلي',
    loadInitWebgl: 'جارٍ تهيئة محرّك الرسوم WebGL...',
    loadTextures: 'جارٍ توليد خامات التضاريس والسماء...',
    loadBiomes: 'جارٍ إنشاء أقاليم العالم المفتوح...',
    loadSpawn: 'جارٍ استدعاء المغامر وتجهيز المظلّلات...',
    loadReady: 'جاهز للمغامرة',
    graphicsSettingsTitle: 'الرسوميات والأداء',
    graphicsSettingsSubtitle: 'ضبط الدقة الديناميكية ومستوى التفاصيل والإطارات',
    graphicsPresetLabel: 'مستوى الجودة',
    graphicsModeLabel: 'وضع الرسوميات',
    modeBalanced: 'متوازن',
    modePerformance: 'الأداء',
    modeQuality: 'الجودة',
    tierAuto: 'تلقائي',
    tierVeryLow: 'منخفض جدًا',
    tierLow: 'منخفض',
    tierMedium: 'متوسط',
    tierHigh: 'عالٍ',
    tierUltra: 'فائق',
    tierOff: 'إيقاف',
    renderScaleLabel: 'مقياس الرندرة',
    viewDistanceLabel: 'مسافة الرؤية',
    shadowQualityLabel: 'جودة الظلال',
    textureQualityLabel: 'جودة الخامات',
    vegetationDensityLabel: 'كثافة النباتات',
    effectsQualityLabel: 'جودة المؤثرات',
    waterQualityLabel: 'جودة المياه',
    postProcessingLabel: 'المعالجة اللاحقة',
    antiAliasingLabel: 'تنعيم الحواف',
    aaOff: 'إيقاف',
    aaFxaa: 'FXAA',
    aaMsaa: 'MSAA',
    fpsLimitLabel: 'حد الإطارات (FPS)',
    fpsUncapped: 'مفتوح',
    showDebugOverlayLabel: 'لوحة مراقبة الأداء (F3)',
    showDebugOverlayDesc: 'عرض الإطارات وسحوبات الرسم والمثلثات والذاكرة والأجزاء',
    resetGraphicsAutoBtn: 'إعادة للتلقائي',
    hardwareProfileLabel: 'العتاد المكتشف',
    effectiveTierLabel: 'الجودة الفعلية',
    dynamicAdaptTag: 'تكيّف تلقائي',
    deviceDesktop: 'سطح المكتب',
    deviceMobile: 'هاتف',
    deviceTablet: 'جهاز لوحي',
    debugPerfTitle: 'مراقب الأداء',
    debugPerfCloseHint: 'F3 للتبديل',
    debugFps: 'الإطارات',
    debugFrameTime: 'زمن الإطار',
    debugDrawCalls: 'أوامر الرسم',
    debugTriangles: 'المثلثات',
    debugGeometries: 'الأشكال الهندسية',
    debugTextures: 'الخامات',
    debugHeap: 'ذاكرة JS',
    debugObjects: 'العناصر النشطة',
    debugNpcs: 'الشخصيات النشطة',
    debugAnimals: 'الحياة البرية',
    debugChunks: 'الأجزاء (نشط/كل)',
    debugRenderScale: 'مقياس الدقة',
    debugQuality: 'الجودة',
    debugMode: 'الوضع',
    debugDevice: 'الجهاز',
    menuSubtitle: 'استكشف. انجُ. اكتشف.',
    menuNewWorld: 'عالم جديد',
    menuContinue: 'متابعة',
    menuLoadWorld: 'تحميل عالم',
    menuSettings: 'الإعدادات',
    menuExitGame: 'خروج من اللعبة',
    noSavedWorldTitle: 'لم يتم العثور على عالم محفوظ.',
    noSavedWorldDesc: 'أنشئ عالمًا جديدًا لبدء مغامرتك في وادي أوكهولو.',
    createNewWorldCta: 'إنشاء عالم جديد',
    createWorldTitle: 'إنشاء عالم جديد',
    createWorldSubtitle: 'اختر اسم العالم وبذرة التضاريس ونوع العالم ومستوى الصعوبة.',
    worldNameLabel: 'اسم العالم',
    worldNamePlaceholder: 'ملحمة أوكهولو',
    worldNameRequiredError: 'يرجى إدخال اسم للعالم.',
    worldSeedLabel: 'بذرة العالم',
    worldSeedPlaceholder: 'عشوائي أو رقم مخصص',
    randomSeedBtn: 'عشوائي',
    worldTypeLabel: 'نوع العالم',
    worldTypeNormal: 'عادي',
    worldTypeNormalDesc: 'استكشاف متوازن ومهام وقتال معتدل.',
    worldTypeAdventure: 'مغامرة',
    worldTypeAdventureDesc: 'رحلة قصصية مع مؤن وإمدادات بداية.',
    worldTypeSurvival: 'بقاء',
    worldTypeSurvivalDesc: 'تحمّل أشد وأعداء أقوى في البراري.',
    worldTypeCreative: 'إبداعي',
    worldTypeCreativeDesc: 'تحمّل غير محدود وتجوال آمن بلا ضرر.',
    difficultyLabel: 'الصعوبة',
    diffEasy: 'سهل',
    diffNormal: 'عادي',
    diffHard: 'صعب',
    createWorldBtn: 'إنشاء العالم',
    backBtn: 'رجوع',
    loadWorldTitle: 'تحميل عالم',
    loadWorldSubtitle: 'اختر عالمًا محفوظًا لاستئناف الرحلة أو إدارته.',
    noWorldsFoundTitle: 'لا توجد عوالم محفوظة بعد',
    noWorldsFoundDesc: 'أنشئ عالمًا جديدًا لحفظ تقدمك وحقيبتك ومهامك.',
    playWorldBtn: 'العب العالم',
    deleteWorldBtn: 'حذف العالم',
    deleteWorldConfirmTitle: 'حذف هذا العالم؟',
    deleteWorldConfirmDesc: 'لا يمكن التراجع عن هذا الإجراء.',
    deleteBtn: 'حذف',
    lastPlayedLabel: 'آخر لعب',
    settingsTitle: 'الإعدادات',
    settingsSubtitle: 'تخصيص الرسوميات والصوت والتحكم واللعب وسهولة الوصول.',
    tabGraphics: 'الرسوميات',
    tabAudio: 'الصوت',
    tabControls: 'التحكم',
    tabGameplay: 'اللعب',
    tabAccessibility: 'سهولة الوصول',
    applyBtn: 'تطبيق',
    resetBtn: 'إعادة ضبط',
    settingsAppliedNotice: 'تم تطبيق الإعدادات.',
    vsyncLabel: 'المزامنة الرأسية (VSync)',
    dynamicQualityLabel: 'الجودة الديناميكية',
    audioSectionTitle: 'الصوت والموسيقى',
    masterVolumeLabel: 'مستوى الصوت الرئيسي',
    musicVolumeLabel: 'مستوى الموسيقى',
    effectsVolumeLabel: 'مستوى المؤثرات الصوتية',
    ambientVolumeLabel: 'صوت البيئة المحيطة',
    uiVolumeLabel: 'صوت الواجهة',
    voiceVolumeLabel: 'الحوارات والأصوات',
    menuMusicLabel: 'موسيقى القائمة الرئيسية',
    soundEffectsLabel: 'المؤثرات الصوتية',
    audioToggleOn: 'تشغيل',
    audioToggleOff: 'إيقاف',
    fovLabel: 'مجال الرؤية (FOV)',
    showFpsLabel: 'إظهار عدّاد الإطارات',
    showHudLabel: 'إظهار واجهة اللعب',
    uiScaleLabel: 'حجم الواجهة',
    textSizeLabel: 'حجم النص',
    textSizeSmall: 'صغير',
    textSizeNormal: 'عادي',
    textSizeLarge: 'كبير',
    highContrastLabel: 'تباين عالٍ',
    reducedMotionLabel: 'تقليل الحركة',
    exitConfirmTitle: 'الخروج من عالم المغامرة؟',
    exitConfirmDesc: 'قد يُفقد أي تقدّم غير محفوظ.',
    webExitNoticeDesc: 'لإغلاق اللعبة، قم بإغلاق تبويب المتصفح هذا.',
    okBtn: 'موافق',
    pauseResume: 'استئناف',
    pauseSaveWorld: 'حفظ العالم',
    pauseSettings: 'الإعدادات',
    pauseMainMenu: 'القائمة الرئيسية',
    pauseExitGame: 'خروج من اللعبة',
    unsavedMainMenuTitle: 'العودة إلى القائمة الرئيسية؟',
    unsavedMainMenuDesc: 'يوجد تقدّم غير محفوظ في هذا العالم.',
    saveAndExitBtn: 'حفظ وخروج',
    discardAndExitBtn: 'خروج دون حفظ',
    worldAndTimeTools: 'أدوات العالم والوقت والطقس',
    craftTab: 'التصنيع',
    craftBtn: 'تصنيع',
    craftCategoryAll: 'الكل',
    craftCategoryCamp: 'المخيم والعتاد',
    craftCategoryWeapon: 'الأسلحة',
    craftCategoryTools: 'الأدوات',
    craftCategoryArmor: 'الدروع',
    craftCategoryClothing: 'الملابس',
    craftCategoryBuilding: 'البناء',
    craftCategoryMaterial: 'المواد الخام',
    craftCategoryProvisions: 'المؤن',
    craftStationHand: 'يدويًا',
    craftStationTable: 'طاولة الصناعة',
    craftStationForge: 'الحدّادة',
    craftStationFurnace: 'فرن الصهر',
    craftStationWorkbench: 'طاولة الحرفي',
    craftStatusAvailable: 'متاح',
    craftStatusMissing: 'مواد ناقصة',
    craftStatusLocked: 'مقفل',
    craftLockStation: (stationName) => `يتطلب الاقتراب من ${stationName}`,
    craftLockLevel: (lvl) => `يتطلب المستوى ${lvl}`,
    craftLockTool: (toolLabel) => `يتطلب ${toolLabel}`,
    craftLockPrereq: (prereqName) => `اصنع ${prereqName} أولًا`,
    craftLockStory: 'أكمل فصل القصة الرئيسية المطلوب أولًا',
    availableStationsLabel: 'المحطات القريبة النشطة',
    craftDurationSec: (sec) => `${sec.toFixed(1)} ث`,
    craftingInProgress: 'جارٍ التصنيع...',
    craftMaterialsNeeded: 'المواد المطلوبة',
    craftedNotice: (name, count) =>
      `تم تصنيع ${name}${count > 1 ? ` ×${count}` : ''}.`,
    craftedFailIngredients: 'تنقصك المواد المطلوبة للتصنيع.',
    sleepTransitionLabel: 'جارٍ النوم...',
    goodMorningNotice: 'صباح الخير.',
    cannotSleepDayNotice: 'يمكنك النوم فقط في المساء أو الليل.',
    bedPlacedNotice: 'تم وضع سرير التخييم. تفاعل معه ليلًا للنوم حتى الصباح.',
    portraitRecommendationText:
      'إذا أردت اللعب بشكل أفضل، اجعل الهاتف عموديًا لتجربة أكثر سلاسة ومتعة.',
    portraitRecommendationDismissAria: 'إخفاء نصيحة الوضع العمودي',
    updateAvailableTitle: 'تحديث جديد متوفر!',
    updateAvailableBody:
      'قم بتحديث اللعبة للاستمتاع بالمزايا الجديدة وإصلاح الأخطاء وتحسين تجربة اللعب.',
    updateCurrentVersionLabel: 'الإصدار الحالي',
    updateNewVersionLabel: 'الإصدار الجديد',
    updateNowBtn: 'تحديث الآن',
    updateCloseBtn: 'إغلاق',
    updateDontShowAgainBtn: 'لا تظهر هذه الرسالة مرة أخرى',
    bedCannotPlaceNotice: 'لا يمكن وضع السرير فوق الماء أو المنحدرات الحادة.',
    placeBedBtn: 'وضع السرير',
    placeStationBtn: 'وضع المحطة',
    stationPlacedNotice: (name) => `تم وضع ${name} قريبًا. اقترب واضغط E للتصنيع.`,
    stationCannotPlaceNotice: 'لا يمكن وضع المحطة فوق الماء أو المنحدرات الحادة.',
    toolRequiredNotice: (toolLabel, resourceName) =>
      `يتطلب ${toolLabel} لاستخراج ${resourceName}.`,
    toolBrokenNotice: (name) => `انكسر ${name} بسبب الاستهلاك!`,
    durabilityShort: 'المتانة',
    bonusCapacity: 'سعة الحقيبة',
    toolPickaxeTier1: 'معول حجري أو أفضل',
    toolPickaxeTier2: 'معول حديدي أو أفضل',
    toolAxeName: 'فأس',
    toolPickaxeName: 'معول',
    toolShovelName: 'مجرفة',
    toolTierLabel: (tier) => `المستوى ${tier}`,
    durabilityLabel: 'المتانة',
    weaponBrokenNotice: (name) => `انكسر ${name} بسبب الاستهلاك!`,
    weaponsRepairedNotice: (cost) =>
      cost > 0 ? `تم إصلاح الأسلحة (-${cost} عملة).` : 'تم إصلاح الأسلحة.',
    repairNeedCoinsNotice: (cost) =>
      `تحتاج ${cost} عملة أو لا توجد أسلحة تالفة للإصلاح.`,
    chestOpenedNotice: (label, summary) => `تم فتح ${label}: ${summary}.`,
    harvestedResourceNotice: (name, count) => `تم جمع ${name} +${count}.`,
    damageReductionLabel: 'الدفاع',
    staminaUnlimitedLabel: '∞ غير محدود',
    staminaModeBadge: (maxLabel) => `التحمّل: ${maxLabel}`,
    pauseMap: 'الخريطة',
    miniMapOrientationLabel: 'اتجاه الخريطة المصغّرة',
    miniMapNorthUp: 'الشمال للأعلى',
    miniMapRotating: 'تدور مع اللاعب',
    waypointLabel: 'نقطة توجيه',
    setWaypointPrompt: 'تعيين نقطة توجيه؟',
    setWaypointBtn: 'تعيين نقطة توجيه',
    removeWaypointBtn: 'إزالة نقطة التوجيه',
    waypointSetNotice: 'تم وضع نقطة التوجيه على الخريطة.',
    waypointRemovedNotice: 'تمت إزالة نقطة التوجيه.',
    mapLegendWaypoint: 'نقطة التوجيه الشخصية',
    mapLegendUnexplored: 'منطقة غير مستكشفة',
    bowChargeLabel: 'الشحن',
    bowMaxLabel: 'أقصى',
    bowCancelledNotice: 'تم إلغاء رمية القوس.',
    mobAim: 'تصويب',
    mobShoot: 'إطلاق',
    bowPowerTitle: 'قوة القوس',
    bowTierWeak: 'ضعيفة',
    bowTierLow: 'منخفضة',
    bowTierStrong: 'قوية',
    bowTierMaximum: 'قصوى',
    bowNoArrowsNotice: 'نفدت السهام! يمكنك صناعة سهام من الحقيبة.',
    bowNoArrowsShort: 'لا توجد سهام',
    bowHeadshotNotice: 'إصابة في الرأس!',
    bowNpcWarningNotice: 'انتبه للتصويب! أهل القرية مسالمون.',
    showBowTrajectoryLabel: 'إظهار مسار السهم',
    bowCancelHint: 'انقر يميناً أو C للإلغاء',
    arrowsLabel: 'السهام',
    villageDiscoveredNotice: (name) => `تم اكتشاف القرية: ${name}`,
    mapLegendResource: 'موارد الطبيعة',
    showWorldGenDebugLabel: 'مصحح توليد العالم',
    footstepVolumeLabel: 'صوت خطوات اللاعب',
    cameraSettingsTitle: 'الكاميرا والمنظور',
    cameraPerspectiveLabel: 'منظور الكاميرا',
    perspectiveFirstPerson: 'منظور الشخص الأول',
    perspectiveSecondPerson: 'منظور الشخص الثاني',
    perspectiveThirdPerson: 'منظور الشخص الثالث',
    perspectiveShort1p: '1P',
    perspectiveShort2p: '2P',
    perspectiveShort3p: '3P',
    cameraSensitivityLabel: 'حساسية الكاميرا',
    cameraDistanceLabel: 'مسافة الكاميرا',
    cameraHeightLabel: 'ارتفاع الكاميرا',
    cameraSmoothingLabel: 'نعومة الكاميرا',
    cameraInvertYLabel: 'عكس محور الكاميرا الرأسي',
    indicatorOffsetTitle: 'إزاحة مؤشر التفاعل',
    indicatorOffsetXLabel: 'إزاحة المؤشر X (جانبي)',
    indicatorOffsetYLabel: 'إزاحة المؤشر Y (عمودي)',
    indicatorOffsetZLabel: 'إزاحة المؤشر Z (عمق)',
    weatherMaxDurationLabel: 'المدة القصوى للطقس',
    btnCameraLabel: 'تبديل الكاميرا',
    ctrlCamera: 'كاميرا',
    mobCamera: 'منظور',
    cameraPerspectiveNotice: (mode) =>
      `منظور الكاميرا: ${mode === 'first-person' ? 'الشخص الأول' : mode === 'second-person' ? 'الشخص الثاني' : 'الشخص الثالث'}`,
    showBiomeDebugLabel: 'إظهار مصحح المناطق الحيوية',
    biomeDebugPrefix: 'المنطقة الحيوية',
    menuMultiplayer: 'اللعب الجماعي',
    mpSubtitle: 'غرف اللعب المشترك ومتصفح الغرف والأصدقاء والدعوات.',
    mpCreateRoom: 'إنشاء غرفة',
    mpJoinRoom: 'دخول غرفة',
    mpQuickJoin: 'دخول سريع',
    mpFriends: 'الأصدقاء',
    mpInvites: 'الدعوات',
    mpReady: 'جاهز',
    mpReadyActive: 'جاهز ✓',
    mpNotReady: 'غير جاهز',
    mpStartGame: 'بدء اللعبة',
    mpLeaveRoom: 'مغادرة الغرفة',
    mpPlayerNameLabel: 'اسم اللاعب',
    mpPlayerNamePlaceholder: 'مغامر',
    mpRoomNameLabel: 'اسم الغرفة',
    mpRoomNamePlaceholder: 'رحلة وادي أوكهولو',
    mpRoomNameRequired: 'يرجى إدخال اسم الغرفة.',
    mpRoomCodeLabel: 'رمز الغرفة',
    mpRoomCodePlaceholder: 'مثال: A7K9P2',
    mpRoomCodeRequired: 'يرجى إدخال رمز الغرفة.',
    mpMaxPlayersLabel: 'الحد الأقصى للاعبين',
    mpPrivacyLabel: 'خصوصية الغرفة',
    mpPrivacyPublic: 'عامة',
    mpPrivacyFriends: 'الأصدقاء فقط',
    mpPrivacyPrivate: 'خاصة',
    mpPasswordLabel: 'كلمة المرور (اختياري)',
    mpPasswordOptionalPlaceholder: 'اتركه فارغًا بدون كلمة مرور',
    mpRoomBrowserTitle: 'متصفح الغرف',
    mpSearchRoomsPlaceholder: 'ابحث باسم الغرفة أو المضيف...',
    mpRefreshBtn: 'تحديث',
    mpNoRoomsTitle: 'لا توجد غرف متاحة حاليًا',
    mpNoRoomsDesc:
      'ستظهر الغرف العامة النشطة هنا فور ربط خادم Cloudflare Workers و Durable Objects.',
    mpFriendsSubtitle: 'إدارة الأصدقاء المتصلين وإرسال دعوات الغرف.',
    mpAddFriendPlaceholder: 'أدخل اسم أو معرّف اللاعب...',
    mpAddFriendBtn: 'إضافة',
    mpNoFriendsTitle: 'لا يوجد أصدقاء مضافون بعد',
    mpNoFriendsDesc:
      'أضف اسم صديق أعلاه لتتمكن من دعوته سريعًا إلى غرفك.',
    mpInvitesSubtitle: 'دعوات غرف اللعب الجماعي الواردة.',
    mpNoInvitesTitle: 'لا توجد دعوات معلّقة',
    mpNoInvitesDesc:
      'ستظهر دعوات الأصدقاء للانضمام إلى غرفهم هنا عند تفعيل الخادم.',
    mpAcceptBtn: 'قبول',
    mpDeclineBtn: 'رفض',
    mpInviteBtn: 'دعوة',
    mpLobbyTitle: 'صالة الغرفة',
    mpPlayerListTitle: 'قائمة اللاعبين',
    mpHostLabel: 'المضيف',
    mpYouLabel: 'أنت',
    mpOpenSlotLabel: 'مكان شاغر',
    mpCopyCodeBtn: 'نسخ الرمز',
    mpCodeCopiedNotice: 'تم نسخ رمز الغرفة.',
    mpPlayersCount: (current, max) => `${current} / ${max} لاعبين`,
    mpServerStatusDisconnected:
      'خادم اللعب الجماعي: غير متصل (Cloudflare Workers + Durable Objects)',
    mpServerNoticeBanner:
      'واجهة اللعب الجماعي جاهزة. ستعمل الغرف المباشرة والمطابقة فور ربط خادم Cloudflare Workers و Durable Objects.',
    mpQuickJoinUnavailable:
      'الدخول السريع غير متاح حتى يتم ربط خادم اللعب الجماعي.',
    mpJoinRequiresBackend:
      'الانضمام إلى الغرف البعيدة يتطلب ربط خادم Cloudflare Workers و Durable Objects.',
    mpStartRequiresBackend:
      'بدء جلسة اللعب الجماعي يتطلب ربط خادم Cloudflare Workers و Durable Objects.',
    mpFriendActionRequiresBackend:
      'طلبات الصداقة والدعوات تتطلب ربط خادم اللعب الجماعي.',
    mpLocalLobbyPreviewNotice:
      'وضع معاينة الصالة — سيتمكن اللاعبون عن بُعد من الانضمام فور ربط خادم Cloudflare Workers و Durable Objects.',
    mpGameModeLabel: 'نمط اللعب',
    mpPrivateRoomLabel: 'غرفة خاصة',
    mpAllowFriendsLabel: 'السماح للأصدقاء',
    mpToggleOn: 'مفعّل',
    mpToggleOff: 'معطّل',
    mpRoomLabel: 'الغرفة',
    mpPlayersShort: (current, max) => `اللاعبون: ${current}/${max}`,
    mpInviteFriends: 'دعوة الأصدقاء',
    mpKickPlayer: 'طرد اللاعب',
    mpCloseRoom: 'إغلاق الغرفة',
    mpRoomLockedLabel: 'الغرفة مقفلة',
    mpCreatingRoom: 'جارٍ إنشاء الغرفة...',
    mpStartingGame: 'جارٍ بدء اللعبة...',
    mpServerStatusConnected:
      'خادم اللعب الجماعي: متصل (Cloudflare Workers + Durable Objects)',
    mpBackendRequiredForCreate:
      'خادم اللعب الجماعي غير مهيأ. يرجى ضبط المتغير VITE_MULTIPLAYER_URL.',
    mpNotConfiguredTitle: 'خادم اللعب الجماعي غير مهيأ.',
    mpNotConfiguredHint: 'يرجى ضبط المتغير VITE_MULTIPLAYER_URL.',
    mpStatusConnecting: 'جارٍ الاتصال...',
    mpStatusConnected: 'متصل',
    mpStatusDisconnected: 'غير متصل',
    mpStatusServerUnavailable: 'الخادم غير متاح',
    mpStatusReconnecting: 'إعادة الاتصال...',
    mpHostTransferredNotice: (newHostName) =>
      `غادر المضيف السابق. أصبح ${newHostName} مضيف الغرفة الآن.`,
    mpKickedNotice: 'تمت إزالتك من الغرفة بواسطة المضيف.',
    mpPlayerKickedNotice: (name) => `تم طرد ${name} من الغرفة.`,
    mpRoomClosedNotice: 'أغلق المضيف الغرفة.',
    mpStartingWorldNotice: (roomCode, modeLabel) =>
      `بدء عالم اللعب الجماعي · الغرفة ${roomCode} · ${modeLabel}`,
    mpEnterRoomCodeLabel: 'أدخل رمز الغرفة',
    mpRoomLinkLabel: 'رابط الغرفة',
    mpCopyLinkBtn: 'نسخ الرابط',
    mpShareBtn: 'مشاركة',
    mpLinkCopiedNotice: 'تم نسخ رابط الغرفة.',
    mpInviteFriendsSubtitle: 'شارك رمز أو رابط الغرفة، أو أرسل دعوة مباشرة لصديق.',
    mpInviteTargetPlaceholder: 'أدخل اسم اللاعب الصديق...',
    mpSendInviteBtn: 'إرسال دعوة',
    mpInviteSentNotice: (name) => `تم إرسال الدعوة إلى ${name}.`,
    mpInvitedToPlayNotification: (name) => `دعاك ${name} للعب.`,
    mpErrorRoomNotFound: 'الغرفة لم تعد موجودة.',
    mpErrorRoomFull: 'الغرفة ممتلئة.',
    mpErrorGameAlreadyStarted: 'اللعبة قد بدأت بالفعل',
    mpErrorUnableToConnect: 'تعذّر الاتصال بخادم اللعب الجماعي.',
    mpErrorRoomCreationFailed: 'فشل إنشاء الغرفة.',
    mpVerifyingRoom: 'جارٍ التحقق من الغرفة...',
    mpRemoveFriendBtn: 'إزالة',
    mpRequireAllReadyLabel: 'اشتراط جاهزية جميع اللاعبين',
    mpTransferHost: 'نقل الاستضافة',
    mpConnectionQualityLabel: 'الاتصال',
    mpQualityExcellent: 'ممتاز',
    mpQualityGood: 'جيد',
    mpQualityPoor: 'ضعيف',
    mpQualityDisconnected: 'غير متصل',
    mpPingUnit: 'مللي ثانية',
    mpWaitingForReadyHint: (ready, total) =>
      `بانتظار جاهزية جميع اللاعبين (${ready}/${total})`,
    mpWorldSeedLabel: 'بذرة العالم',
    mpAuthoritativeConfigBadge: 'إعدادات عالم معتمدة من الخادم',
    mpRoomChatTitle: 'دردشة الغرفة',
    mpRoomChatOpenBtn: 'الدردشة (T)',
    mpRoomChatPlaceholder: 'اكتب رسالة إلى أعضاء الغرفة...',
    mpRoomChatSendBtn: 'إرسال',
    mpRoomChatEmpty: 'لا توجد رسائل بعد. رحّب برفاقك في الغرفة!',
    mpRoomChatSpamNotice: 'تمهّل قليلًا قبل إرسال رسالة أخرى.',
    mpRoomChatDuplicateNotice: 'يرجى عدم تكرار نفس الرسالة.',
    mpRoomChatTooLongNotice: (max) => `لا يمكن أن تتجاوز الرسالة ${max} حرفًا.`,
    mpRoomChatDisconnectedNotice: 'الدردشة متوقفة مؤقتًا حتى يتم الاتصال بالغرفة.',
    mpRoomChatMutedSuppressed: (count) =>
      `تم إخفاء ${count} ${count === 1 ? 'رسالة' : 'رسائل'} من لاعبين مكتومين أو محظورين.`,
    mpRoomChatTabsChat: 'دردشة الغرفة',
    mpRoomChatTabsPlayers: 'اللاعبون',
    mpActionViewProfile: 'عرض الملف الشخصي',
    mpActionInvite: 'دعوة',
    mpActionMute: 'كتم',
    mpActionUnmute: 'إلغاء الكتم',
    mpActionBlock: 'حظر',
    mpActionUnblock: 'إلغاء الحظر',
    mpActionReport: 'إبلاغ',
    mpActionAddFriend: 'إضافة صديق',
    mpActionRemoveFriend: 'إزالة صديق',
    mpBadgeMuted: 'مكتوم',
    mpBadgeBlocked: 'محظور',
    mpBadgeFriend: 'صديق',
    mpProfileTitle: 'ملف اللاعب',
    mpProfileRoleLabel: 'الدور في الغرفة',
    mpProfileRoleHost: 'مضيف الغرفة',
    mpProfileRolePlayer: 'عضو الغرفة',
    mpProfileStatusLabel: 'الحالة',
    mpProfileHealthLabel: 'الصحة',
    mpProfileJoinedAtLabel: 'وقت الانضمام',
    mpProfileLocalSocialNote:
      'قائمة الأصدقاء والحظر محلية حاليًا (وتتوافق مع مزامنة الحسابات مستقبلًا دون تغيير الشبكة).',
    mpPlayerMutedNotice: (name) => `تم كتم ${name}. سيتم إخفاء رسائله في الدردشة.`,
    mpPlayerUnmutedNotice: (name) => `تم إلغاء كتم ${name}.`,
    mpPlayerBlockedNotice: (name) => `تم حظر ${name}. سيتم إخفاء رسائله ودعواته.`,
    mpPlayerUnblockedNotice: (name) => `تم إلغاء حظر ${name}.`,
    mpFriendAddedNotice: (name) => `تمت إضافة ${name} إلى قائمة الأصدقاء.`,
    mpReportTitle: 'الإبلاغ عن لاعب',
    mpReportSubtitle: (name) => `إرسال بلاغ إشراف عن ${name} داخل هذه الغرفة.`,
    mpReportReasonLabel: 'السبب',
    mpReportReasonSpam: 'إزعاج أو رسائل متكررة',
    mpReportReasonHarassment: 'إساءة أو مضايقة في الدردشة',
    mpReportReasonCheating: 'غش أو استغلال ثغرات',
    mpReportReasonInappropriateName: 'اسم لاعب غير لائق',
    mpReportReasonInappropriateProfile: 'ملف شخصي أو صورة غير لائقة',
    mpReportReasonOther: 'سبب آخر',
    mpReportDetailsLabel: 'تفاصيل إضافية (اختياري)',
    mpReportDetailsPlaceholder: 'اشرح باختصار ما حدث...',
    mpReportSubmitBtn: 'إرسال البلاغ',
    mpReportSubmittedNotice: (name) => `تم إرسال البلاغ ضد ${name}.`,
    mpReportDuplicateNotice: 'لقد قمت بالإبلاغ عن هذا اللاعب في هذه الغرفة بالفعل.',
    mpConnectionLostTitle: 'انقطع الاتصال',
    mpReconnectingSubtitle: 'انقطع الاتصال. جارٍ إعادة الاتصال...',
    mpReconnectAttemptLabel: (attempt, max) => `المحاولة ${attempt} من ${max}`,
    mpReconnectFailedTitle: 'انقطع الاتصال',
    mpReconnectFailedDesc:
      'تعذّرت إعادة الاتصال بغرفة اللعب الجماعي بعد عدة محاولات.',
    mpRetryConnectionBtn: 'إعادة المحاولة',
    mpReturnToMenuBtn: 'قائمة اللعب الجماعي',
    mpRoomClosedReturnNotice: 'تم إغلاق الغرفة. جارٍ العودة إلى قائمة اللعب الجماعي.',
    mpOfflineCannotConnectNotice:
      'لا يوجد اتصال بالإنترنت. يرجى التحقق من الشبكة والمحاولة مرة أخرى.',
    showPlayerNamesLabel: 'إظهار أسماء اللاعبين',
    profileCreateTitle: 'أنشئ ملفك الشخصي',
    profileCreateSubtitle: 'أنشئ هويتك الدائمة كمغامر قبل الدخول إلى غرف اللعب الجماعي.',
    profilePictureLabel: 'صورة الملف الشخصي',
    profileSelectAvatarTitle: 'الصورة الرمزية',
    profilePresetsTab: 'صور جاهزة',
    profileGeneratedTab: 'مُولّدة',
    profileUploadTab: 'رفع صورة',
    profileChooseFileBtn: 'اختر صورة (PNG أو JPEG أو WebP)',
    profileUploadHint: 'يتم القص تلقائيًا إلى 128×128 بكسل · الحد الأقصى 5 ميجابايت · دون نصوص ضارة.',
    profileUploadTooLargeErr: 'حجم الصورة يتجاوز الحد المسموح. اختر صورة أصغر.',
    profileUploadInvalidFormatErr: 'صيغة الملف غير مدعومة. اختر صورة PNG أو JPEG أو WebP صالحة.',
    profileUploadDecodeErr: 'تعذّر قراءة ملف الصورة.',
    profileAvatarSavedBtn: 'اعتماد الصورة',
    profileChangeAvatarBtn: 'تغيير الصورة',
    profilePlayerNameLabel: 'اسم اللاعب',
    profilePlayerNameHint: 'من 3 إلى 20 حرفًا · يدعم العربية والإنجليزية والأرقام.',
    profilePlayerIdLabel: 'معرّف اللاعب',
    profilePermanentBadge: 'دائم',
    profileIdImmutableNote: 'معرّف فريد دائم يُعيَّن من الخادم ولا يمكن تعديله.',
    profilePlayerTagLabel: 'وسم اللاعب (اختياري)',
    profileBioLabel: 'نبذة عنك (اختياري)',
    profileBioPlaceholder: 'اكتب نبذة قصيرة عن أسلوب لعبك...',
    profileCountryLabel: 'الدولة / المنطقة (اختياري)',
    profileCountryPlaceholder: 'مثال: السعودية، الأردن، مصر...',
    profileFavoriteModeLabel: 'نمط اللعب المفضّل',
    profileStatusLabel: 'الحالة',
    profileStatusOnline: 'متصل',
    profileStatusInGame: 'في اللعبة',
    profileStatusAway: 'بعيد',
    profileStatusOffline: 'غير متصل',
    profileCreateSubmitBtn: 'إنشاء الملف الشخصي',
    profileSavingBtn: 'جارٍ الحفظ...',
    profileEditBtn: 'تعديل الملف',
    profileSaveBtn: 'حفظ التغييرات',
    profileCancelEditBtn: 'إلغاء',
    profileStatisticsTitle: 'الإحصائيات',
    profileStatLevel: 'المستوى',
    profileStatExperience: 'الخبرة',
    profileStatPlayTime: 'وقت اللعب',
    profileStatWorldsCreated: 'العوالم المنشأة',
    profileStatWorldsJoined: 'العوالم المنضم إليها',
    profileStatQuestsCompleted: 'المهام المكتملة',
    profileStatEnemiesDefeated: 'الأعداء المهزومون',
    profileStatAnimalsDefeated: 'الحيوانات المصطادة',
    profileStatVillagesDiscovered: 'القرى المكتشفة',
    profileStatResourcesCollected: 'الموارد المجموعة',
    profileStatDistanceTraveled: 'المسافة المقطوعة',
    profilePrivacyTitle: 'الخصوصية والظهور عبر الإنترنت',
    profilePrivacyShowOnline: 'إظهار حالة الاتصال',
    profilePrivacyShowNames: 'إظهار أسماء اللاعبين فوق الشخصيات',
    profilePrivacyAllowFriends: 'السماح بطلبات الصداقة',
    profilePrivacyAllowInvites: 'السماح بدعوات الغرف',
    profilePrivacyAllowMessages: 'الرسائل المباشرة',
    profileMsgPrivacyEveryone: 'الجميع',
    profileMsgPrivacyFriends: 'الأصدقاء فقط',
    profileMsgPrivacyNobody: 'لا أحد',
    profileBlockedPlayersTitle: 'اللاعبون المحظورون',
    profileCopyIdBtn: 'نسخ المعرّف',
    profileIdCopiedNotice: 'تم نسخ معرّف اللاعب.',
    profileSearchPlayerTitle: 'البحث عن لاعب',
    profileSearchPlayerPlaceholder: 'ابحث بمعرّف اللاعب (WA-...) أو الاسم#الوسم أو #الوسم أو الاسم...',
    profileSearchBtn: 'بحث',
    profileNoSearchResults: 'لم يتم العثور على لاعبين مطابقين.',
    profileFriendRequestsIncoming: 'طلبات الصداقة الواردة',
    profileFriendRequestsOutgoing: 'الطلبات المرسلة',
    profileSendFriendRequestBtn: 'إضافة صديق',
    profileCancelRequestBtn: 'إلغاء الطلب',
    profilePendingRequestBadge: 'تم إرسال الطلب',
    profileDirectMessageBtn: 'رسالة خاصة',
    profileDirectMessagesTitle: 'الرسائل المباشرة',
    profileDmPlaceholder: 'اكتب رسالة خاصة...',
    profileDmEmpty: 'لا توجد رسائل بعد.',
    profileDmUnavailable: 'يتطلب إرسال الرسائل المباشرة اتصالًا بالخادم.',
    profileViewFullProfileBtn: 'الملف الشخصي الكامل',
    profileOpenBtn: 'الملف الشخصي',
    profileInviteToastText: (name, tag, roomName) =>
      `دعاك ${name}${tag ? ` #${tag}` : ''} إلى: ${roomName}`,
    profileFriendsCategoryOnline: 'متصل',
    profileFriendsCategoryInGame: 'في اللعبة',
    profileFriendsCategoryOffline: 'غير متصل',
    profilePagePrev: 'السابق',
    profilePageNext: 'التالي',
    mapLegendFriend: 'صديق',
    mapLegendRoomPlayer: 'لاعب في الغرفة',
    showFriendsOnMapLabel: 'إظهار الأصدقاء ولاعبي الغرفة على الخريطة',
    mpWorldSettingsPermissionLabel: 'التحكم في الوقت والطقس',
    mpWorldSettingsHostOnly: 'المضيف فقط',
    mpWorldSettingsAllPlayers: 'جميع اللاعبين',
    mpWorldSettingsHostOnlyNotice: 'يمكن لمضيف الغرفة فقط تغيير الوقت والطقس حالياً.',
    mpErrorRoomExpired: 'انتهت صلاحية هذه الغرفة بعد 72 ساعة من عدم النشاط.',
    showPartyMembersOnMapLabel: 'إظهار أعضاء الفريق على الخريطة',
    mapLegendPartyMember: 'عضو الفريق',
    mapLegendCoopObjective: 'هدف تعاوني',
    partyTitle: 'فريق المغامرة',
    partySubtitle: 'نسّق مع حلفائك في أوكهولو دون مشاركة الغنائم أو نقاط الخبرة الشخصية',
    partyBtnLabel: 'الفريق',
    partyCreateBtn: 'إنشاء فريق',
    partyLeaveBtn: 'مغادرة الفريق',
    partyNoPartyTitle: 'لا يوجد فريق نشط',
    partyNoPartyDesc: 'كوّن فريقًا تعاونيًا لتتبع الحلفاء على الخريطة وتحفيز حراس القرية وخوض أهداف مشتركة.',
    partyLeaderBadge: 'القائد',
    partyMemberTag: 'حليف الفريق',
    partyMembersCount: (count, max) => `${count}/${max} أعضاء`,
    partyReadyBtn: 'تأكيد الجاهزية',
    partyReadyActive: 'جاهز',
    partyNotReady: 'يستعد',
    partyKickBtn: 'إزالة',
    partyTransferLeaderBtn: 'نقل القيادة',
    partyInviteTitle: 'دعوة الأصدقاء ولاعبي الغرفة',
    partyInviteBtn: 'دعوة',
    partyInvitedBadge: 'تمت الدعوة',
    partyPendingInvitesTitle: 'دعوات الفريق المعلقة',
    partyInviteReceivedNotice: (fromName) => `دعاك ${fromName} للانضمام إلى فريقه!`,
    partyCreatedNotice: 'تم تشكيل فريق المغامرة!',
    partyJoinedNotice: 'انضممت إلى الفريق!',
    partyLeftNotice: 'غادرت الفريق.',
    partyLeaderTransferredNotice: (name) => `أصبح ${name} قائد الفريق الآن.`,
    partyDuplicateInviteNotice: 'توجد دعوة معلقة بالفعل لهذا اللاعب.',
    partyFullNotice: 'وصل الفريق إلى الحد الأقصى للغرفة.',
    partyFriendlyFireLabel: 'نيران صديقة',
    partyFriendlyFireOnDesc: 'يمكن لأعضاء الفريق إلحاق الضرر ببعضهم',
    partyFriendlyFireOffDesc: 'لا يمكن لأعضاء الفريق إيذاء بعضهم البعض',
    partyFriendlyFireBlockedNotice: 'النيران الصديقة معطلة — أعضاء الفريق محميون.',
    partyDistanceMeters: (m) => `${m}م`,
    coopObjectiveTitle: 'الأهداف التعاونية',
    coopObjectiveStartBtn: 'بدء الهدف',
    coopObjectiveCancelBtn: 'إلغاء',
    coopObjectiveLeaderOnlyHint: 'يمكن لقائد الفريق فقط بدء الأهداف التعاونية أو إلغاؤها.',
    coopObjectiveActiveLabel: 'الهدف النشط',
    coopObjectiveCompletedNotice: (title, xp, coins) =>
      `اكتمل الهدف التعاوني: ${title}! حصلت على ${xp} خبرة و${coins} عملة.`,
    coopObjectiveStartedNotice: (title) => `بدأ الهدف التعاوني: ${title}`,
    coopObjectiveNoneActive: 'لا يوجد هدف تعاوني نشط.',
    coopTypeKillBoss: 'القضاء على الزعيم / اللصوص',
    coopTypeProtectVillage: 'حماية القرية',
    coopTypeCollectResources: 'جمع الموارد',
    coopTypeEscortNpc: 'مرافقة شيخ القرية',
    coopTypeExploreLocation: 'استكشاف الموقع الحدودي',
    coopTypeOpenDungeon: 'فتح بوابات القبو',
    questScopePersonal: 'فردية',
    questScopeCoop: 'تعاونية',
    questStartCoopBtn: 'بدء المهمة التعاونية',
    questClaimRewardBtn: 'استلام المكافأة الشخصية',
    questCoopActiveHint: 'تقدّم مشترك للفريق · مكافآت شخصية لكل لاعب',
    questCoopContributors: (count) => `${count} مشاركين`,
    coopQuestsSectionTitle: 'مهام الفريق التعاونية',
    bossTargetLabel: (name) => `الهدف: ${name}`,
    bossPhaseLabel: (phase) => `المرحلة ${phase}`,
    bossStateLabel: (state) => {
      switch (state) {
        case 'windup_slam':
          return 'ضربة زلزالية';
        case 'windup_strike':
          return 'ضربة ثقيلة';
        case 'enraged_roar':
          return 'غضب عارم!';
        case 'recover':
          return 'مترنح';
        default:
          return 'مشتبك';
      }
    },
    lootGrantedNotice: (summary) => `تم استلام الغنائم: ${summary}`,
    coopQuestStartedNotice: (title) => `بدأت المهمة التعاونية: ${title}`,
    coopQuestCompletedNotice: (title) => `اكتملت المهمة التعاونية: ${title}`,
    tabStory: (done, total) => `القصة (${done}/${total})`,
    storyCampaignTitle: 'القصة الرئيسية للمغامرة',
    storyChapterProgress: (current, total) => `الفصل ${current} من ${total}`,
    storyActiveQuestLabel: 'مهمة القصة النشطة',
    storyNextObjectiveLabel: 'الهدف التالي',
    storyCompletedCampaignTitle: 'اكتملت الحملة — أسطورة أوكهولو',
    storyCompletedCampaignDesc:
      'كشفت سر خزينة حجر الشمس وأنقذت الوادي. يمكنك مواصلة الاستكشاف الحر والصناعة والمهام الجانبية.',
    storyStartQuestBtn: 'بدء مهمة القصة',
    storyRetryQuestBtn: 'إعادة المحاولة',
    storyCompleteFallbackHint: 'تحدث مع الشيخ ثورن أو اتبع علامة النجمة الذهبية على خريطتك.',
    storyStateLabels: {
      LOCKED: 'مقفلة',
      AVAILABLE: 'متاحة',
      ACTIVE: 'نشطة',
      OBJECTIVE_COMPLETED: 'جاهزة للتسليم',
      COMPLETED: 'مكتملة',
      FAILED: 'فشلت',
    },
    storyQuestStartedNotice: (title) => `بدأت مهمة القصة: ${title}`,
    storyQuestFailedNotice: (title) => `فشلت مهمة القصة: ${title}`,
    storyRescuedNotice: (name) => `تم إنقاذ ${name}!`,
    storyRescueActionVerb: 'إنقاذ',
    mapLegendStoryObjective: 'هدف أو شخصية القصة الرئيسية',
    mapLegendSideQuestAvailable: 'مهمة جانبية متاحة',
    mapLegendSideQuestActive: 'هدف مهمة جانبية نشطة',
    mapLegendSideQuestTurnin: 'مهمة جانبية جاهزة للتسليم',
    sideQuestAcceptedNotice: (title) => `تم قبول المهمة الجانبية: ${title}`,
    sideQuestAbandonedNotice: (title) => `تم التخلّي عن المهمة الجانبية: ${title}`,
    sideQuestFailedNotice: (title) => `فشلت المهمة الجانبية: ${title}`,
    sideQuestExpiredNotice: (title) => `انتهت مهلة المهمة الجانبية: ${title}`,
    sideQuestMissingItemsNotice:
      'لا تملك جميع الأغراض المطلوبة لإتمام هذه المهمة الجانبية بعد.',
    sideQuestReadyNotice: (title) => `المهمة الجانبية جاهزة للتسليم: ${title}`,
    tabSideQuests: (done, total) => `الجانبية (${done}/${total})`,
    sideQuestsSectionTitle: 'المهام الجانبية الاختيارية',
    sideQuestsSubtitle:
      'قصص ومكافآت ومهام إنقاذ وتوصيل وصيد واستكشاف اختيارية في أنحاء الوادي — لا تُشترط لإنهاء القصة الرئيسية.',
    sideQuestReputationLabel: 'سمعة الوادي',
    sideQuestAcceptBtn: 'قبول المهمة',
    sideQuestAbandonBtn: 'تخلّي',
    sideQuestRetryBtn: 'إعادة المحاولة',
    sideQuestRepeatableBadge: 'متكررة',
    sideQuestTimedBadge: (hours) => `متبقي ${hours} س`,
    sideQuestCooldownBadge: (sec) => `انتظار ${sec}ث`,
    sideQuestGiverLabel: 'مُعطي المهمة',
    sideQuestLocationLabel: 'الموقع',
    sideQuestLevelReqBadge: (lvl) => `مستوى ${lvl}+`,
    sideQuestNightOnlyBadge: 'مساءً وليلاً',
    sideQuestCompletedCountBadge: (count) => `مكتملة ×${count}`,
    sideQuestFilterAll: 'الكل',
    sideQuestGroupActive: 'المهام الجانبية النشطة',
    sideQuestGroupAvailable: 'المهام الجانبية المتاحة',
    sideQuestGroupFailed: 'مهام فاشلة أو منتهية',
    sideQuestGroupLocked: 'المهام الجانبية المقفلة',
    sideQuestGroupCompleted: 'المهام الجانبية المكتملة',
    sideQuestEmptyNotice: 'لا توجد مهام جانبية في هذا التصنيف.',
    sideQuestStateLabels: {
      LOCKED: 'مقفلة',
      AVAILABLE: 'متاحة',
      ACTIVE: 'نشطة',
      COMPLETED: 'مكتملة',
      FAILED: 'فشلت',
      EXPIRED: 'انتهت المهلة',
    },
    sideQuestCategoryLabels: {
      rescue: 'إنقاذ',
      delivery: 'توصيل',
      hunting: 'صيد وقتال',
      gathering: 'جمع موارد',
      exploration: 'استكشاف',
      village: 'مهام القرى',
    },
    buildModeTitle: 'وضع البناء',
    buildModeBtn: 'بناء',
    buildManageBtn: 'إدارة',
    buildExitBtn: 'خروج',
    buildPlaceBtn: 'تثبيت',
    buildRotateLeftBtn: 'تدوير -',
    buildRotateRightBtn: 'تدوير +',
    buildSnapLabel: 'التقاط',
    buildSnapOn: 'التقاط مفعل',
    buildSnapOff: 'وضع حر',
    buildSnappedBadge: 'ملتصق',
    buildNudgeForward: 'أمام',
    buildNudgeBack: 'خلف',
    buildNudgeLeft: 'يسار',
    buildNudgeRight: 'يمين',
    buildValidPlacement: 'موقع صالح للبناء',
    buildInvalidPlacement: 'موقع غير صالح',
    buildCreativeFreeTag: 'الوضع الإبداعي — بناء مجاني',
    buildRequiredMaterials: 'المواد المطلوبة',
    buildMissingMaterialsNotice: 'تنقصك بعض المواد المطلوبة للبناء.',
    buildPlacedNotice: (name) => `تم تشييد ${name}.`,
    buildInvalidNotice: (reasonLabel) => `تعذر البناء: ${reasonLabel}`,
    buildPermissionDeniedNotice: 'ليست لديك صلاحية لاستخدام هذا المنشأ.',
    buildReasonLabels: {
      valid: 'جاهز للبناء',
      out_of_bounds: 'خارج حدود الوادي القابلة للبناء',
      in_water: 'لا يمكن البناء داخل الماء أو المحيط',
      near_water: 'قريب جدًا من حافة الماء',
      slope_too_steep: 'انحدار الأرض شديد جدًا هنا',
      uneven_terrain: 'الأرض غير مستوية بما يكفي',
      colliding_structure: 'يعترضه عائق أو منشأ آخر',
      inside_village_protected: 'منطقة قرية محمية',
      blocking_road: 'لا يمكن سد طرق القرية أو مساراتها',
      near_npc_spawn: 'قريب جدًا من موقع أحد الشخصيات',
      near_quest_object: 'قريب جدًا من معلم مهمة أو أطلال',
      missing_materials: 'نقص في المواد المطلوبة',
      permission_denied: 'لا توجد صلاحية',
    },
    buildStorageTitle: 'مخزن المنشأ',
    buildStorageCapacityLabel: (used, max) => `${used} / ${max} خانة`,
    buildStorageBackpack: 'حقيبتك',
    buildStorageVault: 'محتويات المخزن',
    buildStorageEmpty: 'لا توجد أغراض مخزنة حاليًا.',
    buildStorageDepositBtn: 'إيداع',
    buildStorageWithdrawBtn: 'سحب',
    buildStorageAllBtn: 'الكل',
    buildStorageFullNotice: 'مخزن المنشأ ممتلئ.',
    buildManageTitle: 'إدارة المنشأ',
    buildManageOwnerLabel: 'الباني',
    buildManageHealthLabel: 'المتانة',
    buildManageRepairBtn: 'إصلاح',
    buildManageRepairedNotice: 'تم إصلاح المنشأ إلى المتانة الكاملة.',
    buildManageUpgradeBtn: (nextName) => `ترقية ← ${nextName}`,
    buildManageUpgradedNotice: (nextName) => `تمت ترقية المنشأ إلى ${nextName}.`,
    buildManagePermLabel: 'صلاحيات الوصول',
    buildPermLabels: {
      owner: 'المالك فقط',
      friends: 'الأصدقاء',
      party: 'الفريق',
      everyone: 'الجميع',
    },
    buildManageDemolishBtn: 'هدم',
    buildManageDemolishConfirm: 'تأكيد الهدم',
    buildManageDemolishCancel: 'تراجع',
    buildManageDemolishRefundHint: 'يتم استرداد 50% من المواد الأساسية.',
    buildManageDemolishNotEmpty: 'أفرغ المخزن أولًا قبل هدم المنشأ.',
    buildDemolishedNotice: 'تم هدم المنشأ.',
    buildFarmGrowingNotice: (pct) => `ينمو القمح الذهبي حاليًا (${pct}%).`,
    buildFarmHarvestedNotice: (count) => `تم حصاد قمح ذهبي ×${count}!`,
    buildControlsHint: 'R تدوير · Tab التقاط · F / نقر للتثبيت · B خروج',
    buildDefaultPermLabel: 'الصلاحية',
    farmPlotTitle: 'إدارة الحوض الزراعي',
    farmSoilReady: 'تربة محروثة وجاهزة للزراعة',
    farmSoilUntilled: 'تربة غير محروثة — احرثها قبل البذر',
    farmWateredStatus: (pct) => `الرطوبة: ${pct}%`,
    farmWateredRainBadge: 'يروى بالمطر',
    farmWateredTroughBadge: 'قرب حوض ماء',
    farmTillSoilBtn: 'حراثة التربة',
    farmPlantSeedBtn: (seedName) => `زراعة ${seedName}`,
    farmWaterCropBtn: 'ري المحصول',
    farmWaterNeedsSourceHint: 'احمل مرش ماء نحاسيًا أو ازرع قرب نهر أو حوض ماء أو تحت المطر.',
    farmWateredBonusNotice: 'التربة المروية تسرّع نمو المحصول.',
    farmHarvestBtn: 'حصاد المحصول الناضج',
    farmNoSeedsHint: 'لا توجد بذور في حقيبتك — اجمع النباتات البرية أو اشترِ من التاجر.',
    farmSeedLabel: 'اختر البذور',
    farmGrowthHoursLabel: (hours) => `نمو ~${hours}س`,
    farmYieldLabel: (count) => `الإنتاج ×${count}`,
    farmStageLabel: (stage) =>
      stage >= 3 ? 'ناضج' : stage === 2 ? 'نمو متقدم' : stage === 1 ? 'بذرة نابته' : 'فارغ',
    farmCropProgressLabel: (cropName, pct) => `${cropName} · ${pct}%`,
    farmTilledNotice: 'تمت حراثة التربة وأصبحت جاهزة للبذور.',
    farmPlantedNotice: (cropName) => `تمت زراعة ${cropName}! حافظ على الري لنمو أسرع.`,
    farmWateredNotice: 'تم ري الحوض الزراعي.',
    farmCropHarvestedNotice: (cropName, count, seedName, seedCount) =>
      seedCount > 0
        ? `تم حصاد ${cropName} ×${count} (+${seedName} ×${seedCount})!`
        : `تم حصاد ${cropName} ×${count}!`,
    farmAnimalCollectedNotice: (animalName, itemName, count) =>
      `تم جمع ${itemName} ×${count} من ${animalName}.`,
    farmAnimalFedNotice: (animalName, hoursLeft) =>
      `تم إطعام ${animalName}! يجهز خلال ~${hoursLeft.toFixed(1)}س.`,
    farmAnimalRestingNotice: (animalName, hoursLeft) =>
      `${animalName} يرتاح. يجهز خلال ~${hoursLeft.toFixed(1)}س (أطعمه قمحًا أو علفًا للتسريع).`,
    farmFoundSeedNotice: (seedName) => `عثرت على ${seedName}!`,
    dialogueOpenMarketBtn: 'السوق والبذور',
    dialogueOpenVillageDevBtn: 'تطوير القرية',
    villageDevTitle: 'تطوير القرية',
    villageLevelBadge: (lvl) => `مستوى ${lvl}`,
    villageReputationLabel: 'السمعة',
    villageRepDiscountHint: (discountPct, sellBonusPct) =>
      `السوق: خصم شراء ${discountPct}% · زيادة بيع +${sellBonusPct}%`,
    villageRepairsTitle: 'ترميمات القرية',
    villageProjectsTitle: 'مشاريع التطوير',
    villagePerksTitle: 'مزايا القرية المفتوحة',
    villageNoPerksYet: 'أكمل الترميمات أو التجارة أو احصد بالقرب للوصول إلى المستوى 2.',
    villageRepairDoneBtn: 'إتمام الترميم',
    villageRepairCompletedBadge: 'مُرمّم',
    villageProjectBuildBtn: 'إنشاء المشروع',
    villageProjectCompletedBadge: 'تم البناء',
    villageProjectLockedBadge: (minLevel) => `يتطلب مستوى القرية ${minLevel}`,
    villageDefenseTitle: 'دورية الدفاع عن القرية',
    villageDefenseDesc: 'تصدَّ للصوص على أطراف القرية لكسب خبرة كبيرة للقرية وعملات وسمعة.',
    villageDefenseStartBtn: 'دافع عن القرية (3 غزاة)',
    villageDefenseActiveBadge: (remaining) => `متبقي ${remaining} غزاة`,
    villageDefenseStartedNotice: (villageName, count) =>
      `بدأ الدفاع عن ${villageName}! رُصد ${count} غزاة عند الأطراف.`,
    villageDefenseProgressNotice: (remaining) =>
      `تم صد غازٍ! متبقي ${remaining} حول القرية.`,
    villageDefenseWonNotice: (villageName) =>
      `تم تأمين ${villageName}! يهتف القرويون لشجاعتك (+130 خبرة قرية، +65 سمعة).`,
    villageUpgradeLevelNotice: (villageName, level) =>
      `ارتقت ${villageName} إلى مستوى التطوير ${level}! تم فتح سلع سوق جديدة.`,
    villageRepairSuccessNotice: (name) => `اكتمل الترميم: ${name}!`,
    villageProjectSuccessNotice: (name) => `تم بناء مشروع القرية: ${name}!`,
    merchantTradeTitle: 'سوق القرية والتجارة',
    merchantBuyTab: 'شراء البضائع',
    merchantSellTab: 'بيع المحاصيل',
    merchantBuyBtn: 'شراء',
    merchantSellOneBtn: 'بيع 1',
    merchantSellAllBtn: 'بيع الكل',
    merchantLockedLevel: (minLevel) => `مستوى القرية ${minLevel}`,
    merchantRequiresPenHint: 'ابنِ قن دجاج أو حظيرة ماشية قريبة لشراء الحيوانات.',
    merchantHasPenHint: 'تم رصد حظيرة/قن قريب — ستنتقل المواشي المشتراة إليه مباشرة!',
    merchantEmptySellHint: 'لا توجد محاصيل أو منتجات حيوانية أو سلع قابلة للبيع في حقيبتك.',
    merchantNotEnoughCoinsNotice: 'العملات غير كافية.',
    merchantBoughtNotice: (name, coins) => `تم شراء ${name} مقابل ${coins} عملة.`,
    merchantBoughtAnimalNotice: (speciesName) =>
      `تم شراء ${speciesName}! تم توجيهه إلى أقرب حظيرة/قن.`,
    merchantSoldNotice: (name, count, coins) => `تم بيع ${name} ×${count} مقابل +${coins} عملة.`,
    hostLanBtn: 'استضافة LAN محلي',
    lanWorldSourceNew: 'عالم جديد',
    lanWorldSourceSaved: 'عالم محفوظ',
    lanSelectSavedWorld: 'اختر عالماً محفوظاً',
    lanNoSavedWorldsHint: 'لا توجد عوالم محلية محفوظة بعد. أنشئ عالماً جديداً ليتم حفظ التقدم تلقائياً.',
    lanSavedWorldHostNote: 'يتم تحديث حفظ العالم على جهازك تلقائياً. لا يقوم الضيوف المتصلون بحفظ عالمك محلياً.',
    androidStorageTitle: 'مجلد الحفظ على الجهاز',
    androidStorageStateInitialized: 'تم التهيئة بنجاح',
    androidStorageStateAvailable: 'متاح',
    androidStorageStatePermissionRequired: 'يتطلب إذن الوصول',
    androidStorageStateNotAccessible: 'غير متاح للوصول',
    androidStorageGrantBtn: 'منح الإذن',
    androidStorageChooseFolderBtn: 'اختر مجلدًا (SAF)',
    androidStoragePermHint: 'امنح إذن التخزين لحفظ العوالم والإعدادات مباشرة داخل /storage/emulated/0/World of Adventure/.',
    menuMods: 'المودات',
    tabMods: 'المودات',
    modsTitle: 'مدير المودات المحلية',
    modsSubtitle: 'اكتشاف والتحقق وتفعيل وتعطيل وإدارة مودات البيانات والأصول دون اتصال بالإنترنت.',
    modsFolderLabel: 'مجلد المودات',
    modsOpenFolderBtn: 'فتح مجلد المودات',
    modsRefreshBtn: 'تحديث المودات',
    modsImportBtn: 'استيراد .woamod',
    modsDiscoveredLabel: 'المثبتة',
    modsActiveLabel: 'المفعلة',
    modsIssuesLabel: 'المشاكل',
    modsEmptyTitle: 'لا توجد مودات مثبتة',
    modsEmptyHint: 'ضع مجلدات المودات التطويرية داخل مجلد المودات أعلاه، أو اضغط استيراد .woamod لتثبيت حزمة مود رسمية دون إنترنت.',
    modsEmptyStructureHint: 'الهيكل القياسي: mod.json + items/ و weapons/ و recipes/ و quests/ و characters/ و creatures/ و npcs/ و buildings/ و models/ و textures/ و sounds/ و music/ و localization/ و assets/.',
    modsStatusReady: 'مفعل',
    modsStatusDisabled: 'معطل',
    modsStatusIncompatible: 'إصدار غير مدعوم',
    modsStatusMissingDep: 'اعتمادية مفقودة',
    modsStatusDepDisabled: 'الاعتمادية معطلة',
    modsStatusCircularDep: 'اعتمادية دائرية',
    modsStatusDuplicate: 'معرف مود مكرر',
    modsStatusCorrupted: 'حزمة تالفة',
    modsStatusIncomplete: 'مود غير صالح',
    modsStatusUnsafe: 'مود غير صالح (محظور)',
    modsEnableBtn: 'تفعيل',
    modsDisableBtn: 'تعطيل',
    modsRemoveBtn: 'إزالة',
    modsRemoveConfirmTitle: 'إزالة المود؟',
    modsRemoveConfirmDesc: (name) =>
      `هل تريد حذف "${name}" نهائياً من مجلد المودات المحلي؟`,
    modsRemoveConfirmYes: 'حذف المود',
    modsByAuthor: (author) => `بواسطة ${author}`,
    modsPriorityLabel: 'أولوية التحميل',
    modsDependenciesLabel: 'الاعتماديات',
    modsFoldersCoverageLabel: (present, total) => `${present}/${total} مجلدات`,
    modsContentAssetsLabel: (contentCount, assetCount) =>
      `${contentCount} بيانات · ${assetCount} أصول`,
    modsLogsTitle: 'سجل التحقق والتحميل',
    modsLogsShowBtn: 'عرض السجل',
    modsLogsHideBtn: 'إخفاء السجل',
    modsLogsClearBtn: 'مسح',
    modsLogsEmpty: 'لم يتم تسجيل أحداث للمودات بعد.',
    modsInstantSaveNote: 'يتم تطبيق وحفظ تفعيل وتعطيل وأولوية المودات فوراً دون اتصال.',
    modsImportSuccessNotice: (name) => `تم التثبيت بنجاح: تمت إضافة "${name}" إلى مجلد المودات المحلي.`,
    modsImportErrorNotice: (err) => `فشل الاستيراد: ${err}`,
    modsReloadBtn: 'إعادة تحميل المودات',
    modsReloadSuccessNotice: (activeCount, issueCount) =>
      issueCount > 0
        ? `تمت إعادة تحميل ${activeCount} مود مفعل (تم تجاوز ${issueCount} مود به مشاكل بأمان).`
        : `تمت إعادة تحميل ${activeCount} مود مفعل بنجاح.`,
    modsViewDetailsBtn: 'عرض التفاصيل',
    modsFilterInstalled: 'المودات المثبتة',
    modsFilterEnabled: 'المودات المفعلة',
    modsFilterDisabled: 'المودات المعطلة',
    modsFilterEmptyTitle: 'لا توجد مودات في هذا التصنيف',
    modsFilterEmptyHint: 'بدّل التصنيف أو قم بتثبيت/تفعيل مود محلي لعرضه هنا.',
    modsCompatibilityLabel: 'التوافق',
    modsCompatibleBadge: 'متوافق',
    modsUnsupportedVersionBadge: 'إصدار غير مدعوم',
    modsModIdLabel: 'معرف المود',
    modsVersionLabel: 'الإصدار',
    modsAuthorLabel: 'المؤلف',
    modsDescriptionLabel: 'الوصف',
    modsNoDescription: 'لا يوجد وصف في ملف mod.json.',
    modsSupportedGameVersionLabel: 'إصدار اللعبة المدعوم',
    modsLoadOrderLabel: 'ترتيب التحميل',
    modsNoDependencies: 'لا يوجد',
    modsErrorWarningTitle: 'حالة الأخطاء والتحذيرات',
    modsNoErrorsOrWarnings: 'لا توجد أخطاء أو تحذيرات. جاهز للتحميل الآمن.',
    modsSourcePathLabel: 'مسار المصدر',
    modsContentFilesLabel: 'ملفات البيانات',
    modsAssetsFilesLabel: 'الأصول المتوافقة',
    modsIncompatibleAssetsLabel: 'أصول غير متوافقة (تم تجاوزها)',
    modsFoldersLabel: 'مجلدات المود القياسية',
    modsCloseDetailsBtn: 'إغلاق',
    modsClearSummaryInvalidMod: 'مود غير صالح: ملف mod.json مفقود أو غير مكتمل أو يفتقد البيانات المطلوبة.',
    modsClearSummaryUnsupportedVersion: (required, current) =>
      `إصدار غير مدعوم: يتطلب اللعبة ${required || 'غير محدد'}، والإصدار الحالي هو ${current}.`,
    modsClearSummaryMissingDep: 'اعتمادية مفقودة: أحد المودات المطلوبة مفقود أو معطل أو غير متوافق بالإصدار.',
    modsClearSummaryDuplicateId: 'معرف مود مكرر: يوجد مود آخر مثبت يستخدم نفس معرف المود.',
    modsClearSummaryCorruptedPackage: 'حزمة تالفة: تعذر قراءة الأرشيف أو ملفات JSON الخاصة بالمود بأمان.',
    modsClearSummaryIncompatibleAsset: (count) =>
      `أصول غير متوافقة: تم تجاوز ${count} ملف أصول غير مدعوم أو كبير الحجم بأمان.`,
    modsErrorInvalidPackageName: 'ملف حزمة غير صالح. يتم قبول حزم .woamod الرسمية فقط.',
    modsErrorInvalidPackageSize: 'حجم الحزمة فارغ أو يتجاوز الحد الآمن 150 ميجابايت.',
    modsErrorCorruptPackage: 'حزمة تالفة: أرشيف .woamod المحدد أو ملفات JSON الخاصة به معطوبة أو غير صالحة.',
    modsErrorPermissionRequired: 'يلزم منح إذن التخزين للكتابة داخل مجلد World of Adventure/Mods/.',
    modsKindDevelopment: 'تطويري / غير مضغوط',
    modsKindWoamod: 'حزمة .woamod مثبتة',
    modsOriginLabel: 'تنسيق المود',
    modsPackageFileLabel: 'ملف الحزمة',
    modsInstalledAtLabel: 'تاريخ التثبيت',
    modsDevBadgeHint: 'تم التحميل مباشرة من مجلد غير مضغوط داخل Mods/',
    modsInstallProgressTitle: 'جارٍ تثبيت حزمة .woamod',
    modsStageReading: 'قراءة الحزمة',
    modsStageValidating: 'التحقق من البنية والأمان',
    modsStageExtracting: 'استخراج الملفات بأمان',
    modsStageFinalizing: 'إنهاء التثبيت',
    modsStageCleaningUp: 'تنظيف الملفات غير المكتملة',
    modsStageCompleted: 'اكتمل التثبيت',
    modsStageFailed: 'فشل التثبيت',
    modsInstallEntriesLabel: (done, total) => `${done}/${total} ملف`,
    modsErrorPathTraversal: 'تم حظر انتهاك أمني: مسار غير آمن أو رابط رمزي داخل الحزمة.',
    modsErrorUnsafeExecutable: 'تم حظر انتهاك أمني: يُمنع وجود ملفات تنفيذية أو مكتبات أصلية داخل المودات.',
    modsErrorRequiredFilesMissing: 'مود غير صالح: ملف mod.json المطلوب أو مجلدات المود القياسية مفقودة.',
    modsErrorUnsupportedVersion: 'إصدار غير مدعوم: حزمة .woamod لا تدعم إصدار اللعبة الحالي.',
    modsErrorDuplicateModId: 'معرف مود مكرر: يوجد مود مثبت يستخدم نفس المعرف بالفعل.',
    modsErrorMissingDependency: 'اعتمادية مفقودة: قم بتثبيت وتفعيل المودات المطلوبة أولاً.',
    modsErrorDepMismatch: 'تعارض اعتمادية: إصدار المود المعتمد لا يطابق النطاق المطلوب.',
    modsErrorTargetExists: 'مجلد الهدف موجود بالفعل داخل Mods/. احذف المود الحالي قبل إعادة التثبيت.',
    worldModsSectionTitle: 'مودات العالم والعزل',
    worldModsModeVanilla: 'عالم أصلي (بدون مودات)',
    worldModsModeVanillaDesc: 'لا توجد مودات مفعلة. معزول تماماً عن العوالم المعدلة.',
    worldModsModeModded: 'اختيار المودات',
    worldModsModeModdedDesc: 'اختر المودات المفعلة وترتيب التحميل المحفوظ مع هذا العالم فقط.',
    worldModsEmptyInstalledHint: 'لا توجد مودات محلية مثبتة بعد. سيبدأ هذا العالم في الوضع الأصلي المعزول.',
    worldModsEnableAllBtn: 'تفعيل المتوافق',
    worldModsClearAllBtn: 'تعطيل الكل',
    worldModsMoveUp: 'تقديم المود في ترتيب التحميل',
    worldModsMoveDown: 'تأخير المود في ترتيب التحميل',
    worldBadgeVanilla: 'أصلي',
    worldBadgeModded: (count) => (count === 1 ? 'مود واحد' : `${count} مودات`),
    worldRecoveryTitle: 'فحص مودات العالم والاسترداد الآمن',
    worldRecoverySubtitle: (worldName) => `${worldName}`,
    worldRecoveryWarningBanner:
      'تم اكتشاف تغييرات أو نقص في مودات هذا العالم قبل التحميل. جميع العناصر والمهام والمباني المعدلة محفوظة بأمان.',
    worldRecoveryResolvedBanner:
      'جميع مودات هذا العالم جاهزة الآن. يمكنك حفظ الإعدادات المحدثة أو تشغيل العالم بشكل طبيعي.',
    worldRecoveryStatusMissing: 'مود مفقود',
    worldRecoveryStatusVersionChanged: (saved, installed) =>
      `تغير الإصدار (المحفوظ v${saved} -> المثبت v${installed})`,
    worldRecoveryStatusIncompatible: 'مود غير متوافق',
    worldRecoveryStatusReady: 'جاهز',
    worldRecoveryStatusDisabledWorld: 'معطل لهذا العالم',
    worldRecoveryStatusDisabledGlobally: 'مخصص للعالم (سيُفعل عند التشغيل)',
    worldRecoverySavedVersion: (v) => `المحفوظ v${v}`,
    worldRecoveryInstalledVersion: (v) => `المثبت v${v}`,
    worldRecoveryOrphanedTitle: 'محتوى مودات محفوظ داخل الحفظ',
    worldRecoveryOrphanedDesc: (items, quests, buildings, recipes) =>
      `تم الحفاظ على ${items} عنصر، ${quests} مهمة، ${buildings} مبنى، و${recipes} وصفة بأمان دون حذف.`,
    worldRecoveryManageModsBtn: 'إدارة / استيراد المودات',
    worldRecoveryRefreshBtn: 'تحديث المودات',
    worldRecoverySaveConfigBtn: 'حفظ إعدادات مودات العالم',
    worldRecoveryConfigSavedNotice: 'تم حفظ إعدادات مودات العالم المحدثة دون تعديل بيانات العالم.',
    worldRecoveryEnterSafeBtn: 'وضع الاسترداد الآمن',
    worldRecoverySafeModeDesc:
      'يفتح العالم للمعاينة مع تعطيل الحفظ التلقائي والكتابة فوق الحفظ الأصلي.',
    worldRecoveryLoadAnywayBtn: 'تحميل العالم',
    worldRecoveryRemoveMissingBtn: 'تعطيل القيد',
    modsSafeRecoveryEnteredNotice:
      'وضع الاسترداد الآمن مفعل: الحفظ التلقائي والكتابة فوق الحفظ الأصلي معطلان لحماية محتوى المودات.',
    modsSafeRecoveryReadOnlyNotice:
      'يمنع وضع الاسترداد الآمن الكتابة فوق خانة الحفظ هذه. اختر خانة أخرى لحفظ نسخة.',
    hudSafeRecoveryBadge: 'الاسترداد الآمن (الحفظ التلقائي معطل)',
    mpModCompatMismatchTitle: 'يتطلب توافق المودات',
    mpModsVanillaBadge: 'أصلي (بدون مودات)',
    mpModsRequiredCountBadge: (count) => (count === 1 ? 'مود واحد' : `${count} مودات`),
    mpModCompatOkBadge: 'المودات متوافقة',
    mpModCompatBlockedHint: 'يرجى معالجة اختلافات المودات أدناه قبل دخول عالم اللعب الجماعي.',
    mpModPresetAppliedNotice: 'تمت مطابقة المودات النشطة محليًا مع إعدادات المضيف.',
    mpRefreshModsBtn: 'تحديث المودات',
    mpMatchRoomModsBtn: 'مطابقة مودات الغرفة',
    mpHostRequiredModsLabel: 'مودات المضيف المطلوبة',
    mpModIssueMissing: 'مود مفقود',
    mpModIssueDisabled: 'مثبّت (معطّل)',
    mpModIssueVersionMismatch: 'اختلاف الإصدار',
    mpModIssueApiMismatch: 'عدم توافق API / المخطط',
    mpModIssueExtraActive: 'مود لعب إضافي مفعّل',
    mpModIssueMissingDependency: 'اعتمادية مفقودة',
    mpModIssueUnsupported: 'إصدار غير مدعوم',
    mpModHostSavedMismatchHint: 'يستخدم هذا العالم المحفوظ إعدادات مودات مختلفة عن المودات المفعلة محليًا حاليًا.',
    mpModExpectedLabel: (version) => `المضيف: ${version}`,
    mpModLocalLabel: (version) => `لديك: ${version}`,
    mpDismissBtn: 'إغلاق',
    mpLanModStatusTitle: 'توافق مودات الشبكة المحلية',
    mpLanRequiredModsTitle: 'المودات المطلوبة',
    mpLanCompatiblePlayersTitle: 'اللاعبون المتوافقون',
    mpLanIncompatiblePlayersTitle: 'اللاعبون غير المتوافقين',
    mpLanNoIncompatiblePlayers: 'لا توجد محاولات انضمام مرفوضة.',
    mpLanVanillaNoMods: 'لا شيء (عالم أصلي)',
    modsSpawnDiagnosticsTitle: 'إعدادات وتشخيص الظهور في العالم',
    modsNoSpawnRules: 'لا يحتوي هذا المود على قواعد ظهور مخصصة في العالم.',
    modsSpawnConfiguredLabel: 'الإحداثيات المحددة',
    modsSpawnResolvedLabel: 'الإحداثيات الفعلية',
    modsSpawnModeLabel: 'الوضع',
    modsSpawnChunkLabel: 'المقطع',
    modsSpawnInstancesLabel: 'النشطة',
    modsSpawnMenuPreviewHint: 'معرّف في الحزمة (ادخل إلى عالم لتقييم الإحداثيات الفعلية)',
    modsSpawnStatusLabel: (status) => {
      switch (status) {
        case 'spawned':
          return 'تم الظهور';
        case 'pending_chunk':
          return 'بانتظار تحميل المقطع';
        case 'condition_unmet':
          return 'الشرط غير متحقق';
        case 'collected':
          return 'تم جمعه';
        case 'defeated':
          return 'تمت هزيمته';
        case 'failed':
          return 'فشل';
        default:
          return status;
      }
    },
    modsSpawnAutoY: 'تلقائي',
    modsSpawnRotationLabel: 'الدوران',
    modsSpawnScaleLabel: 'الحجم',
    modsSpawnAlreadySpawnedLabel: 'مُستدعى',
    modsSpawnSavedLabel: 'محفوظ',
    modsSpawnYesLabel: 'نعم',
    modsSpawnNoLabel: 'لا',
  },
};
