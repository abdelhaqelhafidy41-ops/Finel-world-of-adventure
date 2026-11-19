import { detectRuntimePlatform, type RuntimePlatform } from '../../utils/platformExit';
import type { DifficultyLevel, WorldType } from '../save/saveTypes';

export const MAX_LAN_PLAYERS = 4;
export const DEFAULT_LAN_PORT = 41234;
export const LAN_DISCOVERY_PORT = 41235;

export interface LanPlatformCapabilities {
  platform: RuntimePlatform;
  canHost: boolean;
  canAutoDiscover: boolean;
  canJoinDirectIp: boolean;
  isHttpsPage: boolean;
  limitationReason: string | null;
}

export interface DiscoveredLanHost {
  ip: string;
  port: number;
  baseUrl: string;
  roomId: string;
  roomCode: string;
  roomName: string;
  hostName: string;
  worldName: string;
  worldType: WorldType;
  difficulty: DifficultyLevel;
  playerCount: number;
  maxPlayers: number;
  status: 'waiting' | 'in-game' | 'closed';
  lastSeenAt: number;
}

export interface LanHostStartResult {
  ok: boolean;
  ip: string | null;
  port: number;
  baseUrl: string | null;
  roomCode?: string;
  maxPlayers: number;
  error?: string;
  firewallHint?: string;
}

export interface LanHostStatus {
  running: boolean;
  ip: string | null;
  port: number;
  baseUrl: string | null;
  maxPlayers: number;
  roomCode?: string;
  playerCount?: number;
}

export interface LanProbeResult {
  ok: boolean;
  baseUrl: string;
  roomCode?: string;
  roomName?: string;
  hostName?: string;
  playerCount?: number;
  maxPlayers?: number;
  status?: string;
  error?: string;
}

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getLanCapabilities(): LanPlatformCapabilities {
  const platform = detectRuntimePlatform();
  const isHttpsPage =
    typeof window !== 'undefined' && window.location?.protocol === 'https:';

  if (platform === 'electron' && typeof window !== 'undefined' && window.desktopApp?.lan) {
    return {
      platform: 'electron',
      canHost: true,
      canAutoDiscover: true,
      canJoinDirectIp: true,
      isHttpsPage: false,
      limitationReason: null,
    };
  }

  if (
    platform === 'android' &&
    typeof window !== 'undefined' &&
    typeof window.AndroidNativeBridge?.startLanHost === 'function'
  ) {
    return {
      platform: 'android',
      canHost: true,
      canAutoDiscover: true,
      canJoinDirectIp: true,
      isHttpsPage: false,
      limitationReason: null,
    };
  }

  return {
    platform: 'web',
    canHost: false,
    canAutoDiscover: false,
    canJoinDirectIp: !isHttpsPage,
    isHttpsPage,
    limitationReason: isHttpsPage
      ? 'Web browsers on HTTPS cannot host local TCP/UDP LAN servers or open insecure ws:// LAN sockets. Use the Windows Desktop or Android app to host and join Offline LAN games.'
      : 'Web browsers cannot open native TCP/UDP sockets to host or auto-discover LAN games. Use the Windows Desktop or Android app to host, or join a native host by IP address.',
  };
}

export function normalizeLanBaseUrl(
  rawIpOrAddress: string,
  portInput?: number | string,
): string | null {
  const trimmed = rawIpOrAddress.trim();
  if (!trimmed) return null;

  const fallbackPort =
    typeof portInput === 'number'
      ? portInput
      : typeof portInput === 'string' && portInput.trim()
        ? Number.parseInt(portInput.trim(), 10)
        : DEFAULT_LAN_PORT;
  const resolvedPort =
    Number.isFinite(fallbackPort) && fallbackPort >= 1024 && fallbackPort <= 65535
      ? Math.floor(fallbackPort)
      : DEFAULT_LAN_PORT;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (!parsed.hostname) return null;
    const finalPort = parsed.port ? parsed.port : String(resolvedPort);
    return `http://${parsed.hostname}:${finalPort}`;
  } catch {
    return null;
  }
}

