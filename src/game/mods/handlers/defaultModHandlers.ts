import type {
  BuildingBlueprint,
  BuildingCategory,
  StructureMaterialTier,
} from '../../building/buildingTypes';
import type { DamageType } from '../../combat/combatTypes';
import type {
  WeaponAttackAnimType,
  WeaponKind,
  WeaponStats,
} from '../../combat/weapons/Weapon';
import type {
  CraftingRecipe,
  EquipSlot,
  ItemDefinition,
  ItemIconKey,
  ToolKind,
} from '../../inventory/inventoryTypes';
import type { QuestDefinition } from '../../quest/questTypes';
import {
  clearAllModQuests,
  registerModQuestDefinition,
  unregisterModQuests,
} from '../../quest/questRegistry';
import { normalizeModAssetPath } from '../ModAssetResolver';
import {
  CORE_PROTECTED_IDS,
  NamespacedContentRegistry,
  resolveModCrossReference,
  resolveModObjectIdentifier,
} from '../ModNamespaceRegistry';
import { SUPPORTED_MOD_SCHEMA_VERSIONS, type ModAssetIndexEntry, type Woa3dModelDescriptor } from '../modTypes';
import { normalizeModRelativeAssetPathForLookup, parseAndValidateWoa3dText } from '../woa3dMetadata';
import {
  extractInlineEventDefinitions,
  normalizeTriggerType,
  sanitizeModEventDefinition,
  validateModEventCrossReferences,
  type ModEventCrossReferenceResolvers,
  type ModEventDefinition,
  type ModEventTriggerSpec,
  type ModEventTriggerType,
} from '../ModEventConfig';
import {
  extractInlineSpawnDefinitions,
  sanitizeModSpawnDefinition,
  type ModSpawnContentType,
  type ModSpawnDefinition,
} from '../ModSpawnConfig';
import type {
  ModContentHandler,
  ModContentHandlerResult,
  ModContentType,
  ModDiagnostic,
  ModGenericEntityDescriptor,
  ModLoadContext,
  ModLootDropEntry,
  ModLootTableDescriptor,
  ModMusicDescriptor,
  ModSoundDescriptor,
  ModTextureDescriptor,
} from '../modTypes';

const VALID_ITEM_ICONS = new Set<string>([
  'compass',
  'journal',
  'herb',
  'loaf',
  'tonic',
  'apple',
  'wheat',
  'seal',
  'boots',
  'cloak',
  'sword',
  'axe',
  'bow',
  'spear',
  'crossbow',
  'knife',
  'wood',
  'stone',
  'ore',
  'coal',
  'fiber',
  'hide',
  'meat',
  'cooked_meat',
  'arrow',
  'torch',
  'bed',
  'armor',
  'mushroom',
  'berries',
  'flower',
  'sand',
  'cactus',
  'shell',
  'crystal',
  'pickaxe',
  'shovel',
  'shirt',
  'pants',
  'gloves',
  'backpack',
  'ingot',
  'plank',
  'gravel',
  'station',
  'cloth',
  'club',
  'seed',
  'corn',
  'carrot',
  'potato',
  'tomato',
  'egg',
  'milk',
  'cheese',
  'watering_can',
  'hoe',
]);

const VALID_EQUIP_SLOTS = new Set<string>([
  'weapon',
  'head',
  'body',
  'legs',
  'hands',
  'boots',
  'backpack',
  'accessory',
]);

const VALID_TOOL_KINDS = new Set<string>(['axe', 'pickaxe', 'shovel']);

const VALID_WEAPON_KINDS = new Set<string>([
  'sword',
  'axe',
  'bow',
  'spear',
  'crossbow',
  'knife',
]);

const VALID_BUILDING_CATEGORIES = new Set<string>([
  'structures',
  'doors_windows',
  'storage',
  'crafting',
  'farming',
  'furniture',
]);

const VALID_MATERIAL_TIERS = new Set<string>(['wood', 'stone', 'reinforced']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function extractEntriesList(data: unknown, containerKeys: string[]): unknown[] {
  if (Array.isArray(data)) return data;
  if (!isRecord(data)) return [];
  for (const key of containerKeys) {
    const candidate = data[key];
    if (Array.isArray(candidate)) return candidate;
  }
  if (typeof data.id === 'string') return [data];
  return [];
}

function sanitizeIconKey(raw: unknown, fallback: ItemIconKey): ItemIconKey {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (VALID_ITEM_ICONS.has(trimmed)) {
      return trimmed as ItemIconKey;
    }
  }
  return fallback;
}

function inferWeaponKind(raw: Record<string, unknown>, icon: ItemIconKey): WeaponKind {
  const explicit =
    typeof raw.weaponKind === 'string'
      ? raw.weaponKind.trim().toLowerCase()
      : isRecord(raw.weaponStats) && typeof raw.weaponStats.kind === 'string'
        ? raw.weaponStats.kind.trim().toLowerCase()
        : '';
  if (VALID_WEAPON_KINDS.has(explicit)) {
    return explicit as WeaponKind;
  }
  if (icon === 'axe') return 'axe';
  if (icon === 'bow') return 'bow';
  if (icon === 'spear') return 'spear';
  if (icon === 'crossbow') return 'crossbow';
  if (icon === 'knife') return 'knife';
  return 'sword';
}

function defaultAnimForKind(kind: WeaponKind): WeaponAttackAnimType {
  switch (kind) {
    case 'axe':
      return 'heavy_chop';
    case 'bow':
    case 'crossbow':
      return 'bow_shot';
    case 'spear':
      return 'spear_thrust';
    case 'knife':
      return 'knife_slash';
    default:
      return 'melee_slash';
  }
}

function defaultDamageTypeForKind(kind: WeaponKind): DamageType {
  switch (kind) {
    case 'bow':
    case 'crossbow':
    case 'spear':
      return 'pierce';
    case 'axe':
      return 'blunt';
    default:
      return 'slash';
  }
}

function resolveOptionalAssetField(
  modId: string,
  raw: Record<string, unknown>,
  fieldNames: string[],
  diagnostics: ModDiagnostic[],
  sourceFile: string,
): { ok: true; value?: string } | { ok: false } {
  for (const field of fieldNames) {
    const rawVal = raw[field];
    if (typeof rawVal === 'string' && rawVal.trim()) {
      const normalized = normalizeModAssetPath(modId, rawVal);
      if (!normalized.ok) {
        diagnostics.push({
          code: normalized.code,
          severity: 'error',
          message: `Unsafe or invalid asset path "${rawVal}" in "${sourceFile}": ${normalized.message}`,
        });
        return { ok: false };
      }
      return { ok: true, value: normalized.canonicalRef };
    }
  }
  return { ok: true };
}

type ItemFlavorMode =
  | 'items'
  | 'weapons'
  | 'armor'
  | 'tools'
  | 'consumables'
  | 'resources';

