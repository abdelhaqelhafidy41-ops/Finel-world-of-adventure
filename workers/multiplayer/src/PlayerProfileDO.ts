import {
  ALLOWED_REPORT_REASONS,
  findForbiddenAuthorityKey,
  sanitizeChatText,
  type PlayerReportReason,
} from '../../../shared/multiplayerProtocol';
import {
  computeLevelAndXp,
  createEmptyProfileStats,
  DEFAULT_PLAYER_PRIVACY,
  isValidPublicPlayerId,
  MAX_DIRECT_MESSAGE_LENGTH,
  migrateAvatarConfig,
  sanitizeBio,
  sanitizeCountryRegion,
  sanitizePlayerNameInput,
  stripDangerousText,
  validateAvatarConfig,
  validateFavoriteGameMode,
  validatePlayerName,
  validatePlayerTag,
  type AvatarConfig,
  type DirectMessageRecord,
  type EditablePresenceStatus,
  type FavoriteGameMode,
  type FriendRecord,
  type FriendRequestRecord,
  type MessagePrivacyOption,
  type OnlinePresenceStatus,
  type OwnPlayerProfile,
  type PlayerPrivacySettings,
  type PlayerProfileStats,
  type PlayerSearchSummary,
  type ProfileStatsDelta,
  type PublicPlayerProfile,
} from '../../../shared/profileTypes';
import type { CfDurableObjectState, CfEnv } from './cfTypes';
import {
  generateSecureAccountId,
  generateSecurePlayerTag,
  generateSecurePublicProfileId,
  generateSecureRecordId,
  generateSecureSessionToken,
  sha256Hex,
} from './roomId';
import { SecurityAuditLogger } from './securityLogger';

interface StoredProfileAccount {
  accountId: string;
  publicProfileId: string;
  tokenHash: string;
  displayName: string;
  playerTag: string;
  avatar: AvatarConfig;
  bio: string;
  country: string;
  favoriteGameMode: FavoriteGameMode;
  manualStatus: EditablePresenceStatus;
  statusNote: string;
  privacy: PlayerPrivacySettings;
  stats: PlayerProfileStats;
  currentRoomId: string | null;
  currentRoomName: string | null;
  friends: Array<{ accountId: string; addedAt: number }>;
  blockedAccountIds: string[];
  createdAt: number;
  lastActiveAt: number;
  tagUpdatedAt: number;
  lastDmSentAt: number;
  lastReportAt: number;
}

interface StoredFriendRequest {
  requestId: string;
  fromAccountId: string;
  toAccountId: string;
  createdAt: number;
}

interface StoredDirectMessage {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  message: string;
  timestamp: number;
}

interface StoredModerationReport {
  reportId: string;
  reporterAccountId: string;
  targetAccountId: string;
  targetPublicProfileId: string;
  reason: PlayerReportReason;
  details?: string;
  timestamp: number;
}

interface PersistedProfileDirectory {
  accounts: StoredProfileAccount[];
  friendRequests: StoredFriendRequest[];
  directMessages: StoredDirectMessage[];
  reports: StoredModerationReport[];
}

const STORAGE_KEY = 'player_profiles_directory_v1';
const PRESENCE_STALE_MS = 3 * 60 * 1000;
const IN_GAME_STALE_MS = 12 * 60 * 1000;
const TAG_CHANGE_COOLDOWN_MS = 60 * 1000;
const DM_COOLDOWN_MS = 1200;
const REPORT_COOLDOWN_MS = 8000;
const MAX_ACCOUNTS = 20_000;
const MAX_DIRECT_MESSAGES = 2000;
const MAX_REPORTS = 1000;
const STATS_WINDOW_MS = 60_000;
const STATS_MAX_UPDATES_PER_WINDOW = 10;
const STATS_MAX_XP_PER_WINDOW = 2500;
const FRIEND_REQ_WINDOW_MS = 60_000;
const FRIEND_REQ_MAX_PER_WINDOW = 10;

export class PlayerProfileDO {
  private readonly ctx: CfDurableObjectState;
  private readonly securityLogger = new SecurityAuditLogger();
  private accountsById = new Map<string, StoredProfileAccount>();
  private accountIdByPublicId = new Map<string, string>();
  private accountIdByTokenHash = new Map<string, string>();
  private friendRequests = new Map<string, StoredFriendRequest>();
  private directMessages: StoredDirectMessage[] = [];
  private reports: StoredModerationReport[] = [];
  private statsWindowByAccount = new Map<
    string,
    { windowStart: number; count: number; xpAccum: number }
  >();
  private friendReqWindowByAccount = new Map<
    string,
    { windowStart: number; count: number }
  >();
  private loaded = false;
  private accountSqlInitialized = false;

  constructor(ctx: CfDurableObjectState, _env: CfEnv) {
    this.ctx = ctx;
  }

  private ensureAccountSqlSchema(): void {
    if (this.accountSqlInitialized) return;
    const sql = this.ctx.storage.sql;
    if (!sql) return;
    const statements = [
      `CREATE TABLE IF NOT EXISTS accounts (
        account_id TEXT PRIMARY KEY NOT NULL,
        public_profile_id TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        email_normalized TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_iterations INTEGER NOT NULL DEFAULT 100000,
        email_verified INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_login_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_accounts_email_norm ON accounts(email_normalized)`,
      `CREATE INDEX IF NOT EXISTS idx_accounts_public_id ON accounts(public_profile_id)`,
      `CREATE TABLE IF NOT EXISTS profiles (
        account_id TEXT PRIMARY KEY NOT NULL,
        public_profile_id TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        player_tag TEXT NOT NULL DEFAULT '0001',
        avatar_json TEXT NOT NULL,
        bio TEXT NOT NULL DEFAULT '',
        country TEXT NOT NULL DEFAULT '',
        favorite_game_mode TEXT NOT NULL DEFAULT 'normal',
        privacy_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_profiles_public_id ON profiles(public_profile_id)`,
      `CREATE INDEX IF NOT EXISTS idx_profiles_display_name ON profiles(display_name)`,
      `CREATE TABLE IF NOT EXISTS player_progress (
        account_id TEXT PRIMARY KEY NOT NULL,
        save_version INTEGER NOT NULL DEFAULT 1,
        revision INTEGER NOT NULL DEFAULT 1,
        level INTEGER NOT NULL DEFAULT 1,
        xp INTEGER NOT NULL DEFAULT 0,
        xp_to_next_level INTEGER NOT NULL DEFAULT 100,
        coins INTEGER NOT NULL DEFAULT 0,
        secondary_currencies_json TEXT NOT NULL DEFAULT '{}',
        max_health INTEGER NOT NULL DEFAULT 100,
        max_stamina INTEGER NOT NULL DEFAULT 100,
        unlocked_characters_json TEXT NOT NULL DEFAULT '[]',
        unlocked_abilities_json TEXT NOT NULL DEFAULT '[]',
        skills_json TEXT NOT NULL DEFAULT '{}',
        stats_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS player_inventory (
        account_id TEXT PRIMARY KEY NOT NULL,
        inventory_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS player_quests (
        account_id TEXT PRIMARY KEY NOT NULL,
        quests_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS player_achievements (
        account_id TEXT PRIMARY KEY NOT NULL,
        achievements_json TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS account_settings (
        account_id TEXT PRIMARY KEY NOT NULL,
        settings_json TEXT NOT NULL DEFAULT '{}',
        language TEXT NOT NULL DEFAULT 'en',
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS world_saves (
        account_id TEXT NOT NULL,
        world_id TEXT NOT NULL,
        world_name TEXT NOT NULL,
        world_seed INTEGER NOT NULL,
        world_mode TEXT NOT NULL DEFAULT 'normal',
        difficulty TEXT NOT NULL DEFAULT 'normal',
        save_version INTEGER NOT NULL DEFAULT 6,
        revision INTEGER NOT NULL DEFAULT 1,
        play_time_seconds INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        data_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, world_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_world_saves_account_updated ON world_saves(account_id, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL,
        token_hash TEXT UNIQUE NOT NULL,
        refresh_token_hash TEXT UNIQUE NOT NULL,
        expires_at INTEGER NOT NULL,
        refresh_expires_at INTEGER NOT NULL,
        user_agent TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_refresh_hash ON sessions(refresh_token_hash)`,
      `CREATE TABLE IF NOT EXISTS password_resets (
        reset_id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_password_resets_account ON password_resets(account_id, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS friendships (
        account_id TEXT NOT NULL,
        target_public_profile_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'friend',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, target_public_profile_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_friendships_account_status ON friendships(account_id, status)`,
    ];
    for (const stmt of statements) {
      sql.exec(stmt);
    }
    this.accountSqlInitialized = true;
  }

