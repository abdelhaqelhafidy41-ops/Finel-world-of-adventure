import type { ModAssetReadResult } from '../../utils/platformExit';
import type { ModAssetIndexEntry } from './modTypes';
import { FORBIDDEN_MOD_PACKAGE_EXTENSIONS } from './WoamodPackageValidator';

export interface NormalizedAssetPathResult {
  ok: true;
  modId: string;
  relativePath: string;
  canonicalRef: string;
}

export interface InvalidAssetPathResult {
  ok: false;
  code:
    | 'INVALID_ASSET_PATH'
    | 'UNSAFE_ASSET_URI'
    | 'UNSAFE_ASSET_PATH'
    | 'CROSS_MOD_ASSET_FORBIDDEN'
    | 'FORBIDDEN_ASSET_EXTENSION';
  message: string;
}

export type ModAssetPathNormalization =
  | NormalizedAssetPathResult
  | InvalidAssetPathResult;

const BLOCKED_EXTERNAL_URI_PREFIXES = [
  'http:',
  'https:',
  'data:',
  'blob:',
  'file:',
  'javascript:',
  'vbscript:',
];

function getExtLower(relPath: string): string {
  const dot = relPath.lastIndexOf('.');
  return dot >= 0 ? relPath.slice(dot).toLowerCase() : '';
}

function sanitizeRelativeSegments(rawPath: string): string | null {
  if (!rawPath || typeof rawPath !== 'string') return null;
  if (rawPath.includes('\0') || /^[a-z]:/i.test(rawPath)) return null;
  const normalizedSlashes = rawPath.replace(/\\/g, '/').trim();
  if (!normalizedSlashes || normalizedSlashes.startsWith('/')) {
    return null;
  }

  const rawParts = normalizedSlashes.split('/');
  const cleanParts: string[] = [];
  for (const part of rawParts) {
    if (!part || part === '.') continue;
    if (part === '..') return null;
    cleanParts.push(part);
  }
  if (cleanParts.length === 0) return null;
  return cleanParts.join('/');
}

/**
 * Normalizes a mod's internal asset path into a stable canonical reference `modId://relative/path`.
 * Accepts `"textures/foo.png"`, `"./textures/foo.png"`, `"mod://textures/foo.png"`,
 * or `"modId://textures/foo.png"`.
 */
export function normalizeModAssetPath(
  modId: string,
  rawPath: string,
): ModAssetPathNormalization {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return {
      ok: false,
      code: 'INVALID_ASSET_PATH',
      message: 'Asset path must be a non-empty string.',
    };
  }

  const trimmed = rawPath.trim();
  const lower = trimmed.toLowerCase();

  for (const blocked of BLOCKED_EXTERNAL_URI_PREFIXES) {
    if (lower.startsWith(blocked)) {
      return {
        ok: false,
        code: 'UNSAFE_ASSET_URI',
        message: `External or dynamic URI "${trimmed}" is not allowed in mod assets.`,
      };
    }
  }

  let relInput = trimmed;
  const schemeSep = trimmed.indexOf('://');
  if (schemeSep >= 0) {
    const schemeMod = trimmed.slice(0, schemeSep).trim();
    relInput = trimmed.slice(schemeSep + 3);
    if (schemeMod.toLowerCase() !== 'mod' && schemeMod !== modId) {
      return {
        ok: false,
        code: 'CROSS_MOD_ASSET_FORBIDDEN',
        message: `Mod "${modId}" cannot reference asset path belonging to "${schemeMod}" ("${trimmed}").`,
      };
    }
  }

  const relativePath = sanitizeRelativeSegments(relInput);
  if (!relativePath) {
    return {
      ok: false,
      code: 'UNSAFE_ASSET_PATH',
      message: `Unsafe or invalid mod asset path "${trimmed}" (path traversal and absolute paths are forbidden).`,
    };
  }

  const ext = getExtLower(relativePath);
  if (ext && FORBIDDEN_MOD_PACKAGE_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      code: 'FORBIDDEN_ASSET_EXTENSION',
      message: `Executable or script asset extension "${ext}" is blocked ("${relativePath}").`,
    };
  }

  return {
    ok: true,
    modId,
    relativePath,
    canonicalRef: `${modId}://${relativePath}`,
  };
}