function sanitizeItemLikeDefinition(
  modId: string,
  raw: unknown,
  mode: ItemFlavorMode,
  sourceFile: string,
  diagnostics: ModDiagnostic[],
): { item: ItemDefinition; weaponStats?: WeaponStats } | null {
  if (!isRecord(raw)) return null;
  const rawId = typeof raw.id === 'string' ? raw.id.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!rawId || !name) return null;

  const idRes = resolveModObjectIdentifier(modId, rawId, CORE_PROTECTED_IDS);
  if (!idRes.ok) {
    diagnostics.push({
      code: idRes.code,
      severity: 'error',
      message: `${sourceFile}: ${idRes.message}`,
    });
    return null;
  }

  const assetCheck = resolveOptionalAssetField(
    modId,
    raw,
    ['iconTexture', 'texture', 'texturePath'],
    diagnostics,
    sourceFile,
  );
  if (!assetCheck.ok) return null;

  const modelCheck = resolveOptionalAssetField(
    modId,
    raw,
    ['modelPath', 'model', 'modelAsset', 'woa3d', 'woa3dPath', 'model3d'],
    diagnostics,
    sourceFile,
  );
  if (!modelCheck.ok) return null;

  const id = idRes.fullId;

  let defaultCategory: ItemDefinition['category'] = 'material';
  let defaultIcon: ItemIconKey = 'stone';
  let defaultEquipSlot: EquipSlot | undefined;
  let defaultStackable = true;
  let defaultMaxStack = 50;
  let defaultUsable = false;

  if (mode === 'weapons') {
    defaultCategory = 'weapon';
    defaultIcon = 'sword';
    defaultEquipSlot = 'weapon';
    defaultUsable = true;
    defaultStackable = false;
    defaultMaxStack = 1;
  } else if (mode === 'armor') {
    defaultCategory = 'equipment';
    defaultIcon = 'armor';
    defaultEquipSlot = 'body';
    defaultUsable = true;
    defaultStackable = false;
    defaultMaxStack = 1;
  } else if (mode === 'tools') {
    defaultCategory = 'tool';
    defaultIcon = 'pickaxe';
    defaultEquipSlot = 'weapon';
    defaultUsable = true;
    defaultStackable = false;
    defaultMaxStack = 1;
  } else if (mode === 'consumables') {
    defaultCategory = 'consumable';
    defaultIcon = 'tonic';
    defaultUsable = true;
    defaultStackable = true;
    defaultMaxStack = 20;
  } else if (mode === 'resources') {
    defaultCategory = 'material';
    defaultIcon = 'ore';
    defaultStackable = true;
    defaultMaxStack = 99;
  }

  const rawCategory =
    typeof raw.category === 'string' ? raw.category.trim() : '';
  const validCategories = new Set([
    'consumable',
    'quest',
    'equipment',
    'weapon',
    'material',
    'tool',
  ]);
  const category: ItemDefinition['category'] =
    mode === 'items' && validCategories.has(rawCategory)
      ? (rawCategory as ItemDefinition['category'])
      : defaultCategory;

  const resolvedEquipSlot =
    typeof raw.equipSlot === 'string' && VALID_EQUIP_SLOTS.has(raw.equipSlot.trim())
      ? (raw.equipSlot.trim() as EquipSlot)
      : defaultEquipSlot;

  const icon = sanitizeIconKey(raw.icon, defaultIcon);
  const def: ItemDefinition = {
    id,
    name,
    nameAr: typeof raw.nameAr === 'string' && raw.nameAr.trim() ? raw.nameAr.trim() : name,
    description: typeof raw.description === 'string' ? raw.description : '',
    descriptionAr:
      typeof raw.descriptionAr === 'string' && raw.descriptionAr.trim()
        ? raw.descriptionAr
        : typeof raw.description === 'string'
          ? raw.description
          : '',
    category,
    icon,
    stackable:
      typeof raw.stackable === 'boolean' ? raw.stackable : defaultStackable,
    maxStack:
      typeof raw.maxStack === 'number' && raw.maxStack > 0
        ? Math.trunc(raw.maxStack)
        : defaultMaxStack,
    usable:
      typeof raw.usable === 'boolean'
        ? raw.usable
        : defaultUsable || Boolean(resolvedEquipSlot),
    droppable: typeof raw.droppable === 'boolean' ? raw.droppable : true,
    valueCoins:
      typeof raw.valueCoins === 'number' && Number.isFinite(raw.valueCoins)
        ? Math.max(0, Math.round(raw.valueCoins))
        : undefined,
    ...(modelCheck.value ? { modelPath: modelCheck.value } : {}),
    ...(assetCheck.value ? { iconTexture: assetCheck.value } : {}),
  };

  if (resolvedEquipSlot) {
    def.equipSlot = resolvedEquipSlot;
  }

  if (mode === 'tools') {
    const rawTool = typeof raw.toolKind === 'string' ? raw.toolKind.trim() : 'pickaxe';
    def.toolKind = VALID_TOOL_KINDS.has(rawTool)
      ? (rawTool as ToolKind)
      : 'pickaxe';
    const tier = Number(raw.toolTier ?? raw.toolPower ?? 2);
    def.toolTier = Number.isFinite(tier) && tier > 0 ? Math.trunc(tier) : 2;
    if (typeof raw.maxDurability === 'number' && Number.isFinite(raw.maxDurability) && raw.maxDurability > 0) {
      def.maxDurability = Math.trunc(raw.maxDurability);
    }
  } else if (typeof raw.toolKind === 'string' && VALID_TOOL_KINDS.has(raw.toolKind.trim())) {
    def.toolKind = raw.toolKind.trim() as ToolKind;
    const tier = Number(raw.toolTier ?? raw.toolPower);
    if (Number.isFinite(tier) && tier > 0) {
      def.toolTier = Math.trunc(tier);
    }
  }

  if (isRecord(raw.equipStats)) {
    def.equipStats = raw.equipStats as ItemDefinition['equipStats'];
  } else if (mode === 'armor') {
    const defense = Number(raw.defense ?? raw.armor ?? raw.damageReductionBonus ?? 0);
    const maxHealthBonus = Number(raw.maxHealthBonus ?? 0);
    const maxStaminaBonus = Number(raw.maxStaminaBonus ?? 0);
    const speedBonus = Number(raw.speedBonus ?? 0);
    const capacityBonus = Number(raw.capacityBonus ?? 0);
    def.equipStats = {
      ...(Number.isFinite(defense) && defense > 0
        ? { damageReductionBonus: defense }
        : { damageReductionBonus: 0.08 }),
      ...(Number.isFinite(maxHealthBonus) && maxHealthBonus > 0 ? { maxHealthBonus } : {}),
      ...(Number.isFinite(maxStaminaBonus) && maxStaminaBonus > 0 ? { maxStaminaBonus } : {}),
      ...(Number.isFinite(speedBonus) && speedBonus !== 0 ? { speedBonus } : {}),
      ...(Number.isFinite(capacityBonus) && capacityBonus > 0 ? { capacityBonus } : {}),
    };
  }

  if (isRecord(raw.consumeEffect)) {
    def.consumeEffect = raw.consumeEffect as ItemDefinition['consumeEffect'];
  } else if (mode === 'consumables') {
    const health = Number(raw.health ?? raw.healHealth ?? 0);
    const stamina = Number(raw.stamina ?? raw.restoreStamina ?? 0);
    if (health > 0 || stamina > 0) {
      def.consumeEffect = {
        ...(health > 0 ? { health } : {}),
        ...(stamina > 0 ? { stamina } : {}),
      };
    }
  }

  let builtWeaponStats: WeaponStats | undefined;
  const rawWStats = isRecord(raw.weaponStats) ? raw.weaponStats : undefined;
  const dmg = Number(rawWStats?.damage ?? raw.damage ?? (mode === 'weapons' ? 25 : 0));
  if (mode === 'weapons' || (rawWStats && Number.isFinite(dmg) && dmg > 0)) {
    const cd = Number(rawWStats?.cooldown ?? raw.cooldown ?? 0.45);
    const rng = Number(rawWStats?.range ?? raw.range ?? 2.8);
    const staminaCost = Number(rawWStats?.staminaCost ?? raw.staminaCost ?? 5);
    const critChance = Number(rawWStats?.critChance ?? raw.critChance ?? 0.16);
    const critMultiplier = Number(rawWStats?.critMultiplier ?? 1.5);
    const isRanged = Boolean(rawWStats?.isRanged ?? raw.isRanged ?? false);
    const kind = inferWeaponKind(raw, icon);

    def.weaponStats = {
      damage: Number.isFinite(dmg) && dmg > 0 ? dmg : 25,
      cooldown: Number.isFinite(cd) && cd > 0 ? cd : 0.45,
      range: Number.isFinite(rng) && rng > 0 ? rng : 2.8,
      isRanged,
      staminaCost: Number.isFinite(staminaCost) && staminaCost >= 0 ? staminaCost : 5,
      critChance:
        Number.isFinite(critChance) && critChance >= 0 && critChance <= 1
          ? critChance
          : 0.16,
    };
    def.equipSlot = 'weapon';
    const rawWeaponId =
      typeof raw.weaponId === 'string' && raw.weaponId.trim()
        ? resolveModCrossReference(modId, raw.weaponId)
        : id;
    def.weaponId = rawWeaponId;

    builtWeaponStats = {
      id: rawWeaponId,
      itemId: id,
      name: def.name,
      nameAr: def.nameAr,
      kind,
      damage: def.weaponStats.damage,
      critChance: def.weaponStats.critChance ?? 0.16,
      critMultiplier: Number.isFinite(critMultiplier) && critMultiplier >= 1 ? critMultiplier : 1.5,
      cooldown: def.weaponStats.cooldown,
      hitDelay: 0.09,
      swingDuration: 0.28,
      range: def.weaponStats.range,
      arcAngleRad: kind === 'spear' ? Math.PI * 0.42 : Math.PI * 0.76,
      knockback: isRanged ? 3.5 : 5.0,
      staminaCost: def.weaponStats.staminaCost,
      attackAnim: defaultAnimForKind(kind),
      damageType: defaultDamageTypeForKind(kind),
      isRanged,
      projectileSpeed: isRanged ? 34 : undefined,
      chargeDuration: isRanged ? 0.55 : undefined,
      ...(modelCheck.value ? { modelPath: modelCheck.value } : {}),
    };
  }

  return { item: def, weaponStats: builtWeaponStats };
}

function sanitizeRecipe(
  modId: string,
  raw: unknown,
  sourceFile: string,
  diagnostics: ModDiagnostic[],
): CraftingRecipe | null {
  if (!isRecord(raw)) return null;
  const rawId = typeof raw.id === 'string' ? raw.id.trim() : '';
  const rawResultItemId =
    typeof raw.resultItemId === 'string' ? raw.resultItemId.trim() : '';
  if (!rawId || !rawResultItemId || !Array.isArray(raw.ingredients)) return null;

  const idRes = resolveModObjectIdentifier(modId, rawId, CORE_PROTECTED_IDS);
  if (!idRes.ok) {
    diagnostics.push({
      code: idRes.code,
      severity: 'error',
      message: `${sourceFile}: ${idRes.message}`,
    });
    return null;
  }

  const ingredients = raw.ingredients
    .filter(isRecord)
    .map((ing) => ({
      itemId:
        typeof ing.itemId === 'string' && ing.itemId.trim()
          ? resolveModCrossReference(modId, ing.itemId)
          : '',
      count: typeof ing.count === 'number' && ing.count > 0 ? Math.trunc(ing.count) : 1,
    }))
    .filter((ing) => ing.itemId.length > 0);

  if (ingredients.length === 0) return null;

  return {
    id: idRes.fullId,
    resultItemId: resolveModCrossReference(modId, rawResultItemId),
    resultCount:
      typeof raw.resultCount === 'number' && raw.resultCount > 0
        ? Math.trunc(raw.resultCount)
        : 1,
    category:
      typeof raw.category === 'string'
        ? (raw.category as CraftingRecipe['category'])
        : 'material',
    ingredients,
    station:
      typeof raw.station === 'string'
        ? (raw.station as CraftingRecipe['station'])
        : 'hand',
    requiredLevel:
      typeof raw.requiredLevel === 'number' ? Math.trunc(raw.requiredLevel) : undefined,
    prerequisiteRecipeId:
      typeof raw.prerequisiteRecipeId === 'string' && raw.prerequisiteRecipeId.trim()
        ? resolveModCrossReference(modId, raw.prerequisiteRecipeId)
        : typeof raw.unlockedByRecipeId === 'string' && raw.unlockedByRecipeId.trim()
          ? resolveModCrossReference(modId, raw.unlockedByRecipeId)
          : undefined,
    craftingTimeSec:
      typeof raw.craftingTimeSec === 'number' && raw.craftingTimeSec > 0
        ? raw.craftingTimeSec
        : 0.5,
  };
}

function sanitizeQuest(
  modId: string,
  raw: unknown,
  sourceFile: string,
  diagnostics: ModDiagnostic[],
): QuestDefinition | null {
  if (!isRecord(raw)) return null;
  const rawId = typeof raw.id === 'string' ? raw.id.trim() : '';
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const giverNpcId =
    typeof raw.giverNpcId === 'string' ? raw.giverNpcId.trim() : '';
  if (!rawId || !title || !giverNpcId || !Array.isArray(raw.objectives)) return null;

  const idRes = resolveModObjectIdentifier(modId, rawId, CORE_PROTECTED_IDS);
  if (!idRes.ok) {
    diagnostics.push({
      code: idRes.code,
      severity: 'error',
      message: `${sourceFile}: ${idRes.message}`,
    });
    return null;
  }

  const normalizedObjectives = raw.objectives
    .filter(isRecord)
    .map((obj) => {
      const copy: Record<string, unknown> = { ...obj };
      if (typeof copy.itemId === 'string' && copy.itemId.trim()) {
        copy.itemId = resolveModCrossReference(modId, copy.itemId);
      }
      if (typeof copy.npcId === 'string' && copy.npcId.trim()) {
        copy.npcId = resolveModCrossReference(modId, copy.npcId);
      }
      if (typeof copy.targetNpcId === 'string' && copy.targetNpcId.trim()) {
        copy.targetNpcId = resolveModCrossReference(modId, copy.targetNpcId);
      }
      if (typeof copy.enemyType === 'string' && copy.enemyType.trim()) {
        copy.enemyType = resolveModCrossReference(modId, copy.enemyType);
      }
      return copy;
    }) as unknown as QuestDefinition['objectives'];

  const rawReward = isRecord(raw.reward) ? { ...raw.reward } : {};
  if (Array.isArray(rawReward.items)) {
    rawReward.items = rawReward.items.map((item) => {
      if (!isRecord(item)) return item;
      return {
        ...item,
        id:
          typeof item.id === 'string' && item.id.trim()
            ? resolveModCrossReference(modId, item.id)
            : item.id,
      };
    });
  }

  return {
    id: idRes.fullId,
    title,
    titleAr: typeof raw.titleAr === 'string' ? raw.titleAr : title,
    scope: raw.scope === 'cooperative' ? 'cooperative' : 'personal',
    giverNpcId: resolveModCrossReference(modId, giverNpcId),
    turnInNpcId:
      typeof raw.turnInNpcId === 'string' && raw.turnInNpcId.trim()
        ? resolveModCrossReference(modId, raw.turnInNpcId)
        : resolveModCrossReference(modId, giverNpcId),
    description: typeof raw.description === 'string' ? raw.description : '',
    descriptionAr:
      typeof raw.descriptionAr === 'string' ? raw.descriptionAr : undefined,
    sequential: typeof raw.sequential === 'boolean' ? raw.sequential : true,
    objectives: normalizedObjectives,
    reward: rawReward as QuestDefinition['reward'],
    rewardSummary:
      typeof raw.rewardSummary === 'string' ? raw.rewardSummary : 'Reward',
    rewardSummaryAr:
      typeof raw.rewardSummaryAr === 'string' ? raw.rewardSummaryAr : undefined,
  };
}

