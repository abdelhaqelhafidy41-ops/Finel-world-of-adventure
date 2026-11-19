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

interface DesktopAppApi {
  isDesktop?: boolean;
  platform?: string;
  toggleFullscreen?: () => Promise<boolean>;
  isFullscreen?: () => Promise<boolean>;
  quitApp?: () => Promise<void>;
  lan?: DesktopLanBridgeApi;
}

interface AndroidNativeBridgeApi {
  exitApp?: () => void;
  shareText?: (title: string, text: string, url: string) => void;
  startLanHost?: (port: number, roomOptionsJson: string) => string;
  stopLanHost?: () => string;
  getLanStatus?: () => string;
  getLocalIp?: () => string;
  discoverLanHosts?: (timeoutMs: number) => string;
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
