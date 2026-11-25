import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameEngine } from './game/engine/GameEngine';
import { SaveManager } from './game/save/SaveManager';
import { LoadManager } from './game/save/LoadManager';
import { type AudioManager, getAudioManager } from './game/audio/AudioManager';
import { detectTouchDevice } from './game/input/MobileInputManager';
import {
  loadMobileSettings,
  saveMobileSettings,
  shouldShowMobileControls,
} from './game/input/MobileLayoutStore';
import {
  DEFAULT_MOBILE_SETTINGS,
  type ActiveModal,
  type GamePhase,
  type GameSettings,
  type MobileControlSettings,
  type PlayerHudSnapshot,
} from './game/types';
import type { MapWaypoint } from './game/world/MapManager';
import type { InventorySnapshot } from './game/inventory/inventoryTypes';
import type { DialogueSnapshot } from './game/dialogue/dialogueTypes';
import type {
  NewWorldOptions,
  SaveGameData,
  SaveGameMeta,
  SaveSlotId,
  SaveSlotSummary,
} from './game/save/saveTypes';
import {
  flushPendingWorldSaves,
  hydratePersistentWorldStorage,
} from './game/save/LocalWorldStorage';
import {
  getModManager,
  type WorldModInspectionResult,
  type WorldModSelectionEntry,
} from './game/mods';
import {
  UI_TEXT,
  loadSavedLanguage,
  saveLanguage,
  type Language,
} from './game/i18n/translations';
import { LoadingScreen } from './components/LoadingScreen';
import { TitleScreen, type TitleSubScreen } from './components/TitleScreen';
import { HudOverlay } from './components/HudOverlay';
import { MobileControlsOverlay } from './components/MobileControlsOverlay';
import { BuildModeOverlay } from './components/BuildModeOverlay';
import { BuildingStorageModal } from './components/BuildingStorageModal';
import { StructureManageModal } from './components/StructureManageModal';
import { FarmPlotModal } from './components/FarmPlotModal';
import { VillageDevelopmentModal } from './components/VillageDevelopmentModal';
import { MerchantTradeModal } from './components/MerchantTradeModal';
import {
  isMerchantDialogueNpc,
  isVillageStewardNpc,
} from './game/village/VillageTradeCatalog';
import { MobileSettingsModal } from './components/MobileSettingsModal';
import { InventoryModal } from './components/InventoryModal';
import { WorldMapModal } from './components/WorldMapModal';
import { DialogueModal } from './components/DialogueModal';
import { QuestJournalModal } from './components/QuestJournalModal';
import { PauseMenu } from './components/PauseMenu';
import { SaveSlotsModal } from './components/SaveSlotsModal';
import { GraphicsSettingsModal } from './components/GraphicsSettingsModal';
import { DebugPerformanceOverlay } from './components/DebugPerformanceOverlay';
import {
  SettingsScreen,
  type SettingsTabId,
} from './components/menu/SettingsScreen';
import { WorldModRecoveryModal } from './components/menu/WorldModRecoveryModal';
import { UpdateNotificationModal } from './components/menu/UpdateNotificationModal';
import {
  checkForAppUpdate,
  suppressUpdateVersion,
  type AppUpdateInfo,
} from './game/settings/AppUpdateService';
import {
  DEFAULT_GRAPHICS_SETTINGS,
  isDeveloperToolsEnabled,
  loadGraphicsSettings,
  saveGraphicsSettings,
  type DebugPerformanceSnapshot,
  type GraphicsSettings,
  type ResolvedGraphicsProfile,
} from './game/engine/GraphicsQualityManager';
import {
  applyAccessibilityDocumentAttributes,
  createDefaultExtendedSettings,
  loadExtendedSettings,
  saveExtendedSettings,
  type AudioSettings,
  type ExtendedGameSettings,
} from './game/settings/GameSettingsStore';
import {
  exportMissingAndroidSettingsSnapshot,
  hydrateAndroidSettingsFromNative,
  parseAndroidStorageStatusJson,
} from './game/settings/AndroidSettingsSync';
import { hydrateWindowsSettingsFromNative } from './game/settings/WindowsSettingsSync';
import { Mail } from 'lucide-react';
import { useGamepadPauseButton } from './hooks/useMenuNavigation';
import {
  createMultiplayerService,
  loadSavedMultiplayerName,
} from './game/multiplayer/MultiplayerService';
import {
  isSwitchingMultiplayerTransport,
  SwitchingMultiplayerTransport,
} from './game/multiplayer/MultiplayerTransport';
import { getLanCapabilities } from './game/multiplayer/LanMultiplayerManager';
import { extractJoinTargetFromUrl } from './game/multiplayer/inviteUtils';
import type {
  IMultiplayerService,
  MultiplayerConnectionState,
  MultiplayerGameStartInfo,
  MultiplayerInvite,
  MultiplayerRoomState,
  PartyStateSnapshot,
} from './game/multiplayer/multiplayerTypes';
import { InGameMultiplayerChatModal } from './components/multiplayer/InGameMultiplayerChatModal';
import { PartyPanel } from './components/multiplayer/PartyPanel';
import { ConnectionStatusBanner } from './components/multiplayer/ConnectionStatusBanner';
import { ProfileManager } from './game/profile/ProfileManager';
import { AvatarBadge } from './components/profile/AvatarBadge';
import { PlayerProfileModal } from './components/profile/PlayerProfileModal';
import { ProfileSetupModal } from './components/profile/ProfileSetupModal';
import { AccountAuthModal } from './components/profile/AccountAuthModal';
import { AccountCloudModal } from './components/profile/AccountCloudModal';
import { AuthService } from './game/profile/AuthService';
import { CloudSaveService } from './game/save/CloudSaveService';

declare global {
  interface Window {
    __handleAndroidBack?: () => boolean;
    __handleMultiplayerJoinLink?: (url: string) => void;
  }
}

const INITIAL_HUD: PlayerHudSnapshot = {
  health: 100,
  maxHealth: 100,
  stamina: 100,
  maxStamina: 100,
  x: 0,
  y: 0,
  z: 4,
  headingDeg: 0,
  grounded: true,
  sprinting: false,
  speed: 0,
  biome: 'Plains',
  inWater: false,
  movementState: 'idle',
  nearbyInteractable: null,
  timeOfDayLabel: '08:30 · Morning',
  level: 1,
  xp: 0,
  xpToNextLevel: 100,
  coins: 0,
  trackedQuest: null,
};

const EMPTY_INVENTORY: InventorySnapshot = {
  capacity: 32,
  usedSlots: 0,
  slots: new Array(32).fill(null),
  equippedBySlot: {},
  bonuses: {
    maxHealthBonus: 0,
    maxStaminaBonus: 0,
    speedBonus: 0,
    damageReductionBonus: 0,
    capacityBonus: 0,
  },
};

