import { migrateAvatarConfig } from '../../../shared/profileTypes';
import {
  CHAT_HISTORY_LIMIT,
  CHAT_RATE_COOLDOWN_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_RECONNECT_ATTEMPTS,
  MAX_WS_MESSAGE_BYTES,
  MULTIPLAYER_PROTOCOL_VERSION,
  generateNetworkEntityId,
  getConnectionQuality,
  isValidRoomId,
  parseRelayedChatMessage,
  parseRelayedPlayerStatePayload,
  pickAvatarColor,
  sanitizeChatText,
  sanitizeProtocolWorldModMetadata,
  validateEntitySyncBatchPayload,
  validateGameEventPayload,
  validatePlayerReportPayload,
  validatePlayerStatePayload,
  verifyMultiplayerModCompatibility,
  type AuthoritativePlayerVitals,
  type AuthoritativeProgressionState,
  type AuthoritativeRoomSnapshot,
  type AuthoritativeWorldSettings,
  type AuthoritativeWorldTimeState,
  type AuthoritativeWorldWeatherState,
  type BossEncounterState,
  type ChatHistoryPayload,
  type ClientMessageType,
  type ConnectionQuality,
  type CoopObjectiveState,
  type CoopObjectiveType,
  type CoopQuestStateRecord,
  type EnemyAttackPlayerPayload,
  type EntitySyncBatchPayload,
  type ErrorPayload,
  type GameEventPayload,
  type HostTransferredPayload,
  type LootGrantPayload,
  type MultiplayerInviteRecord,
  type NetworkEnvelope,
  type PartyInviteRecord,
  type PartyStateSnapshot,
  type PlayerKickedPayload,
  type PlayerNetworkState,
  type PlayerReportReason,
  type PositionCorrectionPayload,
  type ProtocolModCompatibilityReport,
  type ProtocolWorldModMetadata,
  type ReportAckPayload,
  type RoomChatMessage,
  type RoomClosedPayload,
  type RoomWorldSnapshotPayload,
  type WorldSettingsPermission,
  type WorldSettingsUpdatePayload,
} from '../../../shared/multiplayerProtocol';
import { getModManager } from '../mods';
import {
  MultiplayerJoinError,
  MultiplayerServiceUnavailableError,
  type CreateRoomOptions,
  type IMultiplayerService,
  type ISocialFriendsAdapter,
  type JoinRoomOptions,
  type MultiplayerConnectOptions,
  type MultiplayerConnectionState,
  type MultiplayerFriend,
  type MultiplayerGameStartInfo,
  type MultiplayerInvite,
  type MultiplayerJoinErrorCode,
  type MultiplayerRoomState,
  type MultiplayerRoomSummary,
  type MultiplayerServiceConfig,
  type MultiplayerServiceEvent,
  type PlayerProfileSummary,
  type SendChatResult,
  type SocialModerationEntry,
} from './multiplayerTypes';
import { FRIENDS_STORAGE_KEY, LocalSocialProvider } from './SocialManager';
import {
  checkMultiplayerServerHealth,
  logMultiplayerDiagnosticOnce,
  normalizeMultiplayerBaseUrl,
  resolveMultiplayerServerUrl,
  toWebSocketUrl,
  type MultiplayerServerHealthResult,
} from './multiplayerConfig';
import { AuthService } from '../profile/AuthService';
import { ProfileManager } from '../profile/ProfileManager';

export const PLAYER_NAME_STORAGE_KEY = 'woa_mp_player_name_v1';
export { FRIENDS_STORAGE_KEY };
const PLAYER_STATE_SEND_INTERVAL_MS = 40; // 25 Hz desktop baseline sync
const PLAYER_STATE_MOBILE_INTERVAL_MS = 66; // ~15 Hz mobile / high-RTT sync
const PLAYER_STATE_CONSTRAINED_INTERVAL_MS = 100; // 10 Hz Save-Data / 2G sync
const PLAYER_STATE_HIDDEN_TAB_INTERVAL_MS = 250; // 4 Hz background tab throttle
const PLAYER_STATE_MIN_URGENT_INTERVAL_MS = 33; // 30 Hz hard ceiling on edge events
const INVITE_POLL_INTERVAL_MS = 6000;
const MAX_SEEN_INVITE_IDS = 200;
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 16_000;
const INBOUND_SILENCE_TIMEOUT_MS = Math.min(HEARTBEAT_TIMEOUT_MS, 28_000);
const LIVENESS_PROBE_TIMEOUT_MS = 2800;

function compactPlayerState(state: PlayerNetworkState): PlayerNetworkState {
  const compact: PlayerNetworkState = {
    x: state.x,
    y: state.y,
    z: state.z,
    yaw: state.yaw,
  };
  if (state.aimYaw !== undefined && Math.abs(state.aimYaw - state.yaw) > 0.005) {
    compact.aimYaw = state.aimYaw;
  }
  if (state.pitch !== undefined && Math.abs(state.pitch) > 0.005) {
    compact.pitch = state.pitch;
  }
  if (state.vx !== undefined && Math.abs(state.vx) > 0.02) compact.vx = state.vx;
  if (state.vy !== undefined && Math.abs(state.vy) > 0.02) compact.vy = state.vy;
  if (state.vz !== undefined && Math.abs(state.vz) > 0.02) compact.vz = state.vz;
  if (state.movementState && state.movementState !== 'idle') {
    compact.movementState = state.movementState;
  }
  if (state.animState) compact.animState = state.animState;
  if (state.sprinting) compact.sprinting = true;
  if (state.jumping) compact.jumping = true;
  if (state.crouching) compact.crouching = true;
  if (state.grounded === false) compact.grounded = false;
  if (state.weaponId !== undefined) compact.weaponId = state.weaponId;
  if (state.bowCharging) {
    compact.bowCharging = true;
    if (state.bowCharge !== undefined) compact.bowCharge = state.bowCharge;
  }
  if (state.shooting) compact.shooting = true;
  if (state.reloading) compact.reloading = true;
  if (state.seq !== undefined) compact.seq = state.seq;
  return compact;
}

function mapJoinErrorCode(rawError?: string): MultiplayerJoinErrorCode {
  switch (rawError) {
    case 'ROOM_NOT_FOUND':
    case 'INVALID_ROOM_CODE_OR_ID':
    case 'INVALID_ROOM_ID':
      return 'ROOM_NOT_FOUND';
    case 'ROOM_EXPIRED':
      return 'ROOM_EXPIRED';
    case 'ROOM_FULL':
      return 'ROOM_FULL';
    case 'GAME_ALREADY_STARTED':
    case 'ROOM_LOCKED':
      return 'GAME_ALREADY_STARTED';
    case 'PASSWORD_REQUIRED':
      return 'PASSWORD_REQUIRED';
    case 'INVALID_PASSWORD':
      return 'INVALID_PASSWORD';
    case 'MOD_INCOMPATIBLE':
      return 'MOD_INCOMPATIBLE';
    case 'INVALID_MOD_METADATA':
      return 'INVALID_MOD_METADATA';
    case 'MOD_METADATA_TOO_LARGE':
      return 'MOD_METADATA_TOO_LARGE';
    default:
      return 'UNKNOWN';
  }
}

export function loadSavedMultiplayerName(fallback = 'Adventurer'): string {
  try {
    const val = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
    if (val && val.trim().length > 0) {
      return val.trim().slice(0, 24);
    }
  } catch {
    // Ignore storage access errors
  }
  return fallback;
}

export function saveMultiplayerName(name: string): void {
  try {
    const cleaned = name.trim().slice(0, 24);
    if (cleaned) {
      localStorage.setItem(PLAYER_NAME_STORAGE_KEY, cleaned);
    }
  } catch {
    // Ignore storage access errors
  }
}

export const ROOM_RESUME_STORAGE_KEY = 'woa_mp_room_resume_v1';
const ROOM_RESUME_TTL_MS = 72 * 60 * 60 * 1000;

interface StoredRoomResumeMap {
  [roomId: string]: {
    resumeToken: string;
    updatedAt: number;
  };
}

