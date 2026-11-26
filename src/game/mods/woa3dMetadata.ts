import {
  MOD_CONTENT_SCHEMA_VERSION,
  SUPPORTED_MOD_SCHEMA_VERSIONS,
  type Woa3dAssetMetadata,
} from './modTypes';

export type CanonicalWoa3dCategory =
  | 'weapons'
  | 'decorations'
  | 'buildings'
  | 'items'
  | 'armor'
  | 'tools'
  | 'consumables'
  | 'resources'
  | 'characters'
  | 'animals'
  | 'monsters'
  | 'npcs'
  | 'models';

const MOD_CATEGORY_ALIAS_MAP: Record<string, CanonicalWoa3dCategory> = {
  weapon: 'weapons',
  weapons: 'weapons',
  sword: 'weapons',
  axe: 'weapons',
  bow: 'weapons',
  spear: 'weapons',
  crossbow: 'weapons',
  knife: 'weapons',
  decoration: 'decorations',
  decorations: 'decorations',
  decor: 'decorations',
  furniture: 'decorations',
  prop: 'decorations',
  props: 'decorations',
  ornament: 'decorations',
  building: 'buildings',
  buildings: 'buildings',
  structure: 'buildings',
  structures: 'buildings',
  item: 'items',
  items: 'items',
  relic: 'items',
  relics: 'items',
  artifact: 'items',
  artifacts: 'items',
  armor: 'armor',
  armour: 'armor',
  equipment: 'armor',
  tool: 'tools',
  tools: 'tools',
  consumable: 'consumables',
  consumables: 'consumables',
  food: 'consumables',
  potion: 'consumables',
  potions: 'consumables',
  resource: 'resources',
  resources: 'resources',
  material: 'resources',
  materials: 'resources',
  character: 'characters',
  characters: 'characters',
  animal: 'animals',
  animals: 'animals',
  creature: 'animals',
  creatures: 'animals',
  wildlife: 'animals',
  monster: 'monsters',
  monsters: 'monsters',
  enemy: 'monsters',
  enemies: 'monsters',
  npc: 'npcs',
  npcs: 'npcs',
  '3d-model': 'models',
  model: 'models',
  models: 'models',
};

const VALID_WOA3D_TOP_CATEGORIES = new Set<string>([
  '3d-model',
  '3d_model',
  'model',
  'models',
]);

export type Woa3dValidationOutcome =
  | {
      ok: true;
      metadata: Woa3dAssetMetadata;
      parsed: Record<string, unknown>;
    }
  | {
      ok: false;
      reason: 'wrong_category' | 'corrupt_asset' | 'unsupported_schema';
      errorCode: string;
      message: string;
    };

export function normalizeWoa3dModCategory(
  rawModCategory: unknown,
): CanonicalWoa3dCategory | null {
  if (typeof rawModCategory !== 'string') return null;
  const key = rawModCategory.trim().toLowerCase();
  if (!key) return null;
  return MOD_CATEGORY_ALIAS_MAP[key] ?? null;
}

export function parseAndValidateWoa3dText(
  rawText: string,
  supportedSchemas: readonly number[] = SUPPORTED_MOD_SCHEMA_VERSIONS,
): Woa3dValidationOutcome {
  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(rawText);
  } catch (err) {
    return {
      ok: false,
      reason: 'corrupt_asset',
      errorCode: 'CORRUPT_WOA3D_JSON',
      message: `Invalid .woa3d JSON syntax${err instanceof Error ? `: ${err.message}` : '.'}`,
    };
  }

  if (!parsedUnknown || typeof parsedUnknown !== 'object' || Array.isArray(parsedUnknown)) {
    return {
      ok: false,
      reason: 'corrupt_asset',
      errorCode: 'INVALID_WOA3D_ROOT',
      message: '.woa3d asset root must be a JSON object.',
    };
  }

  const parsed = parsedUnknown as Record<string, unknown>;

  let schemaVersion = MOD_CONTENT_SCHEMA_VERSION;
  if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== null) {
    if (typeof parsed.schemaVersion !== 'number' || !Number.isFinite(parsed.schemaVersion)) {
      return {
        ok: false,
        reason: 'unsupported_schema',
        errorCode: 'INVALID_WOA3D_SCHEMA_VERSION',
        message: '.woa3d asset has invalid numeric "schemaVersion".',
      };
    }
    schemaVersion = Math.trunc(parsed.schemaVersion);
    if (!supportedSchemas.includes(schemaVersion)) {
      return {
        ok: false,
        reason: 'unsupported_schema',
        errorCode: 'UNSUPPORTED_WOA3D_SCHEMA_VERSION',
        message: `.woa3d schemaVersion v${schemaVersion} is not supported (supported: v${supportedSchemas.join(', v')}).`,
      };
    }
  }

  const rawType = typeof parsed.type === 'string' ? parsed.type.trim().toLowerCase() : '';
  if (rawType !== '3d-model') {
    return {
      ok: false,
      reason: 'wrong_category',
      errorCode: 'INVALID_WOA3D_TYPE',
      message: `.woa3d asset requires type "3d-model" (got "${rawType || 'missing'}").`,
    };
  }

  const rawCategory =
    typeof parsed.category === 'string' ? parsed.category.trim().toLowerCase() : '';
  if (rawCategory && !VALID_WOA3D_TOP_CATEGORIES.has(rawCategory)) {
    return {
      ok: false,
      reason: 'wrong_category',
      errorCode: 'INVALID_WOA3D_CATEGORY',
      message: `.woa3d asset category "${parsed.category}" is invalid for a 3D model.`,
    };
  }

  const modCategory =
    typeof parsed.modCategory === 'string' ? parsed.modCategory.trim() : '';
  const canonicalCategory = modCategory ? normalizeWoa3dModCategory(modCategory) : 'models';
  if (modCategory && !canonicalCategory) {
    return {
      ok: false,
      reason: 'wrong_category',
      errorCode: 'INVALID_WOA3D_MOD_CATEGORY',
      message: `.woa3d modCategory "${modCategory}" is not a recognized World of Adventure content category.`,
    };
  }

  const id = typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id.trim() : undefined;
  const name =
    typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : undefined;

  return {
    ok: true,
    metadata: {
      schemaVersion,
      type: '3d-model',
      category: rawCategory || '3d-model',
      modCategory: modCategory || 'models',
      canonicalCategory: canonicalCategory ?? 'models',
      ...(id ? { id } : {}),
      ...(name ? { name } : {}),
    },
    parsed,
  };
}

