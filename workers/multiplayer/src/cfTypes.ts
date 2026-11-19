export interface CfExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface CfDurableObjectId {
  toString(): string;
  equals(other: CfDurableObjectId): boolean;
}

export interface CfDurableObjectStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface CfDurableObjectNamespace {
  idFromName(name: string): CfDurableObjectId;
  idFromString(id: string): CfDurableObjectId;
  newUniqueId(): CfDurableObjectId;
  get(id: CfDurableObjectId): CfDurableObjectStub;
}

export interface CfDurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteAll(): Promise<void>;
  setAlarm?(scheduledTime: number | Date): Promise<void>;
  deleteAlarm?(): Promise<void>;
}

export interface CfWebSocket extends WebSocket {
  accept(): void;
  serializeAttachment(attachment: unknown): void;
  deserializeAttachment(): unknown;
}

export interface CfDurableObjectState {
  readonly id: CfDurableObjectId;
  readonly storage: CfDurableObjectStorage;
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): CfWebSocket[];
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

export interface CfWebSocketPair {
  0: CfWebSocket;
  1: CfWebSocket;
}

export interface CfD1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta?: {
    changes?: number;
    duration?: number;
    last_row_id?: number;
  };
}

export interface CfD1PreparedStatement {
  bind(...values: unknown[]): CfD1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<CfD1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<CfD1Result<T>>;
}

export interface CfD1Database {
  prepare(query: string): CfD1PreparedStatement;
  batch<T = Record<string, unknown>>(
    statements: CfD1PreparedStatement[],
  ): Promise<CfD1Result<T>[]>;
  exec?(query: string): Promise<unknown>;
}

export interface CfEnv {
  MULTIPLAYER_ROOMS: CfDurableObjectNamespace;
  ROOM_DIRECTORY: CfDurableObjectNamespace;
  PLAYER_PROFILES: CfDurableObjectNamespace;
  DB?: CfD1Database;
  ENVIRONMENT?: string;
  ALLOWED_ORIGINS?: string;
  MAX_ROOMS_PER_LIST?: string;
  SESSION_HMAC_SECRET?: string;
  HOST_DISCONNECT_GRACE_MS?: string;
  PLAYER_RECONNECT_GRACE_MS?: string;
  RESET_EMAIL_API_URL?: string;
  RESET_EMAIL_API_KEY?: string;
  RESET_EMAIL_FROM?: string;
}

export function createCfWebSocketPair(): [CfWebSocket, CfWebSocket] {
  const PairCtor = (
    globalThis as unknown as {
      WebSocketPair: new () => CfWebSocketPair;
    }
  ).WebSocketPair;
  const pair = new PairCtor();
  return [pair[0], pair[1]];
}

export function makeWebSocketUpgradeResponse(clientSocket: CfWebSocket): Response {
  const init = {
    status: 101,
    webSocket: clientSocket,
  } as unknown as ResponseInit;
  return new Response(null, init);
}
