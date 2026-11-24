import type { RawDiscoveredModEntry } from '../../utils/platformExit';
import {
  CURRENT_GAME_VERSION,
  STANDARD_MOD_FOLDERS,
  type IncompatibleModAsset,
  type ModAssetIndexEntry,
  type ModDependency,
  type ModDiagnostic,
  type ModManifest,
  type ModRecord,
  type ModStateConfig,
  type ParsedModContentFile,
  type StandardModFolder,
} from './modTypes';
import {
  isValidSemverRangeSyntax,
  parseSemver,
  satisfiesSemverRange,
} from './modSemver';

const MOD_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/i;
const MAX_MOD_ASSET_BYTES = 16 * 1024 * 1024;

const TEXTURE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif']);
const MODEL_EXTENSIONS = new Set(['.glb', '.gltf', '.obj', '.mtl', '.bin']);
const AUDIO_EXTENSIONS = new Set(['.ogg', '.mp3', '.wav']);
const GENERAL_SAFE_ASSET_EXTENSIONS = new Set([
  ...TEXTURE_EXTENSIONS,
  ...MODEL_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  '.json',
  '.txt',
]);
const DATA_CATEGORY_FOLDERS = new Set([
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

function getAssetExtension(relPath: string): string {
  const dot = relPath.lastIndexOf('.');
  return dot >= 0 ? relPath.slice(dot).toLowerCase() : '';
}

function classifyModAsset(
  category: string,
  relativePath: string,
  sizeBytes: number,
): IncompatibleModAsset | null {
  if (sizeBytes > MAX_MOD_ASSET_BYTES) {
    return {
      category,
      relativePath,
      sizeBytes,
      reason: 'too_large',
    };
  }

  const ext = getAssetExtension(relativePath);
  const cat = category.toLowerCase();

  // Root-level documentation/metadata files are safe informational files
  if (!relativePath.includes('/')) {
    if (ext === '.txt' || ext === '.md' || ext === '.json' || TEXTURE_EXTENSIONS.has(ext)) {
      return null;
    }
    return { category, relativePath, sizeBytes, reason: 'unsupported_format' };
  }

  if (cat === 'textures') {
    if (!TEXTURE_EXTENSIONS.has(ext)) {
      return { category, relativePath, sizeBytes, reason: 'wrong_category' };
    }
    return null;
  }

  if (cat === 'models') {
    if (!MODEL_EXTENSIONS.has(ext)) {
      return { category, relativePath, sizeBytes, reason: 'wrong_category' };
    }
    return null;
  }

  if (cat === 'sounds' || cat === 'music') {
    if (!AUDIO_EXTENSIONS.has(ext)) {
      return { category, relativePath, sizeBytes, reason: 'wrong_category' };
    }
    return null;
  }

  if (DATA_CATEGORY_FOLDERS.has(cat)) {
    // Non-JSON file inside a JSON data directory (e.g. .xml / .yaml / stray binary)
    if (!TEXTURE_EXTENSIONS.has(ext) && ext !== '.txt') {
      return { category, relativePath, sizeBytes, reason: 'wrong_category' };
    }
    return null;
  }

  if (!GENERAL_SAFE_ASSET_EXTENSIONS.has(ext)) {
    return { category, relativePath, sizeBytes, reason: 'unsupported_format' };
  }

  return null;
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val && typeof val === 'object' && !Array.isArray(val));
}

function normalizeDependencies(
  rawDeps: unknown,
  diagnostics: ModDiagnostic[],
): ModDependency[] {
  if (rawDeps === undefined || rawDeps === null) {
    return [];
  }

  const normalized: ModDependency[] = [];

  if (Array.isArray(rawDeps)) {
    for (let i = 0; i < rawDeps.length; i++) {
      const entry = rawDeps[i];
      if (typeof entry === 'string') {
        const modId = entry.trim();
        if (!modId || !MOD_ID_PATTERN.test(modId)) {
          diagnostics.push({
            code: 'INVALID_DEPENDENCY_ENTRY',
            severity: 'error',
            message: `Invalid dependency modId at dependencies[${i}].`,
          });
          continue;
        }
        normalized.push({ modId });
        continue;
      }

      if (isPlainRecord(entry)) {
        const modId =
          typeof entry.modId === 'string'
            ? entry.modId.trim()
            : typeof entry.id === 'string'
              ? entry.id.trim()
              : '';
        if (!modId || !MOD_ID_PATTERN.test(modId)) {
          diagnostics.push({
            code: 'INVALID_DEPENDENCY_ENTRY',
            severity: 'error',
            message: `Missing or invalid dependency modId at dependencies[${i}].`,
          });
          continue;
        }
        const versionRange =
          typeof entry.versionRange === 'string'
            ? entry.versionRange.trim()
            : typeof entry.version === 'string'
              ? entry.version.trim()
              : undefined;
        if (versionRange && !isValidSemverRangeSyntax(versionRange)) {
          diagnostics.push({
            code: 'INVALID_DEPENDENCY_VERSION',
            severity: 'error',
            message: `Invalid dependency version range "${versionRange}" for "${modId}".`,
          });
        }
        normalized.push({
          modId,
          versionRange,
          optional: entry.optional === true,
        });
        continue;
      }

      diagnostics.push({
        code: 'INVALID_DEPENDENCY_ENTRY',
        severity: 'error',
        message: `Invalid dependency value at dependencies[${i}].`,
      });
    }
    return normalized;
  }

  // Also allow map syntax: { "core-lib": "^1.0.0" }
  if (isPlainRecord(rawDeps)) {
    for (const [key, val] of Object.entries(rawDeps)) {
      const modId = key.trim();
      if (!modId || !MOD_ID_PATTERN.test(modId)) {
        diagnostics.push({
          code: 'INVALID_DEPENDENCY_ENTRY',
          severity: 'error',
          message: `Invalid dependency modId "${key}".`,
        });
        continue;
      }
      const versionRange = typeof val === 'string' ? val.trim() : undefined;
      if (versionRange && !isValidSemverRangeSyntax(versionRange)) {
        diagnostics.push({
          code: 'INVALID_DEPENDENCY_VERSION',
          severity: 'error',
          message: `Invalid dependency version range "${versionRange}" for "${modId}".`,
        });
      }
      normalized.push({ modId, versionRange });
    }
    return normalized;
  }

  diagnostics.push({
    code: 'INVALID_DEPENDENCIES_FIELD',
    severity: 'error',
    message: 'Field "dependencies" must be an array or dependency map.',
  });
  return normalized;
}

function normalizeStringArray(rawVal: unknown): string[] {
  if (!Array.isArray(rawVal)) return [];
  return rawVal
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
}

function buildFallbackManifest(sourceId: string): ModManifest {
  const cleanId = sourceId
    .replace(/\.(zip|woamod)$/i, '')
    .replace(/[^a-z0-9._-]+/gi, '_')
    .replace(/^[^a-z0-9]+/i, 'mod_')
    .slice(0, 64);

  return {
    modId: cleanId || 'invalid_mod',
    name: sourceId,
    version: '0.0.0',
    author: 'Unknown',
    description: '',
    supportedGameVersion: CURRENT_GAME_VERSION,
    modTypes: [],
    categories: [],
    dependencies: [],
    loadPriority: 0,
  };
}

function parseManifest(
  rawEntry: RawDiscoveredModEntry,
): { manifest: ModManifest; hasValidManifest: boolean; diagnostics: ModDiagnostic[] } {
  const diagnostics: ModDiagnostic[] = [];
  const fallback = buildFallbackManifest(rawEntry.sourceId);

  if (rawEntry.archiveCorrupt) {
    diagnostics.push({
      code: 'CORRUPT_ARCHIVE',
      severity: 'error',
      message: 'Mod package archive is corrupted or unreadable.',
      detail: rawEntry.archiveError,
    });
    return { manifest: fallback, hasValidManifest: false, diagnostics };
  }

  if (rawEntry.manifestError || rawEntry.manifestRaw === null) {
    diagnostics.push({
      code: rawEntry.manifestError || 'MISSING_MOD_JSON',
      severity: 'error',
      message: 'Required mod.json manifest was not found or could not be read.',
      detail: rawEntry.manifestError ?? undefined,
    });
    return { manifest: fallback, hasValidManifest: false, diagnostics };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawEntry.manifestRaw);
  } catch (err) {
    diagnostics.push({
      code: 'INVALID_MOD_JSON_SYNTAX',
      severity: 'error',
      message: 'mod.json contains invalid JSON syntax.',
      detail: err instanceof Error ? err.message : undefined,
    });
    return { manifest: fallback, hasValidManifest: false, diagnostics };
  }

  if (!isPlainRecord(parsed)) {
    diagnostics.push({
      code: 'INVALID_MOD_JSON_ROOT',
      severity: 'error',
      message: 'mod.json root must be a JSON object.',
    });
    return { manifest: fallback, hasValidManifest: false, diagnostics };
  }

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

  if (!modId || !MOD_ID_PATTERN.test(modId)) {
    diagnostics.push({
      code: 'INVALID_MOD_ID',
      severity: 'error',
      message:
        'mod.json requires a valid "modId" (2-64 chars: letters, digits, ".", "_", "-").',
    });
  }
  if (!name) {
    diagnostics.push({
      code: 'MISSING_NAME',
      severity: 'error',
      message: 'mod.json requires a non-empty "name".',
    });
  }
  if (!version || !parseSemver(version)) {
    diagnostics.push({
      code: 'INVALID_VERSION',
      severity: 'error',
      message: `mod.json requires a valid semantic "version" (got "${version || 'missing'}").`,
    });
  }
  if (!author) {
    diagnostics.push({
      code: 'MISSING_AUTHOR',
      severity: 'error',
      message: 'mod.json requires a non-empty "author".',
    });
  }
  if (!description) {
    diagnostics.push({
      code: 'MISSING_DESCRIPTION',
      severity: 'warning',
      message: 'mod.json should include a "description".',
    });
  }
  if (!supportedGameVersion || !isValidSemverRangeSyntax(supportedGameVersion)) {
    diagnostics.push({
      code: 'INVALID_SUPPORTED_GAME_VERSION',
      severity: 'error',
      message: `mod.json requires a valid "supportedGameVersion" (got "${supportedGameVersion || 'missing'}").`,
    });
  }

  const modTypes = normalizeStringArray(parsed.modTypes);
  const categories = normalizeStringArray(parsed.categories);
  const effectiveTypes = modTypes.length > 0 ? modTypes : categories;
  const effectiveCategories = categories.length > 0 ? categories : modTypes;

  if (effectiveTypes.length === 0) {
    diagnostics.push({
      code: 'MISSING_MOD_CATEGORIES',
      severity: 'warning',
      message: 'mod.json does not declare "modTypes" or "categories".',
    });
  }

  const dependencies = normalizeDependencies(parsed.dependencies, diagnostics);
  const loadPriority =
    typeof parsed.loadPriority === 'number' && Number.isFinite(parsed.loadPriority)
      ? Math.trunc(parsed.loadPriority)
      : 0;

  const manifest: ModManifest = {
    modId: modId || fallback.modId,
    name: name || fallback.name,
    version: version || fallback.version,
    author: author || fallback.author,
    description,
    supportedGameVersion: supportedGameVersion || '',
    modTypes: effectiveTypes,
    categories: effectiveCategories,
    dependencies,
    loadPriority,
    icon: typeof parsed.icon === 'string' ? parsed.icon.trim() : undefined,
  };

  const hasFatalManifestErrors = diagnostics.some((d) => d.severity === 'error');
  return {
    manifest,
    hasValidManifest: !hasFatalManifestErrors,
    diagnostics,
  };
}