function sanitizeBlueprint(
  modId: string,
  raw: unknown,
  isDecoration: boolean,
  sourceFile: string,
  diagnostics: ModDiagnostic[],
): BuildingBlueprint | null {
  if (!isRecord(raw)) return null;
  const rawId = typeof raw.id === 'string' ? raw.id.trim() : '';
  const nameEn =
    typeof raw.nameEn === 'string' && raw.nameEn.trim()
      ? raw.nameEn.trim()
      : typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : '';
  if (!rawId || !nameEn) return null;

  const idRes = resolveModObjectIdentifier(modId, rawId, CORE_PROTECTED_IDS);
  if (!idRes.ok) {
    diagnostics.push({
      code: idRes.code,
      severity: 'error',
      message: `${sourceFile}: ${idRes.message}`,
    });
    return null;
  }

  const assetCheck = resolveOptionalAssetField(
    modId,
    raw,
    ['texture', 'texturePath'],
    diagnostics,
    sourceFile,
  );
  if (!assetCheck.ok) return null;

  const modelCheck = resolveOptionalAssetField(
    modId,
    raw,
    ['modelPath', 'model', 'modelAsset', 'woa3d', 'woa3dPath', 'model3d'],
    diagnostics,
    sourceFile,
  );
  if (!modelCheck.ok) return null;

  const rawCat = typeof raw.category === 'string' ? raw.category.trim() : '';
  const category: BuildingCategory = VALID_BUILDING_CATEGORIES.has(rawCat)
    ? (rawCat as BuildingCategory)
    : isDecoration
      ? 'furniture'
      : 'structures';

  const rawTier = typeof raw.tier === 'string' ? raw.tier.trim() : '';
  const tier: StructureMaterialTier = VALID_MATERIAL_TIERS.has(rawTier)
    ? (rawTier as StructureMaterialTier)
    : 'wood';

  const costs = Array.isArray(raw.costs)
    ? raw.costs
        .filter(isRecord)
        .map((c) => ({
          itemId:
            typeof c.itemId === 'string' && c.itemId.trim()
              ? resolveModCrossReference(modId, c.itemId)
              : 'wood',
          count:
            typeof c.count === 'number' && c.count > 0 ? Math.trunc(c.count) : 1,
        }))
    : [{ itemId: 'wood', count: 4 }];

  const repairCosts = Array.isArray(raw.repairCosts)
    ? raw.repairCosts
        .filter(isRecord)
        .map((c) => ({
          itemId:
            typeof c.itemId === 'string' && c.itemId.trim()
              ? resolveModCrossReference(modId, c.itemId)
              : 'wood',
          count:
            typeof c.count === 'number' && c.count > 0 ? Math.trunc(c.count) : 1,
        }))
    : [{ itemId: 'wood', count: 2 }];

  return {
    id: idRes.fullId,
    category,
    tier,
    nameEn,
    nameAr:
      typeof raw.nameAr === 'string' && raw.nameAr.trim() ? raw.nameAr.trim() : nameEn,
    descEn:
      typeof raw.descEn === 'string'
        ? raw.descEn
        : typeof raw.description === 'string'
          ? raw.description
          : nameEn,
    descAr:
      typeof raw.descAr === 'string' && raw.descAr.trim()
        ? raw.descAr
        : typeof raw.descriptionAr === 'string' && raw.descriptionAr.trim()
          ? raw.descriptionAr
          : nameEn,
    width: typeof raw.width === 'number' && raw.width > 0 ? raw.width : isDecoration ? 1.0 : 3.2,
    depth: typeof raw.depth === 'number' && raw.depth > 0 ? raw.depth : isDecoration ? 1.0 : 3.2,
    height:
      typeof raw.height === 'number' && raw.height > 0 ? raw.height : isDecoration ? 1.2 : 2.8,
    waterBuffer:
      typeof raw.waterBuffer === 'number' && raw.waterBuffer >= 0 ? raw.waterBuffer : 2.0,
    maxSlope:
      typeof raw.maxSlope === 'number' && raw.maxSlope > 0 ? raw.maxSlope : 0.45,
    maxRelief:
      typeof raw.maxRelief === 'number' && raw.maxRelief > 0 ? raw.maxRelief : 1.5,
    allowOnFloor:
      typeof raw.allowOnFloor === 'boolean' ? raw.allowOnFloor : isDecoration,
    isDecorative:
      typeof raw.isDecorative === 'boolean' ? raw.isDecorative : isDecoration,
    costs,
    maxHealth:
      typeof raw.maxHealth === 'number' && raw.maxHealth > 0
        ? Math.round(raw.maxHealth)
        : isDecoration
          ? 120
          : 250,
    repairCosts,
    ...(typeof raw.isHouse === 'boolean' ? { isHouse: raw.isHouse } : {}),
    ...(typeof raw.wallHeight === 'number' && raw.wallHeight > 0 ? { wallHeight: raw.wallHeight } : {}),
    ...(typeof raw.roofHeight === 'number' && raw.roofHeight > 0 ? { roofHeight: raw.roofHeight } : {}),
    ...(typeof raw.hasDoor === 'boolean' ? { hasDoor: raw.hasDoor } : {}),
    ...(isRecord(raw.doorOffset) &&
    typeof raw.doorOffset.x === 'number' &&
    typeof raw.doorOffset.y === 'number' &&
    typeof raw.doorOffset.z === 'number' &&
    typeof raw.doorOffset.halfW === 'number' &&
    typeof raw.doorOffset.halfD === 'number' &&
    typeof raw.doorOffset.height === 'number'
      ? {
          doorOffset: {
            x: raw.doorOffset.x,
            y: raw.doorOffset.y,
            z: raw.doorOffset.z,
            halfW: raw.doorOffset.halfW,
            halfD: raw.doorOffset.halfD,
            height: raw.doorOffset.height,
          },
        }
      : {}),
    ...(typeof raw.isFloorPiece === 'boolean' ? { isFloorPiece: raw.isFloorPiece } : {}),
    ...(typeof raw.isRoofPiece === 'boolean' ? { isRoofPiece: raw.isRoofPiece } : {}),
    ...(typeof raw.isWallPiece === 'boolean' ? { isWallPiece: raw.isWallPiece } : {}),
    ...(typeof raw.isDoorPiece === 'boolean' ? { isDoorPiece: raw.isDoorPiece } : {}),
    ...(typeof raw.isStairsPiece === 'boolean' ? { isStairsPiece: raw.isStairsPiece } : {}),
    ...(modelCheck.value ? { modelPath: modelCheck.value } : {}),
  };
}

function sanitizeLootTable(
  modId: string,
  raw: unknown,
  sourceFile: string,
  diagnostics: ModDiagnostic[],
): ModLootTableDescriptor | null {
  if (!isRecord(raw)) return null;
  const rawId = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!rawId) return null;

  const idRes = resolveModObjectIdentifier(modId, rawId, CORE_PROTECTED_IDS);
  if (!idRes.ok) {
    diagnostics.push({
      code: idRes.code,
      severity: 'error',
      message: `${sourceFile}: ${idRes.message}`,
    });
    return null;
  }

  const rawEntries = Array.isArray(raw.entries)
    ? raw.entries
    : Array.isArray(raw.drops)
      ? raw.drops
      : [];

  const entries: ModLootDropEntry[] = rawEntries
    .filter(isRecord)
    .map((entry) => {
      const rawItem =
        typeof entry.itemId === 'string' && entry.itemId.trim()
          ? entry.itemId.trim()
          : '';
      const minCount =
        typeof entry.minCount === 'number' && entry.minCount >= 1
          ? Math.trunc(entry.minCount)
          : typeof entry.count === 'number' && entry.count >= 1
            ? Math.trunc(entry.count)
            : 1;
      const maxCount =
        typeof entry.maxCount === 'number' && entry.maxCount >= minCount
          ? Math.trunc(entry.maxCount)
          : minCount;
      const chance =
        typeof entry.chance === 'number' && Number.isFinite(entry.chance)
          ? Math.max(0, Math.min(1, entry.chance))
          : 1;
      const weight =
        typeof entry.weight === 'number' && entry.weight > 0 ? entry.weight : undefined;
      return {
        itemId: rawItem ? resolveModCrossReference(modId, rawItem) : '',
        minCount,
        maxCount,
        chance,
        weight,
      };
    })
    .filter((e) => e.itemId.length > 0);

  if (entries.length === 0) return null;

  return {
    id: idRes.fullId,
    modId,
    sourceFile,
    rolls: typeof raw.rolls === 'number' && raw.rolls >= 1 ? Math.trunc(raw.rolls) : 1,
    entries,
  };
}

function sanitizeSoundDescriptor(
  modId: string,
  raw: unknown,
  sourceFile: string,
  diagnostics: ModDiagnostic[],
): ModSoundDescriptor | null {
  if (!isRecord(raw)) return null;
  const rawId = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!rawId) return null;

  const idRes = resolveModObjectIdentifier(modId, rawId, CORE_PROTECTED_IDS);
  if (!idRes.ok) {
    diagnostics.push({
      code: idRes.code,
      severity: 'error',
      message: `${sourceFile}: ${idRes.message}`,
    });
    return null;
  }

  const audioCheck = resolveOptionalAssetField(
    modId,
    raw,
    ['audioPath', 'sound', 'path', 'file', 'src'],
    diagnostics,
    sourceFile,
  );
  if (!audioCheck.ok || !audioCheck.value) {
    if (audioCheck.ok) {
      diagnostics.push({
        code: 'MISSING_AUDIO_PATH',
        severity: 'warning',
        message: `Sound "${idRes.fullId}" in "${sourceFile}" is missing an audio path.`,
      });
    }
    return null;
  }

  const busRaw = typeof raw.bus === 'string' ? raw.bus.trim() : 'effects';
  const bus: ModSoundDescriptor['bus'] =
    busRaw === 'ambient' || busRaw === 'ui' || busRaw === 'voice'
      ? busRaw
      : 'effects';

  return {
    id: idRes.fullId,
    modId,
    sourceFile,
    audioPath: audioCheck.value,
    bus,
    volume:
      typeof raw.volume === 'number' && Number.isFinite(raw.volume)
        ? Math.max(0, Math.min(1, raw.volume))
        : 0.75,
    pitchVariance:
      typeof raw.pitchVariance === 'number' && Number.isFinite(raw.pitchVariance)
        ? Math.max(0, Math.min(0.5, raw.pitchVariance))
        : 0.05,
    minIntervalMs:
      typeof raw.minIntervalMs === 'number' && raw.minIntervalMs >= 0
        ? Math.trunc(raw.minIntervalMs)
        : 45,
    maxDistance:
      typeof raw.maxDistance === 'number' && raw.maxDistance > 0
        ? raw.maxDistance
        : 42,
    looping: Boolean(raw.looping ?? raw.loop),
  };
}

function sanitizeMusicDescriptor(
  modId: string,
  raw: unknown,
  sourceFile: string,
  diagnostics: ModDiagnostic[],
): ModMusicDescriptor | null {
  if (!isRecord(raw)) return null;
  const rawId = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!rawId) return null;

  const idRes = resolveModObjectIdentifier(modId, rawId, CORE_PROTECTED_IDS);
  if (!idRes.ok) {
    diagnostics.push({
      code: idRes.code,
      severity: 'error',
      message: `${sourceFile}: ${idRes.message}`,
    });
    return null;
  }

  const audioCheck = resolveOptionalAssetField(
    modId,
    raw,
    ['audioPath', 'track', 'path', 'file', 'src'],
    diagnostics,
    sourceFile,
  );
  if (!audioCheck.ok || !audioCheck.value) {
    return null;
  }

  const title =
    typeof raw.title === 'string' && raw.title.trim()
      ? raw.title.trim()
      : idRes.objectId;
  const ctxRaw = typeof raw.context === 'string' ? raw.context.trim() : 'explore';
  const context: ModMusicDescriptor['context'] =
    ctxRaw === 'menu' ||
    ctxRaw === 'combat' ||
    ctxRaw === 'village' ||
    ctxRaw === 'night' ||
    ctxRaw === 'boss'
      ? ctxRaw
      : 'explore';

  return {
    id: idRes.fullId,
    modId,
    sourceFile,
    audioPath: audioCheck.value,
    title,
    titleAr:
      typeof raw.titleAr === 'string' && raw.titleAr.trim() ? raw.titleAr.trim() : title,
    context,
    biome: typeof raw.biome === 'string' && raw.biome.trim() ? raw.biome.trim() : undefined,
    volume:
      typeof raw.volume === 'number' && Number.isFinite(raw.volume)
        ? Math.max(0, Math.min(1, raw.volume))
        : 0.6,
    loop: typeof raw.loop === 'boolean' ? raw.loop : true,
    fadeSeconds:
      typeof raw.fadeSeconds === 'number' && raw.fadeSeconds >= 0 ? raw.fadeSeconds : 1.5,
  };
}

