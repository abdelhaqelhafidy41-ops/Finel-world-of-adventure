import {
  CLOUD_SAVE_SCHEMA_VERSION,
  type CloudAccountInfo,
  type CloudPlayerProgressData,
  type CloudPlayerSavePayload,
  type CloudWorldSaveRecord,
  type CloudWorldSaveSummary,
} from '../../../shared/accountTypes';
import {
  createEmptyProfileStats,
  DEFAULT_PLAYER_PRIVACY,
  migrateAvatarConfig,
  sanitizeBio,
  sanitizeCountryRegion,
  validatePlayerName,
  type AvatarConfig,
  type FavoriteGameMode,
  type PlayerPrivacySettings,
  type PlayerProfileStats,
} from '../../../shared/profileTypes';
import {
  generateAccountId,
  generatePlayerTag,
  generatePublicPlayerId,
  generateResetCode,
  hashPassword,
  randomHex,
  sha256Hex,
  verifyPassword,
} from './accountCrypto';
import type { CfD1Database, CfEnv } from './cfTypes';
import { IpRateLimiter } from './rateLimiter';
import { workerSecurityLogger } from './securityLogger';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RESET_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_RESET_ATTEMPTS = 5;
const MAX_WORLD_SAVES_PER_ACCOUNT = 25;
const MAX_AUTH_BODY_BYTES = 16_384;
const MAX_PLAYER_SAVE_BYTES = 256_000;
const MAX_WORLD_SAVE_BYTES = 512_000;

const authRegisterLimiter = new IpRateLimiter(8, 60_000);
const authLoginLimiter = new IpRateLimiter(12, 60_000);
const authResetLimiter = new IpRateLimiter(5, 300_000);
const saveWriteLimiter = new IpRateLimiter(60, 60_000);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const WORLD_ID_RE = /^[a-zA-Z0-9_-]{3,64}$/;
const ALLOWED_WORLD_MODES = new Set(['normal', 'adventure', 'survival', 'creative']);
const ALLOWED_DIFFICULTIES = new Set(['easy', 'normal', 'hard']);

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  const normalized =
    typeof body.ok === 'boolean' && typeof body.success !== 'boolean'
      ? { ...body, success: body.ok }
      : body;
  return Response.json(normalized, { status });
}

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length < 5 || trimmed.length > 160 || !EMAIL_RE.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function validatePasswordStrength(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Password is required.' };
  }
  if (raw.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters long.' };
  }
  if (raw.length > 128) {
    return { ok: false, error: 'Password must be 128 characters or fewer.' };
  }
  return { ok: true, value: raw };
}

async function parseJsonBounded(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const declaredLen = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
    return { ok: false, status: 413, error: 'PAYLOAD_TOO_LARGE' };
  }
  const raw = await request.text().catch(() => '');
  const byteLen = new TextEncoder().encode(raw).byteLength;
  if (byteLen > maxBytes) {
    return { ok: false, status: 413, error: 'PAYLOAD_TOO_LARGE' };
  }
  if (!raw.trim()) {
    return { ok: true, data: {} };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, status: 400, error: 'INVALID_JSON_BODY' };
    }
    return { ok: true, data: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400, error: 'INVALID_JSON_BODY' };
  }
}

function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const token = match ? match[1].trim() : '';
  return token.length >= 24 ? token : null;
}

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  const n = typeof val === 'number' && Number.isFinite(val) ? Math.floor(val) : fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeStringArray(val: unknown, maxItems = 250, maxLen = 64): string[] {
  if (!Array.isArray(val)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of val) {
    if (typeof item !== 'string') continue;
    const clean = item.trim().slice(0, maxLen);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
      if (out.length >= maxItems) break;
    }
  }
  return out;
}

function sanitizeNumberMap(val: unknown, maxEntries = 100, min = 0, max = 10_000_000): Record<string, number> {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return {};
  const out: Record<string, number> = {};
  let count = 0;
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (count >= maxEntries) break;
    const cleanKey = k.trim().slice(0, 48);
    if (!cleanKey || typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[cleanKey] = Math.max(min, Math.min(max, Math.floor(v)));
    count++;
  }
  return out;
}

function sanitizeStats(raw: unknown): PlayerProfileStats {
  const base = createEmptyProfileStats();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const r = raw as Record<string, unknown>;
  return {
    playTimeSeconds: clampInt(r.playTimeSeconds, 0, 100_000_000, base.playTimeSeconds),
    worldsCreated: clampInt(r.worldsCreated, 0, 10_000, base.worldsCreated),
    worldsJoined: clampInt(r.worldsJoined, 0, 100_000, base.worldsJoined),
    questsCompleted: clampInt(r.questsCompleted, 0, 100_000, base.questsCompleted),
    enemiesDefeated: clampInt(r.enemiesDefeated, 0, 10_000_000, base.enemiesDefeated),
    animalsDefeated: clampInt(r.animalsDefeated, 0, 10_000_000, base.animalsDefeated),
    villagesDiscovered: clampInt(r.villagesDiscovered, 0, 10_000, base.villagesDiscovered),
    resourcesCollected: clampInt(r.resourcesCollected, 0, 100_000_000, base.resourcesCollected),
    distanceTraveledMeters: clampInt(r.distanceTraveledMeters, 0, 100_000_000, base.distanceTraveledMeters),
    multiplayerSessions: clampInt(r.multiplayerSessions, 0, 100_000, base.multiplayerSessions),
    gamesHosted: clampInt(r.gamesHosted, 0, 100_000, base.gamesHosted),
    level: clampInt(r.level, 1, 999, base.level),
    xp: clampInt(r.xp, 0, 10_000_000, base.xp),
    xpToNextLevel: clampInt(r.xpToNextLevel, 50, 10_000_000, base.xpToNextLevel),
  };
}

interface AuthenticatedSession {
  sessionId: string;
  accountId: string;
  publicProfileId: string;
  email: string;
}

async function authenticateRequest(
  request: Request,
  db: CfD1Database,
): Promise<AuthenticatedSession | null> {
  const token = extractBearerToken(request);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const row = await db
    .prepare(
      `SELECT s.session_id, s.account_id, s.expires_at, a.public_profile_id, a.email
       FROM sessions s
       INNER JOIN accounts a ON a.account_id = s.account_id
       WHERE s.token_hash = ?
       LIMIT 1`,
    )
    .bind(tokenHash)
    .first<{
      session_id: string;
      account_id: string;
      expires_at: number;
      public_profile_id: string;
      email: string;
    }>();

  if (!row || Number(row.expires_at) <= now) {
    return null;
  }

  // Update last_used_at asynchronously (non-blocking)
  void db
    .prepare('UPDATE sessions SET last_used_at = ? WHERE session_id = ?')
    .bind(now, row.session_id)
    .run()
    .catch(() => {});

  return {
    sessionId: row.session_id,
    accountId: row.account_id,
    publicProfileId: row.public_profile_id,
    email: row.email,
  };
}

