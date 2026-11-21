'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const dgram = require('node:dgram');
const os = require('node:os');

const MAX_LAN_PLAYERS = 4;
const DEFAULT_LAN_PORT = 41234;
const DISCOVERY_PORT = 41235;
const DISCOVERY_MAGIC = 'WOA_LAN_V1';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_HTTP_BODY_BYTES = 16_384;
const MAX_WS_PAYLOAD_BYTES = 65_536;

const AVATAR_COLORS = ['#6ab06e', '#e5a93c', '#58b4d1', '#d96b6b'];
const PARTY_MARKER_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899'];
const TIME_PRESET_HOURS = {
  sunrise: 6.0,
  noon: 12.0,
  sunset: 18.0,
  midnight: 0.0,
};
const VALID_WEATHER_STATES = new Set(['clear', 'cloudy', 'overcast', 'rain', 'storm', 'fog']);
const VALID_MOVEMENT_STATES = new Set(['idle', 'walking', 'running', 'jumping', 'falling']);
const TIME_SYNC_INTERVAL_MS = 5000;

function getLocalIpv4Addresses() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, list] of Object.entries(ifaces)) {
    if (!Array.isArray(list)) continue;
    for (const info of list) {
      if (info.family !== 'IPv4' || info.internal) continue;
      // Prefer private RFC1918 Wi-Fi/Ethernet LAN addresses
      const isPrivate =
        info.address.startsWith('192.168.') ||
        info.address.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(info.address);
      candidates.push({ name, address: info.address, isPrivate });
    }
  }
  candidates.sort((a, b) => Number(b.isPrivate) - Number(a.isPrivate));
  return candidates.map((c) => c.address);
}

function getPrimaryLanIp() {
  const ips = getLocalIpv4Addresses();
  return ips[0] || '127.0.0.1';
}

function randomId(prefix, bytes = 8) {
  return `${prefix}_${crypto.randomBytes(bytes).toString('base64url')}`;
}

function generateLanCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = crypto.randomBytes(4);
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += chars[buf[i] % chars.length];
  }
  return out;
}

function sanitizeText(raw, maxLen, fallback = '') {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLen);
  return cleaned || fallback;
}

function encodeWsFrame(text, opcode = 0x1) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function encodeWsCloseFrame(code = 1000, reason = '') {
  const reasonBuf = Buffer.from(String(reason).slice(0, 100), 'utf8');
  const payload = Buffer.alloc(2 + reasonBuf.length);
  payload.writeUInt16BE(code, 0);
  reasonBuf.copy(payload, 2);
  const header = Buffer.alloc(2);
  header[0] = 0x88;
  header[1] = payload.length;
  return Buffer.concat([header, payload]);
}

function createWsSocketWrapper(rawSocket) {
  let recvBuffer = Buffer.alloc(0);
  let closed = false;
  const listeners = { message: [], close: [] };

  function emitClose(code, reason) {
    if (closed) return;
    closed = true;
    for (const fn of listeners.close) {
      try {
        fn(code, reason);
      } catch {
        // Ignore handler errors
      }
    }
  }

  rawSocket.on('data', (chunk) => {
    if (closed) return;
    recvBuffer = Buffer.concat([recvBuffer, chunk]);
    while (recvBuffer.length >= 2) {
      const b0 = recvBuffer[0];
      const b1 = recvBuffer[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (recvBuffer.length < 4) return;
        payloadLen = recvBuffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (recvBuffer.length < 10) return;
        const bigLen = recvBuffer.readBigUInt64BE(2);
        if (bigLen > BigInt(MAX_WS_PAYLOAD_BYTES)) {
          wrapper.close(1009, 'Message too large');
          return;
        }
        payloadLen = Number(bigLen);
        offset = 10;
      }

      if (payloadLen > MAX_WS_PAYLOAD_BYTES) {
        wrapper.close(1009, 'Message too large');
        return;
      }

      const maskLen = masked ? 4 : 0;
      const totalLen = offset + maskLen + payloadLen;
      if (recvBuffer.length < totalLen) return;

      let payload = recvBuffer.subarray(offset + maskLen, totalLen);
      if (masked) {
        const maskKey = recvBuffer.subarray(offset, offset + 4);
        const unmasked = Buffer.allocUnsafe(payloadLen);
        for (let i = 0; i < payloadLen; i++) {
          unmasked[i] = payload[i] ^ maskKey[i & 3];
        }
        payload = unmasked;
      } else {
        payload = Buffer.from(payload);
      }

      recvBuffer = recvBuffer.subarray(totalLen);

      if (opcode === 0x8) {
        // Close frame
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
        const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : '';
        try {
          rawSocket.write(encodeWsCloseFrame(1000, ''));
        } catch {
          // Ignore
        }
        rawSocket.end();
        emitClose(code, reason);
        return;
      } else if (opcode === 0x9) {
        // Ping -> Pong
        try {
          rawSocket.write(encodeWsFrame(payload.toString('utf8'), 0x0a));
        } catch {
          // Ignore
        }
      } else if (opcode === 0x1) {
        const text = payload.toString('utf8');
        for (const fn of listeners.message) {
          try {
            fn(text);
          } catch {
            // Ignore handler errors
          }
        }
      }
    }
  });

  rawSocket.on('close', () => emitClose(1006, 'Socket closed'));
  rawSocket.on('error', () => emitClose(1006, 'Socket error'));

  const wrapper = {
    isOpen: () => !closed && !rawSocket.destroyed && rawSocket.writable,
    send(obj) {
      if (!wrapper.isOpen()) return false;
      try {
        const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
        rawSocket.write(encodeWsFrame(text, 0x1));
        return true;
      } catch {
        return false;
      }
    },
    close(code = 1000, reason = '') {
      if (closed) return;
      try {
        rawSocket.write(encodeWsCloseFrame(code, reason));
      } catch {
        // Ignore
      }
      try {
        rawSocket.end();
      } catch {
        // Ignore
      }
      emitClose(code, reason);
    },
    onMessage(fn) {
      listeners.message.push(fn);
    },
    onClose(fn) {
      listeners.close.push(fn);
    },
  };

  return wrapper;
}

class OfflineLanServer {
  constructor() {
    this.httpServer = null;
    this.discoverySocket = null;
    this.timeSyncTimer = null;
    this.port = DEFAULT_LAN_PORT;
    this.room = null;
    this.sessions = new Map(); // playerId -> { token, ws, player }
    this.chatHistory = [];
    this.seqCounter = 0;
  }