export async function startLanHost(
  roomOptions: {
    roomName?: string;
    hostName?: string;
    worldName?: string;
    worldType?: WorldType;
    difficulty?: DifficultyLevel;
  } = {},
  port = DEFAULT_LAN_PORT,
): Promise<LanHostStartResult> {
  const caps = getLanCapabilities();

  if (caps.platform === 'electron' && window.desktopApp?.lan) {
    try {
      const res = await window.desktopApp.lan.startHost({
        port,
        roomOptions: {
          ...roomOptions,
          maxPlayers: MAX_LAN_PLAYERS,
        },
      });
      const ok = Boolean(res.ok);
      const ip = typeof res.ip === 'string' && res.ip ? res.ip : null;
      const actualPort = typeof res.port === 'number' ? res.port : port;
      const baseUrl =
        typeof res.baseUrl === 'string' && res.baseUrl
          ? res.baseUrl
          : ip
            ? `http://${ip}:${actualPort}`
            : `http://127.0.0.1:${actualPort}`;
      return {
        ok,
        ip,
        port: actualPort,
        baseUrl: ok ? baseUrl : null,
        roomCode: typeof res.roomCode === 'string' ? res.roomCode : undefined,
        maxPlayers: MAX_LAN_PLAYERS,
        error: typeof res.error === 'string' ? res.error : undefined,
        firewallHint:
          typeof res.firewallHint === 'string' ? res.firewallHint : undefined,
      };
    } catch (err) {
      return {
        ok: false,
        ip: null,
        port,
        baseUrl: null,
        maxPlayers: MAX_LAN_PLAYERS,
        error: err instanceof Error ? err.message : 'Failed to start desktop LAN server.',
        firewallHint:
          'Allow World of Adventure through Windows Defender Firewall on Private Wi-Fi networks.',
      };
    }
  }

  if (caps.platform === 'android' && window.AndroidNativeBridge?.startLanHost) {
    try {
      const raw = window.AndroidNativeBridge.startLanHost(
        port,
        JSON.stringify({ ...roomOptions, maxPlayers: MAX_LAN_PLAYERS }),
      );
      const res = safeParseJson<Record<string, unknown>>(raw, { ok: false });
      const ok = Boolean(res.ok);
      const ip = typeof res.ip === 'string' && res.ip ? res.ip : null;
      const actualPort = typeof res.port === 'number' ? res.port : port;
      const baseUrl =
        typeof res.baseUrl === 'string' && res.baseUrl
          ? res.baseUrl
          : ip
            ? `http://${ip}:${actualPort}`
            : `http://127.0.0.1:${actualPort}`;
      return {
        ok,
        ip,
        port: actualPort,
        baseUrl: ok ? baseUrl : null,
        roomCode: typeof res.roomCode === 'string' ? res.roomCode : undefined,
        maxPlayers: MAX_LAN_PLAYERS,
        error: typeof res.error === 'string' ? res.error : undefined,
      };
    } catch (err) {
      return {
        ok: false,
        ip: null,
        port,
        baseUrl: null,
        maxPlayers: MAX_LAN_PLAYERS,
        error: err instanceof Error ? err.message : 'Failed to start Android LAN server.',
      };
    }
  }

  return {
    ok: false,
    ip: null,
    port,
    baseUrl: null,
    maxPlayers: MAX_LAN_PLAYERS,
    error:
      caps.limitationReason ||
      'Offline LAN hosting requires the Windows Desktop or Android app.',
  };
}

export async function stopLanHost(): Promise<void> {
  const platform = detectRuntimePlatform();
  try {
    if (platform === 'electron' && window.desktopApp?.lan) {
      await window.desktopApp.lan.stopHost();
    } else if (platform === 'android' && window.AndroidNativeBridge?.stopLanHost) {
      window.AndroidNativeBridge.stopLanHost();
    }
  } catch {
    // Ignore cleanup errors
  }
}

export async function getLanHostStatus(): Promise<LanHostStatus> {
  const platform = detectRuntimePlatform();
  try {
    if (platform === 'electron' && window.desktopApp?.lan) {
      const res = await window.desktopApp.lan.getStatus();
      const ip = typeof res.ip === 'string' ? res.ip : null;
      const port = typeof res.port === 'number' ? res.port : DEFAULT_LAN_PORT;
      return {
        running: Boolean(res.running),
        ip,
        port,
        baseUrl:
          typeof res.baseUrl === 'string'
            ? res.baseUrl
            : ip
              ? `http://${ip}:${port}`
              : null,
        maxPlayers: MAX_LAN_PLAYERS,
        roomCode: typeof res.roomCode === 'string' ? res.roomCode : undefined,
        playerCount: typeof res.playerCount === 'number' ? res.playerCount : undefined,
      };
    }
    if (platform === 'android' && window.AndroidNativeBridge?.getLanStatus) {
      const res = safeParseJson<Record<string, unknown>>(
        window.AndroidNativeBridge.getLanStatus(),
        {},
      );
      const ip = typeof res.ip === 'string' ? res.ip : null;
      const port = typeof res.port === 'number' ? res.port : DEFAULT_LAN_PORT;
      return {
        running: Boolean(res.running),
        ip,
        port,
        baseUrl:
          typeof res.baseUrl === 'string'
            ? res.baseUrl
            : ip
              ? `http://${ip}:${port}`
              : null,
        maxPlayers: MAX_LAN_PLAYERS,
        roomCode: typeof res.roomCode === 'string' ? res.roomCode : undefined,
        playerCount: typeof res.playerCount === 'number' ? res.playerCount : undefined,
      };
    }
  } catch {
    // Ignore status errors
  }
  return {
    running: false,
    ip: null,
    port: DEFAULT_LAN_PORT,
    baseUrl: null,
    maxPlayers: MAX_LAN_PLAYERS,
  };
}

