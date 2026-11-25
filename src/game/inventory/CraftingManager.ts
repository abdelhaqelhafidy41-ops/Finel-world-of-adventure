import rawRecipes from './recipes.json';
import type { InventoryManager } from './InventoryManager';
import type {
  CraftingContext,
  CraftingLockReason,
  CraftingRecipe,
  CraftingRecipeStatus,
  CraftingRecipeView,
  CraftingStationType,
} from './inventoryTypes';

export type CraftResult =
  | {
      ok: false;
      reason: 'unknown_recipe' | 'missing_ingredients' | 'inventory_full' | 'locked';
      lockReason?: CraftingLockReason;
      recipe?: CraftingRecipe;
    }
  | { ok: true; itemId: string; count: number; recipe: CraftingRecipe };

function toLookupSet(input?: ReadonlySet<string> | string[]): ReadonlySet<string> {
  if (!input) return new Set<string>();
  return input instanceof Set ? input : new Set(input);
}

/**
 * Data-driven CraftingManager executing recipes against InventoryManager
 * with support for crafting stations, tools, player level, prerequisites, and progression tracking.
 */
export class CraftingManager {
  private static externalRecipeProvider: (() => CraftingRecipe[]) | null = null;
  private readonly recipes: CraftingRecipe[];
  private readonly craftedRecipeIds = new Set<string>();
  private readonly unlockedRecipeIds = new Set<string>();

  constructor(recipes: CraftingRecipe[] = rawRecipes as unknown as CraftingRecipe[]) {
    this.recipes = recipes;
  }

  public static setExternalRecipeProvider(
    provider: (() => CraftingRecipe[]) | null,
  ): void {
    CraftingManager.externalRecipeProvider = provider;
  }

  public getRecipes(): CraftingRecipe[] {
    const ext = CraftingManager.externalRecipeProvider?.();
    if (!ext || ext.length === 0) return this.recipes;
    const merged = new Map<string, CraftingRecipe>();
    for (const r of this.recipes) {
      merged.set(r.id, r);
    }
    for (const r of ext) {
      if (!merged.has(r.id)) {
        merged.set(r.id, r);
      }
    }
    return Array.from(merged.values());
  }

  public getRecipe(recipeId: string): CraftingRecipe | undefined {
    const core = this.recipes.find((r) => r.id === recipeId);
    if (core) return core;
    const ext = CraftingManager.externalRecipeProvider?.();
    if (ext && ext.length > 0) {
      for (let i = ext.length - 1; i >= 0; i--) {
        if (ext[i].id === recipeId) return ext[i];
      }
    }
    return undefined;
  }

  public resetProgression(): void {
    this.craftedRecipeIds.clear();
    this.unlockedRecipeIds.clear();
  }

  public unlockRecipe(recipeId: string): void {
    this.unlockedRecipeIds.add(recipeId);
  }

  public recordCraftedRecipe(recipeId: string): void {
    this.craftedRecipeIds.add(recipeId);
    this.unlockedRecipeIds.add(recipeId);
  }

  public exportState(): { craftedRecipeIds: string[]; unlockedRecipeIds: string[] } {
    return {
      craftedRecipeIds: Array.from(this.craftedRecipeIds),
      unlockedRecipeIds: Array.from(this.unlockedRecipeIds),
    };
  }

  public restoreState(state?: {
    craftedRecipeIds?: string[];
    unlockedRecipeIds?: string[];
  }): void {
    this.craftedRecipeIds.clear();
    this.unlockedRecipeIds.clear();
    if (!state) return;
    if (Array.isArray(state.craftedRecipeIds)) {
      for (const id of state.craftedRecipeIds) {
        if (typeof id === 'string') this.craftedRecipeIds.add(id);
      }
    }
    if (Array.isArray(state.unlockedRecipeIds)) {
      for (const id of state.unlockedRecipeIds) {
        if (typeof id === 'string') this.unlockedRecipeIds.add(id);
      }
    }
  }

