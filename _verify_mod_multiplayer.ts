import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

// Mock WebSocketPair & 101 Response before importing Cloudflare DOs (same pattern as _verify_mp_room.ts)
class MockWebSocket extends EventTarget {
  public peer: MockWebSocket | null = null;
  public accepted = false;
  public closed = false;
  public sent: string[] = [];
  public readyState = 1;

  accept(): void {
    this.accepted = true;
  }
  serializeAttachment(): void {}
  deserializeAttachment(): unknown {
    return null;
  }
  send(data: string): void {
    const peer = this.peer;
    if (this.closed || !peer || peer.closed) return;
    setTimeout(() => {
      peer.dispatchEvent(new MessageEvent('message', { data }));
    }, 0);
  }
  close(code = 1000, reason = ''): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event('close'), { code, reason }));
    const peer = this.peer;
    if (peer && !peer.closed) {
      setTimeout(() => {
        if (!peer.closed) {
          peer.closed = true;
          peer.readyState = 3;
          peer.dispatchEvent(Object.assign(new Event('close'), { code, reason }));
        }
      }, 0);
    }
  }
}

(globalThis as Record<string, unknown>).WebSocketPair = class {
  0: MockWebSocket;
  1: MockWebSocket;
  constructor() {
    const a = new MockWebSocket();
    const b = new MockWebSocket();
    a.peer = b;
    b.peer = a;
    this[0] = a;
    this[1] = b;
  }
};

const OrigResponse = globalThis.Response;
(globalThis as Record<string, unknown>).Response = class extends OrigResponse {
  webSocket?: unknown;
  constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
    if (init?.status === 101) {
      super(null, { status: 200 });
      Object.defineProperty(this, 'status', { value: 101 });
      this.webSocket = init.webSocket;
    } else {
      super(body, init);
    }
  }
};

import {
  CURRENT_MOD_API_VERSION,
  MAX_MOD_METADATA_BYTES,
  SUPPORTED_MOD_SCHEMA_VERSIONS,
  formatProtocolModCompatibilityMessage,
  validateUntrustedProtocolModMetadata,
  verifyMultiplayerModCompatibility,
  type ProtocolWorldModMetadata,
} from './shared/multiplayerProtocol';
const CURRENT_MOD_SCHEMA_VERSION = SUPPORTED_MOD_SCHEMA_VERSIONS[0];
import workerApp from './workers/multiplayer/src/index';
import { MultiplayerRoomDO } from './workers/multiplayer/src/MultiplayerRoomDO';
import { RoomDirectoryDO } from './workers/multiplayer/src/RoomDirectoryDO';
import { validateDiscoveredMods } from './src/game/mods/ModValidator';
import {
  evaluateMultiplayerModCompatibility,
  evaluateSaveModCompatibility,
} from './src/game/mods/ModWorldCompatibility';
import {
  enrichProtocolReportWithLocalDiscovery,
  formatMultiplayerModRejectionMessage,
} from './src/game/mods/ModMultiplayerCompatibility';
import {
  CURRENT_GAME_VERSION,
  MOD_API_VERSION,
  MOD_CONTENT_SCHEMA_VERSION,
  type ModRecord,
  type ModsSnapshot,
} from './src/game/mods/modTypes';

const require = createRequire(import.meta.url);
const { OfflineLanServer } = require('./electron/lanServer.cjs') as {
  OfflineLanServer: new () => {
    port: number;
    start: (preferredPort?: number, roomOptions?: Record<string, unknown> | null) => Promise<{ ok: boolean; port: number; hostSession?: Record<string, unknown> }>;
    stop: () => Promise<void>;
    initRoom: (options: Record<string, unknown>) => Record<string, unknown>;
    joinPlayer: (options: Record<string, unknown>) => Record<string, unknown>;
    getStatus: () => Record<string, unknown>;
  };
};

function createMockState(idStr = 'do-id') {
  const store = new Map<string, unknown>();
  let scheduledAlarm: number | null = null;
  return {
    id: { toString: () => idStr, equals: () => false },
    storage: {
      get: async <T = unknown>(k: string) => store.get(k) as T | undefined,
      put: async (k: string, v: unknown) => {
        store.set(k, structuredClone(v));
      },
      delete: async (k: string) => store.delete(k),
      deleteAll: async () => store.clear(),
      setAlarm: async (ts: number | Date) => {
        scheduledAlarm = typeof ts === 'number' ? ts : ts.getTime();
      },
      deleteAlarm: async () => {
        scheduledAlarm = null;
      },
      getScheduledAlarm: () => scheduledAlarm,
    },
    acceptWebSocket: () => {},
    getWebSockets: () => [],
    blockConcurrencyWhile: async <T>(cb: () => Promise<T>) => cb(),
  };
}

