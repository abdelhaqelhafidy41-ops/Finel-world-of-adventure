import type {
  CraftingRecipe,
  ItemDefinition,
  ItemIconKey,
} from '../../inventory/inventoryTypes';
import type { QuestDefinition } from '../../quest/questTypes';
import {
  clearAllModQuests,
  registerModQuestDefinition,
  unregisterModQuests,
} from '../../quest/questRegistry';
import type {
  ModContentHandler,
  ModContentHandlerResult,
  ModDiagnostic,
  ModLoadContext,
} from '../modTypes';

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
  // Support single-object JSON definition file
  if (typeof data.id === 'string') return [data];
  return [];
}

function sanitizeItemDefinition(
  raw: unknown,
  isWeaponDefault: boolean,
): ItemDefinition | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!id || !name) return null;

  const category = isWeaponDefault
    ? 'weapon'
    : typeof raw.category === 'string'
      ? (raw.category as ItemDefinition['category'])
      : 'material';

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
    icon:
      typeof raw.icon === 'string' && raw.icon.trim()
        ? (raw.icon.trim() as ItemIconKey)
        : isWeaponDefault
          ? 'sword'
          : 'stone',
    stackable: typeof raw.stackable === 'boolean' ? raw.stackable : !isWeaponDefault,
    maxStack:
      typeof raw.maxStack === 'number' && raw.maxStack > 0
        ? Math.trunc(raw.maxStack)
        : isWeaponDefault
          ? 1
          : 50,
    usable: typeof raw.usable === 'boolean' ? raw.usable : false,
    droppable: typeof raw.droppable === 'boolean' ? raw.droppable : true,
    valueCoins:
      typeof raw.valueCoins === 'number' && Number.isFinite(raw.valueCoins)
        ? Math.max(0, Math.round(raw.valueCoins))
        : undefined,
  };

  if (isRecord(raw.weaponStats)) {
    const dmg = Number(raw.weaponStats.damage);
    const cd = Number(raw.weaponStats.cooldown);
    const rng = Number(raw.weaponStats.range);
    if (Number.isFinite(dmg) && dmg > 0) {
      def.weaponStats = {
        damage: dmg,
        cooldown: Number.isFinite(cd) && cd > 0 ? cd : 0.65,
        range: Number.isFinite(rng) && rng > 0 ? rng : 2.6,
        isRanged: Boolean(raw.weaponStats.isRanged),
        staminaCost:
          typeof raw.weaponStats.staminaCost === 'number'
            ? raw.weaponStats.staminaCost
            : undefined,
        critChance:
          typeof raw.weaponStats.critChance === 'number'
            ? raw.weaponStats.critChance
            : undefined,
      };
      def.equipSlot = 'weapon';
      def.weaponId = typeof raw.weaponId === 'string' ? raw.weaponId : id;
    }
  }

  if (typeof raw.equipSlot === 'string') {
    def.equipSlot = raw.equipSlot as ItemDefinition['equipSlot'];
  }
  if (isRecord(raw.equipStats)) {
    def.equipStats = raw.equipStats as ItemDefinition['equipStats'];
  }
  if (isRecord(raw.consumeEffect)) {
    def.consumeEffect = raw.consumeEffect as ItemDefinition['consumeEffect'];
  }

  return def;
}

function sanitizeRecipe(raw: unknown): CraftingRecipe | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const resultItemId =
    typeof raw.resultItemId === 'string' ? raw.resultItemId.trim() : '';
  if (!id || !resultItemId || !Array.isArray(raw.ingredients)) return null;

  const ingredients = raw.ingredients
    .filter(isRecord)
    .map((ing) => ({
      itemId: typeof ing.itemId === 'string' ? ing.itemId.trim() : '',
      count: typeof ing.count === 'number' && ing.count > 0 ? Math.trunc(ing.count) : 1,
    }))
    .filter((ing) => ing.itemId.length > 0);

  if (ingredients.length === 0) return null;

  return {
    id,
    resultItemId,
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
    craftingTimeSec:
      typeof raw.craftingTimeSec === 'number' && raw.craftingTimeSec > 0
        ? raw.craftingTimeSec
        : 0.5,
  };
}

