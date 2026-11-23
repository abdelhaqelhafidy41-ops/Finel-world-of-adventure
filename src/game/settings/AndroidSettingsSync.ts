import {
  detectRuntimePlatform,
  type AndroidStorageStatus,
} from '../../utils/platformExit';
import type { GraphicsSettings } from '../engine/GraphicsQualityManager';
import type { Language } from '../i18n/translations';
import type { MobileControlSettings } from '../types';
import type { ExtendedGameSettings } from './GameSettingsStore';

const EXTENDED_SETTINGS_KEY = 'woa_extended_settings_v1';
const GRAPHICS_SETTINGS_KEY = 'woa_graphics_settings_v1';
const MOBILE_SETTINGS_KEY = 'woa_mobile_controls_v2';
const LANGUAGE_SETTINGS_KEY = 'woa_language_v1';
const LOCAL_PROFILE_KEY = 'woa_local_profile_v1';
const SETTINGS_TS_KEY = 'woa_android_settings_ts_v1';

interface SettingsTimestampMap {
  game?: number;
  graphics?: number;
  audio?: number;
  controls?: number;
  language?: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readLocalTimestamps(): SettingsTimestampMap {
  try {
    const raw = localStorage.getItem(SETTINGS_TS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? (parsed as SettingsTimestampMap) : {};
  } catch {
    return {};
  }
}

function writeLocalTimestamp(key: keyof SettingsTimestampMap, ts: number): void {
  try {
    const map = readLocalTimestamps();
    map[key] = ts;
    localStorage.setItem(SETTINGS_TS_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

export function isAndroidNativeStorageAvailable(): boolean {
  return (
    detectRuntimePlatform() === 'android' &&
    typeof window !== 'undefined' &&
    Boolean(window.AndroidNativeBridge?.getStorageStatus)
  );
}

export function getAndroidStorageStatus(): AndroidStorageStatus | null {
  if (!isAndroidNativeStorageAvailable()) return null;
  try {
    const raw = window.AndroidNativeBridge?.getStorageStatus?.();
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && parsed.platform === 'android') {
      return parsed as unknown as AndroidStorageStatus;
    }
  } catch {
    // Ignore bridge parse failures
  }
  return null;
}

export function parseAndroidStorageStatusJson(
  rawJson: string,
): AndroidStorageStatus | null {
  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (isRecord(parsed) && parsed.platform === 'android') {
      return parsed as unknown as AndroidStorageStatus;
    }
  } catch {
    // Ignore malformed JSON
  }
  return null;
}

export function requestAndroidStoragePermission(): void {
  if (!isAndroidNativeStorageAvailable()) return;
  try {
    window.AndroidNativeBridge?.requestStoragePermission?.();
  } catch {
    // Safe no-op
  }
}

export function requestAndroidSafFolder(): void {
  if (!isAndroidNativeStorageAvailable()) return;
  try {
    window.AndroidNativeBridge?.requestSafFolderAccess?.();
  } catch {
    // Safe no-op
  }
}

export function syncLanguageSettingToAndroid(lang: Language): void {
  if (typeof localStorage === 'undefined') return;
  const now = Date.now();
  writeLocalTimestamp('language', now);
  if (
    detectRuntimePlatform() !== 'android' ||
    !window.AndroidNativeBridge?.writeSettingFile
  ) {
    return;
  }
  try {
    window.AndroidNativeBridge.writeSettingFile(
      'language',
      JSON.stringify({
        version: 1,
        savedAtMs: now,
        language: lang,
      }),
    );
  } catch {
    // Non-fatal
  }
}

export function syncGraphicsSettingToAndroid(settings: GraphicsSettings): void {
  if (typeof localStorage === 'undefined') return;
  const now = Date.now();
  writeLocalTimestamp('graphics', now);
  if (
    detectRuntimePlatform() !== 'android' ||
    !window.AndroidNativeBridge?.writeSettingFile
  ) {
    return;
  }
  try {
    window.AndroidNativeBridge.writeSettingFile(
      'graphics',
      JSON.stringify({
        version: 1,
        savedAtMs: now,
        ...settings,
      }),
    );
  } catch {
    // Non-fatal
  }
}

export function syncExtendedSettingsToAndroid(settings: ExtendedGameSettings): void {
  if (typeof localStorage === 'undefined') return;
  const now = Date.now();
  writeLocalTimestamp('game', now);
  writeLocalTimestamp('audio', now);
  if (
    detectRuntimePlatform() !== 'android' ||
    !window.AndroidNativeBridge?.writeSettingFile
  ) {
    return;
  }
  try {
    window.AndroidNativeBridge.writeSettingFile(
      'game',
      JSON.stringify({
        version: 1,
        savedAtMs: now,
        gameplay: settings.gameplay,
        camera: settings.camera,
        accessibility: settings.accessibility,
        vsync: settings.vsync,
        dynamicQuality: settings.dynamicQuality,
      }),
    );
    window.AndroidNativeBridge.writeSettingFile(
      'audio',
      JSON.stringify({
        version: 1,
        savedAtMs: now,
        ...settings.audio,
      }),
    );
  } catch {
    // Non-fatal
  }
}

export function syncMobileSettingsToAndroid(
  settings: MobileControlSettings,
): void {
  if (typeof localStorage === 'undefined') return;
  const now = Date.now();
  writeLocalTimestamp('controls', now);
  if (
    detectRuntimePlatform() !== 'android' ||
    !window.AndroidNativeBridge?.writeSettingFile
  ) {
    return;
  }
  try {
    window.AndroidNativeBridge.writeSettingFile(
      'controls',
      JSON.stringify({
        savedAtMs: now,
        ...settings,
      }),
    );
  } catch {
    // Non-fatal
  }
}

export function syncProfileToAndroid(profileJson: string | null): void {
  if (
    detectRuntimePlatform() !== 'android' ||
    !window.AndroidNativeBridge?.writeProfileFile ||
    !profileJson
  ) {
    return;
  }
  try {
    window.AndroidNativeBridge.writeProfileFile(profileJson);
  } catch {
    // Non-fatal
  }
}

let initialHydrationDone = false;

/**
 * Synchronously hydrates existing Android shared-storage settings (`Settings/*.json`
 * and `Profiles/profile.json`) into localStorage on Android launch or permission grant,
 * and exports any existing pre-permission localStorage settings to shared storage.
 * Instant no-op on Windows, Web, and PWA.
 */
export function hydrateAndroidSettingsFromNative(force = false): {
  changed: boolean;
  writable: boolean;
} {
  if (
    detectRuntimePlatform() !== 'android' ||
    typeof localStorage === 'undefined' ||
    !window.AndroidNativeBridge?.readAllSettings
  ) {
    return { changed: false, writable: false };
  }
  if (initialHydrationDone && !force) {
    return { changed: false, writable: false };
  }

  let changed = false;
  let writable = false;

  try {
    const raw = window.AndroidNativeBridge.readAllSettings();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !parsed.ok) {
      return { changed: false, writable: false };
    }
    writable = Boolean(parsed.writable);
    if (!writable) {
      return { changed: false, writable: false };
    }

    const diskSettings = isRecord(parsed.settings) ? parsed.settings : {};
    const localTs = readLocalTimestamps();

    // 1. Language settings
    const diskLang = isRecord(diskSettings.language) ? diskSettings.language : null;
    const diskLangTs =
      diskLang && typeof diskLang.savedAtMs === 'number' ? diskLang.savedAtMs : 0;
    const localLangRaw = localStorage.getItem(LANGUAGE_SETTINGS_KEY);
    if (
      diskLang &&
      (diskLang.language === 'en' || diskLang.language === 'ar') &&
      (!localLangRaw || !(localTs.language && localTs.language > diskLangTs))
    ) {
      if (localLangRaw !== diskLang.language) {
        localStorage.setItem(LANGUAGE_SETTINGS_KEY, diskLang.language);
        changed = true;
      }
      if (diskLangTs > 0) writeLocalTimestamp('language', diskLangTs);
    } else if (localLangRaw === 'en' || localLangRaw === 'ar') {
      syncLanguageSettingToAndroid(localLangRaw);
    }

    // 2. Graphics settings
    const diskGfx = isRecord(diskSettings.graphics) ? diskSettings.graphics : null;
    const diskGfxTs =
      diskGfx && typeof diskGfx.savedAtMs === 'number' ? diskGfx.savedAtMs : 0;
    const localGfxRaw = localStorage.getItem(GRAPHICS_SETTINGS_KEY);
    if (
      diskGfx &&
      (!localGfxRaw || !(localTs.graphics && localTs.graphics > diskGfxTs))
    ) {
      const cleaned = { ...diskGfx };
      delete cleaned.version;
      delete cleaned.savedAtMs;
      localStorage.setItem(GRAPHICS_SETTINGS_KEY, JSON.stringify(cleaned));
      if (diskGfxTs > 0) writeLocalTimestamp('graphics', diskGfxTs);
      changed = true;
    } else if (localGfxRaw) {
      try {
        const localGfx = JSON.parse(localGfxRaw) as GraphicsSettings;
        syncGraphicsSettingToAndroid(localGfx);
      } catch {
        // Ignore malformed local entry
      }
    }

    // 3. Game + Audio settings (stored as separate files in Settings/ on Android)
    const diskGame = isRecord(diskSettings.game) ? diskSettings.game : null;
    const diskAudio = isRecord(diskSettings.audio) ? diskSettings.audio : null;
    const diskGameTs =
      diskGame && typeof diskGame.savedAtMs === 'number' ? diskGame.savedAtMs : 0;
    const diskAudioTs =
      diskAudio && typeof diskAudio.savedAtMs === 'number' ? diskAudio.savedAtMs : 0;
    const localExtRaw = localStorage.getItem(EXTENDED_SETTINGS_KEY);
    let parsedLocalExt: Record<string, unknown> | null = null;
    if (localExtRaw) {
      try {
        const tmp: unknown = JSON.parse(localExtRaw);
        if (isRecord(tmp)) parsedLocalExt = tmp;
      } catch {
        parsedLocalExt = null;
      }
    }

    let extUpdated = false;
    const mergedExt: Record<string, unknown> = parsedLocalExt
      ? { ...parsedLocalExt }
      : {};

    if (
      diskGame &&
      (!parsedLocalExt || !(localTs.game && localTs.game > diskGameTs))
    ) {
      if (isRecord(diskGame.gameplay)) mergedExt.gameplay = diskGame.gameplay;
      if (isRecord(diskGame.camera)) mergedExt.camera = diskGame.camera;
      if (isRecord(diskGame.accessibility)) {
        mergedExt.accessibility = diskGame.accessibility;
      }
      if (typeof diskGame.vsync === 'boolean') mergedExt.vsync = diskGame.vsync;
      if (typeof diskGame.dynamicQuality === 'boolean') {
        mergedExt.dynamicQuality = diskGame.dynamicQuality;
      }
      if (diskGameTs > 0) writeLocalTimestamp('game', diskGameTs);
      extUpdated = true;
    }

    if (
      diskAudio &&
      (!parsedLocalExt || !(localTs.audio && localTs.audio > diskAudioTs))
    ) {
      const cleanAudio = { ...diskAudio };
      delete cleanAudio.version;
      delete cleanAudio.savedAtMs;
      mergedExt.audio = cleanAudio;
      if (diskAudioTs > 0) writeLocalTimestamp('audio', diskAudioTs);
      extUpdated = true;
    }

    if (extUpdated) {
      localStorage.setItem(EXTENDED_SETTINGS_KEY, JSON.stringify(mergedExt));
      changed = true;
    } else if (parsedLocalExt && (!diskGame || !diskAudio)) {
      syncExtendedSettingsToAndroid(
        parsedLocalExt as unknown as ExtendedGameSettings,
      );
    }

    // 4. Controls settings
    const diskControls = isRecord(diskSettings.controls)
      ? diskSettings.controls
      : null;
    const diskControlsTs =
      diskControls && typeof diskControls.savedAtMs === 'number'
        ? diskControls.savedAtMs
        : 0;
    const localCtrlRaw = localStorage.getItem(MOBILE_SETTINGS_KEY);
    if (
      diskControls &&
      (!localCtrlRaw || !(localTs.controls && localTs.controls > diskControlsTs))
    ) {
      const cleanCtrl = { ...diskControls };
      delete cleanCtrl.savedAtMs;
      localStorage.setItem(MOBILE_SETTINGS_KEY, JSON.stringify(cleanCtrl));
      if (diskControlsTs > 0) writeLocalTimestamp('controls', diskControlsTs);
      changed = true;
    } else if (localCtrlRaw) {
      try {
        const localCtrl = JSON.parse(localCtrlRaw) as MobileControlSettings;
        syncMobileSettingsToAndroid(localCtrl);
      } catch {
        // Ignore malformed local entry
      }
    }

    // 5. Profile mirror (Profiles/profile.json)
    const localProfileRaw = localStorage.getItem(LOCAL_PROFILE_KEY);
    if (!localProfileRaw && window.AndroidNativeBridge.readProfileFile) {
      try {
        const profRaw = window.AndroidNativeBridge.readProfileFile();
        const profParsed: unknown = JSON.parse(profRaw);
        if (isRecord(profParsed) && profParsed.ok && isRecord(profParsed.profile)) {
          localStorage.setItem(
            LOCAL_PROFILE_KEY,
            JSON.stringify(profParsed.profile),
          );
          changed = true;
        }
      } catch {
        // Ignore profile read failures
      }
    } else if (localProfileRaw) {
      syncProfileToAndroid(localProfileRaw);
    }

    initialHydrationDone = true;
  } catch {
    return { changed: false, writable: false };
  }

  return { changed, writable };
}

/**
 * Ensures all 5 canonical Settings/*.json files exist inside Android shared storage
 * when writable, without overwriting any pre-existing files on disk.
 */
export function exportMissingAndroidSettingsSnapshot(current: {
  lang: Language;
  graphics: GraphicsSettings;
  extended: ExtendedGameSettings;
  mobile: MobileControlSettings;
}): void {
  if (
    detectRuntimePlatform() !== 'android' ||
    !window.AndroidNativeBridge?.readAllSettings
  ) {
    return;
  }
  try {
    const raw = window.AndroidNativeBridge.readAllSettings();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !parsed.ok || !parsed.writable) return;
    const disk = isRecord(parsed.settings) ? parsed.settings : {};

    if (!isRecord(disk.language)) {
      syncLanguageSettingToAndroid(current.lang);
    }
    if (!isRecord(disk.graphics)) {
      syncGraphicsSettingToAndroid(current.graphics);
    }
    if (!isRecord(disk.game) || !isRecord(disk.audio)) {
      syncExtendedSettingsToAndroid(current.extended);
    }
    if (!isRecord(disk.controls)) {
      syncMobileSettingsToAndroid(current.mobile);
    }
  } catch {
    // Non-fatal
  }
}
