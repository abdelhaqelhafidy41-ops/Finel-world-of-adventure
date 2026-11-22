const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  net,
  protocol,
  session,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  OfflineLanServer,
  discoverLanHosts,
  getPrimaryLanIp,
  DEFAULT_LAN_PORT,
} = require('./lanServer.cjs');

const lanServer = new OfflineLanServer();

const APP_NAME = 'World of Adventure';
const APP_SCHEME = 'app';
const APP_HOST = 'worldofadventure';
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const DEV_SERVER_URL = process.env.ELECTRON_START_URL || '';
const IS_DEV = Boolean(DEV_SERVER_URL) && !app.isPackaged;

app.setName(APP_NAME);
app.commandLine.appendSwitch('high-dpi-support', '1');

// Register custom secure scheme before app is ready so Vite's ES modules,
// relative ./assets/* paths, WebGL, and persistent localStorage saves work offline.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;

function resolveDistFile(requestUrl) {
  let pathname = '/index.html';
  try {
    const parsed = new URL(requestUrl);
    pathname = decodeURIComponent(parsed.pathname || '/');
  } catch {
    pathname = '/index.html';
  }

  if (pathname === '/' || pathname === '') {
    pathname = '/index.html';
  }

  const relativePath = pathname.replace(/^\/+/, '');
  const candidate = path.resolve(DIST_DIR, relativePath);

  // Prevent directory traversal outside dist/
  if (!candidate.startsWith(DIST_DIR)) {
    return path.join(DIST_DIR, 'index.html');
  }

  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate;
  }

  return path.join(DIST_DIR, 'index.html');
}

function registerAppProtocol() {
  protocol.handle(APP_SCHEME, (request) => {
    const filePath = resolveDistFile(request.url);
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function configureSessionPermissions() {
  const defaultSession = session.defaultSession;
  if (!defaultSession) return;

  const allowedPermissions = new Set([
    'pointerLock',
    'fullscreen',
    'media',
  ]);

  defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowedPermissions.has(permission));
  });

  defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return allowedPermissions.has(permission);
  });
}