export function parseCanonicalAssetRef(
  canonicalRef: string,
): { modId: string; relativePath: string } | null {
  if (typeof canonicalRef !== 'string') return null;
  const sep = canonicalRef.indexOf('://');
  if (sep <= 0) return null;
  const modId = canonicalRef.slice(0, sep).trim();
  const rel = sanitizeRelativeSegments(canonicalRef.slice(sep + 3));
  if (!modId || !rel) return null;
  return { modId, relativePath: rel };
}

export type ModAssetByteReader = (
  sourceId: string,
  relativePath: string,
) => Promise<ModAssetReadResult>;

/**
 * Indexes validated mod assets by canonical `modId://relative/path` references
 * and resolves safe `data:` URLs for textures/sounds/music/UI icons without direct FS leaks.
 */
export class ModAssetResolver {
  private readonly assetEntriesByRef = new Map<string, ModAssetIndexEntry>();
  private readonly refsByModId = new Map<string, Set<string>>();
  private readonly sourceIdByModId = new Map<string, string>();
  private readonly dataUrlCache = new Map<string, string>();
  private reader: ModAssetByteReader | null;

  constructor(reader: ModAssetByteReader | null = null) {
    this.reader = reader;
  }

  public setReader(reader: ModAssetByteReader | null): void {
    this.reader = reader;
  }

  public setModAssets(
    modId: string,
    sourceId: string,
    assets: ModAssetIndexEntry[],
  ): void {
    this.removeModAssets(modId);
    this.sourceIdByModId.set(modId, sourceId);

    const refs = new Set<string>();
    for (const asset of assets) {
      const normalized = normalizeModAssetPath(modId, asset.relativePath);
      if (!normalized.ok) continue;
      this.assetEntriesByRef.set(normalized.canonicalRef, {
        ...asset,
        modId,
        sourceId,
        relativePath: normalized.relativePath,
      });
      refs.add(normalized.canonicalRef);
    }
    this.refsByModId.set(modId, refs);
  }

  public removeModAssets(modId: string): void {
    const refs = this.refsByModId.get(modId);
    if (refs) {
      for (const ref of refs) {
        this.assetEntriesByRef.delete(ref);
        this.dataUrlCache.delete(ref);
      }
      this.refsByModId.delete(modId);
    }
    this.sourceIdByModId.delete(modId);
  }

  public clear(): void {
    this.assetEntriesByRef.clear();
    this.refsByModId.clear();
    this.sourceIdByModId.clear();
    this.dataUrlCache.clear();
  }

  public hasAsset(canonicalOrModId: string, relativePath?: string): boolean {
    if (relativePath !== undefined) {
      const normalized = normalizeModAssetPath(canonicalOrModId, relativePath);
      if (!normalized.ok) return false;
      return this.assetEntriesByRef.has(normalized.canonicalRef);
    }
    return this.assetEntriesByRef.has(canonicalOrModId);
  }

  public findEntry(canonicalRef: string): ModAssetIndexEntry | undefined {
    return this.assetEntriesByRef.get(canonicalRef);
  }

  public findWoa3dMetadata(canonicalRef: string) {
    return this.assetEntriesByRef.get(canonicalRef)?.woa3dMetadata;
  }

  public getWoa3dAssets(modId?: string): ModAssetIndexEntry[] {
    const out: ModAssetIndexEntry[] = [];
    for (const entry of this.assetEntriesByRef.values()) {
      if (modId && entry.modId !== modId) continue;
      if (entry.relativePath.toLowerCase().endsWith('.woa3d') || entry.woa3dMetadata) {
        out.push(entry);
      }
    }
    return out;
  }

  public getModAssetRefs(modId: string): string[] {
    const refs = this.refsByModId.get(modId);
    return refs ? Array.from(refs) : [];
  }

  public async resolveDataUrl(canonicalRef: string): Promise<string | null> {
    const cached = this.dataUrlCache.get(canonicalRef);
    if (cached) return cached;

    const entry = this.assetEntriesByRef.get(canonicalRef);
    const parsed = parseCanonicalAssetRef(canonicalRef);
    if (!parsed || !this.reader) return null;

    const sourceId = entry?.sourceId ?? this.sourceIdByModId.get(parsed.modId);
    if (!sourceId) return null;

    const result = await this.reader(sourceId, parsed.relativePath);
    if (!result.ok || !result.base64) {
      return null;
    }

    const mimeType = result.mimeType || 'application/octet-stream';
    const dataUrl = `data:${mimeType};base64,${result.base64}`;
    this.dataUrlCache.set(canonicalRef, dataUrl);
    return dataUrl;
  }
}
