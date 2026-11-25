import rawItems from './items.json';
import type { ItemDefinition } from './inventoryTypes';

/**
 * Data-driven ItemManager registry. New items can be added via items.json
 * or registered dynamically at runtime without changing inventory logic.
 */
export class ItemManager {
  private static externalItemProvider: (() => ItemDefinition[]) | null = null;
  private readonly items = new Map<string, ItemDefinition>();

  constructor(initialItems: ItemDefinition[] = rawItems as unknown as ItemDefinition[]) {
    for (const item of initialItems) {
      this.items.set(item.id, item);
    }
  }

  public static setExternalItemProvider(
    provider: (() => ItemDefinition[]) | null,
  ): void {
    ItemManager.externalItemProvider = provider;
  }

  private findExternalItem(itemId: string): ItemDefinition | undefined {
    const ext = ItemManager.externalItemProvider?.();
    if (!ext || ext.length === 0) return undefined;
    for (let i = ext.length - 1; i >= 0; i--) {
      if (ext[i].id === itemId) return ext[i];
    }
    return undefined;
  }

  public getItem(itemId: string): ItemDefinition | undefined {
    return this.items.get(itemId) ?? this.findExternalItem(itemId);
  }

  public getAllItems(): ItemDefinition[] {
    const ext = ItemManager.externalItemProvider?.();
    if (!ext || ext.length === 0) {
      return Array.from(this.items.values());
    }
    const merged = new Map<string, ItemDefinition>(this.items);
    for (const item of ext) {
      if (!merged.has(item.id)) {
        merged.set(item.id, item);
      }
    }
    return Array.from(merged.values());
  }

  public registerItem(definition: ItemDefinition): void {
    this.items.set(definition.id, definition);
  }

  public getName(itemId: string, lang: 'en' | 'ar' = 'en'): string {
    const def = this.getItem(itemId);
    if (!def) return itemId;
    return lang === 'ar' ? def.nameAr : def.name;
  }

  public getDescription(itemId: string, lang: 'en' | 'ar' = 'en'): string {
    const def = this.getItem(itemId);
    if (!def) return '';
    return lang === 'ar' ? def.descriptionAr : def.description;
  }
}