  materializeWorldTime(now = Date.now()) {
    if (!this.room || !this.room.worldTime) {
      return {
        worldHours: 8.5,
        dayCount: 1,
        timeScale: 1,
        paused: false,
        fullDayDurationSeconds: 360,
        anchorServerMs: now,
      };
    }
    const wt = this.room.worldTime;
    const fullDaySec =
      typeof wt.fullDayDurationSeconds === 'number' && Number.isFinite(wt.fullDayDurationSeconds)
        ? Math.max(30, Math.min(1800, wt.fullDayDurationSeconds))
        : 360;
    const timeScale =
      typeof wt.timeScale === 'number' && Number.isFinite(wt.timeScale)
        ? Math.max(0, Math.min(10, wt.timeScale))
        : 1;
    let worldHours =
      typeof wt.worldHours === 'number' && Number.isFinite(wt.worldHours)
        ? ((wt.worldHours % 24) + 24) % 24
        : 8.5;
    let dayCount =
      typeof wt.dayCount === 'number' && Number.isFinite(wt.dayCount)
        ? Math.max(1, Math.floor(wt.dayCount))
        : 1;
    const anchorMs =
      typeof wt.anchorServerMs === 'number' && Number.isFinite(wt.anchorServerMs)
        ? wt.anchorServerMs
        : now;

    if (!wt.paused && timeScale > 0 && fullDaySec > 0 && now > anchorMs) {
      const elapsedSec = Math.max(0, (now - anchorMs) / 1000);
      const total = worldHours + elapsedSec * (24 / fullDaySec) * timeScale;
      if (total >= 24) {
        dayCount += Math.floor(total / 24);
      }
      worldHours = ((total % 24) + 24) % 24;
    }

    wt.worldHours = Math.round(worldHours * 1000) / 1000;
    wt.dayCount = dayCount;
    wt.timeScale = timeScale;
    wt.paused = Boolean(wt.paused);
    wt.fullDayDurationSeconds = fullDaySec;
    wt.anchorServerMs = now;
    return { ...wt };
  }

  startTimeSyncLoop() {
    this.stopTimeSyncLoop();
    this.timeSyncTimer = setInterval(() => {
      if (!this.room || this.room.status !== 'in-game') return;
      let hasOpenSocket = false;
      for (const sess of this.sessions.values()) {
        if (sess.ws && sess.ws.isOpen()) {
          hasOpenSocket = true;
          break;
        }
      }
      if (!hasOpenSocket) return;
      const now = Date.now();
      const worldTime = this.materializeWorldTime(now);
      this.broadcast('WORLD_TIME_CHANGED', 'server', {
        worldTime,
        serverTimestamp: now,
        updatedBy: this.room.hostId,
      });
    }, TIME_SYNC_INTERVAL_MS);
    if (typeof this.timeSyncTimer.unref === 'function') {
      this.timeSyncTimer.unref();
    }
  }

  stopTimeSyncLoop() {
    if (this.timeSyncTimer) {
      clearInterval(this.timeSyncTimer);
      this.timeSyncTimer = null;
    }
  }

  buildPartySnapshotForPlayer(playerId) {
    if (!this.room) {
      return { party: null, pendingInvites: [], outgoingInvites: [] };
    }
    const player = this.room.players.get(playerId);
    const party = player && player.partyId ? this.room.parties.get(player.partyId) || null : null;
    const pendingInvites = [];
    const outgoingInvites = [];
    for (const inv of this.room.partyInvites.values()) {
      if (inv.status !== 'pending') continue;
      if (inv.toPlayerId === playerId) pendingInvites.push({ ...inv });
      if (inv.fromPlayerId === playerId) outgoingInvites.push({ ...inv });
    }
    return {
      party: party ? this.serializeParty(party) : null,
      pendingInvites,
      outgoingInvites,
    };
  }

  serializeParty(party) {
    return {
      partyId: party.partyId,
      roomId: party.roomId,
      leaderPlayerId: party.leaderPlayerId,
      maxMembers: MAX_LAN_PLAYERS,
      createdAt: party.createdAt,
      activeObjective: party.activeObjective ? { ...party.activeObjective } : null,
      members: party.memberIds
        .map((pid, idx) => {
          const p = this.room ? this.room.players.get(pid) : null;
          if (!p) return null;
          return {
            playerId: p.playerId,
            displayName: p.displayName,
            avatarColor: p.avatarColor,
            level: p.level ?? 1,
            health: p.health ?? 100,
            maxHealth: p.maxHealth ?? 100,
            isDead: Boolean(p.isDead),
            online: true,
            isReady: Boolean(p.partyReady),
            joinedAt: p.partyJoinedAt ?? p.joinedAt,
            markerIndex: idx,
            markerColor: PARTY_MARKER_COLORS[idx % PARTY_MARKER_COLORS.length],
          };
        })
        .filter(Boolean),
    };
  }

  broadcastAllPartyStates() {
    if (!this.room) return;
    for (const pid of this.room.players.keys()) {
      this.sendTo(pid, 'PARTY_STATE', this.buildPartySnapshotForPlayer(pid));
    }
  }

  removePlayerFromParty(playerId) {
    if (!this.room) return;
    const player = this.room.players.get(playerId);
    // Clean up any pending invites involving this player
    for (const [invId, inv] of this.room.partyInvites.entries()) {
      if (inv.fromPlayerId === playerId || inv.toPlayerId === playerId) {
        this.room.partyInvites.delete(invId);
      }
    }
    if (!player || !player.partyId) return;
    const party = this.room.parties.get(player.partyId);
    player.partyId = null;
    player.partyReady = false;
    if (!party) return;
    party.memberIds = party.memberIds.filter((id) => id !== playerId);
    if (party.memberIds.length === 0) {
      this.room.parties.delete(party.partyId);
    } else if (party.leaderPlayerId === playerId) {
      party.leaderPlayerId = party.memberIds[0];
    }
  }

  buildWorldSnapshotForPlayer(playerId, now = Date.now()) {
    if (!this.room) return null;
    const worldTime = this.materializeWorldTime(now);
    return {
      openedChests: [],
      collectedPickups: [],
      depletedResources: [],
      doors: [],
      placedBeds: [],
      placedStations: [],
      playerBuildings: [],
      villagesDev: [],
      droppedItems: [],
      quests: [],
      discoveredLandmarks: ['spawn-glade'],
      deadEntities: [],
      worldSettingsPermission: this.room.worldSettingsPermission || 'HOST_ONLY',
      worldSettings: {
        worldType: this.room.worldType,
        difficulty: this.room.difficulty,
        pvpEnabled: false,
        friendlyFire: Boolean(this.room.friendlyFire),
        staminaUnlimited: this.room.worldType === 'creative',
        spawnX: 0,
        spawnY: 0,
        spawnZ: 4,
      },
      worldTime,
      worldWeather: { ...this.room.worldWeather },
      serverTimestamp: now,
      partyState: this.buildPartySnapshotForPlayer(playerId),
      coopQuests: [],
      bossEncounters: [],
    };
  }

  getStatus() {
    const ip = getPrimaryLanIp();
    return {
      running: Boolean(this.httpServer && this.httpServer.listening),
      ip,
      allIps: getLocalIpv4Addresses(),
      port: this.port,
      address: `${ip}:${this.port}`,
      baseUrl: `http://${ip}:${this.port}`,
      room: this.room ? this.buildRoomSnapshot() : null,
    };
  }

