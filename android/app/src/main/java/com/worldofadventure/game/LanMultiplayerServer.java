package com.worldofadventure.game;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.util.Base64;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Native Offline LAN Multiplayer Server for Android (zero Internet required).
 * Serves HTTP room endpoints + RFC 6455 WebSocket on local Wi-Fi (max 4 players)
 * and responds to / sends UDP LAN discovery beacons on port 41235.
 */
public class LanMultiplayerServer {
    public static final int MAX_LAN_PLAYERS = 4;
    public static final int DEFAULT_LAN_PORT = 41234;
    public static final int DISCOVERY_PORT = 41235;
    private static final String DISCOVERY_MAGIC = "WOA_LAN_V1";
    private static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final String[] AVATAR_COLORS = {"#6ab06e", "#e5a93c", "#58b4d1", "#d96b6b"};
    private static final String[] PARTY_MARKER_COLORS = {"#3b82f6", "#10b981", "#f59e0b", "#ec4899"};
    private static final String CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    private final Context appContext;
    private final SecureRandom rng = new SecureRandom();
    private final AtomicInteger seqCounter = new AtomicInteger(0);
    private final ExecutorService executor = Executors.newCachedThreadPool();

    private volatile ServerSocket serverSocket;
    private volatile DatagramSocket discoverySocket;
    private volatile boolean running = false;
    private volatile int listenPort = DEFAULT_LAN_PORT;
    private WifiManager.MulticastLock multicastLock;

    private final Object roomLock = new Object();
    private RoomRecord room = null;
    private final Map<String, PlayerSession> sessions = new ConcurrentHashMap<>();
    private final List<JSONObject> chatHistory = Collections.synchronizedList(new ArrayList<>());

    private static final class PartyRecord {
        String partyId;
        String roomId;
        String leaderPlayerId;
        long createdAt;
        final List<String> memberIds = new ArrayList<>();
        JSONObject activeObjective = null;
    }

    private static final class PartyInviteRecord {
        String inviteId;
        String partyId;
        String roomId;
        String fromPlayerId;
        String fromPlayerName;
        String toPlayerId;
        String toPlayerName;
        long createdAt;
        String status = "pending";
    }

    private static final class RoomRecord {
        String roomId;
        String roomCode;
        String roomName;
        String worldName;
        String worldType;
        String difficulty;
        int seed;
        String hostId;
        String hostName;
        String status;
        long createdAt;
        String worldSettingsPermission = "HOST_ONLY";
        boolean friendlyFire = false;
        JSONObject worldTime;
        JSONObject worldWeather;
        final Map<String, PlayerRecord> players = new LinkedHashMap<>();
        final Map<String, PartyRecord> parties = new LinkedHashMap<>();
        final Map<String, PartyInviteRecord> partyInvites = new LinkedHashMap<>();
    }

    private static final class PlayerRecord {
        String playerId;
        String networkEntityId;
        String displayName;
        boolean isHost;
        boolean isReady;
        long joinedAt;
        String avatarColor;
        String partyId = null;
        boolean partyReady = false;
        long partyJoinedAt = 0;
        int level = 1;
        int health = 100;
        int maxHealth = 100;
        boolean isDead = false;
        JSONObject state;
    }

    private static final class PlayerSession {
        final String playerId;
        final String token;
        volatile Socket socket;
        volatile OutputStream out;
        volatile boolean open = false;

        PlayerSession(String playerId, String token) {
            this.playerId = playerId;
            this.token = token;
        }

        synchronized boolean sendText(String text) {
            if (!open || out == null) return false;
            try {
                byte[] payload = text.getBytes(StandardCharsets.UTF_8);
                writeWsFrame(out, 0x1, payload);
                return true;
            } catch (IOException e) {
                open = false;
                return false;
            }
        }

        synchronized void close(int code, String reason) {
            if (!open && socket == null) return;
            open = false;
            try {
                if (out != null) {
                    byte[] r = (reason == null ? "" : reason).getBytes(StandardCharsets.UTF_8);
                    int rLen = Math.min(r.length, 100);
                    byte[] payload = new byte[2 + rLen];
                    payload[0] = (byte) ((code >> 8) & 0xFF);
                    payload[1] = (byte) (code & 0xFF);
                    System.arraycopy(r, 0, payload, 2, rLen);
                    writeWsFrame(out, 0x8, payload);
                }
            } catch (Exception ignored) {
            }
            try {
                if (socket != null) socket.close();
            } catch (Exception ignored) {
            }
            socket = null;
            out = null;
        }
    }

    public LanMultiplayerServer(Context context) {
        this.appContext = context.getApplicationContext();
    }