function readStoredRoomResumeMap(): StoredRoomResumeMap {
  try {
    const raw = localStorage.getItem(ROOM_RESUME_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const now = Date.now();
    const out: StoredRoomResumeMap = {};
    for (const [roomId, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as { resumeToken?: unknown }).resumeToken === 'string' &&
        typeof (entry as { updatedAt?: unknown }).updatedAt === 'number' &&
        now - (entry as { updatedAt: number }).updatedAt < ROOM_RESUME_TTL_MS
      ) {
        out[roomId] = {
          resumeToken: (entry as { resumeToken: string }).resumeToken,
          updatedAt: (entry as { updatedAt: number }).updatedAt,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function loadRoomResumeToken(roomId: string): string | undefined {
  if (!roomId) return undefined;
  const map = readStoredRoomResumeMap();
  return map[roomId]?.resumeToken;
}

function saveRoomResumeToken(roomId: string, resumeToken?: string): void {
  if (!roomId || !resumeToken) return;
  try {
    const map = readStoredRoomResumeMap();
    map[roomId] = { resumeToken, updatedAt: Date.now() };
    localStorage.setItem(ROOM_RESUME_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage access errors
  }
}

function deleteRoomResumeToken(roomId?: string | null): void {
  if (!roomId) return;
  try {
    const map = readStoredRoomResumeMap();
    if (roomId in map) {
      delete map[roomId];
      localStorage.setItem(ROOM_RESUME_STORAGE_KEY, JSON.stringify(map));
    }
  } catch {
    // Ignore storage access errors
  }
}

interface RoomSessionResponse {
  ok: boolean;
  error?: string;
  message?: string;
  room?: AuthoritativeRoomSnapshot;
  playerId?: string;
  sessionToken?: string;
  resumeToken?: string;
  wsPath?: string;
  modCompatibility?: ProtocolModCompatibilityReport;
  hostModMetadata?: ProtocolWorldModMetadata;
}

function defaultWorldSettings(
  worldType: AuthoritativeRoomSnapshot['gameState']['worldType'],
  difficulty: AuthoritativeRoomSnapshot['gameState']['difficulty'],
): AuthoritativeWorldSettings {
  return {
    worldType,
    difficulty,
    pvpEnabled: false,
    friendlyFire: false,
    staminaUnlimited: worldType === 'creative',
    spawnX: 0,
    spawnY: 0,
    spawnZ: 4,
  };
}

function toRoomState(
  snap: AuthoritativeRoomSnapshot,
  localPlayerId: string | null,
): MultiplayerRoomState {
  return {
    roomId: snap.roomId,
    roomCode: snap.roomCode,
    roomName: snap.roomName,
    hostId: snap.hostId,
    hostName: snap.hostName,
    worldName: snap.gameState.worldName,
    worldType: snap.gameState.worldType,
    difficulty: snap.gameState.difficulty,
    maxPlayers: snap.maxPlayers,
    playerCount: snap.players.length,
    privacy: snap.gameState.privacy,
    isPrivate: Boolean(snap.gameState.isPrivate),
    allowFriends: snap.gameState.allowFriends !== false,
    requireAllReady: snap.gameState.requireAllReady !== false,
    worldSettingsPermission: snap.gameState.worldSettingsPermission ?? 'HOST_ONLY',
    worldSettings:
      snap.gameState.worldSettings ??
      defaultWorldSettings(snap.gameState.worldType, snap.gameState.difficulty),
    locked: Boolean(snap.gameState.locked),
    status: snap.status,
    hasPassword: snap.gameState.hasPassword,
    seed: snap.gameState.seed,
    createdAt: snap.createdAt,
    ...(snap.lastActivityAt !== undefined ? { lastActivityAt: snap.lastActivityAt } : {}),
    ...(snap.expiresAt !== undefined ? { expiresAt: snap.expiresAt } : {}),
    ...(snap.worldTime ? { worldTime: snap.worldTime } : {}),
    ...(snap.worldWeather ? { worldWeather: snap.worldWeather } : {}),
    ...(snap.serverTimestamp !== undefined ? { serverTimestamp: snap.serverTimestamp } : {}),
    ...(snap.gameState.modMetadata ? { modMetadata: snap.gameState.modMetadata } : {}),
    ...(snap.gameState.modCompatibilityStatus
      ? { modCompatibilityStatus: snap.gameState.modCompatibilityStatus }
      : {}),
    players: snap.players.map((p) => ({
      id: p.playerId,
      ...(p.publicProfileId ? { publicProfileId: p.publicProfileId } : {}),
      networkEntityId: p.networkEntityId ?? generateNetworkEntityId(p.playerId),
      displayName: p.displayName,
      ...(p.playerTag ? { playerTag: p.playerTag } : {}),
      isHost: p.isHost,
      isReady: p.isReady,
      isLocal: localPlayerId !== null && p.playerId === localPlayerId,
      joinedAt: p.joinedAt,
      avatarColor: p.avatar?.color || p.avatarColor || pickAvatarColor(p.playerId),
      ...(p.avatar ? { avatar: migrateAvatarConfig(p.avatar).avatar } : {}),
      pingMs: typeof p.pingMs === 'number' ? p.pingMs : null,
      connectionQuality:
        p.connectionQuality ??
        getConnectionQuality(typeof p.pingMs === 'number' ? p.pingMs : null, true),
      level: typeof p.level === 'number' ? p.level : 1,
      partyId: p.partyId ?? null,
      health: typeof p.health === 'number' ? p.health : 100,
      maxHealth: typeof p.maxHealth === 'number' ? p.maxHealth : 100,
      isDead: Boolean(p.isDead),
      state: p.state,
    })),
  };
}

function buildWebSocketUrl(baseHttpUrl: string, pathAndQuery: string): string {
  const converted = toWebSocketUrl(baseHttpUrl, pathAndQuery);
  if (converted) return converted;
  const url = new URL(pathAndQuery, baseHttpUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/**
 * Isolated WebSocket + HTTP multiplayer service communicating with Cloudflare Workers
 * and Durable Objects. Keeps all networking separate from single-player gameplay code.
 */
export class MultiplayerService implements IMultiplayerService {
  public readonly protocol = 'cloudflare-durable-object-ws' as const;

  private readonly workerBaseUrl: string | null;
  private connectionState: MultiplayerConnectionState = 'disconnected';
  private currentRoom: MultiplayerRoomState | null = null;
  private localPlayerId: string | null = null;
  private sessionToken: string | null = null;
  private lastWsPath: string | null = null;

  private socket: WebSocket | null = null;
  private socketListenerAbort: AbortController | null = null;
  private heartbeatTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private networkProbeTimer: number | null = null;
  private reconnectAttempts = 0;
  private isReconnectingLoop = false;
  private lastInboundAt = 0;
  private intentionalDisconnect = false;
  private outboundSeq = 0;
  private lastPingSentAt = 0;
  private latencyMs: number | null = null;
  private lastPlayerStateSentAt = 0;
  private invitePollTimer: number | null = null;
  private invitePollPlayerName: string | null = null;
  private readonly seenInviteIds = new Set<string>();
  private authoritativeStartInfo: MultiplayerGameStartInfo | null = null;
  private latestWorldSnapshot: RoomWorldSnapshotPayload | null = null;
  private latestProgression: AuthoritativeProgressionState | null = null;
  private latestVitals: AuthoritativePlayerVitals | null = null;
  private partyState: PartyStateSnapshot = {
    party: null,
    pendingInvites: [],
    outgoingInvites: [],
  };
  private readonly coopQuests = new Map<string, CoopQuestStateRecord>();
  private readonly bossEncounters = new Map<string, BossEncounterState>();
  private networkListenersBound = false;
  private networkListenerAbort: AbortController | null = null;

  private readonly listeners = new Set<(event: MultiplayerServiceEvent) => void>();
  private readonly socialProvider: ISocialFriendsAdapter;
  private chatMessages: RoomChatMessage[] = [];
  private lastChatSentAt = 0;
  private lastChatNormalized = '';
  private duplicateChatStreak = 0;
  private lowPowerMode = false;
  private readonly packetTimestampsMs: number[] = [];
  private packetReadHead = 0;

  constructor(
    workerBaseUrl: string | null = null,
    socialProvider?: ISocialFriendsAdapter,
  ) {
    this.workerBaseUrl = normalizeMultiplayerBaseUrl(workerBaseUrl);
    this.socialProvider = socialProvider ?? new LocalSocialProvider();
    this.bindNetworkListeners();
  }

  public getConnectionState(): MultiplayerConnectionState {
    return this.connectionState;
  }

  public getReconnectAttempt(): number {
    return this.reconnectAttempts;
  }

  public getMaxReconnectAttempts(): number {
    return MAX_RECONNECT_ATTEMPTS;
  }

  public setLowPowerMode(enabled: boolean): void {
    this.lowPowerMode = enabled;
  }

  private recordNetworkPacket(): void {
    const now = performance.now();
    this.packetTimestampsMs.push(now);
    const cutoff = now - 1000;
    while (
      this.packetReadHead < this.packetTimestampsMs.length &&
      this.packetTimestampsMs[this.packetReadHead] < cutoff
    ) {
      this.packetReadHead++;
    }
    if (this.packetReadHead > 64) {
      this.packetTimestampsMs.splice(0, this.packetReadHead);
      this.packetReadHead = 0;
    }
  }

  public getNetworkPacketsPerSec(): number {
    const now = performance.now();
    const cutoff = now - 1000;
    while (
      this.packetReadHead < this.packetTimestampsMs.length &&
      this.packetTimestampsMs[this.packetReadHead] < cutoff
    ) {
      this.packetReadHead++;
    }
    return this.packetTimestampsMs.length - this.packetReadHead;
  }

  public async retryReconnect(): Promise<void> {
    if (!this.currentRoom || !this.lastWsPath || this.intentionalDisconnect) {
      return;
    }
    this.reconnectAttempts = 0;
    this.isReconnectingLoop = true;
    this.scheduleReconnect(true);
  }

  public getLatencyMs(): number | null {
    return this.latencyMs;
  }

  public getConnectionQuality(): ConnectionQuality {
    return getConnectionQuality(
      this.latencyMs,
      this.connectionState === 'connected',
    );
  }

  public getLocalPlayerId(): string | null {
    return this.localPlayerId;
  }

  public isConfigured(): boolean {
    return Boolean(this.workerBaseUrl && this.workerBaseUrl.length > 0);
  }

  public async checkServerHealth(
    timeoutMs = 5000,
  ): Promise<MultiplayerServerHealthResult> {
    return checkMultiplayerServerHealth(this.workerBaseUrl, timeoutMs);
  }

  public getConfig(): MultiplayerServiceConfig {
    return {
      protocol: this.protocol,
      workerBaseUrl: this.workerBaseUrl,
    };
  }

  public getRoomState(): MultiplayerRoomState | null {
    return this.currentRoom;
  }

  public getCurrentRoom(): MultiplayerRoomState | null {
    return this.getRoomState();
  }

  public getAuthoritativeGameStartInfo(): MultiplayerGameStartInfo | null {
    return this.authoritativeStartInfo;
  }

  public getLatestWorldSnapshot(): RoomWorldSnapshotPayload | null {
    return this.latestWorldSnapshot;
  }

  public getLatestProgression(): AuthoritativeProgressionState | null {
    return this.latestProgression;
  }

  public getLatestVitals(): AuthoritativePlayerVitals | null {
    return this.latestVitals;
  }

  public getPartyState(): PartyStateSnapshot {
    return this.partyState;
  }

  public getCoopQuests(): CoopQuestStateRecord[] {
    return Array.from(this.coopQuests.values());
  }

  public getBossEncounters(): BossEncounterState[] {
    return Array.from(this.bossEncounters.values());
  }

  public async connect(target?: MultiplayerConnectOptions | string): Promise<void> {
    if (!this.workerBaseUrl) {
      throw new MultiplayerServiceUnavailableError(
        'Multiplayer server is not configured. Please configure VITE_MULTIPLAYER_URL.',
      );
    }

    let wsUrl: string;
    if (typeof target === 'string') {
      wsUrl = target.startsWith('ws://') || target.startsWith('wss://')
        ? target
        : buildWebSocketUrl(this.workerBaseUrl, target);
    } else if (target) {
      if (!isValidRoomId(target.roomId)) {
        throw new Error('Invalid multiplayer room ID.');
      }
      this.localPlayerId = target.playerId;
      this.sessionToken = target.sessionToken;
      const path =
        target.wsPath ??
        `/api/multiplayer/ws?roomId=${encodeURIComponent(target.roomId)}&playerId=${encodeURIComponent(target.playerId)}&token=${encodeURIComponent(target.sessionToken)}`;
      this.lastWsPath = path;
      wsUrl = buildWebSocketUrl(this.workerBaseUrl, path);
    } else if (this.lastWsPath) {
      wsUrl = buildWebSocketUrl(this.workerBaseUrl, this.lastWsPath);
    } else {
      throw new Error('Missing room session credentials for WebSocket connection.');
    }

    this.closeSocketOnly();
    this.intentionalDisconnect = false;
    this.setConnectionState(this.isReconnectingLoop ? 'reconnecting' : 'connecting');

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        console.error('[Multiplayer] Failed to open WebSocket connection.', err);
        if (!this.isReconnectingLoop) {
          this.setConnectionState('error');
        }
        reject(new Error('Unable to connect to multiplayer server.'));
        return;
      }
      this.socket = ws;
      const listenerAbort = new AbortController();
      this.socketListenerAbort = listenerAbort;
      const signal = listenerAbort.signal;

      const timeoutId = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          console.error('[Multiplayer] WebSocket connection timed out.');
          listenerAbort.abort();
          if (this.socket === ws) {
            this.socket = null;
          }
          if (this.socketListenerAbort === listenerAbort) {
            this.socketListenerAbort = null;
          }
          try {
            ws.close();
          } catch {
            // Ignore close errors
          }
          if (!this.isReconnectingLoop) {
            this.setConnectionState('error');
          }
          reject(new Error('Unable to connect to multiplayer server.'));
        }
      }, 15_000);

      ws.addEventListener(
        'open',
        () => {
          if (this.socket !== ws || settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          this.reconnectAttempts = 0;
          this.isReconnectingLoop = false;
          this.lastInboundAt = Date.now();
          this.clearNetworkProbeTimer();
          this.setConnectionState('connected');
          this.startHeartbeat();
          this.sendMessage('CONNECT', {
            displayName: loadSavedMultiplayerName('Adventurer'),
          });
          this.lastPingSentAt = performance.now();
          this.sendMessage('PING', { clientSentAt: Date.now() });
          resolve();
        },
        { signal },
      );

      ws.addEventListener(
        'message',
        (event) => {
          if (this.socket !== ws) return;
          this.lastInboundAt = Date.now();
          this.recordNetworkPacket();
          this.clearNetworkProbeTimer();
          this.handleIncomingMessage(event.data);
        },
        { signal },
      );

      ws.addEventListener(
        'close',
        (closeEvent) => {
          window.clearTimeout(timeoutId);
          if (this.socket && this.socket !== ws) {
            // A newer socket already replaced this one (e.g. fast network switchover)
            return;
          }
          this.stopHeartbeat();
          if (this.socket === ws) {
            this.socket = null;
          }
          if (this.socketListenerAbort === listenerAbort) {
            this.socketListenerAbort = null;
          }
          listenerAbort.abort();
          if (!settled) {
            settled = true;
            console.error('[Multiplayer] WebSocket closed before handshake completed.', {
              code: closeEvent.code,
              reason: closeEvent.reason,
            });
            if (!this.isReconnectingLoop) {
              this.setConnectionState('error');
            }
            reject(new Error('Unable to connect to multiplayer server.'));
            return;
          }
          if (closeEvent.code === 4002) {
            return;
          }
          if (closeEvent.code === 4000 || closeEvent.code === 4010) {
            this.intentionalDisconnect = true;
            deleteRoomResumeToken(this.currentRoom?.roomId);
            if (this.currentRoom) {
              this.disconnect();
              this.emit({
                type: 'room-closed',
                reason:
                  closeEvent.code === 4010
                    ? 'Room expired after 72 hours of inactivity.'
                    : closeEvent.reason || 'Room no longer exists.',
              });
            } else {
              this.setConnectionState('disconnected');
            }
            return;
          }
          if (closeEvent.code === 4001) {
            this.intentionalDisconnect = true;
            if (this.currentRoom) {
              const pid = this.localPlayerId ?? '';
              this.disconnect();
              this.emit({
                type: 'player-kicked',
                targetPlayerId: pid,
                targetDisplayName: '',
                isLocalTarget: true,
              });
            } else {
              this.setConnectionState('disconnected');
            }
            return;
          }
          if (!this.intentionalDisconnect && this.currentRoom && this.lastWsPath) {
            this.scheduleReconnect();
          } else {
            this.setConnectionState('disconnected');
          }
        },
        { signal },
      );

      ws.addEventListener(
        'error',
        (wsErr) => {
          if (this.socket && this.socket !== ws) return;
          console.error('[Multiplayer] WebSocket transport error.', wsErr);
          if (!settled) {
            settled = true;
            window.clearTimeout(timeoutId);
            listenerAbort.abort();
            if (!this.isReconnectingLoop) {
              this.setConnectionState('error');
            }
            reject(new Error('Unable to connect to multiplayer server.'));
          }
        },
        { signal },
      );
    });
  }

  public disconnect(): void {
    this.intentionalDisconnect = true;
    this.isReconnectingLoop = false;
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    this.clearNetworkProbeTimer();
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.sendMessage('DISCONNECT');
    }
    this.closeSocketOnly();
    this.currentRoom = null;
    this.localPlayerId = null;
    this.sessionToken = null;
    this.lastWsPath = null;
    this.latencyMs = null;
    this.lastInboundAt = 0;
    this.authoritativeStartInfo = null;
    this.latestWorldSnapshot = null;
    this.latestProgression = null;
    this.latestVitals = null;
    this.partyState = { party: null, pendingInvites: [], outgoingInvites: [] };
    this.coopQuests.clear();
    this.bossEncounters.clear();
    this.chatMessages = [];
    this.lastChatSentAt = 0;
    this.lastChatNormalized = '';
    this.duplicateChatStreak = 0;
    this.setConnectionState('disconnected');
    this.emit({ type: 'room-updated', room: null });
    this.emit({ type: 'party-updated', partyState: this.partyState });
    this.emit({ type: 'chat-history', messages: [] });
  }

  public async listPublicRooms(): Promise<MultiplayerRoomSummary[]> {
    if (!this.workerBaseUrl) {
      return [];
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return [];
    }
    try {
      const res = await fetch(`${this.workerBaseUrl}/api/multiplayer/rooms`, {
        method: 'GET',
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        ok?: boolean;
        rooms?: MultiplayerRoomSummary[];
      };
      return Array.isArray(data.rooms) ? data.rooms : [];
    } catch {
      return [];
    }
  }

  public async createRoom(options: CreateRoomOptions): Promise<MultiplayerRoomState> {
    if (!this.workerBaseUrl) {
      throw new MultiplayerServiceUnavailableError(
        'Multiplayer server is not configured. Please configure VITE_MULTIPLAYER_URL.',
      );
    }

    const res = await fetch(`${this.workerBaseUrl}/api/multiplayer/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...AuthService.getBearerHeaders(),
      },
      body: JSON.stringify(options),
    });
    const data = (await res.json().catch(() => null)) as RoomSessionResponse | null;

    if (!res.ok || !data?.ok || !data.room || !data.playerId || !data.sessionToken) {
      console.error('[Multiplayer] Room creation failed.', {
        status: res.status,
        error: data?.error,
        message: data?.message,
      });
      throw new Error(data?.message || data?.error || 'Room creation failed.');
    }

    const roomState = toRoomState(data.room, data.playerId);
    saveRoomResumeToken(roomState.roomId, data.resumeToken);
    this.localPlayerId = data.playerId;
    this.sessionToken = data.sessionToken;
    this.currentRoom = roomState;
    this.latestWorldSnapshot = null;
    this.latestProgression = null;
    this.latestVitals = null;
    this.coopQuests.clear();
    this.bossEncounters.clear();
    this.chatMessages = [];
    this.emit({ type: 'chat-history', messages: [] });
    this.emit({ type: 'room-updated', room: roomState });

    await this.connect({
      roomId: roomState.roomId,
      playerId: data.playerId,
      sessionToken: data.sessionToken,
      wsPath: data.wsPath,
    });

    return this.currentRoom ?? roomState;
  }

  public async verifyRoom(roomCodeOrId: string): Promise<MultiplayerRoomSummary> {
    if (!this.workerBaseUrl) {
      throw new MultiplayerServiceUnavailableError(
        'Multiplayer server is not configured. Please configure VITE_MULTIPLAYER_URL.',
      );
    }

    const res = await fetch(
      `${this.workerBaseUrl}/api/multiplayer/rooms/verify?codeOrId=${encodeURIComponent(roomCodeOrId.trim())}`,
      {
        method: 'GET',
        headers: { accept: 'application/json' },
      },
    );
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      message?: string;
      room?: AuthoritativeRoomSnapshot;
    } | null;

    if (!res.ok || !data?.ok || !data.room) {
      const errCode = mapJoinErrorCode(data?.error);
      if (errCode === 'ROOM_EXPIRED' || errCode === 'ROOM_NOT_FOUND') {
        deleteRoomResumeToken(roomCodeOrId.trim());
      }
      throw new MultiplayerJoinError(
        errCode,
        data?.message || data?.error || 'ROOM NOT FOUND',
      );
    }

    return toRoomState(data.room, this.localPlayerId);
  }

  private async resolveSanitizedClientModMetadata(
    overrideMeta?: ProtocolWorldModMetadata,
  ): Promise<ProtocolWorldModMetadata | undefined> {
    if (overrideMeta) {
      return sanitizeProtocolWorldModMetadata(overrideMeta) ?? undefined;
    }
    const mm = getModManager();
    await mm.initialize();
    return (
      sanitizeProtocolWorldModMetadata(mm.getActiveWorldModMetadata()) ?? undefined
    );
  }

  private enrichLocalCompatibilityReport(
    report: ProtocolModCompatibilityReport,
  ): ProtocolModCompatibilityReport {
    const localMods = getModManager().getSnapshot().mods;
    const discoveredIds = new Set(localMods.map((m) => m.manifest.modId));
    return {
      ...report,
      issues: report.issues.map((issue) =>
        issue.code === 'missing_mod' && discoveredIds.has(issue.modId)
          ? {
              ...issue,
              code: 'disabled_mod' as const,
              actualVersion:
                localMods.find((m) => m.manifest.modId === issue.modId)?.manifest.version ??
                issue.actualVersion,
              message: `Host requires mod "${issue.modName ?? issue.modId}" (${issue.modId} v${issue.expectedVersion ?? '?'}), which is installed locally but disabled.`,
            }
          : issue,
      ),
    };
  }

  public async joinRoom(options: JoinRoomOptions): Promise<MultiplayerRoomState> {
    if (!this.workerBaseUrl) {
      throw new MultiplayerServiceUnavailableError(
        'Multiplayer server is not configured. Please configure VITE_MULTIPLAYER_URL.',
      );
    }

    // 1. Explicitly verify room existence, capacity, and host mod requirements before joining
    const verified = await this.verifyRoom(options.roomCodeOrId);
    const clientModMetadata = await this.resolveSanitizedClientModMetadata(
      options.clientModMetadata,
    );
    const preCheck = this.enrichLocalCompatibilityReport(
      verifyMultiplayerModCompatibility(verified.modMetadata, clientModMetadata),
    );
    if (!preCheck.compatible) {
      throw new MultiplayerJoinError('MOD_INCOMPATIBLE', preCheck.summary, {
        modCompatibility: preCheck,
        hostModMetadata: verified.modMetadata,
      });
    }

    const resumeToken = options.resumeToken ?? loadRoomResumeToken(verified.roomId);

    // 2. Join the room & obtain authenticated WebSocket ticket
    const res = await fetch(`${this.workerBaseUrl}/api/multiplayer/rooms/join`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...AuthService.getBearerHeaders(),
      },
      body: JSON.stringify({
        ...options,
        ...(clientModMetadata ? { clientModMetadata } : {}),
        ...(resumeToken ? { resumeToken } : {}),
      }),
    });
    const data = (await res.json().catch(() => null)) as RoomSessionResponse | null;

    if (!res.ok || !data?.ok || !data.room || !data.playerId || !data.sessionToken) {
      const errCode = mapJoinErrorCode(data?.error);
      if (errCode === 'ROOM_EXPIRED' || errCode === 'ROOM_NOT_FOUND') {
        deleteRoomResumeToken(verified.roomId);
      }
      throw new MultiplayerJoinError(
        errCode,
        data?.message || data?.error || 'ROOM NOT FOUND',
        {
          modCompatibility: data?.modCompatibility
            ? this.enrichLocalCompatibilityReport(data.modCompatibility)
            : undefined,
          hostModMetadata: data?.hostModMetadata ?? verified.modMetadata,
        },
      );
    }

    const roomState = toRoomState(data.room, data.playerId);
    saveRoomResumeToken(roomState.roomId, data.resumeToken);
    this.localPlayerId = data.playerId;
    this.sessionToken = data.sessionToken;
    this.currentRoom = roomState;
    this.latestWorldSnapshot = null;
    this.latestProgression = null;
    this.latestVitals = null;
    this.coopQuests.clear();
    this.bossEncounters.clear();
    this.chatMessages = [];
    this.emit({ type: 'chat-history', messages: [] });
    this.emit({ type: 'room-updated', room: roomState });

    // 3. Connect WebSocket to room so player is live in the player list
    await this.connect({
      roomId: roomState.roomId,
      playerId: data.playerId,
      sessionToken: data.sessionToken,
      wsPath: data.wsPath,
    });

    return this.currentRoom ?? roomState;
  }

  public async quickJoin(playerName: string): Promise<MultiplayerRoomState> {
    if (!this.workerBaseUrl) {
      throw new MultiplayerServiceUnavailableError(
        'Multiplayer server is not configured. Please configure VITE_MULTIPLAYER_URL.',
      );
    }

    const clientModMetadata = await this.resolveSanitizedClientModMetadata();
    const res = await fetch(
      `${this.workerBaseUrl}/api/multiplayer/rooms/quick-join`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...AuthService.getBearerHeaders(),
        },
        body: JSON.stringify({
          playerName,
          ...(clientModMetadata ? { clientModMetadata } : {}),
        }),
      },
    );
    const data = (await res.json().catch(() => null)) as RoomSessionResponse | null;

    if (!res.ok || !data?.ok || !data.room || !data.playerId || !data.sessionToken) {
      const mappedErr = mapJoinErrorCode(data?.error);
      if (
        mappedErr === 'MOD_INCOMPATIBLE' ||
        mappedErr === 'INVALID_MOD_METADATA' ||
        mappedErr === 'MOD_METADATA_TOO_LARGE'
      ) {
        throw new MultiplayerJoinError(
          mappedErr,
          data?.message || 'No mod-compatible public rooms are available.',
          {
            modCompatibility: data?.modCompatibility
              ? this.enrichLocalCompatibilityReport(data.modCompatibility)
              : undefined,
            hostModMetadata: data?.hostModMetadata,
          },
        );
      }
      throw new Error(data?.message || data?.error || 'No open rooms available.');
    }

    const roomState = toRoomState(data.room, data.playerId);
    saveRoomResumeToken(roomState.roomId, data.resumeToken);
    this.localPlayerId = data.playerId;
    this.sessionToken = data.sessionToken;
    this.currentRoom = roomState;
    this.latestWorldSnapshot = null;
    this.latestProgression = null;
    this.latestVitals = null;
    this.coopQuests.clear();
    this.bossEncounters.clear();
    this.chatMessages = [];
    this.emit({ type: 'chat-history', messages: [] });
    this.emit({ type: 'room-updated', room: roomState });

    await this.connect({
      roomId: roomState.roomId,
      playerId: data.playerId,
      sessionToken: data.sessionToken,
      wsPath: data.wsPath,
    });

    return this.currentRoom ?? roomState;
  }

  public async leaveRoom(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.sendMessage('LEAVE_ROOM');
    }
    this.disconnect();
  }

  public async kickPlayer(targetPlayerId: string): Promise<void> {
    if (!this.workerBaseUrl || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new MultiplayerServiceUnavailableError(
        'Kicking a player requires an active Cloudflare Durable Object room connection.',
      );
    }
    if (!this.currentRoom || !this.localPlayerId) {
      throw new Error('You must be in a room to kick a player.');
    }
    if (this.currentRoom.hostId !== this.localPlayerId) {
      throw new Error('Only the room host can kick players.');
    }
    const sent = this.sendMessage('KICK_PLAYER', { targetPlayerId });
    if (!sent) {
      throw new Error('Failed to send KICK_PLAYER command.');
    }
  }

  public async transferHost(targetPlayerId: string): Promise<void> {
    if (!this.workerBaseUrl || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new MultiplayerServiceUnavailableError(
        'Transferring host requires an active Cloudflare Durable Object room connection.',
      );
    }
    if (!this.currentRoom || !this.localPlayerId) {
      throw new Error('You must be in a room to transfer host.');
    }
    if (this.currentRoom.hostId !== this.localPlayerId) {
      throw new Error('Only the room host can transfer host ownership.');
    }
    if (!targetPlayerId || targetPlayerId === this.localPlayerId) {
      throw new Error('Select another connected player to transfer host.');
    }
    const sent = this.sendMessage('TRANSFER_HOST', { targetPlayerId });
    if (!sent) {
      throw new Error('Failed to send TRANSFER_HOST command.');
    }
  }

  public async updateRoomSettings(settings: {
    requireAllReady?: boolean;
    friendlyFire?: boolean;
  }): Promise<void> {
    if (!this.workerBaseUrl || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new MultiplayerServiceUnavailableError(
        'Updating room settings requires an active Cloudflare Durable Object room connection.',
      );
    }
    if (!this.currentRoom || !this.localPlayerId) {
      throw new Error('You must be in a room to update room settings.');
    }
    if (this.currentRoom.hostId !== this.localPlayerId) {
      throw new Error('Only the room host can update room settings.');
    }
    if (settings.requireAllReady !== undefined && this.currentRoom.status !== 'waiting') {
      throw new Error('Ready requirement settings cannot be changed after the match has started.');
    }
    const payload: { requireAllReady?: boolean; friendlyFire?: boolean } = {};
    if (typeof settings.requireAllReady === 'boolean') {
      payload.requireAllReady = settings.requireAllReady;
    }
    if (typeof settings.friendlyFire === 'boolean') {
      payload.friendlyFire = settings.friendlyFire;
    }
    const sent = this.sendMessage('UPDATE_ROOM_SETTINGS', payload);
    if (!sent) {
      throw new Error('Failed to send UPDATE_ROOM_SETTINGS command.');
    }
  }

  public async closeRoom(): Promise<void> {
    if (!this.workerBaseUrl || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new MultiplayerServiceUnavailableError(
        'Closing a room requires an active Cloudflare Durable Object room connection.',
      );
    }
    if (!this.currentRoom || !this.localPlayerId) {
      throw new Error('You must be in a room to close it.');
    }
    if (this.currentRoom.hostId !== this.localPlayerId) {
      throw new Error('Only the room host can close the room.');
    }
    const sent = this.sendMessage('CLOSE_ROOM');
    if (!sent) {
      throw new Error('Failed to send CLOSE_ROOM command.');
    }
  }

  public sendMessage<T = unknown>(type: ClientMessageType, payload?: T): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    if (!this.currentRoom || !this.localPlayerId) {
      return false;
    }

    this.outboundSeq += 1;
    const envelope: NetworkEnvelope<T> = {
      v: MULTIPLAYER_PROTOCOL_VERSION,
      type,
      roomId: this.currentRoom.roomId,
      playerId: this.localPlayerId,
      timestamp: Date.now(),
      seq: this.outboundSeq,
      ...(payload !== undefined ? { payload } : {}),
    };

    const serialized = JSON.stringify(envelope);
    if (new TextEncoder().encode(serialized).byteLength > MAX_WS_MESSAGE_BYTES) {
      return false;
    }

    try {
      this.socket.send(serialized);
      this.recordNetworkPacket();
      return true;
    } catch {
      return false;
    }
  }

  private getAdaptivePlayerStateIntervalMs(): number {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return PLAYER_STATE_HIDDEN_TAB_INTERVAL_MS;
    }
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    const conn = (
      nav as (Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }) | undefined
    )?.connection;
    if (
      conn?.saveData ||
      conn?.effectiveType === '2g' ||
      conn?.effectiveType === 'slow-2g'
    ) {
      return PLAYER_STATE_CONSTRAINED_INTERVAL_MS;
    }
    const isMobileUa =
      typeof nav?.userAgent === 'string' &&
      /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent);
    if (this.lowPowerMode) {
      return Math.max(PLAYER_STATE_MOBILE_INTERVAL_MS, 85);
    }
    if (
      isMobileUa ||
      conn?.effectiveType === '3g' ||
      (this.latencyMs !== null && this.latencyMs >= 160)
    ) {
      return PLAYER_STATE_MOBILE_INTERVAL_MS;
    }
    return PLAYER_STATE_SEND_INTERVAL_MS;
  }

  public sendPlayerState(state: PlayerNetworkState, immediate = false): boolean {
    const now = performance.now();
    const minInterval = immediate
      ? PLAYER_STATE_MIN_URGENT_INTERVAL_MS
      : this.getAdaptivePlayerStateIntervalMs();
    if (now - this.lastPlayerStateSentAt < minInterval) {
      return false;
    }
    const check = validatePlayerStatePayload(state);
    if (!check.ok) {
      return false;
    }
    const compact = compactPlayerState(check.state);
    const sent = this.sendMessage('PLAYER_STATE', compact);
    if (sent) {
      this.lastPlayerStateSentAt = now;
    }
    return sent;
  }

  public sendEntitySync(payload: EntitySyncBatchPayload): boolean {
    const check = validateEntitySyncBatchPayload(payload);
    if (!check.ok) {
      return false;
    }
    return this.sendMessage<EntitySyncBatchPayload>('ENTITY_SYNC', check.payload);
  }

  public sendWorldSettingsUpdate(payload: WorldSettingsUpdatePayload): boolean {
    return this.sendMessage<WorldSettingsUpdatePayload>('WORLD_SETTINGS_UPDATE', payload);
  }

  public sendEnemyAttackPlayer(payload: EnemyAttackPlayerPayload): boolean {
    return this.sendMessage<EnemyAttackPlayerPayload>('ENEMY_ATTACK_PLAYER', payload);
  }

  public sendRepairWeapons(costCoins: number): boolean {
    if (!Number.isFinite(costCoins) || costCoins <= 0) return false;
    return this.sendMessage('REPAIR_WEAPONS', {
      costCoins: Math.max(1, Math.min(500, Math.round(costCoins))),
    });
  }

  public sendGameEvent(
    event: string,
    data?: Record<string, string | number | boolean | null>,
  ): boolean {
    const check = validateGameEventPayload({ event, data }, false);
    if (!check.ok) {
      return false;
    }
    return this.sendMessage<GameEventPayload>('GAME_EVENT', check.payload);
  }

  public async setReady(ready: boolean): Promise<MultiplayerRoomState | null> {
    if (!this.currentRoom) return null;
    const sent = this.sendMessage('READY', { ready });
    if (sent && this.localPlayerId) {
      this.currentRoom = {
        ...this.currentRoom,
        players: this.currentRoom.players.map((p) =>
          p.id === this.localPlayerId ? { ...p, isReady: ready } : p,
        ),
      };
      this.emit({ type: 'room-updated', room: this.currentRoom });
    }
    return this.currentRoom;
  }

  public async startGame(): Promise<void> {
    if (!this.workerBaseUrl || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new MultiplayerServiceUnavailableError(
        'Online match launch requires the Cloudflare Workers & Durable Objects backend.',
      );
    }
    if (!this.currentRoom || !this.localPlayerId) {
      throw new Error('You must be in a room to start the game.');
    }
    if (this.currentRoom.hostId !== this.localPlayerId) {
      throw new Error('Only the room host can start the game.');
    }
    const sent = this.sendMessage('START_GAME');
    if (!sent) {
      throw new Error('Failed to send START_GAME command to server.');
    }
  }

  public async startMatch(): Promise<void> {
    return this.startGame();
  }

  public createParty(): boolean {
    return this.sendMessage('PARTY_CREATE');
  }

  public inviteToParty(target: {
    targetPlayerId?: string;
    targetPublicProfileId?: string;
    targetPlayerName?: string;
  }): boolean {
    return this.sendMessage('PARTY_INVITE', target);
  }

  public acceptPartyInvite(inviteId: string): boolean {
    return this.sendMessage('PARTY_ACCEPT_INVITE', { inviteId });
  }

  public declinePartyInvite(inviteId: string): boolean {
    return this.sendMessage('PARTY_DECLINE_INVITE', { inviteId });
  }

  public leaveParty(): boolean {
    return this.sendMessage('PARTY_LEAVE');
  }

  public removePartyMember(targetPlayerId: string): boolean {
    return this.sendMessage('PARTY_KICK', { targetPlayerId });
  }

  public transferPartyLeader(targetPlayerId: string): boolean {
    return this.sendMessage('PARTY_TRANSFER_LEADER', { targetPlayerId });
  }

  public setPartyReady(ready: boolean): boolean {
    return this.sendMessage('PARTY_SET_READY', { ready });
  }

  public startCoopObjective(options: {
    type: CoopObjectiveType;
    title?: string;
    targetId?: string;
    targetX?: number;
    targetZ?: number;
    targetCount?: number;
  }): boolean {
    return this.sendMessage('PARTY_START_OBJECTIVE', options);
  }

  public cancelCoopObjective(): boolean {
    return this.sendMessage('PARTY_CANCEL_OBJECTIVE');
  }

  public sendCoopObjectiveProgress(objectiveId: string, amount = 1): boolean {
    return this.sendGameEvent('COOP_OBJECTIVE_PROGRESS', {
      objectiveId,
      amount: Math.max(1, Math.min(5, Math.round(amount))),
    });
  }

  public startCoopQuest(questId: string): boolean {
    if (!questId) return false;
    return this.sendMessage('COOP_QUEST_START', { questId });
  }

  public completeCoopQuest(questId: string): boolean {
    if (!questId) return false;
    return this.sendMessage('COOP_QUEST_COMPLETE', { questId });
  }

  public sendNpcDialogueState(npcId: string, state: 'talking' | 'idle'): boolean {
    if (!npcId) return false;
    return this.sendGameEvent('NPC_DIALOGUE_STATE', { npcId, state });
  }

  public sendPlayerBuildPlace(payload: {
    structureId: string;
    blueprintId: string;
    x: number;
    y: number;
    z: number;
    yaw: number;
    ownerName: string;
    permissionScope: 'owner' | 'friends' | 'party' | 'everyone';
  }): boolean {
    return this.sendGameEvent('PLAYER_BUILD_PLACE', payload);
  }

  public sendPlayerBuildRepair(structureId: string): boolean {
    return this.sendGameEvent('PLAYER_BUILD_REPAIR', { structureId });
  }

  public sendPlayerBuildUpgrade(structureId: string): boolean {
    return this.sendGameEvent('PLAYER_BUILD_UPGRADE', { structureId });
  }

  public sendPlayerBuildDemolish(structureId: string): boolean {
    return this.sendGameEvent('PLAYER_BUILD_DEMOLISH', { structureId });
  }

  public sendPlayerBuildPerms(
    structureId: string,
    permissionScope: 'owner' | 'friends' | 'party' | 'everyone',
  ): boolean {
    return this.sendGameEvent('PLAYER_BUILD_PERMS', { structureId, permissionScope });
  }

  public sendPlayerStorageTransfer(
    structureId: string,
    direction: 'deposit' | 'withdraw',
    itemId: string,
    count: number,
  ): boolean {
    return this.sendGameEvent('PLAYER_STORAGE_TRANSFER', {
      structureId,
      direction,
      itemId,
      count,
    });
  }

  public sendPlayerFarmTill(structureId: string): boolean {
    return this.sendGameEvent('PLAYER_FARM_TILL', { structureId });
  }

  public sendPlayerFarmPlant(structureId: string, cropId: string): boolean {
    return this.sendGameEvent('PLAYER_FARM_PLANT', { structureId, cropId });
  }

  public sendPlayerFarmWater(structureId: string): boolean {
    return this.sendGameEvent('PLAYER_FARM_WATER', { structureId });
  }

  public sendPlayerFarmHarvest(
    structureId: string,
    cropId?: string,
    villageId?: string,
  ): boolean {
    return this.sendGameEvent('PLAYER_FARM_HARVEST', {
      structureId,
      ...(cropId ? { cropId } : {}),
      ...(villageId ? { villageId } : {}),
    });
  }

  public sendVillageRepair(villageId: string, repairId: string): boolean {
    return this.sendGameEvent('VILLAGE_REPAIR', { villageId, repairId });
  }

  public sendVillageProject(villageId: string, projectId: string): boolean {
    return this.sendGameEvent('VILLAGE_PROJECT', { villageId, projectId });
  }

  public sendVillageDefenseWon(villageId: string): boolean {
    return this.sendGameEvent('VILLAGE_DEFENSE_WON', { villageId });
  }

  public sendMerchantBuy(villageId: string, offerId: string): boolean {
    return this.sendGameEvent('MERCHANT_BUY', { villageId, offerId });
  }

  public sendMerchantSell(
    villageId: string,
    itemId: string,
    count: number,
  ): boolean {
    return this.sendGameEvent('MERCHANT_SELL', { villageId, itemId, count });
  }

  public sendChatMessage(text: string): SendChatResult {
    if (
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN ||
      !this.currentRoom ||
      !this.localPlayerId
    ) {
      return { ok: false, code: 'NOT_CONNECTED' };
    }
    const cleaned = sanitizeChatText(text);
    if (!cleaned) {
      return { ok: false, code: 'EMPTY_CHAT_MESSAGE' };
    }
    if (cleaned.length > MAX_CHAT_MESSAGE_LENGTH) {
      return { ok: false, code: 'CHAT_TOO_LONG' };
    }

    const now = Date.now();
    if (now - this.lastChatSentAt < CHAT_RATE_COOLDOWN_MS) {
      return { ok: false, code: 'CHAT_SPAM_LIMITED' };
    }

    const normalized = cleaned.toLowerCase();
    if (normalized === this.lastChatNormalized && now - this.lastChatSentAt < 12_000) {
      this.duplicateChatStreak += 1;
      if (this.duplicateChatStreak >= 2) {
        return { ok: false, code: 'CHAT_DUPLICATE_SPAM' };
      }
    } else {
      this.duplicateChatStreak = 1;
    }

    const sent = this.sendMessage('ROOM_CHAT', { message: cleaned });
    if (!sent) {
      return { ok: false, code: 'NOT_CONNECTED' };
    }
    this.lastChatSentAt = now;
    this.lastChatNormalized = normalized;
    return { ok: true };
  }

  public getChatMessages(): RoomChatMessage[] {
    return this.chatMessages.slice();
  }

  public reportPlayer(
    targetPlayerId: string,
    reason: PlayerReportReason,
    details?: string,
  ): boolean {
    if (!this.localPlayerId || !this.currentRoom) return false;
    const check = validatePlayerReportPayload(
      { targetPlayerId, reason, ...(details ? { details } : {}) },
      this.localPlayerId,
    );
    if (!check.ok) {
      return false;
    }
    return this.sendMessage('PLAYER_REPORT', check.payload);
  }

  public mutePlayer(playerId: string, displayName: string): SocialModerationEntry[] {
    const next = this.socialProvider.mutePlayer(playerId, displayName);
    this.emitSocialUpdated();
    return next;
  }

  public unmutePlayer(playerId: string, displayName?: string): SocialModerationEntry[] {
    const next = this.socialProvider.unmutePlayer(playerId, displayName);
    this.emitSocialUpdated();
    return next;
  }

  public isPlayerMuted(playerId: string, displayName?: string): boolean {
    return this.socialProvider.isMuted(playerId, displayName);
  }

  public getMutedPlayers(): SocialModerationEntry[] {
    return this.socialProvider.getMutedPlayers();
  }

  public blockPlayer(playerId: string, displayName: string): SocialModerationEntry[] {
    const next = this.socialProvider.blockPlayer(playerId, displayName);
    const targetPlayer = this.currentRoom?.players.find(
      (p) => p.id === playerId || p.publicProfileId === playerId,
    );
    if (targetPlayer?.publicProfileId) {
      void ProfileManager.blockProfile(targetPlayer.publicProfileId);
    }
    this.emitSocialUpdated();
    return next;
  }

  public unblockPlayer(playerId: string, displayName?: string): SocialModerationEntry[] {
    const next = this.socialProvider.unblockPlayer(playerId, displayName);
    const targetPlayer = this.currentRoom?.players.find(
      (p) => p.id === playerId || p.publicProfileId === playerId,
    );
    if (targetPlayer?.publicProfileId) {
      void ProfileManager.unblockProfile(targetPlayer.publicProfileId);
    }
    this.emitSocialUpdated();
    return next;
  }

  public isPlayerBlocked(playerId: string, displayName?: string): boolean {
    if (this.socialProvider.isBlocked(playerId, displayName)) return true;
    const blocked = ProfileManager.getSnapshot().blockedPlayers;
    return blocked.some(
      (b) =>
        b.publicProfileId === playerId ||
        (displayName ? b.displayName.toLowerCase() === displayName.trim().toLowerCase() : false),
    );
  }

  public getBlockedPlayers(): SocialModerationEntry[] {
    return this.socialProvider.getBlockedPlayers();
  }

  public getPlayerProfileSummary(playerId: string): PlayerProfileSummary | null {
    const room = this.currentRoom;
    if (!room) return null;
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return null;
    return this.socialProvider.buildProfileSummary(player, room.roomName);
  }

  public getSocialAdapter(): ISocialFriendsAdapter {
    return this.socialProvider;
  }

  public async getFriends(): Promise<MultiplayerFriend[]> {
    return this.socialProvider.getFriends();
  }

  public async addFriend(displayName: string): Promise<MultiplayerFriend[]> {
    return this.socialProvider.addFriend(displayName);
  }

  public async removeFriend(friendId: string): Promise<MultiplayerFriend[]> {
    return this.socialProvider.removeFriend(friendId);
  }

  public async sendInvite(
    targetPlayerName: string,
    toPublicProfileId?: string,
    partyId?: string,
  ): Promise<MultiplayerInvite> {
    if (!this.workerBaseUrl) {
      throw new MultiplayerServiceUnavailableError(
        'Sending invites requires the online multiplayer backend.',
      );
    }
    if (!this.currentRoom) {
      throw new Error('Join or create a room before inviting friends.');
    }
    const cleanedTarget = targetPlayerName.trim().slice(0, 24);
    if (!cleanedTarget && !toPublicProfileId) {
      throw new Error('Enter a player name to invite.');
    }

    const localPlayer =
      this.currentRoom.players.find((p) => p.id === this.localPlayerId) ??
      this.currentRoom.players.find((p) => p.isLocal);
    const effectivePartyId =
      partyId ??
      (this.partyState.party &&
      this.partyState.party.leaderPlayerId === this.localPlayerId
        ? this.partyState.party.partyId
        : undefined);

    const res = await fetch(`${this.workerBaseUrl}/api/multiplayer/invites`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...AuthService.getBearerHeaders(),
      },
      body: JSON.stringify({
        roomId: this.currentRoom.roomId,
        fromPlayerId: this.localPlayerId ?? '',
        sessionToken: this.sessionToken ?? '',
        fromPlayerName: localPlayer?.displayName || loadSavedMultiplayerName(),
        toPlayerName: cleanedTarget,
        ...(toPublicProfileId ? { toPublicProfileId } : {}),
        ...(effectivePartyId ? { partyId: effectivePartyId } : {}),
      }),
    });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      message?: string;
      invite?: MultiplayerInviteRecord;
    } | null;

    if (!res.ok || !data?.ok || !data.invite) {
      throw new MultiplayerJoinError(
        mapJoinErrorCode(data?.error),
        data?.message || data?.error || 'Failed to send invitation.',
      );
    }

    return data.invite;
  }

  public async getInvites(playerName?: string): Promise<MultiplayerInvite[]> {
    if (!this.workerBaseUrl) {
      return [];
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return [];
    }
    const targetName = (playerName ?? loadSavedMultiplayerName('')).trim();
    const publicProfileId = ProfileManager.getProfile()?.publicProfileId ?? '';
    if (!targetName && !publicProfileId) return [];

    try {
      const res = await fetch(
        `${this.workerBaseUrl}/api/multiplayer/invites?playerName=${encodeURIComponent(targetName)}&publicProfileId=${encodeURIComponent(publicProfileId)}`,
        {
          method: 'GET',
          headers: {
            accept: 'application/json',
            ...AuthService.getBearerHeaders(),
          },
        },
      );
      if (!res.ok) return [];
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        invites?: MultiplayerInviteRecord[];
      } | null;

      const rawList: MultiplayerInvite[] = Array.isArray(data?.invites) ? data.invites : [];
      const list = rawList.filter(
        (inv) =>
          !this.isPlayerBlocked(
            inv.fromPublicProfileId ?? inv.fromPlayerId ?? '',
            inv.fromPlayerName,
          ),
      );
      this.emit({ type: 'invites-updated', invites: list });
      for (const inv of list) {
        if (!this.seenInviteIds.has(inv.inviteId)) {
          this.seenInviteIds.add(inv.inviteId);
          if (this.seenInviteIds.size > MAX_SEEN_INVITE_IDS) {
            const oldest = this.seenInviteIds.values().next();
            if (!oldest.done) this.seenInviteIds.delete(oldest.value);
          }
          this.emit({ type: 'invite-received', invite: inv });
        }
      }
      return list;
    } catch {
      return [];
    }
  }

  public async acceptInvite(
    inviteId: string,
    playerName?: string,
  ): Promise<MultiplayerRoomState> {
    if (!this.workerBaseUrl) {
      throw new MultiplayerServiceUnavailableError(
        'Accepting invites requires the online multiplayer backend.',
      );
    }

    const cleanedName = (playerName ?? loadSavedMultiplayerName('Adventurer')).trim() || 'Adventurer';
    const clientModMetadata = await this.resolveSanitizedClientModMetadata();
    const res = await fetch(`${this.workerBaseUrl}/api/multiplayer/invites/accept`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...AuthService.getBearerHeaders(),
      },
      body: JSON.stringify({
        inviteId,
        playerName: cleanedName,
        ...(clientModMetadata ? { clientModMetadata } : {}),
      }),
    });
    const data = (await res.json().catch(() => null)) as RoomSessionResponse | null;

    if (!res.ok || !data?.ok || !data.room || !data.playerId || !data.sessionToken) {
      throw new MultiplayerJoinError(
        mapJoinErrorCode(data?.error),
        data?.message || data?.error || 'ROOM NOT FOUND',
        {
          modCompatibility: data?.modCompatibility
            ? this.enrichLocalCompatibilityReport(data.modCompatibility)
            : undefined,
          hostModMetadata: data?.hostModMetadata,
        },
      );
    }

    const roomState = toRoomState(data.room, data.playerId);
    saveRoomResumeToken(roomState.roomId, data.resumeToken);
    this.localPlayerId = data.playerId;
    this.sessionToken = data.sessionToken;
    this.currentRoom = roomState;
    this.latestWorldSnapshot = null;
    this.latestProgression = null;
    this.latestVitals = null;
    this.coopQuests.clear();
    this.bossEncounters.clear();
    this.chatMessages = [];
    this.emit({ type: 'chat-history', messages: [] });
    this.emit({ type: 'room-updated', room: roomState });

    await this.connect({
      roomId: roomState.roomId,
      playerId: data.playerId,
      sessionToken: data.sessionToken,
      wsPath: data.wsPath,
    });

    return this.currentRoom ?? roomState;
  }

  public async declineInvite(inviteId: string): Promise<void> {
    if (!this.workerBaseUrl) return;
    await fetch(`${this.workerBaseUrl}/api/multiplayer/invites/decline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inviteId }),
    }).catch(() => {});
  }

  public startInvitePolling(playerName: string): void {
    const cleaned = playerName.trim();
    if (!this.workerBaseUrl || !cleaned) {
      this.stopInvitePolling();
      return;
    }
    this.invitePollPlayerName = cleaned;
    if (this.invitePollTimer !== null) return;

    void this.getInvites(cleaned).catch(() => {});
    this.invitePollTimer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      if (this.invitePollPlayerName && !this.currentRoom) {
        void this.getInvites(this.invitePollPlayerName).catch(() => {});
      }
    }, INVITE_POLL_INTERVAL_MS);
  }

  public stopInvitePolling(): void {
    this.invitePollPlayerName = null;
    if (this.invitePollTimer !== null) {
      window.clearInterval(this.invitePollTimer);
      this.invitePollTimer = null;
    }
  }

  public subscribe(
    listener: (event: MultiplayerServiceEvent) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private handleIncomingMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let envelope: NetworkEnvelope;
    try {
      envelope = JSON.parse(raw) as NetworkEnvelope;
    } catch {
      return;
    }
    if (!envelope || typeof envelope !== 'object') return;

    switch (envelope.type) {
      case 'CONNECT': {
        const p = envelope.payload as { playerId?: string } | undefined;
        if (p?.playerId && !this.localPlayerId) {
          this.localPlayerId = p.playerId;
        }
        break;
      }
      case 'PING': {
        this.sendMessage('PONG', envelope.payload);
        break;
      }
      case 'PONG': {
        if (this.lastPingSentAt > 0) {
          this.latencyMs = Math.max(1, Math.round(performance.now() - this.lastPingSentAt));
          const quality = this.getConnectionQuality();
          if (this.currentRoom && this.localPlayerId) {
            this.currentRoom = {
              ...this.currentRoom,
              players: this.currentRoom.players.map((p) =>
                p.id === this.localPlayerId
                  ? { ...p, pingMs: this.latencyMs, connectionQuality: quality }
                  : p,
              ),
            };
            this.emit({ type: 'room-updated', room: this.currentRoom });
          }
        }
        break;
      }
      case 'ROOM_STATE': {
        const snap = envelope.payload as AuthoritativeRoomSnapshot | undefined;
        if (snap && isValidRoomId(snap.roomId)) {
          this.currentRoom = toRoomState(snap, this.localPlayerId);
          this.emit({ type: 'room-updated', room: this.currentRoom });
        }
        break;
      }
      case 'PLAYER_STATE': {
        const check = parseRelayedPlayerStatePayload(envelope.payload);
        if (check.ok && envelope.playerId !== this.localPlayerId) {
          if (this.currentRoom) {
            this.currentRoom = {
              ...this.currentRoom,
              players: this.currentRoom.players.map((p) =>
                p.id === envelope.playerId
                  ? {
                      ...p,
                      networkEntityId:
                        check.state.networkEntityId ?? p.networkEntityId,
                      health:
                        typeof check.state.health === 'number'
                          ? check.state.health
                          : p.health,
                      maxHealth:
                        typeof check.state.maxHealth === 'number'
                          ? check.state.maxHealth
                          : p.maxHealth,
                      isDead:
                        typeof check.state.isDead === 'boolean'
                          ? check.state.isDead
                          : p.isDead,
                      state: check.state,
                    }
                  : p,
              ),
            };
          }
          this.emit({
            type: 'player-state',
            playerId: envelope.playerId,
            state: check.state,
          });
        }
        break;
      }
      case 'PLAYER_VITALS': {
        const vitals = envelope.payload as AuthoritativePlayerVitals | undefined;
        if (vitals && typeof vitals.playerId === 'string') {
          if (vitals.playerId === this.localPlayerId) {
            this.latestVitals = vitals;
          }
          if (this.currentRoom) {
            this.currentRoom = {
              ...this.currentRoom,
              players: this.currentRoom.players.map((p) =>
                p.id === vitals.playerId
                  ? {
                      ...p,
                      networkEntityId: vitals.networkEntityId || p.networkEntityId,
                      health: vitals.health,
                      maxHealth: vitals.maxHealth,
                      isDead: vitals.isDead,
                    }
                  : p,
              ),
            };
          }
          this.emit({ type: 'player-vitals', vitals });
        }
        break;
      }
      case 'PROGRESSION_UPDATED': {
        const progression = envelope.payload as AuthoritativeProgressionState | undefined;
        if (progression && typeof progression.playerId === 'string') {
          if (progression.playerId === this.localPlayerId) {
            this.latestProgression = progression;
          }
          this.emit({ type: 'progression-updated', progression });
        }
        break;
      }
      case 'WORLD_TIME_CHANGED': {
        const payload = envelope.payload as
          | {
              worldTime?: AuthoritativeWorldTimeState;
              serverTimestamp?: number;
              updatedBy?: string;
            }
          | undefined;
        if (payload?.worldTime) {
          if (this.currentRoom) {
            this.currentRoom = {
              ...this.currentRoom,
              worldTime: payload.worldTime,
              serverTimestamp: payload.serverTimestamp ?? Date.now(),
            };
          }
          this.emit({
            type: 'world-time-changed',
            worldTime: payload.worldTime,
            serverTimestamp: payload.serverTimestamp ?? Date.now(),
            updatedBy: payload.updatedBy,
          });
        }
        break;
      }
      case 'WORLD_DAY_CHANGED': {
        const payload = envelope.payload as
          | {
              dayCount?: number;
              worldHours?: number;
              serverTimestamp?: number;
              updatedBy?: string;
            }
          | undefined;
        if (typeof payload?.dayCount === 'number' && typeof payload?.worldHours === 'number') {
          this.emit({
            type: 'world-day-changed',
            dayCount: payload.dayCount,
            worldHours: payload.worldHours,
            serverTimestamp: payload.serverTimestamp ?? Date.now(),
            updatedBy: payload.updatedBy,
          });
        }
        break;
      }
      case 'WORLD_TIME_SCALE_CHANGED': {
        const payload = envelope.payload as
          | {
              timeScale?: number;
              paused?: boolean;
              worldTime?: AuthoritativeWorldTimeState;
              serverTimestamp?: number;
              updatedBy?: string;
            }
          | undefined;
        if (payload?.worldTime && typeof payload.timeScale === 'number') {
          if (this.currentRoom) {
            this.currentRoom = {
              ...this.currentRoom,
              worldTime: payload.worldTime,
              serverTimestamp: payload.serverTimestamp ?? Date.now(),
            };
          }
          this.emit({
            type: 'world-time-scale-changed',
            timeScale: payload.timeScale,
            paused: Boolean(payload.paused),
            worldTime: payload.worldTime,
            serverTimestamp: payload.serverTimestamp ?? Date.now(),
            updatedBy: payload.updatedBy,
          });
        }
        break;
      }
      case 'WORLD_WEATHER_CHANGED': {
        const payload = envelope.payload as
          | {
              worldWeather?: AuthoritativeWorldWeatherState;
              triggerLightning?: boolean;
              serverTimestamp?: number;
              updatedBy?: string;
            }
          | undefined;
        if (payload?.worldWeather) {
          if (this.currentRoom) {
            this.currentRoom = {
              ...this.currentRoom,
              worldWeather: payload.worldWeather,
              serverTimestamp: payload.serverTimestamp ?? Date.now(),
            };
          }
          this.emit({
            type: 'world-weather-changed',
            worldWeather: payload.worldWeather,
            triggerLightning: payload.triggerLightning,
            serverTimestamp: payload.serverTimestamp ?? Date.now(),
            updatedBy: payload.updatedBy,
          });
        }
        break;
      }
      case 'WORLD_WEATHER_INTENSITY_CHANGED': {
        const payload = envelope.payload as
          | {
              intensity?: number;
              worldWeather?: AuthoritativeWorldWeatherState;
              serverTimestamp?: number;
              updatedBy?: string;
            }
          | undefined;
        if (payload?.worldWeather && typeof payload.intensity === 'number') {
          if (this.currentRoom) {
            this.currentRoom = {
              ...this.currentRoom,
              worldWeather: payload.worldWeather,
              serverTimestamp: payload.serverTimestamp ?? Date.now(),
            };
          }
          this.emit({
            type: 'world-weather-intensity-changed',
            intensity: payload.intensity,
            worldWeather: payload.worldWeather,
            serverTimestamp: payload.serverTimestamp ?? Date.now(),
            updatedBy: payload.updatedBy,
          });
        }
        break;
      }
      case 'WORLD_SETTINGS_UPDATED': {
        const payload = envelope.payload as
          | {
              worldSettingsPermission?: WorldSettingsPermission;
              friendlyFire?: boolean;
              worldTime?: AuthoritativeWorldTimeState;
              worldWeather?: AuthoritativeWorldWeatherState;
              triggerLightning?: boolean;
              serverTimestamp?: number;
              updatedBy?: string;
            }
          | undefined;
        if (payload?.worldTime && payload?.worldWeather) {
          const perm = payload.worldSettingsPermission ?? 'HOST_ONLY';
          if (this.currentRoom) {
            this.currentRoom = {
              ...this.currentRoom,
              worldSettingsPermission: perm,
              ...(typeof payload.friendlyFire === 'boolean' && this.currentRoom.worldSettings
                ? {
                    worldSettings: {
                      ...this.currentRoom.worldSettings,
                      friendlyFire: payload.friendlyFire,
                    },
                  }
                : {}),
              worldTime: payload.worldTime,
              worldWeather: payload.worldWeather,
              serverTimestamp: payload.serverTimestamp ?? Date.now(),
            };
            this.emit({ type: 'room-updated', room: this.currentRoom });
          }
          this.emit({
            type: 'world-settings-updated',
            worldSettingsPermission: perm,
            worldTime: payload.worldTime,
            worldWeather: payload.worldWeather,
            triggerLightning: payload.triggerLightning,
            serverTimestamp: payload.serverTimestamp ?? Date.now(),
            updatedBy: payload.updatedBy,
          });
        }
        break;
      }
      case 'POSITION_CORRECTION': {
        const correction = envelope.payload as PositionCorrectionPayload | undefined;
        if (
          correction &&
          typeof correction.x === 'number' &&
          typeof correction.y === 'number' &&
          typeof correction.z === 'number'
        ) {
          this.emit({ type: 'position-correction', correction });
        }
        break;
      }
      case 'GAME_EVENT': {
        const check = validateGameEventPayload(envelope.payload, true);
        if (check.ok) {
          this.emit({
            type: 'game-event',
            playerId: envelope.playerId,
            payload: check.payload,
          });
        }
        break;
      }
      case 'ENTITY_SYNC': {
        const check = validateEntitySyncBatchPayload(envelope.payload);
        if (check.ok && envelope.playerId !== this.localPlayerId) {
          this.emit({
            type: 'entity-sync',
            playerId: envelope.playerId,
            payload: check.payload,
          });
        }
        break;
      }
      case 'WORLD_SNAPSHOT': {
        const snap = envelope.payload as RoomWorldSnapshotPayload | undefined;
        if (snap && typeof snap === 'object') {
          this.latestWorldSnapshot = snap;
          if (this.currentRoom) {
            this.currentRoom = {
              ...this.currentRoom,
              ...(snap.worldSettingsPermission
                ? { worldSettingsPermission: snap.worldSettingsPermission }
                : {}),
              ...(snap.worldSettings ? { worldSettings: snap.worldSettings } : {}),
              ...(snap.worldTime ? { worldTime: snap.worldTime } : {}),
              ...(snap.worldWeather ? { worldWeather: snap.worldWeather } : {}),
              ...(snap.serverTimestamp !== undefined
                ? { serverTimestamp: snap.serverTimestamp }
                : {}),
              ...(snap.modMetadata ? { modMetadata: snap.modMetadata } : {}),
            };
          }
          if (snap.partyState) {
            this.partyState = snap.partyState;
            this.emit({ type: 'party-updated', partyState: snap.partyState });
          }
          this.coopQuests.clear();
          if (Array.isArray(snap.coopQuests)) {
            for (const q of snap.coopQuests) {
              if (q && typeof q.questId === 'string') {
                this.coopQuests.set(q.questId, q);
              }
            }
          }
          this.bossEncounters.clear();
          if (Array.isArray(snap.bossEncounters)) {
            for (const b of snap.bossEncounters) {
              if (b && typeof b.bossId === 'string') {
                this.bossEncounters.set(b.bossId, b);
              }
            }
          }
          this.emit({
            type: 'world-snapshot',
            snapshot: snap,
          });
        }
        break;
      }
      case 'START_GAME': {
        const payload = envelope.payload as
          | {
              roomId?: string;
              roomCode?: string;
              roomName?: string;
              worldName?: string;
              seed?: number;
              worldType?: MultiplayerRoomState['worldType'];
              difficulty?: MultiplayerRoomState['difficulty'];
              worldSettingsPermission?: WorldSettingsPermission;
              worldSettings?: AuthoritativeWorldSettings;
              worldTime?: AuthoritativeWorldTimeState;
              worldWeather?: AuthoritativeWorldWeatherState;
              requireAllReady?: boolean;
              modMetadata?: ProtocolWorldModMetadata;
            }
          | undefined;
        const room = this.currentRoom;
        const worldType =
          payload?.worldSettings?.worldType ??
          payload?.worldType ??
          room?.worldType ??
          'normal';
        const difficulty =
          payload?.worldSettings?.difficulty ??
          payload?.difficulty ??
          room?.difficulty ??
          'normal';
        const seed =
          typeof payload?.seed === 'number' ? payload.seed : (room?.seed ?? 0);
        const worldSettingsPermission =
          payload?.worldSettingsPermission ?? room?.worldSettingsPermission ?? 'HOST_ONLY';
        const worldSettings =
          payload?.worldSettings ??
          room?.worldSettings ??
          defaultWorldSettings(worldType, difficulty);
        const worldTime = payload?.worldTime ?? room?.worldTime;
        const worldWeather = payload?.worldWeather ?? room?.worldWeather;
        const requireAllReady =
          typeof payload?.requireAllReady === 'boolean'
            ? payload.requireAllReady
            : (room?.requireAllReady ?? true);
        const resolvedModMetadata = payload?.modMetadata ?? room?.modMetadata;

        if (this.currentRoom) {
          this.currentRoom = {
            ...this.currentRoom,
            status: 'in-game',
            locked: true,
            seed,
            worldType,
            difficulty,
            worldSettingsPermission,
            worldSettings,
            ...(worldTime ? { worldTime } : {}),
            ...(worldWeather ? { worldWeather } : {}),
            ...(resolvedModMetadata ? { modMetadata: resolvedModMetadata } : {}),
            requireAllReady,
          };
          this.emit({ type: 'room-updated', room: this.currentRoom });
        }

        const startInfo: MultiplayerGameStartInfo = {
          roomId: payload?.roomId ?? room?.roomId ?? envelope.roomId,
          roomCode: payload?.roomCode ?? room?.roomCode ?? '',
          roomName: payload?.roomName ?? room?.roomName ?? 'World of Adventure',
          worldName:
            payload?.worldName ?? room?.worldName ?? room?.roomName ?? 'World of Adventure',
          seed,
          worldType,
          difficulty,
          worldSettingsPermission,
          worldSettings,
          worldTime,
          worldWeather,
          requireAllReady,
          isHost: Boolean(room && this.localPlayerId && room.hostId === this.localPlayerId),
          localPlayerId: this.localPlayerId ?? '',
          players: this.currentRoom?.players ?? room?.players ?? [],
          ...(resolvedModMetadata ? { modMetadata: resolvedModMetadata } : {}),
        };
        this.authoritativeStartInfo = startInfo;
        this.emit({
          type: 'game-started',
          info: startInfo,
        });
        break;
      }
      case 'HOST_TRANSFERRED': {
        const payload = envelope.payload as HostTransferredPayload | undefined;
        if (payload?.newHostId && this.currentRoom) {
          this.currentRoom = {
            ...this.currentRoom,
            hostId: payload.newHostId,
            hostName: payload.newHostName,
            players: this.currentRoom.players.map((p) => ({
              ...p,
              isHost: p.id === payload.newHostId,
              isReady: p.id === payload.newHostId ? true : p.isReady,
            })),
          };
          this.emit({ type: 'room-updated', room: this.currentRoom });
          this.emit({
            type: 'host-transferred',
            previousHostId: payload.previousHostId,
            newHostId: payload.newHostId,
            newHostName: payload.newHostName,
          });
        }
        break;
      }
      case 'PLAYER_KICKED': {
        const payload = envelope.payload as PlayerKickedPayload | undefined;
        if (payload?.targetPlayerId) {
          const isLocalTarget = payload.targetPlayerId === this.localPlayerId;
          if (isLocalTarget) {
            this.disconnect();
          }
          this.emit({
            type: 'player-kicked',
            targetPlayerId: payload.targetPlayerId,
            targetDisplayName: payload.targetDisplayName,
            isLocalTarget,
          });
        }
        break;
      }
      case 'ROOM_CLOSED': {
        const payload = envelope.payload as RoomClosedPayload | undefined;
        deleteRoomResumeToken(this.currentRoom?.roomId);
        this.disconnect();
        this.emit({
          type: 'room-closed',
          reason: payload?.reason ?? 'Host closed the room.',
        });
        break;
      }
      case 'ROOM_CHAT': {
        const msg = parseRelayedChatMessage(envelope.payload);
        if (msg) {
          if (!this.chatMessages.some((m) => m.id === msg.id)) {
            this.chatMessages = [...this.chatMessages, msg].slice(-CHAT_HISTORY_LIMIT);
          }
          this.emit({ type: 'chat-message', message: msg });
        }
        break;
      }
      case 'CHAT_HISTORY': {
        const payload = envelope.payload as ChatHistoryPayload | undefined;
        const incoming = Array.isArray(payload?.messages)
          ? payload.messages
              .map((m) => parseRelayedChatMessage(m))
              .filter((m): m is RoomChatMessage => Boolean(m))
          : [];
        const mergedMap = new Map<string, RoomChatMessage>();
        for (const msg of incoming) {
          mergedMap.set(msg.id, msg);
        }
        for (const msg of this.chatMessages) {
          if (!mergedMap.has(msg.id)) {
            mergedMap.set(msg.id, msg);
          }
        }
        this.chatMessages = Array.from(mergedMap.values())
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-CHAT_HISTORY_LIMIT);
        this.emit({ type: 'chat-history', messages: this.chatMessages.slice() });
        break;
      }
      case 'REPORT_ACK': {
        const ack = envelope.payload as ReportAckPayload | undefined;
        if (ack && typeof ack.reportId === 'string' && typeof ack.targetPlayerId === 'string') {
          this.emit({ type: 'report-submitted', ack });
        }
        break;
      }
      case 'PARTY_STATE': {
        const snap = envelope.payload as PartyStateSnapshot | undefined;
        if (snap && typeof snap === 'object') {
          this.partyState = {
            party: snap.party ?? null,
            pendingInvites: Array.isArray(snap.pendingInvites) ? snap.pendingInvites : [],
            outgoingInvites: Array.isArray(snap.outgoingInvites) ? snap.outgoingInvites : [],
          };
          this.emit({ type: 'party-updated', partyState: this.partyState });
        }
        break;
      }
      case 'PARTY_INVITE_RECEIVED': {
        const invite = envelope.payload as PartyInviteRecord | undefined;
        if (invite && typeof invite.inviteId === 'string') {
          if (!this.partyState.pendingInvites.some((i) => i.inviteId === invite.inviteId)) {
            this.partyState = {
              ...this.partyState,
              pendingInvites: [invite, ...this.partyState.pendingInvites],
            };
            this.emit({ type: 'party-updated', partyState: this.partyState });
          }
          this.emit({ type: 'party-invite-received', invite });
        }
        break;
      }
      case 'PARTY_OBJECTIVE_UPDATED': {
        const objective = envelope.payload as CoopObjectiveState | undefined;
        if (objective && typeof objective.objectiveId === 'string') {
          if (this.partyState.party && this.partyState.party.partyId === objective.partyId) {
            this.partyState = {
              ...this.partyState,
              party: {
                ...this.partyState.party,
                activeObjective: objective,
              },
            };
            this.emit({ type: 'party-updated', partyState: this.partyState });
          }
          this.emit({ type: 'party-objective-updated', objective });
        }
        break;
      }
      case 'PARTY_OBJECTIVE_COMPLETED': {
        const objective = envelope.payload as CoopObjectiveState | undefined;
        if (objective && typeof objective.objectiveId === 'string') {
          if (this.partyState.party && this.partyState.party.partyId === objective.partyId) {
            this.partyState = {
              ...this.partyState,
              party: {
                ...this.partyState.party,
                activeObjective: objective,
              },
            };
            this.emit({ type: 'party-updated', partyState: this.partyState });
          }
          this.emit({ type: 'party-objective-completed', objective });
        }
        break;
      }
      case 'COOP_QUEST_UPDATED': {
        const coopQuest = envelope.payload as CoopQuestStateRecord | undefined;
        if (coopQuest && typeof coopQuest.questId === 'string') {
          this.coopQuests.set(coopQuest.questId, coopQuest);
          this.emit({ type: 'coop-quest-updated', coopQuest });
        }
        break;
      }
      case 'BOSS_STATE_UPDATED': {
        const boss = envelope.payload as BossEncounterState | undefined;
        if (boss && typeof boss.bossId === 'string') {
          this.bossEncounters.set(boss.bossId, boss);
          this.emit({ type: 'boss-state-updated', boss });
        }
        break;
      }
      case 'LOOT_GRANTED': {
        const loot = envelope.payload as LootGrantPayload | undefined;
        if (loot && typeof loot.grantId === 'string') {
          this.emit({ type: 'loot-granted', loot });
        }
        break;
      }
      case 'ERROR': {
        const err = envelope.payload as ErrorPayload | undefined;
        if (err?.code === 'ROOM_EXPIRED' || err?.code === 'ROOM_NOT_FOUND') {
          deleteRoomResumeToken(this.currentRoom?.roomId);
        }
        this.emit({
          type: 'error',
          code: err?.code,
          message: err?.message ?? 'Multiplayer server rejected the request.',
        });
        break;
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const intervalMs =
      this.currentRoom?.status === 'waiting'
        ? Math.min(HEARTBEAT_INTERVAL_MS, 4000)
        : HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        if (
          this.lastInboundAt > 0 &&
          Date.now() - this.lastInboundAt > INBOUND_SILENCE_TIMEOUT_MS
        ) {
          // Silent half-open socket timeout (e.g. Wi-Fi/mobile handoff without TCP FIN)
          this.closeSocketOnly();
          if (!this.intentionalDisconnect && this.currentRoom && this.lastWsPath) {
            this.scheduleReconnect();
          }
          return;
        }
        this.lastPingSentAt = performance.now();
        this.sendMessage('PING', { clientSentAt: Date.now() });
      }
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearNetworkProbeTimer(): void {
    if (this.networkProbeTimer !== null) {
      window.clearTimeout(this.networkProbeTimer);
      this.networkProbeTimer = null;
    }
  }

  private bindNetworkListeners(): void {
    if (this.networkListenersBound || typeof window === 'undefined') return;
    this.networkListenersBound = true;
    const abort = new AbortController();
    this.networkListenerAbort = abort;
    const signal = abort.signal;

    window.addEventListener(
      'offline',
      () => {
        if (
          this.intentionalDisconnect ||
          !this.currentRoom ||
          !this.lastWsPath
        ) {
          return;
        }
        this.closeSocketOnly();
        if (!this.isReconnectingLoop) {
          this.scheduleReconnect();
        }
      },
      { signal },
    );

    const handleNetworkRestoredOrChanged = () => {
      if (
        this.intentionalDisconnect ||
        !this.currentRoom ||
        !this.lastWsPath
      ) {
        return;
      }
      if (
        this.connectionState === 'reconnecting' ||
        this.connectionState === 'error'
      ) {
        // Wake up exponential backoff immediately on Wi-Fi / mobile / online restoration
        if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          this.scheduleReconnect(true);
        }
      } else if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        // Probe socket liveness right away after Wi-Fi / mobile switch
        this.clearNetworkProbeTimer();
        this.lastPingSentAt = performance.now();
        this.sendMessage('PING', { clientSentAt: Date.now() });
        this.networkProbeTimer = window.setTimeout(() => {
          this.networkProbeTimer = null;
          if (
            !this.intentionalDisconnect &&
            this.currentRoom &&
            this.lastWsPath &&
            this.connectionState === 'connected'
          ) {
            this.closeSocketOnly();
            this.scheduleReconnect(true);
          }
        }, LIVENESS_PROBE_TIMEOUT_MS);
      }
    };

    window.addEventListener('online', handleNetworkRestoredOrChanged, { signal });

    const netConn = (
      navigator as Navigator & {
        connection?: {
          addEventListener?: (
            type: string,
            listener: () => void,
            options?: { signal?: AbortSignal },
          ) => void;
        };
      }
    ).connection;
    netConn?.addEventListener?.('change', handleNetworkRestoredOrChanged, { signal });
  }

  public dispose(): void {
    this.stopInvitePolling();
    this.disconnect();
    this.networkListenerAbort?.abort();
    this.networkListenerAbort = null;
    this.networkListenersBound = false;
    this.listeners.clear();
    this.seenInviteIds.clear();
  }

  private async probeRoomStillAlive(): Promise<'alive' | 'gone' | 'unreachable'> {
    if (!this.workerBaseUrl || !this.currentRoom) return 'unreachable';
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return 'unreachable';
    }
    try {
      const res = await fetch(
        `${this.workerBaseUrl}/api/multiplayer/rooms/${encodeURIComponent(this.currentRoom.roomId)}`,
        {
          method: 'GET',
          headers: { accept: 'application/json' },
        },
      );
      if (res.status === 404 || res.status === 410) {
        return 'gone';
      }
      if (!res.ok) {
        return 'unreachable';
      }
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        room?: AuthoritativeRoomSnapshot;
      } | null;
      if (!data?.ok || !data.room) {
        return 'gone';
      }
      if (
        this.localPlayerId &&
        !data.room.players.some((p) => p.playerId === this.localPlayerId)
      ) {
        return 'gone';
      }
      return 'alive';
    } catch {
      return 'unreachable';
    }
  }

  private scheduleReconnect(immediate = false): void {
    if (this.intentionalDisconnect || !this.currentRoom || !this.lastWsPath) {
      return;
    }
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.isReconnectingLoop = false;
      this.clearReconnectTimer();
      this.setConnectionState('error');
      this.emit({
        type: 'error',
        code: 'RECONNECT_EXHAUSTED',
        message: 'Lost connection to multiplayer room server.',
      });
      return;
    }

    this.clearReconnectTimer();
    this.isReconnectingLoop = true;
    const rawDelay = Math.min(
      MAX_RECONNECT_DELAY_MS,
      BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts),
    );
    // Add ±20% jitter to exponential backoff to avoid thundering-herd reconnect storms
    const jitterFactor = 0.8 + Math.random() * 0.4;
    const delayMs = immediate ? 60 : Math.min(MAX_RECONNECT_DELAY_MS, Math.round(rawDelay * jitterFactor));
    this.reconnectAttempts += 1;
    this.setConnectionState('reconnecting');

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.intentionalDisconnect || !this.currentRoom || !this.lastWsPath) {
        return;
      }
      void this.connect().catch(async () => {
        if (this.intentionalDisconnect || !this.currentRoom || !this.lastWsPath) {
          return;
        }
        const status = await this.probeRoomStillAlive();
        if (this.intentionalDisconnect || !this.currentRoom) return;
        if (status === 'gone') {
          deleteRoomResumeToken(this.currentRoom?.roomId);
          this.disconnect();
          this.emit({
            type: 'room-closed',
            reason: 'The multiplayer room closed or your session timed out.',
          });
          return;
        }
        this.scheduleReconnect();
      });
    }, delayMs);
  }

  private closeSocketOnly(): void {
    this.stopHeartbeat();
    this.clearNetworkProbeTimer();
    if (this.socketListenerAbort) {
      this.socketListenerAbort.abort();
      this.socketListenerAbort = null;
    }
    if (this.socket) {
      const sock = this.socket;
      this.socket = null;
      try {
        sock.close(1000);
      } catch {
        // Ignore close errors
      }
    }
  }

  private setConnectionState(next: MultiplayerConnectionState): void {
    const attempt =
      next === 'reconnecting'
        ? this.reconnectAttempts
        : next === 'error'
          ? this.reconnectAttempts
          : 0;
    const changed = this.connectionState !== next || next === 'reconnecting';
    this.connectionState = next;
    if (changed) {
      this.emit({
        type: 'connection-changed',
        state: next,
        attempt,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
      });
    }
  }

  private emitSocialUpdated(): void {
    this.emit({
      type: 'social-updated',
      muted: this.socialProvider.getMutedPlayers(),
      blocked: this.socialProvider.getBlockedPlayers(),
    });
  }

  private emit(event: MultiplayerServiceEvent): void {
    this.listeners.forEach((fn) => {
      try {
        fn(event);
      } catch {
        // Never allow listener errors to crash multiplayer networking
      }
    });
  }
}

export function createMultiplayerService(
  socialProvider?: ISocialFriendsAdapter,
): IMultiplayerService {
  logMultiplayerDiagnosticOnce();
  return new MultiplayerService(resolveMultiplayerServerUrl(), socialProvider);
}
