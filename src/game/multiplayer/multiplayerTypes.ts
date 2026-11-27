import type {
  AuthoritativePlayerVitals,
  AuthoritativeProgressionState,
  AuthoritativeRoomSnapshot,
  AuthoritativeWorldSettings,
  AuthoritativeWorldTimeState,
  AuthoritativeWorldWeatherState,
  BossAttackState,
  BossEncounterState,
  ChatHistoryPayload,
  ClientMessageType,
  ConnectionQuality,
  CoopObjectiveContribution,
  CoopObjectiveRewardEntry,
  CoopObjectiveState,
  CoopObjectiveStatus,
  CoopObjectiveType,
  CoopQuestStateRecord,
  EnemyAttackPlayerPayload,
  EntitySyncBatchPayload,
  GameEventPayload,
  LootDistributionMode,
  LootGrantItem,
  LootGrantPayload,
  NetworkEnvelope,
  PartyInviteRecord,
  PartyMemberRecord,
  PartyRecord,
  PartyStateSnapshot,
  PlayerNetworkState,
  PlayerReportPayload,
  PlayerReportReason,
  PositionCorrectionPayload,
  ProtocolModCompatibilityReport,
  ProtocolRoomIncompatiblePlayerAttempt,
  ProtocolRoomModCompatibilityStatus,
  ProtocolWorldModEntry,
  ProtocolWorldModMetadata,
  QuestScope,
  RepairWeaponsPayload,
  ReportAckPayload,
  RoomChatMessage,
  RoomPrivacy,
  RoomStatus,
  RoomWorldSnapshotPayload,
  WorldSettingsPermission,
  WorldSettingsUpdatePayload,
} from '../../../shared/multiplayerProtocol';
import { getConnectionQuality } from '../../../shared/multiplayerProtocol';
import type { AvatarConfig } from '../../../shared/profileTypes';
import type { DifficultyLevel, WorldType } from '../save/saveTypes';

export type {
  AuthoritativePlayerVitals,
  AuthoritativeProgressionState,
  AuthoritativeRoomSnapshot,
  AuthoritativeWorldSettings,
  AuthoritativeWorldTimeState,
  AuthoritativeWorldWeatherState,
  BossAttackState,
  BossEncounterState,
  ChatHistoryPayload,
  ClientMessageType,
  ConnectionQuality,
  CoopObjectiveContribution,
  CoopObjectiveRewardEntry,
  CoopObjectiveState,
  CoopObjectiveStatus,
  CoopObjectiveType,
  CoopQuestStateRecord,
  EnemyAttackPlayerPayload,
  EntitySyncBatchPayload,
  GameEventPayload,
  LootDistributionMode,
  LootGrantItem,
  LootGrantPayload,
  NetworkEnvelope,
  PartyInviteRecord,
  PartyMemberRecord,
  PartyRecord,
  PartyStateSnapshot,
  PlayerNetworkState,
  PlayerReportPayload,
  PlayerReportReason,
  PositionCorrectionPayload,
  ProtocolModCompatibilityReport,
  ProtocolRoomIncompatiblePlayerAttempt,
  ProtocolRoomModCompatibilityStatus,
  ProtocolWorldModEntry,
  ProtocolWorldModMetadata,
  QuestScope,
  RepairWeaponsPayload,
  ReportAckPayload,
  RoomChatMessage,
  RoomPrivacy,
  RoomStatus,
  RoomWorldSnapshotPayload,
  WorldSettingsPermission,
  WorldSettingsUpdatePayload,
};
export { getConnectionQuality };

export type MultiplayerTransportProtocol = 'cloudflare-durable-object-ws';

export type MultiplayerConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export type FriendPresenceStatus = 'online' | 'in-room' | 'offline';

export interface MultiplayerPlayer {
  id: string;
  publicProfileId?: string;
  networkEntityId?: string;
  displayName: string;
  playerTag?: string;
  isHost: boolean;
  isReady: boolean;
  isLocal?: boolean;
  joinedAt: number;
  avatarColor: string;
  avatar?: AvatarConfig;
  pingMs: number | null;
  connectionQuality: ConnectionQuality;
  level?: number;
  partyId?: string | null;
  health?: number;
  maxHealth?: number;
  isDead?: boolean;
  state?: PlayerNetworkState;
}