export default function App() {
  // Synchronously pull Android shared-storage settings (/storage/emulated/0/World of Adventure/Settings)
  // before initial React state reads localStorage (instant no-op on Electron/Web/PWA).
  hydrateAndroidSettingsFromNative();

  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const engineLoadPromiseRef = useRef<Promise<GameEngine | null> | null>(null);
  const menuSaveManagerRef = useRef<SaveManager | null>(null);
  if (!menuSaveManagerRef.current) {
    menuSaveManagerRef.current = new SaveManager();
  }
  const menuLoadManagerRef = useRef<LoadManager | null>(null);
  if (!menuLoadManagerRef.current) {
    menuLoadManagerRef.current = new LoadManager();
  }
  const audioManagerRef = useRef<AudioManager | null>(null);
  if (!audioManagerRef.current) {
    audioManagerRef.current = getAudioManager();
  }
  const multiplayerServiceRef = useRef<IMultiplayerService | null>(null);
  if (!multiplayerServiceRef.current) {
    multiplayerServiceRef.current = new SwitchingMultiplayerTransport(
      createMultiplayerService(),
    );
  }

  const [language, setLanguage] = useState<Language>(() => loadSavedLanguage());
  const [phase, setPhase] = useState<GamePhase>('title');
  const [activeModal, setActiveModal] = useState<ActiveModal>('none');
  const [settingsInitialTab, setSettingsInitialTab] =
    useState<SettingsTabId>('graphics');
  const [inventoryInitialTab, setInventoryInitialTab] = useState<'pack' | 'craft'>('pack');
  const [buildingModalVersion, setBuildingModalVersion] = useState(0);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadLabel, setLoadLabel] = useState(() => UI_TEXT[loadSavedLanguage()].loadingDefault);
  const [hud, setHud] = useState<PlayerHudSnapshot>(INITIAL_HUD);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [inventorySnapshot, setInventorySnapshot] =
    useState<InventorySnapshot>(EMPTY_INVENTORY);
  const [dialogueSnapshot, setDialogueSnapshot] = useState<DialogueSnapshot | null>(null);
  const [worldNotice, setWorldNotice] = useState<string | null>(null);
  const [waypoint, setWaypoint] = useState<MapWaypoint | null>(null);
  const [saveSlots, setSaveSlots] = useState<SaveSlotSummary[]>([]);
  const [savedWorlds, setSavedWorlds] = useState<SaveGameMeta[]>([]);
  const [latestSave, setLatestSave] = useState<SaveGameMeta | null>(null);
  const [pendingJoinCode, setPendingJoinCode] = useState<string | null>(() =>
    extractJoinTargetFromUrl(),
  );
  const [incomingInvite, setIncomingInvite] = useState<MultiplayerInvite | null>(
    null,
  );
  const [acceptingInvite, setAcceptingInvite] = useState<boolean>(false);
  const [activeMpRoom, setActiveMpRoom] = useState<MultiplayerRoomState | null>(
    () => multiplayerServiceRef.current?.getRoomState() ?? null,
  );
  const [mpConnectionState, setMpConnectionState] =
    useState<MultiplayerConnectionState>(
      () => multiplayerServiceRef.current?.getConnectionState() ?? 'disconnected',
    );
  const [mpReconnectAttempt, setMpReconnectAttempt] = useState<number>(
    () => multiplayerServiceRef.current?.getReconnectAttempt() ?? 0,
  );
  const [unreadChatCount, setUnreadChatCount] = useState<number>(0);
  const [partyState, setPartyState] = useState<PartyStateSnapshot>(() =>
    multiplayerServiceRef.current?.getPartyState?.() ?? {
      party: null,
      pendingInvites: [],
      outgoingInvites: [],
    },
  );
  const [titleSubScreen, setTitleSubScreen] = useState<TitleSubScreen>(() =>
    extractJoinTargetFromUrl() ? 'multiplayer' : 'main',
  );
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileSetupOpen, setProfileSetupOpen] = useState(false);
  const [accountCloudModalOpen, setAccountCloudModalOpen] = useState(false);
  const [accountAuthModalOpen, setAccountAuthModalOpen] = useState<boolean>(() => {
    if (extractJoinTargetFromUrl()) return false;
    if (AuthService.isSignedInCloudAccount()) return false;
    if (AuthService.hasSeenFirstLaunchPrompt()) return false;
    if (CloudSaveService.hasLocalData()) return false;
    return true;
  });
  const [accountAuthIsFirstLaunch, setAccountAuthIsFirstLaunch] = useState<boolean>(() => {
    if (extractJoinTargetFromUrl()) return false;
    return (
      !AuthService.isSignedInCloudAccount() &&
      !AuthService.hasSeenFirstLaunchPrompt() &&
      !CloudSaveService.hasLocalData()
    );
  });
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdateInfo | null>(null);
  const [pendingWorldRecovery, setPendingWorldRecovery] = useState<{
    slotId: SaveSlotId;
    saveData: SaveGameData;
    initialInspection: WorldModInspectionResult;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void checkForAppUpdate({ timeoutMs: 4000 }).then((res) => {
      if (!cancelled && res.hasUpdate && res.updateInfo) {
        setAvailableUpdate(res.updateInfo);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const languageRef = useRef<Language>(language);
  languageRef.current = language;
  const [initialLanHostSlotId, setInitialLanHostSlotId] = useState<SaveSlotId | null>(
    null,
  );
  const noticeTimerRef = useRef<number>(0);
  const lastStartedMatchKeyRef = useRef<string | null>(null);
  const pendingLanHostWorldRef = useRef<{
    hostWorldSlotId: SaveSlotId | null;
    savedWorldData: SaveGameData | null;
  }>({ hostWorldSlotId: null, savedWorldData: null });
  const activeModalRef = useRef<ActiveModal>('none');
  activeModalRef.current = activeModal;
  const customizeReturnTargetRef = useRef<
    'mobileSettings' | 'settings' | 'titleSettings'
  >('mobileSettings');

  const [isTouchHardware, setIsTouchHardware] = useState<boolean>(() =>
    detectTouchDevice(),
  );
  const [mobileSettings, setMobileSettings] = useState<MobileControlSettings>(() =>
    loadMobileSettings(),
  );
  const [extendedSettings, setExtendedSettings] = useState<ExtendedGameSettings>(
    () => loadExtendedSettings(),
  );
  const [settings, setSettings] = useState<GameSettings>(() => {
    const ext = loadExtendedSettings();
    return {
      mouseSensitivity: ext.camera.sensitivity,
      muted: ext.audio.muted,
      invertY: ext.camera.invertY,
    };
  });
  const [graphicsSettings, setGraphicsSettings] = useState<GraphicsSettings>(() =>
    loadGraphicsSettings(),
  );
  const [resolvedGraphicsProfile, setResolvedGraphicsProfile] =
    useState<ResolvedGraphicsProfile | null>(null);
  const [debugOverlayOpen, setDebugOverlayOpen] = useState(false);
  const [debugPerfSnapshot, setDebugPerfSnapshot] =
    useState<DebugPerformanceSnapshot | null>(null);
  const [liveFps, setLiveFps] = useState(60);

  const showMobileControls = shouldShowMobileControls(
    mobileSettings,
    isTouchHardware,
  );
  const settingsRef = useRef<GameSettings>(settings);
  settingsRef.current = settings;
  const graphicsSettingsRef = useRef<GraphicsSettings>(graphicsSettings);
  graphicsSettingsRef.current = graphicsSettings;
  const extendedSettingsRef = useRef<ExtendedGameSettings>(extendedSettings);
  extendedSettingsRef.current = extendedSettings;
  const mobileSettingsRef = useRef<MobileControlSettings>(mobileSettings);
  mobileSettingsRef.current = mobileSettings;
  const showMobileControlsRef = useRef<boolean>(showMobileControls);
  showMobileControlsRef.current = showMobileControls;
  const debugOverlayOpenRef = useRef<boolean>(debugOverlayOpen);
  debugOverlayOpenRef.current = debugOverlayOpen;

  // Reliably detect touch devices at startup and on first real touch/pointer interaction
  useEffect(() => {
    const updateFromMedia = () => {
      if (detectTouchDevice()) {
        setIsTouchHardware(true);
      }
    };
    const onTouchStart = () => {
      setIsTouchHardware(true);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        setIsTouchHardware(true);
      }
    };

    const mqCoarse = window.matchMedia?.('(pointer: coarse)');
    const mqAnyCoarse = window.matchMedia?.('(any-pointer: coarse)');
    mqCoarse?.addEventListener?.('change', updateFromMedia);
    mqAnyCoarse?.addEventListener?.('change', updateFromMedia);
    window.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });

    return () => {
      mqCoarse?.removeEventListener?.('change', updateFromMedia);
      mqAnyCoarse?.removeEventListener?.('change', updateFromMedia);
      window.removeEventListener('touchstart', onTouchStart, { capture: true });
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
    };
  }, []);

  const showNotice = useCallback((msg: string) => {
    setWorldNotice(msg);
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      setWorldNotice(null);
    }, 3400);
  }, []);

  const playUiClick = useCallback(() => {
    audioManagerRef.current?.playUiClick();
  }, []);

  const refreshSaveSlots = useCallback(() => {
    const engine = engineRef.current;
    if (engine) {
      setSaveSlots(engine.getSaveSlots());
      setSavedWorlds(engine.getSavedWorlds());
      setLatestSave(engine.getMostRecentSaveMeta());
      return;
    }
    const loader = menuLoadManagerRef.current;
    if (!loader) return;
    setSaveSlots(loader.listSaveSlots());
    setSavedWorlds(loader.listSavedWorlds());
    setLatestSave(loader.getMostRecentSaveMeta());
  }, []);

  // Keep centralized AudioManager synced with persisted/preview audio preferences
  useEffect(() => {
    audioManagerRef.current?.applySettings(
      {
        ...extendedSettings.audio,
        muted: settings.muted,
      },
      { persist: false },
    );
  }, [extendedSettings.audio, settings.muted]);

  // Play main menu music ONLY in main menu / title interface (fades out cleanly before world enters)
  useEffect(() => {
    const mode =
      phase === 'title'
        ? 'menu'
        : phase === 'loading'
          ? 'loading'
          : phase === 'paused'
            ? 'paused'
            : 'world';
    audioManagerRef.current?.setSceneMode(mode);
  }, [phase]);

  // Lightweight startup setup: populate saved worlds list & accessibility attrs without initializing 3D engine
  useEffect(() => {
    let cancelled = false;
    applyAccessibilityDocumentAttributes(loadExtendedSettings().accessibility);
    exportMissingAndroidSettingsSnapshot({
      lang: languageRef.current,
      graphics: graphicsSettingsRef.current,
      extended: extendedSettingsRef.current,
      mobile: mobileSettingsRef.current,
    });
    refreshSaveSlots();
    void hydratePersistentWorldStorage().then(() => {
      if (!cancelled) {
        refreshSaveSlots();
      }
    });
    void getModManager().initialize();
    void hydrateWindowsSettingsFromNative({
      lang: languageRef.current,
      graphics: graphicsSettingsRef.current,
      extended: extendedSettingsRef.current,
      mobile: mobileSettingsRef.current,
    }).then((winRes) => {
      if (cancelled) return;
      if (winRes.changed) {
        const nextLang = loadSavedLanguage();
        const nextGfx = loadGraphicsSettings();
        const nextExt = loadExtendedSettings();
        const nextMobile = loadMobileSettings();
        setLanguage(nextLang);
        setGraphicsSettings(nextGfx);
        setExtendedSettings(nextExt);
        setMobileSettings(nextMobile);
        setSettings({
          mouseSensitivity: nextExt.camera.sensitivity,
          muted: nextExt.audio.muted,
          invertY: nextExt.camera.invertY,
        });
        applyAccessibilityDocumentAttributes(nextExt.accessibility);
        audioManagerRef.current?.applySettings(nextExt.audio, {
          persist: false,
        });
        engineRef.current?.applyExtendedSettings(nextExt);
        engineRef.current?.updateGraphicsSettings(nextGfx);
      }
      if (winRes.restoredProfile) {
        ProfileManager.reloadLocalProfileFromStorage();
      }
    });

    window.__onAndroidStorageStatusChanged = (statusJson: string) => {
      if (cancelled) return;
      const parsedStatus = parseAndroidStorageStatusJson(statusJson);
      if (parsedStatus?.writable) {
        const res = hydrateAndroidSettingsFromNative(true);
        if (res.changed) {
          const nextLang = loadSavedLanguage();
          const nextGfx = loadGraphicsSettings();
          const nextExt = loadExtendedSettings();
          const nextMobile = loadMobileSettings();
          setLanguage(nextLang);
          setGraphicsSettings(nextGfx);
          setExtendedSettings(nextExt);
          setMobileSettings(nextMobile);
          setSettings({
            mouseSensitivity: nextExt.camera.sensitivity,
            muted: nextExt.audio.muted,
            invertY: nextExt.camera.invertY,
          });
          applyAccessibilityDocumentAttributes(nextExt.accessibility);
          audioManagerRef.current?.applySettings(nextExt.audio, {
            persist: false,
          });
          engineRef.current?.applyExtendedSettings(nextExt);
          engineRef.current?.updateGraphicsSettings(nextGfx);
          ProfileManager.reloadLocalProfileFromStorage();
          exportMissingAndroidSettingsSnapshot({
            lang: nextLang,
            graphics: nextGfx,
            extended: nextExt,
            mobile: nextMobile,
          });
        } else {
          exportMissingAndroidSettingsSnapshot({
            lang: languageRef.current,
            graphics: graphicsSettingsRef.current,
            extended: extendedSettingsRef.current,
            mobile: mobileSettingsRef.current,
          });
        }
        void hydratePersistentWorldStorage(true).then(() => {
          if (!cancelled) {
            refreshSaveSlots();
          }
        });
        void getModManager().refreshMods();
      }
    };

    return () => {
      cancelled = true;
      delete window.__onAndroidStorageStatusChanged;
      window.clearTimeout(noticeTimerRef.current);
      void ProfileManager.flushStatsDelta();
      void flushPendingWorldSaves();
      engineRef.current?.dispose();
      engineRef.current = null;
      audioManagerRef.current?.dispose();
      audioManagerRef.current = null;
    };
  }, [refreshSaveSlots]);

  // Persist active world silently when mobile/desktop app goes to background or closes
  useEffect(() => {
    const persistOnLifecycle = () => {
      if (
        (phase === 'playing' || phase === 'paused') &&
        engineRef.current?.canPersistLocalWorld()
      ) {
        engineRef.current.saveCurrentWorld(true);
        void flushPendingWorldSaves();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistOnLifecycle();
      }
    };
    window.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', persistOnLifecycle);
    window.addEventListener('beforeunload', persistOnLifecycle);
    return () => {
      window.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', persistOnLifecycle);
      window.removeEventListener('beforeunload', persistOnLifecycle);
    };
  }, [phase]);

  // Lazy-loads Three.js GameEngine ONLY when transitioning from menu into a world
  const ensureEngine = useCallback(async (): Promise<GameEngine | null> => {
    if (engineRef.current) return engineRef.current;
    if (engineLoadPromiseRef.current) return engineLoadPromiseRef.current;
    const mountEl = canvasMountRef.current;
    if (!mountEl) return null;

    const loadTask = (async (): Promise<GameEngine | null> => {
      try {
        const { GameEngine: GameEngineCtor } = await import(
          './game/engine/GameEngine'
        );
        if (!canvasMountRef.current) return null;

        const engine = new GameEngineCtor(
          canvasMountRef.current,
          {
            onPhaseChange: (nextPhase) => {
              setPhase(nextPhase);
              refreshSaveSlots();
              if (nextPhase !== 'playing') {
                setDialogueSnapshot(null);
                engineRef.current?.endNpcDialogue();
                setActiveModal((curr) =>
                  curr === 'mobileSettings' ||
                  curr === 'graphicsSettings' ||
                  curr === 'settings' ||
                  curr === 'saveSlots' ||
                  curr === 'customizeControls' ||
                  (curr === 'map' && nextPhase === 'paused')
                    ? curr
                    : 'none',
                );
              }
            },
            onHudUpdate: (snapshot) => setHud(snapshot),
            onPointerLockChange: (locked) => setPointerLocked(locked),
            onLoadProgress: (progress, label) => {
              setLoadProgress(progress);
              setLoadLabel(label);
            },
            onInventoryToggle: () => {
              setInventoryInitialTab('pack');
              setActiveModal((prev) =>
                prev === 'dialogue'
                  ? prev
                  : prev === 'inventory'
                    ? 'none'
                    : 'inventory',
              );
            },
            onOpenCraftingStation: () => {
              setInventoryInitialTab('craft');
              setActiveModal((prev) => (prev === 'dialogue' ? prev : 'inventory'));
            },
            onMapToggle: () => {
              setActiveModal((prev) =>
                prev === 'dialogue' ? prev : prev === 'map' ? 'none' : 'map',
              );
            },
            onQuestJournalToggle: () => {
              setActiveModal((prev) =>
                prev === 'dialogue'
                  ? prev
                  : prev === 'questJournal'
                    ? 'none'
                    : 'questJournal',
              );
            },
            onPauseToggleCloseOrResume: () => {
              engineRef.current?.endNpcDialogue();
              setDialogueSnapshot(null);
              setActiveModal('none');
            },
            onWorldNotice: showNotice,
            onInventoryChange: (snapshot) => setInventorySnapshot(snapshot),
            onDialogueChange: (snapshot) => {
              setDialogueSnapshot(snapshot);
              setActiveModal(snapshot ? 'dialogue' : 'none');
            },
            onDebugToggle: () => {
              if (isDeveloperToolsEnabled()) {
                setDebugOverlayOpen((prev) => !prev);
              }
            },
            onDebugPerfUpdate: (snapshot) => {
              setDebugPerfSnapshot(snapshot);
            },
            onGraphicsProfileChange: (profile) => {
              setResolvedGraphicsProfile(profile);
            },
            onChatToggle: () => {
              setActiveModal((prev) =>
                prev === 'dialogue' ? prev : prev === 'chat' ? 'none' : 'chat',
              );
            },
            onOpenBuildingStorage: () => {
              setBuildingModalVersion((v) => v + 1);
              setActiveModal((prev) =>
                prev === 'dialogue' ? prev : 'buildingStorage',
              );
            },
            onOpenStructureManage: () => {
              setBuildingModalVersion((v) => v + 1);
              setActiveModal((prev) =>
                prev === 'dialogue' ? prev : 'structureManage',
              );
            },
            onOpenFarmPlot: () => {
              setBuildingModalVersion((v) => v + 1);
              setActiveModal((prev) =>
                prev === 'dialogue' ? prev : 'farmPlot',
              );
            },
            onOpenVillageDev: () => {
              setBuildingModalVersion((v) => v + 1);
              setActiveModal((prev) =>
                prev === 'dialogue' ? prev : 'villageDev',
              );
            },
            onOpenMerchantTrade: () => {
              setBuildingModalVersion((v) => v + 1);
              setActiveModal((prev) =>
                prev === 'dialogue' ? prev : 'merchantTrade',
              );
            },
            onFarmOrVillageStateChange: () => {
              setBuildingModalVersion((v) => v + 1);
            },
          },
          {
            language: languageRef.current,
            touchMode: showMobileControlsRef.current,
            deferInitialPhase: true,
          },
        );
        engineRef.current = engine;
        engine.setMultiplayerService(multiplayerServiceRef.current);
        engine.setLanguage(languageRef.current);
        engine.updateSettings(settingsRef.current);
        engine.applyExtendedSettings(extendedSettingsRef.current);
        engine.updateGraphicsSettings(graphicsSettingsRef.current);
        engine.setTouchMode(showMobileControlsRef.current);
        engine.updateMobileSettings(mobileSettingsRef.current);
        engine.setDebugOverlayEnabled(debugOverlayOpenRef.current);
        return engine;
      } catch (err) {
        console.error('[App] Failed to load GameEngine:', err);
        return null;
      } finally {
        engineLoadPromiseRef.current = null;
      }
    })();

    engineLoadPromiseRef.current = loadTask;
    return loadTask;
  }, [refreshSaveSlots, showNotice]);

  // Bootstrap persistent player profile & flush stats cleanly on page unload
  useEffect(() => {
    void ProfileManager.bootstrap();
    const unsubProfile = ProfileManager.subscribe((snap) => {
      const showNames = snap.profile?.privacy.showPlayerName;
      if (typeof showNames === 'boolean') {
        setExtendedSettings((prev) => {
          if (prev.gameplay.showPlayerNames === showNames) return prev;
          const next: ExtendedGameSettings = {
            ...prev,
            gameplay: { ...prev.gameplay, showPlayerNames: showNames },
          };
          saveExtendedSettings(next);
          engineRef.current?.applyExtendedSettings(next);
          return next;
        });
      }
    });
    const onUnload = () => {
      void ProfileManager.flushStatsDelta();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      unsubProfile();
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

  // Sync language with <html lang> & engine
  useEffect(() => {
    document.documentElement.lang = language;
    engineRef.current?.setLanguage(language);
  }, [language]);

  // Sync accessibility attributes on <html> whenever extended settings update
  useEffect(() => {
    applyAccessibilityDocumentAttributes(extendedSettings.accessibility);
  }, [extendedSettings.accessibility]);

  // Keep React extendedSettings.camera.perspective synced with engine HUD snapshot (e.g. KeyV or loaded save)
  useEffect(() => {
    if (!hud.cameraPerspective) return;
    setExtendedSettings((prev) => {
      if (prev.camera.perspective === hud.cameraPerspective) return prev;
      return {
        ...prev,
        camera: {
          ...prev.camera,
          perspective: hud.cameraPerspective!,
        },
      };
    });
  }, [hud.cameraPerspective]);

  // Lightweight live FPS polling only when user enabled "Show FPS Counter"
  useEffect(() => {
    if (!extendedSettings.gameplay.showFps || phase !== 'playing') return;
    const id = window.setInterval(() => {
      if (engineRef.current) {
        setLiveFps(engineRef.current.getCurrentFps());
      }
    }, 350);
    return () => window.clearInterval(id);
  }, [extendedSettings.gameplay.showFps, phase]);

  // Sync mobile touch mode, mobile settings, and modal pause state with engine
  useEffect(() => {
    engineRef.current?.setTouchMode(showMobileControls);
    engineRef.current?.updateMobileSettings(mobileSettings);
  }, [showMobileControls, mobileSettings, phase]);

  useEffect(() => {
    engineRef.current?.setModalOpen(activeModal !== 'none');
    if (activeModal === 'chat') {
      setUnreadChatCount(0);
    }
  }, [activeModal]);

  useEffect(() => {
    engineRef.current?.setDebugOverlayEnabled(debugOverlayOpen);
  }, [debugOverlayOpen]);

  // Gamepad Start button toggles Pause during gameplay/paused states
  useGamepadPauseButton(
    (phase === 'playing' || phase === 'paused') && activeModal === 'none',
    () => {
      if (phase === 'playing') {
        engineRef.current?.pauseGame();
      } else if (phase === 'paused') {
        engineRef.current?.resumeGame();
      }
    },
  );

  // Native Android back-button handler invoked by MainActivity via Capacitor bridge
  useEffect(() => {
    window.__handleAndroidBack = () => {
      if (activeModal === 'dialogue') {
        playUiClick();
        engineRef.current?.endNpcDialogue();
        return true;
      }
      if (activeModal === 'customizeControls') {
        playUiClick();
        setMobileSettings((curr) => {
          saveMobileSettings(curr);
          return curr;
        });
        if (customizeReturnTargetRef.current === 'titleSettings') {
          setActiveModal('none');
          setTitleSubScreen('settings');
        } else {
          setActiveModal(customizeReturnTargetRef.current);
        }
        return true;
      }
      if (activeModal !== 'none') {
        playUiClick();
        setActiveModal('none');
        return true;
      }
      if (phase === 'title' && titleSubScreen !== 'main') {
        playUiClick();
        setTitleSubScreen('main');
        return true;
      }
      if (debugOverlayOpen) {
        setDebugOverlayOpen(false);
        return true;
      }
      if (phase === 'playing') {
        engineRef.current?.pauseGame();
        return true;
      }
      if (phase === 'paused') {
        engineRef.current?.resumeGame();
        return true;
      }
      return false;
    };

    return () => {
      delete window.__handleAndroidBack;
    };
  }, [activeModal, debugOverlayOpen, phase, playUiClick, titleSubScreen]);

  // Clean up initial /join/ROOM_ID or ?join=ROOM_ID URL and listen for Android deep links
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const initialTarget = extractJoinTargetFromUrl(window.location.href);
      if (initialTarget) {
        try {
          const parsed = new URL(window.location.href);
          if (parsed.searchParams.has('join') || /\/join\//i.test(parsed.pathname)) {
            window.history.replaceState({}, document.title, '/');
          }
        } catch {
          // Ignore history replacement errors on custom schemes
        }
      }
    }

    window.__handleMultiplayerJoinLink = (incomingUrl: string) => {
      const target = extractJoinTargetFromUrl(incomingUrl);
      if (!target) return;
      setPendingJoinCode(target);
      if (phase === 'playing' || phase === 'paused') {
        engineRef.current?.returnToMainMenu();
      }
      setActiveModal('none');
      setTitleSubScreen('multiplayer');
    };

    return () => {
      delete window.__handleMultiplayerJoinLink;
    };
  }, [phase]);

  // Poll for incoming friend room invitations when multiplayer backend is configured
  useEffect(() => {
    const svc = multiplayerServiceRef.current;
    if (!svc || !svc.isConfigured()) return;

    const unsub = svc.subscribe((ev) => {
      if (ev.type === 'invite-received') {
        setIncomingInvite(ev.invite);
      }
    });

    const activeName = loadSavedMultiplayerName(
      language === 'ar' ? 'مغامر' : 'Adventurer',
    );
    svc.startInvitePolling(activeName);

    return () => {
      unsub();
      svc.stopInvitePolling();
    };
  }, [language, titleSubScreen]);

  const handleToggleLanguage = useCallback(() => {
    playUiClick();
    setLanguage((prev) => {
      const next: Language = prev === 'en' ? 'ar' : 'en';
      saveLanguage(next);
      return next;
    });
  }, [playUiClick]);

  const launchWorldSlotDirect = useCallback(
    (
      slotId: SaveSlotId,
      loadOptions?: {
        safeRecoveryMode?: boolean;
        overrideModSelection?: {
          selectionMode: 'vanilla' | 'custom';
          selectedMods: WorldModSelectionEntry[];
        };
      },
    ) => {
      setPendingWorldRecovery(null);
      setActiveModal('none');
      setTitleSubScreen('main');
      setPhase('loading');
      setLoadProgress(4);
      setLoadLabel(UI_TEXT[languageRef.current].loadingDefault);

      void (async () => {
        const engine = await ensureEngine();
        if (!engine) {
          setPhase('title');
          showNotice(UI_TEXT[languageRef.current].loadFailedNotice);
          return;
        }
        engine.setModalOpen(false);
        const ok = await engine.loadFromSlot(slotId, loadOptions);
        if (!ok) {
          setPhase('title');
        } else {
          setWaypoint(engine.getWaypoint());
        }
        refreshSaveSlots();
      })();
    },
    [ensureEngine, refreshSaveSlots, showNotice],
  );

  const initiateWorldLoad = useCallback(
    (slotId: SaveSlotId) => {
      playUiClick();
      void (async () => {
        try {
          const modMgr = getModManager();
          await modMgr.initialize();
          await modMgr.refreshMods();
          const loader = menuLoadManagerRef.current ?? new LoadManager();
          const res = await loader.loadSlotAsync(slotId);
          if (!res.ok) {
            showNotice(UI_TEXT[languageRef.current].loadFailedNotice);
            return;
          }
          const inspection = modMgr.inspectSaveMods(res.data);
          if (inspection.requiresWarningBeforeLoad) {
            setPendingWorldRecovery({
              slotId,
              saveData: res.data,
              initialInspection: inspection,
            });
            return;
          }
          launchWorldSlotDirect(slotId);
        } catch (err) {
          console.error('[App] Failed pre-load mod inspection:', err);
          launchWorldSlotDirect(slotId);
        }
      })();
    },
    [launchWorldSlotDirect, playUiClick, showNotice],
  );

  const handleContinue = useCallback(() => {
    const latest = engineRef.current
      ? engineRef.current.getMostRecentSaveMeta()
      : menuLoadManagerRef.current?.getMostRecentSaveMeta();
    if (!latest) {
      playUiClick();
      setTitleSubScreen('newWorld');
      return;
    }

    initiateWorldLoad(latest.slotId);
  }, [initiateWorldLoad, playUiClick]);

  const handleCreateWorld = useCallback(
    (options: NewWorldOptions) => {
      playUiClick();
      setActiveModal('none');
      setTitleSubScreen('main');
      setPhase('loading');
      setLoadProgress(4);
      setLoadLabel(UI_TEXT[languageRef.current].loadingDefault);

      void (async () => {
        const engine = await ensureEngine();
        if (!engine) {
          setPhase('title');
          showNotice(UI_TEXT[languageRef.current].loadFailedNotice);
          return;
        }
        engine.setModalOpen(false);
        const ok = await engine.createNewWorld(options);
        if (!ok) {
          setPhase('title');
          return;
        }
        setWaypoint(engine.getWaypoint());
        refreshSaveSlots();
      })();
    },
    [ensureEngine, playUiClick, refreshSaveSlots, showNotice],
  );

  const handleStartMultiplayerWorld = useCallback(
    (info: MultiplayerGameStartInfo) => {
      const matchKey = `${info.roomId}:${info.seed}`;
      if (lastStartedMatchKeyRef.current === matchKey) {
        return;
      }
      lastStartedMatchKeyRef.current = matchKey;
      const authType = info.worldSettings?.worldType ?? info.worldType;
      const authDifficulty = info.worldSettings?.difficulty ?? info.difficulty;
      const svc = multiplayerServiceRef.current;
      const localId = info.localPlayerId ?? svc?.getLocalPlayerId() ?? null;
      const isLanHost = Boolean(
        svc &&
          isSwitchingMultiplayerTransport(svc) &&
          svc.getActiveMode() === 'lan' &&
          localId &&
          info.hostId === localId,
      );
      const pendingHost = pendingLanHostWorldRef.current;
      pendingLanHostWorldRef.current = {
        hostWorldSlotId: null,
        savedWorldData: null,
      };
      setActiveModal('none');
      setTitleSubScreen('main');
      setPhase('loading');
      setLoadProgress(4);
      setLoadLabel(UI_TEXT[languageRef.current].loadingDefault);

      void (async () => {
        try {
          const engine = await ensureEngine();
          if (!engine) {
            lastStartedMatchKeyRef.current = null;
            setPhase('title');
            showNotice(UI_TEXT[languageRef.current].loadFailedNotice);
            return;
          }
          engine.setModalOpen(false);
          engine.setMultiplayerService(multiplayerServiceRef.current);
          const started = await engine.startMultiplayerWorld({
            worldName: info.worldName || info.roomName,
            seed: info.seed,
            worldType: authType,
            difficulty: authDifficulty,
            worldSettingsPermission: info.worldSettingsPermission,
            worldTime: info.worldTime,
            worldWeather: info.worldWeather,
            localPlayerId: info.localPlayerId,
            players: info.players,
            modMetadata: info.modMetadata,
            hostWorldSlotId: isLanHost ? pendingHost.hostWorldSlotId : null,
            savedWorldData: isLanHost ? pendingHost.savedWorldData : null,
          });
          if (!started) {
            lastStartedMatchKeyRef.current = null;
            setPhase('title');
            return;
          }
          setWaypoint(engine.getWaypoint());
          refreshSaveSlots();
          const t = UI_TEXT[language];
          const modeLabel =
            authType === 'survival'
              ? t.worldTypeSurvival
              : authType === 'adventure'
                ? t.worldTypeAdventure
                : authType === 'creative'
                  ? t.worldTypeCreative
                  : t.worldTypeNormal;
          showNotice(t.mpStartingWorldNotice(info.roomCode || info.roomId, modeLabel));
        } catch (err) {
          console.error('[Multiplayer] Failed to start world:', err);
          lastStartedMatchKeyRef.current = null;
          setPhase('title');
          showNotice(UI_TEXT[languageRef.current].loadFailedNotice);
        }
      })();
    },
    [ensureEngine, language, refreshSaveSlots, showNotice],
  );

  // Root-level multiplayer match transition, room snapshot, connection resilience & unread chat listener
  useEffect(() => {
    const svc = multiplayerServiceRef.current;
    if (!svc) return;
    setActiveMpRoom(svc.getRoomState());
    if (svc.getPartyState) {
      setPartyState(svc.getPartyState());
    }
    setMpConnectionState(svc.getConnectionState());
    setMpReconnectAttempt(svc.getReconnectAttempt());
    return svc.subscribe((ev) => {
      if (ev.type === 'connection-changed') {
        setMpConnectionState(ev.state);
        setMpReconnectAttempt(ev.attempt ?? svc.getReconnectAttempt());
      } else if (ev.type === 'game-started') {
        setUnreadChatCount(0);
        handleStartMultiplayerWorld(ev.info);
      } else if (ev.type === 'room-updated') {
        setActiveMpRoom(ev.room);
        void ProfileManager.updatePresence({
          currentRoomId: ev.room?.roomId ?? null,
          currentRoomName: ev.room?.roomName ?? null,
        });
      } else if (ev.type === 'party-updated') {
        setPartyState(ev.partyState);
      } else if (ev.type === 'party-invite-received') {
        showNotice(
          UI_TEXT[languageRef.current].partyInviteReceivedNotice(
            ev.invite.fromPlayerName,
          ),
        );
      } else if (ev.type === 'world-snapshot') {
        if (ev.snapshot.partyState) {
          setPartyState(ev.snapshot.partyState);
        }
      } else if (ev.type === 'host-transferred') {
        if (engineRef.current?.isMultiplayerSession()) {
          showNotice(
            UI_TEXT[languageRef.current].mpHostTransferredNotice(ev.newHostName),
          );
        }
      } else if (ev.type === 'room-closed') {
        const wasInGame = Boolean(engineRef.current?.isMultiplayerSession());
        const wasLan =
          isSwitchingMultiplayerTransport(svc) && svc.getActiveMode() === 'lan';
        lastStartedMatchKeyRef.current = null;
        setActiveMpRoom(null);
        setUnreadChatCount(0);
        setMpConnectionState('disconnected');
        setMpReconnectAttempt(0);
        if (wasInGame) {
          setActiveModal('none');
          setTitleSubScreen('multiplayer');
          engineRef.current?.returnToMainMenu();
          refreshSaveSlots();
          showNotice(
            wasLan
              ? languageRef.current === 'ar'
                ? 'تم إيقاف الخادم المحلي من صاحب الغرفة.'
                : 'The host has stopped the local server.'
              : UI_TEXT[languageRef.current].mpRoomClosedReturnNotice,
          );
        }
      } else if (ev.type === 'player-kicked' && ev.isLocalTarget) {
        const wasInGame = Boolean(engineRef.current?.isMultiplayerSession());
        lastStartedMatchKeyRef.current = null;
        setActiveMpRoom(null);
        setUnreadChatCount(0);
        setMpConnectionState('disconnected');
        setMpReconnectAttempt(0);
        if (wasInGame) {
          setActiveModal('none');
          setTitleSubScreen('multiplayer');
          engineRef.current?.returnToMainMenu();
          refreshSaveSlots();
          showNotice(UI_TEXT[languageRef.current].mpKickedNotice);
        }
      } else if (ev.type === 'chat-message') {
        const localId = svc.getLocalPlayerId();
        const isMutedOrBlocked =
          svc.isPlayerMuted(ev.message.playerId, ev.message.playerName) ||
          svc.isPlayerBlocked(ev.message.playerId, ev.message.playerName);
        if (
          activeModalRef.current !== 'chat' &&
          !isMutedOrBlocked &&
          ev.message.playerId !== localId
        ) {
          setUnreadChatCount((c) => Math.min(99, c + 1));
        }
      }
    });
  }, [handleStartMultiplayerWorld, refreshSaveSlots, showNotice]);

  const handleOpenSaveSlots = useCallback(() => {
    engineRef.current?.sound.playUiClick();
    refreshSaveSlots();
    setActiveModal('saveSlots');
  }, [refreshSaveSlots]);

  const handleQuickSave = useCallback(() => {
    engineRef.current?.saveCurrentWorld(false);
    refreshSaveSlots();
  }, [refreshSaveSlots]);

  const handleSaveSlot = useCallback(
    (slotId: SaveSlotId) => {
      engineRef.current?.saveToSlot(slotId, false);
      refreshSaveSlots();
    },
    [refreshSaveSlots],
  );

  const handleLoadSlot = useCallback(
    (slotId: SaveSlotId) => {
      initiateWorldLoad(slotId);
    },
    [initiateWorldLoad],
  );

  const handleDeleteSlot = useCallback(
    (slotId: SaveSlotId) => {
      if (engineRef.current) {
        engineRef.current.deleteSaveSlot(slotId);
        refreshSaveSlots();
        return;
      }
      const existing = menuLoadManagerRef.current?.loadSlot(slotId);
      const label = existing?.ok ? existing.data.meta.worldName : slotId;
      if (menuSaveManagerRef.current?.deleteSave(slotId)) {
        playUiClick();
        showNotice(UI_TEXT[languageRef.current].deletedNotice(label));
      }
      refreshSaveSlots();
    },
    [playUiClick, refreshSaveSlots, showNotice],
  );

  const handleResume = useCallback(() => {
    setActiveModal('none');
    engineRef.current?.resumeGame();
  }, []);

  const handlePause = useCallback(() => {
    if (hud.isSleeping) return;
    setActiveModal('none');
    engineRef.current?.pauseGame();
  }, [hud.isSleeping]);

  const handleExitMultiplayerToMenu = useCallback(() => {
    if (engineRef.current?.canPersistLocalWorld()) {
      engineRef.current.saveCurrentWorld(true);
    }
    void flushPendingWorldSaves();
    pendingLanHostWorldRef.current = {
      hostWorldSlotId: null,
      savedWorldData: null,
    };
    void multiplayerServiceRef.current?.leaveRoom().catch(() => {
      // Ignore network errors while exiting back to multiplayer menu
    });
    lastStartedMatchKeyRef.current = null;
    setActiveMpRoom(null);
    setUnreadChatCount(0);
    setMpConnectionState('disconnected');
    setMpReconnectAttempt(0);
    setActiveModal('none');
    setTitleSubScreen('multiplayer');
    engineRef.current?.returnToMainMenu();
    refreshSaveSlots();
  }, [refreshSaveSlots]);

  const handleReturnToMainMenu = useCallback(
    (saveFirst: boolean) => {
      if (saveFirst && engineRef.current?.canPersistLocalWorld()) {
        engineRef.current.saveCurrentWorld(false);
      }
      void flushPendingWorldSaves();
      pendingLanHostWorldRef.current = {
        hostWorldSlotId: null,
        savedWorldData: null,
      };
      if (engineRef.current?.isMultiplayerSession()) {
        void multiplayerServiceRef.current?.leaveRoom().catch(() => {
          // Ignore network errors when leaving room cleanly
        });
        void ProfileManager.updatePresence({
          currentRoomId: null,
          currentRoomName: null,
        });
      }
      void ProfileManager.flushStatsDelta();
      void CloudSaveService.flushPendingQueue();
      lastStartedMatchKeyRef.current = null;
      setActiveModal('none');
      setTitleSubScreen('main');
      engineRef.current?.returnToMainMenu();
      refreshSaveSlots();
    },
    [refreshSaveSlots],
  );

  const handleBeforeAppExit = useCallback(async () => {
    if (engineRef.current?.canPersistLocalWorld()) {
      engineRef.current.saveCurrentWorld(true);
    }
    await flushPendingWorldSaves();
    refreshSaveSlots();
  }, [refreshSaveSlots]);

  // Register CloudSaveService hooks & bootstrap cloud session on startup
  useEffect(() => {
    SaveManager.registerCloudHooks({
      onSave: (slotId) => {
        CloudSaveService.scheduleWorldSave(slotId);
        CloudSaveService.schedulePlayerSave();
      },
      onDelete: (slotId) => {
        void CloudSaveService.deleteWorldData(slotId);
      },
    });
    if (AuthService.isSignedInCloudAccount()) {
      void AuthService.fetchAccountMe().then((me) => {
        if (me?.account) {
          ProfileManager.syncFromCloudAccount(me.account);
        }
      });
      void CloudSaveService.flushPendingQueue();
    }
  }, []);

  const handleResetPosition = useCallback(() => {
    setActiveModal('none');
    engineRef.current?.resetPlayerPosition();
    engineRef.current?.resumeGame();
  }, []);

  const handlePreviewAudio = useCallback((audio: AudioSettings) => {
    audioManagerRef.current?.applySettings(audio, { persist: false });
  }, []);

  const handleUpdateSettings = useCallback((partial: Partial<GameSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      engineRef.current?.updateSettings(next);
      return next;
    });
    if (
      partial.muted !== undefined ||
      partial.mouseSensitivity !== undefined ||
      partial.invertY !== undefined
    ) {
      setExtendedSettings((prev) => {
        const nextExt: ExtendedGameSettings = {
          ...prev,
          audio: {
            ...prev.audio,
            ...(partial.muted !== undefined ? { muted: partial.muted } : {}),
          },
          camera: {
            ...prev.camera,
            ...(partial.mouseSensitivity !== undefined
              ? { sensitivity: partial.mouseSensitivity }
              : {}),
            ...(partial.invertY !== undefined
              ? { invertY: partial.invertY }
              : {}),
          },
        };
        saveExtendedSettings(nextExt);
        return nextExt;
      });
    }
  }, []);

  const handleUpdateGraphicsSettings = useCallback(
    (partial: Partial<GraphicsSettings>) => {
      playUiClick();
      const nextProfile = engineRef.current?.updateGraphicsSettings(partial);
      const nextSettings = engineRef.current?.getGraphicsSettings();
      if (nextSettings) {
        setGraphicsSettings(nextSettings);
        saveGraphicsSettings(nextSettings);
      } else {
        setGraphicsSettings((prev) => {
          const merged = { ...prev, ...partial };
          saveGraphicsSettings(merged);
          return merged;
        });
      }
      if (nextProfile) {
        setResolvedGraphicsProfile(nextProfile);
      }
    },
    [playUiClick],
  );

  const handleResetGraphicsAuto = useCallback(() => {
    playUiClick();
    if (engineRef.current) {
      const nextProfile = engineRef.current.resetGraphicsSettings();
      const nextSettings = engineRef.current.getGraphicsSettings();
      if (nextSettings) setGraphicsSettings(nextSettings);
      if (nextProfile) setResolvedGraphicsProfile(nextProfile);
    } else {
      const resetGfx: GraphicsSettings = { ...DEFAULT_GRAPHICS_SETTINGS };
      saveGraphicsSettings(resetGfx);
      setGraphicsSettings(resetGfx);
    }
  }, [playUiClick]);

  const handleApplyExtendedSettings = useCallback(
    (payload: {
      lang: Language;
      graphics: GraphicsSettings;
      extended: ExtendedGameSettings;
      game: GameSettings;
      mobile: MobileControlSettings;
    }) => {
      playUiClick();

      setLanguage(payload.lang);
      saveLanguage(payload.lang);

      handleUpdateGraphicsSettings(payload.graphics);

      setExtendedSettings(payload.extended);
      saveExtendedSettings(payload.extended);
      applyAccessibilityDocumentAttributes(payload.extended.accessibility);
      engineRef.current?.applyExtendedSettings(payload.extended);
      if (ProfileManager.hasProfile()) {
        void ProfileManager.updateProfile({
          privacy: { showPlayerName: payload.extended.gameplay.showPlayerNames },
        });
      }

      setSettings(payload.game);
      engineRef.current?.updateSettings(payload.game);

      setMobileSettings(payload.mobile);
      saveMobileSettings(payload.mobile);

      showNotice(UI_TEXT[payload.lang].settingsAppliedNotice);
    },
    [handleUpdateGraphicsSettings, playUiClick, showNotice],
  );

  const handleResetAllSettings = useCallback(() => {
    playUiClick();
    const defExt = createDefaultExtendedSettings();
    const defGame: GameSettings = {
      mouseSensitivity: 1.0,
      muted: false,
      invertY: false,
    };
    const defMobile: MobileControlSettings = { ...DEFAULT_MOBILE_SETTINGS };

    if (engineRef.current) {
      const nextProfile = engineRef.current.resetGraphicsSettings();
      const nextGfx = engineRef.current.getGraphicsSettings();
      if (nextGfx) setGraphicsSettings(nextGfx);
      if (nextProfile) setResolvedGraphicsProfile(nextProfile);
    } else {
      const resetGfx: GraphicsSettings = { ...DEFAULT_GRAPHICS_SETTINGS };
      saveGraphicsSettings(resetGfx);
      setGraphicsSettings(resetGfx);
    }

    setExtendedSettings(defExt);
    saveExtendedSettings(defExt);
    applyAccessibilityDocumentAttributes(defExt.accessibility);
    engineRef.current?.applyExtendedSettings(defExt);

    setSettings(defGame);
    engineRef.current?.updateSettings(defGame);

    setMobileSettings(defMobile);
    saveMobileSettings(defMobile);
  }, [playUiClick]);

  const handleUpdateMobileSettings = useCallback((next: MobileControlSettings) => {
    setMobileSettings(next);
    saveMobileSettings(next);
  }, []);

  const handleOpenCustomizeControls = useCallback(
    (returnTarget: 'mobileSettings' | 'settings' | 'titleSettings' = 'mobileSettings') => {
      playUiClick();
      customizeReturnTargetRef.current = returnTarget;
      if (returnTarget === 'titleSettings') {
        setTitleSubScreen('main');
      }
      setActiveModal('customizeControls');
    },
    [playUiClick],
  );

  const handleExitCustomizeControls = useCallback(() => {
    playUiClick();
    setMobileSettings((curr) => {
      saveMobileSettings(curr);
      return curr;
    });
    if (customizeReturnTargetRef.current === 'titleSettings') {
      setActiveModal('none');
      setTitleSubScreen('settings');
    } else {
      setActiveModal(customizeReturnTargetRef.current);
    }
  }, [playUiClick]);

  const handleSaveMobileSettingsAndClose = useCallback(() => {
    engineRef.current?.sound.playUiClick();
    setMobileSettings((curr) => {
      saveMobileSettings(curr);
      return curr;
    });
    showNotice(UI_TEXT[language].settingsSavedNotice);
    setActiveModal('none');
  }, [language, showNotice]);

  const handleToggleMute = useCallback(() => {
    setSettings((prev) => {
      const next = { ...prev, muted: !prev.muted };
      audioManagerRef.current?.unlock();
      audioManagerRef.current?.setMuted(next.muted, false);
      engineRef.current?.updateSettings(next);
      setExtendedSettings((prevExt) => {
        const nextExt: ExtendedGameSettings = {
          ...prevExt,
          audio: { ...prevExt.audio, muted: next.muted },
        };
        saveExtendedSettings(nextExt);
        return nextExt;
      });
      return next;
    });
  }, []);

  const handleOpenInventory = useCallback(() => {
    if (hud.isSleeping) return;
    engineRef.current?.sound.playUiClick();
    setInventoryInitialTab('pack');
    setActiveModal((prev) => (prev === 'inventory' ? 'none' : 'inventory'));
  }, [hud.isSleeping]);

  const handleOpenMap = useCallback(() => {
    if (hud.isSleeping) return;
    engineRef.current?.sound.playUiClick();
    setActiveModal((prev) => (prev === 'map' ? 'none' : 'map'));
  }, [hud.isSleeping]);

  const handleSetWaypoint = useCallback((wp: MapWaypoint) => {
    engineRef.current?.setWaypoint(wp);
    setWaypoint(engineRef.current?.getWaypoint() ?? wp);
  }, []);

  const handleClearWaypoint = useCallback(() => {
    engineRef.current?.clearWaypoint();
    setWaypoint(null);
  }, []);

  const handleToggleMiniMapRotate = useCallback(() => {
    engineRef.current?.sound.playUiClick();
    setExtendedSettings((prev) => {
      const next: ExtendedGameSettings = {
        ...prev,
        gameplay: {
          ...prev.gameplay,
          miniMapRotate: !prev.gameplay.miniMapRotate,
        },
      };
      saveExtendedSettings(next);
      engineRef.current?.applyExtendedSettings(next);
      return next;
    });
  }, []);

  const handleToggleShowPartyMembersOnMap = useCallback(() => {
    engineRef.current?.sound.playUiClick();
    setExtendedSettings((prev) => {
      const next: ExtendedGameSettings = {
        ...prev,
        gameplay: {
          ...prev.gameplay,
          showPartyMembersOnMap: !prev.gameplay.showPartyMembersOnMap,
        },
      };
      saveExtendedSettings(next);
      engineRef.current?.applyExtendedSettings(next);
      return next;
    });
  }, []);

  // KeyO toggles the Party / Co-op panel during multiplayer gameplay
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'KeyO') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (phase !== 'playing' || hud.isSleeping) return;
      if (!engineRef.current?.isMultiplayerSession() && !activeMpRoom) return;
      e.preventDefault();
      engineRef.current?.sound.playUiClick();
      setActiveModal((prev) =>
        prev === 'dialogue' ? prev : prev === 'party' ? 'none' : 'party',
      );
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeMpRoom, hud.isSleeping, phase]);

  const handleOpenQuestJournal = useCallback(() => {
    if (hud.isSleeping) return;
    engineRef.current?.sound.playUiClick();
    setActiveModal((prev) =>
      prev === 'questJournal' ? 'none' : 'questJournal',
    );
  }, [hud.isSleeping]);

  const handleTrackQuest = useCallback((questId: string) => {
    engineRef.current?.sound.playUiClick();
    engineRef.current?.setTrackedQuest(questId);
  }, []);

  const handleCloseDialogue = useCallback(() => {
    engineRef.current?.sound.playUiClick();
    engineRef.current?.endNpcDialogue();
  }, []);

  const handleNextDialogue = useCallback(() => {
    engineRef.current?.advanceDialogue();
  }, []);

  const handleSelectDialogueChoice = useCallback((choiceId: string) => {
    engineRef.current?.selectDialogueChoice(choiceId);
  }, []);

  return (
    <main className="relative w-full h-full overflow-hidden bg-[#0d1712]">
      {/* Isolated WebGL canvas mount so React state updates never recreate the 3D scene */}
      <div ref={canvasMountRef} className="absolute inset-0 w-full h-full touch-action-none" />

      {phase === 'loading' && (
        <LoadingScreen
          progress={loadProgress}
          statusLabel={loadLabel}
          lang={language}
        />
      )}

      {phase === 'title' && activeModal !== 'customizeControls' && (
        <TitleScreen
          lang={language}
          subScreen={titleSubScreen}
          latestSave={latestSave}
          savedWorlds={savedWorlds}
          showMobileControls={showMobileControls}
          muted={settings.muted}
          graphicsSettings={graphicsSettings}
          extendedSettings={extendedSettings}
          gameSettings={settings}
          mobileSettings={mobileSettings}
          onChangeSubScreen={(next) => {
            playUiClick();
            refreshSaveSlots();
            setTitleSubScreen(next);
          }}
          onToggleLanguage={handleToggleLanguage}
          onToggleMute={handleToggleMute}
          onContinue={handleContinue}
          onCreateWorld={handleCreateWorld}
          onPlayWorld={handleLoadSlot}
          canHostLan={getLanCapabilities().canHost}
          onHostWorldLan={(slotId) => {
            playUiClick();
            setInitialLanHostSlotId(slotId);
            setTitleSubScreen('multiplayer');
          }}
          onDeleteWorld={handleDeleteSlot}
          onApplySettings={handleApplyExtendedSettings}
          onPreviewAudio={handlePreviewAudio}
          onResetAllSettings={handleResetAllSettings}
          onOpenCustomizeControls={() =>
            handleOpenCustomizeControls('titleSettings')
          }
          multiplayerService={multiplayerServiceRef.current}
          initialJoinCode={pendingJoinCode}
          onConsumeInitialJoinCode={() => setPendingJoinCode(null)}
          initialLanHostSlotId={initialLanHostSlotId}
          onConsumeInitialLanHostSlotId={() => setInitialLanHostSlotId(null)}
          onPrepareHostWorld={(info) => {
            pendingLanHostWorldRef.current = info;
          }}
          onStartMultiplayerWorld={handleStartMultiplayerWorld}
          onOpenProfile={() => {
            playUiClick();
            setAccountCloudModalOpen(true);
          }}
        />
      )}

      {(phase === 'playing' || activeModal === 'customizeControls') && (
        <>
          <HudOverlay
            hud={hud}
            pointerLocked={pointerLocked}
            muted={settings.muted}
            showMobileControls={
              showMobileControls || activeModal === 'customizeControls'
            }
            mobileSettings={mobileSettings}
            customizeMode={activeModal === 'customizeControls'}
            worldNotice={worldNotice}
            lang={language}
            showHud={extendedSettings.gameplay.showHud}
            showFps={extendedSettings.gameplay.showFps}
            showBiomeDebug={extendedSettings.gameplay.showBiomeDebug}
            fps={liveFps}
            mapManager={engineRef.current?.mapManager ?? null}
            mapData={engineRef.current?.getMapData() ?? null}
            waypoint={waypoint}
            miniMapRotate={extendedSettings.gameplay.miniMapRotate}
            showPartyMembersOnMap={extendedSettings.gameplay.showPartyMembersOnMap}
            onToggleMute={handleToggleMute}
            onPause={handlePause}
            onOpenInventory={handleOpenInventory}
            onOpenMap={handleOpenMap}
            onOpenQuestJournal={handleOpenQuestJournal}
            onSelectWeaponSlot={(slotIndex) =>
              engineRef.current?.useInventorySlot(slotIndex)
            }
            onUnequipWeapon={() => engineRef.current?.unequipWeapon()}
            onJumpToTimePreset={(preset) =>
              engineRef.current?.jumpToTimePreset(preset)
            }
            onSetDayDuration={(sec) =>
              engineRef.current?.setFullDayDurationSeconds(sec)
            }
            onSetTimeScale={(scale) =>
              engineRef.current?.setTimeScale(scale)
            }
            onToggleTimePaused={(paused) =>
              engineRef.current?.setTimePaused(paused)
            }
            onSetWeatherState={(state) =>
              engineRef.current?.setWeatherState(state)
            }
            onSetWeatherDynamic={(enabled) =>
              engineRef.current?.setWeatherDynamic(enabled)
            }
            onSetWeatherTransitionDuration={(sec) =>
              engineRef.current?.setWeatherTransitionDuration(sec)
            }
            onSetWeatherQuality={(quality) =>
              engineRef.current?.setWeatherQuality(quality)
            }
            onTriggerLightning={() =>
              engineRef.current?.triggerLightningStrike()
            }
            onCycleCameraPerspective={() =>
              engineRef.current?.cycleCameraPerspective()
            }
            isMultiplayer={Boolean(engineRef.current?.isMultiplayerSession() || activeMpRoom)}
            unreadChatCount={unreadChatCount}
            onOpenChat={() => {
              if (hud.isSleeping) return;
              engineRef.current?.sound.playUiClick();
              setActiveModal((prev) => (prev === 'chat' ? 'none' : 'chat'));
            }}
            partyState={partyState}
            onOpenParty={() => {
              if (hud.isSleeping) return;
              engineRef.current?.sound.playUiClick();
              setActiveModal((prev) => (prev === 'party' ? 'none' : 'party'));
            }}
            onToggleBuildMode={() => engineRef.current?.toggleBuildMode()}
            onOpenStructureManage={() => engineRef.current?.openStructureManageModal()}
          />

          {((showMobileControls && activeModal === 'none') ||
            activeModal === 'customizeControls') && (
            <MobileControlsOverlay
              mobileInput={engineRef.current?.getMobileInput() ?? null}
              settings={mobileSettings}
              grounded={hud.grounded}
              nearbyInteractable={hud.nearbyInteractable}
              lang={language}
              customizeMode={activeModal === 'customizeControls'}
              equippedWeaponIsRanged={Boolean(hud.equippedWeapon?.isRanged)}
              bowChargeProgress={hud.isChargingBow ? (hud.bowChargeProgress ?? 0) : 0}
              cameraPerspective={hud.cameraPerspective}
              buildModeActive={Boolean(hud.buildMode?.active)}
              nearbyPlayerStructureId={hud.nearbyPlayerStructureId ?? null}
              onUpdateSettings={handleUpdateMobileSettings}
              onExitCustomize={handleExitCustomizeControls}
              onPause={handlePause}
              onOpenInventory={handleOpenInventory}
              onOpenMap={handleOpenMap}
              onOpenQuestJournal={handleOpenQuestJournal}
              onCycleCameraPerspective={() =>
                engineRef.current?.cycleCameraPerspective()
              }
              onToggleBuildMode={() => engineRef.current?.toggleBuildMode()}
              onOpenStructureManage={() => engineRef.current?.openStructureManageModal()}
              onCanvasTap={(x, y) => engineRef.current?.handleScreenTap(x, y)}
            />
          )}

          {phase === 'playing' && activeModal === 'none' && hud.buildMode?.active && (
            <BuildModeOverlay
              buildMode={hud.buildMode}
              lang={language}
              showMobileControls={showMobileControls}
              onSelectCategory={(cat) => engineRef.current?.selectBuildCategory(cat)}
              onSelectBlueprint={(bpId) => engineRef.current?.selectBlueprint(bpId)}
              onRotate={(dir) => engineRef.current?.rotateBuildPreview(dir)}
              onSetRotationStep={(deg) => engineRef.current?.setBuildRotationStep(deg)}
              onToggleSnap={() => engineRef.current?.toggleBuildSnap()}
              onNudge={(dx, dz) => engineRef.current?.nudgeBuildPreview(dx, dz)}
              onResetNudge={() => engineRef.current?.resetBuildNudge()}
              onAdjustDistance={(delta) => engineRef.current?.adjustBuildDistance(delta)}
              onSetDefaultPermission={(scope) =>
                engineRef.current?.setBuildDefaultPermission(scope)
              }
              onConfirmPlace={() => engineRef.current?.confirmBuildPlacement()}
              onExit={() => engineRef.current?.exitBuildMode()}
            />
          )}

          {activeModal === 'buildingStorage' && (() => {
            void buildingModalVersion;
            const storageSnap = engineRef.current?.getStorageModalSnapshot() ?? null;
            if (!storageSnap) return null;
            return (
              <BuildingStorageModal
                snapshot={storageSnap}
                inventory={inventorySnapshot}
                lang={language}
                onTransfer={(dir, itemId, count) => {
                  const ok = engineRef.current?.transferStorageItem(
                    storageSnap.structureId,
                    dir,
                    itemId,
                    count,
                  );
                  if (ok) setBuildingModalVersion((v) => v + 1);
                }}
                onClose={() => setActiveModal('none')}
              />
            );
          })()}

          {activeModal === 'structureManage' && (() => {
            void buildingModalVersion;
            const manageSnap = engineRef.current?.getStructureManageSnapshot() ?? null;
            if (!manageSnap) return null;
            return (
              <StructureManageModal
                snapshot={manageSnap}
                lang={language}
                onRepair={(sid) => {
                  const ok = engineRef.current?.repairStructure(sid);
                  if (ok) setBuildingModalVersion((v) => v + 1);
                }}
                onUpgrade={(sid) => {
                  const ok = engineRef.current?.upgradeStructure(sid);
                  if (ok) setBuildingModalVersion((v) => v + 1);
                }}
                onSetPermission={(sid, scope) => {
                  const ok = engineRef.current?.setStructurePermission(sid, scope);
                  if (ok) setBuildingModalVersion((v) => v + 1);
                }}
                onDemolish={(sid) => {
                  const ok = Boolean(engineRef.current?.demolishStructure(sid));
                  if (ok) setBuildingModalVersion((v) => v + 1);
                  return ok;
                }}
                onClose={() => setActiveModal('none')}
              />
            );
          })()}

          {activeModal === 'farmPlot' && (() => {
            void buildingModalVersion;
            const farmSnap = engineRef.current?.getFarmPlotSnapshot() ?? null;
            if (!farmSnap) return null;
            return (
              <FarmPlotModal
                snapshot={farmSnap}
                lang={language}
                onTillSoil={(sid) => {
                  const ok = engineRef.current?.tillFarmPlot(sid);
                  if (ok) setBuildingModalVersion((v) => v + 1);
                }}
                onPlantSeed={(sid, cropId) => {
                  const ok = engineRef.current?.plantFarmSeed(sid, cropId);
                  if (ok) setBuildingModalVersion((v) => v + 1);
                }}
                onWaterPlot={(sid) => {
                  const ok = engineRef.current?.waterFarmPlot(sid);
                  if (ok) setBuildingModalVersion((v) => v + 1);
                }}
                onHarvestPlot={(sid) => {
                  const ok = engineRef.current?.harvestFarmPlot(sid);
                  if (ok) setBuildingModalVersion((v) => v + 1);
                }}
                onClose={() => setActiveModal('none')}
              />
            );
          })()}

          {activeModal === 'villageDev' && (() => {
            void buildingModalVersion;
            const villageSnap = engineRef.current?.getVillageDevSnapshot() ?? null;
            if (!villageSnap) return null;
            return (
              <VillageDevelopmentModal
                snapshot={villageSnap}
                lang={language}
                onCompleteRepair={(villageId, repairId) => {
                  const ok = engineRef.current?.completeVillageRepair(villageId, repairId);
                  if (ok) setBuildingModalVersion((v) => v + 1);
                }}
                onCompleteProject={(villageId, projectId) => {
                  const ok = engineRef.current?.completeVillageProject(villageId, projectId);
                  if (ok) setBuildingModalVersion((v) => v + 1);
                }}
                onStartDefense={(villageId) => {
                  const ok = engineRef.current?.startVillageDefense(villageId);
                  if (ok) {
                    setBuildingModalVersion((v) => v + 1);
                    setActiveModal('none');
                  }
                }}
                onClose={() => setActiveModal('none')}
              />
            );
          })()}

          {activeModal === 'merchantTrade' && (() => {
            void buildingModalVersion;
            const tradeSnap = engineRef.current?.getMerchantTradeSnapshot() ?? null;
            if (!tradeSnap) return null;
            return (
              <MerchantTradeModal
                snapshot={tradeSnap}
                lang={language}
                onBuyOffer={(offerId) => {
                  const ok = engineRef.current?.buyMerchantOffer(offerId);
                  if (ok) setBuildingModalVersion((v) => v + 1);
                }}
                onSellItem={(itemId, count) => {
                  const ok = engineRef.current?.sellMerchantItem(itemId, count);
                  if (ok) setBuildingModalVersion((v) => v + 1);
                }}
                onClose={() => setActiveModal('none')}
              />
            );
          })()}

          {activeModal === 'inventory' && (
            <InventoryModal
              snapshot={inventorySnapshot}
              quests={engineRef.current?.getJournalQuests() ?? []}
              craftRecipes={engineRef.current?.getCraftingRecipes() ?? []}
              nearbyStations={engineRef.current?.getNearbyCraftingStations() ?? ['hand']}
              playerLevel={hud.level}
              initialTab={inventoryInitialTab}
              lang={language}
              onUseSlot={(slotIndex) => engineRef.current?.useInventorySlot(slotIndex)}
              onDropSlot={(slotIndex, count) =>
                engineRef.current?.dropInventorySlot(slotIndex, count)
              }
              onCraftRecipe={(recipeId) => engineRef.current?.craftRecipe(recipeId)}
              onClose={() => setActiveModal('none')}
            />
          )}

          {activeModal === 'questJournal' && (
            <QuestJournalModal
              activeQuests={
                engineRef.current?.getQuestJournalData().active ?? []
              }
              completedQuests={
                engineRef.current?.getQuestJournalData().completed ?? []
              }
              availableQuests={
                engineRef.current?.getQuestJournalData().available ?? []
              }
              coopObjective={
                partyState.party?.activeObjective ??
                engineRef.current?.dialogueEngine.quests.getCoopObjective() ??
                null
              }
              storyJournal={engineRef.current?.getStoryJournalData() ?? null}
              sideQuestJournal={engineRef.current?.getSideQuestJournalData() ?? null}
              level={hud.level}
              xp={hud.xp}
              xpToNextLevel={hud.xpToNextLevel}
              coins={hud.coins}
              lang={language}
              onTrackQuest={handleTrackQuest}
              onStartStoryQuest={(questId) =>
                engineRef.current?.startStoryQuest(questId)
              }
              onRetryStoryQuest={(questId) =>
                engineRef.current?.retryStoryQuest(questId)
              }
              onAcceptSideQuest={(sideQuestId) =>
                engineRef.current?.acceptSideQuest(sideQuestId)
              }
              onAbandonSideQuest={(sideQuestId) =>
                engineRef.current?.abandonSideQuest(sideQuestId)
              }
              onRetrySideQuest={(sideQuestId) =>
                engineRef.current?.retrySideQuest(sideQuestId)
              }
              onStartCoopQuest={(questId) =>
                engineRef.current?.startCooperativeQuest(questId)
              }
              onCompleteCoopQuest={(questId) =>
                engineRef.current?.completeCooperativeQuest(questId)
              }
              onClose={() => setActiveModal('none')}
            />
          )}

          {activeModal === 'dialogue' && dialogueSnapshot && (
            <DialogueModal
              snapshot={dialogueSnapshot}
              lang={language}
              aiService={engineRef.current?.aiService ?? null}
              getAiWorldContext={() =>
                engineRef.current?.getAiWorldContext() ?? {
                  biome: hud.biome,
                  timeOfDay: hud.timeOfDayLabel,
                  weather: hud.weatherSnapshot?.currentState ?? 'clear',
                  playerLevel: hud.level,
                  activeQuests: [],
                  completedQuests: [],
                }
              }
              canTrade={isMerchantDialogueNpc(
                dialogueSnapshot.npcId,
                dialogueSnapshot.npcRole,
              )}
              canManageVillageDev={isVillageStewardNpc(
                dialogueSnapshot.npcId,
                dialogueSnapshot.npcRole,
              )}
              onOpenTrade={() => engineRef.current?.openTradeFromActiveDialogue()}
              onOpenVillageDev={() =>
                engineRef.current?.openVillageDevFromActiveDialogue()
              }
              onNext={handleNextDialogue}
              onSelectChoice={handleSelectDialogueChoice}
              onClose={handleCloseDialogue}
            />
          )}
        </>
      )}

      {(phase === 'playing' || phase === 'paused') && activeModal === 'map' && (
        <WorldMapModal
          playerX={hud.x}
          playerZ={hud.z}
          headingDeg={hud.headingDeg}
          biome={hud.biome}
          mapManager={engineRef.current?.mapManager ?? null}
          mapData={engineRef.current?.getMapData() ?? null}
          waypoint={waypoint}
          miniMapRotate={extendedSettings.gameplay.miniMapRotate}
          showPartyMembersOnMap={extendedSettings.gameplay.showPartyMembersOnMap}
          lang={language}
          onSetWaypoint={handleSetWaypoint}
          onClearWaypoint={handleClearWaypoint}
          onToggleMiniMapRotate={handleToggleMiniMapRotate}
          onToggleShowPartyMembersOnMap={handleToggleShowPartyMembersOnMap}
          onClose={() => setActiveModal('none')}
        />
      )}

      {(phase === 'playing' || phase === 'paused') &&
        activeModal === 'chat' &&
        multiplayerServiceRef.current && (
          <InGameMultiplayerChatModal
            lang={language}
            service={multiplayerServiceRef.current}
            room={activeMpRoom ?? multiplayerServiceRef.current.getRoomState()}
            onClose={() => setActiveModal('none')}
            onNotice={showNotice}
          />
        )}

      {(phase === 'playing' || phase === 'paused') &&
        activeModal === 'party' &&
        multiplayerServiceRef.current && (
          <PartyPanel
            lang={language}
            service={multiplayerServiceRef.current}
            currentRoom={activeMpRoom ?? multiplayerServiceRef.current.getRoomState()}
            partyState={partyState}
            localPlayerId={multiplayerServiceRef.current.getLocalPlayerId()}
            playerX={hud.x}
            playerZ={hud.z}
            mapPlayers={engineRef.current?.getMapData()?.players}
            coopQuestsList={(() => {
              const data = engineRef.current?.getQuestJournalData();
              if (!data) return [];
              return [
                ...data.active,
                ...data.available,
                ...data.completed,
              ].filter((q) => q.scope === 'cooperative');
            })()}
            bossEncounters={engineRef.current?.getBossEncounters() ?? []}
            onStartCoopQuest={(questId) =>
              engineRef.current?.startCooperativeQuest(questId)
            }
            onCompleteCoopQuest={(questId) =>
              engineRef.current?.completeCooperativeQuest(questId)
            }
            onClose={() => setActiveModal('none')}
            onNotice={showNotice}
          />
        )}

      {phase === 'paused' &&
        activeModal !== 'mobileSettings' &&
        activeModal !== 'graphicsSettings' &&
        activeModal !== 'settings' &&
        activeModal !== 'saveSlots' &&
        activeModal !== 'customizeControls' &&
        activeModal !== 'party' &&
        activeModal !== 'map' &&
        activeModal !== 'buildingStorage' &&
        activeModal !== 'structureManage' &&
        activeModal !== 'farmPlot' &&
        activeModal !== 'villageDev' &&
        activeModal !== 'merchantTrade' && (
          <PauseMenu
            settings={settings}
            showMobileControls={showMobileControls}
            lang={language}
            activeWorldName={
              engineRef.current?.getActiveWorldMeta().worldName ??
              UI_TEXT[language].gameTitle
            }
            hasUnsavedProgress={
              engineRef.current?.getHasUnsavedProgress() ?? false
            }
            timeSnapshot={hud.timeSnapshot}
            weatherSnapshot={hud.weatherSnapshot}
            onToggleLanguage={handleToggleLanguage}
            onResume={handleResume}
            onOpenMap={handleOpenMap}
            onSaveWorld={handleQuickSave}
            onOpenSettings={() => {
              engineRef.current?.sound.playUiClick();
              setSettingsInitialTab('graphics');
              setActiveModal('settings');
            }}
            onOpenMods={() => {
              engineRef.current?.sound.playUiClick();
              setSettingsInitialTab('mods');
              setActiveModal('settings');
            }}
            onReturnToMainMenu={handleReturnToMainMenu}
            onResetPosition={handleResetPosition}
            onOpenSaveSlots={handleOpenSaveSlots}
            onUpdateSettings={handleUpdateSettings}
            onOpenGraphicsSettings={() => {
              engineRef.current?.sound.playUiClick();
              setActiveModal('graphicsSettings');
            }}
            graphicsSummaryLabel={
              resolvedGraphicsProfile
                ? (() => {
                    const t = UI_TEXT[language];
                    const tier = resolvedGraphicsProfile.effectiveTier;
                    const tierText =
                      tier === 'very-low'
                        ? t.tierVeryLow
                        : tier === 'low'
                          ? t.tierLow
                          : tier === 'medium'
                            ? t.tierMedium
                            : tier === 'high'
                              ? t.tierHigh
                              : t.tierUltra;
                    return graphicsSettings.preset === 'auto'
                      ? `${t.tierAuto} · ${tierText}`
                      : tierText;
                  })()
                : undefined
            }
            onOpenMobileSettings={() => setActiveModal('mobileSettings')}
            onJumpToTimePreset={(preset) =>
              engineRef.current?.jumpToTimePreset(preset)
            }
            onSetDayDuration={(sec) =>
              engineRef.current?.setFullDayDurationSeconds(sec)
            }
            onSetWeatherState={(state) =>
              engineRef.current?.setWeatherState(state)
            }
            onSetWeatherDynamic={(enabled) =>
              engineRef.current?.setWeatherDynamic(enabled)
            }
            onSetWeatherTransitionDuration={(sec) =>
              engineRef.current?.setWeatherTransitionDuration(sec)
            }
            onSetWeatherQuality={(quality) =>
              engineRef.current?.setWeatherQuality(quality)
            }
            isMultiplayer={engineRef.current?.isMultiplayerSession() ?? false}
            isHost={engineRef.current?.isMultiplayerHost() ?? false}
            canSaveWorld={engineRef.current?.canPersistLocalWorld() ?? false}
            onBeforeExit={handleBeforeAppExit}
            worldSettingsPermission={
              engineRef.current?.getWorldSettingsPermission() ??
              activeMpRoom?.worldSettingsPermission ??
              'HOST_ONLY'
            }
            canControlWorldSettings={
              engineRef.current?.canControlWorldSettings() ?? true
            }
            onSetWorldSettingsPermission={(perm) =>
              engineRef.current?.setWorldSettingsPermission(perm)
            }
            friendlyFire={Boolean(activeMpRoom?.worldSettings?.friendlyFire)}
            onSetFriendlyFire={(enabled) =>
              void engineRef.current?.setFriendlyFire(enabled)
            }
            onOpenParty={() => {
              engineRef.current?.sound.playUiClick();
              setActiveModal('party');
            }}
            partyMemberCount={partyState.party?.members.length ?? 0}
            pendingPartyInvitesCount={partyState.pendingInvites.length}
            lanServerInfo={
              isSwitchingMultiplayerTransport(multiplayerServiceRef.current) &&
              multiplayerServiceRef.current.getActiveMode() === 'lan' &&
              activeMpRoom
                ? {
                    address:
                      multiplayerServiceRef.current.getLanDisplayAddress() || '',
                    roomCode: activeMpRoom.roomCode,
                  }
                : null
            }
          />
        )}

      {activeModal === 'settings' && (
        <SettingsScreen
          lang={language}
          initialTab={settingsInitialTab}
          graphicsSettings={graphicsSettings}
          extendedSettings={extendedSettings}
          gameSettings={settings}
          mobileSettings={mobileSettings}
          showMobileControls={showMobileControls}
          onApply={handleApplyExtendedSettings}
          onPreviewAudio={handlePreviewAudio}
          onResetAll={handleResetAllSettings}
          onOpenCustomizeControls={() => handleOpenCustomizeControls('settings')}
          onBack={() => {
            engineRef.current?.sound.playUiClick();
            setActiveModal('none');
          }}
        />
      )}

      {activeModal === 'graphicsSettings' &&
        (resolvedGraphicsProfile ||
          engineRef.current?.getResolvedGraphicsProfile()) && (
          <GraphicsSettingsModal
            settings={graphicsSettings}
            profile={
              (resolvedGraphicsProfile ??
                engineRef.current?.getResolvedGraphicsProfile())!
            }
            hardware={engineRef.current?.getHardwareCapabilities() ?? null}
            debugOverlayOpen={debugOverlayOpen}
            lang={language}
            onUpdate={handleUpdateGraphicsSettings}
            onResetAuto={handleResetGraphicsAuto}
            onToggleDebugOverlay={() => setDebugOverlayOpen((prev) => !prev)}
            onClose={() => {
              engineRef.current?.sound.playUiClick();
              setActiveModal('none');
            }}
          />
        )}

      {activeModal === 'saveSlots' && (
        <SaveSlotsModal
          slots={saveSlots}
          allowSave={
            (phase === 'paused' || phase === 'playing') &&
            Boolean(
              engineRef.current?.canPersistLocalWorld() ||
                (engineRef.current?.isSafeRecoveryMode() &&
                  !engineRef.current?.isMultiplayerSession()),
            )
          }
          lang={language}
          onSaveSlot={handleSaveSlot}
          onLoadSlot={handleLoadSlot}
          onDeleteSlot={handleDeleteSlot}
          onClose={() => setActiveModal('none')}
        />
      )}

      {activeModal === 'mobileSettings' && (
        <MobileSettingsModal
          settings={mobileSettings}
          isTouchHardware={isTouchHardware}
          lang={language}
          onChange={handleUpdateMobileSettings}
          onOpenCustomize={() => handleOpenCustomizeControls('mobileSettings')}
          onSaveAndClose={handleSaveMobileSettingsAndClose}
          onClose={() => setActiveModal('none')}
        />
      )}

      {isDeveloperToolsEnabled() && debugOverlayOpen && debugPerfSnapshot && phase !== 'loading' && (
        <DebugPerformanceOverlay
          snapshot={debugPerfSnapshot}
          lang={language}
          onClose={() => setDebugOverlayOpen(false)}
        />
      )}

      {(phase === 'playing' || phase === 'paused') &&
        Boolean(engineRef.current?.isMultiplayerSession() || activeMpRoom) && (
          <ConnectionStatusBanner
            lang={language}
            connectionState={mpConnectionState}
            attempt={mpReconnectAttempt}
            maxAttempts={multiplayerServiceRef.current?.getMaxReconnectAttempts() ?? 6}
            variant="hud"
            onRetry={() => void multiplayerServiceRef.current?.retryReconnect()}
            onReturnToMenu={handleExitMultiplayerToMenu}
          />
        )}

      {phase !== 'playing' && worldNotice && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[60] pointer-events-none px-4 py-2 rounded-lg bg-[#101c16]/95 border border-[#355c47] text-xs font-medium text-[#eef5ec] shadow-xl">
          {worldNotice}
        </div>
      )}

      {incomingInvite && phase !== 'loading' && (
        <div
          role="status"
          dir={language === 'ar' ? 'rtl' : 'ltr'}
          data-testid="mp-invite-notification"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] w-[min(92vw,420px)] p-3.5 rounded-2xl bg-[#101c16]/96 border border-[#e5a93c]/60 text-[#f2f6ef] shadow-2xl backdrop-blur-md pointer-events-auto"
        >
          <div className="flex items-start gap-3">
            {incomingInvite.fromAvatar ? (
              <AvatarBadge
                avatar={incomingInvite.fromAvatar}
                seed={
                  incomingInvite.fromPublicProfileId ??
                  incomingInvite.fromPlayerName
                }
                displayName={incomingInvite.fromPlayerName}
                size="sm"
              />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-[#20382b] border border-[#e5a93c]/40 flex items-center justify-center shrink-0">
                <Mail className="w-4 h-4 text-[#e5a93c]" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="font-display font-bold text-sm text-[#ffffff] leading-snug">
                {UI_TEXT[language].profileInviteToastText(
                  incomingInvite.fromPlayerName,
                  incomingInvite.fromPlayerTag ?? '',
                  incomingInvite.roomName,
                )}
              </div>
              <div className="text-xs text-[#9db1a1] mt-0.5 truncate">
                {incomingInvite.roomName} ·{' '}
                <span dir="ltr" className="font-mono-num text-[#e5a93c]">
                  {incomingInvite.roomCode}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-2.5">
                <button
                  type="button"
                  disabled={acceptingInvite}
                  data-testid="mp-toast-accept-invite"
                  onClick={async () => {
                    const svc = multiplayerServiceRef.current;
                    if (!svc || acceptingInvite) return;
                    const t = UI_TEXT[language];
                    const name =
                      ProfileManager.getProfile()?.displayName ||
                      loadSavedMultiplayerName(
                        language === 'ar' ? 'مغامر' : 'Adventurer',
                      );
                    setAcceptingInvite(true);
                    try {
                      await svc.acceptInvite(incomingInvite.inviteId, name);
                      setIncomingInvite(null);
                      if (phase !== 'title') {
                        engineRef.current?.returnToMainMenu();
                      }
                      setActiveModal('none');
                      setTitleSubScreen('multiplayer');
                    } catch (err) {
                      setIncomingInvite(null);
                      const msg =
                        err && typeof err === 'object' && 'code' in err
                          ? (err as { code?: string }).code === 'ROOM_FULL'
                            ? t.mpErrorRoomFull
                            : (err as { code?: string }).code === 'GAME_ALREADY_STARTED'
                              ? t.mpErrorGameAlreadyStarted
                              : (err as { code?: string }).code === 'ROOM_EXPIRED'
                                ? t.mpErrorRoomExpired
                                : t.mpErrorRoomNotFound
                          : t.mpErrorRoomNotFound;
                      showNotice(msg);
                    } finally {
                      setAcceptingInvite(false);
                    }
                  }}
                  className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#e5a93c] hover:bg-[#eeb750] disabled:opacity-60 text-[#111914] font-display font-bold text-xs cursor-pointer whitespace-nowrap"
                >
                  {UI_TEXT[language].mpAcceptBtn}
                </button>
                <button
                  type="button"
                  disabled={acceptingInvite}
                  data-testid="mp-toast-decline-invite"
                  onClick={async () => {
                    const invId = incomingInvite.inviteId;
                    setIncomingInvite(null);
                    await multiplayerServiceRef.current?.declineInvite(invId);
                  }}
                  className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#182920] hover:bg-[#22392d] border border-[#2f493b] text-xs font-semibold text-[#e4ece1] cursor-pointer whitespace-nowrap"
                >
                  {UI_TEXT[language].mpDeclineBtn}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {profileModalOpen && (
        <PlayerProfileModal
          lang={language}
          targetPublicProfileId={null}
          multiplayerService={multiplayerServiceRef.current}
          onClose={() => setProfileModalOpen(false)}
          onNotice={showNotice}
          onShowPlayerNamesChanged={(enabled) => {
            setExtendedSettings((prev) => {
              const next: ExtendedGameSettings = {
                ...prev,
                gameplay: { ...prev.gameplay, showPlayerNames: enabled },
              };
              saveExtendedSettings(next);
              engineRef.current?.applyExtendedSettings(next);
              return next;
            });
          }}
        />
      )}

      {profileSetupOpen && (
        <ProfileSetupModal
          lang={language}
          onComplete={() => {
            setProfileSetupOpen(false);
            setProfileModalOpen(true);
          }}
          onCancel={() => setProfileSetupOpen(false)}
        />
      )}

      {accountCloudModalOpen && (
        <AccountCloudModal
          lang={language}
          onClose={() => setAccountCloudModalOpen(false)}
          onOpenAuthModal={() => {
            setAccountAuthIsFirstLaunch(false);
            setAccountAuthModalOpen(true);
          }}
          onCloudRestored={() => {
            refreshSaveSlots();
          }}
          onNotice={showNotice}
        />
      )}

      {accountAuthModalOpen && (
        <AccountAuthModal
          lang={language}
          initialView="welcome"
          isFirstLaunch={accountAuthIsFirstLaunch}
          onClose={() => {
            setAccountAuthModalOpen(false);
            setAccountAuthIsFirstLaunch(false);
          }}
          onPlayOffline={() => {
            setAccountAuthModalOpen(false);
            setAccountAuthIsFirstLaunch(false);
          }}
          onAuthComplete={(msg) => {
            refreshSaveSlots();
            if (msg) showNotice(msg);
          }}
        />
      )}

      {pendingWorldRecovery && (
        <WorldModRecoveryModal
          lang={language}
          slotId={pendingWorldRecovery.slotId}
          saveData={pendingWorldRecovery.saveData}
          initialInspection={pendingWorldRecovery.initialInspection}
          onSaveConfigUpdated={(updatedSave) => {
            setPendingWorldRecovery((prev) =>
              prev ? { ...prev, saveData: updatedSave } : null,
            );
            refreshSaveSlots();
          }}
          onLaunch={(overrideModSelection, safeRecoveryMode) => {
            const slotId = pendingWorldRecovery.slotId;
            launchWorldSlotDirect(slotId, {
              safeRecoveryMode,
              overrideModSelection,
            });
          }}
          onClose={() => setPendingWorldRecovery(null)}
        />
      )}

      {availableUpdate && !accountAuthModalOpen && (
        <UpdateNotificationModal
          lang={language}
          updateInfo={availableUpdate}
          onClose={() => setAvailableUpdate(null)}
          onDontShowAgain={(version) => {
            suppressUpdateVersion(version);
            setAvailableUpdate(null);
          }}
        />
      )}
    </main>
  );
}
