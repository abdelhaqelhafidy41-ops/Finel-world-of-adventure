import { detectRuntimePlatform } from '../../utils/platformExit';
import type { GraphicsSettings } from '../engine/GraphicsQualityManager';
import type { Language } from '../i18n/translations';
import type { MobileControlSettings } from '../types';
import type { ExtendedGameSettings } from './GameSettingsStore';

const EXTENDED_SETTINGS_KEY = 'woa_extended_settings_v1';
const GRAPHICS_SETTINGS_KEY = 'woa_graphics_settings_v1';
const MOBILE_SETTINGS_KEY = 'woa_mobile_controls_v2';
const LANGUAGE_SETTINGS_KEY = 'woa_language_v1';
const LOCAL_PROFILE_KEY = 'woa_local_profile_v1';
const SETTINGS_TS_KEY = 'woa_windows_settings_ts_v1';

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

export function isWindowsElectronStorageAvailable(): boolean {
  return (
    detectRuntimePlatform() === 'electron' &&
    typeof window !== 'undefined' &&
    window.desktopApp?.platform === 'win32' &&
    Boolean(window.desktopApp?.settingsStorage)
  );
}

export function syncLanguageSettingToWindows(lang: Language): void {
  if (typeof localStorage === 'undefined') return;
  const now = Date.now();
  writeLocalTimestamp('language', now);
  if (!isWindowsElectronStorageAvailable()) return;
  void window.desktopApp?.settingsStorage
    ?.writeSetting('language', {
      version: 1,
      savedAtMs: now,
      language: lang,
    })
    .catch(() => undefined);
}

export function syncGraphicsSettingToWindows(settings: GraphicsSettings): void {
  if (typeof localStorage === 'undefined') return;
  const now = Date.now();
  writeLocalTimestamp('graphics', now);
  if (!isWindowsElectronStorageAvailable()) return;
  void window.desktopApp?.settingsStorage
    ?.writeSetting('graphics', {
      version: 1,
      savedAtMs: now,
      ...settings,
    })
    .catch(() => undefined);
}

export function syncExtendedSettingsToWindows(
  settings: ExtendedGameSettings,
): void {
  if (typeof localStorage === 'undefined') return;
  const now = Date.now();
  writeLocalTimestamp('game', now);
  writeLocalTimestamp('audio', now);
  if (!isWindowsElectronStorageAvailable()) return;
  const storage = window.desktopApp?.settingsStorage;
  if (!storage) return;

  void storage
    .writeSetting('game', {
      version: 1,
      savedAtMs: now,
      gameplay: settings.gameplay,
      camera: settings.camera,
      accessibility: settings.accessibility,
      vsync: settings.vsync,
      dynamicQuality: settings.dynamicQuality,
    })
    .catch(() => undefined);

  void storage
    .writeSetting('audio', {
      version: 1,
      savedAtMs: now,
      ...settings.audio,
    })
    .catch(() => undefined);
}

export function syncMobileSettingsToWindows(
  settings: MobileControlSettings,
): void {
  if (typeof localStorage === 'undefined') return;
  const now = Date.now();
  writeLocalTimestamp('controls', now);
  if (!isWindowsElectronStorageAvailable()) return;
  void window.desktopApp?.settingsStorage
    ?.writeSetting('controls', {
      savedAtMs: now,
      ...settings,
    })
    .catch(() => undefined);
}

export function syncProfileToWindows(profileJson: string | null): void {
  if (!profileJson || !isWindowsElectronStorageAvailable()) return;
  try {
    const parsed: unknown = JSON.parse(profileJson);
    if (!isRecord(parsed)) return;
    void window.desktopApp?.settingsStorage
      ?.writeProfile(parsed)
      .catch(() => undefined);
  } catch {
    // Non-fatal
  }
}

/**
 * Loads Windows Documents settings (`%USERPROFILE%\Documents\World of Adventure\Settings\`)
 * and `Profiles\profile.json` asynchronously via Electron IPC and exports any missing
 * files without overwriting newer edits. Instant no-op on Android, Web, and PWA.
 */
export async function hydrateWindowsSettingsFromNative(current: {
  lang: Language;
  graphics: GraphicsSettings;
  extended: ExtendedGameSettings;
  mobile: MobileControlSettings;
}): Promise<{ changed: boolean; restoredProfile: boolean }> {
  if (
    !isWindowsElectronStorageAvailable() ||
    typeof localStorage === 'undefined'
  ) {
    return { changed: false, restoredProfile: false };
  }

  const storage = window.desktopApp?.settingsStorage;
  if (!storage) return { changed: false, restoredProfile: false };

  let changed = false;
  let restoredProfile = false;

  try {
    const res = await storage.readAll();
    if (!res?.ok || res.enabled === false) {
      return { changed: false, restoredProfile: false };
    }

    const diskSettings = isRecord(res.settings) ? res.settings : {};
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
    } else {
      const langToWrite =
        localLangRaw === 'en' || localLangRaw === 'ar' ? localLangRaw : current.lang;
      syncLanguageSettingToWindows(langToWrite);
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
        syncGraphicsSettingToWindows(JSON.parse(localGfxRaw) as GraphicsSettings);
      } catch {
        syncGraphicsSettingToWindows(current.graphics);
      }
    } else {
      syncGraphicsSettingToWindows(current.graphics);
    }

    // 3. Game + Audio settings
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
      : { ...current.extended };

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
    }
    if (!diskGame || !diskAudio || (parsedLocalExt && ((localTs.game ?? 0) > diskGameTs || (localTs.audio ?? 0) > diskAudioTs))) {
      const toExport = (extUpdated
        ? mergedExt
        : parsedLocalExt ?? current.extended) as unknown as ExtendedGameSettings;
      if (!diskGame || (localTs.game ?? 0) > diskGameTs) {
        const now = Date.now();
        writeLocalTimestamp('game', now);
        void storage
          .writeSetting('game', {
            version: 1,
            savedAtMs: now,
            gameplay: toExport.gameplay,
            camera: toExport.camera,
            accessibility: toExport.accessibility,
            vsync: toExport.vsync,
            dynamicQuality: toExport.dynamicQuality,
          })
          .catch(() => undefined);
      }
      if (!diskAudio || (localTs.audio ?? 0) > diskAudioTs) {
        const now = Date.now();
        writeLocalTimestamp('audio', now);
        void storage
          .writeSetting('audio', {
            version: 1,
            savedAtMs: now,
            ...toExport.audio,
          })
          .catch(() => undefined);
      }
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
        syncMobileSettingsToWindows(
          JSON.parse(localCtrlRaw) as MobileControlSettings,
        );
      } catch {
        syncMobileSettingsToWindows(current.mobile);
      }
    } else {
      syncMobileSettingsToWindows(current.mobile);
    }

    // 5. Profile mirror (Profiles/profile.json)
    const localProfileRaw = localStorage.getItem(LOCAL_PROFILE_KEY);
    if (!localProfileRaw) {
      const profRes = await storage.readProfile().catch(() => null);
      if (profRes?.ok && isRecord(profRes.profile)) {
        localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(profRes.profile));
        restoredProfile = true;
      }
    } else {
      syncProfileToWindows(localProfileRaw);
    }
  } catch {
    // Non-fatal fallback to localStorage
  }

  return { changed, restoredProfile };
}
