import * as THREE from 'three';
import type { InventoryManager } from '../inventory/InventoryManager';
import type { Language } from '../i18n/translations';
import { groundHeightAt } from '../math/noise';
import { isWater } from '../world/WorldPlacementValidator';
import type { VillageSiteRecord } from '../world/VillageManager';
import type { WorldInteractable } from '../world/WorldManager';
import type { FarmAnimalManager } from '../farming/FarmAnimalManager';
import type { PlayerBuiltStructure } from '../building/buildingTypes';
import {
  MERCHANT_BUY_CATALOG,
  SELLABLE_FARM_AND_TRADE_PRIORITY,
  computeDiscountedPrice,
  computeSellPrice,
} from './VillageTradeCatalog';
import type {
  MerchantSellEntry,
  MerchantTradeOffer,
  MerchantTradeSnapshot,
  SavedVillageDevelopmentState,
  VillageDevelopmentLevel,
  VillageDevelopmentRecord,
  VillageDevelopmentSnapshot,
  VillageProjectDef,
  VillageRepairSiteDef,
  VillageReputationRank,
} from './villageDevTypes';

const LEVEL_XP_THRESHOLDS: Record<VillageDevelopmentLevel, number> = {
  1: 0,
  2: 120,
  3: 300,
  4: 560,
  5: 900,
};

const LEVEL_NAMES: Record<Language, Record<VillageDevelopmentLevel, string>> = {
  en: {
    1: 'Growing Settlement',
    2: 'Thriving Hamlet',
    3: 'Prosperous Village',
    4: 'Regional Stronghold',
    5: 'Grand Valley Haven',
  },
  ar: {
    1: 'مستوطنة نامية',
    2: 'قرية مزدهرة',
    3: 'قرية عامرة',
    4: 'حصن إقليمي',
    5: 'ملاذ الوادي العظيم',
  },
};

const REPUTATION_META: Array<{
  rank: VillageReputationRank;
  minPoints: number;
  labelEn: string;
  labelAr: string;
  discountPct: number;
  sellBonusPct: number;
}> = [
  { rank: 'honored', minPoints: 480, labelEn: 'Honored Patron', labelAr: 'راعي مكرّم', discountPct: 22, sellBonusPct: 16 },
  { rank: 'trusted', minPoints: 280, labelEn: 'Trusted Ally', labelAr: 'حليف موثوق', discountPct: 16, sellBonusPct: 12 },
  { rank: 'friend', minPoints: 140, labelEn: 'Village Friend', labelAr: 'صديق القرية', discountPct: 10, sellBonusPct: 8 },
  { rank: 'helper', minPoints: 50, labelEn: 'Helpful Hand', labelAr: 'يد معونة', discountPct: 5, sellBonusPct: 4 },
  { rank: 'stranger', minPoints: 0, labelEn: 'Newcomer', labelAr: 'زائر جديد', discountPct: 0, sellBonusPct: 0 },
];

export const VILLAGE_REPAIR_SITES: ReadonlyArray<VillageRepairSiteDef> = [
  {
    id: 'repair_storehouse',
    nameEn: 'Restore Supply Shed Roof',
    nameAr: 'ترميم سقف مخزن القرية',
    descEn: 'Replace weathered timber roof shingles on an auxiliary village supply shed.',
    descAr: 'إصلاح سقف مخزن الإمدادات الخشبي لتأمين مخزون المزارعين.',
    kind: 'storehouse',
    offsetX: -14.5,
    offsetZ: 14.5,
    yaw: 0.4,
    costs: [
      { itemId: 'wood', count: 8 },
      { itemId: 'stone', count: 4 },
    ],
    xpGain: 75,
    reputationGain: 40,
    coinsReward: 25,
  },
  {
    id: 'repair_fence',
    nameEn: 'Mend Village Perimeter Fence',
    nameAr: 'إصلاح السياج الخارجي للقرية',
    descEn: 'Rebuild broken timber paddock rails to keep livestock safe from wolves.',
    descAr: 'ترميم سياج الحظيرة لحماية مواشي القرية من الحيوانات البرية.',
    kind: 'fence',
    offsetX: 16.5,
    offsetZ: -13.5,
    yaw: -0.5,
    costs: [
      { itemId: 'wood', count: 6 },
      { itemId: 'fiber', count: 4 },
    ],
    xpGain: 60,
    reputationGain: 30,
    coinsReward: 18,
  },
];

