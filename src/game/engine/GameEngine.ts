import * as THREE from 'three';
import {
  DEFAULT_MOBILE_SETTINGS,
  type CameraPerspective,
  type GamePhase,
  type GameSettings,
  type InteractableInfo,
  type MobileControlSettings,
  type PlayerHudSnapshot,
  type UnifiedPlayerInput,
  type WeaponSlotHudView,
  type WorldCollider,
  type WorldLandmark,
  type WorldLifecycleState,
} from '../types';
import { ItemManager } from '../inventory/ItemManager';
import { InventoryManager } from '../inventory/InventoryManager';
import { CraftingManager } from '../inventory/CraftingManager';
import type {
  CraftingContext,
  CraftingRecipeView,
  CraftingStationType,
  InventorySnapshot,
  ToolKind,
} from '../inventory/inventoryTypes';
import {
  CARDINAL_LABELS,
  RESOURCE_NODE_LABELS_AR,
  ROLE_LABELS,
  UI_TEXT,
  type Language,
  getLocalizedVillageName,
  translateInteractableLabel,
  translateInteractableMessage,
} from '../i18n/translations';
import { DialogueEngine } from '../dialogue/DialogueEngine';
import type {
  DialogueSnapshot,
  DialogueWorldBridge,
} from '../dialogue/dialogueTypes';
import { getAllQuestDefinitions, getQuestDefinition } from '../quest/questRegistry';
import { generateAndRegisterProceduralQuests } from '../quest/ProceduralQuestGenerator';
import type { QuestReward, QuestView } from '../quest/questTypes';
import { StoryManager } from '../story/StoryManager';
import type { StoryJournalSnapshot, StoryWorldBridge } from '../story/storyTypes';
import { SideQuestManager } from '../sidequest/SideQuestManager';
import { SIDE_QUEST_NPCS } from '../sidequest/sideQuestData';
import type {
  SideQuestJournalSnapshot,
  SideQuestWorldBridge,
} from '../sidequest/sideQuestTypes';
import { getBiomeAt, groundHeightAt, DEFAULT_WORLD_SEED, WATER_LEVEL } from '../math/noise';
import {
  findNearestValidLand,
  findNearestValidResourceLocation,
  findValidQuestTargetPoint,
  getHydrologyClearance,
  getWorldGenTelemetry,
  isLand,
  isWater,
} from '../world/WorldPlacementValidator';
import { WorldGenDebugRenderer } from '../world/WorldGenDebugRenderer';
import { createProceduralTextures, type ProceduralTextureSet } from '../world/textures';
import { createSkyAndLighting, type SkyLightingRig } from '../world/SkyAndLighting';
import { WorldManager, type WorldInteractable } from '../world/WorldManager';
import type { VillageSiteRecord } from '../world/VillageManager';
import { PlayerCharacter } from '../entities/PlayerCharacter';
import { PlayerController } from '../player/PlayerController';
import { ThirdPersonCamera } from '../player/ThirdPersonCamera';
import { InputManager } from '../input/InputManager';
import { OrientationManager } from '../input/OrientationManager';
import type { MobileInputManager } from '../input/MobileInputManager';
import { getAudioManager } from '../audio/AudioManager';
import type { SoundEngine } from '../audio/SoundEngine';
import { CombatManager } from '../combat/CombatManager';
import { BowWeapon } from '../combat/weapons/BowWeapon';
import {
  TimeManager,
  type TimePreset,
  type TimeSnapshot,
} from '../world/TimeManager';
import {
  MAX_WEATHER_DURATION_SECONDS,
  MIN_WEATHER_DURATION_SECONDS,
  WeatherManager,
  type WeatherQuality,
  type WeatherSnapshot,
  type WeatherState,
} from '../world/WeatherManager';
import { WeatherEffects } from '../world/WeatherEffects';
import { AtmosphericParticles } from '../world/AtmosphericParticles';
import { PostProcessingPipeline } from './PostProcessing';
import {
  MapManager,
  type MapAnimalEntry,
  type MapPlayerPin,
  type MapQuestTargetEntry,
  type MapVillageEntry,
  type MapWaypoint,
  type MapWorldData,
} from '../world/MapManager';
import {
  WorldEntityRegistry,
  enemyTypeMatches,
  resolveChunkIdAt,
  type AuthoritativeEntityType,
  type AuthoritativeQuestTargetPlan,
} from '../world/WorldEntityRegistry';
import { worldToChunkCoords } from '../world/ChunkManager';
import { ENEMY_ARCHETYPES } from '../combat/EnemyController';
import { STAMINA_CONFIG_VERSION } from '../player/staminaConfig';
import { SaveManager, generateWorldId, type SaveSourceState } from '../save/SaveManager';
import { LoadManager } from '../save/LoadManager';
import type {
  DifficultyLevel,
  NewWorldOptions,
  SaveGameData,
  SaveGameMeta,
  SaveSlotId,
  SaveSlotSummary,
  WorldType,
} from '../save/saveTypes';
import {
  loadExtendedSettings,
  saveExtendedSettings,
  type CameraSettings,
  type ExtendedGameSettings,
} from '../settings/GameSettingsStore';
import { AIService } from '../ai/AIService';
import type { AIWorldContext } from '../ai/aiTypes';
import { PerformanceMonitor } from './PerformanceMonitor';
import {
  GraphicsQualityManager,
  isDeveloperToolsEnabled,
  probeHardwareCapabilities,
  type DebugPerformanceSnapshot,
  type GraphicsSettings,
  type HardwareCapabilityProfile,
  type ResolvedGraphicsProfile,
} from './GraphicsQualityManager';
import { RemotePlayersManager } from '../multiplayer/RemotePlayersManager';
import { ProfileManager } from '../profile/ProfileManager';
import type {
  EntitySyncBatchPayload,
  IMultiplayerService,
  MultiplayerPlayer,
  RoomWorldSnapshotPayload,
} from '../multiplayer/multiplayerTypes';
import {
  ALLOWED_WEAPON_IDS,
  SERVER_CRAFTABLE_YIELDS,
  generateNetworkEntityId,
  type AuthoritativeWorldTimeState,
  type AuthoritativeWorldWeatherState,
  type BossEncounterState,
  type CoopObjectiveState,
  type CoopQuestStateRecord,
  type GameEventPayload,
  type PartyStateSnapshot,
  type PlayerNetworkState,
  type RoomBuildingState,
  type RoomContainerState,
  type RoomQuestObjectState,
  type SyncedEntityDelta,
  type VillageDevelopmentSyncRecord,
  type WorldSettingsPermission,
} from '../../../shared/multiplayerProtocol';
import {
  BUILDING_BLUEPRINTS,
  getBlueprintById,
  getBlueprintsByCategory,
} from '../building/buildingCatalog';
import { validatePlayerPlacement } from '../building/PlayerBuildingValidator';
import type {
  BuildModeCostStatus,
  BuildModeHudSnapshot,
  BuildingBlueprint,
  BuildingCategory,
  BuildingPermissionScope,
  PlacementValidationResult,
  PlayerBuiltStructure,
  PlayerStructureStorageItem,
  RotationIncrementDeg,
  SavedPlayerBuilding,
  StorageModalSnapshot,
  StructureManageSnapshot,
} from '../building/buildingTypes';
import {
  ALL_CROPS,
  FARM_ANIMAL_SPECS,
  getCropById,
  getCropDisplayName,
  getFarmAnimalName,
} from '../farming/cropCatalog';
import type { CropId, FarmPlotSnapshot } from '../farming/farmingTypes';
import {
  MERCHANT_BUY_CATALOG,
  isMerchantDialogueNpc,
  isVillageStewardNpc,
} from '../village/VillageTradeCatalog';
import {
  VILLAGE_PROJECTS,
  VILLAGE_REPAIR_SITES,
} from '../village/VillageDevelopmentManager';
import type {
  MerchantTradeSnapshot,
  VillageDevelopmentSnapshot,
} from '../village/villageDevTypes';

export interface EngineCallbacks {
  onPhaseChange: (phase: GamePhase) => void;
  onHudUpdate: (snapshot: PlayerHudSnapshot) => void;
  onPointerLockChange: (locked: boolean) => void;
  onLoadProgress: (progress: number, label: string) => void;
  onInventoryToggle: () => void;
  onMapToggle: () => void;
  onQuestJournalToggle: () => void;
  onPauseToggleCloseOrResume: () => void;
  onWorldNotice: (message: string) => void;
  onInventoryChange: (snapshot: InventorySnapshot) => void;
  onDialogueChange: (snapshot: DialogueSnapshot | null) => void;
  onDebugPerfUpdate?: (snapshot: DebugPerformanceSnapshot) => void;
  onDebugToggle?: () => void;
  onGraphicsProfileChange?: (profile: ResolvedGraphicsProfile) => void;
  onChatToggle?: () => void;
  onOpenCraftingStation?: (stationType: CraftingStationType) => void;
  onOpenBuildingStorage?: (structureId: string) => void;
  onOpenStructureManage?: (structureId: string) => void;
  onOpenFarmPlot?: (structureId: string) => void;
  onOpenVillageDev?: (villageId: string) => void;
  onOpenMerchantTrade?: (npcId: string) => void;
  onFarmOrVillageStateChange?: () => void;
}

interface DustParticle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  scale: number;
  life: number;
  maxLife: number;
}

export class GameEngine {
  private readonly container: HTMLElement;
  private readonly callbacks: EngineCallbacks;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private isSoftwareGl = false;

  private textures!: ProceduralTextureSet;
  private skyRig!: SkyLightingRig;
  private weatherEffects!: WeatherEffects;
  private atmosphericParticles!: AtmosphericParticles;
  private postProcessing: PostProcessingPipeline | null = null;
  private world!: WorldManager;
  private player!: PlayerCharacter;
  private cameraRig!: ThirdPersonCamera;
  private controller!: PlayerController;
  private combat!: CombatManager;
  private input!: InputManager;
  public readonly sound: SoundEngine = getAudioManager().sfx;
  private lastCombatEventElapsed = -99;
  public readonly mapManager = new MapManager();
  public readonly saveManager = new SaveManager();
  public readonly loadManager = new LoadManager();
  public readonly aiService = new AIService();
  public readonly timeManager = new TimeManager({
    initialHour: 8.5,
    fullDayDurationSeconds: 360,
  });
  public readonly weatherManager = new WeatherManager(
    {
      initialWeather: 'clear',
      dynamicEnabled: true,
      minStateDurationSeconds: MIN_WEATHER_DURATION_SECONDS,
      maxStateDurationSeconds: MAX_WEATHER_DURATION_SECONDS,
      transitionDurationSeconds: 14,
      quality: 'medium',
    },
    {
      onLightningStrike: (strike) => {
        if (this.weatherEffects && this.controller) {
          this.weatherEffects.spawnLightningBolt(
            strike.azimuthRad,
            strike.distanceMeters,
            this.controller.position,
          );
        }
      },
      onThunderTrigger: (intensity, distanceMeters) => {
        if (this.phase === 'playing') {
          this.sound.playThunder(intensity, distanceMeters);
        }
      },
    },
  );
  public readonly dialogueEngine: DialogueEngine;
  private readonly dialogueBridge: DialogueWorldBridge;
  public readonly entityRegistry = new WorldEntityRegistry();
  private questTargetSyncTimer = 0;
  private authoritativeSyncTimer = 0;
  private envAudioTimer = 0;
  private readonly syncedEntityIdScratch = new Set<string>();
  private readonly authoritativeEntityTypes = new Set<AuthoritativeEntityType>([
    'villager',
    'npc',
    'enemy',
    'thief',
    'monster',
    'boss',
    'animal',
  ]);
  private readonly defaultPlayerPosScratch = new THREE.Vector3(0, 0, 4);
  private readonly blueprintsByQuestScratch = new Map<
    string,
    Array<ReturnType<CombatManager['getBlueprintsSnapshot']>[number]>
  >();
  private readonly blueprintsBucketPool: Array<
    Array<ReturnType<CombatManager['getBlueprintsSnapshot']>[number]>
  > = [];
  private readonly questPlansScratch: AuthoritativeQuestTargetPlan[] = [];
  private readonly mpCentersScratch: Array<{ x: number; z: number }> = [];
  private readonly mpCombinedDeltasScratch: SyncedEntityDelta[] = [];
  private simThrottleScale = 1;
  private particleScale = 1;

  private interactables: WorldInteractable[] = [];
  private landmarks: WorldLandmark[] = [];
  private nearbyInteractable: WorldInteractable | null = null;
  private waypoint: MapWaypoint | null = null;
  private lastFogRevealX = Number.NaN;
  private lastFogRevealZ = Number.NaN;

  private readonly itemManager = new ItemManager();
  private readonly inventoryManager = new InventoryManager(this.itemManager, 32);
  private readonly craftingManager = new CraftingManager();

  private playerLevel = 1;
  private playerXp = 0;
  private playerCoins = 0;
  private isSleeping = false;
  private sleepTimer = 0;
  private readonly SLEEP_DURATION_SEC = 5.0;

  private dustPool: DustParticle[] = [];
  private dustMesh!: THREE.InstancedMesh;
  private readonly dustDummy = new THREE.Object3D();
  private dustGeo!: THREE.SphereGeometry;
  private dustMat!: THREE.MeshBasicMaterial;
  private readonly queryCollidersCb = (x: number, z: number) =>
    this.world.queryCollidersNear(x, z);
  private readonly isVillageClearanceCb = (x: number, z: number) =>
    this.world.isInsideVillageClearance(x, z);
  private readonly isChunkLoadedCb = (cx: number, cz: number) =>
    this.world.chunkManager.isChunkLoaded(cx, cz);

  private phase: GamePhase = 'title';
  private worldLifecycleState: WorldLifecycleState = 'MENU';
  private worldRuntimeLoaded = false;
  private worldLoadingPromise: Promise<boolean> | null = null;
  private modalOpen = false;
  private touchModeEnabled = false;
  private language: Language = 'en';
  private settings: GameSettings = {
    mouseSensitivity: 1.0,
    muted: false,
    invertY: false,
  };
  private mobileSettings: MobileControlSettings = { ...DEFAULT_MOBILE_SETTINGS };

  // Loop, performance & save management
  private readonly performanceMonitor = new PerformanceMonitor();
  private graphicsManager!: GraphicsQualityManager;
  private debugOverlayEnabled = false;
  private debugEmitTimer = 0;
  private lastRenderTimeMs = 0;
  private cachedActiveObjects = 0;
  private objectCountTimer = 0;

  private readonly clock = new THREE.Clock();
  private elapsed = 0;
  private playTimeSeconds = 0;
  private autosaveTimer = 0;
  private activeSaveSlot: SaveSlotId = 'slot-1';
  private activeWorldName = 'Oakhollow Valley';
  private activeWorldType: WorldType = 'normal';
  private activeDifficulty: DifficultyLevel = 'normal';
  private activeWorldCreatedAtMs = Date.now();
  private hasUnsavedProgress = false;
  private unsavedTimer = 0;
  private multiplayerSessionActive = false;
  private authoritativeMultiplayerConfig: {
    seed: number;
    worldType: WorldType;
    difficulty: DifficultyLevel;
  } | null = null;
  private multiplayerService: IMultiplayerService | null = null;
  private localMultiplayerPlayerId: string | null = null;
  private localNetworkEntityId: string | null = null;
  private remotePlayersManager: RemotePlayersManager | null = null;
  private unsubscribeMultiplayer: (() => void) | null = null;
  private mpSyncTimer = 0;
  private mpKeepaliveTimer = 0;
  private mpEntitySyncTimer = 0;
  private mpWeatherTimeHeartbeatTimer = 0;
  private mpOutboundSeq = 0;
  private mpLastSentDigest = '';
  private mpPendingShootFlag = false;
  private mpPendingAnimState: string | undefined = undefined;
  private isApplyingRemoteTimeWeather = false;
  private isApplyingRemoteWorldEvent = false;
  private lastSyncedWeatherState = '';
  private worldSettingsPermission: WorldSettingsPermission = 'HOST_ONLY';
  private lastInteractedBed: { id: string; x: number; z: number } | null = null;
  private hasAppliedInitialSpawnSnapshot = false;
  private readonly persistedContainers = new Map<string, RoomContainerState>();
  private readonly persistedBuildingStates = new Map<string, RoomBuildingState>();
  private readonly persistedQuestObjects = new Map<string, RoomQuestObjectState>();
  private readonly appliedLootGrantIds = new Set<string>();
  private readonly activeBossEncounters = new Map<string, BossEncounterState>();
  private activeDialogueNpcId: string | null = null;
  private reducedMotionEnabled = false;
  private vsyncEnabled = true;
  private frameId = 0;
  private disposed = false;
  private unsubscribeOrientation: (() => void) | null = null;
  private lastResizeW = 0;
  private lastResizeH = 0;
  private lastResizePr = 0;
  private hudEmitTimer = 0;
  private questEvalTimer = 0;
  private lastNearbyId: string | null = null;
  private lastCombatTargetKey: string | null = null;
  private lastCooldownActive = false;
  private lastBowCharging = false;
  private lastBowChargePct = -1;
  private showBowTrajectory = true;
  private worldGenDebugEnabled = false;
  private worldGenDebugRenderer: WorldGenDebugRenderer | null = null;
  private lastDebugLoadedVillagesKey = '';
  private readonly tapRaycaster = new THREE.Raycaster();
  private readonly tapNdc = new THREE.Vector2();
  private biomeDebugEnabled = Boolean(loadExtendedSettings().gameplay.showBiomeDebug);
  private showPlayerNamesSetting = Boolean(
    loadExtendedSettings().gameplay.showPlayerNames,
  );
  private showFriendsOnMapSetting = Boolean(
    loadExtendedSettings().gameplay.showFriendsOnMap,
  );
  private showPartyMembersOnMapSetting = Boolean(
    loadExtendedSettings().gameplay.showPartyMembersOnMap ?? true,
  );
  private cachedPartyState: PartyStateSnapshot = {
    party: null,
    pendingInvites: [],
    outgoingInvites: [],
  };
  private lastFriendlyFireNoticeAtMs = 0;
  private lastCoopProximityReportMs = 0;
  private lastNpcPartySyncAtMs = 0;
  private statAccumTimeSec = 0;
  private statAccumDistM = 0;
  private lastStatTrackX: number | null = null;
  private lastStatTrackZ: number | null = null;
  private biomeValidationOk = true;
  private bowFullChargePlayed = false;
  private bowTargetType: 'none' | 'enemy' | 'animal' | 'npc' = 'none';
  private lastBowTargetType: 'none' | 'enemy' | 'animal' | 'npc' = 'none';

  public readonly storyManager = new StoryManager();
  private readonly storyBridge: StoryWorldBridge;
  public readonly sideQuestManager = new SideQuestManager();
  private readonly sideQuestBridge: SideQuestWorldBridge;
  private trackedQuestSource: 'story' | 'side' | 'sidequest' = 'story';
  private enteredBuildingRecently = false;
  private lastIndoorState = false;
  private readonly storyLocalInteractables = new Map<string, WorldInteractable>();
  private readonly sideQuestLocalInteractables = new Map<string, WorldInteractable>();
  private readonly spawnedSideQuestNpcIds = new Set<string>();

  private cameraSettings: CameraSettings = loadExtendedSettings().camera;
  private footstepVolume = loadExtendedSettings().audio.footstepVolume;
  private indicatorX = 50;
  private indicatorY = 50;
  private lastIndicatorX = 50;
  private lastIndicatorY = 50;
  private lastCameraPerspective: CameraPerspective = 'third-person';

  private readonly _camRayOrigin = new THREE.Vector3();
  private readonly _camRayDir = new THREE.Vector3();
  private readonly _bowNockOrigin = new THREE.Vector3();
  private readonly _bowAimTarget = new THREE.Vector3();
  private readonly _bowLaunchVel = new THREE.Vector3();
  private readonly _prevCamSample = new THREE.Vector3();
  private readonly _currCamSample = new THREE.Vector3();
  private readonly _camHitScratch = new THREE.Vector3();
  private readonly _aimRaycaster = new THREE.Raycaster();
  private readonly _aimNdc = new THREE.Vector2();
  private readonly _indicatorWorld = new THREE.Vector3();
  private readonly _camForwardVec = new THREE.Vector3();
  private readonly _camRightVec = new THREE.Vector3();
  private readonly _camUpVec = new THREE.Vector3();

  private deferInitialPhase = false;

  // Player Building & Construction State
  private buildModeActive = false;
  private buildCategory: BuildingCategory = 'structures';
  private selectedBlueprintId = 'wood-foundation';
  private buildYaw = 0;
  private buildRotationStep: RotationIncrementDeg = 45;
  private buildSnapEnabled = true;
  private buildNudgeX = 0;
  private buildNudgeZ = 0;
  private buildDistance = 6.0;
  private buildPermissionDefault: BuildingPermissionScope = 'owner';
  private lastBuildValidation: PlacementValidationResult | null = null;
  private lastBuildValidationDigest = '';
  private lastNearbyStructureId: string | null = null;
  private activeStorageStructureId: string | null = null;
  private activeManageStructureId: string | null = null;
  private activeFarmStructureId: string | null = null;
  private activeVillageDevId: string | null = null;
  private activeMerchantNpcId: string | null = null;
  private activeMerchantVillageId: string | null = null;

  constructor(
    container: HTMLElement,
    callbacks: EngineCallbacks,
    initialOptions?: {
      language?: Language;
      touchMode?: boolean;
      deferInitialPhase?: boolean;
    },
  ) {
    this.container = container;
    this.callbacks = callbacks;
    if (initialOptions?.language) {
      this.language = initialOptions.language;
    }
    if (initialOptions?.touchMode !== undefined) {
      this.touchModeEnabled = initialOptions.touchMode;
    }
    if (initialOptions?.deferInitialPhase) {
      this.deferInitialPhase = true;
    }
    this.seedStarterInventory();

    this.dialogueBridge = this.createDialogueBridge();
    this.storyBridge = this.createStoryBridge();
    this.sideQuestBridge = this.createSideQuestBridge();
    this.storyManager.setLanguage(this.language);
    this.sideQuestManager.setLanguage(this.language);
    this.dialogueEngine = new DialogueEngine(this.dialogueBridge);
    this.dialogueEngine.setLanguage(this.language);
    this.dialogueEngine.setStoryHooks({
      onNpcTalked: (npcId) => {
        const changed = this.storyManager.onNpcTalked(
          npcId,
          (msg) => this.callbacks.onWorldNotice(msg),
        );
        if (changed) {
          this.hasUnsavedProgress = true;
          this.syncAuthoritativeEntities(true);
          this.emitHud();
        }
      },
      resolveDialogueTree: (npcId, lang, fallbackBuilder) =>
        this.storyManager.buildNpcDialogueTree(
          npcId,
          this.storyBridge,
          lang,
          fallbackBuilder,
          {
            completeStoryQuest: (questId) => {
              if (
                this.storyManager.completeQuest(
                  questId,
                  this.storyBridge,
                  (msg) => this.callbacks.onWorldNotice(msg),
                )
              ) {
                this.hasUnsavedProgress = true;
                this.syncEquipmentBonuses();
                this.syncEquippedWeaponFromInventory();
                this.emitInventorySnapshot();
                this.emitHud();
              }
            },
            startStoryQuest: (questId) => {
              if (
                this.storyManager.startQuest(
                  questId,
                  (msg) => this.callbacks.onWorldNotice(msg),
                )
              ) {
                this.storyManager.update(this.storyBridge, (msg) =>
                  this.callbacks.onWorldNotice(msg),
                );
                this.hasUnsavedProgress = true;
                this.syncStoryLocalEntities();
                this.syncAuthoritativeEntities(true);
                this.emitHud();
              }
            },
            retryStoryQuest: (questId) => {
              this.retryStoryQuest(questId);
            },
            grantDoranWoodenSword: () => {
              if (this.inventoryManager.getItemCount('wooden-sword') < 1) {
                if (this.inventoryManager.canAccept('wooden-sword', 1)) {
                  this.inventoryManager.addItem('wooden-sword', 1);
                  this.sound.playItemPickup('weapon');
                  this.syncEquippedWeaponFromInventory();
                  this.emitInventorySnapshot();
                  const swordName = this.itemManager.getName(
                    'wooden-sword',
                    this.language,
                  );
                  this.callbacks.onWorldNotice(
                    UI_TEXT[this.language].pickedUpNotice(swordName, 1),
                  );
                } else {
                  this.callbacks.onWorldNotice(UI_TEXT[this.language].packFullNotice);
                }
              }
            },
          },
        ),
    });
    this.dialogueEngine.setSideQuestHooks({
      onNpcTalked: (npcId) => {
        const changed = this.sideQuestManager.onNpcTalked(
          npcId,
          this.sideQuestBridge,
          (msg) => this.callbacks.onWorldNotice(msg),
        );
        if (changed) {
          this.hasUnsavedProgress = true;
          this.syncSideQuestLocalEntities();
          this.syncAuthoritativeEntities(true);
          this.emitHud();
        }
      },
      resolveDialogueTree: (npcId, lang, fallbackBuilder) =>
        this.sideQuestManager.buildNpcDialogueTree(
          npcId,
          this.sideQuestBridge,
          lang,
          fallbackBuilder,
        ),
      actions: {
        acceptSideQuest: (sideQuestId) => this.acceptSideQuest(sideQuestId),
        completeSideQuest: (sideQuestId) => this.completeSideQuest(sideQuestId),
        retrySideQuest: (sideQuestId) => this.retrySideQuest(sideQuestId),
        abandonSideQuest: (sideQuestId) => this.abandonSideQuest(sideQuestId),
      },
    });
    void this.initialize();
  }

  private seedStarterInventory(): void {
    this.inventoryManager.restoreState({
      capacity: this.inventoryManager.capacity,
      slots: [],
      equippedBySlot: {},
    });
    this.inventoryManager.addItem('compass', 1);
    this.inventoryManager.addItem('journal', 1);
    this.inventoryManager.addItem('ranger-sword', 1);
    this.inventoryManager.addItem('woodland-axe', 1);
    this.inventoryManager.addItem('hunter-bow', 1);
    this.inventoryManager.addItem('arrow', 24);
    this.inventoryManager.equipItemById('ranger-sword');
  }

  private getXpToNextLevel(): number {
    return this.playerLevel * 100;
  }

  private awardXpAndCoins(xpGain: number, coinsGain: number, questTitle?: string): boolean {
    const t = UI_TEXT[this.language];
    const parts: string[] = [];
    if (xpGain > 0) parts.push(`+${xpGain} ${t.xpShort}`);
    if (coinsGain > 0) parts.push(`+${coinsGain} ${t.coinsLabel}`);

    if (this.multiplayerSessionActive) {
      if (questTitle) {
        const rewardSuffix = parts.length > 0 ? ` (${parts.join(', ')})` : '';
        this.callbacks.onWorldNotice(`${t.questCompletedPrefix}: ${questTitle}${rewardSuffix}`);
      }
      return false;
    }

    this.playerCoins += coinsGain;
    this.playerXp += xpGain;

    let leveledUp = false;
    while (this.playerXp >= this.getXpToNextLevel()) {
      this.playerXp -= this.getXpToNextLevel();
      this.playerLevel += 1;
      leveledUp = true;
    }

    if (questTitle) {
      const rewardSuffix = parts.length > 0 ? ` (${parts.join(', ')})` : '';
      this.callbacks.onWorldNotice(
        leveledUp
          ? `${t.questCompletedPrefix}: ${questTitle}${rewardSuffix}${t.levelUpSuffix(this.playerLevel)}`
          : `${t.questCompletedPrefix}: ${questTitle}${rewardSuffix}`,
      );
    }
    this.emitHud();
    return leveledUp;
  }

  private emitInventorySnapshot(): void {
    this.callbacks.onInventoryChange(this.inventoryManager.getSnapshot());
  }

  private syncEquipmentBonuses(): void {
    if (!this.controller) return;
    this.controller.applyEquipmentBonuses(this.inventoryManager.getEquippedBonuses());
    this.combat?.playerHealth.setDamageReduction(
      this.inventoryManager.getDamageReductionBonus(),
    );
  }

  private syncEquippedWeaponFromInventory(): void {
    this.cancelActiveBowCharge(false);
    if (!this.combat) return;
    this.combat.equipWeapon(this.inventoryManager.getEquippedWeaponId());
    this.input?.setRangedMode(this.combat.isRangedWeaponEquipped());
    this.emitHud();
  }

  public getNearbyCraftingStations(): CraftingStationType[] {
    const stations = new Set<CraftingStationType>(['hand']);
    if (!this.world || !this.controller) return Array.from(stations);
    const px = this.controller.position.x;
    const pz = this.controller.position.z;
    for (let i = 0; i < this.world.interactables.length; i++) {
      const it = this.world.interactables[i];
      if (it.kind !== 'crafting_station' || it.collected || !it.stationType) continue;
      if (Math.hypot(it.x - px, it.z - pz) <= 4.8) {
        stations.add(it.stationType);
      }
    }
    return Array.from(stations);
  }

  private getCraftingContext(): CraftingContext {
    return {
      nearbyStations: this.getNearbyCraftingStations(),
      playerLevel: this.playerLevel,
      completedStoryQuestIds: this.storyManager.getCompletedQuestIds(),
    };
  }

  private getStationDisplayName(station: CraftingStationType): string {
    const t = UI_TEXT[this.language];
    switch (station) {
      case 'crafting_table':
        return t.craftStationTable;
      case 'forge':
        return t.craftStationForge;
      case 'furnace':
        return t.craftStationFurnace;
      case 'workbench':
        return t.craftStationWorkbench;
      default:
        return t.craftStationHand;
    }
  }

  private getToolDisplayName(toolKind: ToolKind, tier = 1): string {
    const t = UI_TEXT[this.language];
    if (toolKind === 'pickaxe') {
      return tier >= 2 ? t.toolPickaxeTier2 : t.toolPickaxeTier1;
    }
    if (toolKind === 'axe') return t.toolAxeName;
    return t.toolShovelName;
  }

  public getCraftingRecipes(): CraftingRecipeView[] {
    return this.craftingManager.getRecipeViews(
      this.inventoryManager,
      this.getCraftingContext(),
    );
  }

  public craftRecipe(recipeId: string): boolean {
    const t = UI_TEXT[this.language];
    const res = this.craftingManager.craft(
      recipeId,
      this.inventoryManager,
      this.getCraftingContext(),
    );
    if (!res.ok) {
      if (res.reason === 'inventory_full') {
        this.callbacks.onWorldNotice(t.packFullNotice);
      } else if (res.reason === 'locked' && res.recipe) {
        let msg = t.craftedFailIngredients;
        if (res.lockReason === 'station') {
          msg = t.craftLockStation(
            this.getStationDisplayName(res.recipe.station ?? 'hand'),
          );
        } else if (res.lockReason === 'level') {
          msg = t.craftLockLevel(res.recipe.requiredLevel ?? 1);
        } else if (res.lockReason === 'tool' && res.recipe.requiredTool) {
          msg = t.craftLockTool(
            this.getToolDisplayName(
              res.recipe.requiredTool,
              res.recipe.requiredToolTier ?? 1,
            ),
          );
        } else if (res.lockReason === 'prerequisite' && res.recipe.prerequisiteRecipeId) {
          const pre = this.craftingManager.getRecipe(res.recipe.prerequisiteRecipeId);
          const preName = pre
            ? this.itemManager.getName(pre.resultItemId, this.language)
            : res.recipe.prerequisiteRecipeId;
          msg = t.craftLockPrereq(preName);
        } else if (res.lockReason === 'story') {
          msg = t.craftLockStory;
        }
        this.callbacks.onWorldNotice(msg);
      } else {
        this.callbacks.onWorldNotice(t.craftedFailIngredients);
      }
      return false;
    }

    this.player?.triggerGatherAnimation('craft', 0.42);
    this.sound.playCrafting(res.itemId);
    if (
      this.multiplayerSessionActive &&
      this.multiplayerService &&
      (res.itemId === 'arrow' ||
        res.itemId === 'bed' ||
        ALLOWED_WEAPON_IDS.has(res.itemId) ||
        Boolean(SERVER_CRAFTABLE_YIELDS[recipeId]))
    ) {
      this.multiplayerService.sendGameEvent('WORLD_EVENT', {
        kind: 'item_crafted',
        recipeId,
        itemId: res.itemId,
        count: res.count,
      });
    }
    const localizedName = this.itemManager.getName(res.itemId, this.language);
    this.callbacks.onWorldNotice(t.craftedNotice(localizedName, res.count));
    this.dialogueEngine.quests.onItemCrafted(
      res.itemId,
      res.count,
      this.dialogueBridge,
      (msg) => this.callbacks.onWorldNotice(msg),
    );
    this.dialogueEngine.quests.update(this.dialogueBridge, (msg) =>
      this.callbacks.onWorldNotice(msg),
    );
    this.storyManager.update(this.storyBridge, (msg) =>
      this.callbacks.onWorldNotice(msg),
    );
    this.sideQuestManager.onItemCrafted(
      res.itemId,
      res.count,
      (msg) => this.callbacks.onWorldNotice(msg),
    );
    this.sideQuestManager.update(this.sideQuestBridge, (msg) =>
      this.callbacks.onWorldNotice(msg),
    );
    this.emitInventorySnapshot();
    this.emitHud();
    return true;
  }

  private createDialogueBridge(): DialogueWorldBridge {
    const engine = this;
    return {
      get playerX() {
        return engine.controller ? engine.controller.position.x : 0;
      },
      get playerZ() {
        return engine.controller ? engine.controller.position.z : 0;
      },
      get currentBiome() {
        const px = engine.controller ? engine.controller.position.x : 0;
        const pz = engine.controller ? engine.controller.position.z : 0;
        return getBiomeAt(px, pz);
      },
      getItemCount: (itemId) => this.inventoryManager.getItemCount(itemId),
      getDiscoveredLandmarksCount: () =>
        this.landmarks.filter((l) => l.discovered).length,
      giveItem: (item) => {
        const qty = item.count ?? 1;
        if (!this.itemManager.getItem(item.id)) {
          this.itemManager.registerItem({
            id: item.id,
            name: item.name,
            nameAr: item.name,
            description: item.description,
            descriptionAr: item.description,
            category: item.usable ? 'consumable' : 'quest',
            icon: 'seal',
            stackable: true,
            maxStack: 20,
            usable: Boolean(item.usable),
            droppable: Boolean(item.usable),
            consumeEffect: item.usable ? { health: 30, stamina: 30 } : undefined,
          });
        }
        this.inventoryManager.addItem(item.id, qty);
        this.emitInventorySnapshot();
      },
      consumeItem: (itemId, count) => {
        this.inventoryManager.removeItem(itemId, count);
        this.emitInventorySnapshot();
      },
      healPlayer: (health, stamina) => {
        if (this.controller) {
          if (health > 0) this.controller.heal(health);
          if (stamina > 0) this.controller.restoreStamina(stamina);
          this.emitHud();
        }
      },
      getCoins: () => this.playerCoins,
      repairWeapons: (costCoins) => {
        const t = UI_TEXT[this.language];
        if (this.playerCoins < costCoins) {
          this.callbacks.onWorldNotice(t.repairNeedCoinsNotice(costCoins));
          return false;
        }
        const repaired = this.inventoryManager.repairAllWeapons();
        if (repaired <= 0) {
          this.callbacks.onWorldNotice(t.repairNeedCoinsNotice(costCoins));
          return false;
        }
        if (this.multiplayerSessionActive && this.multiplayerService) {
          this.multiplayerService.sendRepairWeapons?.(costCoins);
        } else {
          this.playerCoins = Math.max(0, this.playerCoins - costCoins);
        }
        this.sound.playInteract();
        this.emitInventorySnapshot();
        this.emitHud();
        this.callbacks.onWorldNotice(t.weaponsRepairedNotice(costCoins));
        return true;
      },
      grantRewards: (reward: QuestReward, questTitle: string) => {
        if (this.controller) {
          if (reward.health) this.controller.heal(reward.health);
          if (reward.stamina) this.controller.restoreStamina(reward.stamina);
        }
        this.awardXpAndCoins(reward.xp ?? 0, reward.coins ?? 0, questTitle);
      },
      notify: (message) => {
        this.callbacks.onWorldNotice(message);
      },
      getNpcPosition: (npcId) => {
        const npc = this.world?.npcs.npcs.find((n) => n.id === npcId && !n.isDead);
        return npc ? { x: npc.position.x, z: npc.position.z } : null;
      },
      hasNpc: (npcId) => {
        return Boolean(this.world?.npcs.npcs.some((n) => n.id === npcId && !n.isDead));
      },
      validateKillTarget: (obj, giverNpcId) => {
        const giverNpc = giverNpcId
          ? this.world?.npcs.npcs.find((n) => n.id === giverNpcId && !n.isDead)
          : undefined;
        const ax =
          typeof obj.targetX === 'number' && Number.isFinite(obj.targetX)
            ? obj.targetX
            : (giverNpc?.position.x ?? this.controller?.position.x ?? 0);
        const az =
          typeof obj.targetZ === 'number' && Number.isFinite(obj.targetZ)
            ? obj.targetZ
            : (giverNpc?.position.z ?? this.controller?.position.z ?? 48);
        const pt = findValidQuestTargetPoint(ax, az, {
          radius: 0.85,
          minHeightAboveWater: 0.65,
          waterBuffer: 3.0,
          maxSlope: 0.30,
          outsideVillage: true,
          isVillageClearance: this.isVillageClearanceCb,
          queryCollidersNear: this.queryCollidersCb,
          allowedBiomes: obj.targetBiome ? [obj.targetBiome] : undefined,
          minRadius: typeof obj.targetX === 'number' ? 0 : 28,
          maxRadius: 170,
        });
        return pt.valid
          ? { valid: true, anchor: { x: pt.x, z: pt.z } }
          : { valid: false, reason: 'no_valid_spawn' };
      },
      validateResourceLocation: (itemId, anchorX, anchorZ) => {
        if (this.inventoryManager.getItemCount(itemId) > 0) return { valid: true };
        if (this.interactables.some((it) => !it.collected && (it.itemId === itemId || it.id.includes(itemId)))) {
          return { valid: true };
        }
        const px = typeof anchorX === 'number' ? anchorX : (this.controller?.position.x ?? 0);
        const pz = typeof anchorZ === 'number' ? anchorZ : (this.controller?.position.z ?? 4);
        const spot = findNearestValidResourceLocation(px, pz, itemId, 160, { enforceBiomeAffinity: false });
        return spot ? { valid: true } : { valid: false, reason: 'resource_unreachable' };
      },
    };
  }

  private createStoryBridge(): StoryWorldBridge {
    const engine = this;
    return {
      get playerX() {
        return engine.controller ? engine.controller.position.x : 0;
      },
      get playerY() {
        return engine.controller ? engine.controller.position.y : 0;
      },
      get playerZ() {
        return engine.controller ? engine.controller.position.z : 0;
      },
      get indoorFactor() {
        if (!engine.world || !engine.controller) return 0;
        const p = engine.controller.position;
        return engine.world.sampleEnvironmentAudioContext(p.x, p.y, p.z).indoorFactor;
      },
      get enteredBuildingRecently() {
        return engine.enteredBuildingRecently;
      },
      getItemCount: (itemId) => this.inventoryManager.getItemCount(itemId),
      getNpcPosition: (npcId) => {
        const npc = this.world?.npcs.npcs.find((n) => n.id === npcId && !n.isDead);
        return npc ? { x: npc.position.x, z: npc.position.z } : null;
      },
      isNpcAlive: (npcId) => {
        const npc = this.world?.npcs.npcs.find((n) => n.id === npcId);
        if (!npc) return null;
        return !npc.isDead;
      },
      getLocationCoords: (locationId) => {
        const loc = this.world?.exploration.locations.find((l) => l.id === locationId);
        if (loc) {
          const lm = this.landmarks.find((l) => l.id === locationId);
          return {
            x: loc.x,
            z: loc.z,
            discovered: Boolean(lm?.discovered),
          };
        }
        const lm = this.landmarks.find((l) => l.id === locationId);
        return lm ? { x: lm.x, z: lm.z, discovered: lm.discovered } : null;
      },
      getVillageCoords: (villageId) => {
        const v = this.world?.village.villages.find((entry) => entry.id === villageId);
        if (!v) return null;
        const lmId = villageId === 'oakhollow' ? 'village-square' : `village-${villageId}`;
        const lm = this.landmarks.find((l) => l.id === lmId);
        return {
          x: v.centerX,
          z: v.centerZ,
          discovered: villageId === 'oakhollow' || Boolean(lm?.discovered),
        };
      },
      isChestOpened: (chestId) => {
        if (!this.world) return false;
        const chest = this.interactables.find(
          (i) => i.id === chestId && i.kind === 'chest',
        );
        if (chest) return chest.collected;
        return this.world.exportImportantState().openedChestIds.includes(chestId);
      },
      getChestCoords: (chestId) => {
        const chest = this.interactables.find((i) => i.id === chestId);
        if (chest) return { x: chest.x, z: chest.z };
        if (chestId.endsWith('-chest')) {
          const locId = chestId.slice(0, -'-chest'.length);
          const loc = this.world?.exploration.locations.find((l) => l.id === locId);
          if (loc) return { x: loc.x, z: loc.z };
        }
        return null;
      },
      resolveLandPoint: (x, z) => {
        if (isLand(x, z, 0.35) && !isWater(x, z)) {
          return { x, z };
        }
        const safe = findNearestValidLand(x, z, 1.0, 0.35, 160);
        return { x: safe.x, z: safe.z };
      },
      giveItem: (itemId, count) => {
        if (count <= 0) return;
        if (this.inventoryManager.canAccept(itemId, count)) {
          this.inventoryManager.addItem(itemId, count);
          this.syncEquipmentBonuses();
          this.syncEquippedWeaponFromInventory();
          this.emitInventorySnapshot();
        } else if (this.world && this.controller) {
          const label = this.itemManager.getName(itemId, this.language);
          this.world.spawnWorldPickup(
            this.controller.position.x,
            this.controller.position.z,
            itemId,
            count,
            label,
            undefined,
            true,
          );
        }
      },
      consumeItem: (itemId, count) => {
        this.inventoryManager.removeItem(itemId, count);
        this.emitInventorySnapshot();
      },
      grantRewards: (xp, coins, questTitle) => {
        this.awardXpAndCoins(xp, coins, questTitle);
      },
      notify: (message) => {
        this.callbacks.onWorldNotice(message);
      },
    };
  }

  private clearStoryLocalEntities(): void {
    for (const [id, item] of this.storyLocalInteractables) {
      if (item.meshGroup) {
        this.scene.remove(item.meshGroup);
      }
      const idx = this.interactables.indexOf(item);
      if (idx >= 0) {
        this.interactables.splice(idx, 1);
      }
      this.storyLocalInteractables.delete(id);
    }
    this.enteredBuildingRecently = false;
    this.lastIndoorState = false;
  }

  private createStoryRescueMesh(x: number, y: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const crateMat = new THREE.MeshStandardMaterial({
      color: 0x7c5836,
      roughness: 0.85,
    });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.72, 0.75), crateMat);
    crate.position.set(-0.65, 0.36, 0.25);
    crate.castShadow = true;
    group.add(crate);

    const cloakMat = new THREE.MeshStandardMaterial({
      color: 0x2f6f5e,
      roughness: 0.72,
    });
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.3, 1.05, 10),
      cloakMat,
    );
    body.position.set(0, 0.55, 0);
    body.castShadow = true;
    group.add(body);

    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xe6b89c,
      roughness: 0.65,
    });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), skinMat);
    head.position.set(0, 1.24, 0);
    head.castShadow = true;
    group.add(head);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.82,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.035, 8, 24), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.08, 0);
    group.add(ring);

    return group;
  }

  private syncStoryLocalEntities(): void {
    if (!this.world || !this.controller) return;
    const px = this.controller.position.x;
    const pz = this.controller.position.z;
    const pending = this.storyManager.getPendingLocalSpawns(
      px,
      pz,
      this.storyBridge,
      165,
    );
    const pendingById = new Map(pending.map((p) => [p.def.id, p]));

    // Remove out-of-range (>240m) or no-longer-needed story spawns
    for (const [id, existing] of this.storyLocalInteractables) {
      const dist = Math.hypot(px - existing.x, pz - existing.z);
      if (!pendingById.has(id) && (existing.collected || dist > 240)) {
        if (existing.meshGroup) {
          this.scene.remove(existing.meshGroup);
        }
        const idx = this.interactables.indexOf(existing);
        if (idx >= 0) {
          this.interactables.splice(idx, 1);
        }
        this.storyLocalInteractables.delete(id);
      }
    }

    // Spawn missing pending story objects within range
    for (const { def, x, z } of pending) {
      if (this.storyLocalInteractables.has(def.id)) continue;
      if (
        this.interactables.some((it) => it.id === def.id && !it.collected)
      ) {
        continue;
      }

      if (def.kind === 'pickup' && def.itemId) {
        const label = this.language === 'ar' ? def.labelAr : def.labelEn;
        const spawned = this.world.spawnWorldPickup(
          x,
          z,
          def.itemId,
          def.count ?? 1,
          label,
          def.id,
          false,
        );
        this.storyLocalInteractables.set(def.id, spawned);
      } else if (def.kind === 'rescue_npc') {
        const y = groundHeightAt(x, z);
        const meshGroup = this.createStoryRescueMesh(x, y, z);
        this.scene.add(meshGroup);
        const rescueInteractable: WorldInteractable = {
          id: def.id,
          label: this.language === 'ar' ? def.labelAr : def.labelEn,
          actionVerb: UI_TEXT[this.language].storyRescueActionVerb,
          kind: 'story_rescue',
          x,
          y,
          z,
          radius: 3.1,
          collected: false,
          meshGroup,
          message: def.id,
        };
        this.interactables.push(rescueInteractable);
        this.storyLocalInteractables.set(def.id, rescueInteractable);
      }
    }
  }

  private createSideQuestBridge(): SideQuestWorldBridge {
    const engine = this;
    return {
      get playerX() {
        return engine.controller ? engine.controller.position.x : 0;
      },
      get playerY() {
        return engine.controller ? engine.controller.position.y : 0;
      },
      get playerZ() {
        return engine.controller ? engine.controller.position.z : 0;
      },
      get playerLevel() {
        return engine.playerLevel;
      },
      get routinePeriod() {
        return engine.world?.npcs.getRoutinePeriod() ?? 'morning';
      },
      get totalWorldHours() {
        return (
          (Math.max(1, engine.timeManager.getDayCount()) - 1) * 24 +
          engine.timeManager.getWorldHours()
        );
      },
      getItemCount: (itemId) => this.inventoryManager.getItemCount(itemId),
      getNpcPosition: (npcId) => {
        const npc = this.world?.npcs.npcs.find((n) => n.id === npcId && !n.isDead);
        return npc ? { x: npc.position.x, z: npc.position.z } : null;
      },
      isNpcAlive: (npcId) => {
        const npc = this.world?.npcs.npcs.find((n) => n.id === npcId);
        if (!npc) return null;
        return !npc.isDead;
      },
      getLocationCoords: (locationId) => {
        const loc = this.world?.exploration.locations.find((l) => l.id === locationId);
        if (loc) {
          const lm = this.landmarks.find((l) => l.id === locationId);
          return {
            x: loc.x,
            z: loc.z,
            discovered: Boolean(lm?.discovered),
          };
        }
        const lm = this.landmarks.find((l) => l.id === locationId);
        return lm ? { x: lm.x, z: lm.z, discovered: lm.discovered } : null;
      },
      getVillageCoords: (villageId) => {
        const v = this.world?.village.villages.find((entry) => entry.id === villageId);
        if (!v) return null;
        const lmId = villageId === 'oakhollow' ? 'village-square' : `village-${villageId}`;
        const lm = this.landmarks.find((l) => l.id === lmId);
        return {
          x: v.centerX,
          z: v.centerZ,
          discovered: villageId === 'oakhollow' || Boolean(lm?.discovered),
        };
      },
      isStoryQuestCompleted: (storyQuestId) =>
        this.storyManager.getQuestState(storyQuestId) === 'COMPLETED',
      hasStoryFlag: (flag) =>
        this.storyManager.hasUnlockedFlag(flag) || this.dialogueEngine.hasFlag(flag),
      getBuiltStructureCount: (filter) => {
        const list = this.world?.buildings.getAllStructures() ?? [];
        let count = 0;
        for (let i = 0; i < list.length; i++) {
          const st = list[i];
          if (filter?.blueprintId && st.blueprintId !== filter.blueprintId) continue;
          if (filter?.category && st.category !== filter.category) continue;
          count++;
        }
        return count;
      },
      resolveLandPoint: (x, z) => {
        if (isLand(x, z, 0.35) && !isWater(x, z)) {
          return { x, z };
        }
        const safe = findNearestValidLand(x, z, 1.0, 0.35, 160);
        return { x: safe.x, z: safe.z };
      },
      giveItem: (itemId, count) => {
        if (count <= 0) return;
        if (this.inventoryManager.canAccept(itemId, count)) {
          this.inventoryManager.addItem(itemId, count);
          this.syncEquipmentBonuses();
          this.syncEquippedWeaponFromInventory();
          this.emitInventorySnapshot();
        } else if (this.world && this.controller) {
          const label = this.itemManager.getName(itemId, this.language);
          this.world.spawnWorldPickup(
            this.controller.position.x,
            this.controller.position.z,
            itemId,
            count,
            label,
            undefined,
            true,
          );
        }
      },
      consumeItem: (itemId, count) => {
        this.inventoryManager.removeItem(itemId, count);
        this.emitInventorySnapshot();
      },
      grantRewards: (xp, coins, questTitle, meta) => {
        this.awardXpAndCoins(xp, coins, questTitle);
        if (this.multiplayerSessionActive) {
          if (!this.isApplyingRemoteWorldEvent) {
            ProfileManager.recordGameplayDelta({ questsCompleted: 1 });
          }
          if (meta?.sideQuestId) {
            this.emitMultiplayerSideQuestUpdate(meta.sideQuestId, meta.cycleKey);
          }
        } else {
          ProfileManager.recordGameplayDelta({
            questsCompleted: 1,
            xpGained: xp,
          });
        }
      },
      notify: (message) => {
        this.callbacks.onWorldNotice(message);
      },
    };
  }

  private emitMultiplayerSideQuestUpdate(sideQuestId: string, cycleKey?: string): void {
    if (!this.multiplayerSessionActive || !this.multiplayerService) return;
    this.multiplayerService.sendGameEvent('SIDE_QUEST_UPDATED', {
      sideQuestId,
      state: this.sideQuestManager.getQuestState(sideQuestId),
      stepIndex: this.sideQuestManager.getCompletedObjectiveCount(sideQuestId),
      ...(cycleKey ? { cycleKey } : {}),
    });
  }

  private clearSideQuestLocalEntities(): void {
    for (const [id, item] of this.sideQuestLocalInteractables) {
      if (item.meshGroup) {
        this.scene.remove(item.meshGroup);
      }
      const idx = this.interactables.indexOf(item);
      if (idx >= 0) {
        this.interactables.splice(idx, 1);
      }
      this.sideQuestLocalInteractables.delete(id);
    }
    if (this.world) {
      for (const npcId of this.spawnedSideQuestNpcIds) {
        this.world.npcs.unloadSideQuestNpc(npcId);
      }
    }
    this.spawnedSideQuestNpcIds.clear();
  }

  private syncSideQuestLocalEntities(): void {
    if (!this.world || !this.controller) return;
    const px = this.controller.position.x;
    const pz = this.controller.position.z;

    // 1. Stream specialized side-quest NPCs in/out cleanly based on player proximity & unlocks
    for (const npcDef of SIDE_QUEST_NPCS) {
      const check = this.sideQuestManager.shouldSpawnSideQuestNpc(
        npcDef,
        px,
        pz,
        this.sideQuestBridge,
        175,
      );
      if (check.spawn) {
        this.world.npcs.ensureSideQuestNpc(npcDef, check.x, check.z);
        this.spawnedSideQuestNpcIds.add(npcDef.npcId);
      } else if (this.spawnedSideQuestNpcIds.has(npcDef.npcId)) {
        this.world.npcs.unloadSideQuestNpc(npcDef.npcId);
        this.spawnedSideQuestNpcIds.delete(npcDef.npcId);
      }
    }

    // 2. Drive active escort targets (follow player smoothly until approaching destination)
    const activeEscorts = this.sideQuestManager.getActiveEscortSpecs(
      this.sideQuestBridge,
    );
    const escortMap = new Map(activeEscorts.map((e) => [e.npcId, e]));
    for (const npc of this.world.npcs.npcs) {
      const spec = escortMap.get(npc.id);
      if (spec) {
        const distToDest = Math.hypot(px - spec.targetX, pz - spec.targetZ);
        if (distToDest <= spec.radius + 8) {
          this.world.npcs.setNpcEscortTarget(npc.id, {
            x: spec.targetX,
            z: spec.targetZ,
          });
        } else {
          this.world.npcs.setNpcEscortTarget(npc.id, {
            x: px + 1.8,
            z: pz + 1.8,
          });
        }
      } else if (npc.isEscorting()) {
        this.world.npcs.setNpcEscortTarget(npc.id, null);
      }
    }

    // 3. Stream local side-quest pickups and captive rescue NPCs
    const pending = this.sideQuestManager.getPendingLocalSpawns(
      px,
      pz,
      this.sideQuestBridge,
      165,
    );
    const pendingById = new Map(pending.map((p) => [p.def.id, p]));

    for (const [id, existing] of this.sideQuestLocalInteractables) {
      const dist = Math.hypot(px - existing.x, pz - existing.z);
      if (!pendingById.has(id) && (existing.collected || dist > 240)) {
        if (existing.meshGroup) {
          this.scene.remove(existing.meshGroup);
        }
        const idx = this.interactables.indexOf(existing);
        if (idx >= 0) {
          this.interactables.splice(idx, 1);
        }
        this.sideQuestLocalInteractables.delete(id);
      }
    }

    for (const { def, x, z } of pending) {
      if (this.sideQuestLocalInteractables.has(def.id)) continue;
      if (
        this.interactables.some((it) => it.id === def.id && !it.collected)
      ) {
        continue;
      }

      if (def.kind === 'pickup' && def.itemId) {
        const label = this.language === 'ar' ? def.labelAr : def.labelEn;
        const spawned = this.world.spawnWorldPickup(
          x,
          z,
          def.itemId,
          def.count ?? 1,
          label,
          def.id,
          false,
        );
        this.sideQuestLocalInteractables.set(def.id, spawned);
      } else if (def.kind === 'rescue_npc') {
        const y = groundHeightAt(x, z);
        const meshGroup = this.createStoryRescueMesh(x, y, z);
        this.scene.add(meshGroup);
        const rescueInteractable: WorldInteractable = {
          id: def.id,
          label: this.language === 'ar' ? def.labelAr : def.labelEn,
          actionVerb: UI_TEXT[this.language].storyRescueActionVerb,
          kind: 'side_quest_rescue',
          x,
          y,
          z,
          radius: 3.1,
          collected: false,
          meshGroup,
          message: def.id,
        };
        this.interactables.push(rescueInteractable);
        this.sideQuestLocalInteractables.set(def.id, rescueInteractable);
      }
    }
  }

  public getWorldLifecycleState(): WorldLifecycleState {
    return this.worldLifecycleState;
  }

  public isWorldLoaded(): boolean {
    return this.worldRuntimeLoaded && Boolean(this.world);
  }

  /**
   * Lightweight startup: probes basic GPU capabilities for settings/auto-tier
   * detection and immediately enters MENU state without creating WebGLRenderer,
   * 3D scene, terrain chunks, villages, NPCs, animals, resources, or quests.
   */
  private async initialize(): Promise<void> {
    if (this.disposed) return;

    const gpuProbe = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) {
          return {
            isSoftwareGl: true,
            gpuName: 'Software WebGL',
            maxTextureSize: 4096,
            maxAnisotropy: 1,
          };
        }
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpuName = String(probe.getParameter(param) || 'WebGL2 GPU');
        const maxTextureSize = Number(probe.getParameter(probe.MAX_TEXTURE_SIZE)) || 4096;
        const anisoExt =
          probe.getExtension('EXT_texture_filter_anisotropic') ||
          probe.getExtension('MOZ_EXT_texture_filter_anisotropic') ||
          probe.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
        const maxAnisotropy = anisoExt
          ? Number(probe.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) || 1
          : 1;
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return {
          isSoftwareGl: /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpuName),
          gpuName,
          maxTextureSize,
          maxAnisotropy,
        };
      } catch {
        return {
          isSoftwareGl: true,
          gpuName: 'Software WebGL',
          maxTextureSize: 4096,
          maxAnisotropy: 1,
        };
      }
    })();

    this.isSoftwareGl = gpuProbe.isSoftwareGl;
    const hwProfile = probeHardwareCapabilities(
      this.touchModeEnabled,
      this.isSoftwareGl,
      gpuProbe.gpuName,
      gpuProbe.maxTextureSize,
      gpuProbe.maxAnisotropy,
    );
    this.graphicsManager = new GraphicsQualityManager(hwProfile);
    const initialProfile = this.graphicsManager.getProfile();
    this.callbacks.onGraphicsProfileChange?.(initialProfile);

    this.worldLifecycleState = 'MENU';
    this.worldRuntimeLoaded = false;
    this.emitInventorySnapshot();
    if (!this.deferInitialPhase) {
      this.setPhase('title');
    }
  }

  /**
   * Initializes the 3D WebGL renderer, scene, textures, nearby terrain chunks,
   * starting village, NPCs, resources, wildlife, player, and combat systems
   * strictly on demand when entering a world (NEW WORLD / CONTINUE / LOAD WORLD / MULTIPLAYER).
   */
  private async ensureWorldRuntimeLoaded(
    seed: number,
    initialSpawn: { x: number; z: number } = { x: 0, z: 4 },
  ): Promise<boolean> {
    if (this.disposed) return false;
    if (this.worldLoadingPromise) {
      return this.worldLoadingPromise;
    }

    const loadTask = (async (): Promise<boolean> => {
      if (this.worldRuntimeLoaded && this.world) {
        if (this.world.seed !== seed) {
          this.worldLifecycleState = 'WORLD_LOADING';
          this.setPhase('loading');
          this.callbacks.onLoadProgress(20, 'Loading World...');
          await this.yieldFrame();
          if (this.disposed) return false;
          this.callbacks.onLoadProgress(45, 'Generating nearby terrain...');
          this.rebuildWorldForSeed(seed);
          await this.yieldFrame();
          if (this.disposed) return false;
          this.callbacks.onLoadProgress(90, 'Preparing world...');
          await this.yieldFrame();
          this.worldLifecycleState = 'WORLD_READY';
        }
        return !this.disposed;
      }

      this.worldLifecycleState = 'WORLD_LOADING';
      this.setPhase('loading');
      this.callbacks.onLoadProgress(8, 'Loading World...');
      await this.yieldFrame();
      if (this.disposed) return false;

      const initialProfile = this.graphicsManager.getProfile();
      this.renderer = new THREE.WebGLRenderer({
        antialias: !this.isSoftwareGl && initialProfile.antiAliasing === 'msaa',
        powerPreference: 'high-performance',
      });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.08;

      const maxAniso = Math.min(
        this.renderer.capabilities.getMaxAnisotropy(),
        initialProfile.anisotropyCap,
      );
      this.renderer.setPixelRatio(initialProfile.pixelRatio);
      this.renderer.setSize(
        Math.max(1, this.container.clientWidth),
        Math.max(1, this.container.clientHeight),
      );
      this.renderer.shadowMap.enabled = initialProfile.shadowEnabled && !this.isSoftwareGl;
      this.renderer.shadowMap.type = initialProfile.shadowBasicFilter
        ? THREE.BasicShadowMap
        : THREE.PCFSoftShadowMap;

      this.renderer.domElement.style.display = 'block';
      this.renderer.domElement.style.width = '100%';
      this.renderer.domElement.style.height = '100%';
      this.container.appendChild(this.renderer.domElement);
      this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(
        62,
        Math.max(1, this.container.clientWidth) / Math.max(1, this.container.clientHeight),
        0.15,
        initialProfile.cameraFar,
      );

      this.callbacks.onLoadProgress(22, 'Loading resources...');
      await this.yieldFrame();
      if (this.disposed) return false;

      this.textures = createProceduralTextures(maxAniso, initialProfile.textureQuality);
      this.skyRig = createSkyAndLighting(this.scene, this.renderer, this.isSoftwareGl);
      this.weatherEffects = new WeatherEffects(this.scene);
      this.atmosphericParticles = new AtmosphericParticles(this.scene);
      if (!this.isSoftwareGl) {
        this.postProcessing = new PostProcessingPipeline(
          this.renderer,
          this.scene,
          this.camera,
          Math.max(1, this.container.clientWidth),
          Math.max(1, this.container.clientHeight),
          initialProfile.pixelRatio,
          initialProfile.postProcessing,
          initialProfile.antiAliasing,
        );
      }

      this.callbacks.onLoadProgress(34, 'Generating nearby terrain...');
      await this.yieldFrame();
      if (this.disposed) return false;

      this.world = new WorldManager(
        this.scene,
        this.textures,
        this.isSoftwareGl,
        seed,
        (p, label) => {
          const stageLabel =
            label ||
            (p < 55
              ? 'Generating nearby terrain...'
              : p < 70
                ? 'Loading village...'
                : 'Loading NPCs...');
          this.callbacks.onLoadProgress(p, stageLabel);
        },
      );
      this.world.npcs.setLanguage(this.language);
      this.world.setDoorAudioCallback((_doorId, isOpen, x, y, z) => {
        this.sound.playDoorState(isOpen, { x, y, z });
      });
      this.world.setBiomeDebugEnabled(this.biomeDebugEnabled);
      this.biomeValidationOk = this.world.validateBiomeMaterialAssignments().valid;

      this.callbacks.onLoadProgress(78, 'Loading NPCs...');
      await this.yieldFrame();
      if (this.disposed) return false;

      generateAndRegisterProceduralQuests(
        this.world.seed,
        this.world.village.villages,
        this.world.npcs.npcs,
      );
      if (import.meta.env.DEV && this.worldGenDebugEnabled) {
        this.refreshWorldGenDebugRenderer();
      }
      this.interactables = this.world.interactables;
      this.landmarks = this.world.landmarks;
      this.mapManager.prewarmTerrain(
        this.world.seed,
        this.world.village.site,
        this.getVillageMapEntries(),
      );
      this.mapManager.resetFog();
      this.mapManager.revealAround(initialSpawn.x, initialSpawn.z, 195);
      this.lastFogRevealX = initialSpawn.x;
      this.lastFogRevealZ = initialSpawn.z;

      this.callbacks.onLoadProgress(88, 'Preparing world...');
      await this.yieldFrame();
      if (this.disposed) return false;

      this.weatherManager.setSeed(this.world.seed);
      this.sound.setAudioVolumes({ footstepVolume: this.footstepVolume });

      this.player = new PlayerCharacter(this.textures.contactShadowMap);
      this.scene.add(this.player.root);

      this.cameraRig = new ThirdPersonCamera(this.camera);
      this.cameraRig.setColliderQuery(this.queryCollidersCb);
      this.cameraRig.updatePortraitConfig(this.mobileSettings.portraitCamera);
      this.cameraRig.updateCameraConfig({
        distance: this.cameraSettings.distance,
        shoulderHeight: this.cameraSettings.height,
        smoothingScale: this.cameraSettings.smoothing,
      });
      this.cameraRig.setPerspective(this.cameraSettings.perspective, true);
      this.settings.mouseSensitivity = this.cameraSettings.sensitivity;
      this.settings.invertY = this.cameraSettings.invertY;

      this.controller = new PlayerController(this.player, this.cameraRig, {
        queryCollidersNear: (x, z) => this.world.queryCollidersNear(x, z),
        canAttack: () => (this.combat ? this.combat.canPlayerAttack() : true),
        isRangedWeaponEquipped: () =>
          this.combat ? this.combat.isRangedWeaponEquipped() : false,
        isBowAiming: () => Boolean(this.combat?.isChargingBow()),
        getAttackAnimation: () =>
          this.combat
            ? this.combat.getAttackAnimationSpec()
            : { type: 'melee_slash', duration: 0.28 },
        onJump: (pos) => {
          this.sound.playJump();
          this.spawnDustBurst(pos.x, pos.y, pos.z, 5);
        },
        onSprintCancelled: () => {
          this.input?.mobile.setSprintOff();
        },
        onLand: (pos, strength, inWater) => {
          const surface = this.world.detectFootstepSurfaceAt(
            pos.x,
            pos.y,
            pos.z,
            Boolean(inWater),
          );
          this.sound.playLand(strength, surface);
          if (!inWater) {
            this.spawnDustBurst(pos.x, pos.y, pos.z, 6);
          }
        },
        onFootstep: (mode, inWater) => {
          const surface = this.world.detectFootstepSurfaceAt(
            this.controller.position.x,
            this.controller.position.y,
            this.controller.position.z,
            Boolean(inWater),
          );
          this.sound.playFootstepSurface(mode, surface);
        },
        onAttack: (pos, yaw) => {
          if (this.isSleeping) return;
          const weaponId = this.combat?.getEquippedWeapon()?.stats.id ?? null;
          if (
            (weaponId === 'steel-sword' ||
              weaponId === 'iron-sword' ||
              weaponId === 'ranger-sword') &&
            (this.controller.isSprinting() || Math.random() < 0.25)
          ) {
            this.sound.playHeavySwordSwing();
          } else {
            this.sound.playWeaponSwing(weaponId);
          }
          const fx = pos.x + Math.sin(yaw) * 0.9;
          const fz = pos.z + Math.cos(yaw) * 0.9;
          this.spawnDustBurst(fx, pos.y + 0.6, fz, 3);
          const triggered = this.combat?.triggerPlayerAttack(pos, yaw) ?? false;
          if (triggered && this.multiplayerSessionActive && this.multiplayerService) {
            const animSpec = this.combat.getAttackAnimationSpec();
            const weaponId = this.combat.getEquippedWeapon()?.stats.id ?? null;
            this.mpPendingAnimState = animSpec.type;
            this.multiplayerService.sendGameEvent('player:attack', {
              weaponId,
              animType: animSpec.type,
              aimYaw: this.cameraRig?.getYaw() ?? yaw,
            });
          }
        },
        onInteractRequested: () => {
          if (this.isSleeping) return;
          if (this.nearbyInteractable) {
            this.executeInteraction(this.nearbyInteractable);
          }
        },
      });

      this.initDustPool();
      this.controller.reset(initialSpawn.x, initialSpawn.z);

      this.combat = this.createCombatManager(this.world.seed);
      this.wireWorldAndCombatLinks();
      this.applyResolvedProfile(initialProfile, {
        texturesChanged: false,
        vegetationChanged: false,
        shadowMapSizeChanged: true,
        emitCallback: true,
      });

      this.world.update(
        0,
        this.controller.position,
        this.camera,
        0.016,
        undefined,
        0.16,
        0.62,
        this.skyRig,
      );
      this.syncAuthoritativeEntities(true);

      this.input = new InputManager(this.renderer.domElement, {
        onPauseToggle: () => {
          if (this.isSleeping) return;
          if (this.phase === 'playing' && !this.modalOpen && this.buildModeActive) {
            this.exitBuildMode();
            return;
          }
          if (this.phase === 'playing' && !this.modalOpen && this.combat?.isChargingBow()) {
            this.cancelActiveBowCharge(true);
            return;
          }
          if (this.modalOpen) {
            this.callbacks.onPauseToggleCloseOrResume?.();
            return;
          }
          if (this.phase === 'playing') {
            this.setPhase('paused');
          } else if (this.phase === 'paused') {
            this.setPhase('playing');
            this.input.requestPointerLock();
          }
        },
        onInventoryToggle: () => {
          if (this.phase === 'playing' && !this.isSleeping) {
            this.callbacks.onInventoryToggle();
          }
        },
        onMapToggle: () => {
          if (!this.isSleeping && (this.phase === 'playing' || this.phase === 'paused')) {
            this.callbacks.onMapToggle();
          }
        },
        onQuestJournalToggle: () => {
          if (this.phase === 'playing' && !this.isSleeping) {
            this.callbacks.onQuestJournalToggle();
          }
        },
        onWeaponSelect: (weaponIndex) => {
          if (this.phase === 'playing' && !this.modalOpen && !this.isSleeping) {
            this.selectOwnedWeapon(weaponIndex);
          }
        },
        onWeaponCycle: () => {
          if (this.phase === 'playing' && !this.modalOpen && !this.isSleeping) {
            this.cycleOwnedWeapon();
          }
        },
        onWeaponUnequip: () => {
          if (this.phase === 'playing' && !this.modalOpen && !this.isSleeping) {
            this.unequipWeapon();
          }
        },
        onCameraCycle: () => {
          if (this.phase === 'playing' && !this.modalOpen && !this.isSleeping) {
            this.cycleCameraPerspective();
          }
        },
        onPointerLockChange: (locked) => {
          this.callbacks.onPointerLockChange(locked);
        },
        onDebugToggle: () => {
          if (isDeveloperToolsEnabled()) {
            this.callbacks.onDebugToggle?.();
          }
        },
        onChatToggle: () => {
          if (this.phase === 'playing' && !this.isSleeping && this.multiplayerSessionActive) {
            this.callbacks.onChatToggle?.();
          }
        },
        onBuildToggle: () => {
          if (this.phase === 'playing' && !this.modalOpen && !this.isSleeping) {
            this.toggleBuildMode();
          }
        },
        onBuildRotate: (dir) => {
          if (
            this.phase === 'playing' &&
            !this.modalOpen &&
            !this.isSleeping &&
            this.buildModeActive
          ) {
            this.rotateBuildPreview(dir);
          }
        },
        onBuildSnapToggle: () => {
          if (
            this.phase === 'playing' &&
            !this.modalOpen &&
            !this.isSleeping &&
            this.buildModeActive
          ) {
            this.toggleBuildSnap();
          }
        },
        onBuildManage: () => {
          if (
            this.phase === 'playing' &&
            !this.modalOpen &&
            !this.isSleeping &&
            !this.buildModeActive
          ) {
            this.openStructureManageModal();
          }
        },
        onCanvasTap: (clientX, clientY) => {
          if (this.phase === 'playing' && !this.modalOpen && !this.isSleeping) {
            this.handleScreenTap(clientX, clientY);
          }
        },
      });
      this.input.setTouchMode(this.touchModeEnabled);
      this.input.mobile.setControlMode(this.mobileSettings.movementControlMode);
      this.syncEquipmentBonuses();
      this.syncEquippedWeaponFromInventory();

      this.unsubscribeOrientation?.();
      this.unsubscribeOrientation = OrientationManager.subscribe(() =>
        this.handleResize(),
      );
      this.handleResize();

      if (!this.isSoftwareGl) {
        this.renderer.compile(this.scene, this.camera);
      }

      this.worldRuntimeLoaded = true;
      this.worldLifecycleState = 'WORLD_READY';
      this.callbacks.onLoadProgress(100, 'Preparing world...');
      this.clock.start();
      this.lastRenderTimeMs = 0;
      this.scheduleNextFrame();
      return true;
    })();

    this.worldLoadingPromise = loadTask;
    try {
      return await loadTask;
    } finally {
      this.worldLoadingPromise = null;
    }
  }

  /**
   * Unloads the active 3D world and releases terrain chunks, NPC/animal rigs,
   * particles, textures, geometries, post-processing targets, and WebGL context
   * so returning to the main menu does not keep the world resident in memory.
   */
  public unloadWorld(): void {
    if (!this.worldRuntimeLoaded && !this.world && !this.renderer) {
      this.worldLifecycleState = 'MENU';
      return;
    }
    this.worldLifecycleState = 'WORLD_UNLOADING';
    this.worldRuntimeLoaded = false;

    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.frameId = 0;

    this.unsubscribeOrientation?.();
    this.unsubscribeOrientation = null;

    if (this.renderer?.domElement) {
      this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
    }

    this.input?.dispose();
    this.combat?.dispose();
    this.player?.dispose();
    this.worldGenDebugRenderer?.dispose();
    this.worldGenDebugRenderer = null;
    this.world?.dispose();
    this.atmosphericParticles?.dispose();
    this.weatherEffects?.dispose();
    this.skyRig?.dispose();
    this.textures?.dispose();
    this.dustGeo?.dispose();
    this.dustMat?.dispose();
    this.dustMesh?.removeFromParent();
    this.postProcessing?.dispose();
    this.postProcessing = null;
    this.renderer?.dispose();

    if (this.renderer?.domElement?.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }

    // Clear references so GC can reclaim all Three.js buffers and world state
    this.input = undefined as unknown as InputManager;
    this.combat = undefined as unknown as CombatManager;
    this.player = undefined as unknown as PlayerCharacter;
    this.controller = undefined as unknown as PlayerController;
    this.cameraRig = undefined as unknown as ThirdPersonCamera;
    this.world = undefined as unknown as WorldManager;
    this.atmosphericParticles = undefined as unknown as AtmosphericParticles;
    this.weatherEffects = undefined as unknown as WeatherEffects;
    this.skyRig = undefined as unknown as SkyLightingRig;
    this.textures = undefined as unknown as ProceduralTextureSet;
    this.dustGeo = undefined as unknown as THREE.SphereGeometry;
    this.dustMat = undefined as unknown as THREE.MeshBasicMaterial;
    this.dustMesh = undefined as unknown as THREE.InstancedMesh;
    this.dustPool = [];
    this.renderer = undefined as unknown as THREE.WebGLRenderer;
    this.scene = undefined as unknown as THREE.Scene;
    this.camera = undefined as unknown as THREE.PerspectiveCamera;
    this.interactables = [];
    this.landmarks = [];
    this.nearbyInteractable = null;
    this.lastNearbyId = null;
    this.buildModeActive = false;
    this.lastBuildValidation = null;
    this.lastBuildValidationDigest = '';
    this.lastNearbyStructureId = null;
    this.activeStorageStructureId = null;
    this.activeManageStructureId = null;
    this.entityRegistry.clear();
    this.questTargetSyncTimer = 0;

    this.worldLifecycleState = 'MENU';
  }

  private yieldFrame(): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, 25));
  }

  private initDustPool(): void {
    this.dustGeo = new THREE.SphereGeometry(0.14, 6, 5);
    this.dustMat = new THREE.MeshBasicMaterial({
      color: 0xd9d2be,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const maxDust = 18;
    this.dustMesh = new THREE.InstancedMesh(this.dustGeo, this.dustMat, maxDust);
    this.dustMesh.count = 0;
    this.dustMesh.visible = false;
    this.dustMesh.frustumCulled = false;
    this.dustMesh.matrixAutoUpdate = false;
    this.dustMesh.updateMatrix();
    this.scene.add(this.dustMesh);
    for (let i = 0; i < maxDust; i++) {
      this.dustPool.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        scale: 1,
        life: 0,
        maxLife: 0.45,
      });
    }
  }

  private syncDustInstances(): void {
    if (!this.dustMesh) return;
    let active = 0;
    const dummy = this.dustDummy;
    for (let i = 0; i < this.dustPool.length; i++) {
      const p = this.dustPool[i];
      if (p.life > 0) {
        dummy.position.copy(p.pos);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        this.dustMesh.setMatrixAt(active++, dummy.matrix);
      }
    }
    this.dustMesh.count = active;
    this.dustMesh.visible = active > 0;
    if (active > 0) {
      this.dustMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private spawnDustBurst(x: number, y: number, z: number, count: number): void {
    const scaledCount =
      this.particleScale <= 0.25 ? 1 : Math.max(1, Math.round(count * this.particleScale));
    let spawned = 0;
    for (const p of this.dustPool) {
      if (p.life <= 0) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 1.2 + Math.random() * 2.2;
        p.pos.set(x, y + 0.1, z);
        p.scale = 0.7 + Math.random() * 0.7;
        p.vel.set(Math.cos(angle) * spd, 0.8 + Math.random() * 1.1, Math.sin(angle) * spd);
        p.maxLife = 0.35 + Math.random() * 0.25;
        p.life = p.maxLife;
        spawned++;
        if (spawned >= scaledCount) break;
      }
    }
    if (spawned > 0) {
      this.syncDustInstances();
    }
  }

  private updateDust(dt: number): void {
    let anyActive = false;
    for (let i = 0; i < this.dustPool.length; i++) {
      const p = this.dustPool[i];
      if (p.life > 0) {
        p.life -= dt;
        if (p.life <= 0) continue;
        anyActive = true;
        p.pos.addScaledVector(p.vel, dt);
        p.vel.multiplyScalar(0.92);
        const t = p.life / p.maxLife;
        p.scale = 0.5 + (1 - t) * 1.2;
      }
    }
    if (anyActive || this.dustMesh.visible) {
      this.syncDustInstances();
    }
  }

  public startAdventure(): void {
    this.sound.unlock();
    this.sound.playUiClick();
    this.input?.setTouchMode(this.touchModeEnabled);
    this.setPhase('playing');
    if (!this.touchModeEnabled) {
      this.input?.requestPointerLock();
    }
  }

  public resumeGame(skipPointerLock = false): void {
    this.sound.unlock();
    this.sound.playUiClick();
    this.input?.setTouchMode(this.touchModeEnabled);
    this.setPhase('playing');
    if (!this.touchModeEnabled && !skipPointerLock) {
      this.input?.requestPointerLock();
    }
  }

  public pauseGame(): void {
    if (this.phase === 'playing') {
      this.sound.playUiClick();
      this.setPhase('paused');
    }
  }

  public setModalOpen(open: boolean): void {
    this.modalOpen = open;
    if (open) {
      this.cancelActiveBowCharge(false);
      this.world?.buildings.updatePreview(
        false,
        this.selectedBlueprintId,
        0,
        0,
        0,
        0,
        false,
      );
    } else {
      this.activeStorageStructureId = null;
      this.activeManageStructureId = null;
    }
    if (this.input) {
      this.input.setActive(this.phase === 'playing' && !open);
      if (open) {
        this.input.exitPointerLock();
      } else if (this.phase === 'playing' && !this.touchModeEnabled && !this.buildModeActive) {
        this.input.requestPointerLock();
      }
    }
  }

  public setTouchMode(enabled: boolean): void {
    this.touchModeEnabled = enabled;
    this.input?.setTouchMode(enabled);
  }

  public getGraphicsSettings(): GraphicsSettings | null {
    return this.graphicsManager ? this.graphicsManager.getSettings() : null;
  }

  public getResolvedGraphicsProfile(): ResolvedGraphicsProfile | null {
    return this.graphicsManager ? this.graphicsManager.getProfile() : null;
  }

  public getHardwareCapabilities(): HardwareCapabilityProfile | null {
    return this.graphicsManager ? this.graphicsManager.getHardware() : null;
  }

  public updateGraphicsSettings(
    partial: Partial<GraphicsSettings>,
  ): ResolvedGraphicsProfile | null {
    if (!this.graphicsManager) return null;
    const res = this.graphicsManager.updateSettings(partial);
    this.performanceMonitor.reset(res.profile.dynamicTargetFps);
    this.applyResolvedProfile(res.profile, {
      texturesChanged: res.texturesChanged,
      vegetationChanged: res.vegetationChanged,
      shadowMapSizeChanged: res.shadowMapSizeChanged,
      emitCallback: true,
    });
    return res.profile;
  }

  public resetGraphicsSettings(): ResolvedGraphicsProfile | null {
    if (!this.graphicsManager) return null;
    const prev = this.graphicsManager.getProfile();
    const next = this.graphicsManager.resetToAuto();
    this.applyResolvedProfile(next, {
      texturesChanged: prev.textureQuality !== next.textureQuality,
      vegetationChanged: Math.abs(prev.vegetationScale - next.vegetationScale) > 0.01,
      shadowMapSizeChanged:
        prev.shadowMapSize !== next.shadowMapSize ||
        prev.shadowBasicFilter !== next.shadowBasicFilter ||
        prev.shadowEnabled !== next.shadowEnabled,
      emitCallback: true,
    });
    return next;
  }

  public setDebugOverlayEnabled(enabled: boolean): void {
    this.debugOverlayEnabled = enabled;
    this.debugEmitTimer = 0;
    if (enabled && this.renderer && this.graphicsManager) {
      this.objectCountTimer = 999;
      this.callbacks.onDebugPerfUpdate?.(this.getDebugPerformanceSnapshot());
    }
  }

  public getDebugPerformanceSnapshot(): DebugPerformanceSnapshot {
    const profile = this.graphicsManager.getProfile();
    const settings = this.graphicsManager.getSettings();
    const hw = this.graphicsManager.getHardware();
    const info = this.renderer?.info;

    const perfWithMemory = performance as unknown as {
      memory?: { usedJSHeapSize?: number };
    };
    const heapBytes = perfWithMemory.memory?.usedJSHeapSize;
    const jsHeapMb =
      typeof heapBytes === 'number' && heapBytes > 0
        ? Math.round((heapBytes / (1024 * 1024)) * 10) / 10
        : null;

    const activeParticles =
      (this.weatherEffects?.getActiveParticleCount() ?? 0) +
      (this.atmosphericParticles?.getActiveParticleCount() ?? 0) +
      (this.combat?.getActiveParticleCount() ?? 0);
    const mpRoom = this.multiplayerService?.getCurrentRoom() ?? null;
    const measuredNetHz = this.multiplayerService?.getNetworkPacketsPerSec?.();
    const isMpHost =
      Boolean(mpRoom) &&
      mpRoom?.hostId === this.multiplayerService?.getLocalPlayerId();
    const fallbackMoveHz = hw.isMobileOrTablet ? 12 : 16;
    const networkUpdatesPerSec =
      this.multiplayerSessionActive && mpRoom
        ? typeof measuredNetHz === 'number'
          ? measuredNetHz
          : fallbackMoveHz + (isMpHost ? 2 : 0)
        : 0;

    return {
      fps: this.performanceMonitor.getSmoothedFps(),
      frameTimeMs: this.performanceMonitor.getSmoothedFrameMs(),
      minFps: this.performanceMonitor.getMinWindowFps(),
      drawCalls: info ? info.render.calls : 0,
      triangles: info ? info.render.triangles : 0,
      geometries: info ? info.memory.geometries : 0,
      textures: info ? info.memory.textures : 0,
      jsHeapMb,
      activeObjects: this.cachedActiveObjects,
      activeNpcs: this.world ? this.world.npcs.getVisibleNpcCount() : 0,
      activeAnimals: this.world ? this.world.wildlife.getVisibleAnimalCount() : 0,
      activeParticles,
      networkUpdatesPerSec,
      loadedChunks: this.world ? this.world.chunkManager.getLoadedChunkCount() : 0,
      activeChunks: this.world ? this.world.chunkManager.getActiveChunkCount() : 0,
      renderScale: profile.renderScale,
      pixelRatio: Math.round(profile.pixelRatio * 100) / 100,
      effectiveTier: profile.effectiveTier,
      preset: settings.preset,
      graphicsMode: profile.graphicsMode,
      deviceClass: hw.deviceClass,
      gpuName: hw.gpuName,
      fpsLimit: profile.fpsLimit,
      effectiveFpsLimit: profile.effectiveFpsLimit,
      dynamicLevelOffset: this.graphicsManager.getDynamicLevelOffset(),
      dynamicTargetFps: profile.dynamicTargetFps,
    };
  }

  private applyResolvedProfile(
    profile: ResolvedGraphicsProfile,
    opts: {
      texturesChanged: boolean;
      vegetationChanged: boolean;
      shadowMapSizeChanged: boolean;
      emitCallback: boolean;
    },
  ): void {
    if (!this.renderer || !this.camera) {
      if (opts.emitCallback) {
        this.callbacks.onGraphicsProfileChange?.(profile);
      }
      return;
    }

    const vpState = OrientationManager.getState();
    const w = Math.max(1, this.container.clientWidth || vpState.width);
    const h = Math.max(1, this.container.clientHeight || vpState.height);
    if (this.camera.far !== profile.cameraFar) {
      this.camera.far = profile.cameraFar;
      this.camera.updateProjectionMatrix();
    }

    this.renderer.setPixelRatio(profile.pixelRatio);
    this.renderer.setSize(w, h);
    if (this.postProcessing && !this.isSoftwareGl) {
      this.postProcessing.setMode(profile.postProcessing, profile.antiAliasing);
      this.postProcessing.setSize(w, h, profile.pixelRatio);
    }
    this.lastResizeW = w;
    this.lastResizeH = h;
    this.lastResizePr = profile.pixelRatio;

    if (this.textures && opts.texturesChanged) {
      const maxAniso = Math.min(
        this.renderer.capabilities.getMaxAnisotropy(),
        profile.anisotropyCap,
      );
      const oldTex = this.textures;
      const nextTex = createProceduralTextures(
        maxAniso,
        profile.textureQuality,
        oldTex.contactShadowMap,
      );
      this.world?.applyTextures(nextTex);
      oldTex.disposeWorldMaps();
      this.textures = nextTex;
    }

    this.simThrottleScale = profile.simThrottleScale;
    this.particleScale = profile.particleScale;
    this.skyRig?.applyGraphicsProfile(this.renderer, profile);
    this.weatherManager.setQuality(profile.weatherQuality);
    this.weatherEffects?.setParticleScale(profile.particleScale);
    this.atmosphericParticles?.setParticleScale(profile.particleScale);
    this.world?.applyGraphicsProfile(
      profile,
      this.controller?.position,
      opts.vegetationChanged,
    );
    this.combat?.applyGraphicsProfile(profile);
    const lowPowerAudioOrNet =
      profile.effectiveTier === 'very-low' || profile.effectiveTier === 'low';
    getAudioManager().setLowPowerMode(lowPowerAudioOrNet);
    this.multiplayerService?.setLowPowerMode?.(lowPowerAudioOrNet);

    if (this.player) {
      this.player.root.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          if (mesh.userData.__origCastShadow === undefined) {
            mesh.userData.__origCastShadow = mesh.castShadow;
            mesh.userData.__origReceiveShadow = mesh.receiveShadow;
          }
          mesh.castShadow =
            Boolean(mesh.userData.__origCastShadow) &&
            profile.shadowEnabled &&
            !this.isSoftwareGl;
          mesh.receiveShadow =
            Boolean(mesh.userData.__origReceiveShadow) &&
            profile.shadowEnabled &&
            !this.isSoftwareGl;
        }
      });
    }

    if (opts.emitCallback) {
      this.callbacks.onGraphicsProfileChange?.(profile);
    }
  }

  public setLanguage(lang: Language): void {
    this.language = lang;
    this.dialogueEngine.setLanguage(lang);
    this.storyManager.setLanguage(lang);
    this.sideQuestManager.setLanguage(lang);
    this.world?.npcs.setLanguage(lang);
    if (this.worldRuntimeLoaded && this.controller) {
      this.emitHud();
    }
  }

  public getMobileInput(): MobileInputManager | null {
    return this.input?.mobile ?? null;
  }

  public getLandmarks(): WorldLandmark[] {
    return this.landmarks.map((l) => ({ ...l }));
  }

  private getVillageMapEntries(): MapVillageEntry[] {
    if (!this.world) return [];
    return this.world.village.villages.map((v) => ({
      id: v.id,
      name: v.name,
      nameAr: v.nameAr,
      kind: v.kind,
      centerX: v.centerX,
      centerZ: v.centerZ,
    }));
  }

  public getWaypoint(): MapWaypoint | null {
    return this.waypoint ? { ...this.waypoint } : null;
  }

  public setWaypoint(wp: MapWaypoint): void {
    this.waypoint = {
      x: Math.round(wp.x),
      z: Math.round(wp.z),
      label: wp.label,
    };
    this.hasUnsavedProgress = true;
    this.sound.playUiClick();
    this.callbacks.onWorldNotice(UI_TEXT[this.language].waypointSetNotice);
    this.emitHud();
  }

  public clearWaypoint(): void {
    if (!this.waypoint) return;
    this.waypoint = null;
    this.hasUnsavedProgress = true;
    this.sound.playUiClick();
    this.callbacks.onWorldNotice(UI_TEXT[this.language].waypointRemovedNotice);
    this.emitHud();
  }

  public getActiveWorldType(): WorldType {
    return this.activeWorldType;
  }

  public getMapData(): MapWorldData | null {
    if (!this.world) return null;
    const px = this.controller?.position.x ?? 0;
    const pz = this.controller?.position.z ?? 0;
    const maxAnimalDistSq = 190 * 190;
    const animals: MapAnimalEntry[] = [];
    for (const a of this.entityRegistry.getVisibleAnimals()) {
      const dx = a.position.x - px;
      const dz = a.position.z - pz;
      if (dx * dx + dz * dz <= maxAnimalDistSq) {
        animals.push({
          id: a.entityId,
          species: a.archetype ?? 'deer',
          x: a.position.x,
          z: a.position.z,
        });
        if (animals.length >= 40) break;
      }
    }

    const players: MapPlayerPin[] = [];
    const activeParty = this.cachedPartyState.party;
    if (
      this.multiplayerSessionActive &&
      this.multiplayerService &&
      (this.showFriendsOnMapSetting || this.showPartyMembersOnMapSetting)
    ) {
      const room = this.multiplayerService.getRoomState();
      const roomPlayersById = new Map<string, MultiplayerPlayer>();
      for (const p of room?.players ?? []) {
        roomPlayersById.set(p.id, p);
      }
      const partyMemberById = new Map<
        string,
        NonNullable<PartyStateSnapshot['party']>['members'][number]
      >();
      if (activeParty) {
        for (const pm of activeParty.members) {
          partyMemberById.set(pm.playerId, pm);
        }
      }
      const friendProfileIds = new Set<string>();
      const friendNames = new Set<string>();
      for (const f of ProfileManager.getSnapshot().friends) {
        if (f.publicProfileId) friendProfileIds.add(f.publicProfileId);
        if (f.displayName) friendNames.add(f.displayName.trim().toLowerCase());
      }
      const seenIds = new Set<string>();
      const buildPlayerPin = (
        rpId: string,
        name: string,
        publicProfileId: string | undefined,
        tx: number,
        tz: number,
        isDead: boolean,
      ): MapPlayerPin | null => {
        const pm = partyMemberById.get(rpId);
        const isParty = Boolean(pm);
        if (isParty && !this.showPartyMembersOnMapSetting) {
          return null;
        }
        const isFriend = Boolean(
          (publicProfileId && friendProfileIds.has(publicProfileId)) ||
            friendNames.has(name.trim().toLowerCase()),
        );
        if (!isParty && !this.showFriendsOnMapSetting) {
          return null;
        }
        const { distanceMeters, directionLabel } = this.computeDistanceAndDirection(
          px,
          pz,
          tx,
          tz,
        );
        return {
          id: rpId,
          name,
          relationship: isParty ? 'party' : isFriend ? 'friend' : 'room_player',
          x: tx,
          z: tz,
          isDead: isDead || pm?.isDead,
          ...(pm
            ? {
                partyIndex: pm.markerIndex,
                partyColor: pm.markerColor,
                level: pm.level,
                health: pm.health,
                maxHealth: pm.maxHealth,
                online: pm.online,
              }
            : {}),
          distanceMeters,
          directionLabel,
        };
      };

      for (const pos of this.remotePlayersManager?.getRemotePlayerPositions() ?? []) {
        if (!pos.playerId || pos.playerId === this.localMultiplayerPlayerId) continue;
        const rp = roomPlayersById.get(pos.playerId);
        const pm = partyMemberById.get(pos.playerId);
        if (!rp && !pm) continue;
        if (rp?.isLocal) continue;
        seenIds.add(pos.playerId);
        const pin = buildPlayerPin(
          pos.playerId,
          rp?.displayName ?? pm?.displayName ?? 'Ally',
          rp?.publicProfileId ?? pm?.publicProfileId,
          pos.x,
          pos.z,
          pos.isDead,
        );
        if (pin) players.push(pin);
      }
      for (const rp of room?.players ?? []) {
        if (
          !rp.id ||
          rp.id === this.localMultiplayerPlayerId ||
          rp.isLocal ||
          seenIds.has(rp.id) ||
          !rp.state ||
          !Number.isFinite(rp.state.x) ||
          !Number.isFinite(rp.state.z)
        ) {
          continue;
        }
        seenIds.add(rp.id);
        const pin = buildPlayerPin(
          rp.id,
          rp.displayName,
          rp.publicProfileId,
          rp.state.x,
          rp.state.z,
          Boolean(rp.isDead),
        );
        if (pin) players.push(pin);
      }
    }

    const questTargets: MapQuestTargetEntry[] = this.entityRegistry
      .getActiveQuestTargets()
      .map((rec) => {
        const qt = rec.questTarget!;
        const archCfg =
          rec.archetype && rec.archetype in ENEMY_ARCHETYPES
            ? ENEMY_ARCHETYPES[rec.archetype as keyof typeof ENEMY_ARCHETYPES]
            : undefined;
        return {
          entityId: rec.entityId,
          questId: qt.questId,
          objectiveId: qt.objectiveId,
          enemyType: qt.enemyType,
          lifecycle: qt.lifecycle,
          worldId: rec.worldId,
          chunkId: rec.chunkId,
          x: rec.position.x,
          z: rec.position.z,
          loaded: rec.loaded,
          label: archCfg?.name ?? rec.name,
          labelAr: archCfg?.nameAr ?? rec.nameAr,
        };
      });

    return {
      seed: this.world.seed,
      villageSite: this.world.village.site,
      villages: this.getVillageMapEntries(),
      landmarks: this.getLandmarks(),
      npcs: this.entityRegistry.getVisibleVillagers().map((npc) => ({
        id: npc.entityId,
        name:
          (this.language === 'ar' ? npc.nameAr : npc.name) ??
          npc.name ??
          npc.entityId,
        role:
          npc.role && npc.role in ROLE_LABELS[this.language]
            ? ROLE_LABELS[this.language][npc.role as keyof (typeof ROLE_LABELS)['en']]
            : (npc.role ?? ''),
        x: npc.position.x,
        z: npc.position.z,
        alive: npc.alive,
        loaded: npc.loaded,
        valid: npc.valid,
      })),
      animals,
      players,
      questTargets,
      questTargetPlans: this.entityRegistry.getQuestTargetPlans(),
      coopObjective: activeParty?.activeObjective ?? null,
      storyMarkers: this.storyManager.getMapMarkers(this.storyBridge, this.language),
      sideQuestMarkers: this.sideQuestManager.getMapMarkers(
        this.sideQuestBridge,
        this.language,
      ),
      interactables: this.interactables.map((item) => ({
        id: item.id,
        label: item.label,
        kind: item.kind,
        x: item.x,
        z: item.z,
        collected: item.collected,
      })),
      activeQuests: this.dialogueEngine.quests.getActiveQuests(
        this.dialogueBridge,
      ),
      availableQuests: this.dialogueEngine.quests.getAvailableQuests(
        this.dialogueBridge,
      ),
      questDefs: getAllQuestDefinitions(),
      waypoint: this.waypoint ? { ...this.waypoint } : null,
      getItemCount: (itemId: string) =>
        this.inventoryManager.getItemCount(itemId),
    };
  }

  public getPlayerController(): PlayerController | null {
    return this.controller ?? null;
  }

  public useInventorySlot(slotIndex: number): void {
    if (!this.controller) return;
    const t = UI_TEXT[this.language];
    const res = this.inventoryManager.useSlot(slotIndex, {
      health: this.controller.getHealth(),
      maxHealth: this.controller.getMaxHealth(),
      stamina: this.controller.getStamina(),
      maxStamina: this.controller.getMaxStamina(),
    });

    if (!res.ok) {
      if (res.reason === 'full_stats') {
        this.callbacks.onWorldNotice(t.statsAlreadyFull);
      }
      return;
    }

    const localizedName = this.itemManager.getName(res.definition.id, this.language);

    if (res.action === 'place_bed') {
      if (!this.world) return;
      const pos = this.controller.position;
      const yaw = this.controller.getYaw();
      const bx = pos.x + Math.sin(yaw) * 2.0;
      const bz = pos.z + Math.cos(yaw) * 2.0;
      const placed = this.world.placeBedAt(bx, bz, yaw);
      if (!placed) {
        this.callbacks.onWorldNotice(t.bedCannotPlaceNotice);
        return;
      }
      this.inventoryManager.removeItem('bed', 1);
      this.sound.playObjectPlace(false, placed);
      this.spawnDustBurst(placed.x, placed.y, placed.z, 5);
      if (this.multiplayerSessionActive && this.multiplayerService) {
        this.multiplayerService.sendGameEvent('BED_PLACED', {
          bedId: placed.id,
          x: Math.round(placed.x * 100) / 100,
          y: Math.round(placed.y * 100) / 100,
          z: Math.round(placed.z * 100) / 100,
          yaw: Math.round(yaw * 1000) / 1000,
        });
      }
      this.callbacks.onWorldNotice(t.bedPlacedNotice);
    } else if (res.action === 'place_station') {
      if (!this.world) return;
      const pos = this.controller.position;
      const yaw = this.controller.getYaw();
      const sx = pos.x + Math.sin(yaw) * 2.1;
      const sz = pos.z + Math.cos(yaw) * 2.1;
      const placed = this.world.placeStationAt(res.stationType, sx, sz, yaw);
      if (!placed) {
        this.callbacks.onWorldNotice(t.stationCannotPlaceNotice);
        return;
      }
      this.inventoryManager.removeItem(res.definition.id, 1);
      this.sound.playObjectPlace(false, placed);
      this.spawnDustBurst(placed.x, placed.y, placed.z, 5);
      if (this.multiplayerSessionActive && this.multiplayerService) {
        this.multiplayerService.sendGameEvent('STATION_PLACED', {
          stationId: placed.id,
          stationType: res.stationType,
          x: Math.round(placed.x * 100) / 100,
          y: Math.round(placed.y * 100) / 100,
          z: Math.round(placed.z * 100) / 100,
          yaw: Math.round(yaw * 1000) / 1000,
        });
      }
      this.callbacks.onWorldNotice(t.stationPlacedNotice(localizedName));
    } else if (res.action === 'consumed') {
      if (res.healthRestored > 0) this.controller.heal(res.healthRestored);
      if (res.staminaRestored > 0) this.controller.restoreStamina(res.staminaRestored);
      if (this.multiplayerSessionActive && this.multiplayerService) {
        this.multiplayerService.sendGameEvent('ITEM_USED', {
          itemId: res.definition.id,
          count: 1,
        });
      }
      this.sound.playItemPickup('food');
      const parts: string[] = [];
      if (res.healthRestored > 0) parts.push(`+${res.healthRestored} ${t.health}`);
      if (res.staminaRestored > 0) parts.push(`+${res.staminaRestored} ${t.stamina}`);
      this.callbacks.onWorldNotice(t.usedItemNotice(localizedName, parts));
    } else if (res.action === 'equipped') {
      this.sound.playItemPickup(
        res.definition.category === 'weapon' ? 'weapon' : 'resource',
      );
      this.syncEquipmentBonuses();
      this.syncEquippedWeaponFromInventory();
      this.callbacks.onWorldNotice(t.equippedNotice(localizedName));
    } else if (res.action === 'unequipped') {
      this.sound.playUiClick();
      this.syncEquipmentBonuses();
      this.syncEquippedWeaponFromInventory();
      this.callbacks.onWorldNotice(t.unequippedNotice(localizedName));
    }

    this.emitInventorySnapshot();
    this.emitHud();
  }

  public selectOwnedWeapon(weaponIndex: number): void {
    const owned = this.inventoryManager.getOwnedWeaponSlots();
    const target = owned[weaponIndex];
    if (!target) return;

    if (!target.equipped) {
      this.useInventorySlot(target.slotIndex);
    } else {
      this.sound.playUiClick();
    }
  }

  public cycleOwnedWeapon(): void {
    const owned = this.inventoryManager.getOwnedWeaponSlots();
    if (owned.length === 0) return;

    const currentIdx = owned.findIndex((s) => s.equipped);
    const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % owned.length;
    const nextSlot = owned[nextIdx];
    if (!nextSlot.equipped) {
      this.useInventorySlot(nextSlot.slotIndex);
    }
  }

  public unequipWeapon(): void {
    const unequippedDef = this.inventoryManager.unequipSlotType('weapon');
    if (!unequippedDef) return;

    this.sound.playUiClick();
    this.syncEquippedWeaponFromInventory();
    const t = UI_TEXT[this.language];
    const localizedName = this.itemManager.getName(unequippedDef.id, this.language);
    this.callbacks.onWorldNotice(t.unequippedNotice(localizedName));
    this.emitInventorySnapshot();
    this.emitHud();
  }

  public dropInventorySlot(slotIndex: number, count = 1): void {
    const t = UI_TEXT[this.language];
    const res = this.inventoryManager.dropSlot(slotIndex, count);
    if (!res.ok) {
      if (res.reason === 'not_droppable') {
        this.callbacks.onWorldNotice(t.cannotDropNotice);
      }
      return;
    }

    this.sound.playItemDropOrThrow(false);
    this.syncEquipmentBonuses();
    this.syncEquippedWeaponFromInventory();

    const localizedName = this.itemManager.getName(res.itemId, this.language);
    if (this.controller && this.world) {
      const pos = this.controller.position;
      const yaw = this.controller.getYaw();
      const dropX = pos.x + Math.sin(yaw) * 1.35;
      const dropZ = pos.z + Math.cos(yaw) * 1.35;
      const spawned = this.world.spawnWorldPickup(
        dropX,
        dropZ,
        res.itemId,
        res.count,
        res.definition.name,
        undefined,
        true,
      );
      if (this.multiplayerSessionActive && this.multiplayerService) {
        this.multiplayerService.sendGameEvent('ITEM_DROPPED', {
          dropId: spawned.id,
          itemId: res.itemId,
          count: res.count,
          label: res.definition.name,
          x: Math.round(spawned.x * 100) / 100,
          y: Math.round(spawned.y * 100) / 100,
          z: Math.round(spawned.z * 100) / 100,
        });
      }
    }

    this.callbacks.onWorldNotice(t.droppedNotice(localizedName, res.count));
    this.emitInventorySnapshot();
    this.emitHud();
  }

  // ---------------------------------------------------------------------------
  // Building & Construction System
  // ---------------------------------------------------------------------------
  public isBuildModeActive(): boolean {
    return this.buildModeActive;
  }

  public toggleBuildMode(): void {
    if (this.buildModeActive) {
      this.exitBuildMode();
    } else {
      this.enterBuildMode();
    }
  }

  public enterBuildMode(blueprintId?: string): void {
    if (!this.world || !this.controller || this.phase !== 'playing' || this.isSleeping) return;
    this.cancelActiveBowCharge(false);
    if (blueprintId) {
      const bp = getBlueprintById(blueprintId);
      if (bp) {
        this.buildCategory = bp.category;
        this.selectedBlueprintId = bp.id;
      }
    } else if (!getBlueprintById(this.selectedBlueprintId)) {
      this.selectedBlueprintId = BUILDING_BLUEPRINTS[0].id;
      this.buildCategory = BUILDING_BLUEPRINTS[0].category;
    }
    this.buildModeActive = true;
    this.buildNudgeX = 0;
    this.buildNudgeZ = 0;
    // Release pointer lock so desktop players can freely select blueprints, categories, and buttons while drag-looking
    this.input?.exitPointerLock();
    this.sound.playUiClick();
    this.updateBuildPreview();
    this.emitHud();
  }

  public exitBuildMode(): void {
    if (!this.buildModeActive) {
      this.world?.buildings.clearPreview();
      return;
    }
    this.buildModeActive = false;
    this.lastBuildValidation = null;
    this.lastBuildValidationDigest = '';
    this.world?.buildings.clearPreview();
    this.sound.playUiClick();
    this.emitHud();
  }

  public selectBuildCategory(category: BuildingCategory): void {
    this.buildCategory = category;
    const list = getBlueprintsByCategory(category);
    if (list.length > 0 && !list.some((b) => b.id === this.selectedBlueprintId)) {
      this.selectedBlueprintId = list[0].id;
    }
    this.buildNudgeX = 0;
    this.buildNudgeZ = 0;
    this.sound.playUiClick();
    this.updateBuildPreview();
    this.emitHud();
  }

  public selectBlueprint(blueprintId: string): void {
    const bp = getBlueprintById(blueprintId);
    if (!bp) return;
    this.buildCategory = bp.category;
    this.selectedBlueprintId = bp.id;
    this.buildNudgeX = 0;
    this.buildNudgeZ = 0;
    this.sound.playUiClick();
    this.updateBuildPreview();
    this.emitHud();
  }

  public rotateBuildPreview(dir: 1 | -1): void {
    const stepRad = (this.buildRotationStep * Math.PI) / 180;
    this.buildYaw = Math.atan2(
      Math.sin(this.buildYaw + dir * stepRad),
      Math.cos(this.buildYaw + dir * stepRad),
    );
    this.sound.playUiClick();
    this.updateBuildPreview();
    this.emitHud();
  }

  public setBuildRotationStep(deg: RotationIncrementDeg): void {
    this.buildRotationStep = deg;
    this.sound.playUiClick();
    this.emitHud();
  }

  public toggleBuildSnap(): void {
    this.buildSnapEnabled = !this.buildSnapEnabled;
    this.sound.playUiClick();
    this.updateBuildPreview();
    this.emitHud();
  }

  public nudgeBuildPreview(dx: number, dz: number): void {
    this.buildNudgeX = Math.max(-3.5, Math.min(3.5, Math.round((this.buildNudgeX + dx) * 100) / 100));
    this.buildNudgeZ = Math.max(-3.5, Math.min(3.5, Math.round((this.buildNudgeZ + dz) * 100) / 100));
    this.updateBuildPreview();
    this.emitHud();
  }

  public resetBuildNudge(): void {
    this.buildNudgeX = 0;
    this.buildNudgeZ = 0;
    this.updateBuildPreview();
    this.emitHud();
  }

  public adjustBuildDistance(delta: number): void {
    this.buildDistance = Math.max(3.2, Math.min(9.5, this.buildDistance + delta));
    this.updateBuildPreview();
  }

  public setBuildDefaultPermission(scope: BuildingPermissionScope): void {
    this.buildPermissionDefault = scope;
    this.sound.playUiClick();
    this.emitHud();
  }

  private buildCostStatuses(costs: ReadonlyArray<{ itemId: string; count: number }>): {
    hasAll: boolean;
    items: BuildModeCostStatus[];
  } {
    const isCreativeFree = this.activeWorldType === 'creative';
    let hasAll = true;
    const items: BuildModeCostStatus[] = costs.map((c) => {
      const owned = this.inventoryManager.getItemCount(c.itemId);
      const enough = isCreativeFree || owned >= c.count;
      if (!enough) hasAll = false;
      return {
        itemId: c.itemId,
        name: this.itemManager.getName(c.itemId, this.language),
        required: c.count,
        owned,
        enough,
      };
    });
    return { hasAll, items };
  }

  private computeBuildValidation(bp: BuildingBlueprint): PlacementValidationResult | null {
    if (!this.world || !this.controller || !this.cameraRig) return null;
    const camYaw = this.cameraRig.getYaw();
    const forwardX = -Math.sin(camYaw);
    const forwardZ = -Math.cos(camYaw);
    const rightX = Math.cos(camYaw);
    const rightZ = -Math.sin(camYaw);

    const dist = Math.max(this.buildDistance, Math.max(bp.width, bp.depth) * 0.55 + 2.3);
    const rawX =
      this.controller.position.x +
      forwardX * dist +
      rightX * this.buildNudgeX +
      forwardX * this.buildNudgeZ;
    const rawZ =
      this.controller.position.z +
      forwardZ * dist +
      rightZ * this.buildNudgeX +
      forwardZ * this.buildNudgeZ;

    const ctx = this.world.getBuildingValidationContext({
      x: this.controller.position.x,
      y: this.controller.position.y,
      z: this.controller.position.z,
    });

    return validatePlayerPlacement(
      bp,
      rawX,
      rawZ,
      this.buildYaw,
      this.buildSnapEnabled,
      ctx,
    );
  }

  private updateBuildPreview(): void {
    if (!this.world || !this.buildModeActive || this.modalOpen || this.phase !== 'playing') {
      this.world?.buildings.updatePreview(
        false,
        this.selectedBlueprintId,
        0,
        0,
        0,
        0,
        false,
      );
      return;
    }
    const bp = getBlueprintById(this.selectedBlueprintId);
    if (!bp) return;
    const res = this.computeBuildValidation(bp);
    if (!res) return;
    this.lastBuildValidation = res;
    const { hasAll } = this.buildCostStatuses(bp.costs);
    const previewValid = res.valid && hasAll;
    this.world.buildings.updatePreview(
      true,
      bp.id,
      res.alignedX,
      res.alignedY,
      res.alignedZ,
      res.alignedYaw,
      previewValid,
    );
  }

  public confirmBuildPlacement(): boolean {
    if (!this.world || !this.controller || !this.buildModeActive || this.isSleeping) {
      return false;
    }
    const t = UI_TEXT[this.language];
    const bp = getBlueprintById(this.selectedBlueprintId);
    if (!bp) return false;

    const validation = this.computeBuildValidation(bp);
    this.lastBuildValidation = validation;
    if (!validation || !validation.valid) {
      this.sound.playBuildError();
      const reasonKey = validation?.reason ?? 'colliding_structure';
      this.callbacks.onWorldNotice(t.buildInvalidNotice(t.buildReasonLabels[reasonKey]));
      this.emitHud();
      return false;
    }

    const { hasAll } = this.buildCostStatuses(bp.costs);
    if (!hasAll) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(t.buildMissingMaterialsNotice);
      this.emitHud();
      return false;
    }

    const isCreativeFree = this.activeWorldType === 'creative';
    if (!isCreativeFree) {
      for (let i = 0; i < bp.costs.length; i++) {
        this.inventoryManager.removeItem(bp.costs[i].itemId, bp.costs[i].count);
      }
      this.emitInventorySnapshot();
    }

    const structureId = `bld_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const ownerId =
      this.multiplayerSessionActive && this.localMultiplayerPlayerId
        ? this.localMultiplayerPlayerId
        : 'local';
    const ownerName =
      ProfileManager.getSnapshot().profile?.displayName || 'Explorer';

    const placed: PlayerBuiltStructure = {
      id: structureId,
      blueprintId: bp.id,
      category: bp.category,
      tier: bp.tier,
      x: Math.round(validation.alignedX * 1000) / 1000,
      y: Math.round(validation.alignedY * 1000) / 1000,
      z: Math.round(validation.alignedZ * 1000) / 1000,
      yaw: Math.round(validation.alignedYaw * 1000) / 1000,
      health: bp.maxHealth,
      maxHealth: bp.maxHealth,
      ownerId,
      ownerName,
      permission: this.buildPermissionDefault,
      createdAtMs: Date.now(),
      ...(bp.hasDoor ? { doorOpen: false } : {}),
      ...(bp.storageCapacity ? { storageItems: [] } : {}),
      ...(bp.isFarmPlot
        ? {
            farmState: {
              stage: 0,
              growthProgress: 0,
              plantedAtElapsed: this.elapsed,
              soilPrepared: false,
              cropId: null,
              waterLevel: 0,
              plantedAtWorldHours: null,
              lastUpdatedWorldHours: this.getTotalWorldHours(),
            },
          }
        : {}),
    };

    this.world.buildings.addOrUpdateStructure(placed);
    if (bp.isCoop) {
      this.world.farmAnimals.spawnStarterAnimalForStructure(
        placed,
        this.getTotalWorldHours(),
      );
    }
    this.sound.playObjectPlace(bp.category === 'structures', {
      x: placed.x,
      y: placed.y,
      z: placed.z,
    });
    this.spawnDustBurst(placed.x, placed.y + 0.35, placed.z, 7);
    this.hasUnsavedProgress = true;

    if (!this.multiplayerSessionActive) {
      ProfileManager.recordGameplayDelta({ xpGained: 8 });
    } else if (this.multiplayerService) {
      this.multiplayerService.sendPlayerBuildPlace?.({
        structureId: placed.id,
        blueprintId: placed.blueprintId,
        x: placed.x,
        y: placed.y,
        z: placed.z,
        yaw: placed.yaw,
        ownerName: placed.ownerName,
        permissionScope: placed.permission,
      });
    }

    const sqChanged = this.sideQuestManager.onStructureBuilt(
      bp.id,
      bp.category,
      (msg) => this.callbacks.onWorldNotice(msg),
    );
    if (sqChanged) {
      this.syncSideQuestLocalEntities();
    }
    this.sideQuestManager.update(this.sideQuestBridge, (msg) =>
      this.callbacks.onWorldNotice(msg),
    );

    const localizedName = this.language === 'ar' ? bp.nameAr : bp.nameEn;
    this.callbacks.onWorldNotice(t.buildPlacedNotice(localizedName));
    this.updateBuildPreview();
    this.emitHud();
    return true;
  }

  private getBuildModeSnapshot(): BuildModeHudSnapshot {
    const bp = getBlueprintById(this.selectedBlueprintId) ?? BUILDING_BLUEPRINTS[0];
    const { hasAll, items } = this.buildCostStatuses(bp.costs);
    const validPlacement = Boolean(this.lastBuildValidation?.valid) && hasAll;
    const reason =
      !hasAll && this.lastBuildValidation?.valid
        ? 'missing_materials'
        : this.lastBuildValidation?.reason ?? 'valid';

    return {
      active: this.buildModeActive,
      category: this.buildCategory,
      selectedBlueprintId: bp.id,
      rotationDeg: Math.round((((this.buildYaw * 180) / Math.PI) % 360 + 360) % 360),
      rotationStepDeg: this.buildRotationStep,
      snapEnabled: this.buildSnapEnabled,
      validPlacement,
      validationReason: reason,
      snappedToId: this.lastBuildValidation?.snappedToId,
      hasAllMaterials: hasAll,
      isCreativeFree: this.activeWorldType === 'creative',
      costStatus: items,
      placedCount: this.world?.buildings.getStructureCount() ?? 0,
      targetedStructureId: this.lastNearbyStructureId,
    };
  }

  private isStructureOwnerOrHost(st: PlayerBuiltStructure): boolean {
    if (!this.multiplayerSessionActive) return true;
    if (this.localMultiplayerPlayerId && st.ownerId === this.localMultiplayerPlayerId) {
      return true;
    }
    return this.isLocalMultiplayerHost();
  }

  private canAccessPlayerStructure(st: PlayerBuiltStructure): boolean {
    if (!this.multiplayerSessionActive) return true;
    if (this.isStructureOwnerOrHost(st)) return true;
    if (st.permission === 'everyone') return true;
    if (st.permission === 'party') {
      const members = this.cachedPartyState.party?.members ?? [];
      return members.some((m) => m.playerId === st.ownerId);
    }
    if (st.permission === 'friends') {
      return Boolean(this.multiplayerService?.getSocialAdapter().isFriendName(st.ownerName));
    }
    return false;
  }

  public openBuildingStorageModal(structureId: string): boolean {
    if (!this.world) return false;
    const st = this.world.buildings.getStructureById(structureId);
    if (!st) return false;
    if (!this.canAccessPlayerStructure(st)) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(UI_TEXT[this.language].buildPermissionDeniedNotice);
      return false;
    }
    this.activeStorageStructureId = structureId;
    this.sound.playChestState(true, { x: st.x, y: st.y, z: st.z });
    this.callbacks.onOpenBuildingStorage?.(structureId);
    return true;
  }

  public openStructureManageModal(structureId?: string): boolean {
    if (!this.world || !this.controller) return false;
    const target = structureId
      ? this.world.buildings.getStructureById(structureId)
      : this.world.buildings.getNearestManageableStructure(
          this.controller.position.x,
          this.controller.position.y,
          this.controller.position.z,
          5.4,
        );
    if (!target) return false;
    this.activeManageStructureId = target.id;
    this.sound.playUiClick();
    this.callbacks.onOpenStructureManage?.(target.id);
    return true;
  }

  public getStorageModalSnapshot(): StorageModalSnapshot | null {
    if (!this.world || !this.activeStorageStructureId) return null;
    const st = this.world.buildings.getStructureById(this.activeStorageStructureId);
    if (!st) return null;
    const bp = getBlueprintById(st.blueprintId);
    if (!bp?.storageCapacity) return null;
    return {
      structureId: st.id,
      title: this.language === 'ar' ? bp.nameAr : bp.nameEn,
      capacity: bp.storageCapacity,
      items: (st.storageItems ?? []).map((it) => ({ ...it })),
      permission: st.permission,
      canModify: this.canAccessPlayerStructure(st),
    };
  }

  public getStructureManageSnapshot(): StructureManageSnapshot | null {
    if (!this.world || !this.activeManageStructureId) return null;
    const st = this.world.buildings.getStructureById(this.activeManageStructureId);
    if (!st) return null;
    const bp = getBlueprintById(st.blueprintId);
    if (!bp) return null;

    const isOwner = this.isStructureOwnerOrHost(st);
    const canManage = this.canAccessPlayerStructure(st);
    const repairCostCheck = this.buildCostStatuses(bp.repairCosts);
    const nextBp = bp.upgradeToId ? getBlueprintById(bp.upgradeToId) : undefined;
    const upgradeCostCheck = bp.upgradeCosts
      ? this.buildCostStatuses(bp.upgradeCosts)
      : { hasAll: false, items: [] };

    const refundItems: Array<{ itemId: string; name: string; count: number }> = [];
    if (this.activeWorldType !== 'creative') {
      for (let i = 0; i < bp.costs.length; i++) {
        const refundCount = Math.floor(bp.costs[i].count * 0.5);
        if (refundCount > 0) {
          refundItems.push({
            itemId: bp.costs[i].itemId,
            name: this.itemManager.getName(bp.costs[i].itemId, this.language),
            count: refundCount,
          });
        }
      }
    }

    return {
      structureId: st.id,
      blueprintId: bp.id,
      name: this.language === 'ar' ? bp.nameAr : bp.nameEn,
      tier: st.tier,
      health: st.health,
      maxHealth: st.maxHealth,
      ownerId: st.ownerId,
      ownerName: st.ownerName,
      isOwner,
      canManage,
      permission: st.permission,
      canRepair: canManage && st.health < st.maxHealth && repairCostCheck.hasAll,
      repairCosts: repairCostCheck.items,
      upgradeBlueprintId: nextBp?.id,
      upgradeName: nextBp ? (this.language === 'ar' ? nextBp.nameAr : nextBp.nameEn) : undefined,
      canUpgrade: Boolean(nextBp) && isOwner && upgradeCostCheck.hasAll,
      upgradeCosts: upgradeCostCheck.items,
      hasStorage: Boolean(bp.storageCapacity && bp.storageCapacity > 0),
      storageCount: st.storageItems?.length ?? 0,
      refundItems,
      isCreativeFree: this.activeWorldType === 'creative',
    };
  }

  public transferStorageItem(
    structureId: string,
    direction: 'deposit' | 'withdraw',
    itemId: string,
    count: number,
  ): boolean {
    if (!this.world) return false;
    const st = this.world.buildings.getStructureById(structureId);
    const bp = st ? getBlueprintById(st.blueprintId) : undefined;
    if (!st || !bp?.storageCapacity) return false;
    if (!this.canAccessPlayerStructure(st)) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(UI_TEXT[this.language].buildPermissionDeniedNotice);
      return false;
    }

    const qty = Math.max(1, Math.min(200, Math.floor(count)));
    const items: PlayerStructureStorageItem[] = (st.storageItems ?? []).map((it) => ({ ...it }));
    const t = UI_TEXT[this.language];

    if (direction === 'deposit') {
      const owned = this.inventoryManager.getItemCount(itemId);
      const actual = Math.min(owned, qty);
      if (actual <= 0) return false;
      const existing = items.find((it) => it.itemId === itemId);
      if (!existing && items.length >= bp.storageCapacity) {
        this.sound.playBuildError();
        this.callbacks.onWorldNotice(t.buildStorageFullNotice);
        return false;
      }
      this.inventoryManager.removeItem(itemId, actual);
      if (existing) {
        existing.count = Math.min(200, existing.count + actual);
      } else {
        items.push({ itemId, count: actual });
      }
      this.world.buildings.setStorageItems(st.id, items);
      this.sound.playUiClick();
      if (this.multiplayerSessionActive && this.multiplayerService) {
        this.multiplayerService.sendPlayerStorageTransfer?.(
          st.id,
          'deposit',
          itemId,
          actual,
        );
      }
    } else {
      const idx = items.findIndex((it) => it.itemId === itemId);
      if (idx === -1) return false;
      const actual = Math.min(items[idx].count, qty);
      if (!this.inventoryManager.canAccept(itemId, actual)) {
        this.sound.playBuildError();
        this.callbacks.onWorldNotice(t.packFullNotice);
        return false;
      }
      this.inventoryManager.addItem(itemId, actual);
      items[idx].count -= actual;
      if (items[idx].count <= 0) {
        items.splice(idx, 1);
      }
      this.world.buildings.setStorageItems(st.id, items);
      this.sound.playItemPickup('resource');
      if (this.multiplayerSessionActive && this.multiplayerService) {
        this.multiplayerService.sendPlayerStorageTransfer?.(
          st.id,
          'withdraw',
          itemId,
          actual,
        );
      }
    }

    this.hasUnsavedProgress = true;
    this.emitInventorySnapshot();
    this.syncEquippedWeaponFromInventory();
    this.emitHud();
    return true;
  }

  public repairStructure(structureId: string): boolean {
    if (!this.world) return false;
    const st = this.world.buildings.getStructureById(structureId);
    const bp = st ? getBlueprintById(st.blueprintId) : undefined;
    if (!st || !bp || st.health >= st.maxHealth) return false;
    if (!this.canAccessPlayerStructure(st)) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(UI_TEXT[this.language].buildPermissionDeniedNotice);
      return false;
    }

    const { hasAll } = this.buildCostStatuses(bp.repairCosts);
    if (!hasAll) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(UI_TEXT[this.language].buildMissingMaterialsNotice);
      return false;
    }

    if (this.activeWorldType !== 'creative') {
      for (let i = 0; i < bp.repairCosts.length; i++) {
        this.inventoryManager.removeItem(bp.repairCosts[i].itemId, bp.repairCosts[i].count);
      }
      this.emitInventorySnapshot();
    }

    this.world.buildings.applyRepair(st.id);
    this.sound.playBuildRepair({ x: st.x, y: st.y, z: st.z });
    this.spawnDustBurst(st.x, st.y + 0.5, st.z, 5);
    this.hasUnsavedProgress = true;
    if (this.multiplayerSessionActive && this.multiplayerService) {
      this.multiplayerService.sendPlayerBuildRepair?.(st.id);
    }
    this.callbacks.onWorldNotice(UI_TEXT[this.language].buildManageRepairedNotice);
    this.emitHud();
    return true;
  }

  public upgradeStructure(structureId: string): boolean {
    if (!this.world) return false;
    const st = this.world.buildings.getStructureById(structureId);
    const bp = st ? getBlueprintById(st.blueprintId) : undefined;
    if (!st || !bp?.upgradeToId || !bp.upgradeCosts) return false;
    if (!this.isStructureOwnerOrHost(st)) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(UI_TEXT[this.language].buildPermissionDeniedNotice);
      return false;
    }

    const nextBp = getBlueprintById(bp.upgradeToId);
    if (!nextBp) return false;

    const { hasAll } = this.buildCostStatuses(bp.upgradeCosts);
    if (!hasAll) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(UI_TEXT[this.language].buildMissingMaterialsNotice);
      return false;
    }

    if (this.activeWorldType !== 'creative') {
      for (let i = 0; i < bp.upgradeCosts.length; i++) {
        this.inventoryManager.removeItem(bp.upgradeCosts[i].itemId, bp.upgradeCosts[i].count);
      }
      this.emitInventorySnapshot();
    }

    this.world.buildings.applyUpgrade(st.id, nextBp.id);
    this.sound.playBuildUpgrade({ x: st.x, y: st.y, z: st.z });
    this.spawnDustBurst(st.x, st.y + 0.8, st.z, 8);
    this.hasUnsavedProgress = true;
    if (this.multiplayerSessionActive && this.multiplayerService) {
      this.multiplayerService.sendPlayerBuildUpgrade?.(st.id);
    }
    const nextName = this.language === 'ar' ? nextBp.nameAr : nextBp.nameEn;
    this.callbacks.onWorldNotice(UI_TEXT[this.language].buildManageUpgradedNotice(nextName));
    this.emitHud();
    return true;
  }

  public setStructurePermission(structureId: string, scope: BuildingPermissionScope): boolean {
    if (!this.world) return false;
    const st = this.world.buildings.getStructureById(structureId);
    if (!st) return false;
    if (!this.isStructureOwnerOrHost(st)) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(UI_TEXT[this.language].buildPermissionDeniedNotice);
      return false;
    }
    this.world.buildings.setPermissions(st.id, scope);
    this.sound.playUiClick();
    this.hasUnsavedProgress = true;
    if (this.multiplayerSessionActive && this.multiplayerService) {
      this.multiplayerService.sendPlayerBuildPerms?.(st.id, scope);
    }
    this.emitHud();
    return true;
  }

  public demolishStructure(structureId: string): boolean {
    if (!this.world) return false;
    const t = UI_TEXT[this.language];
    const st = this.world.buildings.getStructureById(structureId);
    if (!st) return false;
    if (!this.isStructureOwnerOrHost(st)) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(t.buildPermissionDeniedNotice);
      return false;
    }
    if (st.storageItems && st.storageItems.length > 0) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(t.buildManageDemolishNotEmpty);
      return false;
    }

    const bp = getBlueprintById(st.blueprintId);
    const removed = this.world.buildings.removeStructure(st.id);
    if (!removed) return false;
    this.world.farmAnimals.removeAnimalsForStructure(st.id);

    if (bp && this.activeWorldType !== 'creative') {
      for (let i = 0; i < bp.costs.length; i++) {
        const refundCount = Math.floor(bp.costs[i].count * 0.5);
        if (refundCount > 0 && this.inventoryManager.canAccept(bp.costs[i].itemId, refundCount)) {
          this.inventoryManager.addItem(bp.costs[i].itemId, refundCount);
        }
      }
      this.emitInventorySnapshot();
    }

    this.sound.playObjectRemove({ x: st.x, y: st.y, z: st.z });
    this.spawnDustBurst(st.x, st.y + 0.5, st.z, 8);
    this.hasUnsavedProgress = true;
    if (this.activeManageStructureId === st.id) {
      this.activeManageStructureId = null;
    }
    if (this.activeStorageStructureId === st.id) {
      this.activeStorageStructureId = null;
    }
    if (this.activeFarmStructureId === st.id) {
      this.activeFarmStructureId = null;
    }
    if (this.multiplayerSessionActive && this.multiplayerService) {
      this.multiplayerService.sendPlayerBuildDemolish?.(st.id);
    }
    this.callbacks.onWorldNotice(t.buildDemolishedNotice);
    this.emitHud();
    return true;
  }

  // -------------------------------------------------------------------------
  // Farming, Livestock, Village Development & Expanded Merchant Trade API
  // -------------------------------------------------------------------------
  private getTotalWorldHours(): number {
    return Math.max(
      0,
      (this.timeManager.getDayCount() - 1) * 24 + this.timeManager.getWorldHours(),
    );
  }

  private isCurrentlyRaining(): boolean {
    const state = this.weatherManager.getSnapshot().currentState;
    return state === 'rain' || state === 'storm';
  }

  private isWaterSourceNearby(x: number, z: number, maxDist = 14): boolean {
    if (!this.world) return false;
    return (
      getHydrologyClearance(x, z) <= maxDist ||
      this.world.buildings.isWaterTroughNearby(x, z)
    );
  }

  private findNearestVillageSite(
    x: number,
    z: number,
    maxDist = 260,
  ): VillageSiteRecord | null {
    if (!this.world || this.world.village.villages.length === 0) return null;
    let best: VillageSiteRecord | null = null;
    let bestSq = maxDist * maxDist;
    for (const v of this.world.village.villages) {
      const dSq = (v.centerX - x) * (v.centerX - x) + (v.centerZ - z) * (v.centerZ - z);
      if (dSq <= bestSq) {
        bestSq = dSq;
        best = v;
      }
    }
    return best;
  }

  private getLocalizedVillageDisplayName(village: VillageSiteRecord): string {
    return getLocalizedVillageName(village.id, village.name, this.language);
  }

  private pickSeedForGatheredResource(
    resourceKind: string,
    x: number,
    z: number,
  ): { seedItemId: string; chance: number } | null {
    switch (resourceKind) {
      case 'wheat':
        return { seedItemId: 'wheat-seeds', chance: 0.42 };
      case 'berries':
        return { seedItemId: 'berry-seeds', chance: 0.36 };
      case 'medicinal-herb':
      case 'meadow-herb':
        return { seedItemId: 'herb-seeds', chance: 0.36 };
      case 'flower':
        return { seedItemId: 'carrot-seeds', chance: 0.34 };
      case 'desert-plant':
        return { seedItemId: 'tomato-seeds', chance: 0.32 };
      case 'fiber': {
        const pick = Math.abs(Math.round(x + z)) % 2 === 0 ? 'potato-seeds' : 'corn-seeds';
        return { seedItemId: pick, chance: 0.28 };
      }
      default:
        return null;
    }
  }

  public openFarmPlotModal(structureId: string): boolean {
    if (!this.world) return false;
    const st = this.world.buildings.getStructureById(structureId);
    const bp = st ? getBlueprintById(st.blueprintId) : undefined;
    if (!st || !bp?.isFarmPlot) return false;
    if (!this.canAccessPlayerStructure(st)) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(UI_TEXT[this.language].buildPermissionDeniedNotice);
      return false;
    }
    this.world.buildings.syncAllFarmPlotsByWorldHours(
      this.getTotalWorldHours(),
      this.isCurrentlyRaining(),
    );
    this.activeFarmStructureId = structureId;
    this.sound.playInteract();
    this.callbacks.onOpenFarmPlot?.(structureId);
    return true;
  }

  public getFarmPlotSnapshot(): FarmPlotSnapshot | null {
    if (!this.world || !this.activeFarmStructureId) return null;
    const st = this.world.buildings.getStructureById(this.activeFarmStructureId);
    const bp = st ? getBlueprintById(st.blueprintId) : undefined;
    if (!st || !bp?.isFarmPlot) return null;

    const totalHours = this.getTotalWorldHours();
    const raining = this.isCurrentlyRaining();
    this.world.buildings.syncAllFarmPlotsByWorldHours(totalHours, raining);

    const fs = st.farmState ?? {
      stage: 0,
      growthProgress: 0,
      plantedAtElapsed: this.elapsed,
      soilPrepared: false,
      cropId: null,
      waterLevel: 0,
    };
    const cropId = (fs.cropId as CropId | null | undefined) ?? null;
    const cropDef = cropId ? getCropById(cropId) : undefined;
    const progress = Math.max(0, Math.min(1, fs.growthProgress ?? 0));
    const waterLevel = Math.max(0, Math.min(1, fs.waterLevel ?? 0));
    const fieldScale = bp.id === 'large-farm-field' ? 2 : 1;

    let estimatedHoursRemaining: number | null = null;
    if (cropDef && fs.stage < 3) {
      const rate = raining || waterLevel > 0.08 ? 1 : 0.42;
      estimatedHoursRemaining = Math.max(
        0.1,
        Math.round(((1 - progress) * cropDef.growthWorldHours) / rate * 10) / 10,
      );
    }

    return {
      structureId: st.id,
      blueprintId: bp.id,
      title: this.language === 'ar' ? bp.nameAr : bp.nameEn,
      soilPrepared: Boolean(fs.soilPrepared) || fs.stage >= 1,
      cropId,
      cropName: getCropDisplayName(cropId, this.language),
      stage: fs.stage,
      growthProgress: progress,
      waterLevel,
      isRaining: raining,
      nearWaterSource: this.isWaterSourceNearby(st.x, st.z),
      hasWateringCan: this.inventoryManager.getItemCount('watering-can') > 0,
      hasHoe: this.inventoryManager.getItemCount('wooden-hoe') > 0,
      estimatedHoursRemaining,
      canHarvest: fs.stage >= 3,
      availableSeeds: ALL_CROPS.map((c) => ({
        cropId: c.id,
        seedItemId: c.seedItemId,
        cropName: this.language === 'ar' ? c.nameAr : c.nameEn,
        seedCount: this.inventoryManager.getItemCount(c.seedItemId),
        growthWorldHours: c.growthWorldHours,
        estimatedYield: c.baseYield * fieldScale,
      })),
      isCreativeFree: this.activeWorldType === 'creative',
    };
  }

  public tillFarmPlot(structureId: string): boolean {
    if (!this.world) return false;
    const t = UI_TEXT[this.language];
    const st = this.world.buildings.getStructureById(structureId);
    if (!st) return false;
    if (!this.canAccessPlayerStructure(st)) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(t.buildPermissionDeniedNotice);
      return false;
    }
    const ok = this.world.buildings.prepareFarmSoil(structureId, this.getTotalWorldHours());
    if (!ok) return false;
    this.player?.triggerGatherAnimation('dig', 0.35);
    this.sound.playFarmPlant(st);
    this.spawnDustBurst(st.x, st.y + 0.25, st.z, 5);
    this.hasUnsavedProgress = true;
    if (this.multiplayerSessionActive && this.multiplayerService) {
      this.multiplayerService.sendPlayerFarmTill?.(structureId);
    }
    this.callbacks.onWorldNotice(t.farmTilledNotice);
    this.callbacks.onFarmOrVillageStateChange?.();
    this.emitHud();
    return true;
  }

  public plantFarmSeed(structureId: string, cropId: CropId): boolean {
    if (!this.world) return false;
    const t = UI_TEXT[this.language];
    const st = this.world.buildings.getStructureById(structureId);
    const crop = getCropById(cropId);
    if (!st || !crop) return false;
    if (!this.canAccessPlayerStructure(st)) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(t.buildPermissionDeniedNotice);
      return false;
    }
    const isCreativeFree = this.activeWorldType === 'creative';
    if (!isCreativeFree && this.inventoryManager.getItemCount(crop.seedItemId) < 1) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(t.farmNoSeedsHint);
      return false;
    }

    const ok = this.world.buildings.plantFarmSeed(
      structureId,
      cropId,
      this.getTotalWorldHours(),
      this.isCurrentlyRaining(),
    );
    if (!ok) return false;

    if (!isCreativeFree) {
      this.inventoryManager.removeItem(crop.seedItemId, 1);
      this.emitInventorySnapshot();
    }
    this.player?.triggerGatherAnimation('harvest', 0.35);
    this.sound.playFarmPlant(st);
    this.spawnDustBurst(st.x, st.y + 0.25, st.z, 5);
    this.hasUnsavedProgress = true;
    if (this.multiplayerSessionActive && this.multiplayerService) {
      this.multiplayerService.sendPlayerFarmPlant?.(structureId, cropId);
    } else {
      ProfileManager.recordGameplayDelta({ xpGained: 4 });
    }
    const cropLabel = this.language === 'ar' ? crop.nameAr : crop.nameEn;
    this.callbacks.onWorldNotice(t.farmPlantedNotice(cropLabel));
    this.callbacks.onFarmOrVillageStateChange?.();
    this.emitHud();
    return true;
  }

  public waterFarmPlot(structureId: string): boolean {
    if (!this.world) return false;
    const t = UI_TEXT[this.language];
    const st = this.world.buildings.getStructureById(structureId);
    if (!st) return false;
    if (!this.canAccessPlayerStructure(st)) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(t.buildPermissionDeniedNotice);
      return false;
    }
    const isCreativeFree = this.activeWorldType === 'creative';
    const hasCan = this.inventoryManager.getItemCount('watering-can') > 0;
    const nearWater = this.isWaterSourceNearby(st.x, st.z);
    const raining = this.isCurrentlyRaining();
    if (!isCreativeFree && !hasCan && !nearWater && !raining) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(t.farmWaterNeedsSourceHint);
      return false;
    }
    const ok = this.world.buildings.waterFarmPlot(structureId, this.getTotalWorldHours());
    if (!ok) return false;
    this.sound.playFarmWater(st);
    this.spawnDustBurst(st.x, st.y + 0.35, st.z, 5);
    this.hasUnsavedProgress = true;
    if (this.multiplayerSessionActive && this.multiplayerService) {
      this.multiplayerService.sendPlayerFarmWater?.(structureId);
    }
    this.callbacks.onWorldNotice(t.farmWateredNotice);
    this.callbacks.onFarmOrVillageStateChange?.();
    this.emitHud();
    return true;
  }

  public harvestFarmPlot(structureId: string): boolean {
    if (!this.world) return false;
    const t = UI_TEXT[this.language];
    const st = this.world.buildings.getStructureById(structureId);
    if (!st) return false;
    if (!this.canAccessPlayerStructure(st)) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(t.buildPermissionDeniedNotice);
      return false;
    }
    const stage = st.farmState?.stage ?? 0;
    if (stage < 3) {
      const pct = Math.round((st.farmState?.growthProgress ?? 0) * 100);
      this.sound.playInteract();
      this.callbacks.onWorldNotice(t.buildFarmGrowingNotice(pct));
      return false;
    }

    const cropId = (st.farmState?.cropId as CropId | undefined) ?? 'wheat';
    const cropDef = getCropById(cropId) ?? getCropById('wheat')!;
    const bp = getBlueprintById(st.blueprintId);
    const fieldScale = bp?.id === 'large-farm-field' ? 2 : 1;
    const estimatedQty = Math.max(
      cropDef.baseYield * fieldScale,
      bp?.id === 'large-farm-field' ? bp.farmYieldCount ?? 6 : cropDef.baseYield,
    );
    if (!this.inventoryManager.canAccept(cropDef.harvestItemId, estimatedQty)) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(t.packFullNotice);
      return false;
    }

    const harvested = this.world.buildings.harvestFarmPlot(
      structureId,
      this.elapsed,
      this.getTotalWorldHours(),
    );
    if (!harvested) return false;

    this.player?.triggerGatherAnimation('harvest', 0.42);
    this.sound.playFarmHarvest(st);
    this.sound.playItemPickup('food', st);
    this.spawnDustBurst(st.x, st.y + 0.35, st.z, 7);

    this.inventoryManager.addItem(harvested.itemId, harvested.count);
    let grantedSeeds = 0;
    if (
      harvested.seedCount > 0 &&
      this.inventoryManager.canAccept(harvested.seedItemId, harvested.seedCount)
    ) {
      this.inventoryManager.addItem(harvested.seedItemId, harvested.seedCount);
      grantedSeeds = harvested.seedCount;
    }

    const nearbyVillage = this.findNearestVillageSite(st.x, st.z, 180);
    if (nearbyVillage) {
      const vProg = this.world.villageDev.recordHarvest(nearbyVillage.id, harvested.count);
      if (nearbyVillage.isLoaded) {
        this.world.villageDev.rebuildVillageAddons(nearbyVillage);
      }
      if (vProg.leveledUp) {
        this.sound.playVillageUpgrade(st);
        this.callbacks.onWorldNotice(
          t.villageUpgradeLevelNotice(
            this.getLocalizedVillageDisplayName(nearbyVillage),
            vProg.newLevel,
          ),
        );
      }
    }

    if (this.multiplayerSessionActive && this.multiplayerService) {
      ProfileManager.recordGameplayDelta({ resourcesCollected: 1 });
      this.multiplayerService.sendPlayerFarmHarvest?.(
        structureId,
        harvested.cropId,
        nearbyVillage?.id,
      );
    } else {
      ProfileManager.recordGameplayDelta({ resourcesCollected: 1, xpGained: 8 });
      this.awardXpAndCoins(8, 0);
    }

    this.hasUnsavedProgress = true;
    this.emitInventorySnapshot();
    this.dialogueEngine.quests.update(this.dialogueBridge, (msg) =>
      this.callbacks.onWorldNotice(msg),
    );
    this.storyManager.update(this.storyBridge, (msg) =>
      this.callbacks.onWorldNotice(msg),
    );
    this.sideQuestManager.update(this.sideQuestBridge, (msg) =>
      this.callbacks.onWorldNotice(msg),
    );

    const cropName = this.itemManager.getName(harvested.itemId, this.language);
    const seedName = this.itemManager.getName(harvested.seedItemId, this.language);
    this.callbacks.onWorldNotice(
      t.farmCropHarvestedNotice(cropName, harvested.count, seedName, grantedSeeds),
    );
    this.callbacks.onFarmOrVillageStateChange?.();
    this.emitHud();
    return true;
  }

  public openVillageDevModal(villageId?: string): boolean {
    if (!this.world || !this.controller) return false;
    const target = villageId
      ? this.world.village.villages.find((v) => v.id === villageId) ?? null
      : this.findNearestVillageSite(
          this.controller.position.x,
          this.controller.position.z,
          260,
        );
    if (!target) return false;
    this.activeVillageDevId = target.id;
    this.sound.playInteract();
    this.callbacks.onOpenVillageDev?.(target.id);
    return true;
  }

  public getVillageDevSnapshot(): VillageDevelopmentSnapshot | null {
    if (!this.world || !this.activeVillageDevId) return null;
    const village = this.world.village.villages.find((v) => v.id === this.activeVillageDevId);
    if (!village) return null;
    return this.world.villageDev.buildVillageSnapshot(
      village,
      this.inventoryManager,
      this.activeWorldType === 'creative',
      this.language,
    );
  }

  public completeVillageRepair(villageId: string, repairId: string): boolean {
    if (!this.world) return false;
    const t = UI_TEXT[this.language];
    const village = this.world.village.villages.find((v) => v.id === villageId);
    if (!village) return false;
    const res = this.world.villageDev.completeRepair(
      village,
      repairId,
      this.inventoryManager,
      this.activeWorldType === 'creative',
    );
    if (!res.ok) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(t.buildMissingMaterialsNotice);
      return false;
    }

    this.sound.playBuildRepair(this.controller?.position);
    this.sound.playVillageUpgrade(this.controller?.position);
    this.hasUnsavedProgress = true;
    this.emitInventorySnapshot();

    if (this.multiplayerSessionActive && this.multiplayerService) {
      this.multiplayerService.sendVillageRepair?.(villageId, repairId);
    } else {
      this.awardXpAndCoins(30, res.coinsReward);
      ProfileManager.recordGameplayDelta({ xpGained: 30 });
    }

    const repairDef = VILLAGE_REPAIR_SITES.find((r) => r.id === repairId);
    const repairName = repairDef
      ? this.language === 'ar'
        ? repairDef.nameAr
        : repairDef.nameEn
      : repairId;
    this.callbacks.onWorldNotice(t.villageRepairSuccessNotice(repairName));
    if (res.leveledUp) {
      this.callbacks.onWorldNotice(
        t.villageUpgradeLevelNotice(this.getLocalizedVillageDisplayName(village), res.newLevel),
      );
    }
    this.callbacks.onFarmOrVillageStateChange?.();
    this.emitHud();
    return true;
  }

  public completeVillageProject(villageId: string, projectId: string): boolean {
    if (!this.world) return false;
    const t = UI_TEXT[this.language];
    const village = this.world.village.villages.find((v) => v.id === villageId);
    if (!village) return false;
    const res = this.world.villageDev.completeProject(
      village,
      projectId,
      this.inventoryManager,
      this.activeWorldType === 'creative',
    );
    if (!res.ok) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(t.buildMissingMaterialsNotice);
      return false;
    }

    this.sound.playBuildUpgrade(this.controller?.position);
    this.sound.playVillageUpgrade(this.controller?.position);
    this.hasUnsavedProgress = true;
    this.emitInventorySnapshot();

    if (this.multiplayerSessionActive && this.multiplayerService) {
      this.multiplayerService.sendVillageProject?.(villageId, projectId);
    } else {
      this.awardXpAndCoins(45, 0);
      ProfileManager.recordGameplayDelta({ xpGained: 45 });
    }

    const projectDef = VILLAGE_PROJECTS.find((p) => p.id === projectId);
    const projectName = projectDef
      ? this.language === 'ar'
        ? projectDef.nameAr
        : projectDef.nameEn
      : projectId;
    this.callbacks.onWorldNotice(t.villageProjectSuccessNotice(projectName));
    if (res.leveledUp) {
      this.callbacks.onWorldNotice(
        t.villageUpgradeLevelNotice(this.getLocalizedVillageDisplayName(village), res.newLevel),
      );
    }
    this.callbacks.onFarmOrVillageStateChange?.();
    this.emitHud();
    return true;
  }

  public startVillageDefense(villageId: string): boolean {
    if (!this.world || !this.combat) return false;
    const t = UI_TEXT[this.language];
    const village = this.world.village.villages.find((v) => v.id === villageId);
    if (!village) return false;

    const current = this.world.villageDev.getActiveDefense();
    if (current && current.remainingEnemies > 0) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(t.villageDefenseActiveBadge(current.remainingEnemies));
      return false;
    }

    const spawned = this.combat.spawnVillageDefenseRaiders(
      village.id,
      village.centerX,
      village.centerZ,
      village.clearanceRadius ?? 34,
      3,
      (x, z) => this.world.isInsideVillageClearance(x, z),
      (x, z) => this.world.queryCollidersNear(x, z),
    );
    if (spawned <= 0) {
      this.sound.playBuildError();
      return false;
    }

    this.world.villageDev.startDefense(village.id, spawned);
    this.sound.playInteract();
    this.callbacks.onWorldNotice(
      t.villageDefenseStartedNotice(this.getLocalizedVillageDisplayName(village), spawned),
    );
    this.callbacks.onFarmOrVillageStateChange?.();
    this.emitHud();
    return true;
  }

  public openMerchantTradeModal(npcId: string): boolean {
    if (!this.world || !this.controller) return false;
    const npc = this.world.npcs.npcs.find((n) => n.id === npcId);
    const originX = npc ? npc.position.x : this.controller.position.x;
    const originZ = npc ? npc.position.z : this.controller.position.z;
    const village =
      this.findNearestVillageSite(originX, originZ, 260) ??
      this.world.village.villages[0] ??
      null;
    if (!village) return false;

    this.activeMerchantNpcId = npcId;
    this.activeMerchantVillageId = village.id;
    this.sound.playInteract();
    this.callbacks.onOpenMerchantTrade?.(npcId);
    return true;
  }

  public getMerchantTradeSnapshot(): MerchantTradeSnapshot | null {
    if (!this.world || !this.controller || !this.activeMerchantNpcId) return null;
    const npc = this.world.npcs.npcs.find((n) => n.id === this.activeMerchantNpcId);
    const village =
      (this.activeMerchantVillageId
        ? this.world.village.villages.find((v) => v.id === this.activeMerchantVillageId)
        : null) ??
      this.findNearestVillageSite(this.controller.position.x, this.controller.position.z, 260) ??
      this.world.village.villages[0];
    if (!village) return null;

    const npcName = npc
      ? npc.getLocalizedName(this.language)
      : this.language === 'ar'
        ? 'تاجر القرية'
        : 'Village Merchant';

    return this.world.villageDev.buildMerchantTradeSnapshot(
      this.activeMerchantNpcId,
      npcName,
      village,
      this.inventoryManager,
      this.world.farmAnimals,
      this.world.buildings.getAllStructures(),
      this.controller.position,
      this.playerCoins,
      this.language,
    );
  }

  public buyMerchantOffer(offerId: string): boolean {
    if (!this.world || !this.controller) return false;
    const t = UI_TEXT[this.language];
    const snap = this.getMerchantTradeSnapshot();
    if (!snap) return false;
    const offer = snap.buyOffers.find((o) => o.id === offerId);
    const def = MERCHANT_BUY_CATALOG.find((d) => d.id === offerId);
    if (!offer || !def) return false;

    if (snap.villageLevel < offer.minVillageLevel) {
      this.sound.playBuildError();
      return false;
    }

    if (offer.kind === 'animal' && offer.animalSpecies) {
      const targetPen = this.world.farmAnimals.findNearestPlayerStructureForSpecies(
        this.world.buildings.getAllStructures(),
        this.controller.position.x,
        this.controller.position.z,
        offer.animalSpecies,
        85,
      );
      if (!targetPen) {
        this.sound.playBuildError();
        this.callbacks.onWorldNotice(t.merchantRequiresPenHint);
        return false;
      }
      if (this.playerCoins < offer.finalPriceCoins) {
        this.sound.playBuildError();
        this.callbacks.onWorldNotice(t.merchantNotEnoughCoinsNotice);
        return false;
      }

      const ownerId =
        this.multiplayerSessionActive && this.localMultiplayerPlayerId
          ? this.localMultiplayerPlayerId
          : 'local';
      this.world.farmAnimals.addAnimalToStructure(
        targetPen,
        offer.animalSpecies,
        ownerId,
        this.getTotalWorldHours(),
      );
      this.playerCoins = Math.max(0, this.playerCoins - offer.finalPriceCoins);
      this.world.villageDev.recordTrade(snap.villageId, offer.finalPriceCoins);
      this.sound.playTradeCoin();
      this.sound.playAnimalHappy(targetPen);
      this.hasUnsavedProgress = true;

      if (this.multiplayerSessionActive && this.multiplayerService) {
        this.multiplayerService.sendMerchantBuy?.(snap.villageId, offer.id);
      }

      const animalLabel = getFarmAnimalName(offer.animalSpecies, this.language);
      this.callbacks.onWorldNotice(t.merchantBoughtAnimalNotice(animalLabel));
      this.callbacks.onFarmOrVillageStateChange?.();
      this.emitHud();
      return true;
    }

    if (this.playerCoins < offer.finalPriceCoins) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(t.merchantNotEnoughCoinsNotice);
      return false;
    }
    if (!this.inventoryManager.canAccept(offer.itemId, offer.count)) {
      this.sound.playBuildError();
      this.callbacks.onWorldNotice(t.packFullNotice);
      return false;
    }

    this.playerCoins = Math.max(0, this.playerCoins - offer.finalPriceCoins);
    this.inventoryManager.addItem(offer.itemId, offer.count);
    const vProg = this.world.villageDev.recordTrade(snap.villageId, offer.finalPriceCoins);
    if (vProg.leveledUp) {
      const village = this.world.village.villages.find((v) => v.id === snap.villageId);
      if (village) {
        this.world.villageDev.rebuildVillageAddons(village);
        this.callbacks.onWorldNotice(
          t.villageUpgradeLevelNotice(
            this.getLocalizedVillageDisplayName(village),
            vProg.newLevel,
          ),
        );
      }
    }

    this.sound.playTradeCoin();
    this.hasUnsavedProgress = true;
    this.emitInventorySnapshot();
    if (this.multiplayerSessionActive && this.multiplayerService) {
      this.multiplayerService.sendMerchantBuy?.(snap.villageId, offer.id);
    }

    this.callbacks.onWorldNotice(
      t.merchantBoughtNotice(offer.name, offer.finalPriceCoins),
    );
    this.callbacks.onFarmOrVillageStateChange?.();
    this.emitHud();
    return true;
  }

  public sellMerchantItem(itemId: string, count: number): boolean {
    if (!this.world) return false;
    const t = UI_TEXT[this.language];
    const snap = this.getMerchantTradeSnapshot();
    if (!snap) return false;
    const entry = snap.sellEntries.find((e) => e.itemId === itemId);
    if (!entry || entry.ownedCount < 1) return false;

    const qty = Math.max(1, Math.min(entry.ownedCount, Math.floor(count)));
    const earned = entry.unitSellCoins * qty;
    this.inventoryManager.removeItem(itemId, qty);
    this.playerCoins = Math.min(1_000_000, this.playerCoins + earned);

    const vProg = this.world.villageDev.recordTrade(snap.villageId, earned);
    if (vProg.leveledUp) {
      const village = this.world.village.villages.find((v) => v.id === snap.villageId);
      if (village) {
        this.world.villageDev.rebuildVillageAddons(village);
        this.callbacks.onWorldNotice(
          t.villageUpgradeLevelNotice(
            this.getLocalizedVillageDisplayName(village),
            vProg.newLevel,
          ),
        );
      }
    }

    this.sound.playTradeCoin();
    this.hasUnsavedProgress = true;
    this.emitInventorySnapshot();
    if (this.multiplayerSessionActive && this.multiplayerService) {
      this.multiplayerService.sendMerchantSell?.(snap.villageId, itemId, qty);
    }

    const itemName = this.itemManager.getName(itemId, this.language);
    this.callbacks.onWorldNotice(t.merchantSoldNotice(itemName, qty, earned));
    this.callbacks.onFarmOrVillageStateChange?.();
    this.emitHud();
    return true;
  }

  public canActiveDialogueNpcTrade(): boolean {
    if (!this.activeDialogueNpcId || !this.world) return false;
    const npc = this.world.npcs.npcs.find((n) => n.id === this.activeDialogueNpcId);
    return isMerchantDialogueNpc(this.activeDialogueNpcId, npc?.role);
  }

  public canActiveDialogueNpcManageVillage(): boolean {
    if (!this.activeDialogueNpcId || !this.world) return false;
    const npc = this.world.npcs.npcs.find((n) => n.id === this.activeDialogueNpcId);
    return isVillageStewardNpc(this.activeDialogueNpcId, npc?.role);
  }

  public openTradeFromActiveDialogue(): void {
    const npcId = this.activeDialogueNpcId;
    if (!npcId) return;
    this.endNpcDialogue();
    this.openMerchantTradeModal(npcId);
  }

  public openVillageDevFromActiveDialogue(): void {
    const npcId = this.activeDialogueNpcId;
    if (!npcId || !this.world || !this.controller) return;
    const npc = this.world.npcs.npcs.find((n) => n.id === npcId);
    this.endNpcDialogue();
    const ox = npc ? npc.position.x : this.controller.position.x;
    const oz = npc ? npc.position.z : this.controller.position.z;
    const village =
      this.findNearestVillageSite(ox, oz, 260) ??
      this.findNearestVillageSite(this.controller.position.x, this.controller.position.z, 340) ??
      this.world.village.villages[0];
    if (village) {
      this.openVillageDevModal(village.id);
    }
  }

  private createCombatManager(seed: number): CombatManager {
    return new CombatManager({
      scene: this.scene,
      contactShadowMap: this.textures.contactShadowMap,
      isSoftwareGl: this.isSoftwareGl,
      seed,
      playerMaxHealth: this.controller.getMaxHealth(),
      playerPosition: this.controller.position,
      weaponMount: this.player.getWeaponMount(),
      isVillageClearance: (x, z) => this.world.isInsideVillageClearance(x, z),
      onPlayerDamaged: (result, packet) => {
        const dx = this.controller.position.x - packet.sourcePosition.x;
        const dz = this.controller.position.z - packet.sourcePosition.z;
        const dist = Math.hypot(dx, dz) || 1;
        this.controller.applyCombatDamage(
          result.finalAmount,
          (dx / dist) * packet.knockback,
          (dz / dist) * packet.knockback,
          0.2,
        );
        const hasArmor = this.inventoryManager.getDamageReductionBonus() > 0;
        this.lastCombatEventElapsed = this.elapsed;
        this.sound.playPlayerHurt(hasArmor);
        if (this.multiplayerSessionActive && this.multiplayerService && result.finalAmount > 0) {
          this.multiplayerService.sendGameEvent('player:damage-taken', {
            amount: Math.max(1, Math.round(result.finalAmount)),
            sourceKind: 'enemy',
          });
        }
        this.emitHud();
      },
      onPlayerDefeated: () => {
        this.sound.playPlayerDefeat();
        this.resetPlayerPosition();
        this.combat.resetPlayerAndAggro();
        this.combat.clearVillageDefenseRaiders();
        this.world?.villageDev.cancelDefense();
        if (this.multiplayerSessionActive && this.multiplayerService) {
          this.multiplayerService.sendGameEvent('player:respawn', {});
        }
        this.callbacks.onWorldNotice(UI_TEXT[this.language].playerDefeatedNotice);
        this.emitHud();
      },
      onEnemyHit: (enemy, result) => {
        this.lastCombatEventElapsed = this.elapsed;
        const armored = enemy.archetype.damageReduction >= 0.2;
        const equippedWeapon = this.combat?.getEquippedWeapon()?.stats;
        if (equippedWeapon?.isRanged) {
          this.sound.playArrowImpact(
            armored ? 'armor' : 'enemy',
            enemy.position,
            result.isCrit,
          );
        } else {
          this.sound.playHitImpact(result.isCrit, {
            armored,
            weaponId: equippedWeapon?.id ?? null,
            position: enemy.position,
          });
        }
        this.emitHud();
      },
      onEnemyDefeated: (enemy) => {
        this.sound.playEnemyDefeat(enemy.position);
        if (!this.multiplayerSessionActive) {
          const leveledUp = this.awardXpAndCoins(
            enemy.archetype.xpReward,
            enemy.archetype.coinReward,
          );
          this.recordEnemyKill(enemy.archetype.id, enemy.id);
          ProfileManager.recordGameplayDelta({
            enemiesDefeated: 1,
            xpGained: enemy.archetype.xpReward,
          });
          const t = UI_TEXT[this.language];
          const enemyName =
            this.language === 'ar' ? enemy.archetype.nameAr : enemy.archetype.name;
          const baseMsg = t.enemyDefeatedNotice(
            enemyName,
            enemy.archetype.xpReward,
            enemy.archetype.coinReward,
          );
          this.callbacks.onWorldNotice(
            leveledUp ? `${baseMsg}${t.levelUpSuffix(this.playerLevel)}` : baseMsg,
          );
        }
      },
      onEnemySwing: (enemy) => {
        const enemyWeapon =
          enemy?.archetype?.id === 'stone_sentinel' ? 'battle-axe' : 'ranger-sword';
        this.sound.playWeaponSwing(enemyWeapon, enemy?.position);
        if (
          enemy?.position &&
          !this.multiplayerSessionActive &&
          this.activeWorldType !== 'creative' &&
          this.world?.buildings
        ) {
          const nearStruct = this.world.buildings.getNearestManageableStructure(
            enemy.position.x,
            enemy.position.y,
            enemy.position.z,
            3.1,
          );
          if (nearStruct) {
            const wearDmg = Math.max(4, Math.round((enemy.archetype?.damage ?? 12) * 0.45));
            const dmgRes = this.world.buildings.applyDamage(nearStruct.id, wearDmg);
            if (dmgRes) {
              this.spawnDustBurst(nearStruct.x, nearStruct.y + 0.8, nearStruct.z, dmgRes.destroyed ? 8 : 3);
              if (dmgRes.destroyed) {
                this.sound.playObjectRemove({ x: nearStruct.x, y: nearStruct.y, z: nearStruct.z });
              }
            }
          }
        }
      },
    });
  }

  private wireWorldAndCombatLinks(): void {
    if (!this.world || !this.combat) return;
    this.combat.setWildlifeManager(this.world.wildlife);
    this.combat.setWorldQueryCallbacks({
      isChunkLoaded: (cx, cz) => this.world?.chunkManager.isChunkLoaded(cx, cz) ?? true,
      queryCollidersNear: this.queryCollidersCb,
    });
    this.updateMultiplayerAuthorityMode();
    this.world.npcs.setEnemyCombatProvider(() =>
      this.combat
        ? {
            enemies: this.combat.enemies,
            damageSystem: this.combat.damageSystem,
          }
        : null,
    );
    this.combat.playerHealth.setDamageReduction(
      this.inventoryManager.getDamageReductionBonus(),
    );
    this.combat.setOnPlayerWeaponHit((hitCount) => {
      const res = this.inventoryManager.damageEquippedWeapon(hitCount);
      if (res.damaged) {
        if (res.brokenItemName) {
          this.syncEquippedWeaponFromInventory();
          this.callbacks.onWorldNotice(
            UI_TEXT[this.language].weaponBrokenNotice(res.brokenItemName),
          );
        }
        this.emitInventorySnapshot();
        this.emitHud();
      }
    });
    this.configureCombatMultiplayerCallbacks();
    this.dialogueEngine.quests.setOnQuestCancelled((questId) => {
      this.entityRegistry.markQuestCancelled(questId);
      this.combat?.releaseQuestTargets(questId);
      this.syncAuthoritativeEntities(true);
    });
    this.dialogueEngine.quests.setOnQuestUpdated((questId, status, stepIndex) => {
      if (status === 'completed') {
        this.combat?.releaseQuestTargets(questId);
      } else if (status === 'active') {
        this.entityRegistry.clearQuestCancellation(questId);
      }
      this.questTargetSyncTimer = 1.0;
      this.syncAuthoritativeEntities(true);

      const questDef = getQuestDefinition(questId);
      if (!this.multiplayerSessionActive) {
        if (status === 'completed') {
          ProfileManager.recordGameplayDelta({
            questsCompleted: 1,
            xpGained: 45,
          });
        }
        return;
      }
      if (questDef?.scope === 'cooperative') {
        return;
      }
      if (status === 'completed' && !this.isApplyingRemoteWorldEvent) {
        ProfileManager.recordGameplayDelta({ questsCompleted: 1 });
      }
      if (!this.multiplayerService) return;
      this.multiplayerService.sendGameEvent('QUEST_UPDATED', {
        questId,
        status,
        stepIndex,
      });
    });
    this.combat.setBowWorldCallbacks({
      queryCollidersNear: this.queryCollidersCb,
      onArrowStick: (x, y, z, material) => {
        this.sound.playArrowStick(x, y, z, material ?? 'wood');
      },
      onArrowFly: (x, y, z) => {
        this.sound.playArrowFly({ x, y, z });
      },
      onEnvironmentStrike: (material, x, y, z) => {
        this.sound.playMeleeImpact(material, {
          weaponId: this.combat?.getEquippedWeapon()?.stats.id ?? null,
          position: { x, y, z },
        });
      },
      onHeadshotHit: () => {
        this.callbacks.onWorldNotice(UI_TEXT[this.language].bowHeadshotNotice);
      },
      npcRayTest: (prevPos, nextPos, hitPadding) => {
        const hit = this.world.npcs.rayTestProjectile(prevPos, nextPos, hitPadding);
        if (!hit) return null;
        return {
          id: hit.npc.id,
          role: hit.npc.role,
          isHeadshot: hit.isHeadshot,
          hitPoint: hit.hitPoint,
        };
      },
      onNpcHit: (npcId) => {
        if (!this.controller) return;
        this.world.npcs.reactToArrowHit(
          npcId,
          this.controller.position.x,
          this.controller.position.z,
        );
        this.callbacks.onWorldNotice(UI_TEXT[this.language].bowNpcWarningNotice);
      },
    });
    this.world.wildlife.setCallbacks({
      onAnimalKilled: (animalId, species, position, drops) => {
        if (this.multiplayerSessionActive) {
          if (this.isLocalMultiplayerHost()) {
            for (let i = 0; i < drops.length; i++) {
              const d = drops[i];
              const angle = (i * Math.PI * 2) / Math.max(1, drops.length) + 0.4;
              const offset = drops.length > 1 ? 0.65 : 0;
              const label = this.itemManager.getItem(d.itemId)?.name ?? d.itemId;
              const dropId = `drop_animal_${animalId}_${i}_${Date.now().toString(36)}`;
              const spawned = this.world.spawnWorldPickup(
                position.x + Math.cos(angle) * offset,
                position.z + Math.sin(angle) * offset,
                d.itemId,
                d.quantity,
                label,
                dropId,
                true,
              );
              this.multiplayerService?.sendGameEvent('ITEM_DROPPED', {
                dropId: spawned.id,
                itemId: d.itemId,
                count: d.quantity,
                label,
                x: Math.round(spawned.x * 100) / 100,
                y: Math.round(spawned.y * 100) / 100,
                z: Math.round(spawned.z * 100) / 100,
              });
            }
          }
          return;
        }
        this.sound.playEnemyDefeat(position);
        this.world.spawnAnimalLootDrops(
          position.x,
          position.z,
          drops.map((d) => ({
            itemId: d.itemId,
            count: d.quantity,
            label: this.itemManager.getItem(d.itemId)?.name ?? d.itemId,
          })),
        );
        this.recordEnemyKill(`animal:${species}`, animalId);
        this.awardXpAndCoins(12, 0);
        ProfileManager.recordGameplayDelta({
          animalsDefeated: 1,
          xpGained: 12,
        });
      },
      onPredatorHitPlayer: (_animalId, _species, damage) => {
        if (!this.controller || !this.combat) return;
        if (this.activeWorldType === 'creative' || this.isSleeping) return;
        const res = this.combat.playerHealth.applyDamage(damage, false, false);
        if (!res.applied) return;
        this.controller.applyCombatDamage(res.finalAmount, 0, 0, 0.22);
        this.sound.playPlayerHurt(this.inventoryManager.getDamageReductionBonus() > 0);
        if (this.multiplayerSessionActive && this.multiplayerService && res.finalAmount > 0) {
          this.multiplayerService.sendGameEvent('player:damage-taken', {
            amount: Math.max(1, Math.round(res.finalAmount)),
            sourceKind: 'animal',
          });
        }
        this.emitHud();
        if (res.killed || this.controller.getHealth() <= 0) {
          this.sound.playPlayerDefeat();
          this.resetPlayerPosition();
          this.combat.resetPlayerAndAggro();
          if (this.multiplayerSessionActive && this.multiplayerService) {
            this.multiplayerService.sendGameEvent('player:respawn', {});
          }
          this.callbacks.onWorldNotice(UI_TEXT[this.language].playerDefeatedNotice);
          this.emitHud();
        }
      },
    });
  }

  private rebuildWorldForSeed(seed: number): void {
    if (!this.world || this.world.seed === seed) return;
    if (
      this.multiplayerSessionActive &&
      this.authoritativeMultiplayerConfig &&
      seed !== this.authoritativeMultiplayerConfig.seed
    ) {
      return;
    }
    this.combat?.dispose();
    this.world.dispose();
    this.nearbyInteractable = null;
    this.lastNearbyId = null;

    this.world = new WorldManager(
      this.scene,
      this.textures,
      this.isSoftwareGl,
      seed,
    );
    this.world.npcs.setLanguage(this.language);
    this.world.setDoorAudioCallback((_doorId, isOpen, x, y, z) => {
      this.sound.playDoorState(isOpen, { x, y, z });
    });
    this.world.setBiomeDebugEnabled(this.biomeDebugEnabled);
    this.biomeValidationOk = this.world.validateBiomeMaterialAssignments().valid;
    generateAndRegisterProceduralQuests(
      this.world.seed,
      this.world.village.villages,
      this.world.npcs.npcs,
    );
    if (import.meta.env.DEV && this.worldGenDebugEnabled) {
      this.refreshWorldGenDebugRenderer();
    }
    this.interactables = this.world.interactables;
    this.landmarks = this.world.landmarks;
    this.mapManager.prewarmTerrain(
      this.world.seed,
      this.world.village.site,
      this.getVillageMapEntries(),
    );
    this.combat = this.createCombatManager(this.world.seed);
    this.wireWorldAndCombatLinks();
    this.weatherManager.setSeed(this.world.seed);
  }

  public getSlotDisplayName(slotId: SaveSlotId): string {
    const t = UI_TEXT[this.language];
    if (slotId === 'autosave') return t.saveSlotAutosave;
    if (slotId === 'slot-1') return t.saveSlotManual(1);
    if (slotId === 'slot-2') return t.saveSlotManual(2);
    if (slotId === 'slot-3') return t.saveSlotManual(3);
    return this.activeWorldName || 'World';
  }

  public getSaveSlots(): SaveSlotSummary[] {
    return this.loadManager.listSaveSlots();
  }

  public getSavedWorlds(): SaveGameMeta[] {
    return this.loadManager.listSavedWorlds();
  }

  public hasAnySave(): boolean {
    return this.loadManager.hasAnySave();
  }

  public getMostRecentSaveMeta(): SaveGameMeta | null {
    return this.loadManager.getMostRecentSaveMeta();
  }

  public getHasUnsavedProgress(): boolean {
    return this.hasUnsavedProgress;
  }

  public getActiveWorldMeta(): {
    worldId: string;
    worldName: string;
    worldType: WorldType;
    difficulty: DifficultyLevel;
  } {
    return {
      worldId: this.activeSaveSlot,
      worldName: this.activeWorldName,
      worldType: this.activeWorldType,
      difficulty: this.activeDifficulty,
    };
  }

  public getCurrentFps(): number {
    return this.performanceMonitor.getSmoothedFps();
  }

  private captureWorldThumbnail(): string | undefined {
    if (!this.renderer || !this.scene || !this.camera || this.isSoftwareGl) {
      return undefined;
    }
    try {
      this.renderer.render(this.scene, this.camera);
      const src = this.renderer.domElement;
      if (!src || src.width === 0 || src.height === 0) return undefined;
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 160;
      thumbCanvas.height = 96;
      const ctx = thumbCanvas.getContext('2d');
      if (!ctx) return undefined;
      ctx.drawImage(src, 0, 0, thumbCanvas.width, thumbCanvas.height);
      return thumbCanvas.toDataURL('image/jpeg', 0.72);
    } catch {
      return undefined;
    }
  }

  private captureSaveSource(includeThumbnail = false): SaveSourceState {
    const pos = this.controller.position;
    const camRot = this.controller.getCameraRotation();
    const worldExport = this.world.exportImportantState();

    return {
      worldId: this.activeSaveSlot,
      worldName: this.activeWorldName,
      worldType: this.activeWorldType,
      difficulty: this.activeDifficulty,
      createdAtMs: this.activeWorldCreatedAtMs,
      thumbnailDataUrl: includeThumbnail ? this.captureWorldThumbnail() : undefined,
      playTimeSeconds: this.playTimeSeconds,
      timeLabel: this.timeManager.getTimeOfDayLabel(this.language),
      player: {
        position: {
          x: Math.round(pos.x * 1000) / 1000,
          y: Math.round(pos.y * 1000) / 1000,
          z: Math.round(pos.z * 1000) / 1000,
        },
        rotation: {
          yaw: this.controller.getYaw(),
          cameraYaw: camRot.cameraYaw,
          cameraPitch: camRot.cameraPitch,
        },
        health: this.controller.getHealth(),
        stamina: this.controller.getStamina(),
        staminaIsInfinite: this.activeWorldType === 'creative',
        staminaConfigVersion: STAMINA_CONFIG_VERSION,
        level: this.playerLevel,
        xp: this.playerXp,
        coins: this.playerCoins,
      },
      inventory: this.inventoryManager.exportState(),
      crafting: this.craftingManager.exportState(),
      quests: this.dialogueEngine.quests.exportState(),
      story: this.storyManager.exportState(),
      sideQuests: this.sideQuestManager.exportState(),
      villageDev: this.world.villageDev.exportState(this.world.farmAnimals),
      time: this.timeManager.exportState(),
      weather: this.weatherManager.exportState(),
      world: {
        worldSeed: this.world.seed,
        worldType: this.activeWorldType,
        difficulty: this.activeDifficulty,
        discoveredLandmarkIds: worldExport.discoveredLandmarkIds,
        collectedInteractableIds: worldExport.collectedInteractableIds,
        droppedPickups: worldExport.droppedPickups,
        placedBeds: worldExport.placedBeds,
        placedStations: worldExport.placedStations,
        depletedNodes: worldExport.depletedNodes,
        openedChestIds: worldExport.openedChestIds,
        doorStates: worldExport.doorStates,
        destroyedIds: worldExport.destroyedIds,
        customChanges: worldExport.customChanges,
        killedAnimalIds: this.world.wildlife.exportKilledAnimalIds(),
        dialogueFlags: this.dialogueEngine.exportFlags(),
        defeatedEnemyIds: this.combat.exportDefeatedEnemyIds(),
        questTargets: this.combat.exportQuestTargetState(),
        fogOfWar: this.mapManager.exportFogState(),
        waypoint: this.waypoint ? { ...this.waypoint } : null,
        npcStates: this.world.npcs.exportSaveNpcStates(),
        playerBuildings: worldExport.playerBuildings,
      },
      camera: {
        ...this.cameraSettings,
        perspective:
          this.cameraRig?.getPerspective() ?? this.cameraSettings.perspective,
        sensitivity: this.settings.mouseSensitivity,
        invertY: this.settings.invertY,
      },
      audio: {
        footstepVolume: this.footstepVolume,
      },
    };
  }

  public isMultiplayerSession(): boolean {
    return this.multiplayerSessionActive;
  }

  public saveCurrentWorld(silent = false): boolean {
    if (!this.controller || !this.world || this.multiplayerSessionActive) return false;
    const targetSlot = this.activeSaveSlot || 'slot-1';
    const res = this.saveManager.saveToSlot(
      targetSlot,
      this.captureSaveSource(!silent),
    );
    if (!res.ok) {
      if (!silent) {
        this.callbacks.onWorldNotice(UI_TEXT[this.language].saveFailedNotice);
      }
      return false;
    }
    this.hasUnsavedProgress = false;
    this.unsavedTimer = 0;
    if (!silent) {
      this.sound.playInteract();
      this.callbacks.onWorldNotice(
        UI_TEXT[this.language].savedNotice(this.activeWorldName),
      );
    }
    return true;
  }

  public saveToSlot(slotId: SaveSlotId, silent = false): boolean {
    if (!this.controller || !this.world || this.multiplayerSessionActive) return false;
    const res = this.saveManager.saveToSlot(
      slotId,
      this.captureSaveSource(!silent),
    );
    if (!res.ok) {
      if (!silent) {
        this.callbacks.onWorldNotice(UI_TEXT[this.language].saveFailedNotice);
      }
      return false;
    }
    if (slotId !== 'autosave') {
      this.activeSaveSlot = slotId;
    }
    this.hasUnsavedProgress = false;
    this.unsavedTimer = 0;
    if (!silent) {
      this.sound.playInteract();
      this.callbacks.onWorldNotice(
        UI_TEXT[this.language].savedNotice(this.getSlotDisplayName(slotId)),
      );
    }
    return true;
  }

  public quickSave(): boolean {
    return this.saveCurrentWorld(false);
  }

  public setMultiplayerService(service: IMultiplayerService | null): void {
    this.multiplayerService = service;
  }

  private isLocalMultiplayerHost(): boolean {
    if (!this.multiplayerSessionActive || !this.multiplayerService) return false;
    const room = this.multiplayerService.getRoomState();
    const localId =
      this.localMultiplayerPlayerId ?? this.multiplayerService.getLocalPlayerId();
    return Boolean(room && localId && room.hostId === localId);
  }

  public isMultiplayerHost(): boolean {
    return this.isLocalMultiplayerHost();
  }

  public getWorldSettingsPermission(): WorldSettingsPermission {
    return this.worldSettingsPermission;
  }

  public canControlWorldSettings(): boolean {
    if (!this.multiplayerSessionActive) return true;
    return this.isLocalMultiplayerHost() || this.worldSettingsPermission === 'ALL_PLAYERS';
  }

  public setWorldSettingsPermission(permission: WorldSettingsPermission): void {
    if (
      !this.multiplayerSessionActive ||
      !this.multiplayerService ||
      !this.isLocalMultiplayerHost()
    ) {
      return;
    }
    this.worldSettingsPermission = permission;
    this.multiplayerService.sendWorldSettingsUpdate?.({
      worldSettingsPermission: permission,
    });
    this.emitHud();
  }

  public getPartyState(): PartyStateSnapshot {
    return this.cachedPartyState;
  }

  public async setFriendlyFire(enabled: boolean): Promise<void> {
    if (
      !this.multiplayerSessionActive ||
      !this.multiplayerService ||
      !this.isLocalMultiplayerHost()
    ) {
      return;
    }
    await this.multiplayerService.updateRoomSettings({ friendlyFire: enabled });
    this.emitHud();
  }

  private computeDistanceAndDirection(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
  ): { distanceMeters: number; directionLabel: string } {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const distanceMeters = Math.round(Math.hypot(dx, dz));
    const deg = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
    const labels = CARDINAL_LABELS[this.language];
    const idx = Math.round(deg / 45) % labels.length;
    return {
      distanceMeters,
      directionLabel: labels[idx] ?? 'N',
    };
  }

  private refreshNpcPartyContext(): void {
    if (!this.world) return;
    const party = this.cachedPartyState.party;
    if (!party) {
      this.world.npcs.setPartyContext({
        memberCount: 0,
        activeObjectiveTitle: null,
        memberPositions: [],
      });
      return;
    }
    const posById = new Map<string, { x: number; z: number }>();
    if (this.localMultiplayerPlayerId && this.controller) {
      posById.set(this.localMultiplayerPlayerId, {
        x: this.controller.position.x,
        z: this.controller.position.z,
      });
    }
    for (const pos of this.remotePlayersManager?.getRemotePlayerPositions() ?? []) {
      if (!pos.isDead) {
        posById.set(pos.playerId, { x: pos.x, z: pos.z });
      }
    }
    for (const rp of this.multiplayerService?.getRoomState()?.players ?? []) {
      if (!posById.has(rp.id) && rp.state && !rp.isDead) {
        posById.set(rp.id, { x: rp.state.x, z: rp.state.z });
      }
    }
    const memberPositions: Array<{ playerId: string; x: number; z: number }> = [];
    for (const m of party.members) {
      if (m.online && !m.isDead) {
        const coords = posById.get(m.playerId);
        if (coords) {
          memberPositions.push({ playerId: m.playerId, x: coords.x, z: coords.z });
        }
      }
    }
    this.world.npcs.setPartyContext({
      memberCount: party.members.length,
      activeObjectiveTitle:
        party.activeObjective?.status === 'active' ? party.activeObjective.title : null,
      memberPositions,
    });
  }

  private syncPartyContext(partyState: PartyStateSnapshot): void {
    this.cachedPartyState = partyState;
    const activeParty = partyState.party ?? null;
    this.remotePlayersManager?.setPartyState(activeParty);
    this.dialogueEngine?.quests.setCoopObjective(activeParty?.activeObjective ?? null);
    this.refreshNpcPartyContext();
  }

  private syncMultiplayerCombatTargets(): void {
    if (
      this.multiplayerSessionActive &&
      this.isLocalMultiplayerHost() &&
      this.remotePlayersManager
    ) {
      const remoteTargets = this.remotePlayersManager.getRemoteCombatTargets();
      this.combat?.setMultiplayerTargets(
        this.localMultiplayerPlayerId ?? undefined,
        remoteTargets,
        (enemy, targetPlayerId, damage) => {
          this.multiplayerService?.sendEnemyAttackPlayer?.({
            targetPlayerId,
            sourceKind: 'enemy',
            sourceId: enemy.id,
            archetype: enemy.archetype.id,
            damage: Math.max(1, Math.round(damage)),
            x: Math.round(enemy.position.x * 100) / 100,
            z: Math.round(enemy.position.z * 100) / 100,
          });
        },
      );
      this.world?.wildlife.setMultiplayerTargets(
        this.localMultiplayerPlayerId ?? undefined,
        remoteTargets,
        (animalId, species, damage, targetPlayerId) => {
          const animal = this.world?.wildlife.animals.find((a) => a.id === animalId);
          this.multiplayerService?.sendEnemyAttackPlayer?.({
            targetPlayerId,
            sourceKind: 'animal',
            sourceId: animalId,
            archetype: species,
            damage: Math.max(1, Math.round(damage)),
            ...(animal
              ? {
                  x: Math.round(animal.position.x * 100) / 100,
                  z: Math.round(animal.position.z * 100) / 100,
                }
              : {}),
          });
        },
      );
    } else {
      this.combat?.setMultiplayerTargets(undefined, []);
      this.world?.wildlife.setMultiplayerTargets(undefined, []);
    }
  }

  private updateMultiplayerAuthorityMode(): void {
    const isHost = this.isLocalMultiplayerHost();
    const remoteControlled = this.multiplayerSessionActive && !isHost;
    this.world?.npcs.setNetworkRemoteControlled(remoteControlled);
    this.world?.wildlife.setNetworkRemoteControlled(remoteControlled);
    this.combat?.setNetworkRemoteControlled(remoteControlled);
    if (this.multiplayerSessionActive && !isHost) {
      this.weatherManager.setDynamicEnabled(false);
    }
    this.syncMultiplayerCombatTargets();
  }

  private teardownMultiplayerSync(): void {
    this.unsubscribeMultiplayer?.();
    this.unsubscribeMultiplayer = null;
    this.remotePlayersManager?.dispose();
    this.remotePlayersManager = null;
    this.localMultiplayerPlayerId = null;
    this.localNetworkEntityId = null;
    this.worldSettingsPermission = 'HOST_ONLY';
    this.mpSyncTimer = 0;
    this.mpKeepaliveTimer = 0;
    this.mpEntitySyncTimer = 0;
    this.mpWeatherTimeHeartbeatTimer = 0;
    this.mpOutboundSeq = 0;
    this.mpLastSentDigest = '';
    this.mpPendingShootFlag = false;
    this.mpPendingAnimState = undefined;
    this.lastSyncedWeatherState = '';
    this.lastInteractedBed = null;
    this.hasAppliedInitialSpawnSnapshot = false;
    this.cachedPartyState = { party: null, pendingInvites: [], outgoingInvites: [] };
    this.lastFriendlyFireNoticeAtMs = 0;
    this.lastCoopProximityReportMs = 0;
    this.lastNpcPartySyncAtMs = 0;
    this.dialogueEngine?.quests.setCoopObjective(null);
    this.world?.npcs.setPartyContext({
      memberCount: 0,
      activeObjectiveTitle: null,
      memberPositions: [],
    });
    this.persistedContainers.clear();
    this.persistedBuildingStates.clear();
    this.persistedQuestObjects.clear();
    this.appliedLootGrantIds.clear();
    this.activeBossEncounters.clear();
    this.activeDialogueNpcId = null;
    this.dialogueEngine?.quests.setLocalPlayerId(null);
    this.updateMultiplayerAuthorityMode();
    this.combat?.setMultiplayerCallbacks({ multiplayerAuthoritative: false });
  }

  private configureCombatMultiplayerCallbacks(): void {
    this.combat?.setMultiplayerCallbacks({
      multiplayerAuthoritative: this.multiplayerSessionActive,
      npcStrikeTest: (origin, forwardDir, range, minCos) =>
        this.world.npcs
          .findNpcsInStrikeArc(origin, forwardDir, range, minCos)
          .map((n) => ({
            id: n.id,
            role: n.role,
            position: n.position,
            hitHeight: n.getHitHeight(),
          })),
      playerStrikeTest: (origin, forwardDir, range, minCos) => {
        if (!this.multiplayerSessionActive || !this.remotePlayersManager) return [];
        const room = this.multiplayerService?.getRoomState();
        const friendlyFireOn = Boolean(room?.worldSettings?.friendlyFire);
        const pvpEnabled = Boolean(room?.worldSettings?.pvpEnabled);
        const playersById = new Map<string, MultiplayerPlayer>();
        for (const p of room?.players ?? []) {
          playersById.set(p.id, p);
        }
        const results: Array<{
          playerId: string;
          displayName: string;
          position: THREE.Vector3;
          hitHeight: number;
        }> = [];
        for (const target of this.remotePlayersManager.getRemoteCombatTargets()) {
          if (!target.isAlive) continue;
          const dx = target.position.x - origin.x;
          const dz = target.position.z - origin.z;
          const dy = target.position.y - origin.y;
          const distSq = dx * dx + dz * dz;
          const maxR = range + 0.52;
          if (distSq > maxR * maxR || Math.abs(dy) > 2.3) continue;
          const horizLen = Math.sqrt(distSq);
          if (horizLen > 0.0001) {
            const dot = (dx / horizLen) * forwardDir.x + (dz / horizLen) * forwardDir.z;
            if (horizLen > 0.9 && dot < minCos) continue;
          }
          if (target.isPartyMember) {
            if (!friendlyFireOn) {
              const nowMs = Date.now();
              if (nowMs - this.lastFriendlyFireNoticeAtMs > 2200) {
                this.lastFriendlyFireNoticeAtMs = nowMs;
                this.callbacks.onWorldNotice(
                  UI_TEXT[this.language].partyFriendlyFireBlockedNotice,
                );
              }
              continue;
            }
          } else if (!pvpEnabled) {
            continue;
          }
          results.push({
            playerId: target.playerId,
            displayName: playersById.get(target.playerId)?.displayName ?? 'Player',
            position: target.position,
            hitHeight: 1.85,
          });
        }
        return results;
      },
      playerRayTest: (prevPos, nextPos, hitPadding = 0.25) => {
        if (!this.multiplayerSessionActive || !this.remotePlayersManager) return null;
        const room = this.multiplayerService?.getRoomState();
        const friendlyFireOn = Boolean(room?.worldSettings?.friendlyFire);
        const pvpEnabled = Boolean(room?.worldSettings?.pvpEnabled);
        const segX = nextPos.x - prevPos.x;
        const segY = nextPos.y - prevPos.y;
        const segZ = nextPos.z - prevPos.z;
        const segLenSq = segX * segX + segY * segY + segZ * segZ;
        if (segLenSq < 1e-8) return null;

        let bestT = 2;
        let bestHit: {
          playerId: string;
          isHeadshot: boolean;
          hitPoint: THREE.Vector3;
        } | null = null;
        let blockedParty = false;

        for (const target of this.remotePlayersManager.getRemoteCombatTargets()) {
          if (!target.isAlive) continue;
          const radius = 0.45 + hitPadding;
          const toCenterX = target.position.x - prevPos.x;
          const toCenterZ = target.position.z - prevPos.z;
          const horizLenSq = segX * segX + segZ * segZ;
          const rawT =
            horizLenSq > 1e-7
              ? (toCenterX * segX + toCenterZ * segZ) / horizLenSq
              : 0;
          const t = Math.max(0, Math.min(1, rawT));
          if (t >= bestT) continue;
          const closestX = prevPos.x + segX * t;
          const closestY = prevPos.y + segY * t;
          const closestZ = prevPos.z + segZ * t;
          const dx = closestX - target.position.x;
          const dz = closestZ - target.position.z;
          if (dx * dx + dz * dz > radius * radius) continue;
          const minY = target.position.y - hitPadding * 0.5;
          const maxY = target.position.y + 1.85 + hitPadding;
          if (closestY < minY || closestY > maxY) continue;

          if (target.isPartyMember && !friendlyFireOn) {
            blockedParty = true;
            continue;
          }
          if (!target.isPartyMember && !pvpEnabled) {
            continue;
          }
          bestT = t;
          bestHit = {
            playerId: target.playerId,
            isHeadshot: closestY >= target.position.y + 1.38,
            hitPoint: new THREE.Vector3(closestX, closestY, closestZ),
          };
        }
        if (!bestHit && blockedParty) {
          const nowMs = Date.now();
          if (nowMs - this.lastFriendlyFireNoticeAtMs > 2200) {
            this.lastFriendlyFireNoticeAtMs = nowMs;
            this.callbacks.onWorldNotice(
              UI_TEXT[this.language].partyFriendlyFireBlockedNotice,
            );
          }
        }
        return bestHit;
      },
      onMultiplayerMeleeHit: (hit) => {
        if (!this.multiplayerSessionActive || !this.multiplayerService) return;
        this.multiplayerService.sendGameEvent('COMBAT_HIT', {
          ...(hit.attackId ? { attackId: hit.attackId } : {}),
          weaponId: hit.weaponId,
          targetKind: hit.targetKind,
          targetId: hit.targetId,
          archetype: hit.archetype,
          x: Math.round(hit.x * 100) / 100,
          y: Math.round(hit.y * 100) / 100,
          z: Math.round(hit.z * 100) / 100,
          isCrit: hit.isCrit,
        });
      },
      onMultiplayerArrowFired: (shot) => {
        if (!this.multiplayerSessionActive || !this.multiplayerService) return;
        this.multiplayerService.sendGameEvent('ARROW_FIRED', {
          arrowId: shot.arrowId,
          weaponId: shot.weaponId,
          originX: Math.round(shot.originX * 1000) / 1000,
          originY: Math.round(shot.originY * 1000) / 1000,
          originZ: Math.round(shot.originZ * 1000) / 1000,
          dirX: Math.round(shot.dirX * 1000) / 1000,
          dirY: Math.round(shot.dirY * 1000) / 1000,
          dirZ: Math.round(shot.dirZ * 1000) / 1000,
          bowCharge: Math.round(shot.bowCharge * 100) / 100,
        });
      },
      onMultiplayerProjectileHit: (hit) => {
        if (!this.multiplayerSessionActive || !this.multiplayerService) return;
        this.multiplayerService.sendGameEvent('PROJECTILE_HIT', {
          arrowId: hit.arrowId,
          targetKind: hit.targetKind,
          targetId: hit.targetId,
          ...(hit.archetype ? { archetype: hit.archetype } : {}),
          x: Math.round(hit.x * 1000) / 1000,
          y: Math.round(hit.y * 1000) / 1000,
          z: Math.round(hit.z * 1000) / 1000,
          isHeadshot: hit.isHeadshot,
        });
      },
    });
  }

  private setupMultiplayerSync(
    players: MultiplayerPlayer[],
    localPlayerId: string | null,
  ): void {
    this.teardownMultiplayerSync();
    if (!this.scene || !this.textures) return;

    this.localMultiplayerPlayerId = localPlayerId;
    this.dialogueEngine?.quests.setLocalPlayerId(localPlayerId);
    this.localNetworkEntityId = localPlayerId
      ? generateNetworkEntityId(localPlayerId)
      : null;
    if (this.player && this.localNetworkEntityId) {
      this.player.root.userData.networkEntityId = this.localNetworkEntityId;
    }

    this.remotePlayersManager = new RemotePlayersManager(
      this.scene,
      this.textures.contactShadowMap,
      this.isSoftwareGl,
    );
    this.remotePlayersManager.setShowPlayerNames(this.showPlayerNamesSetting);
    this.remotePlayersManager.syncRoster(players, localPlayerId);
    const initialPartyState = this.multiplayerService?.getPartyState?.() ?? {
      party: null,
      pendingInvites: [],
      outgoingInvites: [],
    };
    this.syncPartyContext(initialPartyState);
    this.configureCombatMultiplayerCallbacks();
    this.updateMultiplayerAuthorityMode();
    this.lastSyncedWeatherState = this.weatherManager.getSnapshot().currentState;

    if (!this.multiplayerService) return;
    this.unsubscribeMultiplayer = this.multiplayerService.subscribe((ev) => {
      if (!this.multiplayerSessionActive) return;

      if (ev.type === 'player-state') {
        this.remotePlayersManager?.pushPlayerState(ev.playerId, ev.state);
      } else if (ev.type === 'game-event') {
        this.remotePlayersManager?.handleGameEvent(ev.playerId, ev.payload);
        this.handleRemoteMultiplayerGameEvent(ev.playerId, ev.payload);
      } else if (ev.type === 'entity-sync') {
        this.applyRemoteEntitySync(ev.payload);
      } else if (ev.type === 'world-snapshot') {
        this.applyRemoteWorldSnapshot(ev.snapshot);
      } else if (ev.type === 'connection-changed') {
        if (ev.state === 'connected') {
          this.syncLocalMultiplayerState(0.05, true);
        }
      } else if (ev.type === 'host-transferred') {
        this.updateMultiplayerAuthorityMode();
      } else if (ev.type === 'room-updated') {
        if (!ev.room) {
          this.teardownMultiplayerSync();
        } else {
          if (ev.room.worldSettingsPermission) {
            this.worldSettingsPermission = ev.room.worldSettingsPermission;
          }
          this.remotePlayersManager?.syncRoster(
            ev.room.players,
            this.localMultiplayerPlayerId,
          );
          this.remotePlayersManager?.setPartyState(this.cachedPartyState.party);
          this.refreshNpcPartyContext();
          this.updateMultiplayerAuthorityMode();
        }
      } else if (ev.type === 'party-updated') {
        this.syncPartyContext(ev.partyState);
        this.emitHud();
      } else if (ev.type === 'party-invite-received') {
        this.sound.playUiClick();
        this.callbacks.onWorldNotice(
          UI_TEXT[this.language].partyInviteReceivedNotice(ev.invite.fromPlayerName),
        );
      } else if (ev.type === 'party-objective-updated') {
        const wasNew =
          ev.objective.status === 'active' &&
          this.cachedPartyState.party?.activeObjective?.objectiveId !== ev.objective.objectiveId;
        if (
          this.cachedPartyState.party &&
          this.cachedPartyState.party.partyId === ev.objective.partyId
        ) {
          this.cachedPartyState = {
            ...this.cachedPartyState,
            party: {
              ...this.cachedPartyState.party,
              activeObjective: ev.objective,
            },
          };
        }
        this.dialogueEngine?.quests.setCoopObjective(ev.objective);
        this.refreshNpcPartyContext();
        if (wasNew) {
          this.callbacks.onWorldNotice(
            UI_TEXT[this.language].coopObjectiveStartedNotice(ev.objective.title),
          );
        }
        this.emitHud();
      } else if (ev.type === 'party-objective-completed') {
        if (
          this.cachedPartyState.party &&
          this.cachedPartyState.party.partyId === ev.objective.partyId
        ) {
          this.cachedPartyState = {
            ...this.cachedPartyState,
            party: {
              ...this.cachedPartyState.party,
              activeObjective: ev.objective,
            },
          };
        }
        this.dialogueEngine?.quests.setCoopObjective(ev.objective);
        this.refreshNpcPartyContext();
        this.sound.playInteract();
        const myReward = this.localMultiplayerPlayerId
          ? ev.objective.rewardsByPlayer[this.localMultiplayerPlayerId]
          : undefined;
        this.callbacks.onWorldNotice(
          UI_TEXT[this.language].coopObjectiveCompletedNotice(
            ev.objective.title,
            myReward?.xp ?? 0,
            myReward?.coins ?? 0,
          ),
        );
        this.emitHud();
      } else if (ev.type === 'progression-updated') {
        if (ev.progression.playerId === this.localMultiplayerPlayerId) {
          const prevLevel = this.playerLevel;
          const prevXp = this.playerXp;
          const nextXp = Math.max(0, ev.progression.xp);
          this.playerCoins = Math.max(0, ev.progression.coins);
          this.playerXp = nextXp;
          this.playerLevel = Math.max(1, ev.progression.level);
          if (
            ev.progression.reason !== 'start_game' &&
            ev.progression.reason !== 'reconnect'
          ) {
            const xpDelta =
              this.playerLevel > prevLevel
                ? Math.max(1, nextXp + (prevLevel * 100 - prevXp))
                : Math.max(0, nextXp - prevXp);
            if (xpDelta > 0) {
              ProfileManager.recordGameplayDelta({ xpGained: xpDelta });
            }
          }
          if (
            this.playerLevel > prevLevel &&
            ev.progression.reason !== 'start_game' &&
            ev.progression.reason !== 'reconnect'
          ) {
            this.callbacks.onWorldNotice(
              `${UI_TEXT[this.language].profileStatLevel} ${this.playerLevel}!`,
            );
          }
          this.emitHud();
        }
      } else if (ev.type === 'world-time-changed') {
        this.isApplyingRemoteTimeWeather = true;
        try {
          this.timeManager.syncFromServer(ev.worldTime, ev.serverTimestamp);
          this.syncWorldTimeImmediate();
          this.emitHud();
        } finally {
          this.isApplyingRemoteTimeWeather = false;
        }
      } else if (ev.type === 'world-day-changed') {
        this.isApplyingRemoteTimeWeather = true;
        try {
          this.timeManager.restoreState({
            ...this.timeManager.exportState(),
            dayCount: ev.dayCount,
            worldHours: ev.worldHours,
          });
          this.syncWorldTimeImmediate();
          this.emitHud();
        } finally {
          this.isApplyingRemoteTimeWeather = false;
        }
      } else if (ev.type === 'world-time-scale-changed') {
        this.isApplyingRemoteTimeWeather = true;
        try {
          this.timeManager.syncFromServer(ev.worldTime, ev.serverTimestamp);
          this.syncWorldTimeImmediate();
          this.emitHud();
        } finally {
          this.isApplyingRemoteTimeWeather = false;
        }
      } else if (ev.type === 'world-weather-changed') {
        this.isApplyingRemoteTimeWeather = true;
        try {
          this.weatherManager.syncFromServer(
            ev.worldWeather,
            ev.serverTimestamp,
            Boolean(ev.triggerLightning),
          );
          this.lastSyncedWeatherState = this.weatherManager.getSnapshot().currentState;
          this.syncWorldTimeImmediate();
          this.emitHud();
        } finally {
          this.isApplyingRemoteTimeWeather = false;
        }
      } else if (ev.type === 'world-weather-intensity-changed') {
        this.isApplyingRemoteTimeWeather = true;
        try {
          this.weatherManager.syncFromServer(ev.worldWeather, ev.serverTimestamp, false);
          this.syncWorldTimeImmediate();
          this.emitHud();
        } finally {
          this.isApplyingRemoteTimeWeather = false;
        }
      } else if (ev.type === 'world-settings-updated') {
        this.isApplyingRemoteTimeWeather = true;
        try {
          this.worldSettingsPermission = ev.worldSettingsPermission;
          this.timeManager.syncFromServer(ev.worldTime, ev.serverTimestamp);
          this.weatherManager.syncFromServer(
            ev.worldWeather,
            ev.serverTimestamp,
            Boolean(ev.triggerLightning),
          );
          this.lastSyncedWeatherState = this.weatherManager.getSnapshot().currentState;
          this.syncWorldTimeImmediate();
          this.emitHud();
        } finally {
          this.isApplyingRemoteTimeWeather = false;
        }
      } else if (ev.type === 'player-vitals') {
        if (ev.vitals.playerId === this.localMultiplayerPlayerId) {
          if (this.controller && this.combat) {
            const prevHealth = this.controller.getHealth();
            this.controller.syncAuthoritativeHealth(ev.vitals.health);
            this.combat.syncPlayerStats(ev.vitals.health, ev.vitals.maxHealth);
            if (ev.vitals.health < prevHealth - 0.5 && !this.isLocalMultiplayerHost()) {
              this.sound.playPlayerHurt(this.inventoryManager.getDamageReductionBonus() > 0);
            }
            if (ev.vitals.isDead) {
              this.sound.playPlayerDefeat();
              this.resetPlayerPosition();
              this.combat.resetPlayerAndAggro();
              this.multiplayerService?.sendGameEvent('player:respawn', {});
              this.callbacks.onWorldNotice(
                UI_TEXT[this.language].playerDefeatedNotice,
              );
            }
            this.emitHud();
          }
        } else {
          this.remotePlayersManager?.applyVitals(ev.vitals);
          this.syncMultiplayerCombatTargets();
        }
      } else if (ev.type === 'coop-quest-updated') {
        const cq = ev.coopQuest;
        const prev = this.dialogueEngine?.quests.getCoopQuestState(cq.questId);
        this.dialogueEngine?.quests.applyCoopQuestState(cq);
        const def = getQuestDefinition(cq.questId);
        const qTitle =
          this.language === 'ar'
            ? (def?.titleAr ?? def?.title ?? cq.questId)
            : (def?.title ?? cq.questId);
        if (!prev && cq.status === 'active') {
          this.callbacks.onWorldNotice(
            UI_TEXT[this.language].coopQuestStartedNotice(qTitle),
          );
        } else if (prev?.status !== 'completed' && cq.status === 'completed') {
          this.sound.playInteract();
          this.callbacks.onWorldNotice(
            UI_TEXT[this.language].coopQuestCompletedNotice(qTitle),
          );
        }
        this.emitHud();
      } else if (ev.type === 'boss-state-updated') {
        const boss = ev.boss;
        this.activeBossEncounters.set(boss.bossId, boss);
        if (this.combat && !this.isLocalMultiplayerHost()) {
          this.combat.applyAuthoritativeEnemyDamage(
            boss.bossId,
            boss.hp,
            boss.maxHp,
            boss.isDead,
            undefined,
            undefined,
            boss.targetPlayerId ?? undefined,
          );
          this.combat.applySyncDeltas([
            {
              id: boss.bossId,
              kind: 'enemy',
              archetype: boss.archetype,
              x: boss.x,
              y: boss.y,
              z: boss.z,
              yaw: boss.yaw,
              state: boss.state,
              hp: boss.hp,
              maxHp: boss.maxHp,
              isDead: boss.isDead,
              isBoss: true,
              bossPhase: boss.phase,
              attackState: boss.attackState,
              targetPlayerId: boss.targetPlayerId ?? undefined,
            },
          ]);
        }
        this.emitHud();
      } else if (ev.type === 'loot-granted') {
        const loot = ev.loot;
        if (this.appliedLootGrantIds.has(loot.grantId)) return;
        this.appliedLootGrantIds.add(loot.grantId);
        if (this.appliedLootGrantIds.size > 300) {
          const oldest = this.appliedLootGrantIds.values().next();
          if (!oldest.done) this.appliedLootGrantIds.delete(oldest.value);
        }
        const t = UI_TEXT[this.language];
        const parts: string[] = [];
        if (loot.xp > 0) parts.push(`+${loot.xp} ${t.xpShort}`);
        if (loot.coins > 0) parts.push(`+${loot.coins} ${t.coinsLabel}`);
        const shouldAddItems = loot.sourceKind !== 'quest';
        let itemsAdded = false;
        for (const item of loot.items) {
          if (!item.itemId || item.count <= 0) continue;
          if (shouldAddItems && this.itemManager.getItem(item.itemId)) {
            this.inventoryManager.addItem(item.itemId, item.count);
            itemsAdded = true;
          }
          parts.push(`${item.count}x ${this.itemManager.getName(item.itemId, this.language)}`);
        }
        if (itemsAdded) {
          this.emitInventorySnapshot();
        }
        if (parts.length > 0) {
          this.sound.playItemPickup(
            loot.coins > 0 && loot.items.length === 0 ? 'coins' : 'quest',
          );
          this.callbacks.onWorldNotice(t.lootGrantedNotice(parts.join(' · ')));
        }
        this.emitHud();
      } else if (ev.type === 'position-correction') {
        if (this.controller) {
          this.controller.applyAuthoritativePositionCorrection(
            ev.correction.x,
            ev.correction.y,
            ev.correction.z,
          );
          this.emitHud();
        }
      } else if (ev.type === 'error') {
        if (ev.code === 'NO_AMMO' && this.activeWorldType !== 'creative') {
          this.reconcileLocalArrowCount(0);
          this.sound.playBowEmpty();
          this.callbacks.onWorldNotice(UI_TEXT[this.language].bowNoArrowsNotice);
        } else if (ev.code === 'FORBIDDEN_WORLD_SETTINGS') {
          this.callbacks.onWorldNotice(
            UI_TEXT[this.language].mpWorldSettingsHostOnlyNotice,
          );
        } else if (ev.code === 'FRIENDLY_FIRE_DISABLED') {
          this.callbacks.onWorldNotice(
            UI_TEXT[this.language].partyFriendlyFireBlockedNotice,
          );
        } else if (ev.code === 'DUPLICATE_PARTY_INVITE') {
          this.callbacks.onWorldNotice(
            UI_TEXT[this.language].partyDuplicateInviteNotice,
          );
        } else if (ev.code === 'PARTY_FULL') {
          this.callbacks.onWorldNotice(UI_TEXT[this.language].partyFullNotice);
        } else if (
          ev.code === 'WEAPON_NOT_OWNED' ||
          ev.code === 'CHEST_ALREADY_OPENED' ||
          ev.code === 'ALREADY_COLLECTED' ||
          ev.code === 'RESOURCE_DEPLETED' ||
          ev.code === 'INSUFFICIENT_COINS' ||
          ev.code === 'ROOM_EXPIRED' ||
          ev.code === 'FORBIDDEN_PARTY_LEADER' ||
          ev.code === 'TARGET_NOT_IN_ROOM' ||
          ev.code === 'PLAYER_ALREADY_IN_PARTY'
        ) {
          this.callbacks.onWorldNotice(ev.message);
        }
      }
    });
  }

  private reconcileLocalArrowCount(targetCount: number): void {
    if (this.activeWorldType === 'creative') return;
    const clamped = Math.max(0, Math.round(targetCount));
    const current = this.inventoryManager.getItemCount('arrow');
    if (clamped < current) {
      this.inventoryManager.removeItem('arrow', current - clamped);
      this.emitInventorySnapshot();
      this.emitHud();
    } else if (clamped > current) {
      this.inventoryManager.addItem('arrow', clamped - current);
      this.emitInventorySnapshot();
      this.emitHud();
    }
  }

  private resolveAttackerCoords(
    playerId: string | undefined,
    fallbackX?: number,
    fallbackZ?: number,
  ): { x?: number; z?: number } {
    if (playerId && playerId === this.localMultiplayerPlayerId && this.controller) {
      return { x: this.controller.position.x, z: this.controller.position.z };
    }
    if (playerId && this.multiplayerService) {
      const p = this.multiplayerService
        .getRoomState()
        ?.players.find((pl) => pl.id === playerId);
      if (p?.state) {
        return { x: p.state.x, z: p.state.z };
      }
    }
    return { x: fallbackX, z: fallbackZ };
  }

  private isValidWeatherState(val: string): val is WeatherState {
    return (
      val === 'clear' ||
      val === 'cloudy' ||
      val === 'overcast' ||
      val === 'rain' ||
      val === 'storm' ||
      val === 'fog'
    );
  }

  private applyRemoteWorldSnapshot(snap: RoomWorldSnapshotPayload): void {
    if (!this.world || !this.combat) return;
    this.isApplyingRemoteWorldEvent = true;
    this.isApplyingRemoteTimeWeather = true;
    try {
      for (const chestId of snap.openedChests) {
        this.world.markChestOpenedRemote(chestId);
      }
      for (const pickupId of snap.collectedPickups) {
        this.world.markPickupCollectedRemote(pickupId);
      }
      const nowMs = Date.now();
      for (const r of snap.depletedResources) {
        const remainSec = Math.max(0, (r.regenAtMs - nowMs) / 1000);
        this.world.applyResourceNodeState(
          r.id,
          r.usesRemaining,
          r.usesRemaining <= 0,
          this.elapsed + remainSec,
        );
      }
      for (const door of snap.doors) {
        this.world.setDoorOpen(door.id, door.isOpen);
      }
      for (const bed of snap.placedBeds) {
        if (!this.world.interactables.some((it) => it.id === bed.id)) {
          this.world.placeBedAt(bed.x, bed.z, bed.yaw, bed.id);
        }
      }
      for (const st of snap.placedStations ?? []) {
        if (!this.world.interactables.some((it) => it.id === st.id)) {
          this.world.placeStationAt(st.stationType, st.x, st.z, st.yaw, st.id);
        }
      }
      if (Array.isArray(snap.playerBuildings)) {
        const hydrated: SavedPlayerBuilding[] = snap.playerBuildings.map((b) => ({
          id: b.id,
          blueprintId: b.blueprintId,
          x: b.x,
          y: b.y,
          z: b.z,
          yaw: b.yaw,
          health: b.structureHp,
          maxHealth: b.maxStructureHp,
          ownerId: b.ownerId,
          ownerName: b.ownerName,
          permission: b.permissionScope,
          createdAtMs: b.createdAtMs,
          ...(b.doorOpen !== undefined ? { doorOpen: b.doorOpen } : {}),
          ...(b.storageItems ? { storageItems: b.storageItems.map((it) => ({ ...it })) } : {}),
          ...(b.farmStage !== undefined
            ? {
                farmState: {
                  stage: b.farmStage,
                  growthProgress: b.farmProgress ?? 0,
                  plantedAtElapsed: this.elapsed,
                  soilPrepared: b.farmSoilPrepared ?? b.farmStage >= 1,
                  cropId: b.farmCropId ?? null,
                  waterLevel: b.farmWaterLevel ?? 0,
                  lastUpdatedWorldHours: this.getTotalWorldHours(),
                },
              }
            : {}),
        }));
        this.world.buildings.restoreSavedBuildings(
          hydrated,
          this.world.chunkManager.getActiveChunkKeys(),
        );
      }
      if (Array.isArray(snap.villagesDev)) {
        for (const vSync of snap.villagesDev as VillageDevelopmentSyncRecord[]) {
          const rec = this.world.villageDev.getOrCreateRecord(vSync.villageId);
          rec.progressXp = vSync.progressXp;
          rec.level = this.world.villageDev.computeLevelForXp(vSync.progressXp);
          rec.reputationPoints = vSync.reputationPoints;
          rec.completedRepairIds = [...vSync.completedRepairIds];
          rec.completedProjectIds = [...vSync.completedProjectIds];
          rec.cropsHarvestedCount = vSync.cropsHarvestedCount;
          rec.tradesCompletedCount = vSync.tradesCompletedCount;
          rec.defensesWonCount = vSync.defensesWonCount;
          const site = this.world.village.villages.find((v) => v.id === vSync.villageId);
          if (site?.isLoaded) {
            this.world.villageDev.rebuildVillageAddons(site);
          }
        }
        this.callbacks.onFarmOrVillageStateChange?.();
      }
      for (const drop of snap.droppedItems) {
        if (!this.world.interactables.some((it) => it.id === drop.id)) {
          this.world.spawnWorldPickup(
            drop.x,
            drop.z,
            drop.itemId,
            drop.count,
            drop.label,
            drop.id,
            true,
          );
        }
      }
      for (const lmId of snap.discoveredLandmarks) {
        const lm = this.landmarks.find((l) => l.id === lmId);
        if (lm && !lm.discovered) {
          lm.discovered = true;
          this.mapManager.revealAround(lm.x, lm.z, 95);
        }
      }
      for (const q of snap.quests) {
        if (getQuestDefinition(q.questId)?.scope === 'cooperative') continue;
        if (q.questId.startsWith('sq-')) {
          this.sideQuestManager.applyRemoteSideQuestUpdate(
            q.questId,
            q.status,
            q.stepIndex,
            this.sideQuestBridge,
          );
          continue;
        }
        this.dialogueEngine.quests.applyRemoteQuestUpdate(
          q.questId,
          q.status,
          q.stepIndex,
          this.dialogueBridge,
        );
      }
      if (Array.isArray(snap.coopQuests)) {
        this.dialogueEngine.quests.setCoopQuestStates(snap.coopQuests);
      }
      if (Array.isArray(snap.bossEncounters)) {
        this.activeBossEncounters.clear();
        for (const boss of snap.bossEncounters) {
          this.activeBossEncounters.set(boss.bossId, boss);
          this.combat.applyAuthoritativeEnemyDamage(
            boss.bossId,
            boss.hp,
            boss.maxHp,
            boss.isDead,
            undefined,
            undefined,
            boss.targetPlayerId ?? undefined,
          );
          this.combat.applySyncDeltas([
            {
              id: boss.bossId,
              kind: 'enemy',
              archetype: boss.archetype,
              x: boss.x,
              y: boss.y,
              z: boss.z,
              yaw: boss.yaw,
              state: boss.state,
              hp: boss.hp,
              maxHp: boss.maxHp,
              isDead: boss.isDead,
              isBoss: true,
              bossPhase: boss.phase,
              attackState: boss.attackState,
              targetPlayerId: boss.targetPlayerId ?? undefined,
            },
          ]);
        }
      }
      for (const dead of snap.deadEntities) {
        if (dead.kind === 'enemy') {
          this.combat.applyAuthoritativeEnemyDamage(dead.id, 0, 100, true);
        } else if (dead.kind === 'animal') {
          this.world.wildlife.applyAuthoritativeDamage(dead.id, 0, 100, true, false);
        } else if (dead.kind === 'npc') {
          this.world.npcs.applyAuthoritativeDamage(dead.id, 0, 100, true);
        }
      }
      if (Array.isArray(snap.entityStates) && snap.entityStates.length > 0) {
        this.combat.restoreEntitySnapshots(snap.entityStates);
        this.world.npcs.restoreEntitySnapshots(snap.entityStates);
        this.world.wildlife.restoreEntitySnapshots(snap.entityStates);
        this.syncAuthoritativeEntities(false);
      }
      if (Array.isArray(snap.containers)) {
        for (const c of snap.containers) {
          this.persistedContainers.set(c.id, c);
        }
      }
      if (Array.isArray(snap.buildingStates)) {
        for (const b of snap.buildingStates) {
          this.persistedBuildingStates.set(b.id, b);
        }
      }
      if (Array.isArray(snap.questObjects)) {
        for (const qo of snap.questObjects) {
          this.persistedQuestObjects.set(qo.id, qo);
        }
      }
      if (snap.worldSettings) {
        this.activeWorldType = snap.worldSettings.worldType;
        this.activeDifficulty = snap.worldSettings.difficulty;
        this.controller?.setGameplayModifiers(
          this.activeDifficulty,
          this.activeWorldType,
        );
      }
      if (snap.worldSettingsPermission) {
        this.worldSettingsPermission = snap.worldSettingsPermission;
      }
      if (snap.worldTime) {
        this.timeManager.syncFromServer(snap.worldTime, snap.serverTimestamp);
      } else if (typeof snap.worldHours === 'number' && Number.isFinite(snap.worldHours)) {
        this.timeManager.setWorldHours(snap.worldHours);
      }
      if (snap.worldWeather) {
        this.weatherManager.syncFromServer(snap.worldWeather, snap.serverTimestamp);
        this.lastSyncedWeatherState = this.weatherManager.getSnapshot().currentState;
      } else if (typeof snap.weather === 'string' && this.isValidWeatherState(snap.weather)) {
        this.lastSyncedWeatherState = snap.weather;
        this.weatherManager.setWeather(snap.weather, true);
      }
      if (typeof snap.coins === 'number' && Number.isFinite(snap.coins)) {
        this.playerCoins = Math.max(0, snap.coins);
      }
      if (typeof snap.xp === 'number' && Number.isFinite(snap.xp)) {
        this.playerXp = Math.max(0, snap.xp);
      }
      if (typeof snap.level === 'number' && Number.isFinite(snap.level)) {
        this.playerLevel = Math.max(1, snap.level);
      }
      if (snap.itemCounts && typeof snap.itemCounts === 'object') {
        for (const [itemId, rawCount] of Object.entries(snap.itemCounts)) {
          if (itemId === 'arrow') continue;
          if (!this.itemManager.getItem(itemId)) continue;
          const targetCount = Math.max(0, Math.round(Number(rawCount) || 0));
          const currentCount = this.inventoryManager.getItemCount(itemId);
          if (targetCount > currentCount) {
            this.inventoryManager.addItem(itemId, targetCount - currentCount);
          } else if (targetCount < currentCount) {
            this.inventoryManager.removeItem(itemId, currentCount - targetCount);
          }
        }
      }
      if (Array.isArray(snap.inventoryItemIds)) {
        for (const itemId of snap.inventoryItemIds) {
          if (itemId === 'arrow') continue;
          if (snap.itemCounts && itemId in snap.itemCounts) continue;
          if (this.inventoryManager.getItemCount(itemId) === 0 && this.itemManager.getItem(itemId)) {
            this.inventoryManager.addItem(itemId, 1);
          }
        }
        this.syncEquippedWeaponFromInventory();
      }
      if (snap.equippedWeaponId !== undefined) {
        if (snap.equippedWeaponId === null) {
          this.inventoryManager.unequipSlotType('weapon');
          this.syncEquippedWeaponFromInventory();
        } else if (typeof snap.equippedWeaponId === 'string' && snap.equippedWeaponId) {
          this.inventoryManager.equipItemById(snap.equippedWeaponId);
          this.syncEquippedWeaponFromInventory();
        }
      }
      if (typeof snap.ammoCount === 'number' && Number.isFinite(snap.ammoCount)) {
        this.reconcileLocalArrowCount(snap.ammoCount);
      }
      let restoredInitialPosition = false;
      if (!this.hasAppliedInitialSpawnSnapshot && snap.playerPosition && this.controller) {
        this.hasAppliedInitialSpawnSnapshot = true;
        const rawX = snap.playerPosition.x;
        const rawZ = snap.playerPosition.z;
        if (Number.isFinite(rawX) && Number.isFinite(rawZ)) {
          let px = rawX;
          let pz = rawZ;
          let py = Number.isFinite(snap.playerPosition.y)
            ? snap.playerPosition.y
            : groundHeightAt(px, pz);
          if (!isLand(px, pz, 0.45) || isWater(px, pz)) {
            const safeLand = findNearestValidLand(px, pz, 4, 0.32, 160);
            px = safeLand.x;
            pz = safeLand.z;
            py = safeLand.y;
          }
          const camRot = this.controller.getCameraRotation();
          const targetYaw = Number.isFinite(snap.playerPosition.yaw)
            ? snap.playerPosition.yaw
            : this.controller.getYaw();
          this.controller.setPoseAndVitals({
            x: px,
            y: py,
            z: pz,
            yaw: targetYaw,
            cameraYaw: camRot.cameraYaw,
            cameraPitch: camRot.cameraPitch,
            health:
              typeof snap.playerVitals?.health === 'number'
                ? snap.playerVitals.health
                : this.controller.getHealth(),
            stamina: this.controller.getStamina(),
          });
          this.mapManager.revealAround(px, pz, 195);
          this.lastFogRevealX = px;
          this.lastFogRevealZ = pz;
          this.skyRig?.updateSunFollow(this.controller.position);
          restoredInitialPosition = true;
        }
      }
      if (snap.playerVitals && this.controller && this.combat) {
        this.controller.syncAuthoritativeHealth(snap.playerVitals.health);
        this.combat.syncPlayerStats(
          snap.playerVitals.health,
          snap.playerVitals.maxHealth,
        );
      }
      this.syncWorldTimeImmediate();
      if (restoredInitialPosition && this.controller && this.camera) {
        this.world.update(
          this.elapsed,
          this.controller.position,
          this.camera,
          0,
          this.timeManager.getWorldHours(),
        );
      }
      if (snap.partyState) {
        this.syncPartyContext(snap.partyState);
      }
      this.emitInventorySnapshot();
      this.emitHud();
    } finally {
      this.isApplyingRemoteWorldEvent = false;
      this.isApplyingRemoteTimeWeather = false;
    }
  }

  private applyRemoteEntitySync(payload: EntitySyncBatchPayload): void {
    if (!this.world || !this.combat) return;
    if (this.isLocalMultiplayerHost()) return;

    if (payload.entities.length > 0) {
      const npcDeltas = payload.entities.filter((e) => e.kind === 'npc');
      const animalDeltas = payload.entities.filter((e) => e.kind === 'animal');
      const enemyDeltas = payload.entities.filter((e) => e.kind === 'enemy');
      if (npcDeltas.length > 0) this.world.npcs.applySyncDeltas(npcDeltas);
      if (animalDeltas.length > 0) this.world.wildlife.applySyncDeltas(animalDeltas);
      if (enemyDeltas.length > 0) this.combat.applySyncDeltas(enemyDeltas);
      this.syncAuthoritativeEntities(false);
    }

    if (typeof payload.worldHours === 'number' && Number.isFinite(payload.worldHours)) {
      const diff = Math.abs(payload.worldHours - this.timeManager.getWorldHours());
      if (diff > 0.15 && diff < 23.85) {
        this.timeManager.setWorldHours(payload.worldHours);
      }
    }
    if (
      typeof payload.weather === 'string' &&
      this.isValidWeatherState(payload.weather) &&
      payload.weather !== this.lastSyncedWeatherState
    ) {
      this.isApplyingRemoteTimeWeather = true;
      try {
        this.lastSyncedWeatherState = payload.weather;
        this.weatherManager.setWeather(payload.weather, false);
      } finally {
        this.isApplyingRemoteTimeWeather = false;
      }
    }
  }

  private handleRemoteMultiplayerGameEvent(
    senderPlayerId: string,
    payload: GameEventPayload,
  ): void {
    if (!this.world || !this.combat) return;
    const data = payload.data ?? {};
    const t = UI_TEXT[this.language];

    switch (payload.event) {
      case 'ARROW_FIRED': {
        const shooterId =
          typeof data.shooterId === 'string' ? data.shooterId : senderPlayerId;
        if (shooterId === this.localMultiplayerPlayerId) {
          if (typeof data.ammoCount === 'number' && Number.isFinite(data.ammoCount)) {
            this.reconcileLocalArrowCount(data.ammoCount);
          }
          return;
        }
        const arrowId = typeof data.arrowId === 'string' ? data.arrowId : '';
        if (!arrowId) return;
        const originX = typeof data.originX === 'number' ? data.originX : 0;
        const originY = typeof data.originY === 'number' ? data.originY : 1.5;
        const originZ = typeof data.originZ === 'number' ? data.originZ : 0;
        const bowCharge = typeof data.bowCharge === 'number' ? data.bowCharge : 1;
        this.remotePlayersManager?.spawnSyncedArrow({
          arrowId,
          shooterId,
          weaponId: typeof data.weaponId === 'string' ? data.weaponId : undefined,
          bowCharge,
          originX,
          originY,
          originZ,
          dirX: typeof data.dirX === 'number' ? data.dirX : 0,
          dirY: typeof data.dirY === 'number' ? data.dirY : 0,
          dirZ: typeof data.dirZ === 'number' ? data.dirZ : 1,
          speed: typeof data.speed === 'number' ? data.speed : 32,
          gravity: typeof data.gravity === 'number' ? data.gravity : 9.8,
        });
        this.sound.playBowRelease(bowCharge, { x: originX, y: originY, z: originZ });
        break;
      }

      case 'PROJECTILE_HIT': {
        const arrowId = typeof data.arrowId === 'string' ? data.arrowId : '';
        const targetKind =
          typeof data.targetKind === 'string' ? data.targetKind : 'world';
        const x = typeof data.x === 'number' ? data.x : 0;
        const y = typeof data.y === 'number' ? data.y : 0;
        const z = typeof data.z === 'number' ? data.z : 0;
        if (arrowId) {
          this.remotePlayersManager?.resolveSyncedArrowHit({
            arrowId,
            x,
            y,
            z,
            targetKind,
          });
        }
        if (senderPlayerId !== this.localMultiplayerPlayerId) {
          this.sound.playArrowImpact(
            targetKind === 'world' ? 'wood' : 'enemy',
            { x, y, z },
          );
        }
        break;
      }

      case 'ENEMY_DAMAGED': {
        const targetId = typeof data.targetId === 'string' ? data.targetId : '';
        if (!targetId) return;
        const attackerId =
          typeof data.attackerId === 'string' ? data.attackerId : senderPlayerId;
        const hp = typeof data.hp === 'number' ? data.hp : 0;
        const maxHp = typeof data.maxHp === 'number' ? data.maxHp : 100;
        const isCrit = Boolean(data.isCrit);
        const x = typeof data.x === 'number' ? data.x : 0;
        const y = typeof data.y === 'number' ? data.y : 1;
        const z = typeof data.z === 'number' ? data.z : 0;
        const atkCoords = this.resolveAttackerCoords(attackerId, x, z);
        this.combat.applyAuthoritativeEnemyDamage(
          targetId,
          hp,
          maxHp,
          false,
          atkCoords.x,
          atkCoords.z,
          attackerId,
        );
        this.combat.spawnHitSparks(x, y, z, isCrit ? 7 : 4);
        this.sound.playHitImpact(isCrit, { position: { x, y, z } });
        if (attackerId === this.localMultiplayerPlayerId) {
          this.emitHud();
        }
        break;
      }

      case 'ENEMY_DIED': {
        const targetId = typeof data.targetId === 'string' ? data.targetId : '';
        if (!targetId) return;
        const killerId =
          typeof data.killerId === 'string' ? data.killerId : senderPlayerId;
        const x = typeof data.x === 'number' ? data.x : 0;
        const y = typeof data.y === 'number' ? data.y : 0;
        const z = typeof data.z === 'number' ? data.z : 0;
        const atkCoords = this.resolveAttackerCoords(killerId, x, z);
        const res = this.combat.applyAuthoritativeEnemyDamage(
          targetId,
          0,
          100,
          true,
          atkCoords.x,
          atkCoords.z,
          killerId,
        );
        if (res?.justKilled) {
          this.spawnDustBurst(x, y, z, 6);
          this.sound.playEnemyDefeat({ x, y, z });
          if (killerId === this.localMultiplayerPlayerId) {
            this.recordEnemyKill(res.enemy.archetype.id, targetId);
            ProfileManager.recordGameplayDelta({ enemiesDefeated: 1 });
          }
          this.emitHud();
        }
        break;
      }

      case 'ANIMAL_DAMAGED': {
        const targetId = typeof data.targetId === 'string' ? data.targetId : '';
        if (!targetId) return;
        const attackerId =
          typeof data.attackerId === 'string' ? data.attackerId : senderPlayerId;
        const hp = typeof data.hp === 'number' ? data.hp : 0;
        const maxHp = typeof data.maxHp === 'number' ? data.maxHp : 50;
        const isCrit = Boolean(data.isCrit);
        const x = typeof data.x === 'number' ? data.x : 0;
        const y = typeof data.y === 'number' ? data.y : 0.7;
        const z = typeof data.z === 'number' ? data.z : 0;
        const atkCoords = this.resolveAttackerCoords(attackerId, x, z);
        this.world.wildlife.applyAuthoritativeDamage(
          targetId,
          hp,
          maxHp,
          false,
          false,
          atkCoords.x,
          atkCoords.z,
        );
        this.combat.spawnHitSparks(x, y, z, isCrit ? 6 : 4);
        this.sound.playHitImpact(isCrit, { position: { x, y, z } });
        if (attackerId === this.localMultiplayerPlayerId) {
          this.emitHud();
        }
        break;
      }

      case 'ANIMAL_DIED': {
        const targetId = typeof data.targetId === 'string' ? data.targetId : '';
        if (!targetId) return;
        const killerId =
          typeof data.killerId === 'string' ? data.killerId : senderPlayerId;
        const x = typeof data.x === 'number' ? data.x : 0;
        const y = typeof data.y === 'number' ? data.y : 0;
        const z = typeof data.z === 'number' ? data.z : 0;
        const atkCoords = this.resolveAttackerCoords(killerId, x, z);
        const res = this.world.wildlife.applyAuthoritativeDamage(
          targetId,
          0,
          100,
          true,
          false,
          atkCoords.x,
          atkCoords.z,
        );
        if (res.justKilled) {
          this.spawnDustBurst(x, y, z, 5);
          this.sound.playEnemyDefeat({ x, y, z });
          if (killerId === this.localMultiplayerPlayerId) {
            if (res.species) {
              this.recordEnemyKill(`animal:${res.species}`, targetId);
            }
            ProfileManager.recordGameplayDelta({ animalsDefeated: 1 });
          }
          if (this.isLocalMultiplayerHost() && res.drops && res.drops.length > 0) {
            for (let i = 0; i < res.drops.length; i++) {
              const d = res.drops[i];
              const angle = (i * Math.PI * 2) / Math.max(1, res.drops.length) + 0.4;
              const offset = res.drops.length > 1 ? 0.65 : 0;
              const label = this.itemManager.getItem(d.itemId)?.name ?? d.itemId;
              const dropId = `drop_animal_${targetId}_${i}_${Date.now().toString(36)}`;
              const spawned = this.world.spawnWorldPickup(
                x + Math.cos(angle) * offset,
                z + Math.sin(angle) * offset,
                d.itemId,
                d.quantity,
                label,
                dropId,
                true,
              );
              this.multiplayerService?.sendGameEvent('ITEM_DROPPED', {
                dropId: spawned.id,
                itemId: d.itemId,
                count: d.quantity,
                label,
                x: Math.round(spawned.x * 100) / 100,
                y: Math.round(spawned.y * 100) / 100,
                z: Math.round(spawned.z * 100) / 100,
              });
            }
          }
          this.emitHud();
        }
        break;
      }

      case 'NPC_DAMAGED': {
        const targetId = typeof data.targetId === 'string' ? data.targetId : '';
        if (!targetId) return;
        const attackerId =
          typeof data.attackerId === 'string' ? data.attackerId : senderPlayerId;
        const hp = typeof data.hp === 'number' ? data.hp : 0;
        const maxHp = typeof data.maxHp === 'number' ? data.maxHp : 100;
        const isCrit = Boolean(data.isCrit);
        const x = typeof data.x === 'number' ? data.x : 0;
        const y = typeof data.y === 'number' ? data.y : 1;
        const z = typeof data.z === 'number' ? data.z : 0;
        const atkCoords = this.resolveAttackerCoords(attackerId, x, z);
        this.world.npcs.applyAuthoritativeDamage(
          targetId,
          hp,
          maxHp,
          false,
          atkCoords.x,
          atkCoords.z,
        );
        this.combat.spawnHitSparks(x, y, z, isCrit ? 6 : 4);
        this.sound.playHitImpact(isCrit, { position: { x, y, z } });
        if (attackerId === this.localMultiplayerPlayerId) {
          this.callbacks.onWorldNotice(t.bowNpcWarningNotice);
        }
        break;
      }

      case 'NPC_DIED': {
        const targetId = typeof data.targetId === 'string' ? data.targetId : '';
        if (!targetId) return;
        const killerId =
          typeof data.killerId === 'string' ? data.killerId : senderPlayerId;
        const x = typeof data.x === 'number' ? data.x : 0;
        const y = typeof data.y === 'number' ? data.y : 0;
        const z = typeof data.z === 'number' ? data.z : 0;
        const atkCoords = this.resolveAttackerCoords(killerId, x, z);
        const res = this.world.npcs.applyAuthoritativeDamage(
          targetId,
          0,
          100,
          true,
          atkCoords.x,
          atkCoords.z,
        );
        if (res?.justKilled) {
          this.spawnDustBurst(x, y, z, 6);
          this.sound.playEnemyDefeat({ x, y, z });
          this.emitHud();
        }
        break;
      }

      case 'PLAYER_DIED': {
        const playerId = typeof data.playerId === 'string' ? data.playerId : '';
        if (
          playerId !== this.localMultiplayerPlayerId &&
          typeof data.x === 'number' &&
          typeof data.z === 'number'
        ) {
          const py = typeof data.y === 'number' ? data.y : 0.8;
          this.spawnDustBurst(data.x, py, data.z, 6);
          this.sound.playPlayerDefeat();
        }
        break;
      }

      case 'CHEST_OPENED': {
        const openedBy = typeof data.openedBy === 'string' ? data.openedBy : senderPlayerId;
        if (openedBy === this.localMultiplayerPlayerId) return;
        const chestId = typeof data.chestId === 'string' ? data.chestId : '';
        if (!chestId) return;
        const chest = this.world.markChestOpenedRemote(chestId);
        if (chest) {
          this.spawnDustBurst(chest.x, chest.y + 0.6, chest.z, 6);
          this.sound.playChestState(true, chest);
        }
        break;
      }

      case 'PLAYER_COLLECTED_RESOURCE': {
        const collectedBy =
          typeof data.collectedBy === 'string' ? data.collectedBy : senderPlayerId;
        if (collectedBy === this.localMultiplayerPlayerId) return;
        const nodeId = typeof data.nodeId === 'string' ? data.nodeId : '';
        if (!nodeId) return;
        const usesRemaining =
          typeof data.usesRemaining === 'number' ? data.usesRemaining : 0;
        const depleted = Boolean(data.depleted);
        this.world.applyResourceNodeState(
          nodeId,
          usesRemaining,
          depleted,
          this.elapsed + 90,
        );
        if (typeof data.x === 'number' && typeof data.z === 'number') {
          const ry = typeof data.y === 'number' ? data.y : 0;
          this.spawnDustBurst(data.x, ry + 0.5, data.z, 4);
          this.sound.playResourceToolAction(
            typeof data.itemId === 'string' ? data.itemId : 'stone',
            depleted,
            { x: data.x, y: ry, z: data.z },
          );
        }
        break;
      }

      case 'ITEM_DROPPED': {
        const dropId = typeof data.dropId === 'string' ? data.dropId : '';
        const itemId = typeof data.itemId === 'string' ? data.itemId : '';
        if (!dropId || !itemId) return;
        if (this.world.interactables.some((it) => it.id === dropId)) return;
        const count = typeof data.count === 'number' ? Math.max(1, Math.round(data.count)) : 1;
        const label = typeof data.label === 'string' ? data.label : itemId;
        const x = typeof data.x === 'number' ? data.x : 0;
        const z = typeof data.z === 'number' ? data.z : 0;
        this.world.spawnWorldPickup(x, z, itemId, count, label, dropId, true);
        break;
      }

      case 'ITEM_PICKED_UP': {
        const pickedUpBy =
          typeof data.pickedUpBy === 'string' ? data.pickedUpBy : senderPlayerId;
        if (pickedUpBy === this.localMultiplayerPlayerId) return;
        const pickupId = typeof data.pickupId === 'string' ? data.pickupId : '';
        if (!pickupId) return;
        if (data.isPlayerDrop) {
          this.world.removePickupById(pickupId);
        } else {
          this.world.markPickupCollectedRemote(pickupId);
        }
        break;
      }

      case 'DOOR_OPENED':
      case 'DOOR_CLOSED': {
        const doorPlayerId =
          typeof data.playerId === 'string' ? data.playerId : senderPlayerId;
        if (doorPlayerId === this.localMultiplayerPlayerId) return;
        const doorId = typeof data.doorId === 'string' ? data.doorId : '';
        if (!doorId) return;
        this.world.setDoorOpen(doorId, payload.event === 'DOOR_OPENED');
        break;
      }

      case 'BED_PLACED': {
        const ownerId = typeof data.ownerId === 'string' ? data.ownerId : senderPlayerId;
        if (ownerId === this.localMultiplayerPlayerId) return;
        const bedId = typeof data.bedId === 'string' ? data.bedId : '';
        if (!bedId || this.world.interactables.some((it) => it.id === bedId)) return;
        const x = typeof data.x === 'number' ? data.x : 0;
        const z = typeof data.z === 'number' ? data.z : 0;
        const yaw = typeof data.yaw === 'number' ? data.yaw : 0;
        const placedBed = this.world.placeBedAt(x, z, yaw, bedId);
        if (placedBed) {
          this.sound.playObjectPlace(false, placedBed);
        }
        break;
      }

      case 'STATION_PLACED': {
        const ownerId = typeof data.ownerId === 'string' ? data.ownerId : senderPlayerId;
        if (ownerId === this.localMultiplayerPlayerId) return;
        const stationId = typeof data.stationId === 'string' ? data.stationId : '';
        if (!stationId || this.world.interactables.some((it) => it.id === stationId)) return;
        const stationType =
          data.stationType === 'furnace' ? 'furnace' : 'crafting_table';
        const x = typeof data.x === 'number' ? data.x : 0;
        const z = typeof data.z === 'number' ? data.z : 0;
        const yaw = typeof data.yaw === 'number' ? data.yaw : 0;
        const placedStation = this.world.placeStationAt(stationType, x, z, yaw, stationId);
        if (placedStation) {
          this.sound.playObjectPlace(false, placedStation);
        }
        break;
      }

      case 'BED_USED': {
        const usedBy = typeof data.usedBy === 'string' ? data.usedBy : senderPlayerId;
        if (usedBy === this.localMultiplayerPlayerId) return;
        const newHours =
          typeof data.newWorldHours === 'number' ? data.newWorldHours : 6.5;
        this.timeManager.setWorldHours(newHours);
        this.world.npcs.wakeAllSleepingNpcs();
        this.syncWorldTimeImmediate();
        this.emitHud();
        break;
      }

      case 'QUEST_UPDATED': {
        const updatedBy =
          typeof data.updatedBy === 'string' ? data.updatedBy : senderPlayerId;
        if (updatedBy !== this.localMultiplayerPlayerId) return;
        const questId = typeof data.questId === 'string' ? data.questId : '';
        const status = typeof data.status === 'string' ? data.status : 'active';
        const stepIndex = typeof data.stepIndex === 'number' ? data.stepIndex : 0;
        if (!questId) return;
        this.dialogueEngine.quests.applyRemoteQuestUpdate(
          questId,
          status,
          stepIndex,
          this.dialogueBridge,
        );
        this.emitHud();
        break;
      }

      case 'SIDE_QUEST_UPDATED': {
        const targetPlayerId =
          typeof data.playerId === 'string' ? data.playerId : senderPlayerId;
        if (targetPlayerId !== this.localMultiplayerPlayerId) return;
        const sideQuestId =
          typeof data.sideQuestId === 'string' ? data.sideQuestId : '';
        const state = typeof data.state === 'string' ? data.state : 'ACTIVE';
        const stepIndex = typeof data.stepIndex === 'number' ? data.stepIndex : 0;
        if (!sideQuestId) return;
        this.sideQuestManager.applyRemoteSideQuestUpdate(
          sideQuestId,
          state,
          stepIndex,
          this.sideQuestBridge,
        );
        this.syncSideQuestLocalEntities();
        this.syncAuthoritativeEntities(true);
        this.emitHud();
        break;
      }

      case 'WORLD_EVENT': {
        const emittedBy =
          typeof data.emittedBy === 'string' ? data.emittedBy : senderPlayerId;
        if (emittedBy === this.localMultiplayerPlayerId) return;
        const kind = typeof data.kind === 'string' ? data.kind : '';
        if (kind === 'landmark_discovered' && typeof data.landmarkId === 'string') {
          this.isApplyingRemoteWorldEvent = true;
          try {
            const lm = this.landmarks.find((l) => l.id === data.landmarkId);
            if (lm && !lm.discovered) {
              lm.discovered = true;
              this.mapManager.revealAround(lm.x, lm.z, 110);
              this.emitHud();
            }
          } finally {
            this.isApplyingRemoteWorldEvent = false;
          }
        } else if (
          kind === 'weather_changed' &&
          typeof data.weather === 'string' &&
          this.isValidWeatherState(data.weather)
        ) {
          this.isApplyingRemoteTimeWeather = true;
          try {
            this.lastSyncedWeatherState = data.weather;
            this.weatherManager.setWeather(data.weather, false);
            this.syncWorldTimeImmediate();
            this.emitHud();
          } finally {
            this.isApplyingRemoteTimeWeather = false;
          }
        }
        break;
      }

      case 'CONTAINER_UPDATED': {
        const containerId = typeof data.containerId === 'string' ? data.containerId : '';
        if (!containerId) return;
        const prev = this.persistedContainers.get(containerId);
        this.persistedContainers.set(containerId, {
          id: containerId,
          isOpen: typeof data.isOpen === 'boolean' ? data.isOpen : (prev?.isOpen ?? true),
          items: prev?.items ?? [],
          updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : senderPlayerId,
          updatedAtMs: Date.now(),
        });
        break;
      }

      case 'BUILDING_UPDATED': {
        const buildingId = typeof data.buildingId === 'string' ? data.buildingId : '';
        if (!buildingId) return;
        const prev = this.persistedBuildingStates.get(buildingId);
        this.persistedBuildingStates.set(buildingId, {
          id: buildingId,
          kind: typeof data.kind === 'string' ? data.kind : (prev?.kind ?? 'structure'),
          state: typeof data.state === 'string' ? data.state : (prev?.state ?? 'built'),
          ...(typeof data.health === 'number' ? { health: data.health } : {}),
          updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : senderPlayerId,
          updatedAtMs: Date.now(),
        });
        break;
      }

      case 'QUEST_OBJECT_UPDATED': {
        const objectId = typeof data.objectId === 'string' ? data.objectId : '';
        const questId = typeof data.questId === 'string' ? data.questId : '';
        if (!objectId || !questId) return;
        this.persistedQuestObjects.set(objectId, {
          id: objectId,
          questId,
          state: typeof data.state === 'string' ? data.state : 'activated',
          updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : senderPlayerId,
          updatedAtMs: Date.now(),
        });
        break;
      }

      case 'NPC_DIALOGUE_STATE': {
        const npcId = typeof data.npcId === 'string' ? data.npcId : '';
        const state = data.dialogueState === 'talking' ? 'talking' : 'idle';
        if (!npcId) return;
        this.world.npcs.setNpcRemoteDialogueState(npcId, state);
        break;
      }

      case 'PLAYER_BUILD_PLACE': {
        const structureId = typeof data.structureId === 'string' ? data.structureId : '';
        const blueprintId = typeof data.blueprintId === 'string' ? data.blueprintId : '';
        const bp = getBlueprintById(blueprintId);
        if (!structureId || !bp) return;
        const ownerId = typeof data.ownerId === 'string' ? data.ownerId : senderPlayerId;
        const existing = this.world.buildings.getStructureById(structureId);
        if (existing) return;
        const permRaw = data.permissionScope;
        const permission: BuildingPermissionScope =
          permRaw === 'friends' || permRaw === 'party' || permRaw === 'everyone'
            ? permRaw
            : 'owner';
        const st: PlayerBuiltStructure = {
          id: structureId,
          blueprintId: bp.id,
          category: bp.category,
          tier: bp.tier,
          x: typeof data.x === 'number' ? data.x : 0,
          y: typeof data.y === 'number' ? data.y : 0,
          z: typeof data.z === 'number' ? data.z : 0,
          yaw: typeof data.yaw === 'number' ? data.yaw : 0,
          health: typeof data.structureHp === 'number' ? data.structureHp : bp.maxHealth,
          maxHealth: typeof data.maxStructureHp === 'number' ? data.maxStructureHp : bp.maxHealth,
          ownerId,
          ownerName: typeof data.ownerName === 'string' ? data.ownerName : 'Explorer',
          permission,
          createdAtMs: typeof data.createdAtMs === 'number' ? data.createdAtMs : Date.now(),
          ...(bp.hasDoor ? { doorOpen: false } : {}),
          ...(bp.storageCapacity ? { storageItems: [] } : {}),
          ...(bp.isFarmPlot
            ? { farmState: { stage: 0, growthProgress: 0, plantedAtElapsed: this.elapsed } }
            : {}),
        };
        this.world.buildings.addOrUpdateStructure(st);
        this.sound.playObjectPlace(bp.category === 'structures', { x: st.x, y: st.y, z: st.z });
        this.spawnDustBurst(st.x, st.y + 0.35, st.z, 5);
        this.emitHud();
        break;
      }

      case 'PLAYER_BUILD_REPAIR': {
        const structureId = typeof data.structureId === 'string' ? data.structureId : '';
        if (!structureId) return;
        const updatedBy = typeof data.updatedBy === 'string' ? data.updatedBy : senderPlayerId;
        if (updatedBy === this.localMultiplayerPlayerId) return;
        const hp = typeof data.structureHp === 'number' ? data.structureHp : undefined;
        this.world.buildings.applyRepair(structureId, hp);
        const st = this.world.buildings.getStructureById(structureId);
        if (st) this.sound.playBuildRepair({ x: st.x, y: st.y, z: st.z });
        this.emitHud();
        break;
      }

      case 'PLAYER_BUILD_UPGRADE': {
        const structureId = typeof data.structureId === 'string' ? data.structureId : '';
        const blueprintId = typeof data.blueprintId === 'string' ? data.blueprintId : '';
        const updatedBy = typeof data.updatedBy === 'string' ? data.updatedBy : senderPlayerId;
        if (!structureId || !blueprintId || updatedBy === this.localMultiplayerPlayerId) return;
        const upgraded = this.world.buildings.applyUpgrade(structureId, blueprintId);
        if (upgraded) {
          this.sound.playBuildUpgrade({ x: upgraded.x, y: upgraded.y, z: upgraded.z });
          this.spawnDustBurst(upgraded.x, upgraded.y + 0.6, upgraded.z, 6);
        }
        this.emitHud();
        break;
      }

      case 'PLAYER_BUILD_PERMS': {
        const structureId = typeof data.structureId === 'string' ? data.structureId : '';
        const updatedBy = typeof data.updatedBy === 'string' ? data.updatedBy : senderPlayerId;
        if (!structureId || updatedBy === this.localMultiplayerPlayerId) return;
        const permRaw = data.permissionScope;
        const scope: BuildingPermissionScope =
          permRaw === 'friends' || permRaw === 'party' || permRaw === 'everyone'
            ? permRaw
            : 'owner';
        this.world.buildings.setPermissions(structureId, scope);
        this.emitHud();
        break;
      }

      case 'PLAYER_BUILD_DEMOLISH': {
        const structureId = typeof data.structureId === 'string' ? data.structureId : '';
        const updatedBy = typeof data.updatedBy === 'string' ? data.updatedBy : senderPlayerId;
        if (!structureId || updatedBy === this.localMultiplayerPlayerId) return;
        const removed = this.world.buildings.removeStructure(structureId);
        if (removed) {
          this.sound.playObjectRemove({ x: removed.x, y: removed.y, z: removed.z });
          this.spawnDustBurst(removed.x, removed.y + 0.5, removed.z, 6);
        }
        this.emitHud();
        break;
      }

      case 'PLAYER_STORAGE_TRANSFER': {
        const structureId = typeof data.structureId === 'string' ? data.structureId : '';
        const updatedBy = typeof data.updatedBy === 'string' ? data.updatedBy : senderPlayerId;
        if (!structureId || updatedBy === this.localMultiplayerPlayerId) return;
        const st = this.world.buildings.getStructureById(structureId);
        if (!st) return;
        const direction = data.direction === 'withdraw' ? 'withdraw' : 'deposit';
        const itemId = typeof data.itemId === 'string' ? data.itemId : '';
        const count = typeof data.count === 'number' ? Math.max(1, Math.round(data.count)) : 1;
        if (!itemId) return;
        const list: PlayerStructureStorageItem[] = (st.storageItems ?? []).map((it) => ({ ...it }));
        if (direction === 'deposit') {
          const ex = list.find((it) => it.itemId === itemId);
          if (ex) ex.count = Math.min(200, ex.count + count);
          else list.push({ itemId, count });
        } else {
          const idx = list.findIndex((it) => it.itemId === itemId);
          if (idx !== -1) {
            list[idx].count -= count;
            if (list[idx].count <= 0) list.splice(idx, 1);
          }
        }
        this.world.buildings.setStorageItems(structureId, list);
        this.emitHud();
        break;
      }

      case 'PLAYER_FARM_TILL': {
        const structureId = typeof data.structureId === 'string' ? data.structureId : '';
        const updatedBy = typeof data.updatedBy === 'string' ? data.updatedBy : senderPlayerId;
        if (!structureId || updatedBy === this.localMultiplayerPlayerId) return;
        this.world.buildings.prepareFarmSoil(structureId, this.getTotalWorldHours());
        this.callbacks.onFarmOrVillageStateChange?.();
        this.emitHud();
        break;
      }

      case 'PLAYER_FARM_PLANT': {
        const structureId = typeof data.structureId === 'string' ? data.structureId : '';
        const cropId = typeof data.cropId === 'string' ? (data.cropId as CropId) : 'wheat';
        const updatedBy = typeof data.updatedBy === 'string' ? data.updatedBy : senderPlayerId;
        if (!structureId || updatedBy === this.localMultiplayerPlayerId) return;
        this.world.buildings.plantFarmSeed(
          structureId,
          cropId,
          this.getTotalWorldHours(),
          this.isCurrentlyRaining(),
        );
        this.callbacks.onFarmOrVillageStateChange?.();
        this.emitHud();
        break;
      }

      case 'PLAYER_FARM_WATER': {
        const structureId = typeof data.structureId === 'string' ? data.structureId : '';
        const updatedBy = typeof data.updatedBy === 'string' ? data.updatedBy : senderPlayerId;
        if (!structureId || updatedBy === this.localMultiplayerPlayerId) return;
        this.world.buildings.waterFarmPlot(structureId, this.getTotalWorldHours());
        this.callbacks.onFarmOrVillageStateChange?.();
        this.emitHud();
        break;
      }

      case 'PLAYER_FARM_HARVEST': {
        const structureId = typeof data.structureId === 'string' ? data.structureId : '';
        const updatedBy = typeof data.updatedBy === 'string' ? data.updatedBy : senderPlayerId;
        if (!structureId) return;
        if (updatedBy !== this.localMultiplayerPlayerId) {
          this.world.buildings.harvestFarmPlot(
            structureId,
            this.elapsed,
            this.getTotalWorldHours(),
          );
        }
        const villageId = typeof data.villageId === 'string' ? data.villageId : '';
        if (villageId && typeof data.villageXp === 'number') {
          const rec = this.world.villageDev.getOrCreateRecord(villageId);
          rec.progressXp = Math.max(rec.progressXp, Number(data.villageXp) || 0);
          rec.reputationPoints = Math.max(
            rec.reputationPoints,
            Number(data.villageRep) || 0,
          );
          rec.level = this.world.villageDev.computeLevelForXp(rec.progressXp);
          const site = this.world.village.villages.find((v) => v.id === villageId);
          if (site?.isLoaded) this.world.villageDev.rebuildVillageAddons(site);
        }
        this.callbacks.onFarmOrVillageStateChange?.();
        this.emitHud();
        break;
      }

      case 'VILLAGE_REPAIR':
      case 'VILLAGE_PROJECT':
      case 'VILLAGE_DEFENSE_WON':
      case 'MERCHANT_BUY':
      case 'MERCHANT_SELL': {
        const villageId = typeof data.villageId === 'string' ? data.villageId : '';
        if (!villageId) return;
        const rec = this.world.villageDev.getOrCreateRecord(villageId);
        if (typeof data.villageXp === 'number') {
          rec.progressXp = Math.max(rec.progressXp, data.villageXp);
          rec.level = this.world.villageDev.computeLevelForXp(rec.progressXp);
        }
        if (typeof data.villageRep === 'number') {
          rec.reputationPoints = Math.max(rec.reputationPoints, data.villageRep);
        }
        if (payload.event === 'VILLAGE_REPAIR' && typeof data.repairId === 'string') {
          if (!rec.completedRepairIds.includes(data.repairId)) {
            rec.completedRepairIds.push(data.repairId);
          }
        } else if (payload.event === 'VILLAGE_PROJECT' && typeof data.projectId === 'string') {
          if (!rec.completedProjectIds.includes(data.projectId)) {
            rec.completedProjectIds.push(data.projectId);
          }
        } else if (payload.event === 'VILLAGE_DEFENSE_WON' && typeof data.defensesWonCount === 'number') {
          rec.defensesWonCount = Math.max(rec.defensesWonCount, data.defensesWonCount);
        }
        const site = this.world.village.villages.find((v) => v.id === villageId);
        if (site?.isLoaded) {
          this.world.villageDev.rebuildVillageAddons(site);
        }
        this.callbacks.onFarmOrVillageStateChange?.();
        this.emitHud();
        break;
      }
    }
  }

  private applyLoadedSave(data: SaveGameData): void {
    this.multiplayerSessionActive = false;
    this.authoritativeMultiplayerConfig = null;
    this.teardownMultiplayerSync();
    this.endNpcDialogue();
    this.rebuildWorldForSeed(data.world.worldSeed);

    this.playTimeSeconds = data.meta.playTimeSeconds;
    this.activeSaveSlot = data.meta.slotId;
    this.activeWorldName = data.meta.worldName || 'Oakhollow Valley';
    this.activeWorldType = data.meta.worldType ?? data.world.worldType ?? 'normal';
    this.activeDifficulty = data.meta.difficulty ?? data.world.difficulty ?? 'normal';
    this.activeWorldCreatedAtMs = data.meta.createdAtMs || data.meta.savedAtMs;
    this.autosaveTimer = 0;
    this.hasUnsavedProgress = false;
    this.unsavedTimer = 0;

    this.controller.setGameplayModifiers(this.activeDifficulty, this.activeWorldType);

    this.isSleeping = false;
    this.sleepTimer = 0;

    // 1. Restore inventory & equipped bonuses before clamping player vitals
    this.inventoryManager.restoreState(data.inventory);
    this.craftingManager.restoreState(data.crafting);
    this.syncEquipmentBonuses();
    this.syncEquippedWeaponFromInventory();

    // 2. Restore player progression, position (relocated off water if legacy save), health & stamina
    this.playerLevel = Math.max(1, data.player.level);
    this.playerXp = Math.max(0, data.player.xp);
    this.playerCoins = Math.max(0, data.player.coins);

    let px = Number.isFinite(data.player.position.x) ? data.player.position.x : 0;
    let pz = Number.isFinite(data.player.position.z) ? data.player.position.z : 4;
    let py = Number.isFinite(data.player.position.y)
      ? data.player.position.y
      : groundHeightAt(px, pz);
    if (!isLand(px, pz, 0.45) || isWater(px, pz)) {
      const safeLand = findNearestValidLand(px, pz, 4, 0.32, 220);
      px = safeLand.x;
      pz = safeLand.z;
      py = safeLand.y;
    }

    this.controller.setPoseAndVitals({
      x: px,
      y: py,
      z: pz,
      yaw: data.player.rotation.yaw,
      cameraYaw: data.player.rotation.cameraYaw,
      cameraPitch: data.player.rotation.cameraPitch,
      health: data.player.health,
      stamina: data.player.stamina,
    });

    // 3. Restore quest progress, completed quests & dialogue flags
    this.dialogueEngine.quests.restoreState(data.quests);
    this.dialogueEngine.restoreFlags(data.world.dialogueFlags);
    this.clearStoryLocalEntities();
    this.storyManager.restoreState(data.story ?? null);
    this.clearSideQuestLocalEntities();
    this.sideQuestManager.restoreState(data.sideQuests ?? null);
    this.trackedQuestSource =
      data.sideQuests?.trackedSideQuestId &&
      this.sideQuestManager.getTrackedSideQuestId() ===
        data.sideQuests.trackedSideQuestId
        ? 'sidequest'
        : 'story';

    // 4. Restore time & weather
    this.timeManager.restoreState(data.time);
    this.weatherManager.restoreState(data.weather);

    // 4b. Restore camera perspective & footstep audio preference if saved
    if (data.camera) {
      this.cameraSettings = { ...data.camera };
      this.settings.mouseSensitivity = data.camera.sensitivity;
      this.settings.invertY = data.camera.invertY;
      this.cameraRig?.updateCameraConfig({
        distance: data.camera.distance,
        shoulderHeight: data.camera.height,
        smoothingScale: data.camera.smoothing,
      });
      this.cameraRig?.setPerspective(data.camera.perspective, true);
    }
    if (typeof data.audio?.footstepVolume === 'number') {
      this.footstepVolume = data.audio.footstepVolume;
      this.sound.setAudioVolumes({ footstepVolume: this.footstepVolume });
    }
    this.player?.setFirstPersonMode(
      this.cameraRig?.isFirstPersonActive() ?? false,
      this.cameraRig?.getPitch() ?? 0,
    );
    this.updateInteractionIndicatorScreenPos();

    // 5. Restore important world state & defeated enemies / killed wildlife
    this.world.restoreImportantState({
      discoveredLandmarkIds: data.world.discoveredLandmarkIds,
      collectedInteractableIds: data.world.collectedInteractableIds,
      droppedPickups: data.world.droppedPickups,
      placedBeds: data.world.placedBeds ?? [],
      placedStations: data.world.placedStations ?? [],
      depletedNodes: data.world.depletedNodes ?? [],
      openedChestIds: data.world.openedChestIds ?? [],
      doorStates: data.world.doorStates ?? [],
      destroyedIds: data.world.destroyedIds ?? [],
      customChanges: data.world.customChanges ?? [],
    });
    this.waypoint = data.world.waypoint ? { ...data.world.waypoint } : null;
    this.mapManager.restoreFogState(
      data.world.fogOfWar,
      this.landmarks,
      px,
      pz,
    );
    this.lastFogRevealX = px;
    this.lastFogRevealZ = pz;

    this.world.wildlife.restoreKilledAnimalIds(data.world.killedAnimalIds ?? []);
    this.world.npcs.restoreSaveNpcStates(data.world.npcStates ?? []);
    this.combat.resetPlayerAndAggro();
    this.combat.clearVillageDefenseRaiders();
    this.combat.restoreQuestTargetState(data.world.questTargets ?? []);
    this.combat.restoreDefeatedEnemies(data.world.defeatedEnemyIds);

    this.world.villageDev.restoreState(data.villageDev, this.world.village.villages);
    this.world.farmAnimals.restoreState(
      data.villageDev?.farmAnimals,
      this.world.village.villages,
      this.getTotalWorldHours(),
    );
    this.world.buildings.syncAllFarmPlotsByWorldHours(
      this.getTotalWorldHours(),
      this.isCurrentlyRaining(),
    );

    this.syncWorldTimeImmediate();
    this.skyRig.updateSunFollow(this.controller.position);
    this.world.update(
      0,
      this.controller.position,
      this.camera,
      0,
      this.timeManager.getWorldHours(),
      0.16,
      0.62,
      this.skyRig,
      this.getTotalWorldHours(),
      this.isCurrentlyRaining(),
    );

    this.sideQuestManager.update(this.sideQuestBridge);
    this.syncSideQuestLocalEntities();
    this.emitInventorySnapshot();
    this.emitHud();
  }

  public async loadFromSlot(slotId: SaveSlotId): Promise<boolean> {
    if (this.multiplayerSessionActive) return false;
    const res = this.loadManager.loadSlot(slotId);
    if (!res.ok) {
      this.callbacks.onWorldNotice(UI_TEXT[this.language].loadFailedNotice);
      return false;
    }

    this.sound.unlock();
    this.sound.playUiClick();

    const loaded = await this.ensureWorldRuntimeLoaded(res.data.world.worldSeed, {
      x: Number.isFinite(res.data.player.position.x) ? res.data.player.position.x : 0,
      z: Number.isFinite(res.data.player.position.z) ? res.data.player.position.z : 4,
    });
    if (!loaded || !this.controller || !this.world) return false;

    this.applyLoadedSave(res.data);
    this.saveManager.setLastActiveSlot(slotId);

    this.input?.setTouchMode(this.touchModeEnabled);
    this.worldLifecycleState = 'GAMEPLAY';
    this.setPhase('playing');
    if (!this.touchModeEnabled && !this.modalOpen) {
      this.input?.requestPointerLock();
    }
    this.callbacks.onWorldNotice(
      UI_TEXT[this.language].loadedNotice(res.data.meta.worldName || this.getSlotDisplayName(slotId)),
    );
    return true;
  }

  public async continueLatestSave(): Promise<boolean> {
    const latest = this.getMostRecentSaveMeta();
    if (!latest) return false;
    return this.loadFromSlot(latest.slotId);
  }

  public async createNewWorld(options: NewWorldOptions): Promise<boolean> {
    this.multiplayerSessionActive = false;
    this.authoritativeMultiplayerConfig = null;
    this.teardownMultiplayerSync();
    const worldId = generateWorldId();
    const cleanName = options.worldName.trim() || 'Oakhollow Valley';
    const seed = Number.isFinite(options.seed)
      ? Math.floor(Math.abs(options.seed)) || DEFAULT_WORLD_SEED
      : DEFAULT_WORLD_SEED;

    this.sound.unlock();
    this.sound.playUiClick();
    this.endNpcDialogue();

    const loaded = await this.ensureWorldRuntimeLoaded(seed, { x: 0, z: 4 });
    if (!loaded || !this.controller || !this.world) return false;

    this.rebuildWorldForSeed(seed);
    this.playTimeSeconds = 0;
    this.autosaveTimer = 0;
    this.playerLevel = 1;
    this.playerXp = 0;
    this.playerCoins = options.worldType === 'creative' ? 500 : options.worldType === 'adventure' ? 50 : 0;
    this.activeSaveSlot = worldId;
    this.activeWorldName = cleanName;
    this.activeWorldType = options.worldType;
    this.activeDifficulty = options.difficulty;
    this.activeWorldCreatedAtMs = Date.now();
    this.hasUnsavedProgress = false;
    this.unsavedTimer = 0;

    this.controller.setGameplayModifiers(options.difficulty, options.worldType);

    this.dialogueEngine.quests.reset();
    this.dialogueEngine.restoreFlags([]);
    this.clearStoryLocalEntities();
    this.storyManager.reset();
    this.clearSideQuestLocalEntities();
    this.sideQuestManager.reset();
    this.trackedQuestSource = 'story';
    this.aiService.resetAllMemory();
    this.seedStarterInventory();
    this.craftingManager.resetProgression();
    this.syncEquipmentBonuses();
    this.syncEquippedWeaponFromInventory();

    this.isSleeping = false;
    this.sleepTimer = 0;

    this.world.restoreImportantState({
      discoveredLandmarkIds: ['spawn-glade'],
      collectedInteractableIds: [],
      droppedPickups: [],
      placedBeds: [],
      placedStations: [],
      depletedNodes: [],
      openedChestIds: [],
    });
    this.world.wildlife.restoreKilledAnimalIds([]);

    this.timeManager.restoreState({
      worldHours: 8.5,
      dayCount: 1,
      fullDayDurationSeconds: 360,
      timeScale: 1,
      paused: false,
    });
    this.weatherManager.setWeather('clear', true);
    this.weatherManager.setDynamicEnabled(true);

    this.controller.reset(0, 4);
    this.waypoint = null;
    this.mapManager.resetFog();
    this.mapManager.revealAround(0, 4, 195);
    this.lastFogRevealX = 0;
    this.lastFogRevealZ = 4;
    this.statAccumTimeSec = 0;
    this.statAccumDistM = 0;
    this.lastStatTrackX = 0;
    this.lastStatTrackZ = 4;
    ProfileManager.recordGameplayDelta({ worldsCreated: 1 });

    this.combat.dispose();
    this.combat = this.createCombatManager(this.world.seed);
    this.wireWorldAndCombatLinks();
    this.world.villageDev.restoreState(undefined, this.world.village.villages);
    this.world.farmAnimals.restoreState(
      undefined,
      this.world.village.villages,
      this.getTotalWorldHours(),
    );
    this.syncWorldTimeImmediate();
    this.skyRig.updateSunFollow(this.controller.position);
    this.world.update(
      this.elapsed,
      this.controller.position,
      this.camera,
      0,
      this.timeManager.getWorldHours(),
      0.16,
      0.62,
      this.skyRig,
      this.getTotalWorldHours(),
      this.isCurrentlyRaining(),
    );

    // Save initial world state immediately so it appears in Load World & Continue
    this.saveManager.saveToSlot(worldId, this.captureSaveSource(true));

    this.emitInventorySnapshot();
    this.emitHud();

    this.input?.setTouchMode(this.touchModeEnabled);
    this.worldLifecycleState = 'GAMEPLAY';
    this.setPhase('playing');
    if (!this.touchModeEnabled) {
      this.input?.requestPointerLock();
    }
    return true;
  }

  public async startMultiplayerWorld(options: {
    worldName: string;
    seed: number;
    worldType: WorldType;
    difficulty: DifficultyLevel;
    worldSettingsPermission?: WorldSettingsPermission;
    worldTime?: AuthoritativeWorldTimeState;
    worldWeather?: AuthoritativeWorldWeatherState;
    localPlayerId?: string;
    players?: MultiplayerPlayer[];
  }): Promise<boolean> {
    this.multiplayerSessionActive = true;
    const cleanName = options.worldName.trim() || 'Oakhollow Co-op';
    const seed = Number.isFinite(options.seed)
      ? Math.floor(Math.abs(options.seed)) || DEFAULT_WORLD_SEED
      : DEFAULT_WORLD_SEED;
    this.authoritativeMultiplayerConfig = {
      seed,
      worldType: options.worldType,
      difficulty: options.difficulty,
    };
    this.worldSettingsPermission = options.worldSettingsPermission ?? 'HOST_ONLY';

    this.sound.unlock();
    this.sound.playUiClick();
    this.endNpcDialogue();

    const loaded = await this.ensureWorldRuntimeLoaded(seed, { x: 0, z: 4 });
    if (!loaded || !this.controller || !this.world) return false;

    this.rebuildWorldForSeed(seed);
    this.playTimeSeconds = 0;
    this.autosaveTimer = 0;
    this.playerLevel = 1;
    this.playerXp = 0;
    this.playerCoins =
      options.worldType === 'creative' ? 500 : options.worldType === 'adventure' ? 50 : 0;
    this.activeWorldName = cleanName;
    this.activeWorldType = options.worldType;
    this.activeDifficulty = options.difficulty;
    this.activeWorldCreatedAtMs = Date.now();
    this.hasUnsavedProgress = false;
    this.unsavedTimer = 0;
    this.statAccumTimeSec = 0;
    this.statAccumDistM = 0;
    this.lastStatTrackX = null;
    this.lastStatTrackZ = null;

    this.controller.setGameplayModifiers(options.difficulty, options.worldType);

    this.dialogueEngine.quests.reset();
    this.dialogueEngine.restoreFlags([]);
    this.clearStoryLocalEntities();
    this.storyManager.reset();
    this.clearSideQuestLocalEntities();
    this.sideQuestManager.reset();
    this.trackedQuestSource = 'story';
    this.aiService.resetAllMemory();
    this.seedStarterInventory();
    this.craftingManager.resetProgression();
    this.syncEquipmentBonuses();
    this.syncEquippedWeaponFromInventory();

    this.isSleeping = false;
    this.sleepTimer = 0;

    this.world.restoreImportantState({
      discoveredLandmarkIds: ['spawn-glade'],
      collectedInteractableIds: [],
      droppedPickups: [],
      placedBeds: [],
      placedStations: [],
      depletedNodes: [],
      openedChestIds: [],
    });
    this.world.wildlife.restoreKilledAnimalIds([]);

    if (options.worldTime) {
      this.timeManager.syncFromServer(options.worldTime);
    } else {
      this.timeManager.restoreState({
        worldHours: 8.5,
        dayCount: 1,
        fullDayDurationSeconds: 360,
        timeScale: 1,
        paused: false,
      });
    }
    if (options.worldWeather) {
      this.weatherManager.syncFromServer(options.worldWeather);
    } else {
      this.weatherManager.setWeather('clear', true);
      this.weatherManager.setDynamicEnabled(true);
    }

    this.controller.reset(0, 4);
    this.waypoint = null;
    this.mapManager.resetFog();
    this.mapManager.revealAround(0, 4, 195);
    this.lastFogRevealX = 0;
    this.lastFogRevealZ = 4;

    this.combat.dispose();
    this.combat = this.createCombatManager(this.world.seed);
    this.wireWorldAndCombatLinks();
    this.world.villageDev.restoreState(undefined, this.world.village.villages);
    this.world.farmAnimals.restoreState(
      undefined,
      this.world.village.villages,
      this.getTotalWorldHours(),
    );
    this.syncEquippedWeaponFromInventory();
    this.syncWorldTimeImmediate();
    this.skyRig.updateSunFollow(this.controller.position);
    this.world.update(
      this.elapsed,
      this.controller.position,
      this.camera,
      0,
      this.timeManager.getWorldHours(),
      0.16,
      0.62,
      this.skyRig,
      this.getTotalWorldHours(),
      this.isCurrentlyRaining(),
    );

    const localId =
      options.localPlayerId ?? this.multiplayerService?.getLocalPlayerId() ?? null;
    const roster =
      options.players ?? this.multiplayerService?.getRoomState()?.players ?? [];
    this.hasAppliedInitialSpawnSnapshot = false;
    this.setupMultiplayerSync(roster, localId);

    const cachedVitals = this.multiplayerService?.getLatestVitals?.();
    if (cachedVitals && cachedVitals.playerId === localId) {
      this.controller.syncAuthoritativeHealth(cachedVitals.health);
      this.combat.syncPlayerStats(cachedVitals.health, cachedVitals.maxHealth);
    }
    const cachedProg = this.multiplayerService?.getLatestProgression?.();
    if (cachedProg && cachedProg.playerId === localId) {
      this.playerCoins = Math.max(0, cachedProg.coins);
      this.playerXp = Math.max(0, cachedProg.xp);
      this.playerLevel = Math.max(1, cachedProg.level);
    }
    const cachedSnap = this.multiplayerService?.getLatestWorldSnapshot?.();
    if (cachedSnap) {
      this.applyRemoteWorldSnapshot(cachedSnap);
      this.syncLocalMultiplayerState(0.05, true);
    }

    this.emitInventorySnapshot();
    this.emitHud();

    this.input?.setTouchMode(this.touchModeEnabled);
    this.worldLifecycleState = 'GAMEPLAY';
    this.setPhase('playing');
    if (!this.touchModeEnabled) {
      this.input?.requestPointerLock();
    }
    return true;
  }

  public startNewGame(seed = DEFAULT_WORLD_SEED): void {
    void this.createNewWorld({
      worldName: 'Oakhollow Valley',
      seed,
      worldType: 'normal',
      difficulty: 'normal',
    });
  }

  public returnToMainMenu(): void {
    this.multiplayerSessionActive = false;
    this.authoritativeMultiplayerConfig = null;
    this.teardownMultiplayerSync();
    this.endNpcDialogue();
    this.modalOpen = false;
    this.input?.exitPointerLock();
    this.input?.clearAll();
    this.sound.stopWorldAmbienceSmooth(0.14);
    this.combat?.clearVillageDefenseRaiders();
    this.world?.villageDev.cancelDefense();
    this.activeFarmStructureId = null;
    this.activeVillageDevId = null;
    this.activeMerchantNpcId = null;
    this.activeMerchantVillageId = null;
    this.unloadWorld();
    this.setPhase('title');
  }

  public deleteSaveSlot(slotId: SaveSlotId): boolean {
    const existing = this.loadManager.loadSlot(slotId);
    const label = existing.ok ? existing.data.meta.worldName : this.getSlotDisplayName(slotId);
    const ok = this.saveManager.deleteSave(slotId);
    if (ok) {
      this.sound.playUiClick();
      this.callbacks.onWorldNotice(UI_TEXT[this.language].deletedNotice(label));
    }
    return ok;
  }

  public resetPlayerPosition(): void {
    this.controller.reset(0, 4);
    this.mapManager.revealAround(0, 4, 195);
    this.lastFogRevealX = 0;
    this.lastFogRevealZ = 4;
    this.syncWorldTimeImmediate();
    this.skyRig.updateSunFollow(this.controller.position);
    this.world.update(
      this.elapsed,
      this.controller.position,
      this.camera,
      0,
      this.timeManager.getWorldHours(),
    );
    this.emitHud();
  }

  private syncWorldTimeImmediate(): void {
    const hours = this.timeManager.getWorldHours();
    const weatherSnap = this.weatherManager.getSnapshot();
    if (this.world && this.controller) {
      this.world.npcs.setWorldHours(hours);
      this.world.village.update(this.elapsed, this.controller.position, hours);
    }
    if (this.skyRig) {
      this.skyRig.updateTimeOfDay(hours, this.elapsed, weatherSnap);
    }
    if (this.weatherEffects && this.controller) {
      this.weatherEffects.update(
        this.elapsed,
        this.controller.position,
        weatherSnap,
        this.timeManager.getNightFactor(),
      );
      this.atmosphericParticles?.update(
        this.elapsed,
        this.controller.position,
        weatherSnap,
        this.timeManager.getNightFactor(),
      );
    }
  }

  public getTimeSnapshot(): TimeSnapshot {
    return this.timeManager.getSnapshot();
  }

  public setTimeHours(hours: number): void {
    if (
      this.multiplayerSessionActive &&
      !this.isApplyingRemoteTimeWeather &&
      !this.canControlWorldSettings()
    ) {
      this.callbacks.onWorldNotice(UI_TEXT[this.language].mpWorldSettingsHostOnlyNotice);
      return;
    }
    this.timeManager.setWorldHours(hours);
    if (
      this.multiplayerSessionActive &&
      this.multiplayerService &&
      !this.isApplyingRemoteTimeWeather
    ) {
      this.multiplayerService.sendWorldSettingsUpdate?.({
        worldHours: this.timeManager.getWorldHours(),
      });
    }
    this.syncWorldTimeImmediate();
    this.emitHud();
  }

  public jumpToTimePreset(preset: TimePreset): void {
    if (
      this.multiplayerSessionActive &&
      !this.isApplyingRemoteTimeWeather &&
      !this.canControlWorldSettings()
    ) {
      this.callbacks.onWorldNotice(UI_TEXT[this.language].mpWorldSettingsHostOnlyNotice);
      return;
    }
    this.sound.playUiClick();
    this.timeManager.jumpToPreset(preset);
    if (
      this.multiplayerSessionActive &&
      this.multiplayerService &&
      !this.isApplyingRemoteTimeWeather
    ) {
      this.multiplayerService.sendWorldSettingsUpdate?.({ preset });
    }
    this.syncWorldTimeImmediate();
    this.emitHud();
  }

  public setFullDayDurationSeconds(seconds: number): void {
    if (
      this.multiplayerSessionActive &&
      !this.isApplyingRemoteTimeWeather &&
      !this.canControlWorldSettings()
    ) {
      this.callbacks.onWorldNotice(UI_TEXT[this.language].mpWorldSettingsHostOnlyNotice);
      return;
    }
    this.timeManager.setFullDayDurationSeconds(seconds);
    if (
      this.multiplayerSessionActive &&
      this.multiplayerService &&
      !this.isApplyingRemoteTimeWeather
    ) {
      this.multiplayerService.sendWorldSettingsUpdate?.({
        fullDayDurationSeconds: this.timeManager.getFullDayDurationSeconds(),
      });
    }
    this.emitHud();
  }

  public setTimeScale(scale: number): void {
    if (
      this.multiplayerSessionActive &&
      !this.isApplyingRemoteTimeWeather &&
      !this.canControlWorldSettings()
    ) {
      this.callbacks.onWorldNotice(UI_TEXT[this.language].mpWorldSettingsHostOnlyNotice);
      return;
    }
    this.sound.playUiClick();
    this.timeManager.setTimeScale(scale);
    if (
      this.multiplayerSessionActive &&
      this.multiplayerService &&
      !this.isApplyingRemoteTimeWeather
    ) {
      this.multiplayerService.sendWorldSettingsUpdate?.({
        timeScale: this.timeManager.getTimeScale(),
      });
    }
    this.emitHud();
  }

  public setTimePaused(paused: boolean): void {
    if (
      this.multiplayerSessionActive &&
      !this.isApplyingRemoteTimeWeather &&
      !this.canControlWorldSettings()
    ) {
      this.callbacks.onWorldNotice(UI_TEXT[this.language].mpWorldSettingsHostOnlyNotice);
      return;
    }
    this.sound.playUiClick();
    this.timeManager.setPaused(paused);
    if (
      this.multiplayerSessionActive &&
      this.multiplayerService &&
      !this.isApplyingRemoteTimeWeather
    ) {
      this.multiplayerService.sendWorldSettingsUpdate?.({
        paused: this.timeManager.isPaused(),
      });
    }
    this.emitHud();
  }

  public getWeatherSnapshot(): WeatherSnapshot {
    return this.weatherManager.getSnapshot();
  }

  public setWeatherState(state: WeatherState, immediate = false): void {
    if (
      this.multiplayerSessionActive &&
      !this.isApplyingRemoteTimeWeather &&
      !this.canControlWorldSettings()
    ) {
      this.callbacks.onWorldNotice(UI_TEXT[this.language].mpWorldSettingsHostOnlyNotice);
      return;
    }
    this.sound.playUiClick();
    this.weatherManager.setWeather(state, immediate);
    if (
      this.multiplayerSessionActive &&
      this.multiplayerService &&
      !this.isApplyingRemoteTimeWeather
    ) {
      const snap = this.weatherManager.getSnapshot();
      this.lastSyncedWeatherState = state;
      this.multiplayerService.sendWorldSettingsUpdate?.({
        weatherState: state,
        targetWeatherState: state,
        durationMs: Math.min(900_000, Math.round(snap.weatherDuration * 1000)),
      });
    }
    this.syncWorldTimeImmediate();
    this.emitHud();
  }

  public setWeatherDynamic(enabled: boolean): void {
    if (
      this.multiplayerSessionActive &&
      !this.isApplyingRemoteTimeWeather &&
      !this.canControlWorldSettings()
    ) {
      this.callbacks.onWorldNotice(UI_TEXT[this.language].mpWorldSettingsHostOnlyNotice);
      return;
    }
    this.sound.playUiClick();
    this.weatherManager.setDynamicEnabled(enabled);
    if (
      this.multiplayerSessionActive &&
      this.multiplayerService &&
      !this.isApplyingRemoteTimeWeather
    ) {
      this.multiplayerService.sendWorldSettingsUpdate?.({
        dynamicEnabled: enabled,
      });
    }
    this.emitHud();
  }

  public setWeatherTransitionDuration(seconds: number): void {
    if (
      this.multiplayerSessionActive &&
      !this.isApplyingRemoteTimeWeather &&
      !this.canControlWorldSettings()
    ) {
      this.callbacks.onWorldNotice(UI_TEXT[this.language].mpWorldSettingsHostOnlyNotice);
      return;
    }
    this.weatherManager.setTransitionDurationSeconds(seconds);
    if (
      this.multiplayerSessionActive &&
      this.multiplayerService &&
      !this.isApplyingRemoteTimeWeather
    ) {
      this.multiplayerService.sendWorldSettingsUpdate?.({
        transitionDurationSeconds: seconds,
      });
    }
    this.emitHud();
  }

  public setWeatherQuality(quality: WeatherQuality): void {
    this.sound.playUiClick();
    this.weatherManager.setQuality(quality);
    this.syncWorldTimeImmediate();
    this.emitHud();
  }

  public triggerLightningStrike(): void {
    if (
      this.multiplayerSessionActive &&
      !this.isApplyingRemoteTimeWeather &&
      !this.canControlWorldSettings()
    ) {
      this.callbacks.onWorldNotice(UI_TEXT[this.language].mpWorldSettingsHostOnlyNotice);
      return;
    }
    this.sound.unlock();
    this.weatherManager.triggerLightningStrike();
    if (
      this.multiplayerSessionActive &&
      this.multiplayerService &&
      !this.isApplyingRemoteTimeWeather
    ) {
      this.multiplayerService.sendWorldSettingsUpdate?.({
        triggerLightning: true,
      });
    }
    this.syncWorldTimeImmediate();
    this.emitHud();
  }

  public getCameraPerspective(): CameraPerspective {
    return this.cameraRig?.getPerspective() ?? this.cameraSettings.perspective;
  }

  public setCameraPerspective(
    mode: CameraPerspective,
    immediate = false,
  ): void {
    this.cameraSettings = { ...this.cameraSettings, perspective: mode };
    this.cameraRig?.setPerspective(mode, immediate);
    const ext = loadExtendedSettings();
    ext.camera.perspective = mode;
    saveExtendedSettings(ext);
    this.player?.setFirstPersonMode(
      this.cameraRig?.isFirstPersonActive() ?? false,
      this.cameraRig?.getPitch() ?? 0,
    );
    this.updateInteractionIndicatorScreenPos();
    this.emitHud();
  }

  public cycleCameraPerspective(): CameraPerspective {
    const next = this.cameraRig
      ? this.cameraRig.cyclePerspective()
      : 'third-person';
    this.sound.playUiClick();
    this.cameraSettings = { ...this.cameraSettings, perspective: next };
    const ext = loadExtendedSettings();
    ext.camera.perspective = next;
    saveExtendedSettings(ext);
    this.player?.setFirstPersonMode(
      this.cameraRig?.isFirstPersonActive() ?? false,
      this.cameraRig?.getPitch() ?? 0,
    );
    this.updateInteractionIndicatorScreenPos();
    this.callbacks.onWorldNotice(
      UI_TEXT[this.language].cameraPerspectiveNotice(next),
    );
    this.emitHud();
    return next;
  }

  public updateSettings(partial: Partial<GameSettings>): void {
    this.settings = { ...this.settings, ...partial };
    if (partial.muted !== undefined) {
      this.sound.setMuted(partial.muted);
    }
  }

  public applyExtendedSettings(ext: ExtendedGameSettings): void {
    this.footstepVolume = ext.audio.footstepVolume;
    getAudioManager().applySettings(ext.audio, { persist: false });
    this.reducedMotionEnabled = ext.accessibility.reducedMotion;
    this.vsyncEnabled = ext.vsync;
    this.cameraRig?.setBaseFov(ext.gameplay.fov);
    this.cameraRig?.setReducedMotion(ext.accessibility.reducedMotion);
    this.weatherManager.setMaxStateDurationSeconds(
      ext.gameplay.weatherMaxDurationSeconds,
    );

    if (ext.camera) {
      this.cameraSettings = { ...ext.camera };
      this.settings.mouseSensitivity = ext.camera.sensitivity;
      this.settings.invertY = ext.camera.invertY;
      this.cameraRig?.updateCameraConfig({
        distance: ext.camera.distance,
        shoulderHeight: ext.camera.height,
        smoothingScale: ext.camera.smoothing,
      });
      this.cameraRig?.setPerspective(ext.camera.perspective, false);
      this.player?.setFirstPersonMode(
        this.cameraRig?.isFirstPersonActive() ?? false,
        this.cameraRig?.getPitch() ?? 0,
      );
      this.updateInteractionIndicatorScreenPos();
    }

    this.activeDifficulty = ext.gameplay.difficulty;
    this.showBowTrajectory = ext.gameplay.showBowTrajectory;
    if (!this.showBowTrajectory) {
      this.combat?.hideBowTrajectoryPreview();
    }
    this.controller?.setGameplayModifiers(
      this.activeDifficulty,
      this.activeWorldType,
    );
    this.graphicsManager?.setDynamicQualityEnabled(ext.dynamicQuality);
    this.setWorldGenDebugEnabled(
      import.meta.env.DEV ? Boolean(ext.gameplay.showWorldGenDebug) : false,
    );
    this.biomeDebugEnabled = Boolean(ext.gameplay.showBiomeDebug);
    this.showPlayerNamesSetting = Boolean(ext.gameplay.showPlayerNames);
    this.showFriendsOnMapSetting = Boolean(ext.gameplay.showFriendsOnMap);
    this.showPartyMembersOnMapSetting = Boolean(ext.gameplay.showPartyMembersOnMap ?? true);
    this.remotePlayersManager?.setShowPlayerNames(this.showPlayerNamesSetting);
    this.world?.setBiomeDebugEnabled(this.biomeDebugEnabled);
    this.emitHud();
  }

  private setWorldGenDebugEnabled(enabled: boolean): void {
    const effective = import.meta.env.DEV && enabled;
    this.worldGenDebugEnabled = effective;
    if (!effective) {
      this.worldGenDebugRenderer?.setVisible(false);
      return;
    }
    this.refreshWorldGenDebugRenderer();
  }

  private refreshWorldGenDebugRenderer(): void {
    if (!import.meta.env.DEV || !this.scene || !this.world) return;
    if (!this.worldGenDebugRenderer) {
      this.worldGenDebugRenderer = new WorldGenDebugRenderer(this.scene);
    }
    const reports = this.world.village.getBuildingValidationReports();
    this.worldGenDebugRenderer.rebuild(
      this.world.village.villages,
      this.world.interactables,
      getWorldGenTelemetry(),
      reports,
    );
    this.lastDebugLoadedVillagesKey = this.world.village.villages
      .map((v) => (v.isLoaded ? v.id : ''))
      .join('|');
    this.worldGenDebugRenderer.setVisible(this.worldGenDebugEnabled);
  }

  public handleScreenTap(clientX: number, clientY: number): boolean {
    if (
      !this.world ||
      !this.camera ||
      !this.renderer ||
      !this.controller ||
      this.phase !== 'playing' ||
      this.modalOpen ||
      this.isSleeping
    ) {
      return false;
    }
    const targets = this.world.village.getDoorRaycastTargets();
    if (targets.length === 0) return false;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    this.tapNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.tapRaycaster.setFromCamera(this.tapNdc, this.camera);
    const hits = this.tapRaycaster.intersectObjects(targets, false);
    if (hits.length === 0) return false;
    const doorId = hits[0].object.userData?.doorId;
    if (typeof doorId !== 'string') return false;
    const doorInter = this.interactables.find(
      (it) => it.kind === 'door' && it.id === doorId && !it.collected,
    );
    if (!doorInter) return false;
    const dx = this.controller.position.x - doorInter.x;
    const dz = this.controller.position.z - doorInter.z;
    const maxDist = Math.max(4.4, doorInter.radius + 1.4);
    if (dx * dx + dz * dz > maxDist * maxDist) {
      return false;
    }
    this.executeInteraction(doorInter);
    return true;
  }

  public updateMobileSettings(next: MobileControlSettings): void {
    this.mobileSettings = next;
    this.input?.mobile.setControlMode(next.movementControlMode);
    this.cameraRig?.updatePortraitConfig(next.portraitCamera);
  }

  public advanceDialogue(): void {
    this.sound.playUiClick();
    const nextSnapshot = this.dialogueEngine.next();
    if (!nextSnapshot) {
      this.world?.npcs.endDialogue();
      if (this.multiplayerSessionActive && this.activeDialogueNpcId) {
        this.multiplayerService?.sendNpcDialogueState?.(this.activeDialogueNpcId, 'idle');
      }
      this.activeDialogueNpcId = null;
    }
    this.callbacks.onDialogueChange(nextSnapshot);
    this.emitHud();
  }

  public selectDialogueChoice(choiceId: string): void {
    this.sound.playUiClick();
    const nextSnapshot = this.dialogueEngine.selectChoice(choiceId);
    if (!nextSnapshot) {
      this.world?.npcs.endDialogue();
      if (this.multiplayerSessionActive && this.activeDialogueNpcId) {
        this.multiplayerService?.sendNpcDialogueState?.(this.activeDialogueNpcId, 'idle');
      }
      this.activeDialogueNpcId = null;
    }
    this.callbacks.onDialogueChange(nextSnapshot);
    this.emitHud();
  }

  public endNpcDialogue(): void {
    this.dialogueEngine.close();
    this.world?.npcs.endDialogue();
    if (this.multiplayerSessionActive && this.activeDialogueNpcId) {
      this.multiplayerService?.sendNpcDialogueState?.(this.activeDialogueNpcId, 'idle');
    }
    this.activeDialogueNpcId = null;
    this.callbacks.onDialogueChange(null);
    this.emitHud();
  }

  public getAiWorldContext(): AIWorldContext {
    const pos = this.controller?.position;
    const biome = pos ? getBiomeAt(pos.x, pos.z) : 'Plains';
    const timeSnap = this.timeManager.getSnapshot();
    const weatherSnap = this.weatherManager.getSnapshot();
    const activeQuests = this.dialogueEngine.quests
      .getActiveQuests(this.dialogueBridge)
      .map((q) => q.title);
    const completedQuests = this.dialogueEngine.quests
      .getCompletedQuests(this.dialogueBridge)
      .map((q) => q.title);

    return {
      biome,
      timeOfDay: `${timeSnap.formattedTime} (Day ${timeSnap.dayCount})`,
      weather: weatherSnap.currentState,
      playerLevel: this.playerLevel,
      activeQuests,
      completedQuests,
    };
  }

  public setTrackedQuest(questId: string | null): void {
    if (questId && questId.startsWith('story-')) {
      this.trackedQuestSource = 'story';
      this.storyManager.setTrackedQuest(questId);
    } else if (questId && questId.startsWith('sq-')) {
      this.trackedQuestSource = 'sidequest';
      this.sideQuestManager.setTrackedSideQuest(questId);
    } else if (questId) {
      this.trackedQuestSource = 'side';
      this.dialogueEngine.quests.setTrackedQuest(questId);
    } else {
      this.storyManager.setTrackedQuest(null);
      this.sideQuestManager.setTrackedSideQuest(null);
      this.dialogueEngine.quests.setTrackedQuest(null);
    }
    this.emitHud();
  }

  public getSideQuestJournalData(): SideQuestJournalSnapshot {
    return this.sideQuestManager.getJournalSnapshot(
      this.sideQuestBridge,
      this.language,
    );
  }

  public acceptSideQuest(sideQuestId: string): boolean {
    const ok = this.sideQuestManager.acceptQuest(
      sideQuestId,
      this.sideQuestBridge,
      (msg) => this.callbacks.onWorldNotice(msg),
    );
    if (ok) {
      this.trackedQuestSource = 'sidequest';
      this.hasUnsavedProgress = true;
      this.syncSideQuestLocalEntities();
      this.syncAuthoritativeEntities(true);
      this.emitMultiplayerSideQuestUpdate(sideQuestId);
      this.emitHud();
    }
    return ok;
  }

  public completeSideQuest(sideQuestId: string): boolean {
    const ok = this.sideQuestManager.completeQuest(
      sideQuestId,
      this.sideQuestBridge,
      (msg) => this.callbacks.onWorldNotice(msg),
    );
    if (ok) {
      this.hasUnsavedProgress = true;
      this.syncEquipmentBonuses();
      this.syncEquippedWeaponFromInventory();
      this.emitInventorySnapshot();
      this.syncSideQuestLocalEntities();
      this.syncAuthoritativeEntities(true);
      this.emitHud();
    }
    return ok;
  }

  public abandonSideQuest(sideQuestId: string): boolean {
    const ok = this.sideQuestManager.abandonQuest(
      sideQuestId,
      this.sideQuestBridge,
      (msg) => this.callbacks.onWorldNotice(msg),
    );
    if (ok) {
      this.hasUnsavedProgress = true;
      this.syncSideQuestLocalEntities();
      this.syncAuthoritativeEntities(true);
      this.emitMultiplayerSideQuestUpdate(sideQuestId);
      this.emitHud();
    }
    return ok;
  }

  public retrySideQuest(sideQuestId: string): boolean {
    if (sideQuestId === 'sq-missing-merchant') {
      this.world?.npcs.reviveSideQuestNpc('npc-sq-tariq');
    }
    const ok = this.sideQuestManager.retryQuest(
      sideQuestId,
      this.sideQuestBridge,
      (msg) => this.callbacks.onWorldNotice(msg),
    );
    if (ok) {
      this.trackedQuestSource = 'sidequest';
      this.hasUnsavedProgress = true;
      this.syncSideQuestLocalEntities();
      this.syncAuthoritativeEntities(true);
      this.emitMultiplayerSideQuestUpdate(sideQuestId);
      this.emitHud();
    }
    return ok;
  }

  public getStoryJournalData(): StoryJournalSnapshot {
    return this.storyManager.getJournalSnapshot(this.language);
  }

  public startStoryQuest(questId: string): boolean {
    const ok = this.storyManager.startQuest(
      questId,
      (msg) => this.callbacks.onWorldNotice(msg),
    );
    if (ok) {
      this.storyManager.update(this.storyBridge, (msg) =>
        this.callbacks.onWorldNotice(msg),
      );
      this.trackedQuestSource = 'story';
      this.hasUnsavedProgress = true;
      this.syncStoryLocalEntities();
      this.syncAuthoritativeEntities(true);
      this.emitHud();
    }
    return ok;
  }

  public retryStoryQuest(questId: string): boolean {
    if (questId === 'story-ch4-q1' && this.world) {
      const guard = this.world.npcs.npcs.find((n) => n.id === 'npc-pinehaven-guard-3');
      if (guard && guard.isDead) {
        guard.isDead = false;
        guard.rig.root.visible = true;
      }
    }
    const ok = this.storyManager.retryFailedQuest(
      questId,
      (msg) => this.callbacks.onWorldNotice(msg),
    );
    if (ok) {
      this.trackedQuestSource = 'story';
      this.hasUnsavedProgress = true;
      this.syncStoryLocalEntities();
      this.syncAuthoritativeEntities(true);
      this.emitHud();
    }
    return ok;
  }

  public recordEnemyKill(enemyType: string, targetEntityId?: string): void {
    const sideChanged = this.dialogueEngine.quests.onEnemyKilled(
      enemyType,
      this.dialogueBridge,
      (msg) => this.callbacks.onWorldNotice(msg),
      targetEntityId,
    );
    const storyChanged = this.storyManager.onEnemyKilled(
      enemyType,
      targetEntityId,
      (msg) => this.callbacks.onWorldNotice(msg),
    );
    const sideQuestChanged = this.sideQuestManager.onEnemyKilled(
      enemyType,
      targetEntityId,
      (msg) => this.callbacks.onWorldNotice(msg),
    );
    if (sideQuestChanged) {
      this.sideQuestManager.update(
        this.sideQuestBridge,
        (msg) => this.callbacks.onWorldNotice(msg),
      );
      this.syncSideQuestLocalEntities();
    }
    if (targetEntityId?.startsWith('vdef_')) {
      const defRes = this.world?.villageDev.onDefenseEnemyDefeated();
      if (defRes) {
        const village = this.world?.village.villages.find((v) => v.id === defRes.villageId);
        const vName = village ? this.getLocalizedVillageDisplayName(village) : defRes.villageId;
        if (defRes.completed) {
          this.sound.playVillageUpgrade(this.controller?.position);
          if (village?.isLoaded) {
            this.world.villageDev.rebuildVillageAddons(village);
          }
          if (this.multiplayerSessionActive && this.multiplayerService) {
            this.multiplayerService.sendVillageDefenseWon?.(defRes.villageId);
          } else {
            this.awardXpAndCoins(50, 45);
            ProfileManager.recordGameplayDelta({ xpGained: 50 });
          }
          this.callbacks.onWorldNotice(UI_TEXT[this.language].villageDefenseWonNotice(vName));
          if (defRes.leveledUp) {
            this.callbacks.onWorldNotice(
              UI_TEXT[this.language].villageUpgradeLevelNotice(vName, defRes.newLevel),
            );
          }
        } else {
          const rem = this.world?.villageDev.getActiveDefense()?.remainingEnemies ?? 0;
          this.callbacks.onWorldNotice(UI_TEXT[this.language].villageDefenseProgressNotice(rem));
        }
        this.callbacks.onFarmOrVillageStateChange?.();
        this.hasUnsavedProgress = true;
      }
    }
    this.syncAuthoritativeEntities(true);
    if (sideChanged || storyChanged || sideQuestChanged) {
      this.hasUnsavedProgress = true;
      this.emitHud();
    }
  }

  public getQuestJournalData(): {
    active: QuestView[];
    completed: QuestView[];
    available: QuestView[];
  } {
    return {
      active: this.dialogueEngine.quests.getActiveQuests(this.dialogueBridge),
      completed: this.dialogueEngine.quests.getCompletedQuests(this.dialogueBridge),
      available: this.dialogueEngine.quests.getAvailableQuests(this.dialogueBridge),
    };
  }

  public getJournalQuests(): QuestView[] {
    return [
      ...this.dialogueEngine.quests.getActiveQuests(this.dialogueBridge),
      ...this.dialogueEngine.quests.getCompletedQuests(this.dialogueBridge),
    ];
  }

  public startCooperativeQuest(questId: string): boolean {
    const def = getQuestDefinition(questId);
    if (!def || def.scope !== 'cooperative') return false;
    if (this.multiplayerSessionActive && this.multiplayerService?.startCoopQuest) {
      return this.multiplayerService.startCoopQuest(questId);
    }
    const ok = this.dialogueEngine.quests.acceptQuest(questId, this.dialogueBridge);
    if (ok) {
      this.emitHud();
    }
    return ok;
  }

  public completeCooperativeQuest(questId: string): boolean {
    const def = getQuestDefinition(questId);
    if (!def || def.scope !== 'cooperative') return false;
    if (this.multiplayerSessionActive && this.multiplayerService?.completeCoopQuest) {
      return this.multiplayerService.completeCoopQuest(questId);
    }
    const ok = this.dialogueEngine.quests.completeQuest(questId, this.dialogueBridge, {
      consumeItem: this.dialogueBridge.consumeItem,
      giveItem: this.dialogueBridge.giveItem,
      grantRewards: this.dialogueBridge.grantRewards,
      notify: this.dialogueBridge.notify,
    });
    if (ok) {
      this.emitInventorySnapshot();
      this.emitHud();
    }
    return ok;
  }

  public getCoopQuests(): CoopQuestStateRecord[] {
    return this.dialogueEngine.quests.getCoopQuestStates();
  }

  public getBossEncounters(): BossEncounterState[] {
    return Array.from(this.activeBossEncounters.values());
  }

  private setPhase(next: GamePhase): void {
    this.phase = next;
    if (next !== 'playing') {
      this.cancelActiveBowCharge(false);
      this.exitBuildMode();
    }
    const audioMode =
      next === 'title'
        ? 'menu'
        : next === 'loading'
          ? 'loading'
          : next === 'paused'
            ? 'paused'
            : 'world';
    getAudioManager().setSceneMode(audioMode);
    this.input?.setActive(next === 'playing' && !this.modalOpen);
    this.callbacks.onPhaseChange(next);
  }

  private tick = (now = performance.now()): void => {
    if (
      this.disposed ||
      !this.worldRuntimeLoaded ||
      !this.renderer ||
      !this.scene ||
      !this.camera ||
      !this.world ||
      !this.controller
    ) {
      return;
    }

    const resolvedFpsCap = this.graphicsManager?.getProfile().effectiveFpsLimit ?? 60;
    const fpsLimit = resolvedFpsCap > 0 ? resolvedFpsCap : this.vsyncEnabled ? 60 : 0;
    if (!this.isSoftwareGl && fpsLimit > 0 && this.lastRenderTimeMs > 0) {
      const minInterval = 1000 / fpsLimit;
      if (now - this.lastRenderTimeMs < minInterval - 0.8) {
        this.frameId = requestAnimationFrame(this.tick);
        return;
      }
    }
    this.lastRenderTimeMs = now;
    this.performanceMonitor.recordFrame(now);

    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);

    if (this.phase !== 'paused') {
      this.elapsed += dt;
      this.updateDust(dt);
    }

    let weatherSnap = this.weatherManager.getSnapshot();

    if (this.phase === 'title') {
      this.cameraRig.updateTitleOrbit(dt, this.controller.position);
      this.skyRig.updateTimeOfDay(
        this.timeManager.getWorldHours(),
        this.elapsed,
        weatherSnap,
      );
      this.skyRig.updateSunFollow(this.controller.position);
      this.weatherEffects.update(
        this.elapsed,
        this.controller.position,
        weatherSnap,
        this.timeManager.getNightFactor(),
      );
      this.atmosphericParticles.update(
        this.reducedMotionEnabled ? this.elapsed * 0.25 : this.elapsed,
        this.controller.position,
        weatherSnap,
        this.timeManager.getNightFactor(),
      );
      this.sound.stopWorldAmbienceSmooth(0.16);
      const groundY = groundHeightAt(
        this.controller.position.x,
        this.controller.position.z,
      );
      this.player.updateAnimation(dt, 0, true, 0, 'idle', groundY);
    } else if (this.phase === 'playing') {
      if (this.isSleeping) {
        this.sleepTimer += dt;
        this.controller.updateIdleOnly(dt);
        this.sound.stopWorldAmbienceSmooth(0.16);
        if (this.sleepTimer >= this.SLEEP_DURATION_SEC) {
          this.completeSleepTransition();
        } else {
          this.emitHud();
        }
      } else if (!this.modalOpen) {
        this.updateGameplay(dt);
        weatherSnap = this.weatherManager.getSnapshot();
      } else {
        this.controller.updateIdleOnly(dt);
        this.sound.stopWorldAmbienceSmooth(0.16);
      }
      if (this.multiplayerSessionActive) {
        this.remotePlayersManager?.update(dt, Date.now(), this.controller.position);
      }
    } else {
      this.sound.stopWorldAmbienceSmooth(0.16);
    }

    this.world.update(
      this.elapsed,
      this.controller.position,
      this.camera,
      this.phase === 'paused' ? 0 : dt,
      this.timeManager.getWorldHours(),
      weatherSnap.atmosphere.windStrength,
      weatherSnap.windAngleRad,
      this.skyRig,
      this.getTotalWorldHours(),
      weatherSnap.currentState === 'rain' || weatherSnap.currentState === 'storm',
    );
    if (import.meta.env.DEV && this.worldGenDebugEnabled && this.worldGenDebugRenderer) {
      let loadedKey = '';
      const vs = this.world.village.villages;
      for (let i = 0; i < vs.length; i++) {
        loadedKey += vs[i].isLoaded ? `${vs[i].id}|` : '|';
      }
      if (loadedKey !== this.lastDebugLoadedVillagesKey) {
        this.refreshWorldGenDebugRenderer();
      }
    }
    if (this.postProcessing && !this.isSoftwareGl) {
      this.postProcessing.update(
        this.timeManager.getNightFactor(),
        weatherSnap.lightningFlash,
      );
      this.postProcessing.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    if (this.debugOverlayEnabled) {
      this.objectCountTimer += dt;
      if (this.objectCountTimer >= 1.0) {
        this.objectCountTimer = 0;
        let objCount = 0;
        this.scene.traverseVisible(() => {
          objCount++;
        });
        this.cachedActiveObjects = objCount;
      }
      this.debugEmitTimer += dt;
      if (this.debugEmitTimer >= 0.25) {
        this.debugEmitTimer = 0;
        this.callbacks.onDebugPerfUpdate?.(this.getDebugPerformanceSnapshot());
      }
    }

    this.scheduleNextFrame();
  };

  private scheduleNextFrame(): void {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private updateGameplay(dt: number): void {
    this.playTimeSeconds += dt;
    this.unsavedTimer += dt;
    if (this.unsavedTimer >= 2.0) {
      this.hasUnsavedProgress = true;
    }
    if (!this.multiplayerSessionActive) {
      this.autosaveTimer += dt;
      if (this.autosaveTimer >= 45) {
        this.autosaveTimer = 0;
        // Save silently back to active world so Continue & Load World stay up to date
        const targetSlot = this.activeSaveSlot || 'autosave';
        this.saveManager.saveToSlot(targetSlot, this.captureSaveSource(false));
        this.hasUnsavedProgress = false;
        this.unsavedTimer = 0;
      }
    }

    const input = this.input.consumeInput(this.settings, this.mobileSettings, dt);

    if (this.buildModeActive) {
      if (input.attack) {
        this.confirmBuildPlacement();
      }
      input.attack = false;
      input.attackHeld = false;
      input.attackReleased = false;
      input.attackCancel = false;
    }

    // Update nearby interactables before controller processes interact trigger
    this.updateProximityInteractables();

    this.handleBowChargeInput(dt, input);
    this.player.setSecondPersonMode(
      this.cameraRig.getPerspective() === 'second-person',
    );
    this.controller.update(dt, input);
    if (this.buildModeActive) {
      this.updateBuildPreview();
    }
    this.player.setFirstPersonMode(
      this.cameraRig.isFirstPersonActive(),
      this.cameraRig.getPitch(),
    );
    this.updateInteractionIndicatorScreenPos();
    if (this.combat.isChargingBow()) {
      this.updateBowAimAndTrajectoryPreview();
    }
    const px = this.controller.position.x;
    const pz = this.controller.position.z;
    this.statAccumTimeSec += dt;
    if (this.lastStatTrackX !== null && this.lastStatTrackZ !== null) {
      const stepDist = Math.hypot(px - this.lastStatTrackX, pz - this.lastStatTrackZ);
      if (stepDist > 0.01 && stepDist < 35) {
        this.statAccumDistM += stepDist;
      }
    }
    this.lastStatTrackX = px;
    this.lastStatTrackZ = pz;
    if (this.statAccumTimeSec >= 5) {
      const wholeSec = Math.floor(this.statAccumTimeSec);
      const wholeDist = Math.floor(this.statAccumDistM);
      this.statAccumTimeSec -= wholeSec;
      this.statAccumDistM -= wholeDist;
      if (wholeSec > 0 || wholeDist > 0) {
        ProfileManager.recordGameplayDelta({
          ...(wholeSec > 0 ? { playTimeSeconds: wholeSec } : {}),
          ...(wholeDist > 0 ? { distanceTraveledMeters: wholeDist } : {}),
        });
      }
    }
    if (
      !Number.isFinite(this.lastFogRevealX) ||
      !Number.isFinite(this.lastFogRevealZ) ||
      (px - this.lastFogRevealX) ** 2 + (pz - this.lastFogRevealZ) ** 2 > 16 * 16
    ) {
      this.mapManager.revealAround(px, pz, 190);
      this.lastFogRevealX = px;
      this.lastFogRevealZ = pz;
    }

    this.syncMultiplayerCombatTargets();
    this.combat.syncPlayerStats(
      this.controller.getHealth(),
      this.controller.getMaxHealth(),
    );
    this.combat.update(
      dt,
      this.elapsed,
      this.controller.position,
      this.camera,
      this.queryCollidersCb,
      this.isVillageClearanceCb,
    );
    this.timeManager.update(dt);
    this.weatherManager.update(dt, getBiomeAt(px, pz));
    const weatherSnap = this.weatherManager.getSnapshot();
    if (
      this.multiplayerSessionActive &&
      this.multiplayerService &&
      !this.isApplyingRemoteTimeWeather &&
      this.isLocalMultiplayerHost() &&
      weatherSnap.currentState !== this.lastSyncedWeatherState
    ) {
      this.lastSyncedWeatherState = weatherSnap.currentState;
      this.multiplayerService.sendWorldSettingsUpdate?.({
        weatherState: weatherSnap.currentState,
        targetWeatherState: weatherSnap.targetState,
        durationMs: Math.min(900_000, Math.round(weatherSnap.weatherDuration * 1000)),
      });
    }
    this.sound.updateListener(
      this.controller.position,
      this.cameraRig?.getYaw() ?? this.controller.getYaw(),
    );
    this.envAudioTimer += dt;
    if (this.envAudioTimer >= 0.2) {
      this.envAudioTimer = 0;
      const py = this.controller.position.y;
      const envCtx = this.world.sampleEnvironmentAudioContext(px, py, pz);
      const recentCombat = Math.max(0, 1 - (this.elapsed - this.lastCombatEventElapsed) / 4.5);
      const combatIntensity = Math.max(
        recentCombat,
        this.combat.getCombatIntensity(this.controller.position),
      );
      getAudioManager().updateEnvironment({
        active: true,
        elapsed: this.elapsed,
        biome: getBiomeAt(px, pz),
        rainIntensity: weatherSnap.atmosphere.rainIntensity,
        windStrength: weatherSnap.atmosphere.windStrength,
        isStorm: weatherSnap.currentState === 'storm',
        nightFactor: this.timeManager.getNightFactor(),
        villageProximity: envCtx.villageProximity,
        waterProximity: envCtx.waterProximity,
        caveFactor: envCtx.caveFactor,
        altitudeMeters: envCtx.altitudeMeters,
        indoorFactor: envCtx.indoorFactor,
        combatIntensity,
      });
    }
    this.skyRig.updateTimeOfDay(
      this.timeManager.getWorldHours(),
      this.elapsed,
      weatherSnap,
    );
    this.skyRig.updateSunFollow(this.controller.position);
    this.weatherEffects.update(
      this.elapsed,
      this.controller.position,
      weatherSnap,
      this.timeManager.getNightFactor(),
    );
    this.atmosphericParticles.update(
      this.elapsed,
      this.controller.position,
      weatherSnap,
      this.timeManager.getNightFactor(),
    );

    // Evaluate rolling FPS & dynamically adapt quality with hysteresis + cooldown
    if (this.graphicsManager) {
      const adapt = this.graphicsManager.evaluateDynamicFps(
        dt,
        this.elapsed,
        this.performanceMonitor.getSmoothedFps(),
        this.performanceMonitor.hasWarmSamples(),
      );
      if (adapt.adapted) {
        this.applyResolvedProfile(adapt.profile, {
          texturesChanged: adapt.texturesChanged,
          vegetationChanged: adapt.vegetationChanged,
          shadowMapSizeChanged: adapt.shadowMapSizeChanged,
          emitCallback: true,
        });
      }
    }

    // Evaluate spatial/collection quest objectives ~6Hz
    this.questEvalTimer += dt;
    let questChanged = false;
    if (this.questEvalTimer >= 0.16) {
      this.questEvalTimer = 0;
      const isIndoor =
        this.world.sampleEnvironmentAudioContext(
          px,
          this.controller.position.y,
          pz,
        ).indoorFactor >= 0.45;
      if (isIndoor && !this.lastIndoorState) {
        this.enteredBuildingRecently = true;
      }
      this.lastIndoorState = isIndoor;

      const sideChanged = this.dialogueEngine.quests.update(
        this.dialogueBridge,
        (msg) => this.callbacks.onWorldNotice(msg),
      );
      this.syncStoryLocalEntities();
      const storyChanged = this.storyManager.update(
        this.storyBridge,
        (msg) => this.callbacks.onWorldNotice(msg),
      );
      const sideQuestChanged = this.sideQuestManager.update(
        this.sideQuestBridge,
        (msg) => this.callbacks.onWorldNotice(msg),
      );
      this.syncSideQuestLocalEntities();
      this.enteredBuildingRecently = false;
      questChanged = sideChanged || storyChanged || sideQuestChanged;
      if (storyChanged || sideQuestChanged) {
        this.hasUnsavedProgress = true;
      }
    }

    this.questTargetSyncTimer += dt;
    this.authoritativeSyncTimer += dt;
    const syncInterval = this.simThrottleScale >= 2 ? 0.35 : 0.18;
    const targetEnsureInterval = this.simThrottleScale >= 2 ? 0.55 : 0.38;
    if (questChanged || this.questTargetSyncTimer >= targetEnsureInterval) {
      this.questTargetSyncTimer = 0;
      this.authoritativeSyncTimer = 0;
      this.syncAuthoritativeEntities(true);
    } else if (this.authoritativeSyncTimer >= syncInterval) {
      this.authoritativeSyncTimer = 0;
      this.syncAuthoritativeEntities(false);
    }

    if (this.multiplayerSessionActive) {
      this.syncLocalMultiplayerState(dt);
    }

    // Emit HUD snapshot (~13Hz or immediately on interactable/quest/combat target/cooldown/bow charge change)
    this.hudEmitTimer += dt;
    const nearbyId = this.nearbyInteractable?.id ?? null;
    const combatTarget = this.combat.getHudTarget();
    const combatKey = combatTarget ? `${combatTarget.id}:${combatTarget.health}` : null;
    const cooldownActive = this.combat.getAttackCooldownRatio() > 0;
    const bowCharging = this.combat.isChargingBow();
    const bowChargePct = bowCharging
      ? Math.round(this.combat.getBowChargeProgress() * 100)
      : -1;
    const bowTargetType = bowCharging ? this.bowTargetType : 'none';
    const activePerspective = this.cameraRig.getPerspective();
    const nearbyStruct = !this.buildModeActive
      ? (this.world.buildings.getNearestManageableStructure(px, this.controller.position.y, pz, 5.2)?.id ?? null)
      : null;
    const buildDigest = this.buildModeActive
      ? `${this.selectedBlueprintId}:${Boolean(this.lastBuildValidation?.valid)}:${this.lastBuildValidation?.reason ?? ''}:${Math.round(this.buildYaw * 100)}`
      : '';
    if (
      this.hudEmitTimer >= 0.075 ||
      nearbyId !== this.lastNearbyId ||
      nearbyStruct !== this.lastNearbyStructureId ||
      buildDigest !== this.lastBuildValidationDigest ||
      combatKey !== this.lastCombatTargetKey ||
      cooldownActive !== this.lastCooldownActive ||
      bowCharging !== this.lastBowCharging ||
      (bowCharging && Math.abs(bowChargePct - this.lastBowChargePct) >= 3) ||
      bowTargetType !== this.lastBowTargetType ||
      activePerspective !== this.lastCameraPerspective ||
      Math.abs(this.indicatorX - this.lastIndicatorX) >= 0.25 ||
      Math.abs(this.indicatorY - this.lastIndicatorY) >= 0.25 ||
      questChanged
    ) {
      this.hudEmitTimer = 0;
      this.lastNearbyId = nearbyId;
      this.lastNearbyStructureId = nearbyStruct;
      this.lastBuildValidationDigest = buildDigest;
      this.lastCombatTargetKey = combatKey;
      this.lastCooldownActive = cooldownActive;
      this.lastBowCharging = bowCharging;
      this.lastBowChargePct = bowChargePct;
      this.lastBowTargetType = bowTargetType;
      this.lastCameraPerspective = activePerspective;
      this.lastIndicatorX = this.indicatorX;
      this.lastIndicatorY = this.indicatorY;
      this.emitHud();
    }
  }

  private updateInteractionIndicatorScreenPos(): void {
    if (!this.camera || !this.cameraRig || !this.controller) return;
    const mode = this.cameraRig.getPerspective();
    if (mode === 'first-person') {
      this.indicatorX = 50;
      this.indicatorY = 50;
      return;
    }

    const ox = this.cameraSettings.interactionIndicatorOffsetX;
    const oy = this.cameraSettings.interactionIndicatorOffsetY;
    const oz = this.cameraSettings.interactionIndicatorOffsetZ;

    if (mode === 'second-person') {
      const depthScale = 1 / Math.max(0.6, 1 + oz * 0.25);
      const rawX = 50 + ox * 16 * depthScale;
      const rawY = 50 - oy * 16 * depthScale;
      this.indicatorX = Math.round(Math.max(22, Math.min(78, rawX)) * 10) / 10;
      this.indicatorY = Math.round(Math.max(20, Math.min(80, rawY)) * 10) / 10;
      return;
    }

    // Third Person: project world-space offset point to the side of the player character
    this.camera.updateMatrixWorld();
    this.camera.getWorldDirection(this._camForwardVec);
    this._camRightVec.crossVectors(this._camForwardVec, this.camera.up).normalize();
    this._camUpVec.crossVectors(this._camRightVec, this._camForwardVec).normalize();

    const depth = Math.max(2.5, 7.5 + oz * 2.5);
    this._indicatorWorld
      .set(
        this.controller.position.x,
        this.controller.position.y + 1.48,
        this.controller.position.z,
      )
      .addScaledVector(this._camForwardVec, depth)
      .addScaledVector(this._camRightVec, ox * 1.65)
      .addScaledVector(this._camUpVec, oy * 1.35);

    this._indicatorWorld.project(this.camera);
    const rawX = (this._indicatorWorld.x * 0.5 + 0.5) * 100;
    const rawY = (-this._indicatorWorld.y * 0.5 + 0.5) * 100;
    this.indicatorX = Math.round(Math.max(22, Math.min(78, rawX)) * 10) / 10;
    this.indicatorY = Math.round(Math.max(20, Math.min(80, rawY)) * 10) / 10;
  }

  private computeCameraCenterAimTarget(
    maxRange: number,
  ): 'none' | 'enemy' | 'animal' | 'npc' {
    this.camera.updateMatrixWorld();
    const perspective = this.cameraRig?.getPerspective() ?? 'third-person';
    let minT: number;

    if (perspective === 'second-person') {
      // In Second Person the camera faces the player, so cast forward from player eye along player forward aim
      const camYaw = this.cameraRig.getYaw();
      const pitch = this.cameraRig.getPitch();
      const cosP = Math.cos(pitch);
      this._camRayOrigin.set(
        this.controller.position.x,
        this.controller.position.y + 1.48,
        this.controller.position.z,
      );
      this._camRayDir
        .set(-Math.sin(camYaw) * cosP, -Math.sin(pitch), -Math.cos(camYaw) * cosP)
        .normalize();
      minT = 0.55;
    } else {
      // In First Person & Third Person, cast directly through the HUD indicator NDC so visual marker and aim agree 100%
      const ndcX = (this.indicatorX / 100) * 2 - 1;
      const ndcY = -((this.indicatorY / 100) * 2 - 1);
      this._aimNdc.set(ndcX, ndcY);
      this._aimRaycaster.setFromCamera(this._aimNdc, this.camera);
      this._camRayOrigin.copy(this._aimRaycaster.ray.origin);
      this._camRayDir.copy(this._aimRaycaster.ray.direction);
      const playerDist = this._camRayOrigin.distanceTo(this.controller.position);
      minT =
        perspective === 'first-person' ? 0.55 : Math.max(1.0, playerDist - 0.45);
    }

    let bestT = maxRange;
    let bestType: 'none' | 'enemy' | 'animal' | 'npc' = 'none';

    // 1. March terrain & world colliders first so walls/hills block targets behind them
    const stepLen = 1.65;
    let prevT = minT;
    this._prevCamSample
      .copy(this._camRayOrigin)
      .addScaledVector(this._camRayDir, prevT);

    for (let t = minT + stepLen; t <= maxRange + stepLen * 0.5; t += stepLen) {
      const clampedT = Math.min(maxRange, t);
      this._currCamSample
        .copy(this._camRayOrigin)
        .addScaledVector(this._camRayDir, clampedT);

      const midX = (this._prevCamSample.x + this._currCamSample.x) * 0.5;
      const midZ = (this._prevCamSample.z + this._currCamSample.z) * 0.5;
      const colliders: WorldCollider[] = this.queryCollidersCb(midX, midZ);
      const colFrac = BowWeapon.intersectSegmentColliders(
        this._prevCamSample,
        this._currCamSample,
        colliders,
        0.06,
        this._camHitScratch,
      );
      if (colFrac !== null) {
        bestT = prevT + (clampedT - prevT) * colFrac;
        break;
      }

      const terrainY = groundHeightAt(this._currCamSample.x, this._currCamSample.z);
      const surfaceY = Math.max(WATER_LEVEL, terrainY);
      if (this._currCamSample.y <= surfaceY) {
        const denom = this._prevCamSample.y - this._currCamSample.y;
        const frac =
          denom > 0.0001
            ? Math.max(0, Math.min(1, (this._prevCamSample.y - surfaceY) / denom))
            : 1;
        bestT = prevT + (clampedT - prevT) * frac;
        break;
      }

      prevT = clampedT;
      this._prevCamSample.copy(this._currCamSample);
      if (clampedT >= maxRange) break;
    }

    // 2. Test enemies along unobstructed ray [minT .. bestT]
    const ox = this._camRayOrigin.x;
    const oy = this._camRayOrigin.y;
    const oz = this._camRayOrigin.z;
    const dx = this._camRayDir.x;
    const dy = this._camRayDir.y;
    const dz = this._camRayDir.z;
    const hLenSq = dx * dx + dz * dz;

    const enemies = this.combat.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (!enemy.health.isAlive()) continue;
      const t =
        hLenSq > 0.0001
          ? ((enemy.position.x - ox) * dx + (enemy.position.z - oz) * dz) / hLenSq
          : Math.abs(dy) > 0.0001
            ? (enemy.position.y + enemy.hitHeight * 0.5 - oy) / dy
            : -1;
      if (t < minT || t >= bestT) continue;
      const hx = ox + dx * t;
      const hy = oy + dy * t;
      const hz = oz + dz * t;
      const ex = hx - enemy.position.x;
      const ez = hz - enemy.position.z;
      const rad = enemy.hitRadius + 0.25;
      if (
        ex * ex + ez * ez <= rad * rad &&
        hy >= enemy.position.y - 0.08 &&
        hy <= enemy.position.y + enemy.hitHeight + 0.28
      ) {
        bestT = t;
        bestType = 'enemy';
      }
    }

    // 3. Test wildlife along [minT .. bestT]
    this._prevCamSample
      .copy(this._camRayOrigin)
      .addScaledVector(this._camRayDir, minT);
    this._currCamSample
      .copy(this._camRayOrigin)
      .addScaledVector(this._camRayDir, bestT);
    const hitAnimal = this.world.wildlife.rayTestProjectile(
      this._prevCamSample,
      this._currCamSample,
      0.34,
    );
    if (hitAnimal) {
      const t =
        (hitAnimal.position.x - ox) * dx +
        (hitAnimal.position.y + hitAnimal.altitude + hitAnimal.traits.bodyRadius * 0.65 - oy) *
          dy +
        (hitAnimal.position.z - oz) * dz;
      if (t >= minT && t < bestT) {
        bestT = t;
        bestType = 'animal';
      }
    }

    // 4. Test NPCs along [minT .. bestT]
    this._currCamSample
      .copy(this._camRayOrigin)
      .addScaledVector(this._camRayDir, bestT);
    const npcHit = this.world.npcs.rayTestProjectile(
      this._prevCamSample,
      this._currCamSample,
      0.16,
    );
    if (npcHit) {
      const t = this._camRayOrigin.distanceTo(npcHit.hitPoint);
      if (t >= minT && t < bestT) {
        bestT = t;
        bestType = 'npc';
      }
    }

    this._bowAimTarget
      .copy(this._camRayOrigin)
      .addScaledVector(this._camRayDir, bestT);
    this.bowTargetType = bestType;
    return bestType;
  }

  private resolveBowNockOrigin(): void {
    this.player.root.updateMatrixWorld(true);
    if (!this.combat.getBowNockWorldPosition(this._bowNockOrigin)) {
      const yaw = this.controller.getYaw();
      this._bowNockOrigin.set(
        this.controller.position.x + Math.sin(yaw) * 0.52,
        this.controller.position.y + 1.38,
        this.controller.position.z + Math.cos(yaw) * 0.52,
      );
    }
  }

  private updateBowAimAndTrajectoryPreview(): void {
    if (!this.combat || !this.controller || !this.player) return;
    const bow = this.combat.getEquippedBowWeapon();
    const maxRange = bow ? bow.getChargeConfig().maxRange : 52;
    this.computeCameraCenterAimTarget(maxRange);
    this.resolveBowNockOrigin();

    const progress = this.combat.getBowChargeProgress();
    const shot = bow ? bow.computeShotParameters(progress) : null;
    const speed = shot ? shot.speed : 15 + progress * 30;
    const gravity = shot ? shot.gravity : 9.8;

    this._bowLaunchVel.subVectors(this._bowAimTarget, this._bowNockOrigin);
    if (this._bowLaunchVel.lengthSq() < 0.0001) {
      const yaw = this.controller.getYaw();
      this._bowLaunchVel.set(Math.sin(yaw), 0.06, Math.cos(yaw));
    } else {
      this._bowLaunchVel.normalize();
    }
    this._bowLaunchVel.multiplyScalar(speed);

    this.combat.updateBowTrajectoryPreview(
      this._bowNockOrigin,
      this._bowLaunchVel,
      gravity,
      progress,
      this.queryCollidersCb,
      this.showBowTrajectory,
    );
  }

  private cancelActiveBowCharge(showNotice = false): void {
    const cancelled = this.combat?.cancelBowCharge() ?? false;
    this.player?.setBowChargeState(false, 0, 0);
    this.bowFullChargePlayed = false;
    this.bowTargetType = 'none';
    this.combat?.hideBowTrajectoryPreview();
    if (cancelled) {
      this.lastBowCharging = false;
      this.lastBowChargePct = -1;
      this.lastBowTargetType = 'none';
      if (showNotice) {
        this.callbacks.onWorldNotice(UI_TEXT[this.language].bowCancelledNotice);
      }
      this.emitHud();
    }
  }

  private handleBowChargeInput(dt: number, input: UnifiedPlayerInput): void {
    if (!this.combat || !this.controller || !this.player) return;

    this.player.setBowEquipped(
      this.combat.getEquippedWeapon()?.stats.kind === 'bow',
    );

    if (!this.combat.isRangedWeaponEquipped()) {
      if (this.combat.isChargingBow()) {
        this.cancelActiveBowCharge(false);
      } else {
        this.player.setBowChargeState(false, 0, 0);
      }
      return;
    }

    if (input.attackCancel) {
      if (this.combat.isChargingBow()) {
        this.cancelActiveBowCharge(true);
      }
      return;
    }

    if (input.attack && !this.combat.isChargingBow()) {
      if (!this.combat.canPlayerAttack()) return;
      const hasArrows =
        this.activeWorldType === 'creative' ||
        this.inventoryManager.getItemCount('arrow') > 0;
      if (!hasArrows) {
        this.sound.playBowEmpty();
        this.callbacks.onWorldNotice(UI_TEXT[this.language].bowNoArrowsNotice);
        return;
      }

      const weaponStats = this.combat.getEquippedWeaponStats();
      const minCost = Math.max(1, (weaponStats?.staminaCost ?? 4) * 0.4);
      if (this.controller.hasStaminaFor(minCost)) {
        if (this.combat.beginBowCharge()) {
          this.bowFullChargePlayed = false;
          this.sound.playBowDraw();
          this.player.setBowChargeState(true, 0, -this.cameraRig.getPitch());
        }
      }
    }

    if (this.combat.isChargingBow()) {
      if (input.attackReleased) {
        const bow = this.combat.getEquippedBowWeapon();
        const maxRange = bow ? bow.getChargeConfig().maxRange : 52;
        this.computeCameraCenterAimTarget(maxRange);
        this.resolveBowNockOrigin();

        const chargeBeforeRelease = this.combat.getBowChargeProgress();
        const res = this.combat.releaseBowCharge(
          this.controller.position,
          this.controller.getYaw(),
          this._bowNockOrigin,
          this._bowAimTarget,
        );
        this.player.setBowChargeState(false, 0, 0);
        this.bowFullChargePlayed = false;
        this.bowTargetType = 'none';

        if (res.fired) {
          if (this.activeWorldType !== 'creative') {
            this.inventoryManager.removeItem('arrow', 1);
            this.emitInventorySnapshot();
          }
          const staminaCost = res.staminaCost * (0.4 + 0.6 * chargeBeforeRelease);
          this.controller.consumeStamina(staminaCost, 0.55);
          const animSpec = this.combat.getAttackAnimationSpec();
          this.player.triggerAttack(animSpec.duration, animSpec.type);
          this.sound.playBowRelease(chargeBeforeRelease);
          if (this.multiplayerSessionActive && this.multiplayerService) {
            const weaponId = this.combat.getEquippedWeapon()?.stats.id ?? null;
            this.mpPendingShootFlag = true;
            this.mpPendingAnimState = animSpec.type;
            this.multiplayerService.sendGameEvent('player:shoot', {
              weaponId,
              animType: animSpec.type,
              bowCharge: Math.round(chargeBeforeRelease * 100) / 100,
              aimYaw: Math.round(this.cameraRig.getYaw() * 1000) / 1000,
              pitch: Math.round(-this.cameraRig.getPitch() * 1000) / 1000,
            });
          }
          const yaw = this.controller.getYaw();
          const fx = this.controller.position.x + Math.sin(yaw) * 0.9;
          const fz = this.controller.position.z + Math.cos(yaw) * 0.9;
          this.spawnDustBurst(fx, this.controller.position.y + 0.6, fz, 3);
          this.emitHud();
        } else if (res.cancelledTooShort) {
          this.emitHud();
        }
        return;
      }

      if (!input.attackHeld) {
        this.cancelActiveBowCharge(false);
        return;
      }

      this.combat.updateBowCharge(dt);
      const progress = this.combat.getBowChargeProgress();
      this.player.setBowChargeState(true, progress, -this.cameraRig.getPitch());
      this.sound.updateBowChargeProgress(progress);
      if (progress >= 0.995 && !this.bowFullChargePlayed) {
        this.bowFullChargePlayed = true;
        this.sound.playBowFullCharge();
      }
    } else {
      this.player.setBowChargeState(false, 0, 0);
    }
  }

  private updateProximityInteractables(): void {
    let best: WorldInteractable | null = null;
    let bestDistSq = Infinity;
    const px = this.controller.position.x;
    const pz = this.controller.position.z;

    for (const item of this.interactables) {
      if (item.collected) continue;
      const dx = px - item.x;
      const dz = pz - item.z;
      const dSq = dx * dx + dz * dz;
      if (dSq <= item.radius * item.radius && dSq < bestDistSq) {
        bestDistSq = dSq;
        best = item;
      }

      if (dSq < 64) {
        const lm = this.landmarks.find((l) => l.id === item.id);
        if (lm && !lm.discovered) {
          lm.discovered = true;
          this.mapManager.revealAround(lm.x, lm.z, 90);
          if (
            this.multiplayerSessionActive &&
            this.multiplayerService &&
            !this.isApplyingRemoteWorldEvent
          ) {
            this.multiplayerService.sendGameEvent('WORLD_EVENT', {
              kind: 'landmark_discovered',
              landmarkId: lm.id,
            });
          }
        }
      }
    }

    for (const lm of this.landmarks) {
      if (!lm.discovered && lm.kind === 'village') {
        if ((px - lm.x) ** 2 + (pz - lm.z) ** 2 < 900) {
          lm.discovered = true;
          this.mapManager.revealAround(lm.x, lm.z, 130);
          if (
            this.multiplayerSessionActive &&
            this.multiplayerService &&
            !this.isApplyingRemoteWorldEvent
          ) {
            this.multiplayerService.sendGameEvent('WORLD_EVENT', {
              kind: 'landmark_discovered',
              landmarkId: lm.id,
            });
          }
          const rawVillageId =
            lm.id === 'village-square'
              ? 'oakhollow'
              : lm.id.replace(/^village-/, '');
          const matchedVillage = this.world?.village.villages.find(
            (v) => v.id === rawVillageId,
          );
          const displayName = matchedVillage
            ? getLocalizedVillageName(
                matchedVillage.id,
                matchedVillage.name,
                this.language,
              )
            : lm.name;
          this.callbacks.onWorldNotice(
            UI_TEXT[this.language].villageDiscoveredNotice(displayName),
          );
          if (!this.isApplyingRemoteWorldEvent) {
            ProfileManager.recordGameplayDelta({
              villagesDiscovered: 1,
              xpGained: 20,
            });
          }
          if (
            this.storyManager.onVillageDiscovered(rawVillageId, (msg) =>
              this.callbacks.onWorldNotice(msg),
            )
          ) {
            this.emitHud();
          }
          if (
            this.sideQuestManager.update(this.sideQuestBridge, (msg) =>
              this.callbacks.onWorldNotice(msg),
            )
          ) {
            this.emitHud();
          }
          this.hasUnsavedProgress = true;
        }
      }
    }

    const nearNpc = this.world.npcs.getNearestInteractable(this.controller.position);
    if (nearNpc && nearNpc.distSq < bestDistSq) {
      bestDistSq = nearNpc.distSq;
      best = {
        id: nearNpc.info.id,
        label: nearNpc.info.label,
        actionVerb: nearNpc.info.actionVerb,
        kind: 'npc',
        x: nearNpc.npc.position.x,
        y: nearNpc.npc.position.y,
        z: nearNpc.npc.position.z,
        radius: nearNpc.npc.interactionRadius,
        collected: false,
        message: '',
      };
    }

    this.nearbyInteractable = best;
  }

  private executeInteraction(target: WorldInteractable): void {
    const t = UI_TEXT[this.language];
    this.player.triggerInteractGesture();

    if (target.kind === 'crafting_station') {
      if (target.id.startsWith('pstation_')) {
        const sid = target.id.slice('pstation_'.length);
        const st = this.world.buildings.getStructureById(sid);
        if (st && !this.canAccessPlayerStructure(st)) {
          this.sound.playBuildError();
          this.callbacks.onWorldNotice(t.buildPermissionDeniedNotice);
          return;
        }
      }
      this.sound.playInteract();
      this.callbacks.onOpenCraftingStation?.(target.stationType ?? 'crafting_table');
      return;
    }

    if (target.kind === 'npc') {
      this.sound.playInteract();
      const profile = this.world.npcs.engageForDialogue(
        target.id,
        this.controller.position,
      );
      if (profile) {
        this.activeDialogueNpcId = target.id;
        if (this.multiplayerSessionActive) {
          this.multiplayerService?.sendNpcDialogueState?.(target.id, 'talking');
        }
        const snapshot = this.dialogueEngine.startDialogue(profile);
        this.callbacks.onDialogueChange(snapshot);
      }
      return;
    }

    const lm = this.landmarks.find((l) => l.id === target.id);
    if (lm && !lm.discovered) {
      lm.discovered = true;
      if (
        this.multiplayerSessionActive &&
        this.multiplayerService &&
        !this.isApplyingRemoteWorldEvent
      ) {
        this.multiplayerService.sendGameEvent('WORLD_EVENT', {
          kind: 'landmark_discovered',
          landmarkId: lm.id,
        });
      }
    }

    if (target.kind === 'well') {
      this.sound.playInteract();
      this.controller.heal(10);
      this.controller.restoreStamina(40);
      this.spawnDustBurst(target.x, target.y + 0.8, target.z, 4);
      this.callbacks.onWorldNotice(
        translateInteractableMessage(target.id, target.message, this.language),
      );
    } else if (target.kind === 'herb') {
      if (!this.inventoryManager.canAccept('meadow-herb', 1)) {
        this.callbacks.onWorldNotice(t.packFullNotice);
        return;
      }
      target.collected = true;
      if (target.meshGroup) {
        target.meshGroup.visible = false;
      }
      this.player?.triggerGatherAnimation('harvest', 0.42);
      this.sound.playResourceToolAction('meadow-herb', true, target);
      this.sound.playItemPickup('food', target);
      this.controller.heal(15);
      this.spawnDustBurst(target.x, target.y, target.z, 6);
      this.inventoryManager.addItem('meadow-herb', 1);
      const herbSeedRoll =
        Math.random() < 0.35 && this.inventoryManager.canAccept('herb-seeds', 1)
          ? 'herb-seeds'
          : null;
      if (herbSeedRoll) {
        this.inventoryManager.addItem(herbSeedRoll, 1);
        const sName = this.itemManager.getName(herbSeedRoll, this.language);
        this.callbacks.onWorldNotice(t.farmFoundSeedNotice(sName));
      }
      if (this.multiplayerSessionActive && this.multiplayerService) {
        ProfileManager.recordGameplayDelta({ resourcesCollected: 1 });
        this.multiplayerService.sendGameEvent('ITEM_PICKED_UP', {
          pickupId: target.id,
          itemId: 'meadow-herb',
          count: 1,
          x: Math.round(target.x * 100) / 100,
          y: Math.round(target.y * 100) / 100,
          z: Math.round(target.z * 100) / 100,
        });
      } else {
        ProfileManager.recordGameplayDelta({
          resourcesCollected: 1,
          xpGained: 5,
        });
      }
      this.emitInventorySnapshot();
      this.nearbyInteractable = null;
      this.lastNearbyId = null;
      this.dialogueEngine.quests.update(this.dialogueBridge, (msg) =>
        this.callbacks.onWorldNotice(msg),
      );
      this.storyManager.update(this.storyBridge, (msg) =>
        this.callbacks.onWorldNotice(msg),
      );
      this.sideQuestManager.update(this.sideQuestBridge, (msg) =>
        this.callbacks.onWorldNotice(msg),
      );
      this.callbacks.onWorldNotice(t.gatheredHerbNotice);
    } else if (target.kind === 'pickup' && target.itemId) {
      const qty = target.count ?? 1;
      if (!this.inventoryManager.canAccept(target.itemId, qty)) {
        this.callbacks.onWorldNotice(t.packFullNotice);
        return;
      }
      target.collected = true;
      if (target.meshGroup) {
        target.meshGroup.visible = false;
        this.scene.remove(target.meshGroup);
      }
      const itemDef = this.itemManager.getItem(target.itemId);
      const pickupCategory =
        itemDef?.category === 'weapon'
          ? 'weapon'
          : itemDef?.category === 'consumable'
            ? 'food'
            : itemDef?.category === 'quest'
              ? 'quest'
              : 'resource';
      this.sound.playItemPickup(pickupCategory, target);
      this.spawnDustBurst(target.x, target.y, target.z, 6);
      this.inventoryManager.addItem(target.itemId, qty);
      if (this.multiplayerSessionActive && this.multiplayerService) {
        this.multiplayerService.sendGameEvent('ITEM_PICKED_UP', {
          pickupId: target.id,
          itemId: target.itemId,
          count: qty,
          x: Math.round(target.x * 100) / 100,
          y: Math.round(target.y * 100) / 100,
          z: Math.round(target.z * 100) / 100,
        });
      }
      this.syncEquippedWeaponFromInventory();
      this.emitInventorySnapshot();
      this.nearbyInteractable = null;
      this.lastNearbyId = null;
      if (target.id.startsWith('story-clue-')) {
        this.storyLocalInteractables.delete(target.id);
      }
      if (this.sideQuestLocalInteractables.has(target.id)) {
        this.sideQuestLocalInteractables.delete(target.id);
      }
      this.dialogueEngine.quests.update(this.dialogueBridge, (msg) =>
        this.callbacks.onWorldNotice(msg),
      );
      this.storyManager.update(this.storyBridge, (msg) =>
        this.callbacks.onWorldNotice(msg),
      );
      this.sideQuestManager.update(this.sideQuestBridge, (msg) =>
        this.callbacks.onWorldNotice(msg),
      );
      const itemName = this.itemManager.getName(target.itemId, this.language);
      this.callbacks.onWorldNotice(t.pickedUpNotice(itemName, qty));
    } else if (target.kind === 'resource') {
      const previewItemId = target.resourceKind ?? '';
      const requiredPickaxeTier =
        previewItemId === 'silver-ore' ||
        previewItemId === 'gold-ore' ||
        previewItemId === 'rare-mineral'
          ? 2
          : previewItemId === 'copper-ore' ||
              previewItemId === 'iron-ore' ||
              previewItemId === 'coal'
            ? 1
            : 0;
      if (
        requiredPickaxeTier > 0 &&
        !this.inventoryManager.hasTool('pickaxe', requiredPickaxeTier)
      ) {
        this.sound.playUiClick();
        const reqLabel =
          requiredPickaxeTier >= 2 ? t.toolPickaxeTier2 : t.toolPickaxeTier1;
        const resLabel = this.itemManager.getName(previewItemId, this.language);
        this.callbacks.onWorldNotice(t.toolRequiredNotice(reqLabel, resLabel));
        return;
      }

      const matchingToolKind: ToolKind | null =
        previewItemId === 'wood' || previewItemId === 'driftwood'
          ? 'axe'
          : previewItemId === 'stone' ||
              previewItemId === 'copper-ore' ||
              previewItemId === 'iron-ore' ||
              previewItemId === 'silver-ore' ||
              previewItemId === 'gold-ore' ||
              previewItemId === 'coal' ||
              previewItemId === 'rare-mineral'
            ? 'pickaxe'
            : previewItemId === 'sand' ||
                previewItemId === 'clay' ||
                previewItemId === 'gravel'
              ? 'shovel'
              : null;

      const bestTool = matchingToolKind
        ? this.inventoryManager.getBestTool(matchingToolKind)
        : null;
      const bonusYield = bestTool ? (bestTool.tier >= 2 ? 2 : 1) : 0;
      const previewCount = target.yieldCount ?? 2;
      if (
        previewItemId &&
        !this.inventoryManager.canAccept(previewItemId, previewCount)
      ) {
        this.callbacks.onWorldNotice(t.packFullNotice);
        return;
      }

      const maxUses =
        target.maxUses ??
        (target.usesRemaining !== undefined ? Math.max(target.usesRemaining, 2) : 2);
      const res = this.world.collectResourceNode(target, this.elapsed);
      if (!res) return;

      const finalCount =
        bonusYield > 0 &&
        this.inventoryManager.canAccept(res.itemId, res.count + bonusYield)
          ? res.count + bonusYield
          : res.count;

      const gatherAnimKind =
        matchingToolKind === 'axe'
          ? 'chop'
          : matchingToolKind === 'pickaxe'
            ? 'mine'
            : matchingToolKind === 'shovel'
              ? 'dig'
              : 'harvest';
      this.player?.triggerGatherAnimation(gatherAnimKind);
      this.sound.playResourceToolAction(res.itemId, res.depleted, target);
      this.inventoryManager.addItem(res.itemId, finalCount);

      const bonusSeedSpec = this.pickSeedForGatheredResource(
        res.itemId,
        target.x,
        target.z,
      );
      let grantedBonusSeedId: string | null = null;
      if (
        bonusSeedSpec &&
        Math.random() < bonusSeedSpec.chance &&
        this.inventoryManager.canAccept(bonusSeedSpec.seedItemId, 1)
      ) {
        this.inventoryManager.addItem(bonusSeedSpec.seedItemId, 1);
        grantedBonusSeedId = bonusSeedSpec.seedItemId;
        const seedName = this.itemManager.getName(bonusSeedSpec.seedItemId, this.language);
        this.callbacks.onWorldNotice(t.farmFoundSeedNotice(seedName));
      }

      if (matchingToolKind && bestTool) {
        const wear = this.inventoryManager.damageGatheringTool(
          matchingToolKind,
          1,
          1,
        );
        if (wear.brokenItemId) {
          this.sound.playToolBreak();
          const brokenName = this.itemManager.getName(
            wear.brokenItemId,
            this.language,
          );
          this.callbacks.onWorldNotice(t.toolBrokenNotice(brokenName));
        }
      }

      if (this.multiplayerSessionActive && this.multiplayerService) {
        ProfileManager.recordGameplayDelta({ resourcesCollected: 1 });
        this.multiplayerService.sendGameEvent('PLAYER_COLLECTED_RESOURCE', {
          nodeId: target.id,
          itemId: res.itemId,
          count: finalCount,
          maxUses,
          ...(grantedBonusSeedId ? { bonusSeedId: grantedBonusSeedId } : {}),
          x: Math.round(target.x * 100) / 100,
          y: Math.round(target.y * 100) / 100,
          z: Math.round(target.z * 100) / 100,
        });
      } else {
        ProfileManager.recordGameplayDelta({
          resourcesCollected: 1,
          xpGained: 5,
        });
      }
      this.spawnDustBurst(target.x, target.y + 0.5, target.z, 6);
      this.emitInventorySnapshot();
      if (res.depleted) {
        this.nearbyInteractable = null;
        this.lastNearbyId = null;
      }
      this.dialogueEngine.quests.update(this.dialogueBridge, (msg) =>
        this.callbacks.onWorldNotice(msg),
      );
      this.storyManager.update(this.storyBridge, (msg) =>
        this.callbacks.onWorldNotice(msg),
      );
      this.sideQuestManager.update(this.sideQuestBridge, (msg) =>
        this.callbacks.onWorldNotice(msg),
      );
      const itemName = this.itemManager.getName(res.itemId, this.language);
      this.callbacks.onWorldNotice(t.harvestedResourceNotice(itemName, finalCount));
    } else if (target.kind === 'chest') {
      const res = this.world.openChest(target);
      if (!res) return;
      this.sound.playChestState(true, target);
      const summaryParts: string[] = [];
      let hasArrows = false;
      let arrowCount = 0;
      const lootItemIds: string[] = [];
      for (const entry of res.loot) {
        if (entry.itemId === 'arrow') {
          hasArrows = true;
          arrowCount += entry.count;
        }
        if (ALLOWED_WEAPON_IDS.has(entry.itemId)) {
          lootItemIds.push(entry.itemId);
        }
        if (this.inventoryManager.canAccept(entry.itemId, entry.count)) {
          this.inventoryManager.addItem(entry.itemId, entry.count);
        } else {
          const dropLabel = this.itemManager.getName(entry.itemId, 'en');
          const spawned = this.world.spawnWorldPickup(
            target.x,
            target.z,
            entry.itemId,
            entry.count,
            dropLabel,
            undefined,
            true,
          );
          if (this.multiplayerSessionActive && this.multiplayerService) {
            this.multiplayerService.sendGameEvent('ITEM_DROPPED', {
              dropId: spawned.id,
              itemId: entry.itemId,
              count: entry.count,
              label: dropLabel,
              x: Math.round(spawned.x * 100) / 100,
              y: Math.round(spawned.y * 100) / 100,
              z: Math.round(spawned.z * 100) / 100,
            });
          }
        }
        const name = this.itemManager.getName(entry.itemId, this.language);
        summaryParts.push(`${name} ×${entry.count}`);
      }
      if (this.multiplayerSessionActive && this.multiplayerService) {
        this.multiplayerService.sendGameEvent('CHEST_OPENED', {
          chestId: target.id,
          hasArrows,
          ...(arrowCount > 0 ? { arrowCount } : {}),
          ...(lootItemIds.length > 0 ? { lootItems: lootItemIds.join(',') } : {}),
          x: Math.round(target.x * 100) / 100,
          y: Math.round(target.y * 100) / 100,
          z: Math.round(target.z * 100) / 100,
        });
      }
      if (res.coins > 0 || res.xp > 0) {
        if (res.coins > 0) {
          this.sound.playItemPickup('coins', target);
        }
        this.awardXpAndCoins(res.xp, res.coins);
        if (res.coins > 0) summaryParts.push(`+${res.coins} ${t.coinsLabel}`);
        if (res.xp > 0) summaryParts.push(`+${res.xp} ${t.xpShort}`);
      }
      this.spawnDustBurst(target.x, target.y + 0.6, target.z, 7);
      this.emitInventorySnapshot();
      this.syncEquippedWeaponFromInventory();
      this.nearbyInteractable = null;
      this.lastNearbyId = null;
      this.dialogueEngine.quests.update(this.dialogueBridge, (msg) =>
        this.callbacks.onWorldNotice(msg),
      );
      this.storyManager.onChestOpened(
        target.id,
        (msg) => this.callbacks.onWorldNotice(msg),
      );
      this.storyManager.update(this.storyBridge, (msg) =>
        this.callbacks.onWorldNotice(msg),
      );
      this.sideQuestManager.update(this.sideQuestBridge, (msg) =>
        this.callbacks.onWorldNotice(msg),
      );
      this.callbacks.onWorldNotice(
        t.chestOpenedNotice(target.label, summaryParts.join(', ')),
      );
    } else if (target.kind === 'door') {
      if (this.world.buildings.hasDoor(target.id)) {
        const st = this.world.buildings.getStructureByDoorId(target.id);
        if (st && !this.canAccessPlayerStructure(st)) {
          this.sound.playBuildError();
          this.callbacks.onWorldNotice(t.buildPermissionDeniedNotice);
          return;
        }
      }
      const nextOpen = !Boolean(target.isOpen);
      const changed = this.world.setDoorOpen(target.id, nextOpen);
      if (changed) {
        if (nextOpen) {
          this.enteredBuildingRecently = true;
          this.storyManager.update(this.storyBridge, (msg) =>
            this.callbacks.onWorldNotice(msg),
          );
          this.enteredBuildingRecently = false;
        }
        this.spawnDustBurst(target.x, target.y + 0.8, target.z, 3);
        if (this.multiplayerSessionActive && this.multiplayerService) {
          this.multiplayerService.sendGameEvent(
            nextOpen ? 'DOOR_OPENED' : 'DOOR_CLOSED',
            {
              doorId: target.id,
              x: Math.round(target.x * 100) / 100,
              z: Math.round(target.z * 100) / 100,
            },
          );
        }
      }
    } else if (target.kind === 'player_storage') {
      const sid = target.id.startsWith('pstore_') ? target.id.slice('pstore_'.length) : target.id;
      this.openBuildingStorageModal(sid);
      return;
    } else if (target.kind === 'farm_plot') {
      const sid = target.id.startsWith('pfarm_') ? target.id.slice('pfarm_'.length) : target.id;
      const st = this.world.buildings.getStructureById(sid);
      if (!st) return;
      if (!this.canAccessPlayerStructure(st)) {
        this.sound.playBuildError();
        this.callbacks.onWorldNotice(t.buildPermissionDeniedNotice);
        return;
      }
      const stage = st.farmState?.stage ?? 0;
      if (stage >= 3) {
        this.harvestFarmPlot(sid);
        return;
      }
      this.openFarmPlotModal(sid);
      return;
    } else if (target.kind === 'farm_animal') {
      const animalId = target.id.startsWith('fanimal_')
        ? target.id.slice('fanimal_'.length)
        : target.id;
      const rec = this.world.farmAnimals.getAnimalById(animalId);
      const spec = rec ? FARM_ANIMAL_SPECS[rec.species] : undefined;
      if (!rec || !spec) return;
      const totalHours = this.getTotalWorldHours();
      const animalName = getFarmAnimalName(rec.species, this.language);
      if (this.world.farmAnimals.isReadyToProduce(rec, totalHours)) {
        if (!this.inventoryManager.canAccept(spec.produceItemId, spec.produceCount)) {
          this.sound.playBuildError();
          this.callbacks.onWorldNotice(t.packFullNotice);
          return;
        }
        const prod = this.world.farmAnimals.collectProduct(animalId, totalHours);
        if (!prod) return;
        this.player?.triggerGatherAnimation('harvest', 0.35);
        this.sound.playAnimalHappy(target);
        this.sound.playItemPickup('food', target);
        this.spawnDustBurst(target.x, target.y + 0.35, target.z, 5);
        this.inventoryManager.addItem(prod.itemId, prod.count);
        this.hasUnsavedProgress = true;
        this.emitInventorySnapshot();
        this.dialogueEngine.quests.update(this.dialogueBridge, (msg) =>
          this.callbacks.onWorldNotice(msg),
        );
        this.storyManager.update(this.storyBridge, (msg) =>
          this.callbacks.onWorldNotice(msg),
        );
        this.sideQuestManager.update(this.sideQuestBridge, (msg) =>
          this.callbacks.onWorldNotice(msg),
        );
        const prodName = this.itemManager.getName(prod.itemId, this.language);
        this.callbacks.onWorldNotice(
          t.farmAnimalCollectedNotice(animalName, prodName, prod.count),
        );
      } else {
        const feedId =
          spec.favoriteFeedItems.find((fid) => this.inventoryManager.getItemCount(fid) > 0) ??
          (this.inventoryManager.getItemCount('animal-feed') > 0 ? 'animal-feed' : null);
        if (feedId) {
          if (this.activeWorldType !== 'creative') {
            this.inventoryManager.removeItem(feedId, 1);
            this.emitInventorySnapshot();
          }
          this.world.farmAnimals.feedAnimal(animalId, totalHours);
          this.sound.playAnimalHappy(target);
          this.spawnDustBurst(target.x, target.y + 0.35, target.z, 4);
          this.hasUnsavedProgress = true;
          const fedHoursLeft = Math.max(
            0.5,
            this.world.farmAnimals.getHoursUntilProduce(rec, totalHours),
          );
          this.callbacks.onWorldNotice(t.farmAnimalFedNotice(animalName, fedHoursLeft));
        } else {
          const hoursLeft = Math.max(
            0.5,
            this.world.farmAnimals.getHoursUntilProduce(rec, totalHours),
          );
          this.sound.playInteract();
          this.callbacks.onWorldNotice(
            t.farmAnimalRestingNotice(animalName, Math.ceil(hoursLeft)),
          );
        }
      }
    } else if (target.kind === 'village_board') {
      const villageId = target.id.startsWith('vboard_')
        ? target.id.slice('vboard_'.length)
        : target.id;
      this.openVillageDevModal(villageId);
      return;
    } else if (target.kind === 'structure_manage') {
      const sid = target.id.startsWith('pmanage_') ? target.id.slice('pmanage_'.length) : target.id;
      this.openStructureManageModal(sid);
      return;
    } else if (target.kind === 'story_rescue') {
      this.sound.playInteract();
      target.collected = true;
      if (target.meshGroup) {
        target.meshGroup.visible = false;
        this.scene.remove(target.meshGroup);
      }
      this.storyLocalInteractables.delete(target.id);
      this.spawnDustBurst(target.x, target.y + 0.8, target.z, 6);
      this.storyManager.onNpcRescued(
        target.id,
        (msg) => this.callbacks.onWorldNotice(msg),
      );
      this.nearbyInteractable = null;
      this.lastNearbyId = null;
      this.hasUnsavedProgress = true;
      this.callbacks.onWorldNotice(t.storyRescuedNotice(target.label));
    } else if (target.kind === 'side_quest_rescue') {
      this.sound.playInteract();
      target.collected = true;
      if (target.meshGroup) {
        target.meshGroup.visible = false;
        this.scene.remove(target.meshGroup);
      }
      this.sideQuestLocalInteractables.delete(target.id);
      this.spawnDustBurst(target.x, target.y + 0.8, target.z, 6);
      this.sideQuestManager.onNpcRescued(
        target.id,
        (msg) => this.callbacks.onWorldNotice(msg),
      );
      this.sideQuestManager.update(
        this.sideQuestBridge,
        (msg) => this.callbacks.onWorldNotice(msg),
      );
      this.syncSideQuestLocalEntities();
      this.syncAuthoritativeEntities(true);
      this.nearbyInteractable = null;
      this.lastNearbyId = null;
      this.hasUnsavedProgress = true;
      this.callbacks.onWorldNotice(t.storyRescuedNotice(target.label));
    } else if (target.kind === 'bed') {
      if (target.id.startsWith('pbed_')) {
        const sid = target.id.slice('pbed_'.length);
        const st = this.world.buildings.getStructureById(sid);
        if (st && !this.canAccessPlayerStructure(st)) {
          this.sound.playBuildError();
          this.callbacks.onWorldNotice(t.buildPermissionDeniedNotice);
          return;
        }
      }
      this.sound.playInteract();
      const h = this.timeManager.getWorldHours();
      if (h >= 5.5 && h < 18.0) {
        this.callbacks.onWorldNotice(t.cannotSleepDayNotice);
        return;
      }
      this.lastInteractedBed = { id: target.id, x: target.x, z: target.z };
      this.startSleepTransition();
      return;
    } else {
      this.sound.playInteract();
      this.callbacks.onWorldNotice(
        translateInteractableMessage(target.id, target.message, this.language),
      );
    }

    this.emitHud();
  }

  private startSleepTransition(): void {
    if (this.isSleeping) return;
    this.cancelActiveBowCharge(false);
    this.isSleeping = true;
    this.sleepTimer = 0;
    this.input?.clearAll();
    this.emitHud();
  }

  private completeSleepTransition(): void {
    this.isSleeping = false;
    this.sleepTimer = 0;
    this.timeManager.advanceToMorning(6.5);
    this.world.buildings.syncAllFarmPlotsByWorldHours(
      this.getTotalWorldHours(),
      this.isCurrentlyRaining(),
    );
    this.world.npcs.wakeAllSleepingNpcs();
    this.controller.heal(this.controller.getMaxHealth());
    this.controller.restoreStamina(this.controller.getMaxStamina());
    this.combat.syncPlayerStats(
      this.controller.getHealth(),
      this.controller.getMaxHealth(),
    );
    this.dialogueEngine.quests.onPlayerSlept(this.dialogueBridge, (msg) =>
      this.callbacks.onWorldNotice(msg),
    );
    if (this.multiplayerSessionActive && this.multiplayerService) {
      const bed = this.lastInteractedBed;
      this.multiplayerService.sendGameEvent('BED_USED', {
        bedId: bed?.id ?? 'bed',
        x: Math.round((bed?.x ?? this.controller.position.x) * 100) / 100,
        z: Math.round((bed?.z ?? this.controller.position.z) * 100) / 100,
      });
    }
    this.lastInteractedBed = null;
    this.syncWorldTimeImmediate();
    this.callbacks.onWorldNotice(UI_TEXT[this.language].goodMorningNotice);
    this.emitHud();
  }

  private getLocalizedInteractable(item: WorldInteractable): InteractableInfo {
    if (item.kind === 'pickup' && item.itemId) {
      const name = this.itemManager.getName(item.itemId, this.language);
      const count = item.count ?? 1;
      return {
        id: item.id,
        label: count > 1 ? `${name} ×${count}` : name,
        actionVerb: item.actionVerb,
        kind: item.kind,
      };
    }
    if (item.kind === 'herb') {
      return {
        id: item.id,
        label: this.itemManager.getName('meadow-herb', this.language),
        actionVerb: item.actionVerb,
        kind: item.kind,
      };
    }
    if (item.kind === 'resource') {
      const label =
        this.language === 'ar'
          ? (item.resourceKind
              ? RESOURCE_NODE_LABELS_AR[item.resourceKind] ??
                this.itemManager.getName(item.resourceKind, 'ar')
              : undefined) ?? translateInteractableLabel(item.id, item.label, 'ar')
          : item.label;
      return {
        id: item.id,
        label,
        actionVerb: item.actionVerb,
        kind: item.kind,
      };
    }
    if (item.kind === 'story_rescue' || item.kind === 'side_quest_rescue') {
      return {
        id: item.id,
        label: item.label,
        actionVerb: UI_TEXT[this.language].storyRescueActionVerb,
        kind: item.kind,
      };
    }
    if (item.kind === 'farm_animal') {
      const animalId = item.id.startsWith('fanimal_')
        ? item.id.slice('fanimal_'.length)
        : item.id;
      const rec = this.world?.farmAnimals.getAnimalById(animalId);
      const label = rec ? getFarmAnimalName(rec.species, this.language) : item.label;
      return {
        id: item.id,
        label,
        actionVerb: item.actionVerb,
        kind: item.kind,
      };
    }
    if (item.kind === 'village_board') {
      const vid = item.id.startsWith('vboard_') ? item.id.slice('vboard_'.length) : '';
      return {
        id: item.id,
        label: getLocalizedVillageName(vid, item.label, this.language),
        actionVerb: item.actionVerb,
        kind: item.kind,
      };
    }
    if (
      item.id.startsWith('pdoor_') ||
      item.id.startsWith('pstation_') ||
      item.id.startsWith('pstore_') ||
      item.id.startsWith('pbed_') ||
      item.id.startsWith('pfarm_') ||
      item.id.startsWith('pmanage_')
    ) {
      const sid = item.id.replace(/^p(?:door|station|store|bed|farm|manage)_/, '');
      const st = this.world?.buildings.getStructureById(sid);
      const bp = st ? getBlueprintById(st.blueprintId) : undefined;
      let label = bp ? (this.language === 'ar' ? bp.nameAr : bp.nameEn) : item.label;
      if (item.id.startsWith('pfarm_') && st?.farmState?.cropId) {
        const cropName = getCropDisplayName(st.farmState.cropId, this.language);
        label = `${label} · ${cropName}`;
      }
      return {
        id: item.id,
        label,
        actionVerb: item.actionVerb,
        kind: item.kind,
      };
    }
    if (item.kind !== 'npc') {
      return {
        id: item.id,
        label: translateInteractableLabel(item.id, item.label, this.language),
        actionVerb: item.actionVerb,
        kind: item.kind,
      };
    }
    return {
      id: item.id,
      label: item.label,
      actionVerb: item.actionVerb,
      kind: item.kind,
    };
  }

  private getWeaponHudViews(): WeaponSlotHudView[] {
    return this.inventoryManager.getOwnedWeaponSlots().map((slot) => {
      const def = slot.definition;
      const weaponId = def.weaponId ?? def.id;
      const kind: WeaponSlotHudView['kind'] =
        def.icon === 'axe'
          ? 'axe'
          : def.icon === 'bow'
            ? 'bow'
            : def.icon === 'spear'
              ? 'spear'
              : def.icon === 'crossbow'
                ? 'crossbow'
                : def.icon === 'knife'
                  ? 'knife'
                  : 'sword';
      return {
        slotIndex: slot.slotIndex,
        itemId: slot.itemId,
        weaponId,
        name: def.name,
        nameAr: def.nameAr,
        kind,
        damage: def.weaponStats?.damage ?? 20,
        cooldown: def.weaponStats?.cooldown ?? 0.5,
        range: def.weaponStats?.range ?? 2.8,
        isRanged: Boolean(def.weaponStats?.isRanged),
        equipped: slot.equipped,
        durability: slot.durability,
        maxDurability: slot.maxDurability,
      };
    });
  }

  private emitHud(): void {
    if (!this.controller || !this.world) return;
    const pos = this.controller.position;
    const heading = this.cameraRig.getHeadingDegrees();
    const nearby: InteractableInfo | null = this.nearbyInteractable
      ? this.getLocalizedInteractable(this.nearbyInteractable)
      : null;
    const ownedWeapons = this.getWeaponHudViews();
    const equippedWeapon = ownedWeapons.find((w) => w.equipped) ?? null;
    const currentBiome = getBiomeAt(pos.x, pos.z);

    const resolvePlayerDisplayName = (playerId?: string | null): string | undefined => {
      if (!playerId) return undefined;
      if (playerId === this.localMultiplayerPlayerId) {
        return ProfileManager.getSnapshot().profile?.displayName ?? 'You';
      }
      return this.multiplayerService
        ?.getRoomState()
        ?.players.find((p) => p.id === playerId)?.displayName;
    };

    const rawCombatTarget = this.combat ? this.combat.getHudTarget() : null;
    const combatTarget = rawCombatTarget
      ? {
          ...rawCombatTarget,
          targetPlayerName:
            rawCombatTarget.targetPlayerName ??
            resolvePlayerDisplayName(rawCombatTarget.targetPlayerId),
        }
      : null;

    const rawActiveBoss = this.combat
      ? this.combat.getActiveBossHudTarget(pos, 42)
      : null;
    const activeBoss = rawActiveBoss
      ? {
          ...rawActiveBoss,
          targetPlayerName:
            rawActiveBoss.targetPlayerName ??
            resolvePlayerDisplayName(rawActiveBoss.targetPlayerId),
        }
      : null;

    this.callbacks.onHudUpdate({
      health: this.controller.getHealth(),
      maxHealth: this.controller.getMaxHealth(),
      stamina: this.controller.getStamina(),
      maxStamina: this.controller.getMaxStamina(),
      worldType: this.activeWorldType,
      x: Math.round(pos.x * 10) / 10,
      y: Math.round(pos.y * 10) / 10,
      z: Math.round(pos.z * 10) / 10,
      headingDeg: Math.round(heading),
      grounded: this.controller.isGrounded(),
      sprinting: this.controller.isSprinting(),
      speed: Math.round(this.controller.getHorizontalSpeed() * 10) / 10,
      biome: currentBiome,
      inWater: this.controller.isInWater(),
      movementState: this.controller.getMovementState(),
      nearbyInteractable: nearby,
      timeOfDayLabel: this.timeManager.getTimeOfDayLabel(this.language),
      level: this.playerLevel,
      xp: this.playerXp,
      xpToNextLevel: this.getXpToNextLevel(),
      coins: this.playerCoins,
      trackedQuest:
        this.trackedQuestSource === 'sidequest'
          ? (this.sideQuestManager.getTrackedHudQuestView(
              this.sideQuestBridge,
              this.language,
            ) ??
            this.storyManager.getTrackedHudQuestView(this.language) ??
            this.dialogueEngine.quests.getTrackedQuestView(this.dialogueBridge))
          : this.trackedQuestSource === 'side'
            ? (this.dialogueEngine.quests.getTrackedQuestView(this.dialogueBridge) ??
              this.sideQuestManager.getTrackedHudQuestView(
                this.sideQuestBridge,
                this.language,
              ) ??
              this.storyManager.getTrackedHudQuestView(this.language))
            : (this.storyManager.getTrackedHudQuestView(this.language) ??
              this.sideQuestManager.getTrackedHudQuestView(
                this.sideQuestBridge,
                this.language,
              ) ??
              this.dialogueEngine.quests.getTrackedQuestView(this.dialogueBridge)),
      combatTarget,
      activeBoss,
      equippedWeapon,
      weaponCooldownRatio: this.combat ? this.combat.getAttackCooldownRatio() : 0,
      ownedWeapons,
      timeSnapshot: this.timeManager.getSnapshot(),
      weatherSnapshot: this.weatherManager.getSnapshot(),
      isSleeping: this.isSleeping,
      sleepProgress: this.isSleeping
        ? Math.max(0, Math.min(1, this.sleepTimer / this.SLEEP_DURATION_SEC))
        : 0,
      isChargingBow: this.combat ? this.combat.isChargingBow() : false,
      bowChargeProgress: this.combat ? this.combat.getBowChargeProgress() : 0,
      bowMaxCharge: this.combat ? this.combat.isBowMaxCharged() : false,
      arrowCount:
        this.activeWorldType === 'creative'
          ? 999
          : this.inventoryManager.getItemCount('arrow'),
      bowTargetType: this.combat?.isChargingBow() ? this.bowTargetType : 'none',
      showBowTrajectory: this.showBowTrajectory,
      cameraPerspective: this.getCameraPerspective(),
      indicatorX: this.indicatorX,
      indicatorY: this.indicatorY,
      biomeMaterialId: this.world.getExpectedTerrainMaterialId(currentBiome),
      biomeValidationOk: this.biomeValidationOk,
      buildMode: this.buildModeActive ? this.getBuildModeSnapshot() : undefined,
      nearbyPlayerStructureId: !this.buildModeActive
        ? (this.world.buildings.getNearestManageableStructure(pos.x, pos.y, pos.z, 5.2)?.id ?? null)
        : null,
    });
  }

  private handleResize = (): void => {
    if (!this.renderer || !this.camera) return;
    const vpState = OrientationManager.getState();
    const w = Math.max(1, this.container.clientWidth || vpState.width);
    const h = Math.max(1, this.container.clientHeight || vpState.height);
    const pr = this.graphicsManager
      ? this.graphicsManager.getProfile().pixelRatio
      : this.isSoftwareGl
        ? 1
        : Math.min(window.devicePixelRatio || 1, 1.5);

    if (
      w === this.lastResizeW &&
      h === this.lastResizeH &&
      Math.abs(pr - this.lastResizePr) < 0.001
    ) {
      return;
    }

    this.lastResizeW = w;
    this.lastResizeH = h;
    this.lastResizePr = pr;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.postProcessing?.setSize(w, h, pr);
  };

  private handleContextLost = (e: Event): void => {
    e.preventDefault();
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
  };

  private syncLocalMultiplayerState(dt: number, forceImmediate = false): void {
    if (!this.multiplayerSessionActive || !this.multiplayerService || !this.controller || !this.combat) {
      return;
    }

    this.mpSyncTimer += dt;
    this.mpKeepaliveTimer += dt;

    const pos = this.controller.position;
    const vel = this.controller.velocity;
    const yaw = this.controller.getYaw();
    const aimYaw = this.cameraRig?.getYaw() ?? yaw;
    const pitch = -(this.cameraRig?.getPitch() ?? 0);
    const movementState = this.controller.getMovementState();
    const grounded = this.controller.isGrounded();
    const sprinting = this.controller.isSprinting();
    const jumping = !grounded && vel.y > 0.2;
    const crouching = false;
    const weaponId = this.combat.getEquippedWeapon()?.stats.id ?? null;
    const bowCharging = this.combat.isChargingBow();
    const bowCharge = bowCharging ? Math.round(this.combat.getBowChargeProgress() * 100) / 100 : 0;
    const reloading =
      this.combat.isRangedWeaponEquipped() &&
      !bowCharging &&
      this.combat.getAttackCooldownRatio() > 0;
    const shooting = this.mpPendingShootFlag;
    const animState = this.mpPendingAnimState;

    const urgent = forceImmediate || shooting || Boolean(animState);
    const isConstrainedDevice =
      typeof navigator !== 'undefined' &&
      (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
        (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData ===
          true);
    const activeSendInterval =
      this.simThrottleScale >= 2 ? 0.085 : isConstrainedDevice ? 0.065 : 0.04;
    const idleKeepaliveInterval =
      this.simThrottleScale >= 2 || isConstrainedDevice ? 1.5 : 1.0;

    if (
      urgent ||
      this.mpSyncTimer >= activeSendInterval ||
      this.mpKeepaliveTimer >= idleKeepaliveInterval
    ) {
      const digest = `${Math.round(pos.x * 100)}|${Math.round(pos.y * 100)}|${Math.round(pos.z * 100)}|${Math.round(yaw * 100)}|${Math.round(aimYaw * 100)}|${Math.round(pitch * 100)}|${movementState}|${sprinting ? 1 : 0}|${jumping ? 1 : 0}|${grounded ? 1 : 0}|${weaponId ?? ''}|${bowCharging ? 1 : 0}|${Math.round(bowCharge * 25)}|${reloading ? 1 : 0}`;
      const changed = digest !== this.mpLastSentDigest;
      const shouldSend =
        urgent ||
        (changed && this.mpSyncTimer >= activeSendInterval) ||
        this.mpKeepaliveTimer >= idleKeepaliveInterval;

      if (shouldSend) {
        this.mpOutboundSeq += 1;
        const statePayload: PlayerNetworkState = {
          x: Math.round(pos.x * 1000) / 1000,
          y: Math.round(pos.y * 1000) / 1000,
          z: Math.round(pos.z * 1000) / 1000,
          yaw: Math.round(yaw * 1000) / 1000,
          aimYaw: Math.round(aimYaw * 1000) / 1000,
          pitch: Math.round(pitch * 1000) / 1000,
          vx: Math.round(vel.x * 100) / 100,
          vy: Math.round(vel.y * 100) / 100,
          vz: Math.round(vel.z * 100) / 100,
          movementState: movementState === 'swimming' ? 'walking' : movementState,
          ...(animState ? { animState } : {}),
          sprinting,
          jumping,
          crouching,
          grounded,
          weaponId,
          bowCharging,
          bowCharge,
          shooting,
          reloading,
          seq: this.mpOutboundSeq,
        };

        const sent = this.multiplayerService.sendPlayerState(statePayload, urgent);
        if (sent) {
          this.mpSyncTimer = 0;
          this.mpKeepaliveTimer = 0;
          this.mpLastSentDigest = digest;
          this.mpPendingShootFlag = false;
          this.mpPendingAnimState = undefined;
        }
      }
    }

    if (this.isLocalMultiplayerHost() && this.multiplayerService.sendEntitySync && this.world) {
      this.mpEntitySyncTimer += dt;
      this.mpWeatherTimeHeartbeatTimer += dt;
      const entitySyncInterval =
        this.simThrottleScale >= 2 ? 0.25 : isConstrainedDevice ? 0.175 : 0.125;
      if (forceImmediate || this.mpEntitySyncTimer >= entitySyncInterval) {
        this.mpEntitySyncTimer = 0;
        const centers = this.mpCentersScratch;
        let centerCount = 0;
        if (centers.length === 0) centers.push({ x: pos.x, z: pos.z });
        else {
          centers[0].x = pos.x;
          centers[0].z = pos.z;
        }
        centerCount = 1;

        const roomPlayers = this.multiplayerService.getRoomState()?.players ?? [];
        for (let i = 0; i < roomPlayers.length; i++) {
          const p = roomPlayers[i];
          if (p.id !== this.localMultiplayerPlayerId && p.state) {
            if (centerCount >= centers.length) {
              centers.push({ x: p.state.x, z: p.state.z });
            } else {
              centers[centerCount].x = p.state.x;
              centers[centerCount].z = p.state.z;
            }
            centerCount++;
          }
        }
        centers.length = centerCount;

        const maxCombined = this.simThrottleScale >= 2 ? 14 : 22;
        const enemyLimit = this.simThrottleScale >= 2 ? 6 : 8;
        const animalLimit = this.simThrottleScale >= 2 ? 4 : 7;
        const npcLimit = this.simThrottleScale >= 2 ? 4 : 7;
        const enemyDeltas = this.combat.exportSyncDeltas(centers, enemyLimit, 80);
        const animalDeltas = this.world.wildlife.exportSyncDeltas(centers, animalLimit, 75);
        const npcDeltas = this.world.npcs.exportSyncDeltas(centers, npcLimit, 75);

        const combined = this.mpCombinedDeltasScratch;
        combined.length = 0;
        for (let i = 0; i < enemyDeltas.length && combined.length < maxCombined; i++) {
          combined.push(enemyDeltas[i]);
        }
        for (let i = 0; i < animalDeltas.length && combined.length < maxCombined; i++) {
          combined.push(animalDeltas[i]);
        }
        for (let i = 0; i < npcDeltas.length && combined.length < maxCombined; i++) {
          combined.push(npcDeltas[i]);
        }

        if (combined.length > 0 || this.mpWeatherTimeHeartbeatTimer >= 2.0) {
          this.mpWeatherTimeHeartbeatTimer = 0;
          this.multiplayerService.sendEntitySync({
            entities: combined.slice(0),
            worldHours: Math.round(this.timeManager.getWorldHours() * 1000) / 1000,
            weather: this.weatherManager.getSnapshot().currentState,
          });
        }
      }
    }

    const nowMs = Date.now();
    if (this.cachedPartyState.party && nowMs - this.lastNpcPartySyncAtMs > 500) {
      this.lastNpcPartySyncAtMs = nowMs;
      this.refreshNpcPartyContext();
    }
    const activeCoop: CoopObjectiveState | null =
      this.cachedPartyState.party?.activeObjective ?? null;
    if (
      activeCoop &&
      activeCoop.status === 'active' &&
      (activeCoop.type === 'explore_location' || activeCoop.type === 'escort_npc') &&
      typeof activeCoop.targetX === 'number' &&
      typeof activeCoop.targetZ === 'number' &&
      nowMs - this.lastCoopProximityReportMs > 1200
    ) {
      const distToTarget = Math.hypot(
        pos.x - activeCoop.targetX,
        pos.z - activeCoop.targetZ,
      );
      if (distToTarget <= (activeCoop.targetRadius ?? 16)) {
        this.lastCoopProximityReportMs = nowMs;
        this.multiplayerService.sendCoopObjectiveProgress?.(activeCoop.objectiveId, 1);
      }
    }
  }

  private syncAuthoritativeEntities(ensureTargets: boolean): void {
    if (!this.world || !this.combat) return;
    const playerPos = this.controller?.position ?? this.defaultPlayerPosScratch;
    const isRemoteGuest = this.multiplayerSessionActive && !this.isLocalMultiplayerHost();
    const activeKillObjectives = this.dialogueEngine.quests.getActiveKillObjectives(
      this.dialogueBridge,
    );
    const storyKillRequests = this.storyManager.getActiveKillRequests(
      this.storyBridge,
    );
    const sideQuestKillRequests = this.sideQuestManager.getActiveKillRequests(
      this.sideQuestBridge,
    );
    const combinedKillObjectives = [
      ...activeKillObjectives,
      ...storyKillRequests.map((req) => ({
        questId: req.questId,
        objectiveId: req.objectiveId,
        enemyType: req.enemyType,
        remainingCount: Math.max(0, req.requiredCount - req.currentCount),
        requiredCount: req.requiredCount,
        targetX: req.targetX,
        targetZ: req.targetZ,
      })),
      ...sideQuestKillRequests.map((req) => ({
        questId: req.sideQuestId,
        objectiveId: req.objectiveId,
        enemyType: req.enemyType,
        remainingCount: Math.max(0, req.requiredCount - req.currentCount),
        requiredCount: req.requiredCount,
        targetX: req.targetX,
        targetZ: req.targetZ,
      })),
    ];

    if (ensureTargets && !isRemoteGuest) {
      this.combat.ensureQuestTargets(combinedKillObjectives, {
        playerPos,
        isVillageClearance: this.isVillageClearanceCb,
        queryCollidersNear: this.queryCollidersCb,
        isChunkLoaded: this.isChunkLoadedCb,
      });
      this.world.wildlife.ensureQuestAnimals(activeKillObjectives, {
        playerPos,
        isVillageClearance: this.isVillageClearanceCb,
        queryCollidersNear: this.queryCollidersCb,
      });
      const centers = this.mpCentersScratch;
      if (centers.length === 0) centers.push({ x: playerPos.x, z: playerPos.z });
      else {
        centers[0].x = playerPos.x;
        centers[0].z = playerPos.z;
      }
      let centerCount = 1;
      if (this.multiplayerSessionActive && this.multiplayerService) {
        const roomPlayers = this.multiplayerService.getRoomState()?.players ?? [];
        for (let i = 0; i < roomPlayers.length; i++) {
          const p = roomPlayers[i];
          if (p.id !== this.localMultiplayerPlayerId && p.state) {
            if (centerCount >= centers.length) {
              centers.push({ x: p.state.x, z: p.state.z });
            } else {
              centers[centerCount].x = p.state.x;
              centers[centerCount].z = p.state.z;
            }
            centerCount++;
          }
        }
      }
      centers.length = centerCount;

      this.combat.streamEnemies(
        centers,
        false,
        this.isChunkLoadedCb,
        this.queryCollidersCb,
      );
    }

    const seen = this.syncedEntityIdScratch;
    seen.clear();
    const animalLodDistSq = this.world.wildlife.getMidLodDistSq();

    // 1. Authoritative Villagers / NPCs
    for (let i = 0; i < this.world.npcs.npcs.length; i++) {
      const npc = this.world.npcs.npcs[i];
      const cxz = worldToChunkCoords(npc.position.x, npc.position.z, 120);
      const chunkLoaded = this.world.chunkManager.isChunkLoaded(cxz.cx, cxz.cz);
      const alive = !npc.isDead;
      const valid =
        npc.isSpawnValid &&
        Number.isFinite(npc.position.x) &&
        Number.isFinite(npc.position.y) &&
        Number.isFinite(npc.position.z);
      const loaded = chunkLoaded && npc.rig.root.visible;
      seen.add(npc.id);
      this.entityRegistry.upsertEntity({
        entityId: npc.id,
        type: npc.id.startsWith('villager-') || npc.role === 'villager' ? 'villager' : 'npc',
        worldId: this.entityRegistry.worldId,
        chunkId: resolveChunkIdAt(npc.position.x, npc.position.z),
        position: {
          x: npc.position.x,
          y: npc.position.y,
          z: npc.position.z,
        },
        state: npc.getBehaviorState(),
        alive,
        loaded,
        valid,
        visibleInWorld: alive && valid && loaded,
        name: npc.name,
        nameAr: npc.getLocalizedName('ar'),
        role: npc.role,
      });
    }

    // 2. Authoritative Enemies & Combat Quest Targets
    const blueprints = this.combat.getBlueprintsSnapshot();
    const blueprintsByQuestKey = this.blueprintsByQuestScratch;
    let bucketPoolIdx = 0;
    blueprintsByQuestKey.clear();
    for (let i = 0; i < blueprints.length; i++) {
      const bp = blueprints[i];
      const ex = bp.controller ? bp.controller.position.x : bp.x;
      const ey = bp.controller ? bp.controller.position.y : groundHeightAt(ex, bp.z);
      const ez = bp.controller ? bp.controller.position.z : bp.z;
      const cxz = worldToChunkCoords(ex, ez, 120);
      const chunkLoaded = this.world.chunkManager.isChunkLoaded(cxz.cx, cxz.cz);
      const alive = !bp.defeated && bp.controller?.state !== 'dead';
      const loaded = Boolean(bp.controller && chunkLoaded && bp.controller.rig.root.visible);
      const valid = Number.isFinite(ex) && Number.isFinite(ez);
      const entType: AuthoritativeEntityType =
        bp.archetypeId === 'ancient_guardian'
          ? 'boss'
          : bp.archetypeId === 'bandit_scout'
            ? 'thief'
            : bp.archetypeId === 'ancient_monster'
              ? 'monster'
              : 'enemy';

      seen.add(bp.id);
      this.entityRegistry.upsertEntity({
        entityId: bp.id,
        type: entType,
        worldId: this.entityRegistry.worldId,
        chunkId: resolveChunkIdAt(ex, ez),
        position: { x: ex, y: ey, z: ez },
        state: bp.controller ? bp.controller.state : bp.defeated ? 'dead' : 'unloaded',
        alive,
        loaded,
        valid,
        visibleInWorld: alive && loaded && valid,
        archetype: bp.archetypeId,
        ...(bp.questTarget ? { questTarget: { ...bp.questTarget } } : {}),
      });

      if (bp.questTarget && !this.entityRegistry.isQuestCancelled(bp.questTarget.questId)) {
        const key = `${bp.questTarget.questId}:${bp.questTarget.objectiveId}`;
        let list = blueprintsByQuestKey.get(key);
        if (!list) {
          if (bucketPoolIdx < this.blueprintsBucketPool.length) {
            list = this.blueprintsBucketPool[bucketPoolIdx++];
            list.length = 0;
          } else {
            list = [];
            this.blueprintsBucketPool.push(list);
            bucketPoolIdx++;
          }
          blueprintsByQuestKey.set(key, list);
        }
        list.push(bp);
      }
    }

    // 3. Authoritative Wildlife (for map visibility and animal hunt objectives)
    for (let i = 0; i < this.world.wildlife.animals.length; i++) {
      const a = this.world.wildlife.animals[i];
      const cxz = worldToChunkCoords(a.position.x, a.position.z, 120);
      const chunkLoaded = this.world.chunkManager.isChunkLoaded(cxz.cx, cxz.cz);
      const alive = !a.isDead;
      const loaded = chunkLoaded && (a.rig !== null || a.distSqToPlayer <= animalLodDistSq);
      const valid = Number.isFinite(a.position.x) && Number.isFinite(a.position.z);

      let matchedAnimalTarget: AuthoritativeEntityType | undefined;
      let questTargetRef:
        | {
            questId: string;
            objectiveId: string;
            enemyType: string;
            lifecycle: 'ACTIVE' | 'SPAWNED';
          }
        | undefined;

      if (alive && loaded && activeKillObjectives.length > 0) {
        for (let q = 0; q < activeKillObjectives.length; q++) {
          const obj = activeKillObjectives[q];
          if (obj.enemyType.startsWith('animal:') && enemyTypeMatches(obj.enemyType, `animal:${a.species}`)) {
            matchedAnimalTarget = 'animal';
            questTargetRef = {
              questId: obj.questId,
              objectiveId: obj.objectiveId,
              enemyType: obj.enemyType,
              lifecycle: a.rig ? 'ACTIVE' : 'SPAWNED',
            };
            break;
          }
        }
      }

      seen.add(a.id);
      this.entityRegistry.upsertEntity({
        entityId: a.id,
        type: matchedAnimalTarget ?? 'animal',
        worldId: this.entityRegistry.worldId,
        chunkId: resolveChunkIdAt(a.position.x, a.position.z),
        position: {
          x: a.position.x,
          y: a.position.y + a.altitude,
          z: a.position.z,
        },
        state: a.behaviorState,
        alive,
        loaded,
        valid,
        visibleInWorld: alive && loaded && valid,
        archetype: a.species,
        ...(questTargetRef ? { questTarget: questTargetRef } : {}),
      });
    }

    this.entityRegistry.pruneNotIn(seen, this.authoritativeEntityTypes);

    // 4. Authoritative Quest Target Plans (handles loaded pins vs unloaded-chunk zone hints)
    const plans = this.questPlansScratch;
    plans.length = 0;
    for (let i = 0; i < activeKillObjectives.length; i++) {
      const obj = activeKillObjectives[i];
      if (this.entityRegistry.isQuestCancelled(obj.questId)) continue;
      if (obj.enemyType.startsWith('animal:')) {
        let loadedMatch = false;
        let matchX = obj.targetX;
        let matchZ = obj.targetZ;
        let bestAnimalDistSq = Infinity;
        const animals = this.world.wildlife.animals;
        for (let ai = 0; ai < animals.length; ai++) {
          const a = animals[ai];
          if (a.isDead || a.species === 'bird') continue;
          if (!enemyTypeMatches(obj.enemyType, `animal:${a.species}`)) continue;
          const cxz = worldToChunkCoords(a.position.x, a.position.z, 120);
          const dxA = a.position.x - playerPos.x;
          const dzA = a.position.z - playerPos.z;
          const dSq = dxA * dxA + dzA * dzA;
          if (
            this.world.chunkManager.isChunkLoaded(cxz.cx, cxz.cz) &&
            (a.rig !== null || a.distSqToPlayer <= animalLodDistSq)
          ) {
            loadedMatch = true;
            if (dSq < bestAnimalDistSq) {
              bestAnimalDistSq = dSq;
              matchX = a.position.x;
              matchZ = a.position.z;
            }
          } else if (!loadedMatch && dSq < bestAnimalDistSq) {
            bestAnimalDistSq = dSq;
            matchX = a.position.x;
            matchZ = a.position.z;
          }
        }
        plans.push({
          questId: obj.questId,
          objectiveId: obj.objectiveId,
          enemyType: obj.enemyType,
          canonicalType: obj.canonicalEnemyType,
          requiredCount: obj.requiredCount,
          currentCount: obj.currentCount,
          lifecycle: loadedMatch ? 'ACTIVE' : 'SPAWN_REQUESTED',
          worldId: this.entityRegistry.worldId,
          chunkId:
            typeof matchX === 'number' && typeof matchZ === 'number'
              ? resolveChunkIdAt(matchX, matchZ)
              : resolveChunkIdAt(playerPos.x, playerPos.z),
          targetX: matchX,
          targetZ: matchZ,
          loaded: loadedMatch,
          cancelled: false,
        });
        continue;
      }

      const key = `${obj.questId}:${obj.objectiveId}`;
      const boundList = blueprintsByQuestKey.get(key);
      let anyLoaded = false;
      let fallbackX = obj.targetX;
      let fallbackZ = obj.targetZ;
      let bestDistSq = Infinity;
      let bestChunkId =
        typeof fallbackX === 'number' && typeof fallbackZ === 'number'
          ? resolveChunkIdAt(fallbackX, fallbackZ)
          : resolveChunkIdAt(playerPos.x, playerPos.z);
      let lifecycle: AuthoritativeQuestTargetPlan['lifecycle'] = 'QUEST_TARGET_REQUIRED';

      if (boundList) {
        for (let b = 0; b < boundList.length; b++) {
          const bp = boundList[b];
          if (bp.defeated || bp.controller?.state === 'dead') continue;
          const bx = bp.controller ? bp.controller.position.x : bp.x;
          const bz = bp.controller ? bp.controller.position.z : bp.z;
          const cxz = worldToChunkCoords(bx, bz, 120);
          const isLoaded = Boolean(
            bp.controller &&
              this.world.chunkManager.isChunkLoaded(cxz.cx, cxz.cz) &&
              bp.controller.rig.root.visible,
          );
          if (isLoaded) {
            anyLoaded = true;
            lifecycle = 'ACTIVE';
          } else if (lifecycle !== 'ACTIVE') {
            lifecycle = 'SPAWN_REQUESTED';
          }
          const dxB = bx - playerPos.x;
          const dzB = bz - playerPos.z;
          const dSq = dxB * dxB + dzB * dzB;
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            fallbackX = bx;
            fallbackZ = bz;
            bestChunkId = resolveChunkIdAt(bx, bz);
          }
        }
      }

      plans.push({
        questId: obj.questId,
        objectiveId: obj.objectiveId,
        enemyType: obj.enemyType,
        canonicalType: obj.canonicalEnemyType,
        requiredCount: obj.requiredCount,
        currentCount: obj.currentCount,
        lifecycle,
        worldId: this.entityRegistry.worldId,
        chunkId: bestChunkId,
        targetX: fallbackX,
        targetZ: fallbackZ,
        loaded: anyLoaded,
        cancelled: false,
      });
    }
    this.entityRegistry.setQuestTargetPlans(plans);
  }

  public dispose(): void {
    this.disposed = true;
    this.teardownMultiplayerSync();
    this.sound.stopWorldAmbienceSmooth(0.08);
    getAudioManager().setSceneMode('menu');
    this.unloadWorld();
  }
}
