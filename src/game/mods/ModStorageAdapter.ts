import {
  detectRuntimePlatform,
  type ModAssetReadResult,
  type ModInstallProgressBridgePayload,
  type RawDiscoveredModEntry,
  type RawModAssetFile,
  type RawModContentFile,
  type RuntimePlatform,
} from '../../utils/platformExit';
import {
  CURRENT_GAME_VERSION,
  MOD_PACKAGE_EXTENSION,
  STANDARD_MOD_FOLDERS,
  type ModInstallProgress,
  type ModRecord,
  type ModStateConfig,
} from './modTypes';
import {
  readFileChunksWithProgress,
  validateWoamodArchiveBytes,
} from './WoamodPackageValidator';

const WEB_MODS_STATE_KEY = 'woa_mods_state_v1';
const WEB_MODS_DB_NAME = 'woa_local_mods_db_v1';
const WEB_MODS_STORE_NAME = 'packages';

const DEFAULT_MOD_STATE: ModStateConfig = {
  version: 1,
  enabledByModId: {},
  priorityByModId: {},
};

const FORBIDDEN_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.wasm',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.dex',
  '.jar',
  '.apk',
  '.class',
  '.sh',
  '.bat',
  '.cmd',
  '.ps1',
  '.vbs',
  '.php',
  '.py',
  '.rb',
  '.html',
  '.htm',
  '.svg',
]);

const ALLOWED_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
  '.obj': 'text/plain',
  '.mtl': 'text/plain',
  '.bin': 'application/octet-stream',
  '.woa3d': 'application/json',
  '.json': 'application/json',
  '.txt': 'text/plain',
};

const STANDARD_FOLDER_SET = new Set<string>(STANDARD_MOD_FOLDERS);

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function sanitizeSourceId(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') return null;
  if (/[/\\<>:"|?*\0]/.test(trimmed)) return null;
  return trimmed;
}

function normalizeStateConfig(raw: unknown): ModStateConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_MOD_STATE };
  }
  const obj = raw as Record<string, unknown>;
  const enabledByModId: Record<string, boolean> = {};
  const priorityByModId: Record<string, number> = {};

  if (obj.enabledByModId && typeof obj.enabledByModId === 'object') {
    for (const [k, v] of Object.entries(obj.enabledByModId as Record<string, unknown>)) {
      if (typeof v === 'boolean') enabledByModId[k] = v;
    }
  }
  if (obj.priorityByModId && typeof obj.priorityByModId === 'object') {
    for (const [k, v] of Object.entries(obj.priorityByModId as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        priorityByModId[k] = Math.trunc(v);
      }
    }
  }

  return {
    version: typeof obj.version === 'number' ? obj.version : 1,
    enabledByModId,
    priorityByModId,
    updatedAtMs: typeof obj.updatedAtMs === 'number' ? obj.updatedAtMs : undefined,
  };
}

function fileToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

interface StoredWebZipPackage {
  sourceId: string;
  packageFileName?: string;
  installedAtMs?: number;
  modifiedAtMs: number;
  base64Content: string;
}