async function loadAccountInfo(
  db: CfD1Database,
  accountId: string,
): Promise<CloudAccountInfo | null> {
  const row = await db
    .prepare(
      `SELECT a.account_id, a.public_profile_id, a.email, a.email_verified,
              a.created_at, a.updated_at, a.last_login_at,
              p.display_name, p.player_tag, p.avatar_json, p.bio, p.country,
              p.favorite_game_mode, p.privacy_json,
              pr.level, pr.xp, pr.xp_to_next_level, pr.stats_json
       FROM accounts a
       INNER JOIN profiles p ON p.account_id = a.account_id
       LEFT JOIN player_progress pr ON pr.account_id = a.account_id
       WHERE a.account_id = ?
       LIMIT 1`,
    )
    .bind(accountId)
    .first<Record<string, unknown>>();

  if (!row) return null;

  const rawAvatar = safeJsonParse<AvatarConfig>(row.avatar_json, {
    kind: 'preset',
    value: 'ranger',
    color: '#10b981',
  });
  const avatar = migrateAvatarConfig(rawAvatar).avatar;
  const privacy: PlayerPrivacySettings = {
    ...DEFAULT_PLAYER_PRIVACY,
    ...safeJsonParse<Partial<PlayerPrivacySettings>>(row.privacy_json, {}),
  };
  const stats = sanitizeStats(safeJsonParse<Record<string, unknown>>(row.stats_json, {}));
  if (typeof row.level === 'number') stats.level = row.level;
  if (typeof row.xp === 'number') stats.xp = row.xp;
  if (typeof row.xp_to_next_level === 'number') stats.xpToNextLevel = row.xp_to_next_level;

  return {
    accountId: String(row.account_id),
    publicProfileId: String(row.public_profile_id),
    email: String(row.email),
    displayName: String(row.display_name),
    playerTag: String(row.player_tag || '0001'),
    avatar,
    bio: String(row.bio || ''),
    country: String(row.country || ''),
    favoriteGameMode: (ALLOWED_WORLD_MODES.has(String(row.favorite_game_mode))
      ? String(row.favorite_game_mode)
      : 'normal') as FavoriteGameMode,
    privacy,
    stats,
    emailVerified: Boolean(row.email_verified),
    createdAt: Number(row.created_at) || Date.now(),
    updatedAt: Number(row.updated_at) || Date.now(),
    lastLoginAt: Number(row.last_login_at) || Date.now(),
  };
}

async function loadPlayerSave(
  db: CfD1Database,
  accountId: string,
): Promise<CloudPlayerSavePayload | null> {
  const [prog, inv, quests, ach, settings] = await Promise.all([
    db
      .prepare('SELECT * FROM player_progress WHERE account_id = ? LIMIT 1')
      .bind(accountId)
      .first<Record<string, unknown>>(),
    db
      .prepare('SELECT inventory_json FROM player_inventory WHERE account_id = ? LIMIT 1')
      .bind(accountId)
      .first<{ inventory_json: string }>(),
    db
      .prepare('SELECT quests_json FROM player_quests WHERE account_id = ? LIMIT 1')
      .bind(accountId)
      .first<{ quests_json: string }>(),
    db
      .prepare('SELECT achievements_json FROM player_achievements WHERE account_id = ? LIMIT 1')
      .bind(accountId)
      .first<{ achievements_json: string }>(),
    db
      .prepare('SELECT settings_json, language FROM account_settings WHERE account_id = ? LIMIT 1')
      .bind(accountId)
      .first<{ settings_json: string; language: string }>(),
  ]);

  if (!prog) return null;

  const stats = sanitizeStats(safeJsonParse<Record<string, unknown>>(prog.stats_json, {}));
  stats.level = Number(prog.level) || stats.level;
  stats.xp = Number(prog.xp) || 0;
  stats.xpToNextLevel = Number(prog.xp_to_next_level) || 100;

  const progress: CloudPlayerProgressData = {
    level: Number(prog.level) || 1,
    xp: Number(prog.xp) || 0,
    xpToNextLevel: Number(prog.xp_to_next_level) || 100,
    coins: Number(prog.coins) || 0,
    secondaryCurrencies: safeJsonParse<Record<string, number>>(
      prog.secondary_currencies_json,
      {},
    ),
    maxHealth: Number(prog.max_health) || 100,
    maxStamina: Number(prog.max_stamina) || 100,
    unlockedCharacters: safeJsonParse<string[]>(prog.unlocked_characters_json, []),
    unlockedAbilities: safeJsonParse<string[]>(prog.unlocked_abilities_json, []),
    skills: safeJsonParse<Record<string, number>>(prog.skills_json, {}),
    stats,
  };

  const parsedSettings = safeJsonParse<Record<string, unknown>>(settings?.settings_json, {});
  if (settings?.language && !parsedSettings.language) {
    parsedSettings.language = settings.language;
  }

  return {
    saveVersion: Number(prog.save_version) || CLOUD_SAVE_SCHEMA_VERSION,
    revision: Number(prog.revision) || 1,
    updatedAt: Number(prog.updated_at) || Date.now(),
    progress,
    inventory: safeJsonParse<Record<string, unknown>>(inv?.inventory_json, {}),
    quests: safeJsonParse<Record<string, unknown>>(quests?.quests_json, {}),
    achievements: safeJsonParse<string[]>(ach?.achievements_json, []),
    settings: parsedSettings,
  };
}