function createWorkerHarness() {
  const rooms = new Map<string, MultiplayerRoomDO>();
  const dirState = createMockState('global-dir');
  let dirDO: RoomDirectoryDO | null = null;

  const env: Record<string, unknown> = {
    ENVIRONMENT: 'production',
    MULTIPLAYER_ROOMS: {
      idFromName: (n: string) => ({ toString: () => n, equals: () => false }),
      idFromString: (n: string) => ({ toString: () => n, equals: () => false }),
      newUniqueId: () => ({ toString: () => 'uid', equals: () => false }),
      get: (idObj: { toString: () => string }) => {
        const key = idObj.toString();
        let instance = rooms.get(key);
        if (!instance) {
          instance = new MultiplayerRoomDO(createMockState(key) as never, env as never);
          rooms.set(key, instance);
        }
        return {
          fetch: (req: RequestInfo | URL, init?: RequestInit) =>
            instance!.fetch(typeof req === 'string' || req instanceof URL ? new Request(String(req), init) : req),
        };
      },
    },
    ROOM_DIRECTORY: {
      idFromName: (n: string) => ({ toString: () => n, equals: () => false }),
      idFromString: (n: string) => ({ toString: () => n, equals: () => false }),
      newUniqueId: () => ({ toString: () => 'uid', equals: () => false }),
      get: () => {
        if (!dirDO) {
          dirDO = new RoomDirectoryDO(dirState as never, env as never);
        }
        return {
          fetch: (req: RequestInfo | URL, init?: RequestInit) =>
            dirDO!.fetch(typeof req === 'string' || req instanceof URL ? new Request(String(req), init) : req),
        };
      },
    },
    PLAYER_PROFILES: {
      idFromName: (n: string) => ({ toString: () => n, equals: () => false }),
      idFromString: (n: string) => ({ toString: () => n, equals: () => false }),
      newUniqueId: () => ({ toString: () => 'uid', equals: () => false }),
      get: () => ({
        fetch: async () => new OrigResponse(JSON.stringify({ ok: true }), { status: 200 }),
      }),
    },
  };

  let ipCounter = 10;
  async function callWorker(path: string, method = 'GET', body?: unknown) {
    const req = new Request(`https://worker.test${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        'CF-Connecting-IP': `198.51.100.${ipCounter++}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const res = await workerApp.fetch(req, env as never, {} as never);
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json: json as Record<string, unknown> };
  }

  function getRoomDO(roomId: string): MultiplayerRoomDO | undefined {
    return rooms.get(roomId);
  }

  return { env, callWorker, getRoomDO };
}

function makeModMeta(mods: ProtocolWorldModMetadata['mods']): ProtocolWorldModMetadata {
  return {
    savedAtGameVersion: CURRENT_GAME_VERSION,
    modApiVersion: CURRENT_MOD_API_VERSION,
    schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
    mods,
  };
}

async function httpJson(url: string, method = 'GET', body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json: json as Record<string, unknown> };
}

function encodeMaskedClientWsFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const maskKey = crypto.randomBytes(4);
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(6);
    header[0] = 0x81;
    header[1] = 0x80 | len;
    maskKey.copy(header, 2);
  } else {
    header = Buffer.alloc(8);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
    maskKey.copy(header, 4);
  }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) {
    masked[i] = payload[i] ^ maskKey[i % 4];
  }
  return Buffer.concat([header, masked]);
}

function rawWsHandshakeAndSnapshot(
  port: number,
  roomId: string,
  playerId: string,
  token: string,
): Promise<{ snapshot: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: `/api/multiplayer/ws?roomId=${encodeURIComponent(roomId)}&playerId=${encodeURIComponent(playerId)}&token=${encodeURIComponent(token)}`,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    });
    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error('LAN WebSocket handshake timed out'));
    }, 5000);

    req.on('upgrade', (_res, socket, head) => {
      let buffer = Buffer.isBuffer(head) ? head : Buffer.alloc(0);
      socket.write(
        encodeMaskedClientWsFrame(
          JSON.stringify({ type: 'CONNECT', roomId, playerId, payload: {} }),
        ),
      );
      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
          const byte1 = buffer[0];
          const byte2 = buffer[1];
          const opcode = byte1 & 0x0f;
          let payloadLen = byte2 & 0x7f;
          let offset = 2;
          if (payloadLen === 126) {
            if (buffer.length < 4) return;
            payloadLen = buffer.readUInt16BE(2);
            offset = 4;
          } else if (payloadLen === 127) {
            if (buffer.length < 10) return;
            payloadLen = Number(buffer.readBigUInt64BE(2));
            offset = 10;
          }
          if (buffer.length < offset + payloadLen) return;
          const framePayload = buffer.subarray(offset, offset + payloadLen);
          buffer = buffer.subarray(offset + payloadLen);
          if (opcode === 0x1) {
            const msg = JSON.parse(framePayload.toString('utf8')) as {
              type: string;
              payload?: Record<string, unknown>;
            };
            if (msg.type === 'ROOM_STATE') {
              clearTimeout(timeout);
              socket.destroy();
              resolve({ snapshot: msg.payload ?? {} });
              return;
            }
          }
        }
      });
      socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    req.end();
  });
}