    public static String getPrimaryLanIp() {
        String fallback = "127.0.0.1";
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface nif = interfaces.nextElement();
                if (!nif.isUp() || nif.isLoopback()) continue;
                Enumeration<InetAddress> addrs = nif.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress addr = addrs.nextElement();
                    if (addr instanceof Inet4Address && !addr.isLoopbackAddress()) {
                        String ip = addr.getHostAddress();
                        if (ip != null && (ip.startsWith("192.168.") || ip.startsWith("10.") || ip.startsWith("172."))) {
                            return ip;
                        }
                        if (ip != null) fallback = ip;
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return fallback;
    }

    private String randomId(String prefix, int byteCount) {
        byte[] buf = new byte[byteCount];
        rng.nextBytes(buf);
        String b64 = Base64.encodeToString(buf, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        return prefix + "_" + b64;
    }

    private String generateLanCode() {
        StringBuilder sb = new StringBuilder(4);
        for (int i = 0; i < 4; i++) {
            sb.append(CODE_CHARS.charAt(rng.nextInt(CODE_CHARS.length())));
        }
        return sb.toString();
    }

    private String sanitizeText(String raw, int maxLen, String fallback) {
        if (raw == null) return fallback;
        String cleaned = raw.replaceAll("[\\x00-\\x1F\\x7F<>]", "").trim();
        if (cleaned.length() > maxLen) cleaned = cleaned.substring(0, maxLen);
        return cleaned.isEmpty() ? fallback : cleaned;
    }

    public String startHostJson(int preferredPort, String roomOptionsJson) {
        try {
            if (!running) {
                int portToTry = (preferredPort > 1024 && preferredPort < 65535) ? preferredPort : DEFAULT_LAN_PORT;
                ServerSocket ss;
                try {
                    ss = new ServerSocket();
                    ss.setReuseAddress(true);
                    ss.bind(new InetSocketAddress("0.0.0.0", portToTry));
                } catch (IOException busy) {
                    ss = new ServerSocket(0, 16, InetAddress.getByName("0.0.0.0"));
                }
                serverSocket = ss;
                listenPort = ss.getLocalPort();
                running = true;

                acquireMulticastLock();
                startAcceptLoop(ss);
                startDiscoveryResponder();
                startTimeSyncLoop();
            }

            JSONObject hostSession = null;
            if (roomOptionsJson != null && !roomOptionsJson.trim().isEmpty()) {
                hostSession = initRoom(new JSONObject(roomOptionsJson));
            }

            JSONObject status = buildStatusJson();
            status.put("ok", true);
            if (hostSession != null) {
                status.put("hostSession", hostSession);
            }
            return status.toString();
        } catch (Exception e) {
            try {
                JSONObject err = new JSONObject();
                err.put("ok", false);
                err.put("error", "LAN_START_FAILED");
                err.put("message", e.getMessage() != null ? e.getMessage() : "Unable to start Android LAN server.");
                return err.toString();
            } catch (Exception ignored) {
                return "{\"ok\":false,\"error\":\"LAN_START_FAILED\"}";
            }
        }
    }

    public String stopHostJson() {
        running = false;
        synchronized (roomLock) {
            if (room != null) {
                try {
                    JSONObject reason = new JSONObject();
                    reason.put("reason", "LAN server stopped.");
                    broadcast("ROOM_CLOSED", "server", reason, null);
                } catch (Exception ignored) {
                }
            }
            for (PlayerSession sess : sessions.values()) {
                sess.close(4000, "LAN server stopped.");
            }
            sessions.clear();
            room = null;
            chatHistory.clear();
        }
        try {
            if (discoverySocket != null) discoverySocket.close();
        } catch (Exception ignored) {
        }
        discoverySocket = null;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (Exception ignored) {
        }
        serverSocket = null;
        releaseMulticastLock();
        return "{\"ok\":true}";
    }

    public String getStatusJson() {
        return buildStatusJson().toString();
    }

    private JSONObject buildStatusJson() {
        JSONObject obj = new JSONObject();
        try {
            String ip = getPrimaryLanIp();
            obj.put("running", running);
            obj.put("ip", ip);
            obj.put("port", listenPort);
            obj.put("address", ip + ":" + listenPort);
            obj.put("baseUrl", "http://" + ip + ":" + listenPort);
            synchronized (roomLock) {
                obj.put("room", room != null ? buildRoomSnapshot() : JSONObject.NULL);
            }
        } catch (Exception ignored) {
        }
        return obj;
    }

    public String discoverLanHostsJson(int timeoutMs) {
        JSONArray results = new JSONArray();
        Map<String, JSONObject> seen = new LinkedHashMap<>();
        DatagramSocket sock = null;
        acquireMulticastLock();
        try {
            sock = new DatagramSocket();
            sock.setBroadcast(true);
            sock.setSoTimeout(300);
            byte[] probe = (DISCOVERY_MAGIC + ":DISCOVER").getBytes(StandardCharsets.UTF_8);
            sock.send(new DatagramPacket(probe, probe.length, InetAddress.getByName("255.255.255.255"), DISCOVERY_PORT));
            String localIp = getPrimaryLanIp();
            String[] parts = localIp.split("\\.");
            if (parts.length == 4) {
                String subnetBcast = parts[0] + "." + parts[1] + "." + parts[2] + ".255";
                try {
                    sock.send(new DatagramPacket(probe, probe.length, InetAddress.getByName(subnetBcast), DISCOVERY_PORT));
                } catch (Exception ignored) {
                }
            }

            long deadline = System.currentTimeMillis() + Math.max(400, Math.min(3500, timeoutMs));
            byte[] buf = new byte[2048];
            while (System.currentTimeMillis() < deadline) {
                try {
                    DatagramPacket pkt = new DatagramPacket(buf, buf.length);
                    sock.receive(pkt);
                    String text = new String(pkt.getData(), 0, pkt.getLength(), StandardCharsets.UTF_8);
                    JSONObject data = new JSONObject(text);
                    if (DISCOVERY_MAGIC.equals(data.optString("magic"))
                            && "ANNOUNCE".equals(data.optString("type"))
                            && !data.optString("roomId").isEmpty()) {
                        String hostIp = pkt.getAddress() != null ? pkt.getAddress().getHostAddress() : data.optString("ip");
                        int port = data.optInt("port", DEFAULT_LAN_PORT);
                        data.put("ip", hostIp);
                        data.put("port", port);
                        data.put("address", hostIp + ":" + port);
                        data.put("baseUrl", "http://" + hostIp + ":" + port);
                        data.put("maxPlayers", MAX_LAN_PLAYERS);
                        seen.put(hostIp + ":" + port, data);
                    }
                } catch (IOException ignoredTimeout) {
                    // Continue until deadline
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (sock != null) {
                try {
                    sock.close();
                } catch (Exception ignored) {
                }
            }
            if (!running) {
                releaseMulticastLock();
            }
        }
        for (JSONObject item : seen.values()) {
            results.put(item);
        }
        return results.toString();
    }

    private void acquireMulticastLock() {
        try {
            if (multicastLock != null && multicastLock.isHeld()) return;
            WifiManager wm = (WifiManager) appContext.getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                multicastLock = wm.createMulticastLock("woa_lan_discovery");
                multicastLock.setReferenceCounted(false);
                multicastLock.acquire();
            }
        } catch (Exception ignored) {
        }
    }

    private void releaseMulticastLock() {
        try {
            if (multicastLock != null && multicastLock.isHeld()) {
                multicastLock.release();
            }
        } catch (Exception ignored) {
        }
        multicastLock = null;
    }

    private void startAcceptLoop(final ServerSocket ss) {
        executor.execute(() -> {
            while (running && !ss.isClosed()) {
                try {
                    final Socket client = ss.accept();
                    executor.execute(() -> handleClientSocket(client));
                } catch (IOException ignored) {
                    if (!running) break;
                }
            }
        });
    }

    private void startTimeSyncLoop() {
        executor.execute(() -> {
            while (running) {
                try {
                    Thread.sleep(5000);
                } catch (InterruptedException ignored) {
                    break;
                }
                if (!running) break;
                synchronized (roomLock) {
                    if (room == null || !"in-game".equals(room.status)) continue;
                    boolean hasOpen = false;
                    for (PlayerSession s : sessions.values()) {
                        if (s.open) {
                            hasOpen = true;
                            break;
                        }
                    }
                    if (!hasOpen) continue;
                    try {
                        long now = System.currentTimeMillis();
                        JSONObject wt = materializeWorldTime(now);
                        JSONObject out = new JSONObject();
                        out.put("worldTime", wt);
                        out.put("serverTimestamp", now);
                        out.put("updatedBy", room.hostId);
                        broadcast("WORLD_TIME_CHANGED", "server", out, null);
                    } catch (Exception ignored) {
                    }
                }
            }
        });
    }

    private JSONObject materializeWorldTime(long now) throws Exception {
        if (room == null || room.worldTime == null) {
            JSONObject def = new JSONObject();
            def.put("worldHours", 8.5);
            def.put("dayCount", 1);
            def.put("timeScale", 1.0);
            def.put("paused", false);
            def.put("fullDayDurationSeconds", 360);
            def.put("anchorServerMs", now);
            return def;
        }
        JSONObject wt = room.worldTime;
        double fullDaySec = wt.optDouble("fullDayDurationSeconds", 360.0);
        if (Double.isNaN(fullDaySec) || Double.isInfinite(fullDaySec)) fullDaySec = 360.0;
        fullDaySec = Math.max(30.0, Math.min(1800.0, fullDaySec));

        double timeScale = wt.optDouble("timeScale", 1.0);
        if (Double.isNaN(timeScale) || Double.isInfinite(timeScale)) timeScale = 1.0;
        timeScale = Math.max(0.0, Math.min(10.0, timeScale));

        double worldHours = wt.optDouble("worldHours", 8.5);
        if (Double.isNaN(worldHours) || Double.isInfinite(worldHours)) worldHours = 8.5;
        worldHours = ((worldHours % 24.0) + 24.0) % 24.0;

        int dayCount = Math.max(1, wt.optInt("dayCount", 1));
        boolean paused = wt.optBoolean("paused", false);
        long anchorMs = wt.optLong("anchorServerMs", now);

        if (!paused && timeScale > 0 && fullDaySec > 0 && now > anchorMs) {
            double elapsedSec = Math.max(0.0, (now - anchorMs) / 1000.0);
            double total = worldHours + elapsedSec * (24.0 / fullDaySec) * timeScale;
            if (total >= 24.0) {
                dayCount += (int) Math.floor(total / 24.0);
            }
            worldHours = ((total % 24.0) + 24.0) % 24.0;
        }

        worldHours = Math.round(worldHours * 1000.0) / 1000.0;
        wt.put("worldHours", worldHours);
        wt.put("dayCount", dayCount);
        wt.put("timeScale", timeScale);
        wt.put("paused", paused);
        wt.put("fullDayDurationSeconds", fullDaySec);
        wt.put("anchorServerMs", now);
        return new JSONObject(wt.toString());
    }

    private JSONObject serializeParty(PartyRecord party) throws Exception {
        JSONObject po = new JSONObject();
        po.put("partyId", party.partyId);
        po.put("roomId", party.roomId);
        po.put("leaderPlayerId", party.leaderPlayerId);
        po.put("maxMembers", MAX_LAN_PLAYERS);
        po.put("createdAt", party.createdAt);
        po.put("activeObjective", party.activeObjective != null ? new JSONObject(party.activeObjective.toString()) : JSONObject.NULL);
        JSONArray members = new JSONArray();
        int idx = 0;
        for (String pid : party.memberIds) {
            PlayerRecord p = room != null ? room.players.get(pid) : null;
            if (p == null) continue;
            JSONObject mo = new JSONObject();
            mo.put("playerId", p.playerId);
            mo.put("displayName", p.displayName);
            mo.put("avatarColor", p.avatarColor);
            mo.put("level", p.level);
            mo.put("health", p.health);
            mo.put("maxHealth", p.maxHealth);
            mo.put("isDead", p.isDead);
            mo.put("online", true);
            mo.put("isReady", p.partyReady);
            mo.put("joinedAt", p.partyJoinedAt > 0 ? p.partyJoinedAt : p.joinedAt);
            mo.put("markerIndex", idx);
            mo.put("markerColor", PARTY_MARKER_COLORS[idx % PARTY_MARKER_COLORS.length]);
            members.put(mo);
            idx++;
        }
        po.put("members", members);
        return po;
    }

    private JSONObject serializePartyInvite(PartyInviteRecord inv) throws Exception {
        JSONObject o = new JSONObject();
        o.put("inviteId", inv.inviteId);
        o.put("partyId", inv.partyId);
        o.put("roomId", inv.roomId);
        o.put("fromPlayerId", inv.fromPlayerId);
        o.put("fromPlayerName", inv.fromPlayerName);
        o.put("toPlayerId", inv.toPlayerId);
        o.put("toPlayerName", inv.toPlayerName);
        o.put("createdAt", inv.createdAt);
        o.put("status", inv.status);
        return o;
    }

    private JSONObject buildPartySnapshotForPlayer(String playerId) throws Exception {
        JSONObject snap = new JSONObject();
        if (room == null) {
            snap.put("party", JSONObject.NULL);
            snap.put("pendingInvites", new JSONArray());
            snap.put("outgoingInvites", new JSONArray());
            return snap;
        }
        PlayerRecord p = room.players.get(playerId);
        PartyRecord party = (p != null && p.partyId != null) ? room.parties.get(p.partyId) : null;
        snap.put("party", party != null ? serializeParty(party) : JSONObject.NULL);
        JSONArray pending = new JSONArray();
        JSONArray outgoing = new JSONArray();
        for (PartyInviteRecord inv : room.partyInvites.values()) {
            if (!"pending".equals(inv.status)) continue;
            if (playerId.equals(inv.toPlayerId)) pending.put(serializePartyInvite(inv));
            if (playerId.equals(inv.fromPlayerId)) outgoing.put(serializePartyInvite(inv));
        }
        snap.put("pendingInvites", pending);
        snap.put("outgoingInvites", outgoing);
        return snap;
    }

    private void broadcastAllPartyStates() {
        if (room == null) return;
        for (String pid : room.players.keySet()) {
            try {
                sendTo(pid, "PARTY_STATE", buildPartySnapshotForPlayer(pid));
            } catch (Exception ignored) {
            }
        }
    }

    private void removePlayerFromParty(String playerId) {
        if (room == null) return;
        List<String> toRemove = new ArrayList<>();
        for (Map.Entry<String, PartyInviteRecord> e : room.partyInvites.entrySet()) {
            if (playerId.equals(e.getValue().fromPlayerId) || playerId.equals(e.getValue().toPlayerId)) {
                toRemove.add(e.getKey());
            }
        }
        for (String invId : toRemove) {
            room.partyInvites.remove(invId);
        }
        PlayerRecord p = room.players.get(playerId);
        if (p == null || p.partyId == null) return;
        PartyRecord party = room.parties.get(p.partyId);
        p.partyId = null;
        p.partyReady = false;
        if (party == null) return;
        party.memberIds.remove(playerId);
        if (party.memberIds.isEmpty()) {
            room.parties.remove(party.partyId);
        } else if (playerId.equals(party.leaderPlayerId)) {
            party.leaderPlayerId = party.memberIds.get(0);
        }
    }

    private JSONObject buildWorldSnapshotForPlayer(String playerId, long now) throws Exception {
        JSONObject ws = new JSONObject();
        ws.put("worldSettingsPermission", room.worldSettingsPermission);
        JSONObject worldSettings = new JSONObject();
        worldSettings.put("worldType", room.worldType);
        worldSettings.put("difficulty", room.difficulty);
        worldSettings.put("pvpEnabled", false);
        worldSettings.put("friendlyFire", room.friendlyFire);
        worldSettings.put("staminaUnlimited", "creative".equals(room.worldType));
        worldSettings.put("spawnX", 0);
        worldSettings.put("spawnY", 0);
        worldSettings.put("spawnZ", 4);
        ws.put("worldSettings", worldSettings);
        ws.put("worldTime", materializeWorldTime(now));
        ws.put("worldWeather", new JSONObject(room.worldWeather.toString()));
        ws.put("serverTimestamp", now);
        ws.put("partyState", buildPartySnapshotForPlayer(playerId));
        ws.put("coopQuests", new JSONArray());
        ws.put("bossEncounters", new JSONArray());
        return ws;
    }

    private void startDiscoveryResponder() {
        executor.execute(() -> {
            try {
                DatagramSocket ds = new DatagramSocket(null);
                ds.setReuseAddress(true);
                ds.bind(new InetSocketAddress("0.0.0.0", DISCOVERY_PORT));
                ds.setBroadcast(true);
                discoverySocket = ds;

                byte[] buf = new byte[512];
                while (running && !ds.isClosed()) {
                    DatagramPacket pkt = new DatagramPacket(buf, buf.length);
                    ds.receive(pkt);
                    String text = new String(pkt.getData(), 0, pkt.getLength(), StandardCharsets.UTF_8).trim();
                    if (!text.startsWith(DISCOVERY_MAGIC + ":DISCOVER")) continue;
                    JSONObject announce;
                    synchronized (roomLock) {
                        if (room == null) continue;
                        announce = new JSONObject();
                        announce.put("magic", DISCOVERY_MAGIC);
                        announce.put("type", "ANNOUNCE");
                        announce.put("ip", getPrimaryLanIp());
                        announce.put("port", listenPort);
                        announce.put("roomId", room.roomId);
                        announce.put("roomCode", room.roomCode);
                        announce.put("roomName", room.roomName);
                        announce.put("hostName", room.hostName);
                        announce.put("worldName", room.worldName);
                        announce.put("worldType", room.worldType);
                        announce.put("difficulty", room.difficulty);
                        announce.put("playerCount", room.players.size());
                        announce.put("maxPlayers", MAX_LAN_PLAYERS);
                        announce.put("status", room.status);
                    }
                    byte[] resp = announce.toString().getBytes(StandardCharsets.UTF_8);
                    ds.send(new DatagramPacket(resp, resp.length, pkt.getAddress(), pkt.getPort()));
                }
            } catch (Exception ignored) {
            }
        });
    }

    private void handleClientSocket(Socket socket) {
        try {
            socket.setTcpNoDelay(true);
            BufferedInputStream in = new BufferedInputStream(socket.getInputStream());
            OutputStream out = socket.getOutputStream();

            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) {
                socket.close();
                return;
            }
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) {
                socket.close();
                return;
            }
            String method = parts[0].trim();
            String rawTarget = parts[1].trim();

            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int idx = line.indexOf(':');
                if (idx > 0) {
                    headers.put(line.substring(0, idx).trim().toLowerCase(), line.substring(idx + 1).trim());
                }
            }

            String path = rawTarget;
            String query = "";
            int qIdx = rawTarget.indexOf('?');
            if (qIdx >= 0) {
                path = rawTarget.substring(0, qIdx);
                query = rawTarget.substring(qIdx + 1);
            }
            Map<String, String> queryParams = parseQuery(query);

            if ("websocket".equalsIgnoreCase(headers.get("upgrade")) && "/api/multiplayer/ws".equals(path)) {
                handleWebSocketUpgrade(socket, in, out, headers, queryParams);
                return;
            }

            if ("OPTIONS".equalsIgnoreCase(method)) {
                sendHttp(out, 204, "");
                socket.close();
                return;
            }

            int contentLength = 0;
            if (headers.containsKey("content-length")) {
                try {
                    contentLength = Math.min(16384, Math.max(0, Integer.parseInt(headers.get("content-length"))));
                } catch (Exception ignored) {
                }
            }
            byte[] bodyBytes = new byte[contentLength];
            int readTotal = 0;
            while (readTotal < contentLength) {
                int n = in.read(bodyBytes, readTotal, contentLength - readTotal);
                if (n < 0) break;
                readTotal += n;
            }
            String bodyStr = new String(bodyBytes, 0, readTotal, StandardCharsets.UTF_8).trim();
            JSONObject bodyJson = bodyStr.isEmpty() ? new JSONObject() : new JSONObject(bodyStr);

            if ("GET".equalsIgnoreCase(method) && "/health".equals(path)) {
                JSONObject res = new JSONObject();
                res.put("ok", true);
                res.put("service", "world-of-adventure-lan");
                res.put("mode", "offline-lan");
                res.put("maxPlayers", MAX_LAN_PLAYERS);
                synchronized (roomLock) {
                    res.put("playerCount", room != null ? room.players.size() : 0);
                    res.put("roomCode", room != null ? room.roomCode : JSONObject.NULL);
                    res.put("roomName", room != null ? room.roomName : JSONObject.NULL);
                    res.put("hostName", room != null ? room.hostName : JSONObject.NULL);
                    res.put("status", room != null ? room.status : "idle");
                }
                sendHttp(out, 200, res.toString());
            } else if ("GET".equalsIgnoreCase(method) && "/api/multiplayer/rooms".equals(path)) {
                JSONObject res = new JSONObject();
                res.put("ok", true);
                JSONArray arr = new JSONArray();
                synchronized (roomLock) {
                    if (room != null) arr.put(buildRoomSnapshot());
                }
                res.put("rooms", arr);
                sendHttp(out, 200, res.toString());
            } else if ("GET".equalsIgnoreCase(method) && "/api/multiplayer/rooms/verify".equals(path)) {
                String codeOrId = queryParams.getOrDefault("codeOrId", "").trim();
                synchronized (roomLock) {
                    if (room == null) {
                        sendHttp(out, 404, "{\"ok\":false,\"error\":\"ROOM_NOT_FOUND\",\"message\":\"LAN game not found.\"}");
                    } else if (!codeOrId.isEmpty()
                            && !codeOrId.equalsIgnoreCase(room.roomCode)
                            && !codeOrId.equals(room.roomId)) {
                        sendHttp(out, 404, "{\"ok\":false,\"error\":\"ROOM_NOT_FOUND\",\"message\":\"Invalid LAN code.\"}");
                    } else if (room.players.size() >= MAX_LAN_PLAYERS) {
                        sendHttp(out, 409, "{\"ok\":false,\"error\":\"ROOM_FULL\",\"message\":\"LAN GAME FULL (4 / 4 players).\"}");
                    } else {
                        JSONObject res = new JSONObject();
                        res.put("ok", true);
                        res.put("room", buildRoomSnapshot());
                        sendHttp(out, 200, res.toString());
                    }
                }
            } else if ("POST".equalsIgnoreCase(method) && "/api/multiplayer/rooms".equals(path)) {
                JSONObject created = initRoom(bodyJson);
                sendHttp(out, 200, created.toString());
            } else if ("POST".equalsIgnoreCase(method) && "/api/multiplayer/rooms/join".equals(path)) {
                JSONObject joinRes = joinPlayer(bodyJson);
                int status = joinRes.optInt("_status", 200);
                joinRes.remove("_status");
                sendHttp(out, status, joinRes.toString());
            } else {
                sendHttp(out, 404, "{\"ok\":false,\"error\":\"NOT_FOUND\"}");
            }
            socket.close();
        } catch (Exception ignored) {
            try {
                socket.close();
            } catch (Exception ignoredClose) {
            }
        }
    }