export async function getLocalLanIp(): Promise<string | null> {
  const platform = detectRuntimePlatform();
  try {
    if (platform === 'electron' && window.desktopApp?.lan) {
      const res = await window.desktopApp.lan.getLocalIp();
      return res?.ip || null;
    }
    if (platform === 'android' && window.AndroidNativeBridge?.getLocalIp) {
      const ip = window.AndroidNativeBridge.getLocalIp();
      return ip && ip.trim() ? ip.trim() : null;
    }
  } catch {
    // Ignore
  }
  return null;
}

function normalizeDiscoveredHost(raw: Record<string, unknown>): DiscoveredLanHost | null {
  const ip = typeof raw.ip === 'string' ? raw.ip.trim() : '';
  const port = typeof raw.port === 'number' && raw.port > 0 ? raw.port : DEFAULT_LAN_PORT;
  if (!ip) return null;
  const baseUrl =
    typeof raw.baseUrl === 'string' && raw.baseUrl
      ? raw.baseUrl
      : `http://${ip}:${port}`;
  const worldType = (
    raw.worldType === 'survival' ||
    raw.worldType === 'adventure' ||
    raw.worldType === 'creative'
      ? raw.worldType
      : 'normal'
  ) as WorldType;
  const difficulty = (
    raw.difficulty === 'easy' || raw.difficulty === 'hard'
      ? raw.difficulty
      : 'normal'
  ) as DifficultyLevel;
  const status = (
    raw.status === 'in-game' || raw.status === 'closed' ? raw.status : 'waiting'
  ) as 'waiting' | 'in-game' | 'closed';

  return {
    ip,
    port,
    baseUrl,
    roomId: typeof raw.roomId === 'string' ? raw.roomId : '',
    roomCode: typeof raw.roomCode === 'string' ? raw.roomCode : '',
    roomName: typeof raw.roomName === 'string' ? raw.roomName : 'LAN World',
    hostName: typeof raw.hostName === 'string' ? raw.hostName : 'Host',
    worldName: typeof raw.worldName === 'string' ? raw.worldName : 'LAN World',
    worldType,
    difficulty,
    playerCount: typeof raw.playerCount === 'number' ? raw.playerCount : 1,
    maxPlayers: Math.min(
      MAX_LAN_PLAYERS,
      typeof raw.maxPlayers === 'number' ? raw.maxPlayers : MAX_LAN_PLAYERS,
    ),
    status,
    lastSeenAt: typeof raw.lastSeenAt === 'number' ? raw.lastSeenAt : Date.now(),
  };
}

export async function discoverLanGames(
  timeoutMs = 1500,
): Promise<DiscoveredLanHost[]> {
  const caps = getLanCapabilities();
  if (!caps.canAutoDiscover) return [];

  try {
    if (caps.platform === 'electron' && window.desktopApp?.lan) {
      const res = await window.desktopApp.lan.discover(timeoutMs);
      if (!res?.ok || !Array.isArray(res.hosts)) return [];
      return res.hosts
        .map((h) => normalizeDiscoveredHost(h))
        .filter((h): h is DiscoveredLanHost => h !== null);
    }

    if (caps.platform === 'android' && window.AndroidNativeBridge?.discoverLanHosts) {
      const raw = window.AndroidNativeBridge.discoverLanHosts(timeoutMs);
      const parsed = safeParseJson<{
        ok?: boolean;
        hosts?: Array<Record<string, unknown>>;
      }>(raw, { ok: false, hosts: [] });
      if (!parsed.ok || !Array.isArray(parsed.hosts)) return [];
      return parsed.hosts
        .map((h) => normalizeDiscoveredHost(h))
        .filter((h): h is DiscoveredLanHost => h !== null);
    }
  } catch {
    return [];
  }
  return [];
}

export async function probeLanHost(
  baseUrl: string,
  timeoutMs = 3500,
): Promise<LanProbeResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        baseUrl,
        error: `LAN host responded with status ${res.status}.`,
      };
    }
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return {
      ok: Boolean(data?.ok !== false),
      baseUrl,
      roomCode: typeof data?.roomCode === 'string' ? data.roomCode : undefined,
      roomName: typeof data?.roomName === 'string' ? data.roomName : undefined,
      hostName: typeof data?.hostName === 'string' ? data.hostName : undefined,
      playerCount:
        typeof data?.playerCount === 'number' ? data.playerCount : undefined,
      maxPlayers:
        typeof data?.maxPlayers === 'number' ? data.maxPlayers : MAX_LAN_PLAYERS,
      status: typeof data?.status === 'string' ? data.status : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      baseUrl,
      error:
        err instanceof Error && err.name === 'AbortError'
          ? 'Could not reach LAN host on local Wi-Fi (timed out).'
          : 'Could not reach LAN host. Verify both devices are on the same Wi-Fi network and firewall allows local connections.',
    };
  } finally {
    window.clearTimeout(timer);
  }
}
