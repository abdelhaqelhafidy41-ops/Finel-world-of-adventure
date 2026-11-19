import {
  resolveMultiplayerServerUrl,
  resolvePublicAppUrl,
} from '../multiplayer/multiplayerConfig';

export type AppPlatform = 'android' | 'windows' | 'web';

export interface RemoteVersionPayload {
  latestVersion: string;
  updateUrl?: string;
  platformUrls?: Partial<Record<AppPlatform, string>>;
  releaseNotes?: {
    ar?: string;
    en?: string;
  };
}

export interface AppUpdateInfo {
  installedVersion: string;
  latestVersion: string;
  platform: AppPlatform;
  updateUrl: string;
  releaseNotes: {
    ar: string;
    en: string;
  };
}

export interface AppUpdateCheckResult {
  status: 'update_available' | 'up_to_date' | 'suppressed' | 'offline' | 'unavailable';
  hasUpdate: boolean;
  updateInfo: AppUpdateInfo | null;
}

const PORTRAIT_TIP_DISMISSED_KEY = 'woa_portrait_tip_dismissed_v1';
const SUPPRESSED_UPDATE_VERSION_KEY = 'woa_suppressed_update_version_v1';

export const OFFICIAL_WEB_APP_URL =
  'https://abdelhaqelhafidy41-ops.github.io/Finel-world-of-adventure/';
export const OFFICIAL_RELEASES_URL =
  'https://github.com/abdelhaqelhafidy41-ops/Finel-world-of-adventure/releases/latest';

/**
 * Returns the installed app version injected from package.json via Vite.
 */
export function getInstalledAppVersion(): string {
  const raw =
    typeof import.meta !== 'undefined'
      ? String(
          (import.meta as unknown as { env?: Record<string, string | undefined> }).env
            ?.VITE_APP_VERSION ?? '',
        ).trim()
      : '';
  return raw || '1.0.0';
}

/**
 * Parses a semantic version string (e.g. "1.0.2", "v1.10.3-beta.1") into numeric [major, minor, patch].
 * Returns null if the input does not begin with a valid numeric semver core.
 */
export function parseSemver(raw: unknown): [number, number, number] | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/^v/i, '').split(/[-+]/)[0];
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(cleaned);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  const minor = match[2] !== undefined ? Number.parseInt(match[2], 10) : 0;
  const patch = match[3] !== undefined ? Number.parseInt(match[3], 10) : 0;
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return null;
  }
  return [major, minor, patch];
}

/**
 * Compares two semantic versions numerically.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

export function normalizeSemver(raw: unknown): string | null {
  const parsed = parseSemver(raw);
  if (!parsed) return null;
  return `${parsed[0]}.${parsed[1]}.${parsed[2]}`;
}

/**
 * Detects the active runtime platform without relying on fragile assumptions.
 */
export function detectAppPlatform(): AppPlatform {
  if (typeof window === 'undefined') return 'web';
  const win = window as unknown as {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
    desktopApp?: { isDesktop?: boolean };
  };

  if (win.desktopApp?.isDesktop) {
    return 'windows';
  }
  if (typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent || '')) {
    return 'windows';
  }
  if (
    win.Capacitor &&
    typeof win.Capacitor.isNativePlatform === 'function' &&
    win.Capacitor.isNativePlatform()
  ) {
    return 'android';
  }
  return 'web';
}

/**
 * Returns true ONLY on mobile phones (Android/iOS/Capacitor mobile or mobile phone browsers).
 * Explicitly returns false on Desktop, Laptop, Windows EXE, and desktop browsers.
 */
export function isMobilePhoneDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  const win = window as unknown as {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
    desktopApp?: { isDesktop?: boolean };
  };

  // Never show on desktop Electron / Windows EXE
  if (win.desktopApp?.isDesktop) return false;
  const ua = navigator.userAgent || '';
  if (/Electron/i.test(ua)) return false;

  // Native Capacitor mobile app
  if (
    win.Capacitor &&
    typeof win.Capacitor.isNativePlatform === 'function' &&
    win.Capacitor.isNativePlatform()
  ) {
    const capPlatform = win.Capacitor.getPlatform?.();
    if (capPlatform === 'android' || capPlatform === 'ios') {
      return true;
    }
  }

  // Explicit desktop OS without mobile UA -> false
  if (/(Windows NT|Macintosh|X11|CrOS)/i.test(ua) && !/Mobile|Android|iPhone|iPod/i.test(ua)) {
    return false;
  }

  // Mobile phone user agents
  const isPhoneUa =
    /iPhone|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile/i.test(ua) ||
    (/Android/i.test(ua) && /Mobile/i.test(ua));
  if (isPhoneUa) {
    return true;
  }

  // Coarse pointer + phone-sized short side fallback for modern mobile browsers
  const hasCoarsePointer =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  const hasTouch = (navigator.maxTouchPoints ?? 0) > 0;
  const minDim = Math.min(window.innerWidth || 9999, window.innerHeight || 9999);

  return hasCoarsePointer && hasTouch && minDim <= 540;
}