  public evaluateLockReason(
    recipe: CraftingRecipe,
    inventory: InventoryManager,
    context?: CraftingContext,
  ): CraftingLockReason | undefined {
    const completedStory = toLookupSet(context?.completedStoryQuestIds);
    const crafted = toLookupSet(context?.craftedRecipeIds);
    const unlocked = toLookupSet(context?.unlockedRecipeIds);

    if (recipe.requiredStoryQuestId && !completedStory.has(recipe.requiredStoryQuestId)) {
      return 'story';
    }

    if (recipe.prerequisiteRecipeId) {
      const prereqDone =
        this.craftedRecipeIds.has(recipe.prerequisiteRecipeId) ||
        this.unlockedRecipeIds.has(recipe.prerequisiteRecipeId) ||
        crafted.has(recipe.prerequisiteRecipeId) ||
        unlocked.has(recipe.prerequisiteRecipeId);
      if (!prereqDone) {
        return 'prerequisite';
      }
    }

    const level = context?.playerLevel ?? 1;
    if (recipe.requiredLevel && level < recipe.requiredLevel) {
      return 'level';
    }

    if (
      recipe.requiredTool &&
      !inventory.hasTool(recipe.requiredTool, recipe.requiredToolTier ?? 1)
    ) {
      return 'tool';
    }

    const requiredStation: CraftingStationType = recipe.station ?? 'hand';
    if (requiredStation !== 'hand') {
      const nearby = new Set<CraftingStationType>(context?.nearbyStations ?? ['hand']);
      nearby.add('hand');
      if (!nearby.has(requiredStation)) {
        return 'station';
      }
    }

    return undefined;
  }

  public getRecipeViews(
    inventory: InventoryManager,
    context?: CraftingContext,
  ): CraftingRecipeView[] {
    const allRecipes = this.getRecipes();
    const views: CraftingRecipeView[] = [];
    for (let i = 0; i < allRecipes.length; i++) {
      const recipe = allRecipes[i];
      const resultItem = inventory.itemManager.getItem(recipe.resultItemId);
      if (!resultItem) continue;

      let hasIngredients = true;
      const ingredients = recipe.ingredients.map((ing) => {
        const owned = inventory.getItemCount(ing.itemId);
        if (owned < ing.count) hasIngredients = false;
        const definition = inventory.itemManager.getItem(ing.itemId) ?? {
          id: ing.itemId,
          name: ing.itemId,
          nameAr: ing.itemId,
          description: '',
          descriptionAr: '',
          category: 'material' as const,
          icon: 'wood' as const,
          stackable: true,
          maxStack: 50,
          usable: false,
          droppable: true,
        };
        return {
          itemId: ing.itemId,
          required: ing.count,
          owned,
          definition,
        };
      });

      const lockReason = this.evaluateLockReason(recipe, inventory, context);
      const status: CraftingRecipeStatus = lockReason
        ? 'locked'
        : hasIngredients
          ? 'available'
          : 'missing_materials';
      const canCraft = status === 'available';

      let prerequisiteName: string | undefined;
      let prerequisiteNameAr: string | undefined;
      if (recipe.prerequisiteRecipeId) {
        const pre = this.getRecipe(recipe.prerequisiteRecipeId);
        const preItem = pre
          ? inventory.itemManager.getItem(pre.resultItemId)
          : undefined;
        prerequisiteName = preItem?.name ?? recipe.prerequisiteRecipeId;
        prerequisiteNameAr = preItem?.nameAr ?? recipe.prerequisiteRecipeId;
      }

      views.push({
        recipe,
        resultItem,
        ingredients,
        canCraft,
        hasIngredients,
        status,
        lockReason,
        requiredStation: recipe.station ?? 'hand',
        requiredLevel: recipe.requiredLevel,
        requiredTool: recipe.requiredTool,
        requiredToolTier: recipe.requiredToolTier,
        prerequisiteRecipeId: recipe.prerequisiteRecipeId,
        prerequisiteName,
        prerequisiteNameAr,
        craftingTimeSec: recipe.craftingTimeSec ?? 0.5,
      });
    }
    return views;
  }

  public craft(
    recipeId: string,
    inventory: InventoryManager,
    context?: CraftingContext,
  ): CraftResult {
    const recipe = this.getRecipe(recipeId);
    if (!recipe) {
      return { ok: false, reason: 'unknown_recipe' };
    }

    const lockReason = this.evaluateLockReason(recipe, inventory, context);
    if (lockReason) {
      return { ok: false, reason: 'locked', lockReason, recipe };
    }

    if (!inventory.hasIngredients(recipe.ingredients)) {
      return { ok: false, reason: 'missing_ingredients', recipe };
    }
    if (!inventory.consumeIngredients(recipe.ingredients)) {
      return { ok: false, reason: 'missing_ingredients', recipe };
    }

    const res = inventory.addItem(recipe.resultItemId, recipe.resultCount);
    if (res.added < recipe.resultCount) {
      // Roll back partial add and refund ingredients cleanly
      if (res.added > 0) {
        inventory.removeItem(recipe.resultItemId, res.added);
      }
      for (const ing of recipe.ingredients) {
        inventory.addItem(ing.itemId, ing.count);
      }
      return { ok: false, reason: 'inventory_full', recipe };
    }

    this.recordCraftedRecipe(recipe.id);

    return {
      ok: true,
      itemId: recipe.resultItemId,
      count: res.added,
      recipe,
    };
  }
}