function sanitizeQuest(raw: unknown): QuestDefinition | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const giverNpcId =
    typeof raw.giverNpcId === 'string' ? raw.giverNpcId.trim() : '';
  if (!id || !title || !giverNpcId || !Array.isArray(raw.objectives)) return null;

  return {
    id,
    title,
    titleAr: typeof raw.titleAr === 'string' ? raw.titleAr : title,
    scope: raw.scope === 'cooperative' ? 'cooperative' : 'personal',
    giverNpcId,
    turnInNpcId: typeof raw.turnInNpcId === 'string' ? raw.turnInNpcId : giverNpcId,
    description: typeof raw.description === 'string' ? raw.description : '',
    descriptionAr:
      typeof raw.descriptionAr === 'string' ? raw.descriptionAr : undefined,
    sequential: typeof raw.sequential === 'boolean' ? raw.sequential : true,
    objectives: raw.objectives as QuestDefinition['objectives'],
    reward: isRecord(raw.reward) ? (raw.reward as QuestDefinition['reward']) : {},
    rewardSummary:
      typeof raw.rewardSummary === 'string' ? raw.rewardSummary : 'Reward',
    rewardSummaryAr:
      typeof raw.rewardSummaryAr === 'string' ? raw.rewardSummaryAr : undefined,
  };
}

export interface ModDescriptorEntry {
  modId: string;
  id: string;
  payload: Record<string, unknown>;
}

export class DefaultModContentStore {
  private readonly itemsByMod = new Map<string, ItemDefinition[]>();
  private readonly weaponsByMod = new Map<string, ItemDefinition[]>();
  private readonly recipesByMod = new Map<string, CraftingRecipe[]>();
  private readonly descriptorsByCategory = new Map<
    string,
    Map<string, ModDescriptorEntry[]>
  >();
  private readonly localizationByMod = new Map<
    string,
    Map<string, Record<string, string>>
  >();

  public getAllModItems(): ItemDefinition[] {
    const out: ItemDefinition[] = [];
    for (const list of this.itemsByMod.values()) out.push(...list);
    for (const list of this.weaponsByMod.values()) out.push(...list);
    return out;
  }

  public getAllModRecipes(): CraftingRecipe[] {
    const out: CraftingRecipe[] = [];
    for (const list of this.recipesByMod.values()) out.push(...list);
    return out;
  }

