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
        JSONObject worldTime;
        JSONObject worldWeather;
        final Map<String, PlayerRecord> players = new LinkedHashMap<>();
    }

    private static final class PlayerRecord {
        String playerId;
        String networkEntityId;
        String displayName;
        boolean isHost;
        boolean isReady;
        long joinedAt;
        String avatarColor;
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
            r.worldTime.put("normalizedTime", 0.32);
            r.worldTime.put("dayCount", 1);
            r.worldTime.put("fullDayDurationSeconds", 360);
            r.worldTime.put("timeScale", 1);
            r.worldTime.put("paused", false);
            r.worldTime.put("serverTimestamp", r.createdAt);

            r.worldWeather = new JSONObject();
            r.worldWeather.put("currentState", "clear");
            r.worldWeather.put("targetState", "clear");
            r.worldWeather.put("transitionProgress", 1);
            r.worldWeather.put("intensity", 0);
            r.worldWeather.put("dynamicEnabled", true);
            r.worldWeather.put("transitionDurationSeconds", 14);
            r.worldWeather.put("windSpeedKmh", 12);
            r.worldWeather.put("serverTimestamp", r.createdAt);

            PlayerRecord host = new PlayerRecord();
            host.playerId = r.hostId;
            host.networkEntityId = "net_" + r.hostId;
            host.displayName = r.hostName;
            host.isHost = true;
            host.isReady = true;
            host.joinedAt = r.createdAt;
            host.avatarColor = AVATAR_COLORS[0];
            host.state = defaultPlayerState(0);
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
            p.avatarColor = AVATAR_COLORS[room.players.size() % AVATAR_COLORS.length];
            p.state = defaultPlayerState((room.players.size() - 1) * 2.2);

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
                        JSONObject snap = buildRoomSnapshot();
                        JSONObject connectRes = new JSONObject();
                        connectRes.put("playerId", playerId);
                        connectRes.put("room", snap);
                        connectRes.put("chatHistory", new JSONArray(chatHistory));
                        sendTo(playerId, "CONNECT", connectRes);
                        broadcast("ROOM_STATE", "server", snap, null);
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
                        room.status = "in-game";
                        JSONObject snap = buildRoomSnapshot();
                        broadcast("ROOM_STATE", "server", snap, null);
                        broadcast("START_GAME", playerId, buildGameStartPayload(snap), null);
                        break;
                    }
                    case "PLAYER_STATE": {
                        player.state = payload;
                        JSONObject outPayload = new JSONObject();
                        outPayload.put("playerId", playerId);
                        outPayload.put("state", payload);
                        outPayload.put("serverTimestamp", System.currentTimeMillis());
                        broadcast("PLAYER_STATE", playerId, outPayload, playerId);
                        break;
                    }
                    case "ENTITY_SYNC": {
                        if (!playerId.equals(room.hostId)) return;
                        broadcast("ENTITY_SYNC", playerId, payload, playerId);
                        break;
                    }
                    case "WORLD_SETTINGS_UPDATE": {
                        if (!playerId.equals(room.hostId)) return;
                        long now = System.currentTimeMillis();
                        if (payload.has("worldTime") && payload.optJSONObject("worldTime") != null) {
                            room.worldTime = payload.optJSONObject("worldTime");
                            room.worldTime.put("serverTimestamp", now);
                        }
                        if (payload.has("worldWeather") && payload.optJSONObject("worldWeather") != null) {
                            room.worldWeather = payload.optJSONObject("worldWeather");
                            room.worldWeather.put("serverTimestamp", now);
                        }
                        JSONObject out = new JSONObject();
                        out.put("worldSettingsPermission", "HOST_ONLY");
                        out.put("worldTime", room.worldTime);
                        out.put("worldWeather", room.worldWeather);
                        out.put("triggerLightning", payload.optBoolean("triggerLightning", false));
                        out.put("serverTimestamp", now);
                        out.put("updatedBy", playerId);
                        broadcast("WORLD_SETTINGS_UPDATE", playerId, out, null);
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
                        chatMsg.put("roomId", room.roomId);
                        chatMsg.put("senderId", playerId);
                        chatMsg.put("senderName", player.displayName);
                        chatMsg.put("message", text);
                        chatMsg.put("timestamp", System.currentTimeMillis());
                        chatHistory.add(chatMsg);
                        if (chatHistory.size() > 60) chatHistory.remove(0);
                        broadcast("ROOM_CHAT", playerId, chatMsg, null);
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
        start.put("worldTime", room.worldTime);
        start.put("worldWeather", room.worldWeather);
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
        snap.put("worldTime", room.worldTime);
        snap.put("worldWeather", room.worldWeather);

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
            po.put("level", 1);
            po.put("health", 100);
            po.put("maxHealth", 100);
            po.put("isDead", false);
            po.put("state", p.state);
            playersArr.put(po);
        }
        snap.put("players", playersArr);

        JSONObject worldSettings = new JSONObject();
        worldSettings.put("worldType", room.worldType);
        worldSettings.put("difficulty", room.difficulty);
        worldSettings.put("pvpEnabled", false);
        worldSettings.put("friendlyFire", false);
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
        gameState.put("worldSettingsPermission", "HOST_ONLY");
        gameState.put("worldSettings", worldSettings);
        gameState.put("locked", false);
        gameState.put("hasPassword", false);
        snap.put("gameState", gameState);
        return snap;
    }

    private JSONObject defaultPlayerState(double xOffset) throws Exception {
        JSONObject st = new JSONObject();
        st.put("x", xOffset);
        st.put("y", 0);
        st.put("z", 4);
        st.put("yaw", 0);
        st.put("vx", 0);
        st.put("vy", 0);
        st.put("vz", 0);
        st.put("anim", "idle");
        st.put("crouching", false);
        st.put("grounded", true);
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