function sanitizeTextureDescriptor(
  modId: string,
  raw: unknown,
  sourceFile: string,
  diagnostics: ModDiagnostic[],
): ModTextureDescriptor | null {
  if (!isRecord(raw)) return null;
  const rawId = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!rawId) return null;

  const idRes = resolveModObjectIdentifier(modId, rawId, CORE_PROTECTED_IDS);
  if (!idRes.ok) {
    diagnostics.push({
      code: idRes.code,
      severity: 'error',
      message: `${sourceFile}: ${idRes.message}`,
    });
    return null;
  }

  const texCheck = resolveOptionalAssetField(
    modId,
    raw,
    ['texturePath', 'texture', 'path', 'file', 'src'],
    diagnostics,
    sourceFile,
  );
  if (!texCheck.ok || !texCheck.value) {
    return null;
  }

  return {
    id: idRes.fullId,
    modId,
    sourceFile,
    texturePath: texCheck.value,
    targetCategory:
      typeof raw.targetCategory === 'string' && raw.targetCategory.trim()
        ? raw.targetCategory.trim()
        : 'items',
    targetId:
      typeof raw.targetId === 'string' && raw.targetId.trim()
        ? resolveModCrossReference(modId, raw.targetId)
        : undefined,
    repeatX:
      typeof raw.repeatX === 'number' && raw.repeatX > 0 ? raw.repeatX : 1,
    repeatY:
      typeof raw.repeatY === 'number' && raw.repeatY > 0 ? raw.repeatY : 1,
  };
}

function sanitizeEntityDescriptor(
  modId: string,
  category: ModContentType,
  raw: unknown,
  sourceFile: string,
  diagnostics: ModDiagnostic[],
): ModGenericEntityDescriptor | null {
  if (!isRecord(raw)) return null;
  const rawId = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!rawId) return null;

  const idRes = resolveModObjectIdentifier(modId, rawId, CORE_PROTECTED_IDS);
  if (!idRes.ok) {
    diagnostics.push({
      code: idRes.code,
      severity: 'error',
      message: `${sourceFile}: ${idRes.message}`,
    });
    return null;
  }

  const texCheck = resolveOptionalAssetField(
    modId,
    raw,
    ['texturePath', 'texture', 'sprite'],
    diagnostics,
    sourceFile,
  );
  if (!texCheck.ok) return null;

  const modelCheck = resolveOptionalAssetField(
    modId,
    raw,
    ['modelPath', 'model', 'modelAsset', 'woa3d', 'woa3dPath', 'model3d'],
    diagnostics,
    sourceFile,
  );
  if (!modelCheck.ok) return null;

  const name =
    typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim()
      : idRes.objectId;

  const sanitizedRaw: Record<string, unknown> = {
    ...raw,
    id: idRes.fullId,
    ...(texCheck.value ? { texturePath: texCheck.value } : {}),
    ...(modelCheck.value ? { modelPath: modelCheck.value } : {}),
  };

  if (typeof raw.lootTableId === 'string' && raw.lootTableId.trim()) {
    sanitizedRaw.lootTableId = resolveModCrossReference(modId, raw.lootTableId);
  }

  return {
    id: idRes.fullId,
    modId,
    category,
    sourceFile,
    name,
    nameAr:
      typeof raw.nameAr === 'string' && raw.nameAr.trim() ? raw.nameAr.trim() : name,
    texturePath: texCheck.value,
    modelPath: modelCheck.value,
    lootTableId:
      typeof sanitizedRaw.lootTableId === 'string' ? sanitizedRaw.lootTableId : undefined,
    raw: sanitizedRaw,
  };
}

export interface ModDescriptorEntry {
  modId: string;
  id: string;
  payload: Record<string, unknown>;
}

export interface ModLocalizationEntry {
  id: string;
  lang: string;
  key: string;
  value: string;
}

export interface ModContentRegistryMap {
  items: NamespacedContentRegistry<ItemDefinition>;
  weapons: NamespacedContentRegistry<ItemDefinition>;
  armor: NamespacedContentRegistry<ItemDefinition>;
  tools: NamespacedContentRegistry<ItemDefinition>;
  consumables: NamespacedContentRegistry<ItemDefinition>;
  resources: NamespacedContentRegistry<ItemDefinition>;
  recipes: NamespacedContentRegistry<CraftingRecipe>;
  characters: NamespacedContentRegistry<ModGenericEntityDescriptor>;
  animals: NamespacedContentRegistry<ModGenericEntityDescriptor>;
  monsters: NamespacedContentRegistry<ModGenericEntityDescriptor>;
  npcs: NamespacedContentRegistry<ModGenericEntityDescriptor>;
  buildings: NamespacedContentRegistry<BuildingBlueprint>;
  decorations: NamespacedContentRegistry<BuildingBlueprint>;
  quests: NamespacedContentRegistry<QuestDefinition>;
  loot_tables: NamespacedContentRegistry<ModLootTableDescriptor>;
  sounds: NamespacedContentRegistry<ModSoundDescriptor>;
  music: NamespacedContentRegistry<ModMusicDescriptor>;
  textures: NamespacedContentRegistry<ModTextureDescriptor>;
  models: NamespacedContentRegistry<Woa3dModelDescriptor>;
  localization: NamespacedContentRegistry<ModLocalizationEntry>;
  spawns: NamespacedContentRegistry<ModSpawnDefinition>;
  events: NamespacedContentRegistry<ModEventDefinition>;
}

export class DefaultModContentStore {
  public readonly registries: ModContentRegistryMap = {
    items: new NamespacedContentRegistry<ItemDefinition>('items'),
    weapons: new NamespacedContentRegistry<ItemDefinition>('weapons'),
    armor: new NamespacedContentRegistry<ItemDefinition>('armor'),
    tools: new NamespacedContentRegistry<ItemDefinition>('tools'),
    consumables: new NamespacedContentRegistry<ItemDefinition>('consumables'),
    resources: new NamespacedContentRegistry<ItemDefinition>('resources'),
    recipes: new NamespacedContentRegistry<CraftingRecipe>('recipes'),
    characters: new NamespacedContentRegistry<ModGenericEntityDescriptor>('characters'),
    animals: new NamespacedContentRegistry<ModGenericEntityDescriptor>('animals'),
    monsters: new NamespacedContentRegistry<ModGenericEntityDescriptor>('monsters'),
    npcs: new NamespacedContentRegistry<ModGenericEntityDescriptor>('npcs'),
    buildings: new NamespacedContentRegistry<BuildingBlueprint>('buildings'),
    decorations: new NamespacedContentRegistry<BuildingBlueprint>('decorations'),
    quests: new NamespacedContentRegistry<QuestDefinition>('quests'),
    loot_tables: new NamespacedContentRegistry<ModLootTableDescriptor>('loot_tables'),
    sounds: new NamespacedContentRegistry<ModSoundDescriptor>('sounds'),
    music: new NamespacedContentRegistry<ModMusicDescriptor>('music'),
    textures: new NamespacedContentRegistry<ModTextureDescriptor>('textures'),
    models: new NamespacedContentRegistry<Woa3dModelDescriptor>('models'),
    localization: new NamespacedContentRegistry<ModLocalizationEntry>('localization'),
    spawns: new NamespacedContentRegistry<ModSpawnDefinition>('spawns'),
    events: new NamespacedContentRegistry<ModEventDefinition>('events'),
  };

  public readonly weaponStatsRegistry = new NamespacedContentRegistry<WeaponStats>('weapons');
  public readonly modelsRegistry = this.registries.models;
  private readonly inlineSpawnIdsByModAndCat = new Map<string, string[]>();
  private readonly inlineEventIdsByModAndCat = new Map<string, string[]>();

  private readonly descriptorsByCategory = new Map<
    string,
    Map<string, ModDescriptorEntry[]>
  >();
  private readonly localizationByMod = new Map<
    string,
    Map<string, Record<string, string>>
  >();

  public getRegistry<K extends keyof ModContentRegistryMap>(type: K): ModContentRegistryMap[K] {
    return this.registries[type];
  }

  public getAllModItems(): ItemDefinition[] {
    return [
      ...this.registries.items.getAll(),
      ...this.registries.weapons.getAll(),
      ...this.registries.armor.getAll(),
      ...this.registries.tools.getAll(),
      ...this.registries.consumables.getAll(),
      ...this.registries.resources.getAll(),
    ];
  }

  public getAllModRecipes(): CraftingRecipe[] {
    return this.registries.recipes.getAll();
  }

  public getAllModBlueprints(): BuildingBlueprint[] {
    return [
      ...this.registries.buildings.getAll(),
      ...this.registries.decorations.getAll(),
    ];
  }

  public getModWeaponStats(weaponId: string): WeaponStats | undefined {
    return this.weaponStatsRegistry.get(weaponId);
  }

  public getAllModWeaponStats(): WeaponStats[] {
    return this.weaponStatsRegistry.getAll();
  }

  public getModSound(soundId: string): ModSoundDescriptor | undefined {
    return this.registries.sounds.get(soundId);
  }

  public getAllModSounds(): ModSoundDescriptor[] {
    return this.registries.sounds.getAll();
  }

  public getAllModMusic(): ModMusicDescriptor[] {
    return this.registries.music.getAll();
  }

  public getModTexture(textureId: string): ModTextureDescriptor | undefined {
    return this.registries.textures.get(textureId);
  }

  public getLootTable(tableId: string): ModLootTableDescriptor | undefined {
    return this.registries.loot_tables.get(tableId);
  }

  public getModModel(idOrCanonicalRef: string): Woa3dModelDescriptor | undefined {
    const direct = this.modelsRegistry.get(idOrCanonicalRef);
    if (direct) return direct;
    const normalizedInput = idOrCanonicalRef.trim().toLowerCase();
    for (const model of this.modelsRegistry.getAll()) {
      if (model.canonicalRef.toLowerCase() === normalizedInput) {
        return model;
      }
    }
    return undefined;
  }

  public getAllModModels(): Woa3dModelDescriptor[] {
    return this.modelsRegistry.getAll();
  }

  public getAllModSpawns(): ModSpawnDefinition[] {
    return this.registries.spawns.getAll();
  }

  public getModSpawnsForMod(modId: string): ModSpawnDefinition[] {
    return this.registries.spawns
      .getAllEntries()
      .filter((e) => e.modId === modId)
      .map((e) => e.data);
  }

  public getAllModEvents(): ModEventDefinition[] {
    return this.registries.events.getAll();
  }

  public getModEventsForMod(modId: string): ModEventDefinition[] {
    return this.registries.events
      .getAllEntries()
      .filter((e) => e.modId === modId)
      .map((e) => e.data);
  }