  buildRoomSnapshot() {
    if (!this.room) return null;
    const now = Date.now();
    const worldTime = this.materializeWorldTime(now);
    return {
      roomId: this.room.roomId,
      roomCode: this.room.roomCode,
      roomName: this.room.roomName,
      hostId: this.room.hostId,
      hostName: this.room.hostName,
      maxPlayers: MAX_LAN_PLAYERS,
      status: this.room.status,
      createdAt: this.room.createdAt,
      lastActivityAt: now,
      serverTimestamp: now,
      worldTime,
      worldWeather: { ...this.room.worldWeather },
      players: Array.from(this.room.players.values()).map((p) => ({
        playerId: p.playerId,
        networkEntityId: p.networkEntityId,
        displayName: p.displayName,
        isHost: p.playerId === this.room.hostId,
        isReady: p.isReady,
        joinedAt: p.joinedAt,
        avatarColor: p.avatarColor,
        pingMs: p.pingMs ?? 2,
        connectionQuality: 'excellent',
        level: p.level ?? 1,
        partyId: p.partyId ?? null,
        health: p.health ?? 100,
        maxHealth: p.maxHealth ?? 100,
        isDead: Boolean(p.isDead),
        state: p.state,
      })),
      gameState: {
        worldName: this.room.worldName,
        worldType: this.room.worldType,
        difficulty: this.room.difficulty,
        seed: this.room.seed,
        privacy: 'public',
        isPrivate: false,
        allowFriends: true,
        requireAllReady: false,
        worldSettingsPermission: this.room.worldSettingsPermission || 'HOST_ONLY',
        worldSettings: {
          worldType: this.room.worldType,
          difficulty: this.room.difficulty,
          pvpEnabled: false,
          friendlyFire: Boolean(this.room.friendlyFire),
          staminaUnlimited: this.room.worldType === 'creative',
          spawnX: 0,
          spawnY: 0,
          spawnZ: 4,
        },
        locked: false,
        hasPassword: false,
      },
    };
  }

  createEnvelope(type, playerId, payload) {
    return {
      type,
      roomId: this.room ? this.room.roomId : '',
      playerId,
      seq: ++this.seqCounter,
      timestamp: Date.now(),
      payload,
    };
  }

  broadcast(type, senderId, payload, excludePlayerId = null) {
    const env = this.createEnvelope(type, senderId, payload);
    const json = JSON.stringify(env);
    for (const [pid, sess] of this.sessions.entries()) {
      if (excludePlayerId && pid === excludePlayerId) continue;
      if (sess.ws && sess.ws.isOpen()) {
        sess.ws.send(json);
      }
    }
  }

  sendTo(playerId, type, payload) {
    const sess = this.sessions.get(playerId);
    if (!sess || !sess.ws || !sess.ws.isOpen()) return;
    sess.ws.send(this.createEnvelope(type, 'server', payload));
  }

  initRoom(options = {}) {
    const hostName = sanitizeText(options.playerName, 24, 'Host');
    const roomName = sanitizeText(options.roomName, 36, 'World of Adventure LAN');
    const worldName = sanitizeText(options.worldName, 36, roomName);
    const worldType = options.worldType === 'creative' ? 'creative' : 'normal';
    const difficulty =
      options.difficulty === 'easy' || options.difficulty === 'hard'
        ? options.difficulty
        : 'normal';
    const seed =
      typeof options.seed === 'number' && Number.isFinite(options.seed)
        ? Math.floor(options.seed)
        : Math.floor(100000 + Math.random() * 899999);

    const roomId = randomId('lan', 9);
    const roomCode = generateLanCode();
    const hostId = randomId('pl', 8);
    const hostToken = randomId('tok', 16);
    const now = Date.now();

    const hostPlayer = {
      playerId: hostId,
      networkEntityId: `net_${hostId}`,
      displayName: hostName,
      isHost: true,
      isReady: true,
      joinedAt: now,
      avatarColor: AVATAR_COLORS[0],
      pingMs: 1,
      level: 1,
      partyId: null,
      partyReady: false,
      partyJoinedAt: now,
      health: 100,
      maxHealth: 100,
      isDead: false,
      state: {
        x: 0,
        y: 0,
        z: 4,
        yaw: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        movementState: 'idle',
        crouching: false,
        grounded: true,
        networkEntityId: `net_${hostId}`,
        health: 100,
        maxHealth: 100,
        isDead: false,
        serverTime: now,
      },
    };

    this.room = {
      roomId,
      roomCode,
      roomName,
      worldName,
      worldType,
      difficulty,
      seed,
      hostId,
      hostName,
      status: 'waiting',
      createdAt: now,
      worldSettingsPermission: 'HOST_ONLY',
      friendlyFire: false,
      players: new Map([[hostId, hostPlayer]]),
      parties: new Map(),
      partyInvites: new Map(),
      worldTime: {
        worldHours: 8.5,
        dayCount: 1,
        fullDayDurationSeconds: 360,
        timeScale: 1,
        paused: false,
        anchorServerMs: now,
      },
      worldWeather: {
        currentState: 'clear',
        targetState: 'clear',
        intensity: 0,
        dynamicEnabled: true,
        transitionDurationSeconds: 14,
        startMs: now,
        durationMs: 240_000,
        endMs: now + 240_000,
      },
    };

    this.sessions.clear();
    this.sessions.set(hostId, { token: hostToken, ws: null, player: hostPlayer });
    this.chatHistory = [];
    this.startTimeSyncLoop();

    return {
      ok: true,
      room: this.buildRoomSnapshot(),
      playerId: hostId,
      sessionToken: hostToken,
      wsPath: `/api/multiplayer/ws?roomId=${encodeURIComponent(roomId)}&playerId=${encodeURIComponent(hostId)}&token=${encodeURIComponent(hostToken)}`,
    };
  }

  joinPlayer(options = {}) {
    if (!this.room) {
      return { status: 404, body: { ok: false, error: 'ROOM_NOT_FOUND', message: 'LAN game not found.' } };
    }
    const codeOrId = String(options.roomCodeOrId || '').trim();
    if (
      codeOrId &&
      codeOrId.toUpperCase() !== this.room.roomCode.toUpperCase() &&
      codeOrId !== this.room.roomId
    ) {
      return { status: 404, body: { ok: false, error: 'ROOM_NOT_FOUND', message: 'Invalid LAN code.' } };
    }
    if (this.room.players.size >= MAX_LAN_PLAYERS) {
      return {
        status: 409,
        body: { ok: false, error: 'ROOM_FULL', message: 'LAN GAME FULL (4 / 4 players).' },
      };
    }

    const displayName = sanitizeText(options.playerName, 24, `Player ${this.room.players.size + 1}`);
    const playerId = randomId('pl', 8);
    if (this.room.players.has(playerId)) {
      return { status: 409, body: { ok: false, error: 'DUPLICATE_PLAYER_ID', message: 'Duplicate player ID.' } };
    }
    const token = randomId('tok', 16);
    const now = Date.now();
    const colorIdx = this.room.players.size % AVATAR_COLORS.length;
    const spawnOffset = (this.room.players.size - 1) * 2.2;

    const player = {
      playerId,
      networkEntityId: `net_${playerId}`,
      displayName,
      isHost: false,
      isReady: false,
      joinedAt: now,
      avatarColor: AVATAR_COLORS[colorIdx],
      pingMs: 4,
      level: 1,
      partyId: null,
      partyReady: false,
      partyJoinedAt: now,
      health: 100,
      maxHealth: 100,
      isDead: false,
      state: {
        x: spawnOffset,
        y: 0,
        z: 4,
        yaw: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        movementState: 'idle',
        crouching: false,
        grounded: true,
        networkEntityId: `net_${playerId}`,
        health: 100,
        maxHealth: 100,
        isDead: false,
        serverTime: now,
      },
    };

    this.room.players.set(playerId, player);
    this.sessions.set(playerId, { token, ws: null, player });

    const snap = this.buildRoomSnapshot();
    this.broadcast('PLAYER_JOIN', playerId, {
      player: snap.players.find((p) => p.playerId === playerId),
      room: snap,
    }, playerId);
    this.broadcast('ROOM_STATE', 'server', snap);

    return {
      status: 200,
      body: {
        ok: true,
        room: snap,
        playerId,
        sessionToken: token,
        wsPath: `/api/multiplayer/ws?roomId=${encodeURIComponent(this.room.roomId)}&playerId=${encodeURIComponent(playerId)}&token=${encodeURIComponent(token)}`,
      },
    };
  }

