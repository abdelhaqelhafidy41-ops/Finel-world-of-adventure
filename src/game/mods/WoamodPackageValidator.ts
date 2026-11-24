import {
  CURRENT_GAME_VERSION,
  MOD_PACKAGE_EXTENSION,
  STANDARD_MOD_FOLDERS,
  type ModDependency,
  type ModInstallProgress,
  type ModManifest,
  type ModRecord,
} from './modTypes';
import {
  isValidSemverRangeSyntax,
  parseSemver,
  satisfiesSemverRange,
} from './modSemver';

export const MAX_WOAMOD_ARCHIVE_BYTES = 150 * 1024 * 1024;
export const MAX_WOAMOD_UNCOMPRESSED_TOTAL_BYTES = 300 * 1024 * 1024;
export const MAX_WOAMOD_ENTRY_BYTES = 32 * 1024 * 1024;
export const MAX_WOAMOD_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_WOAMOD_ENTRIES = 1200;

export const FORBIDDEN_MOD_PACKAGE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.wasm',
  '.node',
  '.exe',
  '.msi',
  '.com',
  '.scr',
  '.pif',
  '.lnk',
  '.dll',
  '.so',
  '.dylib',
  '.sys',
  '.drv',
  '.ocx',
  '.cpl',
  '.dex',
  '.jar',
  '.apk',
  '.aab',
  '.class',
  '.sh',
  '.bash',
  '.zsh',
  '.bat',
  '.cmd',
  '.ps1',
  '.vbs',
  '.vbe',
  '.wsf',
  '.wsh',
  '.php',
  '.py',
  '.rb',
  '.pl',
  '.lua',
  '.html',
  '.htm',
  '.svg',
]);

const MOD_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/i;
const STANDARD_FOLDER_SET = new Set<string>(STANDARD_MOD_FOLDERS);
const MOD_CONTENT_FOLDERS = new Set<string>([
  'items',
  'weapons',
  'characters',
  'creatures',
  'npcs',
  'buildings',
  'quests',
  'recipes',
  'localization',
]);

export interface WoamodZipEntryHeader {
  name: string;
  isDir: boolean;
  compressionMethod: number;
  generalPurposeFlags: number;
  compressedSize: number;
  uncompressedSize: number;
  externalAttributes: number;
  localHeaderOffset: number;
}

export interface WoamodExtractedAssetPreview {
  category: string;
  relativePath: string;
  sizeBytes: number;
}

export interface WoamodValidationResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  detail?: string;
  manifest?: ModManifest;
  installFolderName?: string;
  entryCount?: number;
  totalUncompressedBytes?: number;
  presentFolders?: string[];
  assetPreviews?: WoamodExtractedAssetPreview[];
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function sanitizeZipEntryRelativePath(rawName: string): string | null {
  if (typeof rawName !== 'string' || rawName.length === 0) return null;
  if (rawName.includes('\0')) return null;

  const unixified = rawName.replace(/\\/g, '/');
  if (unixified.startsWith('/') || /^[A-Za-z]:/.test(unixified)) {
    return null;
  }

  const trimmedTrailing = unixified.replace(/\/+$/, '');
  if (!trimmedTrailing) return '';

  const segments = trimmedTrailing.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') {
      return null;
    }
  }
  return segments.join('/');
}

export function buildInstallFolderName(modId: string): string {
  const clean = modId.trim().replace(/[^A-Za-z0-9._-]/g, '_');
  if (!clean || clean === '.' || clean === '..') {
    return `woamod_${Date.now()}`;
  }
  return clean.slice(0, 96);
}