  public validateEventsForMod(
    modId: string,
    resolvers: ModEventCrossReferenceResolvers,
  ): ModDiagnostic[] {
    const diagnostics: ModDiagnostic[] = [];
    for (const entry of this.registries.events.getAllEntries()) {
      if (entry.modId !== modId) continue;
      if (entry.data.validationError) continue;
      const crossDiags = validateModEventCrossReferences(entry.data, resolvers);
      diagnostics.push(...crossDiags);
    }
    return diagnostics;
  }

  public getItemDefinition(itemId: string): ItemDefinition | undefined {
    return (
      this.registries.items.get(itemId) ??
      this.registries.weapons.get(itemId) ??
      this.registries.armor.get(itemId) ??
      this.registries.tools.get(itemId) ??
      this.registries.consumables.get(itemId) ??
      this.registries.resources.get(itemId)
    );
  }

  public getBlueprint(blueprintId: string): BuildingBlueprint | undefined {
    return (
      this.registries.buildings.get(blueprintId) ??
      this.registries.decorations.get(blueprintId)
    );
  }

  public getEntityDescriptor(
    category: 'characters' | 'animals' | 'monsters' | 'npcs',
    id: string,
  ): ModGenericEntityDescriptor | undefined {
    return this.registries[category].get(id);
  }

  public resolveContentForSpawn(spawn: ModSpawnDefinition): {
    found: boolean;
    modelPath?: string;
    item?: ItemDefinition;
    blueprint?: BuildingBlueprint;
    entity?: ModGenericEntityDescriptor;
  } {
    switch (spawn.contentType) {
      case 'item':
      case 'weapon':
      case 'armor':
      case 'tool':
      case 'consumable':
      case 'resource': {
        const item = this.getItemDefinition(spawn.contentId);
        return item ? { found: true, modelPath: item.modelPath, item } : { found: false };
      }
      case 'building':
      case 'decoration': {
        const blueprint = this.getBlueprint(spawn.contentId);
        return blueprint
          ? { found: true, modelPath: blueprint.modelPath, blueprint }
          : { found: false };
      }
      case 'npc': {
        const entity =
          this.registries.npcs.get(spawn.contentId) ??
          this.registries.characters.get(spawn.contentId);
        return entity
          ? { found: true, modelPath: entity.modelPath, entity }
          : { found: false };
      }
      case 'character': {
        const entity =
          this.registries.characters.get(spawn.contentId) ??
          this.registries.npcs.get(spawn.contentId);
        return entity
          ? { found: true, modelPath: entity.modelPath, entity }
          : { found: false };
      }
      case 'monster': {
        const entity = this.registries.monsters.get(spawn.contentId);
        return entity
          ? { found: true, modelPath: entity.modelPath, entity }
          : { found: false };
      }
      case 'animal': {
        const entity = this.registries.animals.get(spawn.contentId);
        return entity
          ? { found: true, modelPath: entity.modelPath, entity }
          : { found: false };
      }
      default:
        return { found: false };
    }
  }

  public validateSpawnsForMod(
    modId: string,
    assets: ModAssetIndexEntry[],
  ): ModDiagnostic[] {
    const diagnostics: ModDiagnostic[] = [];
    const assetPaths = new Set<string>(
      assets.map((a) => normalizeModRelativeAssetPathForLookup(a.relativePath, modId) ?? a.relativePath.toLowerCase()),
    );
    for (const entry of this.registries.spawns.getAllEntries()) {
      if (entry.modId !== modId) continue;
      const spawn = entry.data;
      if (spawn.validationError) continue;

      const resolved = this.resolveContentForSpawn(spawn);
      if (!resolved.found) {
        const msg = `Spawn "${spawn.spawnId}" references unregistered ${spawn.contentType} content "${spawn.contentId}".`;
        spawn.validationError = {
          code: 'SPAWN_CONTENT_NOT_REGISTERED',
          message: msg,
        };
        diagnostics.push({
          code: 'SPAWN_CONTENT_NOT_REGISTERED',
          severity: 'warning',
          message: msg,
        });
        continue;
      }

      if (resolved.modelPath) {
        const byModel = this.getModModel(resolved.modelPath);
        const relLookup = normalizeModRelativeAssetPathForLookup(resolved.modelPath, modId);
        const hasAssetFile = relLookup ? assetPaths.has(relLookup) : false;
        if (!byModel && !hasAssetFile) {
          const msg = `Spawn "${spawn.spawnId}" references content "${spawn.contentId}" whose model "${resolved.modelPath}" is missing or invalid.`;
          spawn.validationError = {
            code: 'SPAWN_MODEL_MISSING',
            message: msg,
          };
          diagnostics.push({
            code: 'SPAWN_MODEL_MISSING',
            severity: 'warning',
            message: msg,
          });
        }
      }
    }
    return diagnostics;
  }

  private registerInlineSpawns(
    modId: string,
    sourceCat: string,
    spawns: ModSpawnDefinition[],
    diagnostics: ModDiagnostic[],
  ): void {
    const bucketKey = `${modId}:${sourceCat}`;
    const existing = this.inlineSpawnIdsByModAndCat.get(bucketKey) ?? [];
    for (const sp of spawns) {
      let candidateId = sp.id;
      let suffix = 1;
      while (this.registries.spawns.has(candidateId)) {
        suffix += 1;
        candidateId = `${sp.id}_${suffix}`;
      }
      const normalized = candidateId === sp.id ? sp : { ...sp, id: candidateId };
      const regRes = this.registries.spawns.register(modId, normalized.id, normalized);
      if (!regRes.ok) {
        diagnostics.push({
          code: regRes.code,
          severity: 'warning',
          message: `${sp.sourceFile}: ${regRes.message}`,
        });
        continue;
      }
      existing.push(normalized.id);
    }
    this.inlineSpawnIdsByModAndCat.set(bucketKey, existing);
  }

  private unloadInlineSpawns(modId: string, sourceCat: string): void {
    const bucketKey = `${modId}:${sourceCat}`;
    const ids = this.inlineSpawnIdsByModAndCat.get(bucketKey);
    if (ids && ids.length > 0) {
      for (const id of ids) {
        this.registries.spawns.unregister(id);
      }
    }
    this.inlineSpawnIdsByModAndCat.delete(bucketKey);
  }

  private extractContextualInlineEvents(
    modId: string,
    rawOwner: unknown,
    sourceFile: string,
    diagnostics: ModDiagnostic[],
    ownerRefs: Partial<Omit<ModEventTriggerSpec, 'type'>>,
  ): ModEventDefinition[] {
    if (!isRecord(rawOwner)) return [];
    const rawList = Array.isArray(rawOwner.events)
      ? rawOwner.events
      : Array.isArray(rawOwner.triggers)
        ? rawOwner.triggers
        : isRecord(rawOwner.event)
          ? [rawOwner.event]
          : [];
    const out: ModEventDefinition[] = [];
    for (let i = 0; i < rawList.length; i++) {
      const item = rawList[i];
      let scopedDefault: Partial<ModEventTriggerSpec> | undefined;
      if (isRecord(item)) {
        const rawTrig = isRecord(item.trigger) ? item.trigger : null;
        const t = normalizeTriggerType(
          rawTrig?.type ??
            rawTrig?.event ??
            item.triggerType ??
            (typeof item.trigger === 'string' ? item.trigger : undefined) ??
            item.eventType,
        );
        if (t) {
          scopedDefault = this.pickApplicableDefaultTriggerRefs(t, ownerRefs);
        }
      }
      const def = sanitizeModEventDefinition(modId, item, sourceFile, diagnostics, {
        index: i,
        defaultTrigger: scopedDefault,
      });
      if (def) out.push(def);
    }
    return out;
  }

