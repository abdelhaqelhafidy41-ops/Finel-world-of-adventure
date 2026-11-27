import {
  MAX_REPAIR_COST_COINS,
  MAX_WEATHER_DURATION_MS,
  MAX_WS_MESSAGE_BYTES,
  MULTIPLAYER_PROTOCOL_VERSION,
  findForbiddenAuthorityKey,
  isValidClientMessageType,
  isValidCoopObjectiveType,
  isValidPlayerId,
  isValidRoomId,
  sanitizeDisplayName,
  validateChatMessageInput,
  validateEntitySyncBatchPayload,
  validateGameEventPayload,
  validatePlayerReportPayload,
  validatePlayerStatePayload,
  type ClientMessageType,
  type CoopObjectiveType,
  type EnemyAttackPlayerPayload,
  type EntitySyncBatchPayload,
  type GameEventPayload,
  type NetworkEnvelope,
  type PlayerNetworkState,
  type PlayerReportPayload,
  type RepairWeaponsPayload,
  type UpdateRoomSettingsPayload,
  type WorldSettingsUpdatePayload,
  type WorldTimePreset,
  type WorldWeatherState,
} from '../../../shared/multiplayerProtocol';

const VALID_TIME_PRESETS = new Set<WorldTimePreset>(['sunrise', 'noon', 'sunset', 'midnight']);
const VALID_WEATHER_STATES = new Set<WorldWeatherState>([
  'clear',
  'cloudy',
  'overcast',
  'rain',
  'storm',
  'fog',
]);

export interface ValidatedClientEnvelope {
  type: ClientMessageType;
  roomId: string;
  playerId: string;
  seq?: number;
  timestamp: number;
  playerState?: PlayerNetworkState;
  gameEvent?: GameEventPayload;
  entitySync?: EntitySyncBatchPayload;
  chatMessage?: string;
  playerReport?: PlayerReportPayload;
  ready?: boolean;
  displayName?: string;
  targetPlayerId?: string;
  roomSettings?: UpdateRoomSettingsPayload;
  worldSettingsUpdate?: WorldSettingsUpdatePayload;
  enemyAttackPlayer?: EnemyAttackPlayerPayload;
  repairWeapons?: RepairWeaponsPayload;
  pingId?: number;
  clientSentAt?: number;
  partyInvite?: {
    targetPlayerId?: string;
    targetPublicProfileId?: string;
    targetPlayerName?: string;
  };
  partyInviteResponse?: {
    inviteId: string;
  };
  partyObjectiveStart?: {
    type: CoopObjectiveType;
    title?: string;
    targetId?: string;
    targetX?: number;
    targetZ?: number;
    targetCount?: number;
  };
  coopQuestAction?: {
    questId: string;
    objectiveId?: string;
    title?: string;
    targetCount?: number;
    targetEnemyType?: string;
  };
}

export function getRawByteLength(data: string | ArrayBuffer): number {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data).byteLength;
  }
  return data.byteLength;
}

/**
 * Parses and validates an untrusted client WebSocket payload against bound session identity.
 */
