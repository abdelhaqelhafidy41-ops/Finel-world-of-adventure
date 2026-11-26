import type {
  ModAssetIndexEntry,
  ModContentHandler,
  ModDiagnostic,
  ModLoadContext,
} from './modTypes';

const CATEGORY_LOAD_PRIORITY: ReadonlyArray<string> = [
  'textures',
  'sounds',
  'music',
  'localization',
  'items',
  'resources',
  'weapons',
  'armor',
  'tools',
  'consumables',
  'loot_tables',
  'loottables',
  'recipes',
  'characters',
  'animals',
  'creatures',
  'monsters',
  'npcs',
  'buildings',
  'decorations',
  'quests',
  'assets',
  'models',
];

function sortModCategories(categories: string[]): string[] {
  return [...categories].sort((a, b) => {
    const ia = CATEGORY_LOAD_PRIORITY.indexOf(a);
    const ib = CATEGORY_LOAD_PRIORITY.indexOf(b);
    const pa = ia >= 0 ? ia : 999;
    const pb = ib >= 0 ? ib : 999;
    return pa !== pb ? pa - pb : a.localeCompare(b);
  });
}

/**
 * Central modular ModContentRegistry decoupling content ingestion from concrete
 * game subsystems so new mod types can register cleanly without changing core loaders.
 */
export class ModContentRegistry {
  private readonly handlers = new Map<string, ModContentHandler>();
  private readonly assetsByModId = new Map<string, ModAssetIndexEntry[]>();
  private readonly listeners = new Set<() => void>();

  public registerHandler(handler: ModContentHandler): void {
    this.handlers.set(handler.contentType, handler);
  }

  public unregisterHandler(contentType: string): void {
    const existing = this.handlers.get(contentType);
    if (existing) {
      existing.clearAll();
      this.handlers.delete(contentType);
    }
  }

  public getRegisteredContentTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  public loadMod(context: ModLoadContext): {
    ok: boolean;
    loadedEntries: number;
    diagnostics: ModDiagnostic[];
  } {
    const diagnostics: ModDiagnostic[] = [];
    let loadedEntries = 0;

    // Index declared binary/static assets for this mod
    this.assetsByModId.set(context.modId, [...context.assets]);

    // Group parsed JSON files by category and load in deterministic dependency order
    const filesByCategory = new Map<string, ModLoadContext['files']>();
    for (const file of context.files) {
      const cat = file.category.toLowerCase();
      const list = filesByCategory.get(cat) ?? [];
      list.push(file);
      filesByCategory.set(cat, list);
    }

    if (
      !filesByCategory.has('models') &&
      this.handlers.has('models') &&
      context.assets.some(
        (a) =>
          a.category.toLowerCase() === 'models' ||
          a.relativePath.toLowerCase().endsWith('.woa3d'),
      )
    ) {
      filesByCategory.set('models', []);
    }

    const orderedCategories = sortModCategories(Array.from(filesByCategory.keys()));
    for (const category of orderedCategories) {
      const files = filesByCategory.get(category) ?? [];
      const handler = this.handlers.get(category);
      if (!handler) {
        diagnostics.push({
          code: 'UNHANDLED_MOD_CATEGORY',
          severity: 'info',
          message: `Category "${category}" has no active runtime handler yet (${files.length} file(s) indexed).`,
        });
        continue;
      }

      try {
        const res = handler.validateAndLoad({
          ...context,
          files,
        });
        loadedEntries += res.loadedCount;
        diagnostics.push(...res.diagnostics);
      } catch (err) {
        diagnostics.push({
          code: 'HANDLER_LOAD_EXCEPTION',
          severity: 'error',
          message: `Failed loading "${category}" content: ${err instanceof Error ? err.message : 'Unknown error'}`,
        });
      }
    }

    const hasFatalError = diagnostics.some((d) => d.severity === 'error');
    if (hasFatalError) {
      this.unloadMod(context.modId);
      return { ok: false, loadedEntries: 0, diagnostics };
    }

    this.notify();
    return { ok: true, loadedEntries, diagnostics };
  }

  public unloadMod(modId: string): void {
    this.assetsByModId.delete(modId);
    for (const handler of this.handlers.values()) {
      try {
        handler.unloadMod(modId);
      } catch {
        // Keep unloading remaining handlers cleanly
      }
    }
    this.notify();
  }

  public unloadAll(): void {
    this.assetsByModId.clear();
    for (const handler of this.handlers.values()) {
      try {
        handler.clearAll();
      } catch {
        // Keep clearing remaining handlers cleanly
      }
    }
    this.notify();
  }

  public getModAssets(modId: string, category?: string): ModAssetIndexEntry[] {
    const list = this.assetsByModId.get(modId) ?? [];
    if (!category) return [...list];
    const target = category.toLowerCase();
    return list.filter((a) => a.category.toLowerCase() === target);
  }

  public getAllActiveAssets(category?: string): ModAssetIndexEntry[] {
    const out: ModAssetIndexEntry[] = [];
    for (const list of this.assetsByModId.values()) {
      for (const item of list) {
        if (!category || item.category.toLowerCase() === category.toLowerCase()) {
          out.push(item);
        }
      }
    }
    return out;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