export async function readFileChunksWithProgress(
  file: File,
  onProgress?: (progress: ModInstallProgress) => void,
): Promise<Uint8Array> {
  const totalBytes = Math.max(0, file.size);
  if (totalBytes > MAX_WOAMOD_ARCHIVE_BYTES) {
    throw new Error('INVALID_PACKAGE_SIZE');
  }
  if (totalBytes < 22) {
    throw new Error('INVALID_PACKAGE_SIZE');
  }

  const out = new Uint8Array(totalBytes);
  const chunkSize = 512 * 1024;
  let offset = 0;

  while (offset < totalBytes) {
    const end = Math.min(totalBytes, offset + chunkSize);
    const slice = file.slice(offset, end);
    const ab = await slice.arrayBuffer();
    const chunk = new Uint8Array(ab);
    out.set(chunk, offset);
    offset = end;

    if (onProgress) {
      const ratio = totalBytes > 0 ? offset / totalBytes : 1;
      onProgress({
        active: true,
        fileName: file.name,
        stage: 'reading',
        percent: Math.min(34, Math.max(2, Math.round(ratio * 34))),
        processedBytes: offset,
        totalBytes,
      });
    }
  }

  return out;
}

export function parseWoamodZipDirectory(bytes: Uint8Array): {
  entries: WoamodZipEntryHeader[];
  totalUncompressedBytes: number;
} {
  if (bytes.length < 22 || bytes.length > MAX_WOAMOD_ARCHIVE_BYTES) {
    throw new Error('INVALID_PACKAGE_SIZE');
  }
  if (
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  ) {
    throw new Error('INVALID_ZIP_SIGNATURE');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  const minOffset = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('CORRUPT_ZIP_EOCD');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  if (totalEntries === 0 || totalEntries > MAX_WOAMOD_ENTRIES) {
    throw new Error(totalEntries === 0 ? 'CORRUPT_MOD_ARCHIVE' : 'MOD_TOO_MANY_FILES');
  }
  if (cdOffset + cdSize > eocdOffset) {
    throw new Error('CORRUPT_ZIP_CENTRAL_DIR');
  }

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const entries: WoamodZipEntryHeader[] = [];
  let totalUncompressedBytes = 0;
  let cursor = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error('CORRUPT_ZIP_CENTRAL_DIR');
    }

    const generalPurposeFlags = view.getUint16(cursor + 8, true);
    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const externalAttributes = view.getUint32(cursor + 38, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    if (cursor + 46 + nameLen + extraLen + commentLen > bytes.length) {
      throw new Error('CORRUPT_ZIP_CENTRAL_DIR');
    }

    if ((generalPurposeFlags & 0x0001) !== 0) {
      throw new Error('ENCRYPTED_ZIP_UNSUPPORTED');
    }

    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new Error('UNSUPPORTED_ZIP_COMPRESSION');
    }

    // Detect POSIX symlink entries stored in upper 16 bits of external attributes
    const unixMode = (externalAttributes >>> 16) & 0o170000;
    if (unixMode === 0o120000) {
      throw new Error('PATH_TRAVERSAL_BLOCKED');
    }

    const rawName = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    const isDir = rawName.endsWith('/') || rawName.endsWith('\\');
    const cleanRel = sanitizeZipEntryRelativePath(rawName);
    if (cleanRel === null) {
      throw new Error('PATH_TRAVERSAL_BLOCKED');
    }

    if (uncompressedSize > MAX_WOAMOD_ENTRY_BYTES) {
      throw new Error('ZIP_ENTRY_TOO_LARGE');
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_WOAMOD_UNCOMPRESSED_TOTAL_BYTES) {
      throw new Error('ZIP_TOTAL_SIZE_EXCEEDED');
    }

    if (cleanRel.length > 0) {
      entries.push({
        name: cleanRel,
        isDir,
        compressionMethod,
        generalPurposeFlags,
        compressedSize,
        uncompressedSize,
        externalAttributes,
        localHeaderOffset,
      });
    }

    cursor += 46 + nameLen + extraLen + commentLen;
  }

  return { entries, totalUncompressedBytes };
}

