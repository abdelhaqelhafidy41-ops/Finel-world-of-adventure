import {
  ALLOWED_ATTACK_ANIM_TYPES,
  ALLOWED_MAX_PLAYER_COUNTS,
  ALLOWED_WEAPON_IDS,
  CHAT_HISTORY_LIMIT,
  CHAT_RATE_COOLDOWN_MS,
  ENEMY_LOOT_TABLES,
  HEARTBEAT_TIMEOUT_MS,
  HOST_DISCONNECT_GRACE_MS,
  MAX_AMMO_COUNT,
  MAX_ITEM_STACK_CAP,
  MAX_PLAYER_COINS,
  MAX_PLAYER_LEVEL,
  MAX_PLAYERS_PER_ROOM,
  MAX_WEATHER_DURATION_MS,
  MIN_PLAYERS_PER_ROOM,
  MULTIPLAYER_PROTOCOL_VERSION,
  PARTY_PALETTE_COLORS,
  PLAYER_RECONNECT_GRACE_MS,
  QUEST_SERVER_REWARDS,
  ROOM_INACTIVE_TIMEOUT_MS,
  SERVER_ANIMAL_MAX_HP,
  SERVER_BUILDING_SPECS,
  SERVER_CRAFTABLE_YIELDS,
  SERVER_CROP_SPECS,
  SERVER_ENEMY_ATTACK_MAX_DAMAGE,
  SERVER_ENEMY_MAX_HP,
  SERVER_ITEM_CATALOG,
  SERVER_ITEM_SELL_VALUES,
  SERVER_MERCHANT_OFFERS,
  SERVER_NPC_MAX_HP,
  SERVER_VILLAGE_PROJECTS,
  SERVER_VILLAGE_REPAIRS,
  SERVER_WEAPON_SPECS,
  SIDE_QUEST_SERVER_REWARDS,
  findForbiddenAuthorityKey,
  generateNetworkEntityId,
  getConnectionQuality,
  isAllowedMultiplayerWeaponId,
  isValidPlayerId,
  isValidRoomCode,
  isValidRoomId,
  pickAvatarColor,
  sanitizeDisplayName,
  sanitizeRoomName,
  serverEnemyTypeMatches,
  validateUntrustedProtocolModMetadata,
  verifyMultiplayerModCompatibility,
  type ProtocolRoomIncompatiblePlayerAttempt,
  type ProtocolRoomModCompatibilityStatus,
  type AuthoritativePlayerVitals,
  type AuthoritativeProgressionState,
  type AuthoritativeRoomSnapshot,
  type AuthoritativeWorldSettings,
  type AuthoritativeWorldTimeState,
  type AuthoritativeWorldWeatherState,
  type BossAttackState,
  type BossEncounterState,
  type ChatHistoryPayload,
  type CoopObjectiveRewardEntry,
  type CoopObjectiveState,
  type CoopObjectiveType,
  type CoopQuestStateRecord,
  type DifficultyLevel,
  type LootDistributionMode,
  type LootGrantItem,
  type LootGrantPayload,
  type NetworkEnvelope,
  type NetworkPlayerRecord,
  type PartyInviteRecord,
  type PartyMemberRecord,
  type PartyRecord,
  type PartyStateSnapshot,
  type PlayerBuiltStructureSnapshot,
  type PlayerNetworkState,
  type PlayerReportReason,
  type PlayerStatisticsRecord,
  type PositionCorrectionPayload,
  type ProtocolWorldModMetadata,
  type ReportAckPayload,
  type RoomBuildingState,
  type RoomChatMessage,
  type RoomContainerState,
  type RoomGameState,
  type RoomPrivacy,
  type RoomQuestObjectState,
  type RoomStatus,
  type RoomWorldSnapshotPayload,
  type ServerMessageType,
  type SyncedEntityKind,
  type SyncedModSpawnEntry,
  type VillageDevelopmentSyncRecord,
  type WorldEntitySnapshot,
  type WorldSettingsPermission,
  type WorldTimePreset,
  type WorldType,
  type WorldWeatherState,
} from '../../../shared/multiplayerProtocol';
import {
  migrateAvatarConfig,
  type AvatarConfig,
  type ProfileStatsDelta,
} from '../../../shared/profileTypes';
import {
  createCfWebSocketPair,
  makeWebSocketUpgradeResponse,
  type CfDurableObjectState,
  type CfEnv,
  type CfWebSocket,
} from './cfTypes';
import { ConnectionRateLimiter } from './rateLimiter';
import {
  generateSecurePlayerId,
  generateSecureRoomCode,
  generateSecureSessionToken,
  generateSecureWorldSeed,
  sha256Hex,
  timingSafeEqualHex,
} from './roomId';
import { SecurityAuditLogger, sanitizeClientErrorMessage } from './securityLogger';
import { validateClientMessage } from './validation';

/**
 * Layer 1: Room Metadata (room_meta_v2)
 * Strictly separated from World Data, Shared World Objects, and Player Progression.
 */
interface StoredRoomLayer {
  roomId: string;
  roomCode: string;
  roomName: string;
  hostPlayerId: string;
  players: Record<string, NetworkPlayerRecord>;
  maxPlayers: number;
  gameMode: {
    worldType: WorldType;
    difficulty: DifficultyLevel;
  };
  status: RoomStatus;
  hasEnteredWorld: boolean;
  permissions: {
    privacy: RoomPrivacy;
    isPrivate: boolean;
    allowFriends: boolean;
    requireAllReady: boolean;
    worldSettingsPermission: WorldSettingsPermission;
    locked: boolean;
    hasPassword: boolean;
  };
  passwordHash: string | null;
  playerTokens: Record<string, string>;
  resumeIndex: Record<string, string>;
  playerKeyByPlayerId: Record<string, string>;
  knownPlayerKeys: string[];
  createdAt: number;
  lastActivityAt: number;
  lastPlayerJoinedAt: number | null;
  lastPlayerLeftAt: number | null;
  expiresAt: number;
  modMetadata?: ProtocolWorldModMetadata;
}

interface ServerTrackedEntity {
  id: string;
  kind: SyncedEntityKind;
  archetype: string;
  maxHp: number;
  hp: number;
  isDead: boolean;
  diedAtMs: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  state: string;
  lastUpdatedAtMs: number;
  killSeq?: number;
  damageByPlayer?: Record<string, number>;
  targetPlayerId?: string | null;
  isBoss?: boolean;
  bossPhase?: number;
  attackState?: string;
  dialogueState?: 'idle' | 'talking';
  dialoguePlayerId?: string;
  questState?: string;
  schedulePeriod?: string;
  worldId?: string;
  chunkId?: string;
  alive?: boolean;
  loaded?: boolean;
  questTarget?: {
    questId: string;
    objectiveId: string;
    enemyType?: string;
    lifecycle: string;
  };
}

/**
 * Layer 2: World Data (world_state_v2)
 */
interface StoredWorldLayer {
  worldSeed: number;
  worldName: string;
  startedAt: number | null;
  tick: number;
  day: number;
  time: AuthoritativeWorldTimeState;
  weather: AuthoritativeWorldWeatherState;
  weatherIntensity: number;
  emptyPausedAtMs: number | null;
  pausedWeatherRemainingMs: number | null;
  worldSettings: AuthoritativeWorldSettings;
  npcStates: Record<string, ServerTrackedEntity>;
  animalStates: Record<string, ServerTrackedEntity>;
  enemyStates: Record<string, ServerTrackedEntity>;
  bossEncounters?: Record<string, BossEncounterState>;
  coopQuests?: Record<string, CoopQuestStateRecord>;
  resourceStates: Record<
    string,
    { usesRemaining: number; regenAtMs: number; collectedBy: string }
  >;
  buildingStates: Record<string, RoomBuildingState>;
  discoveredLandmarks: string[];
  modMetadata?: ProtocolWorldModMetadata;
  modSpawns?: SyncedModSpawnEntry[];
}

/**
 * Layer 3: Shared World Objects (shared_objects_v2)
 */
interface StoredSharedObjectsLayer {
  containers: Record<string, RoomContainerState>;
  chests: Record<string, { openedBy: string; openedAtMs: number }>;
  doors: Record<string, boolean>;
  droppedItems: Record<
    string,
    {
      id: string;
      itemId: string;
      count: number;
      label: string;
      x: number;
      y: number;
      z: number;
      droppedBy: string;
    }
  >;
  sharedResources: Record<string, string>;
  questObjects: Record<string, RoomQuestObjectState>;
  placedBeds: Record<
    string,
    { id: string; ownerId: string; x: number; y: number; z: number; yaw: number }
  >;
  placedStations?: Record<
    string,
    {
      id: string;
      stationType: 'crafting_table' | 'furnace';
      ownerId: string;
      x: number;
      y: number;
      z: number;
      yaw: number;
    }
  >;
  playerBuildings?: Record<string, PlayerBuiltStructureSnapshot>;
  villagesDev?: Record<string, VillageDevelopmentSyncRecord>;
  perPlayerPickups?: Record<string, string[]>;
}

interface RoomQuestEntry {
  questId: string;
  status: string;
  stepIndex: number;
  updatedBy: string;
  updatedAtMs: number;
}

/**
 * Layer 4: Isolated Per-Player Persistent Data (player_data_v2:<persistentKey>)
 * Kept completely separate per player so concurrent updates never overwrite another player.
 */
interface StoredPlayerLayer {
  persistentKey: string;
  playerId: string;
  publicProfileId?: string;
  profile: {
    displayName: string;
    playerTag?: string;
    avatarColor: string;
    avatar?: AvatarConfig;
  };
  level: number;
  xp: number;
  coins: number;
  inventory: {
    ammoCount: number;
    inventoryItemIds: string[];
    itemCounts?: Record<string, number>;
    chestWeaponLootCount: number;
  };
  weapons: {
    equippedWeaponId: string | null;
  };
  quests: Record<string, RoomQuestEntry>;
  claimedRewardIds?: string[];
  statistics: PlayerStatisticsRecord;
  vitals: {
    health: number;
    maxHealth: number;
    isDead: boolean;
    reviveAtMs: number | null;
  };
  position: {
    x: number;
    y: number;
    z: number;
    yaw: number;
  };
  updatedAt: number;
}

interface StoredChatModerationLayer {
  chatMessages: RoomChatMessage[];
  reports: RoomReportEntry[];
}

/**
 * Layer 5: Persistent Party & Cooperative Objective State (party_state_v2)
 */
interface StoredPartyLayer {
  parties: Record<string, PartyRecord>;
  playerPartyById: Record<string, string>;
  invites: Record<string, PartyInviteRecord>;
}

interface RoomReportEntry {
  reportId: string;
  targetPlayerId: string;
  targetDisplayName: string;
  reporterPlayerId: string;
  reason: PlayerReportReason;
  details?: string;
  timestamp: number;
}

interface EphemeralCombatRuntime {
  lastDamageAtMs: number;
  lastAttackAtMs: number;
  lastSwingId: string | null;
  lastSwingWeaponId: string | null;
  lastSwingAtMs: number;
  lastSwingTargetIds: string[];
  lastStateAtMs: number;
  movementJitterM: number;
  lastBedUsedAtMs: number;
  lastResourceCollectAtMs: number;
  lastEnemyAttackAtBySource: Record<string, number>;
}

interface ServerTrackedArrow {
  arrowId: string;
  shooterId: string;
  weaponId: string;
  charge: number;
  originX: number;
  originY: number;
  originZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  speed: number;
  gravity: number;
  createdAtMs: number;
  consumed: boolean;
}

/**
 * Legacy v1 shape retained only for seamless automatic migration on boot.
 */
interface LegacyStoredRoomRecord {
  roomId: string;
  roomCode: string;
  roomName: string;
  hostId: string;
  players: Record<string, NetworkPlayerRecord>;
  authoritativePlayers?: Record<
    string,
    {
      networkEntityId: string;
      health: number;
      maxHealth: number;
      isDead: boolean;
      reviveAtMs: number | null;
      ammoCount: number;
      equippedWeaponId: string | null;
      inventoryItemIds: string[];
      lastX: number;
      lastY: number;
      lastZ: number;
      chestWeaponLootCount: number;
      coins: number;
      xp: number;
      level: number;
    }
  >;
  worldSync?: {
    entities?: Record<string, ServerTrackedEntity>;
    openedChests?: Record<string, { openedBy: string; openedAtMs: number }>;
    collectedPickups?: Record<string, string>;
    depletedResources?: Record<
      string,
      { usesRemaining: number; regenAtMs: number; collectedBy: string }
    >;
    doors?: Record<string, boolean>;
    placedBeds?: Record<
      string,
      { id: string; ownerId: string; x: number; y: number; z: number; yaw: number }
    >;
    droppedItems?: Record<
      string,
      {
        id: string;
        itemId: string;
        count: number;
        label: string;
        x: number;
        y: number;
        z: number;
        droppedBy: string;
      }
    >;
    questsByPlayer?: Record<string, Record<string, RoomQuestEntry>>;
    discoveredLandmarks?: string[];
    worldHours?: number;
    weather?: string;
  };
  chatMessages?: RoomChatMessage[];
  reports?: RoomReportEntry[];
  maxPlayers: number;
  status: RoomStatus;
  gameState: RoomGameState;
  passwordHash: string | null;
  playerTokens: Record<string, string>;
  createdAt: number;
  lastActivityAt?: number;
  lastPlayerJoinedAt?: number | null;
  lastPlayerLeftAt?: number | null;
  expiresAt?: number;
  worldTime?: AuthoritativeWorldTimeState;
  worldWeather?: AuthoritativeWorldWeatherState;
}

interface ActiveSocketSession {
  ws: CfWebSocket;
  playerId: string;
  clientIp: string;
  limiter: ConnectionRateLimiter;
  connectedAt: number;
  pendingPingId: number;
  pendingPingSentAt: number;
  lastRttMeasuredAt: number;
  nextPingSeq: number;
  lastChatSentAtMs: number;
  lastChatNormalized: string;
  duplicateChatStreak: number;
  reportedTargets: Set<string>;
  cleanDisconnect: boolean;
}

const LEGACY_ROOM_STORAGE_KEY = 'authoritative_room_v1';
const ROOM_META_KEY = 'room_meta_v2';
const WORLD_STATE_KEY = 'world_state_v2';
const SHARED_OBJECTS_KEY = 'shared_objects_v2';
const CHAT_MOD_KEY = 'room_chat_v2';
const PARTY_STATE_KEY = 'party_state_v2';
const PLAYER_DATA_KEY_PREFIX = 'player_data_v2:';

const PERIODIC_PERSIST_INTERVAL_MS = 5_000;
const MAX_PLAYER_SPEED_MPS = 18;
const MAX_MOVEMENT_JITTER_M = 6;
const MAX_CONNECTIONS_PER_IP_PER_ROOM = 8;
const BED_HEAL_COOLDOWN_MS = 8_000;
const STARTING_COINS_BY_WORLD_TYPE: Record<WorldType, number> = {
  creative: 500,
  adventure: 50,
  normal: 0,
  survival: 0,
};
const TIME_PRESET_HOURS: Record<WorldTimePreset, number> = {
  sunrise: 6.2,
  noon: 12.0,
  sunset: 18.2,
  midnight: 0.0,
};
const ENEMY_REWARDS: Record<string, { xp: number; coins: number }> = {
  bandit_scout: { xp: 28, coins: 14 },
  thorn_stalker: { xp: 24, coins: 10 },
  stone_sentinel: { xp: 48, coins: 28 },
  ancient_monster: { xp: 42, coins: 22 },
  ancient_guardian: { xp: 180, coins: 95 },
};
const VALID_QUEST_STATUSES = new Set<string>([
  'locked',
  'available',
  'active',
  'completed',
]);
const VALID_WORLD_TYPES = new Set<WorldType>([
  'normal',
  'adventure',
  'survival',
  'creative',
]);
const VALID_DIFFICULTIES = new Set<DifficultyLevel>(['easy', 'normal', 'hard']);
const VALID_PRIVACY = new Set<RoomPrivacy>(['public', 'friends', 'private']);
const VALID_WEATHER_STATES = new Set<WorldWeatherState>([
  'clear',
  'cloudy',
  'overcast',
  'rain',
  'storm',
  'fog',
]);

function defaultPlayerStatistics(): PlayerStatisticsRecord {
  return {
    damageDealt: 0,
    enemiesDefeated: 0,
    animalsDefeated: 0,
    resourcesCollected: 0,
    questsCompleted: 0,
    chestsOpened: 0,
    bedsUsed: 0,
    itemsCrafted: 0,
  };
}

function defaultInventoryIds(): string[] {
  return [
    'compass',
    'journal',
    'ranger-sword',
    'woodland-axe',
    'hunter-bow',
    'arrow',
  ];
}

export class MultiplayerRoomDO {
  private readonly ctx: CfDurableObjectState;
  private readonly env: CfEnv;

  private roomLayer: StoredRoomLayer | null = null;
  private worldLayer: StoredWorldLayer | null = null;
  private sharedObjectsLayer: StoredSharedObjectsLayer | null = null;
  private chatLayer: StoredChatModerationLayer | null = null;
  private partyLayer: StoredPartyLayer | null = null;
  private readonly playerDataByKey = new Map<string, StoredPlayerLayer>();
  private readonly runtimeByPlayerId = new Map<string, EphemeralCombatRuntime>();

  private dirtyRoom = false;
  private dirtyWorld = false;
  private dirtyShared = false;
  private dirtyChat = false;
  private dirtyParty = false;
  private readonly dirtyPlayerKeys = new Set<string>();
  private persistChain: Promise<void> = Promise.resolve();
  private lastPeriodicPersistAt = 0;

  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private readonly sessions = new Map<WebSocket, ActiveSocketSession>();
  private readonly activeArrows = new Map<string, ServerTrackedArrow>();
  private chatSeq = 0;
  private reportSeq = 0;
  private partySeq = 0;
  private readonly bootAt = Date.now();
  private readonly lastVillageDefenseWinByVillageId = new Map<string, number>();
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly wsHandshakeTimestamps = new Map<string, number[]>();
  private readonly lastAmmoCraftAtByPlayer = new Map<string, number>();
  private readonly lastQuestCompleteAtByPlayer = new Map<string, number>();
  private readonly lastChestOpenAtByPlayer = new Map<string, number>();
  private readonly lastCoopProgressAtByPlayer = new Map<string, number>();
  private readonly lastDistantPlayerRelayAt = new Map<string, number>();
  private readonly lastEntityTimeHeartbeatAt = new Map<string, number>();
  private readonly incompatibleJoinAttempts: ProtocolRoomIncompatiblePlayerAttempt[] = [];
  private readonly securityLogger = new SecurityAuditLogger();

  constructor(ctx: CfDurableObjectState, env: CfEnv) {
    this.ctx = ctx;
    this.env = env;
  }

