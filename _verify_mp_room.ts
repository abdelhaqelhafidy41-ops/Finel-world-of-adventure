import assert from 'node:assert/strict';

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

import workerApp from './workers/multiplayer/src/index';
import { MultiplayerRoomDO } from './workers/multiplayer/src/MultiplayerRoomDO';
import { PlayerProfileDO } from './workers/multiplayer/src/PlayerProfileDO';
import { RoomDirectoryDO } from './workers/multiplayer/src/RoomDirectoryDO';
import {
  buildMultiplayerConfig,
  formatMultiplayerDiagnosticReport,
  getMultiplayerConfig,
  normalizeMultiplayerBaseUrl,
  toWebSocketUrl,
} from './src/game/multiplayer/multiplayerConfig';
import {
  buildRoomShareLink,
  extractJoinTargetFromUrl,
} from './src/game/multiplayer/inviteUtils';

function createMockState() {
  const store = new Map<string, unknown>();
  let scheduledAlarm: number | null = null;
  return {
    id: { toString: () => 'room-do-id', equals: () => false },
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

function createMockEnv(overrides: Record<string, unknown> = {}) {
  return {
    MULTIPLAYER_ROOMS: {
      idFromName: (n: string) => ({ toString: () => n, equals: () => false }),
      idFromString: (n: string) => ({ toString: () => n, equals: () => false }),
      newUniqueId: () => ({ toString: () => 'uid', equals: () => false }),
      get: () => ({
        fetch: async () => new OrigResponse(JSON.stringify({ ok: true }), { status: 200 }),
      }),
    },
    ROOM_DIRECTORY: {
      idFromName: (n: string) => ({ toString: () => n, equals: () => false }),
      idFromString: (n: string) => ({ toString: () => n, equals: () => false }),
      newUniqueId: () => ({ toString: () => 'uid', equals: () => false }),
      get: () => ({
        fetch: async () => new OrigResponse(JSON.stringify({ ok: true }), { status: 200 }),
      }),
    },
    PLAYER_PROFILES: {
      idFromName: (n: string) => ({ toString: () => n, equals: () => false }),
      idFromString: (n: string) => ({ toString: () => n, equals: () => false }),
      newUniqueId: () => ({ toString: () => 'uid', equals: () => false }),
      get: () => ({
        fetch: async () => new OrigResponse(JSON.stringify({ ok: true }), { status: 200 }),
      }),
    },
    ...overrides,
  };
}

type Envelope = { type: string; playerId: string; payload?: Record<string, unknown> };

function collectMessages(ws: MockWebSocket): Envelope[] {
  const out: Envelope[] = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String((ev as MessageEvent).data)) as Envelope;
    out.push(msg);
  });
  return out;
}

const flush = () => new Promise((r) => setTimeout(r, 60));