export async function extractWoamodEntryBytes(
  bytes: Uint8Array,
  entry: WoamodZipEntryHeader,
  maxBytes = MAX_WOAMOD_ENTRY_BYTES,
): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localHeaderOffset;
  if (offset + 30 > bytes.length || view.getUint32(offset, true) !== 0x04034b50) {
    throw new Error('CORRUPT_ZIP_LOCAL_HEADER');
  }
  const nameLen = view.getUint16(offset + 26, true);
  const extraLen = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.length) {
    throw new Error('CORRUPT_ZIP_BOUNDS');
  }
  const slice = bytes.subarray(dataStart, dataEnd);

  if (entry.compressionMethod === 0) {
    if (slice.length > maxBytes) {
      throw new Error('ZIP_ENTRY_TOO_LARGE');
    }
    return slice;
  }

  if (entry.compressionMethod === 8 && typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([slice.slice()])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error('ZIP_ENTRY_TOO_LARGE');
        }
        chunks.push(value);
      }
    }

    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.byteLength;
    }
    return out;
  }

  throw new Error('UNSUPPORTED_ZIP_COMPRESSION');
}

function normalizeManifestFromObject(
  parsed: Record<string, unknown>,
  fileName: string,
): { manifest?: ModManifest; error?: string; detail?: string } {
  const modId = typeof parsed.modId === 'string' ? parsed.modId.trim() : '';
  const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
  const version = typeof parsed.version === 'string' ? parsed.version.trim() : '';
  const author = typeof parsed.author === 'string' ? parsed.author.trim() : '';
  const description =
    typeof parsed.description === 'string' ? parsed.description.trim() : '';
  const supportedGameVersion =
    typeof parsed.supportedGameVersion === 'string'
      ? parsed.supportedGameVersion.trim()
      : '';

  const missing: string[] = [];
  if (!modId || !MOD_ID_PATTERN.test(modId)) missing.push('modId');
  if (!name) missing.push('name');
  if (!version || !parseSemver(version)) missing.push('version');
  if (!author) missing.push('author');
  if (!supportedGameVersion || !isValidSemverRangeSyntax(supportedGameVersion)) {
    missing.push('supportedGameVersion');
  }

  if (missing.length > 0) {
    return {
      error: 'REQUIRED_FILES_MISSING',
      detail: `mod.json in "${fileName}" is missing or has invalid required field(s): ${missing.join(', ')}`,
    };
  }

  const normalizeStrings = (val: unknown): string[] => {
    if (!Array.isArray(val)) return [];
    const out: string[] = [];
    for (const item of val) {
      if (typeof item === 'string' && item.trim()) out.push(item.trim());
    }
    return out;
  };

  const modTypes = normalizeStrings(parsed.modTypes);
  const categories = normalizeStrings(parsed.categories);
  const dependencies: ModDependency[] = [];

  if (Array.isArray(parsed.dependencies)) {
    for (const dep of parsed.dependencies) {
      if (typeof dep === 'string') {
        const depId = dep.trim();
        if (!depId || !MOD_ID_PATTERN.test(depId)) {
          return {
            error: 'INVALID_DEPENDENCY_DECLARATION',
            detail: `Invalid dependency "${dep}" declared in mod.json.`,
          };
        }
        dependencies.push({ modId: depId });
      } else if (isPlainRecord(dep)) {
        const depId =
          typeof dep.modId === 'string'
            ? dep.modId.trim()
            : typeof dep.id === 'string'
              ? dep.id.trim()
              : '';
        if (!depId || !MOD_ID_PATTERN.test(depId)) {
          return {
            error: 'INVALID_DEPENDENCY_DECLARATION',
            detail: 'Invalid or missing dependency "modId" in mod.json.',
          };
        }
        const versionRange =
          typeof dep.versionRange === 'string'
            ? dep.versionRange.trim()
            : typeof dep.version === 'string'
              ? dep.version.trim()
              : undefined;
        if (versionRange && !isValidSemverRangeSyntax(versionRange)) {
          return {
            error: 'INVALID_DEPENDENCY_DECLARATION',
            detail: `Invalid dependency semver range "${versionRange}" for "${depId}".`,
          };
        }
        dependencies.push({
          modId: depId,
          versionRange,
          optional: dep.optional === true,
        });
      } else {
        return {
          error: 'INVALID_DEPENDENCY_DECLARATION',
          detail: 'Each entry in "dependencies" must be a modId string or dependency object.',
        };
      }
    }
  } else if (isPlainRecord(parsed.dependencies)) {
    for (const [depId, range] of Object.entries(parsed.dependencies)) {
      if (!MOD_ID_PATTERN.test(depId.trim())) {
        return {
          error: 'INVALID_DEPENDENCY_DECLARATION',
          detail: `Invalid dependency modId "${depId}".`,
        };
      }
      const versionRange =
        typeof range === 'string' && range.trim() ? range.trim() : undefined;
      if (versionRange && !isValidSemverRangeSyntax(versionRange)) {
        return {
          error: 'INVALID_DEPENDENCY_DECLARATION',
          detail: `Invalid dependency semver range "${versionRange}" for "${depId}".`,
        };
      }
      dependencies.push({ modId: depId.trim(), versionRange });
    }
  }

  return {
    manifest: {
      modId,
      name,
      version,
      author,
      description,
      supportedGameVersion,
      modTypes: modTypes.length > 0 ? modTypes : categories,
      categories: categories.length > 0 ? categories : modTypes,
      dependencies,
      loadPriority:
        typeof parsed.loadPriority === 'number' && Number.isFinite(parsed.loadPriority)
          ? Math.trunc(parsed.loadPriority)
          : 0,
      icon: typeof parsed.icon === 'string' ? parsed.icon.trim() : undefined,
    },
  };
}