  private getHostDisconnectGraceMs(): number {
    const raw = Number(this.env?.HOST_DISCONNECT_GRACE_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : HOST_DISCONNECT_GRACE_MS;
  }

  private getPlayerReconnectGraceMs(): number {
    const raw = Number(this.env?.PLAYER_RECONNECT_GRACE_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : PLAYER_RECONNECT_GRACE_MS;
  }

  private clearSweepTimer(): void {
    if (this.sweepTimer !== null) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private getDefaultStartingCoins(): number {
    const wt = this.roomLayer?.gameMode.worldType ?? 'normal';
    return STARTING_COINS_BY_WORLD_TYPE[wt] ?? 0;
  }

  private makeDefaultWorldLayer(
    worldSeed: number,
    worldName: string,
    worldType: WorldType,
    difficulty: DifficultyLevel,
    nowMs: number,
    friendlyFire = false,
  ): StoredWorldLayer {
    return {
      worldSeed,
      worldName,
      startedAt: null,
      tick: 0,
      day: 1,
      time: {
        worldHours: 8.2,
        dayCount: 1,
        timeScale: 1,
        paused: false,
        fullDayDurationSeconds: 720,
        anchorServerMs: nowMs,
      },
      weather: {
        currentState: 'clear',
        targetState: 'clear',
        intensity: 0,
        dynamicEnabled: true,
        transitionDurationSeconds: 12,
        startMs: nowMs,
        durationMs: 240_000,
        endMs: nowMs + 240_000,
      },
      weatherIntensity: 0,
      emptyPausedAtMs: null,
      pausedWeatherRemainingMs: null,
      worldSettings: {
        worldType,
        difficulty,
        pvpEnabled: false,
        friendlyFire,
        staminaUnlimited: worldType === 'creative',
        spawnX: 0,
        spawnY: 0,
        spawnZ: 4,
      },
      npcStates: {},
      animalStates: {},
      enemyStates: {},
      bossEncounters: {},
      coopQuests: {},
      resourceStates: {},
      buildingStates: {},
      discoveredLandmarks: [],
    };
  }

  private makeDefaultSharedObjectsLayer(): StoredSharedObjectsLayer {
    return {
      containers: {},
      chests: {},
      doors: {},
      droppedItems: {},
      sharedResources: {},
      questObjects: {},
      placedBeds: {},
      placedStations: {},
      playerBuildings: {},
      villagesDev: {},
    };
  }

  private makeDefaultChatLayer(): StoredChatModerationLayer {
    return {
      chatMessages: [],
      reports: [],
    };
  }

  private makeDefaultPartyLayer(): StoredPartyLayer {
    return {
      parties: {},
      playerPartyById: {},
      invites: {},
    };
  }

  private ensureWorldLayer(): StoredWorldLayer {
    if (!this.worldLayer) {
      const rl = this.roomLayer!;
      this.worldLayer = this.makeDefaultWorldLayer(
        generateSecureWorldSeed(),
        rl.roomName,
        rl.gameMode.worldType,
        rl.gameMode.difficulty,
        rl.createdAt || Date.now(),
      );
      this.dirtyWorld = true;
    }
    if (this.worldLayer.worldSettings.friendlyFire === undefined) {
      this.worldLayer.worldSettings.friendlyFire = false;
    }
    if (!this.worldLayer.bossEncounters) {
      this.worldLayer.bossEncounters = {};
    }
    if (!this.worldLayer.coopQuests) {
      this.worldLayer.coopQuests = {};
    }
    return this.worldLayer;
  }

  private ensureSharedObjectsLayer(): StoredSharedObjectsLayer {
    if (!this.sharedObjectsLayer) {
      this.sharedObjectsLayer = this.makeDefaultSharedObjectsLayer();
      this.dirtyShared = true;
    }
    if (!this.sharedObjectsLayer.playerBuildings) {
      this.sharedObjectsLayer.playerBuildings = {};
    }
    if (!this.sharedObjectsLayer.villagesDev) {
      this.sharedObjectsLayer.villagesDev = {};
    }
    if (!this.sharedObjectsLayer.perPlayerPickups) {
      this.sharedObjectsLayer.perPlayerPickups = {};
    }
    return this.sharedObjectsLayer;
  }

  private ensureChatLayer(): StoredChatModerationLayer {
    if (!this.chatLayer) {
      this.chatLayer = this.makeDefaultChatLayer();
      this.dirtyChat = true;
    }
    return this.chatLayer;
  }

  private ensurePartyLayer(): StoredPartyLayer {
    if (!this.partyLayer) {
      this.partyLayer = this.makeDefaultPartyLayer();
      this.dirtyParty = true;
    }
    return this.partyLayer;
  }

  private resolvePersistentKeyForPlayerId(playerId: string): string {
    if (this.roomLayer?.playerKeyByPlayerId[playerId]) {
      return this.roomLayer.playerKeyByPlayerId[playerId];
    }
    const player = this.roomLayer?.players[playerId];
    if (player?.publicProfileId) {
      return `profile:${player.publicProfileId}`;
    }
    return `player:${playerId}`;
  }

  private ensurePlayerDataForPlayer(playerId: string): StoredPlayerLayer {
    const key = this.resolvePersistentKeyForPlayerId(playerId);
    let data = this.playerDataByKey.get(key);
    const roomPlayer = this.roomLayer?.players[playerId];
    const ws = this.ensureWorldLayer().worldSettings;
    if (!data) {
      const now = Date.now();
      data = {
        persistentKey: key,
        playerId,
        ...(roomPlayer?.publicProfileId
          ? { publicProfileId: roomPlayer.publicProfileId }
          : {}),
        profile: {
          displayName: roomPlayer?.displayName ?? 'Adventurer',
          ...(roomPlayer?.playerTag ? { playerTag: roomPlayer.playerTag } : {}),
          avatarColor: roomPlayer?.avatarColor ?? pickAvatarColor(playerId),
          ...(roomPlayer?.avatar ? { avatar: roomPlayer.avatar } : {}),
        },
        level: 1,
        xp: 0,
        coins: this.getDefaultStartingCoins(),
        inventory: {
          ammoCount: 24,
          inventoryItemIds: defaultInventoryIds(),
          itemCounts: {},
          chestWeaponLootCount: 0,
        },
        weapons: {
          equippedWeaponId: 'ranger-sword',
        },
        quests: {},
        claimedRewardIds: [],
        statistics: defaultPlayerStatistics(),
        vitals: {
          health: roomPlayer?.health ?? 100,
          maxHealth: roomPlayer?.maxHealth ?? 100,
          isDead: Boolean(roomPlayer?.isDead),
          reviveAtMs: null,
        },
        position: {
          x: roomPlayer?.state?.x ?? ws.spawnX ?? 0,
          y: roomPlayer?.state?.y ?? ws.spawnY ?? 0,
          z: roomPlayer?.state?.z ?? ws.spawnZ ?? 4,
          yaw: roomPlayer?.state?.yaw ?? 0,
        },
        updatedAt: now,
      };
      this.playerDataByKey.set(key, data);
      if (this.roomLayer) {
        this.roomLayer.playerKeyByPlayerId[playerId] = key;
        if (!this.roomLayer.knownPlayerKeys.includes(key)) {
          this.roomLayer.knownPlayerKeys.push(key);
          this.dirtyRoom = true;
        }
      }
      this.dirtyPlayerKeys.add(key);
    }
    if (!data.inventory.itemCounts) {
      data.inventory.itemCounts = {};
    }
    if (!Array.isArray(data.claimedRewardIds)) {
      data.claimedRewardIds = [];
    }
    return data;
  }

  private isActiveRoomModItem(itemId: string): boolean {
    if (!itemId || itemId.length > 96 || !itemId.includes(':')) return false;
    const sep = itemId.indexOf(':');
    if (sep <= 0 || sep >= itemId.length - 1) return false;
    const modId = itemId.slice(0, sep);
    const mods = (this.roomLayer?.modMetadata ?? this.worldLayer?.modMetadata)?.mods;
    if (!Array.isArray(mods)) return false;
    return mods.some((m) => m.modId === modId);
  }

  private resolveCombatWeaponSpec(weaponId: string) {
    const base = SERVER_WEAPON_SPECS[weaponId];
    if (base) return base;
    if (isAllowedMultiplayerWeaponId(weaponId) && this.isActiveRoomModItem(weaponId)) {
      const isRanged = /bow|crossbow/i.test(weaponId);
      return {
        id: weaponId,
        baseDamage: isRanged ? 38 : 48,
        minDamage: isRanged ? 12 : 48,
        maxDamage: isRanged ? 58 : 48,
        range: isRanged ? 54 : 3.4,
        cooldownMs: 300,
        isRanged,
        critMult: 1.65,
        critChance: 0.25,
        headshotMult: 2.0,
        minSpeed: 15,
        maxSpeed: 48,
        gravity: 9.8,
      };
    }
    return null;
  }

  private adjustPlayerItemCount(
    pData: StoredPlayerLayer,
    itemId: string,
    delta: number,
  ): void {
    const cleanId = itemId.trim().slice(0, 96);
    if (!cleanId || !Number.isFinite(delta) || delta === 0) return;
    if (cleanId === 'arrow') {
      pData.inventory.ammoCount = Math.max(
        0,
        Math.min(MAX_AMMO_COUNT, pData.inventory.ammoCount + Math.round(delta)),
      );
      return;
    }
    if (ALLOWED_WEAPON_IDS.has(cleanId)) {
      if (delta > 0 && !pData.inventory.inventoryItemIds.includes(cleanId)) {
        pData.inventory.inventoryItemIds.push(cleanId);
      }
      return;
    }
    if (!pData.inventory.itemCounts) {
      pData.inventory.itemCounts = {};
    }
    const maxStack = SERVER_ITEM_CATALOG[cleanId]?.maxStack ?? MAX_ITEM_STACK_CAP;
    const prev = pData.inventory.itemCounts[cleanId] ?? 0;
    const next = Math.max(0, Math.min(maxStack, prev + Math.round(delta)));
    if (next > 0) {
      pData.inventory.itemCounts[cleanId] = next;
      if (!pData.inventory.inventoryItemIds.includes(cleanId)) {
        pData.inventory.inventoryItemIds.push(cleanId);
      }
      } else {
      delete pData.inventory.itemCounts[cleanId];
      if (!defaultInventoryIds().includes(cleanId)) {
        const idx = pData.inventory.inventoryItemIds.indexOf(cleanId);
        if (idx !== -1) pData.inventory.inventoryItemIds.splice(idx, 1);
      }
    }
  }

  private getPlayerItemCount(pData: StoredPlayerLayer, itemId: string): number {
    const cleanId = itemId.trim().slice(0, 96);
    if (!cleanId) return 0;
    if (cleanId === 'arrow') return pData.inventory.ammoCount;
    if (ALLOWED_WEAPON_IDS.has(cleanId)) {
      return pData.inventory.inventoryItemIds.includes(cleanId) ? 1 : 0;
    }
    return pData.inventory.itemCounts?.[cleanId] ?? 0;
  }

  private computeVillageLevelForXp(xp: number): number {
    if (xp >= 900) return 5;
    if (xp >= 560) return 4;
    if (xp >= 300) return 3;
    if (xp >= 120) return 2;
    return 1;
  }

  private ensureVillageDevRecord(
    shared: StoredSharedObjectsLayer,
    villageId: string,
  ): VillageDevelopmentSyncRecord {
    const map = shared.villagesDev ?? (shared.villagesDev = {});
    let rec = map[villageId];
    if (!rec) {
      rec = {
        villageId,
        level: 1,
        progressXp: 0,
        reputationPoints: 0,
        completedRepairIds: [],
        completedProjectIds: [],
        cropsHarvestedCount: 0,
        tradesCompletedCount: 0,
        defensesWonCount: 0,
      };
      map[villageId] = rec;
    }
    return rec;
  }

  private applyVillageProgressSync(
    shared: StoredSharedObjectsLayer,
    villageId: string,
    xpDelta: number,
    repDelta: number,
  ): VillageDevelopmentSyncRecord {
    const rec = this.ensureVillageDevRecord(shared, villageId);
    rec.progressXp = Math.max(0, rec.progressXp + Math.max(0, Math.round(xpDelta)));
    rec.reputationPoints = Math.max(0, rec.reputationPoints + Math.max(0, Math.round(repDelta)));
    rec.level = this.computeVillageLevelForXp(rec.progressXp);
    return rec;
  }

  private getVillageDiscountAndSellBonus(points: number): {
    discountPct: number;
    sellBonusPct: number;
  } {
    if (points >= 480) return { discountPct: 22, sellBonusPct: 16 };
    if (points >= 280) return { discountPct: 16, sellBonusPct: 12 };
    if (points >= 140) return { discountPct: 10, sellBonusPct: 8 };
    if (points >= 50) return { discountPct: 5, sellBonusPct: 4 };
    return { discountPct: 0, sellBonusPct: 0 };
  }

  private ensureRuntimeForPlayer(playerId: string): EphemeralCombatRuntime {
    let rt = this.runtimeByPlayerId.get(playerId);
    if (!rt) {
      rt = {
        lastDamageAtMs: 0,
        lastAttackAtMs: 0,
        lastSwingId: null,
        lastSwingWeaponId: null,
        lastSwingAtMs: 0,
        lastSwingTargetIds: [],
        lastStateAtMs: 0,
        movementJitterM: MAX_MOVEMENT_JITTER_M,
        lastBedUsedAtMs: 0,
        lastResourceCollectAtMs: 0,
        lastEnemyAttackAtBySource: {},
      };
      this.runtimeByPlayerId.set(playerId, rt);
    }
    return rt;
  }

  private getEntityMapByKind(
    world: StoredWorldLayer,
    kind: SyncedEntityKind,
  ): Record<string, ServerTrackedEntity> {
    if (kind === 'npc') return world.npcStates;
    if (kind === 'animal') return world.animalStates;
    return world.enemyStates;
  }

  private findEntityById(
    world: StoredWorldLayer,
    entityId: string,
  ): ServerTrackedEntity | undefined {
    return (
      world.enemyStates[entityId] ??
      world.animalStates[entityId] ??
      world.npcStates[entityId]
    );
  }

  private getAllEntities(world: StoredWorldLayer): ServerTrackedEntity[] {
    return [
      ...Object.values(world.npcStates),
      ...Object.values(world.animalStates),
      ...Object.values(world.enemyStates),
    ];
  }

  /**
   * Serializes all layer writes onto `persistChain` so concurrent player or world
   * updates never race or clobber unrelated storage keys.
   */
  private flushDirtyLayers(flags?: {
    room?: boolean;
    world?: boolean;
    shared?: boolean;
    chat?: boolean;
    party?: boolean;
    playerKeys?: string[];
  }): Promise<void> {
    if (flags?.room) this.dirtyRoom = true;
    if (flags?.world) this.dirtyWorld = true;
    if (flags?.shared) this.dirtyShared = true;
    if (flags?.chat) this.dirtyChat = true;
    if (flags?.party) this.dirtyParty = true;
    if (flags?.playerKeys) {
      for (const pk of flags.playerKeys) {
        if (pk) this.dirtyPlayerKeys.add(pk);
      }
    }

    const writeRoom = this.dirtyRoom;
    const writeWorld = this.dirtyWorld;
    const writeShared = this.dirtyShared;
    const writeChat = this.dirtyChat;
    const writeParty = this.dirtyParty;
    const writePlayerKeys = Array.from(this.dirtyPlayerKeys);

    this.dirtyRoom = false;
    this.dirtyWorld = false;
    this.dirtyShared = false;
    this.dirtyChat = false;
    this.dirtyParty = false;
    this.dirtyPlayerKeys.clear();

    if (
      !writeRoom &&
      !writeWorld &&
      !writeShared &&
      !writeChat &&
      !writeParty &&
      writePlayerKeys.length === 0
    ) {
      return this.persistChain;
    }

    const roomSnap = writeRoom && this.roomLayer ? structuredClone(this.roomLayer) : null;
    const worldSnap =
      writeWorld && this.worldLayer ? structuredClone(this.worldLayer) : null;
    const sharedSnap =
      writeShared && this.sharedObjectsLayer
        ? structuredClone(this.sharedObjectsLayer)
        : null;
    const chatSnap = writeChat && this.chatLayer ? structuredClone(this.chatLayer) : null;
    const partySnap = writeParty && this.partyLayer ? structuredClone(this.partyLayer) : null;
    const playerSnaps = writePlayerKeys
      .map((pk) => {
        const pd = this.playerDataByKey.get(pk);
        return pd ? ([pk, structuredClone(pd)] as const) : null;
      })
      .filter((entry): entry is readonly [string, StoredPlayerLayer] => Boolean(entry));

    const run = this.persistChain.then(async () => {
      if (roomSnap) {
        await this.ctx.storage.put(ROOM_META_KEY, roomSnap);
      }
      if (worldSnap) {
        await this.ctx.storage.put(WORLD_STATE_KEY, worldSnap);
      }
      if (sharedSnap) {
        await this.ctx.storage.put(SHARED_OBJECTS_KEY, sharedSnap);
      }
      if (chatSnap) {
        await this.ctx.storage.put(CHAT_MOD_KEY, chatSnap);
      }
      if (partySnap) {
        await this.ctx.storage.put(PARTY_STATE_KEY, partySnap);
      }
      for (const [pk, pdSnap] of playerSnaps) {
        await this.ctx.storage.put(`${PLAYER_DATA_KEY_PREFIX}${pk}`, pdSnap);
      }
      await this.ctx.storage.delete(LEGACY_ROOM_STORAGE_KEY);
    });

    this.persistChain = run.catch(() => {});
    return run;
  }

  private async deleteAllRoomStorage(): Promise<void> {
    const keysToDelete = this.roomLayer?.knownPlayerKeys?.slice() ?? [];
    for (const pk of this.playerDataByKey.keys()) {
      if (!keysToDelete.includes(pk)) keysToDelete.push(pk);
    }
    this.dirtyRoom = false;
    this.dirtyWorld = false;
    this.dirtyShared = false;
    this.dirtyChat = false;
    this.dirtyParty = false;
    this.dirtyPlayerKeys.clear();
    const run = this.persistChain.then(async () => {
      await this.ctx.storage.delete(ROOM_META_KEY);
      await this.ctx.storage.delete(WORLD_STATE_KEY);
      await this.ctx.storage.delete(SHARED_OBJECTS_KEY);
      await this.ctx.storage.delete(CHAT_MOD_KEY);
      await this.ctx.storage.delete(PARTY_STATE_KEY);
      await this.ctx.storage.delete(LEGACY_ROOM_STORAGE_KEY);
      for (const pk of keysToDelete) {
        await this.ctx.storage.delete(`${PLAYER_DATA_KEY_PREFIX}${pk}`);
      }
    });
    this.persistChain = run.catch(() => {});
    await run;
  }

  private async persistExpiredTombstone(): Promise<void> {
    const keysToDelete = this.roomLayer?.knownPlayerKeys?.slice() ?? [];
    for (const pk of this.playerDataByKey.keys()) {
      if (!keysToDelete.includes(pk)) keysToDelete.push(pk);
    }
    const tombstone = this.roomLayer ? structuredClone(this.roomLayer) : null;
    this.dirtyRoom = false;
    this.dirtyWorld = false;
    this.dirtyShared = false;
    this.dirtyChat = false;
    this.dirtyParty = false;
    this.dirtyPlayerKeys.clear();

    const run = this.persistChain.then(async () => {
      if (tombstone) {
        tombstone.knownPlayerKeys = [];
        tombstone.resumeIndex = {};
        tombstone.playerKeyByPlayerId = {};
        tombstone.playerTokens = {};
        tombstone.players = {};
        await this.ctx.storage.put(ROOM_META_KEY, tombstone);
      }
      await this.ctx.storage.delete(WORLD_STATE_KEY);
      await this.ctx.storage.delete(SHARED_OBJECTS_KEY);
      await this.ctx.storage.delete(CHAT_MOD_KEY);
      await this.ctx.storage.delete(PARTY_STATE_KEY);
      await this.ctx.storage.delete(LEGACY_ROOM_STORAGE_KEY);
      for (const pk of keysToDelete) {
        await this.ctx.storage.delete(`${PLAYER_DATA_KEY_PREFIX}${pk}`);
      }
    });
    this.persistChain = run.catch(() => {});
    await run;
  }

  private async migrateLegacyRecord(legacy: LegacyStoredRoomRecord): Promise<void> {
    const now = Date.now();
    const createdAt = legacy.createdAt || now;
    const lastActivityAt = legacy.lastActivityAt ?? createdAt;
    const expiresAt = legacy.expiresAt ?? lastActivityAt + ROOM_INACTIVE_TIMEOUT_MS;
    const worldType = legacy.gameState.worldType ?? 'normal';
    const difficulty = legacy.gameState.difficulty ?? 'normal';

    const playerKeyByPlayerId: Record<string, string> = {};
    const knownPlayerKeys: string[] = [];

    for (const [pid, p] of Object.entries(legacy.players ?? {})) {
      const pk = p.publicProfileId ? `profile:${p.publicProfileId}` : `player:${pid}`;
      playerKeyByPlayerId[pid] = pk;
      if (!knownPlayerKeys.includes(pk)) knownPlayerKeys.push(pk);
      const auth = legacy.authoritativePlayers?.[pid];
      const quests = legacy.worldSync?.questsByPlayer?.[pid] ?? {};
      const playerLayer: StoredPlayerLayer = {
        persistentKey: pk,
        playerId: pid,
        ...(p.publicProfileId ? { publicProfileId: p.publicProfileId } : {}),
        profile: {
          displayName: p.displayName,
          ...(p.playerTag ? { playerTag: p.playerTag } : {}),
          avatarColor: p.avatarColor ?? pickAvatarColor(pid),
          ...(p.avatar ? { avatar: p.avatar } : {}),
        },
        level: auth?.level ?? 1,
        xp: auth?.xp ?? 0,
        coins: auth?.coins ?? STARTING_COINS_BY_WORLD_TYPE[worldType] ?? 0,
        inventory: {
          ammoCount: auth?.ammoCount ?? 24,
          inventoryItemIds: Array.isArray(auth?.inventoryItemIds)
            ? auth.inventoryItemIds.slice()
            : defaultInventoryIds(),
          chestWeaponLootCount: auth?.chestWeaponLootCount ?? 0,
        },
        weapons: {
          equippedWeaponId: auth?.equippedWeaponId ?? 'ranger-sword',
        },
        quests: { ...quests },
        statistics: defaultPlayerStatistics(),
        vitals: {
          health: auth?.health ?? p.health ?? 100,
          maxHealth: auth?.maxHealth ?? p.maxHealth ?? 100,
          isDead: Boolean(auth?.isDead ?? p.isDead),
          reviveAtMs: auth?.reviveAtMs ?? null,
        },
        position: {
          x: auth?.lastX ?? p.state?.x ?? 0,
          y: auth?.lastY ?? p.state?.y ?? 0,
          z: auth?.lastZ ?? p.state?.z ?? 4,
          yaw: p.state?.yaw ?? 0,
        },
        updatedAt: now,
      };
      this.playerDataByKey.set(pk, playerLayer);
      this.dirtyPlayerKeys.add(pk);
    }

    this.roomLayer = {
      roomId: legacy.roomId,
      roomCode: legacy.roomCode,
      roomName: legacy.roomName,
      hostPlayerId: legacy.hostId,
      players: legacy.players ?? {},
      maxPlayers: legacy.maxPlayers,
      gameMode: { worldType, difficulty },
      status: legacy.status,
      hasEnteredWorld:
        legacy.status === 'in-game' || Boolean(legacy.gameState.startedAt),
      permissions: {
        privacy: legacy.gameState.privacy ?? 'public',
        isPrivate: Boolean(legacy.gameState.isPrivate),
        allowFriends: legacy.gameState.allowFriends !== false,
        requireAllReady: legacy.gameState.requireAllReady !== false,
        worldSettingsPermission: legacy.gameState.worldSettingsPermission ?? 'HOST_ONLY',
        locked: Boolean(legacy.gameState.locked),
        hasPassword: Boolean(legacy.gameState.hasPassword),
      },
      passwordHash: legacy.passwordHash ?? null,
      playerTokens: legacy.playerTokens ?? {},
      resumeIndex: {},
      playerKeyByPlayerId,
      knownPlayerKeys,
      createdAt,
      lastActivityAt,
      lastPlayerJoinedAt: legacy.lastPlayerJoinedAt ?? null,
      lastPlayerLeftAt: legacy.lastPlayerLeftAt ?? null,
      expiresAt,
    };

    const ws = legacy.worldSync;
    const npcStates: Record<string, ServerTrackedEntity> = {};
    const animalStates: Record<string, ServerTrackedEntity> = {};
    const enemyStates: Record<string, ServerTrackedEntity> = {};
    for (const ent of Object.values(ws?.entities ?? {})) {
      if (ent.kind === 'npc') npcStates[ent.id] = ent;
      else if (ent.kind === 'animal') animalStates[ent.id] = ent;
      else enemyStates[ent.id] = ent;
    }

    const wt: AuthoritativeWorldTimeState = legacy.worldTime ?? {
      worldHours: typeof ws?.worldHours === 'number' ? ws.worldHours : 8.2,
      dayCount: 1,
      timeScale: 1,
      paused: false,
      fullDayDurationSeconds: 720,
      anchorServerMs: now,
    };
    const ww: AuthoritativeWorldWeatherState = legacy.worldWeather ?? {
      currentState: 'clear',
      targetState: 'clear',
      intensity: 0,
      dynamicEnabled: true,
      transitionDurationSeconds: 12,
      startMs: now,
      durationMs: 240_000,
      endMs: now + 240_000,
    };

    this.worldLayer = {
      worldSeed: legacy.gameState.seed,
      worldName: legacy.gameState.worldName,
      startedAt: legacy.gameState.startedAt ?? null,
      tick: legacy.gameState.tick ?? 0,
      day: wt.dayCount,
      time: wt,
      weather: ww,
      weatherIntensity: ww.intensity,
      emptyPausedAtMs: Object.keys(legacy.players ?? {}).length === 0 ? now : null,
      pausedWeatherRemainingMs:
        Object.keys(legacy.players ?? {}).length === 0
          ? Math.max(5_000, ww.endMs - now)
          : null,
      worldSettings: legacy.gameState.worldSettings ?? {
        worldType,
        difficulty,
        pvpEnabled: false,
        staminaUnlimited: worldType === 'creative',
        spawnX: 0,
        spawnY: 0,
        spawnZ: 4,
      },
      npcStates,
      animalStates,
      enemyStates,
      resourceStates: ws?.depletedResources ?? {},
      buildingStates: {},
      discoveredLandmarks: ws?.discoveredLandmarks ?? [],
    };

    this.sharedObjectsLayer = {
      containers: {},
      chests: ws?.openedChests ?? {},
      doors: ws?.doors ?? {},
      droppedItems: ws?.droppedItems ?? {},
      sharedResources: ws?.collectedPickups ?? {},
      questObjects: {},
      placedBeds: ws?.placedBeds ?? {},
      placedStations: {},
    };

    this.chatLayer = {
      chatMessages: legacy.chatMessages ?? [],
      reports: legacy.reports ?? [],
    };

    await this.flushDirtyLayers({
      room: true,
      world: true,
      shared: true,
      chat: true,
    });
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadPromise) {
      this.loadPromise = this.performLoad().finally(() => {
        this.loadPromise = null;
      });
    }
    await this.loadPromise;
  }

  private async performLoad(): Promise<void> {
    if (this.loaded) return;

    const savedRoom = await this.ctx.storage.get<StoredRoomLayer>(ROOM_META_KEY);
    if (savedRoom && isValidRoomId(savedRoom.roomId)) {
      this.roomLayer = savedRoom;
      if (!this.roomLayer.resumeIndex) this.roomLayer.resumeIndex = {};
      if (!this.roomLayer.playerKeyByPlayerId) this.roomLayer.playerKeyByPlayerId = {};
      if (!Array.isArray(this.roomLayer.knownPlayerKeys)) {
        this.roomLayer.knownPlayerKeys = [];
      }
      this.worldLayer =
        (await this.ctx.storage.get<StoredWorldLayer>(WORLD_STATE_KEY)) ?? null;
      this.sharedObjectsLayer =
        (await this.ctx.storage.get<StoredSharedObjectsLayer>(SHARED_OBJECTS_KEY)) ??
        null;
      this.chatLayer =
        (await this.ctx.storage.get<StoredChatModerationLayer>(CHAT_MOD_KEY)) ?? null;
      this.partyLayer =
        (await this.ctx.storage.get<StoredPartyLayer>(PARTY_STATE_KEY)) ?? null;

      for (const pk of this.roomLayer.knownPlayerKeys) {
        const pd = await this.ctx.storage.get<StoredPlayerLayer>(
          `${PLAYER_DATA_KEY_PREFIX}${pk}`,
        );
        if (pd) {
          if (!pd.inventory.itemCounts) pd.inventory.itemCounts = {};
          if (!Array.isArray(pd.claimedRewardIds)) pd.claimedRewardIds = [];
          if (pd.profile?.avatar) {
            const mig = migrateAvatarConfig(pd.profile.avatar);
            if (mig.migrated) {
              pd.profile.avatar = mig.avatar;
              await this.ctx.storage.put(`${PLAYER_DATA_KEY_PREFIX}${pk}`, pd);
            }
          }
          this.playerDataByKey.set(pk, pd);
        }
      }
    } else {
      const legacy =
        await this.ctx.storage.get<LegacyStoredRoomRecord>(LEGACY_ROOM_STORAGE_KEY);
      if (legacy && isValidRoomId(legacy.roomId)) {
        await this.migrateLegacyRecord(legacy);
      }
    }

    if (this.roomLayer && isValidRoomId(this.roomLayer.roomId)) {
      if (this.roomLayer.status !== 'closed') {
        this.ensureWorldLayer();
        this.ensureSharedObjectsLayer();
        this.ensureChatLayer();
        this.ensurePartyLayer();
      }
      const connectedIds = new Set(
        Array.from(this.sessions.values()).map((s) => s.playerId),
      );
      let modified = false;
      for (const p of Object.values(this.roomLayer.players)) {
        if (p.avatar) {
          const mig = migrateAvatarConfig(p.avatar);
          if (mig.migrated) {
            p.avatar = mig.avatar;
            modified = true;
          }
        }
        if (!connectedIds.has(p.playerId)) {
          if (p.disconnectedAt === undefined || p.disconnectedAt === null) {
            p.disconnectedAt = this.bootAt;
            modified = true;
          }
          if (p.connectionQuality !== 'disconnected') {
            p.connectionQuality = 'disconnected';
            modified = true;
          }
        }
      }
      if (!this.roomLayer.lastActivityAt) {
        this.roomLayer.lastActivityAt = this.roomLayer.createdAt || this.bootAt;
        modified = true;
      }
      if (!this.roomLayer.expiresAt) {
        this.roomLayer.expiresAt =
          this.roomLayer.lastActivityAt + ROOM_INACTIVE_TIMEOUT_MS;
        modified = true;
      }
      if (modified) {
        await this.flushDirtyLayers({ room: true });
      }
      const expired = await this.expireIfNeeded(this.bootAt);
      if (!expired && this.roomLayer.status !== 'closed') {
        await this.scheduleLifecycleSweep();
      }
    }
    this.loaded = true;
  }

  private touchRoomActivity(nowMs: number): void {
    if (!this.roomLayer || this.roomLayer.status === 'closed') return;
    this.roomLayer.lastActivityAt = nowMs;
    this.roomLayer.expiresAt = nowMs + ROOM_INACTIVE_TIMEOUT_MS;
    this.dirtyRoom = true;
  }

  private pauseWorldForEmptyRoom(nowMs: number): void {
    const world = this.ensureWorldLayer();
    this.materializeWorldTime(nowMs);
    this.materializeWorldWeather(nowMs);
    world.emptyPausedAtMs = nowMs;
    world.pausedWeatherRemainingMs = Math.max(5_000, world.weather.endMs - nowMs);
    this.dirtyWorld = true;
  }

  private resumeWorldOnActiveEntry(nowMs: number): void {
    const world = this.ensureWorldLayer();
    if (world.emptyPausedAtMs !== null) {
      world.time.anchorServerMs = nowMs;
      if (
        typeof world.pausedWeatherRemainingMs === 'number' &&
        Number.isFinite(world.pausedWeatherRemainingMs)
      ) {
        const remain = Math.max(5_000, Math.min(MAX_WEATHER_DURATION_MS, world.pausedWeatherRemainingMs));
        world.weather.endMs = nowMs + remain;
        world.weather.startMs = world.weather.endMs - world.weather.durationMs;
      }
      world.emptyPausedAtMs = null;
      world.pausedWeatherRemainingMs = null;
      this.dirtyWorld = true;
    } else if (
      this.roomLayer &&
      Object.keys(this.roomLayer.players).length === 0
    ) {
      world.time.anchorServerMs = nowMs;
    }
  }

  private materializeWorldTime(nowMs: number): AuthoritativeWorldTimeState {
    const world = this.ensureWorldLayer();
    const wt = world.time;
    if (world.emptyPausedAtMs !== null) {
      wt.anchorServerMs = nowMs;
      world.day = wt.dayCount;
      return { ...wt };
    }
    if (!wt.paused && nowMs > wt.anchorServerMs) {
      const elapsedSec = (nowMs - wt.anchorServerMs) / 1000;
      const hoursPerSec = 24 / Math.max(60, wt.fullDayDurationSeconds);
      const totalHours = wt.worldHours + elapsedSec * hoursPerSec * wt.timeScale;
      const dayAdvance = Math.floor(totalHours / 24);
      if (dayAdvance > 0) {
        wt.dayCount += dayAdvance;
      }
      wt.worldHours = Math.round((((totalHours % 24) + 24) % 24) * 1000) / 1000;
      wt.anchorServerMs = nowMs;
    } else if (nowMs > wt.anchorServerMs) {
      wt.anchorServerMs = nowMs;
    }
    world.day = wt.dayCount;
    return { ...wt };
  }

  private getServerTotalWorldHours(nowMs: number): number {
    const wt = this.materializeWorldTime(nowMs);
    return wt.dayCount * 24 + wt.worldHours;
  }

  private materializeWorldWeather(nowMs: number): AuthoritativeWorldWeatherState {
    const world = this.ensureWorldLayer();
    const ww = world.weather;
    ww.durationMs = Math.max(5_000, Math.min(MAX_WEATHER_DURATION_MS, ww.durationMs));
    if (world.emptyPausedAtMs !== null) {
      const remain =
        typeof world.pausedWeatherRemainingMs === 'number' &&
        Number.isFinite(world.pausedWeatherRemainingMs)
          ? Math.max(5_000, Math.min(ww.durationMs, world.pausedWeatherRemainingMs))
          : Math.max(5_000, ww.endMs - world.emptyPausedAtMs);
      ww.endMs = nowMs + remain;
      ww.startMs = ww.endMs - ww.durationMs;
      return { ...ww };
    }
    ww.endMs = ww.startMs + ww.durationMs;
    if (nowMs >= ww.endMs && ww.currentState !== ww.targetState) {
      ww.currentState = ww.targetState;
    }
    world.weatherIntensity = ww.intensity;
    return { ...ww };
  }

  private async expireIfNeeded(nowMs: number): Promise<boolean> {
    if (!this.roomLayer) return false;
    if (this.roomLayer.status === 'closed') return true;
    const expiresAt =
      this.roomLayer.expiresAt ??
      (this.roomLayer.lastActivityAt ?? this.roomLayer.createdAt) +
        ROOM_INACTIVE_TIMEOUT_MS;
    if (nowMs < expiresAt) return false;

    const departedPlayers = Object.values(this.roomLayer.players);
    this.broadcast('ROOM_CLOSED', 'system', {
      reason: 'Room expired after 72 hours of inactivity.',
      closedBy: 'system',
    });

    this.roomLayer.players = {};
    this.roomLayer.playerTokens = {};
    this.roomLayer.hostPlayerId = '';
    this.roomLayer.status = 'closed';
    this.roomLayer.permissions.locked = true;
    this.roomLayer.lastActivityAt = nowMs;
    this.roomLayer.expiresAt = expiresAt;

    await this.syncDirectory();
    for (const p of departedPlayers) {
      await this.syncProfileEvent(p.publicProfileId, {
        currentRoomId: null,
        currentRoomName: null,
      });
    }
    for (const [sock, sess] of Array.from(this.sessions.entries())) {
      sess.cleanDisconnect = true;
      this.sessions.delete(sock);
      try {
        sock.close(4010, 'Room expired');
      } catch {
        // Ignore close errors
      }
    }
    this.worldLayer = null;
    this.sharedObjectsLayer = null;
    this.chatLayer = null;
    this.partyLayer = null;
    await this.persistExpiredTombstone();
    this.playerDataByKey.clear();
    this.runtimeByPlayerId.clear();
    this.clearSweepTimer();
    await this.ctx.storage.deleteAlarm?.();
    return true;
  }

  private resolveEntityMaxHp(kind: SyncedEntityKind, archetype: string): number {
    if (kind === 'enemy') {
      return SERVER_ENEMY_MAX_HP[archetype] ?? 65;
    }
    if (kind === 'animal') {
      return SERVER_ANIMAL_MAX_HP[archetype] ?? 50;
    }
    return SERVER_NPC_MAX_HP[archetype] ?? SERVER_NPC_MAX_HP.default;
  }

  private buildWorldSnapshot(playerId: string): RoomWorldSnapshotPayload {
    const world = this.ensureWorldLayer();
    const shared = this.ensureSharedObjectsLayer();
    const pData = this.ensurePlayerDataForPlayer(playerId);
    const now = Date.now();
    const worldTime = this.materializeWorldTime(now);
    const worldWeather = this.materializeWorldWeather(now);

    const depletedResources: RoomWorldSnapshotPayload['depletedResources'] = [];
    let prunedDepleted = false;
    for (const [id, rec] of Object.entries(world.resourceStates)) {
      if (now >= rec.regenAtMs) {
        delete world.resourceStates[id];
        prunedDepleted = true;
      } else {
        depletedResources.push({
          id,
          usesRemaining: rec.usesRemaining,
          regenAtMs: rec.regenAtMs,
        });
      }
    }
    if (prunedDepleted) {
      this.dirtyWorld = true;
    }

    const allEntities = this.getAllEntities(world);
    const deadEntities = allEntities
      .filter((e) => e.isDead)
      .map((e) => ({ id: e.id, kind: e.kind }));
    const px = pData.position.x;
    const pz = pData.position.z;
    const maxRelevantDistSq = 260 * 260;
    const relevantEntities = allEntities.filter((e) => {
      if (e.questTarget || e.isBoss) return true;
      const dx = e.x - px;
      const dz = e.z - pz;
      return dx * dx + dz * dz <= maxRelevantDistSq;
    });
    const prioritizedEntities = relevantEntities.sort((a, b) => {
      const scoreA = (a.questTarget ? 4 : 0) + (a.isBoss ? 2 : 0) + (a.isDead ? -1 : 0);
      const scoreB = (b.questTarget ? 4 : 0) + (b.isBoss ? 2 : 0) + (b.isDead ? -1 : 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      const distA = (a.x - px) * (a.x - px) + (a.z - pz) * (a.z - pz);
      const distB = (b.x - px) * (b.x - px) + (b.z - pz) * (b.z - pz);
      return distA - distB;
    });
    const entityStates: WorldEntitySnapshot[] = prioritizedEntities.slice(0, 120).map((e) => ({
      id: e.id,
      kind: e.kind,
      archetype: e.archetype,
      hp: e.hp,
      maxHp: e.maxHp,
      isDead: e.isDead,
      alive: !e.isDead,
      loaded: e.loaded ?? true,
      x: e.x,
      y: e.y,
      z: e.z,
      yaw: e.yaw,
      state: e.state,
      ...(e.worldId ? { worldId: e.worldId } : {}),
      ...(e.chunkId ? { chunkId: e.chunkId } : {}),
      ...(e.questTarget ? { questTarget: e.questTarget } : {}),
      ...(e.targetPlayerId ? { targetPlayerId: e.targetPlayerId } : {}),
      ...(e.isBoss ? { isBoss: true } : {}),
      ...(e.bossPhase ? { bossPhase: e.bossPhase } : {}),
      ...(e.attackState ? { attackState: e.attackState } : {}),
      ...(e.dialogueState ? { dialogueState: e.dialogueState } : {}),
      ...(e.dialoguePlayerId ? { dialoguePlayerId: e.dialoguePlayerId } : {}),
      ...(e.questState ? { questState: e.questState } : {}),
      ...(e.schedulePeriod ? { schedulePeriod: e.schedulePeriod } : {}),
    }));
    const coopQuests = Object.values(world.coopQuests ?? {})
      .filter((cq) => this.isAuthorizedForCoopQuest(playerId, cq))
      .map((cq) => structuredClone(cq));
    const bossEncounters = Object.values(world.bossEncounters ?? {}).map((b) =>
      structuredClone(b),
    );

    return {
      openedChests: Object.keys(shared.chests),
      collectedPickups: Object.keys(shared.sharedResources),
      depletedResources,
      doors: Object.entries(shared.doors).map(([id, isOpen]) => ({ id, isOpen })),
      placedBeds: Object.values(shared.placedBeds),
      placedStations: Object.values(shared.placedStations ?? {}),
      playerBuildings: Object.values(shared.playerBuildings ?? {}),
      villagesDev: Object.values(shared.villagesDev ?? {}),
      droppedItems: Object.values(shared.droppedItems),
      quests: Object.values(pData.quests).map((q) => ({
        questId: q.questId,
        status: q.status,
        stepIndex: q.stepIndex,
        updatedBy: q.updatedBy,
        scope: QUEST_SERVER_REWARDS[q.questId]?.scope ?? 'personal',
      })),
      coopQuests,
      bossEncounters,
      discoveredLandmarks: world.discoveredLandmarks.slice(),
      deadEntities,
      entityStates,
      containers: Object.values(shared.containers),
      buildingStates: Object.values(world.buildingStates),
      questObjects: Object.values(shared.questObjects),
      worldHours: worldTime.worldHours,
      dayCount: worldTime.dayCount,
      weather: worldWeather.currentState,
      worldTime,
      worldWeather,
      worldSettings: { ...world.worldSettings },
      worldSettingsPermission:
        this.roomLayer!.permissions.worldSettingsPermission ?? 'HOST_ONLY',
      serverTimestamp: now,
      playerPosition: { ...pData.position },
      playerVitals: {
        playerId,
        networkEntityId:
          this.roomLayer?.players[playerId]?.networkEntityId ??
          generateNetworkEntityId(playerId),
        health: pData.vitals.health,
        maxHealth: pData.vitals.maxHealth,
        isDead: pData.vitals.isDead,
        reviveAtMs: pData.vitals.reviveAtMs,
      },
      playerStatistics: { ...pData.statistics },
      ammoCount: pData.inventory.ammoCount,
      coins: pData.coins,
      xp: pData.xp,
      level: pData.level,
      xpToNextLevel: pData.level * 100,
      inventoryItemIds: pData.inventory.inventoryItemIds.slice(),
      itemCounts: { ...(pData.inventory.itemCounts ?? {}) },
      equippedWeaponId: pData.weapons.equippedWeaponId,
      partyState: this.buildPartyStateForPlayer(playerId),
      ...(world.modSpawns && world.modSpawns.length > 0
        ? {
            modSpawns: world.modSpawns.map((entry) => {
              const collectors = shared.perPlayerPickups?.[entry.instanceId];
              return collectors && collectors.includes(pData.persistentKey)
                ? { ...entry, collectedByPlayers: [playerId] }
                : { ...entry };
            }),
          }
        : {}),
      ...((this.roomLayer?.modMetadata ?? world.modMetadata)
        ? { modMetadata: this.roomLayer?.modMetadata ?? world.modMetadata }
        : {}),
    };
  }

  private buildStartGamePayload(): Record<string, unknown> {
    const rl = this.roomLayer!;
    const wl = this.ensureWorldLayer();
    const now = Date.now();
    const resolvedMods = rl.modMetadata ?? wl.modMetadata;
    return {
      roomId: rl.roomId,
      roomCode: rl.roomCode,
      roomName: rl.roomName,
      worldName: wl.worldName,
      seed: wl.worldSeed,
      worldType: rl.gameMode.worldType,
      difficulty: rl.gameMode.difficulty,
      requireAllReady: rl.permissions.requireAllReady,
      worldSettingsPermission: rl.permissions.worldSettingsPermission ?? 'HOST_ONLY',
      worldSettings: wl.worldSettings,
      worldTime: this.materializeWorldTime(now),
      worldWeather: this.materializeWorldWeather(now),
      locked: rl.permissions.locked,
      startedAt: wl.startedAt,
      ...(resolvedMods ? { modMetadata: resolvedMods } : {}),
    };
  }

  private sendToPlayer<T>(
    playerId: string,
    type: ServerMessageType,
    payload?: T,
  ): void {
    for (const [sock, sess] of this.sessions) {
      if (sess.playerId === playerId) {
        this.sendToSocket(sock, type, playerId, payload);
      }
    }
  }

  private grantProgression(
    playerId: string,
    deltaXp: number,
    deltaCoins: number,
    reason: string,
  ): AuthoritativeProgressionState {
    const pData = this.ensurePlayerDataForPlayer(playerId);
    if (deltaCoins !== 0) {
      pData.coins = Math.max(
        0,
        Math.min(MAX_PLAYER_COINS, Math.round(pData.coins + deltaCoins)),
      );
    }
    if (deltaXp > 0 && pData.level < MAX_PLAYER_LEVEL) {
      pData.xp += Math.round(deltaXp);
      while (pData.level < MAX_PLAYER_LEVEL && pData.xp >= pData.level * 100) {
        pData.xp -= pData.level * 100;
        pData.level += 1;
      }
      if (pData.level >= MAX_PLAYER_LEVEL) {
        pData.level = MAX_PLAYER_LEVEL;
        pData.xp = 0;
      }
    }
    pData.updatedAt = Date.now();
    this.dirtyPlayerKeys.add(pData.persistentKey);

    const payload: AuthoritativeProgressionState = {
      playerId,
      coins: pData.coins,
      xp: pData.xp,
      level: pData.level,
      xpToNextLevel: pData.level * 100,
      reason,
    };
    this.sendToPlayer<AuthoritativeProgressionState>(
      playerId,
      'PROGRESSION_UPDATED',
      payload,
    );
    return payload;
  }

  private buildSnapshot(): AuthoritativeRoomSnapshot | null {
    if (!this.roomLayer) return null;
    const rl = this.roomLayer;
    const now = Date.now();
    const isClosed = rl.status === 'closed';
    const worldTime = isClosed ? undefined : this.materializeWorldTime(now);
    const worldWeather = isClosed ? undefined : this.materializeWorldWeather(now);
    const wl = isClosed ? null : this.ensureWorldLayer();

    const playerList = Object.values(rl.players)
      .map((p) => {
        const pk = rl.playerKeyByPlayerId[p.playerId];
        const pd = pk ? this.playerDataByKey.get(pk) : undefined;
        const partyId = this.partyLayer?.playerPartyById[p.playerId] ?? null;
        return {
          ...p,
          networkEntityId: p.networkEntityId ?? generateNetworkEntityId(p.playerId),
          level: pd?.level ?? p.level ?? 1,
          partyId,
          health: pd?.vitals.health ?? p.health ?? 100,
          maxHealth: pd?.vitals.maxHealth ?? p.maxHealth ?? 100,
          isDead: pd?.vitals.isDead ?? p.isDead ?? false,
        };
      })
      .sort((a, b) => a.joinedAt - b.joinedAt);
    const hostPlayer = rl.players[rl.hostPlayerId] ?? playerList[0] ?? null;

    const resolvedMods = rl.modMetadata ?? wl?.modMetadata;
    const modCompatibilityStatus: ProtocolRoomModCompatibilityStatus | undefined =
      resolvedMods || this.incompatibleJoinAttempts.length > 0
        ? {
            requiredMods: (resolvedMods?.mods ?? []).filter(
              (m) => (m.multiplayerCompatibility ?? 'required') !== 'client_only',
            ),
            compatiblePlayers: playerList.map((p) => ({
              playerId: p.playerId,
              displayName: p.displayName,
              isHost: p.isHost,
            })),
            incompatiblePlayers: this.incompatibleJoinAttempts.slice(-20),
          }
        : undefined;
    const gameState: RoomGameState = {
      seed: wl?.worldSeed ?? 0,
      worldName: wl?.worldName ?? rl.roomName,
      worldType: rl.gameMode.worldType,
      difficulty: rl.gameMode.difficulty,
      privacy: rl.permissions.privacy,
      isPrivate: rl.permissions.isPrivate,
      allowFriends: rl.permissions.allowFriends,
      requireAllReady: rl.permissions.requireAllReady,
      worldSettingsPermission: rl.permissions.worldSettingsPermission,
      worldSettings: wl?.worldSettings,
      locked: rl.permissions.locked,
      hasPassword: rl.permissions.hasPassword,
      startedAt: wl?.startedAt ?? null,
      tick: wl?.tick ?? 0,
      ...(resolvedMods ? { modMetadata: resolvedMods } : {}),
      ...(modCompatibilityStatus ? { modCompatibilityStatus } : {}),
    };

    return {
      roomId: rl.roomId,
      roomCode: rl.roomCode,
      roomName: rl.roomName,
      hostId: rl.hostPlayerId,
      hostName:
        hostPlayer?.displayName ?? (playerList.length === 0 ? 'Open Room' : 'Host'),
      players: playerList,
      maxPlayers: rl.maxPlayers,
      status: rl.status,
      hasEnteredWorld: rl.hasEnteredWorld,
      gameState,
      createdAt: rl.createdAt,
      lastActivityAt: rl.lastActivityAt,
      lastPlayerJoinedAt: rl.lastPlayerJoinedAt ?? null,
      lastPlayerLeftAt: rl.lastPlayerLeftAt ?? null,
      expiresAt: rl.expiresAt,
      ...(worldTime ? { worldTime } : {}),
      ...(worldWeather ? { worldWeather } : {}),
      serverTimestamp: now,
    };
  }

  private async syncDirectory(): Promise<void> {
    try {
      if (!this.env?.ROOM_DIRECTORY) return;
      const dirId = this.env.ROOM_DIRECTORY.idFromName('global');
      const stub = this.env.ROOM_DIRECTORY.get(dirId);

      if (!this.roomLayer || this.roomLayer.status === 'closed') {
        if (this.roomLayer?.roomId) {
          await stub.fetch('https://directory.internal/remove', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ roomId: this.roomLayer.roomId }),
          });
        }
        return;
      }

      const snap = this.buildSnapshot();
      if (!snap) return;

      await stub.fetch('https://directory.internal/upsert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roomId: snap.roomId,
          roomCode: snap.roomCode,
          roomName: snap.roomName,
          hostName: snap.hostName,
          worldName: snap.gameState.worldName,
          worldType: snap.gameState.worldType,
          difficulty: snap.gameState.difficulty,
          maxPlayers: snap.maxPlayers,
          playerCount: snap.players.length,
          privacy: snap.gameState.privacy,
          isPrivate: snap.gameState.isPrivate,
          allowFriends: snap.gameState.allowFriends,
          requireAllReady: snap.gameState.requireAllReady,
          locked: snap.gameState.locked,
          hasEnteredWorld: snap.hasEnteredWorld,
          status: snap.status,
          hasPassword: snap.gameState.hasPassword,
          createdAt: snap.createdAt,
          updatedAt: Date.now(),
          lastActivityAt: snap.lastActivityAt,
          expiresAt: snap.expiresAt,
          ...(snap.gameState.modMetadata ? { modMetadata: snap.gameState.modMetadata } : {}),
        }),
      });
    } catch {
      // Directory sync is best-effort; authoritative state lives in this DO
    }
  }

  private async syncProfileEvent(
    publicProfileId: string | undefined,
    update: {
      currentRoomId?: string | null;
      currentRoomName?: string | null;
      statsDelta?: ProfileStatsDelta;
    },
  ): Promise<void> {
    if (!publicProfileId || !this.env?.PLAYER_PROFILES) return;
    try {
      const stub = this.env.PLAYER_PROFILES.get(
        this.env.PLAYER_PROFILES.idFromName('global'),
      );
      await stub.fetch('https://profiles.internal/internal/room-event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          publicProfileId,
          ...update,
        }),
      });
    } catch {
      // Profile telemetry sync is best-effort
    }
  }

  private sendToSocket<T>(
    ws: WebSocket,
    type: ServerMessageType,
    playerId: string,
    payload?: T,
    seq?: number,
  ): void {
    if (!this.roomLayer) return;
    let safePayload = payload;
    if (
      type === 'ERROR' &&
      payload &&
      typeof payload === 'object' &&
      'message' in (payload as Record<string, unknown>)
    ) {
      const errObj = payload as Record<string, unknown>;
      safePayload = {
        ...errObj,
        message: sanitizeClientErrorMessage(errObj.message),
      } as T;
    }
    const envelope: NetworkEnvelope<T> = {
      v: MULTIPLAYER_PROTOCOL_VERSION,
      type,
      roomId: this.roomLayer.roomId,
      playerId,
      timestamp: Date.now(),
      ...(seq !== undefined ? { seq } : {}),
      ...(safePayload !== undefined ? { payload: safePayload } : {}),
    };
    try {
      ws.send(JSON.stringify(envelope));
    } catch {
      // Socket closed before send
    }
  }

  private broadcast<T>(
    type: ServerMessageType,
    senderPlayerId: string,
    payload?: T,
    excludeWs?: WebSocket,
  ): void {
    if (!this.roomLayer) return;
    const envelope: NetworkEnvelope<T> = {
      v: MULTIPLAYER_PROTOCOL_VERSION,
      type,
      roomId: this.roomLayer.roomId,
      playerId: senderPlayerId,
      timestamp: Date.now(),
      ...(payload !== undefined ? { payload } : {}),
    };
    const serialized = JSON.stringify(envelope);
    for (const [sock] of this.sessions) {
      if (excludeWs && sock === excludeWs) continue;
      try {
        sock.send(serialized);
      } catch {
        // Ignore broken sockets; close handler cleans up
      }
    }
  }

  private broadcastRoomState(): void {
    const snapshot = this.buildSnapshot();
    if (!snapshot || !this.roomLayer) return;
    this.broadcast('ROOM_STATE', this.roomLayer.hostPlayerId, snapshot);
  }

  private generateSecurePartyId(): string {
    this.partySeq += 1;
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `pty_${hex}_${this.partySeq}`;
  }

  private generateSecurePartyInviteId(): string {
    this.partySeq += 1;
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `pinv_${hex}_${this.partySeq}`;
  }

  private arePlayersInSameParty(playerAId: string, playerBId: string): boolean {
    if (!this.partyLayer || !playerAId || !playerBId) return false;
    const partyA = this.partyLayer.playerPartyById[playerAId];
    if (!partyA) return false;
    return partyA === this.partyLayer.playerPartyById[playerBId];
  }

  private canPlayerAccessStructure(
    st: PlayerBuiltStructureSnapshot,
    actorId: string,
    isHost: boolean,
  ): boolean {
    if (st.ownerId === actorId || isHost) return true;
    if (st.permissionScope === 'everyone') return true;
    if (st.permissionScope === 'party') {
      return this.arePlayersInSameParty(st.ownerId, actorId);
    }
    if (st.permissionScope === 'friends') {
      return (
        this.arePlayersInSameParty(st.ownerId, actorId) ||
        this.roomLayer?.permissions.allowFriends !== false
      );
    }
    return false;
  }

  private makePartyMemberRecord(
    playerId: string,
    markerIndex: number,
    joinedAt: number,
    isReady = false,
  ): PartyMemberRecord {
    const rp = this.roomLayer?.players[playerId];
    const pk = this.roomLayer?.playerKeyByPlayerId[playerId];
    const pd = pk ? this.playerDataByKey.get(pk) : undefined;
    const isOnline = Boolean(
      rp && !rp.disconnectedAt && rp.connectionQuality !== 'disconnected',
    );
    return {
      playerId,
      ...(rp?.publicProfileId ?? pd?.publicProfileId
        ? { publicProfileId: rp?.publicProfileId ?? pd?.publicProfileId }
        : {}),
      displayName: rp?.displayName ?? pd?.profile.displayName ?? 'Adventurer',
      ...(rp?.playerTag ?? pd?.profile.playerTag
        ? { playerTag: rp?.playerTag ?? pd?.profile.playerTag }
        : {}),
      ...(rp?.avatar ?? pd?.profile.avatar
        ? { avatar: rp?.avatar ?? pd?.profile.avatar }
        : {}),
      avatarColor: rp?.avatarColor ?? pd?.profile.avatarColor ?? pickAvatarColor(playerId),
      level: pd?.level ?? rp?.level ?? 1,
      health: pd?.vitals.health ?? rp?.health ?? 100,
      maxHealth: pd?.vitals.maxHealth ?? rp?.maxHealth ?? 100,
      isDead: Boolean(pd?.vitals.isDead ?? rp?.isDead),
      online: isOnline,
      isReady,
      joinedAt,
      markerIndex,
      markerColor: PARTY_PALETTE_COLORS[markerIndex % PARTY_PALETTE_COLORS.length],
    };
  }

  private syncPartyMemberLiveStats(party: PartyRecord): void {
    const usedIndices = new Set<number>();
    for (let i = 0; i < party.members.length; i++) {
      const m = party.members[i];
      const rp = this.roomLayer?.players[m.playerId];
      const pk = this.roomLayer?.playerKeyByPlayerId[m.playerId];
      const pd = pk ? this.playerDataByKey.get(pk) : undefined;
      if (rp) {
        m.displayName = rp.displayName;
        if (rp.publicProfileId) m.publicProfileId = rp.publicProfileId;
        if (rp.playerTag) m.playerTag = rp.playerTag;
        if (rp.avatar) m.avatar = rp.avatar;
        if (rp.avatarColor) m.avatarColor = rp.avatarColor;
        m.online = !rp.disconnectedAt && rp.connectionQuality !== 'disconnected';
      } else {
        m.online = false;
      }
      if (pd) {
        m.level = pd.level;
        m.health = pd.vitals.health;
        m.maxHealth = pd.vitals.maxHealth;
        m.isDead = pd.vitals.isDead;
      } else if (rp) {
        m.level = rp.level ?? m.level ?? 1;
        m.health = rp.health ?? m.health ?? 100;
        m.maxHealth = rp.maxHealth ?? m.maxHealth ?? 100;
        m.isDead = Boolean(rp.isDead);
      }
      let idx = typeof m.markerIndex === 'number' ? m.markerIndex : i;
      while (usedIndices.has(idx)) idx += 1;
      usedIndices.add(idx);
      m.markerIndex = idx;
      m.markerColor = PARTY_PALETTE_COLORS[idx % PARTY_PALETTE_COLORS.length];
    }
    if (this.roomLayer) {
      party.maxMembers = this.roomLayer.maxPlayers;
    }
  }

  private buildPartyStateForPlayer(playerId: string): PartyStateSnapshot {
    const pl = this.ensurePartyLayer();
    const partyId = pl.playerPartyById[playerId];
    let party: PartyRecord | null = null;
    if (partyId && pl.parties[partyId]) {
      this.syncPartyMemberLiveStats(pl.parties[partyId]);
      party = structuredClone(pl.parties[partyId]);
    }
    const pendingInvites = Object.values(pl.invites)
      .filter(
        (inv) =>
          inv.status === 'pending' &&
          inv.toPlayerId === playerId &&
          Boolean(pl.parties[inv.partyId]),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((inv) => structuredClone(inv));
    const outgoingInvites = Object.values(pl.invites)
      .filter(
        (inv) =>
          inv.status === 'pending' &&
          inv.fromPlayerId === playerId &&
          Boolean(pl.parties[inv.partyId]),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((inv) => structuredClone(inv));

    return {
      party,
      pendingInvites,
      outgoingInvites,
    };
  }

  private sendPartyStateToPlayer(playerId: string): void {
    const snapshot = this.buildPartyStateForPlayer(playerId);
    this.sendToPlayer<PartyStateSnapshot>(playerId, 'PARTY_STATE', snapshot);
  }

  private sendPartyStatesToRoom(targetPlayerIds?: string[]): void {
    if (!this.roomLayer) return;
    const ids = targetPlayerIds ?? Object.keys(this.roomLayer.players);
    for (const pid of ids) {
      if (this.hasActiveSocketForPlayer(pid)) {
        this.sendPartyStateToPlayer(pid);
      }
    }
  }

  private removePlayerFromParty(
    playerId: string,
    _reason: 'left' | 'kicked',
  ): { affectedPlayerIds: string[]; disbanded: boolean } {
    const pl = this.ensurePartyLayer();
    const partyId = pl.playerPartyById[playerId];
    if (!partyId) {
      return { affectedPlayerIds: [playerId], disbanded: false };
    }
    delete pl.playerPartyById[playerId];
    const party = pl.parties[partyId];
    if (!party) {
      this.dirtyParty = true;
      return { affectedPlayerIds: [playerId], disbanded: false };
    }

    const prevMemberIds = party.members.map((m) => m.playerId);
    party.members = party.members.filter((m) => m.playerId !== playerId);

    for (const [invId, inv] of Object.entries(pl.invites)) {
      if (inv.toPlayerId === playerId || inv.fromPlayerId === playerId) {
        if (inv.partyId === partyId && inv.status === 'pending') {
          delete pl.invites[invId];
        }
      }
    }

    if (party.members.length === 0) {
      delete pl.parties[partyId];
      for (const [invId, inv] of Object.entries(pl.invites)) {
        if (inv.partyId === partyId) delete pl.invites[invId];
      }
      this.dirtyParty = true;
      return { affectedPlayerIds: prevMemberIds, disbanded: true };
    }

    if (party.leaderPlayerId === playerId) {
      this.syncPartyMemberLiveStats(party);
      const nextLeader =
        party.members.find((m) => m.online) ??
        party.members.slice().sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (nextLeader) {
        party.leaderPlayerId = nextLeader.playerId;
        nextLeader.isReady = true;
      }
    }
    this.syncPartyMemberLiveStats(party);
    this.dirtyParty = true;
    return { affectedPlayerIds: prevMemberIds, disbanded: false };
  }

  private migratePlayerIdInParties(oldPlayerId: string, newPlayerId: string): void {
    if (!oldPlayerId || !newPlayerId || oldPlayerId === newPlayerId) return;
    const pl = this.ensurePartyLayer();
    const partyId = pl.playerPartyById[oldPlayerId];
    if (partyId) {
      delete pl.playerPartyById[oldPlayerId];
      pl.playerPartyById[newPlayerId] = partyId;
      const party = pl.parties[partyId];
      if (party) {
        if (party.leaderPlayerId === oldPlayerId) {
          party.leaderPlayerId = newPlayerId;
        }
        for (const m of party.members) {
          if (m.playerId === oldPlayerId) {
            m.playerId = newPlayerId;
          }
        }
        if (party.activeObjective?.contributions[oldPlayerId]) {
          const c = party.activeObjective.contributions[oldPlayerId];
          delete party.activeObjective.contributions[oldPlayerId];
          party.activeObjective.contributions[newPlayerId] = { ...c, playerId: newPlayerId };
        }
      }
      this.dirtyParty = true;
    }
    for (const inv of Object.values(pl.invites)) {
      if (inv.fromPlayerId === oldPlayerId) {
        inv.fromPlayerId = newPlayerId;
        this.dirtyParty = true;
      }
      if (inv.toPlayerId === oldPlayerId) {
        inv.toPlayerId = newPlayerId;
        this.dirtyParty = true;
      }
    }
  }

  private buildDefaultCoopObjective(
    type: CoopObjectiveType,
    party: PartyRecord,
    starterId: string,
    opts: {
      title?: string;
      targetId?: string;
      targetX?: number;
      targetZ?: number;
      targetCount?: number;
    },
    now: number,
  ): CoopObjectiveState {
    const starterData = this.playerDataByKey.get(
      this.resolvePersistentKeyForPlayerId(starterId),
    );
    const px = starterData?.position.x ?? 0;
    const pz = starterData?.position.z ?? 4;

    const presets: Record<
      CoopObjectiveType,
      {
        title: string;
        description: string;
        targetCount: number;
        targetX?: number;
        targetZ?: number;
        targetRadius?: number;
        expiresMs?: number;
      }
    > = {
      kill_boss: {
        title: 'Defeat the Stone Sentinel',
        description: 'Coordinate with your party to slay the guardian boss.',
        targetCount: 1,
        targetX: px + 48,
        targetZ: pz + 32,
        targetRadius: 18,
      },
      protect_village: {
        title: 'Protect Oakhollow Village',
        description: 'Defend the village from attacking raiders and beasts.',
        targetCount: 4,
        targetX: 0,
        targetZ: 4,
        targetRadius: 34,
        expiresMs: 300_000,
      },
      collect_resources: {
        title: 'Gather Expedition Supplies',
        description: 'Harvest timber, stone, and herbs together for the camp.',
        targetCount: 6,
      },
      escort_npc: {
        title: 'Escort Village Envoy',
        description: 'Guide and protect the envoy safely to the outpost.',
        targetCount: 1,
        targetX: px + 60,
        targetZ: pz - 42,
        targetRadius: 16,
      },
      explore_location: {
        title: 'Scout Frontier Landmark',
        description: 'Reach and survey the marked frontier coordinates together.',
        targetCount: 1,
        targetX: px + 55,
        targetZ: pz + 55,
        targetRadius: 16,
      },
      open_dungeon: {
        title: 'Unseal Sunken Vault',
        description: 'Unlock vault gates, chests, or relics as a party.',
        targetCount: 2,
      },
    };

    const preset = presets[type];
    const objectiveId = `obj_${now}_${++this.partySeq}`;
    return {
      objectiveId,
      partyId: party.partyId,
      type,
      title: opts.title ?? preset.title,
      description: preset.description,
      status: 'active',
      progress: 0,
      targetCount: opts.targetCount ?? preset.targetCount,
      ...(opts.targetX !== undefined
        ? { targetX: opts.targetX }
        : preset.targetX !== undefined
          ? { targetX: preset.targetX }
          : {}),
      ...(opts.targetZ !== undefined
        ? { targetZ: opts.targetZ }
        : preset.targetZ !== undefined
          ? { targetZ: preset.targetZ }
          : {}),
      ...(preset.targetRadius !== undefined ? { targetRadius: preset.targetRadius } : {}),
      ...(opts.targetId ? { targetId: opts.targetId } : {}),
      startedByPlayerId: starterId,
      startedAt: now,
      expiresAt: preset.expiresMs ? now + preset.expiresMs : null,
      completedAt: null,
      contributions: {},
      rewardsByPlayer: {},
    };
  }

  private async recordCoopObjectiveProgress(
    partyId: string,
    actorPlayerId: string,
    amount: number,
    now: number,
  ): Promise<void> {
    const pl = this.ensurePartyLayer();
    const party = pl.parties[partyId];
    if (!party || !party.activeObjective || party.activeObjective.status !== 'active') {
      return;
    }
    const obj = party.activeObjective;
    const cleanAmount = Math.max(1, Math.min(25, Math.round(amount)));
    const actorName =
      this.roomLayer?.players[actorPlayerId]?.displayName ?? 'Adventurer';
    const existingContrib = obj.contributions[actorPlayerId];
    obj.contributions[actorPlayerId] = {
      playerId: actorPlayerId,
      displayName: actorName,
      amount: (existingContrib?.amount ?? 0) + cleanAmount,
    };
    obj.progress = Math.min(obj.targetCount, obj.progress + cleanAmount);
    this.dirtyParty = true;

    if (obj.progress >= obj.targetCount) {
      obj.status = 'completed';
      obj.completedAt = now;

      const isHighTier = obj.type === 'kill_boss' || obj.type === 'open_dungeon';
      const baseXp = isHighTier ? 85 : 55;
      const baseCoins = isHighTier ? 45 : 25;
      const rewardsByPlayer: Record<string, CoopObjectiveRewardEntry> = {};
      const updatedPlayerKeys: string[] = [];

      for (const member of party.members) {
        const contribAmount = obj.contributions[member.playerId]?.amount ?? 0;
        const bonusXp = Math.min(40, contribAmount * 8);
        const bonusCoins = Math.min(25, contribAmount * 4);
        const totalXp = baseXp + bonusXp;
        const totalCoins = baseCoins + bonusCoins;
        const prog = this.grantProgression(
          member.playerId,
          totalXp,
          totalCoins,
          `coop_objective:${obj.type}`,
        );
        const pk = this.resolvePersistentKeyForPlayerId(member.playerId);
        updatedPlayerKeys.push(pk);
        const rewardEntry: CoopObjectiveRewardEntry = {
          xp: totalXp,
          coins: totalCoins,
          bonusReason:
            contribAmount > 0
              ? `Co-op completion + ${contribAmount} contribution`
              : 'Co-op party completion',
        };
        rewardsByPlayer[member.playerId] = rewardEntry;
        if (obj.contributions[member.playerId]) {
          obj.contributions[member.playerId].rewardXp = totalXp;
          obj.contributions[member.playerId].rewardCoins = totalCoins;
        }
        const memberRecord = this.roomLayer?.players[member.playerId];
        if (memberRecord) {
          memberRecord.level = prog.level;
        }
      }
      obj.rewardsByPlayer = rewardsByPlayer;
      this.syncPartyMemberLiveStats(party);

      await this.flushDirtyLayers({
        party: true,
        room: true,
        playerKeys: updatedPlayerKeys,
      });

      const completedSnap = structuredClone(obj);
      for (const member of party.members) {
        this.sendToPlayer<CoopObjectiveState>(
          member.playerId,
          'PARTY_OBJECTIVE_COMPLETED',
          completedSnap,
        );
        this.sendPartyStateToPlayer(member.playerId);
      }
      this.broadcastRoomState();
      return;
    }

    this.syncPartyMemberLiveStats(party);
    await this.flushDirtyLayers({ party: true });
    const updatedSnap = structuredClone(obj);
    for (const member of party.members) {
      this.sendToPlayer<CoopObjectiveState>(
        member.playerId,
        'PARTY_OBJECTIVE_UPDATED',
        updatedSnap,
      );
      this.sendPartyStateToPlayer(member.playerId);
    }
  }

  private deterministicLootRoll(seedText: string): number {
    let h = 2166136261;
    for (let i = 0; i < seedText.length; i++) {
      h ^= seedText.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10_000) / 10_000;
  }

  private isBossArchetypeOrFlag(
    kind: SyncedEntityKind,
    archetype: string,
    isBossFlag?: boolean,
  ): boolean {
    return kind === 'enemy' && (Boolean(isBossFlag) || archetype === 'ancient_guardian');
  }

  private isAuthorizedForCoopQuest(
    playerId: string,
    cq: CoopQuestStateRecord,
  ): boolean {
    if (!this.roomLayer?.players[playerId]) return false;
    if (cq.partyId) {
      return this.partyLayer?.playerPartyById[playerId] === cq.partyId;
    }
    return true;
  }

  private getAuthorizedPlayerIdsForCoopQuest(cq: CoopQuestStateRecord): string[] {
    if (!this.roomLayer) return [];
    if (cq.partyId && this.partyLayer?.parties[cq.partyId]) {
      return this.partyLayer.parties[cq.partyId].members
        .map((m) => m.playerId)
        .filter((pid) => Boolean(this.roomLayer?.players[pid]));
    }
    return Object.keys(this.roomLayer.players);
  }

  private async grantIdempotentReward(
    playerId: string,
    grantId: string,
    opts: {
      mode: LootDistributionMode;
      sourceKind: 'enemy' | 'boss' | 'quest' | 'coop_quest';
      sourceId: string;
      archetype?: string;
      xp: number;
      coins: number;
      items?: LootGrantItem[];
      statQuestDelta?: number;
      reason: string;
      now: number;
    },
  ): Promise<boolean> {
    if (!this.roomLayer?.players[playerId]) return false;
    const pData = this.ensurePlayerDataForPlayer(playerId);
    if (!Array.isArray(pData.claimedRewardIds)) {
      pData.claimedRewardIds = [];
    }
    if (pData.claimedRewardIds.includes(grantId)) {
      return false;
    }
    pData.claimedRewardIds.push(grantId);
    if (pData.claimedRewardIds.length > 256) {
      pData.claimedRewardIds = pData.claimedRewardIds.slice(-256);
    }

    const grantedItems: LootGrantItem[] = [];
    for (const item of opts.items ?? []) {
      if (!item.itemId || item.count <= 0) continue;
      this.adjustPlayerItemCount(pData, item.itemId, item.count);
      grantedItems.push({ itemId: item.itemId, count: Math.round(item.count) });
    }
    if (opts.statQuestDelta && opts.statQuestDelta > 0) {
      pData.statistics.questsCompleted += opts.statQuestDelta;
    }

    const xpAmt = Math.max(0, Math.round(opts.xp));
    const coinsAmt = Math.max(0, Math.round(opts.coins));
    const prog = this.grantProgression(playerId, xpAmt, coinsAmt, opts.reason);
    const rp = this.roomLayer.players[playerId];
    if (rp) {
      rp.level = prog.level;
    }
    this.dirtyPlayerKeys.add(pData.persistentKey);

    if (xpAmt > 0 || (opts.statQuestDelta ?? 0) > 0) {
      await this.syncProfileEvent(rp?.publicProfileId, {
        statsDelta: {
          ...(xpAmt > 0 ? { xpGained: xpAmt } : {}),
          ...(opts.statQuestDelta && opts.statQuestDelta > 0
            ? { questsCompleted: opts.statQuestDelta }
            : {}),
        },
      });
    }

    const lootPayload: LootGrantPayload = {
      grantId,
      playerId,
      mode: opts.mode,
      sourceKind: opts.sourceKind,
      sourceId: opts.sourceId,
      ...(opts.archetype ? { archetype: opts.archetype } : {}),
      xp: xpAmt,
      coins: coinsAmt,
      items: grantedItems,
      reason: opts.reason,
      timestamp: opts.now,
    };
    this.sendToPlayer<LootGrantPayload>(playerId, 'LOOT_GRANTED', lootPayload);
    return true;
  }

  private async grantCoopQuestPersonalRewardForMember(
    cq: CoopQuestStateRecord,
    memberId: string,
    now: number,
  ): Promise<boolean> {
    if (!this.isAuthorizedForCoopQuest(memberId, cq)) return false;
    if (cq.completedByPlayerIds.includes(memberId)) return false;

    const spec = QUEST_SERVER_REWARDS[cq.questId];
    const contribKills = cq.contributors[memberId] ?? 0;
    const baseXp = spec?.xp ?? 120;
    const baseCoins = spec?.coins ?? 70;
    const personalItems = spec?.items ?? [];

    const grantId = `coop_quest:${cq.questId}:c${cq.cycle}:${memberId}`;
    const pData = this.ensurePlayerDataForPlayer(memberId);
    const alreadyQuestRecorded = pData.quests[cq.questId]?.status === 'completed';

    const granted = await this.grantIdempotentReward(memberId, grantId, {
      mode: 'personal',
      sourceKind: 'coop_quest',
      sourceId: cq.questId,
      xp: baseXp + (contribKills > 0 ? Math.min(30, contribKills * 5) : 0),
      coins: baseCoins + (contribKills > 0 ? Math.min(20, contribKills * 3) : 0),
      items: personalItems,
      statQuestDelta: alreadyQuestRecorded ? 0 : 1,
      reason: `coop_quest:${cq.questId}`,
      now,
    });

    pData.quests[cq.questId] = {
      questId: cq.questId,
      status: 'completed',
      stepIndex: 0,
      updatedBy: memberId,
      updatedAtMs: now,
    };
    pData.updatedAt = now;
    this.dirtyPlayerKeys.add(pData.persistentKey);

    if (!cq.completedByPlayerIds.includes(memberId)) {
      cq.completedByPlayerIds.push(memberId);
    }
    this.dirtyWorld = true;
    return granted;
  }

  private async recordCoopQuestProgressForKill(
    killerId: string,
    targetId: string,
    archetype: string,
    damageByPlayer: Record<string, number>,
    now: number,
  ): Promise<void> {
    const world = this.ensureWorldLayer();
    if (!world.coopQuests) return;

    const updatedPlayerKeys: string[] = [];
    for (const cq of Object.values(world.coopQuests)) {
      if (cq.status !== 'active') continue;
      if (cq.progress >= cq.targetCount) continue;
      const authorizedContributors = Object.keys(damageByPlayer).filter(
        (pid) => damageByPlayer[pid] > 0 && this.isAuthorizedForCoopQuest(pid, cq),
      );
      const killerAuthorized = this.isAuthorizedForCoopQuest(killerId, cq);
      if (!killerAuthorized && authorizedContributors.length === 0) continue;

      if (cq.targetEnemyType && !serverEnemyTypeMatches(cq.targetEnemyType, archetype)) {
        continue;
      }

      if (!Array.isArray(cq.countedTargetIds)) {
        cq.countedTargetIds = [];
      }
      if (cq.countedTargetIds.includes(targetId)) {
        continue;
      }
      cq.countedTargetIds.push(targetId);

      cq.progress = Math.min(cq.targetCount, cq.progress + 1);
      if (killerAuthorized) {
        cq.contributors[killerId] = (cq.contributors[killerId] ?? 0) + 1;
      }
      for (const contribId of authorizedContributors) {
        if (contribId !== killerId && cq.contributors[contribId] === undefined) {
          cq.contributors[contribId] = 0;
        }
      }
      this.dirtyWorld = true;

      const recipients = this.getAuthorizedPlayerIdsForCoopQuest(cq);
      if (cq.progress >= cq.targetCount) {
        cq.status = 'completed';
        cq.completedAtMs = now;
        for (const memberId of recipients) {
          await this.grantCoopQuestPersonalRewardForMember(cq, memberId, now);
          updatedPlayerKeys.push(this.resolvePersistentKeyForPlayerId(memberId));
        }
      }

      await this.flushDirtyLayers({
        room: true,
        world: true,
        playerKeys: updatedPlayerKeys,
      });

      const snap = structuredClone(cq);
      for (const memberId of recipients) {
        this.sendToPlayer<CoopQuestStateRecord>(memberId, 'COOP_QUEST_UPDATED', snap);
      }
    }
  }

  private syncBossEncounterFromEntity(
    world: StoredWorldLayer,
    entity: ServerTrackedEntity,
    fallbackTargetId: string | null,
    broadcastIfChanged: boolean,
    now: number,
  ): BossEncounterState | null {
    if (!this.isBossArchetypeOrFlag(entity.kind, entity.archetype, entity.isBoss)) {
      return null;
    }
    entity.isBoss = true;
    const phase = entity.hp <= Math.floor(entity.maxHp * 0.5) ? 2 : 1;
    entity.bossPhase = phase;
    if (!world.bossEncounters) {
      world.bossEncounters = {};
    }
    const prev = world.bossEncounters[entity.id];
    const nextAttackState = (entity.attackState as BossAttackState) || prev?.attackState || 'idle';
    const nextTargetId =
      entity.targetPlayerId !== undefined
        ? entity.targetPlayerId
        : (prev?.targetPlayerId ?? fallbackTargetId);

    const next: BossEncounterState = {
      bossId: entity.id,
      archetype: entity.archetype,
      hp: entity.hp,
      maxHp: entity.maxHp,
      isDead: entity.isDead,
      state: entity.state,
      attackState: nextAttackState,
      phase,
      targetPlayerId: entity.isDead ? null : nextTargetId,
      damageByPlayer: { ...(entity.damageByPlayer ?? prev?.damageByPlayer ?? {}) },
      x: entity.x,
      y: entity.y,
      z: entity.z,
      yaw: entity.yaw,
      killSeq: entity.killSeq ?? prev?.killSeq ?? 0,
      updatedAtMs: now,
    };

    const significantChange =
      !prev ||
      prev.hp !== next.hp ||
      prev.maxHp !== next.maxHp ||
      prev.isDead !== next.isDead ||
      prev.phase !== next.phase ||
      prev.attackState !== next.attackState ||
      prev.targetPlayerId !== next.targetPlayerId ||
      prev.state !== next.state;

    world.bossEncounters[entity.id] = next;
    this.dirtyWorld = true;

    if (broadcastIfChanged && significantChange) {
      this.broadcast<BossEncounterState>(
        'BOSS_STATE_UPDATED',
        this.roomLayer?.hostPlayerId || 'system',
        structuredClone(next),
      );
    }
    return next;
  }

  private async resolveEnemyOrBossLoot(
    entity: ServerTrackedEntity,
    killerId: string,
    world: StoredWorldLayer,
    now: number,
  ): Promise<string[]> {
    entity.killSeq = (entity.killSeq ?? 0) + 1;
    const killSeq = entity.killSeq;
    const table = ENEMY_LOOT_TABLES[entity.archetype] ?? ENEMY_LOOT_TABLES.bandit_scout;
    const isBoss = this.isBossArchetypeOrFlag(
      entity.kind,
      entity.archetype,
      entity.isBoss || table.isBoss,
    );
    const updatedKeys: string[] = [];

    const killerPersonalItems: LootGrantItem[] = [];
    for (const drop of table.personal.items ?? []) {
      const chance = drop.chance ?? 1;
      const roll = this.deterministicLootRoll(
        `${entity.id}:k${killSeq}:${drop.itemId}:personal`,
      );
      if (roll <= chance) {
        killerPersonalItems.push({ itemId: drop.itemId, count: drop.count });
      }
    }

    await this.grantIdempotentReward(
      killerId,
      `loot:${entity.id}:k${killSeq}:${killerId}:personal`,
      {
        mode: 'personal',
        sourceKind: isBoss ? 'boss' : 'enemy',
        sourceId: entity.id,
        archetype: entity.archetype,
        xp: table.personal.xp,
        coins: table.personal.coins,
        items: killerPersonalItems,
        reason: isBoss ? `boss_killed:${entity.archetype}` : 'enemy_killed',
        now,
      },
    );
    updatedKeys.push(this.resolvePersistentKeyForPlayerId(killerId));

    const dmgMap = entity.damageByPlayer ?? {};
    const contributors = Object.keys(dmgMap).filter(
      (pid) => dmgMap[pid] > 0 && Boolean(this.roomLayer?.players[pid]),
    );
    if (!contributors.includes(killerId)) {
      contributors.push(killerId);
    }

    if (isBoss) {
      for (const pid of contributors) {
        if (pid === killerId) continue;
        await this.grantIdempotentReward(
          pid,
          `loot:${entity.id}:k${killSeq}:${pid}:personal`,
          {
            mode: 'personal',
            sourceKind: 'boss',
            sourceId: entity.id,
            archetype: entity.archetype,
            xp: Math.max(10, Math.round(table.personal.xp * 0.5)),
            coins: Math.max(5, Math.round(table.personal.coins * 0.5)),
            items: killerPersonalItems,
            reason: `boss_assist:${entity.archetype}`,
            now,
          },
        );
        updatedKeys.push(this.resolvePersistentKeyForPlayerId(pid));
      }
    }

    if (table.shared && contributors.length > 0) {
      const killerPartyId = this.partyLayer?.playerPartyById[killerId];
      const partyRecipients =
        killerPartyId && this.partyLayer?.parties[killerPartyId]
          ? this.partyLayer.parties[killerPartyId].members
              .filter((m) => m.online && Boolean(this.roomLayer?.players[m.playerId]))
              .map((m) => m.playerId)
          : [];
      const sharedRecipients = Array.from(
        new Set<string>([...contributors, ...partyRecipients]),
      );
      const divisor = Math.max(1, sharedRecipients.length);
      const sharedXpEach = Math.max(5, Math.round(table.shared.xpPool / divisor));
      const sharedCoinsEach = Math.max(3, Math.round(table.shared.coinsPool / divisor));
      const sharedItems = (table.shared.items ?? []).map((it) => ({
        itemId: it.itemId,
        count: it.count,
      }));

      for (const pid of sharedRecipients) {
        await this.grantIdempotentReward(
          pid,
          `loot:${entity.id}:k${killSeq}:${pid}:shared`,
          {
            mode: 'shared',
            sourceKind: isBoss ? 'boss' : 'enemy',
            sourceId: entity.id,
            archetype: entity.archetype,
            xp: sharedXpEach,
            coins: sharedCoinsEach,
            items: sharedItems,
            reason: `shared_loot:${entity.archetype}`,
            now,
          },
        );
        updatedKeys.push(this.resolvePersistentKeyForPlayerId(pid));
      }
    }

    if (table.worldDrops && table.worldDrops.length > 0) {
      const shared = this.ensureSharedObjectsLayer();
      for (let i = 0; i < table.worldDrops.length; i++) {
        const wd = table.worldDrops[i];
        const chance = wd.chance ?? 1;
        const roll = this.deterministicLootRoll(
          `${entity.id}:k${killSeq}:${wd.itemId}:world:${i}`,
        );
        if (roll > chance) continue;
        const dropId = `drop_loot_${entity.id}_k${killSeq}_${i}`.slice(0, 64);
        if (shared.droppedItems[dropId]) continue;
        delete shared.sharedResources[dropId];
        const offsetX = (i - (table.worldDrops.length - 1) * 0.5) * 0.65;
        shared.droppedItems[dropId] = {
          id: dropId,
          itemId: wd.itemId,
          count: wd.count,
          label: wd.label ?? wd.itemId,
          x: Math.round((entity.x + offsetX) * 100) / 100,
          y: Math.round(entity.y * 100) / 100,
          z: Math.round((entity.z + 0.35) * 100) / 100,
          droppedBy: entity.id,
        };
        this.dirtyShared = true;
        this.broadcast('GAME_EVENT', killerId, {
          event: 'ITEM_DROPPED',
          data: {
            dropId,
            itemId: wd.itemId,
            count: wd.count,
            label: wd.label ?? wd.itemId,
            x: shared.droppedItems[dropId].x,
            y: shared.droppedItems[dropId].y,
            z: shared.droppedItems[dropId].z,
            droppedBy: entity.id,
            mode: 'world_drop',
          },
        });
      }
    }

    if (isBoss) {
      entity.damageByPlayer = {};
      this.syncBossEncounterFromEntity(world, entity, null, true, now);
    } else {
      entity.damageByPlayer = {};
    }

    return Array.from(new Set(updatedKeys));
  }

  private async handleCreateRoom(request: Request): Promise<Response> {
    if (this.roomLayer && this.roomLayer.status !== 'closed') {
      return Response.json(
        { ok: false, error: 'ROOM_ALREADY_EXISTS' },
        { status: 409 },
      );
    }

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || !isValidRoomId(body.roomId)) {
      return Response.json({ ok: false, error: 'INVALID_ROOM_ID' }, { status: 400 });
    }
    const forbiddenCreateKey = findForbiddenAuthorityKey(
      body,
      new Set(['seed', 'worldType', 'difficulty']),
    );
    if (forbiddenCreateKey) {
      this.securityLogger.record({
        category: 'AUTHORITY_VIOLATION',
        code: 'FORBIDDEN_ROOM_CREATE_FIELD',
        severity: 'high',
        roomId: body.roomId,
        detail: forbiddenCreateKey,
      });
      return Response.json(
        {
          ok: false,
          error: 'FORBIDDEN_CLIENT_AUTHORITY',
          message: 'Request contains server-authoritative fields.',
        },
        { status: 403 },
      );
    }

    const verifiedIdentity =
      body.verifiedIdentity &&
      typeof body.verifiedIdentity === 'object' &&
      !Array.isArray(body.verifiedIdentity)
        ? (body.verifiedIdentity as {
            publicProfileId?: string;
            displayName?: string;
            playerTag?: string;
            avatar?: AvatarConfig;
          })
        : null;

    const hostId = generateSecurePlayerId();
    const sessionToken = generateSecureSessionToken();
    const resumeToken = generateSecureSessionToken();
    const resumeHash = await sha256Hex(resumeToken);
    const persistentKey = verifiedIdentity?.publicProfileId
      ? `profile:${verifiedIdentity.publicProfileId}`
      : `resume:${resumeHash}`;

    const hostName = sanitizeDisplayName(
      verifiedIdentity?.displayName ?? body.playerName ?? body.hostName,
      'Adventurer',
    );
    const roomName = sanitizeRoomName(body.roomName, 'Oakhollow Co-op Expedition');
    const worldName = sanitizeRoomName(body.worldName ?? roomName, roomName);
    const worldType: WorldType = VALID_WORLD_TYPES.has(body.worldType as WorldType)
      ? (body.worldType as WorldType)
      : 'normal';
    const difficulty: DifficultyLevel = VALID_DIFFICULTIES.has(
      body.difficulty as DifficultyLevel,
    )
      ? (body.difficulty as DifficultyLevel)
      : 'normal';
    const isPrivate =
      typeof body.isPrivate === 'boolean'
        ? body.isPrivate
        : body.privacy === 'private' || body.privacy === 'friends';
    const allowFriends =
      typeof body.allowFriends === 'boolean'
        ? body.allowFriends
        : body.privacy !== 'private';
    const privacy: RoomPrivacy = VALID_PRIVACY.has(body.privacy as RoomPrivacy)
      ? (body.privacy as RoomPrivacy)
      : !isPrivate
        ? 'public'
        : allowFriends
          ? 'friends'
          : 'private';
    const rawMax =
      typeof body.maxPlayers === 'number' && Number.isFinite(body.maxPlayers)
        ? Math.floor(body.maxPlayers)
        : 8;
    const maxPlayers = (ALLOWED_MAX_PLAYER_COUNTS as readonly number[]).includes(rawMax)
      ? rawMax
      : Math.max(MIN_PLAYERS_PER_ROOM, Math.min(MAX_PLAYERS_PER_ROOM, rawMax));
    const requireAllReady =
      typeof body.requireAllReady === 'boolean' ? body.requireAllReady : true;
    const rawPassword =
      typeof body.password === 'string' && body.password.trim().length > 0
        ? body.password.trim().slice(0, 64)
        : null;
    const passwordHash = rawPassword ? await sha256Hex(rawPassword) : null;
    const now = Date.now();
    const avatarColor = verifiedIdentity?.avatar?.color ?? pickAvatarColor(hostId);
    const hostEntityId = generateNetworkEntityId(hostId);

    const hostPlayer: NetworkPlayerRecord = {
      playerId: hostId,
      ...(verifiedIdentity?.publicProfileId
        ? { publicProfileId: verifiedIdentity.publicProfileId }
        : {}),
      networkEntityId: hostEntityId,
      displayName: hostName,
      ...(verifiedIdentity?.playerTag ? { playerTag: verifiedIdentity.playerTag } : {}),
      avatarColor,
      ...(verifiedIdentity?.avatar ? { avatar: verifiedIdentity.avatar } : {}),
      isHost: true,
      isReady: true,
      pingMs: null,
      connectionQuality: 'good',
      joinedAt: now,
      lastSeenAt: now,
      health: 100,
      maxHealth: 100,
      isDead: false,
    };

    const requestedRoomCode = isValidRoomCode(body.roomCode)
      ? body.roomCode.trim().toUpperCase()
      : generateSecureRoomCode();
    const requestedSeed =
      typeof body.seed === 'number' && Number.isFinite(body.seed) && body.seed > 0
        ? Math.floor(Math.abs(body.seed))
        : generateSecureWorldSeed();
    const friendlyFire =
      typeof body.friendlyFire === 'boolean' ? body.friendlyFire : false;
    const modMetaCheck = validateUntrustedProtocolModMetadata(body.modMetadata);
    if (!modMetaCheck.ok) {
      this.securityLogger.record({
        category: 'PAYLOAD_TAMPER',
        code: modMetaCheck.error,
        severity: 'medium',
        roomId: String(body.roomId || ''),
        detail: modMetaCheck.message.slice(0, 120),
      });
      return Response.json(
        {
          ok: false,
          error: modMetaCheck.error,
          message: modMetaCheck.message,
        },
        { status: modMetaCheck.status },
      );
    }
    const sanitizedModMetadata = modMetaCheck.value;

    this.roomLayer = {
      roomId: body.roomId,
      roomCode: requestedRoomCode,
      roomName,
      hostPlayerId: hostId,
      players: { [hostId]: hostPlayer },
      maxPlayers,
      gameMode: { worldType, difficulty },
      status: 'waiting',
      hasEnteredWorld: false,
      permissions: {
        privacy,
        isPrivate,
        allowFriends,
        requireAllReady,
        worldSettingsPermission: 'HOST_ONLY',
        locked: false,
        hasPassword: Boolean(passwordHash),
      },
      passwordHash,
      playerTokens: { [hostId]: sessionToken },
      resumeIndex: { [resumeHash]: persistentKey },
      playerKeyByPlayerId: { [hostId]: persistentKey },
      knownPlayerKeys: [persistentKey],
      createdAt: now,
      lastActivityAt: now,
      lastPlayerJoinedAt: now,
      lastPlayerLeftAt: null,
      expiresAt: now + ROOM_INACTIVE_TIMEOUT_MS,
      ...(sanitizedModMetadata ? { modMetadata: sanitizedModMetadata } : {}),
    };

    this.worldLayer = this.makeDefaultWorldLayer(
      requestedSeed,
      worldName,
      worldType,
      difficulty,
      now,
      friendlyFire,
    );
    if (sanitizedModMetadata) {
      this.worldLayer.modMetadata = sanitizedModMetadata;
    }
    this.sharedObjectsLayer = this.makeDefaultSharedObjectsLayer();
    this.chatLayer = this.makeDefaultChatLayer();
    this.partyLayer = this.makeDefaultPartyLayer();
    this.playerDataByKey.clear();
    this.runtimeByPlayerId.clear();

    const hostPlayerData: StoredPlayerLayer = {
      persistentKey,
      playerId: hostId,
      ...(verifiedIdentity?.publicProfileId
        ? { publicProfileId: verifiedIdentity.publicProfileId }
        : {}),
      profile: {
        displayName: hostName,
        ...(verifiedIdentity?.playerTag ? { playerTag: verifiedIdentity.playerTag } : {}),
        avatarColor,
        ...(verifiedIdentity?.avatar ? { avatar: verifiedIdentity.avatar } : {}),
      },
      level: 1,
      xp: 0,
      coins: STARTING_COINS_BY_WORLD_TYPE[worldType] ?? 0,
      inventory: {
        ammoCount: 24,
        inventoryItemIds: defaultInventoryIds(),
        itemCounts: {},
        chestWeaponLootCount: 0,
      },
      weapons: {
        equippedWeaponId: 'ranger-sword',
      },
      quests: {},
      statistics: defaultPlayerStatistics(),
      vitals: {
        health: 100,
        maxHealth: 100,
        isDead: false,
        reviveAtMs: null,
      },
      position: {
        x: this.worldLayer.worldSettings.spawnX,
        y: this.worldLayer.worldSettings.spawnY,
        z: this.worldLayer.worldSettings.spawnZ,
        yaw: 0,
      },
      updatedAt: now,
    };
    this.playerDataByKey.set(persistentKey, hostPlayerData);
    this.ensureRuntimeForPlayer(hostId);

    await this.flushDirtyLayers({
      room: true,
      world: true,
      shared: true,
      chat: true,
      party: true,
      playerKeys: [persistentKey],
    });
    await this.syncDirectory();
    await this.scheduleLifecycleSweep();
    await this.syncProfileEvent(hostPlayer.publicProfileId, {
      currentRoomId: this.roomLayer.roomId,
      currentRoomName: this.roomLayer.roomName,
      statsDelta: { worldsCreated: 1, gamesHosted: 1, multiplayerSessions: 1 },
    });

    return Response.json({
      ok: true,
      room: this.buildSnapshot(),
      playerId: hostId,
      sessionToken,
      resumeToken,
    });
  }

  private async handleIssueJoinTicket(request: Request): Promise<Response> {
    if (!this.roomLayer) {
      return Response.json(
        { ok: false, error: 'ROOM_NOT_FOUND', message: 'ROOM NOT FOUND' },
        { status: 404 },
      );
    }
    if (await this.expireIfNeeded(Date.now())) {
      return Response.json(
        { ok: false, error: 'ROOM_EXPIRED', message: 'ROOM EXPIRED' },
        { status: 410 },
      );
    }

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) {
      return Response.json({ ok: false, error: 'INVALID_BODY' }, { status: 400 });
    }
    const forbiddenJoinKey = findForbiddenAuthorityKey(body);
    if (forbiddenJoinKey) {
      this.securityLogger.record({
        category: 'AUTHORITY_VIOLATION',
        code: 'FORBIDDEN_ROOM_JOIN_FIELD',
        severity: 'high',
        roomId: this.roomLayer.roomId,
        detail: forbiddenJoinKey,
      });
      return Response.json(
        {
          ok: false,
          error: 'FORBIDDEN_CLIENT_AUTHORITY',
          message: 'Request contains server-authoritative fields.',
        },
        { status: 403 },
      );
    }

    const rl = this.roomLayer;
    if (rl.status === 'closed') {
      return Response.json(
        { ok: false, error: 'ROOM_EXPIRED', message: 'ROOM EXPIRED' },
        { status: 410 },
      );
    }

    if (rl.passwordHash) {
      const provided = typeof body.password === 'string' ? body.password.trim() : '';
      if (!provided) {
        return Response.json(
          { ok: false, error: 'PASSWORD_REQUIRED' },
          { status: 403 },
        );
      }
      const providedHash = await sha256Hex(provided);
      if (!timingSafeEqualHex(providedHash, rl.passwordHash)) {
        return Response.json(
          { ok: false, error: 'INVALID_PASSWORD' },
          { status: 403 },
        );
      }
    }

    const hostModMetadata = rl.modMetadata ?? this.worldLayer?.modMetadata;
    const clientModCheck = validateUntrustedProtocolModMetadata(
      body.clientModMetadata,
    );
    if (!clientModCheck.ok) {
      const attemptName = sanitizeDisplayName(
        typeof body.playerName === 'string' ? body.playerName : undefined,
        'Player',
      );
      this.incompatibleJoinAttempts.push({
        playerName: attemptName,
        attemptedAt: Date.now(),
        reason: clientModCheck.message,
        issues: [],
      });
      if (this.incompatibleJoinAttempts.length > 20) {
        this.incompatibleJoinAttempts.splice(0, this.incompatibleJoinAttempts.length - 20);
      }
      this.securityLogger.record({
        category: 'PAYLOAD_TAMPER',
        code: clientModCheck.error,
        severity: 'medium',
        roomId: rl.roomId,
        detail: clientModCheck.message.slice(0, 120),
      });
      return Response.json(
        {
          ok: false,
          error: clientModCheck.error,
          message: clientModCheck.message,
        },
        { status: clientModCheck.status },
      );
    }
    const clientModMetadata = clientModCheck.value;
    const modCompatibility = verifyMultiplayerModCompatibility(
      hostModMetadata,
      clientModMetadata,
    );
    if (!modCompatibility.compatible) {
      const attemptName = sanitizeDisplayName(
        typeof body.playerName === 'string' ? body.playerName : undefined,
        'Player',
      );
      this.incompatibleJoinAttempts.push({
        playerName: attemptName,
        attemptedAt: Date.now(),
        reason: modCompatibility.summary,
        issues: modCompatibility.issues,
      });
      if (this.incompatibleJoinAttempts.length > 20) {
        this.incompatibleJoinAttempts.splice(0, this.incompatibleJoinAttempts.length - 20);
      }
      this.securityLogger.record({
        category: 'PAYLOAD_TAMPER',
        code: 'MOD_COMPATIBILITY_REJECTED',
        severity: 'low',
        roomId: rl.roomId,
        detail: modCompatibility.summary.slice(0, 120),
      });
      return Response.json(
        {
          ok: false,
          error: 'MOD_INCOMPATIBLE',
          message: modCompatibility.summary,
          modCompatibility,
          ...(hostModMetadata ? { hostModMetadata } : {}),
        },
        { status: 409 },
      );
    }

    const verifiedIdentity =
      body.verifiedIdentity &&
      typeof body.verifiedIdentity === 'object' &&
      !Array.isArray(body.verifiedIdentity)
        ? (body.verifiedIdentity as {
            publicProfileId?: string;
            displayName?: string;
            playerTag?: string;
            avatar?: AvatarConfig;
          })
        : null;

    const rawResumeToken =
      typeof body.resumeToken === 'string' && body.resumeToken.trim().length > 0
        ? body.resumeToken.trim().slice(0, 128)
        : null;
    const providedResumeHash = rawResumeToken ? await sha256Hex(rawResumeToken) : null;

    let persistentKey = verifiedIdentity?.publicProfileId
      ? `profile:${verifiedIdentity.publicProfileId}`
      : providedResumeHash && rl.resumeIndex[providedResumeHash]
        ? rl.resumeIndex[providedResumeHash]
        : '';

    let outgoingResumeToken = rawResumeToken;
    if (!persistentKey) {
      outgoingResumeToken = generateSecureSessionToken();
      const newHash = await sha256Hex(outgoingResumeToken);
      persistentKey = `resume:${newHash}`;
      rl.resumeIndex[newHash] = persistentKey;
    } else if (!outgoingResumeToken || !providedResumeHash || !rl.resumeIndex[providedResumeHash]) {
      outgoingResumeToken = generateSecureSessionToken();
      const aliasHash = await sha256Hex(outgoingResumeToken);
      rl.resumeIndex[aliasHash] = persistentKey;
    }

    // Load persisted player data if not already cached in memory
    let savedPlayerData = this.playerDataByKey.get(persistentKey);
    if (!savedPlayerData) {
      const fromStorage = await this.ctx.storage.get<StoredPlayerLayer>(
        `${PLAYER_DATA_KEY_PREFIX}${persistentKey}`,
      );
      if (fromStorage) {
        savedPlayerData = fromStorage;
        this.playerDataByKey.set(persistentKey, fromStorage);
      }
    }

    // If same persistent player had a stale disconnected slot still inside rl.players, replace it cleanly
    let staleReplacedId: string | null = null;
    for (const [existingPid, pk] of Object.entries(rl.playerKeyByPlayerId)) {
      if (
        pk === persistentKey &&
        rl.players[existingPid] &&
        !this.hasActiveSocketForPlayer(existingPid)
      ) {
        staleReplacedId = existingPid;
        delete rl.players[existingPid];
        delete rl.playerTokens[existingPid];
        delete rl.playerKeyByPlayerId[existingPid];
        this.runtimeByPlayerId.delete(existingPid);
      }
    }

    const currentCount = Object.keys(rl.players).length;
    if (currentCount >= rl.maxPlayers) {
      return Response.json(
        { ok: false, error: 'ROOM_FULL', message: 'ROOM IS FULL' },
        { status: 409 },
      );
    }

    const now = Date.now();
    // If the room had 0 active players, resume the paused world clock & weather duration cleanly
    if (currentCount === 0) {
      this.resumeWorldOnActiveEntry(now);
    }

    const canReuseSavedId = Boolean(
      savedPlayerData &&
        isValidPlayerId(savedPlayerData.playerId) &&
        !this.hasActiveSocketForPlayer(savedPlayerData.playerId),
    );
    const playerId = canReuseSavedId
      ? savedPlayerData!.playerId
      : generateSecurePlayerId();
    const sessionToken = generateSecureSessionToken();
    const displayName = sanitizeDisplayName(
      verifiedIdentity?.displayName ?? body.playerName ?? savedPlayerData?.profile.displayName,
      'Adventurer',
    );
    const avatarColor =
      verifiedIdentity?.avatar?.color ??
      savedPlayerData?.profile.avatarColor ??
      pickAvatarColor(playerId);
    const playerEntityId = generateNetworkEntityId(playerId);
    const shouldBecomeHost =
      !rl.hostPlayerId ||
      Object.keys(rl.players).length === 0 ||
      !rl.players[rl.hostPlayerId] ||
      staleReplacedId === rl.hostPlayerId;

    // Persistent rooms that already entered the world restore 'in-game' status when players return
    if (rl.hasEnteredWorld && rl.status === 'waiting') {
      rl.status = 'in-game';
      rl.permissions.locked = true;
    }

    const isReturningPlayer = Boolean(savedPlayerData);
    const wl = this.ensureWorldLayer();
    if (!savedPlayerData) {
      savedPlayerData = {
        persistentKey,
        playerId,
        ...(verifiedIdentity?.publicProfileId
          ? { publicProfileId: verifiedIdentity.publicProfileId }
          : {}),
        profile: {
          displayName,
          ...(verifiedIdentity?.playerTag ? { playerTag: verifiedIdentity.playerTag } : {}),
          avatarColor,
          ...(verifiedIdentity?.avatar ? { avatar: verifiedIdentity.avatar } : {}),
        },
        level: 1,
        xp: 0,
        coins: this.getDefaultStartingCoins(),
        inventory: {
          ammoCount: 24,
          inventoryItemIds: defaultInventoryIds(),
          itemCounts: {},
          chestWeaponLootCount: 0,
        },
        weapons: {
          equippedWeaponId: 'ranger-sword',
        },
        quests: {},
        statistics: defaultPlayerStatistics(),
        vitals: {
          health: 100,
          maxHealth: 100,
          isDead: false,
          reviveAtMs: null,
        },
        position: {
          x: wl.worldSettings.spawnX ?? 0,
          y: wl.worldSettings.spawnY ?? 0,
          z: wl.worldSettings.spawnZ ?? 4,
          yaw: 0,
        },
        updatedAt: now,
      };
      this.playerDataByKey.set(persistentKey, savedPlayerData);
    } else {
      // Returning player: preserve progression, inventory, weapons, quests, stats, vitals, position
      savedPlayerData.playerId = playerId;
      if (!savedPlayerData.inventory.itemCounts) {
        savedPlayerData.inventory.itemCounts = {};
      }
      if (verifiedIdentity?.publicProfileId) {
        savedPlayerData.publicProfileId = verifiedIdentity.publicProfileId;
      }
      const resolvedAvatarRaw = verifiedIdentity?.avatar ?? savedPlayerData.profile.avatar;
      const resolvedAvatar = resolvedAvatarRaw
        ? migrateAvatarConfig(resolvedAvatarRaw).avatar
        : undefined;
      savedPlayerData.profile = {
        displayName,
        ...(verifiedIdentity?.playerTag ?? savedPlayerData.profile.playerTag
          ? { playerTag: verifiedIdentity?.playerTag ?? savedPlayerData.profile.playerTag }
          : {}),
        avatarColor,
        ...(resolvedAvatar ? { avatar: resolvedAvatar } : {}),
      };
      savedPlayerData.updatedAt = now;
    }

    const joinedPlayer: NetworkPlayerRecord = {
      playerId,
      ...(verifiedIdentity?.publicProfileId ?? savedPlayerData.publicProfileId
        ? {
            publicProfileId:
              verifiedIdentity?.publicProfileId ?? savedPlayerData.publicProfileId,
          }
        : {}),
      networkEntityId: playerEntityId,
      displayName,
      ...(savedPlayerData.profile.playerTag
        ? { playerTag: savedPlayerData.profile.playerTag }
        : {}),
      avatarColor,
      ...(savedPlayerData.profile.avatar
        ? { avatar: savedPlayerData.profile.avatar }
        : {}),
      isHost: shouldBecomeHost,
      isReady: shouldBecomeHost || rl.status === 'in-game' || rl.hasEnteredWorld,
      pingMs: null,
      connectionQuality: 'good',
      joinedAt: now,
      lastSeenAt: now,
      health: savedPlayerData.vitals.health,
      maxHealth: savedPlayerData.vitals.maxHealth,
      isDead: savedPlayerData.vitals.isDead,
      state: {
        x: savedPlayerData.position.x,
        y: savedPlayerData.position.y,
        z: savedPlayerData.position.z,
        yaw: savedPlayerData.position.yaw,
        weaponId: savedPlayerData.weapons.equippedWeaponId,
        networkEntityId: playerEntityId,
        health: savedPlayerData.vitals.health,
        maxHealth: savedPlayerData.vitals.maxHealth,
        isDead: savedPlayerData.vitals.isDead,
      },
    };

    if (shouldBecomeHost) {
      rl.hostPlayerId = playerId;
    }
    rl.players[playerId] = joinedPlayer;
    rl.playerTokens[playerId] = sessionToken;
    rl.playerKeyByPlayerId[playerId] = persistentKey;
    if (!rl.knownPlayerKeys.includes(persistentKey)) {
      rl.knownPlayerKeys.push(persistentKey);
    }
    rl.lastPlayerJoinedAt = now;
    this.touchRoomActivity(now);
    this.ensureRuntimeForPlayer(playerId);

    if (staleReplacedId && staleReplacedId !== playerId) {
      this.migratePlayerIdInParties(staleReplacedId, playerId);
    }
    const invitedPartyId =
      typeof body.partyId === 'string' && body.partyId.trim().length > 0
        ? body.partyId.trim()
        : '';
    if (invitedPartyId) {
      const pl = this.ensurePartyLayer();
      const targetParty = pl.parties[invitedPartyId];
      if (
        targetParty &&
        !pl.playerPartyById[playerId] &&
        targetParty.members.length < Math.min(targetParty.maxMembers, rl.maxPlayers)
      ) {
        const usedIdx = new Set(targetParty.members.map((m) => m.markerIndex));
        let idx = 0;
        while (usedIdx.has(idx)) idx += 1;
        targetParty.members.push(this.makePartyMemberRecord(playerId, idx, now, false));
        pl.playerPartyById[playerId] = invitedPartyId;
        this.syncPartyMemberLiveStats(targetParty);
        this.dirtyParty = true;
      }
    }

    await this.flushDirtyLayers({
      room: true,
      world: this.dirtyWorld,
      party: this.dirtyParty,
      playerKeys: [persistentKey],
    });
    await this.syncDirectory();
    await this.scheduleLifecycleSweep();
    await this.syncProfileEvent(joinedPlayer.publicProfileId, {
      currentRoomId: rl.roomId,
      currentRoomName: rl.roomName,
      statsDelta: { worldsJoined: 1, multiplayerSessions: 1 },
    });
    this.broadcast('JOIN_ROOM', playerId, { displayName });
    this.broadcastRoomState();
    this.sendPartyStatesToRoom();

    return Response.json({
      ok: true,
      room: this.buildSnapshot(),
      playerId,
      sessionToken,
      resumeToken: outgoingResumeToken,
      returningPlayer: isReturningPlayer,
    });
  }

  private async handleLeavePlayer(playerId: string): Promise<void> {
    if (!this.roomLayer || !this.roomLayer.players[playerId]) return;

    const rl = this.roomLayer;
    const now = Date.now();
    const leavingPlayer = rl.players[playerId];
    const leavingName = leavingPlayer.displayName;
    const wasHost = rl.hostPlayerId === playerId;
    const persistentKey = rl.playerKeyByPlayerId[playerId];

    // Snapshot & persist final player position/vitals/weapon before removing active room slot
    const pData = persistentKey ? this.playerDataByKey.get(persistentKey) : undefined;
    if (pData) {
      if (leavingPlayer.state) {
        pData.position = {
          x: leavingPlayer.state.x,
          y: leavingPlayer.state.y,
          z: leavingPlayer.state.z,
          yaw: leavingPlayer.state.yaw,
        };
        if (leavingPlayer.state.weaponId !== undefined) {
          pData.weapons.equippedWeaponId = leavingPlayer.state.weaponId;
        }
      }
      pData.updatedAt = now;
      this.dirtyPlayerKeys.add(persistentKey);
    }

    delete rl.players[playerId];
    delete rl.playerTokens[playerId];
    delete rl.playerKeyByPlayerId[playerId];
    this.runtimeByPlayerId.delete(playerId);
    const partyRemoval = this.removePlayerFromParty(playerId, 'left');

    await this.syncProfileEvent(leavingPlayer.publicProfileId, {
      currentRoomId: null,
      currentRoomName: null,
    });

    const connectedPlayerIds = new Set(
      Array.from(this.sessions.values()).map((s) => s.playerId),
    );
    const remaining = Object.values(rl.players).sort((a, b) => {
      const aConnected = connectedPlayerIds.has(a.playerId) ? 0 : 1;
      const bConnected = connectedPlayerIds.has(b.playerId) ? 0 : 1;
      if (aConnected !== bConnected) return aConnected - bConnected;
      return a.joinedAt - b.joinedAt;
    });

    if (remaining.length === 0) {
      this.broadcast('LEAVE_ROOM', playerId, { displayName: leavingName });
      rl.hostPlayerId = '';
      rl.status = 'waiting';
      rl.permissions.locked = false;
      rl.lastPlayerLeftAt = now;
      this.pauseWorldForEmptyRoom(now);
      this.touchRoomActivity(now);
      await this.flushDirtyLayers({ room: true, world: true, shared: true, party: true });
      await this.syncDirectory();
      await this.scheduleLifecycleSweep();
      return;
    }

    let hostTransferredPayload: {
      previousHostId: string;
      newHostId: string;
      newHostName: string;
    } | null = null;

    if (wasHost) {
      const nextHost = remaining[0];
      rl.hostPlayerId = nextHost.playerId;
      for (const p of remaining) {
        p.isHost = p.playerId === rl.hostPlayerId;
        if (p.isHost) {
          p.isReady = true;
        }
      }
      hostTransferredPayload = {
        previousHostId: playerId,
        newHostId: nextHost.playerId,
        newHostName: nextHost.displayName,
      };
    }

    await this.flushDirtyLayers({ room: true, world: true, shared: true, party: true });
    await this.syncDirectory();
    this.broadcast('LEAVE_ROOM', playerId, { displayName: leavingName });
    if (hostTransferredPayload) {
      this.broadcast(
        'HOST_TRANSFERRED',
        hostTransferredPayload.newHostId,
        hostTransferredPayload,
      );
    }
    this.broadcastRoomState();
    this.sendPartyStatesToRoom(partyRemoval.affectedPlayerIds);
  }

  private async handleTransferHost(
    hostPlayerId: string,
    targetPlayerId: string,
  ): Promise<void> {
    if (!this.roomLayer) return;
    const target = this.roomLayer.players[targetPlayerId];
    if (!target || targetPlayerId === hostPlayerId) return;

    this.roomLayer.hostPlayerId = targetPlayerId;
    for (const p of Object.values(this.roomLayer.players)) {
      p.isHost = p.playerId === targetPlayerId;
      if (p.isHost) {
        p.isReady = true;
      }
    }

    await this.flushDirtyLayers({ room: true });
    await this.syncDirectory();
    this.broadcast('HOST_TRANSFERRED', hostPlayerId, {
      previousHostId: hostPlayerId,
      newHostId: targetPlayerId,
      newHostName: target.displayName,
    });
    this.broadcastRoomState();
  }

  private async handleKickPlayer(
    hostPlayerId: string,
    targetPlayerId: string,
  ): Promise<void> {
    if (!this.roomLayer) return;
    const target = this.roomLayer.players[targetPlayerId];
    if (!target) return;

    this.broadcast('PLAYER_KICKED', hostPlayerId, {
      targetPlayerId,
      targetDisplayName: target.displayName,
      kickedBy: hostPlayerId,
    });

    const pk = this.roomLayer.playerKeyByPlayerId[targetPlayerId];
    delete this.roomLayer.players[targetPlayerId];
    delete this.roomLayer.playerTokens[targetPlayerId];
    delete this.roomLayer.playerKeyByPlayerId[targetPlayerId];
    this.runtimeByPlayerId.delete(targetPlayerId);
    const partyRemoval = this.removePlayerFromParty(targetPlayerId, 'kicked');

    await this.syncProfileEvent(target.publicProfileId, {
      currentRoomId: null,
      currentRoomName: null,
    });

    for (const [sock, sess] of Array.from(this.sessions.entries())) {
      if (sess.playerId === targetPlayerId) {
        sess.cleanDisconnect = true;
        this.sessions.delete(sock);
        try {
          sock.close(4001, 'Kicked by host');
        } catch {
          // Ignore close errors
        }
      }
    }

    await this.flushDirtyLayers({
      room: true,
      party: true,
      ...(pk ? { playerKeys: [pk] } : {}),
    });
    await this.syncDirectory();
    this.broadcastRoomState();
    this.sendPartyStatesToRoom(partyRemoval.affectedPlayerIds);
  }

  private async handleCloseRoom(hostPlayerId: string): Promise<void> {
    if (!this.roomLayer) return;
    const departedPlayers = Object.values(this.roomLayer.players);
    this.broadcast('ROOM_CLOSED', hostPlayerId, {
      reason: 'Host closed the room.',
      closedBy: hostPlayerId,
    });

    this.roomLayer.players = {};
    this.roomLayer.playerTokens = {};
    this.roomLayer.status = 'closed';
    await this.syncDirectory();
    for (const p of departedPlayers) {
      await this.syncProfileEvent(p.publicProfileId, {
        currentRoomId: null,
        currentRoomName: null,
      });
    }

    for (const [sock, sess] of Array.from(this.sessions.entries())) {
      sess.cleanDisconnect = true;
      this.sessions.delete(sock);
      try {
        sock.close(4000, 'Room closed by host');
      } catch {
        // Ignore close errors
      }
    }

    await this.deleteAllRoomStorage();
    this.roomLayer = null;
    this.worldLayer = null;
    this.sharedObjectsLayer = null;
    this.chatLayer = null;
    this.partyLayer = null;
    this.playerDataByKey.clear();
    this.runtimeByPlayerId.clear();
    this.clearSweepTimer();
    await this.ctx.storage.deleteAlarm?.();
  }

  private sendServerPing(session: ActiveSocketSession): void {
    const now = Date.now();
    session.nextPingSeq += 1;
    session.pendingPingId = session.nextPingSeq;
    session.pendingPingSentAt = now;
    this.sendToSocket(session.ws, 'PING', session.playerId, {
      pingId: session.pendingPingId,
      sentAt: now,
    });
  }

  private hasActiveSocketForPlayer(playerId: string, excludeWs?: WebSocket): boolean {
    for (const [sock, sess] of this.sessions) {
      if (excludeWs && sock === excludeWs) continue;
      if (sess.playerId === playerId) return true;
    }
    return false;
  }

  private async handleUnexpectedSocketDrop(session: ActiveSocketSession): Promise<void> {
    if (!this.roomLayer) return;
    if (session.cleanDisconnect) return;
    if (this.hasActiveSocketForPlayer(session.playerId)) {
      return;
    }

    const player = this.roomLayer.players[session.playerId];
    if (!player) return;

    const now = Date.now();
    player.connectionQuality = 'disconnected';
    player.disconnectedAt = player.disconnectedAt ?? now;
    const pk = this.roomLayer.playerKeyByPlayerId[session.playerId];
    this.lastEntityTimeHeartbeatAt.delete(session.playerId);
    for (const key of Array.from(this.lastDistantPlayerRelayAt.keys())) {
      if (key.startsWith(`${session.playerId}:`) || key.endsWith(`:${session.playerId}`)) {
        this.lastDistantPlayerRelayAt.delete(key);
      }
    }

    // If no active sockets remain in the room, pause world clock & flush all dirty layers immediately
    if (this.sessions.size === 0) {
      this.pauseWorldForEmptyRoom(now);
    }

    await this.flushDirtyLayers({
      room: true,
      world: true,
      shared: true,
      ...(pk ? { playerKeys: [pk] } : {}),
    });

    this.broadcast('DISCONNECT', session.playerId, {
      temporary: true,
      graceMs: this.getPlayerReconnectGraceMs(),
    });
    this.broadcastRoomState();
    this.sendPartyStatesToRoom();
    await this.scheduleLifecycleSweep();
  }

  private async scheduleLifecycleSweep(): Promise<void> {
    this.clearSweepTimer();
    if (!this.roomLayer || this.roomLayer.status === 'closed') return;

    const now = Date.now();
    const hostGraceMs = this.getHostDisconnectGraceMs();
    const reconnectGraceMs = this.getPlayerReconnectGraceMs();
    const connectedIds = new Set(
      Array.from(this.sessions.values()).map((s) => s.playerId),
    );

    let earliestDeadline: number | null =
      this.roomLayer.expiresAt ??
      (this.roomLayer.lastActivityAt ?? this.roomLayer.createdAt) +
        ROOM_INACTIVE_TIMEOUT_MS;

    const hostPlayer = this.roomLayer.players[this.roomLayer.hostPlayerId];
    if (hostPlayer && !connectedIds.has(hostPlayer.playerId) && connectedIds.size > 0) {
      const hostSince = hostPlayer.disconnectedAt ?? this.bootAt;
      const deadline = hostSince + hostGraceMs;
      earliestDeadline =
        earliestDeadline === null ? deadline : Math.min(earliestDeadline, deadline);
    }

    for (const p of Object.values(this.roomLayer.players)) {
      if (!connectedIds.has(p.playerId)) {
        const since = p.disconnectedAt ?? Math.max(p.lastSeenAt, this.bootAt);
        const deadline = since + reconnectGraceMs;
        earliestDeadline =
          earliestDeadline === null ? deadline : Math.min(earliestDeadline, deadline);
      } else {
        const silentDeadline = p.lastSeenAt + HEARTBEAT_TIMEOUT_MS;
        earliestDeadline =
          earliestDeadline === null
            ? silentDeadline
            : Math.min(earliestDeadline, silentDeadline);
      }
    }

    if (earliestDeadline === null) {
      await this.ctx.storage.deleteAlarm?.();
      return;
    }

    const targetTime = Math.max(now + 25, earliestDeadline);
    if (typeof this.ctx.storage.setAlarm === 'function') {
      await this.ctx.storage.setAlarm(targetTime);
    }
    const deltaMs = targetTime - now;
    if (deltaMs <= 120_000) {
      const delayMs = Math.max(25, deltaMs);
      this.sweepTimer = setTimeout(() => {
        this.sweepTimer = null;
        void this.sweepLifecycle();
      }, delayMs);
      (this.sweepTimer as { unref?: () => void }).unref?.();
    }
  }

  public async alarm(): Promise<void> {
    await this.ensureLoaded();
    await this.sweepLifecycle();
  }

  public async sweepLifecycle(): Promise<void> {
    if (!this.roomLayer || this.roomLayer.status === 'closed') return;
    const now = Date.now();
    if (await this.expireIfNeeded(now)) {
      return;
    }
    const hostGraceMs = this.getHostDisconnectGraceMs();
    const reconnectGraceMs = this.getPlayerReconnectGraceMs();

    for (const [sock, sess] of Array.from(this.sessions.entries())) {
      const player = this.roomLayer.players[sess.playerId];
      if (!player) {
        this.sessions.delete(sock);
        continue;
      }
      if (now - player.lastSeenAt > HEARTBEAT_TIMEOUT_MS) {
        this.sessions.delete(sock);
        try {
          sock.close(4008, 'Player heartbeat timeout');
        } catch {
          // Ignore close errors
        }
        if (!this.hasActiveSocketForPlayer(sess.playerId)) {
          player.connectionQuality = 'disconnected';
          player.disconnectedAt = player.disconnectedAt ?? now;
          this.dirtyRoom = true;
          this.broadcast('DISCONNECT', sess.playerId, {
            temporary: true,
            reason: 'PLAYER_TIMEOUT',
          });
        }
      }
    }

    const connectedIds = new Set(
      Array.from(this.sessions.values()).map((s) => s.playerId),
    );

    const currentHost = this.roomLayer.players[this.roomLayer.hostPlayerId];
    if (
      currentHost &&
      !connectedIds.has(currentHost.playerId) &&
      connectedIds.size > 0
    ) {
      const hostSince = currentHost.disconnectedAt ?? this.bootAt;
      if (now - hostSince >= hostGraceMs) {
        const candidate = Object.values(this.roomLayer.players)
          .filter(
            (p) => p.playerId !== currentHost.playerId && connectedIds.has(p.playerId),
          )
          .sort((a, b) => a.joinedAt - b.joinedAt)[0];
        if (candidate) {
          await this.handleTransferHost(currentHost.playerId, candidate.playerId);
        }
      }
    }

    const expiredIds: string[] = [];
    for (const p of Object.values(this.roomLayer.players)) {
      if (!connectedIds.has(p.playerId)) {
        const since = p.disconnectedAt ?? Math.max(p.lastSeenAt, this.bootAt);
        if (now - since >= reconnectGraceMs) {
          expiredIds.push(p.playerId);
        }
      }
    }
    for (const expiredId of expiredIds) {
      await this.handleLeavePlayer(expiredId);
      if (!this.roomLayer) return;
    }

    await this.flushDirtyLayers();
    await this.scheduleLifecycleSweep();
  }

  private attachSocketHandlers(
    ws: CfWebSocket,
    playerId: string,
    clientIp: string,
  ): ActiveSocketSession {
    const limiter = new ConnectionRateLimiter();
    const session: ActiveSocketSession = {
      ws,
      playerId,
      clientIp,
      limiter,
      connectedAt: Date.now(),
      pendingPingId: 0,
      pendingPingSentAt: 0,
      lastRttMeasuredAt: 0,
      nextPingSeq: 0,
      lastChatSentAtMs: 0,
      lastChatNormalized: '',
      duplicateChatStreak: 0,
      reportedTargets: new Set<string>(),
      cleanDisconnect: false,
    };
    this.sessions.set(ws, session);

    ws.addEventListener('message', (event: MessageEvent) => {
      void this.onSocketMessage(session, event.data);
    });

    ws.addEventListener('close', () => {
      if (!this.sessions.has(ws)) return;
      this.sessions.delete(ws);
      void this.handleUnexpectedSocketDrop(session);
    });

    ws.addEventListener('error', () => {
      if (!this.sessions.has(ws)) return;
      this.sessions.delete(ws);
      void this.handleUnexpectedSocketDrop(session);
    });

    return session;
  }

  private async maybePeriodicFlush(now: number): Promise<void> {
    if (now - this.lastPeriodicPersistAt >= PERIODIC_PERSIST_INTERVAL_MS) {
      this.lastPeriodicPersistAt = now;
      await this.flushDirtyLayers();
    }
  }

  private async onSocketMessage(
    session: ActiveSocketSession,
    rawData: unknown,
  ): Promise<void> {
    if (!this.roomLayer) {
      session.ws.close(1008, 'Room no longer exists');
      return;
    }

    if (typeof rawData !== 'string' && !(rawData instanceof ArrayBuffer)) {
      this.sendToSocket(session.ws, 'ERROR', session.playerId, {
        code: 'UNSUPPORTED_FRAME',
        message: 'Only UTF-8 JSON text frames are supported.',
      });
      return;
    }

    const player = this.roomLayer.players[session.playerId];
    if (!player) {
      session.ws.close(1008, 'Player not registered in room');
      return;
    }

    const validated = validateClientMessage(
      rawData,
      this.roomLayer.roomId,
      session.playerId,
      this.roomLayer.hostPlayerId === session.playerId,
    );

    if (!validated.ok) {
      if (
        validated.code === 'FORBIDDEN_CLIENT_AUTHORITY' ||
        validated.code === 'PLAYER_IMPERSONATION_REJECTED' ||
        validated.code === 'FORBIDDEN_HOST_ONLY' ||
        validated.code === 'INVALID_REPAIR_REQUEST' ||
        validated.code === 'INVALID_ENEMY_ATTACK'
      ) {
        this.securityLogger.record({
          category:
            validated.code === 'FORBIDDEN_HOST_ONLY'
              ? 'PERMISSION_DENIED'
              : validated.code === 'INVALID_REPAIR_REQUEST'
                ? 'CURRENCY_TAMPER'
                : 'AUTHORITY_VIOLATION',
          code: validated.code,
          severity: validated.code === 'FORBIDDEN_HOST_ONLY' ? 'medium' : 'high',
          roomId: this.roomLayer.roomId,
          playerId: session.playerId,
        });
      }
      this.sendToSocket(session.ws, 'ERROR', session.playerId, {
        code: validated.code,
        message: validated.reason,
      });
      return;
    }

    const msg = validated.message;
    const rateDecision = session.limiter.checkMessage(msg.type);
    if (!rateDecision.allowed) {
      this.securityLogger.record({
        category: 'RATE_LIMIT_EXCEEDED',
        code: `WS_${msg.type}_RATE_LIMITED`,
        severity: rateDecision.violations >= 20 ? 'high' : 'low',
        roomId: this.roomLayer.roomId,
        playerId: session.playerId,
      });
      this.sendToSocket(session.ws, 'ERROR', session.playerId, {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Slow down.',
      });
      if (rateDecision.violations >= 25) {
        session.ws.close(1008, 'Rate limit exceeded');
      }
      return;
    }

    const now = Date.now();
    player.lastSeenAt = now;

    switch (msg.type) {
      case 'PING': {
        this.sendToSocket(
          session.ws,
          'PONG',
          session.playerId,
          {
            serverTime: now,
            ...(msg.clientSentAt !== undefined ? { clientSentAt: msg.clientSentAt } : {}),
          },
          msg.seq,
        );
        if (now - session.lastRttMeasuredAt >= 3500) {
          this.sendServerPing(session);
        }
        break;
      }

      case 'PONG': {
        if (
          msg.pingId !== undefined &&
          msg.pingId === session.pendingPingId &&
          session.pendingPingSentAt > 0
        ) {
          const rtt = Math.max(1, Math.min(9999, now - session.pendingPingSentAt));
          const prevPing = player.pingMs;
          const prevQuality = player.connectionQuality;
          const nextQuality = getConnectionQuality(rtt, true);
          player.pingMs = rtt;
          player.connectionQuality = nextQuality;
          session.pendingPingId = 0;
          session.lastRttMeasuredAt = now;

          if (
            prevPing === null ||
            prevPing === undefined ||
            Math.abs(prevPing - rtt) >= 8 ||
            prevQuality !== nextQuality
          ) {
            await this.flushDirtyLayers({ room: true });
            this.broadcastRoomState();
          }
        }
        break;
      }

      case 'CONNECT':
      case 'JOIN_ROOM': {
        if (msg.displayName) {
          player.displayName = msg.displayName;
          const pData = this.ensurePlayerDataForPlayer(session.playerId);
          pData.profile.displayName = msg.displayName;
          pData.updatedAt = now;
          await this.flushDirtyLayers({
            room: true,
            playerKeys: [pData.persistentKey],
          });
          await this.syncDirectory();
        }
        this.sendToSocket(
          session.ws,
          'ROOM_STATE',
          session.playerId,
          this.buildSnapshot(),
        );
        this.sendToSocket<PartyStateSnapshot>(
          session.ws,
          'PARTY_STATE',
          session.playerId,
          this.buildPartyStateForPlayer(session.playerId),
        );
        break;
      }

      case 'DISCONNECT':
      case 'LEAVE_ROOM': {
        session.cleanDisconnect = true;
        this.sessions.delete(session.ws);
        await this.handleLeavePlayer(session.playerId);
        try {
          session.ws.close(1000, 'Left room');
        } catch {
          // Ignore close errors
        }
        break;
      }

      case 'READY': {
        if (
          this.roomLayer.status !== 'waiting' ||
          this.roomLayer.permissions.locked
        ) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'INVALID_ROOM_STATUS',
            message: 'Cannot change ready state after game has started.',
          });
          return;
        }
        player.isReady = Boolean(msg.ready);
        await this.flushDirtyLayers({ room: true });
        this.broadcast('READY', session.playerId, { ready: player.isReady });
        this.broadcastRoomState();
        break;
      }

      case 'UPDATE_ROOM_SETTINGS': {
        if (this.roomLayer.hostPlayerId !== session.playerId) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'FORBIDDEN_HOST_ONLY',
            message: 'Only the host can update room settings.',
          });
          return;
        }
        const wantsRequireAllReady = typeof msg.roomSettings?.requireAllReady === 'boolean';
        const wantsFriendlyFire = typeof msg.roomSettings?.friendlyFire === 'boolean';
        if (
          wantsRequireAllReady &&
          (this.roomLayer.status !== 'waiting' || this.roomLayer.permissions.locked)
        ) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'INVALID_ROOM_STATUS',
            message: 'Room ready settings cannot be changed after the game starts.',
          });
          return;
        }
        let changedRoom = false;
        let changedWorld = false;
        if (wantsRequireAllReady) {
          this.roomLayer.permissions.requireAllReady = msg.roomSettings!.requireAllReady!;
          changedRoom = true;
        }
        if (wantsFriendlyFire) {
          const wl = this.ensureWorldLayer();
          wl.worldSettings.friendlyFire = msg.roomSettings!.friendlyFire!;
          changedWorld = true;
        }
        if (changedRoom || changedWorld) {
          await this.flushDirtyLayers({ room: changedRoom, world: changedWorld });
          await this.syncDirectory();
          this.broadcastRoomState();
        }
        break;
      }

      case 'START_GAME': {
        if (this.roomLayer.hostPlayerId !== session.playerId) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'FORBIDDEN_HOST_ONLY',
            message: 'Only the host can start the game.',
          });
          return;
        }
        if (
          this.roomLayer.status !== 'waiting' ||
          this.roomLayer.permissions.locked
        ) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'INVALID_ROOM_STATUS',
            message: 'Room is already locked or started.',
          });
          return;
        }
        if (this.roomLayer.permissions.requireAllReady) {
          const nonHostPlayers = Object.values(this.roomLayer.players).filter(
            (p) => !p.isHost,
          );
          if (nonHostPlayers.some((p) => !p.isReady)) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'PLAYERS_NOT_READY',
              message: 'All required players must be ready before starting.',
            });
            return;
          }
        }

        const world = this.ensureWorldLayer();
        this.roomLayer.status = 'in-game';
        this.roomLayer.hasEnteredWorld = true;
        this.roomLayer.permissions.locked = true;
        if (!world.startedAt) {
          world.startedAt = now;
        }
        world.tick += 1;
        this.resumeWorldOnActiveEntry(now);
        this.touchRoomActivity(now);

        await this.flushDirtyLayers({ room: true, world: true });
        await this.syncDirectory();
        this.broadcastRoomState();
        this.broadcast('START_GAME', session.playerId, this.buildStartGamePayload());

        for (const [sock, sess] of this.sessions) {
          const pData = this.ensurePlayerDataForPlayer(sess.playerId);
          this.sendToSocket(
            sock,
            'WORLD_SNAPSHOT',
            sess.playerId,
            this.buildWorldSnapshot(sess.playerId),
          );
          this.sendToSocket<AuthoritativeProgressionState>(
            sock,
            'PROGRESSION_UPDATED',
            sess.playerId,
            {
              playerId: sess.playerId,
              coins: pData.coins,
              xp: pData.xp,
              level: pData.level,
              xpToNextLevel: pData.level * 100,
              reason: 'start_game',
            },
          );
        }
        break;
      }

      case 'WORLD_SETTINGS_UPDATE': {
        if (!msg.worldSettingsUpdate) return;
        const upd = msg.worldSettingsUpdate;
        const isHost = this.roomLayer.hostPlayerId === session.playerId;

        if (upd.worldSettingsPermission !== undefined) {
          if (!isHost) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'FORBIDDEN_HOST_ONLY',
              message: 'Only the room host can change world settings permissions.',
            });
            return;
          }
          this.roomLayer.permissions.worldSettingsPermission = upd.worldSettingsPermission;
          this.dirtyRoom = true;
        }

        if (upd.friendlyFire !== undefined) {
          if (!isHost) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'FORBIDDEN_HOST_ONLY',
              message: 'Only the room host can change the friendly fire setting.',
            });
            return;
          }
          const worldRef = this.ensureWorldLayer();
          worldRef.worldSettings.friendlyFire = upd.friendlyFire;
          this.dirtyWorld = true;
        }

        const hasWorldControlFields =
          upd.preset !== undefined ||
          upd.worldHours !== undefined ||
          upd.dayCount !== undefined ||
          upd.timeScale !== undefined ||
          upd.paused !== undefined ||
          upd.fullDayDurationSeconds !== undefined ||
          upd.weatherState !== undefined ||
          upd.targetWeatherState !== undefined ||
          upd.weatherIntensity !== undefined ||
          upd.dynamicEnabled !== undefined ||
          upd.transitionDurationSeconds !== undefined ||
          upd.durationMs !== undefined ||
          upd.triggerLightning !== undefined;

        const currentPermission: WorldSettingsPermission =
          this.roomLayer.permissions.worldSettingsPermission ?? 'HOST_ONLY';
        if (hasWorldControlFields && !isHost && currentPermission !== 'ALL_PLAYERS') {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'FORBIDDEN_WORLD_SETTINGS',
            message: 'Host currently restricts world time and weather controls.',
          });
          return;
        }

        this.touchRoomActivity(now);
        const world = this.ensureWorldLayer();
        const materializedTime = this.materializeWorldTime(now);
        const wt = world.time;
        const prevDay = wt.dayCount;
        const prevScale = wt.timeScale;
        let timeChanged = false;

        if (upd.preset !== undefined) {
          wt.worldHours = TIME_PRESET_HOURS[upd.preset];
          wt.anchorServerMs = now;
          timeChanged = true;
        }
        if (upd.worldHours !== undefined) {
          wt.worldHours = Math.round(upd.worldHours * 1000) / 1000;
          wt.anchorServerMs = now;
          timeChanged = true;
        }
        if (upd.dayCount !== undefined) {
          wt.dayCount = upd.dayCount;
          wt.anchorServerMs = now;
          timeChanged = true;
        }
        if (upd.timeScale !== undefined) {
          wt.timeScale = upd.timeScale;
          wt.anchorServerMs = now;
          timeChanged = true;
        }
        if (upd.paused !== undefined) {
          wt.paused = upd.paused;
          wt.anchorServerMs = now;
          timeChanged = true;
        }
        if (upd.fullDayDurationSeconds !== undefined) {
          wt.fullDayDurationSeconds = upd.fullDayDurationSeconds;
          wt.anchorServerMs = now;
          timeChanged = true;
        }
        world.day = wt.dayCount;

        const ww = this.materializeWorldWeather(now);
        const wwRef = world.weather;
        let weatherChanged = false;
        let intensityChanged = false;

        if (
          upd.weatherState !== undefined ||
          upd.targetWeatherState !== undefined ||
          upd.dynamicEnabled !== undefined ||
          upd.durationMs !== undefined ||
          upd.transitionDurationSeconds !== undefined
        ) {
          const nextState =
            upd.targetWeatherState ?? upd.weatherState ?? wwRef.currentState;
          if (upd.weatherState !== undefined) {
            wwRef.currentState = upd.weatherState;
          }
          wwRef.targetState = nextState;
          if (upd.dynamicEnabled !== undefined) {
            wwRef.dynamicEnabled = upd.dynamicEnabled;
          }
          if (upd.transitionDurationSeconds !== undefined) {
            wwRef.transitionDurationSeconds = upd.transitionDurationSeconds;
          }
          if (
            upd.weatherState !== undefined ||
            upd.targetWeatherState !== undefined ||
            upd.durationMs !== undefined
          ) {
            wwRef.startMs = now;
            wwRef.durationMs = Math.max(
              5_000,
              Math.min(
                MAX_WEATHER_DURATION_MS,
                upd.durationMs ?? wwRef.durationMs ?? 240_000,
              ),
            );
            wwRef.endMs = wwRef.startMs + wwRef.durationMs;
          }
          if (upd.weatherIntensity === undefined && upd.weatherState !== undefined) {
            const defaultIntensity =
              upd.weatherState === 'storm'
                ? 0.9
                : upd.weatherState === 'rain'
                  ? 0.72
                  : upd.weatherState === 'fog' || upd.weatherState === 'overcast'
                    ? 0.6
                    : upd.weatherState === 'cloudy'
                      ? 0.35
                      : 0;
            wwRef.intensity = defaultIntensity;
          }
          world.weatherIntensity = wwRef.intensity;
          weatherChanged = true;
        }
        if (upd.weatherIntensity !== undefined) {
          wwRef.intensity = upd.weatherIntensity;
          world.weatherIntensity = wwRef.intensity;
          intensityChanged = true;
        }

        await this.flushDirtyLayers({ room: true, world: true });

        const finalTime = { ...wt };
        const finalWeather = { ...wwRef };
        if (
          timeChanged &&
          (wt.worldHours !== materializedTime.worldHours ||
            wt.paused !== materializedTime.paused ||
            upd.preset !== undefined ||
            upd.worldHours !== undefined ||
            upd.fullDayDurationSeconds !== undefined)
        ) {
          this.broadcast('WORLD_TIME_CHANGED', session.playerId, {
            worldTime: finalTime,
            serverTimestamp: now,
            updatedBy: session.playerId,
          });
        }
        if (wt.dayCount !== prevDay) {
          this.broadcast('WORLD_DAY_CHANGED', session.playerId, {
            dayCount: wt.dayCount,
            worldHours: wt.worldHours,
            serverTimestamp: now,
            updatedBy: session.playerId,
          });
        }
        if (wt.timeScale !== prevScale) {
          this.broadcast('WORLD_TIME_SCALE_CHANGED', session.playerId, {
            timeScale: wt.timeScale,
            paused: wt.paused,
            worldTime: finalTime,
            serverTimestamp: now,
            updatedBy: session.playerId,
          });
        }
        if (weatherChanged || upd.triggerLightning) {
          this.broadcast('WORLD_WEATHER_CHANGED', session.playerId, {
            worldWeather: finalWeather,
            triggerLightning: Boolean(upd.triggerLightning),
            serverTimestamp: now,
            updatedBy: session.playerId,
          });
        }
        if (
          intensityChanged ||
          (upd.weatherState !== undefined && ww.intensity !== finalWeather.intensity)
        ) {
          this.broadcast('WORLD_WEATHER_INTENSITY_CHANGED', session.playerId, {
            intensity: finalWeather.intensity,
            worldWeather: finalWeather,
            serverTimestamp: now,
            updatedBy: session.playerId,
          });
        }
        this.broadcast('WORLD_SETTINGS_UPDATED', session.playerId, {
          worldSettingsPermission:
            this.roomLayer.permissions.worldSettingsPermission ?? 'HOST_ONLY',
          friendlyFire: Boolean(world.worldSettings.friendlyFire),
          worldTime: finalTime,
          worldWeather: finalWeather,
          triggerLightning: Boolean(upd.triggerLightning),
          serverTimestamp: now,
          updatedBy: session.playerId,
        });
        if (upd.worldSettingsPermission !== undefined || upd.friendlyFire !== undefined) {
          this.broadcastRoomState();
        }
        break;
      }

      case 'ENEMY_ATTACK_PLAYER': {
        if (!msg.enemyAttackPlayer) return;
        if (this.roomLayer.status !== 'in-game') return;
        if (this.roomLayer.hostPlayerId !== session.playerId) {
          this.securityLogger.record({
            category: 'PERMISSION_DENIED',
            code: 'ENEMY_ATTACK_NON_HOST',
            severity: 'high',
            roomId: this.roomLayer.roomId,
            playerId: session.playerId,
          });
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'FORBIDDEN_HOST_ONLY',
            message: 'Only the room host can submit NPC/enemy attacks.',
          });
          return;
        }
        if (this.roomLayer.gameMode.worldType === 'creative') return;
        const { targetPlayerId, sourceId, damage: rawDamage, x, z } = msg.enemyAttackPlayer;
        const targetPlayer = this.roomLayer.players[targetPlayerId];
        if (!targetPlayer) return;
        const targetData = this.ensurePlayerDataForPlayer(targetPlayerId);
        const targetRt = this.ensureRuntimeForPlayer(targetPlayerId);
        if (targetData.vitals.isDead) return;

        const lastSrcHit = targetRt.lastEnemyAttackAtBySource[sourceId] ?? 0;
        if (now - lastSrcHit < 650) return;

        const world = this.ensureWorldLayer();
        const sourceEntity = this.findEntityById(world, sourceId);
        if (sourceEntity?.isDead) {
          this.securityLogger.record({
            category: 'COMBAT_ANOMALY',
            code: 'DEAD_ENEMY_ATTACK',
            severity: 'medium',
            roomId: this.roomLayer.roomId,
            playerId: session.playerId,
            detail: sourceId,
          });
          return;
        }
        const resolvedArchetype =
          sourceEntity?.archetype ?? msg.enemyAttackPlayer.archetype ?? 'default';
        const maxArchetypeDamage =
          SERVER_ENEMY_ATTACK_MAX_DAMAGE[resolvedArchetype] ??
          SERVER_ENEMY_ATTACK_MAX_DAMAGE.default;
        const damage = Math.max(1, Math.min(maxArchetypeDamage, Math.round(rawDamage)));

        if (x !== undefined && z !== undefined) {
          const isBossSource = Boolean(
            sourceEntity?.isBoss || resolvedArchetype === 'ancient_guardian',
          );
          const maxReach = isBossSource ? 13.5 : 9.5;
          if (
            Math.hypot(x - targetData.position.x, z - targetData.position.z) > maxReach
          ) {
            return;
          }
          if (sourceEntity) {
            sourceEntity.targetPlayerId = targetPlayerId;
            if (isBossSource) {
              this.syncBossEncounterFromEntity(world, sourceEntity, targetPlayerId, true, now);
            }
          }
        }

        targetRt.lastEnemyAttackAtBySource[sourceId] = now;
        targetData.vitals.health = Math.max(0, targetData.vitals.health - damage);
        targetRt.lastDamageAtMs = now;
        if (targetData.vitals.health <= 0) {
          targetData.vitals.isDead = true;
          targetData.vitals.reviveAtMs = now + 2000;
        }
        targetData.updatedAt = now;
        targetPlayer.health = targetData.vitals.health;
        targetPlayer.maxHealth = targetData.vitals.maxHealth;
        targetPlayer.isDead = targetData.vitals.isDead;
        if (targetPlayer.state) {
          targetPlayer.state.health = targetData.vitals.health;
          targetPlayer.state.isDead = targetData.vitals.isDead;
        }
        this.touchRoomActivity(now);
        await this.flushDirtyLayers({
          room: true,
          playerKeys: [targetData.persistentKey],
        });
        this.broadcast<AuthoritativePlayerVitals>('PLAYER_VITALS', targetPlayerId, {
          playerId: targetPlayerId,
          networkEntityId:
            targetPlayer.networkEntityId ?? generateNetworkEntityId(targetPlayerId),
          health: targetData.vitals.health,
          maxHealth: targetData.vitals.maxHealth,
          isDead: targetData.vitals.isDead,
          reviveAtMs: targetData.vitals.reviveAtMs,
        });
        if (targetData.vitals.isDead) {
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'PLAYER_DIED',
            data: {
              playerId: targetPlayerId,
              killerId: sourceId,
              displayName: targetPlayer.displayName,
              x: targetData.position.x,
              y: targetData.position.y,
              z: targetData.position.z,
            },
          });
        }
        break;
      }

      case 'REPAIR_WEAPONS': {
        if (!msg.repairWeapons) return;
        if (this.roomLayer.status !== 'in-game') return;
        const pData = this.ensurePlayerDataForPlayer(session.playerId);
        const cost =
          this.roomLayer.gameMode.worldType === 'creative'
            ? 0
            : msg.repairWeapons.costCoins;
        if (pData.coins < cost) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'INSUFFICIENT_COINS',
            message: 'Not enough coins to repair weapons.',
          });
          return;
        }
        this.touchRoomActivity(now);
        this.grantProgression(session.playerId, 0, -cost, 'weapons_repaired');
        await this.flushDirtyLayers({
          room: true,
          playerKeys: [pData.persistentKey],
        });
        break;
      }

      case 'KICK_PLAYER': {
        if (this.roomLayer.hostPlayerId !== session.playerId) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'FORBIDDEN_HOST_ONLY',
            message: 'Only the host can kick players.',
          });
          return;
        }
        if (!msg.targetPlayerId || !this.roomLayer.players[msg.targetPlayerId]) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'PLAYER_NOT_FOUND',
            message: 'Target player is no longer in this room.',
          });
          return;
        }
        await this.handleKickPlayer(session.playerId, msg.targetPlayerId);
        break;
      }

      case 'TRANSFER_HOST': {
        if (this.roomLayer.hostPlayerId !== session.playerId) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'FORBIDDEN_HOST_ONLY',
            message: 'Only the host can transfer host ownership.',
          });
          return;
        }
        if (!msg.targetPlayerId || !this.roomLayer.players[msg.targetPlayerId]) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'PLAYER_NOT_FOUND',
            message: 'Target player is no longer in this room.',
          });
          return;
        }
        await this.handleTransferHost(session.playerId, msg.targetPlayerId);
        break;
      }

      case 'CLOSE_ROOM': {
        if (this.roomLayer.hostPlayerId !== session.playerId) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'FORBIDDEN_HOST_ONLY',
            message: 'Only the host can close the room.',
          });
          return;
        }
        await this.handleCloseRoom(session.playerId);
        break;
      }

      case 'PARTY_CREATE': {
        const pl = this.ensurePartyLayer();
        if (pl.playerPartyById[session.playerId]) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'ALREADY_IN_PARTY',
            message: 'You are already in a party.',
          });
          return;
        }
        const partyId = this.generateSecurePartyId();
        const leaderMember = this.makePartyMemberRecord(session.playerId, 0, now, true);
        const party: PartyRecord = {
          partyId,
          roomId: this.roomLayer.roomId,
          leaderPlayerId: session.playerId,
          members: [leaderMember],
          maxMembers: this.roomLayer.maxPlayers,
          createdAt: now,
          activeObjective: null,
        };
        pl.parties[partyId] = party;
        pl.playerPartyById[session.playerId] = partyId;
        this.dirtyParty = true;
        this.touchRoomActivity(now);
        await this.flushDirtyLayers({ room: true, party: true });
        this.sendPartyStatesToRoom();
        this.broadcastRoomState();
        break;
      }

      case 'PARTY_INVITE': {
        if (!msg.partyInvite) return;
        const pl = this.ensurePartyLayer();
        const callerPartyId = pl.playerPartyById[session.playerId];
        let party = callerPartyId ? pl.parties[callerPartyId] : undefined;
        if (!party) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'NOT_IN_PARTY',
            message: 'Create a party before sending party invitations.',
          });
          return;
        }
        if (party.leaderPlayerId !== session.playerId) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'FORBIDDEN_PARTY_LEADER',
            message: 'Only the party leader can invite players.',
          });
          return;
        }

        const maxAllowed = Math.min(party.maxMembers, this.roomLayer.maxPlayers);
        if (party.members.length >= maxAllowed) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'PARTY_FULL',
            message: 'Your party is already at the room player limit.',
          });
          return;
        }

        const allRoomPlayers = Object.values(this.roomLayer.players);
        let target: NetworkPlayerRecord | undefined;
        if (msg.partyInvite.targetPlayerId) {
          target = this.roomLayer.players[msg.partyInvite.targetPlayerId];
        }
        if (!target && msg.partyInvite.targetPublicProfileId) {
          const wantProfile = msg.partyInvite.targetPublicProfileId.toUpperCase();
          target = allRoomPlayers.find(
            (p) => p.publicProfileId?.toUpperCase() === wantProfile,
          );
        }
        if (!target && msg.partyInvite.targetPlayerName) {
          const wantName = msg.partyInvite.targetPlayerName.toLowerCase();
          target = allRoomPlayers.find(
            (p) => p.displayName.toLowerCase() === wantName,
          );
        }

        if (!target) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'PLAYER_NOT_FOUND',
            message: 'Player is not currently in this room.',
          });
          return;
        }
        if (target.playerId === session.playerId) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'CANNOT_INVITE_SELF',
            message: 'You cannot invite yourself to the party.',
          });
          return;
        }
        if (pl.playerPartyById[target.playerId]) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'TARGET_ALREADY_IN_PARTY',
            message: `${target.displayName} is already in a party.`,
          });
          return;
        }

        const duplicatePending = Object.values(pl.invites).find(
          (inv) =>
            inv.status === 'pending' &&
            inv.partyId === party!.partyId &&
            inv.toPlayerId === target!.playerId,
        );
        if (duplicatePending) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'DUPLICATE_PARTY_INVITE',
            message: `An invitation is already pending for ${target.displayName}.`,
          });
          return;
        }

        const invite: PartyInviteRecord = {
          inviteId: this.generateSecurePartyInviteId(),
          partyId: party.partyId,
          roomId: this.roomLayer.roomId,
          fromPlayerId: session.playerId,
          fromPlayerName: player.displayName,
          ...(player.playerTag ? { fromPlayerTag: player.playerTag } : {}),
          toPlayerId: target.playerId,
          ...(target.publicProfileId ? { toPublicProfileId: target.publicProfileId } : {}),
          toPlayerName: target.displayName,
          createdAt: now,
          status: 'pending',
        };
        pl.invites[invite.inviteId] = invite;
        this.dirtyParty = true;
        this.touchRoomActivity(now);
        await this.flushDirtyLayers({ room: true, party: true });
        this.sendToPlayer<PartyInviteRecord>(
          target.playerId,
          'PARTY_INVITE_RECEIVED',
          invite,
        );
        this.sendPartyStatesToRoom([session.playerId, target.playerId]);
        break;
      }

      case 'PARTY_ACCEPT_INVITE': {
        if (!msg.partyInviteResponse) return;
        const pl = this.ensurePartyLayer();
        const invite = pl.invites[msg.partyInviteResponse.inviteId];
        if (!invite || invite.status !== 'pending' || invite.toPlayerId !== session.playerId) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'PARTY_INVITE_NOT_FOUND',
            message: 'Party invitation is missing or no longer pending.',
          });
          return;
        }
        if (pl.playerPartyById[session.playerId]) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'ALREADY_IN_PARTY',
            message: 'Leave your current party before accepting another invitation.',
          });
          return;
        }
        const party = pl.parties[invite.partyId];
        if (!party) {
          delete pl.invites[invite.inviteId];
          this.dirtyParty = true;
          await this.flushDirtyLayers({ party: true });
          this.sendPartyStateToPlayer(session.playerId);
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'PARTY_NOT_FOUND',
            message: 'That party no longer exists.',
          });
          return;
        }
        const maxAllowed = Math.min(party.maxMembers, this.roomLayer.maxPlayers);
        if (party.members.length >= maxAllowed) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'PARTY_FULL',
            message: 'Cannot join party: maximum party size reached.',
          });
          return;
        }

        invite.status = 'accepted';
        const usedIdx = new Set(party.members.map((m) => m.markerIndex));
        let idx = 0;
        while (usedIdx.has(idx)) idx += 1;
        party.members.push(this.makePartyMemberRecord(session.playerId, idx, now, false));
        pl.playerPartyById[session.playerId] = party.partyId;

        for (const [id, otherInv] of Object.entries(pl.invites)) {
          if (
            otherInv.toPlayerId === session.playerId &&
            otherInv.partyId === party.partyId &&
            otherInv.status === 'pending'
          ) {
            delete pl.invites[id];
          }
        }
        delete pl.invites[invite.inviteId];

        this.syncPartyMemberLiveStats(party);
        this.dirtyParty = true;
        this.touchRoomActivity(now);
        await this.flushDirtyLayers({ room: true, party: true });
        this.sendPartyStatesToRoom();
        this.broadcastRoomState();
        break;
      }

      case 'PARTY_DECLINE_INVITE': {
        if (!msg.partyInviteResponse) return;
        const pl = this.ensurePartyLayer();
        const invite = pl.invites[msg.partyInviteResponse.inviteId];
        if (!invite || invite.status !== 'pending' || invite.toPlayerId !== session.playerId) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'PARTY_INVITE_NOT_FOUND',
            message: 'Party invitation is missing or already resolved.',
          });
          return;
        }
        invite.status = 'declined';
        delete pl.invites[invite.inviteId];
        this.dirtyParty = true;
        await this.flushDirtyLayers({ party: true });
        this.sendPartyStatesToRoom([session.playerId, invite.fromPlayerId]);
        break;
      }

      case 'PARTY_LEAVE': {
        const pl = this.ensurePartyLayer();
        if (!pl.playerPartyById[session.playerId]) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'NOT_IN_PARTY',
            message: 'You are not currently in a party.',
          });
          return;
        }
        const removal = this.removePlayerFromParty(session.playerId, 'left');
        this.touchRoomActivity(now);
        await this.flushDirtyLayers({ room: true, party: true });
        this.sendPartyStatesToRoom(removal.affectedPlayerIds);
        this.broadcastRoomState();
        break;
      }

      case 'PARTY_KICK': {
        if (!msg.targetPlayerId) return;
        const pl = this.ensurePartyLayer();
        const partyId = pl.playerPartyById[session.playerId];
        const party = partyId ? pl.parties[partyId] : undefined;
        if (!party) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'NOT_IN_PARTY',
            message: 'You are not in a party.',
          });
          return;
        }
        if (party.leaderPlayerId !== session.playerId) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'FORBIDDEN_PARTY_LEADER',
            message: 'Only the party leader can remove party members.',
          });
          return;
        }
        if (
          msg.targetPlayerId === session.playerId ||
          pl.playerPartyById[msg.targetPlayerId] !== partyId
        ) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'PLAYER_NOT_IN_PARTY',
            message: 'Target player is not a member of your party.',
          });
          return;
        }
        const removal = this.removePlayerFromParty(msg.targetPlayerId, 'kicked');
        this.touchRoomActivity(now);
        await this.flushDirtyLayers({ room: true, party: true });
        this.sendPartyStatesToRoom(removal.affectedPlayerIds);
        this.broadcastRoomState();
        break;
      }

      case 'PARTY_TRANSFER_LEADER': {
        if (!msg.targetPlayerId) return;
        const pl = this.ensurePartyLayer();
        const partyId = pl.playerPartyById[session.playerId];
        const party = partyId ? pl.parties[partyId] : undefined;
        if (!party) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'NOT_IN_PARTY',
            message: 'You are not in a party.',
          });
          return;
        }
        if (party.leaderPlayerId !== session.playerId) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'FORBIDDEN_PARTY_LEADER',
            message: 'Only the party leader can transfer party leadership.',
          });
          return;
        }
        if (
          msg.targetPlayerId === session.playerId ||
          pl.playerPartyById[msg.targetPlayerId] !== partyId
        ) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'PLAYER_NOT_IN_PARTY',
            message: 'Target player must be another member of your party.',
          });
          return;
        }
        party.leaderPlayerId = msg.targetPlayerId;
        const newLeaderMember = party.members.find((m) => m.playerId === msg.targetPlayerId);
        if (newLeaderMember) {
          newLeaderMember.isReady = true;
        }
        this.syncPartyMemberLiveStats(party);
        this.dirtyParty = true;
        this.touchRoomActivity(now);
        await this.flushDirtyLayers({ room: true, party: true });
        this.sendPartyStatesToRoom(party.members.map((m) => m.playerId));
        break;
      }

      case 'PARTY_SET_READY': {
        const pl = this.ensurePartyLayer();
        const partyId = pl.playerPartyById[session.playerId];
        const party = partyId ? pl.parties[partyId] : undefined;
        if (!party) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'NOT_IN_PARTY',
            message: 'You are not in a party.',
          });
          return;
        }
        const member = party.members.find((m) => m.playerId === session.playerId);
        if (member) {
          member.isReady = Boolean(msg.ready);
          this.syncPartyMemberLiveStats(party);
          this.dirtyParty = true;
          await this.flushDirtyLayers({ party: true });
          this.sendPartyStatesToRoom(party.members.map((m) => m.playerId));
        }
        break;
      }

      case 'PARTY_START_OBJECTIVE': {
        if (!msg.partyObjectiveStart) return;
        const pl = this.ensurePartyLayer();
        const partyId = pl.playerPartyById[session.playerId];
        const party = partyId ? pl.parties[partyId] : undefined;
        if (!party) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'NOT_IN_PARTY',
            message: 'Create or join a party to start cooperative objectives.',
          });
          return;
        }
        if (party.leaderPlayerId !== session.playerId) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'FORBIDDEN_PARTY_LEADER',
            message: 'Only the party leader can start cooperative activities.',
          });
          return;
        }
        const obj = this.buildDefaultCoopObjective(
          msg.partyObjectiveStart.type,
          party,
          session.playerId,
          msg.partyObjectiveStart,
          now,
        );
        party.activeObjective = obj;
        this.dirtyParty = true;
        this.touchRoomActivity(now);
        await this.flushDirtyLayers({ room: true, party: true });
        const objSnap = structuredClone(obj);
        for (const member of party.members) {
          this.sendToPlayer<CoopObjectiveState>(
            member.playerId,
            'PARTY_OBJECTIVE_UPDATED',
            objSnap,
          );
          this.sendPartyStateToPlayer(member.playerId);
        }
        break;
      }

      case 'PARTY_CANCEL_OBJECTIVE': {
        const pl = this.ensurePartyLayer();
        const partyId = pl.playerPartyById[session.playerId];
        const party = partyId ? pl.parties[partyId] : undefined;
        if (!party) return;
        if (party.leaderPlayerId !== session.playerId) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'FORBIDDEN_PARTY_LEADER',
            message: 'Only the party leader can cancel cooperative objectives.',
          });
          return;
        }
        if (party.activeObjective) {
          party.activeObjective = null;
          this.dirtyParty = true;
          await this.flushDirtyLayers({ party: true });
          this.sendPartyStatesToRoom(party.members.map((m) => m.playerId));
        }
        break;
      }

      case 'COOP_QUEST_START': {
        if (!msg.coopQuestAction) return;
        const { questId, objectiveId, title } = msg.coopQuestAction;
        const spec = QUEST_SERVER_REWARDS[questId];
        if (!spec || spec.scope !== 'cooperative') {
          this.securityLogger.record({
            category: 'XP_TAMPER',
            code: !spec ? 'UNKNOWN_COOP_QUEST' : 'NOT_COOP_QUEST',
            severity: 'medium',
            roomId: this.roomLayer.roomId,
            playerId: session.playerId,
            detail: questId,
          });
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: !spec ? 'UNKNOWN_COOP_QUEST' : 'NOT_COOP_QUEST',
            message: !spec
              ? 'Unknown cooperative quest.'
              : 'Personal quests cannot be started as cooperative quests.',
          });
          return;
        }
        const world = this.ensureWorldLayer();
        if (!world.coopQuests) world.coopQuests = {};
        const pl = this.ensurePartyLayer();
        const callerPartyId = pl.playerPartyById[session.playerId] ?? null;
        const cqKey = callerPartyId ? `${callerPartyId}:${questId}` : `room:${questId}`;
        const existing = world.coopQuests[cqKey];
        if (existing && existing.status === 'active') {
          this.sendToPlayer<CoopQuestStateRecord>(
            session.playerId,
            'COOP_QUEST_UPDATED',
            structuredClone(existing),
          );
          break;
        }

        const resolvedTargetCount = spec.requiredCount ?? 5;
        const resolvedEnemyType = spec.targetEnemyType ?? 'ancient_monster';
        const resolvedTitle =
          title ??
          (questId === 'quest-coop-ancient-monster'
            ? 'Defeat the Ancient Monster'
            : questId === 'quest-coop-ancient-guardian'
              ? 'Fell the Ancient Guardian'
              : questId);

        const nextCq: CoopQuestStateRecord = {
          questId,
          partyId: callerPartyId,
          objectiveId: objectiveId ?? `${questId}-obj-1`,
          title: resolvedTitle,
          status: 'active',
          progress: 0,
          targetCount: resolvedTargetCount,
          targetEnemyType: resolvedEnemyType,
          startedByPlayerId: session.playerId,
          startedAtMs: now,
          completedAtMs: null,
          cycle: (existing?.cycle ?? 0) + 1,
          contributors: {},
          completedByPlayerIds: [],
        };
        world.coopQuests[cqKey] = nextCq;
        this.dirtyWorld = true;
        this.touchRoomActivity(now);

        const recipients = this.getAuthorizedPlayerIdsForCoopQuest(nextCq);
        const updatedKeys: string[] = [];
        for (const pid of recipients) {
          const pk = this.ensurePlayerDataForPlayer(pid);
          pk.quests[questId] = {
            questId,
            status: 'active',
            stepIndex: 0,
            updatedBy: session.playerId,
            updatedAtMs: now,
          };
          pk.updatedAt = now;
          updatedKeys.push(pk.persistentKey);
        }
        await this.flushDirtyLayers({
          room: true,
          world: true,
          playerKeys: updatedKeys,
        });
        const snap = structuredClone(nextCq);
        for (const pid of recipients) {
          this.sendToPlayer<CoopQuestStateRecord>(pid, 'COOP_QUEST_UPDATED', snap);
        }
        break;
      }

      case 'COOP_QUEST_COMPLETE': {
        if (!msg.coopQuestAction) return;
        const { questId } = msg.coopQuestAction;
        const world = this.ensureWorldLayer();
        if (!world.coopQuests) return;
        const callerPartyId = this.partyLayer?.playerPartyById[session.playerId] ?? null;
        const cqKey = callerPartyId ? `${callerPartyId}:${questId}` : `room:${questId}`;
        const cq = world.coopQuests[cqKey];
        if (!cq || !this.isAuthorizedForCoopQuest(session.playerId, cq)) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'COOP_QUEST_NOT_FOUND',
            message: 'Cooperative quest not active for your party/room.',
          });
          return;
        }
        if (cq.progress < cq.targetCount && cq.status !== 'completed') {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'COOP_QUEST_INCOMPLETE',
            message: 'Cooperative quest objective is not complete yet.',
          });
          return;
        }
        cq.status = 'completed';
        cq.completedAtMs = cq.completedAtMs ?? now;
        const recipients = this.getAuthorizedPlayerIdsForCoopQuest(cq);
        const updatedKeys: string[] = [];
        for (const pid of recipients) {
          await this.grantCoopQuestPersonalRewardForMember(cq, pid, now);
          updatedKeys.push(this.resolvePersistentKeyForPlayerId(pid));
        }
        await this.flushDirtyLayers({
          room: true,
          world: true,
          playerKeys: updatedKeys,
        });
        const snap = structuredClone(cq);
        for (const pid of recipients) {
          this.sendToPlayer<CoopQuestStateRecord>(pid, 'COOP_QUEST_UPDATED', snap);
        }
        break;
      }

      case 'ROOM_CHAT': {
        if (!msg.chatMessage) return;

        if (
          session.lastChatSentAtMs > 0 &&
          now - session.lastChatSentAtMs < CHAT_RATE_COOLDOWN_MS
        ) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'CHAT_SPAM_LIMITED',
            message: 'You are sending messages too quickly. Please wait a moment.',
          });
          return;
        }

        const normalized = msg.chatMessage.toLowerCase();
        if (
          normalized === session.lastChatNormalized &&
          now - session.lastChatSentAtMs < 12_000
        ) {
          session.duplicateChatStreak += 1;
          if (session.duplicateChatStreak >= 2) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'CHAT_DUPLICATE_SPAM',
              message: 'Repeated duplicate messages are blocked by anti-spam.',
            });
            return;
          }
        } else {
          session.duplicateChatStreak = 1;
          session.lastChatNormalized = normalized;
        }
        session.lastChatSentAtMs = now;

        this.chatSeq += 1;
        const chatEntry: RoomChatMessage = {
          id: `chat_${now}_${this.chatSeq}`,
          playerId: session.playerId,
          ...(player.publicProfileId ? { publicProfileId: player.publicProfileId } : {}),
          playerName: player.displayName,
          ...(player.playerTag ? { playerTag: player.playerTag } : {}),
          ...(player.avatar ? { avatar: player.avatar } : {}),
          message: msg.chatMessage,
          timestamp: now,
        };

        const cl = this.ensureChatLayer();
        cl.chatMessages.push(chatEntry);
        if (cl.chatMessages.length > CHAT_HISTORY_LIMIT) {
          cl.chatMessages = cl.chatMessages.slice(-CHAT_HISTORY_LIMIT);
        }
        this.touchRoomActivity(now);
        await this.flushDirtyLayers({ room: true, chat: true });
        this.broadcast<RoomChatMessage>('ROOM_CHAT', session.playerId, chatEntry);
        break;
      }

      case 'PLAYER_REPORT': {
        if (!msg.playerReport) return;
        const { targetPlayerId, reason, details } = msg.playerReport;
        const targetPlayer = this.roomLayer.players[targetPlayerId];
        if (!targetPlayer) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'PLAYER_NOT_FOUND',
            message: 'Reported player is not in this room.',
          });
          return;
        }
        if (session.reportedTargets.has(targetPlayerId)) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'REPORT_ALREADY_SUBMITTED',
            message: 'You have already reported this player in this room.',
          });
          return;
        }
        session.reportedTargets.add(targetPlayerId);
        this.reportSeq += 1;
        const reportId = `rep_${now}_${this.reportSeq}`;
        const cl = this.ensureChatLayer();
        cl.reports.push({
          reportId,
          targetPlayerId,
          targetDisplayName: targetPlayer.displayName,
          reporterPlayerId: session.playerId,
          reason,
          ...(details ? { details } : {}),
          timestamp: now,
        });
        if (cl.reports.length > 40) {
          cl.reports = cl.reports.slice(-40);
        }
        await this.flushDirtyLayers({ chat: true });
        this.sendToSocket<ReportAckPayload>(session.ws, 'REPORT_ACK', session.playerId, {
          reportId,
          targetPlayerId,
          reason,
          timestamp: now,
        });
        break;
      }

      case 'PLAYER_STATE': {
        if (!msg.playerState) return;
        if (this.roomLayer.status !== 'in-game') {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'GAME_NOT_STARTED',
            message: 'Player movement updates are only accepted after the game starts.',
          });
          return;
        }
        const pData = this.ensurePlayerDataForPlayer(session.playerId);
        const rt = this.ensureRuntimeForPlayer(session.playerId);
        const netEntId =
          player.networkEntityId ?? generateNetworkEntityId(session.playerId);

        if (pData.vitals.isDead) {
          this.sendToSocket<AuthoritativePlayerVitals>(
            session.ws,
            'PLAYER_VITALS',
            session.playerId,
            {
              playerId: session.playerId,
              networkEntityId: netEntId,
              health: pData.vitals.health,
              maxHealth: pData.vitals.maxHealth,
              isDead: pData.vitals.isDead,
              reviveAtMs: pData.vitals.reviveAtMs,
            },
          );
          return;
        }

        if (rt.lastStateAtMs > 0) {
          const dtSec = Math.max(0.005, Math.min(5, (now - rt.lastStateAtMs) / 1000));
          const horizDist = Math.hypot(
            msg.playerState.x - pData.position.x,
            msg.playerState.z - pData.position.z,
          );
          const vertDist = Math.abs(msg.playerState.y - pData.position.y);
          rt.movementJitterM = Math.min(
            MAX_MOVEMENT_JITTER_M,
            rt.movementJitterM + dtSec * 2.5,
          );
          // Bounded latency-adaptive tolerance for mobile networks and packet jitter
          const rttSec = Math.max(0, Math.min(0.5, (player.pingMs ?? 0) / 1000));
          const latencyGraceM = rttSec * 8;
          const baseAllowedHoriz = MAX_PLAYER_SPEED_MPS * dtSec + latencyGraceM;
          const horizExcess = Math.max(0, horizDist - baseAllowedHoriz);
          const maxAllowedVert = 36 * dtSec + 8;

          if (horizExcess > rt.movementJitterM || vertDist > maxAllowedVert) {
            this.securityLogger.record({
              category: 'MOVEMENT_ANOMALY',
              code: 'INVALID_POSITION_DELTA',
              severity: horizDist > 120 ? 'high' : 'low',
              roomId: this.roomLayer.roomId,
              playerId: session.playerId,
            });
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'INVALID_POSITION_DELTA',
              message: 'Position update rejected: movement delta exceeds server limit.',
            });
            this.sendToSocket<PositionCorrectionPayload>(
              session.ws,
              'POSITION_CORRECTION',
              session.playerId,
              {
                x: pData.position.x,
                y: pData.position.y,
                z: pData.position.z,
                yaw: player.state?.yaw ?? msg.playerState.yaw,
                seq: msg.playerState.seq,
                reason: 'INVALID_POSITION_DELTA',
              },
            );
            return;
          }
          rt.movementJitterM = Math.max(0, rt.movementJitterM - horizExcess);
        }

        if (
          msg.playerState.weaponId !== undefined &&
          msg.playerState.weaponId !== null &&
          this.roomLayer.gameMode.worldType !== 'creative' &&
          !pData.inventory.inventoryItemIds.includes(msg.playerState.weaponId)
        ) {
          this.securityLogger.record({
            category: 'INVENTORY_TAMPER',
            code: 'EQUIP_UNOWNED_WEAPON',
            severity: 'high',
            roomId: this.roomLayer.roomId,
            playerId: session.playerId,
            detail: msg.playerState.weaponId,
          });
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'WEAPON_NOT_OWNED',
            message: 'Player does not own this weapon.',
          });
          return;
        }

        const prevWeaponId = player.state?.weaponId ?? null;
        pData.position = {
          x: msg.playerState.x,
          y: msg.playerState.y,
          z: msg.playerState.z,
          yaw: msg.playerState.yaw,
        };
        pData.updatedAt = now;
        rt.lastStateAtMs = now;
        if (msg.playerState.weaponId !== undefined) {
          pData.weapons.equippedWeaponId = msg.playerState.weaponId;
        }

        const relayedState: PlayerNetworkState = {
          ...msg.playerState,
          networkEntityId: netEntId,
          health: pData.vitals.health,
          maxHealth: pData.vitals.maxHealth,
          isDead: pData.vitals.isDead,
          serverTime: now,
        };
        player.networkEntityId = netEntId;
        player.health = pData.vitals.health;
        player.maxHealth = pData.vitals.maxHealth;
        player.isDead = pData.vitals.isDead;
        player.state = relayedState;

        const world = this.ensureWorldLayer();
        world.tick += 1;
        this.touchRoomActivity(now);
        this.dirtyPlayerKeys.add(pData.persistentKey);
        this.dirtyWorld = true;
        await this.maybePeriodicFlush(now);

        // Spatial relevance (AOI) filtering:
        // Players within 160m receive full-rate high-frequency updates;
        // Distant players (> 160m) receive 1 Hz low-frequency map/presence updates
        // unless an urgent combat/action edge occurs.
        const isUrgentState = Boolean(
          relayedState.shooting ||
            relayedState.animState ||
            relayedState.jumping ||
            relayedState.isDead ||
            (relayedState.weaponId ?? null) !== prevWeaponId,
        );
        const aoiRadiusSq = 160 * 160;
        for (const [sock, targetSess] of this.sessions) {
          if (sock === session.ws) continue;
          const targetState = this.roomLayer.players[targetSess.playerId]?.state;
          let withinAoi = true;
          if (targetState) {
            const dx = pData.position.x - targetState.x;
            const dz = pData.position.z - targetState.z;
            withinAoi = dx * dx + dz * dz <= aoiRadiusSq;
          }
          if (withinAoi || isUrgentState) {
            this.sendToSocket(sock, 'PLAYER_STATE', session.playerId, relayedState);
          } else {
            const pairKey = `${targetSess.playerId}:${session.playerId}`;
            const lastAt = this.lastDistantPlayerRelayAt.get(pairKey) ?? 0;
            if (now - lastAt >= 1000) {
              this.lastDistantPlayerRelayAt.set(pairKey, now);
              this.sendToSocket(sock, 'PLAYER_STATE', session.playerId, relayedState);
            }
          }
        }

        const activePartyId = this.partyLayer?.playerPartyById[session.playerId];
        const activeParty = activePartyId ? this.partyLayer?.parties[activePartyId] : undefined;
        const activeObj = activeParty?.activeObjective;
        if (
          activeParty &&
          activeObj &&
          activeObj.status === 'active' &&
          (activeObj.type === 'explore_location' || activeObj.type === 'escort_npc') &&
          activeObj.targetX !== undefined &&
          activeObj.targetZ !== undefined
        ) {
          const radius = activeObj.targetRadius ?? 16;
          if (
            Math.hypot(
              pData.position.x - activeObj.targetX,
              pData.position.z - activeObj.targetZ,
            ) <= radius
          ) {
            await this.recordCoopObjectiveProgress(activeParty.partyId, session.playerId, 1, now);
          }
        }
        break;
      }

      case 'ENTITY_SYNC': {
        if (!msg.entitySync) return;
        if (this.roomLayer.status !== 'in-game') return;
        if (this.roomLayer.hostPlayerId !== session.playerId) {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'FORBIDDEN_HOST_ONLY',
            message: 'Only the room host can synchronize world entity movement.',
          });
          return;
        }

        const world = this.ensureWorldLayer();
        this.touchRoomActivity(now);

        const relayedEntities = [];
        for (const delta of msg.entitySync.entities) {
          const capMaxHp = this.resolveEntityMaxHp(delta.kind, delta.archetype);
          const bucket = this.getEntityMapByKind(world, delta.kind);
          let tracked = bucket[delta.id];
          const isBoss = this.isBossArchetypeOrFlag(
            delta.kind,
            delta.archetype,
            delta.isBoss,
          );
          if (!tracked) {
            const initMaxHp =
              typeof delta.maxHp === 'number'
                ? Math.max(1, Math.min(capMaxHp, delta.maxHp))
                : capMaxHp;
            const initHp =
              typeof delta.hp === 'number'
                ? Math.max(0, Math.min(initMaxHp, delta.hp))
                : initMaxHp;
            tracked = {
              id: delta.id,
              kind: delta.kind,
              archetype: delta.archetype,
              maxHp: initMaxHp,
              hp: delta.isDead ? 0 : initHp,
              isDead: Boolean(delta.isDead || initHp <= 0),
              diedAtMs: delta.isDead ? now : 0,
              x: delta.x,
              y: delta.y,
              z: delta.z,
              yaw: delta.yaw,
              state: delta.state,
              lastUpdatedAtMs: now,
              killSeq: 0,
              damageByPlayer: {},
              ...(delta.targetPlayerId !== undefined ? { targetPlayerId: delta.targetPlayerId } : {}),
              ...(isBoss ? { isBoss: true, bossPhase: delta.bossPhase ?? 1 } : {}),
              ...(delta.attackState !== undefined ? { attackState: delta.attackState } : {}),
              ...(delta.dialogueState !== undefined ? { dialogueState: delta.dialogueState } : {}),
              ...(delta.dialoguePlayerId !== undefined ? { dialoguePlayerId: delta.dialoguePlayerId } : {}),
              ...(delta.questState !== undefined ? { questState: delta.questState } : {}),
              ...(delta.schedulePeriod !== undefined ? { schedulePeriod: delta.schedulePeriod } : {}),
              ...(delta.worldId !== undefined ? { worldId: delta.worldId } : {}),
              ...(delta.chunkId !== undefined ? { chunkId: delta.chunkId } : {}),
              alive: !Boolean(delta.isDead || initHp <= 0),
              ...(delta.loaded !== undefined ? { loaded: delta.loaded } : {}),
              ...(delta.questTarget !== undefined ? { questTarget: delta.questTarget } : {}),
            };
            bucket[delta.id] = tracked;
          } else {
            tracked.x = delta.x;
            tracked.y = delta.y;
            tracked.z = delta.z;
            tracked.yaw = delta.yaw;
            tracked.state = delta.state;
            tracked.lastUpdatedAtMs = now;
            if (delta.worldId !== undefined) tracked.worldId = delta.worldId;
            if (delta.chunkId !== undefined) tracked.chunkId = delta.chunkId;
            if (delta.loaded !== undefined) tracked.loaded = delta.loaded;
            if (delta.questTarget !== undefined) {
              tracked.questTarget = tracked.isDead
                ? { ...delta.questTarget, lifecycle: 'DEFEATED' }
                : delta.questTarget;
            }
            if (delta.targetPlayerId !== undefined) {
              tracked.targetPlayerId = delta.targetPlayerId;
            } else if (delta.kind === 'enemy' && delta.state === 'patrol') {
              tracked.targetPlayerId = null;
            }
            if (isBoss) {
              tracked.isBoss = true;
              if (delta.attackState !== undefined) tracked.attackState = delta.attackState;
            }
            if (delta.kind === 'npc') {
              if (delta.dialogueState !== undefined) tracked.dialogueState = delta.dialogueState;
              if (delta.dialoguePlayerId !== undefined) tracked.dialoguePlayerId = delta.dialoguePlayerId;
              if (delta.questState !== undefined) tracked.questState = delta.questState;
              if (delta.schedulePeriod !== undefined) tracked.schedulePeriod = delta.schedulePeriod;
            }
            if (
              delta.kind === 'enemy' &&
              tracked.isDead &&
              delta.isDead === false &&
              now - tracked.diedAtMs >= 20_000
            ) {
              tracked.isDead = false;
              tracked.hp = tracked.maxHp;
              tracked.diedAtMs = 0;
              tracked.damageByPlayer = {};
            }
          }

          tracked.alive = !tracked.isDead;
          if (tracked.isDead && tracked.questTarget) {
            tracked.questTarget = { ...tracked.questTarget, lifecycle: 'DEFEATED' };
          }

          if (isBoss) {
            this.syncBossEncounterFromEntity(
              world,
              tracked,
              tracked.targetPlayerId ?? null,
              true,
              now,
            );
          }

          relayedEntities.push({
            ...delta,
            hp: tracked.hp,
            maxHp: tracked.maxHp,
            isDead: tracked.isDead,
            alive: !tracked.isDead,
            loaded: tracked.loaded ?? true,
            ...(tracked.worldId ? { worldId: tracked.worldId } : {}),
            ...(tracked.chunkId ? { chunkId: tracked.chunkId } : {}),
            ...(tracked.questTarget ? { questTarget: tracked.questTarget } : {}),
            ...(tracked.isBoss ? { isBoss: true, bossPhase: tracked.bossPhase ?? 1 } : {}),
            ...(tracked.targetPlayerId ? { targetPlayerId: tracked.targetPlayerId } : {}),
            ...(tracked.attackState ? { attackState: tracked.attackState } : {}),
            ...(tracked.dialogueState ? { dialogueState: tracked.dialogueState } : {}),
            ...(tracked.dialoguePlayerId ? { dialoguePlayerId: tracked.dialoguePlayerId } : {}),
            ...(tracked.questState ? { questState: tracked.questState } : {}),
            ...(tracked.schedulePeriod ? { schedulePeriod: tracked.schedulePeriod } : {}),
          });
        }

        this.dirtyWorld = true;
        await this.maybePeriodicFlush(now);

        const worldTime = this.materializeWorldTime(now);
        const worldWeather = this.materializeWorldWeather(now);
        const entityAoiSq = 150 * 150;
        for (const [sock, targetSess] of this.sessions) {
          if (sock === session.ws) continue;
          const targetState = this.roomLayer.players[targetSess.playerId]?.state;
          const relevantEntities = targetState
            ? relayedEntities.filter((ent) => {
                if (ent.isBoss || ent.isDead || ent.questTarget) return true;
                const dx = ent.x - targetState.x;
                const dz = ent.z - targetState.z;
                return dx * dx + dz * dz <= entityAoiSq;
              })
            : relayedEntities;
          const lastHb = this.lastEntityTimeHeartbeatAt.get(targetSess.playerId) ?? 0;
          if (relevantEntities.length > 0 || now - lastHb >= 2000) {
            this.lastEntityTimeHeartbeatAt.set(targetSess.playerId, now);
            this.sendToSocket(sock, 'ENTITY_SYNC', session.playerId, {
              entities: relevantEntities,
              worldHours: worldTime.worldHours,
              weather: worldWeather.currentState,
            });
          }
        }
        break;
      }

      case 'GAME_EVENT': {
        if (!msg.gameEvent) return;
        if (this.roomLayer.status !== 'in-game') {
          this.sendToSocket(session.ws, 'ERROR', session.playerId, {
            code: 'GAME_NOT_STARTED',
            message: 'Gameplay events are only accepted after the game starts.',
          });
          return;
        }
        const pData = this.ensurePlayerDataForPlayer(session.playerId);
        const rt = this.ensureRuntimeForPlayer(session.playerId);
        const netEntId =
          player.networkEntityId ?? generateNetworkEntityId(session.playerId);
        const eventName = msg.gameEvent.event;
        const eventData = msg.gameEvent.data ?? {};
        const world = this.ensureWorldLayer();
        world.tick += 1;

        if (eventName === 'player:damage-taken') {
          if (this.roomLayer.gameMode.worldType === 'creative' || pData.vitals.isDead) {
            return;
          }
          if (now - rt.lastDamageAtMs < 240) {
            return;
          }
          const rawAmount =
            typeof eventData.amount === 'number' && Number.isFinite(eventData.amount)
              ? eventData.amount
              : 0;
          const clampedDamage = Math.max(1, Math.min(55, Math.round(rawAmount)));
          pData.vitals.health = Math.max(0, pData.vitals.health - clampedDamage);
          rt.lastDamageAtMs = now;
          if (pData.vitals.health <= 0) {
            pData.vitals.isDead = true;
            pData.vitals.reviveAtMs = now + 2000;
          }
          pData.updatedAt = now;
          player.health = pData.vitals.health;
          player.maxHealth = pData.vitals.maxHealth;
          player.isDead = pData.vitals.isDead;
          if (player.state) {
            player.state.health = pData.vitals.health;
            player.state.isDead = pData.vitals.isDead;
          }
          await this.flushDirtyLayers({
            room: true,
            playerKeys: [pData.persistentKey],
          });
          this.broadcast<AuthoritativePlayerVitals>('PLAYER_VITALS', session.playerId, {
            playerId: session.playerId,
            networkEntityId: netEntId,
            health: pData.vitals.health,
            maxHealth: pData.vitals.maxHealth,
            isDead: pData.vitals.isDead,
            reviveAtMs: pData.vitals.reviveAtMs,
          });
          if (pData.vitals.isDead) {
            this.broadcast('GAME_EVENT', session.playerId, {
              event: 'PLAYER_DIED',
              data: {
                playerId: session.playerId,
                displayName: player.displayName,
                x: pData.position.x,
                y: pData.position.y,
                z: pData.position.z,
              },
            });
          }
          break;
        }

        if (eventName === 'player:respawn') {
          const spawnX = world.worldSettings.spawnX ?? 0;
          const spawnY = world.worldSettings.spawnY ?? 0;
          const spawnZ = world.worldSettings.spawnZ ?? 4;
          pData.vitals.health = pData.vitals.maxHealth;
          pData.vitals.isDead = false;
          pData.vitals.reviveAtMs = null;
          pData.position = { x: spawnX, y: spawnY, z: spawnZ, yaw: pData.position.yaw };
          pData.updatedAt = now;
          rt.lastStateAtMs = now;
          player.health = pData.vitals.health;
          player.maxHealth = pData.vitals.maxHealth;
          player.isDead = false;
          if (player.state) {
            player.state.x = spawnX;
            player.state.y = spawnY;
            player.state.z = spawnZ;
            player.state.health = pData.vitals.health;
            player.state.isDead = false;
          }
          await this.flushDirtyLayers({
            room: true,
            playerKeys: [pData.persistentKey],
          });
          this.broadcast<AuthoritativePlayerVitals>('PLAYER_VITALS', session.playerId, {
            playerId: session.playerId,
            networkEntityId: netEntId,
            health: pData.vitals.health,
            maxHealth: pData.vitals.maxHealth,
            isDead: false,
            reviveAtMs: null,
          });
          this.sendToSocket<PositionCorrectionPayload>(
            session.ws,
            'POSITION_CORRECTION',
            session.playerId,
            {
              x: spawnX,
              y: spawnY,
              z: spawnZ,
              yaw: player.state?.yaw ?? 0,
              reason: 'RESPAWN',
            },
          );
          break;
        }

        if (eventName === 'player:attack' || eventName === 'player:shoot') {
          if (pData.vitals.isDead) return;
          if (!session.limiter.checkCombatEvent(now).allowed) {
            this.securityLogger.record({
              category: 'RATE_LIMIT_EXCEEDED',
              code: 'COMBAT_EVENT_RATE_LIMITED',
              severity: 'medium',
              roomId: this.roomLayer.roomId,
              playerId: session.playerId,
            });
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'RATE_LIMITED',
              message: 'Combat actions sent too quickly.',
            });
            return;
          }
          const weaponId =
            typeof eventData.weaponId === 'string' &&
            (ALLOWED_WEAPON_IDS.has(eventData.weaponId) ||
              (isAllowedMultiplayerWeaponId(eventData.weaponId) &&
                this.isActiveRoomModItem(eventData.weaponId)))
              ? eventData.weaponId
              : null;
          if (
            weaponId &&
            this.roomLayer.gameMode.worldType !== 'creative' &&
            !pData.inventory.inventoryItemIds.includes(weaponId)
          ) {
            this.securityLogger.record({
              category: 'INVENTORY_TAMPER',
              code: 'ATTACK_UNOWNED_WEAPON',
              severity: 'high',
              roomId: this.roomLayer.roomId,
              playerId: session.playerId,
              detail: weaponId,
            });
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'WEAPON_NOT_OWNED',
              message: 'Player does not own this weapon.',
            });
            return;
          }
          if (weaponId) {
            pData.weapons.equippedWeaponId = weaponId;
            pData.updatedAt = now;
            this.dirtyPlayerKeys.add(pData.persistentKey);
          }
          const animType =
            typeof eventData.animType === 'string' &&
            ALLOWED_ATTACK_ANIM_TYPES.has(eventData.animType)
              ? eventData.animType
              : eventName === 'player:shoot'
                ? 'bow_shot'
                : 'melee_slash';
          const bowCharge =
            typeof eventData.bowCharge === 'number' && Number.isFinite(eventData.bowCharge)
              ? Math.max(0, Math.min(1, Math.round(eventData.bowCharge * 100) / 100))
              : 1;
          const aimYaw =
            typeof eventData.aimYaw === 'number' && Number.isFinite(eventData.aimYaw)
              ? Math.round(eventData.aimYaw * 1000) / 1000
              : player.state?.aimYaw ?? player.state?.yaw ?? 0;
          const pitch =
            typeof eventData.pitch === 'number' && Number.isFinite(eventData.pitch)
              ? Math.round(eventData.pitch * 1000) / 1000
              : player.state?.pitch ?? 0;

          this.broadcast(
            'GAME_EVENT',
            session.playerId,
            {
              event: eventName,
              data: {
                weaponId,
                animType,
                bowCharge,
                aimYaw,
                pitch,
              },
            },
            session.ws,
          );
          break;
        }

        if (eventName === 'ARROW_FIRED') {
          if (pData.vitals.isDead) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'PLAYER_DEAD',
              message: 'Cannot fire arrows while downed.',
            });
            return;
          }
          if (!session.limiter.checkCombatEvent(now).allowed) {
            this.securityLogger.record({
              category: 'RATE_LIMIT_EXCEEDED',
              code: 'ARROW_FIRED_RATE_LIMITED',
              severity: 'medium',
              roomId: this.roomLayer.roomId,
              playerId: session.playerId,
            });
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'RATE_LIMITED',
              message: 'Combat actions sent too quickly.',
            });
            return;
          }
          const weaponId =
            typeof eventData.weaponId === 'string' ? eventData.weaponId : '';
          const spec = this.resolveCombatWeaponSpec(weaponId);
          if (!spec || !spec.isRanged) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'INVALID_WEAPON',
              message: 'Weapon cannot fire projectiles.',
            });
            return;
          }
          if (
            this.roomLayer.gameMode.worldType !== 'creative' &&
            !pData.inventory.inventoryItemIds.includes(weaponId)
          ) {
            this.securityLogger.record({
              category: 'COMBAT_ANOMALY',
              code: 'WEAPON_NOT_OWNED',
              severity: 'high',
              roomId: this.roomLayer.roomId,
              playerId: session.playerId,
              detail: weaponId,
            });
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'WEAPON_NOT_OWNED',
              message: 'Player does not own this ranged weapon.',
            });
            return;
          }
          if (now - rt.lastAttackAtMs < spec.cooldownMs * 0.72) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'WEAPON_COOLDOWN',
              message: 'Weapon is still on cooldown.',
            });
            return;
          }
          if (
            this.roomLayer.gameMode.worldType !== 'creative' &&
            pData.inventory.ammoCount <= 0
          ) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'NO_AMMO',
              message: 'Out of arrows.',
            });
            return;
          }

          const originX =
            typeof eventData.originX === 'number' && Number.isFinite(eventData.originX)
              ? eventData.originX
              : pData.position.x;
          const originY =
            typeof eventData.originY === 'number' && Number.isFinite(eventData.originY)
              ? eventData.originY
              : pData.position.y + 1.45;
          const originZ =
            typeof eventData.originZ === 'number' && Number.isFinite(eventData.originZ)
              ? eventData.originZ
              : pData.position.z;

          if (
            Math.hypot(originX - pData.position.x, originZ - pData.position.z) > 4.2 ||
            Math.abs(originY - (pData.position.y + 1.45)) > 3.5
          ) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'INVALID_ORIGIN',
              message: 'Arrow launch origin too far from player position.',
            });
            return;
          }

          const rawDirX = typeof eventData.dirX === 'number' ? eventData.dirX : 0;
          const rawDirY = typeof eventData.dirY === 'number' ? eventData.dirY : 0;
          const rawDirZ = typeof eventData.dirZ === 'number' ? eventData.dirZ : 1;
          const dirLen = Math.hypot(rawDirX, rawDirY, rawDirZ);
          if (
            !Number.isFinite(rawDirX) ||
            !Number.isFinite(rawDirY) ||
            !Number.isFinite(rawDirZ) ||
            dirLen < 0.5 ||
            dirLen > 1.5
          ) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'INVALID_DIRECTION',
              message: 'Projectile launch direction vector is invalid.',
            });
            return;
          }
          const dirX = Math.round((rawDirX / dirLen) * 1000) / 1000;
          const dirY = Math.round((rawDirY / dirLen) * 1000) / 1000;
          const dirZ = Math.round((rawDirZ / dirLen) * 1000) / 1000;

          const arrowId =
            typeof eventData.arrowId === 'string' && eventData.arrowId.length > 0
              ? eventData.arrowId.slice(0, 48)
              : `arr_${session.playerId}_${now}`;
          if (this.activeArrows.has(arrowId)) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'DUPLICATE_ARROW_ID',
              message: 'Arrow network ID already exists.',
            });
            return;
          }

          const charge =
            typeof eventData.bowCharge === 'number' && Number.isFinite(eventData.bowCharge)
              ? Math.max(0, Math.min(1, eventData.bowCharge))
              : 1;
          const speed =
            (spec.minSpeed ?? 15) +
            charge * ((spec.maxSpeed ?? 45) - (spec.minSpeed ?? 15));
          const gravity = spec.gravity ?? 9.8;

          rt.lastAttackAtMs = now;
          pData.weapons.equippedWeaponId = weaponId;
          if (this.roomLayer.gameMode.worldType !== 'creative') {
            pData.inventory.ammoCount = Math.max(0, pData.inventory.ammoCount - 1);
          }
          pData.updatedAt = now;
          this.dirtyPlayerKeys.add(pData.persistentKey);

          if (this.activeArrows.size > 160) {
            for (const [k, v] of this.activeArrows) {
              if (now - v.createdAtMs > 6000 || v.consumed) {
                this.activeArrows.delete(k);
              }
            }
          }

          this.activeArrows.set(arrowId, {
            arrowId,
            shooterId: session.playerId,
            weaponId,
            charge,
            originX,
            originY,
            originZ,
            dirX,
            dirY,
            dirZ,
            speed,
            gravity,
            createdAtMs: now,
            consumed: false,
          });

          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'ARROW_FIRED',
            data: {
              arrowId,
              shooterId: session.playerId,
              weaponId,
              originX,
              originY,
              originZ,
              dirX,
              dirY,
              dirZ,
              speed,
              gravity,
              bowCharge: charge,
              ammoCount: pData.inventory.ammoCount,
            },
          });
          break;
        }

        if (eventName === 'PROJECTILE_HIT') {
          if (pData.vitals.isDead) return;
          if (!session.limiter.checkCombatEvent(now).allowed) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'RATE_LIMITED',
              message: 'Combat actions sent too quickly.',
            });
            return;
          }
          const arrowId =
            typeof eventData.arrowId === 'string' ? eventData.arrowId : '';
          const arrow = this.activeArrows.get(arrowId);
          if (!arrow || arrow.consumed || arrow.shooterId !== session.playerId) {
            this.securityLogger.record({
              category: 'COMBAT_ANOMALY',
              code: 'INVALID_PROJECTILE',
              severity: 'medium',
              roomId: this.roomLayer.roomId,
              playerId: session.playerId,
            });
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'INVALID_PROJECTILE',
              message: 'Arrow does not exist or already resolved.',
            });
            return;
          }
          if (now - arrow.createdAtMs > 6500) {
            this.activeArrows.delete(arrowId);
            return;
          }

          const spec = SERVER_WEAPON_SPECS[arrow.weaponId];
          if (!spec) {
            this.activeArrows.delete(arrowId);
            return;
          }

          const hitX =
            typeof eventData.x === 'number' && Number.isFinite(eventData.x)
              ? eventData.x
              : arrow.originX;
          const hitY =
            typeof eventData.y === 'number' && Number.isFinite(eventData.y)
              ? eventData.y
              : arrow.originY;
          const hitZ =
            typeof eventData.z === 'number' && Number.isFinite(eventData.z)
              ? eventData.z
              : arrow.originZ;
          const flightDist = Math.hypot(
            hitX - arrow.originX,
            hitY - arrow.originY,
            hitZ - arrow.originZ,
          );
          if (flightDist > spec.range + 10) {
            this.securityLogger.record({
              category: 'COMBAT_ANOMALY',
              code: 'PROJECTILE_OUT_OF_RANGE',
              severity: 'medium',
              roomId: this.roomLayer.roomId,
              playerId: session.playerId,
            });
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'OUT_OF_RANGE',
              message: 'Projectile hit exceeds maximum weapon range.',
            });
            return;
          }

          if (flightDist > 2.0) {
            const tEst = flightDist / Math.max(8, arrow.speed);
            const dx = hitX - arrow.originX;
            const dy = hitY - arrow.originY + 0.5 * arrow.gravity * tEst * tEst;
            const dz = hitZ - arrow.originZ;
            const compLen = Math.hypot(dx, dy, dz) || 1;
            const dot =
              (dx / compLen) * arrow.dirX +
              (dy / compLen) * arrow.dirY +
              (dz / compLen) * arrow.dirZ;
            if (dot < 0.15) {
              arrow.consumed = true;
              this.activeArrows.delete(arrowId);
              this.securityLogger.record({
                category: 'COMBAT_ANOMALY',
                code: 'INVALID_PROJECTILE_TRAJECTORY',
                severity: 'high',
                roomId: this.roomLayer.roomId,
                playerId: session.playerId,
              });
              this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                code: 'INVALID_PROJECTILE_TRAJECTORY',
                message: 'Projectile impact point contradicts launch direction.',
              });
              return;
            }
          }

          arrow.consumed = true;
          this.activeArrows.delete(arrowId);

          const targetKind =
            typeof eventData.targetKind === 'string' ? eventData.targetKind : 'world';
          const targetId =
            typeof eventData.targetId === 'string' ? eventData.targetId : '';

          if (targetKind === 'world' || !targetId) {
            this.broadcast('GAME_EVENT', session.playerId, {
              event: 'PROJECTILE_HIT',
              data: {
                arrowId,
                shooterId: session.playerId,
                targetKind: 'world',
                targetId: '',
                x: hitX,
                y: hitY,
                z: hitZ,
                isHeadshot: false,
              },
            });
            break;
          }

          // Server-validate headshots geometrically rather than blindly trusting client flag
          let isHeadshot = false;
          if (Boolean(eventData.isHeadshot)) {
            let targetBaseY = 0;
            if (targetKind === 'player') {
              const targetPData = this.roomLayer.players[targetId]
                ? this.ensurePlayerDataForPlayer(targetId)
                : null;
              targetBaseY = targetPData?.position.y ?? 0;
            } else {
              const tracked = this.findEntityById(world, targetId);
              targetBaseY = tracked?.y ?? 0;
            }
            isHeadshot = hitY >= targetBaseY + 0.9;
          }

          const minD = spec.minDamage ?? spec.baseDamage;
          const maxD = spec.maxDamage ?? spec.baseDamage;
          const baseDmg = minD + arrow.charge * (maxD - minD);
          const damage = Math.max(
            1,
            Math.round(baseDmg * (isHeadshot ? (spec.headshotMult ?? 2.0) : 1)),
          );

          const applied = await this.applyAuthoritativeDamage(
            session.playerId,
            targetKind,
            targetId,
            typeof eventData.archetype === 'string' ? eventData.archetype : 'default',
            damage,
            isHeadshot,
            hitX,
            hitY,
            hitZ,
            now,
          );
          if (applied) {
            this.broadcast('GAME_EVENT', session.playerId, {
              event: 'PROJECTILE_HIT',
              data: {
                arrowId,
                shooterId: session.playerId,
                targetKind,
                targetId,
                x: hitX,
                y: hitY,
                z: hitZ,
                isHeadshot,
              },
            });
          }
          break;
        }

        if (eventName === 'COMBAT_HIT') {
          if (pData.vitals.isDead) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'PLAYER_DEAD',
              message: 'Downed players cannot attack.',
            });
            return;
          }
          if (!session.limiter.checkCombatEvent(now).allowed) {
            this.securityLogger.record({
              category: 'RATE_LIMIT_EXCEEDED',
              code: 'COMBAT_HIT_RATE_LIMITED',
              severity: 'medium',
              roomId: this.roomLayer.roomId,
              playerId: session.playerId,
            });
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'RATE_LIMITED',
              message: 'Combat actions sent too quickly.',
            });
            return;
          }
          const weaponId =
            typeof eventData.weaponId === 'string' && eventData.weaponId.length > 0
              ? eventData.weaponId
              : 'unarmed';
          const spec = this.resolveCombatWeaponSpec(weaponId);
          if (!spec || spec.isRanged) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'INVALID_WEAPON',
              message: 'Invalid melee weapon for COMBAT_HIT.',
            });
            return;
          }
          if (
            weaponId !== 'unarmed' &&
            this.roomLayer.gameMode.worldType !== 'creative' &&
            !pData.inventory.inventoryItemIds.includes(weaponId)
          ) {
            this.securityLogger.record({
              category: 'COMBAT_ANOMALY',
              code: 'WEAPON_NOT_OWNED',
              severity: 'high',
              roomId: this.roomLayer.roomId,
              playerId: session.playerId,
              detail: weaponId,
            });
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'WEAPON_NOT_OWNED',
              message: 'Player does not own this weapon.',
            });
            return;
          }
          const targetKind =
            typeof eventData.targetKind === 'string' ? eventData.targetKind : '';
          const targetId =
            typeof eventData.targetId === 'string' ? eventData.targetId : '';
          if (
            (targetKind !== 'enemy' &&
              targetKind !== 'animal' &&
              targetKind !== 'npc' &&
              targetKind !== 'player') ||
            !targetId
          ) {
            return;
          }

          const attackId =
            typeof eventData.attackId === 'string' && eventData.attackId.length > 0
              ? eventData.attackId.slice(0, 64)
              : null;
          const isSameSwingCleave = Boolean(
            attackId &&
              rt.lastSwingId === attackId &&
              rt.lastSwingWeaponId === weaponId &&
              now - rt.lastSwingAtMs <= 320 &&
              !rt.lastSwingTargetIds.includes(targetId) &&
              rt.lastSwingTargetIds.length < 4,
          );
          if (!isSameSwingCleave && now - rt.lastAttackAtMs < spec.cooldownMs * 0.65) {
            this.securityLogger.record({
              category: 'COMBAT_ANOMALY',
              code: 'WEAPON_COOLDOWN',
              severity: 'low',
              roomId: this.roomLayer.roomId,
              playerId: session.playerId,
            });
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'WEAPON_COOLDOWN',
              message: 'Attack speed exceeds weapon cooldown.',
            });
            return;
          }

          const hitX = typeof eventData.x === 'number' ? eventData.x : pData.position.x;
          const hitY = typeof eventData.y === 'number' ? eventData.y : pData.position.y;
          const hitZ = typeof eventData.z === 'number' ? eventData.z : pData.position.z;
          const distToTarget = Math.hypot(
            hitX - pData.position.x,
            hitZ - pData.position.z,
          );
          if (distToTarget > spec.range + 3.4) {
            this.securityLogger.record({
              category: 'COMBAT_ANOMALY',
              code: 'MELEE_OUT_OF_RANGE',
              severity: 'medium',
              roomId: this.roomLayer.roomId,
              playerId: session.playerId,
            });
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'OUT_OF_RANGE',
              message: 'Target is out of melee reach.',
            });
            return;
          }

          if (isSameSwingCleave) {
            rt.lastSwingTargetIds.push(targetId);
          } else {
            rt.lastAttackAtMs = now;
            rt.lastSwingId = attackId;
            rt.lastSwingWeaponId = weaponId;
            rt.lastSwingAtMs = now;
            rt.lastSwingTargetIds = [targetId];
          }
          pData.weapons.equippedWeaponId = weaponId === 'unarmed' ? null : weaponId;
          pData.updatedAt = now;
          this.dirtyPlayerKeys.add(pData.persistentKey);

          // Server-authoritative crit calculation (do not trust client isCrit spoofing)
          const isCrit = Math.random() < (spec.critChance ?? 0.1);
          const damage = Math.max(
            1,
            Math.round(spec.baseDamage * (isCrit ? spec.critMult : 1)),
          );

          await this.applyAuthoritativeDamage(
            session.playerId,
            targetKind,
            targetId,
            typeof eventData.archetype === 'string' ? eventData.archetype : 'default',
            damage,
            isCrit,
            hitX,
            hitY,
            hitZ,
            now,
          );
          break;
        }

        if (eventName === 'CHEST_OPENED') {
          if (pData.vitals.isDead) return;
          const lastChest = this.lastChestOpenAtByPlayer.get(session.playerId) ?? 0;
          if (now - lastChest < 400) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'RATE_LIMITED',
              message: 'Opening chests too quickly.',
            });
            return;
          }
          const chestId =
            typeof eventData.chestId === 'string'
              ? eventData.chestId.trim().slice(0, 64)
              : '';
          if (!chestId) return;
          const cx = typeof eventData.x === 'number' ? eventData.x : pData.position.x;
          const cz = typeof eventData.z === 'number' ? eventData.z : pData.position.z;
          if (Math.hypot(cx - pData.position.x, cz - pData.position.z) > 8.5) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'OUT_OF_RANGE',
              message: 'Too far from chest to open.',
            });
            return;
          }
          if (eventData.hasArrows === true && eventData.arrowCount !== undefined) {
            if (
              typeof eventData.arrowCount !== 'number' ||
              !Number.isFinite(eventData.arrowCount) ||
              eventData.arrowCount <= 0 ||
              eventData.arrowCount > 24
            ) {
              this.securityLogger.record({
                category: 'INVENTORY_TAMPER',
                code: 'INVALID_CHEST_ARROW_COUNT',
                severity: 'medium',
                roomId: this.roomLayer.roomId,
                playerId: session.playerId,
              });
              this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                code: 'INVALID_ITEM_QUANTITY',
                message: 'Invalid chest reward quantity.',
              });
              return;
            }
          }
          const shared = this.ensureSharedObjectsLayer();
          if (shared.chests[chestId]) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'CHEST_ALREADY_OPENED',
              message: 'Chest has already been opened.',
            });
            return;
          }
          this.lastChestOpenAtByPlayer.set(session.playerId, now);
          shared.chests[chestId] = { openedBy: session.playerId, openedAtMs: now };
          if (eventData.hasArrows === true) {
            const arrowAdd =
              typeof eventData.arrowCount === 'number' &&
              Number.isFinite(eventData.arrowCount)
                ? Math.max(1, Math.min(12, Math.round(eventData.arrowCount)))
                : 8;
            pData.inventory.ammoCount = Math.min(
              MAX_AMMO_COUNT,
              pData.inventory.ammoCount + arrowAdd,
            );
          }
          if (
            typeof eventData.lootItems === 'string' &&
            eventData.lootItems.length > 0 &&
            pData.inventory.chestWeaponLootCount < 3
          ) {
            const items = eventData.lootItems.split(',').slice(0, 1);
            for (const itemId of items) {
              const trimmed = itemId.trim();
              if (
                ALLOWED_WEAPON_IDS.has(trimmed) &&
                !pData.inventory.inventoryItemIds.includes(trimmed)
              ) {
                pData.inventory.inventoryItemIds.push(trimmed);
                pData.inventory.chestWeaponLootCount += 1;
              }
            }
          }
          pData.statistics.chestsOpened += 1;
          this.grantProgression(session.playerId, 15, 12, 'chest_opened');
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({
            room: true,
            shared: true,
            playerKeys: [pData.persistentKey],
          });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'CHEST_OPENED',
            data: {
              chestId,
              openedBy: session.playerId,
              x: cx,
              y: typeof eventData.y === 'number' ? eventData.y : pData.position.y,
              z: cz,
            },
          });
          {
            const activePartyId = this.partyLayer?.playerPartyById[session.playerId];
            const activeObj = activePartyId
              ? this.partyLayer?.parties[activePartyId]?.activeObjective
              : null;
            if (activePartyId && activeObj?.status === 'active' && activeObj.type === 'open_dungeon') {
              await this.recordCoopObjectiveProgress(activePartyId, session.playerId, 1, now);
            }
          }
          break;
        }

        if (eventName === 'PLAYER_COLLECTED_RESOURCE') {
          if (pData.vitals.isDead) return;
          if (now - rt.lastResourceCollectAtMs < 200) {
            return;
          }
          const nodeId =
            typeof eventData.nodeId === 'string'
              ? eventData.nodeId.trim().slice(0, 64)
              : '';
          if (!nodeId) return;
          const rx = typeof eventData.x === 'number' ? eventData.x : pData.position.x;
          const rz = typeof eventData.z === 'number' ? eventData.z : pData.position.z;
          if (Math.hypot(rx - pData.position.x, rz - pData.position.z) > 9.0) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'OUT_OF_RANGE',
              message: 'Too far from resource node.',
            });
            return;
          }
          const prev = world.resourceStates[nodeId];
          if (prev && now < prev.regenAtMs && prev.usesRemaining <= 0) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'RESOURCE_DEPLETED',
              message: 'Resource node is already depleted.',
            });
            return;
          }
          rt.lastResourceCollectAtMs = now;
          const currentUses =
            prev && now < prev.regenAtMs
              ? prev.usesRemaining
              : typeof eventData.maxUses === 'number' && eventData.maxUses >= 1
                ? Math.min(4, Math.round(eventData.maxUses))
                : 2;
          const usesRemaining = Math.max(0, currentUses - 1);
          const depleted = usesRemaining <= 0;
          const itemId =
            typeof eventData.itemId === 'string' ? eventData.itemId.slice(0, 32) : 'wood';
          const regenMs =
            itemId === 'stone' ||
            itemId === 'copper-ore' ||
            itemId === 'iron-ore' ||
            itemId === 'silver-ore' ||
            itemId === 'gold-ore' ||
            itemId === 'coal' ||
            itemId === 'rare-mineral'
              ? 300_000
              : itemId === 'wood'
                ? 240_000
                : itemId === 'driftwood' ||
                    itemId === 'sand' ||
                    itemId === 'clay' ||
                    itemId === 'gravel' ||
                    itemId === 'shell'
                  ? 150_000
                  : 90_000;
          const regenAtMs = now + regenMs;
          world.resourceStates[nodeId] = {
            usesRemaining,
            regenAtMs,
            collectedBy: session.playerId,
          };
          const count =
            typeof eventData.count === 'number'
              ? Math.max(1, Math.min(5, Math.round(eventData.count)))
              : 1;
          this.adjustPlayerItemCount(pData, itemId, count);
          if (
            typeof eventData.bonusSeedId === 'string' &&
            eventData.bonusSeedId.endsWith('-seeds') &&
            eventData.bonusSeedId in SERVER_ITEM_CATALOG
          ) {
            this.adjustPlayerItemCount(pData, eventData.bonusSeedId, 1);
          }
          pData.statistics.resourcesCollected += 1;
          this.grantProgression(session.playerId, 5, 0, 'resource_collected');
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({
            room: true,
            world: true,
            playerKeys: [pData.persistentKey],
          });
          await this.syncProfileEvent(player.publicProfileId, {
            statsDelta: { resourcesCollected: 1, xpGained: 5 },
          });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'PLAYER_COLLECTED_RESOURCE',
            data: {
              nodeId,
              itemId,
              count,
              usesRemaining,
              depleted,
              collectedBy: session.playerId,
              x: rx,
              y: typeof eventData.y === 'number' ? eventData.y : pData.position.y,
              z: rz,
            },
          });
          {
            const activePartyId = this.partyLayer?.playerPartyById[session.playerId];
            const activeObj = activePartyId
              ? this.partyLayer?.parties[activePartyId]?.activeObjective
              : null;
            if (activePartyId && activeObj?.status === 'active' && activeObj.type === 'collect_resources') {
              await this.recordCoopObjectiveProgress(activePartyId, session.playerId, count, now);
            }
          }
          break;
        }

        if (eventName === 'ITEM_DROPPED') {
          if (pData.vitals.isDead) return;
          const itemId =
            typeof eventData.itemId === 'string' ? eventData.itemId.trim().slice(0, 32) : '';
          if (!itemId) return;
          const catalogSpec = SERVER_ITEM_CATALOG[itemId];
          if (!catalogSpec) {
            this.securityLogger.record({
              category: 'INVENTORY_TAMPER',
              code: 'DROP_UNKNOWN_ITEM',
              severity: 'medium',
              roomId: this.roomLayer.roomId,
              playerId: session.playerId,
              detail: itemId,
            });
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'INVALID_ITEM',
              message: 'Unknown item cannot be dropped.',
            });
            return;
          }
          if (!catalogSpec.droppable) {
            this.securityLogger.record({
              category: 'INVENTORY_TAMPER',
              code: 'DROP_NON_DROPPABLE_ITEM',
              severity: 'medium',
              roomId: this.roomLayer.roomId,
              playerId: session.playerId,
              detail: itemId,
            });
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'ITEM_NOT_DROPPABLE',
              message: 'This item cannot be dropped.',
            });
            return;
          }
          const rawCount = eventData.count === undefined ? 1 : eventData.count;
          if (
            typeof rawCount !== 'number' ||
            !Number.isFinite(rawCount) ||
            rawCount <= 0 ||
            rawCount > 99
          ) {
            this.securityLogger.record({
              category: 'INVENTORY_TAMPER',
              code: 'INVALID_DROP_QUANTITY',
              severity: 'high',
              roomId: this.roomLayer.roomId,
              playerId: session.playerId,
              detail: itemId,
            });
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'INVALID_ITEM_QUANTITY',
              message: 'Invalid item drop quantity.',
            });
            return;
          }
          const count = Math.round(rawCount);
          if (
            itemId === 'arrow' &&
            this.roomLayer.gameMode.worldType !== 'creative'
          ) {
            if (pData.inventory.ammoCount < count) {
              this.securityLogger.record({
                category: 'INVENTORY_TAMPER',
                code: 'DROP_INSUFFICIENT_AMMO',
                severity: 'medium',
                roomId: this.roomLayer.roomId,
                playerId: session.playerId,
              });
              this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                code: 'INSUFFICIENT_ITEMS',
                message: 'Not enough arrows to drop.',
              });
              return;
            }
            pData.inventory.ammoCount = Math.max(0, pData.inventory.ammoCount - count);
          } else if (
            this.roomLayer.gameMode.worldType !== 'creative' &&
            ALLOWED_WEAPON_IDS.has(itemId)
          ) {
            const idx = pData.inventory.inventoryItemIds.indexOf(itemId);
            if (idx === -1 || count > 1) {
              this.securityLogger.record({
                category: 'INVENTORY_TAMPER',
                code: 'DROP_UNOWNED_WEAPON',
                severity: 'high',
                roomId: this.roomLayer.roomId,
                playerId: session.playerId,
                detail: itemId,
              });
              this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                code: 'INSUFFICIENT_ITEMS',
                message: 'Weapon not owned to drop.',
              });
              return;
            }
            pData.inventory.inventoryItemIds.splice(idx, 1);
          } else if (this.roomLayer.gameMode.worldType !== 'creative') {
            const ownedCount = pData.inventory.itemCounts?.[itemId] ?? 0;
            if (ownedCount < count) {
              this.securityLogger.record({
                category: 'INVENTORY_TAMPER',
                code: 'DROP_INSUFFICIENT_ITEMS',
                severity: 'high',
                roomId: this.roomLayer.roomId,
                playerId: session.playerId,
                detail: itemId,
              });
              this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                code: 'INSUFFICIENT_ITEMS',
                message: 'Not enough items in inventory to drop.',
              });
              return;
            }
            this.adjustPlayerItemCount(pData, itemId, -count);
          }
          pData.updatedAt = now;
          const dropId =
            typeof eventData.dropId === 'string' && eventData.dropId.length > 0
              ? eventData.dropId.slice(0, 64)
              : `drop_${session.playerId}_${now}`;
          const dx = typeof eventData.x === 'number' ? eventData.x : pData.position.x;
          const dy = typeof eventData.y === 'number' ? eventData.y : pData.position.y;
          const dz = typeof eventData.z === 'number' ? eventData.z : pData.position.z;
          const label =
            typeof eventData.label === 'string' ? eventData.label.slice(0, 48) : itemId;
          const shared = this.ensureSharedObjectsLayer();
          delete shared.sharedResources[dropId];
          shared.droppedItems[dropId] = {
            id: dropId,
            itemId,
            count,
            label,
            x: dx,
            y: dy,
            z: dz,
            droppedBy: session.playerId,
          };
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({
            room: true,
            shared: true,
            playerKeys: [pData.persistentKey],
          });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'ITEM_DROPPED',
            data: {
              dropId,
              itemId,
              count,
              label,
              x: dx,
              y: dy,
              z: dz,
              droppedBy: session.playerId,
            },
          });
          break;
        }

        if (eventName === 'ITEM_PICKED_UP') {
          if (pData.vitals.isDead) return;
          const pickupId =
            typeof eventData.pickupId === 'string' ? eventData.pickupId : '';
          if (!pickupId) return;
          const shared = this.ensureSharedObjectsLayer();
          const drop = shared.droppedItems[pickupId];
          if (drop) {
            if (Math.hypot(drop.x - pData.position.x, drop.z - pData.position.z) > 9.5) {
              this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                code: 'OUT_OF_RANGE',
                message: 'Too far from dropped item.',
              });
              return;
            }
            delete shared.droppedItems[pickupId];
            shared.sharedResources[pickupId] = session.playerId;
            if (drop.itemId === 'arrow') {
              pData.inventory.ammoCount = Math.min(
                MAX_AMMO_COUNT,
                pData.inventory.ammoCount + drop.count,
              );
            } else if (ALLOWED_WEAPON_IDS.has(drop.itemId)) {
              const grantCount = Math.min(4, Math.max(1, drop.count));
              for (let c = 0; c < grantCount; c++) {
                pData.inventory.inventoryItemIds.push(drop.itemId);
              }
            } else {
              this.adjustPlayerItemCount(pData, drop.itemId, drop.count);
            }
            pData.updatedAt = now;
            this.touchRoomActivity(now);
            await this.flushDirtyLayers({
              room: true,
              shared: true,
              playerKeys: [pData.persistentKey],
            });
            this.broadcast('GAME_EVENT', session.playerId, {
              event: 'ITEM_PICKED_UP',
              data: {
                pickupId,
                itemId: drop.itemId,
                count: drop.count,
                isPlayerDrop: true,
                pickedUpBy: session.playerId,
                x: drop.x,
                y: drop.y,
                z: drop.z,
              },
            });
            break;
          }

          const isPerPlayer = eventData.perPlayer === true;
          if (isPerPlayer) {
            const perList = shared.perPlayerPickups?.[pickupId] ?? [];
            if (perList.includes(pData.persistentKey)) {
              this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                code: 'ALREADY_COLLECTED',
                message: 'Item has already been collected.',
              });
              return;
            }
          } else if (shared.sharedResources[pickupId] || pickupId.startsWith('drop_')) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'ALREADY_COLLECTED',
              message: 'Item has already been collected.',
            });
            return;
          }
          const px = typeof eventData.x === 'number' ? eventData.x : pData.position.x;
          const pz = typeof eventData.z === 'number' ? eventData.z : pData.position.z;
          if (Math.hypot(px - pData.position.x, pz - pData.position.z) > 9.5) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'OUT_OF_RANGE',
              message: 'Too far from item.',
            });
            return;
          }
          const itemId =
            typeof eventData.itemId === 'string'
              ? eventData.itemId.trim().slice(0, 96)
              : 'herb';
          const pickupSpec = SERVER_ITEM_CATALOG[itemId];
          const isAllowedModStaticPickup = this.isActiveRoomModItem(itemId);
          if (
            !isAllowedModStaticPickup &&
            (!pickupSpec || ALLOWED_WEAPON_IDS.has(itemId) || pickupSpec.forbidStaticPickup)
          ) {
            this.securityLogger.record({
              category: 'INVENTORY_TAMPER',
              code: 'FORBIDDEN_STATIC_PICKUP',
              severity: 'high',
              roomId: this.roomLayer.roomId,
              playerId: session.playerId,
              detail: itemId,
            });
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'FORBIDDEN_ITEM_GRANT',
              message: 'Restricted or unknown item cannot be picked up directly.',
            });
            return;
          }
          const rawPickupCount = eventData.count === undefined ? 1 : eventData.count;
          if (
            typeof rawPickupCount !== 'number' ||
            !Number.isFinite(rawPickupCount) ||
            rawPickupCount <= 0 ||
            rawPickupCount > 6
          ) {
            this.securityLogger.record({
              category: 'INVENTORY_TAMPER',
              code: 'INVALID_PICKUP_QUANTITY',
              severity: 'high',
              roomId: this.roomLayer.roomId,
              playerId: session.playerId,
              detail: itemId,
            });
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'INVALID_ITEM_QUANTITY',
              message: 'Invalid pickup quantity.',
            });
            return;
          }
          const count = Math.round(rawPickupCount);
          if (isPerPlayer) {
            if (!shared.perPlayerPickups) shared.perPlayerPickups = {};
            const perList = shared.perPlayerPickups[pickupId] ?? [];
            if (!perList.includes(pData.persistentKey)) {
              perList.push(pData.persistentKey);
            }
            shared.perPlayerPickups[pickupId] = perList;
          } else {
            shared.sharedResources[pickupId] = session.playerId;
            if (Array.isArray(world.modSpawns)) {
              const matchedModSpawn = world.modSpawns.find((m) => m.instanceId === pickupId);
              if (matchedModSpawn) {
                matchedModSpawn.collected = true;
                this.dirtyWorld = true;
              }
            }
          }
          this.adjustPlayerItemCount(pData, itemId, count);
          pData.updatedAt = now;
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({
            room: true,
            shared: true,
            world: this.dirtyWorld,
            playerKeys: [pData.persistentKey],
          });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'ITEM_PICKED_UP',
            data: {
              pickupId,
              itemId,
              count,
              isPlayerDrop: false,
              ...(isPerPlayer ? { perPlayer: true } : {}),
              ...(eventData.isModSpawn ? { isModSpawn: true } : {}),
              pickedUpBy: session.playerId,
              x: px,
              y: typeof eventData.y === 'number' ? eventData.y : pData.position.y,
              z: pz,
            },
          });
          break;
        }

        if (eventName === 'ITEM_USED') {
          if (pData.vitals.isDead) return;
          const itemId =
            typeof eventData.itemId === 'string' ? eventData.itemId.trim().slice(0, 96) : '';
          if (!itemId) return;
          const useSpec = SERVER_ITEM_CATALOG[itemId];
          if (!useSpec || !useSpec.usable) {
            this.securityLogger.record({
              category: 'INVENTORY_TAMPER',
              code: 'USE_INVALID_ITEM',
              severity: 'medium',
              roomId: this.roomLayer.roomId,
              playerId: session.playerId,
              detail: itemId,
            });
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'INVALID_ITEM',
              message: 'Item cannot be used.',
            });
            return;
          }
          const rawUseCount = eventData.count === undefined ? 1 : eventData.count;
          if (
            typeof rawUseCount !== 'number' ||
            !Number.isFinite(rawUseCount) ||
            rawUseCount <= 0 ||
            rawUseCount > 20
          ) {
            this.securityLogger.record({
              category: 'INVENTORY_TAMPER',
              code: 'INVALID_USE_QUANTITY',
              severity: 'medium',
              roomId: this.roomLayer.roomId,
              playerId: session.playerId,
              detail: itemId,
            });
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'INVALID_ITEM_QUANTITY',
              message: 'Invalid item usage quantity.',
            });
            return;
          }
          const count = Math.round(rawUseCount);
          if (this.roomLayer.gameMode.worldType !== 'creative') {
            const ownedCount = pData.inventory.itemCounts?.[itemId] ?? 0;
            if (ownedCount < count) {
              this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                code: 'INSUFFICIENT_ITEMS',
                message: 'Not enough items to use.',
              });
              return;
            }
          }
          this.adjustPlayerItemCount(pData, itemId, -count);
          pData.updatedAt = now;
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({
            room: true,
            playerKeys: [pData.persistentKey],
          });
          break;
        }

        if (eventName === 'DOOR_OPENED' || eventName === 'DOOR_CLOSED') {
          if (pData.vitals.isDead) return;
          const doorId = typeof eventData.doorId === 'string' ? eventData.doorId : '';
          if (!doorId) return;
          const dx = typeof eventData.x === 'number' ? eventData.x : pData.position.x;
          const dz = typeof eventData.z === 'number' ? eventData.z : pData.position.z;
          if (Math.hypot(dx - pData.position.x, dz - pData.position.z) > 8.0) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'OUT_OF_RANGE',
              message: 'Too far from door.',
            });
            return;
          }
          const shared = this.ensureSharedObjectsLayer();
          shared.doors[doorId] = eventName === 'DOOR_OPENED';
          if (doorId.startsWith('pdoor_') && shared.playerBuildings) {
            const sid = doorId.slice(6);
            const built = shared.playerBuildings[sid];
            if (built) {
              const isHost = this.roomLayer?.hostPlayerId === session.playerId;
              if (!this.canPlayerAccessStructure(built, session.playerId, isHost)) {
                this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                  code: 'BUILDING_LOCKED',
                  message: 'This structure door is locked to its owner.',
                });
                return;
              }
              built.doorOpen = eventName === 'DOOR_OPENED';
            }
          }
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, shared: true });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: eventName,
            data: {
              doorId,
              isOpen: eventName === 'DOOR_OPENED',
              playerId: session.playerId,
              x: dx,
              z: dz,
            },
          });
          if (eventName === 'DOOR_OPENED') {
            const activePartyId = this.partyLayer?.playerPartyById[session.playerId];
            const activeObj = activePartyId
              ? this.partyLayer?.parties[activePartyId]?.activeObjective
              : null;
            if (activePartyId && activeObj?.status === 'active' && activeObj.type === 'open_dungeon') {
              await this.recordCoopObjectiveProgress(activePartyId, session.playerId, 1, now);
            }
          }
          break;
        }

        if (eventName === 'PLAYER_BUILD_PLACE') {
          if (pData.vitals.isDead) return;
          const structureId =
            typeof eventData.structureId === 'string'
              ? eventData.structureId.trim().slice(0, 64)
              : '';
          const blueprintId =
            typeof eventData.blueprintId === 'string'
              ? eventData.blueprintId.trim().slice(0, 48)
              : '';
          const spec = SERVER_BUILDING_SPECS[blueprintId];
          if (!structureId || !spec) return;
          const bx = typeof eventData.x === 'number' ? eventData.x : pData.position.x;
          const by = typeof eventData.y === 'number' ? eventData.y : pData.position.y;
          const bz = typeof eventData.z === 'number' ? eventData.z : pData.position.z;
          const yaw = typeof eventData.yaw === 'number' ? eventData.yaw : 0;
          if (Math.hypot(bx - pData.position.x, bz - pData.position.z) > 24.0) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'OUT_OF_RANGE',
              message: 'Build location is too far away.',
            });
            return;
          }
          const shared = this.ensureSharedObjectsLayer();
          const map = shared.playerBuildings ?? (shared.playerBuildings = {});
          if (map[structureId]) return;
          const permRaw = eventData.permissionScope;
          const permissionScope: PlayerBuiltStructureSnapshot['permissionScope'] =
            permRaw === 'friends' || permRaw === 'party' || permRaw === 'everyone'
              ? permRaw
              : 'owner';
          const fallbackName = pData.profile.displayName || 'Adventurer';
          const ownerName = sanitizeDisplayName(
            typeof eventData.ownerName === 'string' ? eventData.ownerName : fallbackName,
            fallbackName,
          );
          map[structureId] = {
            id: structureId,
            blueprintId: spec.id,
            x: Math.round(bx * 1000) / 1000,
            y: Math.round(by * 1000) / 1000,
            z: Math.round(bz * 1000) / 1000,
            yaw: Math.round(yaw * 1000) / 1000,
            structureHp: spec.maxHp,
            maxStructureHp: spec.maxHp,
            ownerId: session.playerId,
            ownerName,
            permissionScope,
            createdAtMs: now,
            ...(spec.hasDoor ? { doorOpen: false } : {}),
            ...(spec.storageCapacity ? { storageItems: [] } : {}),
            ...(spec.isFarm
              ? {
                  farmStage: 0,
                  farmProgress: 0,
                  farmSoilPrepared: false,
                  farmCropId: null,
                  farmWaterLevel: 0,
                }
              : {}),
          };
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, shared: true });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'PLAYER_BUILD_PLACE',
            data: {
              structureId,
              blueprintId: spec.id,
              x: map[structureId].x,
              y: map[structureId].y,
              z: map[structureId].z,
              yaw: map[structureId].yaw,
              structureHp: spec.maxHp,
              maxStructureHp: spec.maxHp,
              ownerId: session.playerId,
              ownerName,
              permissionScope,
              createdAtMs: now,
            },
          });
          break;
        }

        if (eventName === 'PLAYER_BUILD_REPAIR') {
          if (pData.vitals.isDead) return;
          const structureId =
            typeof eventData.structureId === 'string' ? eventData.structureId.trim().slice(0, 64) : '';
          if (!structureId) return;
          const shared = this.ensureSharedObjectsLayer();
          const target = shared.playerBuildings?.[structureId];
          if (!target) return;
          const isHost = this.roomLayer?.hostPlayerId === session.playerId;
          if (!this.canPlayerAccessStructure(target, session.playerId, isHost)) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'PERMISSION_DENIED',
              message: 'No permission to repair this structure.',
            });
            return;
          }
          if (Math.hypot(target.x - pData.position.x, target.z - pData.position.z) > 16.0) {
            return;
          }
          target.structureHp = target.maxStructureHp;
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, shared: true });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'PLAYER_BUILD_REPAIR',
            data: {
              structureId,
              structureHp: target.structureHp,
              maxStructureHp: target.maxStructureHp,
              updatedBy: session.playerId,
            },
          });
          break;
        }

        if (eventName === 'PLAYER_BUILD_UPGRADE') {
          if (pData.vitals.isDead) return;
          const structureId =
            typeof eventData.structureId === 'string' ? eventData.structureId.trim().slice(0, 64) : '';
          if (!structureId) return;
          const shared = this.ensureSharedObjectsLayer();
          const target = shared.playerBuildings?.[structureId];
          if (!target) return;
          const isHost = this.roomLayer?.hostPlayerId === session.playerId;
          if (target.ownerId !== session.playerId && !isHost) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'PERMISSION_DENIED',
              message: 'Only the structure owner can upgrade it.',
            });
            return;
          }
          if (Math.hypot(target.x - pData.position.x, target.z - pData.position.z) > 16.0) {
            return;
          }
          const currSpec = SERVER_BUILDING_SPECS[target.blueprintId];
          if (!currSpec?.upgradeToId) return;
          const nextSpec = SERVER_BUILDING_SPECS[currSpec.upgradeToId];
          if (!nextSpec) return;
          target.blueprintId = nextSpec.id;
          target.maxStructureHp = nextSpec.maxHp;
          target.structureHp = nextSpec.maxHp;
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, shared: true });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'PLAYER_BUILD_UPGRADE',
            data: {
              structureId,
              blueprintId: nextSpec.id,
              structureHp: nextSpec.maxHp,
              maxStructureHp: nextSpec.maxHp,
              updatedBy: session.playerId,
            },
          });
          break;
        }

        if (eventName === 'PLAYER_BUILD_PERMS') {
          if (pData.vitals.isDead) return;
          const structureId =
            typeof eventData.structureId === 'string' ? eventData.structureId.trim().slice(0, 64) : '';
          const permRaw = eventData.permissionScope;
          const permissionScope: PlayerBuiltStructureSnapshot['permissionScope'] =
            permRaw === 'friends' || permRaw === 'party' || permRaw === 'everyone'
              ? permRaw
              : 'owner';
          if (!structureId) return;
          const shared = this.ensureSharedObjectsLayer();
          const target = shared.playerBuildings?.[structureId];
          if (!target) return;
          const isHost = this.roomLayer?.hostPlayerId === session.playerId;
          if (target.ownerId !== session.playerId && !isHost) {
            return;
          }
          target.permissionScope = permissionScope;
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, shared: true });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'PLAYER_BUILD_PERMS',
            data: {
              structureId,
              permissionScope,
              updatedBy: session.playerId,
            },
          });
          break;
        }

        if (eventName === 'PLAYER_BUILD_DEMOLISH') {
          if (pData.vitals.isDead) return;
          const structureId =
            typeof eventData.structureId === 'string' ? eventData.structureId.trim().slice(0, 64) : '';
          if (!structureId) return;
          const shared = this.ensureSharedObjectsLayer();
          const target = shared.playerBuildings?.[structureId];
          if (!target) return;
          const isHost = this.roomLayer?.hostPlayerId === session.playerId;
          if (target.ownerId !== session.playerId && !isHost) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'PERMISSION_DENIED',
              message: 'Only the owner or host can demolish this structure.',
            });
            return;
          }
          if (target.storageItems && target.storageItems.length > 0) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'STORAGE_NOT_EMPTY',
              message: 'Empty the storage container before demolishing it.',
            });
            return;
          }
          delete shared.playerBuildings![structureId];
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, shared: true });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'PLAYER_BUILD_DEMOLISH',
            data: {
              structureId,
              updatedBy: session.playerId,
            },
          });
          break;
        }

        if (eventName === 'PLAYER_STORAGE_TRANSFER') {
          if (pData.vitals.isDead) return;
          const structureId =
            typeof eventData.structureId === 'string' ? eventData.structureId.trim().slice(0, 64) : '';
          const direction = eventData.direction === 'withdraw' ? 'withdraw' : 'deposit';
          const itemId =
            typeof eventData.itemId === 'string' ? eventData.itemId.trim().slice(0, 96) : '';
          const count =
            typeof eventData.count === 'number' && Number.isFinite(eventData.count)
              ? Math.max(1, Math.min(200, Math.floor(eventData.count)))
              : 1;
          if (
            !structureId ||
            !itemId ||
            (!(itemId in SERVER_ITEM_CATALOG) && !this.isActiveRoomModItem(itemId))
          ) {
            return;
          }
          const shared = this.ensureSharedObjectsLayer();
          const target = shared.playerBuildings?.[structureId];
          if (!target) return;
          const spec = SERVER_BUILDING_SPECS[target.blueprintId];
          if (!spec?.storageCapacity) return;
          const isHost = this.roomLayer?.hostPlayerId === session.playerId;
          if (!this.canPlayerAccessStructure(target, session.playerId, isHost)) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'PERMISSION_DENIED',
              message: 'You do not have access to this storage.',
            });
            return;
          }
          if (Math.hypot(target.x - pData.position.x, target.z - pData.position.z) > 12.0) {
            return;
          }
          const list = target.storageItems ?? (target.storageItems = []);
          if (direction === 'deposit') {
            const existing = list.find((it) => it.itemId === itemId);
            if (!existing && list.length >= spec.storageCapacity) {
              this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                code: 'STORAGE_FULL',
                message: 'Structure storage is full.',
              });
              return;
            }
            if (existing) {
              existing.count = Math.min(200, existing.count + count);
            } else {
              list.push({ itemId, count });
            }
            this.adjustPlayerItemCount(pData, itemId, -count);
          } else {
            const idx = list.findIndex((it) => it.itemId === itemId);
            if (idx === -1) return;
            const take = Math.min(list[idx].count, count);
            list[idx].count -= take;
            if (list[idx].count <= 0) {
              list.splice(idx, 1);
            }
            this.adjustPlayerItemCount(pData, itemId, take);
          }
          pData.updatedAt = now;
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, shared: true, playerKeys: [pData.persistentKey] });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'PLAYER_STORAGE_TRANSFER',
            data: {
              structureId,
              direction,
              itemId,
              count,
              updatedBy: session.playerId,
            },
          });
          break;
        }

        if (eventName === 'PLAYER_FARM_TILL') {
          if (pData.vitals.isDead) return;
          const structureId =
            typeof eventData.structureId === 'string' ? eventData.structureId.trim().slice(0, 64) : '';
          if (!structureId) return;
          const shared = this.ensureSharedObjectsLayer();
          const target = shared.playerBuildings?.[structureId];
          if (!target) return;
          const spec = SERVER_BUILDING_SPECS[target.blueprintId];
          if (!spec?.isFarm) return;
          const isHost = this.roomLayer?.hostPlayerId === session.playerId;
          if (!this.canPlayerAccessStructure(target, session.playerId, isHost)) return;
          if (Math.hypot(target.x - pData.position.x, target.z - pData.position.z) > 12.0) return;

          target.farmSoilPrepared = true;
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, shared: true });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'PLAYER_FARM_TILL',
            data: {
              structureId,
              updatedBy: session.playerId,
            },
          });
          break;
        }

        if (eventName === 'PLAYER_FARM_PLANT') {
          if (pData.vitals.isDead) return;
          const structureId =
            typeof eventData.structureId === 'string' ? eventData.structureId.trim().slice(0, 64) : '';
          const cropId =
            typeof eventData.cropId === 'string' ? eventData.cropId.trim().slice(0, 32) : '';
          const cropSpec = SERVER_CROP_SPECS[cropId];
          if (!structureId || !cropSpec) return;
          const shared = this.ensureSharedObjectsLayer();
          const target = shared.playerBuildings?.[structureId];
          if (!target) return;
          const spec = SERVER_BUILDING_SPECS[target.blueprintId];
          if (!spec?.isFarm) return;
          const isHost = this.roomLayer?.hostPlayerId === session.playerId;
          if (!this.canPlayerAccessStructure(target, session.playerId, isHost)) return;
          if (Math.hypot(target.x - pData.position.x, target.z - pData.position.z) > 12.0) return;

          if (!target.farmSoilPrepared) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'FARM_SOIL_NOT_PREPARED',
              message: 'Prepare the soil before planting seeds.',
            });
            return;
          }

          const isCreativeFree = this.roomLayer?.gameMode.worldType === 'creative';
          if (!isCreativeFree) {
            if (this.getPlayerItemCount(pData, cropSpec.seedItemId) < 1) {
              this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                code: 'MISSING_SEEDS',
                message: 'You do not have enough seeds to plant.',
              });
              return;
            }
            this.adjustPlayerItemCount(pData, cropSpec.seedItemId, -1);
          }

          target.farmSoilPrepared = true;
          target.farmCropId = cropId;
          target.farmStage = 1;
          target.farmProgress = 0.05;
          target.farmPlantedAtHours = this.getServerTotalWorldHours(now);
          pData.updatedAt = now;
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, shared: true, playerKeys: [pData.persistentKey] });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'PLAYER_FARM_PLANT',
            data: {
              structureId,
              cropId,
              updatedBy: session.playerId,
            },
          });
          break;
        }

        if (eventName === 'PLAYER_FARM_WATER') {
          if (pData.vitals.isDead) return;
          const structureId =
            typeof eventData.structureId === 'string' ? eventData.structureId.trim().slice(0, 64) : '';
          if (!structureId) return;
          const shared = this.ensureSharedObjectsLayer();
          const target = shared.playerBuildings?.[structureId];
          if (!target) return;
          const spec = SERVER_BUILDING_SPECS[target.blueprintId];
          if (!spec?.isFarm) return;
          const isHost = this.roomLayer?.hostPlayerId === session.playerId;
          if (!this.canPlayerAccessStructure(target, session.playerId, isHost)) return;
          if (Math.hypot(target.x - pData.position.x, target.z - pData.position.z) > 12.0) return;

          target.farmWaterLevel = 1;
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, shared: true });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'PLAYER_FARM_WATER',
            data: {
              structureId,
              waterLevel: 1,
              updatedBy: session.playerId,
            },
          });
          break;
        }

        if (eventName === 'PLAYER_FARM_HARVEST') {
          if (pData.vitals.isDead) return;
          const structureId =
            typeof eventData.structureId === 'string' ? eventData.structureId.trim().slice(0, 64) : '';
          if (!structureId) return;
          const shared = this.ensureSharedObjectsLayer();
          const target = shared.playerBuildings?.[structureId];
          if (!target) return;
          const spec = SERVER_BUILDING_SPECS[target.blueprintId];
          if (!spec?.isFarm) return;
          const isHost = this.roomLayer?.hostPlayerId === session.playerId;
          if (!this.canPlayerAccessStructure(target, session.playerId, isHost)) {
            return;
          }
          if (Math.hypot(target.x - pData.position.x, target.z - pData.position.z) > 12.0) {
            return;
          }
          if (!target.farmCropId || (target.farmStage ?? 0) < 1) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'FARM_CROP_NOT_READY',
              message: 'No crop is currently growing in this plot.',
            });
            return;
          }
          const requestedCrop =
            typeof eventData.cropId === 'string' ? eventData.cropId.trim().slice(0, 32) : '';
          const resolvedCropId =
            (target.farmCropId && SERVER_CROP_SPECS[target.farmCropId] ? target.farmCropId : '') ||
            (requestedCrop && SERVER_CROP_SPECS[requestedCrop] ? requestedCrop : '') ||
            'wheat';
          const cropSpec = SERVER_CROP_SPECS[resolvedCropId] ?? SERVER_CROP_SPECS.wheat;
          const nowTotalHours = this.getServerTotalWorldHours(now);
          const plantedHours = target.farmPlantedAtHours ?? nowTotalHours;
          const elapsedHours = Math.max(0, nowTotalHours - plantedHours);
          const speedMult = (target.farmWaterLevel ?? 0) > 0.15 ? 1.35 : 1.0;
          if (elapsedHours * speedMult < cropSpec.growthHours * 0.85) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'FARM_CROP_NOT_READY',
              message: 'Crop has not finished growing yet.',
            });
            return;
          }
          const isLargePlot = target.blueprintId === 'large-farm-field';
          const yieldCount = cropSpec.baseYield * (isLargePlot ? 2 : 1);
          const seedReturnCount = cropSpec.seedReturn * (isLargePlot ? 2 : 1);

          target.farmStage = 0;
          target.farmProgress = 0;
          target.farmCropId = null;
          target.farmSoilPrepared = true;
          target.farmWaterLevel = 0;
          target.farmPlantedAtHours = undefined;
          this.adjustPlayerItemCount(pData, cropSpec.harvestItemId, yieldCount);
          if (seedReturnCount > 0) {
            this.adjustPlayerItemCount(pData, cropSpec.seedItemId, seedReturnCount);
          }

          const villageId =
            typeof eventData.villageId === 'string' ? eventData.villageId.trim().slice(0, 48) : '';
          let villageSync: VillageDevelopmentSyncRecord | null = null;
          if (villageId) {
            const vRec = this.ensureVillageDevRecord(shared, villageId);
            vRec.cropsHarvestedCount += 1;
            villageSync = this.applyVillageProgressSync(
              shared,
              villageId,
              12 + yieldCount * 2,
              6 + yieldCount,
            );
          }

          pData.updatedAt = now;
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, shared: true, playerKeys: [pData.persistentKey] });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'PLAYER_FARM_HARVEST',
            data: {
              structureId,
              cropId: resolvedCropId,
              itemId: cropSpec.harvestItemId,
              count: yieldCount,
              seedItemId: cropSpec.seedItemId,
              seedCount: seedReturnCount,
              ...(villageSync
                ? {
                    villageId: villageSync.villageId,
                    villageLevel: villageSync.level,
                    villageXp: villageSync.progressXp,
                    villageRep: villageSync.reputationPoints,
                  }
                : {}),
              updatedBy: session.playerId,
            },
          });
          break;
        }

        if (eventName === 'VILLAGE_REPAIR') {
          if (pData.vitals.isDead) return;
          const villageId =
            typeof eventData.villageId === 'string' ? eventData.villageId.trim().slice(0, 48) : '';
          const repairId =
            typeof eventData.repairId === 'string' ? eventData.repairId.trim().slice(0, 48) : '';
          const repairSpec = SERVER_VILLAGE_REPAIRS[repairId];
          if (!villageId || !repairSpec) return;

          const shared = this.ensureSharedObjectsLayer();
          const vRec = this.ensureVillageDevRecord(shared, villageId);
          if (vRec.completedRepairIds.includes(repairSpec.id)) return;

          const isCreativeFree = this.roomLayer?.gameMode.worldType === 'creative';
          if (!isCreativeFree) {
            for (const c of repairSpec.costs) {
              if (this.getPlayerItemCount(pData, c.itemId) < c.count) {
                this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                  code: 'MISSING_MATERIALS',
                  message: 'Missing required materials for village repair.',
                });
                return;
              }
            }
            for (const c of repairSpec.costs) {
              this.adjustPlayerItemCount(pData, c.itemId, -c.count);
            }
          }

          vRec.completedRepairIds.push(repairSpec.id);
          const updatedVillage = this.applyVillageProgressSync(
            shared,
            villageId,
            repairSpec.xpGain,
            repairSpec.reputationGain,
          );
          this.grantProgression(
            session.playerId,
            30,
            repairSpec.coinsReward,
            'village_repair_completed',
          );
          pData.updatedAt = now;
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, shared: true, playerKeys: [pData.persistentKey] });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'VILLAGE_REPAIR',
            data: {
              villageId,
              repairId: repairSpec.id,
              villageLevel: updatedVillage.level,
              villageXp: updatedVillage.progressXp,
              villageRep: updatedVillage.reputationPoints,
              updatedBy: session.playerId,
            },
          });
          break;
        }

        if (eventName === 'VILLAGE_PROJECT') {
          if (pData.vitals.isDead) return;
          const villageId =
            typeof eventData.villageId === 'string' ? eventData.villageId.trim().slice(0, 48) : '';
          const projectId =
            typeof eventData.projectId === 'string' ? eventData.projectId.trim().slice(0, 48) : '';
          const projSpec = SERVER_VILLAGE_PROJECTS[projectId];
          if (!villageId || !projSpec) return;

          const shared = this.ensureSharedObjectsLayer();
          const vRec = this.ensureVillageDevRecord(shared, villageId);
          if (vRec.completedProjectIds.includes(projSpec.id)) return;
          if (vRec.level < projSpec.minVillageLevel) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'VILLAGE_LEVEL_LOCKED',
              message: 'Village level is not high enough for this project.',
            });
            return;
          }

          const isCreativeFree = this.roomLayer?.gameMode.worldType === 'creative';
          if (!isCreativeFree) {
            for (const c of projSpec.costs) {
              if (this.getPlayerItemCount(pData, c.itemId) < c.count) {
                this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                  code: 'MISSING_MATERIALS',
                  message: 'Missing required materials for village project.',
                });
                return;
              }
            }
            for (const c of projSpec.costs) {
              this.adjustPlayerItemCount(pData, c.itemId, -c.count);
            }
          }

          vRec.completedProjectIds.push(projSpec.id);
          const updatedVillage = this.applyVillageProgressSync(
            shared,
            villageId,
            projSpec.xpGain,
            projSpec.reputationGain,
          );
          this.grantProgression(session.playerId, 45, 0, 'village_project_completed');
          pData.updatedAt = now;
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, shared: true, playerKeys: [pData.persistentKey] });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'VILLAGE_PROJECT',
            data: {
              villageId,
              projectId: projSpec.id,
              villageLevel: updatedVillage.level,
              villageXp: updatedVillage.progressXp,
              villageRep: updatedVillage.reputationPoints,
              updatedBy: session.playerId,
            },
          });
          break;
        }

        if (eventName === 'VILLAGE_DEFENSE_WON') {
          if (pData.vitals.isDead) return;
          const villageId =
            typeof eventData.villageId === 'string' ? eventData.villageId.trim().slice(0, 48) : '';
          if (!villageId) return;
          const lastWon = this.lastVillageDefenseWinByVillageId.get(villageId) ?? 0;
          if (now - lastWon < 45_000) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'VILLAGE_DEFENSE_COOLDOWN',
              message: 'Wait before claiming another village defense victory.',
            });
            return;
          }
          this.lastVillageDefenseWinByVillageId.set(villageId, now);

          const shared = this.ensureSharedObjectsLayer();
          const vRec = this.ensureVillageDevRecord(shared, villageId);
          vRec.defensesWonCount += 1;
          const updatedVillage = this.applyVillageProgressSync(shared, villageId, 130, 65);
          this.grantProgression(session.playerId, 50, 45, 'village_defense_won');
          pData.updatedAt = now;
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, shared: true, playerKeys: [pData.persistentKey] });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'VILLAGE_DEFENSE_WON',
            data: {
              villageId,
              villageLevel: updatedVillage.level,
              villageXp: updatedVillage.progressXp,
              villageRep: updatedVillage.reputationPoints,
              defensesWonCount: updatedVillage.defensesWonCount,
              updatedBy: session.playerId,
            },
          });
          break;
        }

        if (eventName === 'MERCHANT_BUY') {
          if (pData.vitals.isDead) return;
          const villageId =
            typeof eventData.villageId === 'string' ? eventData.villageId.trim().slice(0, 48) : '';
          const offerId =
            typeof eventData.offerId === 'string' ? eventData.offerId.trim().slice(0, 48) : '';
          const offer = SERVER_MERCHANT_OFFERS[offerId];
          if (!villageId || !offer) return;

          const shared = this.ensureSharedObjectsLayer();
          const vRec = this.ensureVillageDevRecord(shared, villageId);
          if (vRec.level < offer.minVillageLevel) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'MERCHANT_LEVEL_LOCKED',
              message: 'Village development level is too low for this merchant offer.',
            });
            return;
          }

          const { discountPct } = this.getVillageDiscountAndSellBonus(vRec.reputationPoints);
          const finalPrice = Math.max(
            1,
            Math.round(offer.basePriceCoins * (1 - discountPct / 100)),
          );
          if (pData.coins < finalPrice) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'INSUFFICIENT_COINS',
              message: 'Not enough coins for this merchant offer.',
            });
            return;
          }

          if (offer.kind === 'item') {
            this.adjustPlayerItemCount(pData, offer.itemId, offer.count);
          }
          vRec.tradesCompletedCount += 1;
          const xp = Math.max(8, Math.min(35, Math.round(finalPrice * 0.35)));
          const rep = Math.max(5, Math.min(22, Math.round(finalPrice * 0.22)));
          const updatedVillage = this.applyVillageProgressSync(shared, villageId, xp, rep);
          this.grantProgression(session.playerId, 0, -finalPrice, 'merchant_buy');
          pData.updatedAt = now;
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, shared: true, playerKeys: [pData.persistentKey] });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'MERCHANT_BUY',
            data: {
              villageId,
              offerId: offer.id,
              villageLevel: updatedVillage.level,
              villageXp: updatedVillage.progressXp,
              villageRep: updatedVillage.reputationPoints,
              updatedBy: session.playerId,
            },
          });
          break;
        }

        if (eventName === 'MERCHANT_SELL') {
          if (pData.vitals.isDead) return;
          const villageId =
            typeof eventData.villageId === 'string' ? eventData.villageId.trim().slice(0, 48) : '';
          const itemId =
            typeof eventData.itemId === 'string' ? eventData.itemId.trim().slice(0, 40) : '';
          const rawCount =
            typeof eventData.count === 'number' && Number.isFinite(eventData.count)
              ? Math.max(1, Math.min(99, Math.floor(eventData.count)))
              : 1;
          if (!villageId || !itemId || !(itemId in SERVER_ITEM_CATALOG)) return;

          const owned = this.getPlayerItemCount(pData, itemId);
          if (owned < 1) return;
          const sellCount = Math.min(owned, rawCount);

          const shared = this.ensureSharedObjectsLayer();
          const vRec = this.ensureVillageDevRecord(shared, villageId);
          const { sellBonusPct } = this.getVillageDiscountAndSellBonus(vRec.reputationPoints);
          const baseVal = SERVER_ITEM_SELL_VALUES[itemId] ?? 4;
          const baseUnit = Math.max(1, Math.round(baseVal * 0.72));
          const unitSellCoins = Math.max(1, Math.round(baseUnit * (1 + sellBonusPct / 100)));
          const earnedCoins = unitSellCoins * sellCount;

          this.adjustPlayerItemCount(pData, itemId, -sellCount);
          vRec.tradesCompletedCount += 1;
          const xp = Math.max(8, Math.min(35, Math.round(earnedCoins * 0.35)));
          const rep = Math.max(5, Math.min(22, Math.round(earnedCoins * 0.22)));
          const updatedVillage = this.applyVillageProgressSync(shared, villageId, xp, rep);
          this.grantProgression(session.playerId, 0, earnedCoins, 'merchant_sell');
          pData.updatedAt = now;
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, shared: true, playerKeys: [pData.persistentKey] });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'MERCHANT_SELL',
            data: {
              villageId,
              itemId,
              count: sellCount,
              villageLevel: updatedVillage.level,
              villageXp: updatedVillage.progressXp,
              villageRep: updatedVillage.reputationPoints,
              updatedBy: session.playerId,
            },
          });
          break;
        }

        if (eventName === 'CONTAINER_UPDATED') {
          if (pData.vitals.isDead) return;
          const containerId =
            typeof eventData.containerId === 'string'
              ? eventData.containerId.trim().slice(0, 64)
              : '';
          if (!containerId) return;
          const shared = this.ensureSharedObjectsLayer();
          const prev = shared.containers[containerId];
          shared.containers[containerId] = {
            id: containerId,
            isOpen:
              typeof eventData.isOpen === 'boolean'
                ? eventData.isOpen
                : prev?.isOpen ?? true,
            items: prev?.items ?? [],
            updatedBy: session.playerId,
            updatedAtMs: now,
          };
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, shared: true });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'CONTAINER_UPDATED',
            data: {
              containerId,
              isOpen: shared.containers[containerId].isOpen,
              updatedBy: session.playerId,
            },
          });
          break;
        }

        if (eventName === 'BUILDING_UPDATED') {
          if (pData.vitals.isDead) return;
          const buildingId =
            typeof eventData.buildingId === 'string'
              ? eventData.buildingId.trim().slice(0, 64)
              : '';
          if (!buildingId) return;
          world.buildingStates[buildingId] = {
            id: buildingId,
            kind:
              typeof eventData.kind === 'string'
                ? eventData.kind.slice(0, 32)
                : 'structure',
            state:
              typeof eventData.state === 'string'
                ? eventData.state.slice(0, 32)
                : 'built',
            ...(typeof eventData.health === 'number' && Number.isFinite(eventData.health)
              ? { health: Math.max(0, Math.round(eventData.health)) }
              : {}),
            ...(typeof eventData.x === 'number' ? { x: eventData.x } : {}),
            ...(typeof eventData.y === 'number' ? { y: eventData.y } : {}),
            ...(typeof eventData.z === 'number' ? { z: eventData.z } : {}),
            ...(typeof eventData.yaw === 'number' ? { yaw: eventData.yaw } : {}),
            updatedBy: session.playerId,
            updatedAtMs: now,
          };
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, world: true });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'BUILDING_UPDATED',
            data: {
              buildingId,
              kind: world.buildingStates[buildingId].kind,
              state: world.buildingStates[buildingId].state,
              ...(typeof world.buildingStates[buildingId].health === 'number'
                ? { health: world.buildingStates[buildingId].health }
                : {}),
              updatedBy: session.playerId,
            },
          });
          break;
        }

        if (eventName === 'QUEST_OBJECT_UPDATED') {
          const objId =
            typeof eventData.objectId === 'string'
              ? eventData.objectId.trim().slice(0, 64)
              : '';
          const questId =
            typeof eventData.questId === 'string'
              ? eventData.questId.trim().slice(0, 64)
              : '';
          if (!objId || !questId) return;
          const shared = this.ensureSharedObjectsLayer();
          shared.questObjects[objId] = {
            id: objId,
            questId,
            state:
              typeof eventData.state === 'string'
                ? eventData.state.slice(0, 32)
                : 'activated',
            updatedBy: session.playerId,
            updatedAtMs: now,
          };
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, shared: true });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'QUEST_OBJECT_UPDATED',
            data: {
              objectId: objId,
              questId,
              state: shared.questObjects[objId].state,
              updatedBy: session.playerId,
            },
          });
          {
            const activePartyId = this.partyLayer?.playerPartyById[session.playerId];
            const activeObj = activePartyId
              ? this.partyLayer?.parties[activePartyId]?.activeObjective
              : null;
            if (activePartyId && activeObj?.status === 'active' && activeObj.type === 'open_dungeon') {
              await this.recordCoopObjectiveProgress(activePartyId, session.playerId, 1, now);
            }
          }
          break;
        }

        if (eventName === 'BED_PLACED') {
          if (pData.vitals.isDead) return;
          const bedId = typeof eventData.bedId === 'string' ? eventData.bedId : '';
          if (!bedId) return;
          const bx = typeof eventData.x === 'number' ? eventData.x : pData.position.x;
          const by = typeof eventData.y === 'number' ? eventData.y : pData.position.y;
          const bz = typeof eventData.z === 'number' ? eventData.z : pData.position.z;
          const yaw = typeof eventData.yaw === 'number' ? eventData.yaw : 0;
          if (Math.hypot(bx - pData.position.x, bz - pData.position.z) > 9.0) {
            return;
          }
          const shared = this.ensureSharedObjectsLayer();
          shared.placedBeds[bedId] = {
            id: bedId,
            ownerId: session.playerId,
            x: bx,
            y: by,
            z: bz,
            yaw,
          };
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, shared: true });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'BED_PLACED',
            data: { bedId, x: bx, y: by, z: bz, yaw, ownerId: session.playerId },
          });
          break;
        }

        if (eventName === 'STATION_PLACED') {
          if (pData.vitals.isDead) return;
          const stationId =
            typeof eventData.stationId === 'string' ? eventData.stationId.slice(0, 64) : '';
          if (!stationId) return;
          const stationType =
            eventData.stationType === 'furnace' ? 'furnace' : 'crafting_table';
          const sx = typeof eventData.x === 'number' ? eventData.x : pData.position.x;
          const sy = typeof eventData.y === 'number' ? eventData.y : pData.position.y;
          const sz = typeof eventData.z === 'number' ? eventData.z : pData.position.z;
          const yaw = typeof eventData.yaw === 'number' ? eventData.yaw : 0;
          if (Math.hypot(sx - pData.position.x, sz - pData.position.z) > 9.0) {
            return;
          }
          const shared = this.ensureSharedObjectsLayer();
          if (!shared.placedStations) shared.placedStations = {};
          shared.placedStations[stationId] = {
            id: stationId,
            stationType,
            ownerId: session.playerId,
            x: sx,
            y: sy,
            z: sz,
            yaw,
          };
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, shared: true });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'STATION_PLACED',
            data: {
              stationId,
              stationType,
              x: sx,
              y: sy,
              z: sz,
              yaw,
              ownerId: session.playerId,
            },
          });
          break;
        }

        if (eventName === 'BED_USED') {
          if (pData.vitals.isDead) return;
          if (now - rt.lastBedUsedAtMs < BED_HEAL_COOLDOWN_MS) {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'BED_COOLDOWN',
              message: 'Wait a moment before resting in a bed again.',
            });
            return;
          }
          const bedId = typeof eventData.bedId === 'string' ? eventData.bedId : '';
          const bx = typeof eventData.x === 'number' ? eventData.x : pData.position.x;
          const bz = typeof eventData.z === 'number' ? eventData.z : pData.position.z;
          if (Math.hypot(bx - pData.position.x, bz - pData.position.z) > 8.5) return;

          rt.lastBedUsedAtMs = now;
          const wtBefore = this.materializeWorldTime(now);
          const wtRef = world.time;
          const prevBedDay = wtRef.dayCount;
          if (wtBefore.worldHours > 6.5) {
            wtRef.dayCount += 1;
          }
          wtRef.worldHours = 6.5;
          wtRef.anchorServerMs = now;
          world.day = wtRef.dayCount;

          pData.vitals.health = pData.vitals.maxHealth;
          pData.statistics.bedsUsed += 1;
          pData.updatedAt = now;
          player.health = pData.vitals.health;

          this.touchRoomActivity(now);
          await this.flushDirtyLayers({
            room: true,
            world: true,
            playerKeys: [pData.persistentKey],
          });
          this.broadcast<AuthoritativePlayerVitals>('PLAYER_VITALS', session.playerId, {
            playerId: session.playerId,
            networkEntityId: netEntId,
            health: pData.vitals.health,
            maxHealth: pData.vitals.maxHealth,
            isDead: false,
            reviveAtMs: null,
          });
          this.broadcast('WORLD_TIME_CHANGED', session.playerId, {
            worldTime: { ...wtRef },
            serverTimestamp: now,
            updatedBy: session.playerId,
          });
          if (wtRef.dayCount !== prevBedDay) {
            this.broadcast('WORLD_DAY_CHANGED', session.playerId, {
              dayCount: wtRef.dayCount,
              worldHours: wtRef.worldHours,
              serverTimestamp: now,
              updatedBy: session.playerId,
            });
          }
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'BED_USED',
            data: {
              bedId,
              newWorldHours: 6.5,
              usedBy: session.playerId,
              x: bx,
              z: bz,
            },
          });
          break;
        }

        if (eventName === 'NPC_DIALOGUE_STATE') {
          const npcId =
            typeof eventData.npcId === 'string'
              ? eventData.npcId.trim().slice(0, 64)
              : '';
          if (!npcId) return;
          const dialogueState =
            eventData.dialogueState === 'talking' ? 'talking' : 'idle';
          const trackedNpc = world.npcStates[npcId];
          if (trackedNpc) {
            trackedNpc.dialogueState = dialogueState;
            trackedNpc.dialoguePlayerId =
              dialogueState === 'talking' ? session.playerId : undefined;
            trackedNpc.lastUpdatedAtMs = now;
            this.dirtyWorld = true;
          }
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'NPC_DIALOGUE_STATE',
            data: {
              npcId,
              dialogueState,
              playerId: session.playerId,
              ...(typeof eventData.questState === 'string'
                ? { questState: eventData.questState.slice(0, 24) }
                : {}),
            },
          });
          break;
        }

        if (eventName === 'QUEST_UPDATED') {
          const questId =
            typeof eventData.questId === 'string'
              ? eventData.questId.trim().slice(0, 64)
              : '';
          const rawStatus =
            typeof eventData.status === 'string' ? eventData.status : 'active';
          const status = VALID_QUEST_STATUSES.has(rawStatus) ? rawStatus : 'active';
          if (!questId) return;
          const questSpec = QUEST_SERVER_REWARDS[questId];
          if (questSpec?.scope === 'cooperative') {
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'COOP_QUEST_REQUIRES_SERVER_SYNC',
              message: 'Cooperative quest completion is server-authoritative.',
            });
            return;
          }
          const stepIndex =
            typeof eventData.stepIndex === 'number' && Number.isFinite(eventData.stepIndex)
              ? Math.max(0, Math.min(50, Math.round(eventData.stepIndex)))
              : 0;
          const prevQuest = pData.quests[questId];
          pData.quests[questId] = {
            questId,
            status,
            stepIndex,
            updatedBy: session.playerId,
            updatedAtMs: now,
          };
          if (status === 'completed' && prevQuest?.status !== 'completed') {
            if (!questSpec || questSpec.scope !== 'personal') {
              this.securityLogger.record({
                category: 'XP_TAMPER',
                code: 'UNKNOWN_QUEST_COMPLETION',
                severity: 'high',
                roomId: this.roomLayer.roomId,
                playerId: session.playerId,
                detail: questId,
              });
              this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                code: 'UNKNOWN_QUEST',
                message: 'Quest completion requires a valid registered quest.',
              });
              return;
            }
            const lastQuestDone = this.lastQuestCompleteAtByPlayer.get(session.playerId) ?? 0;
            if (now - lastQuestDone < 1500) {
              this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                code: 'RATE_LIMITED',
                message: 'Quest completions submitted too quickly.',
              });
              return;
            }
            this.lastQuestCompleteAtByPlayer.set(session.playerId, now);
            await this.grantIdempotentReward(
              session.playerId,
              `quest:${questId}:${session.playerId}`,
              {
                mode: 'personal',
                sourceKind: 'quest',
                sourceId: questId,
                xp: questSpec.xp,
                coins: questSpec.coins,
                items: questSpec.items ?? [],
                statQuestDelta: 1,
                reason: 'quest_completed',
                now,
              },
            );
          }
          pData.updatedAt = now;
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({
            room: true,
            playerKeys: [pData.persistentKey],
          });
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'QUEST_UPDATED',
            data: {
              questId,
              status,
              stepIndex,
              updatedBy: session.playerId,
              scope: 'personal',
            },
          });
          break;
        }

        if (eventName === 'SIDE_QUEST_UPDATED') {
          const sideQuestId =
            typeof eventData.sideQuestId === 'string'
              ? eventData.sideQuestId.trim().slice(0, 64)
              : '';
          const rawState =
            typeof eventData.state === 'string' ? eventData.state.trim() : 'ACTIVE';
          const cycleKey =
            typeof eventData.cycleKey === 'string'
              ? eventData.cycleKey.trim().slice(0, 80)
              : '';
          if (!sideQuestId) return;

          const sideSpec = SIDE_QUEST_SERVER_REWARDS[sideQuestId];
          if (!sideSpec) {
            this.securityLogger.record({
              category: 'XP_TAMPER',
              code: 'UNKNOWN_SIDE_QUEST',
              severity: 'high',
              roomId: this.roomLayer.roomId,
              playerId: session.playerId,
              detail: sideQuestId,
            });
            this.sendToSocket(session.ws, 'ERROR', session.playerId, {
              code: 'UNKNOWN_QUEST',
              message: 'Side quest requires a valid registered side quest ID.',
            });
            return;
          }

          const stepIndex =
            typeof eventData.stepIndex === 'number' && Number.isFinite(eventData.stepIndex)
              ? Math.max(0, Math.min(20, Math.round(eventData.stepIndex)))
              : 0;
          const prevQuest = pData.quests[sideQuestId];

          if (rawState === 'COMPLETED') {
            if (!sideSpec.repeatable && prevQuest?.status === 'COMPLETED') {
              this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                code: 'DUPLICATE_QUEST_REWARD',
                message: 'Non-repeatable side quest reward already claimed.',
              });
              return;
            }
            if (
              sideSpec.repeatable &&
              prevQuest?.status === 'COMPLETED' &&
              sideSpec.cooldownMs > 0 &&
              now - prevQuest.updatedAtMs < sideSpec.cooldownMs
            ) {
              this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                code: 'QUEST_COOLDOWN_ACTIVE',
                message: 'Repeatable side quest cooldown is still active.',
              });
              return;
            }
            const lastQuestDone = this.lastQuestCompleteAtByPlayer.get(session.playerId) ?? 0;
            if (now - lastQuestDone < 1500) {
              this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                code: 'RATE_LIMITED',
                message: 'Side quest completions submitted too quickly.',
              });
              return;
            }
            this.lastQuestCompleteAtByPlayer.set(session.playerId, now);

            const resolvedCycle =
              sideSpec.repeatable && cycleKey
                ? cycleKey
                : `${sideQuestId}:c1`;
            const granted = await this.grantIdempotentReward(
              session.playerId,
              `sidequest:${sideQuestId}:${resolvedCycle}:${session.playerId}`,
              {
                mode: 'personal',
                sourceKind: 'quest',
                sourceId: sideQuestId,
                xp: sideSpec.xp,
                coins: sideSpec.coins,
                items: sideSpec.items ?? [],
                statQuestDelta: 1,
                reason: 'side_quest_completed',
                now,
              },
            );
            if (!granted) {
              return;
            }
          }

          pData.quests[sideQuestId] = {
            questId: sideQuestId,
            status: rawState,
            stepIndex,
            updatedBy: session.playerId,
            updatedAtMs: now,
          };
          pData.updatedAt = now;
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({
            room: true,
            playerKeys: [pData.persistentKey],
          });
          this.sendToSocket(session.ws, 'GAME_EVENT', session.playerId, {
            event: 'SIDE_QUEST_UPDATED',
            data: {
              sideQuestId,
              state: rawState,
              stepIndex,
              playerId: session.playerId,
            },
          });
          break;
        }

        if (eventName === 'WORLD_EVENT') {
          const kind = typeof eventData.kind === 'string' ? eventData.kind : '';
          if (kind === 'landmark_discovered' && typeof eventData.landmarkId === 'string') {
            const landmarkId = eventData.landmarkId.trim().slice(0, 64);
            if (
              landmarkId &&
              world.discoveredLandmarks.length < 100 &&
              !world.discoveredLandmarks.includes(landmarkId)
            ) {
              world.discoveredLandmarks.push(landmarkId);
              await this.flushDirtyLayers({ world: true });
            }
          } else if (kind === 'weather_changed' && typeof eventData.weather === 'string') {
            const perm =
              this.roomLayer.permissions.worldSettingsPermission ?? 'HOST_ONLY';
            if (this.roomLayer.hostPlayerId !== session.playerId && perm !== 'ALL_PLAYERS') {
              return;
            }
            const rawWeather = eventData.weather.slice(0, 24) as WorldWeatherState;
            if (!VALID_WEATHER_STATES.has(rawWeather)) {
              return;
            }
            const wwRef = world.weather;
            wwRef.currentState = rawWeather;
            wwRef.targetState = rawWeather;
            wwRef.startMs = now;
            wwRef.endMs = now + wwRef.durationMs;
            const defaultIntensity =
              rawWeather === 'storm'
                ? 0.9
                : rawWeather === 'rain'
                  ? 0.72
                  : rawWeather === 'fog' || rawWeather === 'overcast'
                    ? 0.6
                    : rawWeather === 'cloudy'
                      ? 0.35
                      : 0;
            wwRef.intensity =
              typeof eventData.intensity === 'number' && Number.isFinite(eventData.intensity)
                ? Math.max(0, Math.min(1, eventData.intensity))
                : defaultIntensity;
            world.weatherIntensity = wwRef.intensity;
            this.touchRoomActivity(now);
            await this.flushDirtyLayers({ room: true, world: true });
          } else if (kind === 'item_crafted' && typeof eventData.recipeId === 'string') {
            const lastCraft = this.lastAmmoCraftAtByPlayer.get(session.playerId) ?? 0;
            if (now - lastCraft < 500) {
              this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                code: 'RATE_LIMITED',
                message: 'Crafting too quickly.',
              });
              return;
            }
            const yieldSpec = SERVER_CRAFTABLE_YIELDS[eventData.recipeId];
            if (!yieldSpec) {
              this.securityLogger.record({
                category: 'INVENTORY_TAMPER',
                code: 'INVALID_CRAFT_RECIPE',
                severity: 'high',
                roomId: this.roomLayer.roomId,
                playerId: session.playerId,
                detail: eventData.recipeId.slice(0, 48),
              });
              this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                code: 'INVALID_RECIPE',
                message: 'Unknown crafting recipe.',
              });
              return;
            }
            this.lastAmmoCraftAtByPlayer.set(session.playerId, now);
            this.adjustPlayerItemCount(pData, yieldSpec.itemId, yieldSpec.count);
            pData.statistics.itemsCrafted += 1;
            pData.updatedAt = now;
            await this.flushDirtyLayers({ playerKeys: [pData.persistentKey] });
          } else if (kind === 'ammo_crafted' && typeof eventData.count === 'number') {
            if (
              !Number.isFinite(eventData.count) ||
              eventData.count <= 0 ||
              eventData.count > 12
            ) {
              this.securityLogger.record({
                category: 'INVENTORY_TAMPER',
                code: 'INVALID_AMMO_CRAFT_COUNT',
                severity: 'high',
                roomId: this.roomLayer.roomId,
                playerId: session.playerId,
              });
              this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                code: 'INVALID_ITEM_QUANTITY',
                message: 'Invalid ammo craft quantity.',
              });
              return;
            }
            const lastCraft = this.lastAmmoCraftAtByPlayer.get(session.playerId) ?? 0;
            if (now - lastCraft < 1200) {
              this.sendToSocket(session.ws, 'ERROR', session.playerId, {
                code: 'RATE_LIMITED',
                message: 'Crafting ammo too quickly.',
              });
              return;
            }
            this.lastAmmoCraftAtByPlayer.set(session.playerId, now);
            pData.inventory.ammoCount = Math.min(
              MAX_AMMO_COUNT,
              pData.inventory.ammoCount + Math.round(eventData.count),
            );
            pData.statistics.itemsCrafted += 1;
            pData.updatedAt = now;
            await this.flushDirtyLayers({ playerKeys: [pData.persistentKey] });
          }
          this.broadcast('GAME_EVENT', session.playerId, {
            event: 'WORLD_EVENT',
            data: {
              ...eventData,
              emittedBy: session.playerId,
            },
          });
          break;
        }

        if (eventName === 'COOP_OBJECTIVE_PROGRESS') {
          if (pData.vitals.isDead) return;
          const lastProgress = this.lastCoopProgressAtByPlayer.get(session.playerId) ?? 0;
          if (now - lastProgress < 400) {
            return;
          }
          const activePartyId = this.partyLayer?.playerPartyById[session.playerId];
          const activeParty = activePartyId ? this.partyLayer?.parties[activePartyId] : undefined;
          const activeObj = activeParty?.activeObjective;
          if (!activeParty || !activeObj || activeObj.status !== 'active') {
            return;
          }
          if (
            typeof eventData.objectiveId === 'string' &&
            eventData.objectiveId.length > 0 &&
            eventData.objectiveId !== activeObj.objectiveId
          ) {
            return;
          }
          if (
            (activeObj.type === 'explore_location' || activeObj.type === 'escort_npc') &&
            activeObj.targetX !== undefined &&
            activeObj.targetZ !== undefined
          ) {
            const radius = (activeObj.targetRadius ?? 16) + 4;
            if (
              Math.hypot(pData.position.x - activeObj.targetX, pData.position.z - activeObj.targetZ) >
              radius
            ) {
              return;
            }
          }
          this.lastCoopProgressAtByPlayer.set(session.playerId, now);
          await this.recordCoopObjectiveProgress(
            activeParty.partyId,
            session.playerId,
            1,
            now,
          );
          break;
        }

        if (eventName === 'MOD_SPAWNS_SYNC') {
          if (session.playerId !== this.roomLayer.hostPlayerId) {
            return;
          }
          const rawList = Array.isArray(eventData.modSpawns) ? eventData.modSpawns : null;
          if (!rawList) return;
          const replace = eventData.replace !== false;
          const sanitized: SyncedModSpawnEntry[] = [];
          const shared = this.ensureSharedObjectsLayer();
          for (const rawEntry of rawList.slice(0, 64)) {
            if (!rawEntry || typeof rawEntry !== 'object') continue;
            const e = rawEntry as Record<string, unknown>;
            if (
              typeof e.instanceId !== 'string' ||
              typeof e.modId !== 'string' ||
              typeof e.spawnId !== 'string' ||
              typeof e.contentId !== 'string' ||
              typeof e.contentType !== 'string' ||
              typeof e.x !== 'number' ||
              typeof e.y !== 'number' ||
              typeof e.z !== 'number'
            ) {
              continue;
            }
            const instanceId = e.instanceId.slice(0, 128);
            const perPlayer = Boolean(e.perPlayer);
            const alreadyCollected =
              !perPlayer && Boolean(shared.sharedResources[instanceId]);
            sanitized.push({
              instanceId,
              modId: e.modId.slice(0, 64),
              spawnId: e.spawnId.slice(0, 64),
              contentId: e.contentId.slice(0, 96),
              contentType: e.contentType.slice(0, 32),
              x: e.x,
              y: e.y,
              z: e.z,
              rotationX: typeof e.rotationX === 'number' ? e.rotationX : 0,
              rotationY: typeof e.rotationY === 'number' ? e.rotationY : 0,
              rotationZ: typeof e.rotationZ === 'number' ? e.rotationZ : 0,
              scaleX: typeof e.scaleX === 'number' ? e.scaleX : 1,
              scaleY: typeof e.scaleY === 'number' ? e.scaleY : 1,
              scaleZ: typeof e.scaleZ === 'number' ? e.scaleZ : 1,
              ...(perPlayer ? { perPlayer: true } : {}),
              collected: Boolean(e.collected) || alreadyCollected,
              defeated: Boolean(e.defeated),
              ...(typeof e.modelPath === 'string'
                ? { modelPath: e.modelPath.slice(0, 200) }
                : {}),
              ...(typeof e.label === 'string' ? { label: e.label.slice(0, 96) } : {}),
            });
          }

          if (replace) {
            world.modSpawns = sanitized;
          } else {
            const existing = world.modSpawns ?? [];
            const byId = new Map(existing.map((it) => [it.instanceId, it]));
            for (const item of sanitized) {
              byId.set(item.instanceId, item);
            }
            world.modSpawns = Array.from(byId.values()).slice(0, 256);
          }
          this.touchRoomActivity(now);
          await this.flushDirtyLayers({ room: true, world: true });
          this.broadcast('GAME_EVENT', session.playerId, msg.gameEvent);
          break;
        }

        this.broadcast('GAME_EVENT', session.playerId, msg.gameEvent);
        break;
      }
    }
  }

  private sendErrorToPlayer(playerId: string, code: string, message: string): void {
    const sock = Array.from(this.sessions.values()).find(
      (s) => s.playerId === playerId,
    );
    if (sock) {
      this.sendToSocket(sock.ws, 'ERROR', playerId, { code, message });
    }
  }

  private async applyAuthoritativeDamage(
    attackerId: string,
    targetKind: string,
    targetId: string,
    _archetype: string,
    damage: number,
    isCritOrHeadshot: boolean,
    hitX: number,
    hitY: number,
    hitZ: number,
    now: number,
  ): Promise<boolean> {
    if (!this.roomLayer) return false;

    const attackerData = this.ensurePlayerDataForPlayer(attackerId);

    if (targetKind === 'player') {
      if (targetId === attackerId) return false;
      const world = this.ensureWorldLayer();
      const sameParty = this.arePlayersInSameParty(attackerId, targetId);
      if (sameParty) {
        if (!world.worldSettings.friendlyFire) {
          this.sendErrorToPlayer(
            attackerId,
            'FRIENDLY_FIRE_DISABLED',
            'Friendly fire is disabled for party members.',
          );
          return false;
        }
      } else if (!world.worldSettings.pvpEnabled) {
        return false;
      }
      const targetPlayer = this.roomLayer.players[targetId];
      if (!targetPlayer) return false;
      const targetData = this.ensurePlayerDataForPlayer(targetId);
      const targetRt = this.ensureRuntimeForPlayer(targetId);
      if (targetData.vitals.isDead) return false;
      if (
        Math.hypot(hitX - targetData.position.x, hitZ - targetData.position.z) > 6.5 ||
        Math.abs(hitY - targetData.position.y) > 5.5
      ) {
        this.sendErrorToPlayer(
          attackerId,
          'TARGET_POSITION_MISMATCH',
          'Hit rejected: target player is not at that location.',
        );
        return false;
      }
      targetData.vitals.health = Math.max(0, targetData.vitals.health - damage);
      targetRt.lastDamageAtMs = now;
      if (targetData.vitals.health <= 0) {
        targetData.vitals.isDead = true;
        targetData.vitals.reviveAtMs = now + 2000;
      }
      targetData.updatedAt = now;
      attackerData.statistics.damageDealt += damage;
      attackerData.updatedAt = now;
      targetPlayer.health = targetData.vitals.health;
      targetPlayer.isDead = targetData.vitals.isDead;
      await this.flushDirtyLayers({
        room: true,
        playerKeys: [targetData.persistentKey, attackerData.persistentKey],
      });
      this.broadcast<AuthoritativePlayerVitals>('PLAYER_VITALS', targetId, {
        playerId: targetId,
        networkEntityId:
          targetPlayer.networkEntityId ?? generateNetworkEntityId(targetId),
        health: targetData.vitals.health,
        maxHealth: targetData.vitals.maxHealth,
        isDead: targetData.vitals.isDead,
        reviveAtMs: targetData.vitals.reviveAtMs,
      });
      if (targetData.vitals.isDead) {
        this.broadcast('GAME_EVENT', attackerId, {
          event: 'PLAYER_DIED',
          data: {
            playerId: targetId,
            killerId: attackerId,
            displayName: targetPlayer.displayName,
            x: hitX,
            y: hitY,
            z: hitZ,
          },
        });
      }
      return true;
    }

    if (targetKind !== 'npc' && targetKind !== 'animal' && targetKind !== 'enemy') {
      return false;
    }

    const world = this.ensureWorldLayer();
    const entity = this.findEntityById(world, targetId);
    if (!entity) {
      this.sendErrorToPlayer(
        attackerId,
        'TARGET_NOT_FOUND',
        'Hit rejected: target entity is not registered on the room server.',
      );
      return false;
    }
    if (entity.kind !== targetKind) {
      this.sendErrorToPlayer(
        attackerId,
        'INVALID_TARGET_KIND',
        'Hit rejected: target kind does not match registered entity.',
      );
      return false;
    }
    if (
      Math.hypot(hitX - entity.x, hitZ - entity.z) > 6.5 ||
      Math.abs(hitY - entity.y) > 5.5
    ) {
      this.sendErrorToPlayer(
        attackerId,
        'TARGET_POSITION_MISMATCH',
        'Hit rejected: target is not at that location.',
      );
      return false;
    }

    if (entity.isDead) {
      return false;
    }

    const actualDamage = Math.min(entity.hp, Math.max(1, damage));
    entity.hp = Math.max(0, entity.hp - damage);
    if (!entity.damageByPlayer) {
      entity.damageByPlayer = {};
    }
    entity.damageByPlayer[attackerId] =
      (entity.damageByPlayer[attackerId] ?? 0) + actualDamage;
    entity.targetPlayerId = attackerId;

    attackerData.statistics.damageDealt += damage;
    attackerData.updatedAt = now;
    const killed = entity.hp <= 0;
    if (killed) {
      entity.isDead = true;
      entity.diedAtMs = now;
    }
    this.dirtyWorld = true;
    this.dirtyPlayerKeys.add(attackerData.persistentKey);

    const bossEncounter = this.syncBossEncounterFromEntity(
      world,
      entity,
      attackerId,
      true,
      now,
    );

    const damagedEvent =
      targetKind === 'npc'
        ? 'NPC_DAMAGED'
        : targetKind === 'animal'
          ? 'ANIMAL_DAMAGED'
          : 'ENEMY_DAMAGED';
    const diedEvent =
      targetKind === 'npc'
        ? 'NPC_DIED'
        : targetKind === 'animal'
          ? 'ANIMAL_DIED'
          : 'ENEMY_DIED';

    this.broadcast('GAME_EVENT', attackerId, {
      event: damagedEvent,
      data: {
        targetId,
        archetype: entity.archetype,
        attackerId,
        damage,
        hp: entity.hp,
        maxHp: entity.maxHp,
        isCrit: isCritOrHeadshot,
        isBoss: Boolean(bossEncounter),
        ...(bossEncounter ? { bossPhase: bossEncounter.phase } : {}),
        x: hitX,
        y: hitY,
        z: hitZ,
      },
    });

    if (killed) {
      const attackerPlayer = this.roomLayer.players[attackerId];
      const updatedKeys = [attackerData.persistentKey];
      if (targetKind === 'enemy') {
        const contribSnapshot = { ...(entity.damageByPlayer ?? {}) };
        attackerData.statistics.enemiesDefeated += 1;
        const lootKeys = await this.resolveEnemyOrBossLoot(
          entity,
          attackerId,
          world,
          now,
        );
        for (const lk of lootKeys) {
          if (!updatedKeys.includes(lk)) updatedKeys.push(lk);
        }
        const killerReward =
          ENEMY_LOOT_TABLES[entity.archetype]?.personal ??
          ENEMY_REWARDS[entity.archetype] ?? { xp: 25, coins: 12 };
        await this.syncProfileEvent(attackerPlayer?.publicProfileId, {
          statsDelta: { enemiesDefeated: 1, xpGained: killerReward.xp },
        });
        await this.flushDirtyLayers({
          world: true,
          shared: true,
          playerKeys: updatedKeys,
        });
        this.broadcast('GAME_EVENT', attackerId, {
          event: diedEvent,
          data: {
            targetId,
            archetype: entity.archetype,
            killerId: attackerId,
            isBoss: Boolean(bossEncounter),
            x: entity.x,
            y: entity.y,
            z: entity.z,
          },
        });
        await this.recordCoopQuestProgressForKill(
          attackerId,
          targetId,
          entity.archetype,
          contribSnapshot,
          now,
        );
        const activePartyId = this.partyLayer?.playerPartyById[attackerId];
        const activeObj = activePartyId
          ? this.partyLayer?.parties[activePartyId]?.activeObjective
          : null;
        if (
          activePartyId &&
          activeObj?.status === 'active' &&
          (activeObj.type === 'protect_village' ||
            (activeObj.type === 'kill_boss' &&
              (entity.archetype === 'ancient_guardian' ||
                entity.archetype === 'stone_sentinel' ||
                entity.archetype === 'ancient_monster' ||
                activeObj.targetId === targetId ||
                activeObj.targetCount >= 1)))
        ) {
          await this.recordCoopObjectiveProgress(activePartyId, attackerId, 1, now);
        }
      } else {
        if (targetKind === 'animal') {
          const animalContrib = { ...(entity.damageByPlayer ?? {}) };
          attackerData.statistics.animalsDefeated += 1;
          this.grantProgression(attackerId, 12, 0, 'animal_hunted');
          await this.syncProfileEvent(attackerPlayer?.publicProfileId, {
            statsDelta: { animalsDefeated: 1, xpGained: 12 },
          });
          await this.recordCoopQuestProgressForKill(
            attackerId,
            targetId,
            `animal:${entity.archetype}`,
            animalContrib,
            now,
          );
        }
        await this.flushDirtyLayers({
          world: true,
          playerKeys: updatedKeys,
        });
        this.broadcast('GAME_EVENT', attackerId, {
          event: diedEvent,
          data: {
            targetId,
            archetype: entity.archetype,
            killerId: attackerId,
            x: entity.x,
            y: entity.y,
            z: entity.z,
          },
        });
      }
    } else {
      await this.maybePeriodicFlush(now);
    }
    return true;
  }

  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    if (!this.roomLayer) {
      return Response.json({ ok: false, error: 'ROOM_NOT_FOUND' }, { status: 404 });
    }
    if (await this.expireIfNeeded(Date.now())) {
      return Response.json(
        { ok: false, error: 'ROOM_EXPIRED', message: 'ROOM EXPIRED' },
        { status: 410 },
      );
    }

    const rl = this.roomLayer;
    const url = new URL(request.url);
    const playerId = url.searchParams.get('playerId') ?? '';
    const token = url.searchParams.get('token') ?? '';

    if (!isValidPlayerId(playerId) || !token) {
      return Response.json(
        { ok: false, error: 'MISSING_PLAYER_CREDENTIALS' },
        { status: 401 },
      );
    }

    const expectedToken = rl.playerTokens[playerId];
    if (!expectedToken || !timingSafeEqualHex(expectedToken, token)) {
      return Response.json(
        { ok: false, error: 'INVALID_SESSION_TOKEN' },
        { status: 403 },
      );
    }

    if (!rl.players[playerId]) {
      return Response.json(
        { ok: false, error: 'PLAYER_NOT_IN_ROOM' },
        { status: 403 },
      );
    }

    const clientIp =
      request.headers.get('X-Client-IP') ??
      request.headers.get('CF-Connecting-IP') ??
      'unknown';

    let activeFromIp = 0;
    let activeTotalOther = 0;
    for (const sess of this.sessions.values()) {
      if (sess.playerId === playerId) continue;
      activeTotalOther += 1;
      if (sess.clientIp === clientIp) {
        activeFromIp += 1;
      }
    }
    if (activeFromIp >= MAX_CONNECTIONS_PER_IP_PER_ROOM) {
      return Response.json(
        {
          ok: false,
          error: 'CONNECTION_LIMIT_EXCEEDED',
          message: 'Too many simultaneous connections from this IP address.',
        },
        { status: 429 },
      );
    }
    if (activeTotalOther >= rl.maxPlayers) {
      return Response.json(
        { ok: false, error: 'ROOM_FULL', message: 'Room connection limit reached.' },
        { status: 409 },
      );
    }

    const nowHandshake = Date.now();
    const recentHandshakes = (this.wsHandshakeTimestamps.get(playerId) ?? []).filter(
      (ts) => nowHandshake - ts < 30_000,
    );
    if (recentHandshakes.length >= 15) {
      return Response.json(
        { ok: false, error: 'RATE_LIMITED', message: 'Too many reconnect handshakes.' },
        { status: 429 },
      );
    }
    recentHandshakes.push(nowHandshake);
    this.wsHandshakeTimestamps.set(playerId, recentHandshakes);

    for (const [sock, sess] of Array.from(this.sessions.entries())) {
      if (sess.playerId === playerId) {
        sess.cleanDisconnect = true;
        this.sessions.delete(sock);
        try {
          sock.close(4002, 'Superseded by reconnected socket');
        } catch {
          // Ignore close errors
        }
      }
    }

    const now = Date.now();
    const playerRecord = rl.players[playerId];
    const wasDisconnected =
      playerRecord.connectionQuality === 'disconnected' ||
      Boolean(playerRecord.disconnectedAt);
    playerRecord.disconnectedAt = null;
    playerRecord.lastSeenAt = now;
    playerRecord.connectionQuality = 'good';
    this.resumeWorldOnActiveEntry(now);
    this.touchRoomActivity(now);

    const [clientSocket, serverSocket] = createCfWebSocketPair();
    serverSocket.accept();
    const session = this.attachSocketHandlers(serverSocket, playerId, clientIp);

    this.sendToSocket(serverSocket, 'CONNECT', playerId, {
      protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
      roomId: rl.roomId,
      playerId,
      reconnected: wasDisconnected,
    });
    this.sendToSocket(serverSocket, 'ROOM_STATE', playerId, this.buildSnapshot());
    this.sendToSocket<PartyStateSnapshot>(
      serverSocket,
      'PARTY_STATE',
      playerId,
      this.buildPartyStateForPlayer(playerId),
    );

    const cl = this.ensureChatLayer();
    if (cl.chatMessages.length > 0) {
      this.sendToSocket<ChatHistoryPayload>(serverSocket, 'CHAT_HISTORY', playerId, {
        messages: cl.chatMessages.slice(-CHAT_HISTORY_LIMIT),
      });
    }

    if (rl.status === 'in-game') {
      const pData = this.ensurePlayerDataForPlayer(playerId);
      const netEntId =
        playerRecord.networkEntityId ?? generateNetworkEntityId(playerId);

      // Joining or reconnecting to an active world immediately transitions the client into the world
      this.sendToSocket(
        serverSocket,
        'START_GAME',
        rl.hostPlayerId || playerId,
        this.buildStartGamePayload(),
      );
      this.sendToSocket<AuthoritativePlayerVitals>(
        serverSocket,
        'PLAYER_VITALS',
        playerId,
        {
          playerId,
          networkEntityId: netEntId,
          health: pData.vitals.health,
          maxHealth: pData.vitals.maxHealth,
          isDead: pData.vitals.isDead,
          reviveAtMs: pData.vitals.reviveAtMs,
        },
      );
      for (const peer of Object.values(rl.players)) {
        if (peer.playerId !== playerId && peer.state) {
          this.sendToSocket<PlayerNetworkState>(
            serverSocket,
            'PLAYER_STATE',
            peer.playerId,
            peer.state,
          );
        }
      }
      this.sendToSocket(
        serverSocket,
        'WORLD_SNAPSHOT',
        playerId,
        this.buildWorldSnapshot(playerId),
      );
      this.sendToSocket<AuthoritativeProgressionState>(
        serverSocket,
        'PROGRESSION_UPDATED',
        playerId,
        {
          playerId,
          coins: pData.coins,
          xp: pData.xp,
          level: pData.level,
          xpToNextLevel: pData.level * 100,
          reason: 'reconnect',
        },
      );
    }

    if (wasDisconnected || this.dirtyWorld || this.dirtyRoom) {
      await this.flushDirtyLayers({ room: true });
      await this.syncDirectory();
      this.broadcastRoomState();
      this.sendPartyStatesToRoom();
    } else if (this.partyLayer?.playerPartyById[playerId]) {
      this.sendPartyStatesToRoom();
    }
    await this.scheduleLifecycleSweep();
    this.sendServerPing(session);

    return makeWebSocketUpgradeResponse(clientSocket);
  }

  public async fetch(request: Request): Promise<Response> {
    await this.ensureLoaded();
    const url = new URL(request.url);

    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      return this.handleWebSocketUpgrade(request);
    }

    if (request.method === 'POST' && url.pathname === '/init') {
      return this.handleCreateRoom(request);
    }

    if (request.method === 'POST' && url.pathname === '/join') {
      return this.handleIssueJoinTicket(request);
    }

    if (request.method === 'POST' && url.pathname === '/expire-sweep') {
      const body = (await request.json().catch(() => null)) as { nowMs?: unknown } | null;
      const nowMs =
        typeof body?.nowMs === 'number' && Number.isFinite(body.nowMs)
          ? body.nowMs
          : Date.now();
      const expired = await this.expireIfNeeded(nowMs);
      return Response.json({
        ok: true,
        expired,
        status: this.roomLayer?.status ?? 'missing',
      });
    }

    if (request.method === 'POST' && url.pathname === '/verify-member') {
      if (!this.roomLayer) {
        return Response.json(
          { ok: false, error: 'ROOM_NOT_FOUND', message: 'ROOM NOT FOUND' },
          { status: 404 },
        );
      }
      if (await this.expireIfNeeded(Date.now())) {
        return Response.json(
          { ok: false, error: 'ROOM_EXPIRED', message: 'ROOM EXPIRED' },
          { status: 410 },
        );
      }
      const body = (await request.json().catch(() => null)) as {
        playerId?: unknown;
        sessionToken?: unknown;
      } | null;
      const pid = typeof body?.playerId === 'string' ? body.playerId.trim() : '';
      const tok = typeof body?.sessionToken === 'string' ? body.sessionToken.trim() : '';
      const expected = pid ? this.roomLayer.playerTokens[pid] : undefined;
      const player = pid ? this.roomLayer.players[pid] : undefined;
      if (!pid || !tok || !expected || !player || !timingSafeEqualHex(expected, tok)) {
        return Response.json(
          { ok: false, error: 'UNAUTHORIZED_INVITE', message: 'Invalid room member session.' },
          { status: 403 },
        );
      }
      return Response.json({
        ok: true,
        displayName: player.displayName,
        ...(player.publicProfileId ? { publicProfileId: player.publicProfileId } : {}),
        ...(player.playerTag ? { playerTag: player.playerTag } : {}),
        ...(player.avatar ? { avatar: player.avatar } : {}),
        room: this.buildSnapshot(),
      });
    }

    if (request.method === 'GET' && url.pathname === '/verify') {
      if (!this.roomLayer) {
        return Response.json(
          { ok: false, error: 'ROOM_NOT_FOUND', message: 'ROOM NOT FOUND' },
          { status: 404 },
        );
      }
      if (await this.expireIfNeeded(Date.now())) {
        return Response.json(
          { ok: false, error: 'ROOM_EXPIRED', message: 'ROOM EXPIRED' },
          { status: 410 },
        );
      }
      if (Object.keys(this.roomLayer.players).length >= this.roomLayer.maxPlayers) {
        return Response.json(
          {
            ok: false,
            error: 'ROOM_FULL',
            message: 'ROOM IS FULL',
            room: this.buildSnapshot(),
          },
          { status: 409 },
        );
      }
      return Response.json({ ok: true, room: this.buildSnapshot() });
    }

    if (request.method === 'GET' && url.pathname === '/state') {
      if (!this.roomLayer) {
        return Response.json(
          { ok: false, error: 'ROOM_NOT_FOUND', message: 'ROOM NOT FOUND' },
          { status: 404 },
        );
      }
      if (await this.expireIfNeeded(Date.now())) {
        return Response.json(
          { ok: false, error: 'ROOM_EXPIRED', message: 'ROOM EXPIRED' },
          { status: 410 },
        );
      }
      return Response.json({ ok: true, room: this.buildSnapshot() });
    }

    return Response.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
  }
}
