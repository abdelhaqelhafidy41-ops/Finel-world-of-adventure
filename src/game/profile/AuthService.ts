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

export type AuthErrorContext = 'register' | 'login' | 'forgot' | 'reset' | 'account';

export class AuthServiceError extends Error {
  public readonly code: string;
  public readonly status: number | null;
  public readonly isNetworkError: boolean;
  public readonly responseType: string;

  constructor(
    code: string,
    message: string,
    status: number | null = null,
    options?: { isNetworkError?: boolean; responseType?: string },
  ) {
    super(message);
    this.name = 'AuthServiceError';
    this.code = code;
    this.status = status;
    this.isNetworkError = Boolean(options?.isNetworkError);
    this.responseType = options?.responseType ?? (status === null ? 'network' : 'unknown');
  }
}

function logAuthDiagnosticDev(info: {
  action: string;
  method: string;
  url: string;
  status: number | null;
  responseType: string;
  code: string;
  safeMessage?: string;
}): void {
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    console.warn(
      `[Auth:${info.action}] ${info.method} ${info.url} -> status=${info.status ?? 'NETWORK_ERROR'} type=${info.responseType} code=${info.code}${info.safeMessage ? ` message="${info.safeMessage}"` : ''}`,
    );
  }
}

async function safeParseAuthResponse<T extends object>(
  res: Response,
): Promise<{ data: T | null; responseType: string; safeSnippet: string }> {
  const responseType = (res.headers.get('content-type') || 'unknown').split(';')[0].trim().toLowerCase();
  const rawText = await res.text().catch(() => '');
  if (!rawText.trim()) {
    return { data: null, responseType, safeSnippet: '' };
  }
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const safeSnippet =
        typeof obj.message === 'string'
          ? obj.message.slice(0, 140)
          : typeof obj.error === 'string'
            ? obj.error.slice(0, 80)
            : '';
      return { data: parsed as T, responseType, safeSnippet };
    }
  } catch {
    // Non-JSON response (e.g., HTML error page or plain text)
  }
  return {
    data: null,
    responseType,
    safeSnippet: rawText.replace(/\s+/g, ' ').trim().slice(0, 120),
  };
}

/**
 * Converts technical auth / network errors into accurate, friendly localized messages.
 * Strictly separates REAL network failures from HTTP 400/401/403/404/409/429/500+ server errors.
 * Never exposes raw server codes like NOT_FOUND, CLOUD_DB_NOT_CONFIGURED, or stack traces.
 */
