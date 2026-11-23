const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const APP_FOLDER_NAME = 'World of Adventure';

const DIR_WORLDS = 'Worlds';
const DIR_SETTINGS = 'Settings';
const DIR_PROFILES = 'Profiles';
const DIR_BACKUPS = 'Backups';
const DIR_WORLD_BACKUPS = 'backups';

const FILE_WORLD_DATA = 'world-data.json';
const FILE_WORLD_SETTINGS = 'world-settings.json';
const FILE_LEGACY_WORLD_SETTINGS = 'settings.json';
const FILE_PLAYER_DATA = 'player-data.json';
const FILE_WORLD_STATE = 'world-state.json';
const FILE_PROFILE = 'profile.json';

const SETTINGS_FILE_MAP = Object.freeze({
  game: 'game-settings.json',
  graphics: 'graphics-settings.json',
  audio: 'audio-settings.json',
  controls: 'controls-settings.json',
  language: 'language-settings.json',
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
      legacyWorldsDir: resolveLegacyWorldsRoot(),
    };
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
      if (isWindows) {
        await fsp.mkdir(paths.settingsDir, { recursive: true });
        await fsp.mkdir(paths.profilesDir, { recursive: true });
        await fsp.mkdir(paths.backupsDir, { recursive: true });
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
  };
}

module.exports = {
  APP_FOLDER_NAME,
  SETTINGS_FILE_MAP,
  createDesktopStorageManager,
};