export interface MultiplayerRoomSummary {
  roomId: string;
  roomCode: string;
  roomName: string;
  hostName: string;
  worldName: string;
  worldType: WorldType;
  difficulty: DifficultyLevel;
  maxPlayers: number;
  playerCount: number;
  privacy: RoomPrivacy;
  isPrivate?: boolean;
  allowFriends?: boolean;
  requireAllReady?: boolean;
  locked?: boolean;
  status: RoomStatus;
  hasPassword: boolean;
  region?: string;
  modMetadata?: ProtocolWorldModMetadata;
}

export interface MultiplayerRoomState extends MultiplayerRoomSummary {
  hostId: string;
  seed: number;
  isPrivate: boolean;
  allowFriends: boolean;
  requireAllReady: boolean;
  worldSettingsPermission: WorldSettingsPermission;
  worldSettings: AuthoritativeWorldSettings;
  locked: boolean;
  players: MultiplayerPlayer[];
  createdAt: number;
  lastActivityAt?: number;
  expiresAt?: number;
  worldTime?: AuthoritativeWorldTimeState;
  worldWeather?: AuthoritativeWorldWeatherState;
  serverTimestamp?: number;
  durableObjectId?: string;
  modMetadata?: ProtocolWorldModMetadata;
  modCompatibilityStatus?: ProtocolRoomModCompatibilityStatus;
}

export interface MultiplayerGameStartInfo {
  hostId?: string;
  roomId: string;
  roomCode: string;
  roomName: string;
  worldName: string;
  seed: number;
  worldType: WorldType;
  difficulty: DifficultyLevel;
  worldSettingsPermission: WorldSettingsPermission;
  worldSettings: AuthoritativeWorldSettings;
  worldTime?: AuthoritativeWorldTimeState;
  worldWeather?: AuthoritativeWorldWeatherState;
  requireAllReady: boolean;
  isHost: boolean;
  localPlayerId: string;
  players: MultiplayerPlayer[];
  modMetadata?: ProtocolWorldModMetadata;
}

export interface MultiplayerFriend {
  id: string;
  displayName: string;
  status: FriendPresenceStatus;
  currentRoomCode?: string;
}

export interface SocialModerationEntry {
  playerId: string;
  displayName: string;
  updatedAt: number;
}

export interface PlayerProfileSummary {
  playerId: string;
  publicProfileId?: string;
  displayName: string;
  playerTag?: string;
  avatarColor: string;
  avatar?: AvatarConfig;
  isHost: boolean;
  isLocal: boolean;
  isReady: boolean;
  joinedAt: number;
  pingMs: number | null;
  connectionQuality: ConnectionQuality;
  health?: number;
  maxHealth?: number;
  isDead?: boolean;
  roomName?: string;
  isFriend: boolean;
  isMuted: boolean;
  isBlocked: boolean;
  accountSystemAvailable: boolean;
}

/**
 * Decoupled social/friends interface so persistent account-backed friends storage
 * can be dropped in later without altering WebSocket/room networking code.
 */
export interface ISocialFriendsAdapter {
  readonly mode: 'local-ephemeral' | 'account-backed';
  getFriends(): Promise<MultiplayerFriend[]>;
  addFriend(displayName: string): Promise<MultiplayerFriend[]>;
  removeFriend(friendId: string): Promise<MultiplayerFriend[]>;
  isFriendName(displayName: string): boolean;
  getMutedPlayers(): SocialModerationEntry[];
  isMuted(playerId: string, displayName?: string): boolean;
  mutePlayer(playerId: string, displayName: string): SocialModerationEntry[];
  unmutePlayer(playerId: string, displayName?: string): SocialModerationEntry[];
  getBlockedPlayers(): SocialModerationEntry[];
  isBlocked(playerId: string, displayName?: string): boolean;
  blockPlayer(playerId: string, displayName: string): SocialModerationEntry[];
  unblockPlayer(playerId: string, displayName?: string): SocialModerationEntry[];
  buildProfileSummary(player: MultiplayerPlayer, roomName?: string): PlayerProfileSummary;
}

export interface MultiplayerInvite {
  inviteId: string;
  roomId: string;
  roomCode: string;
  roomName: string;
  fromPlayerId: string;
  fromPublicProfileId?: string;
  fromPlayerName: string;
  fromPlayerTag?: string;
  fromAvatar?: AvatarConfig;
  toPublicProfileId?: string;
  worldType: WorldType;
  playerCount: number;
  maxPlayers: number;
  sentAt: number;
  modMetadata?: ProtocolWorldModMetadata;
}

