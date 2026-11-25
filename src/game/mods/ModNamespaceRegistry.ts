import rawItems from '../inventory/items.json';
import rawRecipes from '../inventory/recipes.json';
import rawQuests from '../quest/quests.json';
import { BUILDING_BLUEPRINTS } from '../building/buildingCatalog';
import { AUDIO_CUE_REGISTRY } from '../audio/AudioRegistry';
import type { ModContentType } from './modTypes';

export const MOD_ID_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
export const NAMESPACED_ID_PATTERN =
  /^([a-z0-9][a-z0-9._-]{1,63}):([a-z0-9][a-z0-9._-]{0,63})$/i;

const RESERVED_CORE_NAMESPACES = new Set([
  'core',
  'base',
  'game',
  'vanilla',
  'worldofadventure',
  'woa',
]);

const CORE_WEAPON_IDS = [
  'ranger-sword',
  'wooden-sword',
  'copper-sword',
  'iron-sword',
  'silver-sword',
  'steel-sword',
  'stone-club',
  'woodland-axe',
  'battle-axe',
  'hunter-bow',
  'crossbow',
  'spear',
  'bronze-spear',
  'hunter-knife',
];

const CORE_ENTITY_AND_ROLE_IDS = [
  'player',
  'ranger',
  'village_elder',
  'merchant',
  'blacksmith',
  'guard',
  'villager',
  'farmer',
  'healer',
  'hunter',
  'herbalist',
  'carpenter',
  'deer',
  'wolf',
  'boar',
  'bear',
  'rabbit',
  'chicken',
  'cow',
  'sheep',
  'goat',
  'horse',
  'fox',
  'bandit',
  'goblin',
  'skeleton',
  'slime',
  'boss',
];

function extractIds(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  const out: string[] = [];
  for (const row of rows) {
    if (row && typeof row === 'object' && 'id' in row) {
      const id = (row as { id?: unknown }).id;
      if (typeof id === 'string' && id.trim()) {
        out.push(id.trim());
      }
    }
  }
  return out;
}

export const CORE_PROTECTED_IDS: ReadonlySet<string> = new Set<string>([
  ...extractIds(rawItems),
  ...extractIds(rawRecipes),
  ...extractIds(rawQuests),
  ...BUILDING_BLUEPRINTS.map((bp) => bp.id),
  ...Object.keys(AUDIO_CUE_REGISTRY),
  ...CORE_WEAPON_IDS,
  ...CORE_ENTITY_AND_ROLE_IDS,
]);

export interface ParsedNamespacedId {
  modId: string;
  objectId: string;
  fullId: string;
}

export function parseNamespacedId(rawId: string): ParsedNamespacedId | null {
  if (typeof rawId !== 'string') return null;
  const trimmed = rawId.trim();
  const match = NAMESPACED_ID_PATTERN.exec(trimmed);
  if (!match) return null;
  return {
    modId: match[1],
    objectId: match[2],
    fullId: `${match[1]}:${match[2]}`,
  };
}

export function formatNamespacedId(modId: string, objectId: string): string {
  return `${modId.trim()}:${objectId.trim()}`;
}

export type ResolveModIdentifierResult =
  | {
      ok: true;
      fullId: string;
      modId: string;
      objectId: string;
      wasAutoNamespaced: boolean;
    }
  | {
      ok: false;
      code:
        | 'INVALID_OBJECT_ID'
        | 'CORE_OVERRIDE_FORBIDDEN'
        | 'CROSS_MOD_NAMESPACE_FORBIDDEN';
      message: string;
    };

/**
 * Resolves a mod content object's declared ID into a canonical `modId:objectId` identifier.
 * Rejects un-namespaced core IDs, reserved core namespaces, invalid segments, and cross-mod spoofing.
 */
export function resolveModObjectIdentifier(
  modId: string,
  rawObjectId: unknown,
  coreProtectedIds: ReadonlySet<string> = CORE_PROTECTED_IDS,
): ResolveModIdentifierResult {
  if (typeof rawObjectId !== 'string' || !rawObjectId.trim()) {
    return {
      ok: false,
      code: 'INVALID_OBJECT_ID',
      message: 'Content entry is missing a non-empty string "id".',
    };
  }

  const trimmed = rawObjectId.trim();
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx >= 0) {
    const parsed = parseNamespacedId(trimmed);
    if (!parsed) {
      return {
        ok: false,
        code: 'INVALID_OBJECT_ID',
        message: `Invalid namespaced identifier "${trimmed}". Expected "modId:objectId".`,
      };
    }
    if (RESERVED_CORE_NAMESPACES.has(parsed.modId.toLowerCase())) {
      return {
        ok: false,
        code: 'CORE_OVERRIDE_FORBIDDEN',
        message: `Namespace "${parsed.modId}" is reserved for core game content ("${trimmed}").`,
      };
    }
    if (parsed.modId !== modId) {
      return {
        ok: false,
        code: 'CROSS_MOD_NAMESPACE_FORBIDDEN',
        message: `Mod "${modId}" cannot register object "${trimmed}" under another mod's namespace "${parsed.modId}".`,
      };
    }
    if (coreProtectedIds.has(parsed.fullId)) {
      return {
        ok: false,
        code: 'CORE_OVERRIDE_FORBIDDEN',
        message: `Identifier "${parsed.fullId}" conflicts with protected core content.`,
      };
    }
    return {
      ok: true,
      fullId: parsed.fullId,
      modId: parsed.modId,
      objectId: parsed.objectId,
      wasAutoNamespaced: false,
    };
  }

  if (!MOD_ID_SEGMENT_PATTERN.test(trimmed)) {
    return {
      ok: false,
      code: 'INVALID_OBJECT_ID',
      message: `Invalid object ID "${trimmed}". Use alphanumeric characters, '.', '_', or '-'.`,
    };
  }

  if (coreProtectedIds.has(trimmed)) {
    return {
      ok: false,
      code: 'CORE_OVERRIDE_FORBIDDEN',
      message: `Mod "${modId}" cannot override core game ID "${trimmed}". Prefix with "${modId}:${trimmed}" or choose a new ID.`,
    };
  }

  return {
    ok: true,
    fullId: `${modId}:${trimmed}`,
    modId,
    objectId: trimmed,
    wasAutoNamespaced: true,
  };
}

