import type {
  AuthResponsePayload,
  AuthTokenBundle,
  CloudAccountInfo,
} from '../../../shared/accountTypes';
import type {
  AvatarConfig,
  FavoriteGameMode,
  OwnPlayerProfile,
  PlayerPrivacySettings,
} from '../../../shared/profileTypes';
import { resolveMultiplayerServerUrl } from '../multiplayer/multiplayerConfig';

const AUTH_SESSION_STORAGE_KEY = 'woa_auth_session_v1';
const CLOUD_ACCOUNT_CACHE_KEY = 'woa_cloud_account_cache_v1';
const FIRST_LAUNCH_PROMPT_SEEN_KEY = 'woa_account_prompt_seen_v1';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface AuthSession {
  publicProfileId: string;
  sessionToken: string;
  verifiedWithServer: boolean;
  createdAt: number;
  accountId?: string;
  email?: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshExpiresAt?: number;
  isCloudAccount?: boolean;
}

export interface AuthUser {
  publicProfileId: string;
  verifiedWithServer: boolean;
  accountId?: string;
  email?: string;
  isCloudAccount?: boolean;
}

function getCryptoRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
    return bytes;
  }
  throw new Error('Cryptographically secure random generator is unavailable.');
}

export function generateSecureLocalPublicProfileId(): string {
  const bytes = getCryptoRandomBytes(8);
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `WA-${suffix}`;
}

export function generateSecureLocalPlayerTag(): string {
  const bytes = getCryptoRandomBytes(2);
  const val = ((bytes[0] << 8) | bytes[1]) % 10000;
  return String(val).padStart(4, '0');
}