async function listWorldSaveSummaries(
  db: CfD1Database,
  accountId: string,
): Promise<CloudWorldSaveSummary[]> {
  const res = await db
    .prepare(
      `SELECT world_id, world_name, world_seed, world_mode, difficulty,
              save_version, revision, play_time_seconds, level, created_at, updated_at
       FROM world_saves
       WHERE account_id = ?
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .bind(accountId, MAX_WORLD_SAVES_PER_ACCOUNT)
    .all<Record<string, unknown>>();

  return (res.results ?? []).map((row) => ({
    worldId: String(row.world_id),
    worldName: String(row.world_name),
    worldSeed: Number(row.world_seed) || 0,
    worldMode: (ALLOWED_WORLD_MODES.has(String(row.world_mode))
      ? String(row.world_mode)
      : 'normal') as CloudWorldSaveSummary['worldMode'],
    difficulty: (ALLOWED_DIFFICULTIES.has(String(row.difficulty))
      ? String(row.difficulty)
      : 'normal') as CloudWorldSaveSummary['difficulty'],
    saveVersion: Number(row.save_version) || 6,
    revision: Number(row.revision) || 1,
    playTimeSeconds: Number(row.play_time_seconds) || 0,
    level: Number(row.level) || 1,
    createdAt: Number(row.created_at) || Date.now(),
    updatedAt: Number(row.updated_at) || Date.now(),
  }));
}

async function createSessionTokens(
  db: CfD1Database,
  accountId: string,
  userAgent: string,
) {
  const now = Date.now();
  const sessionId = `sess_${randomHex(12)}`;
  const sessionToken = randomHex(32);
  const refreshToken = randomHex(32);
  const tokenHash = await sha256Hex(sessionToken);
  const refreshHash = await sha256Hex(refreshToken);
  const expiresAt = now + SESSION_TTL_MS;
  const refreshExpiresAt = now + REFRESH_TTL_MS;

  await db
    .prepare(
      `INSERT INTO sessions
       (session_id, account_id, token_hash, refresh_token_hash, expires_at, refresh_expires_at, user_agent, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      sessionId,
      accountId,
      tokenHash,
      refreshHash,
      expiresAt,
      refreshExpiresAt,
      userAgent.slice(0, 180),
      now,
      now,
    )
    .run();

  return {
    sessionToken,
    refreshToken,
    expiresAt,
    refreshExpiresAt,
  };
}

async function sendResetEmailIfConfigured(
  env: CfEnv,
  toEmail: string,
  displayName: string,
  resetCode: string,
): Promise<boolean> {
  if (!env.RESET_EMAIL_API_URL || !env.RESET_EMAIL_API_KEY) {
    return false;
  }
  try {
    const res = await fetch(env.RESET_EMAIL_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${env.RESET_EMAIL_API_KEY}`,
      },
      body: JSON.stringify({
        from: env.RESET_EMAIL_FROM || 'World of Adventure <noreply@worldofadventure.app>',
        to: [toEmail],
        subject: 'World of Adventure — Password Reset Code',
        text: `Hello ${displayName},\n\nYour World of Adventure password reset code is: ${resetCode}\n\nThis code expires in 15 minutes. If you did not request a password reset, you can safely ignore this email.`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Used by MultiplayerRoomDO / Worker index.ts to authenticate a player's D1 account session
 * when joining or creating multiplayer rooms, without modifying multiplayer gameplay.
 */
export async function resolveAccountSessionIdentity(
  request: Request,
  env: CfEnv,
): Promise<Record<string, unknown> | null> {
  if (!env.DB) return null;
  try {
    const auth = await authenticateRequest(request, env.DB);
    if (!auth) return null;
    const account = await loadAccountInfo(env.DB, auth.accountId);
    if (!account) return null;
    return {
      accountId: account.accountId,
      publicProfileId: account.publicProfileId,
      displayName: account.displayName,
      playerTag: account.playerTag,
      avatar: account.avatar,
      level: account.stats.level,
      isCloudAccount: true,
    };
  } catch {
    return null;
  }
}

/**
 * Normalizes /api/auth/* -> /auth/* etc. so both canonical paths and /api/* prefixed paths work.
 */
function normalizeAccountPath(pathname: string): string {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (
    trimmed.startsWith('/api/auth/') ||
    trimmed.startsWith('/api/account') ||
    trimmed.startsWith('/api/player/save') ||
    trimmed.startsWith('/api/world-saves')
  ) {
    return trimmed.slice('/api'.length);
  }
  return trimmed;
}

export function isAccountOrCloudSavePath(pathname: string): boolean {
  const p = normalizeAccountPath(pathname);
  return (
    p.startsWith('/auth/') ||
    p === '/account' ||
    p.startsWith('/account/') ||
    p === '/player/save' ||
    p === '/world-saves' ||
    p.startsWith('/world-saves/')
  );
}

export async function handleAccountRoute(
  request: Request,
  env: CfEnv,
  clientIp: string,
): Promise<Response> {
  const url = new URL(request.url);
  const path = normalizeAccountPath(url.pathname);
  const method = request.method.toUpperCase();

  if (!env.DB) {
    return jsonResponse(
      {
        ok: false,
        error: 'CLOUD_DB_NOT_CONFIGURED',
        message: 'Cloudflare D1 database binding (DB) is not configured on this Worker.',
      },
      503,
    );
  }

  const db = env.DB;

  try {
  // ---------------------------------------------------------------------------
  // 1. POST /auth/register
  // ---------------------------------------------------------------------------
  if (method === 'POST' && path === '/auth/register') {
    if (!authRegisterLimiter.check(clientIp)) {
      return jsonResponse(
        { ok: false, error: 'RATE_LIMITED', message: 'Too many registration attempts. Try again later.' },
        429,
      );
    }

    const parsed = await parseJsonBounded(request, MAX_AUTH_BODY_BYTES);
    if (!parsed.ok) return jsonResponse({ ok: false, error: parsed.error }, parsed.status);

    const emailNorm = normalizeEmail(parsed.data.email);
    if (!emailNorm) {
      return jsonResponse(
        { ok: false, error: 'INVALID_EMAIL', message: 'Please enter a valid email address.' },
        400,
      );
    }

    const nameCheck = validatePlayerName(parsed.data.displayName);
    if (!nameCheck.ok) {
      return jsonResponse(
        { ok: false, error: nameCheck.code, message: nameCheck.reason || 'Display name must be 3–20 valid characters.' },
        400,
      );
    }

    const pwCheck = validatePasswordStrength(parsed.data.password);
    if (!pwCheck.ok) {
      return jsonResponse({ ok: false, error: 'WEAK_PASSWORD', message: pwCheck.error }, 400);
    }

    // Check duplicate email
    const existing = await db
      .prepare('SELECT account_id FROM accounts WHERE email_normalized = ? LIMIT 1')
      .bind(emailNorm)
      .first<{ account_id: string }>();
    if (existing) {
      return jsonResponse(
        { ok: false, error: 'EMAIL_ALREADY_REGISTERED', message: 'An account with this email already exists.' },
        409,
      );
    }

    // Generate server-authoritative unique accountId & publicProfileId
    const accountId = generateAccountId();
    let publicProfileId = generatePublicPlayerId();
    for (let attempt = 0; attempt < 5; attempt++) {
      const collision = await db
        .prepare('SELECT account_id FROM accounts WHERE public_profile_id = ? LIMIT 1')
        .bind(publicProfileId)
        .first();
      if (!collision) break;
      publicProfileId = generatePublicPlayerId();
    }

    const playerTag = generatePlayerTag();
    const { hash, salt, iterations } = await hashPassword(pwCheck.value);
    const now = Date.now();
    const rawAvatar =
      parsed.data.avatar && typeof parsed.data.avatar === 'object'
        ? (parsed.data.avatar as AvatarConfig)
        : ({ kind: 'preset', value: 'ranger', color: '#10b981' } as AvatarConfig);
    const avatar = migrateAvatarConfig(rawAvatar).avatar;
    const language =
      typeof parsed.data.language === 'string' && parsed.data.language === 'ar' ? 'ar' : 'en';

    await db.batch([
      db
        .prepare(
          `INSERT INTO accounts
           (account_id, public_profile_id, email, email_normalized, password_hash, password_salt, password_iterations, email_verified, created_at, updated_at, last_login_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        )
        .bind(accountId, publicProfileId, emailNorm, emailNorm, hash, salt, iterations, now, now, now),
      db
        .prepare(
          `INSERT INTO profiles
           (account_id, public_profile_id, display_name, player_tag, avatar_json, bio, country, favorite_game_mode, privacy_json, updated_at)
           VALUES (?, ?, ?, ?, ?, '', '', 'normal', ?, ?)`,
        )
        .bind(
          accountId,
          publicProfileId,
          nameCheck.name,
          playerTag,
          JSON.stringify(avatar),
          JSON.stringify(DEFAULT_PLAYER_PRIVACY),
          now,
        ),
      db
        .prepare(
          `INSERT INTO player_progress
           (account_id, save_version, revision, level, xp, xp_to_next_level, coins, secondary_currencies_json, max_health, max_stamina, unlocked_characters_json, unlocked_abilities_json, skills_json, stats_json, updated_at)
           VALUES (?, ?, 1, 1, 0, 100, 0, '{}', 100, 100, '[]', '[]', '{}', ?, ?)`,
        )
        .bind(
          accountId,
          CLOUD_SAVE_SCHEMA_VERSION,
          JSON.stringify(createEmptyProfileStats()),
          now,
        ),
      db
        .prepare('INSERT INTO player_inventory (account_id, inventory_json, updated_at) VALUES (?, ?, ?)')
        .bind(accountId, '{}', now),
      db
        .prepare('INSERT INTO player_quests (account_id, quests_json, updated_at) VALUES (?, ?, ?)')
        .bind(accountId, '{}', now),
      db
        .prepare('INSERT INTO player_achievements (account_id, achievements_json, updated_at) VALUES (?, ?, ?)')
        .bind(accountId, '[]', now),
      db
        .prepare('INSERT INTO account_settings (account_id, settings_json, language, updated_at) VALUES (?, ?, ?, ?)')
        .bind(accountId, JSON.stringify({ language }), language, now),
    ]);

    const tokens = await createSessionTokens(
      db,
      accountId,
      request.headers.get('User-Agent') ?? '',
    );
    const account = await loadAccountInfo(db, accountId);
    const playerSave = await loadPlayerSave(db, accountId);

    return jsonResponse(
      {
        ok: true,
        success: true,
        account,
        tokens,
        playerSave,
        worldSaves: [],
      },
      201,
    );
  }

  // ---------------------------------------------------------------------------
  // 2. POST /auth/login
  // ---------------------------------------------------------------------------
  if (method === 'POST' && path === '/auth/login') {
    if (!authLoginLimiter.check(clientIp)) {
      workerSecurityLogger.record({
        category: 'RATE_LIMIT_EXCEEDED',
        code: 'AUTH_LOGIN_RATE_LIMITED',
        severity: 'medium',
        detail: 'auth-login',
      });
      return jsonResponse(
        { ok: false, error: 'RATE_LIMITED', message: 'Too many login attempts. Please wait a minute.' },
        429,
      );
    }

    const parsed = await parseJsonBounded(request, MAX_AUTH_BODY_BYTES);
    if (!parsed.ok) return jsonResponse({ ok: false, error: parsed.error }, parsed.status);

    const emailNorm = normalizeEmail(parsed.data.email);
    const password = typeof parsed.data.password === 'string' ? parsed.data.password : '';
    if (!emailNorm || !password) {
      return jsonResponse(
        { ok: false, error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
        401,
      );
    }

    const row = await db
      .prepare(
        `SELECT account_id, password_hash, password_salt, password_iterations
         FROM accounts
         WHERE email_normalized = ?
         LIMIT 1`,
      )
      .bind(emailNorm)
      .first<{
        account_id: string;
        password_hash: string;
        password_salt: string;
        password_iterations: number;
      }>();

    if (!row) {
      // Constant-time dummy work to mitigate user enumeration timing
      await hashPassword(password, '0123456789abcdef0123456789abcdef', 100_000);
      return jsonResponse(
        { ok: false, error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
        401,
      );
    }

    const valid = await verifyPassword(
      password,
      row.password_hash,
      row.password_salt,
      Number(row.password_iterations) || 100_000,
    );
    if (!valid) {
      return jsonResponse(
        { ok: false, error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
        401,
      );
    }

    const now = Date.now();
    await db
      .prepare('UPDATE accounts SET last_login_at = ? WHERE account_id = ?')
      .bind(now, row.account_id)
      .run();

    const tokens = await createSessionTokens(
      db,
      row.account_id,
      request.headers.get('User-Agent') ?? '',
    );
    const [account, playerSave, worldSaves] = await Promise.all([
      loadAccountInfo(db, row.account_id),
      loadPlayerSave(db, row.account_id),
      listWorldSaveSummaries(db, row.account_id),
    ]);

    return jsonResponse({
      ok: true,
      success: true,
      account,
      tokens,
      playerSave,
      worldSaves,
    });
  }

  // ---------------------------------------------------------------------------
  // 3. POST /auth/logout
  // ---------------------------------------------------------------------------
  if (method === 'POST' && path === '/auth/logout') {
    const token = extractBearerToken(request);
    if (token) {
      const tokenHash = await sha256Hex(token);
      await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    }
    return jsonResponse({ ok: true });
  }

  // ---------------------------------------------------------------------------
  // 4. POST /auth/refresh
  // ---------------------------------------------------------------------------
  if (method === 'POST' && path === '/auth/refresh') {
    const parsed = await parseJsonBounded(request, MAX_AUTH_BODY_BYTES);
    if (!parsed.ok) return jsonResponse({ ok: false, error: parsed.error }, parsed.status);

    const rawRefresh =
      typeof parsed.data.refreshToken === 'string' ? parsed.data.refreshToken.trim() : '';
    if (rawRefresh.length < 24) {
      return jsonResponse({ ok: false, error: 'INVALID_REFRESH_TOKEN' }, 401);
    }

    const refreshHash = await sha256Hex(rawRefresh);
    const now = Date.now();
    const sess = await db
      .prepare(
        `SELECT session_id, account_id, refresh_expires_at
         FROM sessions
         WHERE refresh_token_hash = ?
         LIMIT 1`,
      )
      .bind(refreshHash)
      .first<{ session_id: string; account_id: string; refresh_expires_at: number }>();

    if (!sess || Number(sess.refresh_expires_at) <= now) {
      return jsonResponse(
        { ok: false, error: 'SESSION_EXPIRED', message: 'Session expired. Please log in again.' },
        401,
      );
    }

    // Rotate tokens atomically
    const newSessionToken = randomHex(32);
    const newRefreshToken = randomHex(32);
    const newTokenHash = await sha256Hex(newSessionToken);
    const newRefreshHash = await sha256Hex(newRefreshToken);
    const expiresAt = now + SESSION_TTL_MS;
    const refreshExpiresAt = now + REFRESH_TTL_MS;

    await db
      .prepare(
        `UPDATE sessions
         SET token_hash = ?, refresh_token_hash = ?, expires_at = ?, refresh_expires_at = ?, last_used_at = ?
         WHERE session_id = ?`,
      )
      .bind(newTokenHash, newRefreshHash, expiresAt, refreshExpiresAt, now, sess.session_id)
      .run();

    const account = await loadAccountInfo(db, sess.account_id);
    return jsonResponse({
      ok: true,
      account,
      tokens: {
        sessionToken: newSessionToken,
        refreshToken: newRefreshToken,
        expiresAt,
        refreshExpiresAt,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 5. POST /auth/forgot-password
  // ---------------------------------------------------------------------------
  if (method === 'POST' && path === '/auth/forgot-password') {
    if (!authResetLimiter.check(clientIp)) {
      return jsonResponse(
        { ok: false, error: 'RATE_LIMITED', message: 'Too many reset requests. Please try again later.' },
        429,
      );
    }

    const parsed = await parseJsonBounded(request, MAX_AUTH_BODY_BYTES);
    if (!parsed.ok) return jsonResponse({ ok: false, error: parsed.error }, parsed.status);

    const emailNorm = normalizeEmail(parsed.data.email);
    const genericMsg =
      'If an account exists for that email, a password reset code has been generated.';

    if (!emailNorm) {
      return jsonResponse({ ok: true, message: genericMsg });
    }

    const row = await db
      .prepare(
        `SELECT a.account_id, a.email, p.display_name
         FROM accounts a
         INNER JOIN profiles p ON p.account_id = a.account_id
         WHERE a.email_normalized = ?
         LIMIT 1`,
      )
      .bind(emailNorm)
      .first<{ account_id: string; email: string; display_name: string }>();

    if (!row) {
      return jsonResponse({ ok: true, message: genericMsg });
    }

    const resetCode = generateResetCode();
    const codeHash = await sha256Hex(`${row.account_id}:${resetCode.toUpperCase()}`);
    const now = Date.now();
    const resetId = `rst_${randomHex(10)}`;

    await db
      .prepare(
        `INSERT INTO password_resets (reset_id, account_id, code_hash, expires_at, used_at, attempts, created_at)
         VALUES (?, ?, ?, ?, NULL, 0, ?)`,
      )
      .bind(resetId, row.account_id, codeHash, now + RESET_CODE_TTL_MS, now)
      .run();

    const emailSent = await sendResetEmailIfConfigured(
      env,
      row.email,
      row.display_name,
      resetCode,
    );

    const isDev = (env.ENVIRONMENT ?? 'development') !== 'production';
    return jsonResponse({
      ok: true,
      message: genericMsg,
      emailDelivered: emailSent,
      // Only expose devResetCode in non-production testing when no email provider is configured
      ...(!emailSent && isDev ? { devResetCode: resetCode } : {}),
    });
  }

  // ---------------------------------------------------------------------------
  // 6. POST /auth/reset-password
  // ---------------------------------------------------------------------------
  if (method === 'POST' && path === '/auth/reset-password') {
    if (!authResetLimiter.check(clientIp)) {
      return jsonResponse(
        { ok: false, error: 'RATE_LIMITED', message: 'Too many reset attempts. Try again later.' },
        429,
      );
    }

    const parsed = await parseJsonBounded(request, MAX_AUTH_BODY_BYTES);
    if (!parsed.ok) return jsonResponse({ ok: false, error: parsed.error }, parsed.status);

    const emailNorm = normalizeEmail(parsed.data.email);
    const code = typeof parsed.data.code === 'string' ? parsed.data.code.trim().toUpperCase() : '';
    const pwCheck = validatePasswordStrength(parsed.data.newPassword);
    if (!pwCheck.ok) {
      return jsonResponse({ ok: false, error: 'WEAK_PASSWORD', message: pwCheck.error }, 400);
    }
    if (!emailNorm || code.length < 4) {
      return jsonResponse(
        { ok: false, error: 'INVALID_RESET_CODE', message: 'Invalid or expired reset code.' },
        400,
      );
    }

    const accountRow = await db
      .prepare('SELECT account_id FROM accounts WHERE email_normalized = ? LIMIT 1')
      .bind(emailNorm)
      .first<{ account_id: string }>();
    if (!accountRow) {
      return jsonResponse(
        { ok: false, error: 'INVALID_RESET_CODE', message: 'Invalid or expired reset code.' },
        400,
      );
    }

    const resetRow = await db
      .prepare(
        `SELECT reset_id, code_hash, expires_at, used_at, attempts
         FROM password_resets
         WHERE account_id = ? AND used_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .bind(accountRow.account_id)
      .first<{
        reset_id: string;
        code_hash: string;
        expires_at: number;
        used_at: number | null;
        attempts: number;
      }>();

    const now = Date.now();
    if (
      !resetRow ||
      Number(resetRow.expires_at) <= now ||
      Number(resetRow.attempts) >= MAX_RESET_ATTEMPTS
    ) {
      return jsonResponse(
        { ok: false, error: 'INVALID_RESET_CODE', message: 'Reset code is invalid or has expired.' },
        400,
      );
    }

    const expectedHash = await sha256Hex(`${accountRow.account_id}:${code}`);
    if (expectedHash !== resetRow.code_hash) {
      await db
        .prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE reset_id = ?')
        .bind(resetRow.reset_id)
        .run();
      return jsonResponse(
        { ok: false, error: 'INVALID_RESET_CODE', message: 'Invalid or expired reset code.' },
        400,
      );
    }

    const { hash, salt, iterations } = await hashPassword(pwCheck.value);
    await db.batch([
      db
        .prepare(
          'UPDATE accounts SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ? WHERE account_id = ?',
        )
        .bind(hash, salt, iterations, now, accountRow.account_id),
      db
        .prepare('UPDATE password_resets SET used_at = ? WHERE reset_id = ?')
        .bind(now, resetRow.reset_id),
      db
        .prepare('DELETE FROM sessions WHERE account_id = ?')
        .bind(accountRow.account_id),
    ]);

    return jsonResponse({
      ok: true,
      message: 'Password has been reset successfully. Please log in with your new password.',
    });
  }

  // ---------------------------------------------------------------------------
  // ALL ROUTES BELOW REQUIRE AUTHENTICATED SESSION (server-derived accountId)
  // ---------------------------------------------------------------------------
  const auth = await authenticateRequest(request, db);
  if (!auth) {
    return jsonResponse(
      { ok: false, error: 'UNAUTHORIZED', message: 'Authentication required.' },
      401,
    );
  }
  const authenticatedAccountId = auth.accountId;

  // 7. POST /auth/change-password
  if (method === 'POST' && path === '/auth/change-password') {
    const parsed = await parseJsonBounded(request, MAX_AUTH_BODY_BYTES);
    if (!parsed.ok) return jsonResponse({ ok: false, error: parsed.error }, parsed.status);

    const currentPassword =
      typeof parsed.data.currentPassword === 'string' ? parsed.data.currentPassword : '';
    const pwCheck = validatePasswordStrength(parsed.data.newPassword);
    if (!pwCheck.ok) {
      return jsonResponse({ ok: false, error: 'WEAK_PASSWORD', message: pwCheck.error }, 400);
    }

    const row = await db
      .prepare('SELECT password_hash, password_salt, password_iterations FROM accounts WHERE account_id = ? LIMIT 1')
      .bind(authenticatedAccountId)
      .first<{ password_hash: string; password_salt: string; password_iterations: number }>();
    if (!row) return jsonResponse({ ok: false, error: 'ACCOUNT_NOT_FOUND' }, 404);

    const valid = await verifyPassword(
      currentPassword,
      row.password_hash,
      row.password_salt,
      Number(row.password_iterations) || 100_000,
    );
    if (!valid) {
      return jsonResponse(
        { ok: false, error: 'INVALID_CURRENT_PASSWORD', message: 'Current password is incorrect.' },
        403,
      );
    }

    const { hash, salt, iterations } = await hashPassword(pwCheck.value);
    const now = Date.now();
    await db.batch([
      db
        .prepare(
          'UPDATE accounts SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ? WHERE account_id = ?',
        )
        .bind(hash, salt, iterations, now, authenticatedAccountId),
      // Keep current session active, revoke all other devices
      db
        .prepare('DELETE FROM sessions WHERE account_id = ? AND session_id != ?')
        .bind(authenticatedAccountId, auth.sessionId),
    ]);

    return jsonResponse({ ok: true, message: 'Password updated successfully.' });
  }

  // 8. GET /account/me
  if (method === 'GET' && path === '/account/me') {
    const [account, playerSave, worldSaves] = await Promise.all([
      loadAccountInfo(db, authenticatedAccountId),
      loadPlayerSave(db, authenticatedAccountId),
      listWorldSaveSummaries(db, authenticatedAccountId),
    ]);
    if (!account) {
      return jsonResponse({ ok: false, error: 'ACCOUNT_NOT_FOUND' }, 404);
    }
    return jsonResponse({ ok: true, account, playerSave, worldSaves });
  }

  // 9. PATCH /account/profile
  if ((method === 'PATCH' || method === 'POST') && path === '/account/profile') {
    const parsed = await parseJsonBounded(request, MAX_AUTH_BODY_BYTES);
    if (!parsed.ok) return jsonResponse({ ok: false, error: parsed.error }, parsed.status);

    // Reject attempts to overwrite immutable IDs
    if ('accountId' in parsed.data || 'publicProfileId' in parsed.data) {
      workerSecurityLogger.record({
        category: 'AUTHORITY_VIOLATION',
        code: 'FORBIDDEN_IMMUTABLE_FIELD',
        severity: 'high',
        actorId: auth.publicProfileId,
        detail: 'accountId/publicProfileId',
      });
      return jsonResponse(
        { ok: false, error: 'IMMUTABLE_IDENTITY_FIELD', message: 'Account ID and Player ID cannot be modified.' },
        403,
      );
    }

    const current = await loadAccountInfo(db, authenticatedAccountId);
    if (!current) return jsonResponse({ ok: false, error: 'ACCOUNT_NOT_FOUND' }, 404);

    let nextDisplayName = current.displayName;
    if (parsed.data.displayName !== undefined) {
      const check = validatePlayerName(parsed.data.displayName);
      if (!check.ok) {
        return jsonResponse(
          { ok: false, error: check.code, message: check.reason || 'Display name must be 3–20 valid characters.' },
          400,
        );
      }
      nextDisplayName = check.name;
    }

    const nextAvatar =
      parsed.data.avatar && typeof parsed.data.avatar === 'object'
        ? migrateAvatarConfig(parsed.data.avatar as AvatarConfig).avatar
        : current.avatar;
    const nextBio =
      parsed.data.bio !== undefined ? sanitizeBio(parsed.data.bio) : current.bio;
    const nextCountry =
      parsed.data.country !== undefined
        ? sanitizeCountryRegion(parsed.data.country)
        : current.country;
    const nextMode =
      typeof parsed.data.favoriteGameMode === 'string' &&
      ALLOWED_WORLD_MODES.has(parsed.data.favoriteGameMode)
        ? parsed.data.favoriteGameMode
        : current.favoriteGameMode;
    const nextPrivacy: PlayerPrivacySettings =
      parsed.data.privacy && typeof parsed.data.privacy === 'object'
        ? {
            ...current.privacy,
            ...(parsed.data.privacy as Partial<PlayerPrivacySettings>),
          }
        : current.privacy;

    const now = Date.now();
    await db
      .prepare(
        `UPDATE profiles
         SET display_name = ?, avatar_json = ?, bio = ?, country = ?, favorite_game_mode = ?, privacy_json = ?, updated_at = ?
         WHERE account_id = ?`,
      )
      .bind(
        nextDisplayName,
        JSON.stringify(nextAvatar),
        nextBio,
        nextCountry,
        nextMode,
        JSON.stringify(nextPrivacy),
        now,
        authenticatedAccountId,
      )
      .run();

    const updated = await loadAccountInfo(db, authenticatedAccountId);
    return jsonResponse({ ok: true, account: updated });
  }

  // 10. DELETE /account
  if (method === 'DELETE' && path === '/account') {
    const parsed = await parseJsonBounded(request, MAX_AUTH_BODY_BYTES);
    if (!parsed.ok) return jsonResponse({ ok: false, error: parsed.error }, parsed.status);

    const password = typeof parsed.data.password === 'string' ? parsed.data.password : '';
    const confirmDelete = parsed.data.confirmDelete === true;
    if (!confirmDelete || !password) {
      return jsonResponse(
        {
          ok: false,
          error: 'DELETE_CONFIRMATION_REQUIRED',
          message: 'Please enter your password and confirm account deletion.',
        },
        400,
      );
    }

    const row = await db
      .prepare('SELECT password_hash, password_salt, password_iterations FROM accounts WHERE account_id = ? LIMIT 1')
      .bind(authenticatedAccountId)
      .first<{ password_hash: string; password_salt: string; password_iterations: number }>();
    if (!row) return jsonResponse({ ok: false, error: 'ACCOUNT_NOT_FOUND' }, 404);

    const valid = await verifyPassword(
      password,
      row.password_hash,
      row.password_salt,
      Number(row.password_iterations) || 100_000,
    );
    if (!valid) {
      return jsonResponse(
        { ok: false, error: 'INVALID_PASSWORD', message: 'Incorrect password.' },
        403,
      );
    }

    // Explicitly delete all child records + account (safe even if PRAGMA foreign_keys is off)
    await db.batch([
      db.prepare('DELETE FROM sessions WHERE account_id = ?').bind(authenticatedAccountId),
      db.prepare('DELETE FROM password_resets WHERE account_id = ?').bind(authenticatedAccountId),
      db.prepare('DELETE FROM friendships WHERE account_id = ?').bind(authenticatedAccountId),
      db.prepare('DELETE FROM world_saves WHERE account_id = ?').bind(authenticatedAccountId),
      db.prepare('DELETE FROM account_settings WHERE account_id = ?').bind(authenticatedAccountId),
      db.prepare('DELETE FROM player_achievements WHERE account_id = ?').bind(authenticatedAccountId),
      db.prepare('DELETE FROM player_quests WHERE account_id = ?').bind(authenticatedAccountId),
      db.prepare('DELETE FROM player_inventory WHERE account_id = ?').bind(authenticatedAccountId),
      db.prepare('DELETE FROM player_progress WHERE account_id = ?').bind(authenticatedAccountId),
      db.prepare('DELETE FROM profiles WHERE account_id = ?').bind(authenticatedAccountId),
      db.prepare('DELETE FROM accounts WHERE account_id = ?').bind(authenticatedAccountId),
    ]);

    return jsonResponse({ ok: true, deleted: true });
  }

  // ---------------------------------------------------------------------------
  // 11. GET /player/save
  // ---------------------------------------------------------------------------
  if (method === 'GET' && path === '/player/save') {
    const save = await loadPlayerSave(db, authenticatedAccountId);
    return jsonResponse({ ok: true, save });
  }

  // ---------------------------------------------------------------------------
  // 12. PUT /player/save
  // ---------------------------------------------------------------------------
  if ((method === 'PUT' || method === 'POST') && path === '/player/save') {
    if (!saveWriteLimiter.check(clientIp)) {
      return jsonResponse({ ok: false, error: 'RATE_LIMITED' }, 429);
    }

    const parsed = await parseJsonBounded(request, MAX_PLAYER_SAVE_BYTES);
    if (!parsed.ok) return jsonResponse({ ok: false, error: parsed.error }, parsed.status);

    // Never trust a client-supplied accountId targeting another user
    if (
      typeof parsed.data.accountId === 'string' &&
      parsed.data.accountId.trim() &&
      parsed.data.accountId.trim() !== authenticatedAccountId
    ) {
      workerSecurityLogger.record({
        category: 'AUTHORITY_VIOLATION',
        code: 'CROSS_ACCOUNT_SAVE_ATTEMPT',
        severity: 'high',
        actorId: auth.publicProfileId,
        detail: parsed.data.accountId.trim().slice(0, 40),
      });
      return jsonResponse(
        { ok: false, error: 'FORBIDDEN_ACCOUNT_MISMATCH', message: 'Cannot modify another account.' },
        403,
      );
    }

    const existing = await loadPlayerSave(db, authenticatedAccountId);
    const currentRevision = existing?.revision ?? 0;
    const expectedRevision =
      typeof parsed.data.baseRevision === 'number'
        ? Math.floor(parsed.data.baseRevision)
        : typeof parsed.data.revision === 'number'
          ? Math.floor(parsed.data.revision)
          : null;
    const forceOverwrite = parsed.data.forceOverwrite === true;

    if (
      !forceOverwrite &&
      expectedRevision !== null &&
      currentRevision > 0 &&
      expectedRevision < currentRevision
    ) {
      return jsonResponse(
        {
          ok: false,
          error: 'SAVE_CONFLICT',
          message: 'Newer cloud save exists on the server.',
          serverRevision: currentRevision,
          serverUpdatedAt: existing?.updatedAt ?? Date.now(),
          serverSave: existing,
        },
        409,
      );
    }

    const rawProgress = (parsed.data.progress ?? {}) as Record<string, unknown>;
    const prevProgress = existing?.progress;
    const level = clampInt(rawProgress.level, 1, 999, prevProgress?.level ?? 1);
    const xp = clampInt(rawProgress.xp, 0, 10_000_000, prevProgress?.xp ?? 0);
    const xpToNextLevel = clampInt(
      rawProgress.xpToNextLevel,
      50,
      10_000_000,
      prevProgress?.xpToNextLevel ?? 100,
    );
    const coins = clampInt(rawProgress.coins, 0, 10_000_000, prevProgress?.coins ?? 0);
    const maxHealth = clampInt(rawProgress.maxHealth, 50, 5000, prevProgress?.maxHealth ?? 100);
    const maxStamina = clampInt(rawProgress.maxStamina, 50, 5000, prevProgress?.maxStamina ?? 100);
    const secondaryCurrencies = sanitizeNumberMap(
      rawProgress.secondaryCurrencies ?? prevProgress?.secondaryCurrencies,
    );
    const unlockedCharacters = sanitizeStringArray(
      rawProgress.unlockedCharacters ?? prevProgress?.unlockedCharacters,
    );
    const unlockedAbilities = sanitizeStringArray(
      rawProgress.unlockedAbilities ?? prevProgress?.unlockedAbilities,
    );
    const skills = sanitizeNumberMap(rawProgress.skills ?? prevProgress?.skills, 100, 0, 999);
    const stats = sanitizeStats(rawProgress.stats ?? prevProgress?.stats);
    stats.level = level;
    stats.xp = xp;
    stats.xpToNextLevel = xpToNextLevel;

    const inventoryObj =
      parsed.data.inventory && typeof parsed.data.inventory === 'object' && !Array.isArray(parsed.data.inventory)
        ? (parsed.data.inventory as Record<string, unknown>)
        : existing?.inventory ?? {};
    const questsObj =
      parsed.data.quests && typeof parsed.data.quests === 'object' && !Array.isArray(parsed.data.quests)
        ? (parsed.data.quests as Record<string, unknown>)
        : existing?.quests ?? {};
    const achievements = sanitizeStringArray(
      parsed.data.achievements ?? existing?.achievements,
      300,
      64,
    );
    const settingsObj =
      parsed.data.settings && typeof parsed.data.settings === 'object' && !Array.isArray(parsed.data.settings)
        ? (parsed.data.settings as Record<string, unknown>)
        : existing?.settings ?? {};
    const language =
      typeof settingsObj.language === 'string' && settingsObj.language === 'ar' ? 'ar' : 'en';

    const saveVersion = clampInt(
      parsed.data.saveVersion,
      1,
      100,
      existing?.saveVersion ?? CLOUD_SAVE_SCHEMA_VERSION,
    );
    const nextRevision = currentRevision + 1;
    const now = Date.now();

    await db.batch([
      db
        .prepare(
          `INSERT INTO player_progress
           (account_id, save_version, revision, level, xp, xp_to_next_level, coins, secondary_currencies_json, max_health, max_stamina, unlocked_characters_json, unlocked_abilities_json, skills_json, stats_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id) DO UPDATE SET
             save_version = excluded.save_version,
             revision = excluded.revision,
             level = excluded.level,
             xp = excluded.xp,
             xp_to_next_level = excluded.xp_to_next_level,
             coins = excluded.coins,
             secondary_currencies_json = excluded.secondary_currencies_json,
             max_health = excluded.max_health,
             max_stamina = excluded.max_stamina,
             unlocked_characters_json = excluded.unlocked_characters_json,
             unlocked_abilities_json = excluded.unlocked_abilities_json,
             skills_json = excluded.skills_json,
             stats_json = excluded.stats_json,
             updated_at = excluded.updated_at`,
        )
        .bind(
          authenticatedAccountId,
          saveVersion,
          nextRevision,
          level,
          xp,
          xpToNextLevel,
          coins,
          JSON.stringify(secondaryCurrencies),
          maxHealth,
          maxStamina,
          JSON.stringify(unlockedCharacters),
          JSON.stringify(unlockedAbilities),
          JSON.stringify(skills),
          JSON.stringify(stats),
          now,
        ),
      db
        .prepare(
          `INSERT INTO player_inventory (account_id, inventory_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(account_id) DO UPDATE SET inventory_json = excluded.inventory_json, updated_at = excluded.updated_at`,
        )
        .bind(authenticatedAccountId, JSON.stringify(inventoryObj), now),
      db
        .prepare(
          `INSERT INTO player_quests (account_id, quests_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(account_id) DO UPDATE SET quests_json = excluded.quests_json, updated_at = excluded.updated_at`,
        )
        .bind(authenticatedAccountId, JSON.stringify(questsObj), now),
      db
        .prepare(
          `INSERT INTO player_achievements (account_id, achievements_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(account_id) DO UPDATE SET achievements_json = excluded.achievements_json, updated_at = excluded.updated_at`,
        )
        .bind(authenticatedAccountId, JSON.stringify(achievements), now),
      db
        .prepare(
          `INSERT INTO account_settings (account_id, settings_json, language, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(account_id) DO UPDATE SET settings_json = excluded.settings_json, language = excluded.language, updated_at = excluded.updated_at`,
        )
        .bind(authenticatedAccountId, JSON.stringify(settingsObj), language, now),
    ]);

    const updatedSave = await loadPlayerSave(db, authenticatedAccountId);
    return jsonResponse({ ok: true, save: updatedSave });
  }

  // ---------------------------------------------------------------------------
  // 13. GET /world-saves
  // ---------------------------------------------------------------------------
  if (method === 'GET' && path === '/world-saves') {
    const includeData = url.searchParams.get('includeData') === '1';
    if (!includeData) {
      const worlds = await listWorldSaveSummaries(db, authenticatedAccountId);
      return jsonResponse({ ok: true, worlds });
    }
    const res = await db
      .prepare(
        `SELECT * FROM world_saves
         WHERE account_id = ?
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .bind(authenticatedAccountId, MAX_WORLD_SAVES_PER_ACCOUNT)
      .all<Record<string, unknown>>();

    const worlds: CloudWorldSaveRecord[] = (res.results ?? []).map((row) => ({
      worldId: String(row.world_id),
      worldName: String(row.world_name),
      worldSeed: Number(row.world_seed) || 0,
      worldMode: (ALLOWED_WORLD_MODES.has(String(row.world_mode))
        ? String(row.world_mode)
        : 'normal') as CloudWorldSaveRecord['worldMode'],
      difficulty: (ALLOWED_DIFFICULTIES.has(String(row.difficulty))
        ? String(row.difficulty)
        : 'normal') as CloudWorldSaveRecord['difficulty'],
      saveVersion: Number(row.save_version) || 6,
      revision: Number(row.revision) || 1,
      playTimeSeconds: Number(row.play_time_seconds) || 0,
      level: Number(row.level) || 1,
      createdAt: Number(row.created_at) || Date.now(),
      updatedAt: Number(row.updated_at) || Date.now(),
      data: safeJsonParse<Record<string, unknown>>(row.data_json, {}),
    }));
    return jsonResponse({ ok: true, worlds });
  }

  // ---------------------------------------------------------------------------
  // 14. GET /world-saves/:id
  // ---------------------------------------------------------------------------
  if (method === 'GET' && path.startsWith('/world-saves/')) {
    const worldId = decodeURIComponent(path.slice('/world-saves/'.length)).trim();
    if (!WORLD_ID_RE.test(worldId)) {
      return jsonResponse({ ok: false, error: 'INVALID_WORLD_ID' }, 400);
    }
    const row = await db
      .prepare('SELECT * FROM world_saves WHERE account_id = ? AND world_id = ? LIMIT 1')
      .bind(authenticatedAccountId, worldId)
      .first<Record<string, unknown>>();
    if (!row) {
      return jsonResponse({ ok: false, error: 'WORLD_SAVE_NOT_FOUND' }, 404);
    }
    const world: CloudWorldSaveRecord = {
      worldId: String(row.world_id),
      worldName: String(row.world_name),
      worldSeed: Number(row.world_seed) || 0,
      worldMode: (ALLOWED_WORLD_MODES.has(String(row.world_mode))
        ? String(row.world_mode)
        : 'normal') as CloudWorldSaveRecord['worldMode'],
      difficulty: (ALLOWED_DIFFICULTIES.has(String(row.difficulty))
        ? String(row.difficulty)
        : 'normal') as CloudWorldSaveRecord['difficulty'],
      saveVersion: Number(row.save_version) || 6,
      revision: Number(row.revision) || 1,
      playTimeSeconds: Number(row.play_time_seconds) || 0,
      level: Number(row.level) || 1,
      createdAt: Number(row.created_at) || Date.now(),
      updatedAt: Number(row.updated_at) || Date.now(),
      data: safeJsonParse<Record<string, unknown>>(row.data_json, {}),
    };
    return jsonResponse({ ok: true, world });
  }

  // ---------------------------------------------------------------------------
  // 15. POST /world-saves  &  PUT /world-saves/:id
  // ---------------------------------------------------------------------------
  if (
    (method === 'POST' && path === '/world-saves') ||
    (method === 'PUT' && path.startsWith('/world-saves/'))
  ) {
    if (!saveWriteLimiter.check(clientIp)) {
      return jsonResponse({ ok: false, error: 'RATE_LIMITED' }, 429);
    }

    const parsed = await parseJsonBounded(request, MAX_WORLD_SAVE_BYTES);
    if (!parsed.ok) return jsonResponse({ ok: false, error: parsed.error }, parsed.status);

    const pathWorldId = path.startsWith('/world-saves/')
      ? decodeURIComponent(path.slice('/world-saves/'.length)).trim()
      : '';
    const worldId =
      pathWorldId ||
      (typeof parsed.data.worldId === 'string' ? parsed.data.worldId.trim() : '');
    if (!WORLD_ID_RE.test(worldId)) {
      return jsonResponse({ ok: false, error: 'INVALID_WORLD_ID' }, 400);
    }

    const existing = await db
      .prepare('SELECT revision, updated_at, created_at FROM world_saves WHERE account_id = ? AND world_id = ? LIMIT 1')
      .bind(authenticatedAccountId, worldId)
      .first<{ revision: number; updated_at: number; created_at: number }>();

    if (!existing) {
      const countRow = await db
        .prepare('SELECT COUNT(*) as cnt FROM world_saves WHERE account_id = ?')
        .bind(authenticatedAccountId)
        .first<{ cnt: number }>();
      if (Number(countRow?.cnt ?? 0) >= MAX_WORLD_SAVES_PER_ACCOUNT) {
        return jsonResponse(
          { ok: false, error: 'MAX_WORLD_SAVES_REACHED', message: `Maximum ${MAX_WORLD_SAVES_PER_ACCOUNT} cloud worlds reached.` },
          400,
        );
      }
    }

    const currentRev = existing ? Number(existing.revision) || 1 : 0;
    const baseRevision =
      typeof parsed.data.baseRevision === 'number' ? Math.floor(parsed.data.baseRevision) : null;
    const forceOverwrite = parsed.data.forceOverwrite === true;
    if (!forceOverwrite && baseRevision !== null && currentRev > 0 && baseRevision < currentRev) {
      return jsonResponse(
        {
          ok: false,
          error: 'SAVE_CONFLICT',
          serverRevision: currentRev,
          serverUpdatedAt: Number(existing?.updated_at) || Date.now(),
        },
        409,
      );
    }

    const worldName =
      typeof parsed.data.worldName === 'string' && parsed.data.worldName.trim()
        ? parsed.data.worldName.trim().slice(0, 48)
        : 'Oakhollow Valley';
    const worldSeed = clampInt(parsed.data.worldSeed, -2_147_483_648, 2_147_483_647, 1337);
    const worldMode =
      typeof parsed.data.worldMode === 'string' && ALLOWED_WORLD_MODES.has(parsed.data.worldMode)
        ? parsed.data.worldMode
        : 'normal';
    const difficulty =
      typeof parsed.data.difficulty === 'string' && ALLOWED_DIFFICULTIES.has(parsed.data.difficulty)
        ? parsed.data.difficulty
        : 'normal';
    const saveVersion = clampInt(parsed.data.saveVersion, 1, 100, 6);
    const playTimeSeconds = clampInt(parsed.data.playTimeSeconds, 0, 100_000_000, 0);
    const level = clampInt(parsed.data.level, 1, 999, 1);
    const dataObj =
      parsed.data.data && typeof parsed.data.data === 'object' && !Array.isArray(parsed.data.data)
        ? (parsed.data.data as Record<string, unknown>)
        : {};
    const now = Date.now();
    const createdAt = existing ? Number(existing.created_at) || now : clampInt(parsed.data.createdAt, 0, now + 60_000, now);
    const nextRevision = currentRev + 1;

    await db
      .prepare(
        `INSERT INTO world_saves
         (account_id, world_id, world_name, world_seed, world_mode, difficulty, save_version, revision, play_time_seconds, level, data_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, world_id) DO UPDATE SET
           world_name = excluded.world_name,
           world_seed = excluded.world_seed,
           world_mode = excluded.world_mode,
           difficulty = excluded.difficulty,
           save_version = excluded.save_version,
           revision = excluded.revision,
           play_time_seconds = excluded.play_time_seconds,
           level = excluded.level,
           data_json = excluded.data_json,
           updated_at = excluded.updated_at`,
      )
      .bind(
        authenticatedAccountId,
        worldId,
        worldName,
        worldSeed,
        worldMode,
        difficulty,
        saveVersion,
        nextRevision,
        playTimeSeconds,
        level,
        JSON.stringify(dataObj),
        createdAt,
        now,
      )
      .run();

    return jsonResponse({
      ok: true,
      world: {
        worldId,
        worldName,
        worldSeed,
        worldMode,
        difficulty,
        saveVersion,
        revision: nextRevision,
        playTimeSeconds,
        level,
        createdAt,
        updatedAt: now,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 16. DELETE /world-saves/:id
  // ---------------------------------------------------------------------------
  if (method === 'DELETE' && path.startsWith('/world-saves/')) {
    const worldId = decodeURIComponent(path.slice('/world-saves/'.length)).trim();
    if (!WORLD_ID_RE.test(worldId)) {
      return jsonResponse({ ok: false, error: 'INVALID_WORLD_ID' }, 400);
    }
    await db
      .prepare('DELETE FROM world_saves WHERE account_id = ? AND world_id = ?')
      .bind(authenticatedAccountId, worldId)
      .run();
    return jsonResponse({ ok: true, deleted: true, worldId });
  }

  return jsonResponse({ ok: false, error: 'NOT_FOUND' }, 404);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/no such table/i.test(msg)) {
      return jsonResponse(
        {
          ok: false,
          error: 'CLOUD_DB_MIGRATION_REQUIRED',
          message: 'Account database schema has not been migrated yet.',
        },
        503,
      );
    }
    throw err;
  }
}