/**
 * Resolves references inside recipes, quests, and loot tables (ingredients, NPC IDs, rewards, etc.).
 * - Known core IDs stay unqualified (`"wood"`, `"ranger-sword"`, `"village_elder"`).
 * - Explicit `"otherMod:item"` references stay qualified.
 * - Bare custom IDs (`"ruby_ore"`) qualify under the owning mod (`"mymod:ruby_ore"`).
 */
export function resolveModCrossReference(
  modId: string,
  rawRef: string,
  coreProtectedIds: ReadonlySet<string> = CORE_PROTECTED_IDS,
): string {
  const trimmed = rawRef.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes(':')) {
    return trimmed;
  }
  if (coreProtectedIds.has(trimmed)) {
    return trimmed;
  }
  if (MOD_ID_SEGMENT_PATTERN.test(trimmed)) {
    return `${modId}:${trimmed}`;
  }
  return trimmed;
}

export interface RegisteredModEntry<T> {
  id: string;
  modId: string;
  contentType: ModContentType;
  data: T;
}

export type RegistryRegisterResult<T> =
  | { ok: true; entry: RegisteredModEntry<T> }
  | {
      ok: false;
      code:
        | 'INVALID_OBJECT_ID'
        | 'CORE_OVERRIDE_FORBIDDEN'
        | 'CROSS_MOD_NAMESPACE_FORBIDDEN'
        | 'DUPLICATE_OBJECT_ID';
      message: string;
    };

/**
 * Strongly typed namespaced registry for a single mod content type.
 * Enforces `"modId:objectId"` identifiers, collision blocking, and core-content protection.
 */
export class NamespacedContentRegistry<T> {
  public readonly contentType: ModContentType;
  private readonly entries = new Map<string, RegisteredModEntry<T>>();
  private readonly modIndex = new Map<string, Set<string>>();
  private readonly coreProtectedIds: ReadonlySet<string>;

  constructor(
    contentType: ModContentType,
    coreProtectedIds: ReadonlySet<string> = CORE_PROTECTED_IDS,
  ) {
    this.contentType = contentType;
    this.coreProtectedIds = coreProtectedIds;
  }

  public register(
    modId: string,
    rawObjectId: string,
    data: T,
  ): RegistryRegisterResult<T> {
    const resolved = resolveModObjectIdentifier(
      modId,
      rawObjectId,
      this.coreProtectedIds,
    );
    if (!resolved.ok) {
      return resolved;
    }

    const existing = this.entries.get(resolved.fullId);
    if (existing) {
      return {
        ok: false,
        code: 'DUPLICATE_OBJECT_ID',
        message: `Duplicate ${this.contentType} ID "${resolved.fullId}" (already registered by "${existing.modId}").`,
      };
    }

    const entry: RegisteredModEntry<T> = {
      id: resolved.fullId,
      modId,
      contentType: this.contentType,
      data,
    };
    this.entries.set(resolved.fullId, entry);

    let set = this.modIndex.get(modId);
    if (!set) {
      set = new Set<string>();
      this.modIndex.set(modId, set);
    }
    set.add(resolved.fullId);

    return { ok: true, entry };
  }

  public get(id: string): T | undefined {
    return this.entries.get(id)?.data;
  }

  public getEntry(id: string): RegisteredModEntry<T> | undefined {
    return this.entries.get(id);
  }

  public has(id: string): boolean {
    return this.entries.has(id);
  }

  public getAll(): T[] {
    const out: T[] = [];
    for (const entry of this.entries.values()) {
      out.push(entry.data);
    }
    return out;
  }

  public getAllEntries(): RegisteredModEntry<T>[] {
    return Array.from(this.entries.values());
  }

  public getByMod(modId: string): RegisteredModEntry<T>[] {
    const ids = this.modIndex.get(modId);
    if (!ids) return [];
    const out: RegisteredModEntry<T>[] = [];
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (entry) out.push(entry);
    }
    return out;
  }

  public size(): number {
    return this.entries.size;
  }

  public unloadMod(modId: string): void {
    const ids = this.modIndex.get(modId);
    if (!ids) return;
    for (const id of ids) {
      this.entries.delete(id);
    }
    this.modIndex.delete(modId);
  }

  public clear(): void {
    this.entries.clear();
    this.modIndex.clear();
  }
}