  removePlayer(playerId, reason = 'disconnected') {
    if (!this.room || !this.room.players.has(playerId)) return;
    const isHost = playerId === this.room.hostId;
    this.removePlayerFromParty(playerId);
    const sess = this.sessions.get(playerId);
    if (sess && sess.ws && sess.ws.isOpen()) {
      sess.ws.close(1000, reason);
    }
    this.sessions.delete(playerId);
    this.room.players.delete(playerId);

    if (isHost) {
      this.stopTimeSyncLoop();
      // Gracefully close LAN session when host leaves so no client crashes or corrupts saves
      this.broadcast('ROOM_CLOSED', 'server', {
        reason: 'LAN host ended the session.',
      });
      for (const [, other] of this.sessions.entries()) {
        if (other.ws && other.ws.isOpen()) {
          other.ws.close(4000, 'LAN host ended the session.');
        }
      }
      this.sessions.clear();
      this.room = null;
      return;
    }

    const snap = this.buildRoomSnapshot();
    this.broadcast('PLAYER_LEAVE', playerId, { playerId, reason, room: snap });
    this.broadcast('ROOM_STATE', 'server', snap);
    this.broadcastAllPartyStates();
  }

  handleWsMessage(playerId, rawText) {
    if (!this.room || !this.room.players.has(playerId)) return;
    let msg;
    try {
      msg = JSON.parse(rawText);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    const player = this.room.players.get(playerId);
    const payload = msg.payload && typeof msg.payload === 'object' ? msg.payload : {};

    switch (msg.type) {
      case 'CONNECT': {
        if (typeof payload.displayName === 'string' && payload.displayName.trim()) {
          player.displayName = sanitizeText(payload.displayName, 24, player.displayName);
        }
        const now = Date.now();
        const snap = this.buildRoomSnapshot();
        this.sendTo(playerId, 'CONNECT', {
          playerId,
          room: snap,
        });
        this.broadcast('ROOM_STATE', 'server', snap);
        const worldSnap = this.buildWorldSnapshotForPlayer(playerId, now);
        if (worldSnap) {
          this.sendTo(playerId, 'WORLD_SNAPSHOT', worldSnap);
        }
        this.sendTo(playerId, 'CHAT_HISTORY', {
          messages: this.chatHistory.slice(),
        });
        this.sendTo(playerId, 'PARTY_STATE', this.buildPartySnapshotForPlayer(playerId));
        if (this.room.status === 'in-game') {
          this.sendTo(playerId, 'START_GAME', {
            roomId: this.room.roomId,
            roomCode: this.room.roomCode,
            roomName: this.room.roomName,
            seed: this.room.seed,
            worldName: this.room.worldName,
            worldType: this.room.worldType,
            difficulty: this.room.difficulty,
            hostId: this.room.hostId,
            worldSettingsPermission: this.room.worldSettingsPermission || 'HOST_ONLY',
            worldSettings: snap.gameState.worldSettings,
            worldTime: snap.worldTime,
            worldWeather: snap.worldWeather,
            requireAllReady: false,
            room: snap,
          });
        }
        break;
      }

      case 'PING': {
        this.sendTo(playerId, 'PONG', {
          clientSentAt: typeof payload.clientSentAt === 'number' ? payload.clientSentAt : Date.now(),
          serverTimestamp: Date.now(),
        });
        break;
      }

      case 'READY': {
        player.isReady = Boolean(payload.ready);
        this.broadcast('ROOM_STATE', 'server', this.buildRoomSnapshot());
        break;
      }

      case 'START_GAME': {
        if (playerId !== this.room.hostId) return;
        const now = Date.now();
        this.room.status = 'in-game';
        // Anchor world time cleanly at game start
        this.materializeWorldTime(now);
        const snap = this.buildRoomSnapshot();
        this.broadcast('ROOM_STATE', 'server', snap);
        for (const pid of this.room.players.keys()) {
          const wsSnap = this.buildWorldSnapshotForPlayer(pid, now);
          if (wsSnap) this.sendTo(pid, 'WORLD_SNAPSHOT', wsSnap);
        }
        this.broadcast('START_GAME', playerId, {
          roomId: this.room.roomId,
          roomCode: this.room.roomCode,
          roomName: this.room.roomName,
          seed: this.room.seed,
          worldName: this.room.worldName,
          worldType: this.room.worldType,
          difficulty: this.room.difficulty,
          hostId: this.room.hostId,
          worldSettingsPermission: this.room.worldSettingsPermission || 'HOST_ONLY',
          worldSettings: snap.gameState.worldSettings,
          worldTime: snap.worldTime,
          worldWeather: snap.worldWeather,
          requireAllReady: false,
          room: snap,
        });
        break;
      }

      case 'PLAYER_STATE': {
        const x = Number(payload.x);
        const y = Number(payload.y);
        const z = Number(payload.z);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
        const now = Date.now();
        const flatState = {
          x: Math.round(x * 1000) / 1000,
          y: Math.round(y * 1000) / 1000,
          z: Math.round(z * 1000) / 1000,
          yaw: Number.isFinite(Number(payload.yaw)) ? Math.round(Number(payload.yaw) * 1000) / 1000 : 0,
          vx: Number.isFinite(Number(payload.vx)) ? Math.round(Number(payload.vx) * 100) / 100 : 0,
          vy: Number.isFinite(Number(payload.vy)) ? Math.round(Number(payload.vy) * 100) / 100 : 0,
          vz: Number.isFinite(Number(payload.vz)) ? Math.round(Number(payload.vz) * 100) / 100 : 0,
          movementState: VALID_MOVEMENT_STATES.has(payload.movementState) ? payload.movementState : 'idle',
          sprinting: Boolean(payload.sprinting),
          jumping: Boolean(payload.jumping),
          crouching: Boolean(payload.crouching),
          grounded: payload.grounded !== false,
          networkEntityId: player.networkEntityId,
          health: player.health ?? 100,
          maxHealth: player.maxHealth ?? 100,
          isDead: Boolean(player.isDead),
          serverTime: now,
        };
        if (Number.isFinite(Number(payload.aimYaw))) {
          flatState.aimYaw = Math.round(Number(payload.aimYaw) * 1000) / 1000;
        }
        if (Number.isFinite(Number(payload.pitch))) {
          flatState.pitch = Math.round(Number(payload.pitch) * 1000) / 1000;
        }
        if (typeof payload.animState === 'string' && payload.animState.length > 0) {
          flatState.animState = payload.animState.slice(0, 32);
        }
        if (payload.weaponId === null) {
          flatState.weaponId = null;
        } else if (typeof payload.weaponId === 'string' && payload.weaponId.length > 0) {
          flatState.weaponId = payload.weaponId.slice(0, 48);
        }
        if (typeof payload.bowCharging === 'boolean') {
          flatState.bowCharging = payload.bowCharging;
        }
        if (Number.isFinite(Number(payload.bowCharge))) {
          flatState.bowCharge = Math.max(0, Math.min(1, Math.round(Number(payload.bowCharge) * 100) / 100));
        }
        if (typeof payload.shooting === 'boolean') {
          flatState.shooting = payload.shooting;
        }
        if (typeof payload.reloading === 'boolean') {
          flatState.reloading = payload.reloading;
        }
        if (typeof payload.seq === 'number' && Number.isInteger(payload.seq) && payload.seq >= 0) {
          flatState.seq = payload.seq;
        }
        player.state = flatState;
        // Relay flat PlayerNetworkState directly so parseRelayedPlayerStatePayload accepts it
        this.broadcast('PLAYER_STATE', playerId, flatState, playerId);
        break;
      }

      case 'ENTITY_SYNC': {
        // Only authoritative LAN host broadcasts shared NPC/enemy/animal states
        if (playerId !== this.room.hostId) return;
        this.broadcast('ENTITY_SYNC', playerId, payload, playerId);
        break;
      }

      case 'WORLD_SETTINGS_UPDATE': {
        const isHost = playerId === this.room.hostId;
        if (payload.worldSettingsPermission !== undefined && isHost) {
          if (payload.worldSettingsPermission === 'HOST_ONLY' || payload.worldSettingsPermission === 'ALL_PLAYERS') {
            this.room.worldSettingsPermission = payload.worldSettingsPermission;
          }
        }
        if (typeof payload.friendlyFire === 'boolean' && isHost) {
          this.room.friendlyFire = payload.friendlyFire;
        }
        if (!isHost && this.room.worldSettingsPermission !== 'ALL_PLAYERS') {
          this.sendTo(playerId, 'ERROR', {
            code: 'FORBIDDEN_WORLD_SETTINGS',
            message: 'Host currently restricts world time and weather controls.',
          });
          return;
        }
        const now = Date.now();
        this.materializeWorldTime(now);
        const wt = this.room.worldTime;
        let timeChanged = false;

        if (typeof payload.preset === 'string' && Object.prototype.hasOwnProperty.call(TIME_PRESET_HOURS, payload.preset)) {
          wt.worldHours = TIME_PRESET_HOURS[payload.preset];
          wt.anchorServerMs = now;
          timeChanged = true;
        }
        if (typeof payload.worldHours === 'number' && Number.isFinite(payload.worldHours)) {
          wt.worldHours = Math.round((((payload.worldHours % 24) + 24) % 24) * 1000) / 1000;
          wt.anchorServerMs = now;
          timeChanged = true;
        }
        if (typeof payload.dayCount === 'number' && Number.isFinite(payload.dayCount)) {
          wt.dayCount = Math.max(1, Math.floor(payload.dayCount));
          wt.anchorServerMs = now;
          timeChanged = true;
        }
        if (typeof payload.timeScale === 'number' && Number.isFinite(payload.timeScale)) {
          wt.timeScale = Math.max(0, Math.min(10, payload.timeScale));
          wt.anchorServerMs = now;
          timeChanged = true;
        }
        if (typeof payload.paused === 'boolean') {
          wt.paused = payload.paused;
          wt.anchorServerMs = now;
          timeChanged = true;
        }
        if (typeof payload.fullDayDurationSeconds === 'number' && Number.isFinite(payload.fullDayDurationSeconds)) {
          wt.fullDayDurationSeconds = Math.max(30, Math.min(1800, payload.fullDayDurationSeconds));
          wt.anchorServerMs = now;
          timeChanged = true;
        }
        if (payload.worldTime && typeof payload.worldTime === 'object') {
          if (typeof payload.worldTime.worldHours === 'number' && Number.isFinite(payload.worldTime.worldHours)) {
            wt.worldHours = Math.round((((payload.worldTime.worldHours % 24) + 24) % 24) * 1000) / 1000;
            wt.anchorServerMs = now;
            timeChanged = true;
          }
        }

        const ww = this.room.worldWeather;
        if (typeof payload.weatherState === 'string' && VALID_WEATHER_STATES.has(payload.weatherState)) {
          ww.currentState = payload.weatherState;
          ww.targetState = payload.weatherState;
          ww.startMs = now;
          const dur =
            typeof payload.durationMs === 'number' && Number.isFinite(payload.durationMs)
              ? Math.max(30_000, Math.min(900_000, payload.durationMs))
              : ww.durationMs || 240_000;
          ww.durationMs = dur;
          ww.endMs = now + dur;
        }
        if (typeof payload.targetWeatherState === 'string' && VALID_WEATHER_STATES.has(payload.targetWeatherState)) {
          ww.targetState = payload.targetWeatherState;
          ww.startMs = now;
          const dur =
            typeof payload.durationMs === 'number' && Number.isFinite(payload.durationMs)
              ? Math.max(30_000, Math.min(900_000, payload.durationMs))
              : ww.durationMs || 240_000;
          ww.durationMs = dur;
          ww.endMs = now + dur;
        }
        if (typeof payload.weatherIntensity === 'number' && Number.isFinite(payload.weatherIntensity)) {
          ww.intensity = Math.max(0, Math.min(1, payload.weatherIntensity));
        }
        if (typeof payload.dynamicEnabled === 'boolean') {
          ww.dynamicEnabled = payload.dynamicEnabled;
        }
        if (typeof payload.transitionDurationSeconds === 'number' && Number.isFinite(payload.transitionDurationSeconds)) {
          ww.transitionDurationSeconds = Math.max(2, Math.min(120, payload.transitionDurationSeconds));
        }

        const worldTimeOut = { ...wt };
        const worldWeatherOut = { ...ww };
        this.broadcast('WORLD_SETTINGS_UPDATED', playerId, {
          worldSettingsPermission: this.room.worldSettingsPermission || 'HOST_ONLY',
          friendlyFire: Boolean(this.room.friendlyFire),
          worldTime: worldTimeOut,
          worldWeather: worldWeatherOut,
          triggerLightning: Boolean(payload.triggerLightning),
          serverTimestamp: now,
          updatedBy: playerId,
        });
        if (timeChanged) {
          this.broadcast('WORLD_TIME_CHANGED', playerId, {
            worldTime: worldTimeOut,
            serverTimestamp: now,
            updatedBy: playerId,
          });
        }
        break;
      }

      case 'GAME_EVENT': {
        if (typeof payload.event !== 'string') return;
        // Relay validated gameplay events (combat, projectiles, doors, chests, beds, drops, gathering)
        this.broadcast('GAME_EVENT', playerId, {
          event: payload.event.slice(0, 64),
          data: payload.data && typeof payload.data === 'object' ? payload.data : {},
          actorId: playerId,
          serverTimestamp: Date.now(),
        }, playerId);
        break;
      }

      case 'ROOM_CHAT': {
        const text = sanitizeText(payload.message, 240, '');
        if (!text) return;
        const chatMsg = {
          id: randomId('chat', 6),
          playerId,
          playerName: player.displayName,
          message: text,
          timestamp: Date.now(),
        };
        this.chatHistory.push(chatMsg);
        if (this.chatHistory.length > 40) {
          this.chatHistory.shift();
        }
        this.broadcast('ROOM_CHAT', playerId, chatMsg);
        break;
      }

      case 'PARTY_CREATE': {
        if (player.partyId && this.room.parties.has(player.partyId)) {
          this.sendTo(playerId, 'PARTY_STATE', this.buildPartySnapshotForPlayer(playerId));
          break;
        }
        const now = Date.now();
        const partyId = randomId('party', 6);
        const party = {
          partyId,
          roomId: this.room.roomId,
          leaderPlayerId: playerId,
          memberIds: [playerId],
          createdAt: now,
          activeObjective: null,
        };
        this.room.parties.set(partyId, party);
        player.partyId = partyId;
        player.partyReady = true;
        player.partyJoinedAt = now;
        this.broadcastAllPartyStates();
        this.broadcast('ROOM_STATE', 'server', this.buildRoomSnapshot());
        break;
      }

      case 'PARTY_INVITE': {
        let targetPlayer = null;
        if (typeof payload.targetPlayerId === 'string' && payload.targetPlayerId) {
          targetPlayer = this.room.players.get(payload.targetPlayerId) || null;
        } else if (typeof payload.targetPlayerName === 'string' && payload.targetPlayerName.trim()) {
          const needle = payload.targetPlayerName.trim().toLowerCase();
          for (const p of this.room.players.values()) {
            if (p.displayName.toLowerCase() === needle) {
              targetPlayer = p;
              break;
            }
          }
        }
        if (!targetPlayer || targetPlayer.playerId === playerId) return;

        // Auto-create party for inviter if not already in one
        let party = player.partyId ? this.room.parties.get(player.partyId) : null;
        const now = Date.now();
        if (!party) {
          const partyId = randomId('party', 6);
          party = {
            partyId,
            roomId: this.room.roomId,
            leaderPlayerId: playerId,
            memberIds: [playerId],
            createdAt: now,
            activeObjective: null,
          };
          this.room.parties.set(partyId, party);
          player.partyId = partyId;
          player.partyReady = true;
          player.partyJoinedAt = now;
        }
        if (party.leaderPlayerId !== playerId) {
          this.sendTo(playerId, 'ERROR', {
            code: 'FORBIDDEN_PARTY_LEADER',
            message: 'Only the party leader can invite players.',
          });
          return;
        }
        if (party.memberIds.length >= MAX_LAN_PLAYERS) {
          this.sendTo(playerId, 'ERROR', {
            code: 'PARTY_FULL',
            message: 'Party is full.',
          });
          return;
        }
        if (party.memberIds.includes(targetPlayer.playerId)) return;

        // Avoid duplicate pending invite
        for (const existing of this.room.partyInvites.values()) {
          if (
            existing.status === 'pending' &&
            existing.partyId === party.partyId &&
            existing.toPlayerId === targetPlayer.playerId
          ) {
            this.sendTo(playerId, 'ERROR', {
              code: 'DUPLICATE_PARTY_INVITE',
              message: 'Invite already sent to this player.',
            });
            return;
          }
        }

        const invite = {
          inviteId: randomId('pinv', 6),
          partyId: party.partyId,
          roomId: this.room.roomId,
          fromPlayerId: playerId,
          fromPlayerName: player.displayName,
          toPlayerId: targetPlayer.playerId,
          toPlayerName: targetPlayer.displayName,
          createdAt: now,
          status: 'pending',
        };
        this.room.partyInvites.set(invite.inviteId, invite);
        this.sendTo(targetPlayer.playerId, 'PARTY_INVITE_RECEIVED', invite);
        this.broadcastAllPartyStates();
        this.broadcast('ROOM_STATE', 'server', this.buildRoomSnapshot());
        break;
      }

      case 'PARTY_ACCEPT_INVITE': {
        const inviteId = typeof payload.inviteId === 'string' ? payload.inviteId : '';
        const invite = this.room.partyInvites.get(inviteId);
        if (!invite || invite.status !== 'pending' || invite.toPlayerId !== playerId) return;
        const party = this.room.parties.get(invite.partyId);
        if (!party) {
          this.room.partyInvites.delete(inviteId);
          this.broadcastAllPartyStates();
          return;
        }
        if (party.memberIds.length >= MAX_LAN_PLAYERS) {
          this.sendTo(playerId, 'ERROR', { code: 'PARTY_FULL', message: 'Party is full.' });
          return;
        }
        if (player.partyId && player.partyId !== party.partyId) {
          this.removePlayerFromParty(playerId);
        }
        invite.status = 'accepted';
        this.room.partyInvites.delete(inviteId);
        if (!party.memberIds.includes(playerId)) {
          party.memberIds.push(playerId);
        }
        player.partyId = party.partyId;
        player.partyReady = false;
        player.partyJoinedAt = Date.now();
        this.broadcastAllPartyStates();
        this.broadcast('ROOM_STATE', 'server', this.buildRoomSnapshot());
        break;
      }

      case 'PARTY_DECLINE_INVITE': {
        const inviteId = typeof payload.inviteId === 'string' ? payload.inviteId : '';
        const invite = this.room.partyInvites.get(inviteId);
        if (!invite || invite.toPlayerId !== playerId) return;
        this.room.partyInvites.delete(inviteId);
        this.broadcastAllPartyStates();
        break;
      }

      case 'PARTY_LEAVE': {
        this.removePlayerFromParty(playerId);
        this.broadcastAllPartyStates();
        this.broadcast('ROOM_STATE', 'server', this.buildRoomSnapshot());
        break;
      }

      case 'PARTY_KICK': {
        const targetId = typeof payload.targetPlayerId === 'string' ? payload.targetPlayerId : '';
        if (!targetId || targetId === playerId || !player.partyId) return;
        const party = this.room.parties.get(player.partyId);
        if (!party || party.leaderPlayerId !== playerId) return;
        if (!party.memberIds.includes(targetId)) return;
        this.removePlayerFromParty(targetId);
        this.broadcastAllPartyStates();
        this.broadcast('ROOM_STATE', 'server', this.buildRoomSnapshot());
        break;
      }

      case 'PARTY_TRANSFER_LEADER': {
        const targetId = typeof payload.targetPlayerId === 'string' ? payload.targetPlayerId : '';
        if (!targetId || !player.partyId) return;
        const party = this.room.parties.get(player.partyId);
        if (!party || party.leaderPlayerId !== playerId || !party.memberIds.includes(targetId)) return;
        party.leaderPlayerId = targetId;
        this.broadcastAllPartyStates();
        break;
      }

      case 'PARTY_SET_READY': {
        if (!player.partyId) return;
        player.partyReady = Boolean(payload.ready);
        this.broadcastAllPartyStates();
        break;
      }

      case 'PARTY_START_OBJECTIVE': {
        if (!player.partyId) return;
        const party = this.room.parties.get(player.partyId);
        if (!party || party.leaderPlayerId !== playerId) return;
        const now = Date.now();
        const obj = {
          objectiveId: randomId('pobj', 6),
          partyId: party.partyId,
          type: typeof payload.type === 'string' ? payload.type : 'explore',
          title: sanitizeText(payload.title, 64, 'Team Objective'),
          targetId: typeof payload.targetId === 'string' ? payload.targetId : undefined,
          targetX: Number.isFinite(Number(payload.targetX)) ? Number(payload.targetX) : undefined,
          targetZ: Number.isFinite(Number(payload.targetZ)) ? Number(payload.targetZ) : undefined,
          targetCount: Number.isFinite(Number(payload.targetCount)) ? Math.max(1, Math.floor(Number(payload.targetCount))) : 1,
          currentCount: 0,
          status: 'active',
          startedAt: now,
          contributions: {},
          rewardsByPlayer: {},
        };
        party.activeObjective = obj;
        for (const memberId of party.memberIds) {
          this.sendTo(memberId, 'PARTY_OBJECTIVE_UPDATED', obj);
        }
        this.broadcastAllPartyStates();
        break;
      }

      case 'PARTY_CANCEL_OBJECTIVE': {
        if (!player.partyId) return;
        const party = this.room.parties.get(player.partyId);
        if (!party || party.leaderPlayerId !== playerId) return;
        party.activeObjective = null;
        this.broadcastAllPartyStates();
        break;
      }

      case 'COOP_OBJECTIVE_PROGRESS': {
        if (!player.partyId) return;
        const party = this.room.parties.get(player.partyId);
        if (!party || !party.activeObjective || party.activeObjective.status !== 'active') return;
        const obj = party.activeObjective;
        if (typeof payload.objectiveId === 'string' && payload.objectiveId && payload.objectiveId !== obj.objectiveId) return;
        const inc = Number.isFinite(Number(payload.amount)) ? Math.max(1, Math.floor(Number(payload.amount))) : 1;
        obj.currentCount = Math.min(obj.targetCount, obj.currentCount + inc);
        const completed = obj.currentCount >= obj.targetCount;
        if (completed) {
          obj.status = 'completed';
          obj.completedAt = Date.now();
        }
        const evType = completed ? 'PARTY_OBJECTIVE_COMPLETED' : 'PARTY_OBJECTIVE_UPDATED';
        for (const memberId of party.memberIds) {
          this.sendTo(memberId, evType, obj);
        }
        this.broadcastAllPartyStates();
        break;
      }

      case 'LEAVE_ROOM':
      case 'DISCONNECT': {
        this.removePlayer(playerId, 'left');
        break;
      }

      case 'KICK_PLAYER': {
        if (playerId !== this.room.hostId) return;
        const targetId = typeof payload.targetPlayerId === 'string' ? payload.targetPlayerId : '';
        if (!targetId || targetId === this.room.hostId || !this.room.players.has(targetId)) return;
        this.sendTo(targetId, 'PLAYER_KICKED', {
          targetPlayerId: targetId,
          reason: 'Removed by LAN host.',
        });
        this.removePlayer(targetId, 'kicked');
        break;
      }

      case 'CLOSE_ROOM': {
        if (playerId === this.room.hostId) {
          this.removePlayer(playerId, 'closed');
        }
        break;
      }

      default:
        break;
    }
  }

  readJsonBody(req) {
    return new Promise((resolve) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_HTTP_BODY_BYTES) {
          resolve({ ok: false, status: 413, error: 'PAYLOAD_TOO_LARGE' });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (!raw) {
          resolve({ ok: true, data: {} });
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            resolve({ ok: false, status: 400, error: 'INVALID_JSON_BODY' });
            return;
          }
          resolve({ ok: true, data: parsed });
        } catch {
          resolve({ ok: false, status: 400, error: 'INVALID_JSON_BODY' });
        }
      });
      req.on('error', () => resolve({ ok: false, status: 400, error: 'READ_ERROR' }));
    });
  }

  sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }

  async start(preferredPort = DEFAULT_LAN_PORT, roomOptions = null) {
    if (this.httpServer && this.httpServer.listening) {
      const hostInfo = roomOptions ? this.initRoom(roomOptions) : null;
      return { ok: true, ...this.getStatus(), hostSession: hostInfo };
    }

    this.port = Number(preferredPort) > 1024 && Number(preferredPort) < 65535
      ? Math.floor(Number(preferredPort))
      : DEFAULT_LAN_PORT;

    const server = http.createServer(async (req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        });
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);

      if (req.method === 'GET' && url.pathname === '/health') {
        this.sendJson(res, 200, {
          ok: true,
          service: 'world-of-adventure-lan',
          mode: 'offline-lan',
          maxPlayers: MAX_LAN_PLAYERS,
          playerCount: this.room ? this.room.players.size : 0,
          roomCode: this.room ? this.room.roomCode : null,
          roomName: this.room ? this.room.roomName : null,
          hostName: this.room ? this.room.hostName : null,
          status: this.room ? this.room.status : 'idle',
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/multiplayer/rooms') {
        const snap = this.buildRoomSnapshot();
        this.sendJson(res, 200, { ok: true, rooms: snap ? [snap] : [] });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/multiplayer/rooms/verify') {
        if (!this.room) {
          this.sendJson(res, 404, { ok: false, error: 'ROOM_NOT_FOUND', message: 'LAN game not found.' });
          return;
        }
        const codeOrId = (url.searchParams.get('codeOrId') || '').trim();
        if (
          codeOrId &&
          codeOrId.toUpperCase() !== this.room.roomCode.toUpperCase() &&
          codeOrId !== this.room.roomId
        ) {
          this.sendJson(res, 404, { ok: false, error: 'ROOM_NOT_FOUND', message: 'Invalid LAN code.' });
          return;
        }
        if (this.room.players.size >= MAX_LAN_PLAYERS) {
          this.sendJson(res, 409, {
            ok: false,
            error: 'ROOM_FULL',
            message: 'LAN GAME FULL (4 / 4 players).',
          });
          return;
        }
        this.sendJson(res, 200, { ok: true, room: this.buildRoomSnapshot() });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/multiplayer/rooms') {
        const parsed = await this.readJsonBody(req);
        if (!parsed.ok) {
          this.sendJson(res, parsed.status, { ok: false, error: parsed.error });
          return;
        }
        const created = this.initRoom(parsed.data);
        this.sendJson(res, 200, created);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/multiplayer/rooms/join') {
        const parsed = await this.readJsonBody(req);
        if (!parsed.ok) {
          this.sendJson(res, parsed.status, { ok: false, error: parsed.error });
          return;
        }
        const result = this.joinPlayer(parsed.data);
        this.sendJson(res, result.status, result.body);
        return;
      }

      this.sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
    });

    server.on('upgrade', (req, socket) => {
      const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);
      if (url.pathname !== '/api/multiplayer/ws') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      const roomId = url.searchParams.get('roomId') || '';
      const playerId = url.searchParams.get('playerId') || '';
      const token = url.searchParams.get('token') || '';
      const sess = this.sessions.get(playerId);

      if (!this.room || this.room.roomId !== roomId || !sess || sess.token !== token) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      const key = req.headers['sec-websocket-key'];
      if (!key) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      const acceptKey = crypto
        .createHash('sha1')
        .update(key + WS_GUID)
        .digest('base64');

      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${acceptKey}`,
          '\r\n',
        ].join('\r\n'),
      );

      if (sess.ws && sess.ws.isOpen()) {
        sess.ws.close(4002, 'Replaced by newer connection');
      }

      const ws = createWsSocketWrapper(socket);
      sess.ws = ws;
      ws.onMessage((text) => this.handleWsMessage(playerId, text));
      ws.onClose(() => {
        if (sess.ws === ws) {
          this.removePlayer(playerId, 'disconnected');
        }
      });
    });

    await new Promise((resolve, reject) => {
      const onError = (err) => {
        server.off('listening', onListening);
        if (err && err.code === 'EADDRINUSE' && this.port === DEFAULT_LAN_PORT) {
          // Retry on an ephemeral port if 41234 is already occupied
          this.port = 0;
          server.listen(0, '0.0.0.0');
          return;
        }
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        resolve();
      };
      server.on('error', onError);
      server.once('listening', onListening);
      server.listen(this.port, '0.0.0.0');
    });

    this.httpServer = server;
    this.startDiscoveryResponder();

    const hostSession = roomOptions ? this.initRoom(roomOptions) : null;
    return {
      ok: true,
      ...this.getStatus(),
      hostSession,
    };
  }

  startDiscoveryResponder() {
    if (this.discoverySocket) return;
    try {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('error', () => {
        // Non-fatal if another instance holds UDP discovery port
      });
      sock.on('message', (msg, rinfo) => {
        if (!this.room) return;
        const text = msg.toString('utf8').trim();
        if (!text.startsWith(`${DISCOVERY_MAGIC}:DISCOVER`)) return;
        const announcement = JSON.stringify({
          magic: DISCOVERY_MAGIC,
          type: 'ANNOUNCE',
          ip: getPrimaryLanIp(),
          port: this.port,
          roomId: this.room.roomId,
          roomCode: this.room.roomCode,
          roomName: this.room.roomName,
          hostName: this.room.hostName,
          worldName: this.room.worldName,
          worldType: this.room.worldType,
          difficulty: this.room.difficulty,
          playerCount: this.room.players.size,
          maxPlayers: MAX_LAN_PLAYERS,
          status: this.room.status,
        });
        const buf = Buffer.from(announcement, 'utf8');
        sock.send(buf, 0, buf.length, rinfo.port, rinfo.address, () => {});
      });
      sock.bind(DISCOVERY_PORT, '0.0.0.0', () => {
        try {
          sock.setBroadcast(true);
        } catch {
          // Ignore
        }
      });
      this.discoverySocket = sock;
    } catch {
      // Non-fatal; manual IP join still works
    }
  }

  async stop() {
    this.stopTimeSyncLoop();
    if (this.room) {
      this.broadcast('ROOM_CLOSED', 'server', { reason: 'LAN server stopped.' });
    }
    for (const [, sess] of this.sessions.entries()) {
      if (sess.ws && sess.ws.isOpen()) {
        sess.ws.close(4000, 'LAN server stopped.');
      }
    }
    this.sessions.clear();
    this.room = null;

    if (this.discoverySocket) {
      try {
        this.discoverySocket.close();
      } catch {
        // Ignore
      }
      this.discoverySocket = null;
    }

    if (this.httpServer) {
      const srv = this.httpServer;
      this.httpServer = null;
      await new Promise((resolve) => {
        srv.close(() => resolve());
      });
    }
    return { ok: true };
  }
}

function discoverLanHosts(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const found = new Map();
    let finished = false;
    let sock;

    const done = () => {
      if (finished) return;
      finished = true;
      if (sock) {
        try {
          sock.close();
        } catch {
          // Ignore
        }
      }
      resolve(Array.from(found.values()));
    };

    try {
      sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('error', () => done());
      sock.on('message', (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString('utf8'));
          if (data && data.magic === DISCOVERY_MAGIC && data.type === 'ANNOUNCE' && data.roomId) {
            const hostIp = rinfo.address || data.ip;
            found.set(`${hostIp}:${data.port}`, {
              ip: hostIp,
              port: Number(data.port) || DEFAULT_LAN_PORT,
              address: `${hostIp}:${Number(data.port) || DEFAULT_LAN_PORT}`,
              baseUrl: `http://${hostIp}:${Number(data.port) || DEFAULT_LAN_PORT}`,
              roomId: String(data.roomId),
              roomCode: String(data.roomCode || ''),
              roomName: String(data.roomName || 'World of Adventure'),
              hostName: String(data.hostName || 'Host'),
              worldName: String(data.worldName || 'World of Adventure'),
              worldType: ['normal', 'survival', 'adventure', 'creative'].includes(data.worldType)
                ? data.worldType
                : 'normal',
              difficulty: String(data.difficulty || 'normal'),
              playerCount: Number(data.playerCount) || 1,
              maxPlayers: MAX_LAN_PLAYERS,
              status: String(data.status || 'waiting'),
            });
          }
        } catch {
          // Ignore malformed UDP datagrams
        }
      });

      sock.bind(0, () => {
        try {
          sock.setBroadcast(true);
        } catch {
          // Ignore
        }
        const probe = Buffer.from(`${DISCOVERY_MAGIC}:DISCOVER`, 'utf8');
        sock.send(probe, 0, probe.length, DISCOVERY_PORT, '255.255.255.255', () => {});
        sock.send(probe, 0, probe.length, DISCOVERY_PORT, '127.0.0.1', () => {});
        // Also probe subnet broadcast addresses for multi-homed Wi-Fi routers
        for (const ip of getLocalIpv4Addresses()) {
          const parts = ip.split('.');
          if (parts.length === 4) {
            const bcast = `${parts[0]}.${parts[1]}.${parts[2]}.255`;
            sock.send(probe, 0, probe.length, DISCOVERY_PORT, bcast, () => {});
          }
        }
      });

      setTimeout(done, Math.max(400, Math.min(4000, timeoutMs)));
    } catch {
      done();
    }
  });
}

module.exports = {
  OfflineLanServer,
  discoverLanHosts,
  getPrimaryLanIp,
  getLocalIpv4Addresses,
  MAX_LAN_PLAYERS,
  DEFAULT_LAN_PORT,
  DISCOVERY_PORT,
};