export const VILLAGE_PROJECTS: ReadonlyArray<VillageProjectDef> = [
  {
    id: 'proj_granary',
    nameEn: 'Build Village Harvest Silo',
    nameAr: 'بناء صومعة الحصاد القروية',
    descEn: 'Construct a dry grain silo boosting seed trade and village food reserves.',
    descAr: 'إنشاء صومعة حبوب لتخزين المحاصيل وتوسيع تجارة البذور.',
    kind: 'granary',
    minVillageLevel: 1,
    offsetX: 20.5,
    offsetZ: 6.5,
    yaw: -0.25,
    costs: [
      { itemId: 'wood', count: 10 },
      { itemId: 'planks', count: 4 },
      { itemId: 'stone', count: 4 },
    ],
    xpGain: 95,
    reputationGain: 50,
    unlockSummaryEn: 'Boosts Village Level toward Tier 2 Seed Market',
    unlockSummaryAr: 'يرفع مستوى القرية نحو فتح بذور المرحلة الثانية',
  },
  {
    id: 'proj_plaza_lanterns',
    nameEn: 'Install Brass Plaza Lanterns',
    nameAr: 'تركيب فوانيس الساحة النحاسية',
    descEn: 'Add warm night lanterns around the village outskirts and notice board.',
    descAr: 'إنارة مداخل القرية ولوحة الإعلانات بفوانيس دافئة.',
    kind: 'plaza_lanterns',
    minVillageLevel: 2,
    offsetX: -12.5,
    offsetZ: -14.5,
    yaw: 0,
    costs: [
      { itemId: 'wood', count: 6 },
      { itemId: 'iron-ingot', count: 2 },
      { itemId: 'coal', count: 2 },
    ],
    xpGain: 90,
    reputationGain: 45,
    unlockSummaryEn: 'Improves night visibility & merchant goodwill',
    unlockSummaryAr: 'يعزز الإنارة الليلية وسمعتك لدى التجار',
  },
  {
    id: 'proj_workshop',
    nameEn: 'Expand Artisan Outfitter Pavilion',
    nameAr: 'توسعة جناح الحرفيين والسوق',
    descEn: 'Raise a covered craft & trade pavilion bringing rare seeds and livestock.',
    descAr: 'إنشاء مظلة حرفية تجذب بذورًا ومواشيَ نادرة للسوق.',
    kind: 'workshop',
    minVillageLevel: 2,
    offsetX: -20.5,
    offsetZ: -4.5,
    yaw: 0.75,
    costs: [
      { itemId: 'planks', count: 6 },
      { itemId: 'timber-beam', count: 2 },
      { itemId: 'stone', count: 6 },
    ],
    xpGain: 120,
    reputationGain: 60,
    unlockSummaryEn: 'Significant progress toward Tier 3 Livestock & Tonics',
    unlockSummaryAr: 'تقدم كبير نحو فتح الماعز والتوت والجرعات',
  },
  {
    id: 'proj_watchtower',
    nameEn: 'Erect Frontier Timber Watchtower',
    nameAr: 'تشييد برج المراقبة الحدودي',
    descEn: 'Fortify the village perimeter with an elevated timber & stone lookout tower.',
    descAr: 'تحصين أطراف القرية ببرج مراقبة خشبي وحجري.',
    kind: 'watchtower',
    minVillageLevel: 3,
    offsetX: 14.5,
    offsetZ: 18.5,
    yaw: -0.6,
    costs: [
      { itemId: 'wood', count: 12 },
      { itemId: 'stone', count: 10 },
      { itemId: 'iron-ingot', count: 3 },
    ],
    xpGain: 155,
    reputationGain: 75,
    unlockSummaryEn: 'Fortifies settlement toward Dairy Cows & Master Trade',
    unlockSummaryAr: 'يعزز القرية نحو فتح الأبقار الحلوب والتجارة المتقدمة',
  },
];

interface MountedVillageAddons {
  villageId: string;
  group: THREE.Group;
  boardPos: { x: number; y: number; z: number };
  interactableIds: string[];
}

export class VillageDevelopmentManager {
  private readonly scene: THREE.Scene;
  private readonly rootGroup = new THREE.Group();
  private readonly interactables: WorldInteractable[];
  private readonly records = new Map<string, VillageDevelopmentRecord>();
  private readonly mountedAddons = new Map<string, MountedVillageAddons>();
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private readonly geoCache = new Map<string, THREE.BufferGeometry>();

  private activeDefense: {
    villageId: string;
    remainingEnemies: number;
  } | null = null;