    private void handleWebSocketUpgrade(
            Socket socket,
            BufferedInputStream in,
            OutputStream out,
            Map<String, String> headers,
            Map<String, String> queryParams
    ) throws Exception {
        String roomId = queryParams.getOrDefault("roomId", "");
        String playerId = queryParams.getOrDefault("playerId", "");
        String token = queryParams.getOrDefault("token", "");
        String wsKey = headers.get("sec-websocket-key");

        PlayerSession session = sessions.get(playerId);
        boolean valid;
        synchronized (roomLock) {
            valid = room != null && room.roomId.equals(roomId) && session != null && session.token.equals(token) && wsKey != null;
        }
        if (!valid) {
            sendHttp(out, 403, "{\"ok\":false,\"error\":\"FORBIDDEN\"}");
            socket.close();
            return;
        }

        MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
        byte[] digest = sha1.digest((wsKey + WS_GUID).getBytes(StandardCharsets.UTF_8));
        String accept = Base64.encodeToString(digest, Base64.NO_WRAP);

        String handshake =
                "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
        out.write(handshake.getBytes(StandardCharsets.UTF_8));
        out.flush();

        session.socket = socket;
        session.out = out;
        session.open = true;

        try {
            while (running && session.open && !socket.isClosed()) {
                int b0 = in.read();
                int b1 = in.read();
                if (b0 < 0 || b1 < 0) break;
                int opcode = b0 & 0x0F;
                boolean masked = (b1 & 0x80) != 0;
                long len = b1 & 0x7F;
                if (len == 126) {
                    int h = in.read();
                    int l = in.read();
                    if (h < 0 || l < 0) break;
                    len = ((h & 0xFF) << 8) | (l & 0xFF);
                } else if (len == 127) {
                    len = 0;
                    for (int i = 0; i < 8; i++) {
                        int b = in.read();
                        if (b < 0) {
                            len = -1;
                            break;
                        }
                        len = (len << 8) | (b & 0xFF);
                    }
                    if (len < 0) break;
                }
                if (len > 65536) break;
                byte[] mask = new byte[4];
                if (masked) {
                    if (!readFully(in, mask)) break;
                }
                byte[] payload = new byte[(int) len];
                if (len > 0 && !readFully(in, payload)) break;
                if (masked) {
                    for (int i = 0; i < payload.length; i++) {
                        payload[i] = (byte) (payload[i] ^ mask[i & 3]);
                    }
                }
                if (opcode == 0x8) {
                    break;
                } else if (opcode == 0x9) {
                    synchronized (session) {
                        writeWsFrame(out, 0xA, payload);
                    }
                } else if (opcode == 0x1) {
                    String text = new String(payload, StandardCharsets.UTF_8);
                    handleWsMessage(playerId, text);
                }
            }
        } catch (Exception ignored) {
        } finally {
            removePlayer(playerId, "disconnected");
        }
    }