export interface CreateRoomOptions {
  roomName: string;
  playerName: string;
  worldName: string;
  worldType: WorldType;
  difficulty: DifficultyLevel;
  maxPlayers: number;
  privacy: RoomPrivacy;
  isPrivate?: boolean;
  allowFriends?: boolean;
  requireAllReady?: boolean;
  friendlyFire?: boolean;
  password?: string;
  region?: string;
  seed?: number;
  worldTime?: AuthoritativeWorldTimeState;
  worldWeather?: AuthoritativeWorldWeatherState;
  savedWorldState?: Partial<RoomWorldSnapshotPayload>;
  modMetadata?: ProtocolWorldModMetadata;
}

export interface JoinRoomOptions {
  roomCodeOrId: string;
  playerName: string;
  password?: string;
  resumeToken?: string;
  clientModMetadata?: ProtocolWorldModMetadata;
}

export interface MultiplayerConnectOptions {
  roomId: string;
  playerId: string;
  sessionToken: string;
  wsPath?: string;
}

export interface MultiplayerServiceConfig {
  protocol: MultiplayerTransportProtocol;
  workerBaseUrl: string | null;
}

export type MultiplayerJoinErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_EXPIRED'
  | 'ROOM_FULL'
  | 'GAME_ALREADY_STARTED'
  | 'PASSWORD_REQUIRED'
  | 'INVALID_PASSWORD'
  | 'MOD_INCOMPATIBLE'
  | 'INVALID_MOD_METADATA'
  | 'MOD_METADATA_TOO_LARGE'
  | 'UNKNOWN';

export class MultiplayerJoinError extends Error {
  public readonly code: MultiplayerJoinErrorCode;
  public readonly modCompatibility?: ProtocolModCompatibilityReport;
  public readonly hostModMetadata?: ProtocolWorldModMetadata;

  constructor(
    code: MultiplayerJoinErrorCode,
    message?: string,
    extra?: {
      modCompatibility?: ProtocolModCompatibilityReport;
      hostModMetadata?: ProtocolWorldModMetadata;
    },
  ) {
    super(message || code);
    this.name = 'MultiplayerJoinError';
    this.code = code;
    this.modCompatibility = extra?.modCompatibility;
    this.hostModMetadata = extra?.hostModMetadata;
  }
}

export type MultiplayerServiceEvent =
  | {
      type: 'connection-changed';
      state: MultiplayerConnectionState;
      attempt?: number;
      maxAttempts?: number;
    }
  | { type: 'room-updated'; room: MultiplayerRoomState | null }
  | { type: 'player-state'; playerId: string; state: PlayerNetworkState }
  | { type: 'player-vitals'; vitals: AuthoritativePlayerVitals }
  | { type: 'progression-updated'; progression: AuthoritativeProgressionState }
  | { type: 'position-correction'; correction: PositionCorrectionPayload }
  | { type: 'game-event'; playerId: string; payload: GameEventPayload }
  | { type: 'entity-sync'; playerId: string; payload: EntitySyncBatchPayload }
  | { type: 'world-snapshot'; snapshot: RoomWorldSnapshotPayload }
  | {
      type: 'world-time-changed';
      worldTime: AuthoritativeWorldTimeState;
      serverTimestamp: number;
      updatedBy?: string;
    }
  | {
      type: 'world-day-changed';
      dayCount: number;
      worldHours: number;
      serverTimestamp: number;
      updatedBy?: string;
    }
  | {
      type: 'world-time-scale-changed';
      timeScale: number;
      paused: boolean;
      worldTime: AuthoritativeWorldTimeState;
      serverTimestamp: number;
      updatedBy?: string;
    }
  | {
      type: 'world-weather-changed';
      worldWeather: AuthoritativeWorldWeatherState;
      triggerLightning?: boolean;
      serverTimestamp: number;
      updatedBy?: string;
    }
  | {
      type: 'world-weather-intensity-changed';
      intensity: number;
      worldWeather: AuthoritativeWorldWeatherState;
      serverTimestamp: number;
      updatedBy?: string;
    }
  | {
      type: 'world-settings-updated';
      worldSettingsPermission: WorldSettingsPermission;
      worldTime: AuthoritativeWorldTimeState;
      worldWeather: AuthoritativeWorldWeatherState;
      triggerLightning?: boolean;
      serverTimestamp: number;
      updatedBy?: string;
    }
  | {
      type: 'host-transferred';
      previousHostId: string;
      newHostId: string;
      newHostName: string;
    }
  | {
      type: 'player-kicked';
      targetPlayerId: string;
      targetDisplayName: string;
      isLocalTarget: boolean;
    }
  | { type: 'room-closed'; reason: string }
  | { type: 'game-started'; info: MultiplayerGameStartInfo }
  | { type: 'invites-updated'; invites: MultiplayerInvite[] }
  | { type: 'invite-received'; invite: MultiplayerInvite }
  | { type: 'chat-message'; message: RoomChatMessage }
  | { type: 'chat-history'; messages: RoomChatMessage[] }
  | { type: 'report-submitted'; ack: ReportAckPayload }
  | {
      type: 'social-updated';
      muted: SocialModerationEntry[];
      blocked: SocialModerationEntry[];
    }
  | { type: 'party-updated'; partyState: PartyStateSnapshot }
  | { type: 'party-invite-received'; invite: PartyInviteRecord }
  | { type: 'party-objective-updated'; objective: CoopObjectiveState }
  | { type: 'party-objective-completed'; objective: CoopObjectiveState }
  | { type: 'coop-quest-updated'; coopQuest: CoopQuestStateRecord }
  | { type: 'boss-state-updated'; boss: BossEncounterState }
  | { type: 'loot-granted'; loot: LootGrantPayload }
  | { type: 'error'; code?: string; message: string };