  public getDescriptors(category: string): ModDescriptorEntry[] {
    const map = this.descriptorsByCategory.get(category);
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

  public createHandlers(): ModContentHandler[] {
    return [
      this.createItemsHandler('items', false, this.itemsByMod),
      this.createItemsHandler('weapons', true, this.weaponsByMod),
      this.createRecipesHandler(),
      this.createQuestsHandler(),
      this.createLocalizationHandler(),
      this.createDescriptorHandler('characters', ['characters']),
      this.createDescriptorHandler('creatures', ['creatures', 'wildlife']),
      this.createDescriptorHandler('npcs', ['npcs']),
      this.createDescriptorHandler('buildings', ['buildings', 'structures']),
      this.createDescriptorHandler('assets', ['assets']),
      this.createDescriptorHandler('models', ['models']),
      this.createDescriptorHandler('textures', ['textures']),
      this.createDescriptorHandler('sounds', ['sounds']),
      this.createDescriptorHandler('music', ['music']),
    ];
  }

  private createItemsHandler(
    contentType: string,
    isWeaponDefault: boolean,
    targetMap: Map<string, ItemDefinition[]>,
  ): ModContentHandler {
    return {
      contentType,
      validateAndLoad: (ctx: ModLoadContext): ModContentHandlerResult => {
        const diagnostics: ModDiagnostic[] = [];
        const loaded: ItemDefinition[] = [];
        const containerKeys = isWeaponDefault ? ['weapons', 'items'] : ['items'];

        for (const file of ctx.files) {
          const entries = extractEntriesList(file.data, containerKeys);
          for (const rawEntry of entries) {
            const def = sanitizeItemDefinition(rawEntry, isWeaponDefault);
            if (!def) {
              diagnostics.push({
                code: 'INVALID_ITEM_DEFINITION',
                severity: 'warning',
                message: `Skipped invalid ${contentType} entry in "${file.relativePath}" (requires "id" and "name").`,
              });
              continue;
            }
            loaded.push(def);
          }
        }

        targetMap.set(ctx.modId, loaded);
        return { loadedCount: loaded.length, diagnostics };
      },
      unloadMod: (modId: string) => {
        targetMap.delete(modId);
      },
      clearAll: () => {
        targetMap.clear();
      },
    };
  }

  private createRecipesHandler(): ModContentHandler {
    return {
      contentType: 'recipes',
      validateAndLoad: (ctx: ModLoadContext): ModContentHandlerResult => {
        const diagnostics: ModDiagnostic[] = [];
        const loaded: CraftingRecipe[] = [];

        for (const file of ctx.files) {
          const entries = extractEntriesList(file.data, ['recipes']);
          for (const rawEntry of entries) {
            const recipe = sanitizeRecipe(rawEntry);
            if (!recipe) {
              diagnostics.push({
                code: 'INVALID_RECIPE_DEFINITION',
                severity: 'warning',
                message: `Skipped invalid recipe entry in "${file.relativePath}" (requires "id", "resultItemId", and non-empty "ingredients").`,
              });
              continue;
            }
            loaded.push(recipe);
          }
        }

        this.recipesByMod.set(ctx.modId, loaded);
        return { loadedCount: loaded.length, diagnostics };
      },
      unloadMod: (modId: string) => {
        this.recipesByMod.delete(modId);
      },
      clearAll: () => {
        this.recipesByMod.clear();
      },
    };
  }

  private createQuestsHandler(): ModContentHandler {
    return {
      contentType: 'quests',
      validateAndLoad: (ctx: ModLoadContext): ModContentHandlerResult => {
        const diagnostics: ModDiagnostic[] = [];
        let loadedCount = 0;

        for (const file of ctx.files) {
          const entries = extractEntriesList(file.data, ['quests']);
          for (const rawEntry of entries) {
            const quest = sanitizeQuest(rawEntry);
            if (!quest) {
              diagnostics.push({
                code: 'INVALID_QUEST_DEFINITION',
                severity: 'warning',
                message: `Skipped invalid quest entry in "${file.relativePath}" (requires "id", "title", "giverNpcId", "objectives").`,
              });
              continue;
            }
            registerModQuestDefinition(ctx.modId, quest);
            loadedCount += 1;
          }
        }

        return { loadedCount, diagnostics };
      },
      unloadMod: (modId: string) => {
        unregisterModQuests(modId);
      },
      clearAll: () => {
        clearAllModQuests();
      },
    };
  }

  private createLocalizationHandler(): ModContentHandler {
    return {
      contentType: 'localization',
      validateAndLoad: (ctx: ModLoadContext): ModContentHandlerResult => {
        const diagnostics: ModDiagnostic[] = [];
        const langMap = new Map<string, Record<string, string>>();
        let loadedCount = 0;

        for (const file of ctx.files) {
          if (!isRecord(file.data)) continue;
          const fileBase =
            file.relativePath.split('/').pop()?.replace(/\.json$/i, '').toLowerCase() || '';

          // Either { "en": { ... }, "ar": { ... } } OR per-language file localization/en.json
          const isSingleLangFile = fileBase === 'en' || fileBase === 'ar';
          if (isSingleLangFile && !isRecord(file.data[fileBase])) {
            const dict: Record<string, string> = {};
            for (const [k, v] of Object.entries(file.data)) {
              if (typeof v === 'string') {
                dict[k] = v;
                loadedCount += 1;
              }
            }
            const existing = langMap.get(fileBase) ?? {};
            langMap.set(fileBase, { ...existing, ...dict });
            continue;
          }

          for (const [langCode, block] of Object.entries(file.data)) {
            if (!isRecord(block)) continue;
            const dict: Record<string, string> = {};
            for (const [k, v] of Object.entries(block)) {
              if (typeof v === 'string') {
                dict[k] = v;
                loadedCount += 1;
              }
            }
            const cleanLang = langCode.trim().toLowerCase();
            const existing = langMap.get(cleanLang) ?? {};
            langMap.set(cleanLang, { ...existing, ...dict });
          }
        }

        this.localizationByMod.set(ctx.modId, langMap);
        return { loadedCount, diagnostics };
      },
      unloadMod: (modId: string) => {
        this.localizationByMod.delete(modId);
      },
      clearAll: () => {
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
            const fallbackId =
              typeof file.data.id === 'string' ? file.data.id : file.relativePath;
            entries.push({
              modId: ctx.modId,
              id: fallbackId,
              payload: file.data,
            });
            continue;
          }

          for (const item of list) {
            if (!isRecord(item)) continue;
            const id =
              typeof item.id === 'string' && item.id.trim()
                ? item.id.trim()
                : `${file.relativePath}#${entries.length}`;
            entries.push({
              modId: ctx.modId,
              id,
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
}