    private JSONObject initRoom(JSONObject options) throws Exception {
        synchronized (roomLock) {
            RoomRecord r = new RoomRecord();
            r.roomId = randomId("lan", 9);
            r.roomCode = generateLanCode();
            r.hostName = sanitizeText(options.optString("playerName", "Host"), 24, "Host");
            r.roomName = sanitizeText(options.optString("roomName", "World of Adventure LAN"), 36, "World of Adventure LAN");
            r.worldName = sanitizeText(options.optString("worldName", r.roomName), 36, r.roomName);
            r.worldType = "creative".equals(options.optString("worldType")) ? "creative" : "normal";
            String diff = options.optString("difficulty", "normal");
            r.difficulty = ("easy".equals(diff) || "hard".equals(diff)) ? diff : "normal";
            r.seed = options.has("seed") ? options.optInt("seed", 100000 + rng.nextInt(899999)) : (100000 + rng.nextInt(899999));
            r.hostId = randomId("pl", 8);
            r.status = "waiting";
            r.createdAt = System.currentTimeMillis();

            r.worldTime = new JSONObject();
            r.worldTime.put("worldHours", 8.5);
            r.worldTime.put("dayCount", 1);
            r.worldTime.put("fullDayDurationSeconds", 360);
            r.worldTime.put("timeScale", 1.0);
            r.worldTime.put("paused", false);
            r.worldTime.put("anchorServerMs", r.createdAt);

            r.worldWeather = new JSONObject();
            r.worldWeather.put("currentState", "clear");
            r.worldWeather.put("targetState", "clear");
            r.worldWeather.put("intensity", 0);
            r.worldWeather.put("dynamicEnabled", true);
            r.worldWeather.put("transitionDurationSeconds", 14);
            r.worldWeather.put("startMs", r.createdAt);
            r.worldWeather.put("durationMs", 240000);
            r.worldWeather.put("endMs", r.createdAt + 240000);

            PlayerRecord host = new PlayerRecord();
            host.playerId = r.hostId;
            host.networkEntityId = "net_" + r.hostId;
            host.displayName = r.hostName;
            host.isHost = true;
            host.isReady = true;
            host.joinedAt = r.createdAt;
            host.partyJoinedAt = r.createdAt;
            host.avatarColor = AVATAR_COLORS[0];
            host.state = defaultPlayerState(0, host.networkEntityId, r.createdAt);
            r.players.put(host.playerId, host);

            String token = randomId("tok", 16);
            sessions.clear();
            sessions.put(host.playerId, new PlayerSession(host.playerId, token));
            chatHistory.clear();
            room = r;

            JSONObject res = new JSONObject();
            res.put("ok", true);
            res.put("room", buildRoomSnapshot());
            res.put("playerId", host.playerId);
            res.put("sessionToken", token);
            res.put("wsPath", "/api/multiplayer/ws?roomId=" + r.roomId + "&playerId=" + host.playerId + "&token=" + token);
            return res;
        }
    }

