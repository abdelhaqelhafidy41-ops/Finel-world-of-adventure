export type ItemCategory =
  | 'consumable'
  | 'quest'
  | 'equipment'
  | 'weapon'
  | 'material'
  | 'tool';

export type EquipSlot =
  | 'weapon'
  | 'head'
  | 'body'
  | 'legs'
  | 'hands'
  | 'boots'
  | 'backpack'
  | 'accessory';

export type ToolKind = 'axe' | 'pickaxe' | 'shovel';

export type ItemIconKey =
  | 'compass'
  | 'journal'
  | 'herb'
  | 'loaf'
  | 'tonic'
  | 'apple'
  | 'wheat'
  | 'seal'
  | 'boots'
  | 'cloak'
  | 'sword'
  | 'axe'
  | 'bow'
  | 'spear'
  | 'crossbow'
  | 'knife'
  | 'wood'
  | 'stone'
  | 'ore'
  | 'coal'
  | 'fiber'
  | 'hide'
  | 'meat'
  | 'cooked_meat'
  | 'arrow'
  | 'torch'
  | 'bed'
  | 'armor'
  | 'mushroom'
  | 'berries'
  | 'flower'
  | 'sand'
  | 'cactus'
  | 'shell'
  | 'crystal'
  | 'pickaxe'
  | 'shovel'
  | 'shirt'
  | 'pants'
  | 'gloves'
  | 'backpack'
  | 'ingot'
  | 'plank'
  | 'gravel'
  | 'station'
  | 'cloth'
  | 'club'
  | 'seed'
  | 'corn'
  | 'carrot'
  | 'potato'
  | 'tomato'
  | 'egg'
  | 'milk'
  | 'cheese'
  | 'watering_can'
  | 'hoe';

export interface ItemEquipStats {
  maxHealthBonus?: number;
  maxStaminaBonus?: number;
  speedBonus?: number;
  damageReductionBonus?: number;
  capacityBonus?: number;
}

export interface ItemWeaponStats {
  damage: number;
  cooldown: number;
  range: number;
  isRanged: boolean;
  staminaCost?: number;
  critChance?: number;
}

export interface ItemConsumeEffect {
  health?: number;
  stamina?: number;
}

export interface ItemDefinition {
  id: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  category: ItemCategory;
  icon: ItemIconKey;
  stackable: boolean;
  maxStack: number;
  usable: boolean;
  droppable: boolean;
  equipSlot?: EquipSlot;
  equipStats?: ItemEquipStats;
  weaponId?: string;
  weaponStats?: ItemWeaponStats;
  toolKind?: ToolKind;
  toolTier?: number;
  maxDurability?: number;
  consumeEffect?: ItemConsumeEffect;
  valueCoins?: number;
  modelPath?: string;
  iconTexture?: string;
}

export interface InventorySlotState {
  slotIndex: number;
  itemId: string;
  count: number;
  equipped: boolean;
  durability?: number;
  maxDurability?: number;
}

export interface InventorySlotView {
  slotIndex: number;
  itemId: string;
  count: number;
  equipped: boolean;
  durability?: number;
  maxDurability?: number;
  definition: ItemDefinition;
}

export interface InventorySnapshot {
  capacity: number;
  usedSlots: number;
  slots: Array<InventorySlotView | null>;
  equippedBySlot: Partial<Record<EquipSlot, InventorySlotView>>;
  bonuses: Required<ItemEquipStats>;
}

export interface CraftingIngredient {
  itemId: string;
  count: number;
}

export type CraftingStationType =
  | 'hand'
  | 'crafting_table'
  | 'forge'
  | 'furnace'
  | 'workbench';

export type CraftingRecipeCategory =
  | 'camp'
  | 'weapon'
  | 'tool'
  | 'armor'
  | 'clothing'
  | 'building'
  | 'material'
  | 'provisions';

export type CraftingLockReason =
  | 'station'
  | 'tool'
  | 'level'
  | 'prerequisite'
  | 'story';

export type CraftingRecipeStatus = 'available' | 'missing_materials' | 'locked';

export interface CraftingRecipe {
  id: string;
  resultItemId: string;
  resultCount: number;
  category: CraftingRecipeCategory;
  ingredients: CraftingIngredient[];
  station?: CraftingStationType;
  requiredTool?: ToolKind;
  requiredToolTier?: number;
  requiredLevel?: number;
  prerequisiteRecipeId?: string;
  requiredStoryQuestId?: string;
  craftingTimeSec?: number;
}

export interface CraftingContext {
  nearbyStations?: CraftingStationType[];
  playerLevel?: number;
  craftedRecipeIds?: ReadonlySet<string> | string[];
  unlockedRecipeIds?: ReadonlySet<string> | string[];
  completedStoryQuestIds?: ReadonlySet<string> | string[];
}

export interface CraftingRecipeView {
  recipe: CraftingRecipe;
  resultItem: ItemDefinition;
  ingredients: Array<{
    itemId: string;
    required: number;
    owned: number;
    definition: ItemDefinition;
  }>;
  canCraft: boolean;
  hasIngredients: boolean;
  status: CraftingRecipeStatus;
  lockReason?: CraftingLockReason;
  requiredStation?: CraftingStationType;
  requiredLevel?: number;
  requiredTool?: ToolKind;
  requiredToolTier?: number;
  prerequisiteRecipeId?: string;
  prerequisiteName?: string;
  prerequisiteNameAr?: string;
  craftingTimeSec: number;
}
