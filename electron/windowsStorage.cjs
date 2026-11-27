const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const zlib = require('node:zlib');

const APP_FOLDER_NAME = 'World of Adventure';

const DIR_WORLDS = 'Worlds';
const DIR_SETTINGS = 'Settings';
const DIR_PROFILES = 'Profiles';
const DIR_BACKUPS = 'Backups';
const DIR_MODS = 'Mods';
const DIR_WORLD_BACKUPS = 'backups';

const FILE_WORLD_DATA = 'world-data.json';
const FILE_WORLD_SETTINGS = 'world-settings.json';
const FILE_LEGACY_WORLD_SETTINGS = 'settings.json';
const FILE_PLAYER_DATA = 'player-data.json';
const FILE_WORLD_STATE = 'world-state.json';
const FILE_PROFILE = 'profile.json';
const FILE_MODS_CONFIG = 'mods-config.json';

const STANDARD_MOD_FOLDERS = Object.freeze([
  'assets',
  'models',
  'textures',
  'sounds',
  'music',
  'items',
  'weapons',
  'armor',
  'tools',
  'consumables',
  'resources',
  'recipes',
  'characters',
  'animals',
  'creatures',
  'monsters',
  'npcs',
  'buildings',
  'decorations',
  'quests',
  'loot_tables',
  'localization',
  'spawns',
]);

const MOD_CONTENT_FOLDERS = new Set([
  'items',
  'weapons',
  'armor',
  'tools',
  'consumables',
  'resources',
  'recipes',
  'characters',
  'animals',
  'creatures',
  'monsters',
  'npcs',
  'buildings',
  'decorations',
  'quests',
  'loot_tables',
  'localization',
  'spawns',
]);

const MOD_ASSET_FOLDERS = new Set([
  'assets',
  'models',
  'textures',
  'sounds',
  'music',
]);

const FILE_WOAMOD_META = '.woamod-package.json';
const STAGING_DIR_PREFIX = '.woamod-staging-';

const FORBIDDEN_MOD_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.rb',
  '.pl',
  '.lua',
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
  '.node',
  '.dex',
  '.jar',
  '.apk',
  '.aab',
  '.class',
  '.wasm',
  '.php',
  '.html',
  '.htm',
  '.svg',
]);

const ALLOWED_MOD_ASSET_MIME = Object.freeze({
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.obj': 'text/plain',
  '.mtl': 'text/plain',
  '.bin': 'application/octet-stream',
  '.woa3d': 'application/json',
});

const MAX_ARCHIVE_ENTRIES = 1200;
const MAX_JSON_ENTRY_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_READ_BYTES = 32 * 1024 * 1024;
const MAX_IMPORT_PACKAGE_BYTES = 150 * 1024 * 1024;
const MAX_ARCHIVE_UNCOMPRESSED_TOTAL = 300 * 1024 * 1024;

const SETTINGS_FILE_MAP = Object.freeze({
  game: 'game-settings.json',
  graphics: 'graphics-settings.json',
  audio: 'audio-settings.json',
  controls: 'controls-settings.json',
  language: 'language-settings.json',
  mods: 'mods-config.json',
});

function parseValidJsonObject(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isInsideRoot(rootDir, candidatePath) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(candidatePath);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  return resolvedTarget.startsWith(prefix);
}

function sanitizeWorldId(worldId) {
  if (typeof worldId !== 'string') return null;
  const trimmed = worldId.trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(trimmed)) return null;
  if (trimmed === '.' || trimmed === '..') return null;
  return trimmed;
}

function extractSavedAtMs(worldData) {
  if (!worldData || typeof worldData !== 'object') return 0;
  const meta = worldData.meta;
  if (!meta || typeof meta !== 'object') return 0;
  return typeof meta.savedAtMs === 'number' && Number.isFinite(meta.savedAtMs)
    ? meta.savedAtMs
    : 0;
}

/**
 * Manages Windows local storage under Electron's resolved Documents folder:
 *   app.getPath("documents") + "/World of Adventure/"
 *     ├── Worlds/<worldId>/{world-data.json,world-settings.json,player-data.json,world-state.json,backups/}
 *     ├── Settings/{game-settings.json,graphics-settings.json,audio-settings.json,controls-settings.json,language-settings.json}
 *     ├── Profiles/profile.json
 *     └── Backups/
 *
 * Non-Windows desktop launches preserve prior userData/GameData/Worlds behavior.
 */