    private JSONObject joinPlayer(JSONObject options) throws Exception {
        synchronized (roomLock) {
            JSONObject res = new JSONObject();
            if (room == null) {
                res.put("_status", 404);
                res.put("ok", false);
                res.put("error", "ROOM_NOT_FOUND");
                res.put("message", "LAN game not found.");
                return res;
            }
            String codeOrId = options.optString("roomCodeOrId", "").trim();
            if (!codeOrId.isEmpty() && !codeOrId.equalsIgnoreCase(room.roomCode) && !codeOrId.equals(room.roomId)) {
                res.put("_status", 404);
                res.put("ok", false);
                res.put("error", "ROOM_NOT_FOUND");
                res.put("message", "Invalid LAN code.");
                return res;
            }
            if (room.players.size() >= MAX_LAN_PLAYERS) {
                res.put("_status", 409);
                res.put("ok", false);
                res.put("error", "ROOM_FULL");
                res.put("message", "LAN GAME FULL (4 / 4 players).");
                return res;
            }

            PlayerRecord p = new PlayerRecord();
            p.playerId = randomId("pl", 8);
            p.networkEntityId = "net_" + p.playerId;
            p.displayName = sanitizeText(options.optString("playerName", "Player " + (room.players.size() + 1)), 24, "Player");
            p.isHost = false;
            p.isReady = false;
            p.joinedAt = System.currentTimeMillis();
            p.partyJoinedAt = p.joinedAt;
            p.avatarColor = AVATAR_COLORS[room.players.size() % AVATAR_COLORS.length];
            p.state = defaultPlayerState((room.players.size() - 1) * 2.2, p.networkEntityId, p.joinedAt);

            String token = randomId("tok", 16);
            room.players.put(p.playerId, p);
            sessions.put(p.playerId, new PlayerSession(p.playerId, token));

            JSONObject snap = buildRoomSnapshot();
            broadcast("ROOM_STATE", "server", snap, null);

            res.put("_status", 200);
            res.put("ok", true);
            res.put("room", snap);
            res.put("playerId", p.playerId);
            res.put("sessionToken", token);
            res.put("wsPath", "/api/multiplayer/ws?roomId=" + room.roomId + "&playerId=" + p.playerId + "&token=" + token);
            return res;
        }
    }

    private void removePlayer(String playerId, String reason) {
        synchronized (roomLock) {
            if (room == null || !room.players.containsKey(playerId)) return;
            boolean isHost = playerId.equals(room.hostId);
            removePlayerFromParty(playerId);
            PlayerSession sess = sessions.remove(playerId);
            if (sess != null) sess.close(1000, reason);
            room.players.remove(playerId);

            if (isHost) {
                try {
                    JSONObject closed = new JSONObject();
                    closed.put("reason", "LAN host ended the session.");
                    broadcast("ROOM_CLOSED", "server", closed, null);
                } catch (Exception ignored) {
                }
                for (PlayerSession other : sessions.values()) {
                    other.close(4000, "LAN host ended the session.");
                }
                sessions.clear();
                room = null;
                return;
            }

            try {
                JSONObject snap = buildRoomSnapshot();
                JSONObject leavePayload = new JSONObject();
                leavePayload.put("playerId", playerId);
                leavePayload.put("reason", reason);
                leavePayload.put("room", snap);
                broadcast("PLAYER_LEAVE", playerId, leavePayload, null);
                broadcast("ROOM_STATE", "server", snap, null);
                broadcastAllPartyStates();
            } catch (Exception ignored) {
            }
        }
    }