export function isPortraitTipDismissed(): boolean {
  try {
    return localStorage.getItem(PORTRAIT_TIP_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function dismissPortraitTip(): void {
  try {
    localStorage.setItem(PORTRAIT_TIP_DISMISSED_KEY, 'true');
  } catch {
    // ignore storage errors
  }
}

export function getSuppressedUpdateVersion(): string | null {
  try {
    const raw = localStorage.getItem(SUPPRESSED_UPDATE_VERSION_KEY);
    return normalizeSemver(raw);
  } catch {
    return null;
  }
}

/**
 * Suppresses update notifications ONLY for the specified version string (e.g. "1.0.2").
 * Future newer versions (e.g. "1.0.3") will still trigger the notification.
 */
export function suppressUpdateVersion(version: string): void {
  const normalized = normalizeSemver(version);
  if (!normalized) return;
  try {
    localStorage.setItem(SUPPRESSED_UPDATE_VERSION_KEY, normalized);
  } catch {
    // ignore storage errors
  }
}

/**
 * Pure helper determining whether an update notification should be shown.
 */
export function shouldShowUpdateNotification(
  installedVersion: string,
  latestVersion: string,
  suppressedVersion: string | null,
): boolean {
  const installed = normalizeSemver(installedVersion);
  const latest = normalizeSemver(latestVersion);
  if (!installed || !latest) return false;
  if (compareSemver(installed, latest) >= 0) return false;
  const suppressed = suppressedVersion ? normalizeSemver(suppressedVersion) : null;
  if (suppressed && compareSemver(suppressed, latest) === 0) {
    return false;
  }
  return true;
}

function sanitizeSafeHttpsUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function resolvePlatformUpdateUrl(
  payload: RemoteVersionPayload,
  platform: AppPlatform,
): string {
  const fromPlatform = sanitizeSafeHttpsUrl(payload.platformUrls?.[platform]);
  if (fromPlatform) return fromPlatform;

  if (platform === 'android' || platform === 'windows') {
    return OFFICIAL_RELEASES_URL;
  }

  const fromGeneric = sanitizeSafeHttpsUrl(payload.updateUrl);
  if (fromGeneric) return fromGeneric;

  return resolvePublicAppUrl() || OFFICIAL_WEB_APP_URL;
}

async function fetchJsonWithTimeout<T>(
  url: string,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<T | null> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer =
    controller && typeof setTimeout !== 'undefined'
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

  try {
    const res = await fetchFn(url, {
      method: 'GET',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json') && !url.endsWith('.json')) {
      return null;
    }
    const data = (await res.json()) as T;
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

function buildVersionEndpointCandidates(): string[] {
  const candidates: string[] = [];
  const workerBase = resolveMultiplayerServerUrl();
  if (workerBase) {
    candidates.push(`${workerBase}/app/version`);
  }

  const publicAppUrl = resolvePublicAppUrl();
  if (publicAppUrl) {
    candidates.push(`${publicAppUrl.replace(/\/+$/, '')}/version.json`);
  } else {
    candidates.push(`${OFFICIAL_WEB_APP_URL}version.json`);
  }

  if (
    typeof window !== 'undefined' &&
    /^https?:$/i.test(window.location?.protocol || '')
  ) {
    try {
      const localUrl = new URL('version.json', window.location.href).toString();
      if (!candidates.includes(localUrl)) {
        candidates.push(localUrl);
      }
    } catch {
      // ignore
    }
  }

  return candidates;
}

/**
 * Performs a single lightweight, offline-safe version check.
 * Never throws or blocks game startup.
 */
export async function checkForAppUpdate(options?: {
  installedVersion?: string;
  suppressedVersion?: string | null;
  platform?: AppPlatform;
  timeoutMs?: number;
  endpoints?: string[];
  fetchFn?: typeof fetch;
}): Promise<AppUpdateCheckResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { status: 'offline', hasUpdate: false, updateInfo: null };
  }

  const installedVersion = normalizeSemver(
    options?.installedVersion ?? getInstalledAppVersion(),
  ) ?? '1.0.0';
  const suppressedVersion =
    options?.suppressedVersion !== undefined
      ? options.suppressedVersion
      : getSuppressedUpdateVersion();
  const platform = options?.platform ?? detectAppPlatform();
  const timeoutMs = options?.timeoutMs ?? 4000;
  const fetchFn = options?.fetchFn ?? (typeof fetch === 'function' ? fetch : null);

  if (!fetchFn) {
    return { status: 'unavailable', hasUpdate: false, updateInfo: null };
  }

  const endpoints = options?.endpoints ?? buildVersionEndpointCandidates();

  let remotePayload: RemoteVersionPayload | null = null;
  for (const endpoint of endpoints) {
    const data = await fetchJsonWithTimeout<RemoteVersionPayload>(
      endpoint,
      timeoutMs,
      fetchFn,
    );
    if (data && normalizeSemver(data.latestVersion)) {
      remotePayload = data;
      break;
    }
  }

  if (!remotePayload) {
    return { status: 'unavailable', hasUpdate: false, updateInfo: null };
  }

  const latestVersion = normalizeSemver(remotePayload.latestVersion)!;
  const cmp = compareSemver(installedVersion, latestVersion);
  if (cmp >= 0) {
    return { status: 'up_to_date', hasUpdate: false, updateInfo: null };
  }

  if (!shouldShowUpdateNotification(installedVersion, latestVersion, suppressedVersion)) {
    return { status: 'suppressed', hasUpdate: false, updateInfo: null };
  }

  const updateInfo: AppUpdateInfo = {
    installedVersion,
    latestVersion,
    platform,
    updateUrl: resolvePlatformUpdateUrl(remotePayload, platform),
    releaseNotes: {
      ar:
        remotePayload.releaseNotes?.ar?.trim() ||
        'قم بتحديث اللعبة للاستمتاع بالمزايا الجديدة وإصلاح الأخطاء وتحسين تجربة اللعب.',
      en:
        remotePayload.releaseNotes?.en?.trim() ||
        'Update the game to enjoy the new features, bug fixes, and an improved gameplay experience.',
    },
  };

  return {
    status: 'update_available',
    hasUpdate: true,
    updateInfo,
  };
}