function createDesktopStorageManager({ getDocumentsPath, getUserDataPath, platform }) {
  const isWindows = platform === 'win32';
  const lockMap = new Map();
  let initPromise = null;
  let migrationDone = false;

  function resolveBaseRoot() {
    if (isWindows) {
      const docsDir = getDocumentsPath();
      return path.resolve(docsDir, APP_FOLDER_NAME);
    }
    const userDataDir = getUserDataPath();
    return path.resolve(userDataDir, 'GameData');
  }

  function resolveLegacyWorldsRoot() {
    const userDataDir = getUserDataPath();
    return path.resolve(userDataDir, 'GameData', DIR_WORLDS);
  }

  function resolvePaths() {
    const baseRoot = resolveBaseRoot();
    return {
      baseRoot,
      worldsDir: path.join(baseRoot, DIR_WORLDS),
      settingsDir: path.join(baseRoot, DIR_SETTINGS),
      profilesDir: path.join(baseRoot, DIR_PROFILES),
      backupsDir: path.join(baseRoot, DIR_BACKUPS),
      modsDir: path.join(baseRoot, DIR_MODS),
      legacyWorldsDir: resolveLegacyWorldsRoot(),
    };
  }

  function sanitizeModSourceId(sourceId) {
    if (typeof sourceId !== 'string') return null;
    const trimmed = sourceId.trim();
    if (!trimmed || trimmed === '.' || trimmed === '..') return null;
    if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
      return null;
    }
    if (!/^[A-Za-z0-9._ -]{1,120}$/.test(trimmed)) return null;
    return trimmed;
  }

  function sanitizeModRelativePath(relPath) {
    if (typeof relPath !== 'string') return null;
    const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (!normalized || normalized.includes('\0')) return null;
    const segments = normalized.split('/');
    for (const seg of segments) {
      if (!seg || seg === '.' || seg === '..') return null;
    }
    return segments.join('/');
  }

  function isArchiveModFileName(fileName) {
    const lower = String(fileName || '').toLowerCase();
    return lower.endsWith('.zip') || lower.endsWith('.woamod');
  }

  function parseZipEntries(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
      throw new Error('ARCHIVE_EMPTY_OR_TOO_SMALL');
    }
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
      throw new Error('INVALID_ZIP_SIGNATURE');
    }
    // Locate End of Central Directory (EOCD) signature 0x06054b50
    const minOffset = Math.max(0, buffer.length - 65557);
    let eocdOffset = -1;
    for (let i = buffer.length - 22; i >= minOffset; i--) {
      if (buffer.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset < 0) {
      throw new Error('ARCHIVE_INVALID_ZIP_EOCD');
    }

    const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
    const cdSize = buffer.readUInt32LE(eocdOffset + 12);
    const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

    if (totalEntries === 0) {
      throw new Error('CORRUPT_MOD_ARCHIVE');
    }
    if (totalEntries > MAX_ARCHIVE_ENTRIES) {
      throw new Error('ARCHIVE_TOO_MANY_ENTRIES');
    }
    if (cdOffset + cdSize > eocdOffset) {
      throw new Error('ARCHIVE_CORRUPT_CENTRAL_DIR');
    }

    const entries = [];
    let totalUncompressed = 0;
    let cursor = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
      if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
        throw new Error('ARCHIVE_CORRUPT_ENTRY_HEADER');
      }
      const gpFlags = buffer.readUInt16LE(cursor + 8);
      const compressionMethod = buffer.readUInt16LE(cursor + 10);
      const compressedSize = buffer.readUInt32LE(cursor + 20);
      const uncompressedSize = buffer.readUInt32LE(cursor + 24);
      const nameLen = buffer.readUInt16LE(cursor + 28);
      const extraLen = buffer.readUInt16LE(cursor + 30);
      const commentLen = buffer.readUInt16LE(cursor + 32);
      const externalAttrs = buffer.readUInt32LE(cursor + 38);
      const localHeaderOffset = buffer.readUInt32LE(cursor + 42);

      if (cursor + 46 + nameLen + extraLen + commentLen > buffer.length) {
        throw new Error('ARCHIVE_CORRUPT_CENTRAL_DIR');
      }
      if ((gpFlags & 0x0001) !== 0) {
        throw new Error('ENCRYPTED_ZIP_UNSUPPORTED');
      }
      const unixMode = (externalAttrs >>> 16) & 0o170000;
      if (unixMode === 0o120000) {
        throw new Error('PATH_TRAVERSAL_BLOCKED');
      }

      const rawName = buffer
        .subarray(cursor + 46, cursor + 46 + nameLen)
        .toString('utf8');
      cursor += 46 + nameLen + extraLen + commentLen;

      if (rawName.includes('\0')) {
        throw new Error('PATH_TRAVERSAL_BLOCKED');
      }
      const unixName = rawName.replace(/\\/g, '/');
      if (unixName.startsWith('/') || /^[A-Za-z]:/.test(unixName)) {
        throw new Error('PATH_TRAVERSAL_BLOCKED');
      }
      const isDir = unixName.endsWith('/');
      const trimmedName = unixName.replace(/\/+$/, '');
      if (!trimmedName) continue;

      const parts = trimmedName.split('/');
      if (parts.some((p) => !p || p === '..' || p === '.')) {
        throw new Error('PATH_TRAVERSAL_BLOCKED');
      }
      if (uncompressedSize > MAX_ASSET_READ_BYTES) {
        throw new Error(`ARCHIVE_ENTRY_TOO_LARGE:${trimmedName}`);
      }
      totalUncompressed += uncompressedSize;
      if (totalUncompressed > MAX_ARCHIVE_UNCOMPRESSED_TOTAL) {
        throw new Error('ZIP_TOTAL_SIZE_EXCEEDED');
      }

      entries.push({
        name: trimmedName,
        isDir,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
    }

    return entries;
  }

  function extractZipEntryBuffer(archiveBuffer, entry) {
    const off = entry.localHeaderOffset;
    if (off + 30 > archiveBuffer.length || archiveBuffer.readUInt32LE(off) !== 0x04034b50) {
      throw new Error(`ARCHIVE_INVALID_LOCAL_HEADER:${entry.name}`);
    }
    const localNameLen = archiveBuffer.readUInt16LE(off + 26);
    const localExtraLen = archiveBuffer.readUInt16LE(off + 28);
    const dataStart = off + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > archiveBuffer.length) {
      throw new Error(`ARCHIVE_TRUNCATED_DATA:${entry.name}`);
    }
    const compressedSlice = archiveBuffer.subarray(dataStart, dataEnd);
    let out;
    if (entry.compressionMethod === 0) {
      out = compressedSlice;
    } else if (entry.compressionMethod === 8) {
      out = zlib.inflateRawSync(compressedSlice, { maxOutputLength: MAX_ASSET_READ_BYTES });
    } else {
      throw new Error(`ARCHIVE_UNSUPPORTED_COMPRESSION:${entry.compressionMethod}`);
    }
    if (out.length > MAX_ASSET_READ_BYTES) {
      throw new Error(`ARCHIVE_DECOMPRESSED_TOO_LARGE:${entry.name}`);
    }
    return out;
  }

  function resolveSafeWorldDir(worldsDir, worldId) {
    const safeId = sanitizeWorldId(worldId);
    if (!safeId) return null;
    const target = path.resolve(worldsDir, safeId);
    if (!isInsideRoot(worldsDir, target)) return null;
    return { id: safeId, dir: target };
  }

  async function withKeyLock(lockKey, task) {
    const prev = lockMap.get(lockKey) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    lockMap.set(lockKey, current);
    try {
      await prev;
      return await task();
    } finally {
      release();
      if (lockMap.get(lockKey) === current) {
        lockMap.delete(lockKey);
      }
    }
  }

  async function flushPendingWrites() {
    const pending = Array.from(lockMap.values());
    if (pending.length > 0) {
      await Promise.allSettled(pending);
    }
  }

  async function writeUtf8Synced(filePath, content) {
    const fh = await fsp.open(filePath, 'w');
    try {
      await fh.writeFile(content, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
  }

  async function writeJsonAtomic(targetPath, backupPath, dataObj) {
    if (!dataObj || typeof dataObj !== 'object' || Array.isArray(dataObj)) {
      throw new Error('Invalid JSON payload.');
    }
    const serialized = JSON.stringify(dataObj, null, 2);
    if (!parseValidJsonObject(serialized)) {
      throw new Error('Failed JSON serialization check.');
    }

    const targetDir = path.dirname(targetPath);
    await fsp.mkdir(targetDir, { recursive: true });
    if (backupPath) {
      await fsp.mkdir(path.dirname(backupPath), { recursive: true });
    }

    // Preserve previous valid primary file in backup directory before replacing
    if (backupPath && (await pathExists(targetPath))) {
      try {
        const prevRaw = await fsp.readFile(targetPath, 'utf8');
        if (parseValidJsonObject(prevRaw)) {
          const bakTmp = `${backupPath}.tmp`;
          await writeUtf8Synced(bakTmp, prevRaw);
          await fsp.rename(bakTmp, backupPath);
        }
      } catch {
        // Keep older valid backup if existing file cannot be read
      }
    }

    const tmpPath = `${targetPath}.tmp`;
    await writeUtf8Synced(tmpPath, serialized);
    const verifiedRaw = await fsp.readFile(tmpPath, 'utf8');
    if (!parseValidJsonObject(verifiedRaw)) {
      await fsp.rm(tmpPath, { force: true }).catch(() => {});
      throw new Error('Write verification failed for temporary save file.');
    }
    await fsp.rename(tmpPath, targetPath);
  }

  async function readJsonWithBackups(primaryPath, ...fallbackPaths) {
    const candidates = [primaryPath, ...fallbackPaths].filter(Boolean);
    for (const candidate of candidates) {
      try {
        if (!(await pathExists(candidate))) continue;
        const raw = await fsp.readFile(candidate, 'utf8');
        const parsed = parseValidJsonObject(raw);
        if (parsed) {
          if (candidate !== primaryPath && primaryPath) {
            try {
              await writeJsonAtomic(primaryPath, null, parsed);
            } catch {
              // Non-fatal repair copy failure
            }
          }
          return parsed;
        }
      } catch {
        // Try next backup candidate
      }
    }
    return null;
  }

  async function readWorldBundleFromDir(worldDir) {
    const backupsDir = path.join(worldDir, DIR_WORLD_BACKUPS);
    const worldData = await readJsonWithBackups(
      path.join(worldDir, FILE_WORLD_DATA),
      path.join(backupsDir, `${FILE_WORLD_DATA}.bak`),
      path.join(worldDir, `${FILE_WORLD_DATA}.bak`),
    );
    if (!worldData) return null;

    const settings =
      (await readJsonWithBackups(
        path.join(worldDir, FILE_WORLD_SETTINGS),
        path.join(backupsDir, `${FILE_WORLD_SETTINGS}.bak`),
        path.join(worldDir, FILE_LEGACY_WORLD_SETTINGS),
        path.join(worldDir, `${FILE_LEGACY_WORLD_SETTINGS}.bak`),
      )) || {};

    const playerData =
      (await readJsonWithBackups(
        path.join(worldDir, FILE_PLAYER_DATA),
        path.join(backupsDir, `${FILE_PLAYER_DATA}.bak`),
        path.join(worldDir, `${FILE_PLAYER_DATA}.bak`),
      )) || {};

    const worldState =
      (await readJsonWithBackups(
        path.join(worldDir, FILE_WORLD_STATE),
        path.join(backupsDir, `${FILE_WORLD_STATE}.bak`),
        path.join(worldDir, `${FILE_WORLD_STATE}.bak`),
      )) || {};

    const saveVersion =
      typeof worldData.saveVersion === 'number' ? worldData.saveVersion : 1;

    return {
      saveVersion,
      worldData,
      settings,
      playerData,
      worldState,
    };
  }

  async function writeWorldBundleToDir(worldDir, bundle) {
    const backupsDir = path.join(worldDir, DIR_WORLD_BACKUPS);
    await fsp.mkdir(worldDir, { recursive: true });
    await fsp.mkdir(backupsDir, { recursive: true });

    const saveVersion =
      typeof bundle.saveVersion === 'number' ? bundle.saveVersion : 1;
    const worldDataWithVersion = {
      ...bundle.worldData,
      saveVersion,
    };

    await writeJsonAtomic(
      path.join(worldDir, FILE_WORLD_DATA),
      path.join(backupsDir, `${FILE_WORLD_DATA}.bak`),
      worldDataWithVersion,
    );
    await writeJsonAtomic(
      path.join(worldDir, FILE_WORLD_SETTINGS),
      path.join(backupsDir, `${FILE_WORLD_SETTINGS}.bak`),
      bundle.settings,
    );
    await writeJsonAtomic(
      path.join(worldDir, FILE_PLAYER_DATA),
      path.join(backupsDir, `${FILE_PLAYER_DATA}.bak`),
      bundle.playerData,
    );
    await writeJsonAtomic(
      path.join(worldDir, FILE_WORLD_STATE),
      path.join(backupsDir, `${FILE_WORLD_STATE}.bak`),
      bundle.worldState,
    );
  }

  async function migrateLegacyWorldsIfNeeded(paths) {
    if (!isWindows || migrationDone) return;
    if (paths.legacyWorldsDir === paths.worldsDir) {
      migrationDone = true;
      return;
    }
    if (!(await pathExists(paths.legacyWorldsDir))) {
      migrationDone = true;
      return;
    }

    let entries = [];
    try {
      entries = await fsp.readdir(paths.legacyWorldsDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const safeId = sanitizeWorldId(entry.name);
      if (!safeId) continue;

      const legacyWorldDir = path.join(paths.legacyWorldsDir, safeId);
      const targetSafe = resolveSafeWorldDir(paths.worldsDir, safeId);
      if (!targetSafe) continue;

      try {
        const legacyBundle = await readWorldBundleFromDir(legacyWorldDir);
        if (!legacyBundle) continue;
        const legacyTs = extractSavedAtMs(legacyBundle.worldData);

        const existingTarget = await readJsonWithBackups(
          path.join(targetSafe.dir, FILE_WORLD_DATA),
          path.join(targetSafe.dir, DIR_WORLD_BACKUPS, `${FILE_WORLD_DATA}.bak`),
        );
        if (existingTarget && extractSavedAtMs(existingTarget) >= legacyTs) {
          continue;
        }

        // Write verified bundle to Documents/World of Adventure/Worlds/<worldId>/;
        // preserve original legacy files untouched as fallback backup.
        await writeWorldBundleToDir(targetSafe.dir, legacyBundle);
        const verified = await readJsonWithBackups(
          path.join(targetSafe.dir, FILE_WORLD_DATA),
        );
        if (!verified) {
          throw new Error(`Migration verification failed for world ${safeId}`);
        }
      } catch {
        // Keep migrating other worlds cleanly if one legacy folder fails
      }
    }

    migrationDone = true;
  }

  async function ensureInitialized() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const paths = resolvePaths();
      await fsp.mkdir(paths.worldsDir, { recursive: true });
      await fsp.mkdir(paths.modsDir, { recursive: true });
      await fsp.mkdir(paths.settingsDir, { recursive: true });
      await fsp.mkdir(paths.backupsDir, { recursive: true });
      if (isWindows) {
        await fsp.mkdir(paths.profilesDir, { recursive: true });
        await migrateLegacyWorldsIfNeeded(paths);
      }
      return paths;
    })();
    try {
      return await initPromise;
    } catch (err) {
      initPromise = null;
      throw err;
    }
  }

  async function listWorlds() {
    try {
      const paths = await ensureInitialized();
      const ids = new Set();

      if (await pathExists(paths.worldsDir)) {
        const entries = await fsp.readdir(paths.worldsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const safe = resolveSafeWorldDir(paths.worldsDir, entry.name);
          if (!safe) continue;
          const wd = path.join(safe.dir, FILE_WORLD_DATA);
          const wdBak = path.join(safe.dir, DIR_WORLD_BACKUPS, `${FILE_WORLD_DATA}.bak`);
          const wdLegacyBak = `${wd}.bak`;
          if (
            (await pathExists(wd)) ||
            (await pathExists(wdBak)) ||
            (await pathExists(wdLegacyBak))
          ) {
            ids.add(safe.id);
          }
        }
      }

      if (isWindows && (await pathExists(paths.legacyWorldsDir))) {
        const legacyEntries = await fsp.readdir(paths.legacyWorldsDir, {
          withFileTypes: true,
        });
        for (const entry of legacyEntries) {
          if (!entry.isDirectory()) continue;
          const safeId = sanitizeWorldId(entry.name);
          if (!safeId || ids.has(safeId)) continue;
          const wd = path.join(paths.legacyWorldsDir, safeId, FILE_WORLD_DATA);
          if ((await pathExists(wd)) || (await pathExists(`${wd}.bak`))) {
            ids.add(safeId);
          }
        }
      }

      return { ok: true, worldIds: Array.from(ids) };
    } catch (err) {
      return {
        ok: false,
        worldIds: [],
        error: (err && err.message) || 'LIST_FAILED',
      };
    }
  }

  async function readBundle(worldId) {
    const safeId = sanitizeWorldId(worldId);
    if (!safeId) return { ok: false, error: 'INVALID_WORLD_ID' };

    return withKeyLock(`world:${safeId}`, async () => {
      try {
        const paths = await ensureInitialized();
        const target = resolveSafeWorldDir(paths.worldsDir, safeId);
        if (!target) return { ok: false, error: 'INVALID_WORLD_ID' };

        let bundle = (await pathExists(target.dir))
          ? await readWorldBundleFromDir(target.dir)
          : null;

        if (!bundle && isWindows) {
          const legacyDir = path.join(paths.legacyWorldsDir, safeId);
          if (await pathExists(legacyDir)) {
            bundle = await readWorldBundleFromDir(legacyDir);
          }
        }

        if (!bundle) {
          return { ok: false, error: 'WORLD_NOT_FOUND' };
        }
        return { ok: true, bundle };
      } catch (err) {
        return { ok: false, error: (err && err.message) || 'READ_FAILED' };
      }
    });
  }

  async function writeBundle(worldId, bundle) {
    const safeId = sanitizeWorldId(worldId);
    if (!safeId) return { ok: false, error: 'INVALID_WORLD_ID' };
    if (
      !bundle ||
      typeof bundle !== 'object' ||
      !bundle.worldData ||
      !bundle.settings ||
      !bundle.playerData ||
      !bundle.worldState
    ) {
      return { ok: false, error: 'INVALID_BUNDLE' };
    }

    return withKeyLock(`world:${safeId}`, async () => {
      try {
        const paths = await ensureInitialized();
        const target = resolveSafeWorldDir(paths.worldsDir, safeId);
        if (!target) return { ok: false, error: 'INVALID_WORLD_ID' };
        await writeWorldBundleToDir(target.dir, bundle);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err && err.message) || 'WRITE_FAILED' };
      }
    });
  }

  async function deleteWorld(worldId) {
    const safeId = sanitizeWorldId(worldId);
    if (!safeId) return { ok: false, error: 'INVALID_WORLD_ID' };

    return withKeyLock(`world:${safeId}`, async () => {
      try {
        const paths = await ensureInitialized();
        const target = resolveSafeWorldDir(paths.worldsDir, safeId);
        if (!target) return { ok: false, error: 'INVALID_WORLD_ID' };
        if (await pathExists(target.dir)) {
          await fsp.rm(target.dir, { recursive: true, force: true });
        }
        if (isWindows) {
          const legacyDir = path.join(paths.legacyWorldsDir, safeId);
          if (
            isInsideRoot(paths.legacyWorldsDir, legacyDir) &&
            (await pathExists(legacyDir))
          ) {
            await fsp.rm(legacyDir, { recursive: true, force: true });
          }
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err && err.message) || 'DELETE_FAILED' };
      }
    });
  }

  async function readAllSettings() {
    if (!isWindows) {
      return { ok: true, enabled: false, settings: {} };
    }
    try {
      const paths = await ensureInitialized();
      const settings = {};
      let hasAny = false;
      for (const [key, fileName] of Object.entries(SETTINGS_FILE_MAP)) {
        const primary = path.resolve(paths.settingsDir, fileName);
        if (!isInsideRoot(paths.settingsDir, primary)) continue;
        const backup = path.resolve(paths.backupsDir, `${fileName}.bak`);
        const data = await readJsonWithBackups(primary, backup);
        if (data) {
          settings[key] = data;
          hasAny = true;
        }
      }
      return {
        ok: true,
        enabled: true,
        hasAny,
        rootPath: paths.baseRoot,
        settings,
      };
    } catch (err) {
      return {
        ok: false,
        enabled: true,
        settings: {},
        error: (err && err.message) || 'SETTINGS_READ_FAILED',
      };
    }
  }

  async function writeSetting(settingKey, payload) {
    if (!isWindows) {
      return { ok: false, error: 'NOT_WINDOWS' };
    }
    const fileName = Object.prototype.hasOwnProperty.call(
      SETTINGS_FILE_MAP,
      settingKey,
    )
      ? SETTINGS_FILE_MAP[settingKey]
      : null;
    if (!fileName) {
      return { ok: false, error: 'INVALID_SETTING_KEY' };
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, error: 'INVALID_JSON' };
    }

    return withKeyLock(`setting:${settingKey}`, async () => {
      try {
        const paths = await ensureInitialized();
        const target = path.resolve(paths.settingsDir, fileName);
        const backup = path.resolve(paths.backupsDir, `${fileName}.bak`);
        if (
          !isInsideRoot(paths.settingsDir, target) ||
          !isInsideRoot(paths.backupsDir, backup)
        ) {
          return { ok: false, error: 'INVALID_PATH' };
        }
        await writeJsonAtomic(target, backup, payload);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: (err && err.message) || 'SETTINGS_WRITE_FAILED',
        };
      }
    });
  }

  async function readProfile() {
    if (!isWindows) {
      return { ok: false, error: 'NOT_WINDOWS' };
    }
    return withKeyLock('profile', async () => {
      try {
        const paths = await ensureInitialized();
        const target = path.resolve(paths.profilesDir, FILE_PROFILE);
        const backup = path.resolve(paths.backupsDir, `${FILE_PROFILE}.bak`);
        if (!isInsideRoot(paths.profilesDir, target)) {
          return { ok: false, error: 'INVALID_PATH' };
        }
        const profile = await readJsonWithBackups(target, backup);
        if (!profile) {
          return { ok: false, error: 'NOT_FOUND' };
        }
        return { ok: true, profile };
      } catch (err) {
        return {
          ok: false,
          error: (err && err.message) || 'PROFILE_READ_FAILED',
        };
      }
    });
  }

  async function writeProfile(payload) {
    if (!isWindows) {
      return { ok: false, error: 'NOT_WINDOWS' };
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, error: 'INVALID_JSON' };
    }
    return withKeyLock('profile', async () => {
      try {
        const paths = await ensureInitialized();
        const target = path.resolve(paths.profilesDir, FILE_PROFILE);
        const backup = path.resolve(paths.backupsDir, `${FILE_PROFILE}.bak`);
        if (
          !isInsideRoot(paths.profilesDir, target) ||
          !isInsideRoot(paths.backupsDir, backup)
        ) {
          return { ok: false, error: 'INVALID_PATH' };
        }
        await writeJsonAtomic(target, backup, payload);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: (err && err.message) || 'PROFILE_WRITE_FAILED',
        };
      }
    });
  }

  // ---------- Local Mods Storage & Discovery ----------

  async function scanFolderMod(realModsDir, entryName) {
    const folderPath = path.resolve(realModsDir, entryName);
    let realFolderPath;
    try {
      realFolderPath = await fsp.realpath(folderPath);
    } catch {
      return null;
    }
    if (!isInsideRoot(realModsDir, realFolderPath)) {
      return null;
    }

    const stat = await fsp.stat(realFolderPath);
    const presentFoldersSet = new Set();
    const assetFiles = [];
    const contentFiles = [];
    const executableFiles = [];
    let manifestRaw = null;
    let manifestError = null;

    const manifestPath = path.join(realFolderPath, 'mod.json');
    if (await pathExists(manifestPath)) {
      try {
        const mStat = await fsp.stat(manifestPath);
        if (mStat.isFile() && mStat.size <= MAX_JSON_ENTRY_BYTES) {
          manifestRaw = await fsp.readFile(manifestPath, 'utf8');
        } else {
          manifestError = 'MANIFEST_TOO_LARGE_OR_INVALID';
        }
      } catch (err) {
        manifestError = (err && err.message) || 'MANIFEST_READ_FAILED';
      }
    } else {
      manifestError = 'MANIFEST_MISSING';
    }

    const rootChildren = await fsp.readdir(realFolderPath, { withFileTypes: true }).catch(() => []);
    for (const child of rootChildren) {
      if (child.isDirectory() && STANDARD_MOD_FOLDERS.includes(child.name)) {
        presentFoldersSet.add(child.name);
      } else if (child.isFile()) {
        const ext = path.extname(child.name).toLowerCase();
        if (FORBIDDEN_MOD_EXTENSIONS.has(ext)) {
          executableFiles.push(child.name);
        }
      }
    }

    // Also detect assets/<subfolder> if modder nests standard asset folders under assets/
    const assetsSubDir = path.join(realFolderPath, 'assets');
    if (await pathExists(assetsSubDir)) {
      const assetsChildren = await fsp.readdir(assetsSubDir, { withFileTypes: true }).catch(() => []);
      for (const ac of assetsChildren) {
        if (ac.isDirectory() && STANDARD_MOD_FOLDERS.includes(ac.name)) {
          presentFoldersSet.add(ac.name);
        }
      }
    }

    let packageMeta = null;
    const pkgMetaPath = path.join(realFolderPath, FILE_WOAMOD_META);
    if (await pathExists(pkgMetaPath)) {
      try {
        const realMeta = await fsp.realpath(pkgMetaPath);
        if (isInsideRoot(realFolderPath, realMeta)) {
          const parsedMeta = parseValidJsonObject(await fsp.readFile(realMeta, 'utf8'));
          if (parsedMeta && parsedMeta.format === 'woamod') {
            packageMeta = parsedMeta;
          }
        }
      } catch {
        // Treat unreadable metadata as development folder gracefully
      }
    }

    async function walkRelative(dirPath, relPrefix, depth) {
      if (depth > 8) return;
      const items = await fsp.readdir(dirPath, { withFileTypes: true }).catch(() => []);
      for (const item of items) {
        if (item.name === FILE_WOAMOD_META) continue;
        if (assetFiles.length + contentFiles.length > MAX_ARCHIVE_ENTRIES) break;
        const abs = path.join(dirPath, item.name);
        let realItem;
        try {
          realItem = await fsp.realpath(abs);
        } catch {
          continue;
        }
        if (!isInsideRoot(realFolderPath, realItem)) continue;

        const rel = relPrefix ? `${relPrefix}/${item.name}` : item.name;
        if (item.isDirectory()) {
          await walkRelative(realItem, rel, depth + 1);
          continue;
        }
        if (!item.isFile()) continue;

        const ext = path.extname(item.name).toLowerCase();
        if (FORBIDDEN_MOD_EXTENSIONS.has(ext)) {
          executableFiles.push(rel);
          continue;
        }

        const topFolder = rel.split('/')[0];
        const secondFolder = topFolder === 'assets' ? rel.split('/')[1] : null;
        const category = MOD_CONTENT_FOLDERS.has(topFolder)
          ? topFolder
          : secondFolder && MOD_ASSET_FOLDERS.has(secondFolder)
            ? secondFolder
            : topFolder;

        if (MOD_CONTENT_FOLDERS.has(topFolder) && ext === '.json') {
          try {
            const fStat = await fsp.stat(realItem);
            if (fStat.size <= MAX_JSON_ENTRY_BYTES) {
              const rawText = await fsp.readFile(realItem, 'utf8');
              contentFiles.push({ category: topFolder, relativePath: rel, rawText });
            } else {
              contentFiles.push({
                category: topFolder,
                relativePath: rel,
                rawText: '',
                readError: 'FILE_TOO_LARGE',
              });
            }
          } catch (err) {
            contentFiles.push({
              category: topFolder,
              relativePath: rel,
              rawText: '',
              readError: (err && err.message) || 'READ_FAILED',
            });
          }
        } else if (rel !== 'mod.json') {
          const fStat = await fsp.stat(realItem).catch(() => null);
          const sizeBytes = fStat ? fStat.size : 0;
          let rawText;
          if (ext === '.woa3d' && sizeBytes <= MAX_JSON_ENTRY_BYTES) {
            rawText = await fsp.readFile(realItem, 'utf8').catch(() => undefined);
          }
          assetFiles.push({
            category,
            relativePath: rel,
            sizeBytes,
            ...(rawText !== undefined ? { rawText } : {}),
          });
        }
      }
    }

    await walkRelative(realFolderPath, '', 0);

    return {
      sourceId: entryName,
      sourceType: 'folder',
      installKind: packageMeta ? 'woamod' : 'development',
      packageFileName:
        packageMeta && typeof packageMeta.packageFileName === 'string'
          ? packageMeta.packageFileName
          : undefined,
      installedAtMs:
        packageMeta && typeof packageMeta.installedAtMs === 'number'
          ? packageMeta.installedAtMs
          : undefined,
      sourcePath: realFolderPath,
      modifiedAtMs: stat.mtimeMs || Date.now(),
      manifestRaw,
      manifestError,
      presentFolders: STANDARD_MOD_FOLDERS.filter((f) => presentFoldersSet.has(f)),
      contentFiles,
      assetFiles,
      executableFiles,
      archiveCorrupt: false,
    };
  }

  async function scanArchiveMod(realModsDir, entryName) {
    const archivePath = path.resolve(realModsDir, entryName);
    let realArchivePath;
    try {
      realArchivePath = await fsp.realpath(archivePath);
    } catch {
      return null;
    }
    if (!isInsideRoot(realModsDir, realArchivePath)) return null;

    const stat = await fsp.stat(realArchivePath);
    if (stat.size > MAX_IMPORT_PACKAGE_BYTES) {
      return {
        sourceId: entryName,
        sourceType: 'archive',
        sourcePath: realArchivePath,
        modifiedAtMs: stat.mtimeMs || Date.now(),
        manifestRaw: null,
        manifestError: 'ARCHIVE_TOO_LARGE',
        presentFolders: [],
        contentFiles: [],
        assetFiles: [],
        executableFiles: [],
        archiveCorrupt: true,
        archiveError: 'ARCHIVE_TOO_LARGE',
      };
    }

    try {
      const archiveBuffer = await fsp.readFile(realArchivePath);
      const entries = parseZipEntries(archiveBuffer);

      // Detect optional single top-level wrapper folder when mod.json is nested 1 level down
      let stripPrefix = '';
      const hasRootManifest = entries.some((e) => !e.isDir && e.name === 'mod.json');
      if (!hasRootManifest) {
        const firstSegments = new Set(entries.map((e) => e.name.split('/')[0]).filter(Boolean));
        if (firstSegments.size === 1) {
          const singleRoot = Array.from(firstSegments)[0];
          if (entries.some((e) => !e.isDir && e.name === `${singleRoot}/mod.json`)) {
            stripPrefix = `${singleRoot}/`;
          }
        }
      }

      const presentFoldersSet = new Set();
      const assetFiles = [];
      const contentFiles = [];
      const executableFiles = [];
      let manifestRaw = null;
      let manifestError = 'MANIFEST_MISSING';

      for (const entry of entries) {
        let rel = entry.name;
        if (stripPrefix && rel.startsWith(stripPrefix)) {
          rel = rel.slice(stripPrefix.length);
        } else if (stripPrefix && rel === stripPrefix.slice(0, -1)) {
          continue;
        }
        if (!rel) continue;

        const parts = rel.split('/');
        const topFolder = parts[0];
        if (STANDARD_MOD_FOLDERS.includes(topFolder) && (entry.isDir || parts.length > 1)) {
          presentFoldersSet.add(topFolder);
        }
        if (topFolder === 'assets' && parts.length > 1 && STANDARD_MOD_FOLDERS.includes(parts[1])) {
          presentFoldersSet.add(parts[1]);
        }

        if (entry.isDir) continue;

        const ext = path.extname(rel).toLowerCase();
        if (FORBIDDEN_MOD_EXTENSIONS.has(ext)) {
          executableFiles.push(rel);
          continue;
        }

        if (rel === 'mod.json') {
          if (entry.uncompressedSize > MAX_JSON_ENTRY_BYTES) {
            manifestError = 'MANIFEST_TOO_LARGE_OR_INVALID';
          } else {
            const buf = extractZipEntryBuffer(archiveBuffer, entry);
            manifestRaw = buf.toString('utf8');
            manifestError = null;
          }
          continue;
        }

        if (MOD_CONTENT_FOLDERS.has(topFolder) && ext === '.json') {
          if (entry.uncompressedSize > MAX_JSON_ENTRY_BYTES) {
            contentFiles.push({
              category: topFolder,
              relativePath: rel,
              rawText: '',
              readError: 'FILE_TOO_LARGE',
            });
          } else {
            const buf = extractZipEntryBuffer(archiveBuffer, entry);
            contentFiles.push({
              category: topFolder,
              relativePath: rel,
              rawText: buf.toString('utf8'),
            });
          }
        } else {
          const secondFolder = topFolder === 'assets' ? parts[1] : null;
          const category =
            secondFolder && MOD_ASSET_FOLDERS.has(secondFolder) ? secondFolder : topFolder;
          let rawText;
          if (ext === '.woa3d' && entry.uncompressedSize <= MAX_JSON_ENTRY_BYTES) {
            try {
              rawText = extractZipEntryBuffer(archiveBuffer, entry).toString('utf8');
            } catch {
              rawText = undefined;
            }
          }
          assetFiles.push({
            category,
            relativePath: rel,
            sizeBytes: entry.uncompressedSize,
            ...(rawText !== undefined ? { rawText } : {}),
          });
        }
      }

      return {
        sourceId: entryName,
        sourceType: 'archive',
        sourcePath: realArchivePath,
        modifiedAtMs: stat.mtimeMs || Date.now(),
        manifestRaw,
        manifestError,
        presentFolders: STANDARD_MOD_FOLDERS.filter((f) => presentFoldersSet.has(f)),
        contentFiles,
        assetFiles,
        executableFiles,
        archiveCorrupt: false,
      };
    } catch (err) {
      return {
        sourceId: entryName,
        sourceType: 'archive',
        sourcePath: realArchivePath,
        modifiedAtMs: stat.mtimeMs || Date.now(),
        manifestRaw: null,
        manifestError: (err && err.message) || 'ARCHIVE_CORRUPT',
        presentFolders: [],
        contentFiles: [],
        assetFiles: [],
        executableFiles: [],
        archiveCorrupt: true,
        archiveError: (err && err.message) || 'ARCHIVE_CORRUPT',
      };
    }
  }

  async function getModsInfo() {
    try {
      const paths = await ensureInitialized();
      return {
        ok: true,
        modsDir: paths.modsDir,
        platform,
        writable: true,
      };
    } catch (err) {
      return {
        ok: false,
        modsDir: resolvePaths().modsDir,
        platform,
        writable: false,
        error: (err && err.message) || 'MODS_DIR_ERROR',
      };
    }
  }

  async function cleanupStaleStagingDirs(realModsDir) {
    try {
      const children = await fsp.readdir(realModsDir, { withFileTypes: true });
      for (const child of children) {
        if (!child.name.startsWith(STAGING_DIR_PREFIX)) continue;
        const target = path.resolve(realModsDir, child.name);
        if (isInsideRoot(realModsDir, target)) {
          await fsp.rm(target, { recursive: true, force: true }).catch(() => {});
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  async function discoverMods() {
    try {
      const paths = await ensureInitialized();
      const realModsDir = await fsp.realpath(paths.modsDir);
      await cleanupStaleStagingDirs(realModsDir);
      const dirEntries = await fsp.readdir(realModsDir, { withFileTypes: true });
      const results = [];

      for (const entry of dirEntries) {
        if (entry.name.startsWith('.')) continue;
        const safeId = sanitizeModSourceId(entry.name);
        if (!safeId) continue;

        if (entry.isDirectory()) {
          const scanned = await scanFolderMod(realModsDir, safeId);
          if (scanned) results.push(scanned);
        } else if (entry.isFile() && isArchiveModFileName(safeId)) {
          const scanned = await scanArchiveMod(realModsDir, safeId);
          if (scanned) results.push(scanned);
        }
      }

      return {
        ok: true,
        modsDir: realModsDir,
        entries: results,
      };
    } catch (err) {
      return {
        ok: false,
        modsDir: resolvePaths().modsDir,
        entries: [],
        error: (err && err.message) || 'MOD_DISCOVERY_FAILED',
      };
    }
  }

  async function readModState() {
    return withKeyLock('mods:state', async () => {
      try {
        const paths = await ensureInitialized();
        const primary = path.resolve(paths.settingsDir, FILE_MODS_CONFIG);
        const backup = path.resolve(paths.backupsDir, `${FILE_MODS_CONFIG}.bak`);
        if (!isInsideRoot(paths.settingsDir, primary)) {
          return { ok: false, error: 'INVALID_PATH' };
        }
        const state = await readJsonWithBackups(primary, backup);
        return {
          ok: true,
          state: state || { version: 1, enabledByModId: {}, priorityByModId: {} },
        };
      } catch (err) {
        return {
          ok: false,
          error: (err && err.message) || 'MOD_STATE_READ_FAILED',
        };
      }
    });
  }

  async function writeModState(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, error: 'INVALID_JSON' };
    }
    return withKeyLock('mods:state', async () => {
      try {
        const paths = await ensureInitialized();
        const primary = path.resolve(paths.settingsDir, FILE_MODS_CONFIG);
        const backup = path.resolve(paths.backupsDir, `${FILE_MODS_CONFIG}.bak`);
        if (
          !isInsideRoot(paths.settingsDir, primary) ||
          !isInsideRoot(paths.backupsDir, backup)
        ) {
          return { ok: false, error: 'INVALID_PATH' };
        }
        await writeJsonAtomic(primary, backup, payload);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: (err && err.message) || 'MOD_STATE_WRITE_FAILED',
        };
      }
    });
  }

  async function readModAsset(sourceId, relativePath) {
    const safeSource = sanitizeModSourceId(sourceId);
    const safeRel = sanitizeModRelativePath(relativePath);
    if (!safeSource || !safeRel) {
      return { ok: false, error: 'INVALID_MOD_ASSET_PATH' };
    }
    const ext = path.extname(safeRel).toLowerCase();
    const mimeType = ALLOWED_MOD_ASSET_MIME[ext];
    if (!mimeType || FORBIDDEN_MOD_EXTENSIONS.has(ext)) {
      return { ok: false, error: 'UNSUPPORTED_OR_FORBIDDEN_ASSET_TYPE' };
    }

    try {
      const paths = await ensureInitialized();
      const realModsDir = await fsp.realpath(paths.modsDir);
      const sourcePath = path.resolve(realModsDir, safeSource);
      const realSourcePath = await fsp.realpath(sourcePath);
      if (!isInsideRoot(realModsDir, realSourcePath)) {
        return { ok: false, error: 'PATH_OUTSIDE_MODS_DIR' };
      }

      const stat = await fsp.stat(realSourcePath);
      if (stat.isDirectory()) {
        const absAsset = path.resolve(realSourcePath, safeRel);
        const realAsset = await fsp.realpath(absAsset);
        if (!isInsideRoot(realSourcePath, realAsset)) {
          return { ok: false, error: 'ASSET_PATH_TRAVERSAL_BLOCKED' };
        }
        const aStat = await fsp.stat(realAsset);
        if (!aStat.isFile() || aStat.size > MAX_ASSET_READ_BYTES) {
          return { ok: false, error: 'ASSET_TOO_LARGE_OR_NOT_FILE' };
        }
        const buf = await fsp.readFile(realAsset);
        return {
          ok: true,
          mimeType,
          base64: buf.toString('base64'),
          sizeBytes: buf.length,
        };
      }

      if (stat.isFile() && isArchiveModFileName(safeSource)) {
        const archiveBuf = await fsp.readFile(realSourcePath);
        const entries = parseZipEntries(archiveBuf);
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
        const match = entries.find(
          (e) => !e.isDir && (e.name === `${stripPrefix}${safeRel}` || e.name === safeRel),
        );
        if (!match) {
          return { ok: false, error: 'ASSET_NOT_FOUND' };
        }
        const buf = extractZipEntryBuffer(archiveBuf, match);
        return {
          ok: true,
          mimeType,
          base64: buf.toString('base64'),
          sizeBytes: buf.length,
        };
      }

      return { ok: false, error: 'MOD_SOURCE_NOT_FOUND' };
    } catch (err) {
      return {
        ok: false,
        error: (err && err.message) || 'ASSET_READ_FAILED',
      };
    }
  }

  async function deleteMod(sourceId) {
    const safeSource = sanitizeModSourceId(sourceId);
    if (!safeSource) return { ok: false, error: 'INVALID_MOD_SOURCE_ID' };

    return withKeyLock(`mod:${safeSource}`, async () => {
      try {
        const paths = await ensureInitialized();
        const realModsDir = await fsp.realpath(paths.modsDir);
        const candidate = path.resolve(realModsDir, safeSource);
        if (!(await pathExists(candidate))) {
          return { ok: false, error: 'MOD_NOT_FOUND' };
        }
        const realTarget = await fsp.realpath(candidate);
        if (!isInsideRoot(realModsDir, realTarget)) {
          return { ok: false, error: 'PATH_OUTSIDE_MODS_DIR' };
        }
        await fsp.rm(realTarget, { recursive: true, force: true });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: (err && err.message) || 'MOD_DELETE_FAILED',
        };
      }
    });
  }

  async function collectInstalledModIds(realModsDir) {
    const installedIds = new Map();
    const entries = await fsp.readdir(realModsDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const safeId = sanitizeModSourceId(entry.name);
      if (!safeId) continue;
      if (entry.isDirectory()) {
        const scanned = await scanFolderMod(realModsDir, safeId);
        const parsed = scanned && scanned.manifestRaw ? parseValidJsonObject(scanned.manifestRaw) : null;
        if (parsed && typeof parsed.modId === 'string' && parsed.modId.trim()) {
          installedIds.set(parsed.modId.trim(), safeId);
        }
      } else if (entry.isFile() && isArchiveModFileName(safeId)) {
        const scanned = await scanArchiveMod(realModsDir, safeId);
        const parsed = scanned && scanned.manifestRaw ? parseValidJsonObject(scanned.manifestRaw) : null;
        if (parsed && typeof parsed.modId === 'string' && parsed.modId.trim()) {
          installedIds.set(parsed.modId.trim(), safeId);
        }
      }
    }
    return installedIds;
  }

  async function importModPackage(fileName, payload, options = {}, onProgress = null) {
    const safeName = sanitizeModSourceId(fileName);
    if (!safeName || !safeName.toLowerCase().endsWith('.woamod')) {
      return { ok: false, error: 'INVALID_MOD_PACKAGE_EXTENSION' };
    }

    let buf;
    if (Buffer.isBuffer(payload)) {
      buf = payload;
    } else if (payload instanceof Uint8Array) {
      buf = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
    } else if (typeof payload === 'string' && payload.trim()) {
      buf = Buffer.from(payload, 'base64');
    } else {
      return { ok: false, error: 'EMPTY_PACKAGE_DATA' };
    }

    if (buf.length < 22 || buf.length > MAX_IMPORT_PACKAGE_BYTES) {
      return { ok: false, error: 'INVALID_PACKAGE_SIZE' };
    }

    let entries;
    try {
      entries = parseZipEntries(buf);
    } catch (err) {
      return {
        ok: false,
        error: (err && err.message) || 'CORRUPT_MOD_ARCHIVE',
      };
    }

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

    const extractItems = [];
    let manifestEntry = null;
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
      const safeRel = sanitizeModRelativePath(rel);
      if (!safeRel || safeRel === FILE_WOAMOD_META || safeRel.endsWith(`/${FILE_WOAMOD_META}`)) {
        return { ok: false, error: 'PATH_TRAVERSAL_BLOCKED', detail: rel };
      }
      if (!entry.isDir) {
        const ext = path.extname(safeRel).toLowerCase();
        if (FORBIDDEN_MOD_EXTENSIONS.has(ext)) {
          return {
            ok: false,
            error: 'UNSAFE_EXECUTABLE_CONTENT',
            detail: safeRel,
          };
        }
        if (safeRel === 'mod.json') {
          manifestEntry = entry;
        }
      }
      extractItems.push({ rel: safeRel, entry });
    }

    if (!manifestEntry) {
      return { ok: false, error: 'REQUIRED_FILES_MISSING', detail: 'mod.json missing' };
    }

    let manifestObj;
    try {
      if (manifestEntry.uncompressedSize > MAX_JSON_ENTRY_BYTES) {
        return { ok: false, error: 'MANIFEST_TOO_LARGE_OR_INVALID' };
      }
      const mBuf = extractZipEntryBuffer(buf, manifestEntry);
      manifestObj = parseValidJsonObject(mBuf.toString('utf8'));
    } catch {
      return { ok: false, error: 'CORRUPT_MOD_ARCHIVE' };
    }

    if (!manifestObj || typeof manifestObj.modId !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(manifestObj.modId.trim())) {
      return { ok: false, error: 'REQUIRED_FILES_MISSING', detail: 'Invalid modId in mod.json' };
    }

    const modId = manifestObj.modId.trim();
    const rawFolder =
      options && typeof options.installFolderName === 'string' && options.installFolderName.trim()
        ? options.installFolderName.trim()
        : modId.replace(/[^A-Za-z0-9._-]/g, '_');
    const safeFolder = sanitizeModSourceId(rawFolder);
    if (!safeFolder || safeFolder.startsWith('.')) {
      return { ok: false, error: 'INVALID_MOD_SOURCE_ID' };
    }

    return withKeyLock(`mod:${safeFolder}`, async () => {
      let realStagingDir = null;
      let committed = false;
      try {
        const paths = await ensureInitialized();
        const realModsDir = await fsp.realpath(paths.modsDir);

        // Verify no duplicate modId exists in Mods/ and prevent overwriting existing folders
        const installedIds = await collectInstalledModIds(realModsDir);
        if (installedIds.has(modId)) {
          return {
            ok: false,
            error: 'DUPLICATE_MOD_ID',
            detail: `Conflicts with "${installedIds.get(modId)}"`,
          };
        }

        const finalTargetDir = path.resolve(realModsDir, safeFolder);
        if (!isInsideRoot(realModsDir, finalTargetDir)) {
          return { ok: false, error: 'PATH_TRAVERSAL_BLOCKED' };
        }
        if (await pathExists(finalTargetDir)) {
          return {
            ok: false,
            error: 'TARGET_ALREADY_EXISTS',
            detail: safeFolder,
          };
        }

        const stagingName = `${STAGING_DIR_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const stagingPath = path.resolve(realModsDir, stagingName);
        if (!isInsideRoot(realModsDir, stagingPath)) {
          return { ok: false, error: 'PATH_TRAVERSAL_BLOCKED' };
        }
        await fsp.mkdir(stagingPath, { recursive: true });
        realStagingDir = await fsp.realpath(stagingPath);
        if (!isInsideRoot(realModsDir, realStagingDir)) {
          throw new Error('PATH_TRAVERSAL_BLOCKED');
        }

        const fileItems = extractItems.filter((it) => !it.entry.isDir);
        const totalFiles = Math.max(1, fileItems.length);
        let doneFiles = 0;

        for (const item of extractItems) {
          const destPath = path.resolve(realStagingDir, item.rel);
          if (!isInsideRoot(realStagingDir, destPath)) {
            throw new Error('PATH_TRAVERSAL_BLOCKED');
          }

          if (item.entry.isDir) {
            await fsp.mkdir(destPath, { recursive: true });
            const realDir = await fsp.realpath(destPath);
            if (!isInsideRoot(realStagingDir, realDir)) {
              throw new Error('PATH_TRAVERSAL_BLOCKED');
            }
            continue;
          }

          const parentDir = path.dirname(destPath);
          await fsp.mkdir(parentDir, { recursive: true });
          const realParent = await fsp.realpath(parentDir);
          if (realParent !== realStagingDir && !isInsideRoot(realStagingDir, realParent)) {
            throw new Error('PATH_TRAVERSAL_BLOCKED');
          }

          const entryBuf = extractZipEntryBuffer(buf, item.entry);
          const relTop = item.rel.split('/')[0];
          const relExt = path.extname(item.rel).toLowerCase();
          if ((MOD_CONTENT_FOLDERS.has(relTop) && relExt === '.json') || relExt === '.woa3d') {
            JSON.parse(entryBuf.toString('utf8'));
          }

          await fsp.writeFile(destPath, entryBuf, { flag: 'wx' });
          doneFiles += 1;
          if (onProgress && (doneFiles % 5 === 0 || doneFiles === totalFiles)) {
            onProgress({
              stage: 'extracting',
              fileName: safeName,
              percent: Math.round((doneFiles / totalFiles) * 100),
              processedBytes: buf.length,
              totalBytes: buf.length,
              entriesDone: doneFiles,
              entriesTotal: totalFiles,
              currentEntry: item.rel,
            });
          }
        }

        const installedAtMs = Date.now();
        const metaPayload = {
          format: 'woamod',
          packageVersion: 1,
          modId,
          version: typeof manifestObj.version === 'string' ? manifestObj.version : '1.0.0',
          packageFileName: safeName,
          installedAtMs,
        };
        const metaPath = path.resolve(realStagingDir, FILE_WOAMOD_META);
        if (!isInsideRoot(realStagingDir, metaPath)) {
          throw new Error('PATH_TRAVERSAL_BLOCKED');
        }
        await fsp.writeFile(metaPath, JSON.stringify(metaPayload, null, 2), 'utf8');

        // Re-check right before atomic commit so nothing created in parallel is overwritten
        if (await pathExists(finalTargetDir)) {
          throw new Error('TARGET_ALREADY_EXISTS');
        }
        await fsp.rename(realStagingDir, finalTargetDir);
        committed = true;

        return {
          ok: true,
          sourceId: safeFolder,
          modId,
          sourcePath: finalTargetDir,
        };
      } catch (err) {
        return {
          ok: false,
          error: (err && err.message) || 'MOD_IMPORT_FAILED',
        };
      } finally {
        if (!committed && realStagingDir && (await pathExists(realStagingDir))) {
          await fsp.rm(realStagingDir, { recursive: true, force: true }).catch(() => {});
        }
      }
    });
  }

  return {
    ensureInitialized,
    resolvePaths,
    flushPendingWrites,
    listWorlds,
    readBundle,
    writeBundle,
    deleteWorld,
    readAllSettings,
    writeSetting,
    readProfile,
    writeProfile,
    getModsInfo,
    discoverMods,
    readModState,
    writeModState,
    readModAsset,
    deleteMod,
    importModPackage,
  };
}

module.exports = {
  APP_FOLDER_NAME,
  SETTINGS_FILE_MAP,
  STANDARD_MOD_FOLDERS,
  createDesktopStorageManager,
};