function generateLocalSessionToken(): string {
  const bytes = getCryptoRandomBytes(24);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function readCachedCloudAccount(): CloudAccountInfo | null {
  try {
    const raw = localStorage.getItem(CLOUD_ACCOUNT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CloudAccountInfo | null;
    if (!parsed || typeof parsed.accountId !== 'string' || typeof parsed.publicProfileId !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedCloudAccount(account: CloudAccountInfo | null): void {
  try {
    if (!account) {
      localStorage.removeItem(CLOUD_ACCOUNT_CACHE_KEY);
    } else {
      localStorage.setItem(CLOUD_ACCOUNT_CACHE_KEY, JSON.stringify(account));
    }
  } catch {
    // Ignore storage quota errors
  }
}

class AuthServiceImpl {
  private cachedSession: AuthSession | null = null;
  private cachedAccount: CloudAccountInfo | null = null;
  private initialized = false;
  private readonly listeners = new Set<() => void>();

  private ensureLoaded(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.cachedAccount = readCachedCloudAccount();
    try {
      const raw = localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<AuthSession> | null;
      if (
        parsed &&
        typeof parsed.publicProfileId === 'string' &&
        typeof parsed.sessionToken === 'string' &&
        parsed.publicProfileId.startsWith('WA-') &&
        parsed.sessionToken.length >= 16
      ) {
        this.cachedSession = {
          publicProfileId: parsed.publicProfileId,
          sessionToken: parsed.sessionToken,
          verifiedWithServer: Boolean(parsed.verifiedWithServer),
          createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
          ...(typeof parsed.accountId === 'string' ? { accountId: parsed.accountId } : {}),
          ...(typeof parsed.email === 'string' ? { email: parsed.email } : {}),
          ...(typeof parsed.refreshToken === 'string' ? { refreshToken: parsed.refreshToken } : {}),
          ...(typeof parsed.expiresAt === 'number' ? { expiresAt: parsed.expiresAt } : {}),
          ...(typeof parsed.refreshExpiresAt === 'number'
            ? { refreshExpiresAt: parsed.refreshExpiresAt }
            : {}),
          isCloudAccount: Boolean(parsed.isCloudAccount),
        };
      }
    } catch {
      this.cachedSession = null;
    }
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        // Never allow subscriber errors to break auth state
      }
    }
  }

  public subscribe(listener: () => void): () => void {
    this.ensureLoaded();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private persistSession(): void {
    try {
      if (!this.cachedSession) {
        localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
      } else {
        localStorage.setItem(
          AUTH_SESSION_STORAGE_KEY,
          JSON.stringify(this.cachedSession),
        );
      }
    } catch {
      // Ignore storage quota or private browsing errors
    }
  }

  public hasSeenFirstLaunchPrompt(): boolean {
    try {
      return localStorage.getItem(FIRST_LAUNCH_PROMPT_SEEN_KEY) === '1';
    } catch {
      return false;
    }
  }

  public markFirstLaunchPromptSeen(): void {
    try {
      localStorage.setItem(FIRST_LAUNCH_PROMPT_SEEN_KEY, '1');
    } catch {
      // Ignore
    }
  }

  public getSession(): AuthSession | null {
    this.ensureLoaded();
    return this.cachedSession ? { ...this.cachedSession } : null;
  }

  public getCloudAccount(): CloudAccountInfo | null {
    this.ensureLoaded();
    return this.cachedAccount ? { ...this.cachedAccount } : null;
  }

  public isSignedInCloudAccount(): boolean {
    this.ensureLoaded();
    return Boolean(
      this.cachedSession?.isCloudAccount &&
        this.cachedSession.verifiedWithServer &&
        this.cachedSession.accountId &&
        this.cachedSession.sessionToken,
    );
  }

  public getCurrentUser(): AuthUser | null {
    const sess = this.getSession();
    if (!sess) return null;
    return {
      publicProfileId: sess.publicProfileId,
      verifiedWithServer: sess.verifiedWithServer,
      accountId: sess.accountId,
      email: sess.email,
      isCloudAccount: Boolean(sess.isCloudAccount),
    };
  }

  public getBearerHeaders(): Record<string, string> {
    const sess = this.getSession();
    if (!sess || !sess.verifiedWithServer || !sess.sessionToken) {
      return {};
    }
    return { Authorization: `Bearer ${sess.sessionToken}` };
  }

  public signIn(input: {
    publicProfileId: string;
    sessionToken?: string;
    verifiedWithServer: boolean;
    accountId?: string;
    email?: string;
    refreshToken?: string;
    expiresAt?: number;
    refreshExpiresAt?: number;
    isCloudAccount?: boolean;
  }): AuthSession {
    this.ensureLoaded();
    const session: AuthSession = {
      publicProfileId: input.publicProfileId,
      sessionToken: input.sessionToken || generateLocalSessionToken(),
      verifiedWithServer: input.verifiedWithServer,
      createdAt: Date.now(),
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.email ? { email: input.email } : {}),
      ...(input.refreshToken ? { refreshToken: input.refreshToken } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      ...(input.refreshExpiresAt ? { refreshExpiresAt: input.refreshExpiresAt } : {}),
      isCloudAccount: Boolean(input.isCloudAccount),
    };
    this.cachedSession = session;
    this.persistSession();
    this.notify();
    return { ...session };
  }

  private applyCloudAuthSuccess(account: CloudAccountInfo, tokens: AuthTokenBundle): void {
    this.cachedAccount = account;
    writeCachedCloudAccount(account);
    this.markFirstLaunchPromptSeen();
    this.signIn({
      publicProfileId: account.publicProfileId,
      sessionToken: tokens.sessionToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt,
      accountId: account.accountId,
      email: account.email,
      verifiedWithServer: true,
      isCloudAccount: true,
    });
  }

  private requireServerBaseUrl(): string {
    const baseUrl = resolveMultiplayerServerUrl();
    if (!baseUrl) {
      throw new Error('Online account server URL is not configured.');
    }
    return baseUrl;
  }

  public async registerAccount(input: {
    displayName: string;
    email: string;
    password: string;
    avatar?: AvatarConfig;
    language?: string;
  }): Promise<AuthResponsePayload> {
    const baseUrl = this.requireServerBaseUrl();
    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => null)) as AuthResponsePayload | null;
    if (!res.ok || !data?.ok || !data.account || !data.tokens) {
      throw new Error(data?.message || data?.error || 'Account registration failed.');
    }
    this.applyCloudAuthSuccess(data.account, data.tokens);
    return data;
  }

  public async loginAccount(input: {
    email: string;
    password: string;
  }): Promise<AuthResponsePayload> {
    const baseUrl = this.requireServerBaseUrl();
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => null)) as AuthResponsePayload | null;
    if (!res.ok || !data?.ok || !data.account || !data.tokens) {
      throw new Error(data?.message || data?.error || 'Invalid email or password.');
    }
    this.applyCloudAuthSuccess(data.account, data.tokens);
    return data;
  }

  public async refreshCloudSession(): Promise<CloudAccountInfo | null> {
    this.ensureLoaded();
    const sess = this.cachedSession;
    const baseUrl = resolveMultiplayerServerUrl();
    if (!sess?.isCloudAccount || !sess.refreshToken || !baseUrl) return null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;

    try {
      const res = await fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: sess.refreshToken }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          this.signOut();
        }
        return null;
      }
      const data = (await res.json().catch(() => null)) as AuthResponsePayload | null;
      if (data?.ok && data.account && data.tokens) {
        this.applyCloudAuthSuccess(data.account, data.tokens);
        return data.account;
      }
      return null;
    } catch {
      return null;
    }
  }

  public async fetchAccountMe(): Promise<AuthResponsePayload | null> {
    this.ensureLoaded();
    const baseUrl = resolveMultiplayerServerUrl();
    if (!this.isSignedInCloudAccount() || !baseUrl) return null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;

    // Auto-refresh token if within 1 hour of expiry
    if (
      this.cachedSession?.expiresAt &&
      Date.now() > this.cachedSession.expiresAt - 60 * 60 * 1000
    ) {
      await this.refreshCloudSession();
    }

    try {
      const res = await fetch(`${baseUrl}/account/me`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...this.getBearerHeaders(),
        },
      });
      if (res.status === 401) {
        const refreshed = await this.refreshCloudSession();
        if (!refreshed) return null;
        return this.fetchAccountMe();
      }
      if (!res.ok) return null;
      const data = (await res.json().catch(() => null)) as AuthResponsePayload | null;
      if (data?.ok && data.account) {
        this.cachedAccount = data.account;
        writeCachedCloudAccount(data.account);
        this.notify();
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }

  public async updateAccountProfile(patch: {
    displayName?: string;
    avatar?: AvatarConfig;
    bio?: string;
    country?: string;
    favoriteGameMode?: FavoriteGameMode;
    privacy?: Partial<PlayerPrivacySettings>;
  }): Promise<CloudAccountInfo> {
    const baseUrl = this.requireServerBaseUrl();
    const res = await fetch(`${baseUrl}/account/profile`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...this.getBearerHeaders(),
      },
      body: JSON.stringify(patch),
    });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      message?: string;
      account?: CloudAccountInfo;
    } | null;
    if (!res.ok || !data?.ok || !data.account) {
      throw new Error(data?.message || data?.error || 'Failed to update profile.');
    }
    this.cachedAccount = data.account;
    writeCachedCloudAccount(data.account);
    this.notify();
    return data.account;
  }

  public async forgotPassword(email: string): Promise<{
    ok: boolean;
    message: string;
    devResetCode?: string;
  }> {
    const baseUrl = this.requireServerBaseUrl();
    const res = await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      message?: string;
      devResetCode?: string;
    } | null;
    if (!res.ok || !data?.ok) {
      throw new Error(data?.message || data?.error || 'Failed to request password reset.');
    }
    return {
      ok: true,
      message: data.message || 'Password reset code sent if the email exists.',
      devResetCode: data.devResetCode,
    };
  }

  public async resetPassword(input: {
    email: string;
    code: string;
    newPassword: string;
  }): Promise<string> {
    const baseUrl = this.requireServerBaseUrl();
    const res = await fetch(`${baseUrl}/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      message?: string;
    } | null;
    if (!res.ok || !data?.ok) {
      throw new Error(data?.message || data?.error || 'Password reset failed.');
    }
    return data.message || 'Password updated successfully.';
  }

  public async changePassword(input: {
    currentPassword: string;
    newPassword: string;
  }): Promise<string> {
    const baseUrl = this.requireServerBaseUrl();
    const res = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...this.getBearerHeaders(),
      },
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      message?: string;
    } | null;
    if (!res.ok || !data?.ok) {
      throw new Error(data?.message || data?.error || 'Failed to change password.');
    }
    return data.message || 'Password changed successfully.';
  }

  public async logoutAccount(): Promise<void> {
    const baseUrl = resolveMultiplayerServerUrl();
    const headers = this.getBearerHeaders();
    if (baseUrl && headers.Authorization) {
      try {
        await fetch(`${baseUrl}/auth/logout`, {
          method: 'POST',
          headers,
        });
      } catch {
        // Proceed with local logout even if offline
      }
    }
    this.signOut();
  }

  public async deleteAccount(password: string): Promise<void> {
    const baseUrl = this.requireServerBaseUrl();
    const res = await fetch(`${baseUrl}/account`, {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        ...this.getBearerHeaders(),
      },
      body: JSON.stringify({
        password,
        confirmDelete: true,
      }),
    });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      message?: string;
    } | null;
    if (!res.ok || !data?.ok) {
      throw new Error(data?.message || data?.error || 'Failed to delete account.');
    }
    this.signOut();
  }

  public async refreshSession(): Promise<OwnPlayerProfile | null> {
    const sess = this.getSession();
    const baseUrl = resolveMultiplayerServerUrl();
    if (!sess || !sess.verifiedWithServer || !baseUrl) {
      return null;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return null;
    }
    // If cloud account is active, sync from /account/me
    if (sess.isCloudAccount) {
      const me = await this.fetchAccountMe();
      if (me?.account) {
        const a = me.account;
        return {
          publicProfileId: a.publicProfileId,
          displayName: a.displayName,
          playerTag: a.playerTag,
          avatar: a.avatar,
          bio: a.bio,
          country: a.country,
          favoriteGameMode: a.favoriteGameMode,
          presenceStatus: 'online',
          manualStatus: 'online',
          isOnlineVisible: true,
          privacy: a.privacy,
          stats: a.stats,
          createdAt: a.createdAt,
          lastActiveAt: a.updatedAt,
          tagUpdatedAt: a.createdAt,
          friendsCount: 0,
          pendingIncomingRequestsCount: 0,
          pendingOutgoingRequestsCount: 0,
          blockedCount: 0,
        };
      }
      return null;
    }

    try {
      const res = await fetch(`${baseUrl}/api/profile/me`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${sess.sessionToken}`,
        },
      });
      if (!res.ok) return null;
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        profile?: OwnPlayerProfile;
      } | null;
      return data?.ok && data.profile ? data.profile : null;
    } catch {
      return null;
    }
  }

  public signOut(): void {
    this.initialized = true;
    this.cachedSession = null;
    this.cachedAccount = null;
    this.persistSession();
    writeCachedCloudAccount(null);
    this.notify();
  }
}

export const AuthService = new AuthServiceImpl();