function createMainWindow() {
  const windowIconPath = path.join(
    __dirname,
    process.platform === 'win32' ? 'icon.ico' : 'icon.png',
  );
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    icon: windowIconPath,
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0d1712',
    show: false,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: IS_DEV,
      backgroundThrottling: false,
    },
  });

  if (!IS_DEV) {
    Menu.setApplicationMenu(null);
    mainWindow.setMenuBarVisibility(false);
  }

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Support F11 fullscreen toggle cleanly & block browser/DevTools shortcuts in production
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    if (input.key === 'F11') {
      event.preventDefault();
      if (mainWindow) {
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
      }
      return;
    }

    if (!IS_DEV) {
      const ctrlOrMeta = input.control || input.meta;
      const lowerKey = input.key.toLowerCase();
      const isDevToolsShortcut =
        input.key === 'F12' ||
        (ctrlOrMeta && input.shift && (lowerKey === 'i' || lowerKey === 'j' || lowerKey === 'c'));
      const isReloadShortcut =
        input.key === 'F5' || (ctrlOrMeta && lowerKey === 'r');

      if (isDevToolsShortcut || isReloadShortcut) {
        event.preventDefault();
      }
    }
  });

  // Keep navigation strictly inside the local app
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (IS_DEV && targetUrl.startsWith(DEV_SERVER_URL)) {
      return;
    }
    if (!IS_DEV && targetUrl.startsWith(`${APP_SCHEME}://${APP_HOST}`)) {
      return;
    }
    event.preventDefault();
  });

  if (IS_DEV) {
    void mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    void mainWindow.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`);
  }
}

ipcMain.handle('desktop:toggle-fullscreen', () => {
  if (!mainWindow) return false;
  const next = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  return next;
});

ipcMain.handle('desktop:is-fullscreen', () => {
  return mainWindow ? mainWindow.isFullScreen() : false;
});

ipcMain.handle('desktop:quit-app', () => {
  void lanServer.stop();
  app.quit();
});

ipcMain.handle('lan:start-host', async (_event, opts = {}) => {
  try {
    const port = opts && typeof opts.port === 'number' ? opts.port : DEFAULT_LAN_PORT;
    return await lanServer.start(port, opts && opts.roomOptions ? opts.roomOptions : null);
  } catch (err) {
    const code = err && err.code ? String(err.code) : 'LAN_START_FAILED';
    const firewallHint =
      code === 'EACCES' || code === 'EPERM'
        ? 'Windows Firewall or network permissions blocked the local LAN server. Allow World of Adventure on Private Networks in Windows Defender Firewall.'
        : (err && err.message) || 'Failed to start local LAN server.';
    return { ok: false, error: code, message: firewallHint };
  }
});

ipcMain.handle('lan:stop-host', async () => {
  return lanServer.stop();
});

ipcMain.handle('lan:get-status', () => {
  return lanServer.getStatus();
});

ipcMain.handle('lan:get-local-ip', () => {
  return getPrimaryLanIp();
});

const WORLD_STORAGE_LOCK = new Map();

function getWorldsRoot() {
  return path.join(app.getPath('userData'), 'GameData', 'Worlds');
}

function sanitizeWorldId(worldId) {
  if (typeof worldId !== 'string') return null;
  const trimmed = worldId.trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(trimmed)) return null;
  if (trimmed === '.' || trimmed === '..') return null;
  const root = path.resolve(getWorldsRoot());
  const target = path.resolve(root, trimmed);
  if (!target.startsWith(root + path.sep)) return null;
  return { id: trimmed, dir: target };
}

function parseValidJson(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readJsonFileWithBackup(filePath) {
  const candidates = [filePath, `${filePath}.bak`];
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const raw = fs.readFileSync(candidate, 'utf8');
      const parsed = parseValidJson(raw);
      if (parsed) {
        if (candidate !== filePath) {
          try {
            fs.copyFileSync(candidate, filePath);
          } catch {
            // Ignore repair copy failure; parsed data is still valid
          }
        }
        return parsed;
      }
    } catch {
      // Try backup
    }
  }
  return null;
}

function writeJsonFileAtomic(filePath, dataObj) {
  if (!dataObj || typeof dataObj !== 'object' || Array.isArray(dataObj)) {
    throw new Error('Invalid JSON payload for world save file.');
  }
  const serialized = JSON.stringify(dataObj);
  // Verify serialization produces valid JSON before touching disk
  if (!parseValidJson(serialized)) {
    throw new Error('Failed JSON serialization verification.');
  }
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  const bakPath = `${filePath}.bak`;
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeSync(fd, serialized, 0, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (fs.existsSync(filePath)) {
    try {
      const existingRaw = fs.readFileSync(filePath, 'utf8');
      if (parseValidJson(existingRaw)) {
        fs.copyFileSync(filePath, bakPath);
      }
    } catch {
      // Ignore if existing file was unreadable
    }
  }
  fs.renameSync(tmpPath, filePath);
}

async function withWorldLock(worldId, task) {
  const prev = WORLD_STORAGE_LOCK.get(worldId) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  WORLD_STORAGE_LOCK.set(worldId, current);
  try {
    await prev;
    return await task();
  } finally {
    release();
    if (WORLD_STORAGE_LOCK.get(worldId) === current) {
      WORLD_STORAGE_LOCK.delete(worldId);
    }
  }
}

ipcMain.handle('worldStorage:listWorlds', async () => {
  try {
    const root = getWorldsRoot();
    if (!fs.existsSync(root)) return { ok: true, worldIds: [] };
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const worldIds = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const safe = sanitizeWorldId(entry.name);
      if (!safe) continue;
      const worldDataPath = path.join(safe.dir, 'world-data.json');
      if (fs.existsSync(worldDataPath) || fs.existsSync(`${worldDataPath}.bak`)) {
        worldIds.push(safe.id);
      }
    }
    return { ok: true, worldIds };
  } catch (err) {
    return { ok: false, worldIds: [], error: (err && err.message) || 'LIST_FAILED' };
  }
});

ipcMain.handle('worldStorage:readBundle', async (_event, worldId) => {
  const safe = sanitizeWorldId(worldId);
  if (!safe) return { ok: false, error: 'INVALID_WORLD_ID' };
  return withWorldLock(safe.id, () => {
    try {
      const worldData = readJsonFileWithBackup(path.join(safe.dir, 'world-data.json'));
      if (!worldData) {
        return { ok: false, error: 'WORLD_NOT_FOUND' };
      }
      const settings = readJsonFileWithBackup(path.join(safe.dir, 'settings.json')) || {};
      const playerData = readJsonFileWithBackup(path.join(safe.dir, 'player-data.json')) || {};
      const worldState = readJsonFileWithBackup(path.join(safe.dir, 'world-state.json')) || {};
      const saveVersion =
        typeof worldData.saveVersion === 'number' ? worldData.saveVersion : 1;
      return {
        ok: true,
        bundle: {
          saveVersion,
          worldData,
          settings,
          playerData,
          worldState,
        },
      };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'READ_FAILED' };
    }
  });
});

ipcMain.handle('worldStorage:writeBundle', async (_event, worldId, bundle) => {
  const safe = sanitizeWorldId(worldId);
  if (!safe) return { ok: false, error: 'INVALID_WORLD_ID' };
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
  return withWorldLock(safe.id, () => {
    try {
      fs.mkdirSync(safe.dir, { recursive: true });
      const worldDataWithVersion = {
        ...bundle.worldData,
        saveVersion: typeof bundle.saveVersion === 'number' ? bundle.saveVersion : 1,
      };
      writeJsonFileAtomic(path.join(safe.dir, 'world-data.json'), worldDataWithVersion);
      writeJsonFileAtomic(path.join(safe.dir, 'settings.json'), bundle.settings);
      writeJsonFileAtomic(path.join(safe.dir, 'player-data.json'), bundle.playerData);
      writeJsonFileAtomic(path.join(safe.dir, 'world-state.json'), bundle.worldState);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'WRITE_FAILED' };
    }
  });
});

ipcMain.handle('worldStorage:deleteWorld', async (_event, worldId) => {
  const safe = sanitizeWorldId(worldId);
  if (!safe) return { ok: false, error: 'INVALID_WORLD_ID' };
  return withWorldLock(safe.id, () => {
    try {
      if (fs.existsSync(safe.dir)) {
        fs.rmSync(safe.dir, { recursive: true, force: true });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'DELETE_FAILED' };
    }
  });
});

ipcMain.handle('lan:discover', async (_event, timeoutMs = 1500) => {
  return discoverLanHosts(timeoutMs);
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  if (!IS_DEV) {
    registerAppProtocol();
  }
  configureSessionPermissions();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  void lanServer.stop();
});

app.on('window-all-closed', () => {
  void lanServer.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