    private void handleWsMessage(String playerId, String rawText) {
        try {
            JSONObject msg = new JSONObject(rawText);
            String type = msg.optString("type", "");
            JSONObject payload = msg.optJSONObject("payload");
            if (payload == null) payload = new JSONObject();

            synchronized (roomLock) {
                if (room == null || !room.players.containsKey(playerId)) return;
                PlayerRecord player = room.players.get(playerId);
                if (player == null) return;

                switch (type) {
                    case "CONNECT": {
                        String name = sanitizeText(payload.optString("displayName", ""), 24, "");
                        if (!name.isEmpty()) player.displayName = name;
                        long now = System.currentTimeMillis();
                        JSONObject snap = buildRoomSnapshot();
                        JSONObject connectRes = new JSONObject();
                        connectRes.put("playerId", playerId);
                        connectRes.put("room", snap);
                        sendTo(playerId, "CONNECT", connectRes);
                        broadcast("ROOM_STATE", "server", snap, null);
                        sendTo(playerId, "WORLD_SNAPSHOT", buildWorldSnapshotForPlayer(playerId, now));
                        JSONObject chatHist = new JSONObject();
                        chatHist.put("messages", new JSONArray(chatHistory));
                        sendTo(playerId, "CHAT_HISTORY", chatHist);
                        sendTo(playerId, "PARTY_STATE", buildPartySnapshotForPlayer(playerId));
                        if ("in-game".equals(room.status)) {
                            sendTo(playerId, "START_GAME", buildGameStartPayload(snap));
                        }
                        break;
                    }
                    case "PING": {
                        JSONObject pong = new JSONObject();
                        pong.put("clientSentAt", payload.optLong("clientSentAt", System.currentTimeMillis()));
                        pong.put("serverTimestamp", System.currentTimeMillis());
                        sendTo(playerId, "PONG", pong);
                        break;
                    }
                    case "READY": {
                        player.isReady = payload.optBoolean("ready", false);
                        broadcast("ROOM_STATE", "server", buildRoomSnapshot(), null);
                        break;
                    }
                    case "START_GAME": {
                        if (!playerId.equals(room.hostId)) return;
                        long now = System.currentTimeMillis();
                        room.status = "in-game";
                        materializeWorldTime(now);
                        JSONObject snap = buildRoomSnapshot();
                        broadcast("ROOM_STATE", "server", snap, null);
                        for (String pid : room.players.keySet()) {
                            sendTo(pid, "WORLD_SNAPSHOT", buildWorldSnapshotForPlayer(pid, now));
                        }
                        broadcast("START_GAME", playerId, buildGameStartPayload(snap), null);
                        break;
                    }
                    case "PLAYER_STATE": {
                        double x = payload.optDouble("x", Double.NaN);
                        double y = payload.optDouble("y", Double.NaN);
                        double z = payload.optDouble("z", Double.NaN);
                        if (Double.isNaN(x) || Double.isNaN(y) || Double.isNaN(z)) return;
                        long now = System.currentTimeMillis();
                        JSONObject flat = new JSONObject();
                        flat.put("x", Math.round(x * 1000.0) / 1000.0);
                        flat.put("y", Math.round(y * 1000.0) / 1000.0);
                        flat.put("z", Math.round(z * 1000.0) / 1000.0);
                        flat.put("yaw", Math.round(payload.optDouble("yaw", 0.0) * 1000.0) / 1000.0);
                        if (payload.has("aimYaw") && !Double.isNaN(payload.optDouble("aimYaw", Double.NaN))) {
                            flat.put("aimYaw", Math.round(payload.optDouble("aimYaw", 0.0) * 1000.0) / 1000.0);
                        }
                        if (payload.has("pitch") && !Double.isNaN(payload.optDouble("pitch", Double.NaN))) {
                            flat.put("pitch", Math.round(payload.optDouble("pitch", 0.0) * 1000.0) / 1000.0);
                        }
                        flat.put("vx", Math.round(payload.optDouble("vx", 0.0) * 100.0) / 100.0);
                        flat.put("vy", Math.round(payload.optDouble("vy", 0.0) * 100.0) / 100.0);
                        flat.put("vz", Math.round(payload.optDouble("vz", 0.0) * 100.0) / 100.0);
                        String ms = payload.optString("movementState", "idle");
                        if (!"idle".equals(ms) && !"walking".equals(ms) && !"running".equals(ms) && !"jumping".equals(ms) && !"falling".equals(ms)) {
                            ms = "idle";
                        }
                        flat.put("movementState", ms);
                        if (payload.has("animState") && !payload.optString("animState", "").isEmpty()) {
                            flat.put("animState", payload.optString("animState"));
                        }
                        flat.put("sprinting", payload.optBoolean("sprinting", false));
                        flat.put("jumping", payload.optBoolean("jumping", false));
                        flat.put("crouching", payload.optBoolean("crouching", false));
                        flat.put("grounded", payload.optBoolean("grounded", true));
                        if (payload.has("weaponId")) {
                            if (payload.isNull("weaponId")) {
                                flat.put("weaponId", JSONObject.NULL);
                            } else {
                                flat.put("weaponId", payload.optString("weaponId"));
                            }
                        }
                        if (payload.has("bowCharging")) flat.put("bowCharging", payload.optBoolean("bowCharging", false));
                        if (payload.has("bowCharge")) flat.put("bowCharge", Math.max(0.0, Math.min(1.0, payload.optDouble("bowCharge", 0.0))));
                        if (payload.has("shooting")) flat.put("shooting", payload.optBoolean("shooting", false));
                        if (payload.has("reloading")) flat.put("reloading", payload.optBoolean("reloading", false));
                        if (payload.has("seq")) flat.put("seq", payload.optInt("seq", 0));
                        flat.put("networkEntityId", player.networkEntityId);
                        flat.put("health", player.health);
                        flat.put("maxHealth", player.maxHealth);
                        flat.put("isDead", player.isDead);
                        flat.put("serverTime", now);
                        player.state = flat;
                        broadcast("PLAYER_STATE", playerId, flat, playerId);
                        break;
                    }
                    case "ENTITY_SYNC": {
                        if (!playerId.equals(room.hostId)) return;
                        broadcast("ENTITY_SYNC", playerId, payload, playerId);
                        break;
                    }
                    case "WORLD_SETTINGS_UPDATE": {
                        boolean isHost = playerId.equals(room.hostId);
                        if (payload.has("worldSettingsPermission") && isHost) {
                            String perm = payload.optString("worldSettingsPermission", "HOST_ONLY");
                            if ("HOST_ONLY".equals(perm) || "ALL_PLAYERS".equals(perm)) {
                                room.worldSettingsPermission = perm;
                            }
                        }
                        if (payload.has("friendlyFire") && isHost) {
                            room.friendlyFire = payload.optBoolean("friendlyFire", false);
                        }
                        if (!isHost && !"ALL_PLAYERS".equals(room.worldSettingsPermission)) {
                            JSONObject err = new JSONObject();
                            err.put("code", "FORBIDDEN_WORLD_SETTINGS");
                            err.put("message", "Host currently restricts world time and weather controls.");
                            sendTo(playerId, "ERROR", err);
                            return;
                        }
                        long now = System.currentTimeMillis();
                        materializeWorldTime(now);
                        boolean timeChanged = false;
                        if (payload.has("preset")) {
                            String preset = payload.optString("preset", "");
                            if ("sunrise".equals(preset)) { room.worldTime.put("worldHours", 6.0); room.worldTime.put("anchorServerMs", now); timeChanged = true; }
                            else if ("noon".equals(preset)) { room.worldTime.put("worldHours", 12.0); room.worldTime.put("anchorServerMs", now); timeChanged = true; }
                            else if ("sunset".equals(preset)) { room.worldTime.put("worldHours", 18.0); room.worldTime.put("anchorServerMs", now); timeChanged = true; }
                            else if ("midnight".equals(preset)) { room.worldTime.put("worldHours", 0.0); room.worldTime.put("anchorServerMs", now); timeChanged = true; }
                        }
                        if (payload.has("worldHours")) {
                            double wh = payload.optDouble("worldHours", Double.NaN);
                            if (!Double.isNaN(wh) && !Double.isInfinite(wh)) {
                                wh = ((wh % 24.0) + 24.0) % 24.0;
                                room.worldTime.put("worldHours", Math.round(wh * 1000.0) / 1000.0);
                                room.worldTime.put("anchorServerMs", now);
                                timeChanged = true;
                            }
                        }
                        if (payload.has("dayCount")) {
                            room.worldTime.put("dayCount", Math.max(1, payload.optInt("dayCount", 1)));
                            room.worldTime.put("anchorServerMs", now);
                            timeChanged = true;
                        }
                        if (payload.has("timeScale")) {
                            double ts = payload.optDouble("timeScale", 1.0);
                            if (!Double.isNaN(ts) && !Double.isInfinite(ts)) {
                                room.worldTime.put("timeScale", Math.max(0.0, Math.min(10.0, ts)));
                                room.worldTime.put("anchorServerMs", now);
                                timeChanged = true;
                            }
                        }
                        if (payload.has("paused")) {
                            room.worldTime.put("paused", payload.optBoolean("paused", false));
                            room.worldTime.put("anchorServerMs", now);
                            timeChanged = true;
                        }
                        if (payload.has("fullDayDurationSeconds")) {
                            double fd = payload.optDouble("fullDayDurationSeconds", 360.0);
                            if (!Double.isNaN(fd) && !Double.isInfinite(fd)) {
                                room.worldTime.put("fullDayDurationSeconds", Math.max(30.0, Math.min(1800.0, fd)));
                                room.worldTime.put("anchorServerMs", now);
                                timeChanged = true;
                            }
                        }
                        if (payload.has("weatherState")) {
                            String ws = payload.optString("weatherState", "clear");
                            room.worldWeather.put("currentState", ws);
                            room.worldWeather.put("targetState", ws);
                            room.worldWeather.put("startMs", now);
                            long dur = Math.max(30000L, Math.min(900000L, payload.optLong("durationMs", 240000L)));
                            room.worldWeather.put("durationMs", dur);
                            room.worldWeather.put("endMs", now + dur);
                        }
                        if (payload.has("targetWeatherState")) {
                            String tws = payload.optString("targetWeatherState", "clear");
                            room.worldWeather.put("targetState", tws);
                            room.worldWeather.put("startMs", now);
                            long dur = Math.max(30000L, Math.min(900000L, payload.optLong("durationMs", 240000L)));
                            room.worldWeather.put("durationMs", dur);
                            room.worldWeather.put("endMs", now + dur);
                        }
                        if (payload.has("weatherIntensity")) {
                            room.worldWeather.put("intensity", Math.max(0.0, Math.min(1.0, payload.optDouble("weatherIntensity", 0.0))));
                        }
                        if (payload.has("dynamicEnabled")) {
                            room.worldWeather.put("dynamicEnabled", payload.optBoolean("dynamicEnabled", true));
                        }
                        if (payload.has("transitionDurationSeconds")) {
                            room.worldWeather.put("transitionDurationSeconds", Math.max(2.0, Math.min(120.0, payload.optDouble("transitionDurationSeconds", 14.0))));
                        }
                        JSONObject wtOut = new JSONObject(room.worldTime.toString());
                        JSONObject wwOut = new JSONObject(room.worldWeather.toString());
                        JSONObject out = new JSONObject();
                        out.put("worldSettingsPermission", room.worldSettingsPermission);
                        out.put("friendlyFire", room.friendlyFire);
                        out.put("worldTime", wtOut);
                        out.put("worldWeather", wwOut);
                        out.put("triggerLightning", payload.optBoolean("triggerLightning", false));
                        out.put("serverTimestamp", now);
                        out.put("updatedBy", playerId);
                        broadcast("WORLD_SETTINGS_UPDATED", playerId, out, null);
                        if (timeChanged) {
                            JSONObject timeOut = new JSONObject();
                            timeOut.put("worldTime", wtOut);
                            timeOut.put("serverTimestamp", now);
                            timeOut.put("updatedBy", playerId);
                            broadcast("WORLD_TIME_CHANGED", playerId, timeOut, null);
                        }
                        break;
                    }
                    case "GAME_EVENT": {
                        String ev = payload.optString("event", "");
                        if (ev.isEmpty()) return;
                        JSONObject out = new JSONObject();
                        out.put("event", ev);
                        out.put("data", payload.optJSONObject("data") != null ? payload.optJSONObject("data") : new JSONObject());
                        out.put("actorId", playerId);
                        out.put("serverTimestamp", System.currentTimeMillis());
                        broadcast("GAME_EVENT", playerId, out, playerId);
                        break;
                    }
                    case "ROOM_CHAT": {
                        String text = sanitizeText(payload.optString("message", ""), 240, "");
                        if (text.isEmpty()) return;
                        JSONObject chatMsg = new JSONObject();
                        chatMsg.put("id", randomId("chat", 6));
                        chatMsg.put("playerId", playerId);
                        chatMsg.put("playerName", player.displayName);
                        chatMsg.put("message", text);
                        chatMsg.put("timestamp", System.currentTimeMillis());
                        chatHistory.add(chatMsg);
                        if (chatHistory.size() > 40) chatHistory.remove(0);
                        broadcast("ROOM_CHAT", playerId, chatMsg, null);
                        break;
                    }
                    case "PARTY_CREATE": {
                        if (player.partyId != null && room.parties.containsKey(player.partyId)) {
                            sendTo(playerId, "PARTY_STATE", buildPartySnapshotForPlayer(playerId));
                            break;
                        }
                        long now = System.currentTimeMillis();
                        PartyRecord party = new PartyRecord();
                        party.partyId = randomId("party", 6);
                        party.roomId = room.roomId;
                        party.leaderPlayerId = playerId;
                        party.createdAt = now;
                        party.memberIds.add(playerId);
                        room.parties.put(party.partyId, party);
                        player.partyId = party.partyId;
                        player.partyReady = true;
                        player.partyJoinedAt = now;
                        broadcastAllPartyStates();
                        broadcast("ROOM_STATE", "server", buildRoomSnapshot(), null);
                        break;
                    }
                    case "PARTY_INVITE": {
                        PlayerRecord target = null;
                        String targetId = payload.optString("targetPlayerId", "");
                        String targetName = payload.optString("targetPlayerName", "").trim();
                        if (!targetId.isEmpty()) {
                            target = room.players.get(targetId);
                        } else if (!targetName.isEmpty()) {
                            for (PlayerRecord pr : room.players.values()) {
                                if (pr.displayName.equalsIgnoreCase(targetName)) {
                                    target = pr;
                                    break;
                                }
                            }
                        }
                        if (target == null || target.playerId.equals(playerId)) return;
                        long now = System.currentTimeMillis();
                        PartyRecord party = player.partyId != null ? room.parties.get(player.partyId) : null;
                        if (party == null) {
                            party = new PartyRecord();
                            party.partyId = randomId("party", 6);
                            party.roomId = room.roomId;
                            party.leaderPlayerId = playerId;
                            party.createdAt = now;
                            party.memberIds.add(playerId);
                            room.parties.put(party.partyId, party);
                            player.partyId = party.partyId;
                            player.partyReady = true;
                            player.partyJoinedAt = now;
                        }
                        if (!playerId.equals(party.leaderPlayerId)) {
                            JSONObject err = new JSONObject();
                            err.put("code", "FORBIDDEN_PARTY_LEADER");
                            err.put("message", "Only the party leader can invite players.");
                            sendTo(playerId, "ERROR", err);
                            return;
                        }
                        if (party.memberIds.size() >= MAX_LAN_PLAYERS) {
                            JSONObject err = new JSONObject();
                            err.put("code", "PARTY_FULL");
                            err.put("message", "Party is full.");
                            sendTo(playerId, "ERROR", err);
                            return;
                        }
                        if (party.memberIds.contains(target.playerId)) return;
                        for (PartyInviteRecord existing : room.partyInvites.values()) {
                            if ("pending".equals(existing.status) && party.partyId.equals(existing.partyId) && target.playerId.equals(existing.toPlayerId)) {
                                JSONObject err = new JSONObject();
                                err.put("code", "DUPLICATE_PARTY_INVITE");
                                err.put("message", "Invite already sent to this player.");
                                sendTo(playerId, "ERROR", err);
                                return;
                            }
                        }
                        PartyInviteRecord inv = new PartyInviteRecord();
                        inv.inviteId = randomId("pinv", 6);
                        inv.partyId = party.partyId;
                        inv.roomId = room.roomId;
                        inv.fromPlayerId = playerId;
                        inv.fromPlayerName = player.displayName;
                        inv.toPlayerId = target.playerId;
                        inv.toPlayerName = target.displayName;
                        inv.createdAt = now;
                        inv.status = "pending";
                        room.partyInvites.put(inv.inviteId, inv);
                        sendTo(target.playerId, "PARTY_INVITE_RECEIVED", serializePartyInvite(inv));
                        broadcastAllPartyStates();
                        broadcast("ROOM_STATE", "server", buildRoomSnapshot(), null);
                        break;
                    }
                    case "PARTY_ACCEPT_INVITE": {
                        String inviteId = payload.optString("inviteId", "");
                        PartyInviteRecord inv = room.partyInvites.get(inviteId);
                        if (inv == null || !"pending".equals(inv.status) || !playerId.equals(inv.toPlayerId)) return;
                        PartyRecord party = room.parties.get(inv.partyId);
                        if (party == null) {
                            room.partyInvites.remove(inviteId);
                            broadcastAllPartyStates();
                            return;
                        }
                        if (party.memberIds.size() >= MAX_LAN_PLAYERS) {
                            JSONObject err = new JSONObject();
                            err.put("code", "PARTY_FULL");
                            err.put("message", "Party is full.");
                            sendTo(playerId, "ERROR", err);
                            return;
                        }
                        if (player.partyId != null && !player.partyId.equals(party.partyId)) {
                            removePlayerFromParty(playerId);
                        }
                        room.partyInvites.remove(inviteId);
                        if (!party.memberIds.contains(playerId)) party.memberIds.add(playerId);
                        player.partyId = party.partyId;
                        player.partyReady = false;
                        player.partyJoinedAt = System.currentTimeMillis();
                        broadcastAllPartyStates();
                        broadcast("ROOM_STATE", "server", buildRoomSnapshot(), null);
                        break;
                    }
                    case "PARTY_DECLINE_INVITE": {
                        String inviteId = payload.optString("inviteId", "");
                        PartyInviteRecord inv = room.partyInvites.get(inviteId);
                        if (inv == null || !playerId.equals(inv.toPlayerId)) return;
                        room.partyInvites.remove(inviteId);
                        broadcastAllPartyStates();
                        break;
                    }
                    case "PARTY_LEAVE": {
                        removePlayerFromParty(playerId);
                        broadcastAllPartyStates();
                        broadcast("ROOM_STATE", "server", buildRoomSnapshot(), null);
                        break;
                    }
                    case "PARTY_KICK": {
                        String targetId = payload.optString("targetPlayerId", "");
                        if (targetId.isEmpty() || targetId.equals(playerId) || player.partyId == null) return;
                        PartyRecord party = room.parties.get(player.partyId);
                        if (party == null || !playerId.equals(party.leaderPlayerId) || !party.memberIds.contains(targetId)) return;
                        removePlayerFromParty(targetId);
                        broadcastAllPartyStates();
                        broadcast("ROOM_STATE", "server", buildRoomSnapshot(), null);
                        break;
                    }
                    case "PARTY_TRANSFER_LEADER": {
                        String targetId = payload.optString("targetPlayerId", "");
                        if (targetId.isEmpty() || player.partyId == null) return;
                        PartyRecord party = room.parties.get(player.partyId);
                        if (party == null || !playerId.equals(party.leaderPlayerId) || !party.memberIds.contains(targetId)) return;
                        party.leaderPlayerId = targetId;
                        broadcastAllPartyStates();
                        break;
                    }
                    case "PARTY_SET_READY": {
                        if (player.partyId == null) return;
                        player.partyReady = payload.optBoolean("ready", false);
                        broadcastAllPartyStates();
                        break;
                    }
                    case "PARTY_START_OBJECTIVE": {
                        if (player.partyId == null) return;
                        PartyRecord party = room.parties.get(player.partyId);
                        if (party == null || !playerId.equals(party.leaderPlayerId)) return;
                        JSONObject obj = new JSONObject();
                        obj.put("objectiveId", randomId("pobj", 6));
                        obj.put("partyId", party.partyId);
                        obj.put("type", payload.optString("type", "explore"));
                        obj.put("title", sanitizeText(payload.optString("title", "Team Objective"), 64, "Team Objective"));
                        if (payload.has("targetId")) obj.put("targetId", payload.optString("targetId"));
                        if (payload.has("targetX")) obj.put("targetX", payload.optDouble("targetX", 0));
                        if (payload.has("targetZ")) obj.put("targetZ", payload.optDouble("targetZ", 0));
                        obj.put("targetCount", Math.max(1, payload.optInt("targetCount", 1)));
                        obj.put("currentCount", 0);
                        obj.put("status", "active");
                        obj.put("startedAt", System.currentTimeMillis());
                        obj.put("contributions", new JSONObject());
                        obj.put("rewardsByPlayer", new JSONObject());
                        party.activeObjective = obj;
                        for (String memberId : party.memberIds) {
                            sendTo(memberId, "PARTY_OBJECTIVE_UPDATED", obj);
                        }
                        broadcastAllPartyStates();
                        break;
                    }
                    case "PARTY_CANCEL_OBJECTIVE": {
                        if (player.partyId == null) return;
                        PartyRecord party = room.parties.get(player.partyId);
                        if (party == null || !playerId.equals(party.leaderPlayerId)) return;
                        party.activeObjective = null;
                        broadcastAllPartyStates();
                        break;
                    }
                    case "COOP_OBJECTIVE_PROGRESS": {
                        if (player.partyId == null) return;
                        PartyRecord party = room.parties.get(player.partyId);
                        if (party == null || party.activeObjective == null || !"active".equals(party.activeObjective.optString("status"))) return;
                        int inc = Math.max(1, payload.optInt("amount", 1));
                        int targetCount = Math.max(1, party.activeObjective.optInt("targetCount", 1));
                        int nextCount = Math.min(targetCount, party.activeObjective.optInt("currentCount", 0) + inc);
                        party.activeObjective.put("currentCount", nextCount);
                        boolean completed = nextCount >= targetCount;
                        if (completed) {
                            party.activeObjective.put("status", "completed");
                            party.activeObjective.put("completedAt", System.currentTimeMillis());
                        }
                        String evType = completed ? "PARTY_OBJECTIVE_COMPLETED" : "PARTY_OBJECTIVE_UPDATED";
                        for (String memberId : party.memberIds) {
                            sendTo(memberId, evType, party.activeObjective);
                        }
                        broadcastAllPartyStates();
                        break;
                    }
                    case "LEAVE_ROOM":
                    case "DISCONNECT":
                        removePlayer(playerId, "left");
                        break;
                    case "KICK_PLAYER": {
                        if (!playerId.equals(room.hostId)) return;
                        String targetId = payload.optString("targetPlayerId", "");
                        if (!targetId.isEmpty() && !targetId.equals(room.hostId) && room.players.containsKey(targetId)) {
                            JSONObject kickPayload = new JSONObject();
                            kickPayload.put("targetPlayerId", targetId);
                            kickPayload.put("reason", "Removed by LAN host.");
                            sendTo(targetId, "PLAYER_KICKED", kickPayload);
                            removePlayer(targetId, "kicked");
                        }
                        break;
                    }
                    case "CLOSE_ROOM":
                        if (playerId.equals(room.hostId)) removePlayer(playerId, "closed");
                        break;
                    default:
                        break;
                }
            }
        } catch (Exception ignored) {
        }
    }