async function run() {
  const state = createMockState();
  const env = createMockEnv();
  const roomDO = new MultiplayerRoomDO(state as never, env as never);
  const roomId = 'room_test_123456';

  // 1. Create room
  const createRes = await roomDO.fetch(
    new Request('https://internal/init', {
      method: 'POST',
      body: JSON.stringify({
        roomId,
        roomName: 'Test Coop',
        playerName: 'HostOne',
        worldName: 'Oakhollow',
        worldType: 'normal',
        difficulty: 'normal',
        maxPlayers: 4,
      }),
    }),
  );
  const createJson = (await createRes.json()) as {
    ok: boolean;
    playerId: string;
    sessionToken: string;
  };
  assert.equal(createJson.ok, true);
  const hostId = createJson.playerId;

  // 2. Join guest
  const joinRes = await roomDO.fetch(
    new Request('https://internal/join', {
      method: 'POST',
      body: JSON.stringify({ playerName: 'GuestTwo' }),
    }),
  );
  const joinJson = (await joinRes.json()) as {
    ok: boolean;
    playerId: string;
    sessionToken: string;
  };
  assert.equal(joinJson.ok, true);
  const guestId = joinJson.playerId;

  // 3. Connect host & guest WS
  const hostWsRes = (await roomDO.fetch(
    new Request(`https://internal/ws?playerId=${hostId}&token=${createJson.sessionToken}`, {
      headers: { Upgrade: 'websocket' },
    }),
  )) as unknown as { status: number; webSocket: MockWebSocket };
  assert.equal(hostWsRes.status, 101);
  const hostWs = hostWsRes.webSocket;
  const hostMsgs = collectMessages(hostWs);

  const guestWsRes = (await roomDO.fetch(
    new Request(`https://internal/ws?playerId=${guestId}&token=${joinJson.sessionToken}`, {
      headers: { Upgrade: 'websocket' },
    }),
  )) as unknown as { status: number; webSocket: MockWebSocket };
  assert.equal(guestWsRes.status, 101);
  let guestWs = guestWsRes.webSocket;
  let guestMsgs = collectMessages(guestWs);
  await flush();

  const send = (ws: MockWebSocket, pid: string, type: string, payload?: unknown) => {
    ws.send(JSON.stringify({ v: 1, type, roomId, playerId: pid, timestamp: Date.now(), payload }));
  };

  // Ready + start game
  send(guestWs, guestId, 'READY', { ready: true });
  await flush();
  send(hostWs, hostId, 'START_GAME');
  await flush();
  assert.ok(hostMsgs.some((m) => m.type === 'WORLD_SNAPSHOT'), 'Host receives WORLD_SNAPSHOT on start');
  assert.ok(guestMsgs.some((m) => m.type === 'WORLD_SNAPSHOT'), 'Guest receives WORLD_SNAPSHOT on start');

  // 4. Forged NPC_DIED & forbidden authority keys rejected
  guestMsgs.length = 0;
  send(guestWs, guestId, 'GAME_EVENT', { event: 'NPC_DIED', data: { targetId: 'npc-rowan' } });
  await flush();
  assert.ok(
    guestMsgs.some((m) => m.type === 'ERROR'),
    'Forged SERVER_ONLY event NPC_DIED must be rejected',
  );

  guestMsgs.length = 0;
  send(guestWs, guestId, 'GAME_EVENT', {
    event: 'COMBAT_HIT',
    data: { weaponId: 'ranger-sword', targetKind: 'enemy', targetId: 'enemy-1', damage: 9999 },
  });
  await flush();
  assert.ok(
    guestMsgs.some((m) => m.type === 'ERROR'),
    'Client-supplied damage key must be rejected',
  );

  // 5. Host-only ENTITY_SYNC enforced
  guestMsgs.length = 0;
  send(guestWs, guestId, 'ENTITY_SYNC', { entities: [] });
  await flush();
  assert.ok(
    guestMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'FORBIDDEN_HOST_ONLY'),
    'Non-host ENTITY_SYNC must be rejected',
  );

  guestMsgs.length = 0;
  send(hostWs, hostId, 'ENTITY_SYNC', {
    entities: [
      { id: 'enemy-bandit_scout-0', kind: 'enemy', archetype: 'bandit_scout', x: 5, y: 0, z: 6, yaw: 1.2, state: 'patrol' },
      { id: 'animal-deer-0', kind: 'animal', archetype: 'deer', x: 1.5, y: 0, z: 4.5, yaw: 0.4, state: 'idle' },
      { id: 'npc-rowan', kind: 'npc', archetype: 'villager', x: 2.0, y: 0, z: 4.5, yaw: 0.1, state: 'idle' },
    ],
    worldHours: 10.5,
    weather: 'rain',
  });
  await flush();
  const synced = guestMsgs.find((m) => m.type === 'ENTITY_SYNC');
  assert.ok(synced, 'Guest receives host ENTITY_SYNC');

  // 5b. Non-existent target fabrication rejected (TARGET_NOT_FOUND)
  guestMsgs.length = 0;
  send(guestWs, guestId, 'GAME_EVENT', {
    event: 'COMBAT_HIT',
    data: {
      weaponId: 'ranger-sword',
      targetKind: 'enemy',
      targetId: 'forged-fake-enemy-999',
      archetype: 'bandit_scout',
      x: 1,
      y: 0,
      z: 4,
      isCrit: false,
    },
  });
  await flush();
  assert.ok(
    guestMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'TARGET_NOT_FOUND'),
    'Fabricated target ID rejected with TARGET_NOT_FOUND',
  );
  await new Promise((r) => setTimeout(r, 360));

  // 5c. Unowned weapon rejected (WEAPON_NOT_OWNED), then crafting grants it cleanly
  guestMsgs.length = 0;
  send(guestWs, guestId, 'GAME_EVENT', {
    event: 'COMBAT_HIT',
    data: {
      weaponId: 'steel-sword',
      targetKind: 'animal',
      targetId: 'animal-deer-0',
      archetype: 'deer',
      x: 1.5,
      y: 0,
      z: 4.5,
      isCrit: false,
    },
  });
  await flush();
  assert.ok(
    guestMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'WEAPON_NOT_OWNED'),
    'Unowned steel-sword rejected with WEAPON_NOT_OWNED',
  );

  send(guestWs, guestId, 'GAME_EVENT', {
    event: 'WORLD_EVENT',
    data: { kind: 'item_crafted', recipeId: 'recipe-steel-sword', itemId: 'steel-sword', count: 1 },
  });
  await flush();
  guestMsgs.length = 0;
  send(guestWs, guestId, 'GAME_EVENT', {
    event: 'COMBAT_HIT',
    data: {
      attackId: 'swing_cleave_1',
      weaponId: 'steel-sword',
      targetKind: 'animal',
      targetId: 'animal-deer-0',
      archetype: 'deer',
      x: 1.5,
      y: 0,
      z: 4.5,
      isCrit: false,
    },
  });
  // Second target in same swing (cleave) succeeds without triggering cooldown
  send(guestWs, guestId, 'GAME_EVENT', {
    event: 'COMBAT_HIT',
    data: {
      attackId: 'swing_cleave_1',
      weaponId: 'steel-sword',
      targetKind: 'npc',
      targetId: 'npc-rowan',
      archetype: 'villager',
      x: 2.0,
      y: 0,
      z: 4.5,
      isCrit: false,
    },
  });
  await flush();
  assert.ok(
    guestMsgs.some((m) => m.type === 'GAME_EVENT' && (m.payload as { event?: string })?.event === 'ANIMAL_DAMAGED'),
    'Crafted steel-sword hit animal cleanly',
  );
  assert.ok(
    guestMsgs.some((m) => m.type === 'GAME_EVENT' && (m.payload as { event?: string })?.event === 'NPC_DAMAGED'),
    'Melee cleave hit 2nd target on same attackId cleanly',
  );

  // Distinct rapid swing within cooldown is still blocked
  guestMsgs.length = 0;
  send(guestWs, guestId, 'GAME_EVENT', {
    event: 'COMBAT_HIT',
    data: {
      attackId: 'swing_spam_2',
      weaponId: 'steel-sword',
      targetKind: 'animal',
      targetId: 'animal-deer-0',
      archetype: 'deer',
      x: 1.5,
      y: 0,
      z: 4.5,
      isCrit: false,
    },
  });
  await flush();
  assert.ok(
    guestMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'WEAPON_COOLDOWN'),
    'Rapid distinct melee swing still blocked by WEAPON_COOLDOWN',
  );
  await new Promise((r) => setTimeout(r, 360));

  // 6. Out-of-range COMBAT_HIT rejected
  guestMsgs.length = 0;
  send(guestWs, guestId, 'GAME_EVENT', {
    event: 'COMBAT_HIT',
    data: {
      weaponId: 'ranger-sword',
      targetKind: 'enemy',
      targetId: 'enemy-bandit_scout-0',
      archetype: 'bandit_scout',
      x: 120,
      y: 0,
      z: 120,
      isCrit: false,
    },
  });
  await flush();
  assert.ok(
    guestMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'OUT_OF_RANGE'),
    'Out-of-range COMBAT_HIT rejected',
  );

  // 7. Valid ARROW_FIRED + PROJECTILE_HIT deducts server ammo & damages enemy authoritatively
  hostMsgs.length = 0;
  guestMsgs.length = 0;
  send(hostWs, hostId, 'GAME_EVENT', {
    event: 'ARROW_FIRED',
    data: {
      arrowId: 'arr_1',
      weaponId: 'hunter-bow',
      originX: 0.2,
      originY: 1.5,
      originZ: 4.1,
      dirX: 0,
      dirY: 0,
      dirZ: 1,
      bowCharge: 1,
    },
  });
  await flush();
  const arrowFiredMsg = guestMsgs.find(
    (m) => m.type === 'GAME_EVENT' && (m.payload as { event?: string })?.event === 'ARROW_FIRED',
  );
  assert.ok(arrowFiredMsg, 'ARROW_FIRED broadcast to guest');
  assert.equal((arrowFiredMsg!.payload!.data as { ammoCount: number }).ammoCount, 23);

  // Duplicate active arrowId rejected
  hostMsgs.length = 0;
  await new Promise((r) => setTimeout(r, 275));
  send(hostWs, hostId, 'GAME_EVENT', {
    event: 'ARROW_FIRED',
    data: {
      arrowId: 'arr_1',
      weaponId: 'hunter-bow',
      originX: 0.2,
      originY: 1.5,
      originZ: 4.1,
      dirX: 0,
      dirY: 0,
      dirZ: 1,
      bowCharge: 1,
    },
  });
  await flush();
  assert.ok(
    hostMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'DUPLICATE_ARROW_ID'),
    'Duplicate active arrowId rejected',
  );

  // Projectile hit behind shooter trajectory rejected
  hostMsgs.length = 0;
  send(hostWs, hostId, 'GAME_EVENT', {
    event: 'ARROW_FIRED',
    data: {
      arrowId: 'arr_bad_traj',
      weaponId: 'hunter-bow',
      originX: 0.2,
      originY: 1.5,
      originZ: 4.1,
      dirX: 0,
      dirY: 0,
      dirZ: 1,
      bowCharge: 1,
    },
  });
  await flush();
  send(hostWs, hostId, 'GAME_EVENT', {
    event: 'PROJECTILE_HIT',
    data: {
      arrowId: 'arr_bad_traj',
      targetKind: 'world',
      targetId: '',
      x: 0.2,
      y: 1.5,
      z: -12,
      isHeadshot: false,
    },
  });
  await flush();
  assert.ok(
    hostMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'INVALID_PROJECTILE_TRAJECTORY'),
    'Hit behind arrow launch vector rejected with INVALID_PROJECTILE_TRAJECTORY',
  );

  send(hostWs, hostId, 'GAME_EVENT', {
    event: 'PROJECTILE_HIT',
    data: {
      arrowId: 'arr_1',
      targetKind: 'enemy',
      targetId: 'enemy-bandit_scout-0',
      archetype: 'bandit_scout',
      x: 5,
      y: 1.4,
      z: 6,
      isHeadshot: true,
    },
  });
  await flush();
  const enemyDmg = guestMsgs.find(
    (m) => m.type === 'GAME_EVENT' && (m.payload as { event?: string })?.event === 'ENEMY_DAMAGED',
  );
  const enemyDied = guestMsgs.find(
    (m) => m.type === 'GAME_EVENT' && (m.payload as { event?: string })?.event === 'ENEMY_DIED',
  );
  assert.ok(enemyDmg, 'Server computed ENEMY_DAMAGED');
  assert.ok(enemyDied, 'Headshot full-charge bow killed 65 HP scout cleanly -> ENEMY_DIED');

  // 8. Exhaust all 24 starting arrows on guest -> 25th hits NO_AMMO
  for (let i = 0; i < 25; i++) {
    guestMsgs.length = 0;
    send(guestWs, guestId, 'GAME_EVENT', {
      event: 'ARROW_FIRED',
      data: { arrowId: `g_arr_${i}`, weaponId: 'hunter-bow', originX: 0, originY: 1.5, originZ: 4, dirX: 0, dirY: 0, dirZ: 1, bowCharge: 1 },
    });
    await new Promise((r) => setTimeout(r, 300));
  }
  await flush();
  const noAmmoErr = guestMsgs.find((m) => m.type === 'ERROR' && m.payload?.code === 'NO_AMMO');
  assert.ok(noAmmoErr, '25th arrow rejected with NO_AMMO by server');

  // Crafting 12 arrows restores server ammo
  send(guestWs, guestId, 'GAME_EVENT', { event: 'WORLD_EVENT', data: { kind: 'ammo_crafted', count: 12 } });
  await flush();
  guestMsgs.length = 0;
  send(guestWs, guestId, 'GAME_EVENT', {
    event: 'ARROW_FIRED',
    data: { arrowId: 'g_arr_crafted', weaponId: 'hunter-bow', originX: 0, originY: 1.5, originZ: 4, dirX: 0, dirY: 0, dirZ: 1, bowCharge: 0.5 },
  });
  await flush();
  assert.ok(
    guestMsgs.some((m) => m.type === 'GAME_EVENT' && (m.payload as { event?: string })?.event === 'ARROW_FIRED'),
    'Crafted ammo allows firing again',
  );

  // 9. Atomic Chest, Resource, Item Drop/Pickup, Door, Bed, Quest
  guestMsgs.length = 0;
  send(hostWs, hostId, 'GAME_EVENT', { event: 'CHEST_OPENED', data: { chestId: 'chest-1', hasArrows: false, x: 1, y: 0, z: 4 } });
  await flush();
  send(guestWs, guestId, 'GAME_EVENT', { event: 'CHEST_OPENED', data: { chestId: 'chest-1', hasArrows: false, x: 1, y: 0, z: 4 } });
  await flush();
  assert.ok(
    guestMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'CHEST_ALREADY_OPENED'),
    'Double chest open prevented',
  );

  send(hostWs, hostId, 'GAME_EVENT', { event: 'ITEM_PICKED_UP', data: { pickupId: 'wood-seed-1', itemId: 'wood', count: 3, x: 1, y: 0, z: 4 } });
  await flush();
  send(hostWs, hostId, 'GAME_EVENT', { event: 'ITEM_DROPPED', data: { dropId: 'drop_1', itemId: 'wood', count: 3, label: 'Wood', x: 1, y: 0, z: 4 } });
  await flush();
  send(guestWs, guestId, 'GAME_EVENT', { event: 'ITEM_PICKED_UP', data: { pickupId: 'drop_1', x: 1, z: 4 } });
  await flush();
  hostMsgs.length = 0;
  send(hostWs, hostId, 'GAME_EVENT', { event: 'ITEM_PICKED_UP', data: { pickupId: 'drop_1', x: 1, z: 4 } });
  await flush();
  assert.ok(
    hostMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'ALREADY_COLLECTED'),
    'Item drop can only be claimed once',
  );

  send(hostWs, hostId, 'GAME_EVENT', { event: 'DOOR_OPENED', data: { doorId: 'door-1', x: 1, z: 4 } });
  send(hostWs, hostId, 'GAME_EVENT', { event: 'BED_PLACED', data: { bedId: 'bed-1', x: 1, y: 0, z: 4, yaw: 0.5 } });
  send(hostWs, hostId, 'GAME_EVENT', { event: 'BED_USED', data: { bedId: 'bed-1', x: 1, z: 4 } });
  send(hostWs, hostId, 'GAME_EVENT', { event: 'QUEST_UPDATED', data: { questId: 'quest-1', status: 'active', stepIndex: 2 } });
  send(guestWs, guestId, 'GAME_EVENT', { event: 'QUEST_UPDATED', data: { questId: 'quest-guest', status: 'active', stepIndex: 1 } });
  send(hostWs, hostId, 'GAME_EVENT', { event: 'WORLD_EVENT', data: { kind: 'landmark_discovered', landmarkId: 'lm-ruins' } });
  send(hostWs, hostId, 'PLAYER_STATE', { x: 12.5, y: 0, z: -8.25, yaw: 1.1 });
  await flush();

  // 10. Reconnect snapshot contains full synchronized world state & isolated per-player quests/inventory/positions
  const reconnectWsRes = (await roomDO.fetch(
    new Request(`https://internal/ws?playerId=${guestId}&token=${joinJson.sessionToken}`, {
      headers: { Upgrade: 'websocket' },
    }),
  )) as unknown as { status: number; webSocket: MockWebSocket };
  guestWs = reconnectWsRes.webSocket;
  guestMsgs = collectMessages(guestWs);
  await flush();
  const snap = guestMsgs.find((m) => m.type === 'WORLD_SNAPSHOT')?.payload as Record<string, unknown>;
  assert.ok(snap, 'Reconnect receives WORLD_SNAPSHOT');
  assert.deepEqual(snap.openedChests, ['chest-1']);
  assert.equal((snap.doors as Array<{ id: string; isOpen: boolean }>)[0].isOpen, true);
  assert.equal((snap.placedBeds as Array<{ id: string }>)[0].id, 'bed-1');
  const guestQuests = snap.quests as Array<{ questId: string }>;
  assert.ok(guestQuests.some((q) => q.questId === 'quest-guest'), 'Guest retains own quests on reconnect');
  assert.ok(!guestQuests.some((q) => q.questId === 'quest-1'), 'Host quests do not leak to guest');
  assert.ok((snap.discoveredLandmarks as string[]).includes('lm-ruins'));
  assert.equal(snap.ammoCount, 11);
  assert.ok(
    Math.abs((snap.worldHours as number) - 6.5) < 0.05,
    `WORLD_SNAPSHOT worldHours reflects bed time (~6.5), got ${snap.worldHours}`,
  );
  assert.ok(
    Array.isArray(snap.inventoryItemIds) && (snap.inventoryItemIds as string[]).includes('steel-sword'),
    'Reconnect snapshot restores per-player inventoryItemIds including crafted steel-sword',
  );
  const peerHostState = guestMsgs.find((m) => m.type === 'PLAYER_STATE' && m.playerId === hostId);
  assert.ok(
    peerHostState && peerHostState.payload?.x === 12.5 && peerHostState.payload?.z === -8.25,
    'Reconnect sends peer PLAYER_STATE positions so map markers restore',
  );

  // 11. Room Chat (English & Arabic BiDi, authoritative sender, length limits, anti-spam)
  hostMsgs.length = 0;
  guestMsgs.length = 0;
  send(hostWs, hostId, 'ROOM_CHAT', {
    message: 'مرحبا بكم في وادي أوكهولو! Welcome!',
    playerName: 'SpoofedAdmin',
    playerId: 'spoofed_id',
  });
  await flush();
  const relayedChat = guestMsgs.find((m) => m.type === 'ROOM_CHAT');
  assert.ok(relayedChat, 'Guest receives ROOM_CHAT broadcast');
  assert.equal(relayedChat!.payload?.playerId, hostId, 'Server stamps authoritative playerId');
  assert.equal(relayedChat!.payload?.playerName, 'HostOne', 'Server stamps authoritative playerName');
  assert.equal(relayedChat!.payload?.message, 'مرحبا بكم في وادي أوكهولو! Welcome!');
  assert.equal(typeof relayedChat!.payload?.timestamp, 'number');
  assert.equal(typeof relayedChat!.payload?.id, 'string');

  // Empty & overlength messages rejected
  guestMsgs.length = 0;
  send(guestWs, guestId, 'ROOM_CHAT', { message: '   ' });
  await flush();
  assert.ok(
    guestMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'EMPTY_CHAT_MESSAGE'),
    'Empty chat message rejected',
  );

  guestMsgs.length = 0;
  send(guestWs, guestId, 'ROOM_CHAT', { message: 'x'.repeat(245) });
  await flush();
  assert.ok(
    guestMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'CHAT_TOO_LONG'),
    'Overlength chat message (>240) rejected',
  );

  // Cooldown anti-spam & duplicate message suppression
  hostMsgs.length = 0;
  send(hostWs, hostId, 'ROOM_CHAT', { message: 'Immediate burst' });
  await flush();
  assert.ok(
    hostMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'CHAT_SPAM_LIMITED'),
    'Rapid burst blocked by cooldown anti-spam',
  );

  await new Promise((r) => setTimeout(r, 950));
  hostMsgs.length = 0;
  send(hostWs, hostId, 'ROOM_CHAT', { message: 'مرحبا بكم في وادي أوكهولو! Welcome!' });
  await flush();
  assert.ok(
    hostMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'CHAT_DUPLICATE_SPAM'),
    'Duplicate message blocked by anti-spam',
  );

  await new Promise((r) => setTimeout(r, 950));
  send(guestWs, guestId, 'ROOM_CHAT', { message: 'Ready near the bridge.' });
  await flush();

  // 12. Player Report (REPORT_ACK, self-report rejected, duplicate report rejected)
  guestMsgs.length = 0;
  send(guestWs, guestId, 'PLAYER_REPORT', {
    targetPlayerId: guestId,
    reason: 'spam',
  });
  await flush();
  assert.ok(
    guestMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'CANNOT_REPORT_SELF'),
    'Self-report rejected with CANNOT_REPORT_SELF',
  );

  guestMsgs.length = 0;
  send(guestWs, guestId, 'PLAYER_REPORT', {
    targetPlayerId: hostId,
    reason: 'spam',
    details: 'Repeated pings near village.',
  });
  await flush();
  const reportAck = guestMsgs.find((m) => m.type === 'REPORT_ACK');
  assert.ok(reportAck, 'Valid PLAYER_REPORT returns REPORT_ACK');
  assert.equal(reportAck!.payload?.targetPlayerId, hostId);
  assert.equal(reportAck!.payload?.reason, 'spam');

  guestMsgs.length = 0;
  send(guestWs, guestId, 'PLAYER_REPORT', {
    targetPlayerId: hostId,
    reason: 'harassment',
  });
  await flush();
  assert.ok(
    guestMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'REPORT_ALREADY_SUBMITTED'),
    'Duplicate report in same room rejected with REPORT_ALREADY_SUBMITTED',
  );

  // 13. Reconnect receives CHAT_HISTORY + stored reports contain zero sensitive data
  const chatReconWsRes = (await roomDO.fetch(
    new Request(`https://internal/ws?playerId=${guestId}&token=${joinJson.sessionToken}`, {
      headers: { Upgrade: 'websocket' },
    }),
  )) as unknown as { status: number; webSocket: MockWebSocket };
  guestWs = chatReconWsRes.webSocket;
  guestMsgs = collectMessages(guestWs);
  await flush();
  const chatHistory = guestMsgs.find((m) => m.type === 'CHAT_HISTORY')?.payload as {
    messages?: Array<{ message: string }>;
  };
  assert.ok(chatHistory && Array.isArray(chatHistory.messages), 'Reconnect receives CHAT_HISTORY');
  assert.equal(chatHistory.messages!.length, 2, 'CHAT_HISTORY preserves recent room messages');

  const storedChat = await state.storage.get<{
    reports?: Array<Record<string, unknown>>;
  }>('room_chat_v2');
  assert.equal(storedChat?.reports?.length, 1);
  assert.equal('ip' in (storedChat?.reports?.[0] ?? {}), false);
  assert.equal('token' in (storedChat?.reports?.[0] ?? {}), false);

  const storedRoomMeta = await state.storage.get<Record<string, unknown>>('room_meta_v2');
  const storedWorldLayer = await state.storage.get<Record<string, unknown>>('world_state_v2');
  const storedSharedLayer = await state.storage.get<Record<string, unknown>>('shared_objects_v2');
  assert.ok(storedRoomMeta, 'Separated room_meta_v2 layer stored in DO storage');
  assert.ok(storedWorldLayer, 'Separated world_state_v2 layer stored in DO storage');
  assert.ok(storedSharedLayer, 'Separated shared_objects_v2 layer stored in DO storage');
  assert.equal(
    await state.storage.get('authoritative_room_v1'),
    undefined,
    'Legacy monolithic key is not kept once migrated to separated layers',
  );

  // 14. Unexpected WebSocket drop preserves room membership & restores full state on reconnect
  send(hostWs, hostId, 'PLAYER_STATE', { x: 12.5, y: 1.0, z: -8.25, yaw: 1.75 });
  await flush();
  guestMsgs.length = 0;
  // Simulate guest abrupt network drop
  guestWs.close(1006, 'Network changed');
  await flush();
  const roomAfterDropRes = await roomDO.fetch(new Request('https://internal/state'));
  const roomAfterDrop = (await roomAfterDropRes.json()) as {
    ok: boolean;
    room: { players: Array<{ playerId: string; connectionQuality?: string }> };
  };
  const droppedGuestRecord = roomAfterDrop.room.players.find((p) => p.playerId === guestId);
  assert.ok(droppedGuestRecord, 'Abrupt disconnect preserves guest membership inside grace window');
  assert.equal(droppedGuestRecord?.connectionQuality, 'disconnected');

  const guestRejoinWsRes = (await roomDO.fetch(
    new Request(`https://internal/ws?playerId=${guestId}&token=${joinJson.sessionToken}`, {
      headers: { Upgrade: 'websocket' },
    }),
  )) as unknown as { status: number; webSocket: MockWebSocket };
  const guestRejoinWs = guestRejoinWsRes.webSocket;
  const guestRejoinMsgs = collectMessages(guestRejoinWs);
  await flush();
  assert.ok(
    guestRejoinMsgs.some((m) => m.type === 'CONNECT' && m.playerId === guestId),
    'Reconnect restores network identity via CONNECT',
  );
  assert.ok(
    guestRejoinMsgs.some((m) => m.type === 'ROOM_STATE'),
    'Reconnect receives current ROOM_STATE',
  );
  assert.ok(
    guestRejoinMsgs.some(
      (m) =>
        m.type === 'PLAYER_STATE' &&
        m.playerId === hostId &&
        Math.abs(Number(m.payload?.x) - 12.5) < 0.01,
    ),
    'Reconnect receives peer PLAYER_STATEs',
  );
  assert.ok(
    guestRejoinMsgs.some((m) => m.type === 'WORLD_SNAPSHOT'),
    'Reconnect receives important WORLD_SNAPSHOT',
  );

  // 15. Simulated server / Durable Object restart recovers room + world + identities on reconnect
  const restartedDO = new MultiplayerRoomDO(
    state as never,
    createMockEnv({ HOST_DISCONNECT_GRACE_MS: '80', PLAYER_RECONNECT_GRACE_MS: '180' }) as never,
  );
  const hostAfterRestartRes = (await restartedDO.fetch(
    new Request(`https://internal/ws?playerId=${hostId}&token=${createJson.sessionToken}`, {
      headers: { Upgrade: 'websocket' },
    }),
  )) as unknown as { status: number; webSocket: MockWebSocket };
  const hostAfterRestartWs = hostAfterRestartRes.webSocket;
  const hostAfterRestartMsgs = collectMessages(hostAfterRestartWs);
  const guestAfterRestartRes = (await restartedDO.fetch(
    new Request(`https://internal/ws?playerId=${guestId}&token=${joinJson.sessionToken}`, {
      headers: { Upgrade: 'websocket' },
    }),
  )) as unknown as { status: number; webSocket: MockWebSocket };
  const guestAfterRestartWs = guestAfterRestartRes.webSocket;
  const guestAfterRestartMsgs = collectMessages(guestAfterRestartWs);
  await flush();
  assert.ok(
    hostAfterRestartMsgs.some((m) => m.type === 'WORLD_SNAPSHOT'),
    'Host recovers WORLD_SNAPSHOT after DO server restart',
  );
  assert.ok(
    guestAfterRestartMsgs.some((m) => m.type === 'ROOM_STATE'),
    'Guest recovers ROOM_STATE after DO server restart',
  );

  // 16. Host unexpected disconnect transfers host authority after grace period
  guestAfterRestartMsgs.length = 0;
  hostAfterRestartWs.close(1006, 'Wi-Fi disconnected');
  await new Promise((r) => setTimeout(r, 110));
  await restartedDO.alarm();
  await flush();
  assert.ok(
    guestAfterRestartMsgs.some(
      (m) => m.type === 'HOST_TRANSFERRED' && m.payload?.newHostId === guestId,
    ),
    'Host authority automatically transfers to connected guest after grace timeout',
  );

  // 17. Disconnected player past reconnect grace timeout is removed cleanly by DO alarm
  await new Promise((r) => setTimeout(r, 110));
  await restartedDO.alarm();
  await flush();
  const postTimeoutStateRes = await restartedDO.fetch(new Request('https://internal/state'));
  const postTimeoutState = (await postTimeoutStateRes.json()) as {
    room: { players: Array<{ playerId: string }>; hostId: string };
  };
  assert.equal(postTimeoutState.room.hostId, guestId);
  assert.equal(
    postTimeoutState.room.players.some((p) => p.playerId === hostId),
    false,
    'Timed-out disconnected player purged cleanly by server alarm',
  );

  // 18. Closing room cleanly emits ROOM_CLOSED, closes client WS, and deletes room state
  guestAfterRestartMsgs.length = 0;
  send(guestAfterRestartWs, guestId, 'CLOSE_ROOM');
  await flush();
  assert.ok(
    guestAfterRestartMsgs.some((m) => m.type === 'ROOM_CLOSED'),
    'CLOSE_ROOM broadcasts ROOM_CLOSED to clients',
  );
  assert.equal(guestAfterRestartWs.closed, true, 'CLOSE_ROOM closes connected client socket');
  const closedStateRes = await restartedDO.fetch(new Request('https://internal/state'));
  assert.equal(closedStateRes.status, 404, 'Closed room returns 404 from DO');

  // 19. Production Security: Movement speedhack, fake static weapon pickup, bed spam, oversized payload
  const secState = createMockState();
  const secRoom = new MultiplayerRoomDO(secState as never, createMockEnv() as never);
  const secRoomId = 'room_sec_test_999';
  const secCreate = (await (
    await secRoom.fetch(
      new Request('https://internal/init', {
        method: 'POST',
        body: JSON.stringify({
          roomId: secRoomId,
          roomName: 'Security Arena',
          playerName: 'SecHost',
          worldType: 'normal',
          maxPlayers: 16,
        }),
      }),
    )
  ).json()) as { playerId: string; sessionToken: string };
  const secHostId = secCreate.playerId;
  const secHostWsRes = (await secRoom.fetch(
    new Request(
      `https://internal/ws?playerId=${secHostId}&token=${secCreate.sessionToken}`,
      { headers: { Upgrade: 'websocket', 'X-Client-IP': '203.0.113.10' } },
    ),
  )) as unknown as { status: number; webSocket: MockWebSocket };
  const secHostWs = secHostWsRes.webSocket;
  const secMsgs = collectMessages(secHostWs);
  await flush();

  const sendSec = (ws: MockWebSocket, pid: string, type: string, payload?: unknown) => {
    ws.send(
      JSON.stringify({ v: 1, type, roomId: secRoomId, playerId: pid, timestamp: Date.now(), payload }),
    );
  };
  sendSec(secHostWs, secHostId, 'START_GAME');
  await flush();

  // 19a. Packet-burst speedhack / teleport rejected
  secMsgs.length = 0;
  sendSec(secHostWs, secHostId, 'PLAYER_STATE', { x: 0, y: 0, z: 4, yaw: 0 });
  await flush();
  for (let step = 1; step <= 6; step++) {
    sendSec(secHostWs, secHostId, 'PLAYER_STATE', { x: step * 5, y: 0, z: 4, yaw: 0 });
  }
  await flush();
  assert.ok(
    secMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'INVALID_POSITION_DELTA') &&
      secMsgs.some((m) => m.type === 'POSITION_CORRECTION'),
    'Packet-burst speedhack rejected with INVALID_POSITION_DELTA + POSITION_CORRECTION',
  );

  // 19b. Fake static pickup weapon fabrication rejected
  secMsgs.length = 0;
  sendSec(secHostWs, secHostId, 'GAME_EVENT', {
    event: 'ITEM_PICKED_UP',
    data: { pickupId: 'fake_static_pickup_1', itemId: 'steel-sword', count: 4, x: 0, z: 4 },
  });
  await flush();
  assert.ok(
    secMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'FORBIDDEN_ITEM_GRANT'),
    'Untracked static pickup weapon grant rejected with FORBIDDEN_ITEM_GRANT',
  );

  // 19c. Bed heal spam blocked by cooldown
  sendSec(secHostWs, secHostId, 'GAME_EVENT', {
    event: 'BED_USED',
    data: { bedId: 'bed-sec-1', x: 0, z: 4 },
  });
  await flush();
  secMsgs.length = 0;
  sendSec(secHostWs, secHostId, 'GAME_EVENT', {
    event: 'BED_USED',
    data: { bedId: 'bed-sec-1', x: 0, z: 4 },
  });
  await flush();
  assert.ok(
    secMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'BED_COOLDOWN'),
    'Immediate repeated BED_USED rejected with BED_COOLDOWN',
  );

  // 19d. Oversized WS message (>4096 bytes) rejected
  secMsgs.length = 0;
  secHostWs.send(
    JSON.stringify({
      v: 1,
      type: 'ROOM_CHAT',
      roomId: secRoomId,
      playerId: secHostId,
      timestamp: Date.now(),
      payload: { message: 'a'.repeat(4500) },
    }),
  );
  await flush();
  assert.ok(
    secMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'MESSAGE_SIZE_EXCEEDED'),
    'Oversized WebSocket payload rejected with MESSAGE_SIZE_EXCEEDED',
  );

  // 19e. Per-IP concurrent WebSocket limit (8 max per IP) enforced
  secHostWs.close(1000, 'Done');
  const limitState = createMockState();
  const limitRoom = new MultiplayerRoomDO(limitState as never, createMockEnv() as never);
  await limitRoom.fetch(
    new Request('https://internal/init', {
      method: 'POST',
      body: JSON.stringify({
        roomId: 'room_limit_test_888',
        roomName: 'Limit Arena',
        playerName: 'LimitHost',
        worldType: 'normal',
        maxPlayers: 16,
      }),
    }),
  );
  const floodSockets: MockWebSocket[] = [];
  for (let idx = 0; idx < 8; idx++) {
    const jRes = (await (
      await limitRoom.fetch(
        new Request('https://internal/join', {
          method: 'POST',
          body: JSON.stringify({ playerName: `Flood_${idx}` }),
        }),
      )
    ).json()) as { playerId: string; sessionToken: string };
    const wsRes = (await limitRoom.fetch(
      new Request(
        `https://internal/ws?playerId=${jRes.playerId}&token=${jRes.sessionToken}`,
        { headers: { Upgrade: 'websocket', 'X-Client-IP': '203.0.113.10' } },
      ),
    )) as unknown as { status: number; webSocket: MockWebSocket };
    assert.equal(wsRes.status, 101);
    floodSockets.push(wsRes.webSocket);
  }
  const extraJoin = (await (
    await limitRoom.fetch(
      new Request('https://internal/join', {
        method: 'POST',
        body: JSON.stringify({ playerName: 'Flood_OverLimit' }),
      }),
    )
  ).json()) as { playerId: string; sessionToken: string };
  const overLimitRes = await limitRoom.fetch(
    new Request(
      `https://internal/ws?playerId=${extraJoin.playerId}&token=${extraJoin.sessionToken}`,
      { headers: { Upgrade: 'websocket', 'X-Client-IP': '203.0.113.10' } },
    ),
  );
  assert.equal(overLimitRes.status, 429, 'Per-IP simultaneous WebSocket connection cap returns 429');
  for (const s of floodSockets) s.close(1000, 'Done');

  // 20. Full Worker HTTP Router + RoomDirectoryDO + MultiplayerRoomDO integration test
  const dirState = createMockState();
  const profilesState = createMockState();
  const roomMap = new Map<string, MultiplayerRoomDO>();
  let fullEnv: ReturnType<typeof createMockEnv>;
  const dirDO = new RoomDirectoryDO(dirState as never, {} as never);
  const profileDO = new PlayerProfileDO(profilesState as never, {} as never);
  fullEnv = createMockEnv({
    ENVIRONMENT: 'production',
    ROOM_DIRECTORY: {
      idFromName: (n: string) => ({ toString: () => n, equals: () => false }),
      idFromString: (n: string) => ({ toString: () => n, equals: () => false }),
      newUniqueId: () => ({ toString: () => 'dir', equals: () => false }),
      get: () => ({
        fetch: (req: RequestInfo | URL, init?: RequestInit) =>
          dirDO.fetch(typeof req === 'string' ? new Request(req, init) : (req as Request)),
      }),
    },
    PLAYER_PROFILES: {
      idFromName: (n: string) => ({ toString: () => n, equals: () => false }),
      idFromString: (n: string) => ({ toString: () => n, equals: () => false }),
      newUniqueId: () => ({ toString: () => 'prof', equals: () => false }),
      get: () => ({
        fetch: (req: RequestInfo | URL, init?: RequestInit) =>
          profileDO.fetch(typeof req === 'string' ? new Request(req, init) : (req as Request)),
      }),
    },
    MULTIPLAYER_ROOMS: {
      idFromName: (n: string) => ({ toString: () => n, equals: () => false }),
      idFromString: (n: string) => ({ toString: () => n, equals: () => false }),
      newUniqueId: () => ({ toString: () => 'rm', equals: () => false }),
      get: (id: { toString: () => string }) => {
        const key = id.toString();
        let instance = roomMap.get(key);
        if (!instance) {
          instance = new MultiplayerRoomDO(createMockState() as never, fullEnv as never);
          roomMap.set(key, instance);
        }
        return {
          fetch: (req: RequestInfo | URL, init?: RequestInit) =>
            instance!.fetch(typeof req === 'string' ? new Request(req, init) : (req as Request)),
        };
      },
    },
  });

  const ctxStub = { waitUntil: () => {}, passThroughOnException: () => {} };
  const healthRes = await workerApp.fetch(
    new Request('https://worker.example/health'),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(healthRes.status, 200);
  const healthJson = (await healthRes.json()) as { ok: boolean; environment: string };
  assert.equal(healthJson.ok, true);
  assert.equal(healthJson.environment, 'production');

  // Oversized HTTP body rejected with 413
  const hugeHttpRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.5' },
      body: JSON.stringify({ playerName: 'x'.repeat(36_000) }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(hugeHttpRes.status, 413, 'Oversized HTTP POST rejected with 413');

  // Create room via Worker router
  const createHttpRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.5' },
      body: JSON.stringify({
        roomName: 'Oakhollow Production Coop',
        playerName: 'AtlasHost',
        worldType: 'normal',
        maxPlayers: 4,
        privacy: 'public',
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(createHttpRes.status, 200);
  const createdRoom = (await createHttpRes.json()) as {
    ok: boolean;
    playerId: string;
    sessionToken: string;
    room: { roomId: string; roomCode: string };
  };
  assert.equal(createdRoom.ok, true);

  // Verify room by code
  const verifyRes = await workerApp.fetch(
    new Request(
      `https://worker.example/api/multiplayer/rooms/verify?codeOrId=${createdRoom.room.roomCode}`,
      { headers: { 'CF-Connecting-IP': '198.51.100.6' } },
    ),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(verifyRes.status, 200);

  // Unauthenticated invite rejected (403)
  const badInviteRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.7' },
      body: JSON.stringify({
        roomId: createdRoom.room.roomId,
        fromPlayerId: createdRoom.playerId,
        sessionToken: 'forged_token',
        toPlayerName: 'FriendBob',
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(badInviteRes.status, 403, 'Forged invite without valid sessionToken rejected');

  // Authenticated invite -> list -> accept -> join
  const goodInviteRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.5' },
      body: JSON.stringify({
        roomId: createdRoom.room.roomId,
        fromPlayerId: createdRoom.playerId,
        sessionToken: createdRoom.sessionToken,
        toPlayerName: 'FriendBob',
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(goodInviteRes.status, 200);
  const invPayload = (await goodInviteRes.json()) as { invite: { inviteId: string } };
  const listInvRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/invites?playerName=FriendBob', {
      headers: { 'CF-Connecting-IP': '198.51.100.8' },
    }),
    fullEnv as never,
    ctxStub,
  );
  const listInvJson = (await listInvRes.json()) as { invites: Array<{ inviteId: string }> };
  assert.equal(listInvJson.invites.length, 1);

  const acceptInvRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/invites/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.8' },
      body: JSON.stringify({
        inviteId: invPayload.invite.inviteId,
        playerName: 'FriendBob',
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(acceptInvRes.status, 200);
  const acceptedJson = (await acceptInvRes.json()) as {
    ok: boolean;
    room: { players: Array<{ displayName: string }> };
  };
  assert.equal(acceptedJson.ok, true);
  assert.equal(acceptedJson.room.players.length, 2);

  // 21. Player Profile & Online Identity System end-to-end verification
  // 21a. Invalid display names (<3 chars, >20 chars, XSS script) rejected
  const shortNameRes = await workerApp.fetch(
    new Request('https://worker.example/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.21' },
      body: JSON.stringify({ displayName: 'Ab' }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(shortNameRes.status, 400, 'Display name shorter than 3 chars rejected');

  const longNameRes = await workerApp.fetch(
    new Request('https://worker.example/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.21' },
      body: JSON.stringify({ displayName: 'X'.repeat(21) }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(longNameRes.status, 400, 'Display name longer than 20 chars rejected');

  const xssNameRes = await workerApp.fetch(
    new Request('https://worker.example/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.21' },
      body: JSON.stringify({ displayName: '<script>x</script>' }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(xssNameRes.status, 400, 'HTML/script dangerous displayName rejected');

  // 21b. Create Arabic & English profiles with server-issued CSPRNG WA-... IDs (ignoring forged client IDs/stats)
  const createP1Res = await workerApp.fetch(
    new Request('https://worker.example/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.22' },
      body: JSON.stringify({
        displayName: 'المغامر 1',
        playerTag: '4827',
        publicProfileId: 'WA-FORGED00',
        accountId: 'acc_forged',
        stats: { level: 99, enemiesDefeated: 9999 },
        avatar: { kind: 'preset', value: 'ranger' },
        bio: 'Exploring Oakhollow',
        country: 'SA',
        favoriteGameMode: 'adventure',
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(createP1Res.status, 201);
  const p1Data = (await createP1Res.json()) as {
    ok: boolean;
    sessionToken: string;
    profile: {
      publicProfileId: string;
      displayName: string;
      playerTag: string;
      stats: { level: number; enemiesDefeated: number };
      accountId?: string;
      tokenHash?: string;
    };
  };
  assert.equal(p1Data.ok, true);
  assert.match(p1Data.profile.publicProfileId, /^WA-[A-Z0-9]{6,10}$/);
  assert.notEqual(p1Data.profile.publicProfileId, 'WA-FORGED00', 'Client cannot spoof publicProfileId');
  assert.equal(p1Data.profile.stats.level, 1, 'Client cannot spoof initial level');
  assert.equal(p1Data.profile.stats.enemiesDefeated, 0, 'Client cannot spoof initial stats');
  assert.equal('accountId' in p1Data.profile, false, 'Internal accountId never exposed');
  assert.equal('tokenHash' in p1Data.profile, false, 'Internal tokenHash never exposed');

  const createP2Res = await workerApp.fetch(
    new Request('https://worker.example/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.23' },
      body: JSON.stringify({
        displayName: 'Shadow123',
        playerTag: '9001',
        avatar: { kind: 'generated', value: 'Shadow123' },
        favoriteGameMode: 'survival',
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(createP2Res.status, 201);
  const p2Data = (await createP2Res.json()) as {
    ok: boolean;
    sessionToken: string;
    profile: { publicProfileId: string; displayName: string; playerTag: string };
  };
  assert.notEqual(p1Data.profile.publicProfileId, p2Data.profile.publicProfileId);

  // 21c. Immutable field modification rejected + valid update succeeds + invalid avatar rejected
  const tamperIdRes = await workerApp.fetch(
    new Request('https://worker.example/api/profile/update', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${p1Data.sessionToken}`,
        'CF-Connecting-IP': '198.51.100.22',
      },
      body: JSON.stringify({ publicProfileId: 'WA-99999999' }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(tamperIdRes.status, 403, 'Modifying permanent publicProfileId rejected with 403');

  const badAvatarRes = await workerApp.fetch(
    new Request('https://worker.example/api/profile/update', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${p1Data.sessionToken}`,
        'CF-Connecting-IP': '198.51.100.22',
      },
      body: JSON.stringify({
        avatar: { kind: 'uploaded', value: 'data:text/html;base64,PHNjcmlwdD4=' },
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(badAvatarRes.status, 400, 'Non-image custom avatar data URL rejected');

  const updateP2Res = await workerApp.fetch(
    new Request('https://worker.example/api/profile/update', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${p2Data.sessionToken}`,
        'CF-Connecting-IP': '198.51.100.23',
      },
      body: JSON.stringify({
        bio: 'Night scout',
        privacy: { showOnlineStatus: false },
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(updateP2Res.status, 200);

  // Viewer sees P2 as offline when showOnlineStatus is false
  const viewP2Res = await workerApp.fetch(
    new Request(`https://worker.example/api/profile/${p2Data.profile.publicProfileId}`, {
      headers: {
        Authorization: `Bearer ${p1Data.sessionToken}`,
        'CF-Connecting-IP': '198.51.100.22',
      },
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(viewP2Res.status, 200);
  const viewP2Json = (await viewP2Res.json()) as {
    profile: { presenceStatus: string; isOnlineVisible: boolean; bio: string };
  };
  assert.equal(viewP2Json.profile.presenceStatus, 'offline');
  assert.equal(viewP2Json.profile.isOnlineVisible, false);
  assert.equal(viewP2Json.profile.bio, 'Night scout');

  // 21d. Player search by WA-ID, Name#Tag, #Tag, and Display Name
  for (const q of [p2Data.profile.publicProfileId, 'Shadow123#9001', '#9001', 'Shadow']) {
    const searchRes = await workerApp.fetch(
      new Request(`https://worker.example/api/players/search?q=${encodeURIComponent(q)}`, {
        headers: {
          Authorization: `Bearer ${p1Data.sessionToken}`,
          'CF-Connecting-IP': '198.51.100.22',
        },
      }),
      fullEnv as never,
      ctxStub,
    );
    assert.equal(searchRes.status, 200);
    const searchJson = (await searchRes.json()) as {
      results: Array<{ publicProfileId: string }>;
    };
    assert.ok(
      searchJson.results.some((r) => r.publicProfileId === p2Data.profile.publicProfileId),
      `Search query "${q}" finds P2`,
    );
  }

  // 21e. Friend requests lifecycle + privacy gates + direct messages + blocking
  const frRes = await workerApp.fetch(
    new Request('https://worker.example/api/friends/request', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${p1Data.sessionToken}`,
        'CF-Connecting-IP': '198.51.100.22',
      },
      body: JSON.stringify({ targetPublicProfileId: p2Data.profile.publicProfileId }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(frRes.status, 200);
  const frJson = (await frRes.json()) as { ok: boolean; requestId: string };
  assert.equal(frJson.ok, true);

  // Duplicate request rejected with 409
  const dupFrRes = await workerApp.fetch(
    new Request('https://worker.example/api/friends/request', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${p1Data.sessionToken}`,
        'CF-Connecting-IP': '198.51.100.22',
      },
      body: JSON.stringify({ targetPublicProfileId: p2Data.profile.publicProfileId }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(dupFrRes.status, 409);

  // Accept friend request
  const acceptFrRes = await workerApp.fetch(
    new Request('https://worker.example/api/friends/respond', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${p2Data.sessionToken}`,
        'CF-Connecting-IP': '198.51.100.23',
      },
      body: JSON.stringify({ requestId: frJson.requestId, action: 'accept' }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(acceptFrRes.status, 200);

  // Direct message allowed between friends, then verify friends-only & nobody privacy
  const dmRes = await workerApp.fetch(
    new Request('https://worker.example/api/messages/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${p1Data.sessionToken}`,
        'CF-Connecting-IP': '198.51.100.22',
      },
      body: JSON.stringify({
        toPublicProfileId: p2Data.profile.publicProfileId,
        message: 'جاهز للمغامرة؟',
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(dmRes.status, 200);

  const threadRes = await workerApp.fetch(
    new Request(`https://worker.example/api/messages?with=${p1Data.profile.publicProfileId}`, {
      headers: {
        Authorization: `Bearer ${p2Data.sessionToken}`,
        'CF-Connecting-IP': '198.51.100.23',
      },
    }),
    fullEnv as never,
    ctxStub,
  );
  const threadJson = (await threadRes.json()) as {
    messages: Array<{ fromPublicProfileId: string; message: string }>;
  };
  assert.equal(threadJson.messages.length, 1);
  assert.equal(threadJson.messages[0].fromPublicProfileId, p1Data.profile.publicProfileId);

  // Set P2 allowMessages = 'nobody' -> DM blocked
  await workerApp.fetch(
    new Request('https://worker.example/api/profile/update', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${p2Data.sessionToken}`,
        'CF-Connecting-IP': '198.51.100.23',
      },
      body: JSON.stringify({ privacy: { allowMessages: 'nobody', allowGameInvites: false } }),
    }),
    fullEnv as never,
    ctxStub,
  );
  await new Promise((r) => setTimeout(r, 1250));
  const blockedDmRes = await workerApp.fetch(
    new Request('https://worker.example/api/messages/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${p1Data.sessionToken}`,
        'CF-Connecting-IP': '198.51.100.22',
      },
      body: JSON.stringify({
        toPublicProfileId: p2Data.profile.publicProfileId,
        message: 'Should be blocked by privacy',
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(blockedDmRes.status, 403, 'allowMessages: nobody blocks DMs');

  // 21f. Verified profile identity stamped onto room roster & chat (anti-spoofing) + invite privacy check
  const p1CreateRoomRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/rooms', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${p1Data.sessionToken}`,
        'CF-Connecting-IP': '198.51.100.22',
      },
      body: JSON.stringify({
        roomName: 'Identity Verified Room',
        playerName: 'SpoofedClientName',
        publicProfileId: 'WA-FAKE9999',
        worldType: 'normal',
        maxPlayers: 4,
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(p1CreateRoomRes.status, 200);
  const p1RoomData = (await p1CreateRoomRes.json()) as {
    playerId: string;
    sessionToken: string;
    room: {
      roomId: string;
      roomCode: string;
      players: Array<{
        playerId: string;
        displayName: string;
        publicProfileId?: string;
        playerTag?: string;
        avatar?: { kind: string; value?: string };
      }>;
    };
  };
  assert.equal(p1RoomData.room.players[0].displayName, 'المغامر 1', 'Server stamps verified profile displayName');
  assert.equal(p1RoomData.room.players[0].publicProfileId, p1Data.profile.publicProfileId);
  assert.equal(p1RoomData.room.players[0].playerTag, '4827');
  assert.equal(p1RoomData.room.players[0].avatar?.value, 'ranger');

  // Invite to P2 blocked when allowGameInvites is false
  const blockedInviteRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/invites', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'CF-Connecting-IP': '198.51.100.22',
      },
      body: JSON.stringify({
        roomId: p1RoomData.room.roomId,
        fromPlayerId: p1RoomData.playerId,
        sessionToken: p1RoomData.sessionToken,
        toPublicProfileId: p2Data.profile.publicProfileId,
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(blockedInviteRes.status, 403, 'allowGameInvites: false blocks room invite');

  // 21g. Confidential profile report + blocking cleans friendship
  const profReportRes = await workerApp.fetch(
    new Request('https://worker.example/api/reports', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${p1Data.sessionToken}`,
        'CF-Connecting-IP': '198.51.100.22',
      },
      body: JSON.stringify({
        targetPublicProfileId: p2Data.profile.publicProfileId,
        reason: 'inappropriate_profile',
        details: 'Testing moderation report.',
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(profReportRes.status, 200);
  const profReportJson = (await profReportRes.json()) as Record<string, unknown>;
  assert.equal(profReportJson.ok, true);
  assert.equal('reporterAccountId' in profReportJson, false);

  const blockP2Res = await workerApp.fetch(
    new Request('https://worker.example/api/blocks', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${p1Data.sessionToken}`,
        'CF-Connecting-IP': '198.51.100.22',
      },
      body: JSON.stringify({ targetPublicProfileId: p2Data.profile.publicProfileId }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(blockP2Res.status, 200);

  // Blocked user can no longer send friend request or DM
  const blockedFrRes = await workerApp.fetch(
    new Request('https://worker.example/api/friends/request', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${p2Data.sessionToken}`,
        'CF-Connecting-IP': '198.51.100.23',
      },
      body: JSON.stringify({ targetPublicProfileId: p1Data.profile.publicProfileId }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(blockedFrRes.status, 403, 'Blocked user cannot send friend request');

  // 21h. Server stats accumulation & level/XP computation
  const statsRes = await workerApp.fetch(
    new Request('https://worker.example/api/profile/stats', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${p1Data.sessionToken}`,
        'CF-Connecting-IP': '198.51.100.22',
      },
      body: JSON.stringify({
        playTimeSeconds: 180,
        worldsCreated: 1,
        enemiesDefeated: 4,
        xpGained: 250,
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(statsRes.status, 200);
  const statsJson = (await statsRes.json()) as {
    profile: { stats: { level: number; playTimeSeconds: number; worldsCreated: number; enemiesDefeated: number } };
  };
  assert.equal(statsJson.profile.stats.playTimeSeconds, 180);
  // 1 from creating the verified room in 21f + 1 from stats delta
  assert.equal(statsJson.profile.stats.worldsCreated, 2);
  assert.equal(statsJson.profile.stats.enemiesDefeated, 4);
  assert.ok(statsJson.profile.stats.level >= 2, 'XP gain advances player level');

  // 22. Multiplayer config URL normalization (https, wss, http, ws, missing) & Worker /health + CORS
  assert.equal(
    normalizeMultiplayerBaseUrl('https://example.workers.dev/'),
    'https://example.workers.dev',
  );
  assert.equal(
    normalizeMultiplayerBaseUrl('wss://example.workers.dev/'),
    'https://example.workers.dev',
  );
  assert.equal(
    normalizeMultiplayerBaseUrl('http://localhost:8787/'),
    'http://localhost:8787',
  );
  assert.equal(
    normalizeMultiplayerBaseUrl('ws://localhost:8787/'),
    'http://localhost:8787',
  );
  assert.equal(
    toWebSocketUrl('https://example.workers.dev', '/api/multiplayer/ws?roomId=r1'),
    'wss://example.workers.dev/api/multiplayer/ws?roomId=r1',
  );
  assert.equal(
    toWebSocketUrl('http://localhost:8787', '/api/multiplayer/ws?roomId=r1'),
    'ws://localhost:8787/api/multiplayer/ws?roomId=r1',
  );

  const httpsCfg = buildMultiplayerConfig('https://example.workers.dev/', 'production', 'https://user.github.io');
  assert.equal(httpsCfg.configured, true);
  assert.equal(httpsCfg.baseUrl, 'https://example.workers.dev');
  assert.equal(httpsCfg.webSocketUrl, 'wss://example.workers.dev');

  const wssCfg = buildMultiplayerConfig('wss://example.workers.dev', 'production', null);
  assert.equal(wssCfg.configured, true);
  assert.equal(wssCfg.baseUrl, 'https://example.workers.dev');
  assert.equal(wssCfg.webSocketUrl, 'wss://example.workers.dev');

  const missingCfg = buildMultiplayerConfig('', 'development', null);
  assert.equal(missingCfg.configured, false);
  assert.equal(missingCfg.baseUrl, null);
  assert.equal(missingCfg.webSocketUrl, null);

  const diag = getMultiplayerConfig();
  assert.equal(typeof diag.configured, 'boolean');
  assert.ok(!('apiToken' in diag));

  const formattedDiag = formatMultiplayerDiagnosticReport(httpsCfg);
  assert.ok(formattedDiag.includes('Multiplayer configured: true'));
  assert.ok(formattedDiag.includes('Multiplayer URL: https://example.workers.dev'));
  assert.ok(formattedDiag.includes('WebSocket URL: wss://example.workers.dev'));
  assert.ok(formattedDiag.includes('Environment: production'));
  assert.ok(!formattedDiag.includes('CLOUDFLARE_API_TOKEN'));

  // Subpath GitHub Pages share link avoids 404 /join/<id> and resolves via ?join=<id>
  const ghShareLink = buildRoomShareLink(
    'rm_12345678',
    'https://abdelhaqelhafidy41-ops.github.io/Finel-world-of-adventure/',
  );
  assert.equal(
    ghShareLink,
    'https://abdelhaqelhafidy41-ops.github.io/Finel-world-of-adventure/?join=rm_12345678',
  );
  assert.equal(extractJoinTargetFromUrl(ghShareLink), 'rm_12345678');

  const rootShareLink = buildRoomShareLink('rm_12345678', 'https://play.example.com');
  assert.equal(rootShareLink, 'https://play.example.com/join/rm_12345678');
  assert.equal(extractJoinTargetFromUrl(rootShareLink), 'rm_12345678');

  const healthCorsRes = await workerApp.fetch(
    new Request('https://worker.example/health', {
      method: 'GET',
      headers: { Origin: 'https://abdelhaqelhafidy41-ops.github.io' },
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(healthCorsRes.status, 200);
  const healthCorsJson = (await healthCorsRes.json()) as { ok?: boolean; service?: string };
  assert.equal(healthCorsJson.ok, true);
  assert.equal(healthCorsJson.service, 'world-of-adventure-multiplayer');
  assert.equal(
    healthCorsRes.headers.get('Access-Control-Allow-Origin'),
    'https://abdelhaqelhafidy41-ops.github.io',
  );

  const preflightCorsRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/rooms', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://abdelhaq-elhafidy.github.io',
        'Access-Control-Request-Method': 'POST',
      },
    }),
    { ...fullEnv, ALLOWED_ORIGINS: 'https://*.github.io,http://localhost:3000' } as never,
    ctxStub,
  );
  assert.equal(preflightCorsRes.status, 204);
  assert.equal(
    preflightCorsRes.headers.get('Access-Control-Allow-Origin'),
    'https://abdelhaq-elhafidy.github.io',
  );
  assert.ok(
    (preflightCorsRes.headers.get('Access-Control-Allow-Methods') ?? '').includes('POST'),
  );

  // 23. Independent coins/XP/level, chest progression, REPAIR_WEAPONS, forged progression rejection & chat HTML sanitization
  const tamperedCreateRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.31' },
      body: JSON.stringify({
        playerName: 'ProgHost',
        roomName: 'Persistence Valley',
        worldType: 'adventure',
        visibility: 'public',
        coins: 999999999,
        xp: 999999,
        level: 99,
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(tamperedCreateRes.status, 403, 'Forged coins/xp/level on room create rejected');

  const advCreateRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.31' },
      body: JSON.stringify({
        playerName: 'ProgHost',
        roomName: 'Persistence Valley',
        worldType: 'adventure',
        visibility: 'public',
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(advCreateRes.status, 200);
  const advCreateJson = (await advCreateRes.json()) as {
    room: {
      roomId: string;
      roomCode: string;
      hostId: string;
      gameState: { worldSettingsPermission: string };
    };
    playerId: string;
    sessionToken: string;
  };
  assert.equal(advCreateJson.room.gameState.worldSettingsPermission, 'HOST_ONLY');

  const tamperedJoinRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/rooms/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.32' },
      body: JSON.stringify({
        roomCodeOrId: advCreateJson.room.roomId,
        playerName: 'ProgGuest',
        coins: 88888,
        xp: 88888,
        level: 88,
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(tamperedJoinRes.status, 403, 'Forged coins/xp/level on room join rejected');

  const advJoinRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/rooms/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.32' },
      body: JSON.stringify({
        roomCodeOrId: advCreateJson.room.roomId,
        playerName: 'ProgGuest',
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(advJoinRes.status, 200);
  const advJoinJson = (await advJoinRes.json()) as {
    playerId: string;
    sessionToken: string;
  };

  const pHostWsRes = (await workerApp.fetch(
    new Request(
      `https://worker.example/api/multiplayer/ws?roomId=${advCreateJson.room.roomId}&playerId=${advCreateJson.playerId}&token=${advCreateJson.sessionToken}`,
      { headers: { Upgrade: 'websocket', Origin: 'https://abdelhaqelhafidy41-ops.github.io' } },
    ),
    fullEnv as never,
    ctxStub,
  )) as unknown as { status: number; webSocket: MockWebSocket };
  const pGuestWsRes = (await workerApp.fetch(
    new Request(
      `https://worker.example/api/multiplayer/ws?roomId=${advCreateJson.room.roomId}&playerId=${advJoinJson.playerId}&token=${advJoinJson.sessionToken}`,
      { headers: { Upgrade: 'websocket', Origin: 'https://abdelhaqelhafidy41-ops.github.io' } },
    ),
    fullEnv as never,
    ctxStub,
  )) as unknown as { status: number; webSocket: MockWebSocket };
  assert.equal(pHostWsRes.status, 101);
  assert.equal(pGuestWsRes.status, 101);

  const sendAdv = (ws: MockWebSocket, pid: string, type: string, payload?: unknown) => {
    ws.send(
      JSON.stringify({
        v: 1,
        type,
        roomId: advCreateJson.room.roomId,
        playerId: pid,
        timestamp: Date.now(),
        payload,
      }),
    );
  };

  const pHostWs = pHostWsRes.webSocket;
  const pGuestWs = pGuestWsRes.webSocket;
  const pHostMsgs = collectMessages(pHostWs);
  const pGuestMsgs = collectMessages(pGuestWs);
  await flush();

  sendAdv(pGuestWs, advJoinJson.playerId, 'READY', { ready: true });
  await flush();
  sendAdv(pHostWs, advCreateJson.playerId, 'START_GAME');
  await flush();

  const hostInitSnap = pHostMsgs.find((m) => m.type === 'WORLD_SNAPSHOT')?.payload as {
    coins: number;
    xp: number;
    level: number;
  };
  const guestInitSnap = pGuestMsgs.find((m) => m.type === 'WORLD_SNAPSHOT')?.payload as {
    coins: number;
    xp: number;
    level: number;
  };
  assert.ok(hostInitSnap && guestInitSnap, 'Host and guest receive WORLD_SNAPSHOT on START_GAME');
  assert.equal(hostInitSnap.coins, 50, 'Adventure room grants 50 starter coins, ignoring forged coins');
  assert.equal(hostInitSnap.xp, 0);
  assert.equal(hostInitSnap.level, 1);
  assert.equal(guestInitSnap.coins, 50);

  // Chat sanitization strips HTML/script payloads on active room WebSocket
  pGuestMsgs.length = 0;
  sendAdv(pHostWs, advCreateJson.playerId, 'ROOM_CHAT', {
    message: '<script>alert(1)</script><img src=x onerror=alert(2)>Hello Safely!',
  });
  await flush();
  const sanitizedChat = pGuestMsgs.find((m) => m.type === 'ROOM_CHAT');
  assert.ok(sanitizedChat, 'Sanitized chat message relayed');
  assert.ok(
    !String(sanitizedChat!.payload?.message).includes('<') &&
      !String(sanitizedChat!.payload?.message).includes('>'),
    'HTML angle brackets removed from relayed chat',
  );
  assert.ok(String(sanitizedChat!.payload?.message).includes('Hello Safely!'));

  // Host opens chest -> host receives PROGRESSION_UPDATED (+15 xp, +12 coins), guest remains at 50 coins
  pHostMsgs.length = 0;
  pGuestMsgs.length = 0;
  sendAdv(pHostWs, advCreateJson.playerId, 'GAME_EVENT', {
    event: 'CHEST_OPENED',
    data: { chestId: 'prog-chest-1', x: 0, y: 0, z: 4 },
  });
  await flush();
  const hostProg = pHostMsgs.find((m) => m.type === 'PROGRESSION_UPDATED')?.payload as {
    playerId: string;
    coins: number;
    xp: number;
  };
  assert.ok(hostProg && hostProg.playerId === advCreateJson.playerId);
  assert.equal(hostProg.coins, 62);
  assert.equal(hostProg.xp, 15);
  assert.ok(!pGuestMsgs.some((m) => m.type === 'PROGRESSION_UPDATED'), 'Guest coins/XP unaffected by host chest');

  // Host repairs weapons (-20 coins -> 42 coins) & overspending fails with INSUFFICIENT_COINS
  pHostMsgs.length = 0;
  sendAdv(pHostWs, advCreateJson.playerId, 'REPAIR_WEAPONS', { costCoins: 20 });
  await flush();
  const afterRepair = pHostMsgs.find((m) => m.type === 'PROGRESSION_UPDATED')?.payload as {
    coins: number;
  };
  assert.equal(afterRepair.coins, 42);
  pHostMsgs.length = 0;
  sendAdv(pHostWs, advCreateJson.playerId, 'REPAIR_WEAPONS', { costCoins: 500 });
  await flush();
  assert.ok(
    pHostMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'INSUFFICIENT_COINS'),
    'Overspending REPAIR_WEAPONS rejected with INSUFFICIENT_COINS',
  );

  // Guest opens a separate chest -> guest receives independent PROGRESSION_UPDATED, host remains unaffected
  pHostMsgs.length = 0;
  pGuestMsgs.length = 0;
  sendAdv(pGuestWs, advJoinJson.playerId, 'GAME_EVENT', {
    event: 'CHEST_OPENED',
    data: { chestId: 'prog-chest-2', x: 2, y: 0, z: 4 },
  });
  await flush();
  const guestProg = pGuestMsgs.find((m) => m.type === 'PROGRESSION_UPDATED')?.payload as {
    playerId: string;
    coins: number;
    xp: number;
  };
  assert.ok(guestProg && guestProg.playerId === advJoinJson.playerId);
  assert.equal(guestProg.coins, 62);
  assert.equal(guestProg.xp, 15);
  assert.ok(!pHostMsgs.some((m) => m.type === 'PROGRESSION_UPDATED'), 'Host coins/XP unaffected by guest chest');

  // 25. Host-simulated ENEMY_ATTACK_PLAYER hits remote player; non-host rejected
  pGuestMsgs.length = 0;
  sendAdv(pGuestWs, advJoinJson.playerId, 'ENEMY_ATTACK_PLAYER', {
    targetPlayerId: advCreateJson.playerId,
    sourceKind: 'enemy',
    sourceId: 'bandit_1',
    damage: 15,
  });
  await flush();
  assert.ok(
    pGuestMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'FORBIDDEN_HOST_ONLY'),
    'Non-host cannot emit ENEMY_ATTACK_PLAYER',
  );

  pHostMsgs.length = 0;
  pGuestMsgs.length = 0;
  sendAdv(pHostWs, advCreateJson.playerId, 'ENEMY_ATTACK_PLAYER', {
    targetPlayerId: advJoinJson.playerId,
    sourceKind: 'enemy',
    sourceId: 'bandit_1',
    archetype: 'bandit_scout',
    damage: 25,
    x: 0,
    z: 4,
  });
  await flush();
  const guestVitalsHit = pGuestMsgs.find((m) => m.type === 'PLAYER_VITALS')?.payload as {
    playerId: string;
    health: number;
    maxHealth: number;
  };
  assert.ok(guestVitalsHit && guestVitalsHit.playerId === advJoinJson.playerId);
  assert.ok(guestVitalsHit.health < guestVitalsHit.maxHealth, 'Host enemy attack reduces remote player health');

  // 26. Authoritative World Time, Weather (<=900s cap), & Permissions (HOST_ONLY vs ALL_PLAYERS)
  pGuestMsgs.length = 0;
  sendAdv(pGuestWs, advJoinJson.playerId, 'WORLD_SETTINGS_UPDATE', { preset: 'sunset' });
  await flush();
  assert.ok(
    pGuestMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'FORBIDDEN_WORLD_SETTINGS'),
    'Guest cannot change time/weather when worldSettingsPermission is HOST_ONLY',
  );

  pGuestMsgs.length = 0;
  sendAdv(pHostWs, advCreateJson.playerId, 'WORLD_SETTINGS_UPDATE', {
    worldSettingsPermission: 'ALL_PLAYERS',
    weatherState: 'storm',
    targetWeatherState: 'storm',
    durationMs: 2_000_000,
  });
  await flush();
  const settingsEv = pGuestMsgs.find((m) => m.type === 'WORLD_SETTINGS_UPDATED')?.payload as {
    worldSettingsPermission: string;
    worldWeather: { currentState: string; durationMs: number };
  };
  assert.ok(settingsEv, 'Guest receives authoritative WORLD_SETTINGS_UPDATED');
  assert.equal(settingsEv.worldSettingsPermission, 'ALL_PLAYERS');
  assert.equal(settingsEv.worldWeather.currentState, 'storm');
  assert.ok(settingsEv.worldWeather.durationMs <= 900_000, 'Weather duration clamped to <= 900,000ms (15 min)');

  pHostMsgs.length = 0;
  sendAdv(pGuestWs, advJoinJson.playerId, 'WORLD_SETTINGS_UPDATE', { preset: 'midnight' });
  await flush();
  const timeChanged = pHostMsgs.find((m) => m.type === 'WORLD_TIME_CHANGED')?.payload as {
    worldTime: { worldHours: number };
  };
  assert.ok(timeChanged, 'Guest can change world time when ALL_PLAYERS permission is enabled');
  assert.equal(timeChanged.worldTime.worldHours, 0);

  // 27. 0-player room persistence in directory, host promotion on rejoin, and explicit CLOSE_ROOM cleanup
  sendAdv(pGuestWs, advJoinJson.playerId, 'LEAVE_ROOM');
  await flush();
  sendAdv(pHostWs, advCreateJson.playerId, 'LEAVE_ROOM');
  await flush();

  const listPersistedRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/rooms', {
      headers: { 'CF-Connecting-IP': '198.51.100.33' },
    }),
    fullEnv as never,
    ctxStub,
  );
  const listPersistedJson = (await listPersistedRes.json()) as {
    rooms: Array<{ roomId: string; playerCount: number; status: string }>;
  };
  const persistedEntry = listPersistedJson.rooms.find((r) => r.roomId === advCreateJson.room.roomId);
  assert.ok(persistedEntry, '0-player public room stays listed in RoomDirectoryDO');
  assert.equal(persistedEntry!.playerCount, 0);
  assert.equal(persistedEntry!.status, 'waiting');

  const rejoinEmptyRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/rooms/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.34' },
      body: JSON.stringify({
        roomCodeOrId: advCreateJson.room.roomId,
        playerName: 'NewHostPlayer',
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(rejoinEmptyRes.status, 200);
  const rejoinEmptyJson = (await rejoinEmptyRes.json()) as {
    playerId: string;
    sessionToken: string;
    room: { hostId: string; players: Array<{ id: string; isHost: boolean }> };
  };
  assert.equal(
    rejoinEmptyJson.room.hostId,
    rejoinEmptyJson.playerId,
    'Joining a 0-player persisted room promotes the joiner to host',
  );

  // 28. 72-hour expiration keeps room alive at 71h and expires at 73h
  const nowCheck = Date.now();
  const stillAliveRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/rooms/expire-sweep', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.35' },
      body: JSON.stringify({ roomId: advCreateJson.room.roomId, nowMs: nowCheck + 71 * 60 * 60 * 1000 }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(stillAliveRes.status, 200);
  const verifyStillAlive = await workerApp.fetch(
    new Request(`https://worker.example/api/multiplayer/rooms/verify?codeOrId=${advCreateJson.room.roomId}`, {
      headers: { 'CF-Connecting-IP': '198.51.100.35' },
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(verifyStillAlive.status, 200, 'Room still active prior to 72 hours');

  const expiredSweepRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/rooms/expire-sweep', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.35' },
      body: JSON.stringify({ roomId: advCreateJson.room.roomId, nowMs: nowCheck + 73 * 60 * 60 * 1000 }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(expiredSweepRes.status, 200);
  const verifyExpiredRes = await workerApp.fetch(
    new Request(`https://worker.example/api/multiplayer/rooms/verify?codeOrId=${advCreateJson.room.roomId}`, {
      headers: { 'CF-Connecting-IP': '198.51.100.35' },
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(verifyExpiredRes.status, 410, 'Room expired after >72 hours returns 410');
  const verifyExpiredJson = (await verifyExpiredRes.json()) as { error?: string; code?: string };
  assert.equal(verifyExpiredJson.error ?? verifyExpiredJson.code, 'ROOM_EXPIRED');

  const listAfterExpire = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/rooms', {
      headers: { 'CF-Connecting-IP': '198.51.100.35' },
    }),
    fullEnv as never,
    ctxStub,
  );
  const listAfterExpireJson = (await listAfterExpire.json()) as {
    rooms: Array<{ roomId: string }>;
  };
  assert.ok(
    !listAfterExpireJson.rooms.some((r) => r.roomId === advCreateJson.room.roomId),
    'Expired room removed from RoomDirectoryDO listing',
  );

  // =========================================================================
  // 29. FULL PERSISTENCE LIFECYCLE: SEPARATED LAYERS, COLD DO RESTART,
  //     GUEST & HOST RESUME-TOKEN RESTORE, SHARED WORLD & CLOCK PAUSE/RESUME
  // =========================================================================
  const persistState = createMockState();
  const persistEnv = createMockEnv();
  let persistRoomDO = new MultiplayerRoomDO(persistState as never, persistEnv as never);
  const persistRoomId = 'room_persist_test';
  const sendPersist = (ws: MockWebSocket, pid: string, type: string, payload?: unknown) => {
    ws.send(
      JSON.stringify({
        v: 1,
        type,
        roomId: persistRoomId,
        playerId: pid,
        timestamp: Date.now(),
        payload,
      }),
    );
  };

  const pCreateRes = await persistRoomDO.fetch(
    new Request('https://internal/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        roomId: persistRoomId,
        roomCode: 'PRS777',
        roomName: 'Persistent Realm',
        hostName: 'Founder',
        worldName: 'Persistent Valley',
        worldType: 'survival',
        difficulty: 'hard',
        maxPlayers: 4,
        privacy: 'public',
        seed: 98765,
      }),
    }),
  );
  assert.equal(pCreateRes.status, 200);
  const pCreateJson = (await pCreateRes.json()) as {
    playerId: string;
    sessionToken: string;
    resumeToken?: string;
    room: { roomId: string; roomCode: string; gameState: { seed: number } };
  };
  assert.ok(pCreateJson.resumeToken, 'Room init returns resumeToken for persistent player restore');
  assert.equal(pCreateJson.room.gameState.seed, 98765);

  const pJoinRes = await persistRoomDO.fetch(
    new Request('https://internal/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        playerName: 'RangerAlly',
      }),
    }),
  );
  assert.equal(pJoinRes.status, 200);
  const pJoinJson = (await pJoinRes.json()) as {
    playerId: string;
    sessionToken: string;
    resumeToken?: string;
  };
  assert.ok(pJoinJson.resumeToken, 'Room join returns resumeToken for guest restore');

  const pHostWsResPersist = (await persistRoomDO.fetch(
    new Request(
      `https://internal/ws?playerId=${pCreateJson.playerId}&token=${pCreateJson.sessionToken}`,
      { headers: { Upgrade: 'websocket' } },
    ),
  )) as unknown as { status: number; webSocket: MockWebSocket };
  const pHostWsPersist = pHostWsResPersist.webSocket;
  const pHostMsgsPersist = collectMessages(pHostWsPersist);

  const pGuestWsResPersist = (await persistRoomDO.fetch(
    new Request(
      `https://internal/ws?playerId=${pJoinJson.playerId}&token=${pJoinJson.sessionToken}`,
      { headers: { Upgrade: 'websocket' } },
    ),
  )) as unknown as { status: number; webSocket: MockWebSocket };
  const pGuestWsPersist = pGuestWsResPersist.webSocket;
  const pGuestMsgsPersist = collectMessages(pGuestWsPersist);
  await flush();

  sendPersist(pGuestWsPersist, pJoinJson.playerId, 'READY', { ready: true });
  await flush();
  sendPersist(pHostWsPersist, pCreateJson.playerId, 'START_GAME');
  await flush();

  // Mutate time, weather, entities, shared world objects, resources, and distinct per-player state
  sendPersist(pHostWsPersist, pCreateJson.playerId, 'WORLD_SETTINGS_UPDATE', {
    worldHours: 19.25,
    dayCount: 4,
    weatherState: 'rain',
    targetWeatherState: 'rain',
    weatherIntensity: 0.85,
    durationMs: 420_000,
    worldSettingsPermission: 'ALL_PLAYERS',
  });
  await flush();

  sendPersist(pHostWsPersist, pCreateJson.playerId, 'PLAYER_STATE', {
    x: 44.5,
    y: 2.0,
    z: -19.75,
    yaw: 1.25,
    weaponId: 'ranger-sword',
  });
  sendPersist(pGuestWsPersist, pJoinJson.playerId, 'PLAYER_STATE', {
    x: -63.25,
    y: 3.5,
    z: 28.5,
    yaw: -0.9,
    weaponId: 'hunter-bow',
  });
  await flush();

  sendPersist(pHostWsPersist, pCreateJson.playerId, 'ENTITY_SYNC', {
    entities: [
      {
        id: 'enemy-persist-1',
        kind: 'enemy',
        archetype: 'bandit_scout',
        x: 52.5,
        y: 1.5,
        z: -14.0,
        yaw: 0.7,
        state: 'chase',
        hp: 30,
        maxHp: 65,
        isDead: false,
      },
      {
        id: 'npc-elder-1',
        kind: 'npc',
        archetype: 'elder',
        x: 11.2,
        y: 0.5,
        z: 9.4,
        yaw: 2.1,
        state: 'walking',
        hp: 100,
        maxHp: 100,
        isDead: false,
      },
      {
        id: 'deer-persist-1',
        kind: 'animal',
        archetype: 'deer',
        x: -22.0,
        y: 1.0,
        z: 18.0,
        yaw: -1.1,
        state: 'flee',
        hp: 0,
        maxHp: 55,
        isDead: true,
      },
    ],
  });
  await flush();

  // Concurrent updates from Host and Guest to test save safety & resource stack persistence
  sendPersist(pHostWsPersist, pCreateJson.playerId, 'GAME_EVENT', {
    event: 'CHEST_OPENED',
    data: { chestId: 'chest-persist-1', lootItems: 'iron-sword', hasArrows: true, arrowCount: 6 },
  });
  sendPersist(pGuestWsPersist, pJoinJson.playerId, 'GAME_EVENT', {
    event: 'DOOR_OPENED',
    data: { doorId: 'door-persist-1' },
  });
  sendPersist(pHostWsPersist, pCreateJson.playerId, 'GAME_EVENT', {
    event: 'BED_PLACED',
    data: { bedId: 'bed-persist-1', x: 45.0, y: 2.0, z: -18.0, yaw: 0.5 },
  });
  sendPersist(pGuestWsPersist, pJoinJson.playerId, 'GAME_EVENT', {
    event: 'ITEM_PICKED_UP',
    data: { pickupId: 'apple-seed-persist-1', itemId: 'apple', count: 3, x: -62.0, y: 3.5, z: 29.0 },
  });
  await flush();
  sendPersist(pGuestWsPersist, pJoinJson.playerId, 'GAME_EVENT', {
    event: 'ITEM_DROPPED',
    data: { dropId: 'drop-persist-1', itemId: 'apple', count: 3, label: 'Apple', x: -62.0, y: 3.5, z: 29.0 },
  });
  sendPersist(pHostWsPersist, pCreateJson.playerId, 'GAME_EVENT', {
    event: 'CONTAINER_UPDATED',
    data: { containerId: 'crate-persist-1', isOpen: true },
  });
  sendPersist(pGuestWsPersist, pJoinJson.playerId, 'GAME_EVENT', {
    event: 'BUILDING_UPDATED',
    data: { buildingId: 'watchtower-1', kind: 'tower', state: 'repaired', health: 250 },
  });
  sendPersist(pHostWsPersist, pCreateJson.playerId, 'GAME_EVENT', {
    event: 'QUEST_OBJECT_UPDATED',
    data: { objectId: 'shrine-orb-1', questId: 'quest-forest', state: 'activated' },
  });
  sendPersist(pGuestWsPersist, pJoinJson.playerId, 'GAME_EVENT', {
    event: 'QUEST_UPDATED',
    data: { questId: 'quest-guest-only', status: 'active', stepIndex: 2 },
  });
  sendPersist(pHostWsPersist, pCreateJson.playerId, 'GAME_EVENT', {
    event: 'PLAYER_COLLECTED_RESOURCE',
    data: { nodeId: 'tree-persist-1', itemId: 'wood', count: 2, maxUses: 2, x: 44.5, y: 2.0, z: -19.75 },
  });
  sendPersist(pGuestWsPersist, pJoinJson.playerId, 'GAME_EVENT', {
    event: 'PLAYER_COLLECTED_RESOURCE',
    data: { nodeId: 'rock-persist-1', itemId: 'stone', count: 3, maxUses: 1, x: -63.25, y: 3.5, z: 28.5 },
  });
  await new Promise((r) => setTimeout(r, 240));
  sendPersist(pHostWsPersist, pCreateJson.playerId, 'GAME_EVENT', {
    event: 'PLAYER_COLLECTED_RESOURCE',
    data: { nodeId: 'tree-persist-1', itemId: 'wood', count: 2, maxUses: 2, x: 44.5, y: 2.0, z: -19.75 },
  });
  sendPersist(pGuestWsPersist, pJoinJson.playerId, 'GAME_EVENT', {
    event: 'ITEM_PICKED_UP',
    data: { pickupId: 'herb-persist-1', itemId: 'meadow-herb', count: 1, x: -63.25, y: 3.5, z: 28.5 },
  });
  await flush();

  // Host leaves while Guest remains -> verify automatic host migration while in-game
  sendPersist(pHostWsPersist, pCreateJson.playerId, 'LEAVE_ROOM');
  await flush();
  assert.ok(
    pGuestMsgsPersist.some(
      (m) => m.type === 'HOST_TRANSFERRED' && m.payload?.newHostId === pJoinJson.playerId,
    ),
    'Remaining guest is promoted to host when original host disconnects/leaves',
  );

  // Guest leaves so room hits 0 players and pauses clock/weather
  sendPersist(pGuestWsPersist, pJoinJson.playerId, 'LEAVE_ROOM');
  await flush();

  // Verify separated storage keys exist and clock is paused
  const pRoomMetaAfterLeave = await persistState.storage.get<{
    knownPlayerKeys: string[];
    hasEnteredWorld: boolean;
  }>('room_meta_v2');
  assert.ok(pRoomMetaAfterLeave?.hasEnteredWorld);
  assert.equal(pRoomMetaAfterLeave?.knownPlayerKeys.length, 2);

  const pWorldAfterLeave = await persistState.storage.get<{
    worldSeed: number;
    emptyPausedAtMs: number | null;
    pausedWeatherRemainingMs: number | null;
    resourceStates: Record<string, { usesRemaining: number }>;
  }>('world_state_v2');
  assert.equal(pWorldAfterLeave?.worldSeed, 98765);
  assert.ok(
    pWorldAfterLeave?.emptyPausedAtMs !== null,
    'World clock/weather pauses when 0 players remain in persistent room',
  );
  assert.equal(pWorldAfterLeave?.resourceStates['tree-persist-1']?.usesRemaining, 0);
  assert.equal(pWorldAfterLeave?.resourceStates['rock-persist-1']?.usesRemaining, 0);

  for (const pk of pRoomMetaAfterLeave!.knownPlayerKeys) {
    assert.ok(
      await persistState.storage.get(`player_data_v2:${pk}`),
      `Player data saved in dedicated player_data_v2 layer (${pk})`,
    );
  }

  // Simulate full Durable Object cold restart from storage only
  persistRoomDO = new MultiplayerRoomDO(persistState as never, persistEnv as never);

  // Guest rejoins FIRST using resumeToken — should restore playerId, become host, & enter world immediately
  const pGuestRejoinRes = await persistRoomDO.fetch(
    new Request('https://internal/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        playerName: 'RangerAlly',
        resumeToken: pJoinJson.resumeToken,
      }),
    }),
  );
  assert.equal(pGuestRejoinRes.status, 200);
  const pGuestRejoinJson = (await pGuestRejoinRes.json()) as {
    playerId: string;
    sessionToken: string;
    room: { hostId: string; status: string; gameState: { seed: number } };
  };
  assert.equal(
    pGuestRejoinJson.playerId,
    pJoinJson.playerId,
    'Joining with resumeToken restores original persistent playerId',
  );
  assert.equal(
    pGuestRejoinJson.room.hostId,
    pJoinJson.playerId,
    'First returning player in 0-player room is promoted to host',
  );
  assert.equal(
    pGuestRejoinJson.room.status,
    'in-game',
    'Previously entered persistent room restores status in-game',
  );
  assert.equal(pGuestRejoinJson.room.gameState.seed, 98765);

  const pGuestRejoinWsRes = (await persistRoomDO.fetch(
    new Request(
      `https://internal/ws?playerId=${pGuestRejoinJson.playerId}&token=${pGuestRejoinJson.sessionToken}`,
      { headers: { Upgrade: 'websocket' } },
    ),
  )) as unknown as { status: number; webSocket: MockWebSocket };
  const pGuestRejoinWs = pGuestRejoinWsRes.webSocket;
  const pGuestRejoinMsgs = collectMessages(pGuestRejoinWs);
  await flush();

  assert.ok(
    pGuestRejoinMsgs.some((m) => m.type === 'START_GAME'),
    'Returning player into persistent in-game world receives START_GAME immediately',
  );
  const pGuestSnap = pGuestRejoinMsgs.find((m) => m.type === 'WORLD_SNAPSHOT')?.payload as {
    dayCount?: number;
    worldTime?: { dayCount: number; worldHours: number };
    worldWeather?: { currentState: string; intensity: number; durationMs: number };
    worldSettings?: { worldType: string; difficulty: string };
    openedChests: string[];
    collectedPickups: string[];
    depletedResources: Array<{ id: string; usesRemaining: number }>;
    doors: Array<{ id: string; isOpen: boolean }>;
    placedBeds: Array<{ id: string }>;
    droppedItems: Array<{ id: string }>;
    containers?: Array<{ id: string; isOpen: boolean }>;
    buildingStates?: Array<{ id: string; state: string }>;
    questObjects?: Array<{ id: string; questId: string; state: string }>;
    quests: Array<{ questId: string; stepIndex: number }>;
    entityStates?: Array<{ id: string; kind: string; x: number; hp: number; isDead: boolean }>;
    playerPosition?: { x: number; y: number; z: number; yaw: number };
    itemCounts?: Record<string, number>;
    xp?: number;
  };
  assert.ok(pGuestSnap, 'Returning player receives full WORLD_SNAPSHOT after DO restart');
  assert.equal(pGuestSnap.dayCount, 4);
  assert.ok(Math.abs((pGuestSnap.worldTime?.worldHours ?? 0) - 19.25) < 0.05);
  assert.equal(pGuestSnap.worldWeather?.currentState, 'rain');
  assert.equal(pGuestSnap.worldWeather?.intensity, 0.85);
  assert.equal(pGuestSnap.worldWeather?.durationMs, 420_000);
  assert.equal(pGuestSnap.worldSettings?.worldType, 'survival');
  assert.equal(pGuestSnap.worldSettings?.difficulty, 'hard');
  assert.ok(pGuestSnap.openedChests.includes('chest-persist-1'));
  assert.ok(pGuestSnap.collectedPickups.includes('herb-persist-1'));
  assert.ok(pGuestSnap.depletedResources.some((r) => r.id === 'tree-persist-1' && r.usesRemaining === 0));
  assert.ok(pGuestSnap.depletedResources.some((r) => r.id === 'rock-persist-1' && r.usesRemaining === 0));
  assert.ok(pGuestSnap.doors.some((d) => d.id === 'door-persist-1' && d.isOpen));
  assert.ok(pGuestSnap.placedBeds.some((b) => b.id === 'bed-persist-1'));
  assert.ok(pGuestSnap.droppedItems.some((d) => d.id === 'drop-persist-1'));
  assert.ok(pGuestSnap.containers?.some((c) => c.id === 'crate-persist-1' && c.isOpen));
  assert.ok(pGuestSnap.buildingStates?.some((b) => b.id === 'watchtower-1' && b.state === 'repaired'));
  assert.ok(pGuestSnap.questObjects?.some((q) => q.id === 'shrine-orb-1' && q.state === 'activated'));
  assert.equal(pGuestSnap.itemCounts?.stone, 3, 'Guest exact collected resource stack count restored');
  assert.equal(pGuestSnap.itemCounts?.['meadow-herb'], 1, 'Guest picked-up herb stack restored');
  assert.ok(
    pGuestSnap.entityStates?.some((e) => e.id === 'enemy-persist-1' && e.hp === 30 && Math.abs(e.x - 52.5) < 0.05),
    'Enemy entity snapshot persisted across DO restart',
  );
  assert.ok(
    pGuestSnap.entityStates?.some((e) => e.id === 'deer-persist-1' && e.isDead === true),
    'Killed animal snapshot persisted across DO restart',
  );
  assert.ok(
    pGuestSnap.quests.some((q) => q.questId === 'quest-guest-only' && q.stepIndex === 2),
    'Guest independent quest state restored',
  );
  assert.ok(
    Math.abs((pGuestSnap.playerPosition?.x ?? 0) - -63.25) < 0.05,
    'Guest saved position restored independently',
  );

  // Original host now rejoins with resumeToken and must get OWN independent player data (no quest-guest-only, own wood=4, own coords & iron-sword)
  const pHostRejoinRes = await persistRoomDO.fetch(
    new Request('https://internal/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        playerName: 'Founder',
        resumeToken: pCreateJson.resumeToken,
      }),
    }),
  );
  assert.equal(pHostRejoinRes.status, 200);
  const pHostRejoinJson = (await pHostRejoinRes.json()) as {
    playerId: string;
    sessionToken: string;
  };
  assert.equal(pHostRejoinJson.playerId, pCreateJson.playerId);
  const pHostRejoinWsRes = (await persistRoomDO.fetch(
    new Request(
      `https://internal/ws?playerId=${pHostRejoinJson.playerId}&token=${pHostRejoinJson.sessionToken}`,
      { headers: { Upgrade: 'websocket' } },
    ),
  )) as unknown as { status: number; webSocket: MockWebSocket };
  const pHostRejoinMsgs = collectMessages(pHostRejoinWsRes.webSocket);
  await flush();

  const pHostSnap = pHostRejoinMsgs.find((m) => m.type === 'WORLD_SNAPSHOT')?.payload as {
    playerPosition?: { x: number; z: number };
    inventoryItemIds?: string[];
    itemCounts?: Record<string, number>;
    quests: Array<{ questId: string }>;
  };
  assert.ok(pHostSnap, 'Returning host receives own WORLD_SNAPSHOT');
  assert.ok(
    Math.abs((pHostSnap.playerPosition?.x ?? 0) - 44.5) < 0.05,
    'Host saved position restored independently from guest',
  );
  assert.ok(
    pHostSnap.inventoryItemIds?.includes('iron-sword'),
    'Host independent inventory restored',
  );
  assert.equal(
    pHostSnap.itemCounts?.wood,
    4,
    'Host exact collected wood count (4) restored independently from guest',
  );
  assert.equal(
    pHostSnap.itemCounts?.stone,
    undefined,
    'Host did not receive guest collected stone',
  );
  assert.ok(
    !pHostSnap.quests.some((q) => q.questId === 'quest-guest-only'),
    'Player progression & quests remain strictly isolated per player',
  );

  // 30. Joining resets 72h inactivity timer & true 72h expiry purges room and blocks client restoration
  const stateAfterRejoinRes = await persistRoomDO.fetch(new Request('https://internal/state'));
  assert.equal(stateAfterRejoinRes.status, 200);
  const stateAfterRejoinJson = (await stateAfterRejoinRes.json()) as {
    room: { lastActivityAt: number; expiresAt: number };
  };
  assert.ok(
    stateAfterRejoinJson.room.expiresAt - stateAfterRejoinJson.room.lastActivityAt ===
      72 * 60 * 60 * 1000,
    'Joining resets 72h server-side inactivity timer',
  );

  const sweepBeforeExpiry = await persistRoomDO.fetch(
    new Request('https://internal/expire-sweep', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nowMs: stateAfterRejoinJson.room.expiresAt - 60_000 }),
    }),
  );
  const sweepBeforeJson = (await sweepBeforeExpiry.json()) as { expired: boolean };
  assert.equal(sweepBeforeJson.expired, false);

  const sweepAfterExpiry = await persistRoomDO.fetch(
    new Request('https://internal/expire-sweep', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nowMs: stateAfterRejoinJson.room.expiresAt + 1000 }),
    }),
  );
  const sweepAfterJson = (await sweepAfterExpiry.json()) as { expired: boolean; status: string };
  assert.equal(sweepAfterJson.expired, true);
  assert.equal(sweepAfterJson.status, 'closed');
  assert.equal(
    await persistState.storage.get('world_state_v2'),
    undefined,
    'Expired room purges world_state_v2 so clients cannot restore it',
  );
  const expiredJoinAttempt = await persistRoomDO.fetch(
    new Request('https://internal/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'Founder', resumeToken: pCreateJson.resumeToken }),
    }),
  );
  assert.equal(expiredJoinAttempt.status, 410, 'Expired room rejects rejoin attempts with 410');

  // Clean up test WebSockets before exit
  void pHostMsgsPersist;

  // =========================================================================
  // 31–38. COMPLETE PARTY / CO-OP SYSTEM VERIFICATION
  // =========================================================================
  const partyStateStorage = createMockState();
  const partyEnv = createMockEnv();
  const partyRoomId = 'room_party_coop_01';
  const partyRoom = new MultiplayerRoomDO(partyStateStorage as never, partyEnv as never);

  const partyInitRes = (await (
    await partyRoom.fetch(
      new Request('https://internal/init', {
        method: 'POST',
        body: JSON.stringify({
          roomId: partyRoomId,
          roomName: 'Party Frontier',
          playerName: 'LeaderAlpha',
          worldType: 'normal',
          maxPlayers: 4,
          friendlyFire: false,
        }),
      }),
    )
  ).json()) as { playerId: string; sessionToken: string; resumeToken: string };

  const partyJoinBRes = (await (
    await partyRoom.fetch(
      new Request('https://internal/join', {
        method: 'POST',
        body: JSON.stringify({ playerName: 'RangerBravo' }),
      }),
    )
  ).json()) as { playerId: string; sessionToken: string; resumeToken: string };

  const partyJoinCRes = (await (
    await partyRoom.fetch(
      new Request('https://internal/join', {
        method: 'POST',
        body: JSON.stringify({ playerName: 'ScoutCharlie' }),
      }),
    )
  ).json()) as { playerId: string; sessionToken: string; resumeToken: string };

  const pAId = partyInitRes.playerId;
  const pBId = partyJoinBRes.playerId;
  const pCId = partyJoinCRes.playerId;

  const pAWs = ((await partyRoom.fetch(
    new Request(`https://internal/ws?playerId=${pAId}&token=${partyInitRes.sessionToken}`, {
      headers: { Upgrade: 'websocket' },
    }),
  )) as unknown as { webSocket: MockWebSocket }).webSocket;
  const pBWs = ((await partyRoom.fetch(
    new Request(`https://internal/ws?playerId=${pBId}&token=${partyJoinBRes.sessionToken}`, {
      headers: { Upgrade: 'websocket' },
    }),
  )) as unknown as { webSocket: MockWebSocket }).webSocket;
  const pCWs = ((await partyRoom.fetch(
    new Request(`https://internal/ws?playerId=${pCId}&token=${partyJoinCRes.sessionToken}`, {
      headers: { Upgrade: 'websocket' },
    }),
  )) as unknown as { webSocket: MockWebSocket }).webSocket;

  const pAMsgs = collectMessages(pAWs);
  const pBMsgs = collectMessages(pBWs);
  const pCMsgs = collectMessages(pCWs);
  const sendParty = (
    ws: MockWebSocket,
    pid: string,
    type: string,
    payload?: Record<string, unknown>,
  ) => {
    ws.send(
      JSON.stringify({
        v: 1,
        type,
        roomId: partyRoomId,
        playerId: pid,
        timestamp: Date.now(),
        ...(payload !== undefined ? { payload } : {}),
      }),
    );
  };

  await flush();
  sendParty(pBWs, pBId, 'READY', { ready: true });
  sendParty(pCWs, pCId, 'READY', { ready: true });
  await flush();
  sendParty(pAWs, pAId, 'START_GAME');
  await flush();
  assert.ok(
    pAMsgs.some((m) => m.type === 'START_GAME'),
    'Party test room transitions to in-game',
  );

  // 31. Party Create & Max Size Respecting Room Max Players (4)
  pAMsgs.length = 0;
  sendParty(pAWs, pAId, 'PARTY_CREATE');
  await flush();
  const createdPartySnap = pAMsgs.find((m) => m.type === 'PARTY_STATE')?.payload as {
    party: {
      partyId: string;
      leaderPlayerId: string;
      maxMembers: number;
      members: Array<{ playerId: string; markerIndex: number; markerColor: string }>;
    } | null;
  };
  assert.ok(createdPartySnap?.party, 'PARTY_CREATE returns authoritative party');
  assert.equal(createdPartySnap.party!.leaderPlayerId, pAId);
  assert.equal(createdPartySnap.party!.maxMembers, 4, 'Party maxMembers respects room limit');
  assert.equal(createdPartySnap.party!.members[0].markerIndex, 0);

  // 32. Party Invite -> Duplicate Rejection -> Decline -> Re-Invite -> Accept -> Ready Sync
  pBMsgs.length = 0;
  sendParty(pAWs, pAId, 'PARTY_INVITE', {
    targetPlayerId: pBId,
    targetPlayerName: 'RangerBravo',
  });
  await flush();
  const invEv = pBMsgs.find((m) => m.type === 'PARTY_INVITE_RECEIVED')?.payload as {
    inviteId: string;
    partyId: string;
    toPlayerId: string;
  };
  assert.ok(invEv?.inviteId, 'Target player receives PARTY_INVITE_RECEIVED');

  // Duplicate invite prevented
  pAMsgs.length = 0;
  sendParty(pAWs, pAId, 'PARTY_INVITE', {
    targetPlayerId: pBId,
  });
  await flush();
  assert.ok(
    pAMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'DUPLICATE_PARTY_INVITE'),
    'Duplicate party invite rejected with DUPLICATE_PARTY_INVITE',
  );

  // Decline invite clears pending status and allows fresh re-invite
  pBMsgs.length = 0;
  sendParty(pBWs, pBId, 'PARTY_DECLINE_INVITE', {
    inviteId: invEv.inviteId,
  });
  await flush();
  const bSnapAfterDecline = [...pBMsgs].reverse().find((m) => m.type === 'PARTY_STATE')
    ?.payload as { party: unknown; pendingInvites: unknown[] };
  assert.equal(bSnapAfterDecline.party, null);
  assert.equal(bSnapAfterDecline.pendingInvites.length, 0);

  // Re-invite & Accept
  pBMsgs.length = 0;
  sendParty(pAWs, pAId, 'PARTY_INVITE', { targetPlayerId: pBId });
  await flush();
  const invEv2 = pBMsgs.find((m) => m.type === 'PARTY_INVITE_RECEIVED')?.payload as {
    inviteId: string;
  };
  assert.ok(invEv2?.inviteId);
  pAMsgs.length = 0;
  pBMsgs.length = 0;
  sendParty(pBWs, pBId, 'PARTY_ACCEPT_INVITE', {
    inviteId: invEv2.inviteId,
  });
  await flush();
  const bJoinedSnap = [...pBMsgs].reverse().find((m) => m.type === 'PARTY_STATE')
    ?.payload as {
    party: {
      members: Array<{ playerId: string; markerIndex: number; markerColor: string; isReady: boolean }>;
    };
  };
  assert.equal(bJoinedSnap.party.members.length, 2, 'Accepted invite adds B to party');
  assert.notEqual(
    bJoinedSnap.party.members[0].markerColor,
    bJoinedSnap.party.members[1].markerColor,
    'Party members assigned distinct marker colors',
  );

  // Ready status sync across party members
  pAMsgs.length = 0;
  sendParty(pBWs, pBId, 'PARTY_SET_READY', { ready: true });
  await flush();
  const aSnapAfterReady = [...pAMsgs].reverse().find((m) => m.type === 'PARTY_STATE')
    ?.payload as {
    party: { members: Array<{ playerId: string; isReady: boolean }> };
  };
  assert.equal(
    aSnapAfterReady.party.members.find((m) => m.playerId === pBId)?.isReady,
    true,
    'Party member ready status syncs across party',
  );

  // 33. Server Validates Party Leader Permissions (Non-leader rejected; Leader Transfer & Auto-transfer on Leave)
  pBMsgs.length = 0;
  sendParty(pBWs, pBId, 'PARTY_INVITE', { targetPlayerId: pCId });
  sendParty(pBWs, pBId, 'PARTY_KICK', { targetPlayerId: pAId });
  sendParty(pBWs, pBId, 'PARTY_TRANSFER_LEADER', { targetPlayerId: pCId });
  sendParty(pBWs, pBId, 'PARTY_START_OBJECTIVE', { type: 'kill_boss' });
  await flush();
  assert.equal(
    pBMsgs.filter((m) => m.type === 'ERROR' && m.payload?.code === 'FORBIDDEN_PARTY_LEADER').length,
    4,
    'All non-leader privileged party actions rejected with FORBIDDEN_PARTY_LEADER',
  );

  // Leader invites C -> C accepts -> A transfers leader to B -> B leaves -> auto transfers leader to A -> re-invite B & kick/re-invite C
  pCMsgs.length = 0;
  sendParty(pAWs, pAId, 'PARTY_INVITE', { targetPlayerId: pCId });
  await flush();
  const invC = pCMsgs.find((m) => m.type === 'PARTY_INVITE_RECEIVED')?.payload as {
    inviteId: string;
  };
  sendParty(pCWs, pCId, 'PARTY_ACCEPT_INVITE', {
    inviteId: invC.inviteId,
  });
  await flush();

  // Explicit Leader Transfer A -> B
  pBMsgs.length = 0;
  sendParty(pAWs, pAId, 'PARTY_TRANSFER_LEADER', { targetPlayerId: pBId });
  await flush();
  const snapAfterTransfer = [...pBMsgs].reverse().find((m) => m.type === 'PARTY_STATE')
    ?.payload as { party: { leaderPlayerId: string; members: Array<{ playerId: string }> } };
  assert.equal(snapAfterTransfer.party.leaderPlayerId, pBId, 'Explicit leader transfer updates leader');

  // Leader B leaves -> Automatic leader transfer to remaining member (A)
  pAMsgs.length = 0;
  sendParty(pBWs, pBId, 'PARTY_LEAVE');
  await flush();
  const snapAfterBLeave = [...pAMsgs].reverse().find((m) => m.type === 'PARTY_STATE')
    ?.payload as { party: { leaderPlayerId: string; members: Array<{ playerId: string }> } };
  assert.equal(snapAfterBLeave.party.members.length, 2);
  assert.equal(
    snapAfterBLeave.party.leaderPlayerId,
    pAId,
    'Leadership transfers automatically when current leader leaves',
  );

  // Re-invite B so all 3 are in the party again, then test Kick -> Re-invite
  pBMsgs.length = 0;
  sendParty(pAWs, pAId, 'PARTY_INVITE', { targetPlayerId: pBId });
  await flush();
  const invBRejoin = pBMsgs.find((m) => m.type === 'PARTY_INVITE_RECEIVED')?.payload as {
    inviteId: string;
  };
  sendParty(pBWs, pBId, 'PARTY_ACCEPT_INVITE', {
    inviteId: invBRejoin.inviteId,
  });
  await flush();

  // Test authorized Kick on C, then invite C back
  pAMsgs.length = 0;
  sendParty(pAWs, pAId, 'PARTY_KICK', { targetPlayerId: pCId });
  await flush();
  const snapAfterKick = [...pAMsgs].reverse().find((m) => m.type === 'PARTY_STATE')
    ?.payload as { party: { members: Array<{ playerId: string }> } };
  assert.equal(
    snapAfterKick.party.members.some((m) => m.playerId === pCId),
    false,
    'Authorized leader kick removes target from party',
  );
  pCMsgs.length = 0;
  sendParty(pAWs, pAId, 'PARTY_INVITE', { targetPlayerId: pCId });
  await flush();
  const invC2 = pCMsgs.find((m) => m.type === 'PARTY_INVITE_RECEIVED')?.payload as {
    inviteId: string;
  };
  sendParty(pCWs, pCId, 'PARTY_ACCEPT_INVITE', {
    inviteId: invC2.inviteId,
  });
  await flush();

  // 34. Friendly Fire ON/OFF (Server Validated for Melee & Projectile)
  // Position A & B near spawn (0, 0, 4)
  sendParty(pAWs, pAId, 'PLAYER_STATE', { x: 1, y: 0, z: 4, yaw: 0 });
  sendParty(pBWs, pBId, 'PLAYER_STATE', { x: 2, y: 0, z: 4, yaw: 0 });
  await flush();

  // Friendly fire is OFF by default -> Melee hit on party member blocked
  pAMsgs.length = 0;
  pBMsgs.length = 0;
  sendParty(pAWs, pAId, 'GAME_EVENT', {
    event: 'COMBAT_HIT',
    data: {
      weaponId: 'unarmed',
      targetKind: 'player',
      targetId: pBId,
      x: 2,
      y: 0,
      z: 4,
    },
  });
  await flush();
  assert.ok(
    pAMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'FRIENDLY_FIRE_DISABLED'),
    'Party melee attack rejected with FRIENDLY_FIRE_DISABLED when friendlyFire is OFF',
  );
  assert.equal(
    pBMsgs.some((m) => m.type === 'PLAYER_VITALS'),
    false,
    'Target party member takes zero melee damage when friendlyFire is OFF',
  );

  // Friendly fire OFF -> Projectile hit on party member also blocked
  await new Promise((r) => setTimeout(r, 320));
  pAMsgs.length = 0;
  pBMsgs.length = 0;
  sendParty(pAWs, pAId, 'GAME_EVENT', {
    event: 'ARROW_FIRED',
    data: {
      arrowId: 'ff_off_arr_1',
      weaponId: 'hunter-bow',
      originX: 1,
      originY: 1.5,
      originZ: 4,
      dirX: 1,
      dirY: 0,
      dirZ: 0,
      bowCharge: 1,
    },
  });
  await flush();
  sendParty(pAWs, pAId, 'GAME_EVENT', {
    event: 'PROJECTILE_HIT',
    data: {
      arrowId: 'ff_off_arr_1',
      targetKind: 'player',
      targetId: pBId,
      x: 2,
      y: 1.4,
      z: 4,
      isHeadshot: false,
    },
  });
  await flush();
  assert.ok(
    pAMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'FRIENDLY_FIRE_DISABLED'),
    'Party projectile hit rejected with FRIENDLY_FIRE_DISABLED when friendlyFire is OFF',
  );
  assert.equal(
    pBMsgs.some((m) => m.type === 'PLAYER_VITALS'),
    false,
    'Target party member takes zero projectile damage when friendlyFire is OFF',
  );

  // Non-host cannot toggle friendlyFire
  pBMsgs.length = 0;
  sendParty(pBWs, pBId, 'UPDATE_ROOM_SETTINGS', {
    friendlyFire: true,
  });
  await flush();
  assert.ok(
    pBMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'FORBIDDEN_HOST_ONLY'),
    'Non-host cannot toggle friendlyFire setting',
  );

  // Host toggles friendlyFire ON -> party melee & projectile attacks now land and update PLAYER_VITALS
  pBMsgs.length = 0;
  sendParty(pAWs, pAId, 'UPDATE_ROOM_SETTINGS', {
    friendlyFire: true,
  });
  await flush();
  assert.ok(
    pBMsgs.some(
      (m) =>
        m.type === 'ROOM_STATE' &&
        (m.payload as { gameState?: { worldSettings?: { friendlyFire?: boolean } } })?.gameState
          ?.worldSettings?.friendlyFire === true,
    ),
    'Host enabling friendlyFire broadcasts ROOM_STATE worldSettings.friendlyFire=true',
  );

  await new Promise((r) => setTimeout(r, 320));
  pBMsgs.length = 0;
  sendParty(pAWs, pAId, 'GAME_EVENT', {
    event: 'COMBAT_HIT',
    data: {
      weaponId: 'unarmed',
      targetKind: 'player',
      targetId: pBId,
      x: 2,
      y: 0,
      z: 4,
    },
  });
  await flush();
  const bDamagedVitals = pBMsgs.find((m) => m.type === 'PLAYER_VITALS')?.payload as {
    health: number;
    maxHealth: number;
  };
  assert.ok(
    bDamagedVitals && bDamagedVitals.health < bDamagedVitals.maxHealth,
    'Party member takes authoritative melee damage when friendlyFire is ON',
  );

  await new Promise((r) => setTimeout(r, 320));
  pBMsgs.length = 0;
  sendParty(pAWs, pAId, 'GAME_EVENT', {
    event: 'ARROW_FIRED',
    data: {
      arrowId: 'ff_on_arr_1',
      weaponId: 'hunter-bow',
      originX: 1,
      originY: 1.5,
      originZ: 4,
      dirX: 1,
      dirY: 0,
      dirZ: 0,
      bowCharge: 0.5,
    },
  });
  await flush();
  sendParty(pAWs, pAId, 'GAME_EVENT', {
    event: 'PROJECTILE_HIT',
    data: {
      arrowId: 'ff_on_arr_1',
      targetKind: 'player',
      targetId: pBId,
      x: 2,
      y: 1.4,
      z: 4,
      isHeadshot: false,
    },
  });
  await flush();
  const bArrowVitals = pBMsgs.find((m) => m.type === 'PLAYER_VITALS')?.payload as {
    health: number;
  };
  assert.ok(
    bArrowVitals && bArrowVitals.health < bDamagedVitals.health,
    'Party member takes authoritative projectile damage when friendlyFire is ON',
  );

  // Restore friendlyFire OFF
  sendParty(pAWs, pAId, 'UPDATE_ROOM_SETTINGS', {
    friendlyFire: false,
  });
  await flush();

  // 35. Personal XP, Coins & Inventory NOT Automatically Shared Across Party Members
  // Give enemy in world snapshot via ENTITY_SYNC from A (host) & have A gather resource and kill an enemy
  sendParty(pAWs, pAId, 'ENTITY_SYNC', {
    entities: [
      {
        id: 'party-nonshare-enemy-1',
        kind: 'enemy',
        archetype: 'bandit_scout',
        x: 2.5,
        y: 0,
        z: 4,
        yaw: 0,
        state: 'aggro',
        hp: 5,
        maxHp: 65,
      },
    ],
  });
  await flush();

  pAMsgs.length = 0;
  pBMsgs.length = 0;
  sendParty(pAWs, pAId, 'GAME_EVENT', {
    event: 'PLAYER_COLLECTED_RESOURCE',
    data: {
      nodeId: 'party-tree-1',
      itemId: 'wood',
      count: 2,
      x: 1,
      z: 4,
    },
  });
  await flush();
  const aProgAfterGather = [...pAMsgs]
    .reverse()
    .find((m) => m.type === 'PROGRESSION_UPDATED')?.payload as {
    playerId: string;
    xp: number;
    coins: number;
  };
  assert.ok(aProgAfterGather && aProgAfterGather.xp >= 5, 'Gatherer earns personal XP');
  assert.equal(
    pBMsgs.some((m) => m.type === 'PROGRESSION_UPDATED' && (m.payload as { playerId?: string })?.playerId === pBId),
    false,
    'Party member B does NOT automatically receive A personal resource XP/coins',
  );

  await new Promise((r) => setTimeout(r, 320));
  pAMsgs.length = 0;
  pBMsgs.length = 0;
  sendParty(pAWs, pAId, 'GAME_EVENT', {
    event: 'COMBAT_HIT',
    data: {
      weaponId: 'unarmed',
      targetKind: 'enemy',
      targetId: 'party-nonshare-enemy-1',
      x: 2.5,
      y: 0,
      z: 4,
    },
  });
  await flush();
  assert.ok(
    pAMsgs.some((m) => m.type === 'PROGRESSION_UPDATED' && (m.payload as { playerId?: string })?.playerId === pAId),
    'Enemy killer A earns personal kill XP & coins',
  );
  assert.equal(
    pBMsgs.some((m) => m.type === 'PROGRESSION_UPDATED' && (m.payload as { playerId?: string })?.playerId === pBId),
    false,
    'Party member B does NOT receive A personal kill XP/coins',
  );

  // 36. All 6 Cooperative Objectives + Individual Calculated Rewards
  const runObjectiveAndAssertRewards = async (
    type:
      | 'explore_location'
      | 'escort_npc'
      | 'collect_resources'
      | 'open_dungeon'
      | 'protect_village'
      | 'kill_boss',
    triggerAction: () => Promise<void>,
  ) => {
    pAMsgs.length = 0;
    pBMsgs.length = 0;
    sendParty(pAWs, pAId, 'PARTY_START_OBJECTIVE', {
      type,
      title: `Test ${type}`,
      targetX: 2,
      targetZ: 4,
      targetCount: type === 'collect_resources' ? 2 : 1,
    });
    await flush();
    assert.ok(
      pAMsgs.some((m) => m.type === 'PARTY_OBJECTIVE_UPDATED') &&
        pBMsgs.some((m) => m.type === 'PARTY_OBJECTIVE_UPDATED'),
      `Objective ${type} broadcast to all party members`,
    );

    await triggerAction();
    await flush();

    const completedEv = pAMsgs.find((m) => m.type === 'PARTY_OBJECTIVE_COMPLETED')
      ?.payload as {
      type: string;
      status: string;
      rewardsByPlayer: Record<string, { xp: number; coins: number; bonusReason: string }>;
    };
    assert.ok(completedEv, `Objective ${type} completed`);
    assert.equal(completedEv.status, 'completed');
    assert.ok(
      completedEv.rewardsByPlayer[pAId].xp > completedEv.rewardsByPlayer[pBId].xp ||
        completedEv.rewardsByPlayer[pBId].xp > completedEv.rewardsByPlayer[pAId].xp,
      `Objective ${type} calculates individual rewards based on contribution (${JSON.stringify(completedEv.rewardsByPlayer)})`,
    );
  };

  // (1) explore_location: triggered by PLAYER_STATE within radius
  await runObjectiveAndAssertRewards('explore_location', async () => {
    sendParty(pAWs, pAId, 'PLAYER_STATE', { x: 2, y: 0, z: 4, yaw: 0 });
  });

  // (2) escort_npc: triggered by COOP_OBJECTIVE_PROGRESS within radius
  await runObjectiveAndAssertRewards('escort_npc', async () => {
    sendParty(pAWs, pAId, 'GAME_EVENT', {
      event: 'COOP_OBJECTIVE_PROGRESS',
      data: { amount: 1 },
    });
  });

  // (3) collect_resources: triggered by PLAYER_COLLECTED_RESOURCE
  await runObjectiveAndAssertRewards('collect_resources', async () => {
    sendParty(pAWs, pAId, 'GAME_EVENT', {
      event: 'PLAYER_COLLECTED_RESOURCE',
      data: { nodeId: 'coop-ore-1', itemId: 'stone', count: 2, x: 1.5, z: 4 },
    });
  });

  // (4) open_dungeon: triggered by DOOR_OPENED / CHEST_OPENED
  await runObjectiveAndAssertRewards('open_dungeon', async () => {
    sendParty(pAWs, pAId, 'GAME_EVENT', {
      event: 'CHEST_OPENED',
      data: { chestId: 'dungeon-vault-chest-1', x: 1, z: 4 },
    });
  });

  // (5) protect_village: triggered by killing enemy entity
  sendParty(pAWs, pAId, 'ENTITY_SYNC', {
    entities: [
      {
        id: 'coop-raider-1',
        kind: 'enemy',
        archetype: 'bandit_scout',
        x: 1.8,
        y: 0,
        z: 4,
        yaw: 0,
        state: 'aggro',
        hp: 5,
        maxHp: 65,
      },
    ],
  });
  await flush();
  await new Promise((r) => setTimeout(r, 320));
  await runObjectiveAndAssertRewards('protect_village', async () => {
    sendParty(pAWs, pAId, 'GAME_EVENT', {
      event: 'COMBAT_HIT',
      data: {
        weaponId: 'unarmed',
        targetKind: 'enemy',
        targetId: 'coop-raider-1',
        x: 1.8,
        y: 0,
        z: 4,
      },
    });
  });

  // (6) kill_boss: triggered by killing sentinel / boss entity
  sendParty(pAWs, pAId, 'ENTITY_SYNC', {
    entities: [
      {
        id: 'coop-boss-1',
        kind: 'enemy',
        archetype: 'stone_sentinel',
        x: 1.8,
        y: 0,
        z: 4,
        yaw: 0,
        state: 'aggro',
        hp: 5,
        maxHp: 120,
      },
    ],
  });
  await flush();
  await new Promise((r) => setTimeout(r, 320));
  await runObjectiveAndAssertRewards('kill_boss', async () => {
    sendParty(pAWs, pAId, 'GAME_EVENT', {
      event: 'COMBAT_HIT',
      data: {
        weaponId: 'unarmed',
        targetKind: 'enemy',
        targetId: 'coop-boss-1',
        x: 1.8,
        y: 0,
        z: 4,
      },
    });
  });

  // 37. Reconnection Restores Party Membership, Leadership & Active Co-op Objective
  sendParty(pAWs, pAId, 'PARTY_START_OBJECTIVE', {
    type: 'open_dungeon',
    title: 'Persistent Dungeon Raid',
    targetX: 25,
    targetZ: -15,
    targetCount: 3,
  });
  await flush();
  pBWs.close(1006, 'Brief reconnect drop');
  await flush();
  const restartedPartyDO = new MultiplayerRoomDO(partyStateStorage as never, partyEnv as never);
  const pBRejoinWsRes = (await restartedPartyDO.fetch(
    new Request(
      `https://internal/ws?playerId=${pBId}&token=${partyJoinBRes.sessionToken}`,
      { headers: { Upgrade: 'websocket' } },
    ),
  )) as unknown as { status: number; webSocket: MockWebSocket };
  assert.equal(pBRejoinWsRes.status, 101);
  const pBRejoinMsgs = collectMessages(pBRejoinWsRes.webSocket);
  await flush();
  const pBSnapAfterReconnect = pBRejoinMsgs.find((m) => m.type === 'WORLD_SNAPSHOT')
    ?.payload as {
    partyState?: {
      party?: {
        leaderPlayerId: string;
        members: Array<{ playerId: string; online: boolean }>;
        activeObjective?: { title: string; targetCount: number; status: string } | null;
      } | null;
    };
  };
  assert.ok(pBSnapAfterReconnect?.partyState?.party, 'WORLD_SNAPSHOT restores partyState on reconnect');
  assert.equal(pBSnapAfterReconnect.partyState!.party!.leaderPlayerId, pAId);
  assert.ok(
    pBSnapAfterReconnect.partyState!.party!.members.some((m) => m.playerId === pBId),
    'Reconnected player membership survives disconnect and DO restart',
  );
  assert.equal(
    pBSnapAfterReconnect.partyState!.party!.activeObjective?.title,
    'Persistent Dungeon Raid',
    'Active cooperative objective restored across disconnect/restart',
  );

  // 38. Map Integration: Party Markers, Distance, Direction, Objective Pin & Toggle
  const { MapManager } = await import('./src/game/world/MapManager');
  const testMapMgr = new MapManager();
  const partyMarkersOn = testMapMgr.buildMarkers({
    seed: 12345,
    villageSite: null,
    landmarks: [],
    villages: [],
    npcs: [],
    interactables: [],
    activeQuests: [],
    availableQuests: [],
    questDefs: [],
    getItemCount: () => 0,
    players: [
      {
        id: pBId,
        name: 'RangerBravo',
        relationship: 'party',
        x: 30,
        z: -40,
        partyIndex: 1,
        partyColor: '#a855f7',
        online: true,
        distanceMeters: 50,
        directionLabel: 'NE',
      },
      {
        id: 'room-guest-4',
        name: 'OtherTraveler',
        relationship: 'room_player',
        x: -20,
        z: 10,
      },
    ],
    coopObjective: {
      objectiveId: 'obj-map-1',
      partyId: createdPartySnap.party!.partyId,
      type: 'open_dungeon',
      title: 'Open Dungeon Vaults',
      description: 'Open vaults',
      status: 'active',
      progress: 1,
      targetCount: 3,
      targetX: 25,
      targetZ: -15,
      startedByPlayerId: pAId,
      startedAt: Date.now(),
      contributions: {},
      rewardsByPlayer: {},
    },
    lang: 'en',
    showPartyMembers: true,
    showNonPartyPlayers: true,
  });
  const partyPin = partyMarkersOn.find((m) => m.kind === 'party_member');
  assert.ok(partyPin, 'Party member marker generated when showPartyMembers=true');
  assert.equal(partyPin.partyIndex, 1);
  assert.equal(partyPin.markerColor, '#a855f7');
  assert.equal(partyPin.distanceMeters, 50);
  assert.equal(partyPin.directionLabel, 'NE');
  assert.ok(
    partyMarkersOn.some((m) => m.kind === 'coop_objective'),
    'Active co-op objective pin emitted onto map',
  );

  const partyMarkersHidden = testMapMgr.buildMarkers({
    seed: 12345,
    villageSite: null,
    landmarks: [],
    villages: [],
    npcs: [],
    interactables: [],
    activeQuests: [],
    availableQuests: [],
    questDefs: [],
    getItemCount: () => 0,
    players: [
      {
        id: pBId,
        name: 'RangerBravo',
        relationship: 'party',
        x: 30,
        z: -40,
        partyIndex: 1,
        partyColor: '#a855f7',
        online: true,
        distanceMeters: 50,
        directionLabel: 'NE',
      },
    ],
    coopObjective: {
      objectiveId: 'obj-map-1',
      partyId: createdPartySnap.party!.partyId,
      type: 'open_dungeon',
      title: 'Open Dungeon Vaults',
      description: 'Open vaults',
      status: 'active',
      progress: 1,
      targetCount: 3,
      targetX: 25,
      targetZ: -15,
      startedByPlayerId: pAId,
      startedAt: Date.now(),
      contributions: {},
      rewardsByPlayer: {},
    },
    lang: 'en',
    showPartyMembers: false,
    showNonPartyPlayers: true,
  });
  assert.equal(
    partyMarkersHidden.some((m) => m.kind === 'party_member'),
    false,
    'SHOW PARTY MEMBERS ON MAP toggle OFF hides party member markers cleanly',
  );
  assert.ok(
    partyMarkersHidden.some((m) => m.kind === 'coop_objective'),
    'Co-op objective pin remains visible even if party player markers are toggled off',
  );

  pAWs.close(1000, 'Done');
  pCWs.close(1000, 'Done');
  pBRejoinWsRes.webSocket.close(1000, 'Done');

  // ============================================================================
  // 26. Anti-Cheat Security Hardening Verification Suite
  // ============================================================================
  const acCreateRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.210' },
      body: JSON.stringify({
        playerName: 'ACHost',
        roomName: 'AntiCheat Citadel',
        worldType: 'normal',
        privacy: 'private',
        allowFriends: false,
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(acCreateRes.status, 200);
  const acCreateJson = (await acCreateRes.json()) as {
    room: { roomId: string; roomCode: string };
    playerId: string;
    sessionToken: string;
  };
  const acRoomId = acCreateJson.room.roomId;
  const acHostId = acCreateJson.playerId;

  // 26a. Forged host role / permissions on join rejected
  const forgedRoleJoinRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/rooms/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.211' },
      body: JSON.stringify({
        roomCodeOrId: acRoomId,
        playerName: 'RoleSpoofer',
        isHost: true,
        role: 'host',
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(forgedRoleJoinRes.status, 403, 'Client-forged isHost/role on join rejected');

  const acJoinRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/rooms/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.211' },
      body: JSON.stringify({
        roomCodeOrId: acRoomId,
        playerName: 'ACGuest',
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(acJoinRes.status, 200);
  const acJoinJson = (await acJoinRes.json()) as {
    playerId: string;
    sessionToken: string;
  };
  const acGuestId = acJoinJson.playerId;

  // 26b. Private room invite denied for non-host
  const nonHostPrivateInviteRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.211' },
      body: JSON.stringify({
        roomId: acRoomId,
        fromPlayerId: acGuestId,
        sessionToken: acJoinJson.sessionToken,
        toPlayerName: 'OutsideFriend',
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(
    nonHostPrivateInviteRes.status,
    403,
    'Non-host cannot invite players into host-only private room',
  );

  // Connect both host & guest via WS and start game
  const acHostWsRes = (await workerApp.fetch(
    new Request(
      `https://worker.example/api/multiplayer/ws?roomId=${encodeURIComponent(acRoomId)}&playerId=${encodeURIComponent(acHostId)}&token=${encodeURIComponent(acCreateJson.sessionToken)}`,
      { headers: { Upgrade: 'websocket', 'CF-Connecting-IP': '198.51.100.210' } },
    ),
    fullEnv as never,
    ctxStub,
  )) as unknown as { status: number; webSocket: MockWebSocket };
  const acGuestWsRes = (await workerApp.fetch(
    new Request(
      `https://worker.example/api/multiplayer/ws?roomId=${encodeURIComponent(acRoomId)}&playerId=${encodeURIComponent(acGuestId)}&token=${encodeURIComponent(acJoinJson.sessionToken)}`,
      { headers: { Upgrade: 'websocket', 'CF-Connecting-IP': '198.51.100.211' } },
    ),
    fullEnv as never,
    ctxStub,
  )) as unknown as { status: number; webSocket: MockWebSocket };
  const acHostWs = acHostWsRes.webSocket;
  const acGuestWs = acGuestWsRes.webSocket;
  const acHostMsgs: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  const acGuestMsgs: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  acHostWs.addEventListener('message', (e) =>
    acHostMsgs.push(JSON.parse(String((e as MessageEvent).data))),
  );
  acGuestWs.addEventListener('message', (e) =>
    acGuestMsgs.push(JSON.parse(String((e as MessageEvent).data))),
  );
  const acSend = (ws: MockWebSocket, playerId: string, type: string, payload?: unknown) =>
    ws.send(JSON.stringify({ v: 1, type, roomId: acRoomId, playerId, timestamp: Date.now(), payload }));

  acSend(acGuestWs, acGuestId, 'READY', { ready: true });
  await flush();
  acSend(acHostWs, acHostId, 'START_GAME');
  await flush();

  // 26c. Coins, XP, Level, Inventory, Host role, Damage tampering via WS rejected
  acGuestMsgs.length = 0;
  acSend(acGuestWs, acGuestId, 'PLAYER_STATE', {
    x: 0, y: 0, z: 0, yaw: 0, coins: 999999999,
  });
  acSend(acGuestWs, acGuestId, 'REPAIR_WEAPONS', { costCoins: -500 });
  acSend(acGuestWs, acGuestId, 'REPAIR_WEAPONS', { costCoins: 99999 });
  acSend(acGuestWs, acGuestId, 'UPDATE_ROOM_SETTINGS', { isHost: true, maxPlayers: 8 });
  acSend(acGuestWs, acGuestId, 'WORLD_SETTINGS_UPDATE', { friendlyFire: true });
  acSend(acGuestWs, acGuestId, 'KICK_PLAYER', { targetPlayerId: acHostId });
  acSend(acGuestWs, acGuestId, 'TRANSFER_HOST', { targetPlayerId: acGuestId });
  acSend(acGuestWs, acGuestId, 'ENEMY_ATTACK_PLAYER', {
    targetPlayerId: acHostId, sourceId: 'e1', damage: 50, x: 0, z: 0,
  });
  await flush();

  const guestErrCodes = acGuestMsgs
    .filter((m) => m.type === 'ERROR')
    .map((m) => String(m.payload?.code ?? ''));
  assert.ok(
    guestErrCodes.includes('FORBIDDEN_CLIENT_AUTHORITY'),
    'WS coins=999999999 rejected with FORBIDDEN_CLIENT_AUTHORITY',
  );
  assert.ok(
    guestErrCodes.includes('INVALID_REPAIR_REQUEST'),
    'Negative/impossible REPAIR_WEAPONS cost rejected',
  );
  assert.ok(
    guestErrCodes.filter((c) => c === 'FORBIDDEN_HOST_ONLY').length >= 4,
    'Non-host room/world/kick/transfer/enemy-attack actions rejected',
  );

  // 26d. Fabricated personal quest completion & fabricated co-op quest rejected
  acGuestMsgs.length = 0;
  acSend(acGuestWs, acGuestId, 'GAME_EVENT', {
    event: 'QUEST_UPDATED',
    data: { questId: 'fabricated-infinite-xp-quest', status: 'completed', stepIndex: 1 },
  });
  acSend(acGuestWs, acGuestId, 'COOP_QUEST_START', {
    questId: 'fabricated-coop-quest',
    targetCount: 1,
  });
  await flush();
  assert.ok(
    acGuestMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'UNKNOWN_QUEST'),
    'Fabricated personal quest completion rejected (no infinite XP/coins)',
  );
  assert.ok(
    acGuestMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'UNKNOWN_COOP_QUEST'),
    'Fabricated cooperative quest start rejected',
  );

  // 26e. Inventory tampering: unowned drop (duplication), non-droppable drop, impossible counts,
  // unowned weapon equip, unknown craft recipe, impossible ammo craft, forbidden static armor pickup
  acGuestMsgs.length = 0;
  acSend(acGuestWs, acGuestId, 'GAME_EVENT', {
    event: 'ITEM_DROPPED',
    data: { dropId: 'dup_1', itemId: 'wood', count: 5, x: 0, y: 0, z: 0 },
  });
  acSend(acGuestWs, acGuestId, 'GAME_EVENT', {
    event: 'ITEM_DROPPED',
    data: { dropId: 'dup_2', itemId: 'compass', count: 1, x: 0, y: 0, z: 0 },
  });
  acSend(acGuestWs, acGuestId, 'GAME_EVENT', {
    event: 'ITEM_DROPPED',
    data: { dropId: 'dup_3', itemId: 'wood', count: 9999, x: 0, y: 0, z: 0 },
  });
  acSend(acGuestWs, acGuestId, 'PLAYER_STATE', {
    x: 0.5, y: 0, z: 0.5, yaw: 0, weaponId: 'steel-sword',
  });
  acSend(acGuestWs, acGuestId, 'GAME_EVENT', {
    event: 'WORLD_EVENT',
    data: { kind: 'item_crafted', recipeId: 'hacked-god-sword' },
  });
  acSend(acGuestWs, acGuestId, 'GAME_EVENT', {
    event: 'WORLD_EVENT',
    data: { kind: 'ammo_crafted', count: 500 },
  });
  acSend(acGuestWs, acGuestId, 'GAME_EVENT', {
    event: 'ITEM_PICKED_UP',
    data: { pickupId: 'hacked-armor-1', itemId: 'iron-armor', count: 1, x: 0, z: 0 },
  });
  await flush();
  const invErrCodes = acGuestMsgs
    .filter((m) => m.type === 'ERROR')
    .map((m) => String(m.payload?.code ?? ''));
  assert.ok(invErrCodes.includes('INSUFFICIENT_ITEMS'), 'Unowned item drop (duplication) rejected');
  assert.ok(invErrCodes.includes('ITEM_NOT_DROPPABLE'), 'Non-droppable quest/tool item drop rejected');
  assert.ok(invErrCodes.includes('INVALID_ITEM_QUANTITY'), 'Impossible drop/ammo craft quantity rejected');
  assert.ok(invErrCodes.includes('WEAPON_NOT_OWNED'), 'Unowned weapon equip in PLAYER_STATE rejected');
  assert.ok(invErrCodes.includes('INVALID_RECIPE'), 'Unknown crafting recipe rejected');
  assert.ok(invErrCodes.includes('FORBIDDEN_ITEM_GRANT'), 'Static pickup of restricted armor rejected');

  // 26f. Combat validation: forged damage field rejected, headshot spoof at ground level stripped
  acHostMsgs.length = 0;
  acSend(acHostWs, acHostId, 'ENTITY_SYNC', {
    entities: [
      { id: 'enemy-ac-1', kind: 'enemy', archetype: 'bandit_scout', x: 0, y: 0, z: 6, yaw: 0, state: 'idle' },
    ],
  });
  await flush();
  acSend(acHostWs, acHostId, 'PLAYER_STATE', { x: 0, y: 0, z: 0, yaw: 0, weaponId: 'hunter-bow' });
  await flush();
  acSend(acHostWs, acHostId, 'GAME_EVENT', {
    event: 'COMBAT_HIT',
    data: { targetKind: 'enemy', targetId: 'enemy-ac-1', weaponId: 'ranger-sword', damage: 9999, x: 0, y: 0, z: 2 },
  });
  await flush();
  assert.ok(
    acHostMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'FORBIDDEN_CLIENT_AUTHORITY'),
    'Forged damage=9999 in COMBAT_HIT rejected',
  );
  acHostMsgs.length = 0;
  acSend(acHostWs, acHostId, 'GAME_EVENT', {
    event: 'ARROW_FIRED',
    data: { arrowId: 'arr_spoof_hs', weaponId: 'hunter-bow', originX: 0, originY: 1.45, originZ: 0, dirX: 0, dirY: 0, dirZ: 1, bowCharge: 1 },
  });
  await flush();
  acSend(acHostWs, acHostId, 'GAME_EVENT', {
    event: 'PROJECTILE_HIT',
    data: { arrowId: 'arr_spoof_hs', targetKind: 'enemy', targetId: 'enemy-ac-1', archetype: 'bandit_scout', x: 0, y: 0.2, z: 6, isHeadshot: true },
  });
  await flush();
  const hsHitEvt = acHostMsgs.find(
    (m) => m.type === 'GAME_EVENT' && m.payload?.event === 'PROJECTILE_HIT',
  );
  assert.ok(hsHitEvt, 'Valid arrow hit processed');
  assert.equal(
    (hsHitEvt?.payload?.data as Record<string, unknown>)?.isHeadshot,
    false,
    'Ground-level headshot spoof stripped by server geometric validation',
  );

  // 26g. Profile /stats/delta impossible XP delta & forbidden level field rejected
  const acProfCreate = await workerApp.fetch(
    new Request('https://worker.example/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.212' },
      body: JSON.stringify({ displayName: 'ACProfile' }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(acProfCreate.status, 201);
  const acProfJson = (await acProfCreate.json()) as { sessionToken: string };
  const badXpStatsRes = await workerApp.fetch(
    new Request('https://worker.example/api/profile/stats', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${acProfJson.sessionToken}`,
        'CF-Connecting-IP': '198.51.100.212',
      },
      body: JSON.stringify({ xpGained: 999999 }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(badXpStatsRes.status, 400, 'Impossible xpGained delta rejected');
  const forgedLevelStatsRes = await workerApp.fetch(
    new Request('https://worker.example/api/profile/stats', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${acProfJson.sessionToken}`,
        'CF-Connecting-IP': '198.51.100.212',
      },
      body: JSON.stringify({ level: 99, coins: 999999999 }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(forgedLevelStatsRes.status, 403, 'Direct level/coins in /api/profile/stats rejected');

  // 26h. Security logs & implementation secrets never exposed to clients
  const stateHttpRes = await workerApp.fetch(
    new Request(`https://worker.example/api/multiplayer/rooms/${acRoomId}`, {
      method: 'GET',
      headers: { 'CF-Connecting-IP': '198.51.100.213' },
    }),
    fullEnv as never,
    ctxStub,
  );
  const stateBodyText = await stateHttpRes.text();
  assert.equal(
    /SECURITY_AUDIT|securityLogger|tokenHash|passwordHash/i.test(stateBodyText),
    false,
    'Room state response never exposes security logs or internal hashes',
  );
  for (const m of [...acHostMsgs, ...acGuestMsgs]) {
    if (m.type === 'ERROR') {
      const msgStr = String(m.payload?.message ?? '');
      assert.equal(
        /stack|tokenHash|passwordHash|DurableObject|\.ts:/i.test(msgStr),
        false,
        'Client error messages never leak implementation secrets',
      );
    }
  }

  // 26i. Room join rate limiting returns 429 on flood
  let joinRateLimited = false;
  for (let i = 0; i < 28; i++) {
    const r = await workerApp.fetch(
      new Request('https://worker.example/api/multiplayer/rooms/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.250' },
        body: JSON.stringify({ roomCodeOrId: 'INVALID99', playerName: 'FloodBot' }),
      }),
      fullEnv as never,
      ctxStub,
    );
    if (r.status === 429) {
      joinRateLimited = true;
      break;
    }
  }
  assert.ok(joinRateLimited, 'Room join endpoint enforces rate limiting (429)');

  acHostWs.close(1000, 'Done');
  acGuestWs.close(1000, 'Done');

  // =========================================================================
  // 27. SCALE (4 & 8 PLAYERS), AOI BANDWIDTH FILTERING, ADAPTIVE INTERPOLATION,
  //     HOST MIGRATION & RECONNECTION STATE SYNC
  // =========================================================================
  const scaleCreateRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.220' },
      body: JSON.stringify({
        roomName: 'Scale 8P Optimization Room',
        hostName: 'Player1',
        worldName: 'Grand Valley',
        worldType: 'normal',
        difficulty: 'normal',
        maxPlayers: 8,
        privacy: 'public',
        requireAllReady: false,
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(scaleCreateRes.status, 200, '8-player room created');
  const scaleCreateJson = (await scaleCreateRes.json()) as {
    room: { roomId: string; maxPlayers: number };
    playerId: string;
    sessionToken: string;
    resumeToken?: string;
  };
  const scaleRoomId = scaleCreateJson.room.roomId;
  assert.equal(scaleCreateJson.room.maxPlayers, 8);

  type ScaleClient = {
    name: string;
    playerId: string;
    sessionToken: string;
    resumeToken?: string;
    ws: MockWebSocket;
    msgs: Array<{ type: string; playerId?: string; payload?: Record<string, unknown> }>;
  };

  const openScaleWs = async (pid: string, tok: string) => {
    const res = (await workerApp.fetch(
      new Request(
        `https://worker.example/api/multiplayer/ws?roomId=${scaleRoomId}&playerId=${pid}&token=${tok}`,
        { headers: { Upgrade: 'websocket', Origin: 'https://abdelhaqelhafidy41-ops.github.io' } },
      ),
      fullEnv as never,
      ctxStub,
    )) as unknown as { status: number; webSocket: MockWebSocket };
    assert.equal(res.status, 101);
    return res.webSocket;
  };

  const scaleSend = (c: ScaleClient, type: string, payload?: unknown) => {
    c.ws.send(
      JSON.stringify({
        v: 1,
        type,
        roomId: scaleRoomId,
        playerId: c.playerId,
        timestamp: Date.now(),
        payload,
      }),
    );
  };

  const scaleClients: ScaleClient[] = [];
  {
    const ws1 = await openScaleWs(scaleCreateJson.playerId, scaleCreateJson.sessionToken);
    scaleClients.push({
      name: 'Player1',
      playerId: scaleCreateJson.playerId,
      sessionToken: scaleCreateJson.sessionToken,
      resumeToken: scaleCreateJson.resumeToken,
      ws: ws1,
      msgs: collectMessages(ws1),
    });
  }

  for (let idx = 2; idx <= 8; idx++) {
    const jRes = await workerApp.fetch(
      new Request('https://worker.example/api/multiplayer/rooms/join', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'CF-Connecting-IP': `198.51.100.${220 + idx}`,
        },
        body: JSON.stringify({
          roomCodeOrId: scaleRoomId,
          playerName: `Player${idx}`,
        }),
      }),
      fullEnv as never,
      ctxStub,
    );
    assert.equal(jRes.status, 200, `Player${idx} joined 8-player room`);
    const jJson = (await jRes.json()) as {
      playerId: string;
      sessionToken: string;
      resumeToken?: string;
    };
    const ws = await openScaleWs(jJson.playerId, jJson.sessionToken);
    scaleClients.push({
      name: `Player${idx}`,
      playerId: jJson.playerId,
      sessionToken: jJson.sessionToken,
      resumeToken: jJson.resumeToken,
      ws,
      msgs: collectMessages(ws),
    });
    if (idx === 4) {
      await flush();
      const latestRoom4 = scaleClients[0].msgs
        .filter((m) => m.type === 'ROOM_STATE')
        .pop()?.payload as { players?: Array<{ playerId: string }> } | undefined;
      assert.equal(latestRoom4?.players?.length, 4, '4-player milestone has 4 unique players');
    }
  }
  await flush();

  // 9th player rejected because room is at 8/8 capacity
  const ninthRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/rooms/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '198.51.100.240' },
      body: JSON.stringify({ roomCodeOrId: scaleRoomId, playerName: 'Player9' }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(ninthRes.status, 409, '9th player rejected on full 8-player room');

  // Start game with all 8 players
  for (const c of scaleClients) c.msgs.length = 0;
  scaleSend(scaleClients[0], 'START_GAME');
  await flush();
  for (const c of scaleClients) {
    assert.ok(c.msgs.some((m) => m.type === 'START_GAME'), `${c.name} received START_GAME`);
    assert.ok(c.msgs.some((m) => m.type === 'WORLD_SNAPSHOT'), `${c.name} received WORLD_SNAPSHOT`);
  }

  // 27b. Spatial Relevance (AOI) filtering on PLAYER_STATE & ENTITY_SYNC
  // Place Player 1 & Player 2 near origin, Player 3 far away at (300, 0, 300)
  // First move Player 3 gradually or set initial position (first PLAYER_STATE sets baseline position)
  scaleSend(scaleClients[0], 'PLAYER_STATE', { x: 2, y: 0, z: 2, yaw: 0, seq: 1 });
  scaleSend(scaleClients[1], 'PLAYER_STATE', { x: 8, y: 0, z: 4, yaw: 0, seq: 1 });
  scaleSend(scaleClients[2], 'PLAYER_STATE', { x: 300, y: 0, z: 300, yaw: 0, seq: 1 });
  await flush();

  scaleClients[1].msgs.length = 0;
  scaleClients[2].msgs.length = 0;
  // Send 5 rapid movement ticks from Player 1 (near Player 2, far from Player 3)
  for (let step = 2; step <= 6; step++) {
    scaleSend(scaleClients[0], 'PLAYER_STATE', {
      x: 2 + step * 0.4,
      y: 0,
      z: 2,
      yaw: 0.1,
      vx: 4,
      vz: 0,
      movementState: 'walking',
      seq: step,
    });
  }
  await flush();

  const nearRelays = scaleClients[1].msgs.filter(
    (m) => m.type === 'PLAYER_STATE' && m.playerId === scaleClients[0].playerId,
  );
  const farRelays = scaleClients[2].msgs.filter(
    (m) => m.type === 'PLAYER_STATE' && m.playerId === scaleClients[0].playerId,
  );
  assert.equal(nearRelays.length, 5, 'Nearby player receives all 5 high-frequency PLAYER_STATE updates');
  assert.ok(
    farRelays.length <= 1,
    `Distant player (>160m) throttled to <=1 low-frequency relay (got ${farRelays.length})`,
  );

  // ENTITY_SYNC spatial filtering: near NPC vs far NPC vs boss
  scaleClients[1].msgs.length = 0;
  scaleClients[2].msgs.length = 0;
  scaleSend(scaleClients[0], 'ENTITY_SYNC', {
    entities: [
      {
        id: 'npc-near-aoi',
        kind: 'npc',
        archetype: 'villager',
        x: 10,
        y: 0,
        z: 10,
        yaw: 0,
        state: 'walking',
        hp: 100,
        maxHp: 100,
        isDead: false,
      },
      {
        id: 'npc-far-aoi',
        kind: 'npc',
        archetype: 'merchant',
        x: 310,
        y: 0,
        z: 305,
        yaw: 0,
        state: 'idle',
        hp: 100,
        maxHp: 100,
        isDead: false,
      },
      {
        id: 'boss-global-aoi',
        kind: 'enemy',
        archetype: 'ancient_warden_boss',
        x: 500,
        y: 0,
        z: 500,
        yaw: 0,
        state: 'chase',
        hp: 400,
        maxHp: 400,
        isDead: false,
        isBoss: true,
      },
    ],
  });
  await flush();

  const p2Ents =
    (
      scaleClients[1].msgs.find((m) => m.type === 'ENTITY_SYNC')?.payload as {
        entities?: Array<{ id: string }>;
      }
    )?.entities ?? [];
  const p3Ents =
    (
      scaleClients[2].msgs.find((m) => m.type === 'ENTITY_SYNC')?.payload as {
        entities?: Array<{ id: string }>;
      }
    )?.entities ?? [];
  assert.ok(p2Ents.some((e) => e.id === 'npc-near-aoi'), 'Near player receives near NPC');
  assert.ok(!p2Ents.some((e) => e.id === 'npc-far-aoi'), 'Near player does NOT receive distant NPC (>150m)');
  assert.ok(p2Ents.some((e) => e.id === 'boss-global-aoi'), 'Boss state always synchronized');
  assert.ok(p3Ents.some((e) => e.id === 'npc-far-aoi'), 'Far player receives NPC near their own area');
  assert.ok(!p3Ents.some((e) => e.id === 'npc-near-aoi'), 'Far player does NOT receive origin NPC (>150m)');

  // 27c. Chat + Reconnect + Zero Duplicate Players or Chat Messages + Host Migration
  scaleSend(scaleClients[0], 'ROOM_CHAT', { message: 'Welcome all 8 adventurers!' });
  await flush();

  // Player 2 disconnects and reconnects cleanly
  scaleClients[1].ws.close(1006, 'Mobile handoff');
  await flush();
  const p2ReWs = await openScaleWs(scaleClients[1].playerId, scaleClients[1].sessionToken);
  const p2ReMsgs = collectMessages(p2ReWs);
  scaleClients[1].ws = p2ReWs;
  await flush();

  const p2ReSnap = p2ReMsgs.find((m) => m.type === 'WORLD_SNAPSHOT');
  const p2ReRoom = p2ReMsgs.find((m) => m.type === 'ROOM_STATE')?.payload as {
    players?: Array<{ playerId: string }>;
  };
  const p2ReChatHist = p2ReMsgs.find((m) => m.type === 'CHAT_HISTORY')?.payload as {
    messages?: Array<{ id: string }>;
  };
  assert.ok(p2ReSnap, 'Reconnected player receives full WORLD_SNAPSHOT');
  const uniqueIds = new Set((p2ReRoom?.players ?? []).map((p) => p.playerId));
  assert.equal(uniqueIds.size, 8, 'No duplicate players after reconnect in 8-player room');
  assert.equal(
    new Set((p2ReChatHist?.messages ?? []).map((m) => m.id)).size,
    (p2ReChatHist?.messages ?? []).length,
    'No duplicate chat messages after reconnect',
  );

  // Host leaves -> automatic host migration in 8-player room
  scaleClients[1].msgs = p2ReMsgs;
  p2ReMsgs.length = 0;
  scaleSend(scaleClients[0], 'LEAVE_ROOM');
  await flush();
  assert.ok(
    p2ReMsgs.some((m) => m.type === 'HOST_TRANSFERRED'),
    'Host migration triggers cleanly in 8-player room',
  );

  for (const c of scaleClients) {
    try {
      c.ws.close(1000, 'Scale test done');
    } catch {
      // Ignore already closed
    }
  }

  // 27d. Adaptive Jitter Interpolation smoothly absorbs mobile/Wi-Fi jitter
  const { RemoteSnapshotInterpolator } = await import('./src/game/multiplayer/RemotePlayersManager');
  const jitterInterp = new RemoteSnapshotInterpolator();
  const baseT = 100_000;
  const jitterOffsets = [0, 55, 10, 80, 15, 70, 5, 65];
  for (let i = 0; i < jitterOffsets.length; i++) {
    const serverTime = baseT + i * 50;
    const receivedAt = serverTime + jitterOffsets[i];
    jitterInterp.push(
      {
        x: i * 0.5,
        y: 0,
        z: 0,
        yaw: 0,
        vx: 10,
        vz: 0,
        seq: i + 1,
        serverTime,
      },
      receivedAt,
    );
  }
  const adaptedDelay = jitterInterp.getAdaptiveDelayMs();
  assert.ok(
    adaptedDelay > 88 && adaptedDelay <= 210,
    `Adaptive interpolation delay expanded for jitter (${adaptedDelay}ms)`,
  );
  const sampleA = jitterInterp.sample(baseT + 300);
  const sampleB = jitterInterp.sample(baseT + 325);
  assert.ok(sampleA && sampleB && sampleB.x >= sampleA.x, 'Interpolated position advances monotonically without teleporting');

  // 28. Avatar cleanup, Mountain Guardian emblem, legacy migration & multiplayer sync
  const {
    PRESET_AVATAR_IDS,
    LEGACY_PRESET_AVATAR_MIGRATIONS,
    migrateAvatarConfig,
    validateAvatarConfig,
  } = await import('./shared/profileTypes');
  const {
    PRESET_AVATARS,
    buildPresetAvatarDataUri,
    generateDeterministicAvatarDataUri,
    resolveAvatarSrc,
  } = await import('./src/game/profile/avatarUtils');
  const { parseRelayedChatMessage } = await import('./shared/multiplayerProtocol');

  assert.equal(
    (PRESET_AVATAR_IDS as readonly string[]).includes('knight'),
    false,
    'Legacy knight preset ID removed from selectable PRESET_AVATAR_IDS',
  );
  assert.equal(
    PRESET_AVATARS.some(
      (a) =>
        (a.id as string) === 'knight' ||
        a.labelEn === 'Valley Knight' ||
        a.labelAr === 'فارس الوادي',
    ),
    false,
    'Valley Knight removed from selectable PRESET_AVATARS',
  );
  const mgDef = PRESET_AVATARS.find((a) => a.id === 'mountain-guardian');
  assert.ok(mgDef, 'Mountain Guardian preset exists');
  assert.equal(mgDef.labelEn, 'Mountain Guardian');
  assert.equal(mgDef.labelAr, 'حارس الجبل');
  assert.equal(LEGACY_PRESET_AVATAR_MIGRATIONS.knight, 'mountain-guardian');

  const mgSvgUri = buildPresetAvatarDataUri('mountain-guardian');
  const mgSvgDecoded = decodeURIComponent(mgSvgUri);
  assert.ok(mgSvgDecoded.includes('M64 21L93 33v28'), 'Mountain Guardian has shield outline');
  assert.ok(mgSvgDecoded.includes('M42 71l10-16'), 'Mountain Guardian has alpine peak path');
  assert.equal(
    mgSvgDecoded.includes('M64 34v58M46 54h36'),
    false,
    'Mountain Guardian SVG has no religious cross path',
  );

  // Legacy migration helper + resolveAvatarSrc + validateAvatarConfig
  const migResult = migrateAvatarConfig({ kind: 'preset', value: 'knight', color: '#2563eb' });
  assert.equal(migResult.migrated, true);
  assert.deepEqual(migResult.avatar, {
    kind: 'preset',
    value: 'mountain-guardian',
    color: '#2563eb',
  });
  assert.equal(
    resolveAvatarSrc({ kind: 'preset', value: 'knight', color: '#3b82f6' }),
    resolveAvatarSrc({ kind: 'preset', value: 'mountain-guardian', color: '#3b82f6' }),
    'resolveAvatarSrc transparently upgrades legacy knight avatar to mountain-guardian',
  );

  const valMigrated = validateAvatarConfig({ kind: 'preset', value: 'knight', color: '#3b82f6' });
  assert.equal(valMigrated.ok, true);
  if (valMigrated.ok) {
    assert.equal(valMigrated.avatar.value, 'mountain-guardian');
  }
  const valUnknown = validateAvatarConfig({ kind: 'preset', value: 'unknown-emblem' });
  assert.equal(valUnknown.ok, false, 'Unknown preset ID still rejected');

  // Generated deterministic avatars across 50 seeds never emit legacy 4x4 grid or cross paths
  for (let i = 0; i < 50; i++) {
    const genUri = generateDeterministicAvatarDataUri(`WA-SEED-${i}`);
    const genSvg = decodeURIComponent(genUri.replace(/^data:image\/svg\+xml;utf8,/, ''));
    assert.ok(genSvg.startsWith('<svg '), `Generated avatar ${i} is valid SVG`);
    assert.equal(
      genSvg.includes('M64 34v58M46 54h36'),
      false,
      `Generated avatar ${i} contains no cross path`,
    );
  }

  // PlayerProfileDO persists migration of an existing user with 'knight' without losing ID/name/tag/stats/friends
  const legacyProfileState = createMockState();
  const legacyToken = 'legacy_migration_token_1234567890';
  const legacyTokenHash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(legacyToken))),
  )
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  await legacyProfileState.storage.put('player_profiles_directory_v1', {
    accounts: [
      {
        accountId: 'acc_legacy_1',
        publicProfileId: 'WA-LEGACY1',
        tokenHash: legacyTokenHash,
        displayName: 'AlphaHero',
        playerTag: '7742',
        avatar: { kind: 'preset', value: 'knight', color: '#3b82f6' },
        bio: 'Mountain explorer',
        country: 'SA',
        favoriteGameMode: 'adventure',
        manualStatus: 'online',
        statusNote: '',
        privacy: {
          showOnlineStatus: true,
          showPlayerName: true,
          allowFriendRequests: true,
          allowGameInvites: true,
          allowMessages: 'everyone',
        },
        stats: {
          level: 7,
          xp: 95,
          xpToNextLevel: 358,
          playTimeSeconds: 4200,
          worldsCreated: 3,
          worldsJoined: 5,
          questsCompleted: 11,
          enemiesDefeated: 42,
          animalsDefeated: 15,
          villagesDiscovered: 4,
          resourcesCollected: 190,
          distanceTraveledMeters: 8400,
          multiplayerSessions: 6,
          gamesHosted: 2,
        },
        currentRoomId: null,
        currentRoomName: null,
        friends: [{ accountId: 'acc_friend_1', addedAt: 1700000000000 }],
        blockedAccountIds: [],
        createdAt: 1700000000000,
        lastActiveAt: Date.now(),
        tagUpdatedAt: 1700000000000,
        lastDmSentAt: 0,
        lastReportAt: 0,
      },
      {
        accountId: 'acc_friend_1',
        publicProfileId: 'WA-FRIEND1',
        tokenHash: 'unused_hash_for_friend_1234567890abcdef',
        displayName: 'BestFriend',
        playerTag: '1122',
        avatar: { kind: 'preset', value: 'knight', color: '#1d4ed8' },
        bio: '',
        country: 'AE',
        favoriteGameMode: 'normal',
        manualStatus: 'online',
        statusNote: '',
        privacy: {
          showOnlineStatus: true,
          showPlayerName: true,
          allowFriendRequests: true,
          allowGameInvites: true,
          allowMessages: 'everyone',
        },
        stats: {
          level: 4,
          xp: 10,
          xpToNextLevel: 207,
          playTimeSeconds: 600,
          worldsCreated: 1,
          worldsJoined: 1,
          questsCompleted: 2,
          enemiesDefeated: 5,
          animalsDefeated: 2,
          villagesDiscovered: 1,
          resourcesCollected: 20,
          distanceTraveledMeters: 1000,
          multiplayerSessions: 1,
          gamesHosted: 0,
        },
        currentRoomId: null,
        currentRoomName: null,
        friends: [{ accountId: 'acc_legacy_1', addedAt: 1700000000000 }],
        blockedAccountIds: [],
        createdAt: 1700000000000,
        lastActiveAt: Date.now(),
        tagUpdatedAt: 1700000000000,
        lastDmSentAt: 0,
        lastReportAt: 0,
      },
    ],
    friendRequests: [],
    directMessages: [],
    reports: [],
  });

  const legacyProfileDo = new PlayerProfileDO(legacyProfileState as never, {} as never);
  const meMigRes = await legacyProfileDo.fetch(
    new Request('https://profile-do/me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${legacyToken}` },
    }),
  );
  assert.equal(meMigRes.status, 200);
  const meMigJson = (await meMigRes.json()) as {
    ok: boolean;
    profile: {
      publicProfileId: string;
      displayName: string;
      playerTag: string;
      avatar: { kind: string; value: string; color?: string };
      stats: { level: number; xp: number; enemiesDefeated: number };
      friendsCount: number;
    };
  };
  assert.equal(meMigJson.profile.avatar.value, 'mountain-guardian', 'Legacy knight migrated to mountain-guardian');
  assert.equal(meMigJson.profile.avatar.color, '#3b82f6');
  assert.equal(meMigJson.profile.publicProfileId, 'WA-LEGACY1', 'Player ID preserved');
  assert.equal(meMigJson.profile.displayName, 'AlphaHero', 'Display name preserved');
  assert.equal(meMigJson.profile.playerTag, '7742', 'Player tag preserved');
  assert.equal(meMigJson.profile.stats.level, 7, 'Level preserved');
  assert.equal(meMigJson.profile.stats.xp, 95, 'XP preserved');
  assert.equal(meMigJson.profile.stats.enemiesDefeated, 42, 'Stats preserved');
  assert.equal(meMigJson.profile.friendsCount, 1, 'Friends count preserved');

  // Verify friend list also serves migrated friend avatar
  const friendsMigRes = await legacyProfileDo.fetch(
    new Request('https://profile-do/friends', {
      method: 'GET',
      headers: { Authorization: `Bearer ${legacyToken}` },
    }),
  );
  const friendsMigJson = (await friendsMigRes.json()) as {
    friends: Array<{ publicProfileId: string; avatar: { value: string; color?: string } }>;
  };
  assert.equal(friendsMigJson.friends.length, 1);
  assert.equal(friendsMigJson.friends[0].publicProfileId, 'WA-FRIEND1');
  assert.equal(friendsMigJson.friends[0].avatar.value, 'mountain-guardian');
  assert.equal(friendsMigJson.friends[0].avatar.color, '#1d4ed8');

  // Verify parseRelayedChatMessage upgrades any stale legacy knight payload to mountain-guardian
  const sanChat = parseRelayedChatMessage({
    id: 'msg_mig_1',
    playerId: 'p_1',
    playerName: 'AlphaHero',
    avatar: { kind: 'preset', value: 'knight', color: '#3b82f6' },
    message: 'Greetings from the ridge!',
    timestamp: Date.now(),
  });
  assert.ok(sanChat);
  assert.equal(sanChat.avatar?.value, 'mountain-guardian');

  // Verify room creation & roster sync with migrated Mountain Guardian profile
  const mgCreateRoomRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/rooms', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${legacyToken}`,
        'CF-Connecting-IP': '198.51.100.77',
      },
      body: JSON.stringify({
        roomName: 'Mountain Watch',
        playerName: 'RidgeGuard',
        worldType: 'normal',
        maxPlayers: 4,
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  // Note: workerApp.fetch resolves profile via fullEnv.PLAYER_PROFILES; use p1Data updated to mountain-guardian
  assert.equal(mgCreateRoomRes.status, 200);
  const mgUpdateRes = await workerApp.fetch(
    new Request('https://worker.example/api/profile/update', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${p1Data.sessionToken}`,
        'CF-Connecting-IP': '198.51.100.22',
      },
      body: JSON.stringify({
        avatar: { kind: 'preset', value: 'mountain-guardian', color: '#3b82f6' },
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(mgUpdateRes.status, 200);
  const mgAuthRoomRes = await workerApp.fetch(
    new Request('https://worker.example/api/multiplayer/rooms', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${p1Data.sessionToken}`,
        'CF-Connecting-IP': '198.51.100.22',
      },
      body: JSON.stringify({
        roomName: 'Mountain Watch 2',
        playerName: 'IgnoredSpoof',
        worldType: 'normal',
        maxPlayers: 4,
      }),
    }),
    fullEnv as never,
    ctxStub,
  );
  assert.equal(mgAuthRoomRes.status, 200);
  const mgAuthRoomJson = (await mgAuthRoomRes.json()) as {
    room: { players: Array<{ avatar?: { kind: string; value: string } }> };
  };
  assert.equal(mgAuthRoomJson.room.players[0].avatar?.value, 'mountain-guardian');

  // 22. Farming, Village Development & Merchant Trade server-authoritative verification
  {
    const farmState = createMockState();
    const farmEnv = createMockEnv();
    const farmRoomDO = new MultiplayerRoomDO(farmState as never, farmEnv as never);
    const farmRoomId = 'room_farm_dev_test';

    const fCreate = (await (
      await farmRoomDO.fetch(
        new Request('https://internal/init', {
          method: 'POST',
          body: JSON.stringify({
            roomId: farmRoomId,
            roomName: 'Farming & Village Coop',
            playerName: 'FarmerHost',
            worldName: 'Oakhollow',
            worldType: 'normal',
            difficulty: 'normal',
            maxPlayers: 4,
          }),
        }),
      )
    ).json()) as { ok: boolean; playerId: string; sessionToken: string };
    assert.equal(fCreate.ok, true);

    const fJoin = (await (
      await farmRoomDO.fetch(
        new Request('https://internal/join', {
          method: 'POST',
          body: JSON.stringify({ playerName: 'VillageGuest' }),
        }),
      )
    ).json()) as { ok: boolean; playerId: string; sessionToken: string };
    assert.equal(fJoin.ok, true);

    const fHostWsRes = (await farmRoomDO.fetch(
      new Request(
        `https://internal/ws?playerId=${fCreate.playerId}&token=${fCreate.sessionToken}`,
        { headers: { Upgrade: 'websocket' } },
      ),
    )) as unknown as { status: number; webSocket: MockWebSocket };
    const fHostWs = fHostWsRes.webSocket;
    const fHostMsgs = collectMessages(fHostWs);

    const fGuestWsRes = (await farmRoomDO.fetch(
      new Request(
        `https://internal/ws?playerId=${fJoin.playerId}&token=${fJoin.sessionToken}`,
        { headers: { Upgrade: 'websocket' } },
      ),
    )) as unknown as { status: number; webSocket: MockWebSocket };
    let fGuestWs = fGuestWsRes.webSocket;
    let fGuestMsgs = collectMessages(fGuestWs);
    await flush();

    const fSend = (ws: MockWebSocket, pid: string, type: string, payload?: unknown) => {
      ws.send(JSON.stringify({ v: 1, type, roomId: farmRoomId, playerId: pid, timestamp: Date.now(), payload }));
    };

    fSend(fGuestWs, fJoin.playerId, 'READY', { ready: true });
    await flush();
    fSend(fHostWs, fCreate.playerId, 'START_GAME');
    await flush();

    // Move host near oakhollow square and gather wood, stone, fiber + wheat-seeds respecting the 200ms gather cooldown
    fSend(fHostWs, fCreate.playerId, 'PLAYER_STATE', { x: 8, y: 0, z: 8, yaw: 0 });
    await flush();
    const gatherResources = [
      { nodeId: 'farm_wood_a', itemId: 'wood', count: 5 },
      { nodeId: 'farm_wood_b', itemId: 'wood', count: 5 },
      { nodeId: 'farm_stone_a', itemId: 'stone', count: 4 },
      { nodeId: 'farm_fiber_a', itemId: 'fiber', count: 2, bonusSeedId: 'wheat-seeds' },
    ];
    for (const g of gatherResources) {
      fSend(fHostWs, fCreate.playerId, 'GAME_EVENT', {
        event: 'PLAYER_COLLECTED_RESOURCE',
        data: { ...g, x: 8, y: 0, z: 8 },
      });
      await new Promise((r) => setTimeout(r, 220));
    }
    await flush();

    // Place a small-farm-plot (costs 4 wood + 2 stone)
    fGuestMsgs.length = 0;
    fHostMsgs.length = 0;
    const plotId = 'plot_mp_verify_1';
    fSend(fHostWs, fCreate.playerId, 'GAME_EVENT', {
      event: 'PLAYER_BUILD_PLACE',
      data: {
        structureId: plotId,
        blueprintId: 'small-farm-plot',
        x: 12,
        y: 0,
        z: 12,
        yaw: 0,
        permissionScope: 'everyone',
      },
    });
    await flush();
    assert.ok(
      fGuestMsgs.some(
        (m) =>
          m.type === 'GAME_EVENT' &&
          (m.payload as { event?: string; data?: { structureId?: string } })?.event === 'PLAYER_BUILD_PLACE' &&
          (m.payload as { data?: { structureId?: string } })?.data?.structureId === plotId,
      ),
      'Farm plot placement broadcasts to guest',
    );

    // Reject planting before tilling soil
    fHostMsgs.length = 0;
    fSend(fHostWs, fCreate.playerId, 'GAME_EVENT', {
      event: 'PLAYER_FARM_PLANT',
      data: { structureId: plotId, cropId: 'wheat' },
    });
    await flush();
    assert.ok(
      fHostMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'FARM_SOIL_NOT_PREPARED'),
      'Cannot plant before tilling soil',
    );

    // Till -> Plant -> Water
    fSend(fHostWs, fCreate.playerId, 'GAME_EVENT', {
      event: 'PLAYER_FARM_TILL',
      data: { structureId: plotId },
    });
    await flush();
    fHostMsgs.length = 0;
    fSend(fHostWs, fCreate.playerId, 'GAME_EVENT', {
      event: 'PLAYER_FARM_PLANT',
      data: { structureId: plotId, cropId: 'wheat' },
    });
    await flush();
    assert.ok(
      fHostMsgs.some(
        (m) => m.type === 'GAME_EVENT' && (m.payload as { event?: string })?.event === 'PLAYER_FARM_PLANT',
      ),
      'Seed plants cleanly after tilling soil',
    );
    fSend(fHostWs, fCreate.playerId, 'GAME_EVENT', {
      event: 'PLAYER_FARM_WATER',
      data: { structureId: plotId },
    });
    await flush();

    // Reject premature harvest right after planting
    fHostMsgs.length = 0;
    fSend(fHostWs, fCreate.playerId, 'GAME_EVENT', {
      event: 'PLAYER_FARM_HARVEST',
      data: { structureId: plotId, cropId: 'wheat', villageId: 'oakhollow' },
    });
    await flush();
    assert.ok(
      fHostMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'FARM_CROP_NOT_READY'),
      'Premature crop harvest rejected server-side',
    );

    // Advance time using bed use (+22.3h from Day 1 8.2 to Day 2 6.5) so wheat matures, then harvest once and ensure duplicate harvest fails
    fSend(fHostWs, fCreate.playerId, 'GAME_EVENT', {
      event: 'BED_USED',
      data: { bedId: 'oakhollow-house-1-bed', x: 8, z: 8 },
    });
    await flush();
    fHostMsgs.length = 0;
    fSend(fHostWs, fCreate.playerId, 'GAME_EVENT', {
      event: 'PLAYER_FARM_HARVEST',
      data: { structureId: plotId, cropId: 'wheat', villageId: 'oakhollow' },
    });
    await flush();
    assert.ok(
      fHostMsgs.some(
        (m) => m.type === 'GAME_EVENT' && (m.payload as { event?: string })?.event === 'PLAYER_FARM_HARVEST',
      ),
      'Mature crop harvests cleanly on server',
    );
    fHostMsgs.length = 0;
    fSend(fHostWs, fCreate.playerId, 'GAME_EVENT', {
      event: 'PLAYER_FARM_HARVEST',
      data: { structureId: plotId, cropId: 'wheat', villageId: 'oakhollow' },
    });
    await flush();
    assert.ok(
      fHostMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'FARM_CROP_NOT_READY'),
      'Duplicate crop harvest prevented server-side',
    );

    // Village Repair + Village Defense + Level-gated Project check
    fHostMsgs.length = 0;
    fSend(fHostWs, fCreate.playerId, 'GAME_EVENT', {
      event: 'VILLAGE_REPAIR',
      data: { villageId: 'oakhollow', repairId: 'repair_storehouse' },
    });
    await flush();
    assert.ok(
      fHostMsgs.some(
        (m) => m.type === 'GAME_EVENT' && (m.payload as { event?: string })?.event === 'VILLAGE_REPAIR',
      ),
      'Village repair accepted & broadcast',
    );

    // Reject level-3 workshop project while Oakhollow is still Lv 1
    fHostMsgs.length = 0;
    fSend(fHostWs, fCreate.playerId, 'GAME_EVENT', {
      event: 'VILLAGE_PROJECT',
      data: { villageId: 'oakhollow', projectId: 'proj_workshop' },
    });
    await flush();
    assert.ok(
      fHostMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'VILLAGE_LEVEL_LOCKED'),
      'Level-locked village project rejected',
    );

    // Village defense won + spam cooldown guard
    fHostMsgs.length = 0;
    fSend(fHostWs, fCreate.playerId, 'GAME_EVENT', {
      event: 'VILLAGE_DEFENSE_WON',
      data: { villageId: 'oakhollow' },
    });
    await flush();
    assert.ok(
      fHostMsgs.some(
        (m) => m.type === 'GAME_EVENT' && (m.payload as { event?: string })?.event === 'VILLAGE_DEFENSE_WON',
      ),
      'Village defense victory accepted',
    );
    fHostMsgs.length = 0;
    fSend(fHostWs, fCreate.playerId, 'GAME_EVENT', {
      event: 'VILLAGE_DEFENSE_WON',
      data: { villageId: 'oakhollow' },
    });
    await flush();
    assert.ok(
      fHostMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'VILLAGE_DEFENSE_COOLDOWN'),
      'Village defense spam cooldown enforced',
    );

    // Merchant Buy & Sell: sell harvested wheat to earn coins, then buy carrot-seeds, reject level-4 offer
    fHostMsgs.length = 0;
    fSend(fHostWs, fCreate.playerId, 'GAME_EVENT', {
      event: 'MERCHANT_SELL',
      data: { villageId: 'oakhollow', itemId: 'wheat', count: 2 },
    });
    await flush();
    assert.ok(
      fHostMsgs.some(
        (m) => m.type === 'GAME_EVENT' && (m.payload as { event?: string })?.event === 'MERCHANT_SELL',
      ),
      'Merchant sell succeeds for harvested wheat',
    );

    fHostMsgs.length = 0;
    fSend(fHostWs, fCreate.playerId, 'GAME_EVENT', {
      event: 'MERCHANT_BUY',
      data: { villageId: 'oakhollow', offerId: 'offer-wheat-seeds' },
    });
    await flush();
    assert.ok(
      fHostMsgs.some(
        (m) => m.type === 'GAME_EVENT' && (m.payload as { event?: string })?.event === 'MERCHANT_BUY',
      ),
      'Merchant buy succeeds for unlocked seeds',
    );

    fHostMsgs.length = 0;
    fSend(fHostWs, fCreate.playerId, 'GAME_EVENT', {
      event: 'MERCHANT_BUY',
      data: { villageId: 'oakhollow', offerId: 'offer-buy-cow' },
    });
    await flush();
    assert.ok(
      fHostMsgs.some((m) => m.type === 'ERROR' && m.payload?.code === 'MERCHANT_LEVEL_LOCKED'),
      'Level-locked merchant offer rejected server-side',
    );

    // Reconnect snapshot retains villagesDev & farm plot state
    const fReconnect = (await farmRoomDO.fetch(
      new Request(
        `https://internal/ws?playerId=${fJoin.playerId}&token=${fJoin.sessionToken}`,
        { headers: { Upgrade: 'websocket' } },
      ),
    )) as unknown as { status: number; webSocket: MockWebSocket };
    fGuestWs = fReconnect.webSocket;
    fGuestMsgs = collectMessages(fGuestWs);
    await flush();
    const fSnap = fGuestMsgs.find((m) => m.type === 'WORLD_SNAPSHOT')?.payload as {
      villagesDev?: Array<{
        villageId: string;
        level: number;
        completedRepairIds: string[];
        defensesWonCount: number;
      }>;
      playerBuildings?: Array<{ id: string; farmSoilPrepared?: boolean }>;
    };
    const oakSnap = fSnap?.villagesDev?.find((v) => v.villageId === 'oakhollow');
    assert.ok(oakSnap, 'WORLD_SNAPSHOT persists villagesDev');
    assert.ok(
      oakSnap.completedRepairIds.includes('repair_storehouse'),
      'Snapshot restores completed repair',
    );
    assert.equal(oakSnap.defensesWonCount, 1, 'Snapshot restores defense count');
    assert.ok(
      oakSnap.level >= 2,
      'Oakhollow leveled up from repair + harvest + defense + trade',
    );
    const snapPlot = fSnap.playerBuildings?.find((b) => b.id === plotId);
    assert.ok(snapPlot && snapPlot.farmSoilPrepared === true, 'Snapshot restores prepared farm plot');
  }

  console.log('ALL MULTIPLAYER, PERSISTENCE, PROFILE, PARTY/CO-OP, ANTI-CHEAT & OPTIMIZATION TESTS PASSED');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