export function validateClientMessage(
  rawData: string | ArrayBuffer,
  boundRoomId: string,
  boundPlayerId: string,
  isPlayerHost: boolean,
): { ok: true; message: ValidatedClientEnvelope } | { ok: false; code: string; reason: string } {
  const byteLength = getRawByteLength(rawData);
  if (byteLength === 0 || byteLength > MAX_WS_MESSAGE_BYTES) {
    return {
      ok: false,
      code: 'MESSAGE_SIZE_EXCEEDED',
      reason: `Message byte size (${byteLength}) out of allowed 1..${MAX_WS_MESSAGE_BYTES} range.`,
    };
  }

  let text: string;
  if (typeof rawData === 'string') {
    text = rawData;
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(rawData);
    } catch {
      return {
        ok: false,
        code: 'INVALID_ENCODING',
        reason: 'Message must be valid UTF-8 JSON.',
      };
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      code: 'INVALID_JSON',
      reason: 'Message is not valid JSON.',
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      code: 'INVALID_ENVELOPE',
      reason: 'Envelope must be a JSON object.',
    };
  }

  const envObj = parsed as Record<string, unknown>;
  const rootForbidden = findForbiddenAuthorityKey(envObj);
  if (rootForbidden) {
    return {
      ok: false,
      code: 'FORBIDDEN_CLIENT_AUTHORITY',
      reason: `Client cannot supply authoritative field "${rootForbidden}".`,
    };
  }

  const env = parsed as Partial<Omit<NetworkEnvelope, 'type'> & { type: unknown }>;
  if (env.v !== undefined && env.v !== MULTIPLAYER_PROTOCOL_VERSION) {
    return {
      ok: false,
      code: 'UNSUPPORTED_PROTOCOL_VERSION',
      reason: 'Protocol version mismatch.',
    };
  }

  if (!isValidClientMessageType(env.type)) {
    return {
      ok: false,
      code: 'INVALID_MESSAGE_TYPE',
      reason: 'Unknown or disallowed client message type.',
    };
  }

  // Never trust client-supplied roomId or playerId if they mismatch authenticated socket binding
  if (env.roomId !== undefined) {
    if (!isValidRoomId(env.roomId) || env.roomId !== boundRoomId) {
      return {
        ok: false,
        code: 'ROOM_MISMATCH',
        reason: 'Envelope roomId does not match active room.',
      };
    }
  }

  if (env.playerId !== undefined) {
    if (!isValidPlayerId(env.playerId) || env.playerId !== boundPlayerId) {
      return {
        ok: false,
        code: 'PLAYER_IMPERSONATION_REJECTED',
        reason: 'Envelope playerId does not match authenticated socket player.',
      };
    }
  }

  const msg: ValidatedClientEnvelope = {
    type: env.type,
    roomId: boundRoomId,
    playerId: boundPlayerId,
    timestamp: Date.now(),
    seq:
      typeof env.seq === 'number' && Number.isInteger(env.seq) && env.seq >= 0
        ? env.seq
        : undefined,
  };

  if (
    (env.type === 'START_GAME' ||
      env.type === 'KICK_PLAYER' ||
      env.type === 'TRANSFER_HOST' ||
      env.type === 'UPDATE_ROOM_SETTINGS' ||
      env.type === 'CLOSE_ROOM' ||
      env.type === 'ENTITY_SYNC' ||
      env.type === 'ENEMY_ATTACK_PLAYER') &&
    !isPlayerHost
  ) {
    return {
      ok: false,
      code: 'FORBIDDEN_HOST_ONLY',
      reason: 'Only the room host can perform this room action.',
    };
  }

  if (env.type === 'PLAYER_STATE') {
    const forbiddenStateKey = findForbiddenAuthorityKey(
      env.payload,
      new Set(['health', 'maxHealth', 'isDead']),
    );
    if (forbiddenStateKey) {
      return {
        ok: false,
        code: 'FORBIDDEN_CLIENT_AUTHORITY',
        reason: `Client cannot supply authoritative field "${forbiddenStateKey}".`,
      };
    }
    const check = validatePlayerStatePayload(env.payload);
    if (!check.ok) {
      return { ok: false, code: 'INVALID_PLAYER_STATE', reason: check.reason };
    }
    msg.playerState = check.state;
  } else if (env.type === 'GAME_EVENT') {
    const rawEventPayload =
      env.payload && typeof env.payload === 'object' && !Array.isArray(env.payload)
        ? (env.payload as Record<string, unknown>)
        : null;
    const rawEventName = typeof rawEventPayload?.event === 'string' ? rawEventPayload.event : '';
    if (rawEventName === 'MOD_SPAWNS_SYNC' && !isPlayerHost) {
      return {
        ok: false,
        code: 'FORBIDDEN_HOST_ONLY',
        reason: 'Only the room host can synchronize mod spawns.',
      };
    }
    const allowedEventKeys =
      rawEventName === 'BUILDING_UPDATED' ? new Set(['health']) : undefined;
    const forbiddenEventKey =
      findForbiddenAuthorityKey(rawEventPayload, allowedEventKeys) ??
      findForbiddenAuthorityKey(rawEventPayload?.data, allowedEventKeys);
    if (forbiddenEventKey) {
      return {
        ok: false,
        code: 'FORBIDDEN_CLIENT_AUTHORITY',
        reason: `Client cannot supply authoritative field "${forbiddenEventKey}".`,
      };
    }
    const check = validateGameEventPayload(env.payload, false);
    if (!check.ok) {
      return { ok: false, code: 'INVALID_GAME_EVENT', reason: check.reason };
    }
    msg.gameEvent = check.payload;
  } else if (env.type === 'ENTITY_SYNC') {
    const check = validateEntitySyncBatchPayload(env.payload);
    if (!check.ok) {
      return { ok: false, code: 'INVALID_ENTITY_SYNC', reason: check.reason };
    }
    msg.entitySync = check.payload;
  } else if (env.type === 'ROOM_CHAT') {
    const check = validateChatMessageInput(env.payload);
    if (!check.ok) {
      return { ok: false, code: check.code, reason: check.reason };
    }
    msg.chatMessage = check.message;
  } else if (env.type === 'PLAYER_REPORT') {
    const check = validatePlayerReportPayload(env.payload, boundPlayerId);
    if (!check.ok) {
      return { ok: false, code: check.code, reason: check.reason };
    }
    msg.playerReport = check.payload;
  } else if (env.type === 'READY') {
    const payload = env.payload as { ready?: unknown } | undefined;
    if (!payload || typeof payload.ready !== 'boolean') {
      return {
        ok: false,
        code: 'INVALID_READY_PAYLOAD',
        reason: 'READY payload must include boolean "ready".',
      };
    }
    msg.ready = payload.ready;
  } else if (env.type === 'KICK_PLAYER' || env.type === 'TRANSFER_HOST') {
    const payload = env.payload as { targetPlayerId?: unknown } | undefined;
    if (!payload || !isValidPlayerId(payload.targetPlayerId)) {
      return {
        ok: false,
        code: env.type === 'TRANSFER_HOST' ? 'INVALID_TRANSFER_PAYLOAD' : 'INVALID_KICK_PAYLOAD',
        reason: `${env.type} payload must include a valid targetPlayerId.`,
      };
    }
    if (payload.targetPlayerId === boundPlayerId) {
      return {
        ok: false,
        code: env.type === 'TRANSFER_HOST' ? 'CANNOT_TRANSFER_SELF' : 'CANNOT_KICK_SELF',
        reason:
          env.type === 'TRANSFER_HOST'
            ? 'Host is already assigned to this player.'
            : 'Host cannot kick themselves.',
      };
    }
    msg.targetPlayerId = payload.targetPlayerId;
  } else if (env.type === 'UPDATE_ROOM_SETTINGS') {
    const payload = env.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {
        ok: false,
        code: 'INVALID_ROOM_SETTINGS',
        reason: 'UPDATE_ROOM_SETTINGS payload must be an object.',
      };
    }
    const forbiddenRoomKey = findForbiddenAuthorityKey(payload);
    if (forbiddenRoomKey) {
      return {
        ok: false,
        code: 'FORBIDDEN_CLIENT_AUTHORITY',
        reason: `Client cannot modify authoritative field "${forbiddenRoomKey}".`,
      };
    }
    const nextSettings: UpdateRoomSettingsPayload = {};
    if (typeof payload.requireAllReady === 'boolean') {
      nextSettings.requireAllReady = payload.requireAllReady;
    }
    if (typeof payload.friendlyFire === 'boolean') {
      nextSettings.friendlyFire = payload.friendlyFire;
    }
    if (
      nextSettings.requireAllReady === undefined &&
      nextSettings.friendlyFire === undefined
    ) {
      return {
        ok: false,
        code: 'INVALID_ROOM_SETTINGS',
        reason: 'UPDATE_ROOM_SETTINGS requires requireAllReady or friendlyFire.',
      };
    }
    msg.roomSettings = nextSettings;
  } else if (env.type === 'WORLD_SETTINGS_UPDATE') {
    const payload = env.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {
        ok: false,
        code: 'INVALID_WORLD_SETTINGS',
        reason: 'WORLD_SETTINGS_UPDATE payload must be an object.',
      };
    }
    const forbiddenWorldKey = findForbiddenAuthorityKey(payload);
    if (forbiddenWorldKey) {
      return {
        ok: false,
        code: 'FORBIDDEN_CLIENT_AUTHORITY',
        reason: `Client cannot modify authoritative field "${forbiddenWorldKey}".`,
      };
    }
    const upd: WorldSettingsUpdatePayload = {};
    if (
      payload.worldSettingsPermission === 'HOST_ONLY' ||
      payload.worldSettingsPermission === 'ALL_PLAYERS'
    ) {
      upd.worldSettingsPermission = payload.worldSettingsPermission;
    }
    if (
      typeof payload.preset === 'string' &&
      VALID_TIME_PRESETS.has(payload.preset as WorldTimePreset)
    ) {
      upd.preset = payload.preset as WorldTimePreset;
    }
    if (typeof payload.worldHours === 'number' && Number.isFinite(payload.worldHours)) {
      upd.worldHours = ((payload.worldHours % 24) + 24) % 24;
    }
    if (typeof payload.dayCount === 'number' && Number.isFinite(payload.dayCount)) {
      upd.dayCount = Math.max(1, Math.min(99_999, Math.floor(payload.dayCount)));
    }
    if (typeof payload.timeScale === 'number' && Number.isFinite(payload.timeScale)) {
      upd.timeScale = Math.max(0.1, Math.min(20, Math.round(payload.timeScale * 100) / 100));
    }
    if (typeof payload.paused === 'boolean') {
      upd.paused = payload.paused;
    }
    if (
      typeof payload.fullDayDurationSeconds === 'number' &&
      Number.isFinite(payload.fullDayDurationSeconds)
    ) {
      upd.fullDayDurationSeconds = Math.max(
        60,
        Math.min(1200, Math.round(payload.fullDayDurationSeconds)),
      );
    }
    if (
      typeof payload.weatherState === 'string' &&
      VALID_WEATHER_STATES.has(payload.weatherState as WorldWeatherState)
    ) {
      upd.weatherState = payload.weatherState as WorldWeatherState;
    }
    if (
      typeof payload.targetWeatherState === 'string' &&
      VALID_WEATHER_STATES.has(payload.targetWeatherState as WorldWeatherState)
    ) {
      upd.targetWeatherState = payload.targetWeatherState as WorldWeatherState;
    }
    if (
      typeof payload.weatherIntensity === 'number' &&
      Number.isFinite(payload.weatherIntensity)
    ) {
      upd.weatherIntensity = Math.max(0, Math.min(1, Math.round(payload.weatherIntensity * 100) / 100));
    }
    if (typeof payload.dynamicEnabled === 'boolean') {
      upd.dynamicEnabled = payload.dynamicEnabled;
    }
    if (
      typeof payload.transitionDurationSeconds === 'number' &&
      Number.isFinite(payload.transitionDurationSeconds)
    ) {
      upd.transitionDurationSeconds = Math.max(
        2,
        Math.min(40, Math.round(payload.transitionDurationSeconds)),
      );
    }
    if (typeof payload.durationMs === 'number' && Number.isFinite(payload.durationMs)) {
      upd.durationMs = Math.max(5_000, Math.min(MAX_WEATHER_DURATION_MS, Math.round(payload.durationMs)));
    }
    if (typeof payload.triggerLightning === 'boolean') {
      upd.triggerLightning = payload.triggerLightning;
    }
    if (typeof payload.friendlyFire === 'boolean') {
      upd.friendlyFire = payload.friendlyFire;
    }
    msg.worldSettingsUpdate = upd;
  } else if (env.type === 'ENEMY_ATTACK_PLAYER') {
    const payload = env.payload as Record<string, unknown> | undefined;
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      !isValidPlayerId(payload.targetPlayerId) ||
      (payload.sourceKind !== 'enemy' && payload.sourceKind !== 'animal') ||
      typeof payload.sourceId !== 'string' ||
      payload.sourceId.length === 0 ||
      typeof payload.damage !== 'number' ||
      !Number.isFinite(payload.damage) ||
      payload.damage <= 0 ||
      payload.damage > 100
    ) {
      return {
        ok: false,
        code: 'INVALID_ENEMY_ATTACK',
        reason: 'ENEMY_ATTACK_PLAYER requires valid target, source, and bounded damage.',
      };
    }
    msg.enemyAttackPlayer = {
      targetPlayerId: payload.targetPlayerId,
      sourceKind: payload.sourceKind,
      sourceId: payload.sourceId.slice(0, 64),
      ...(typeof payload.archetype === 'string'
        ? { archetype: payload.archetype.slice(0, 32) }
        : {}),
      damage: Math.max(1, Math.min(85, Math.round(payload.damage))),
      ...(typeof payload.x === 'number' && Number.isFinite(payload.x) ? { x: payload.x } : {}),
      ...(typeof payload.z === 'number' && Number.isFinite(payload.z) ? { z: payload.z } : {}),
    };
  } else if (env.type === 'REPAIR_WEAPONS') {
    const payload = env.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {
        ok: false,
        code: 'INVALID_REPAIR_REQUEST',
        reason: 'REPAIR_WEAPONS requires a valid request payload.',
      };
    }
    const forbiddenRepairKey = findForbiddenAuthorityKey(payload);
    if (forbiddenRepairKey) {
      return {
        ok: false,
        code: 'FORBIDDEN_CLIENT_AUTHORITY',
        reason: `Client cannot modify authoritative field "${forbiddenRepairKey}".`,
      };
    }
    if (
      typeof payload.costCoins !== 'number' ||
      !Number.isFinite(payload.costCoins) ||
      payload.costCoins <= 0 ||
      payload.costCoins > MAX_REPAIR_COST_COINS
    ) {
      return {
        ok: false,
        code: 'INVALID_REPAIR_REQUEST',
        reason: 'REPAIR_WEAPONS requires a valid costCoins amount.',
      };
    }
    msg.repairWeapons = {
      costCoins: Math.max(1, Math.min(MAX_REPAIR_COST_COINS, Math.round(payload.costCoins))),
    };
  } else if (env.type === 'START_GAME') {
    if (env.payload !== undefined) {
      return {
        ok: false,
        code: 'FORBIDDEN_CLIENT_AUTHORITY',
        reason: 'START_GAME cannot include client-supplied world configuration.',
      };
    }
  } else if (env.type === 'PING' || env.type === 'PONG') {
    const payload = env.payload as { pingId?: unknown; clientSentAt?: unknown } | undefined;
    if (payload && typeof payload === 'object') {
      if (typeof payload.pingId === 'number' && Number.isInteger(payload.pingId)) {
        msg.pingId = payload.pingId;
      }
      if (typeof payload.clientSentAt === 'number' && Number.isFinite(payload.clientSentAt)) {
        msg.clientSentAt = payload.clientSentAt;
      }
    }
  } else if (env.type === 'JOIN_ROOM' || env.type === 'CONNECT') {
    const payload = env.payload as { displayName?: unknown } | undefined;
    if (payload?.displayName !== undefined) {
      msg.displayName = sanitizeDisplayName(payload.displayName);
    }
  } else if (env.type === 'PARTY_INVITE') {
    const payload = env.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {
        ok: false,
        code: 'INVALID_PARTY_INVITE',
        reason: 'PARTY_INVITE payload must be an object.',
      };
    }
    const targetPlayerId =
      typeof payload.targetPlayerId === 'string' && isValidPlayerId(payload.targetPlayerId)
        ? payload.targetPlayerId
        : undefined;
    const targetPublicProfileId =
      typeof payload.targetPublicProfileId === 'string' &&
      payload.targetPublicProfileId.trim().length > 0
        ? payload.targetPublicProfileId.trim().slice(0, 64)
        : undefined;
    const targetPlayerName =
      typeof payload.targetPlayerName === 'string' && payload.targetPlayerName.trim().length > 0
        ? sanitizeDisplayName(payload.targetPlayerName)
        : undefined;
    if (!targetPlayerId && !targetPublicProfileId && !targetPlayerName) {
      return {
        ok: false,
        code: 'INVALID_PARTY_INVITE',
        reason: 'PARTY_INVITE requires targetPlayerId, targetPublicProfileId, or targetPlayerName.',
      };
    }
    msg.partyInvite = {
      ...(targetPlayerId ? { targetPlayerId } : {}),
      ...(targetPublicProfileId ? { targetPublicProfileId } : {}),
      ...(targetPlayerName ? { targetPlayerName } : {}),
    };
  } else if (
    env.type === 'PARTY_ACCEPT_INVITE' ||
    env.type === 'PARTY_DECLINE_INVITE'
  ) {
    const payload = env.payload as { inviteId?: unknown } | undefined;
    if (
      !payload ||
      typeof payload.inviteId !== 'string' ||
      payload.inviteId.trim().length < 4 ||
      payload.inviteId.trim().length > 64
    ) {
      return {
        ok: false,
        code: 'INVALID_PARTY_INVITE_ID',
        reason: `${env.type} requires a valid inviteId.`,
      };
    }
    msg.partyInviteResponse = { inviteId: payload.inviteId.trim() };
  } else if (env.type === 'PARTY_KICK' || env.type === 'PARTY_TRANSFER_LEADER') {
    const payload = env.payload as { targetPlayerId?: unknown } | undefined;
    if (!payload || !isValidPlayerId(payload.targetPlayerId)) {
      return {
        ok: false,
        code: 'INVALID_PARTY_TARGET',
        reason: `${env.type} requires a valid targetPlayerId.`,
      };
    }
    msg.targetPlayerId = payload.targetPlayerId;
  } else if (env.type === 'PARTY_SET_READY') {
    const payload = env.payload as { ready?: unknown } | undefined;
    if (!payload || typeof payload.ready !== 'boolean') {
      return {
        ok: false,
        code: 'INVALID_PARTY_READY',
        reason: 'PARTY_SET_READY requires boolean ready.',
      };
    }
    msg.ready = payload.ready;
  } else if (env.type === 'PARTY_START_OBJECTIVE') {
    const payload = env.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object' || !isValidCoopObjectiveType(payload.type)) {
      return {
        ok: false,
        code: 'INVALID_COOP_OBJECTIVE',
        reason: 'PARTY_START_OBJECTIVE requires a valid objective type.',
      };
    }
    msg.partyObjectiveStart = {
      type: payload.type,
      ...(typeof payload.title === 'string' && payload.title.trim().length > 0
        ? { title: payload.title.trim().slice(0, 64) }
        : {}),
      ...(typeof payload.targetId === 'string' && payload.targetId.trim().length > 0
        ? { targetId: payload.targetId.trim().slice(0, 64) }
        : {}),
      ...(typeof payload.targetX === 'number' && Number.isFinite(payload.targetX)
        ? { targetX: Math.round(payload.targetX * 100) / 100 }
        : {}),
      ...(typeof payload.targetZ === 'number' && Number.isFinite(payload.targetZ)
        ? { targetZ: Math.round(payload.targetZ * 100) / 100 }
        : {}),
      ...(typeof payload.targetCount === 'number' &&
      Number.isFinite(payload.targetCount) &&
      payload.targetCount >= 1
        ? { targetCount: Math.max(1, Math.min(25, Math.round(payload.targetCount))) }
        : {}),
    };
  } else if (env.type === 'COOP_QUEST_START' || env.type === 'COOP_QUEST_COMPLETE') {
    const payload = env.payload as Record<string, unknown> | undefined;
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.questId !== 'string' ||
      payload.questId.trim().length === 0 ||
      payload.questId.trim().length > 64
    ) {
      return {
        ok: false,
        code: 'INVALID_COOP_QUEST_PAYLOAD',
        reason: `${env.type} requires a valid questId.`,
      };
    }
    msg.coopQuestAction = {
      questId: payload.questId.trim().slice(0, 64),
      ...(typeof payload.objectiveId === 'string' && payload.objectiveId.trim().length > 0
        ? { objectiveId: payload.objectiveId.trim().slice(0, 64) }
        : {}),
      ...(typeof payload.title === 'string' && payload.title.trim().length > 0
        ? { title: payload.title.trim().slice(0, 64) }
        : {}),
      ...(typeof payload.targetEnemyType === 'string' && payload.targetEnemyType.trim().length > 0
        ? { targetEnemyType: payload.targetEnemyType.trim().slice(0, 32) }
        : {}),
      ...(typeof payload.targetCount === 'number' &&
      Number.isFinite(payload.targetCount) &&
      payload.targetCount >= 1
        ? { targetCount: Math.max(1, Math.min(50, Math.round(payload.targetCount))) }
        : {}),
    };
  }

  return { ok: true, message: msg };
}