  private async handleInternalAccountSql(request: Request): Promise<Response> {
    const sql = this.ctx.storage.sql;
    if (!sql) {
      return Response.json(
        { ok: false, error: 'SQL_STORAGE_UNAVAILABLE' },
        { status: 503 },
      );
    }
    this.ensureAccountSqlSchema();
    const body = (await request.json().catch(() => null)) as {
      mode?: 'first' | 'all' | 'run' | 'batch';
      query?: string;
      params?: unknown[];
      statements?: Array<{ query: string; params?: unknown[] }>;
    } | null;
    if (!body || !body.mode) {
      return Response.json({ ok: false, error: 'INVALID_SQL_REQUEST' }, { status: 400 });
    }
    try {
      if (body.mode === 'batch') {
        const list = Array.isArray(body.statements) ? body.statements : [];
        const results = list.map((item) => {
          const rows = sql
            .exec(item.query, ...(Array.isArray(item.params) ? item.params : []))
            .toArray();
          return { results: rows, success: true };
        });
        return Response.json({ ok: true, results });
      }
      const query = typeof body.query === 'string' ? body.query : '';
      const params = Array.isArray(body.params) ? body.params : [];
      const rows = sql.exec(query, ...params).toArray();
      if (body.mode === 'first') {
        return Response.json({ ok: true, row: rows[0] ?? null });
      }
      return Response.json({ ok: true, results: rows });
    } catch (err) {
      return Response.json(
        { ok: false, error: 'SQL_EXECUTION_ERROR', message: err instanceof Error ? err.message : 'SQL error' },
        { status: 500 },
      );
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const saved = await this.ctx.storage.get<PersistedProfileDirectory>(STORAGE_KEY);
    let migratedAny = false;
    if (saved) {
      if (Array.isArray(saved.accounts)) {
        for (const acc of saved.accounts) {
          if (!acc?.accountId || !acc?.publicProfileId || !acc?.tokenHash) continue;
          if (acc.avatar) {
            const mig = migrateAvatarConfig(acc.avatar);
            if (mig.migrated) {
              acc.avatar = mig.avatar;
              migratedAny = true;
            }
          }
          this.accountsById.set(acc.accountId, acc);
          this.accountIdByPublicId.set(acc.publicProfileId.toUpperCase(), acc.accountId);
          this.accountIdByTokenHash.set(acc.tokenHash, acc.accountId);
        }
      }
      if (Array.isArray(saved.friendRequests)) {
        for (const req of saved.friendRequests) {
          if (req?.requestId) {
            this.friendRequests.set(req.requestId, req);
          }
        }
      }
      if (Array.isArray(saved.directMessages)) {
        this.directMessages = saved.directMessages;
      }
      if (Array.isArray(saved.reports)) {
        this.reports = saved.reports;
      }
    }
    this.loaded = true;
    if (migratedAny) {
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    const payload: PersistedProfileDirectory = {
      accounts: Array.from(this.accountsById.values()),
      friendRequests: Array.from(this.friendRequests.values()),
      directMessages: this.directMessages.slice(-MAX_DIRECT_MESSAGES),
      reports: this.reports.slice(-MAX_REPORTS),
    };
    await this.ctx.storage.put(STORAGE_KEY, payload);
  }

  private async authenticate(request: Request): Promise<StoredProfileAccount | null> {
    const authHeader = request.headers.get('Authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    const token = match ? match[1].trim() : '';
    if (!token || token.length < 16 || token.length > 256) {
      return null;
    }
    const tokenHash = await sha256Hex(token);
    const accountId = this.accountIdByTokenHash.get(tokenHash);
    if (!accountId) return null;
    return this.accountsById.get(accountId) ?? null;
  }

  private isBlockedEitherWay(accA: StoredProfileAccount, accB: StoredProfileAccount): boolean {
    return (
      accA.blockedAccountIds.includes(accB.accountId) ||
      accB.blockedAccountIds.includes(accA.accountId)
    );
  }

  private resolveEffectivePresence(
    acc: StoredProfileAccount,
    forOwner: boolean,
    now = Date.now(),
  ): { presenceStatus: OnlinePresenceStatus; isOnlineVisible: boolean } {
    if (!forOwner && !acc.privacy.showOnlineStatus) {
      return { presenceStatus: 'offline', isOnlineVisible: false };
    }
    if (acc.manualStatus === 'offline') {
      return { presenceStatus: 'offline', isOnlineVisible: forOwner };
    }
    if (acc.currentRoomId && now - acc.lastActiveAt <= IN_GAME_STALE_MS) {
      return { presenceStatus: 'in-game', isOnlineVisible: true };
    }
    if (now - acc.lastActiveAt > PRESENCE_STALE_MS) {
      return { presenceStatus: 'offline', isOnlineVisible: true };
    }
    return {
      presenceStatus: acc.manualStatus === 'away' ? 'away' : 'online',
      isOnlineVisible: true,
    };
  }

  private toPublicProfile(
    acc: StoredProfileAccount,
    viewer: StoredProfileAccount | null,
    now = Date.now(),
  ): PublicPlayerProfile {
    const isSelf = viewer?.accountId === acc.accountId;
    const blocked = viewer && !isSelf ? this.isBlockedEitherWay(viewer, acc) : false;
    const { presenceStatus, isOnlineVisible } = blocked
      ? { presenceStatus: 'offline' as OnlinePresenceStatus, isOnlineVisible: false }
      : this.resolveEffectivePresence(acc, isSelf, now);

    return {
      publicProfileId: acc.publicProfileId,
      displayName: acc.displayName,
      playerTag: acc.playerTag,
      avatar: acc.avatar,
      bio: blocked ? '' : acc.bio,
      country: acc.country,
      favoriteGameMode: acc.favoriteGameMode,
      presenceStatus,
      statusNote: blocked ? undefined : acc.statusNote || undefined,
      isOnlineVisible,
      currentRoomId:
        isOnlineVisible && presenceStatus === 'in-game' ? acc.currentRoomId : null,
      currentRoomName:
        isOnlineVisible && presenceStatus === 'in-game' ? acc.currentRoomName : null,
      stats: { ...acc.stats },
      createdAt: acc.createdAt,
      lastActiveAt: acc.lastActiveAt,
    };
  }

  private toOwnProfile(acc: StoredProfileAccount, now = Date.now()): OwnPlayerProfile {
    const base = this.toPublicProfile(acc, acc, now);
    let incoming = 0;
    let outgoing = 0;
    for (const req of this.friendRequests.values()) {
      if (req.toAccountId === acc.accountId) incoming += 1;
      if (req.fromAccountId === acc.accountId) outgoing += 1;
    }
    return {
      ...base,
      manualStatus: acc.manualStatus,
      privacy: { ...acc.privacy },
      tagUpdatedAt: acc.tagUpdatedAt,
      friendsCount: acc.friends.length,
      pendingIncomingRequestsCount: incoming,
      pendingOutgoingRequestsCount: outgoing,
      blockedCount: acc.blockedAccountIds.length,
    };
  }

  private toSearchSummary(
    acc: StoredProfileAccount,
    viewer: StoredProfileAccount | null,
    now = Date.now(),
  ): PlayerSearchSummary {
    const isSelf = viewer?.accountId === acc.accountId;
    const { presenceStatus, isOnlineVisible } = this.resolveEffectivePresence(
      acc,
      isSelf,
      now,
    );
    const isFriend = viewer
      ? viewer.friends.some((f) => f.accountId === acc.accountId)
      : false;
    let hasIncomingRequest = false;
    let hasOutgoingRequest = false;
    if (viewer) {
      for (const req of this.friendRequests.values()) {
        if (req.fromAccountId === acc.accountId && req.toAccountId === viewer.accountId) {
          hasIncomingRequest = true;
        } else if (
          req.fromAccountId === viewer.accountId &&
          req.toAccountId === acc.accountId
        ) {
          hasOutgoingRequest = true;
        }
      }
    }

    return {
      publicProfileId: acc.publicProfileId,
      displayName: acc.displayName,
      playerTag: acc.playerTag,
      avatar: acc.avatar,
      presenceStatus,
      isOnlineVisible,
      level: acc.stats.level,
      favoriteGameMode: acc.favoriteGameMode,
      currentRoomId:
        isOnlineVisible && presenceStatus === 'in-game' ? acc.currentRoomId : null,
      currentRoomName:
        isOnlineVisible && presenceStatus === 'in-game' ? acc.currentRoomName : null,
      isFriend,
      hasIncomingRequest,
      hasOutgoingRequest,
    };
  }

  private allocateUniquePublicId(): string {
    for (let attempt = 0; attempt < 24; attempt++) {
      const candidate = generateSecurePublicProfileId();
      if (!this.accountIdByPublicId.has(candidate)) {
        return candidate;
      }
    }
    return `WA-${generateSecureAccountId().slice(4, 14).toUpperCase()}`;
  }

  private async handleCreateProfile(request: Request): Promise<Response> {
    if (this.accountsById.size >= MAX_ACCOUNTS) {
      return Response.json(
        { ok: false, error: 'PROFILE_CAPACITY_REACHED', message: 'Profile capacity reached.' },
        { status: 503 },
      );
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return Response.json({ ok: false, error: 'INVALID_BODY' }, { status: 400 });
    }

    const forbiddenCreateKey = findForbiddenAuthorityKey(body);
    if (forbiddenCreateKey) {
      this.securityLogger.record({
        category: 'AUTHORITY_VIOLATION',
        code: 'FORBIDDEN_PROFILE_CREATE_FIELD',
        severity: 'high',
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

    const nameCheck = validatePlayerName(body.displayName);
    if (!nameCheck.ok) {
      return Response.json(
        { ok: false, error: nameCheck.code, message: nameCheck.reason },
        { status: 400 },
      );
    }

    const publicProfileId = this.allocateUniquePublicId();
    const avatarCheck = validateAvatarConfig(body.avatar, publicProfileId);
    if (!avatarCheck.ok) {
      return Response.json(
        { ok: false, error: avatarCheck.code, message: avatarCheck.reason },
        { status: 400 },
      );
    }

    let playerTag = generateSecurePlayerTag();
    if (body.playerTag !== undefined && String(body.playerTag).trim().length > 0) {
      const tagCheck = validatePlayerTag(body.playerTag);
      if (!tagCheck.ok) {
        return Response.json(
          { ok: false, error: 'INVALID_PLAYER_TAG', message: tagCheck.reason },
          { status: 400 },
        );
      }
      playerTag = tagCheck.tag;
    }

    const rawPrivacy =
      body.privacy && typeof body.privacy === 'object' && !Array.isArray(body.privacy)
        ? (body.privacy as Record<string, unknown>)
        : {};
    const allowMessages: MessagePrivacyOption =
      rawPrivacy.allowMessages === 'friends' || rawPrivacy.allowMessages === 'nobody'
        ? rawPrivacy.allowMessages
        : 'everyone';

    const manualStatus: EditablePresenceStatus =
      body.manualStatus === 'away' || body.manualStatus === 'offline'
        ? body.manualStatus
        : 'online';

    const accountId = generateSecureAccountId();
    const sessionToken = generateSecureSessionToken();
    const tokenHash = await sha256Hex(sessionToken);
    const now = Date.now();

    const account: StoredProfileAccount = {
      accountId,
      publicProfileId,
      tokenHash,
      displayName: nameCheck.name,
      playerTag,
      avatar: avatarCheck.avatar,
      bio: sanitizeBio(body.bio),
      country: sanitizeCountryRegion(body.country),
      favoriteGameMode: validateFavoriteGameMode(body.favoriteGameMode),
      manualStatus,
      statusNote: stripDangerousText(body.statusNote).slice(0, 48),
      privacy: {
        showOnlineStatus:
          typeof rawPrivacy.showOnlineStatus === 'boolean'
            ? rawPrivacy.showOnlineStatus
            : DEFAULT_PLAYER_PRIVACY.showOnlineStatus,
        showPlayerName:
          typeof rawPrivacy.showPlayerName === 'boolean'
            ? rawPrivacy.showPlayerName
            : DEFAULT_PLAYER_PRIVACY.showPlayerName,
        allowFriendRequests:
          typeof rawPrivacy.allowFriendRequests === 'boolean'
            ? rawPrivacy.allowFriendRequests
            : DEFAULT_PLAYER_PRIVACY.allowFriendRequests,
        allowGameInvites:
          typeof rawPrivacy.allowGameInvites === 'boolean'
            ? rawPrivacy.allowGameInvites
            : DEFAULT_PLAYER_PRIVACY.allowGameInvites,
        allowMessages,
      },
      stats: createEmptyProfileStats(),
      currentRoomId: null,
      currentRoomName: null,
      friends: [],
      blockedAccountIds: [],
      createdAt: now,
      lastActiveAt: now,
      tagUpdatedAt: now,
      lastDmSentAt: 0,
      lastReportAt: 0,
    };

    this.accountsById.set(accountId, account);
    this.accountIdByPublicId.set(publicProfileId, accountId);
    this.accountIdByTokenHash.set(tokenHash, accountId);
    await this.persist();

    return Response.json(
      {
        ok: true,
        sessionToken,
        profile: this.toOwnProfile(account, now),
      },
      { status: 201 },
    );
  }

  private async handleUpdateProfile(
    request: Request,
    account: StoredProfileAccount,
  ): Promise<Response> {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return Response.json({ ok: false, error: 'INVALID_BODY' }, { status: 400 });
    }

    // Explicitly block tampering with permanent identifiers or server-tracked stats/authority fields
    const immutableKeys = ['publicProfileId', 'accountId', 'stats', 'level', 'xp'];
    for (const k of immutableKeys) {
      if (k in body && body[k] !== undefined) {
        if (k === 'publicProfileId' && body[k] === account.publicProfileId) {
          continue;
        }
        this.securityLogger.record({
          category: 'AUTHORITY_VIOLATION',
          code: 'FORBIDDEN_IMMUTABLE_FIELD',
          severity: 'high',
          playerId: account.publicProfileId,
          detail: k,
        });
        return Response.json(
          {
            ok: false,
            error: 'FORBIDDEN_IMMUTABLE_FIELD',
            message: 'Request contains server-authoritative fields.',
          },
          { status: 403 },
        );
      }
    }
    const forbiddenUpdateKey = findForbiddenAuthorityKey(body);
    if (forbiddenUpdateKey) {
      this.securityLogger.record({
        category: 'AUTHORITY_VIOLATION',
        code: 'FORBIDDEN_CLIENT_AUTHORITY',
        severity: 'high',
        playerId: account.publicProfileId,
        detail: forbiddenUpdateKey,
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

    const now = Date.now();

    if (body.displayName !== undefined) {
      const check = validatePlayerName(body.displayName);
      if (!check.ok) {
        return Response.json(
          { ok: false, error: check.code, message: check.reason },
          { status: 400 },
        );
      }
      account.displayName = check.name;
    }

    if (body.avatar !== undefined) {
      const avatarCheck = validateAvatarConfig(body.avatar, account.publicProfileId);
      if (!avatarCheck.ok) {
        return Response.json(
          { ok: false, error: avatarCheck.code, message: avatarCheck.reason },
          { status: 400 },
        );
      }
      account.avatar = avatarCheck.avatar;
    }

    if (body.playerTag !== undefined) {
      const cleanTag = String(body.playerTag).replace(/^#/, '').trim();
      if (cleanTag !== account.playerTag) {
        if (now - account.tagUpdatedAt < TAG_CHANGE_COOLDOWN_MS) {
          return Response.json(
            {
              ok: false,
              error: 'TAG_CHANGE_COOLDOWN',
              message: 'Please wait a minute before changing your player tag again.',
            },
            { status: 429 },
          );
        }
        const tagCheck = validatePlayerTag(cleanTag);
        if (!tagCheck.ok) {
          return Response.json(
            { ok: false, error: 'INVALID_PLAYER_TAG', message: tagCheck.reason },
            { status: 400 },
          );
        }
        account.playerTag = tagCheck.tag;
        account.tagUpdatedAt = now;
      }
    }

    if (body.bio !== undefined) {
      account.bio = sanitizeBio(body.bio);
    }

    if (body.country !== undefined) {
      account.country = sanitizeCountryRegion(body.country);
    }

    if (body.favoriteGameMode !== undefined) {
      account.favoriteGameMode = validateFavoriteGameMode(body.favoriteGameMode);
    }

    if (body.statusNote !== undefined) {
      account.statusNote = stripDangerousText(body.statusNote).slice(0, 48);
    }

    if (
      body.manualStatus === 'online' ||
      body.manualStatus === 'away' ||
      body.manualStatus === 'offline'
    ) {
      account.manualStatus = body.manualStatus;
    }

    if (body.privacy && typeof body.privacy === 'object' && !Array.isArray(body.privacy)) {
      const p = body.privacy as Record<string, unknown>;
      if (typeof p.showOnlineStatus === 'boolean') {
        account.privacy.showOnlineStatus = p.showOnlineStatus;
      }
      if (typeof p.showPlayerName === 'boolean') {
        account.privacy.showPlayerName = p.showPlayerName;
      }
      if (typeof p.allowFriendRequests === 'boolean') {
        account.privacy.allowFriendRequests = p.allowFriendRequests;
      }
      if (typeof p.allowGameInvites === 'boolean') {
        account.privacy.allowGameInvites = p.allowGameInvites;
      }
      if (
        p.allowMessages === 'everyone' ||
        p.allowMessages === 'friends' ||
        p.allowMessages === 'nobody'
      ) {
        account.privacy.allowMessages = p.allowMessages;
      }
    }

    account.lastActiveAt = now;
    await this.persist();
    return Response.json({ ok: true, profile: this.toOwnProfile(account, now) });
  }

  private applyStatsDelta(account: StoredProfileAccount, delta: ProfileStatsDelta): void {
    const clampInt = (val: unknown, maxDelta: number): number => {
      if (typeof val !== 'number' || !Number.isFinite(val)) return 0;
      return Math.max(0, Math.min(maxDelta, Math.round(val)));
    };

    const s = account.stats;
    s.playTimeSeconds += clampInt(delta.playTimeSeconds, 3600);
    s.worldsCreated += clampInt(delta.worldsCreated, 5);
    s.worldsJoined += clampInt(delta.worldsJoined, 10);
    s.questsCompleted += clampInt(delta.questsCompleted, 10);
    s.enemiesDefeated += clampInt(delta.enemiesDefeated, 40);
    s.animalsDefeated += clampInt(delta.animalsDefeated, 40);
    s.villagesDiscovered += clampInt(delta.villagesDiscovered, 10);
    s.resourcesCollected += clampInt(delta.resourcesCollected, 80);
    s.distanceTraveledMeters += clampInt(delta.distanceTraveledMeters, 12_000);
    s.multiplayerSessions += clampInt(delta.multiplayerSessions, 10);
    s.gamesHosted += clampInt(delta.gamesHosted, 10);

    const xpGain = clampInt(delta.xpGained, 2500);
    if (xpGain > 0) {
      const updated = computeLevelAndXp(s.level, s.xp, xpGain);
      s.level = updated.level;
      s.xp = updated.xp;
      s.xpToNextLevel = updated.xpToNextLevel;
    }
  }

  private findAccountByPublicId(publicIdRaw: unknown): StoredProfileAccount | null {
    if (!isValidPublicPlayerId(publicIdRaw)) return null;
    const accId = this.accountIdByPublicId.get(publicIdRaw.trim().toUpperCase());
    return accId ? (this.accountsById.get(accId) ?? null) : null;
  }

  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/internal/account-sql') {
      return this.handleInternalAccountSql(request);
    }
    await this.ensureLoaded();
    const now = Date.now();

    if (request.method === 'POST' && url.pathname === '/create') {
      return this.handleCreateProfile(request);
    }

    if (request.method === 'GET' && url.pathname === '/me') {
      const account = await this.authenticate(request);
      if (!account) {
        return Response.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
      }
      account.lastActiveAt = now;
      await this.persist();
      return Response.json({ ok: true, profile: this.toOwnProfile(account, now) });
    }

    if (request.method === 'POST' && url.pathname === '/update') {
      const account = await this.authenticate(request);
      if (!account) {
        return Response.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
      }
      return this.handleUpdateProfile(request, account);
    }

    if (request.method === 'POST' && url.pathname === '/presence') {
      const account = await this.authenticate(request);
      if (!account) {
        return Response.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
      }
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body) {
        const forbiddenPresenceKey = findForbiddenAuthorityKey(body);
        if (forbiddenPresenceKey) {
          this.securityLogger.record({
            category: 'AUTHORITY_VIOLATION',
            code: 'FORBIDDEN_PRESENCE_FIELD',
            severity: 'medium',
            playerId: account.publicProfileId,
            detail: forbiddenPresenceKey,
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
        if (
          body.manualStatus === 'online' ||
          body.manualStatus === 'away' ||
          body.manualStatus === 'offline'
        ) {
          account.manualStatus = body.manualStatus;
        }
        if (body.currentRoomId === null) {
          account.currentRoomId = null;
          account.currentRoomName = null;
        } else if (typeof body.currentRoomId === 'string' && body.currentRoomId.length <= 64) {
          account.currentRoomId = body.currentRoomId;
          account.currentRoomName =
            typeof body.currentRoomName === 'string'
              ? stripDangerousText(body.currentRoomName).slice(0, 40)
              : account.currentRoomName;
        }
      }
      account.lastActiveAt = now;
      await this.persist();
      return Response.json({ ok: true, profile: this.toOwnProfile(account, now) });
    }

    if (request.method === 'POST' && url.pathname === '/stats/delta') {
      const account = await this.authenticate(request);
      if (!account) {
        return Response.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
      }
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return Response.json({ ok: false, error: 'INVALID_BODY' }, { status: 400 });
      }
      const forbiddenStatsKey = findForbiddenAuthorityKey(body);
      if (forbiddenStatsKey) {
        this.securityLogger.record({
          category: 'XP_TAMPER',
          code: 'FORBIDDEN_STATS_FIELD',
          severity: 'high',
          playerId: account.publicProfileId,
          detail: forbiddenStatsKey,
        });
        return Response.json(
          {
            ok: false,
            error: 'FORBIDDEN_CLIENT_AUTHORITY',
            message: 'Clients cannot directly set progression fields.',
          },
          { status: 403 },
        );
      }

      const statLimits: Record<string, number> = {
        playTimeSeconds: 3600,
        worldsCreated: 5,
        worldsJoined: 10,
        questsCompleted: 10,
        enemiesDefeated: 40,
        animalsDefeated: 40,
        villagesDiscovered: 10,
        resourcesCollected: 80,
        distanceTraveledMeters: 12_000,
        multiplayerSessions: 10,
        gamesHosted: 10,
        xpGained: 2500,
      };
      for (const [key, maxVal] of Object.entries(statLimits)) {
        const raw = body[key];
        if (raw === undefined) continue;
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > maxVal) {
          this.securityLogger.record({
            category: 'XP_TAMPER',
            code: 'INVALID_STATS_DELTA',
            severity: 'high',
            playerId: account.publicProfileId,
            detail: key,
          });
          return Response.json(
            {
              ok: false,
              error: 'INVALID_STATS_DELTA',
              message: 'Stats update contains out-of-range values.',
            },
            { status: 400 },
          );
        }
      }

      const requestedXp =
        typeof body.xpGained === 'number' && Number.isFinite(body.xpGained)
          ? Math.round(body.xpGained)
          : 0;
      let win = this.statsWindowByAccount.get(account.accountId);
      if (!win || now - win.windowStart >= STATS_WINDOW_MS) {
        win = { windowStart: now, count: 0, xpAccum: 0 };
      }
      if (
        win.count + 1 > STATS_MAX_UPDATES_PER_WINDOW ||
        win.xpAccum + requestedXp > STATS_MAX_XP_PER_WINDOW
      ) {
        this.securityLogger.record({
          category: 'RATE_LIMIT_EXCEEDED',
          code: 'STATS_DELTA_RATE_LIMITED',
          severity: 'medium',
          playerId: account.publicProfileId,
        });
        return Response.json(
          {
            ok: false,
            error: 'RATE_LIMITED',
            message: 'Too many progression updates. Please wait a moment.',
          },
          { status: 429 },
        );
      }
      win.count += 1;
      win.xpAccum += requestedXp;
      this.statsWindowByAccount.set(account.accountId, win);

      this.applyStatsDelta(account, body as ProfileStatsDelta);
      account.lastActiveAt = now;
      await this.persist();
      return Response.json({ ok: true, profile: this.toOwnProfile(account, now) });
    }

    // Internal trusted route used by Worker/MultiplayerRoomDO to verify token -> immutable identity
    if (request.method === 'POST' && url.pathname === '/internal/resolve-session') {
      const body = (await request.json().catch(() => null)) as {
        profileSessionToken?: unknown;
      } | null;
      const token =
        typeof body?.profileSessionToken === 'string'
          ? body.profileSessionToken.trim()
          : '';
      if (!token) {
        return Response.json({ ok: false, error: 'MISSING_TOKEN' }, { status: 401 });
      }
      const tokenHash = await sha256Hex(token);
      const accountId = this.accountIdByTokenHash.get(tokenHash);
      const account = accountId ? this.accountsById.get(accountId) : undefined;
      if (!account) {
        return Response.json({ ok: false, error: 'INVALID_PROFILE_TOKEN' }, { status: 401 });
      }
      account.lastActiveAt = now;
      await this.persist();
      return Response.json({
        ok: true,
        identity: {
          publicProfileId: account.publicProfileId,
          displayName: account.displayName,
          playerTag: account.playerTag,
          avatar: account.avatar,
        },
      });
    }

    // Internal trusted route called when joining/starting/leaving/updating stats from a DO room
    if (request.method === 'POST' && url.pathname === '/internal/room-event') {
      const body = (await request.json().catch(() => null)) as {
        publicProfileId?: unknown;
        currentRoomId?: string | null;
        currentRoomName?: string | null;
        statsDelta?: ProfileStatsDelta;
      } | null;
      const acc = this.findAccountByPublicId(body?.publicProfileId);
      if (!acc) {
        return Response.json({ ok: false, error: 'PROFILE_NOT_FOUND' }, { status: 404 });
      }
      if (body?.currentRoomId !== undefined) {
        acc.currentRoomId = body.currentRoomId ? body.currentRoomId.slice(0, 64) : null;
        acc.currentRoomName =
          body.currentRoomId && typeof body.currentRoomName === 'string'
            ? stripDangerousText(body.currentRoomName).slice(0, 40)
            : null;
      }
      if (body?.statsDelta) {
        this.applyStatsDelta(acc, body.statsDelta);
      }
      acc.lastActiveAt = now;
      await this.persist();
      return Response.json({ ok: true });
    }

    // Internal trusted route called before storing a room invite
    if (request.method === 'POST' && url.pathname === '/internal/check-invite') {
      const body = (await request.json().catch(() => null)) as {
        fromPublicProfileId?: unknown;
        toPublicProfileId?: unknown;
        toPlayerName?: unknown;
      } | null;
      const sender = this.findAccountByPublicId(body?.fromPublicProfileId);
      let recipient = this.findAccountByPublicId(body?.toPublicProfileId);
      if (!recipient && typeof body?.toPlayerName === 'string') {
        const cleanName = sanitizePlayerNameInput(body.toPlayerName).toLowerCase();
        if (cleanName) {
          for (const candidate of this.accountsById.values()) {
            if (candidate.displayName.toLowerCase() === cleanName) {
              recipient = candidate;
              break;
            }
          }
        }
      }
      if (!recipient) {
        // Legacy fallback when inviting a non-registered guest name
        return Response.json({
          ok: true,
          resolvedRecipient: null,
        });
      }
      if (sender && this.isBlockedEitherWay(sender, recipient)) {
        return Response.json(
          { ok: false, error: 'PLAYER_BLOCKED', message: 'Cannot send invitation to this player.' },
          { status: 403 },
        );
      }
      if (!recipient.privacy.allowGameInvites) {
        return Response.json(
          { ok: false, error: 'INVITES_DISABLED', message: 'This player has disabled game invites.' },
          { status: 403 },
        );
      }
      return Response.json({
        ok: true,
        resolvedRecipient: {
          publicProfileId: recipient.publicProfileId,
          displayName: recipient.displayName,
        },
      });
    }

    // Public profile lookup by WA-... publicProfileId
    if (request.method === 'GET' && url.pathname === '/public') {
      const viewer = await this.authenticate(request);
      const target = this.findAccountByPublicId(url.searchParams.get('id'));
      if (!target) {
        return Response.json(
          { ok: false, error: 'PLAYER_NOT_FOUND', message: 'Player profile not found.' },
          { status: 404 },
        );
      }
      const isFriend = viewer
        ? viewer.friends.some((f) => f.accountId === target.accountId)
        : false;
      const blockedByViewer = viewer
        ? viewer.blockedAccountIds.includes(target.accountId)
        : false;
      return Response.json({
        ok: true,
        profile: this.toPublicProfile(target, viewer, now),
        relationship: {
          isSelf: viewer?.accountId === target.accountId,
          isFriend,
          isBlockedByViewer: blockedByViewer,
        },
      });
    }

    // Search player by WA-ID, Name#Tag, #Tag, or Display Name
    if (request.method === 'GET' && url.pathname === '/search') {
      const viewer = await this.authenticate(request);
      const rawQuery = stripDangerousText(url.searchParams.get('q') ?? '').trim();
      if (rawQuery.length < 2) {
        return Response.json({ ok: true, results: [] });
      }
      const qUpper = rawQuery.toUpperCase();
      const qLower = rawQuery.toLowerCase();
      const hashIdx = rawQuery.lastIndexOf('#');
      const namePart = hashIdx > 0 ? rawQuery.slice(0, hashIdx).trim().toLowerCase() : '';
      const tagPart =
        hashIdx >= 0 ? rawQuery.slice(hashIdx + 1).replace(/\D/g, '').slice(0, 4) : '';

      const results: PlayerSearchSummary[] = [];
      for (const candidate of this.accountsById.values()) {
        if (viewer && viewer.accountId === candidate.accountId) continue;
        if (viewer && this.isBlockedEitherWay(viewer, candidate)) continue;

        let matches = false;
        if (candidate.publicProfileId.toUpperCase() === qUpper) {
          matches = true;
        } else if (tagPart.length === 4) {
          if (namePart) {
            matches =
              candidate.playerTag === tagPart &&
              candidate.displayName.toLowerCase().includes(namePart);
          } else {
            matches = candidate.playerTag === tagPart;
          }
        } else {
          const candLower = candidate.displayName.toLowerCase();
          matches =
            candLower === qLower ||
            candLower.startsWith(qLower) ||
            candLower.includes(qLower) ||
            candidate.publicProfileId.toUpperCase().includes(qUpper);
        }

        if (matches) {
          results.push(this.toSearchSummary(candidate, viewer, now));
          if (results.length >= 20) break;
        }
      }

      results.sort((a, b) => {
        const aExact =
          a.publicProfileId.toUpperCase() === qUpper ||
          a.displayName.toLowerCase() === qLower
            ? 0
            : 1;
        const bExact =
          b.publicProfileId.toUpperCase() === qUpper ||
          b.displayName.toLowerCase() === qLower
            ? 0
            : 1;
        if (aExact !== bExact) return aExact - bExact;
        return a.displayName.localeCompare(b.displayName);
      });

      return Response.json({ ok: true, results });
    }

    // Friends + Requests + Blocks snapshot
    if (request.method === 'GET' && url.pathname === '/friends') {
      const account = await this.authenticate(request);
      if (!account) {
        return Response.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
      }
      const friends: FriendRecord[] = [];
      for (const link of account.friends) {
        const friendAcc = this.accountsById.get(link.accountId);
        if (!friendAcc || this.isBlockedEitherWay(account, friendAcc)) continue;
        const { presenceStatus, isOnlineVisible } = this.resolveEffectivePresence(
          friendAcc,
          false,
          now,
        );
        friends.push({
          publicProfileId: friendAcc.publicProfileId,
          displayName: friendAcc.displayName,
          playerTag: friendAcc.playerTag,
          avatar: friendAcc.avatar,
          presenceStatus,
          isOnlineVisible,
          level: friendAcc.stats.level,
          favoriteGameMode: friendAcc.favoriteGameMode,
          currentRoomId:
            isOnlineVisible && presenceStatus === 'in-game'
              ? friendAcc.currentRoomId
              : null,
          currentRoomName:
            isOnlineVisible && presenceStatus === 'in-game'
              ? friendAcc.currentRoomName
              : null,
          addedAt: link.addedAt,
          lastActiveAt: friendAcc.lastActiveAt,
        });
      }

      const incomingRequests: FriendRequestRecord[] = [];
      const outgoingRequests: FriendRequestRecord[] = [];
      for (const req of this.friendRequests.values()) {
        const fromAcc = this.accountsById.get(req.fromAccountId);
        const toAcc = this.accountsById.get(req.toAccountId);
        if (!fromAcc || !toAcc || this.isBlockedEitherWay(fromAcc, toAcc)) continue;
        const dto: FriendRequestRecord = {
          requestId: req.requestId,
          fromPublicProfileId: fromAcc.publicProfileId,
          fromDisplayName: fromAcc.displayName,
          fromPlayerTag: fromAcc.playerTag,
          fromAvatar: fromAcc.avatar,
          toPublicProfileId: toAcc.publicProfileId,
          toDisplayName: toAcc.displayName,
          toPlayerTag: toAcc.playerTag,
          toAvatar: toAcc.avatar,
          createdAt: req.createdAt,
        };
        if (req.toAccountId === account.accountId) incomingRequests.push(dto);
        if (req.fromAccountId === account.accountId) outgoingRequests.push(dto);
      }

      const blocked = account.blockedAccountIds
        .map((id) => this.accountsById.get(id))
        .filter((x): x is StoredProfileAccount => Boolean(x))
        .map((x) => ({
          publicProfileId: x.publicProfileId,
          displayName: x.displayName,
          playerTag: x.playerTag,
          avatar: x.avatar,
        }));

      return Response.json({
        ok: true,
        friends,
        incomingRequests: incomingRequests.sort((a, b) => b.createdAt - a.createdAt),
        outgoingRequests: outgoingRequests.sort((a, b) => b.createdAt - a.createdAt),
        blocked,
      });
    }

    if (request.method === 'POST' && url.pathname === '/friends/request') {
      const account = await this.authenticate(request);
      if (!account) {
        return Response.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
      }
      let frWin = this.friendReqWindowByAccount.get(account.accountId);
      if (!frWin || now - frWin.windowStart >= FRIEND_REQ_WINDOW_MS) {
        frWin = { windowStart: now, count: 0 };
      }
      if (frWin.count + 1 > FRIEND_REQ_MAX_PER_WINDOW) {
        this.securityLogger.record({
          category: 'RATE_LIMIT_EXCEEDED',
          code: 'ACCOUNT_FRIEND_REQUEST_RATE_LIMITED',
          severity: 'medium',
          playerId: account.publicProfileId,
        });
        return Response.json(
          { ok: false, error: 'RATE_LIMITED', message: 'Too many friend requests sent.' },
          { status: 429 },
        );
      }
      frWin.count += 1;
      this.friendReqWindowByAccount.set(account.accountId, frWin);

      const body = (await request.json().catch(() => null)) as {
        targetPublicProfileId?: unknown;
      } | null;
      const target = this.findAccountByPublicId(body?.targetPublicProfileId);
      if (!target) {
        return Response.json(
          { ok: false, error: 'PLAYER_NOT_FOUND', message: 'Player not found.' },
          { status: 404 },
        );
      }
      if (target.accountId === account.accountId) {
        return Response.json(
          { ok: false, error: 'CANNOT_ADD_SELF', message: 'You cannot add yourself as a friend.' },
          { status: 400 },
        );
      }
      if (this.isBlockedEitherWay(account, target)) {
        return Response.json(
          { ok: false, error: 'PLAYER_BLOCKED', message: 'Action unavailable because one player blocked the other.' },
          { status: 403 },
        );
      }
      if (!target.privacy.allowFriendRequests) {
        return Response.json(
          { ok: false, error: 'FRIEND_REQUESTS_DISABLED', message: 'This player is not accepting friend requests.' },
          { status: 403 },
        );
      }
      if (account.friends.some((f) => f.accountId === target.accountId)) {
        return Response.json(
          { ok: false, error: 'ALREADY_FRIENDS', message: 'Already friends.' },
          { status: 409 },
        );
      }

      // Check existing pending request in either direction
      for (const req of this.friendRequests.values()) {
        if (req.fromAccountId === account.accountId && req.toAccountId === target.accountId) {
          return Response.json(
            { ok: false, error: 'REQUEST_ALREADY_SENT', message: 'Friend request already sent.' },
            { status: 409 },
          );
        }
        if (req.fromAccountId === target.accountId && req.toAccountId === account.accountId) {
          // Mutual request auto-accepts cleanly!
          this.friendRequests.delete(req.requestId);
          account.friends.push({ accountId: target.accountId, addedAt: now });
          target.friends.push({ accountId: account.accountId, addedAt: now });
          await this.persist();
          return Response.json({ ok: true, acceptedMutually: true });
        }
      }

      const requestId = generateSecureRecordId('fr');
      this.friendRequests.set(requestId, {
        requestId,
        fromAccountId: account.accountId,
        toAccountId: target.accountId,
        createdAt: now,
      });
      await this.persist();
      return Response.json({ ok: true, requestId });
    }

    if (request.method === 'POST' && url.pathname === '/friends/respond') {
      const account = await this.authenticate(request);
      if (!account) {
        return Response.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
      }
      const body = (await request.json().catch(() => null)) as {
        requestId?: unknown;
        action?: unknown;
      } | null;
      const reqId = typeof body?.requestId === 'string' ? body.requestId.trim() : '';
      const action = body?.action;
      const req = this.friendRequests.get(reqId);
      if (!req) {
        return Response.json(
          { ok: false, error: 'REQUEST_NOT_FOUND', message: 'Friend request no longer exists.' },
          { status: 404 },
        );
      }

      if (action === 'cancel') {
        if (req.fromAccountId !== account.accountId) {
          return Response.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 });
        }
        this.friendRequests.delete(reqId);
        await this.persist();
        return Response.json({ ok: true });
      }

      if (req.toAccountId !== account.accountId) {
        return Response.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 });
      }

      this.friendRequests.delete(reqId);
      if (action === 'accept') {
        const sender = this.accountsById.get(req.fromAccountId);
        if (sender && !this.isBlockedEitherWay(account, sender)) {
          if (!account.friends.some((f) => f.accountId === sender.accountId)) {
            account.friends.push({ accountId: sender.accountId, addedAt: now });
          }
          if (!sender.friends.some((f) => f.accountId === account.accountId)) {
            sender.friends.push({ accountId: account.accountId, addedAt: now });
          }
        }
      }
      await this.persist();
      return Response.json({ ok: true });
    }

    if (request.method === 'POST' && url.pathname === '/friends/remove') {
      const account = await this.authenticate(request);
      if (!account) {
        return Response.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
      }
      const body = (await request.json().catch(() => null)) as {
        targetPublicProfileId?: unknown;
      } | null;
      const target = this.findAccountByPublicId(body?.targetPublicProfileId);
      if (!target) {
        return Response.json({ ok: false, error: 'PLAYER_NOT_FOUND' }, { status: 404 });
      }
      account.friends = account.friends.filter((f) => f.accountId !== target.accountId);
      target.friends = target.friends.filter((f) => f.accountId !== account.accountId);
      await this.persist();
      return Response.json({ ok: true });
    }

    if (request.method === 'POST' && url.pathname === '/blocks/add') {
      const account = await this.authenticate(request);
      if (!account) {
        return Response.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
      }
      const body = (await request.json().catch(() => null)) as {
        targetPublicProfileId?: unknown;
      } | null;
      const target = this.findAccountByPublicId(body?.targetPublicProfileId);
      if (!target || target.accountId === account.accountId) {
        return Response.json({ ok: false, error: 'INVALID_TARGET' }, { status: 400 });
      }
      if (!account.blockedAccountIds.includes(target.accountId)) {
        account.blockedAccountIds.push(target.accountId);
      }
      // Remove any mutual friendship and pending requests on block
      account.friends = account.friends.filter((f) => f.accountId !== target.accountId);
      target.friends = target.friends.filter((f) => f.accountId !== account.accountId);
      for (const [reqId, req] of Array.from(this.friendRequests.entries())) {
        if (
          (req.fromAccountId === account.accountId && req.toAccountId === target.accountId) ||
          (req.fromAccountId === target.accountId && req.toAccountId === account.accountId)
        ) {
          this.friendRequests.delete(reqId);
        }
      }
      await this.persist();
      return Response.json({ ok: true });
    }

    if (request.method === 'POST' && url.pathname === '/blocks/remove') {
      const account = await this.authenticate(request);
      if (!account) {
        return Response.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
      }
      const body = (await request.json().catch(() => null)) as {
        targetPublicProfileId?: unknown;
      } | null;
      const target = this.findAccountByPublicId(body?.targetPublicProfileId);
      if (!target) {
        return Response.json({ ok: false, error: 'PLAYER_NOT_FOUND' }, { status: 404 });
      }
      account.blockedAccountIds = account.blockedAccountIds.filter(
        (id) => id !== target.accountId,
      );
      await this.persist();
      return Response.json({ ok: true });
    }

    if (request.method === 'GET' && url.pathname === '/messages') {
      const account = await this.authenticate(request);
      if (!account) {
        return Response.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
      }
      const partner = this.findAccountByPublicId(url.searchParams.get('with'));
      if (!partner || this.isBlockedEitherWay(account, partner)) {
        return Response.json({ ok: true, messages: [] });
      }
      const thread: DirectMessageRecord[] = [];
      for (const dm of this.directMessages) {
        if (
          (dm.fromAccountId === account.accountId && dm.toAccountId === partner.accountId) ||
          (dm.fromAccountId === partner.accountId && dm.toAccountId === account.accountId)
        ) {
          const senderAcc = this.accountsById.get(dm.fromAccountId);
          const recipAcc = this.accountsById.get(dm.toAccountId);
          if (!senderAcc || !recipAcc) continue;
          thread.push({
            id: dm.id,
            fromPublicProfileId: senderAcc.publicProfileId,
            fromDisplayName: senderAcc.displayName,
            fromPlayerTag: senderAcc.playerTag,
            fromAvatar: senderAcc.avatar,
            toPublicProfileId: recipAcc.publicProfileId,
            message: dm.message,
            timestamp: dm.timestamp,
          });
        }
      }
      return Response.json({ ok: true, messages: thread.slice(-50) });
    }

    if (request.method === 'POST' && url.pathname === '/messages/send') {
      const account = await this.authenticate(request);
      if (!account) {
        return Response.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
      }
      if (now - account.lastDmSentAt < DM_COOLDOWN_MS) {
        return Response.json(
          { ok: false, error: 'RATE_LIMITED', message: 'Sending messages too quickly.' },
          { status: 429 },
        );
      }
      const body = (await request.json().catch(() => null)) as {
        toPublicProfileId?: unknown;
        message?: unknown;
      } | null;
      const recipient = this.findAccountByPublicId(body?.toPublicProfileId);
      if (!recipient || recipient.accountId === account.accountId) {
        return Response.json({ ok: false, error: 'PLAYER_NOT_FOUND' }, { status: 404 });
      }
      if (this.isBlockedEitherWay(account, recipient)) {
        return Response.json(
          { ok: false, error: 'PLAYER_BLOCKED', message: 'Messaging unavailable for blocked players.' },
          { status: 403 },
        );
      }
      if (recipient.privacy.allowMessages === 'nobody') {
        return Response.json(
          { ok: false, error: 'MESSAGES_DISABLED', message: 'This player has disabled direct messages.' },
          { status: 403 },
        );
      }
      if (
        recipient.privacy.allowMessages === 'friends' &&
        !recipient.friends.some((f) => f.accountId === account.accountId)
      ) {
        return Response.json(
          { ok: false, error: 'FRIENDS_ONLY_MESSAGES', message: 'Only friends can message this player.' },
          { status: 403 },
        );
      }
      const cleanMsg = sanitizeChatText(body?.message).slice(0, MAX_DIRECT_MESSAGE_LENGTH);
      if (!cleanMsg) {
        return Response.json(
          { ok: false, error: 'EMPTY_MESSAGE', message: 'Message cannot be empty.' },
          { status: 400 },
        );
      }

      account.lastDmSentAt = now;
      account.lastActiveAt = now;
      const dmId = generateSecureRecordId('dm');
      this.directMessages.push({
        id: dmId,
        fromAccountId: account.accountId,
        toAccountId: recipient.accountId,
        message: cleanMsg,
        timestamp: now,
      });
      if (this.directMessages.length > MAX_DIRECT_MESSAGES) {
        this.directMessages = this.directMessages.slice(-MAX_DIRECT_MESSAGES);
      }
      await this.persist();
      const record: DirectMessageRecord = {
        id: dmId,
        fromPublicProfileId: account.publicProfileId,
        fromDisplayName: account.displayName,
        fromPlayerTag: account.playerTag,
        fromAvatar: account.avatar,
        toPublicProfileId: recipient.publicProfileId,
        message: cleanMsg,
        timestamp: now,
      };
      return Response.json({ ok: true, message: record });
    }

    if (request.method === 'POST' && url.pathname === '/reports/submit') {
      const account = await this.authenticate(request);
      if (!account) {
        return Response.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
      }
      if (now - account.lastReportAt < REPORT_COOLDOWN_MS) {
        return Response.json(
          { ok: false, error: 'RATE_LIMITED', message: 'Please wait before submitting another report.' },
          { status: 429 },
        );
      }
      const body = (await request.json().catch(() => null)) as {
        targetPublicProfileId?: unknown;
        reason?: unknown;
        details?: unknown;
      } | null;
      const target = this.findAccountByPublicId(body?.targetPublicProfileId);
      if (!target || target.accountId === account.accountId) {
        return Response.json({ ok: false, error: 'INVALID_TARGET' }, { status: 400 });
      }
      if (
        typeof body?.reason !== 'string' ||
        !(ALLOWED_REPORT_REASONS as readonly string[]).includes(body.reason)
      ) {
        return Response.json({ ok: false, error: 'INVALID_REPORT_REASON' }, { status: 400 });
      }
      const details =
        typeof body.details === 'string'
          ? sanitizeChatText(body.details).slice(0, 200)
          : '';
      account.lastReportAt = now;
      const reportId = generateSecureRecordId('rep');
      this.reports.push({
        reportId,
        reporterAccountId: account.accountId,
        targetAccountId: target.accountId,
        targetPublicProfileId: target.publicProfileId,
        reason: body.reason as PlayerReportReason,
        ...(details ? { details } : {}),
        timestamp: now,
      });
      if (this.reports.length > MAX_REPORTS) {
        this.reports = this.reports.slice(-MAX_REPORTS);
      }
      await this.persist();
      // Confidential confirmation: never reveals reporter identity or internal account IDs
      return Response.json({
        ok: true,
        reportId,
        targetPublicProfileId: target.publicProfileId,
        reason: body.reason,
        timestamp: now,
      });
    }

    return Response.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
  }
}