  private readonly matWoodDark: THREE.MeshStandardMaterial;
  private readonly matWoodWarm: THREE.MeshStandardMaterial;
  private readonly matStone: THREE.MeshStandardMaterial;
  private readonly matPaper: THREE.MeshStandardMaterial;
  private readonly matLantern: THREE.MeshStandardMaterial;
  private readonly matRoof: THREE.MeshStandardMaterial;
  private readonly matIron: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, interactables: WorldInteractable[]) {
    this.scene = scene;
    this.interactables = interactables;
    this.rootGroup.name = 'VillageDevelopmentAddons';
    this.scene.add(this.rootGroup);

    this.matWoodDark = new THREE.MeshStandardMaterial({ color: 0x573b26, roughness: 0.86 });
    this.matWoodWarm = new THREE.MeshStandardMaterial({ color: 0xa6784b, roughness: 0.82 });
    this.matStone = new THREE.MeshStandardMaterial({ color: 0x868a84, roughness: 0.9 });
    this.matPaper = new THREE.MeshStandardMaterial({ color: 0xefe3c6, roughness: 0.85 });
    this.matLantern = new THREE.MeshStandardMaterial({
      color: 0xfff0be,
      emissive: 0xffb744,
      emissiveIntensity: 1.25,
      roughness: 0.25,
    });
    this.matRoof = new THREE.MeshStandardMaterial({ color: 0x8b4a33, roughness: 0.78 });
    this.matIron = new THREE.MeshStandardMaterial({ color: 0x434952, roughness: 0.45, metalness: 0.7 });

    this.disposables.push(
      this.matWoodDark,
      this.matWoodWarm,
      this.matStone,
      this.matPaper,
      this.matLantern,
      this.matRoof,
      this.matIron,
    );
  }

  public getOrCreateRecord(villageId: string): VillageDevelopmentRecord {
    let rec = this.records.get(villageId);
    if (!rec) {
      rec = {
        villageId,
        level: 1,
        progressXp: 0,
        reputationPoints: 0,
        completedRepairIds: [],
        completedProjectIds: [],
        cropsHarvestedCount: 0,
        tradesCompletedCount: 0,
        defensesWonCount: 0,
        lastRaidWorldHours: 0,
      };
      this.records.set(villageId, rec);
    }
    return rec;
  }

  public getReputationRankInfo(points: number): (typeof REPUTATION_META)[number] {
    for (const tier of REPUTATION_META) {
      if (points >= tier.minPoints) return tier;
    }
    return REPUTATION_META[REPUTATION_META.length - 1];
  }

  public computeLevelForXp(xp: number): VillageDevelopmentLevel {
    if (xp >= LEVEL_XP_THRESHOLDS[5]) return 5;
    if (xp >= LEVEL_XP_THRESHOLDS[4]) return 4;
    if (xp >= LEVEL_XP_THRESHOLDS[3]) return 3;
    if (xp >= LEVEL_XP_THRESHOLDS[2]) return 2;
    return 1;
  }

  public addVillageProgress(
    villageId: string,
    xpDelta: number,
    reputationDelta: number,
  ): { leveledUp: boolean; newLevel: VillageDevelopmentLevel } {
    const rec = this.getOrCreateRecord(villageId);
    const oldLevel = rec.level;
    rec.progressXp = Math.max(0, rec.progressXp + Math.max(0, xpDelta));
    rec.reputationPoints = Math.max(0, rec.reputationPoints + Math.max(0, reputationDelta));
    rec.level = this.computeLevelForXp(rec.progressXp);
    return {
      leveledUp: rec.level > oldLevel,
      newLevel: rec.level,
    };
  }

  public recordHarvest(villageId: string, cropCount = 1): { leveledUp: boolean; newLevel: VillageDevelopmentLevel } {
    const rec = this.getOrCreateRecord(villageId);
    rec.cropsHarvestedCount += 1;
    return this.addVillageProgress(villageId, 12 + cropCount * 2, 6 + cropCount);
  }

  public recordTrade(villageId: string, coinAmount: number): { leveledUp: boolean; newLevel: VillageDevelopmentLevel } {
    const rec = this.getOrCreateRecord(villageId);
    rec.tradesCompletedCount += 1;
    const xp = Math.max(8, Math.min(35, Math.round(coinAmount * 0.35)));
    const rep = Math.max(5, Math.min(22, Math.round(coinAmount * 0.22)));
    return this.addVillageProgress(villageId, xp, rep);
  }

  public startDefense(villageId: string, enemyCount: number): boolean {
    if (this.activeDefense && this.activeDefense.remainingEnemies > 0) return false;
    this.activeDefense = {
      villageId,
      remainingEnemies: Math.max(1, enemyCount),
    };
    return true;
  }

  public getActiveDefense(): { villageId: string; remainingEnemies: number } | null {
    return this.activeDefense ? { ...this.activeDefense } : null;
  }

  public onDefenseEnemyDefeated(): {
    completed: boolean;
    villageId: string;
    leveledUp: boolean;
    newLevel: VillageDevelopmentLevel;
  } | null {
    if (!this.activeDefense) return null;
    this.activeDefense.remainingEnemies = Math.max(0, this.activeDefense.remainingEnemies - 1);
    const villageId = this.activeDefense.villageId;
    if (this.activeDefense.remainingEnemies <= 0) {
      this.activeDefense = null;
      const rec = this.getOrCreateRecord(villageId);
      rec.defensesWonCount += 1;
      const lvl = this.addVillageProgress(villageId, 130, 65);
      return {
        completed: true,
        villageId,
        ...lvl,
      };
    }
    return {
      completed: false,
      villageId,
      leveledUp: false,
      newLevel: this.getOrCreateRecord(villageId).level,
    };
  }

  public cancelDefense(): void {
    this.activeDefense = null;
  }

  public onVillageLoaded(village: VillageSiteRecord): void {
    this.onVillageUnloaded(village.id);
    this.getOrCreateRecord(village.id);
    this.rebuildVillageAddons(village);
  }

  public onVillageUnloaded(villageId: string): void {
    const mounted = this.mountedAddons.get(villageId);
    if (!mounted) return;
    mounted.group.removeFromParent();
    const idSet = new Set(mounted.interactableIds);
    for (let i = this.interactables.length - 1; i >= 0; i--) {
      if (idSet.has(this.interactables[i].id)) {
        this.interactables.splice(i, 1);
      }
    }
    this.mountedAddons.delete(villageId);
  }

  public rebuildVillageAddons(village: VillageSiteRecord): void {
    this.onVillageUnloaded(village.id);
    const rec = this.getOrCreateRecord(village.id);
    const group = new THREE.Group();
    group.name = `VillageAddons_${village.id}`;
    const interactableIds: string[] = [];

    // 1. Place additive Notice & Development Board safely off-center near market square
    const boardPos = this.findSafeAddonSpot(
      village.marketPos.x + 6.4,
      village.marketPos.z + 5.8,
      village.marketPos.x,
      village.marketPos.z,
    );
    const boardMesh = this.buildVillageNoticeBoardMesh(rec.level);
    boardMesh.position.set(boardPos.x, boardPos.y, boardPos.z);
    boardMesh.rotation.y = Math.atan2(
      village.marketPos.x - boardPos.x,
      village.marketPos.z - boardPos.z,
    );
    group.add(boardMesh);

    const boardId = `vboard_${village.id}`;
    this.interactables.push({
      id: boardId,
      label: village.name,
      actionVerb: 'Village Board',
      kind: 'village_board',
      x: boardPos.x,
      y: boardPos.y,
      z: boardPos.z,
      radius: 3.1,
      collected: false,
      message: `${village.name} Development & Projects`,
    });
    interactableIds.push(boardId);

    // 2. Render completed additive Repairs
    for (const rep of VILLAGE_REPAIR_SITES) {
      if (!rec.completedRepairIds.includes(rep.id)) continue;
      const spot = this.findSafeAddonSpot(
        village.centerX + rep.offsetX,
        village.centerZ + rep.offsetZ,
        village.centerX,
        village.centerZ,
      );
      const mesh = this.buildRepairMesh(rep.kind);
      mesh.position.set(spot.x, spot.y, spot.z);
      mesh.rotation.y = rep.yaw;
      group.add(mesh);
    }

    // 3. Render completed additive Development Projects
    for (const proj of VILLAGE_PROJECTS) {
      if (!rec.completedProjectIds.includes(proj.id)) continue;
      const spot = this.findSafeAddonSpot(
        village.centerX + proj.offsetX,
        village.centerZ + proj.offsetZ,
        village.centerX,
        village.centerZ,
      );
      const mesh = this.buildProjectMesh(proj.kind);
      mesh.position.set(spot.x, spot.y, spot.z);
      mesh.rotation.y = proj.yaw;
      group.add(mesh);
    }

    this.rootGroup.add(group);
    this.mountedAddons.set(village.id, {
      villageId: village.id,
      group,
      boardPos,
      interactableIds,
    });
  }

  public completeRepair(
    village: VillageSiteRecord,
    repairId: string,
    inventory: InventoryManager,
    isCreativeFree: boolean,
  ): {
    ok: boolean;
    coinsReward: number;
    leveledUp: boolean;
    newLevel: VillageDevelopmentLevel;
    reason?: string;
  } {
    const rec = this.getOrCreateRecord(village.id);
    const def = VILLAGE_REPAIR_SITES.find((r) => r.id === repairId);
    if (!def) return { ok: false, coinsReward: 0, leveledUp: false, newLevel: rec.level, reason: 'not_found' };
    if (rec.completedRepairIds.includes(repairId)) {
      return { ok: false, coinsReward: 0, leveledUp: false, newLevel: rec.level, reason: 'already_done' };
    }
    if (!isCreativeFree) {
      for (const c of def.costs) {
        if (inventory.getItemCount(c.itemId) < c.count) {
          return { ok: false, coinsReward: 0, leveledUp: false, newLevel: rec.level, reason: 'missing_materials' };
        }
      }
      for (const c of def.costs) {
        inventory.removeItem(c.itemId, c.count);
      }
    }
    rec.completedRepairIds.push(repairId);
    const prog = this.addVillageProgress(village.id, def.xpGain, def.reputationGain);
    this.rebuildVillageAddons(village);
    return {
      ok: true,
      coinsReward: def.coinsReward,
      leveledUp: prog.leveledUp,
      newLevel: prog.newLevel,
    };
  }

  public completeProject(
    village: VillageSiteRecord,
    projectId: string,
    inventory: InventoryManager,
    isCreativeFree: boolean,
  ): {
    ok: boolean;
    leveledUp: boolean;
    newLevel: VillageDevelopmentLevel;
    reason?: string;
  } {
    const rec = this.getOrCreateRecord(village.id);
    const def = VILLAGE_PROJECTS.find((p) => p.id === projectId);
    if (!def) return { ok: false, leveledUp: false, newLevel: rec.level, reason: 'not_found' };
    if (rec.completedProjectIds.includes(projectId)) {
      return { ok: false, leveledUp: false, newLevel: rec.level, reason: 'already_done' };
    }
    if (rec.level < def.minVillageLevel) {
      return { ok: false, leveledUp: false, newLevel: rec.level, reason: 'level_locked' };
    }
    if (!isCreativeFree) {
      for (const c of def.costs) {
        if (inventory.getItemCount(c.itemId) < c.count) {
          return { ok: false, leveledUp: false, newLevel: rec.level, reason: 'missing_materials' };
        }
      }
      for (const c of def.costs) {
        inventory.removeItem(c.itemId, c.count);
      }
    }
    rec.completedProjectIds.push(projectId);
    const prog = this.addVillageProgress(village.id, def.xpGain, def.reputationGain);
    this.rebuildVillageAddons(village);
    return {
      ok: true,
      leveledUp: prog.leveledUp,
      newLevel: prog.newLevel,
    };
  }

  public buildVillageSnapshot(
    village: VillageSiteRecord,
    inventory: InventoryManager,
    isCreativeFree: boolean,
    lang: Language,
  ): VillageDevelopmentSnapshot {
    const rec = this.getOrCreateRecord(village.id);
    const rep = this.getReputationRankInfo(rec.reputationPoints);
    const nextLvl = Math.min(5, rec.level + 1) as VillageDevelopmentLevel;
    const nextLevelXp = rec.level >= 5 ? LEVEL_XP_THRESHOLDS[5] : LEVEL_XP_THRESHOLDS[nextLvl];

    const repairs = VILLAGE_REPAIR_SITES.map((r) => {
      const completed = rec.completedRepairIds.includes(r.id);
      const costs = r.costs.map((c) => {
        const owned = inventory.getItemCount(c.itemId);
        const item = inventory.itemManager.getItem(c.itemId);
        return {
          itemId: c.itemId,
          name: lang === 'ar' ? (item?.nameAr ?? item?.name ?? c.itemId) : (item?.name ?? c.itemId),
          required: c.count,
          owned,
          enough: isCreativeFree || owned >= c.count,
        };
      });
      return {
        id: r.id,
        name: lang === 'ar' ? r.nameAr : r.nameEn,
        desc: lang === 'ar' ? r.descAr : r.descEn,
        completed,
        xpGain: r.xpGain,
        reputationGain: r.reputationGain,
        coinsReward: r.coinsReward,
        costs,
        canComplete: !completed && costs.every((c) => c.enough),
      };
    });

    const projects = VILLAGE_PROJECTS.map((p) => {
      const completed = rec.completedProjectIds.includes(p.id);
      const levelMet = rec.level >= p.minVillageLevel;
      const costs = p.costs.map((c) => {
        const owned = inventory.getItemCount(c.itemId);
        const item = inventory.itemManager.getItem(c.itemId);
        return {
          itemId: c.itemId,
          name: lang === 'ar' ? (item?.nameAr ?? item?.name ?? c.itemId) : (item?.name ?? c.itemId),
          required: c.count,
          owned,
          enough: isCreativeFree || owned >= c.count,
        };
      });
      return {
        id: p.id,
        name: lang === 'ar' ? p.nameAr : p.nameEn,
        desc: lang === 'ar' ? p.descAr : p.descEn,
        unlockSummary: lang === 'ar' ? p.unlockSummaryAr : p.unlockSummaryEn,
        minVillageLevel: p.minVillageLevel,
        levelMet,
        completed,
        xpGain: p.xpGain,
        reputationGain: p.reputationGain,
        costs,
        canBuild: !completed && levelMet && costs.every((c) => c.enough),
      };
    });

    const perksUnlocked: string[] = [];
    if (rec.level >= 2) {
      perksUnlocked.push(
        lang === 'ar' ? 'فتح بذور الذرة والطماطم والأعشاب + الأغنام' : 'Corn, Tomato & Herb Seeds + Sheep Livestock',
      );
    }
    if (rec.level >= 3) {
      perksUnlocked.push(
        lang === 'ar' ? 'فتح شتلات التوت والماعز والجرعات العلاجية' : 'Berry Cuttings, Goats & Apothecary Tonics',
      );
    }
    if (rec.level >= 4) {
      perksUnlocked.push(
        lang === 'ar' ? 'فتح الأبقار الحلوب وسبائك الحديد' : 'Dairy Cows & Merchant Iron Ingots',
      );
    }
    if (rec.level >= 5) {
      perksUnlocked.push(
        lang === 'ar' ? 'فتح إمدادات البناء المتقدمة وأعلى سمعة' : 'Master Timber Beams & Grand Haven Prestige',
      );
    }

    return {
      villageId: village.id,
      villageName: lang === 'ar' && village.nameAr ? village.nameAr : village.name,
      level: rec.level,
      levelName: LEVEL_NAMES[lang][rec.level],
      progressXp: rec.progressXp,
      nextLevelXp,
      reputationPoints: rec.reputationPoints,
      reputationRank: rep.rank,
      reputationLabel: lang === 'ar' ? rep.labelAr : rep.labelEn,
      tradeDiscountPct: rep.discountPct,
      sellBonusPct: rep.sellBonusPct,
      defenseActive: this.activeDefense?.villageId === village.id && this.activeDefense.remainingEnemies > 0,
      defenseRemainingCount:
        this.activeDefense?.villageId === village.id ? this.activeDefense.remainingEnemies : 0,
      repairs,
      projects,
      perksUnlocked,
    };
  }

  public buildMerchantTradeSnapshot(
    npcId: string,
    merchantName: string,
    village: VillageSiteRecord,
    inventory: InventoryManager,
    farmAnimals: FarmAnimalManager,
    playerStructures: ReadonlyArray<PlayerBuiltStructure>,
    playerPos: THREE.Vector3,
    playerCoins: number,
    lang: Language,
  ): MerchantTradeSnapshot {
    const rec = this.getOrCreateRecord(village.id);
    const rep = this.getReputationRankInfo(rec.reputationPoints);
    const hasCoopNearby = Boolean(
      farmAnimals.findNearestPlayerStructureForSpecies(
        playerStructures,
        playerPos.x,
        playerPos.z,
        'chicken',
        85,
      ),
    );
    const hasPenNearby = Boolean(
      farmAnimals.findNearestPlayerStructureForSpecies(
        playerStructures,
        playerPos.x,
        playerPos.z,
        'cow',
        85,
      ),
    );

    const buyOffers: MerchantTradeOffer[] = MERCHANT_BUY_CATALOG.map((o) => {
      const finalPriceCoins = computeDiscountedPrice(o.basePriceCoins, rep.discountPct);
      const lockedByLevel = rec.level < o.minVillageLevel;
      const lockedByPen =
        o.kind === 'animal' &&
        (o.animalSpecies === 'chicken' ? !hasCoopNearby : !hasPenNearby);
      return {
        id: o.id,
        kind: o.kind,
        itemId: o.itemId,
        animalSpecies: o.animalSpecies,
        count: o.count,
        name: lang === 'ar' ? o.nameAr : o.nameEn,
        description: lang === 'ar' ? o.descAr : o.descEn,
        basePriceCoins: o.basePriceCoins,
        finalPriceCoins,
        minVillageLevel: o.minVillageLevel,
        locked: lockedByLevel || lockedByPen,
        ownedCount: inventory.getItemCount(o.itemId),
      };
    });

    const sellMap = new Map<string, MerchantSellEntry>();
    const snap = inventory.getSnapshot();
    for (const slot of snap.slots) {
      if (!slot) continue;
      const def = inventory.itemManager.getItem(slot.itemId);
      const baseCoins = def?.valueCoins ?? 0;
      if (!def || baseCoins <= 0) continue;
      if (
        !SELLABLE_FARM_AND_TRADE_PRIORITY.has(def.id) &&
        def.category !== 'material' &&
        def.category !== 'consumable'
      ) {
        continue;
      }
      const existing = sellMap.get(def.id);
      if (existing) {
        existing.ownedCount += slot.count;
      } else {
        sellMap.set(def.id, {
          itemId: def.id,
          name: lang === 'ar' ? (def.nameAr ?? def.name) : def.name,
          ownedCount: slot.count,
          unitSellCoins: computeSellPrice(baseCoins, rep.sellBonusPct),
        });
      }
    }
    const sellEntries = Array.from(sellMap.values()).sort((a, b) => {
      const ap = SELLABLE_FARM_AND_TRADE_PRIORITY.has(a.itemId) ? 0 : 1;
      const bp = SELLABLE_FARM_AND_TRADE_PRIORITY.has(b.itemId) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return b.unitSellCoins - a.unitSellCoins;
    });

    return {
      npcId,
      merchantName,
      villageId: village.id,
      villageName: lang === 'ar' && village.nameAr ? village.nameAr : village.name,
      villageLevel: rec.level,
      reputationRank: rep.rank,
      reputationLabel: lang === 'ar' ? rep.labelAr : rep.labelEn,
      discountPct: rep.discountPct,
      sellBonusPct: rep.sellBonusPct,
      playerCoins,
      hasPlayerPenNearby: hasPenNearby || hasCoopNearby,
      buyOffers,
      sellEntries,
    };
  }

  public exportState(farmAnimals: FarmAnimalManager): SavedVillageDevelopmentState {
    const villages: Record<string, VillageDevelopmentRecord> = {};
    this.records.forEach((rec, id) => {
      villages[id] = {
        ...rec,
        completedRepairIds: [...rec.completedRepairIds],
        completedProjectIds: [...rec.completedProjectIds],
      };
    });
    return {
      villages,
      farmAnimals: farmAnimals.exportState(),
    };
  }

  public restoreState(
    saved: SavedVillageDevelopmentState | undefined,
    loadedVillages: ReadonlyArray<VillageSiteRecord>,
  ): void {
    this.records.clear();
    this.activeDefense = null;
    if (saved?.villages) {
      Object.entries(saved.villages).forEach(([id, r]) => {
        if (!r || typeof r !== 'object') return;
        const xp = Math.max(0, Number(r.progressXp) || 0);
        this.records.set(id, {
          villageId: id,
          level: this.computeLevelForXp(xp),
          progressXp: xp,
          reputationPoints: Math.max(0, Number(r.reputationPoints) || 0),
          completedRepairIds: Array.isArray(r.completedRepairIds) ? [...r.completedRepairIds] : [],
          completedProjectIds: Array.isArray(r.completedProjectIds) ? [...r.completedProjectIds] : [],
          cropsHarvestedCount: Math.max(0, Number(r.cropsHarvestedCount) || 0),
          tradesCompletedCount: Math.max(0, Number(r.tradesCompletedCount) || 0),
          defensesWonCount: Math.max(0, Number(r.defensesWonCount) || 0),
          lastRaidWorldHours: Number(r.lastRaidWorldHours) || 0,
        });
      });
    }
    for (const v of loadedVillages) {
      if (v.isLoaded) {
        this.rebuildVillageAddons(v);
      }
    }
  }

  public dispose(): void {
    const ids = Array.from(this.mountedAddons.keys());
    for (const id of ids) {
      this.onVillageUnloaded(id);
    }
    this.records.clear();
    this.rootGroup.removeFromParent();
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
    this.geoCache.clear();
  }

  // -------------------------------------------------------------------------
  // Additive 3D Geometry Builders (zero modification to existing villages)
  // -------------------------------------------------------------------------
  private findSafeAddonSpot(
    targetX: number,
    targetZ: number,
    fallbackX: number,
    fallbackZ: number,
  ): { x: number; y: number; z: number } {
    if (!isWater(targetX, targetZ)) {
      return { x: targetX, y: groundHeightAt(targetX, targetZ), z: targetZ };
    }
    for (let r = 2; r <= 12; r += 2) {
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const cx = targetX + Math.cos(ang) * r;
        const cz = targetZ + Math.sin(ang) * r;
        if (!isWater(cx, cz)) {
          return { x: cx, y: groundHeightAt(cx, cz), z: cz };
        }
      }
    }
    return { x: fallbackX, y: groundHeightAt(fallbackX, fallbackZ), z: fallbackZ };
  }

  private boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
    const key = `vb:${w.toFixed(2)}:${h.toFixed(2)}:${d.toFixed(2)}`;
    let g = this.geoCache.get(key);
    if (!g) {
      g = new THREE.BoxGeometry(w, h, d);
      this.geoCache.set(key, g);
      this.disposables.push(g);
    }
    return g;
  }

  private addMesh(
    group: THREE.Group,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ): void {
    const m = new THREE.Mesh(this.boxGeo(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  private buildVillageNoticeBoardMesh(level: VillageDevelopmentLevel): THREE.Group {
    const g = new THREE.Group();
    this.addMesh(g, 0.45, 0.25, 0.45, this.matStone, -0.78, 0.125, 0);
    this.addMesh(g, 0.45, 0.25, 0.45, this.matStone, 0.78, 0.125, 0);
    this.addMesh(g, 0.16, 2.25, 0.16, this.matWoodDark, -0.78, 1.15, 0);
    this.addMesh(g, 0.16, 2.25, 0.16, this.matWoodDark, 0.78, 1.15, 0);
    this.addMesh(g, 1.48, 0.96, 0.1, this.matWoodWarm, 0, 1.48, 0);
    this.addMesh(g, 0.46, 0.36, 0.04, this.matPaper, -0.34, 1.54, 0.06);
    this.addMesh(g, 0.44, 0.42, 0.04, this.matPaper, 0.3, 1.44, 0.06);
    this.addMesh(g, 1.95, 0.14, 0.68, this.matRoof, 0, 2.3, 0);
    if (level >= 2) {
      this.addMesh(g, 0.22, 0.28, 0.22, this.matLantern, 0.96, 2.02, 0);
    }
    return g;
  }

  private buildRepairMesh(kind: VillageRepairSiteDef['kind']): THREE.Group {
    const g = new THREE.Group();
    if (kind === 'storehouse') {
      this.addMesh(g, 2.6, 0.24, 2.2, this.matStone, 0, 0.12, 0);
      this.addMesh(g, 2.4, 1.6, 2.0, this.matWoodWarm, 0, 1.0, 0);
      this.addMesh(g, 2.7, 0.18, 2.3, this.matRoof, 0, 1.9, 0);
    } else {
      for (const sx of [-1.8, 0, 1.8]) {
        this.addMesh(g, 0.2, 1.15, 0.2, this.matWoodDark, sx, 0.575, 0);
      }
      this.addMesh(g, 3.8, 0.14, 0.1, this.matWoodWarm, 0, 0.45, 0);
      this.addMesh(g, 3.8, 0.14, 0.1, this.matWoodWarm, 0, 0.88, 0);
    }
    return g;
  }

  private buildProjectMesh(kind: VillageProjectDef['kind']): THREE.Group {
    const g = new THREE.Group();
    if (kind === 'granary') {
      this.addMesh(g, 2.8, 0.3, 2.8, this.matStone, 0, 0.15, 0);
      this.addMesh(g, 2.3, 2.5, 2.3, this.matWoodWarm, 0, 1.55, 0);
      this.addMesh(g, 2.7, 0.24, 2.7, this.matRoof, 0, 2.9, 0);
      this.addMesh(g, 0.9, 1.4, 0.16, this.matWoodDark, 0, 0.9, 1.18);
    } else if (kind === 'plaza_lanterns') {
      this.addMesh(g, 0.46, 0.3, 0.46, this.matStone, 0, 0.15, 0);
      this.addMesh(g, 0.18, 2.8, 0.18, this.matWoodDark, 0, 1.4, 0);
      this.addMesh(g, 0.18, 0.14, 0.65, this.matIron, 0, 2.72, 0.25);
      this.addMesh(g, 0.3, 0.38, 0.3, this.matLantern, 0, 2.42, 0.46);
    } else if (kind === 'workshop') {
      this.addMesh(g, 3.2, 0.24, 2.6, this.matStone, 0, 0.12, 0);
      for (const [px, pz] of [
        [-1.35, -1.05],
        [1.35, -1.05],
        [-1.35, 1.05],
        [1.35, 1.05],
      ]) {
        this.addMesh(g, 0.2, 2.2, 0.2, this.matWoodDark, px, 1.2, pz);
      }
      this.addMesh(g, 3.5, 0.18, 2.9, this.matRoof, 0, 2.35, 0);
      this.addMesh(g, 1.6, 0.78, 0.8, this.matWoodWarm, 0, 0.62, 0);
    } else {
      // Watchtower
      this.addMesh(g, 2.6, 0.4, 2.6, this.matStone, 0, 0.2, 0);
      for (const [px, pz] of [
        [-1.0, -1.0],
        [1.0, -1.0],
        [-1.0, 1.0],
        [1.0, 1.0],
      ]) {
        this.addMesh(g, 0.24, 4.2, 0.24, this.matWoodDark, px, 2.3, pz);
      }
      this.addMesh(g, 2.8, 0.22, 2.8, this.matWoodWarm, 0, 4.4, 0);
      this.addMesh(g, 3.0, 0.2, 3.0, this.matRoof, 0, 5.7, 0);
      this.addMesh(g, 0.28, 0.36, 0.28, this.matLantern, 0, 4.95, 1.15);
    }
    return g;
  }
}
