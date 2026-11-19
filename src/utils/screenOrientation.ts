import { useCallback, useEffect, useState } from 'react';
import { detectRuntimePlatform } from './platformExit';

export type ScreenOrientationMode = 'portrait' | 'landscape';

const ORIENTATION_STORAGE_KEY = 'woa_screen_orientation_mode';
const ORIENTATION_EVENT = 'woa-screen-orientation-changed';

interface ScreenOrientationWithLock {
  lock?: (orientation: 'landscape' | 'portrait') => Promise<void>;
  unlock?: () => void;
}

let restoredOnce = false;

export function getCurrentScreenOrientation(): ScreenOrientationMode {
  if (typeof window === 'undefined') return 'landscape';

  try {
    const nativeOrientation = window.AndroidNativeBridge?.getOrientation?.();
    if (nativeOrientation === 'landscape' || nativeOrientation === 'portrait') {
      return nativeOrientation;
    }
  } catch {
    // Fallback to viewport dimensions below.
  }

  return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
}

export function shouldShowOrientationToggle(): boolean {
  if (typeof window === 'undefined') return false;
  const platform = detectRuntimePlatform();
  if (platform === 'electron') return false;
  if (platform === 'android') return true;

  const ua = navigator.userAgent || '';
  const isMobileUa =
    /Android|iPhone|iPad|iPod|Mobile|Windows Phone|webOS/i.test(ua);
  const hasTouch =
    (navigator.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window;
  const isCoarsePointer =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  return isMobileUa || (hasTouch && isCoarsePointer);
}

export async function setAppScreenOrientation(
  mode: ScreenOrientationMode,
): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  try {
    window.localStorage.setItem(ORIENTATION_STORAGE_KEY, mode);
  } catch {
    // Ignore storage quota/privacy errors.
  }

  // 1. Native Android APK path — always works even if system auto-rotate is off.
  if (window.AndroidNativeBridge?.setOrientation) {
    try {
      window.AndroidNativeBridge.setOrientation(mode);
      window.dispatchEvent(
        new CustomEvent<ScreenOrientationMode>(ORIENTATION_EVENT, {
          detail: mode,
        }),
      );
      return true;
    } catch {
      // Fall through to web orientation API.
    }
  }

  // 2. Mobile Web Browser fallback via Screen Orientation API.
  const screenOrientation = window.screen
    ?.orientation as ScreenOrientationWithLock | undefined;
  if (screenOrientation?.lock) {
    try {
      await screenOrientation.lock(mode);
      window.dispatchEvent(
        new CustomEvent<ScreenOrientationMode>(ORIENTATION_EVENT, {
          detail: mode,
        }),
      );
      return true;
    } catch {
      // Some mobile browsers require fullscreen before locking orientation.
      try {
        if (
          !document.fullscreenElement &&
          document.documentElement.requestFullscreen
        ) {
          await document.documentElement.requestFullscreen();
        }
        await screenOrientation.lock(mode);
        window.dispatchEvent(
          new CustomEvent<ScreenOrientationMode>(ORIENTATION_EVENT, {
            detail: mode,
          }),
        );
        return true;
      } catch {
        return false;
      }
    }
  }

  return false;
}

export async function toggleAppScreenOrientation(): Promise<ScreenOrientationMode> {
  const current = getCurrentScreenOrientation();
  const next: ScreenOrientationMode =
    current === 'landscape' ? 'portrait' : 'landscape';
  await setAppScreenOrientation(next);
  return next;
}

export function restoreSavedScreenOrientation(): void {
  if (restoredOnce || typeof window === 'undefined') return;
  restoredOnce = true;

  if (!window.AndroidNativeBridge?.setOrientation) return;

  try {
    const saved = window.localStorage.getItem(ORIENTATION_STORAGE_KEY);
    if (saved === 'landscape' || saved === 'portrait') {
      window.AndroidNativeBridge.setOrientation(saved);
    }
  } catch {
    // Ignore storage errors.
  }
}

export function useScreenOrientation(): {
  orientation: ScreenOrientationMode;
  showOrientationToggle: boolean;
  toggleOrientation: () => void;
} {
  const [orientation, setOrientation] = useState<ScreenOrientationMode>(() =>
    getCurrentScreenOrientation(),
  );
  const [showOrientationToggle] = useState<boolean>(() =>
    shouldShowOrientationToggle(),
  );

  useEffect(() => {
    restoreSavedScreenOrientation();

    const syncOrientation = () => {
      setOrientation(getCurrentScreenOrientation());
    };

    const onCustomChange = (event: Event) => {
      const custom = event as CustomEvent<ScreenOrientationMode>;
      if (custom.detail === 'landscape' || custom.detail === 'portrait') {
        setOrientation(custom.detail);
      } else {
        syncOrientation();
      }
    };

    window.addEventListener('resize', syncOrientation);
    window.addEventListener('orientationchange', syncOrientation);
    window.addEventListener(ORIENTATION_EVENT, onCustomChange);

    const screenOrientation = window.screen?.orientation;
    screenOrientation?.addEventListener?.('change', syncOrientation);

    return () => {
      window.removeEventListener('resize', syncOrientation);
      window.removeEventListener('orientationchange', syncOrientation);
      window.removeEventListener(ORIENTATION_EVENT, onCustomChange);
      screenOrientation?.removeEventListener?.('change', syncOrientation);
    };
  }, []);

  const toggleOrientation = useCallback(() => {
    void toggleAppScreenOrientation().then((next) => {
      setOrientation(next);
    });
  }, []);

  return {
    orientation,
    showOrientationToggle,
    toggleOrientation,
  };
}