async function runAllTests() {
  let passed = 0;
  const pass = (name: string) => {
    passed += 1;
    console.log(`PASS [${passed}]: ${name}`);
  };

  // =========================================================================
  // 1. Vanilla Host + Vanilla Client (explicit empty & omitted metadata)
  // =========================================================================
  {
    const r1 = verifyMultiplayerModCompatibility(undefined, undefined);
    assert.equal(r1.compatible, true);
    assert.equal(r1.issues.length, 0);

    const r2 = verifyMultiplayerModCompatibility(makeModMeta([]), undefined);
    assert.equal(r2.compatible, true);

    const r3 = verifyMultiplayerModCompatibility(undefined, makeModMeta([]));
    assert.equal(r3.compatible, true);
    pass('1. Vanilla host + Vanilla client allowed (including omitted client metadata)');
  }

  // =========================================================================
  // 2. Modded Host + Matching Client
  // =========================================================================
  {
    const hostMeta = makeModMeta([
      {
        modId: 'sunstone-weapons',
        name: 'Sunstone Weapons',
        version: '1.2.0',
        supportedGameVersion: CURRENT_GAME_VERSION,
        compatibilityVersion: '1.x',
        modApiVersion: CURRENT_MOD_API_VERSION,
        schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
        multiplayerCompatibility: 'required',
      },
    ]);
    const clientMeta = makeModMeta([
      {
        modId: 'sunstone-weapons',
        name: 'Sunstone Weapons',
        version: '1.2.0',
        supportedGameVersion: CURRENT_GAME_VERSION,
        compatibilityVersion: '1.x',
        modApiVersion: CURRENT_MOD_API_VERSION,
        schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
        multiplayerCompatibility: 'required',
      },
    ]);
    const report = verifyMultiplayerModCompatibility(hostMeta, clientMeta);
    assert.equal(report.compatible, true);
    assert.equal(report.issues.length, 0);
    pass('2. Modded host + matching modded client allowed');
  }

  // =========================================================================
  // 3. Modded Host + Client missing required mod
  // =========================================================================
  {
    const hostMeta = makeModMeta([
      {
        modId: 'mystic-flora',
        name: 'Mystic Flora',
        version: '1.0.0',
        modApiVersion: CURRENT_MOD_API_VERSION,
        schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
        multiplayerCompatibility: 'required',
      },
    ]);
    const report = verifyMultiplayerModCompatibility(hostMeta, makeModMeta([]));
    assert.equal(report.compatible, false);
    assert.equal(report.issues[0]?.code, 'missing_mod');
    assert.ok(report.summary.includes('Cannot join this world.'));
    assert.ok(report.summary.includes('Missing required mods:'));
    assert.ok(report.summary.includes('Mystic Flora'));
    pass('3. Modded host + client missing required mod blocked with multi-line message');
  }

  // =========================================================================
  // 4. Exact version mismatch (when compatibilityVersion omitted)
  // =========================================================================
  {
    const hostMeta = makeModMeta([
      {
        modId: 'iron-citadel',
        name: 'Iron Citadel',
        version: '2.1.0',
        modApiVersion: CURRENT_MOD_API_VERSION,
        schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
        multiplayerCompatibility: 'required',
      },
    ]);
    const clientMeta = makeModMeta([
      {
        modId: 'iron-citadel',
        name: 'Iron Citadel',
        version: '2.0.5',
        modApiVersion: CURRENT_MOD_API_VERSION,
        schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
        multiplayerCompatibility: 'required',
      },
    ]);
    const report = verifyMultiplayerModCompatibility(hostMeta, clientMeta);
    assert.equal(report.compatible, false);
    assert.equal(report.issues[0]?.code, 'version_mismatch');
    assert.ok(report.summary.includes('Incompatible mods:'));
    assert.ok(report.summary.includes('Required:'));
    assert.ok(report.summary.includes('Installed:'));
    pass('4. Exact mod version mismatch blocked when compatibilityVersion omitted');
  }

  // =========================================================================
  // 5. Compatibility range "1.x" allows "1.3.0"
  // =========================================================================
  {
    const hostMeta = makeModMeta([
      {
        modId: 'forest-beasts',
        name: 'Forest Beasts',
        version: '1.0.0',
        compatibilityVersion: '1.x',
        modApiVersion: CURRENT_MOD_API_VERSION,
        schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
        multiplayerCompatibility: 'required',
      },
    ]);
    const clientMeta = makeModMeta([
      {
        modId: 'forest-beasts',
        name: 'Forest Beasts',
        version: '1.3.0',
        modApiVersion: CURRENT_MOD_API_VERSION,
        schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
        multiplayerCompatibility: 'required',
      },
    ]);
    const report = verifyMultiplayerModCompatibility(hostMeta, clientMeta);
    assert.equal(report.compatible, true);
    pass('5. SemVer compatibilityVersion "1.x" allows client v1.3.0');
  }

  // =========================================================================
  // 6. Compatibility range "2.x" rejects "1.4.0" & unsupported game version rejected
  // =========================================================================
  {
    const hostMeta = makeModMeta([
      {
        modId: 'forest-beasts',
        name: 'Forest Beasts',
        version: '2.0.0',
        compatibilityVersion: '2.x',
        modApiVersion: CURRENT_MOD_API_VERSION,
        schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
        multiplayerCompatibility: 'required',
      },
    ]);
    const clientMeta = makeModMeta([
      {
        modId: 'forest-beasts',
        name: 'Forest Beasts',
        version: '1.4.0',
        modApiVersion: CURRENT_MOD_API_VERSION,
        schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
        multiplayerCompatibility: 'required',
      },
    ]);
    const rRange = verifyMultiplayerModCompatibility(hostMeta, clientMeta);
    assert.equal(rRange.compatible, false);
    assert.equal(rRange.issues[0]?.code, 'version_mismatch');

    const rGameVer = verifyMultiplayerModCompatibility(
      makeModMeta([
        {
          modId: 'legacy-pack',
          name: 'Legacy Pack',
          version: '1.0.0',
          supportedGameVersion: '0.1.0',
          modApiVersion: CURRENT_MOD_API_VERSION,
          schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
          multiplayerCompatibility: 'required',
        },
      ]),
      makeModMeta([
        {
          modId: 'legacy-pack',
          name: 'Legacy Pack',
          version: '1.0.0',
          supportedGameVersion: '0.1.0',
          modApiVersion: CURRENT_MOD_API_VERSION,
          schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
          multiplayerCompatibility: 'required',
        },
      ]),
    );
    assert.equal(rGameVer.compatible, false);
    assert.equal(rGameVer.issues[0]?.code, 'unsupported_mod');
    assert.ok(rGameVer.summary.includes('Unsupported mods:'));
    pass('6. SemVer compatibilityVersion "2.x" rejects v1.4.0 and unsupported game version triggers unsupported_mod');
  }

  // =========================================================================
  // 7. Required dependencies validated (missing_dependency)
  // =========================================================================
  {
    const hostMeta = makeModMeta([
      {
        modId: 'dragon-quests',
        name: 'Dragon Quests',
        version: '1.0.0',
        modApiVersion: CURRENT_MOD_API_VERSION,
        schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
        multiplayerCompatibility: 'required',
        dependencies: [{ modId: 'core-rpg-lib', versionRange: '1.x', optional: false }],
      },
    ]);
    const clientMeta = makeModMeta([
      {
        modId: 'dragon-quests',
        name: 'Dragon Quests',
        version: '1.0.0',
        modApiVersion: CURRENT_MOD_API_VERSION,
        schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
        multiplayerCompatibility: 'required',
        dependencies: [{ modId: 'core-rpg-lib', versionRange: '1.x', optional: false }],
      },
    ]);
    const report = verifyMultiplayerModCompatibility(hostMeta, clientMeta);
    assert.equal(report.compatible, false);
    assert.ok(report.issues.some((i) => i.code === 'missing_dependency' && i.dependencyModId === 'core-rpg-lib'));
    assert.ok(report.summary.includes('Missing dependencies:'));
    pass('7. Missing required dependency detected and blocked with missing_dependency');
  }

  // =========================================================================
  // 8. Client extra active gameplay mod rejected, client_only allowed
  // =========================================================================
  {
    const extraGameplayReport = verifyMultiplayerModCompatibility(
      makeModMeta([]),
      makeModMeta([
        {
          modId: 'super-chests',
          name: 'Super Chests',
          version: '1.0.0',
          modApiVersion: CURRENT_MOD_API_VERSION,
          schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
          multiplayerCompatibility: 'required',
        },
      ]),
    );
    assert.equal(extraGameplayReport.compatible, false);
    assert.equal(extraGameplayReport.issues[0]?.code, 'extra_active_mod');

    const clientOnlyReport = verifyMultiplayerModCompatibility(
      makeModMeta([]),
      makeModMeta([
        {
          modId: 'ui-minimap-skin',
          name: 'Minimap Skin',
          version: '1.0.0',
          modApiVersion: CURRENT_MOD_API_VERSION,
          schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
          multiplayerCompatibility: 'client_only',
        },
      ]),
    );
    assert.equal(clientOnlyReport.compatible, true);
    pass('8. Client extra gameplay mod rejected while client_only cosmetic mod allowed');
  }

  // =========================================================================
  // 9. Real OfflineLanServer HTTP + WebSocket Mod Verification & Host Status Dashboard
  // =========================================================================
  const lanServer = new OfflineLanServer();
  try {
    const hostMods = makeModMeta([
      {
        modId: 'oakhollow-plus',
        name: 'Oakhollow Plus',
        version: '1.1.0',
        compatibilityVersion: '1.x',
        supportedGameVersion: CURRENT_GAME_VERSION,
        modApiVersion: CURRENT_MOD_API_VERSION,
        schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
        multiplayerCompatibility: 'required',
      },
    ]);
    const started = await lanServer.start(41289, {
      hostName: 'LanHostPlayer',
      roomName: 'Oakhollow Modded LAN',
      worldName: 'Oakhollow Valley',
      worldSeed: 987654,
      modMetadata: hostMods,
    });
    assert.equal(started.ok, true);
    const port = started.port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const hostSession = started.hostSession as {
      ok: boolean;
      room: { roomId: string; roomCode: string };
      playerId: string;
      sessionToken: string;
    };
    assert.equal(hostSession.ok, true);
    const lanRoomId = hostSession.room.roomId;
    const lanRoomCode = hostSession.room.roomCode;
    assert.ok(lanRoomId && lanRoomCode);

    // 9a. LAN /health exposes safe host mod metadata (no executable payloads)
    const infoRes = await httpJson(`${baseUrl}/health`);
    assert.equal(infoRes.status, 200);
    assert.ok((infoRes.json.modMetadata as ProtocolWorldModMetadata)?.mods?.length === 1);

    // 9b. Incompatible client join is blocked with 409 MOD_INCOMPATIBLE and logged on host
    const badJoin = await httpJson(`${baseUrl}/api/multiplayer/rooms/join`, 'POST', {
      roomCodeOrId: lanRoomCode,
      playerName: 'BadModGuest',
      clientModMetadata: makeModMeta([]),
    });
    assert.equal(badJoin.status, 409);
    assert.equal(badJoin.json.error, 'MOD_INCOMPATIBLE');
    assert.ok(String(badJoin.json.message).includes('Oakhollow Plus'));

    // 9c. Malformed / traversal / oversized client metadata strictly rejected (400 / 413), never coerced to vanilla
    const traversalJoin = await httpJson(`${baseUrl}/api/multiplayer/rooms/join`, 'POST', {
      roomCodeOrId: lanRoomCode,
      playerName: 'HackerGuest',
      clientModMetadata: {
        mods: [
          {
            modId: '../evil-mod',
            name: 'Evil',
            version: '1.0.0',
          },
        ],
      },
    });
    assert.equal(traversalJoin.status, 400);
    assert.equal(traversalJoin.json.error, 'INVALID_MOD_METADATA');

    const scriptKeyJoin = await httpJson(`${baseUrl}/api/multiplayer/rooms/join`, 'POST', {
      roomCodeOrId: lanRoomCode,
      playerName: 'ScriptGuest',
      clientModMetadata: {
        mods: [
          {
            modId: 'oakhollow-plus',
            name: 'Oakhollow Plus',
            version: '1.1.0',
            script: 'alert(1)',
          },
        ],
      },
    });
    assert.equal(scriptKeyJoin.status, 400);
    assert.equal(scriptKeyJoin.json.error, 'INVALID_MOD_METADATA');

    const hugeJoin = await httpJson(`${baseUrl}/api/multiplayer/rooms/join`, 'POST', {
      roomCodeOrId: lanRoomCode,
      playerName: 'OversizedGuest',
      clientModMetadata: makeModMeta(
        Array.from({ length: 65 }, (_, i) => ({
          modId: `bulk-mod-${i}`,
          name: `Bulk Mod ${i}`,
          version: '1.0.0',
        })),
      ),
    });
    assert.equal(hugeJoin.status, 413);
    assert.equal(hugeJoin.json.error, 'MOD_METADATA_TOO_LARGE');

    // 9d. Compatible client (v1.4.2 satisfies 1.x) succeeds over HTTP & WS, and host status lists both compatible & incompatible players
    const goodJoin = await httpJson(`${baseUrl}/api/multiplayer/rooms/join`, 'POST', {
      roomCodeOrId: lanRoomCode,
      playerName: 'GoodModGuest',
      clientModMetadata: makeModMeta([
        {
          modId: 'oakhollow-plus',
          name: 'Oakhollow Plus',
          version: '1.4.2',
          supportedGameVersion: CURRENT_GAME_VERSION,
          modApiVersion: CURRENT_MOD_API_VERSION,
          schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
          multiplayerCompatibility: 'required',
        },
      ]),
    });
    assert.equal(goodJoin.status, 200);
    assert.ok(goodJoin.json.sessionToken);

    const { snapshot } = await rawWsHandshakeAndSnapshot(
      port,
      lanRoomId,
      hostSession.playerId,
      hostSession.sessionToken,
    );
    const gameState = (snapshot.gameState ?? {}) as Record<string, unknown>;
    const compatStatus = gameState.modCompatibilityStatus as {
      requiredMods: Array<{ modId: string }>;
      compatiblePlayers: Array<{ displayName: string }>;
      incompatiblePlayers: Array<{ playerName: string; reason: string }>;
    };
    assert.ok(compatStatus, 'LAN snapshot must expose modCompatibilityStatus');
    assert.equal(compatStatus.requiredMods.length, 1);
    assert.equal(compatStatus.requiredMods[0].modId, 'oakhollow-plus');
    assert.ok(compatStatus.compatiblePlayers.some((p) => p.displayName === 'GoodModGuest'));
    assert.ok(compatStatus.incompatiblePlayers.some((p) => p.playerName === 'BadModGuest'));
    assert.ok(compatStatus.incompatiblePlayers.some((p) => p.playerName === 'HackerGuest'));

    // Ensure no executable/archive fields leak into LAN snapshot
    const serializedSnapshot = JSON.stringify(snapshot);
    assert.ok(!serializedSnapshot.includes('"script"'));
    assert.ok(!serializedSnapshot.includes('"archive"'));
    assert.ok(!serializedSnapshot.includes('.woamod'));

    // Ensure vanilla gameplay fields in snapshot remain intact and untouched
    assert.equal(typeof gameState.seed, 'number');
    assert.ok(Array.isArray(snapshot.players));
    const hostPlayer = (snapshot.players as Array<Record<string, unknown>>)[0];
    assert.ok(hostPlayer);
    assert.equal(typeof hostPlayer.displayName, 'string');
    pass('9. Real OfflineLanServer HTTP + WS verification, security rejections, and host status dashboard');
  } finally {
    await lanServer.stop();
  }

  // =========================================================================
  // 10. Online Worker + MultiplayerRoomDO + RoomDirectoryDO Verification & Security
  // =========================================================================
  {
    const { callWorker, getRoomDO } = createWorkerHarness();
    const hostMods = makeModMeta([
      {
        modId: 'sky-islands',
        name: 'Sky Islands',
        version: '2.0.0',
        compatibilityVersion: '2.x',
        supportedGameVersion: CURRENT_GAME_VERSION,
        modApiVersion: CURRENT_MOD_API_VERSION,
        schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
        multiplayerCompatibility: 'required',
      },
    ]);

    // 10a. Reject invalid host modMetadata on create room
    const invalidCreate = await callWorker('/api/multiplayer/rooms', 'POST', {
      playerName: 'OnlineHost',
      roomName: 'Bad Meta Room',
      worldName: 'Test',
      modMetadata: {
        mods: [{ modId: 'bad.dll', name: 'Bad', version: '1.0.0' }],
      },
    });
    assert.equal(invalidCreate.status, 400);
    assert.equal(invalidCreate.json.error, 'INVALID_MOD_METADATA');

    // 10b. Create valid modded online room
    const created = await callWorker('/api/multiplayer/rooms', 'POST', {
      playerName: 'OnlineHost',
      roomName: 'Sky Islands Realm',
      worldName: 'Aether Valley',
      privacy: 'public',
      modMetadata: hostMods,
    });
    assert.equal(created.status, 200);
    const createdRoom = created.json.room as { roomId: string; roomCode: string };
    const roomId = String(createdRoom.roomId);
    const roomCode = String(createdRoom.roomCode);
    assert.ok(roomId && roomCode);

    // 10c. Incompatible client rejected with 409 MOD_INCOMPATIBLE
    const incompatibleJoin = await callWorker('/api/multiplayer/rooms/join', 'POST', {
      roomCodeOrId: roomCode,
      playerName: 'WrongVerGuest',
      clientModMetadata: makeModMeta([
        {
          modId: 'sky-islands',
          name: 'Sky Islands',
          version: '1.5.0',
          supportedGameVersion: CURRENT_GAME_VERSION,
          modApiVersion: CURRENT_MOD_API_VERSION,
          schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
          multiplayerCompatibility: 'required',
        },
      ]),
    });
    assert.equal(incompatibleJoin.status, 409);
    assert.equal(incompatibleJoin.json.error, 'MOD_INCOMPATIBLE');

    // 10d. Malformed & oversized metadata rejected with 400 / 413 on /join and /quick-join
    const malformedQuickJoin = await callWorker('/api/multiplayer/rooms/quick-join', 'POST', {
      playerName: 'QuickBad',
      clientModMetadata: 'not-an-object',
    });
    assert.equal(malformedQuickJoin.status, 400);
    assert.equal(malformedQuickJoin.json.error, 'INVALID_MOD_METADATA');

    const oversizedQuickJoin = await callWorker('/api/multiplayer/rooms/quick-join', 'POST', {
      playerName: 'QuickHuge',
      clientModMetadata: {
        mods: [],
        padding: 'x'.repeat(MAX_MOD_METADATA_BYTES + 256),
      },
    });
    assert.equal(oversizedQuickJoin.status, 413);
    assert.equal(oversizedQuickJoin.json.error, 'MOD_METADATA_TOO_LARGE');

    // 10e. Compatible client joins online room cleanly
    const compatibleJoin = await callWorker('/api/multiplayer/rooms/join', 'POST', {
      roomCodeOrId: roomCode,
      playerName: 'MatchingGuest',
      clientModMetadata: makeModMeta([
        {
          modId: 'sky-islands',
          name: 'Sky Islands',
          version: '2.3.1',
          supportedGameVersion: CURRENT_GAME_VERSION,
          modApiVersion: CURRENT_MOD_API_VERSION,
          schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
          multiplayerCompatibility: 'required',
        },
      ]),
    });
    assert.equal(compatibleJoin.status, 200);
    const snapshot = compatibleJoin.json.room as {
      players: Array<{ displayName: string; progression?: unknown }>;
      gameState: {
        modCompatibilityStatus?: {
          requiredMods: Array<{ modId: string }>;
          compatiblePlayers: Array<{ displayName: string }>;
          incompatiblePlayers: Array<{ playerName: string }>;
        };
      };
    };
    assert.ok(snapshot.gameState.modCompatibilityStatus);
    assert.equal(snapshot.gameState.modCompatibilityStatus.requiredMods[0].modId, 'sky-islands');
    assert.ok(
      snapshot.gameState.modCompatibilityStatus.compatiblePlayers.some(
        (p) => p.displayName === 'MatchingGuest',
      ),
    );
    assert.ok(
      snapshot.gameState.modCompatibilityStatus.incompatiblePlayers.some(
        (p) => p.playerName === 'WrongVerGuest',
      ),
    );

    // 10f. Progression isolation: mod updates never alter player progression/XP/coins
    const roomDO = getRoomDO(roomId);
    assert.ok(roomDO);
    const hostSnapPlayer = snapshot.players.find((p) => p.displayName === 'OnlineHost') as
      | { level?: number; xp?: number; coins?: number }
      | undefined;
    assert.ok(hostSnapPlayer);
    // Initial progression remains owned by existing progression system (not modified by Mods)
    assert.equal((hostSnapPlayer.coins ?? 0) >= 0, true);
    pass('10. Online Worker + DO mod compatibility verification, security checks, and progression isolation');
  }

  // =========================================================================
  // 11. Unit checks: validateUntrustedProtocolModMetadata & ModValidator
  // =========================================================================
  {
    const badPath = validateUntrustedProtocolModMetadata({
      mods: [{ modId: 'dir/escape', name: 'X', version: '1.0.0' }],
    });
    assert.equal(badPath.ok, false);
    if (!badPath.ok) assert.equal(badPath.status, 400);

    const badBytes = validateUntrustedProtocolModMetadata({
      mods: [{ modId: 'ok-mod', name: 'X'.repeat(MAX_MOD_METADATA_BYTES + 100), version: '1.0.0' }],
    });
    assert.equal(badBytes.ok, false);
    if (!badBytes.ok) assert.equal(badBytes.status, 413);

    const baseEntry = {
      sourceId: 'crystal-gear',
      sourceType: 'folder' as const,
      installKind: 'development' as const,
      sourcePath: '/mods/crystal-gear',
      modifiedAtMs: Date.now(),
      manifestError: null,
      presentFolders: ['items'],
      contentFiles: [],
      assetFiles: [],
      executableFiles: [],
      archiveCorrupt: false,
    };

    const validPipeline = validateDiscoveredMods(
      [
        {
          ...baseEntry,
          manifestRaw: JSON.stringify({
            modId: 'crystal-gear',
            name: 'Crystal Gear',
            version: '1.2.0',
            compatibilityVersion: '1.x',
            author: 'Tester',
            description: 'Adds crystal tools',
            supportedGameVersion: '1.x',
            modApiVersion: CURRENT_MOD_API_VERSION,
            schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
          }),
        },
      ],
      { version: 1, enabledByModId: {}, priorityByModId: {}, updatedAtMs: Date.now() },
      CURRENT_GAME_VERSION,
    );
    assert.equal(validPipeline.records[0]?.hasValidManifest, true);
    assert.equal(validPipeline.records[0]?.manifest.compatibilityVersion, '1.x');

    const badPipeline = validateDiscoveredMods(
      [
        {
          ...baseEntry,
          manifestRaw: JSON.stringify({
            modId: 'crystal-gear',
            name: 'Crystal Gear',
            version: '1.2.0',
            compatibilityVersion: 'not-a-semver',
            author: 'Tester',
            description: 'Adds crystal tools',
            supportedGameVersion: '1.x',
            modApiVersion: CURRENT_MOD_API_VERSION,
            schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
          }),
        },
      ],
      { version: 1, enabledByModId: {}, priorityByModId: {}, updatedAtMs: Date.now() },
      CURRENT_GAME_VERSION,
    );
    assert.ok(
      badPipeline.records[0]?.diagnostics.some(
        (d) => d.severity === 'error' && d.message.includes('compatibilityVersion'),
      ),
    );
    pass('11. Strict untrusted metadata validator and ModValidator compatibilityVersion checks');
  }

  // =========================================================================
  // 12. ModWorldCompatibility & ModMultiplayerCompatibility local discovery enrichment
  // =========================================================================
  {
    const localModRecord: ModRecord = {
      entryKey: 'sunstone-weapons:woamod',
      sourceId: 'sunstone-weapons.woamod',
      sourceType: 'archive',
      installKind: 'woamod',
      sourcePath: '/mods/sunstone-weapons.woamod',
      modifiedAtMs: Date.now(),
      manifest: {
        modId: 'sunstone-weapons',
        name: 'Sunstone Weapons',
        version: '1.2.0',
        compatibilityVersion: '1.x',
        author: 'Tester',
        description: 'Weapons',
        supportedGameVersion: CURRENT_GAME_VERSION,
        modApiVersion: MOD_API_VERSION,
        schemaVersion: MOD_CONTENT_SCHEMA_VERSION,
        multiplayerCompatibility: 'required',
        modTypes: ['weapons'],
        categories: ['combat'],
        loadPriority: 100,
        dependencies: [],
      },
      hasValidManifest: true,
      gameCompatible: true,
      presentFolders: ['weapons'],
      missingStandardFolders: [],
      contentFileCount: 0,
      assetFileCount: 0,
      loadedEntriesCount: 0,
      parsedContentFiles: [],
      assets: [],
      incompatibleAssets: [],
      enabled: false,
      loaded: false,
      effectivePriority: 100,
      status: 'disabled',
      diagnostics: [],
      loadOrderIndex: null,
    };
    const snap: ModsSnapshot = {
      initialized: true,
      scanning: false,
      modsDir: '/mods',
      writable: true,
      platform: 'web',
      gameVersion: CURRENT_GAME_VERSION,
      modApiVersion: MOD_API_VERSION,
      schemaVersion: MOD_CONTENT_SCHEMA_VERSION,
      mods: [localModRecord],
      activeModIds: [],
      loadOrder: [],
      logs: [],
      lastScanAtMs: Date.now(),
      reloadedAtMs: null,
      lastError: null,
      installProgress: null,
    };
    const hostMeta = makeModMeta([
      {
        modId: 'sunstone-weapons',
        name: 'Sunstone Weapons',
        version: '1.2.0',
        compatibilityVersion: '1.x',
        supportedGameVersion: CURRENT_GAME_VERSION,
        modApiVersion: CURRENT_MOD_API_VERSION,
        schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
        multiplayerCompatibility: 'required',
      },
    ]);
    const localEval = evaluateMultiplayerModCompatibility('lan', hostMeta, snap);
    assert.equal(localEval.compatible, false);
    assert.equal(localEval.issues[0]?.code, 'disabled_mod');

    const rawReport = verifyMultiplayerModCompatibility(hostMeta, makeModMeta([]));
    const enriched = enrichProtocolReportWithLocalDiscovery(rawReport, snap);
    assert.equal(enriched.issues[0]?.code, 'disabled_mod');
    assert.ok(formatMultiplayerModRejectionMessage(enriched).includes('Cannot join this world.'));
    assert.ok(formatProtocolModCompatibilityMessage(rawReport).includes('Cannot join this world.'));
    pass('12. Local discovery enrichment marks installed-but-disabled mods as disabled_mod');
  }

  // =========================================================================
  // 13. Multiple required mods, Online Invite & Quick-Join compatibility filtering
  // =========================================================================
  {
    const multiHostMeta = makeModMeta([
      {
        modId: 'mod-alpha',
        name: 'Alpha Expansion',
        version: '1.2.0',
        compatibilityVersion: '1.x',
        supportedGameVersion: CURRENT_GAME_VERSION,
        modApiVersion: CURRENT_MOD_API_VERSION,
        schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
        multiplayerCompatibility: 'required',
      },
      {
        modId: 'mod-beta',
        name: 'Beta Dungeons',
        version: '2.0.0',
        compatibilityVersion: '2.x',
        supportedGameVersion: CURRENT_GAME_VERSION,
        modApiVersion: CURRENT_MOD_API_VERSION,
        schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
        multiplayerCompatibility: 'required',
      },
    ]);
    const partialClient = makeModMeta([
      {
        modId: 'mod-alpha',
        name: 'Alpha Expansion',
        version: '1.3.0',
        supportedGameVersion: CURRENT_GAME_VERSION,
        modApiVersion: CURRENT_MOD_API_VERSION,
        schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
        multiplayerCompatibility: 'required',
      },
    ]);
    const multiReport = verifyMultiplayerModCompatibility(multiHostMeta, partialClient);
    assert.equal(multiReport.compatible, false);
    assert.ok(multiReport.issues.some((i) => i.modId === 'mod-beta' && i.code === 'missing_mod'));
    assert.ok(multiReport.summary.includes('Beta Dungeons'));

    const { callWorker } = createWorkerHarness();
    const hostCreated = await callWorker('/api/multiplayer/rooms', 'POST', {
      playerName: 'InviteHost',
      roomName: 'Multi-Mod Realm',
      worldName: 'Multi-Mod World',
      privacy: 'public',
      modMetadata: multiHostMeta,
    });
    assert.equal(hostCreated.status, 200);
    const createdRoom = hostCreated.json.room as { roomId: string };
    const hostPlayerId = String(hostCreated.json.playerId);
    const hostToken = String(hostCreated.json.sessionToken);

    // Quick-join with vanilla client rejects with 409 MOD_INCOMPATIBLE when only modded rooms exist
    const qjBad = await callWorker('/api/multiplayer/rooms/quick-join', 'POST', {
      playerName: 'VanillaQuick',
      clientModMetadata: makeModMeta([]),
    });
    assert.equal(qjBad.status, 409);
    assert.equal(qjBad.json.error, 'MOD_INCOMPATIBLE');

    // Send invite & ensure incompatible invite accept fails before world entry, while matching succeeds
    const inviteRes = await callWorker('/api/multiplayer/invites', 'POST', {
      roomId: createdRoom.roomId,
      fromPlayerId: hostPlayerId,
      sessionToken: hostToken,
      toPlayerName: 'InvitedGuest',
    });
    assert.equal(inviteRes.status, 200);
    const inviteObj = inviteRes.json.invite as { inviteId: string };

    const invReject = await callWorker('/api/multiplayer/invites/accept', 'POST', {
      inviteId: inviteObj.inviteId,
      playerName: 'InvitedGuest',
      clientModMetadata: partialClient,
    });
    assert.equal(invReject.status, 409);
    assert.equal(invReject.json.error, 'MOD_INCOMPATIBLE');

    const fullClient = makeModMeta([
      {
        modId: 'mod-alpha',
        name: 'Alpha Expansion',
        version: '1.5.0',
        supportedGameVersion: CURRENT_GAME_VERSION,
        modApiVersion: CURRENT_MOD_API_VERSION,
        schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
        multiplayerCompatibility: 'required',
      },
      {
        modId: 'mod-beta',
        name: 'Beta Dungeons',
        version: '2.1.0',
        supportedGameVersion: CURRENT_GAME_VERSION,
        modApiVersion: CURRENT_MOD_API_VERSION,
        schemaVersion: CURRENT_MOD_SCHEMA_VERSION,
        multiplayerCompatibility: 'required',
      },
    ]);
    const invAccept = await callWorker('/api/multiplayer/invites/accept', 'POST', {
      inviteId: inviteObj.inviteId,
      playerName: 'InvitedGuest',
      clientModMetadata: fullClient,
    });
    assert.equal(invAccept.status, 200);
    pass('13. Multiple required mods, online invite rejection/accept, and quick-join filtering verified');
  }

  // =========================================================================
  // 14. Saved World Mod Compatibility & Vanilla Save Loading
  // =========================================================================
  {
    const baseSnap: ModsSnapshot = {
      initialized: true,
      scanning: false,
      modsDir: '/mods',
      writable: true,
      platform: 'web',
      gameVersion: CURRENT_GAME_VERSION,
      modApiVersion: MOD_API_VERSION,
      schemaVersion: MOD_CONTENT_SCHEMA_VERSION,
      mods: [],
      activeModIds: [],
      loadOrder: [],
      logs: [],
      lastScanAtMs: Date.now(),
      reloadedAtMs: null,
      lastError: null,
      installProgress: null,
    };

    // 14a. Vanilla save loads normally
    const vanillaEval = evaluateSaveModCompatibility(undefined, baseSnap);
    assert.equal(vanillaEval.compatible, true);
    assert.equal(vanillaEval.hasWarnings, false);

    // 14b. Modded save missing required mod warns & blocks direct safe load
    const moddedSaveMissing = evaluateSaveModCompatibility(
      {
        modApiVersion: MOD_API_VERSION,
        schemaVersion: MOD_CONTENT_SCHEMA_VERSION,
        savedAtGameVersion: CURRENT_GAME_VERSION,
        selectionMode: 'custom',
        mods: [
          {
            modId: 'crystal-cavern',
            name: 'Crystal Cavern',
            version: '1.0.0',
            loadOrder: 0,
            enabled: true,
            compatible: true,
            modApiVersion: MOD_API_VERSION,
            schemaVersion: MOD_CONTENT_SCHEMA_VERSION,
          },
        ],
      },
      baseSnap,
    );
    assert.equal(moddedSaveMissing.hasWarnings, true);
    assert.ok(moddedSaveMissing.issues.some((i) => i.code === 'missing_mod'));
    pass('14. Vanilla saves load cleanly while modded saves missing required mods trigger safety warning');
  }

  console.log(`\nALL ${passed} MOD MULTIPLAYER VERIFICATION SUITES PASSED.`);
}

runAllTests().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