export async function validateWoamodArchiveBytes(
  bytes: Uint8Array,
  fileName: string,
  options: {
    gameVersion?: string;
    existingMods?: ModRecord[];
    onProgress?: (progress: ModInstallProgress) => void;
  } = {},
): Promise<WoamodValidationResult> {
  const gameVersion = options.gameVersion ?? CURRENT_GAME_VERSION;
  const existingMods = options.existingMods ?? [];

  const emitProgress = (
    percent: number,
    stage: ModInstallProgress['stage'],
    currentEntry?: string,
  ) => {
    options.onProgress?.({
      active: stage !== 'completed' && stage !== 'failed',
      fileName,
      stage,
      percent,
      processedBytes: bytes.length,
      totalBytes: bytes.length,
      currentEntry,
    });
  };

  if (!fileName.trim().toLowerCase().endsWith(MOD_PACKAGE_EXTENSION)) {
    return {
      ok: false,
      errorCode: 'INVALID_MOD_PACKAGE_EXTENSION',
      message: `Only official "${MOD_PACKAGE_EXTENSION}" mod packages can be imported.`,
    };
  }

  emitProgress(38, 'validating');

  let parsedDir: { entries: WoamodZipEntryHeader[]; totalUncompressedBytes: number };
  try {
    parsedDir = parseWoamodZipDirectory(bytes);
  } catch (err) {
    const code = err instanceof Error ? err.message : 'CORRUPT_MOD_ARCHIVE';
    return {
      ok: false,
      errorCode: code,
      message:
        code === 'PATH_TRAVERSAL_BLOCKED'
          ? 'Unsafe path traversal or symbolic link detected inside mod package.'
          : 'The .woamod package is corrupted or uses an unsupported archive structure.',
    };
  }

  const { entries, totalUncompressedBytes } = parsedDir;

  // Detect optional single top-level wrapper folder when mod.json is nested 1 level down
  let stripPrefix = '';
  if (!entries.some((e) => !e.isDir && e.name === 'mod.json')) {
    const roots = new Set(entries.map((e) => e.name.split('/')[0]).filter(Boolean));
    if (roots.size === 1) {
      const singleRoot = Array.from(roots)[0];
      if (entries.some((e) => !e.isDir && e.name === `${singleRoot}/mod.json`)) {
        stripPrefix = `${singleRoot}/`;
      }
    }
  }

  const folderSet = new Set<string>();
  const assetPreviews: WoamodExtractedAssetPreview[] = [];
  const forbiddenFiles: string[] = [];
  let manifestEntry: WoamodZipEntryHeader | null = null;
  const contentJsonEntries: Array<{
    rel: string;
    category: string;
    entry: WoamodZipEntryHeader;
  }> = [];

  for (const entry of entries) {
    let rel = entry.name;
    if (stripPrefix) {
      if (rel.startsWith(stripPrefix)) {
        rel = rel.slice(stripPrefix.length);
      } else if (rel === stripPrefix.slice(0, -1)) {
        continue;
      }
    }
    if (!rel) continue;

    // Prevent spoofing package provenance marker
    if (rel === '.woamod-package.json' || rel.endsWith('/.woamod-package.json')) {
      return {
        ok: false,
        errorCode: 'PATH_TRAVERSAL_BLOCKED',
        message: 'Archive contains reserved metadata filename.',
        detail: rel,
      };
    }

    const parts = rel.split('/');
    const topFolder = parts[0].toLowerCase();
    if (STANDARD_FOLDER_SET.has(topFolder) && (entry.isDir || parts.length > 1)) {
      folderSet.add(topFolder);
    }
    if (topFolder === 'assets' && parts.length > 1) {
      const second = parts[1].toLowerCase();
      if (STANDARD_FOLDER_SET.has(second)) {
        folderSet.add(second);
      }
    }

    if (entry.isDir) continue;

    const ext = getExtension(rel);
    if (FORBIDDEN_MOD_PACKAGE_EXTENSIONS.has(ext)) {
      forbiddenFiles.push(rel);
      continue;
    }

    if (rel === 'mod.json') {
      manifestEntry = entry;
      continue;
    }

    if (MOD_CONTENT_FOLDERS.has(topFolder) && ext === '.json') {
      contentJsonEntries.push({ rel, category: topFolder, entry });
    } else {
      const second = topFolder === 'assets' && parts[1] ? parts[1].toLowerCase() : null;
      const category = second && STANDARD_FOLDER_SET.has(second) ? second : topFolder;
      assetPreviews.push({
        category,
        relativePath: rel,
        sizeBytes: entry.uncompressedSize,
      });
    }
  }

  if (forbiddenFiles.length > 0) {
    return {
      ok: false,
      errorCode: 'UNSAFE_EXECUTABLE_CONTENT',
      message: `Blocked executable scripts or native libraries in "${fileName}".`,
      detail: forbiddenFiles.slice(0, 5).join(', '),
    };
  }

  if (!manifestEntry) {
    return {
      ok: false,
      errorCode: 'REQUIRED_FILES_MISSING',
      message: 'Required "mod.json" manifest file is missing inside this .woamod package.',
    };
  }

  emitProgress(46, 'validating', 'mod.json');

  let manifestObj: Record<string, unknown>;
  try {
    const rawManifestBytes = await extractWoamodEntryBytes(
      bytes,
      manifestEntry,
      MAX_WOAMOD_JSON_BYTES,
    );
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(rawManifestBytes);
    const parsed = JSON.parse(decoded);
    if (!isPlainRecord(parsed)) {
      return {
        ok: false,
        errorCode: 'INVALID_MOD_JSON_ROOT',
        message: 'mod.json root must be a valid JSON object.',
      };
    }
    manifestObj = parsed;
  } catch (err) {
    const code = err instanceof Error ? err.message : 'CORRUPT_MOD_ARCHIVE';
    return {
      ok: false,
      errorCode: code === 'ZIP_ENTRY_TOO_LARGE' ? code : 'CORRUPT_MOD_ARCHIVE',
      message: 'Failed to read or parse mod.json from the .woamod archive.',
    };
  }

  const normalized = normalizeManifestFromObject(manifestObj, fileName);
  if (!normalized.manifest) {
    return {
      ok: false,
      errorCode: normalized.error ?? 'REQUIRED_FILES_MISSING',
      message: normalized.detail ?? 'mod.json is missing required fields.',
      detail: normalized.detail,
    };
  }
  const manifest = normalized.manifest;

  if (folderSet.size === 0) {
    return {
      ok: false,
      errorCode: 'REQUIRED_FILES_MISSING',
      message:
        'Package must include at least one standard mod folder (items/, weapons/, textures/, models/, quests/, etc.).',
    };
  }

  // Validate supported game version
  if (!satisfiesSemverRange(gameVersion, manifest.supportedGameVersion)) {
    return {
      ok: false,
      errorCode: 'UNSUPPORTED_GAME_VERSION',
      message: `Requires game version ${manifest.supportedGameVersion} (current version is ${gameVersion}).`,
      detail: `modId=${manifest.modId}`,
      manifest,
    };
  }

  // Detect duplicate Mod ID against already installed mods
  const duplicate = existingMods.find(
    (m) => m.hasValidManifest && m.manifest.modId === manifest.modId,
  );
  if (duplicate) {
    return {
      ok: false,
      errorCode: 'DUPLICATE_MOD_ID',
      message: `Duplicate Mod ID "${manifest.modId}" is already installed ("${duplicate.sourceId}").`,
      detail: `Remove "${duplicate.sourceId}" before installing this package.`,
      manifest,
    };
  }

  // Validate required dependencies against currently installed mods
  for (const dep of manifest.dependencies) {
    if (dep.modId === manifest.modId) {
      return {
        ok: false,
        errorCode: 'SELF_DEPENDENCY',
        message: `Mod "${manifest.modId}" cannot depend on itself.`,
        manifest,
      };
    }
    const target = existingMods.find(
      (m) => m.hasValidManifest && m.manifest.modId === dep.modId,
    );
    if (!target) {
      if (!dep.optional) {
        return {
          ok: false,
          errorCode: 'MISSING_DEPENDENCY',
          message: `Missing required dependency "${dep.modId}"${dep.versionRange ? ` (${dep.versionRange})` : ''}.`,
          detail: 'Install the required dependency mod first.',
          manifest,
        };
      }
      continue;
    }

    if (
      dep.versionRange &&
      !satisfiesSemverRange(target.manifest.version, dep.versionRange)
    ) {
      if (!dep.optional) {
        return {
          ok: false,
          errorCode: 'DEPENDENCY_VERSION_MISMATCH',
          message: `Dependency "${dep.modId}" is v${target.manifest.version}, requires ${dep.versionRange}.`,
          manifest,
        };
      }
    }

    if (
      !dep.optional &&
      (target.status === 'corrupted' ||
        target.status === 'unsafe' ||
        target.status === 'incompatible' ||
        target.status === 'incomplete')
    ) {
      return {
        ok: false,
        errorCode: 'DEPENDENCY_NOT_ACTIVE',
        message: `Required dependency "${dep.modId}" has error status "${target.status}".`,
        manifest,
      };
    }
  }

  // Validate all content JSON files inside the package so corrupt JSON never installs
  for (let i = 0; i < contentJsonEntries.length; i++) {
    const item = contentJsonEntries[i];
    if (contentJsonEntries.length > 0) {
      const pct = 46 + Math.round(((i + 1) / contentJsonEntries.length) * 12);
      emitProgress(Math.min(58, pct), 'validating', item.rel);
    }
    try {
      const contentBytes = await extractWoamodEntryBytes(
        bytes,
        item.entry,
        MAX_WOAMOD_JSON_BYTES,
      );
      const text = new TextDecoder('utf-8', { fatal: true }).decode(contentBytes);
      JSON.parse(text);
    } catch {
      return {
        ok: false,
        errorCode: 'CORRUPT_CONTENT_JSON',
        message: `Corrupted or unreadable JSON file "${item.rel}" inside .woamod package.`,
        detail: item.rel,
        manifest,
      };
    }
  }

  const presentFolders = STANDARD_MOD_FOLDERS.filter((f) => folderSet.has(f));
  return {
    ok: true,
    manifest,
    installFolderName: buildInstallFolderName(manifest.modId),
    entryCount: entries.filter((e) => !e.isDir).length,
    totalUncompressedBytes,
    presentFolders,
    assetPreviews,
  };
}