    private JSONObject buildGameStartPayload(JSONObject snap) throws Exception {
        JSONObject start = new JSONObject();
        start.put("roomId", room.roomId);
        start.put("roomCode", room.roomCode);
        start.put("roomName", room.roomName);
        start.put("seed", room.seed);
        start.put("worldName", room.worldName);
        start.put("worldType", room.worldType);
        start.put("difficulty", room.difficulty);
        start.put("hostId", room.hostId);
        start.put("worldSettingsPermission", room.worldSettingsPermission);
        start.put("worldSettings", snap.optJSONObject("gameState") != null ? snap.optJSONObject("gameState").optJSONObject("worldSettings") : new JSONObject());
        start.put("worldTime", snap.optJSONObject("worldTime"));
        start.put("worldWeather", snap.optJSONObject("worldWeather"));
        start.put("requireAllReady", false);
        start.put("room", snap);
        return start;
    }

    private JSONObject buildRoomSnapshot() throws Exception {
        long now = System.currentTimeMillis();
        JSONObject snap = new JSONObject();
        snap.put("roomId", room.roomId);
        snap.put("roomCode", room.roomCode);
        snap.put("roomName", room.roomName);
        snap.put("hostId", room.hostId);
        snap.put("hostName", room.hostName);
        snap.put("maxPlayers", MAX_LAN_PLAYERS);
        snap.put("status", room.status);
        snap.put("createdAt", room.createdAt);
        snap.put("lastActivityAt", now);
        snap.put("serverTimestamp", now);
        snap.put("worldTime", materializeWorldTime(now));
        snap.put("worldWeather", new JSONObject(room.worldWeather.toString()));

        JSONArray playersArr = new JSONArray();
        for (PlayerRecord p : room.players.values()) {
            JSONObject po = new JSONObject();
            po.put("playerId", p.playerId);
            po.put("networkEntityId", p.networkEntityId);
            po.put("displayName", p.displayName);
            po.put("isHost", p.playerId.equals(room.hostId));
            po.put("isReady", p.isReady);
            po.put("joinedAt", p.joinedAt);
            po.put("avatarColor", p.avatarColor);
            po.put("pingMs", 3);
            po.put("connectionQuality", "excellent");
            po.put("level", p.level);
            po.put("partyId", p.partyId != null ? p.partyId : JSONObject.NULL);
            po.put("health", p.health);
            po.put("maxHealth", p.maxHealth);
            po.put("isDead", p.isDead);
            po.put("state", p.state);
            playersArr.put(po);
        }
        snap.put("players", playersArr);

        JSONObject worldSettings = new JSONObject();
        worldSettings.put("worldType", room.worldType);
        worldSettings.put("difficulty", room.difficulty);
        worldSettings.put("pvpEnabled", false);
        worldSettings.put("friendlyFire", room.friendlyFire);
        worldSettings.put("staminaUnlimited", "creative".equals(room.worldType));
        worldSettings.put("spawnX", 0);
        worldSettings.put("spawnY", 0);
        worldSettings.put("spawnZ", 4);

        JSONObject gameState = new JSONObject();
        gameState.put("worldName", room.worldName);
        gameState.put("worldType", room.worldType);
        gameState.put("difficulty", room.difficulty);
        gameState.put("seed", room.seed);
        gameState.put("privacy", "public");
        gameState.put("isPrivate", false);
        gameState.put("allowFriends", true);
        gameState.put("requireAllReady", false);
        gameState.put("worldSettingsPermission", room.worldSettingsPermission);
        gameState.put("worldSettings", worldSettings);
        gameState.put("locked", false);
        gameState.put("hasPassword", false);
        snap.put("gameState", gameState);
        return snap;
    }