  private pickApplicableDefaultTriggerRefs(
    triggerType: ModEventTriggerType,
    ownerRefs: Partial<Omit<ModEventTriggerSpec, 'type'>>,
  ): Partial<ModEventTriggerSpec> | undefined {
    const out: Partial<ModEventTriggerSpec> = {};
    if (
      (triggerType === 'item_collected' ||
        triggerType === 'item_equipped' ||
        triggerType === 'item_crafted') &&
      ownerRefs.itemId
    ) {
      out.itemId = ownerRefs.itemId;
    }
    if (
      (triggerType === 'item_equipped' || triggerType === 'entity_killed_with_weapon') &&
      ownerRefs.weaponId
    ) {
      out.weaponId = ownerRefs.weaponId;
    }
    if (triggerType === 'recipe_completed' && ownerRefs.recipeId) {
      out.recipeId = ownerRefs.recipeId;
    }
    if (
      (triggerType === 'quest_started' ||
        triggerType === 'quest_completed' ||
        triggerType === 'quest_failed' ||
        triggerType === 'npc_quest_completed') &&
      ownerRefs.questId
    ) {
      out.questId = ownerRefs.questId;
    }
    if (
      (triggerType === 'npc_talk_start' ||
        triggerType === 'dialogue_started' ||
        triggerType === 'dialogue_completed' ||
        triggerType === 'dialogue_choice_selected' ||
        triggerType === 'npc_interaction' ||
        triggerType === 'npc_quest_completed') &&
      ownerRefs.npcId
    ) {
      out.npcId = ownerRefs.npcId;
    }
    if (
      (triggerType === 'animal_killed' ||
        triggerType === 'monster_killed' ||
        triggerType === 'enemy_killed' ||
        triggerType === 'boss_killed' ||
        triggerType === 'entity_killed' ||
        triggerType === 'entity_killed_with_weapon') &&
      ownerRefs.entityId
    ) {
      out.entityId = ownerRefs.entityId;
    }
    if (
      (triggerType === 'building_placed' ||
        triggerType === 'structure_completed' ||
        triggerType === 'structure_destroyed') &&
      ownerRefs.buildingId
    ) {
      out.buildingId = ownerRefs.buildingId;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  private registerInlineEvents(
    modId: string,
    sourceCat: string,
    events: ModEventDefinition[],
    diagnostics: ModDiagnostic[],
  ): void {
    const bucketKey = `${modId}:${sourceCat}`;
    const existing = this.inlineEventIdsByModAndCat.get(bucketKey) ?? [];
    for (const ev of events) {
      let candidateId = ev.id;
      let suffix = 1;
      while (this.registries.events.has(candidateId)) {
        suffix += 1;
        candidateId = `${ev.id}_${suffix}`;
      }
      const normalized = candidateId === ev.id ? ev : { ...ev, id: candidateId };
      const regRes = this.registries.events.register(modId, normalized.id, normalized);
      if (!regRes.ok) {
        diagnostics.push({
          code: regRes.code,
          severity: 'warning',
          message: `${ev.sourceFile}: ${regRes.message}`,
        });
        continue;
      }
      existing.push(normalized.id);
    }
    this.inlineEventIdsByModAndCat.set(bucketKey, existing);
  }

  private unloadInlineEvents(modId: string, sourceCat: string): void {
    const bucketKey = `${modId}:${sourceCat}`;
    const ids = this.inlineEventIdsByModAndCat.get(bucketKey);
    if (ids && ids.length > 0) {
      for (const id of ids) {
        this.registries.events.unregister(id);
      }
    }
    this.inlineEventIdsByModAndCat.delete(bucketKey);
  }

  public getDescriptors(category: string): ModDescriptorEntry[] {
    const normalized = category.toLowerCase();
    if (
      normalized === 'characters' ||
      normalized === 'animals' ||
      normalized === 'monsters' ||
      normalized === 'npcs'
    ) {
      return this.registries[normalized].getAllEntries().map((entry) => ({
        modId: entry.modId,
        id: entry.id,
        payload: entry.data.raw,
      }));
    }
    if (normalized === 'buildings' || normalized === 'decorations') {
      return this.registries[normalized].getAllEntries().map((entry) => ({
        modId: entry.modId,
        id: entry.id,
        payload: entry.data as unknown as Record<string, unknown>,
      }));
    }
    if (normalized === 'sounds' || normalized === 'music' || normalized === 'textures' || normalized === 'loot_tables') {
      return this.registries[normalized].getAllEntries().map((entry) => ({
        modId: entry.modId,
        id: entry.id,
        payload: entry.data as unknown as Record<string, unknown>,
      }));
    }

    const map = this.descriptorsByCategory.get(normalized);
    if (!map) return [];
    const out: ModDescriptorEntry[] = [];
    for (const list of map.values()) out.push(...list);
    return out;
  }

  public resolveLocalization(lang: string, key: string): string | undefined {
    let resolved: string | undefined;
    for (const modMap of this.localizationByMod.values()) {
      const langDict = modMap.get(lang);
      if (langDict && typeof langDict[key] === 'string') {
        resolved = langDict[key];
      }
    }
    return resolved;
  }

  private hasItemInOtherItemRegistries(
    id: string,
    excludeMode: ItemFlavorMode,
  ): boolean {
    const itemRegistries: Array<[ItemFlavorMode, NamespacedContentRegistry<ItemDefinition>]> = [
      ['items', this.registries.items],
      ['weapons', this.registries.weapons],
      ['armor', this.registries.armor],
      ['tools', this.registries.tools],
      ['consumables', this.registries.consumables],
      ['resources', this.registries.resources],
    ];
    for (const [mode, reg] of itemRegistries) {
      if (mode !== excludeMode && reg.has(id)) return true;
    }
    return false;
  }

  public createHandlers(): ModContentHandler[] {
    return [
      this.createItemLikeHandler('items', ['items'], this.registries.items),
      this.createItemLikeHandler('weapons', ['weapons', 'items'], this.registries.weapons),
      this.createItemLikeHandler('armor', ['armor', 'items'], this.registries.armor),
      this.createItemLikeHandler('tools', ['tools', 'items'], this.registries.tools),
      this.createItemLikeHandler(
        'consumables',
        ['consumables', 'food', 'potions', 'items'],
        this.registries.consumables,
      ),
      this.createItemLikeHandler(
        'resources',
        ['resources', 'materials', 'items'],
        this.registries.resources,
      ),
      this.createRecipesHandler(),
      this.createQuestsHandler(),
      this.createBlueprintsHandler('buildings', false, ['buildings', 'structures'], this.registries.buildings),
      this.createBlueprintsHandler('decorations', true, ['decorations', 'furniture', 'buildings'], this.registries.decorations),
      this.createLootTablesHandler('loot_tables'),
      this.createLootTablesHandler('loottables'),
      this.createSoundsHandler(),
      this.createMusicHandler(),
      this.createTexturesHandler(),
      this.createLocalizationHandler(),
      this.createEntityHandler('characters', ['characters'], this.registries.characters),
      this.createEntityHandler('animals', ['animals', 'creatures', 'wildlife'], this.registries.animals),
      this.createEntityHandler('creatures', ['creatures', 'animals', 'wildlife'], this.registries.animals),
      this.createEntityHandler('monsters', ['monsters', 'enemies'], this.registries.monsters),
      this.createEntityHandler('npcs', ['npcs'], this.registries.npcs),
      this.createDescriptorHandler('assets', ['assets']),
      this.createModelsHandler(),
      this.createSpawnsHandler(),
      this.createEventsHandler(),
    ];
  }

  private createItemLikeHandler(
    mode: ItemFlavorMode,
    containerKeys: string[],
    targetRegistry: NamespacedContentRegistry<ItemDefinition>,
  ): ModContentHandler {
    const spawnContentType: ModSpawnContentType =
      mode === 'weapons'
        ? 'weapon'
        : mode === 'armor'
          ? 'armor'
          : mode === 'tools'
            ? 'tool'
            : mode === 'consumables'
              ? 'consumable'
              : mode === 'resources'
                ? 'resource'
                : 'item';
    return {
      contentType: mode,
      validateAndLoad: (ctx: ModLoadContext): ModContentHandlerResult => {
        const diagnostics: ModDiagnostic[] = [];
        targetRegistry.unloadMod(ctx.modId);
        this.unloadInlineSpawns(ctx.modId, mode);
        this.unloadInlineEvents(ctx.modId, mode);
        if (mode === 'weapons') {
          this.weaponStatsRegistry.unloadMod(ctx.modId);
        }

        let loadedCount = 0;
        for (const file of ctx.files) {
          const entries = extractEntriesList(file.data, containerKeys);
          for (const rawEntry of entries) {
            const parsed = sanitizeItemLikeDefinition(
              ctx.modId,
              rawEntry,
              mode,
              file.relativePath,
              diagnostics,
            );
            if (!parsed) {
              diagnostics.push({
                code: 'INVALID_ITEM_DEFINITION',
                severity: 'warning',
                message: `Skipped invalid ${mode} entry in "${file.relativePath}" (requires "id" and "name").`,
              });
              continue;
            }

            if (this.hasItemInOtherItemRegistries(parsed.item.id, mode)) {
              diagnostics.push({
                code: 'DUPLICATE_OBJECT_ID',
                severity: 'error',
                message: `Duplicate item ID "${parsed.item.id}" across item categories in "${file.relativePath}".`,
              });
              continue;
            }

            const regRes = targetRegistry.register(ctx.modId, parsed.item.id, parsed.item);
            if (!regRes.ok) {
              diagnostics.push({
                code: regRes.code,
                severity: 'error',
                message: `${file.relativePath}: ${regRes.message}`,
              });
              continue;
            }

            if (parsed.weaponStats) {
              const wRes = this.weaponStatsRegistry.register(
                ctx.modId,
                parsed.weaponStats.id,
                parsed.weaponStats,
              );
              if (!wRes.ok) {
                diagnostics.push({
                  code: wRes.code,
                  severity: 'error',
                  message: `${file.relativePath}: ${wRes.message}`,
                });
                continue;
              }
            }

            const effectiveSpawnType: ModSpawnContentType =
              parsed.item.category === 'weapon' || parsed.weaponStats
                ? 'weapon'
                : spawnContentType;
            const inlineSpawns = extractInlineSpawnDefinitions(
              ctx.modId,
              rawEntry,
              parsed.item.id,
              effectiveSpawnType,
              file.relativePath,
              diagnostics,
            );
            if (inlineSpawns.length > 0) {
              this.registerInlineSpawns(ctx.modId, mode, inlineSpawns, diagnostics);
            }

            const inlineEvents = this.extractContextualInlineEvents(
              ctx.modId,
              rawEntry,
              file.relativePath,
              diagnostics,
              {
                itemId: parsed.item.id,
                ...(effectiveSpawnType === 'weapon' ? { weaponId: parsed.item.id } : {}),
              },
            );
            if (inlineEvents.length > 0) {
              this.registerInlineEvents(ctx.modId, mode, inlineEvents, diagnostics);
            }

            loadedCount += 1;
          }
        }

        return { loadedCount, diagnostics };
      },
      unloadMod: (modId: string) => {
        targetRegistry.unloadMod(modId);
        this.unloadInlineSpawns(modId, mode);
        this.unloadInlineEvents(modId, mode);
        if (mode === 'weapons') {
          this.weaponStatsRegistry.unloadMod(modId);
        }
      },
      clearAll: () => {
        targetRegistry.clear();
        this.inlineSpawnIdsByModAndCat.clear();
        this.inlineEventIdsByModAndCat.clear();
        if (mode === 'weapons') {
          this.weaponStatsRegistry.clear();
        }
      },
    };
  }

  private createRecipesHandler(): ModContentHandler {
    return {
      contentType: 'recipes',
      validateAndLoad: (ctx: ModLoadContext): ModContentHandlerResult => {
        const diagnostics: ModDiagnostic[] = [];
        this.registries.recipes.unloadMod(ctx.modId);
        this.unloadInlineEvents(ctx.modId, 'recipes');
        let loadedCount = 0;

        for (const file of ctx.files) {
          const entries = extractEntriesList(file.data, ['recipes']);
          for (const rawEntry of entries) {
            const recipe = sanitizeRecipe(
              ctx.modId,
              rawEntry,
              file.relativePath,
              diagnostics,
            );
            if (!recipe) {
              diagnostics.push({
                code: 'INVALID_RECIPE_DEFINITION',
                severity: 'warning',
                message: `Skipped invalid recipe entry in "${file.relativePath}" (requires "id", "resultItemId", and non-empty "ingredients").`,
              });
              continue;
            }
            const regRes = this.registries.recipes.register(ctx.modId, recipe.id, recipe);
            if (!regRes.ok) {
              diagnostics.push({
                code: regRes.code,
                severity: 'error',
                message: `${file.relativePath}: ${regRes.message}`,
              });
              continue;
            }
            const inlineEvents = this.extractContextualInlineEvents(
              ctx.modId,
              rawEntry,
              file.relativePath,
              diagnostics,
              { recipeId: recipe.id, itemId: recipe.resultItemId },
            );
            if (inlineEvents.length > 0) {
              this.registerInlineEvents(ctx.modId, 'recipes', inlineEvents, diagnostics);
            }
            loadedCount += 1;
          }
        }

        return { loadedCount, diagnostics };
      },
      unloadMod: (modId: string) => {
        this.registries.recipes.unloadMod(modId);
        this.unloadInlineEvents(modId, 'recipes');
      },
      clearAll: () => {
        this.registries.recipes.clear();
        this.inlineEventIdsByModAndCat.clear();
      },
    };
  }

  private createQuestsHandler(): ModContentHandler {
    return {
      contentType: 'quests',
      validateAndLoad: (ctx: ModLoadContext): ModContentHandlerResult => {
        const diagnostics: ModDiagnostic[] = [];
        this.registries.quests.unloadMod(ctx.modId);
        this.unloadInlineEvents(ctx.modId, 'quests');
        unregisterModQuests(ctx.modId);
        let loadedCount = 0;

        for (const file of ctx.files) {
          const entries = extractEntriesList(file.data, ['quests']);
          for (const rawEntry of entries) {
            const quest = sanitizeQuest(
              ctx.modId,
              rawEntry,
              file.relativePath,
              diagnostics,
            );
            if (!quest) {
              diagnostics.push({
                code: 'INVALID_QUEST_DEFINITION',
                severity: 'warning',
                message: `Skipped invalid quest entry in "${file.relativePath}" (requires "id", "title", "giverNpcId", "objectives").`,
              });
              continue;
            }

            const regRes = this.registries.quests.register(ctx.modId, quest.id, quest);
            if (!regRes.ok) {
              diagnostics.push({
                code: regRes.code,
                severity: 'error',
                message: `${file.relativePath}: ${regRes.message}`,
              });
              continue;
            }

            const qAdded = registerModQuestDefinition(ctx.modId, quest);
            if (!qAdded) {
              diagnostics.push({
                code: 'CORE_OVERRIDE_FORBIDDEN',
                severity: 'error',
                message: `${file.relativePath}: Quest "${quest.id}" conflicts with core quest content.`,
              });
              continue;
            }
            const inlineEvents = this.extractContextualInlineEvents(
              ctx.modId,
              rawEntry,
              file.relativePath,
              diagnostics,
              { questId: quest.id, npcId: quest.giverNpcId },
            );
            if (inlineEvents.length > 0) {
              this.registerInlineEvents(ctx.modId, 'quests', inlineEvents, diagnostics);
            }
            loadedCount += 1;
          }
        }

        return { loadedCount, diagnostics };
      },
      unloadMod: (modId: string) => {
        this.registries.quests.unloadMod(modId);
        this.unloadInlineEvents(modId, 'quests');
        unregisterModQuests(modId);
      },
      clearAll: () => {
        this.registries.quests.clear();
        this.inlineEventIdsByModAndCat.clear();
        clearAllModQuests();
      },
    };
  }

  private createBlueprintsHandler(
    contentType: 'buildings' | 'decorations',
    isDecoration: boolean,
    containerKeys: string[],
    targetRegistry: NamespacedContentRegistry<BuildingBlueprint>,
  ): ModContentHandler {
    const spawnContentType: ModSpawnContentType = isDecoration ? 'decoration' : 'building';
    return {
      contentType,
      validateAndLoad: (ctx: ModLoadContext): ModContentHandlerResult => {
        const diagnostics: ModDiagnostic[] = [];
        targetRegistry.unloadMod(ctx.modId);
        this.unloadInlineSpawns(ctx.modId, contentType);
        this.unloadInlineEvents(ctx.modId, contentType);
        let loadedCount = 0;

        for (const file of ctx.files) {
          const entries = extractEntriesList(file.data, containerKeys);
          for (const rawEntry of entries) {
            const bp = sanitizeBlueprint(
              ctx.modId,
              rawEntry,
              isDecoration,
              file.relativePath,
              diagnostics,
            );
            if (!bp) {
              diagnostics.push({
                code: 'INVALID_BUILDING_DEFINITION',
                severity: 'warning',
                message: `Skipped invalid ${contentType} entry in "${file.relativePath}" (requires "id" and "nameEn"/"name").`,
              });
              continue;
            }

            const other =
              contentType === 'buildings'
                ? this.registries.decorations
                : this.registries.buildings;
            if (other.has(bp.id)) {
              diagnostics.push({
                code: 'DUPLICATE_OBJECT_ID',
                severity: 'error',
                message: `Duplicate blueprint ID "${bp.id}" across buildings/decorations in "${file.relativePath}".`,
              });
              continue;
            }

            const regRes = targetRegistry.register(ctx.modId, bp.id, bp);
            if (!regRes.ok) {
              diagnostics.push({
                code: regRes.code,
                severity: 'error',
                message: `${file.relativePath}: ${regRes.message}`,
              });
              continue;
            }

            const inlineSpawns = extractInlineSpawnDefinitions(
              ctx.modId,
              rawEntry,
              bp.id,
              bp.isDecorative ? 'decoration' : spawnContentType,
              file.relativePath,
              diagnostics,
            );
            if (inlineSpawns.length > 0) {
              this.registerInlineSpawns(ctx.modId, contentType, inlineSpawns, diagnostics);
            }

            const inlineEvents = this.extractContextualInlineEvents(
              ctx.modId,
              rawEntry,
              file.relativePath,
              diagnostics,
              { buildingId: bp.id },
            );
            if (inlineEvents.length > 0) {
              this.registerInlineEvents(ctx.modId, contentType, inlineEvents, diagnostics);
            }

            loadedCount += 1;
          }
        }

        return { loadedCount, diagnostics };
      },
      unloadMod: (modId: string) => {
        targetRegistry.unloadMod(modId);
        this.unloadInlineSpawns(modId, contentType);
        this.unloadInlineEvents(modId, contentType);
      },
      clearAll: () => {
        targetRegistry.clear();
        this.inlineSpawnIdsByModAndCat.clear();
        this.inlineEventIdsByModAndCat.clear();
      },
    };
  }

  private createLootTablesHandler(contentType: string): ModContentHandler {
    return {
      contentType,
      validateAndLoad: (ctx: ModLoadContext): ModContentHandlerResult => {
        const diagnostics: ModDiagnostic[] = [];
        let loadedCount = 0;

        for (const file of ctx.files) {
          const entries = extractEntriesList(file.data, ['loot_tables', 'lootTables', 'tables']);
          for (const rawEntry of entries) {
            const table = sanitizeLootTable(
              ctx.modId,
              rawEntry,
              file.relativePath,
              diagnostics,
            );
            if (!table) {
              diagnostics.push({
                code: 'INVALID_LOOT_TABLE_DEFINITION',
                severity: 'warning',
                message: `Skipped invalid loot table entry in "${file.relativePath}".`,
              });
              continue;
            }

            const regRes = this.registries.loot_tables.register(
              ctx.modId,
              table.id,
              table,
            );
            if (!regRes.ok) {
              diagnostics.push({
                code: regRes.code,
                severity: 'error',
                message: `${file.relativePath}: ${regRes.message}`,
              });
              continue;
            }
            loadedCount += 1;
          }
        }

        return { loadedCount, diagnostics };
      },
      unloadMod: (modId: string) => {
        this.registries.loot_tables.unloadMod(modId);
      },
      clearAll: () => {
        this.registries.loot_tables.clear();
      },
    };
  }

  private createSoundsHandler(): ModContentHandler {
    return {
      contentType: 'sounds',
      validateAndLoad: (ctx: ModLoadContext): ModContentHandlerResult => {
        const diagnostics: ModDiagnostic[] = [];
        this.registries.sounds.unloadMod(ctx.modId);
        let loadedCount = 0;

        for (const file of ctx.files) {
          const entries = extractEntriesList(file.data, ['sounds']);
          for (const rawEntry of entries) {
            const sound = sanitizeSoundDescriptor(
              ctx.modId,
              rawEntry,
              file.relativePath,
              diagnostics,
            );
            if (!sound) continue;

            const regRes = this.registries.sounds.register(ctx.modId, sound.id, sound);
            if (!regRes.ok) {
              diagnostics.push({
                code: regRes.code,
                severity: 'error',
                message: `${file.relativePath}: ${regRes.message}`,
              });
              continue;
            }
            loadedCount += 1;
          }
        }

        return { loadedCount, diagnostics };
      },
      unloadMod: (modId: string) => {
        this.registries.sounds.unloadMod(modId);
      },
      clearAll: () => {
        this.registries.sounds.clear();
      },
    };
  }

  private createMusicHandler(): ModContentHandler {
    return {
      contentType: 'music',
      validateAndLoad: (ctx: ModLoadContext): ModContentHandlerResult => {
        const diagnostics: ModDiagnostic[] = [];
        this.registries.music.unloadMod(ctx.modId);
        let loadedCount = 0;

        for (const file of ctx.files) {
          const entries = extractEntriesList(file.data, ['music', 'tracks']);
          for (const rawEntry of entries) {
            const track = sanitizeMusicDescriptor(
              ctx.modId,
              rawEntry,
              file.relativePath,
              diagnostics,
            );
            if (!track) continue;

            const regRes = this.registries.music.register(ctx.modId, track.id, track);
            if (!regRes.ok) {
              diagnostics.push({
                code: regRes.code,
                severity: 'error',
                message: `${file.relativePath}: ${regRes.message}`,
              });
              continue;
            }
            loadedCount += 1;
          }
        }

        return { loadedCount, diagnostics };
      },
      unloadMod: (modId: string) => {
        this.registries.music.unloadMod(modId);
      },
      clearAll: () => {
        this.registries.music.clear();
      },
    };
  }

  private createTexturesHandler(): ModContentHandler {
    return {
      contentType: 'textures',
      validateAndLoad: (ctx: ModLoadContext): ModContentHandlerResult => {
        const diagnostics: ModDiagnostic[] = [];
        this.registries.textures.unloadMod(ctx.modId);
        let loadedCount = 0;

        for (const file of ctx.files) {
          const entries = extractEntriesList(file.data, ['textures']);
          for (const rawEntry of entries) {
            const tex = sanitizeTextureDescriptor(
              ctx.modId,
              rawEntry,
              file.relativePath,
              diagnostics,
            );
            if (!tex) continue;

            const regRes = this.registries.textures.register(ctx.modId, tex.id, tex);
            if (!regRes.ok) {
              diagnostics.push({
                code: regRes.code,
                severity: 'error',
                message: `${file.relativePath}: ${regRes.message}`,
              });
              continue;
            }
            loadedCount += 1;
          }
        }

        return { loadedCount, diagnostics };
      },
      unloadMod: (modId: string) => {
        this.registries.textures.unloadMod(modId);
      },
      clearAll: () => {
        this.registries.textures.clear();
      },
    };
  }

  private createEntityHandler(
    contentType: string,
    containerKeys: string[],
    targetRegistry: NamespacedContentRegistry<ModGenericEntityDescriptor>,
  ): ModContentHandler {
    const logicalCategory: ModContentType =
      contentType === 'creatures'
        ? 'animals'
        : (contentType as ModContentType);
    const spawnContentType: ModSpawnContentType =
      logicalCategory === 'npcs'
        ? 'npc'
        : logicalCategory === 'characters'
          ? 'character'
          : logicalCategory === 'monsters'
            ? 'monster'
            : 'animal';

    return {
      contentType,
      validateAndLoad: (ctx: ModLoadContext): ModContentHandlerResult => {
        const diagnostics: ModDiagnostic[] = [];
        this.unloadInlineSpawns(ctx.modId, contentType);
        this.unloadInlineEvents(ctx.modId, contentType);
        let loadedCount = 0;

        for (const file of ctx.files) {
          const list = extractEntriesList(file.data, containerKeys);
          for (const rawEntry of list) {
            const entity = sanitizeEntityDescriptor(
              ctx.modId,
              logicalCategory,
              rawEntry,
              file.relativePath,
              diagnostics,
            );
            if (!entity) {
              diagnostics.push({
                code: 'INVALID_ENTITY_DEFINITION',
                severity: 'warning',
                message: `Skipped invalid ${contentType} entry in "${file.relativePath}" (requires "id").`,
              });
              continue;
            }

            const regRes = targetRegistry.register(ctx.modId, entity.id, entity);
            if (!regRes.ok) {
              diagnostics.push({
                code: regRes.code,
                severity: 'error',
                message: `${file.relativePath}: ${regRes.message}`,
              });
              continue;
            }

            const inlineSpawns = extractInlineSpawnDefinitions(
              ctx.modId,
              rawEntry,
              entity.id,
              spawnContentType,
              file.relativePath,
              diagnostics,
            );
            if (inlineSpawns.length > 0) {
              this.registerInlineSpawns(ctx.modId, contentType, inlineSpawns, diagnostics);
            }

            const inlineEvents = this.extractContextualInlineEvents(
              ctx.modId,
              rawEntry,
              file.relativePath,
              diagnostics,
              logicalCategory === 'npcs'
                ? { npcId: entity.id, entityId: entity.id }
                : { entityId: entity.id },
            );
            if (inlineEvents.length > 0) {
              this.registerInlineEvents(ctx.modId, contentType, inlineEvents, diagnostics);
            }

            loadedCount += 1;
          }
        }

        return { loadedCount, diagnostics };
      },
      unloadMod: (modId: string) => {
        targetRegistry.unloadMod(modId);
        this.unloadInlineSpawns(modId, contentType);
        this.unloadInlineEvents(modId, contentType);
      },
      clearAll: () => {
        targetRegistry.clear();
        this.inlineSpawnIdsByModAndCat.clear();
        this.inlineEventIdsByModAndCat.clear();
      },
    };
  }

  private createLocalizationHandler(): ModContentHandler {
    return {
      contentType: 'localization',
      validateAndLoad: (ctx: ModLoadContext): ModContentHandlerResult => {
        const diagnostics: ModDiagnostic[] = [];
        this.registries.localization.unloadMod(ctx.modId);
        const langMap = new Map<string, Record<string, string>>();
        let loadedCount = 0;

        const registerLocPair = (
          cleanLang: string,
          rawKey: string,
          val: string,
          sourceFile: string,
        ) => {
          const existingDict = langMap.get(cleanLang) ?? {};
          existingDict[rawKey] = val;
          langMap.set(cleanLang, existingDict);

          const rawObjId = `${cleanLang}.${rawKey}`;
          const sanitizedSeg = rawObjId.replace(/[^a-z0-9._:-]/gi, '_');
          const idRes = resolveModObjectIdentifier(
            ctx.modId,
            sanitizedSeg.includes(':') ? sanitizedSeg : `${ctx.modId}:${sanitizedSeg}`,
            CORE_PROTECTED_IDS,
          );
          if (!idRes.ok) {
            diagnostics.push({
              code: idRes.code,
              severity: 'error',
              message: `${sourceFile}: ${idRes.message}`,
            });
            return;
          }
          const regRes = this.registries.localization.register(ctx.modId, idRes.fullId, {
            id: idRes.fullId,
            lang: cleanLang,
            key: rawKey,
            value: val,
          });
          if (!regRes.ok) {
            diagnostics.push({
              code: regRes.code,
              severity: 'error',
              message: `${sourceFile}: ${regRes.message}`,
            });
            return;
          }
          loadedCount += 1;
        };

        for (const file of ctx.files) {
          if (!isRecord(file.data)) continue;
          const fileBase =
            file.relativePath.split('/').pop()?.replace(/\.json$/i, '').toLowerCase() || '';

          const isSingleLangFile = fileBase === 'en' || fileBase === 'ar';
          if (isSingleLangFile && !isRecord(file.data[fileBase])) {
            for (const [k, v] of Object.entries(file.data)) {
              if (typeof v === 'string') {
                registerLocPair(fileBase, k, v, file.relativePath);
              }
            }
            continue;
          }

          for (const [langCode, block] of Object.entries(file.data)) {
            if (!isRecord(block)) continue;
            const cleanLang = langCode.trim().toLowerCase();
            for (const [k, v] of Object.entries(block)) {
              if (typeof v === 'string') {
                registerLocPair(cleanLang, k, v, file.relativePath);
              }
            }
          }
        }

        this.localizationByMod.set(ctx.modId, langMap);
        return { loadedCount, diagnostics };
      },
      unloadMod: (modId: string) => {
        this.registries.localization.unloadMod(modId);
        this.localizationByMod.delete(modId);
      },
      clearAll: () => {
        this.registries.localization.clear();
        this.localizationByMod.clear();
      },
    };
  }

  private createDescriptorHandler(
    category: string,
    containerKeys: string[],
  ): ModContentHandler {
    if (!this.descriptorsByCategory.has(category)) {
      this.descriptorsByCategory.set(category, new Map());
    }
    return {
      contentType: category,
      validateAndLoad: (ctx: ModLoadContext): ModContentHandlerResult => {
        const diagnostics: ModDiagnostic[] = [];
        const entries: ModDescriptorEntry[] = [];

        for (const file of ctx.files) {
          const list = extractEntriesList(file.data, containerKeys);
          if (list.length === 0 && isRecord(file.data)) {
            const rawId =
              typeof file.data.id === 'string' ? file.data.id : file.relativePath;
            entries.push({
              modId: ctx.modId,
              id: rawId.includes(':') ? rawId : `${ctx.modId}:${rawId}`,
              payload: file.data,
            });
            continue;
          }

          for (const item of list) {
            if (!isRecord(item)) continue;
            const rawId =
              typeof item.id === 'string' && item.id.trim()
                ? item.id.trim()
                : `${file.relativePath}#${entries.length}`;
            entries.push({
              modId: ctx.modId,
              id: rawId.includes(':') ? rawId : `${ctx.modId}:${rawId}`,
              payload: item,
            });
          }
        }

        this.descriptorsByCategory.get(category)!.set(ctx.modId, entries);
        return { loadedCount: entries.length, diagnostics };
      },
      unloadMod: (modId: string) => {
        this.descriptorsByCategory.get(category)?.delete(modId);
      },
      clearAll: () => {
        this.descriptorsByCategory.get(category)?.clear();
      },
    };
  }

  private createModelsHandler(): ModContentHandler {
    const category = 'models';
    if (!this.descriptorsByCategory.has(category)) {
      this.descriptorsByCategory.set(category, new Map());
    }
    return {
      contentType: category,
      validateAndLoad: (ctx: ModLoadContext): ModContentHandlerResult => {
        const diagnostics: ModDiagnostic[] = [];
        const entries: ModDescriptorEntry[] = [];
        this.modelsRegistry.unloadMod(ctx.modId);
        let loadedCount = 0;

        for (const file of ctx.files) {
          const list = extractEntriesList(file.data, ['models']);
          if (list.length === 0 && isRecord(file.data)) {
            const rawId =
              typeof file.data.id === 'string' ? file.data.id : file.relativePath;
            entries.push({
              modId: ctx.modId,
              id: rawId.includes(':') ? rawId : `${ctx.modId}:${rawId}`,
              payload: file.data,
            });
            loadedCount += 1;
            continue;
          }

          for (const item of list) {
            if (!isRecord(item)) continue;
            const rawId =
              typeof item.id === 'string' && item.id.trim()
                ? item.id.trim()
                : `${file.relativePath}#${entries.length}`;
            entries.push({
              modId: ctx.modId,
              id: rawId.includes(':') ? rawId : `${ctx.modId}:${rawId}`,
              payload: item,
            });
            loadedCount += 1;
          }
        }

        for (const asset of ctx.assets) {
          if (!asset.relativePath.toLowerCase().endsWith('.woa3d')) continue;
          let meta = asset.woa3dMetadata;
          let rawObj: Record<string, unknown> | undefined;
          if (!meta && typeof asset.rawText === 'string') {
            const parsed = parseAndValidateWoa3dText(
              asset.rawText,
              SUPPORTED_MOD_SCHEMA_VERSIONS,
            );
            if (!parsed.ok) {
              diagnostics.push({
                code: parsed.errorCode,
                severity: 'warning',
                message: `Skipped invalid .woa3d model "${asset.relativePath}": ${parsed.message}`,
              });
              continue;
            }
            meta = parsed.metadata;
            rawObj = parsed.parsed;
          } else if (typeof asset.rawText === 'string') {
            try {
              const maybe = JSON.parse(asset.rawText);
              if (isRecord(maybe)) rawObj = maybe;
            } catch {
              // ignore
            }
          }

          const fileSlug =
            asset.relativePath
              .split('/')
              .pop()
              ?.replace(/\.woa3d$/i, '')
              .replace(/[^a-z0-9._-]+/gi, '_') || 'model';
          const rawObjId = (meta?.id ?? fileSlug).replace(/[^a-z0-9._:-]+/gi, '_');
          const idRes = resolveModObjectIdentifier(ctx.modId, rawObjId, CORE_PROTECTED_IDS);
          const fullId = idRes.ok
            ? idRes.fullId
            : `${ctx.modId}:${fileSlug.toLowerCase()}`;
          const canonicalRef = `${ctx.modId}://${asset.relativePath.replace(/\\/g, '/')}`;

          const descriptor: Woa3dModelDescriptor = {
            id: fullId,
            modId: ctx.modId,
            relativePath: asset.relativePath,
            canonicalRef,
            category: meta?.category ?? '3d-model',
            type: '3d-model',
            modCategory: meta?.modCategory ?? 'models',
            canonicalCategory: meta?.canonicalCategory ?? 'models',
            schemaVersion:
              meta?.schemaVersion ?? ctx.manifest.schemaVersion ?? 2,
            name: meta?.name ?? fileSlug,
            sizeBytes: asset.sizeBytes,
            ...(rawObj ? { raw: rawObj } : {}),
          };

          const regRes = this.modelsRegistry.register(ctx.modId, fullId, descriptor);
          if (!regRes.ok) {
            diagnostics.push({
              code: regRes.code,
              severity: 'warning',
              message: `${asset.relativePath}: ${regRes.message}`,
            });
            continue;
          }

          entries.push({
            modId: ctx.modId,
            id: fullId,
            payload: descriptor as unknown as Record<string, unknown>,
          });
          loadedCount += 1;
        }

        this.descriptorsByCategory.get(category)!.set(ctx.modId, entries);
        return { loadedCount, diagnostics };
      },
      unloadMod: (modId: string) => {
        this.modelsRegistry.unloadMod(modId);
        this.descriptorsByCategory.get(category)?.delete(modId);
      },
      clearAll: () => {
        this.modelsRegistry.clear();
        this.descriptorsByCategory.get(category)?.clear();
      },
    };
  }

  private createSpawnsHandler(): ModContentHandler {
    return {
      contentType: 'spawns',
      validateAndLoad: (ctx: ModLoadContext): ModContentHandlerResult => {
        const diagnostics: ModDiagnostic[] = [];
        this.unloadInlineSpawns(ctx.modId, 'spawns_file');
        this.unloadInlineEvents(ctx.modId, 'spawns_file');
        let loadedCount = 0;

        for (const file of ctx.files) {
          const entries = extractEntriesList(file.data, ['spawns', 'spawnConfigs', 'rules']);
          const list = entries.length > 0 ? entries : isRecord(file.data) ? [file.data] : [];
          for (let i = 0; i < list.length; i++) {
            const rawItem = list[i];
            const spawn = sanitizeModSpawnDefinition(
              ctx.modId,
              rawItem,
              file.relativePath,
              diagnostics,
              { index: i },
            );
            if (!spawn) continue;
            this.registerInlineSpawns(ctx.modId, 'spawns_file', [spawn], diagnostics);
            const inlineEvents = this.extractContextualInlineEvents(
              ctx.modId,
              rawItem,
              file.relativePath,
              diagnostics,
              { entityId: spawn.contentId },
            );
            if (inlineEvents.length > 0) {
              this.registerInlineEvents(ctx.modId, 'spawns_file', inlineEvents, diagnostics);
            }
            loadedCount += 1;
          }
        }

        return { loadedCount, diagnostics };
      },
      unloadMod: (modId: string) => {
        this.unloadInlineSpawns(modId, 'spawns_file');
        this.unloadInlineEvents(modId, 'spawns_file');
        this.registries.spawns.unloadMod(modId);
      },
      clearAll: () => {
        this.inlineSpawnIdsByModAndCat.clear();
        this.inlineEventIdsByModAndCat.clear();
        this.registries.spawns.clear();
      },
    };
  }

  private createEventsHandler(): ModContentHandler {
    return {
      contentType: 'events',
      validateAndLoad: (ctx: ModLoadContext): ModContentHandlerResult => {
        const diagnostics: ModDiagnostic[] = [];
        this.unloadInlineEvents(ctx.modId, 'events_file');
        let loadedCount = 0;

        for (const file of ctx.files) {
          const entries = extractEntriesList(file.data, ['events', 'triggers', 'rules']);
          const list = entries.length > 0 ? entries : isRecord(file.data) ? [file.data] : [];
          for (let i = 0; i < list.length; i++) {
            const eventDef = sanitizeModEventDefinition(
              ctx.modId,
              list[i],
              file.relativePath,
              diagnostics,
              { index: i },
            );
            if (!eventDef) continue;
            this.registerInlineEvents(ctx.modId, 'events_file', [eventDef], diagnostics);
            loadedCount += 1;
          }
        }

        return { loadedCount, diagnostics };
      },
      unloadMod: (modId: string) => {
        this.unloadInlineEvents(modId, 'events_file');
        this.registries.events.unloadMod(modId);
      },
      clearAll: () => {
        this.inlineEventIdsByModAndCat.clear();
        this.registries.events.clear();
      },
    };
  }
}
