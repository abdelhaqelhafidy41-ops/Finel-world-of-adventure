export type RuntimePlatform = 'electron' | 'android' | 'web';

export interface DesktopLanBridgeApi {
  startHost: (options?: {
    port?: number;
    roomOptions?: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  stopHost: () => Promise<Record<string, unknown>>;
  getStatus: () => Promise<Record<string, unknown>>;
  getLocalIp: () => Promise<{ ok: boolean; ip: string | null }>;
  discover: (timeoutMs?: number) => Promise<{
    ok: boolean;
    hosts?: Array<Record<string, unknown>>;
    error?: string;
  }>;
}

export interface DesktopWorldStorageApi {
  listWorlds: () => Promise<{ ok: boolean; worldIds?: string[]; error?: string }>;
  readBundle: (worldId: string) => Promise<{
    ok: boolean;
    bundle?: Record<string, unknown>;
    error?: string;
  }>;
  writeBundle: (
    worldId: string,
    bundle: Record<string, unknown>,
  ) => Promise<{ ok: boolean; error?: string }>;
  deleteWorld: (worldId: string) => Promise<{ ok: boolean; error?: string }>;
}

export interface DesktopSettingsStorageApi {
  readAll: () => Promise<{
    ok: boolean;
    enabled?: boolean;
    hasAny?: boolean;
    rootPath?: string;
    settings?: Record<string, Record<string, unknown>>;
    error?: string;
  }>;
  writeSetting: (
    settingKey: 'game' | 'graphics' | 'audio' | 'controls' | 'language',
    payload: Record<string, unknown>,
  ) => Promise<{ ok: boolean; error?: string }>;
  readProfile: () => Promise<{
    ok: boolean;
    profile?: Record<string, unknown>;
    error?: string;
  }>;
  writeProfile: (
    payload: Record<string, unknown>,
  ) => Promise<{ ok: boolean; error?: string }>;
}

interface DesktopAppApi {
  isDesktop?: boolean;
  platform?: string;
  toggleFullscreen?: () => Promise<boolean>;
  isFullscreen?: () => Promise<boolean>;
  quitApp?: () => Promise<void>;
  lan?: DesktopLanBridgeApi;
  worldStorage?: DesktopWorldStorageApi;
  settingsStorage?: DesktopSettingsStorageApi;
}

export type AndroidStorageState =
  | 'initialized'
  | 'available'
  | 'permission_required'
  | 'not_accessible';

export interface AndroidStorageStatus {
  ok: boolean;
  platform: 'android';
  state: AndroidStorageState;
  mode: 'direct' | 'saf' | 'none';
  path: string;
  writable: boolean;
  initialized: boolean;
  sdkInt?: number;
  canRequestAllFiles?: boolean;
  hasSafGrant?: boolean;
  migratedWorldsCount?: number;
  lastError?: string;
}

interface AndroidNativeBridgeApi {
  exitApp?: () => void;
  shareText?: (title: string, text: string, url: string) => void;
  startLanHost?: (port: number, roomOptionsJson: string) => string;
  stopLanHost?: () => string;
  getLanStatus?: () => string;
  getLocalIp?: () => string;
  discoverLanHosts?: (timeoutMs: number) => string;
  listSavedWorldIds?: () => string;
  readWorldBundle?: (worldId: string) => string;
  writeWorldBundle?: (worldId: string, bundleJson: string) => string;
  deleteWorldBundle?: (worldId: string) => string;
  getStorageStatus?: () => string;
  requestStoragePermission?: () => void;
  requestSafFolderAccess?: () => void;
  readAllSettings?: () => string;
  writeSettingFile?: (settingKey: string, jsonContent: string) => string;
  writeProfileFile?: (jsonContent: string) => string;
  readProfileFile?: () => string;
  setOrientation?: (mode: string) => void;
  getOrientation?: () => string;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

declare global {
  interface Window {
    desktopApp?: DesktopAppApi;
    AndroidNativeBridge?: AndroidNativeBridgeApi;
    Capacitor?: CapacitorGlobal;
    __onAndroidStorageStatusChanged?: (statusJson: string) => void;
  }
}

export function detectRuntimePlatform(): RuntimePlatform {
  if (typeof window === 'undefined') return 'web';
  if (window.desktopApp?.isDesktop) {
    return 'electron';
  }
  if (
    window.AndroidNativeBridge?.exitApp ||
    (window.Capacitor?.isNativePlatform?.() &&
      window.Capacitor?.getPlatform?.() === 'android')
  ) {
    return 'android';
  }
  return 'web';
}

export async function performPlatformExit(): Promise<{
  exited: boolean;
  platform: RuntimePlatform;
}> {
  const platform = detectRuntimePlatform();

  if (platform === 'electron' && window.desktopApp?.quitApp) {
    try {
      await window.desktopApp.quitApp();
      return { exited: true, platform };
    } catch {
      return { exited: false, platform };
    }
  }

  if (platform === 'android' && window.AndroidNativeBridge?.exitApp) {
    try {
      window.AndroidNativeBridge.exitApp();
      return { exited: true, platform };
    } catch {
      return { exited: false, platform };
    }
  }

  // Web browsers cannot safely close arbitrary tabs via script;
  // callers should show an informational notice instead of window.close().
  return { exited: false, platform: 'web' };
}