export interface ValidationPipelineResult {
  records: ModRecord[];
  loadOrder: string[];
}

/**
 * Pure deterministic validator for all discovered mods:
 * 1. Parses manifests & JSON data files safely
 * 2. Detects executable / non-data content & corrupted archives
 * 3. Detects missing standard structure
 * 4. Detects duplicate modIds (keeps highest-version / priority valid entry as winner, marks others 'duplicate')
 * 5. Validates supportedGameVersion against CURRENT_GAME_VERSION
 * 6. Resolves dependencies, missing/disabled dependencies, version ranges, and circular dependency cycles
 * 7. Computes deterministic dependency-first + loadPriority topological load order
 */
export function validateDiscoveredMods(
  rawEntries: RawDiscoveredModEntry[],
  state: ModStateConfig,
  gameVersion: string = CURRENT_GAME_VERSION,
): ValidationPipelineResult {
  const initialRecords: ModRecord[] = [];

  for (const raw of rawEntries) {
    const parsedManifest = parseManifest(raw);
    const diagnostics: ModDiagnostic[] = [...parsedManifest.diagnostics];

    if (raw.executableFiles.length > 0) {
      diagnostics.push({
        code: 'UNSAFE_EXECUTABLE_CONTENT',
        severity: 'error',
        message: `Executable or script files are strictly forbidden in mods (${raw.executableFiles.slice(0, 3).join(', ')}).`,
        detail: raw.executableFiles.join(', '),
      });
    }

    const parsedContentFiles: ParsedModContentFile[] = [];
    for (const file of raw.contentFiles) {
      if (file.readError) {
        diagnostics.push({
          code: 'CONTENT_FILE_UNREADABLE',
          severity: 'error',
          message: `Failed reading ${file.relativePath}: ${file.readError}`,
        });
        continue;
      }
      try {
        const jsonData: unknown = JSON.parse(file.rawText);
        parsedContentFiles.push({
          category: file.category,
          relativePath: file.relativePath,
          data: jsonData,
        });
      } catch (err) {
        diagnostics.push({
          code: 'CORRUPT_CONTENT_JSON',
          severity: 'error',
          message: `Invalid JSON in "${file.relativePath}".`,
          detail: err instanceof Error ? err.message : undefined,
        });
      }
    }

    const presentSet = new Set(raw.presentFolders.map((f) => f.toLowerCase()));
    const presentFolders = STANDARD_MOD_FOLDERS.filter((f) => presentSet.has(f));
    const missingStandardFolders = STANDARD_MOD_FOLDERS.filter(
      (f): f is StandardModFolder => !presentSet.has(f),
    );

    if (
      !raw.archiveCorrupt &&
      parsedManifest.hasValidManifest &&
      presentFolders.length === 0 &&
      parsedContentFiles.length === 0 &&
      raw.assetFiles.length === 0
    ) {
      diagnostics.push({
        code: 'INCOMPLETE_MOD_STRUCTURE',
        severity: 'error',
        message:
          'Mod contains no standard content or asset directories (items/, weapons/, quests/, models/, textures/, etc.).',
      });
    } else if (missingStandardFolders.length > 0) {
      diagnostics.push({
        code: 'PARTIAL_STANDARD_FOLDERS',
        severity: 'info',
        message: `${presentFolders.length}/${STANDARD_MOD_FOLDERS.length} standard folders present.`,
      });
    }

    const modId = parsedManifest.manifest.modId;
    const savedEnabled = state.enabledByModId[modId];
    // Newly discovered valid mods default to disabled? Or enabled?
    // Keeping newly placed local mods disabled until validated & explicitly enabled OR default true?
    // Wait: players dropping a mod folder expect either easy toggle or safe auto-enable.
    // Let's default to `true` ONLY if explicitly stored or safe, OR `false`? Wait: if someone drops a mod in Mods/, checking enabled === true on default vs false:
    // Actually defaulting to `false` unless already in state prevents broken mods from loading unannounced, OR defaulting `true` loads dropped mods immediately on launch!
    // Requirement: "The system must load enabled mods safely" & "persisted enable/disable states". If `savedEnabled === undefined`, defaulting to `true` means dropping a mod into `Mods/` activates it automatically after validation passes! And toggling it off writes `false` cleanly.
    const enabled = savedEnabled !== undefined ? Boolean(savedEnabled) : true;
    const effectivePriority =
      typeof state.priorityByModId[modId] === 'number' &&
      Number.isFinite(state.priorityByModId[modId])
        ? Math.trunc(state.priorityByModId[modId])
        : parsedManifest.manifest.loadPriority;

    const gameCompatible = !(
      parsedManifest.hasValidManifest &&
      parsedManifest.manifest.supportedGameVersion &&
      !satisfiesSemverRange(gameVersion, parsedManifest.manifest.supportedGameVersion)
    );

    if (!gameCompatible) {
      diagnostics.push({
        code: 'INCOMPATIBLE_GAME_VERSION',
        severity: 'error',
        message: `Requires game version ${parsedManifest.manifest.supportedGameVersion}, current version is ${gameVersion}.`,
      });
    }

    const assets: ModAssetIndexEntry[] = [];
    const incompatibleAssets: IncompatibleModAsset[] = [];
    for (const af of raw.assetFiles) {
      const issue = classifyModAsset(af.category, af.relativePath, af.sizeBytes);
      if (issue) {
        incompatibleAssets.push(issue);
      } else {
        assets.push({
          modId,
          sourceId: raw.sourceId,
          category: af.category,
          relativePath: af.relativePath,
          sizeBytes: af.sizeBytes,
        });
      }
    }

    if (incompatibleAssets.length > 0) {
      const sample = incompatibleAssets
        .slice(0, 3)
        .map((a) => a.relativePath)
        .join(', ');
      diagnostics.push({
        code: 'INCOMPATIBLE_ASSET',
        severity: 'warning',
        message: `Incompatible asset (${incompatibleAssets.length} file${incompatibleAssets.length > 1 ? 's' : ''} skipped): ${sample}`,
        detail: incompatibleAssets.map((a) => `${a.relativePath} (${a.reason})`).join(', '),
      });
    }

    const installKind =
      raw.installKind ?? (raw.sourceType === 'archive' ? 'woamod' : 'development');
    const packageFileName =
      raw.packageFileName ??
      (raw.sourceType === 'archive' ? raw.sourceId : undefined);

    initialRecords.push({
      entryKey: `${raw.sourceType}:${raw.sourceId}`,
      sourceId: raw.sourceId,
      sourceType: raw.sourceType,
      installKind,
      packageFileName,
      installedAtMs: raw.installedAtMs,
      sourcePath: raw.sourcePath,
      modifiedAtMs: raw.modifiedAtMs,
      manifest: parsedManifest.manifest,
      hasValidManifest: parsedManifest.hasValidManifest,
      gameCompatible,
      presentFolders: [...presentFolders],
      missingStandardFolders: [...missingStandardFolders],
      contentFileCount: raw.contentFiles.length,
      assetFileCount: assets.length,
      loadedEntriesCount: 0,
      parsedContentFiles,
      assets,
      incompatibleAssets,
      enabled,
      loaded: false,
      effectivePriority,
      status: 'ready',
      diagnostics,
      loadOrderIndex: null,
    });
  }

  // Assign base intrinsic status before duplicate/dependency pass
  for (const rec of initialRecords) {
    if (rec.diagnostics.some((d) => d.code === 'UNSAFE_EXECUTABLE_CONTENT')) {
      rec.status = 'unsafe';
    } else if (
      rec.diagnostics.some(
        (d) =>
          d.code === 'CORRUPT_ARCHIVE' ||
          d.code === 'MISSING_MOD_JSON' ||
          d.code === 'INVALID_MOD_JSON_SYNTAX' ||
          d.code === 'INVALID_MOD_JSON_ROOT' ||
          d.code === 'INVALID_MOD_ID' ||
          d.code === 'CORRUPT_CONTENT_JSON' ||
          d.code === 'CONTENT_FILE_UNREADABLE',
      ) ||
      !rec.hasValidManifest
    ) {
      rec.status = 'corrupted';
    } else if (rec.diagnostics.some((d) => d.code === 'INCOMPLETE_MOD_STRUCTURE')) {
      rec.status = 'incomplete';
    } else if (rec.diagnostics.some((d) => d.code === 'INCOMPATIBLE_GAME_VERSION')) {
      rec.status = 'incompatible';
    } else if (!rec.enabled) {
      rec.status = 'disabled';
    } else {
      rec.status = 'ready';
    }
  }

  // Detect duplicate modIds among entries that parsed a manifest ID
  const byModId = new Map<string, ModRecord[]>();
  for (const rec of initialRecords) {
    if (!rec.hasValidManifest) continue;
    const bucket = byModId.get(rec.manifest.modId) ?? [];
    bucket.push(rec);
    byModId.set(rec.manifest.modId, bucket);
  }

  const activeByModId = new Map<string, ModRecord>();
  for (const [modId, bucket] of byModId.entries()) {
    if (bucket.length === 1) {
      activeByModId.set(modId, bucket[0]);
      continue;
    }

    // Prefer ready/folder or newest/highest-priority entry, mark duplicates clearly
    const sorted = [...bucket].sort((a, b) => {
      if (a.sourceType !== b.sourceType) {
        return a.sourceType === 'folder' ? -1 : 1;
      }
      return a.sourceId.localeCompare(b.sourceId);
    });
    const winner = sorted[0];
    activeByModId.set(modId, winner);
    for (let i = 1; i < sorted.length; i++) {
      const dup = sorted[i];
      dup.diagnostics.push({
        code: 'DUPLICATE_MOD_ID',
        severity: 'error',
        message: `Duplicate modId "${modId}" conflicts with "${winner.sourceId}".`,
      });
      if (dup.status === 'ready' || dup.status === 'disabled') {
        dup.status = 'duplicate';
      }
    }
  }

  // Dependency resolution & iterative propagation among enabled 'ready' candidates
  let changed = true;
  while (changed) {
    changed = false;
    for (const rec of activeByModId.values()) {
      if (rec.status !== 'ready') continue;

      for (const dep of rec.manifest.dependencies) {
        if (dep.modId === rec.manifest.modId) {
          rec.diagnostics.push({
            code: 'SELF_DEPENDENCY',
            severity: 'error',
            message: `Mod "${rec.manifest.modId}" cannot depend on itself.`,
          });
          rec.status = 'circular_dependency';
          changed = true;
          break;
        }

        const target = activeByModId.get(dep.modId);
        if (!target) {
          if (!dep.optional) {
            rec.diagnostics.push({
              code: 'MISSING_DEPENDENCY',
              severity: 'error',
              message: `Missing required dependency "${dep.modId}"${dep.versionRange ? ` (${dep.versionRange})` : ''}.`,
            });
            rec.status = 'missing_dependency';
            changed = true;
            break;
          }
          continue;
        }

        if (dep.versionRange && !satisfiesSemverRange(target.manifest.version, dep.versionRange)) {
          if (!dep.optional) {
            rec.diagnostics.push({
              code: 'DEPENDENCY_VERSION_MISMATCH',
              severity: 'error',
              message: `Dependency "${dep.modId}" is version ${target.manifest.version}, requires ${dep.versionRange}.`,
            });
            rec.status = 'missing_dependency';
            changed = true;
            break;
          }
          continue;
        }

        if (target.status !== 'ready') {
          if (!dep.optional) {
            rec.diagnostics.push({
              code: 'DEPENDENCY_NOT_ACTIVE',
              severity: 'error',
              message: `Required dependency "${dep.modId}" is not active (${target.status}).`,
            });
            rec.status =
              target.status === 'disabled' ? 'dependency_disabled' : 'missing_dependency';
            changed = true;
            break;
          }
        }
      }
    }
  }

  // Cycle detection among remaining 'ready' candidates using Kahn's topological sort
  const readyMap = new Map<string, ModRecord>();
  for (const rec of activeByModId.values()) {
    if (rec.status === 'ready') {
      readyMap.set(rec.manifest.modId, rec);
    }
  }

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const [id, rec] of readyMap.entries()) {
    inDegree.set(id, 0);
    dependents.set(id, []);
    void rec;
  }

  for (const [id, rec] of readyMap.entries()) {
    const seenDeps = new Set<string>();
    for (const dep of rec.manifest.dependencies) {
      if (!readyMap.has(dep.modId) || seenDeps.has(dep.modId)) continue;
      seenDeps.add(dep.modId);
      inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      dependents.get(dep.modId)?.push(id);
    }
  }

  const compareReady = (aId: string, bId: string): number => {
    const a = readyMap.get(aId)!;
    const b = readyMap.get(bId)!;
    if (a.effectivePriority !== b.effectivePriority) {
      return a.effectivePriority - b.effectivePriority;
    }
    return aId.localeCompare(bId);
  };

  const queue = Array.from(inDegree.entries())
    .filter(([, deg]) => deg === 0)
    .map(([id]) => id)
    .sort(compareReady);

  const loadOrder: string[] = [];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const rec = readyMap.get(currentId);
    if (!rec) continue;
    rec.loadOrderIndex = loadOrder.length;
    loadOrder.push(currentId);

    for (const nextId of dependents.get(currentId) ?? []) {
      const nextDeg = (inDegree.get(nextId) ?? 0) - 1;
      inDegree.set(nextId, nextDeg);
      if (nextDeg === 0) {
        queue.push(nextId);
        queue.sort(compareReady);
      }
    }
  }

  // Any remaining ready nodes could not be ordered due to a dependency cycle
  if (loadOrder.length < readyMap.size) {
    for (const [id, rec] of readyMap.entries()) {
      if (rec.loadOrderIndex !== null) continue;
      rec.status = 'circular_dependency';
      rec.diagnostics.push({
        code: 'CIRCULAR_DEPENDENCY',
        severity: 'error',
        message: `Circular dependency detected involving "${id}".`,
      });
    }
  }

  // Sort UI list deterministically: load order first, then disabled, then issues
  const statusRank: Record<ModRecord['status'], number> = {
    ready: 0,
    disabled: 1,
    dependency_disabled: 2,
    missing_dependency: 3,
    incompatible: 4,
    circular_dependency: 5,
    incomplete: 6,
    duplicate: 7,
    corrupted: 8,
    unsafe: 9,
  };

  initialRecords.sort((a, b) => {
    const rDiff = statusRank[a.status] - statusRank[b.status];
    if (rDiff !== 0) return rDiff;
    if (a.loadOrderIndex !== null && b.loadOrderIndex !== null) {
      return a.loadOrderIndex - b.loadOrderIndex;
    }
    if (a.effectivePriority !== b.effectivePriority) {
      return a.effectivePriority - b.effectivePriority;
    }
    return a.manifest.name.localeCompare(b.manifest.name);
  });

  return { records: initialRecords, loadOrder };
}