    private JSONObject defaultPlayerState(double xOffset, String networkEntityId, long now) throws Exception {
        JSONObject st = new JSONObject();
        st.put("x", xOffset);
        st.put("y", 0);
        st.put("z", 4);
        st.put("yaw", 0);
        st.put("vx", 0);
        st.put("vy", 0);
        st.put("vz", 0);
        st.put("movementState", "idle");
        st.put("crouching", false);
        st.put("grounded", true);
        st.put("networkEntityId", networkEntityId);
        st.put("health", 100);
        st.put("maxHealth", 100);
        st.put("isDead", false);
        st.put("serverTime", now);
        return st;
    }

    private void broadcast(String type, String senderId, JSONObject payload, String excludePlayerId) {
        try {
            JSONObject env = new JSONObject();
            env.put("type", type);
            env.put("roomId", room != null ? room.roomId : "");
            env.put("playerId", senderId);
            env.put("seq", seqCounter.incrementAndGet());
            env.put("timestamp", System.currentTimeMillis());
            env.put("payload", payload);
            String json = env.toString();
            for (Map.Entry<String, PlayerSession> entry : sessions.entrySet()) {
                if (excludePlayerId != null && excludePlayerId.equals(entry.getKey())) continue;
                entry.getValue().sendText(json);
            }
        } catch (Exception ignored) {
        }
    }

    private void sendTo(String playerId, String type, JSONObject payload) {
        PlayerSession sess = sessions.get(playerId);
        if (sess == null) return;
        try {
            JSONObject env = new JSONObject();
            env.put("type", type);
            env.put("roomId", room != null ? room.roomId : "");
            env.put("playerId", "server");
            env.put("seq", seqCounter.incrementAndGet());
            env.put("timestamp", System.currentTimeMillis());
            env.put("payload", payload);
            sess.sendText(env.toString());
        } catch (Exception ignored) {
        }
    }

    private static void writeWsFrame(OutputStream out, int opcode, byte[] payload) throws IOException {
        int len = payload.length;
        out.write(0x80 | (opcode & 0x0F));
        if (len < 126) {
            out.write(len);
        } else if (len < 65536) {
            out.write(126);
            out.write((len >> 8) & 0xFF);
            out.write(len & 0xFF);
        } else {
            out.write(127);
            for (int i = 7; i >= 0; i--) {
                out.write((int) (((long) len >> (i * 8)) & 0xFF));
            }
        }
        out.write(payload);
        out.flush();
    }

    private static void sendHttp(OutputStream out, int status, String jsonBody) throws IOException {
        byte[] body = jsonBody.getBytes(StandardCharsets.UTF_8);
        String reason = status == 200 ? "OK" : status == 204 ? "No Content" : status == 409 ? "Conflict" : status == 403 ? "Forbidden" : "Not Found";
        String header =
                "HTTP/1.1 " + status + " " + reason + "\r\n" +
                "Content-Type: application/json; charset=utf-8\r\n" +
                "Content-Length: " + body.length + "\r\n" +
                "Access-Control-Allow-Origin: *\r\n" +
                "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
                "Access-Control-Allow-Headers: Content-Type, Authorization\r\n" +
                "Connection: close\r\n\r\n";
        out.write(header.getBytes(StandardCharsets.UTF_8));
        if (body.length > 0) out.write(body);
        out.flush();
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        int b;
        while ((b = in.read()) != -1) {
            if (b == '\n') break;
            if (b != '\r') baos.write(b);
            if (baos.size() > 8192) break;
        }
        if (b == -1 && baos.size() == 0) return null;
        return baos.toString("UTF-8");
    }

    private static boolean readFully(InputStream in, byte[] dst) throws IOException {
        int off = 0;
        while (off < dst.length) {
            int n = in.read(dst, off, dst.length - off);
            if (n < 0) return false;
            off += n;
        }
        return true;
    }

    private static Map<String, String> parseQuery(String q) {
        Map<String, String> map = new HashMap<>();
        if (q == null || q.isEmpty()) return map;
        for (String pair : q.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0) {
                try {
                    String k = URLDecoder.decode(pair.substring(0, eq), "UTF-8");
                    String v = URLDecoder.decode(pair.substring(eq + 1), "UTF-8");
                    map.put(k, v);
                } catch (Exception ignored) {
                }
            }
        }
        return map;
    }
}