export class MultiplayerServiceUnavailableError extends Error {
  public readonly code = 'MULTIPLAYER_BACKEND_NOT_CONNECTED';

  constructor(message = 'Online multiplayer server is not connected yet.') {
    super(message);
    this.name = 'MultiplayerServiceUnavailableError';
  }
}

export interface SendChatResult {
  ok: boolean;
  code?: 'NOT_CONNECTED' | 'EMPTY_CHAT_MESSAGE' | 'CHAT_TOO_LONG' | 'CHAT_SPAM_LIMITED' | 'CHAT_DUPLICATE_SPAM';
}

export interface IMultiplayerService {
  readonly protocol: MultiplayerTransportProtocol;
  connect(target?: MultiplayerConnectOptions | string): Promise<void>;
  disconnect(): void;
  retryReconnect(): Promise<void>;
  getReconnectAttempt(): number;
  getMaxReconnectAttempts(): number;
  getConnectionState(): MultiplayerConnectionState;
  getLatencyMs(): number | null;
  getConnectionQuality(): ConnectionQuality;
  getNetworkPacketsPerSec?(): number;
  setLowPowerMode?(enabled: boolean): void;
  getLocalPlayerId(): string | null;
  isConfigured(): boolean;
  getConfig(): MultiplayerServiceConfig;
  getActiveMode?(): 'online' | 'lan';
  getRoomState(): MultiplayerRoomState | null;
  getCurrentRoom(): MultiplayerRoomState | null;
  getAuthoritativeGameStartInfo(): MultiplayerGameStartInfo | null;
  getLatestWorldSnapshot?(): RoomWorldSnapshotPayload | null;
  getLatestProgression?(): AuthoritativeProgressionState | null;
  getLatestVitals?(): AuthoritativePlayerVitals | null;
  listPublicRooms(): Promise<MultiplayerRoomSummary[]>;
  verifyRoom(roomCodeOrId: string): Promise<MultiplayerRoomSummary>;
  createRoom(options: CreateRoomOptions): Promise<MultiplayerRoomState>;
  joinRoom(options: JoinRoomOptions): Promise<MultiplayerRoomState>;
  quickJoin(playerName: string): Promise<MultiplayerRoomState>;
  leaveRoom(): Promise<void>;
  kickPlayer(targetPlayerId: string): Promise<void>;
  transferHost(targetPlayerId: string): Promise<void>;
  updateRoomSettings(settings: {
    requireAllReady?: boolean;
    friendlyFire?: boolean;
  }): Promise<void>;
  closeRoom(): Promise<void>;
  sendMessage<T = unknown>(type: ClientMessageType, payload?: T): boolean;
  sendPlayerState(state: PlayerNetworkState, immediate?: boolean): boolean;
  sendEntitySync?(payload: EntitySyncBatchPayload): boolean;
  sendWorldSettingsUpdate?(payload: WorldSettingsUpdatePayload): boolean;
  sendEnemyAttackPlayer?(payload: EnemyAttackPlayerPayload): boolean;
  sendRepairWeapons?(costCoins: number): boolean;
  sendGameEvent(
    event: string,
    data?: GameEventPayload['data'],
  ): boolean;
  sendChatMessage(text: string): SendChatResult;
  getChatMessages(): RoomChatMessage[];
  reportPlayer(
    targetPlayerId: string,
    reason: PlayerReportReason,
    details?: string,
  ): boolean;
  mutePlayer(playerId: string, displayName: string): SocialModerationEntry[];
  unmutePlayer(playerId: string, displayName?: string): SocialModerationEntry[];
  isPlayerMuted(playerId: string, displayName?: string): boolean;
  getMutedPlayers(): SocialModerationEntry[];
  blockPlayer(playerId: string, displayName: string): SocialModerationEntry[];
  unblockPlayer(playerId: string, displayName?: string): SocialModerationEntry[];
  isPlayerBlocked(playerId: string, displayName?: string): boolean;
  getBlockedPlayers(): SocialModerationEntry[];
  getPlayerProfileSummary(playerId: string): PlayerProfileSummary | null;
  getSocialAdapter(): ISocialFriendsAdapter;
  setReady(ready: boolean): Promise<MultiplayerRoomState | null>;
  startGame(): Promise<void>;
  startMatch(): Promise<void>;
  getFriends(): Promise<MultiplayerFriend[]>;
  addFriend(displayName: string): Promise<MultiplayerFriend[]>;
  removeFriend(friendId: string): Promise<MultiplayerFriend[]>;
  sendInvite(
    targetPlayerName: string,
    toPublicProfileId?: string,
    partyId?: string,
  ): Promise<MultiplayerInvite>;
  getInvites(playerName?: string): Promise<MultiplayerInvite[]>;
  acceptInvite(inviteId: string, playerName?: string): Promise<MultiplayerRoomState>;
  declineInvite(inviteId: string): Promise<void>;
  startInvitePolling(playerName: string): void;
  stopInvitePolling(): void;
  getPartyState?(): PartyStateSnapshot;
  createParty?(): boolean;
  inviteToParty?(target: {
    targetPlayerId?: string;
    targetPublicProfileId?: string;
    targetPlayerName?: string;
  }): boolean;
  acceptPartyInvite?(inviteId: string): boolean;
  declinePartyInvite?(inviteId: string): boolean;
  leaveParty?(): boolean;
  removePartyMember?(targetPlayerId: string): boolean;
  transferPartyLeader?(targetPlayerId: string): boolean;
  setPartyReady?(ready: boolean): boolean;
  startCoopObjective?(options: {
    type: CoopObjectiveType;
    title?: string;
    targetId?: string;
    targetX?: number;
    targetZ?: number;
    targetCount?: number;
  }): boolean;
  cancelCoopObjective?(): boolean;
  sendCoopObjectiveProgress?(objectiveId: string, amount?: number): boolean;
  getCoopQuests?(): CoopQuestStateRecord[];
  getBossEncounters?(): BossEncounterState[];
  startCoopQuest?(questId: string): boolean;
  completeCoopQuest?(questId: string): boolean;
  sendNpcDialogueState?(npcId: string, state: 'talking' | 'idle'): boolean;
  sendPlayerBuildPlace?(payload: {
    structureId: string;
    blueprintId: string;
    x: number;
    y: number;
    z: number;
    yaw: number;
    ownerName: string;
    permissionScope: 'owner' | 'friends' | 'party' | 'everyone';
  }): boolean;
  sendPlayerBuildRepair?(structureId: string): boolean;
  sendPlayerBuildUpgrade?(structureId: string): boolean;
  sendPlayerBuildDemolish?(structureId: string): boolean;
  sendPlayerBuildPerms?(
    structureId: string,
    permissionScope: 'owner' | 'friends' | 'party' | 'everyone',
  ): boolean;
  sendPlayerStorageTransfer?(
    structureId: string,
    direction: 'deposit' | 'withdraw',
    itemId: string,
    count: number,
  ): boolean;
  sendPlayerFarmTill?(structureId: string): boolean;
  sendPlayerFarmPlant?(structureId: string, cropId: string): boolean;
  sendPlayerFarmWater?(structureId: string): boolean;
  sendPlayerFarmHarvest?(
    structureId: string,
    cropId?: string,
    villageId?: string,
  ): boolean;
  sendVillageRepair?(villageId: string, repairId: string): boolean;
  sendVillageProject?(villageId: string, projectId: string): boolean;
  sendVillageDefenseWon?(villageId: string): boolean;
  sendMerchantBuy?(villageId: string, offerId: string): boolean;
  sendMerchantSell?(villageId: string, itemId: string, count: number): boolean;
  subscribe(listener: (event: MultiplayerServiceEvent) => void): () => void;
}