interface WebZipEntry {
  name: string;
  isDir: boolean;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function openWebModsDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(WEB_MODS_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(WEB_MODS_STORE_NAME)) {
          db.createObjectStore(WEB_MODS_STORE_NAME, { keyPath: 'sourceId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readAllWebPackages(): Promise<StoredWebZipPackage[]> {
  const db = await openWebModsDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(WEB_MODS_STORE_NAME, 'readonly');
      const req = tx.objectStore(WEB_MODS_STORE_NAME).getAll();
      req.onsuccess = () => {
        resolve(Array.isArray(req.result) ? (req.result as StoredWebZipPackage[]) : []);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

async function putWebPackage(pkg: StoredWebZipPackage): Promise<void> {
  const db = await openWebModsDb();
  if (!db) throw new Error('INDEXEDDB_UNAVAILABLE');
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WEB_MODS_STORE_NAME, 'readwrite');
    tx.objectStore(WEB_MODS_STORE_NAME).put(pkg);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('WEB_MOD_SAVE_FAILED'));
  });
}

async function deleteWebPackage(sourceId: string): Promise<void> {
  const db = await openWebModsDb();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(WEB_MODS_STORE_NAME, 'readwrite');
    tx.objectStore(WEB_MODS_STORE_NAME).delete(sourceId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

function parseWebZipDirectory(bytes: Uint8Array): WebZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  const minOffset = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('CORRUPT_ZIP_EOCD');

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  if (totalEntries > 2000) throw new Error('MOD_TOO_MANY_FILES');

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const entries: WebZipEntry[] = [];
  let cursor = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error('CORRUPT_ZIP_CENTRAL_DIR');
    }
    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const rawName = decoder
      .decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen))
      .replace(/\\/g, '/');

    if (
      rawName.startsWith('/') ||
      rawName.includes('..') ||
      rawName.includes('\0')
    ) {
      throw new Error('ZIP_PATH_TRAVERSAL_BLOCKED');
    }
    if (uncompressedSize > 16 * 1024 * 1024) {
      throw new Error('ZIP_ENTRY_TOO_LARGE');
    }

    entries.push({
      name: rawName,
      isDir: rawName.endsWith('/'),
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    cursor += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

async function extractWebZipEntryBytes(
  bytes: Uint8Array,
  entry: WebZipEntry,
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
  if (dataEnd > bytes.length) throw new Error('CORRUPT_ZIP_BOUNDS');
  const slice = bytes.subarray(dataStart, dataEnd);

  if (entry.compressionMethod === 0) {
    return slice;
  }
  if (entry.compressionMethod === 8 && typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([slice.slice()])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }
  throw new Error('UNSUPPORTED_ZIP_COMPRESSION');
}

async function scanWebZipPackage(
  pkg: StoredWebZipPackage,
): Promise<RawDiscoveredModEntry> {
  const base: RawDiscoveredModEntry = {
    sourceId: pkg.sourceId,
    sourceType: 'archive',
    installKind: 'woamod',
    packageFileName: pkg.packageFileName || pkg.sourceId,
    installedAtMs: pkg.installedAtMs || pkg.modifiedAtMs,
    sourcePath: `indexeddb://${pkg.sourceId}`,
    modifiedAtMs: pkg.modifiedAtMs,
    manifestRaw: null,
    manifestError: null,
    presentFolders: [],
    contentFiles: [],
    assetFiles: [],
    executableFiles: [],
    archiveCorrupt: false,
  };

  try {
    const bytes = base64ToBytes(pkg.base64Content);
    const entries = parseWebZipDirectory(bytes);

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
    const contentFiles: RawModContentFile[] = [];
    const assetFiles: RawModAssetFile[] = [];
    const executableFiles: string[] = [];
    const decoder = new TextDecoder('utf-8');

    for (const entry of entries) {
      let rel = entry.name;
      if (stripPrefix && rel.startsWith(stripPrefix)) {
        rel = rel.slice(stripPrefix.length);
      }
      rel = rel.replace(/^\/+/, '');
      if (!rel) continue;

      const parts = rel.split('/');
      const firstSeg = parts[0].toLowerCase();
      if (STANDARD_FOLDER_SET.has(firstSeg)) {
        folderSet.add(firstSeg);
      }
      const secondSeg = firstSeg === 'assets' && parts[1] ? parts[1].toLowerCase() : null;
      if (secondSeg && STANDARD_FOLDER_SET.has(secondSeg)) {
        folderSet.add(secondSeg);
      }
      if (entry.isDir) continue;

      const ext = getExtension(rel);
      if (FORBIDDEN_EXTENSIONS.has(ext)) {
        executableFiles.push(rel);
        continue;
      }

      if (rel === 'mod.json') {
        const extracted = await extractWebZipEntryBytes(bytes, entry);
        base.manifestRaw = decoder.decode(extracted);
        continue;
      }

      const category =
        secondSeg && STANDARD_FOLDER_SET.has(secondSeg)
          ? secondSeg
          : STANDARD_FOLDER_SET.has(firstSeg)
            ? firstSeg
            : 'other';
      if (ext === '.json') {
        const extracted = await extractWebZipEntryBytes(bytes, entry);
        contentFiles.push({
          category,
          relativePath: rel,
          rawText: decoder.decode(extracted),
        });
      } else if (ext === '.woa3d' && entry.uncompressedSize <= 2 * 1024 * 1024) {
        const extracted = await extractWebZipEntryBytes(bytes, entry);
        assetFiles.push({
          category,
          relativePath: rel,
          sizeBytes: entry.uncompressedSize,
          rawText: decoder.decode(extracted),
        });
      } else {
        assetFiles.push({
          category,
          relativePath: rel,
          sizeBytes: entry.uncompressedSize,
        });
      }
    }

    base.presentFolders = Array.from(folderSet);
    base.contentFiles = contentFiles;
    base.assetFiles = assetFiles;
    base.executableFiles = executableFiles;
    if (base.manifestRaw === null) {
      base.manifestError = 'MISSING_MOD_JSON';
    }
  } catch (err) {
    base.archiveCorrupt = true;
    base.archiveError = err instanceof Error ? err.message : 'CORRUPT_MOD_ARCHIVE';
  }

  return base;
}

export interface ModStorageInfo {
  ok: boolean;
  platform: RuntimePlatform;
  modsDir: string;
  writable: boolean;
  error?: string;
}

export class ModStorageAdapter {
  public getPlatform(): RuntimePlatform {
    return detectRuntimePlatform();
  }

  public async getModsInfo(): Promise<ModStorageInfo> {
    const platform = this.getPlatform();

    if (platform === 'electron' && window.desktopApp?.modStorage) {
      try {
        const res = await window.desktopApp.modStorage.getInfo();
        return {
          ok: Boolean(res.ok),
          platform: 'electron',
          modsDir: res.modsDir || 'Documents/World of Adventure/Mods/',
          writable: Boolean(res.writable),
          error: res.error,
        };
      } catch (err) {
        return {
          ok: false,
          platform: 'electron',
          modsDir: 'Documents/World of Adventure/Mods/',
          writable: false,
          error: err instanceof Error ? err.message : 'MODS_INFO_ERROR',
        };
      }
    }

    if (platform === 'android' && window.AndroidNativeBridge?.getModsInfo) {
      try {
        const parsed = JSON.parse(window.AndroidNativeBridge.getModsInfo()) as {
          ok?: boolean;
          modsDir?: string;
          writable?: boolean;
          error?: string;
        };
        return {
          ok: Boolean(parsed.ok),
          platform: 'android',
          modsDir: parsed.modsDir || '/storage/emulated/0/World of Adventure/Mods/',
          writable: Boolean(parsed.writable),
          error: parsed.error,
        };
      } catch (err) {
        return {
          ok: false,
          platform: 'android',
          modsDir: '/storage/emulated/0/World of Adventure/Mods/',
          writable: false,
          error: err instanceof Error ? err.message : 'ANDROID_MODS_INFO_ERROR',
        };
      }
    }

    return {
      ok: true,
      platform: 'web',
      modsDir: 'Browser Local Mods (IndexedDB)',
      writable: true,
    };
  }

  public async discoverRawMods(): Promise<{
    ok: boolean;
    modsDir: string;
    entries: RawDiscoveredModEntry[];
    error?: string;
  }> {
    const platform = this.getPlatform();

    if (platform === 'electron' && window.desktopApp?.modStorage) {
      return window.desktopApp.modStorage.discoverMods();
    }

    if (platform === 'android' && window.AndroidNativeBridge?.listLocalMods) {
      try {
        const parsed = JSON.parse(window.AndroidNativeBridge.listLocalMods()) as {
          ok?: boolean;
          modsDir?: string;
          entries?: RawDiscoveredModEntry[];
          error?: string;
        };
        return {
          ok: Boolean(parsed.ok),
          modsDir: parsed.modsDir || '/storage/emulated/0/World of Adventure/Mods/',
          entries: Array.isArray(parsed.entries) ? parsed.entries : [],
          error: parsed.error,
        };
      } catch (err) {
        return {
          ok: false,
          modsDir: '/storage/emulated/0/World of Adventure/Mods/',
          entries: [],
          error: err instanceof Error ? err.message : 'ANDROID_DISCOVER_ERROR',
        };
      }
    }

    const packages = await readAllWebPackages();
    const entries = await Promise.all(packages.map((pkg) => scanWebZipPackage(pkg)));
    return {
      ok: true,
      modsDir: 'Browser Local Mods (IndexedDB)',
      entries,
    };
  }

  public async readState(): Promise<ModStateConfig> {
    const platform = this.getPlatform();

    if (platform === 'electron' && window.desktopApp?.modStorage) {
      try {
        const res = await window.desktopApp.modStorage.readState();
        if (res.ok && res.state) {
          const normalized = normalizeStateConfig(res.state);
          this.writeLocalStateFallback(normalized);
          return normalized;
        }
      } catch {
        // Fallback cleanly to local mirror
      }
    }

    if (platform === 'android' && window.AndroidNativeBridge?.readModState) {
      try {
        const parsed = JSON.parse(window.AndroidNativeBridge.readModState()) as {
          ok?: boolean;
          state?: unknown;
        };
        if (parsed.ok && parsed.state) {
          const normalized = normalizeStateConfig(parsed.state);
          this.writeLocalStateFallback(normalized);
          return normalized;
        }
      } catch {
        // Fallback cleanly to local mirror
      }
    }

    return this.readLocalStateFallback();
  }

  public async writeState(state: ModStateConfig): Promise<boolean> {
    const clean: ModStateConfig = {
      ...state,
      version: 1,
      updatedAtMs: Date.now(),
    };
    this.writeLocalStateFallback(clean);
    const platform = this.getPlatform();

    if (platform === 'electron' && window.desktopApp?.modStorage) {
      const res = await window.desktopApp.modStorage.writeState(
        clean as unknown as Record<string, unknown>,
      );
      return Boolean(res.ok);
    }

    if (platform === 'android' && window.AndroidNativeBridge?.writeModState) {
      try {
        const res = JSON.parse(
          window.AndroidNativeBridge.writeModState(JSON.stringify(clean)),
        ) as { ok?: boolean };
        return Boolean(res.ok);
      } catch {
        return false;
      }
    }

    return true;
  }

  public async readAsset(
    sourceId: string,
    relativePath: string,
  ): Promise<ModAssetReadResult> {
    const platform = this.getPlatform();

    if (platform === 'electron' && window.desktopApp?.modStorage) {
      return window.desktopApp.modStorage.readAsset(sourceId, relativePath);
    }

    if (platform === 'android' && window.AndroidNativeBridge?.readModAsset) {
      try {
        return JSON.parse(
          window.AndroidNativeBridge.readModAsset(sourceId, relativePath),
        ) as ModAssetReadResult;
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'ANDROID_ASSET_READ_FAILED',
        };
      }
    }

    const packages = await readAllWebPackages();
    const pkg = packages.find((p) => p.sourceId === sourceId);
    if (!pkg) return { ok: false, error: 'MOD_NOT_FOUND' };
    try {
      const bytes = base64ToBytes(pkg.base64Content);
      const entries = parseWebZipDirectory(bytes);
      const ext = getExtension(relativePath);
      const mimeType = ALLOWED_MIME_TYPES[ext];
      if (!mimeType || FORBIDDEN_EXTENSIONS.has(ext)) {
        return { ok: false, error: 'FORBIDDEN_OR_UNSUPPORTED_ASSET' };
      }
      const match = entries.find(
        (e) => !e.isDir && (e.name === relativePath || e.name.endsWith(`/${relativePath}`)),
      );
      if (!match) return { ok: false, error: 'ASSET_NOT_FOUND' };
      const assetBytes = await extractWebZipEntryBytes(bytes, match);
      return {
        ok: true,
        mimeType,
        base64: fileToBase64(assetBytes),
        sizeBytes: assetBytes.length,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'WEB_ASSET_READ_FAILED',
      };
    }
  }

  public async deleteMod(sourceId: string): Promise<{ ok: boolean; error?: string }> {
    const safeSource = sanitizeSourceId(sourceId);
    if (!safeSource) return { ok: false, error: 'INVALID_SOURCE_ID' };
    const platform = this.getPlatform();

    if (platform === 'electron' && window.desktopApp?.modStorage) {
      return window.desktopApp.modStorage.deleteMod(safeSource);
    }

    if (platform === 'android' && window.AndroidNativeBridge?.deleteLocalMod) {
      try {
        return JSON.parse(
          window.AndroidNativeBridge.deleteLocalMod(safeSource),
        ) as { ok: boolean; error?: string };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'ANDROID_DELETE_FAILED',
        };
      }
    }

    await deleteWebPackage(safeSource);
    return { ok: true };
  }

  public async importPackageFile(
    file: File,
    options: {
      existingMods?: ModRecord[];
      gameVersion?: string;
      onProgress?: (progress: ModInstallProgress) => void;
    } = {},
  ): Promise<{
    ok: boolean;
    sourceId?: string;
    modId?: string;
    error?: string;
    detail?: string;
  }> {
    const safeName = sanitizeSourceId(file.name);
    const lower = safeName?.toLowerCase() ?? '';
    const emit = (progress: ModInstallProgress) => {
      options.onProgress?.(progress);
    };

    if (!safeName || !lower.endsWith(MOD_PACKAGE_EXTENSION)) {
      emit({
        active: false,
        fileName: file.name,
        stage: 'failed',
        percent: 0,
        processedBytes: 0,
        totalBytes: file.size || 0,
        message: 'INVALID_MOD_PACKAGE_EXTENSION',
      });
      return { ok: false, error: 'INVALID_MOD_PACKAGE_EXTENSION' };
    }

    let bytes: Uint8Array;
    try {
      bytes = await readFileChunksWithProgress(file, emit);
    } catch (err) {
      const code = err instanceof Error ? err.message : 'INVALID_PACKAGE_SIZE';
      emit({
        active: false,
        fileName: safeName,
        stage: 'failed',
        percent: 0,
        processedBytes: 0,
        totalBytes: file.size || 0,
        message: code,
      });
      return { ok: false, error: code };
    }

    const validation = await validateWoamodArchiveBytes(bytes, safeName, {
      gameVersion: options.gameVersion ?? CURRENT_GAME_VERSION,
      existingMods: options.existingMods ?? [],
      onProgress: emit,
    });

    if (!validation.ok || !validation.manifest || !validation.installFolderName) {
      emit({
        active: false,
        fileName: safeName,
        stage: 'cleaning_up',
        percent: 100,
        processedBytes: bytes.length,
        totalBytes: bytes.length,
        message: validation.errorCode || 'MOD_VALIDATION_FAILED',
      });
      return {
        ok: false,
        error: validation.errorCode || 'MOD_VALIDATION_FAILED',
        detail: validation.detail || validation.message,
      };
    }

    const platform = this.getPlatform();

    if (platform === 'electron' && window.desktopApp?.modStorage) {
      let unsubProgress: (() => void) | undefined;
      if (window.desktopApp.modStorage.onInstallProgress) {
        unsubProgress = window.desktopApp.modStorage.onInstallProgress(
          (payload: ModInstallProgressBridgePayload) => {
            const pct =
              payload.stage === 'extracting'
                ? 58 + Math.round((Math.min(100, Math.max(0, payload.percent)) / 100) * 36)
                : Math.min(100, Math.max(58, payload.percent));
            emit({
              active: payload.stage !== 'completed' && payload.stage !== 'failed',
              fileName: payload.fileName || safeName,
              stage: payload.stage,
              percent: pct,
              processedBytes: payload.processedBytes ?? bytes.length,
              totalBytes: payload.totalBytes ?? bytes.length,
              entriesDone: payload.entriesDone,
              entriesTotal: payload.entriesTotal,
              currentEntry: payload.currentEntry,
              message: payload.message,
            });
          },
        );
      }

      try {
        emit({
          active: true,
          fileName: safeName,
          stage: 'extracting',
          percent: 60,
          processedBytes: bytes.length,
          totalBytes: bytes.length,
          entriesDone: 0,
          entriesTotal: validation.entryCount,
        });
        const res = await window.desktopApp.modStorage.importPackage(safeName, bytes, {
          expectedModId: validation.manifest.modId,
          installFolderName: validation.installFolderName,
        });
        if (res.ok) {
          emit({
            active: true,
            fileName: safeName,
            stage: 'finalizing',
            percent: 96,
            processedBytes: bytes.length,
            totalBytes: bytes.length,
            entriesDone: validation.entryCount,
            entriesTotal: validation.entryCount,
          });
        } else {
          emit({
            active: false,
            fileName: safeName,
            stage: 'failed',
            percent: 0,
            processedBytes: 0,
            totalBytes: bytes.length,
            message: res.error,
          });
        }
        return res;
      } finally {
        unsubProgress?.();
      }
    }

    if (platform === 'android' && window.AndroidNativeBridge?.importModPackage) {
      emit({
        active: true,
        fileName: safeName,
        stage: 'extracting',
        percent: 65,
        processedBytes: bytes.length,
        totalBytes: bytes.length,
        entriesDone: 0,
        entriesTotal: validation.entryCount,
      });
      try {
        const b64 = fileToBase64(bytes);
        const res = JSON.parse(
          window.AndroidNativeBridge.importModPackage(safeName, b64),
        ) as { ok: boolean; sourceId?: string; modId?: string; error?: string; detail?: string };
        emit({
          active: res.ok,
          fileName: safeName,
          stage: res.ok ? 'finalizing' : 'failed',
          percent: res.ok ? 96 : 0,
          processedBytes: bytes.length,
          totalBytes: bytes.length,
          message: res.error,
        });
        return res;
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'ANDROID_IMPORT_FAILED',
        };
      }
    }

    // Web / IndexedDB fallback installation
    const installKey = validation.installFolderName;
    const totalEntries = Math.max(1, validation.entryCount ?? 1);
    for (let step = 1; step <= 4; step++) {
      emit({
        active: true,
        fileName: safeName,
        stage: 'extracting',
        percent: 60 + step * 8,
        processedBytes: bytes.length,
        totalBytes: bytes.length,
        entriesDone: Math.min(totalEntries, Math.round((totalEntries * step) / 4)),
        entriesTotal: totalEntries,
      });
      await new Promise((resolve) => window.setTimeout(resolve, 16));
    }

    const b64 = fileToBase64(bytes);
    await putWebPackage({
      sourceId: installKey,
      packageFileName: safeName,
      installedAtMs: Date.now(),
      modifiedAtMs: file.lastModified || Date.now(),
      base64Content: b64,
    });
    emit({
      active: true,
      fileName: safeName,
      stage: 'finalizing',
      percent: 96,
      processedBytes: bytes.length,
      totalBytes: bytes.length,
      entriesDone: totalEntries,
      entriesTotal: totalEntries,
    });
    return { ok: true, sourceId: installKey, modId: validation.manifest.modId };
  }

  public hasNativeModPicker(): boolean {
    return (
      this.getPlatform() === 'android' &&
      typeof window.AndroidNativeBridge?.requestImportModPackage === 'function'
    );
  }

  public requestNativeModImport(
    onProgress?: (progress: ModInstallProgress) => void,
  ): Promise<{
    ok: boolean;
    cancelled?: boolean;
    sourceId?: string;
    modId?: string;
    error?: string;
    detail?: string;
  }> {
    if (!this.hasNativeModPicker()) {
      return Promise.resolve({ ok: false, error: 'NATIVE_PICKER_UNAVAILABLE' });
    }
    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        if (window.__onAndroidModImported === onResult) {
          delete window.__onAndroidModImported;
        }
        if (window.__onAndroidModInstallProgress === onProgressMsg) {
          delete window.__onAndroidModInstallProgress;
        }
      };
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ ok: false, error: 'IMPORT_TIMEOUT' });
      }, 300000);

      const onProgressMsg = (progressJson: string) => {
        if (settled || !onProgress) return;
        try {
          const p = JSON.parse(progressJson) as ModInstallProgressBridgePayload;
          onProgress({
            active: p.stage !== 'completed' && p.stage !== 'failed',
            fileName: p.fileName || 'mod.woamod',
            stage: p.stage || 'extracting',
            percent: Math.min(100, Math.max(0, Number(p.percent) || 0)),
            processedBytes: Number(p.processedBytes) || 0,
            totalBytes: Number(p.totalBytes) || 0,
            entriesDone: p.entriesDone,
            entriesTotal: p.entriesTotal,
            currentEntry: p.currentEntry,
            message: p.message,
          });
        } catch {
          // Ignore malformed progress ticks
        }
      };

      const onResult = (resultJson: string) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        cleanup();
        try {
          const parsed = JSON.parse(resultJson) as {
            ok?: boolean;
            sourceId?: string;
            modId?: string;
            error?: string;
            detail?: string;
          };
          if (parsed.error === 'IMPORT_CANCELLED') {
            resolve({ ok: false, cancelled: true, error: 'IMPORT_CANCELLED' });
            return;
          }
          resolve({
            ok: Boolean(parsed.ok),
            sourceId: parsed.sourceId,
            modId: parsed.modId,
            error: parsed.error,
            detail: parsed.detail,
          });
        } catch {
          resolve({ ok: false, error: 'MOD_IMPORT_FAILED' });
        }
      };

      window.__onAndroidModInstallProgress = onProgressMsg;
      window.__onAndroidModImported = onResult;
      try {
        window.AndroidNativeBridge?.requestImportModPackage?.();
      } catch (err) {
        settled = true;
        window.clearTimeout(timer);
        cleanup();
        resolve({
          ok: false,
          error: err instanceof Error ? err.message : 'NATIVE_PICKER_FAILED',
        });
      }
    });
  }

  public async openModsFolder(): Promise<{ ok: boolean; error?: string }> {
    const platform = this.getPlatform();
    if (platform === 'electron' && window.desktopApp?.modStorage?.openModsFolder) {
      return window.desktopApp.modStorage.openModsFolder();
    }
    return { ok: false, error: 'OPEN_FOLDER_UNSUPPORTED' };
  }

  private readLocalStateFallback(): ModStateConfig {
    try {
      const raw = window.localStorage.getItem(WEB_MODS_STATE_KEY);
      if (!raw) return { ...DEFAULT_MOD_STATE };
      return normalizeStateConfig(JSON.parse(raw));
    } catch {
      return { ...DEFAULT_MOD_STATE };
    }
  }

  private writeLocalStateFallback(state: ModStateConfig): void {
    try {
      window.localStorage.setItem(WEB_MODS_STATE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage quota issues
    }
  }
}