export function isWoa3dCompatibleWithContent(
  canonicalModelCat: string,
  contentCategory: string,
  contentEntry: Record<string, unknown>,
): boolean {
  const modelCat = canonicalModelCat.toLowerCase();
  const contentCat = contentCategory.toLowerCase();

  if (modelCat === 'models') return true;
  if (modelCat === contentCat) return true;

  if (contentCat === 'creatures' && modelCat === 'animals') return true;
  if (contentCat === 'buildings' && modelCat === 'decorations') {
    return (
      contentEntry.isDecorative === true ||
      String(contentEntry.category ?? '').trim().toLowerCase() === 'furniture'
    );
  }
  if (contentCat === 'decorations' && modelCat === 'buildings') {
    return (
      contentEntry.isDecorative === true ||
      String(contentEntry.category ?? '').trim().toLowerCase() === 'furniture'
    );
  }

  if (contentCat === 'items') {
    const itemSubCat = String(contentEntry.category ?? '').trim().toLowerCase();
    if (
      modelCat === 'weapons' &&
      (itemSubCat === 'weapon' ||
        contentEntry.weaponStats !== undefined ||
        String(contentEntry.equipSlot ?? '').trim().toLowerCase() === 'weapon')
    ) {
      return true;
    }
    if (modelCat === 'tools' && (itemSubCat === 'tool' || contentEntry.toolKind !== undefined)) {
      return true;
    }
    if (modelCat === 'armor' && itemSubCat === 'equipment') return true;
    if (modelCat === 'consumables' && itemSubCat === 'consumable') return true;
    if (modelCat === 'resources' && itemSubCat === 'material') return true;
  }

  if (
    modelCat === 'items' &&
    (contentCat === 'resources' ||
      contentCat === 'consumables' ||
      contentCat === 'tools' ||
      contentCat === 'armor')
  ) {
    return true;
  }

  return false;
}

export function extractModelReferenceFromContent(
  entry: Record<string, unknown>,
): string | null {
  const fields = [
    'modelPath',
    'model',
    'modelAsset',
    'woa3d',
    'woa3dPath',
    'model3d',
  ];
  for (const field of fields) {
    const val = entry[field];
    if (typeof val === 'string' && val.trim()) {
      return val.trim();
    }
  }
  return null;
}

export function normalizeModRelativeAssetPathForLookup(
  rawRef: string,
  modId?: string,
): string | null {
  if (typeof rawRef !== 'string' || !rawRef.trim()) return null;
  let cleaned = rawRef.trim().replace(/\\/g, '/');
  const sep = cleaned.indexOf('://');
  if (sep >= 0) {
    const scheme = cleaned.slice(0, sep).trim().toLowerCase();
    if (scheme !== 'mod' && (!modId || scheme !== modId.toLowerCase())) {
      return null;
    }
    cleaned = cleaned.slice(sep + 3);
  }
  const parts: string[] = [];
  for (const seg of cleaned.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') return null;
    parts.push(seg);
  }
  if (parts.length === 0) return null;
  return parts.join('/').toLowerCase();
}