export function formatAuthError(
  err: unknown,
  lang: 'ar' | 'en',
  context: AuthErrorContext = 'account',
): string {
  const isAr = lang === 'ar';
  const authErr = err instanceof AuthServiceError ? err : null;
  const status = authErr?.status ?? null;
  const code = (
    authErr?.code ??
    (err instanceof Error ? err.message.trim() : '')
  ).toUpperCase();

  // A. REAL NETWORK FAILURE ONLY (fetch threw, DNS/connection refused, or offline)
  if (authErr?.isNetworkError || code === 'NETWORK_ERROR' || err instanceof TypeError) {
    return isAr
      ? 'تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت وحاول مرة أخرى.'
      : 'Unable to connect to the server. Please check your internet connection and try again.';
  }

  // F. HTTP 409 — Duplicate account / email
  if (
    status === 409 ||
    code === 'EMAIL_ALREADY_REGISTERED' ||
    code === 'ACCOUNT_ALREADY_EXISTS' ||
    code === 'EMAIL_ALREADY_EXISTS'
  ) {
    return isAr
      ? 'هذا البريد الإلكتروني مستخدم بالفعل.'
      : 'This email address is already registered.';
  }

  // B. HTTP 400 — Validation / Bad Request
  if (code === 'INVALID_EMAIL') {
    return isAr
      ? 'يرجى إدخال بريد إلكتروني صحيح.'
      : 'Please enter a valid email address.';
  }
  if (code === 'WEAK_PASSWORD') {
    return isAr
      ? 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.'
      : 'Password must be at least 8 characters long.';
  }
  if (
    code === 'INVALID_NAME' ||
    code === 'NAME_TOO_SHORT' ||
    code === 'NAME_TOO_LONG' ||
    code === 'INVALID_PLAYER_NAME'
  ) {
    return isAr
      ? 'يجب أن يكون اسم اللاعب بين 3 و20 حرفاً صالحاً.'
      : 'Display name must be 3–20 valid characters.';
  }
  if (code === 'INVALID_RESET_CODE') {
    return isAr
      ? 'رمز الاستعادة غير صحيح أو منتهي الصلاحية.'
      : 'The recovery code is invalid or has expired.';
  }
  if (status === 400) {
    return isAr
      ? 'يرجى التحقق من البيانات المدخلة والمحاولة مرة أخرى.'
      : 'Please check the entered information and try again.';
  }

  // C. HTTP 401 — Authentication error
  if (status === 401 || code === 'INVALID_CREDENTIALS' || code === 'UNAUTHORIZED') {
    if (context === 'login' || code === 'INVALID_CREDENTIALS') {
      return isAr
        ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'
        : 'Invalid email or password.';
    }
    return isAr
      ? 'انتهت جلسة تسجيل الدخول. يرجى تسجيل الدخول مرة أخرى.'
      : 'Authentication required. Please log in again.';
  }

  // D. HTTP 403 — Authorization error
  if (code === 'INVALID_CURRENT_PASSWORD' || code === 'INVALID_PASSWORD') {
    return isAr
      ? 'كلمة المرور الحالية غير صحيحة.'
      : 'Current password is incorrect.';
  }
  if (status === 403 || code === 'ORIGIN_NOT_ALLOWED') {
    return isAr
      ? 'ليس لديك صلاحية لإجراء هذه العملية.'
      : 'You are not authorized to perform this action.';
  }

  // G. HTTP 429 — Rate limited
  if (status === 429 || code === 'RATE_LIMITED') {
    return isAr
      ? 'تم إرسال محاولات كثيرة جداً. يرجى الانتظار دقيقة ثم المحاولة مرة أخرى.'
      : 'Too many attempts. Please wait a minute and try again.';
  }

  // E. HTTP 404 (missing/misconfigured API route) & H. HTTP 500+ / server errors
  // NEVER describe server or API endpoint errors as an internet connection problem.
  return isAr
    ? 'حدث خطأ في الخادم. حاول مرة أخرى لاحقًا.'
    : 'A server error occurred. Please try again later.';
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
      throw new AuthServiceError(
        'SERVER_NOT_CONFIGURED',
        'Online account server URL is not configured.',
        null,
      );
    }
    return baseUrl.replace(/\/+$/, '');
  }

  public async registerAccount(input: {
    displayName: string;
    email: string;
    password: string;
    avatar?: AvatarConfig;
    language?: string;
  }): Promise<AuthResponsePayload> {
    const baseUrl = this.requireServerBaseUrl();
    const endpoint = `${baseUrl}/auth/register`;
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(input),
      });
    } catch {
      logAuthDiagnosticDev({
        action: 'register',
        method: 'POST',
        url: endpoint,
        status: null,
        responseType: 'network',
        code: 'NETWORK_ERROR',
      });
      throw new AuthServiceError('NETWORK_ERROR', 'Unable to reach account server.', null, {
        isNetworkError: true,
        responseType: 'network',
      });
    }
    const { data, responseType, safeSnippet } = await safeParseAuthResponse<
      AuthResponsePayload & { success?: boolean }
    >(res);
    const succeeded = Boolean(data?.ok || data?.success);
    if (!res.ok || !succeeded || !data?.account || !data?.tokens) {
      const code = String(
        data?.error || (res.status === 404 ? 'NOT_FOUND' : !data ? 'INVALID_SERVER_RESPONSE' : `HTTP_${res.status}`),
      );
      logAuthDiagnosticDev({
        action: 'register',
        method: 'POST',
        url: endpoint,
        status: res.status,
        responseType,
        code,
        safeMessage: safeSnippet,
      });
      throw new AuthServiceError(code, data?.message || 'Account registration failed.', res.status, {
        isNetworkError: false,
        responseType,
      });
    }
    this.applyCloudAuthSuccess(data.account, data.tokens);
    return data;
  }

  public async loginAccount(input: {
    email: string;
    password: string;
  }): Promise<AuthResponsePayload> {
    const baseUrl = this.requireServerBaseUrl();
    const endpoint = `${baseUrl}/auth/login`;
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(input),
      });
    } catch {
      logAuthDiagnosticDev({
        action: 'login',
        method: 'POST',
        url: endpoint,
        status: null,
        responseType: 'network',
        code: 'NETWORK_ERROR',
      });
      throw new AuthServiceError('NETWORK_ERROR', 'Unable to reach account server.', null, {
        isNetworkError: true,
        responseType: 'network',
      });
    }
    const { data, responseType, safeSnippet } = await safeParseAuthResponse<
      AuthResponsePayload & { success?: boolean }
    >(res);
    const succeeded = Boolean(data?.ok || data?.success);
    if (!res.ok || !succeeded || !data?.account || !data?.tokens) {
      const code = String(
        data?.error || (res.status === 404 ? 'NOT_FOUND' : !data ? 'INVALID_SERVER_RESPONSE' : `HTTP_${res.status}`),
      );
      logAuthDiagnosticDev({
        action: 'login',
        method: 'POST',
        url: endpoint,
        status: res.status,
        responseType,
        code,
        safeMessage: safeSnippet,
      });
      throw new AuthServiceError(code, data?.message || 'Invalid email or password.', res.status, {
        isNetworkError: false,
        responseType,
      });
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
    const endpoint = `${baseUrl}/auth/forgot-password`;
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {
      logAuthDiagnosticDev({
        action: 'forgot-password',
        method: 'POST',
        url: endpoint,
        status: null,
        responseType: 'network',
        code: 'NETWORK_ERROR',
      });
      throw new AuthServiceError('NETWORK_ERROR', 'Unable to reach account server.', null, {
        isNetworkError: true,
        responseType: 'network',
      });
    }
    const { data, responseType, safeSnippet } = await safeParseAuthResponse<{
      ok?: boolean;
      success?: boolean;
      error?: string;
      message?: string;
      devResetCode?: string;
    }>(res);
    const succeeded = Boolean(data?.ok || data?.success);
    if (!res.ok || !succeeded) {
      const code = String(
        data?.error || (res.status === 404 ? 'NOT_FOUND' : !data ? 'INVALID_SERVER_RESPONSE' : `HTTP_${res.status}`),
      );
      logAuthDiagnosticDev({
        action: 'forgot-password',
        method: 'POST',
        url: endpoint,
        status: res.status,
        responseType,
        code,
        safeMessage: safeSnippet,
      });
      throw new AuthServiceError(code, data?.message || 'Failed to request password reset.', res.status, {
        isNetworkError: false,
        responseType,
      });
    }
    return {
      ok: true,
      message: data?.message || 'Password reset code sent if the email exists.',
      devResetCode: data?.devResetCode,
    };
  }

  public async resetPassword(input: {
    email: string;
    code: string;
    newPassword: string;
  }): Promise<string> {
    const baseUrl = this.requireServerBaseUrl();
    const endpoint = `${baseUrl}/auth/reset-password`;
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(input),
      });
    } catch {
      logAuthDiagnosticDev({
        action: 'reset-password',
        method: 'POST',
        url: endpoint,
        status: null,
        responseType: 'network',
        code: 'NETWORK_ERROR',
      });
      throw new AuthServiceError('NETWORK_ERROR', 'Unable to reach account server.', null, {
        isNetworkError: true,
        responseType: 'network',
      });
    }
    const { data, responseType, safeSnippet } = await safeParseAuthResponse<{
      ok?: boolean;
      success?: boolean;
      error?: string;
      message?: string;
    }>(res);
    const succeeded = Boolean(data?.ok || data?.success);
    if (!res.ok || !succeeded) {
      const code = String(
        data?.error || (res.status === 404 ? 'NOT_FOUND' : !data ? 'INVALID_SERVER_RESPONSE' : `HTTP_${res.status}`),
      );
      logAuthDiagnosticDev({
        action: 'reset-password',
        method: 'POST',
        url: endpoint,
        status: res.status,
        responseType,
        code,
        safeMessage: safeSnippet,
      });
      throw new AuthServiceError(code, data?.message || 'Password reset failed.', res.status, {
        isNetworkError: false,
        responseType,
      });
    }
    return data?.message || 'Password updated successfully.';
  }

  public async changePassword(input: {
    currentPassword: string;
    newPassword: string;
  }): Promise<string> {
    const baseUrl = this.requireServerBaseUrl();
    const endpoint = `${baseUrl}/auth/change-password`;
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...this.getBearerHeaders(),
        },
        body: JSON.stringify(input),
      });
    } catch {
      logAuthDiagnosticDev({
        action: 'change-password',
        method: 'POST',
        url: endpoint,
        status: null,
        responseType: 'network',
        code: 'NETWORK_ERROR',
      });
      throw new AuthServiceError('NETWORK_ERROR', 'Unable to reach account server.', null, {
        isNetworkError: true,
        responseType: 'network',
      });
    }
    const { data, responseType, safeSnippet } = await safeParseAuthResponse<{
      ok?: boolean;
      success?: boolean;
      error?: string;
      message?: string;
    }>(res);
    const succeeded = Boolean(data?.ok || data?.success);
    if (!res.ok || !succeeded) {
      const code = String(
        data?.error || (res.status === 404 ? 'NOT_FOUND' : !data ? 'INVALID_SERVER_RESPONSE' : `HTTP_${res.status}`),
      );
      logAuthDiagnosticDev({
        action: 'change-password',
        method: 'POST',
        url: endpoint,
        status: res.status,
        responseType,
        code,
        safeMessage: safeSnippet,
      });
      throw new AuthServiceError(code, data?.message || 'Failed to change password.', res.status, {
        isNetworkError: false,
        responseType,
      });
    }
    return data?.message || 'Password changed successfully.';
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
