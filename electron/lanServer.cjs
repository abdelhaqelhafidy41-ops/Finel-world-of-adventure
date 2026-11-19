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
    this.port = DEFAULT_LAN_PORT;
    this.room = null;
    this.sessions = new Map(); // playerId -> { token, ws, player }
    this.chatHistory = [];
    this.seqCounter = 0;
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
      worldTime: this.room.worldTime,
      worldWeather: this.room.worldWeather,
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
        worldSettingsPermission: 'HOST_ONLY',
        worldSettings: {
          worldType: this.room.worldType,
          difficulty: this.room.difficulty,
          pvpEnabled: false,
          friendlyFire: false,
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
        anim: 'idle',
        crouching: false,
        grounded: true,
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
      players: new Map([[hostId, hostPlayer]]),
      worldTime: {
        normalizedTime: 0.32,
        dayCount: 1,
        fullDayDurationSeconds: 360,
        timeScale: 1,
        paused: false,
        serverTimestamp: now,
      },
      worldWeather: {
        currentState: 'clear',
        targetState: 'clear',
        transitionProgress: 1,
        intensity: 0,
        dynamicEnabled: true,
        transitionDurationSeconds: 14,
        windSpeedKmh: 12,
        serverTimestamp: now,
      },
    };

    this.sessions.clear();
    this.sessions.set(hostId, { token: hostToken, ws: null, player: hostPlayer });
    this.chatHistory = [];

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
        anim: 'idle',
        crouching: false,
        grounded: true,
      },
    };

    this.room.players.set(playerId, player);
    this.sessions.set(playerId, { token, ws: null, player });

    const snap = this.buildRoomSnapshot();
    this.broadcast('PLAYER_JOIN', playerId, {
      player: snap.players.find((p) => p.playerId === playerId),
      room: snap,
    }, playerId);
    this.broadcast('ROOM_STATE', 'server', { room: snap });

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
    const sess = this.sessions.get(playerId);
    if (sess && sess.ws && sess.ws.isOpen()) {
      sess.ws.close(1000, reason);
    }
    this.sessions.delete(playerId);
    this.room.players.delete(playerId);

    if (isHost) {
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
    this.broadcast('ROOM_STATE', 'server', { room: snap });
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
        const snap = this.buildRoomSnapshot();
        this.sendTo(playerId, 'CONNECT', {
          playerId,
          room: snap,
          chatHistory: this.chatHistory,
        });
        this.broadcast('ROOM_STATE', 'server', { room: snap });
        if (this.room.status === 'playing') {
          this.sendTo(playerId, 'GAME_START', {
            roomId: this.room.roomId,
            seed: this.room.seed,
            worldName: this.room.worldName,
            worldType: this.room.worldType,
            difficulty: this.room.difficulty,
            hostId: this.room.hostId,
            worldTime: this.room.worldTime,
            worldWeather: this.room.worldWeather,
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
        this.broadcast('ROOM_STATE', 'server', { room: this.buildRoomSnapshot() });
        break;
      }

      case 'START_GAME': {
        if (playerId !== this.room.hostId) return;
        this.room.status = 'playing';
        const snap = this.buildRoomSnapshot();
        this.broadcast('ROOM_STATE', 'server', { room: snap });
        this.broadcast('GAME_START', playerId, {
          roomId: this.room.roomId,
          seed: this.room.seed,
          worldName: this.room.worldName,
          worldType: this.room.worldType,
          difficulty: this.room.difficulty,
          hostId: this.room.hostId,
          worldTime: this.room.worldTime,
          worldWeather: this.room.worldWeather,
          room: snap,
        });
        break;
      }

      case 'PLAYER_STATE': {
        const x = Number(payload.x);
        const y = Number(payload.y);
        const z = Number(payload.z);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
        player.state = {
          x,
          y,
          z,
          yaw: Number.isFinite(Number(payload.yaw)) ? Number(payload.yaw) : 0,
          vx: Number.isFinite(Number(payload.vx)) ? Number(payload.vx) : 0,
          vy: Number.isFinite(Number(payload.vy)) ? Number(payload.vy) : 0,
          vz: Number.isFinite(Number(payload.vz)) ? Number(payload.vz) : 0,
          anim: typeof payload.anim === 'string' ? payload.anim.slice(0, 24) : 'idle',
          crouching: Boolean(payload.crouching),
          grounded: payload.grounded !== false,
          equippedItem:
            typeof payload.equippedItem === 'string' ? payload.equippedItem.slice(0, 48) : undefined,
          aimPitch: Number.isFinite(Number(payload.aimPitch)) ? Number(payload.aimPitch) : undefined,
          bowCharging: Boolean(payload.bowCharging),
          bowChargeProgress: Number.isFinite(Number(payload.bowChargeProgress))
            ? Math.max(0, Math.min(1, Number(payload.bowChargeProgress)))
            : undefined,
        };
        this.broadcast('PLAYER_STATE', playerId, {
          playerId,
          state: player.state,
          serverTimestamp: Date.now(),
        }, playerId);
        break;
      }

      case 'ENTITY_SYNC': {
        // Only authoritative LAN host broadcasts shared NPC/enemy/animal states
        if (playerId !== this.room.hostId) return;
        this.broadcast('ENTITY_SYNC', playerId, payload, playerId);
        break;
      }

      case 'WORLD_SETTINGS_UPDATE': {
        if (playerId !== this.room.hostId) return;
        const now = Date.now();
        if (payload.worldTime && typeof payload.worldTime === 'object') {
          this.room.worldTime = { ...this.room.worldTime, ...payload.worldTime, serverTimestamp: now };
        }
        if (payload.worldWeather && typeof payload.worldWeather === 'object') {
          this.room.worldWeather = { ...this.room.worldWeather, ...payload.worldWeather, serverTimestamp: now };
        }
        this.broadcast('WORLD_SETTINGS_UPDATE', playerId, {
          worldSettingsPermission: 'HOST_ONLY',
          worldTime: this.room.worldTime,
          worldWeather: this.room.worldWeather,
          triggerLightning: Boolean(payload.triggerLightning),
          serverTimestamp: now,
          updatedBy: playerId,
        });
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
          roomId: this.room.roomId,
          senderId: playerId,
          senderName: player.displayName,
          message: text,
          timestamp: Date.now(),
        };
        this.chatHistory.push(chatMsg);
        if (this.chatHistory.length > 60) {
          this.chatHistory.shift();
        }
        this.broadcast('ROOM_CHAT', playerId, chatMsg);
        break;
      }

      case 'LEAVE_ROOM':
      case 'DISCONNECT': {
        this.removePlayer(playerId, 'left');
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
